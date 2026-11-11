/* global HTMLRewriter */

// Apple App Site Association payload. Inlined here because CF Pages strips
// hidden directories (.well-known/) from the deploy, so the static file in
// public/.well-known/ is not actually served. The Worker is the authoritative
// source for this route. App ID is <TEAM_ID>.<bundleID> — the bundle ID must
// stay in sync with PRODUCT_BUNDLE_IDENTIFIER in ios/Config/Shared.xcconfig.
// See documents/reference/ios-deep-links.md.
const AASA_PAYLOAD = JSON.stringify({
  applinks: {
    details: [
      {
        appIDs: ['D5H5726S52.org.boyk.app'],
        components: [
          { '/': '/boycott/*', comment: 'Open boycott detail in app' },
          { '/': '/post/*', comment: 'Open post detail in app' },
          { '/': '/user/*', comment: 'Open user profile in app' },
          { '/': '/company/*', comment: 'Open company detail in app' },
          { '/': '/brand/*', comment: 'Open brand detail in app' },
        ],
      },
    ],
  },
  webcredentials: {
    apps: ['D5H5726S52.org.boyk.app'],
  },
})

// Origin of the graph API when LIVE_BACKEND=true; override with the
// NEO4J_API_URL env var.
const DEFAULT_NEO4J_API = 'https://dzavkrusst.us-east-1.awsapprunner.com'

// Sentry ingest for org "boyk": boyk-react, boyk-ios, boyk-express
const SENTRY_INGEST_HOST = 'o4511024545660928.ingest.us.sentry.io'
const SENTRY_PROJECTS = ['4512203240439808', '4512203232575488', '4512203242995712']

// Bump to invalidate Worker Cache API entries. CF zone purge doesn't clear
// caches.default — rotate this string when stale data needs flushing.
const CACHE_KEY_VERSION = 'v3'

function versionedCacheKey(url) {
  const u = new URL(url.toString())
  u.searchParams.set('__cv', CACHE_KEY_VERSION)
  return new Request(u.toString(), { method: 'GET' })
}

const ALLOWED_ORIGINS = [
  'https://boyk.org',
  'https://www.boyk.org',
  'https://staging.boyk.org',
  'https://boyk.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

// Edge cache TTLs by endpoint pattern (seconds)
// Data only changes after daily ETL — aggressive caching is safe
const CACHE_TTLS = {
  '/api/stats': 86400, // 24 hours — cosmetic data, changes once per ETL
  '/api/companies/search': 21600, // 6 hours — index only changes after ETL
  '/api/companies/': 43200, // 12 hours — company detail + graph
  '/api/brands/search': 21600, // 6 hours — search results
  '/api/brands/': 43200, // 12 hours — brand detail
  '/api/products/search': 21600, // 6 hours — search results
  '/api/products/': 86400, // 24 hours — products barely change
  '/api/persons/': 43200, // 12 hours — person detail
}

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin') || ''
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin
  }
  return ALLOWED_ORIGINS[0]
}

function getCacheTtl(path) {
  for (const [prefix, ttl] of Object.entries(CACHE_TTLS)) {
    if (path.startsWith(prefix)) return ttl
  }
  return 0
}

// Stale-while-revalidate: serve stale for up to 24hr while refreshing in background
const SWR_MAX_STALE_S = 86400

function isStale(cachedResponse, maxAgeS) {
  const cachedAt = parseInt(cachedResponse.headers.get('X-Cached-At') || '0', 10)
  if (!cachedAt) return true
  const ageS = (Date.now() - cachedAt) / 1000
  return ageS > maxAgeS
}

function isTooOld(cachedResponse) {
  const cachedAt = parseInt(cachedResponse.headers.get('X-Cached-At') || '0', 10)
  if (!cachedAt) return true
  return (Date.now() - cachedAt) / 1000 > SWR_MAX_STALE_S
}

