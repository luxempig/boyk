import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import satori from 'https://esm.sh/satori@0.10.13'
import { initWasm, Resvg } from 'https://esm.sh/@resvg/resvg-wasm@2.6.0'

import { getCorsHeaders } from '../_shared/cors.ts'

const OG_WIDTH = 1200
const OG_HEIGHT = 630
const OG_PREFIX = 'og-images/boycotts'

// One-time init of the resvg WASM module per cold-start.
let wasmInitPromise: Promise<void> | null = null
function ensureWasmInit(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const wasmRes = await fetch('https://esm.sh/@resvg/resvg-wasm@2.6.0/index_bg.wasm')
      if (!wasmRes.ok) throw new Error('Failed to fetch resvg WASM module')
      await initWasm(await wasmRes.arrayBuffer())
    })()
  }
  return wasmInitPromise
}

// Cache the Inter font so we don't refetch from Google on every invocation.
let fontPromise: Promise<ArrayBuffer> | null = null
function loadInterBold(): Promise<ArrayBuffer> {
  if (!fontPromise) {
    fontPromise = (async () => {
      // Google Fonts serves woff2 only when the User-Agent looks like a
      // modern browser; default Deno UA gets older formats that satori
      // can't parse.
      const cssRes = await fetch(
        'https://fonts.googleapis.com/css2?family=Inter:wght@800&display=swap',
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        }
      )
      const css = await cssRes.text()
      const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('(woff2|woff)'\)/)
      if (!match) throw new Error('Could not parse Google Fonts CSS')
      const fontRes = await fetch(match[1])
      if (!fontRes.ok) throw new Error('Failed to fetch Inter font')
      return fontRes.arrayBuffer()
    })()
  }
  return fontPromise
}

interface BoycottForRender {
  name: string
  company_count: number
  tracker_count: number
}

function buildSatoriTree(boycott: BoycottForRender) {
  const subtitle =
    boycott.company_count === 1
      ? '1 company blocked'
      : `${boycott.company_count.toLocaleString()} companies blocked`

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px',
        backgroundImage: 'linear-gradient(135deg, #0f0f1a 0%, #1e1b3a 45%, #2d1f4a 100%)',
        color: '#ffffff',
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#a78bfa',
            },
            children: 'Boyk',
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '24px' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 84,
                    fontWeight: 800,
                    lineHeight: 1.05,
                    letterSpacing: '-0.02em',
                  },
                  children: boycott.name,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 36,
                    fontWeight: 800,
                    color: '#cbd5f5',
                    letterSpacing: '-0.01em',
                  },
                  children: subtitle,
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.55)',
            },
            children: 'boyk.org',
          },
        },
      ],
    },
  }
}

async function renderPng(boycott: BoycottForRender): Promise<Uint8Array> {
  await ensureWasmInit()
  const fontBuffer = await loadInterBold()

  const svg = await satori(buildSatoriTree(boycott) as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [{ name: 'Inter', data: fontBuffer, weight: 800, style: 'normal' }],
  })

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_WIDTH },
  })
  return resvg.render().asPng()
}

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

interface BoycottRow {
  id: string
  name: string
  creator_id: string
  is_public: boolean
}

async function fetchBoycott(boycottId: string): Promise<BoycottRow | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return null
  const res = await fetch(
    `${url}/rest/v1/boycotts?id=eq.${boycottId}&select=id,name,creator_id,is_public`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  )
  if (!res.ok) return null
  const rows = await res.json().catch(() => [])
  return rows[0] || null
}

async function fetchCompanyCount(boycottId: string): Promise<number> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return 0
  const res = await fetch(`${url}/rest/v1/boycott_companies?boycott_id=eq.${boycottId}&select=id`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) return 0
  const range = res.headers.get('Content-Range') || ''
  const m = range.match(/\/(\d+)$/)
  return m ? parseInt(m[1], 10) : 0
}

