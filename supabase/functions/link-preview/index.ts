import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { getCorsHeaders } from '../_shared/cors.ts'
import { getSupabaseServiceClient } from '../_shared/supabase.ts'

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const FETCH_TIMEOUT_MS = 5000
const MAX_BODY_BYTES = 100_000 // Only read first ~100KB

// --- SSRF guard -----------------------------------------------------------
// This function fetches a caller-supplied URL server-side. Without these
// checks an authenticated user could point it at cloud metadata
// (169.254.169.254), loopback, or RFC1918 hosts and read the response.

// True if a 32-bit IPv4 value is loopback/private/link-local/reserved.
function ipv4NumIsBlocked(n: number): boolean {
  const a = (n >>> 24) & 255
  const b = (n >>> 16) & 255
  const c = (n >>> 8) & 255
  if (a === 0 || a === 10 || a === 127) return true // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true // 169.254/16 link-local + IMDS
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a >= 224) return true // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false
}

function dottedIsBlocked(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const o = [+m[1], +m[2], +m[3], +m[4]]
  if (o.some(x => x > 255)) return true // malformed → block
  return ipv4NumIsBlocked(((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0)
}

// Checks an IP literal (IPv4 dotted, or IPv6 incl. v4-mapped/compat and NAT64,
// in either dotted or compressed-hex form — the form the WHATWG URL parser
// emits, e.g. [::ffff:a9fe:a9fe] for 169.254.169.254).
function ipIsBlocked(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return dottedIsBlocked(ip)
  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::') return true
    if (ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd')) return true // link-local, ULA
    // Embedded IPv4 in dotted form: ::ffff:127.0.0.1 / 64:ff9b::127.0.0.1
    const dotted = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (dotted && dottedIsBlocked(dotted[1])) return true
    // Embedded IPv4 in hex form: ::ffff:7f00:1 / 64:ff9b::a9fe:a9fe
    const hex = ip.match(/(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const num = ((parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)) >>> 0
      if (ipv4NumIsBlocked(num)) return true
    }
    return false
  }
  return false
}

// Resolve A/AAAA over DNS-over-HTTPS. Deno.resolveDns is unavailable in the
// Supabase edge runtime, but an HTTPS fetch to a public resolver works.
async function resolveAllViaDoH(name: string): Promise<string[]> {
  const out: string[] = []
  for (const type of ['A', 'AAAA']) {
    const res = await fetch(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000) }
    )
    if (!res.ok) throw new Error('doh-failed')
    const data = await res.json()
    for (const ans of data?.Answer ?? []) {
      if ((ans.type === 1 || ans.type === 28) && typeof ans.data === 'string') out.push(ans.data)
    }
  }
  return out
}

async function hostIsBlocked(hostname: string): Promise<boolean> {
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === 'metadata.google.internal'
  ) {
    return true
  }
  if (h.includes(':')) return ipIsBlocked(h) // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return ipIsBlocked(h) // dotted IPv4
  // Anything else that isn't a valid public DNS hostname (decimal/hex/octal IP
  // encodings, bare single labels) is not a legitimate preview target → block.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(h)) return true
  // Resolve and block if any record is internal. Fail CLOSED: if resolution
  // fails we cannot prove the target is external, so we reject.
  try {
    const ips = await resolveAllViaDoH(h)
    if (ips.length === 0) return true
    return ips.some(ipIsBlocked)
  } catch {
    return true
  }
}

// Fetch following redirects manually, re-validating the host at each hop so a
// public URL can't 30x-redirect into the internal network.
async function ssrfSafeFetch(startUrl: string, init: RequestInit, maxHops = 4): Promise<Response> {
  let current = startUrl
  for (let hop = 0; hop < maxHops; hop++) {
    const u = new URL(current)
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('blocked-protocol')
    if (await hostIsBlocked(u.hostname)) throw new Error('blocked-host')
    const res = await fetch(current, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      await res.body?.cancel()
      current = new URL(loc, current).toString()
      continue
    }
    return res
  }
  throw new Error('too-many-redirects')
}