// KV search cache helpers
function normalizeSearchQuery(q) {
  return (q || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

function getSearchKvKey(path, query, limit) {
  const type = path.includes('/brands/')
    ? 'brand'
    : path.includes('/products/')
      ? 'product'
      : 'company'
  return `search:${type}:${normalizeSearchQuery(query)}:${limit}`
}

function isSearchEndpoint(path) {
  return path.endsWith('/search')
}

const STAGING_COOKIE = 'boyk_staging_auth'

function checkStagingAuth(request, env) {
  const password = env.STAGING_PASSWORD
  if (!password) {
    return new Response('Staging environment misconfigured', { status: 500 })
  }

  // Check for valid auth cookie
  const cookies = request.headers.get('Cookie') || ''
  const match = cookies.match(new RegExp(`${STAGING_COOKIE}=([^;]+)`))
  if (match && match[1] === password) {
    return null // Auth passed via cookie
  }

  // Handle form submission
  if (request.method === 'POST') {
    return handleStagingLogin(request, password)
  }

  // Show login form
  return new Response(stagingLoginPage(), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

async function handleStagingLogin(request, password) {
  const body = await request.formData()
  const submitted = body.get('password') || ''

  if (submitted === password) {
    // Set auth cookie and redirect to the requested page
    const url = new URL(request.url)
    return new Response(null, {
      status: 302,
      headers: {
        Location: url.pathname + url.search,
        'Set-Cookie': `${STAGING_COOKIE}=${password}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
      },
    })
  }

  return new Response(stagingLoginPage('Incorrect password'), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function stagingLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Boyk Staging</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0a0a1a;color:#e2e8f0;font-family:system-ui,sans-serif}
  .card{background:#12122a;border:1px solid #2d2d5e;border-radius:12px;padding:2.5rem;
    width:100%;max-width:360px;text-align:center}
  h1{font-size:1.5rem;margin-bottom:.5rem;letter-spacing:1px}
  p{font-size:.875rem;color:#94a3b8;margin-bottom:1.5rem}
  input{width:100%;padding:.75rem 1rem;border:1px solid #2d2d5e;border-radius:8px;
    background:#0a0a1a;color:#e2e8f0;font-size:1rem;margin-bottom:1rem;outline:none}
  input:focus{border-color:#f472b6}
  button{width:100%;padding:.75rem;border:none;border-radius:8px;background:#db2777;
    color:#fff;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s}
  button:hover{background:#be185d}
  .error{color:#f87171;font-size:.875rem;margin-bottom:1rem}
</style>
</head><body>
<form class="card" method="POST">
  <h1>Boyk Staging</h1>
  <p>Enter the staging password to continue</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <input type="password" name="password" placeholder="Password" autofocus required>
  <button type="submit">Enter</button>
</form>
</body></html>`
}

async function revalidateInBackground(targetURL, fetchOptions, cacheKey, cache, cacheTtl) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(targetURL, { ...fetchOptions, signal: controller.signal })
    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.text()
      const contentType = response.headers.get('Content-Type') || ''
      if (contentType.includes('application/json')) {
        const cacheResponse = new Response(data, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${SWR_MAX_STALE_S}`,
            'X-Cached-At': String(Date.now()),
            'X-Cache-Ttl': String(cacheTtl),
          },
        })
        await cache.put(cacheKey, cacheResponse)
      }
    }
  } catch {
    // Silently fail — stale cache continues serving
  }
}

async function fetchFromR2Fallback(env, path) {
  if (!env.BOYK_ASSETS) return null
  // Map API path to R2 key: /api/companies/ABC123 → api-cache/companies/ABC123.json
  const segments = path.replace(/^\/api\//, '').split('/')
  if (segments.length < 2) return null
  const r2Key = `api-cache/${segments[0]}/${segments[1]}.json`
  try {
    const obj = await env.BOYK_ASSETS.get(r2Key)
    if (!obj) return null
    return await obj.text()
  } catch {
    return null
  }
}

// Open Food Facts barcode index fallback. Shards are built offline by
// boyk-data-etl/tools/off-ingest (data (c) Open Food Facts contributors, ODbL 1.0)
// with brand strings pre-resolved to graph entities, and uploaded to R2 under
// offidx/{first-3-of-barcode}.json. Scanners disagree about leading zeros
// (EAN-13 vs UPC-A), so a few candidate spellings are tried.
async function lookupOffBarcode(env, rawCode) {
  if (!env.BOYK_ASSETS || !rawCode) return null
  const candidates = [...new Set([rawCode, rawCode.replace(/^0+/, ''), rawCode.padStart(13, '0')])]
  for (const code of candidates) {
    if (!code || code.length < 3) continue
    try {
      const obj = await env.BOYK_ASSETS.get(`offidx/${code.slice(0, 3)}.json`)
      if (!obj) continue
      const shard = await obj.json()
      const entry = shard[code]
      if (!entry) continue
      // A 4th element "fdc" marks a USDA FoodData Central entry: public
      // domain, and not Open Food Facts data, so it must not carry their credit.
      const [name, brand, m, origin] = entry
      const match = m || null
      const fdc = origin === 'fdc'
      return {
        barcode: code,
        name: name || brand || null,
        brand_name: brand || null,
        brand_id: match && match.t === 'brand' ? match.id : null,
        company_id: match ? match.cid || (match.t === 'company' ? match.id : null) : null,
        company_name: match ? match.cname || (match.t === 'company' ? match.name : null) : null,
        source: fdc ? 'usda_fdc' : 'openfoodfacts',
        license: fdc ? 'public-domain' : 'ODbL',
        attribution: fdc
          ? { name: 'USDA FoodData Central', url: 'https://fdc.nal.usda.gov' }
          : { name: 'Open Food Facts', url: 'https://world.openfoodfacts.org' },
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

// How far a lookup got: the share of scans ending in 'company' is the number
// that matters, since only those can be checked against a boycott.
function scanOutcome(product) {
  if (!product) return 'none'
  if (product.company_id) return 'company'
  if (product.brand_id || product.brand_name) return 'brand'
  return 'product'
}

// Barcode lookups ask the graph first, then the R2 index. Most graph products
// have no brand→company path while the index often does, so the index is
// consulted whenever the graph can't name a company, not only on a 404.
async function handleBarcodeLookup(env, ctx, code, { neo4jApi, corsOrigin, isStaging }) {
  const cache = caches.default
  const cacheKey = new Request(
    `https://boyk.org/__barcode/${CACHE_KEY_VERSION}/${encodeURIComponent(code)}`
  )
  let product = null
  let cacheStatus = 'MISS'

  if (!isStaging) {
    const cached = await cache.match(cacheKey).catch(() => null)
    if (cached) {
      product = await cached.json().catch(() => null)
      if (product) cacheStatus = 'HIT'
    }
  }

  if (!product) {
    let graph = null
    if (!neo4jApi) {
      graph = await snapshotBarcode(env, code)
    } else {
      try {
        const res = await fetch(`${neo4jApi}/api/products/barcode/${encodeURIComponent(code)}`, {
          signal: AbortSignal.timeout(3000),
        })
        if (res.ok && (res.headers.get('Content-Type') || '').includes('application/json')) {
          graph = await res.json()
        }
      } catch {
        // graph slow or down — the index can still answer
      }
    }

    if (graph?.company_id) {
      product = graph
    } else {
      const off = await lookupOffBarcode(env, code)
      if (graph && off?.company_id) {
        // Keep the graph's product details (image, recall flag); take the
        // owner from the index, with the index's credit.
        product = {
          ...graph,
          brand_id: graph.brand_id || off.brand_id,
          brand_name: graph.brand_name || off.brand_name,
          company_id: off.company_id,
          company_name: off.company_name,
          source: off.source,
          license: off.license,
          attribution: off.attribution,
        }
      } else {
        product = graph || off
      }
    }

    if (product && !isStaging) {
      ctx.waitUntil(
        cache
          .put(
            cacheKey,
            new Response(JSON.stringify(product), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=86400',
              },
            })
          )
          .catch(() => {})
      )
    }
  }

  if (!isStaging && !isSnapshot(env) && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    ctx.waitUntil(
      fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_barcode_scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ p_barcode: code, p_outcome: scanOutcome(product) }),
      }).catch(() => {})
    )
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
    'Cache-Control': product ? 'public, max-age=86400' : 'no-store',
    'X-Cache': cacheStatus,
  }
  if (!product) {
    return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404, headers })
  }
  return new Response(JSON.stringify(product), { status: 200, headers })
}