async function updateBoycottOgUrl(boycottId: string, ogUrl: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return
  await fetch(`${url}/rest/v1/boycotts?id=eq.${boycottId}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ og_image_url: ogUrl }),
  })
}

/**
 * Generate (or regenerate) the Open Graph image for a public boycott and
 * write the resulting URL back to boycotts.og_image_url.
 *
 * Auth: caller must be the boycott's creator. We don't rely solely on RLS
 * because we use the service role to write the og_image_url back; the
 * creator-id check below is the actual trust boundary.
 *
 * Request:  POST { boycottId: string }
 * Response: { ok: true, url: string } | { error: string }
 *
 * Deploy with --no-verify-jwt for the same reason as upload-url (asymmetric
 * signing keys break the function gateway). Auth is validated inside.
 */
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const jwt = authHeader?.replace(/^Bearer\s+/i, '')
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const user = await verifyUser(jwt)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { boycottId } = await req.json()
    if (!boycottId || typeof boycottId !== 'string') {
      return new Response(JSON.stringify({ error: 'boycottId is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const boycott = await fetchBoycott(boycottId)
    if (!boycott) {
      return new Response(JSON.stringify({ error: 'Boycott not found' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    if (boycott.creator_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    if (!boycott.is_public) {
      return new Response(JSON.stringify({ error: 'Private boycotts do not get OG images' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const accountId = Deno.env.get('R2_ACCOUNT_ID')
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
    const bucket = Deno.env.get('R2_BUCKET') || 'boyk-assets'
    const publicUrl = Deno.env.get('R2_PUBLIC_URL')

    if (!accountId || !accessKeyId || !secretAccessKey || !publicUrl) {
      console.error('Missing R2 environment variables')
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const companyCount = await fetchCompanyCount(boycottId)

    // Cap the rendered name length so satori never gets a pathological input.
    // 60 chars fits the 1200x630 layout with the 84px font; longer strings
    // would either overflow the canvas or stretch render time unboundedly.
    const truncatedName =
      boycott.name && boycott.name.length > 60
        ? boycott.name.slice(0, 57).trimEnd() + '…'
        : boycott.name
    const png = await renderPng({
      name: truncatedName,
      company_count: companyCount,
      tracker_count: 0,
    })

    const key = `${OG_PREFIX}/${boycottId}.png`
    await uploadToR2({
      accountId,
      bucket,
      key,
      accessKeyId,
      secretAccessKey,
      body: png,
      contentType: 'image/png',
    })

    // Cache-bust by appending updated-at so clients refresh after regeneration.
    const ogUrl = `${publicUrl.replace(/\/$/, '')}/${key}?v=${Date.now()}`
    await updateBoycottOgUrl(boycottId, ogUrl)

    return new Response(JSON.stringify({ ok: true, url: ogUrl }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('generate-boycott-og-image error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})

// --- R2 server-side PUT with AWS Signature V4 ---
//
// Same primitives used by upload-url and delete-comment-media. When a fourth
// R2 operation appears, extract these into _shared/r2.ts.

async function uploadToR2({
  accountId,
  bucket,
  key,
  accessKeyId,
  secretAccessKey,
  body,
  contentType,
}: {
  accountId: string
  bucket: string
  key: string
  accessKeyId: string
  secretAccessKey: string
  body: Uint8Array
  contentType: string
}): Promise<void> {
  const region = 'auto'
  const host = `${bucket}.${accountId}.r2.cloudflarestorage.com`
  const now = new Date()
  const dateStamp = formatDate(now)
  const amzDate = formatAmzDate(now)
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`

  const payloadHash = await sha256HexBytes(body)
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`

  const canonicalRequest = [
    'PUT',
    `/${encodeS3Key(key)}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, 's3')
  const signature = await hmacHex(signingKey, stringToSign)
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${host}/${encodeS3Key(key)}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 upload failed: ${res.status} ${text}`)
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}
function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}
function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map(s => encodeURIComponent(s))
    .join('/')
}
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}
async function hmacHex(key: ArrayBuffer | Uint8Array, data: string): Promise<string> {
  const sig = await hmac(key, data)
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode('AWS4' + secretKey), dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}
