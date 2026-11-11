#!/usr/bin/env node
/**
 * E2E Smoke Test Script
 * Tests all critical paths via HTTP requests.
 * Run: node scripts/e2e-smoke.mjs
 *
 * For Playwright browser tests, use the Playwright MCP tools directly
 * with CF-Access-Client-Id/Secret headers set.
 */

const BASE = process.env.BOYK_BASE_URL || 'https://boyk.org'
const API = process.env.BOYK_API_BASE_URL || `${BASE}/neo4j-api/api`
const SUPABASE =
  process.env.BOYK_SUPABASE_FUNCTIONS_URL || 'https://ggmkhgmrjtaacbcgnuwy.supabase.co/functions/v1'
const DIRECT_API = process.env.BOYK_DIRECT_API_BASE_URL

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  \x1b[32m PASS\x1b[0m ${name}`)
    passed++
  } catch (e) {
    console.log(`  \x1b[31m FAIL\x1b[0m ${name}: ${e.message}`)
    failed++
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

async function fetchJSON(url, opts) {
  // One retry on network failure (transient DNS/connection errors).
  let res
  try {
    res = await fetch(url, opts)
  } catch (e) {
    await new Promise(r => setTimeout(r, 1000))
    res = await fetch(url, opts).catch(retryErr => {
      throw new Error(`Network error fetching ${url}: ${retryErr.message} (after retry)`)
    })
  }

  // Only parse JSON when the response actually is JSON. A non-JSON body
  // (e.g. an HTML error/Cloudflare page) otherwise throws an opaque
  // "Unexpected token" SyntaxError that hides the real status.
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    const text = await res.text()
    return { status: res.status, headers: res.headers, data: null, text }
  }

  return { status: res.status, headers: res.headers, data: await res.json() }
}

async function fetchHead(url) {
  const res = await fetch(url, { redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location') }
}

// --- Tests ---

console.log('\n API Endpoints')

await test('Health check', async () => {
  const { data } = await fetchJSON(`${API}/health`)
  assert(data.status === 'ok', `Expected ok, got ${data.status}`)
})

await test('Stats returns data', async () => {
  const { data } = await fetchJSON(`${API}/stats`)
  assert(data.Company > 0, `No companies: ${JSON.stringify(data)}`)
  assert(data.Brand > 0, 'No brands')
  assert(data.Product > 0, 'No products')
})

await test('Company search returns results', async () => {
  const { data } = await fetchJSON(`${API}/companies/search?q=coca&limit=2`)
  assert(Array.isArray(data) && data.length > 0, 'No search results')
  assert(data[0].name, 'Missing name field')
})

await test('Brand search returns results', async () => {
  const { data } = await fetchJSON(`${API}/brands/search?q=nike&limit=2`)
  assert(Array.isArray(data), 'Not an array')
})

await test('Product search returns results', async () => {
  const { data } = await fetchJSON(`${API}/products/search?q=water&limit=2`)
  assert(Array.isArray(data), 'Not an array')
})

await test('Company detail returns enrichment data', async () => {
  const search = await fetchJSON(`${API}/companies/search?q=coca&limit=1`)
  if (search.data.length > 0) {
    const id = search.data[0].id
    const { data } = await fetchJSON(`${API}/companies/${id}`)
    assert(data.name, 'Missing name')
    assert(data.connections, 'Missing connections')
  }
})

await test('Invalid company returns 404', async () => {
  const { status } = await fetchJSON(`${API}/companies/INVALID_ID_12345`)
  assert(status === 404, `Expected 404, got ${status}`)
})

await test('Brands endpoint exists', async () => {
  const { status } = await fetchJSON(`${API}/brands/INVALID`)
  assert(status === 404, `Expected 404, got ${status}`)
})

await test('Products endpoint exists', async () => {
  const { status } = await fetchJSON(`${API}/products/0000000000000`)
  assert(status === 404, `Expected 404, got ${status}`)
})

await test('Persons endpoint exists', async () => {
  const { status } = await fetchJSON(`${API}/persons/INVALID`)
  assert(status === 404, `Expected 404, got ${status}`)
})

await test('Rate limit headers present (direct API, if configured)', async () => {
  if (!DIRECT_API) {
    console.log('  \x1b[33mSKIP\x1b[0m Direct API not configured (set BOYK_DIRECT_API_BASE_URL)')
    return
  }
  const res = await fetch(`${DIRECT_API}/health`)
  const remaining = res.headers.get('ratelimit-remaining')
  assert(remaining !== null, 'Missing RateLimit-Remaining header')
})

console.log('\n Redirects & Public Pages')

await test('/demo redirects to /demo/', async () => {
  const { status, location } = await fetchHead(`${BASE}/demo`)
  assert(status === 308 || status === 301, `Expected redirect, got ${status}`)
  assert(location?.includes('/demo/'), `Redirect to ${location}`)
})

await test('/demo/ returns 200', async () => {
  const res = await fetch(`${BASE}/demo/`)
  assert(res.status === 200, `Expected 200, got ${res.status}`)
  const text = await res.text()
  assert(text.includes('Sign NDA'), 'Missing NDA form content')
})

await test('/demo/?event=signing_complete shows completion', async () => {
  const res = await fetch(`${BASE}/demo/?event=signing_complete`)
  assert(res.status === 200, `Expected 200, got ${res.status}`)
  const text = await res.text()
  assert(text.includes('NDA Signed'), 'Missing completion content')
})

await test('/ios is accessible (no CF Access gate)', async () => {
  const res = await fetch(`${BASE}/ios`)
  const text = await res.text()
  // Should NOT contain "Sign in" from CF Access, should contain app content
  assert(!text.includes('Cloudflare Access'), 'Page is behind Cloudflare Access')
})

await test('API proxy bypasses CF Access', async () => {
  const { data } = await fetchJSON(`${BASE}/neo4j-api/api/health`)
  assert(data.status === 'ok', 'API proxy blocked')
})

console.log('\n Edge Functions')

await test('agent-chat requires auth', async () => {
  const { status } = await fetchJSON(`${SUPABASE}/agent-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert(status === 401, `Expected 401, got ${status}`)
})

await test('trigger-fix requires auth', async () => {
  const { status } = await fetchJSON(`${SUPABASE}/trigger-fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert(status === 401, `Expected 401, got ${status}`)
})

await test('docusign-create-envelope validates input', async () => {
  // With verify_jwt = false (see supabase/config.toml), the demo NDA flow
  // reaches the function without a JWT and should now get a 400 validation
  // error for an empty body (was 401 when the gateway rejected the missing JWT).
  const { status, data } = await fetchJSON(`${SUPABASE}/docusign-create-envelope`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert(status === 400, `Expected 400, got ${status}`)
  // Best-effort: confirm the body looks like a validation error when JSON is returned.
  if (data?.error) {
    assert(data.error.includes('required'), `Unexpected error: ${data.error}`)
  }
})

// --- Summary ---
console.log(`\n ${'='.repeat(40)}`)
console.log(` ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