// ---------------------------------------------------------------------------
// Snapshot mode
// ---------------------------------------------------------------------------
// Unless LIVE_BACKEND=true, the site is a read-only demo: the graph API is
// answered from files saved in R2 by scripts/demo/ (one JSON file per company,
// brand, person and barcode, plus a search index), and nothing is sent to
// Supabase.
function isSnapshot(env) {
  return env.LIVE_BACKEND !== 'true'
}

// Tokenizer and stopwords shared with scripts/demo/build-search-index.py —
// keep the two in step.
const SEARCH_STOPWORDS = new Set(
  (
    'the and of inc ltd limited llc gmbh co corp corporation company holdings holding ' +
    'group sa ag plc bv nv ab as oy spa srl sarl pty pte kg international de la le et und'
  ).split(' ')
)

function searchTokens(text) {
  return (text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Names are filed under the first two characters of each word, so one small
// file holds every candidate. Every query word must start some word of the
// name; exact and leading matches rank above the entity's own significance.
async function snapshotSearch(env, kind, query, limit) {
  const words = searchTokens(query)
  const compact = words.join('')
  const key =
    words.find(w => w.length >= 2 && !SEARCH_STOPWORDS.has(w)) ||
    words.find(w => w.length >= 2) ||
    (compact.length >= 2 ? compact : null)
  if (!key || !env.BOYK_ASSETS) return []

  const obj = await env.BOYK_ASSETS.get(`api-cache/search/${kind}/${key.slice(0, 2)}.json`)
  if (!obj) return []
  const rows = await obj.json()

  // "the coca" should still find Coca-Cola: filler words only count when the
  // query has nothing else.
  const meaningful = words.filter(w => !SEARCH_STOPWORDS.has(w))
  const required = meaningful.length ? meaningful : words

  const hits = []
  for (const row of rows) {
    const nameWords = searchTokens(row.name)
    const nameCompact = nameWords.join('')
    const allWordsMatch = required.every(w => nameWords.some(n => n.startsWith(w)))
    if (!allWordsMatch && !nameCompact.startsWith(compact)) continue
    let match = 1
    if (nameCompact === compact) match = 6
    else if (nameCompact.startsWith(compact)) match = 3
    hits.push([match * 4 + (row._r || 0), row])
  }
  hits.sort((a, b) => b[0] - a[0])
  return hits.slice(0, limit).map(([, row]) => {
    const { _r, ...rest } = row
    return rest
  })
}

const COMPANY_SEARCH_FIELDS = [
  'id',
  'name',
  'logo_url',
  'website',
  'description',
  'lei',
  'ticker',
  'country',
  'wikidata_id',
  'industry',
  'employees',
  'sanctioned',
  'sanction_lists',
  'sanction_programs',
  'brand_count',
  'subsidiary_count',
]

async function snapshotObject(env, key) {
  if (!env.BOYK_ASSETS) return null
  try {
    const obj = await env.BOYK_ASSETS.get(`api-cache/${key}.json`)
    return obj ? await obj.text() : null
  } catch {
    return null
  }
}

// The graph's own answer for a barcode, as saved. Scanners disagree about
// leading zeros, so the same spellings as the index lookup are tried.
async function snapshotBarcode(env, rawCode) {
  const candidates = [...new Set([rawCode, rawCode.replace(/^0+/, ''), rawCode.padStart(13, '0')])]
  for (const code of candidates) {
    if (!code) continue
    const text = await snapshotObject(env, `barcode/${encodeURIComponent(code)}`)
    if (text) {
      try {
        return JSON.parse(text)
      } catch {
        // unreadable file — try the next spelling
      }
    }
  }
  return null
}

async function handleSnapshotApi(env, ctx, request, path, url, corsOrigin) {
  const respond = (body, status = 200, cache = 'public, max-age=3600') =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
        'Cache-Control': status === 200 ? cache : 'no-store',
        'X-Data-Source': 'snapshot',
      },
    })

  if (request.method !== 'GET') return respond({ error: 'This is a read-only demo' }, 405)
  if (path === '/api/health') return respond({ status: 'ok', mode: 'snapshot' })

  if (path === '/api/stats') {
    return respond((await snapshotObject(env, 'stats')) || {})
  }

  const search = path.match(/^\/api\/(companies|brands|products)\/search$/)
  if (search) {
    const q = url.searchParams.get('q') || ''
    if (q.length < 2 || q.length > 200 || search[1] === 'products') return respond([])
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit')) || 20, 100))
    const rows = await snapshotSearch(env, search[1], q, limit)
    if (search[1] === 'brands') return respond(rows)
    // The live API returns every field, null when unset.
    return respond(
      rows.map(row => Object.fromEntries(COMPANY_SEARCH_FIELDS.map(f => [f, row[f] ?? null])))
    )
  }

  const barcode = path.match(/^\/api\/products\/barcode\/([^/]+)$/)
  if (barcode) {
    return handleBarcodeLookup(env, ctx, decodeURIComponent(barcode[1]), {
      neo4jApi: null,
      corsOrigin,
      isStaging: false,
    })
  }

  const detail = path.match(/^\/api\/(companies|brands|persons)\/([^/]+)$/)
  if (detail) {
    const id = decodeURIComponent(detail[2])
    const text = await snapshotObject(env, `${detail[1]}/${encodeURIComponent(id)}`)
    if (text) return respond(text)
  }
  return respond({ error: 'Not found' }, 404)
}