// Validate a Supabase session JWT via direct /auth/v1/user fetch.
// supabase.auth.getUser() is flaky with the new asymmetric (ES256) keys.
async function verifyUser(jwt: string): Promise<{ id: string } | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return body?.id ? { id: body.id } : null
}

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    // Authenticate user (direct /auth/v1/user fetch — works with ES256 keys).
    const authHeader = req.headers.get('Authorization')
    const jwt = authHeader?.replace(/^Bearer\s+/i, '')
    const user = jwt ? await verifyUser(jwt) : null

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { url } = await req.json()

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'url is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Validate URL
    let parsed: URL
    try {
      parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol')
      }
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // SSRF guard: reject internal/loopback/link-local targets before any fetch
    // or cache lookup. Generic 400 so this can't be used as a host/port scanner.
    if (await hostIsBlocked(parsed.hostname)) {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const serviceClient = getSupabaseServiceClient()

    // Check cache
    const { data: cached } = await serviceClient
      .from('link_previews')
      .select('*')
      .eq('url', url)
      .single()

    if (cached && new Date(cached.fetched_at).getTime() > Date.now() - CACHE_TTL_MS) {
      return new Response(JSON.stringify(cached), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Fetch URL with timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    let html: string
    try {
      const res = await ssrfSafeFetch(url, {
        signal: controller.signal,
        headers: {
          // Mimic a real browser UA — many publishers (Guardian, NYT, Bloomberg)
          // 403 unrecognized clients. Identifying as Boyk made every link
          // preview fail except for permissive sites like Wikipedia.
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
      clearTimeout(timeout)

      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'Failed to fetch URL' }), {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      // Read only first chunk to avoid huge pages
      const reader = res.body?.getReader()
      if (!reader) {
        return new Response(JSON.stringify({ error: 'No response body' }), {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      let totalBytes = 0
      const chunks: Uint8Array[] = []
      while (totalBytes < MAX_BODY_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        totalBytes += value.length
      }
      reader.cancel()

      html = new TextDecoder().decode(
        chunks.length === 1
          ? chunks[0]
          : chunks.reduce((acc, chunk) => {
              const merged = new Uint8Array(acc.length + chunk.length)
              merged.set(acc)
              merged.set(chunk, acc.length)
              return merged
            }, new Uint8Array(0))
      )
    } catch (e) {
      clearTimeout(timeout)
      return new Response(JSON.stringify({ error: 'Fetch timeout or error' }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Parse OG tags with regex (no DOM parser needed)
    const ogTitle = extractMeta(html, 'og:title')
    const ogDesc = extractMeta(html, 'og:description')
    const ogImage = extractMeta(html, 'og:image')
    const ogSiteName = extractMeta(html, 'og:site_name')

    // Fallbacks
    const title = ogTitle || extractTitleTag(html) || parsed.hostname
    const description = ogDesc || extractMeta(html, 'description') || null
    const image_url = ogImage || null
    const site_name = ogSiteName || parsed.hostname.replace(/^www\./, '')

    const preview = {
      url,
      title: title?.slice(0, 500) || null,
      description: description?.slice(0, 1000) || null,
      image_url: image_url?.slice(0, 2000) || null,
      site_name: site_name?.slice(0, 200) || null,
      fetched_at: new Date().toISOString(),
    }

    // Upsert cache via service role
    await serviceClient.from('link_previews').upsert(preview, { onConflict: 'url' })

    return new Response(JSON.stringify(preview), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('link-preview error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})

function extractMeta(html: string, property: string): string | null {
  // Match both property= and name= attributes
  const regex = new RegExp(
    `<meta\\s+(?:[^>]*?(?:property|name)=["']${escapeRegex(property)}["'][^>]*?content=["']([^"']*?)["']|[^>]*?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${escapeRegex(property)}["'])`,
    'i'
  )
  const match = html.match(regex)
  if (match) {
    return decodeEntities(match[1] || match[2] || '')
  }
  return null
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return match ? decodeEntities(match[1].trim()) : null
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
}