// OFAC comprehensively sanctioned countries — reviewed quarterly
// Reference: https://ofac.treasury.gov/sanctions-programs-and-country-information
const BLOCKED_COUNTRIES = ['CU', 'IR', 'KP', 'SY', 'RU', 'BY']

// Default OG image used when a boycott has no per-boycott image yet, OR when
// the share-fetch fails. Keep this in sync with public/og-image.jpg.
const DEFAULT_OG_IMAGE = 'https://boyk.org/og-image.jpg'

// Fetch boycott share metadata from Supabase. Returns null on any failure so
// the Worker falls back to the static <meta> tags shipped in index.html.
async function fetchBoycottForShare(env, boycottId) {
  const supabaseUrl = env.SUPABASE_URL
  const anonKey = env.SUPABASE_ANON_KEY
  if (isSnapshot(env) || !supabaseUrl || !anonKey) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_boycott_for_share`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_id: boycottId }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  } catch {
    return null
  }
}

function escapeHtmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Stream-rewrite the SPA HTML response with per-boycott meta tags. Returns
// null if metadata couldn't be fetched, signaling the caller to serve the
// untouched response.
async function maybeInjectBoycottOg(assetResponse, boycottId, env) {
  const data = await fetchBoycottForShare(env, boycottId)
  if (!data) return null

  const title = `${data.name} — Boyk`
  const summaryParts = []
  if (data.company_count > 0) {
    summaryParts.push(
      `${data.company_count} ${data.company_count === 1 ? 'company' : 'companies'} blocked`
    )
  }
  if (data.tracker_count > 0) {
    summaryParts.push(
      `${data.tracker_count} ${data.tracker_count === 1 ? 'follower' : 'followers'}`
    )
  }
  const description =
    data.description?.trim() ||
    (summaryParts.length ? summaryParts.join(' · ') : 'Track corporate accountability on Boyk.')
  const image = data.og_image_url || DEFAULT_OG_IMAGE
  const canonical = `https://boyk.org/boycott/${data.id}`

  const setAttr = (name, value) => ({
    element(el) {
      el.setAttribute(name, value)
    },
  })

  const rewriter = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(escapeHtmlAttr(title))
      },
    })
    .on('meta[name="title"]', { element: el => el.setAttribute('content', title) })
    .on('meta[name="description"]', {
      element: el => el.setAttribute('content', description),
    })
    .on('meta[property="og:title"]', setAttr('content', title))
    .on('meta[property="og:description"]', setAttr('content', description))
    .on('meta[property="og:url"]', setAttr('content', canonical))
    .on('meta[property="og:image"]', setAttr('content', image))
    .on('meta[property="og:type"]', setAttr('content', 'article'))
    .on('meta[name="twitter:title"]', setAttr('content', title))
    .on('meta[name="twitter:description"]', setAttr('content', description))
    .on('meta[name="twitter:url"]', setAttr('content', canonical))
    .on('meta[name="twitter:image"]', setAttr('content', image))
    .on('link[rel="canonical"]', setAttr('href', canonical))

  const transformed = rewriter.transform(assetResponse)
  const response = new Response(transformed.body, transformed)
  response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  return response
}

// Fetch post share metadata from Supabase. Mirrors fetchBoycottForShare —
// returns null on any failure so the Worker falls back to the static <meta>
// tags shipped in index.html. Only posts with audience='everyone' come back.
async function fetchPostForShare(env, postId) {
  const supabaseUrl = env.SUPABASE_URL
  const anonKey = env.SUPABASE_ANON_KEY
  if (isSnapshot(env) || !supabaseUrl || !anonKey) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_post_for_share`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_id: postId }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  } catch {
    return null
  }
}

function truncateForOg(text, max) {
  if (!text) return ''
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1).trimEnd() + '…'
}

// Stream-rewrite the SPA HTML response with per-post meta tags.
async function maybeInjectPostOg(assetResponse, postId, env) {
  const data = await fetchPostForShare(env, postId)
  if (!data) return null

  const authorLabel = data.author_display_name || data.author_username || 'Someone'
  const titlePrefix = data.boycott_name ? `${authorLabel} on ${data.boycott_name}` : authorLabel
  const title = `${titlePrefix} — Boyk`
  const description = truncateForOg(data.content || `${authorLabel} posted on Boyk`, 200)
  // Prefer media attached to the post; fall back to author avatar, then site default.
  const image = data.media_url || data.author_profile_picture_url || DEFAULT_OG_IMAGE
  const canonical = `https://boyk.org/post/${data.id}`

  const setAttr = (name, value) => ({
    element(el) {
      el.setAttribute(name, value)
    },
  })

  const rewriter = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(escapeHtmlAttr(title))
      },
    })
    .on('meta[name="title"]', { element: el => el.setAttribute('content', title) })
    .on('meta[name="description"]', {
      element: el => el.setAttribute('content', description),
    })
    .on('meta[property="og:title"]', setAttr('content', title))
    .on('meta[property="og:description"]', setAttr('content', description))
    .on('meta[property="og:url"]', setAttr('content', canonical))
    .on('meta[property="og:image"]', setAttr('content', image))
    .on('meta[property="og:type"]', setAttr('content', 'article'))
    .on('meta[name="twitter:title"]', setAttr('content', title))
    .on('meta[name="twitter:description"]', setAttr('content', description))
    .on('meta[name="twitter:url"]', setAttr('content', canonical))
    .on('meta[name="twitter:image"]', setAttr('content', image))
    .on('link[rel="canonical"]', setAttr('href', canonical))

  const transformed = rewriter.transform(assetResponse)
  const response = new Response(transformed.body, transformed)
  response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  return response
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    const isStaging = env.DEPLOY_ENV === 'staging'

    // OFAC geoblocking — block sanctioned countries (production only)
    if (!isStaging) {
      const country = request.cf?.country
      if (country && BLOCKED_COUNTRIES.includes(country)) {
        return new Response(
          'This service is unavailable in your region due to U.S. regulatory requirements.',
          { status: 451 }
        )
      }
    }

    // Apple App Site Association — must be served as application/json with no
    // redirects, and must be reachable without auth (Apple's CDN won't pass a
    // staging password cookie). Served from the inlined AASA_PAYLOAD because
    // CF Pages strips hidden directories from deploys, making the static file
    // unreachable. Placed BEFORE the staging auth gate so Universal Links can
    // be verified against staging.boyk.org as well as boyk.org.
    if (url.pathname === '/.well-known/apple-app-site-association') {
      return new Response(AASA_PAYLOAD, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // Staging: require cookie-based auth before anything else
    if (isStaging) {
      const authResponse = checkStagingAuth(request, env)
      if (authResponse) return authResponse
    }

    // Redirect *.pages.dev to boyk.org (production only — staging stays on its own domain)
    if (!isStaging && url.hostname.endsWith('.pages.dev')) {
      const dest = new URL(url.pathname + url.search, 'https://boyk.org')
      return Response.redirect(dest.toString(), 301)
    }

    // Relay error reports to Sentry. Some networks (Türk Telekom among them)
    // block sentry.io by TLS hostname, so the web and iOS DSNs point here
    // instead. Only our own projects are forwarded, so this can't be used
    // as an open proxy.
    const sentryMatch = url.pathname.match(/^\/sentry-relay\/api\/(\d+)\/envelope\/?$/)
    if (sentryMatch) {
      if (request.method !== 'POST' || !SENTRY_PROJECTS.includes(sentryMatch[1])) {
        return new Response(null, { status: 404 })
      }
      const headers = new Headers()
      for (const name of ['content-type', 'content-encoding', 'x-sentry-auth', 'user-agent']) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
      }
      const upstream = await fetch(
        `https://${SENTRY_INGEST_HOST}/api/${sentryMatch[1]}/envelope/${url.search}`,
        { method: 'POST', headers, body: request.body }
      )
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
      })
    }

    // Proxy /neo4j-api/* requests to the Neo4j API server
    if (url.pathname.startsWith('/neo4j-api')) {
      const corsOrigin = getCorsOrigin(request)

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': corsOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        })
      }

      const path = url.pathname.replace(/^\/neo4j-api/, '')

      if (isSnapshot(env)) {
        return handleSnapshotApi(env, ctx, request, path, url, corsOrigin)
      }
      const neo4jApi = env.NEO4J_API_URL || DEFAULT_NEO4J_API
      const targetURL = `${neo4jApi}${path}${url.search}`

      const barcodeMatch =
        request.method === 'GET' && path.match(/^\/api\/products\/barcode\/([^/]+)$/)
      if (barcodeMatch) {
        return handleBarcodeLookup(env, ctx, decodeURIComponent(barcodeMatch[1]), {
          neo4jApi,
          corsOrigin,
          isStaging,
        })
      }

      // Edge cache: check for cached GET responses
      const cacheTtl = !isStaging && request.method === 'GET' ? getCacheTtl(path) : 0
      const cache = caches.default
      const fetchOptions = {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
      }

      // SWR cache read: serve fresh directly, serve stale + revalidate in background
      if (cacheTtl > 0) {
        const cacheKey = versionedCacheKey(url)
        const cached = await cache.match(cacheKey)
        if (cached && !isTooOld(cached)) {
          const headers = new Headers(cached.headers)
          headers.set('Access-Control-Allow-Origin', corsOrigin)

          const entryTtl = parseInt(cached.headers.get('X-Cache-Ttl') || String(cacheTtl), 10)
          if (!isStale(cached, entryTtl)) {
            headers.set('X-Cache', 'HIT')
            return new Response(cached.body, { status: cached.status, headers })
          }

          // Stale but within SWR window — serve stale, revalidate in background
          headers.set('X-Cache', 'STALE')
          const staleBody = await cached.text()
          if (ctx.waitUntil) {
            ctx.waitUntil(
              revalidateInBackground(targetURL, fetchOptions, cacheKey, cache, cacheTtl)
            )
          }
          return new Response(staleBody, { status: cached.status, headers })
        }
      }

      // KV search cache (global, cross-PoP) — check after edge cache, before origin
      if (cacheTtl > 0 && isSearchEndpoint(path) && env.BOYK_KV) {
        const searchParams = new URL(url).searchParams
        const kvKey = getSearchKvKey(path, searchParams.get('q'), searchParams.get('limit') || '20')
        try {
          const kvResult = await env.BOYK_KV.get(kvKey, 'text')
          if (kvResult) {
            return new Response(kvResult, {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': corsOrigin,
                'X-Cache': 'KV-HIT',
              },
            })
          }
        } catch {
          // KV failure — fall through to origin
        }
      }

      try {
        // Forward request body for POST/PUT/PATCH methods
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          fetchOptions.body = await request.text()
        }

        // Origin-fetch timeout enables the R2 fallback on slow responses.
        // Company detail runs two batched CALL{} queries on a 0.25 vCPU App
        // Runner — uncached IDs routinely need >3s, and the boycott page
        // prefetches several at once, so those get a longer budget. Search
        // and everything else keep the tight 3s.
        const isCompanyDetail = /^\/api\/companies\/[^/]+$/.test(path)
        const originTimeoutMs = isCompanyDetail ? 8000 : 3000
        const controller = new AbortController()
        const fetchTimeout = setTimeout(() => controller.abort(), originTimeoutMs)
        let response
        try {
          response = await fetch(targetURL, { ...fetchOptions, signal: controller.signal })
        } finally {
          clearTimeout(fetchTimeout)
        }
        const data = await response.text()

        // Guard against non-JSON upstream responses (e.g. nginx error pages)
        const contentType = response.headers.get('Content-Type') || ''
        if (!contentType.includes('application/json')) {
          return new Response(JSON.stringify({ error: 'Upstream returned non-JSON response' }), {
            status: 502,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': corsOrigin,
            },
          })
        }

        const resHeaders = {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
          'Cache-Control': cacheTtl > 0 ? `public, max-age=${cacheTtl}` : 'no-store',
          'X-Cache': 'MISS',
        }

        // Forward rate limit headers from upstream
        for (const h of [
          'RateLimit-Limit',
          'RateLimit-Remaining',
          'RateLimit-Reset',
          'RateLimit-Policy',
        ]) {
          const v = response.headers.get(h)
          if (v) resHeaders[h] = v
        }

        const res = new Response(data, { status: response.status, headers: resHeaders })

        // Store successful GET responses in edge cache with SWR timestamp
        if (cacheTtl > 0 && response.status === 200) {
          const cacheKey = versionedCacheKey(url)
          const cacheResponse = new Response(data, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${SWR_MAX_STALE_S}`,
              'X-Cached-At': String(Date.now()),
              'X-Cache-Ttl': String(cacheTtl),
            },
          })
          const put = cache.put(cacheKey, cacheResponse)
          if (ctx.waitUntil) ctx.waitUntil(put)

          // Write search results to KV for cross-PoP caching
          if (isSearchEndpoint(path) && env.BOYK_KV) {
            const searchParams = new URL(url).searchParams
            const kvKey = getSearchKvKey(
              path,
              searchParams.get('q'),
              searchParams.get('limit') || '20'
            )
            if (ctx.waitUntil) {
              ctx.waitUntil(env.BOYK_KV.put(kvKey, data, { expirationTtl: 21600 }).catch(() => {}))
            }
          }
        }

        return res
      } catch (err) {
        const isTimeout = err?.name === 'AbortError'

        // Try R2 static fallback before returning error
        if (!isSearchEndpoint(path)) {
          const r2Data = await fetchFromR2Fallback(env, path)
          if (r2Data) {
            return new Response(r2Data, {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': corsOrigin,
                'X-Cache': 'R2-FALLBACK',
                'X-Data-Source': 'r2-fallback',
              },
            })
          }
        }

        return new Response(
          JSON.stringify({ error: isTimeout ? 'API timeout' : 'API unavailable' }),
          {
            status: isTimeout ? 504 : 502,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': corsOrigin,
              'Retry-After': '5',
            },
          }
        )
      }
    }

    // Serve static assets — prevent caching of HTML/SW so deploys propagate immediately
    const assetResponse = await env.ASSETS.fetch(request)
    const pathname = url.pathname
    const contentType = assetResponse.headers.get('Content-Type') || ''
    const isHtml = contentType.includes('text/html')

    // Never cache: service worker, or any HTML response (SPA serves index.html for all routes)
    if (pathname === '/sw.js' || isHtml) {
      // For /boycott/:id paths, inject per-boycott OG/Twitter meta tags so
      // shares on X/iMessage/Slack/etc. show real previews instead of the
      // generic site card. The page still renders the SPA — we just rewrite
      // the static <meta> tags before the bytes hit the wire.
      if (isHtml) {
        const boycottMatch = pathname.match(/^\/boycott\/([^/?#]+)\/?$/)
        if (boycottMatch) {
          const boycottId = boycottMatch[1]
          const rewritten = await maybeInjectBoycottOg(assetResponse, boycottId, env)
          if (rewritten) return rewritten
        }
        const postMatch = pathname.match(/^\/post\/([^/?#]+)\/?$/)
        if (postMatch) {
          const postId = postMatch[1]
          const rewritten = await maybeInjectPostOg(assetResponse, postId, env)
          if (rewritten) return rewritten
        }
      }
      const response = new Response(assetResponse.body, assetResponse)
      response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      return response
    }

    return assetResponse
  },
}
