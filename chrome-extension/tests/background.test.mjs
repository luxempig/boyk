/**
 * Unit tests for background.js core logic
 * Tests: normalizeBrandName, checkBrand, checkUrl
 *
 * Run: node chrome-extension/tests/background.test.js
 */

import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Mock chrome APIs ──────────────────────────────────────────────────────────
globalThis.chrome = {
  storage: {
    local: {
      _store: {},
      get: async keys => {
        const result = {}
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) result[k] = globalThis.chrome.storage.local._store[k]
        return result
      },
      set: async obj => Object.assign(globalThis.chrome.storage.local._store, obj),
      remove: async keys => {
        for (const k of Array.isArray(keys) ? keys : [keys])
          delete globalThis.chrome.storage.local._store[k]
      },
    },
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    sendMessage: () => {},
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    get: async () => ({}),
    sendMessage: async () => {},
    query: async () => [],
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
  alarms: {
    create: () => {},
    onAlarm: { addListener: () => {} },
  },
}

// ── Extract functions from background.js ──────────────────────────────────────
// We need to eval background.js in this context to get the functions.
// Since background.js defines functions at module scope, we'll extract them.
const bgSource = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf-8')

// Wrap in a function that returns the internals we need
const wrappedSource = `
(function() {
  ${bgSource}
  return { normalizeBrandName, checkBrand, checkUrl, loadBoycottData, boycottedDomains, boycottedCompanies, boycottedBrands };
})()
`

const bg = eval(wrappedSource)

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${e.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${e.message}`)
  }
}

// ── normalizeBrandName ────────────────────────────────────────────────────────
console.log('\nnormalizeBrandName:')

test('lowercases input', () => {
  assert.strictEqual(bg.normalizeBrandName('Apple'), 'apple')
})

test('removes spaces', () => {
  assert.strictEqual(bg.normalizeBrandName('Coca Cola'), 'cocacola')
})

test('removes special characters', () => {
  assert.strictEqual(bg.normalizeBrandName('Johnson & Johnson'), 'johnsonjohnson')
})

test('removes hyphens and underscores', () => {
  assert.strictEqual(bg.normalizeBrandName('Coca-Cola_Company'), 'cocacolacompany')
})

// ── checkUrl ──────────────────────────────────────────────────────────────────
console.log('\ncheckUrl:')

// Set up test boycott data
bg.boycottedDomains.clear()
bg.boycottedCompanies.clear()
bg.boycottedDomains.add('amazon.com')
bg.boycottedDomains.add('starbucks.com')
bg.boycottedCompanies.set('amazon.com', { name: 'Amazon', website: 'https://amazon.com' })
bg.boycottedCompanies.set('starbucks.com', {
  name: 'Starbucks',
  website: 'https://starbucks.com',
})

test('matches direct domain', () => {
  const result = bg.checkUrl('https://amazon.com/products')
  assert.strictEqual(result.isBoycotted, true)
  assert.strictEqual(result.company.name, 'Amazon')
})

test('matches www prefix', () => {
  const result = bg.checkUrl('https://www.amazon.com/products')
  assert.strictEqual(result.isBoycotted, true)
})

test('matches subdomain', () => {
  const result = bg.checkUrl('https://smile.amazon.com/dp/B123')
  assert.strictEqual(result.isBoycotted, true)
})

test('does not match unrelated domain', () => {
  const result = bg.checkUrl('https://google.com')
  assert.strictEqual(result.isBoycotted, false)
})

test('does not match short company name in domain (< 5 chars)', () => {
  bg.boycottedCompanies.set('meta.com', { name: 'Meta', website: 'https://meta.com' })
  bg.boycottedDomains.add('meta.com')
  // "meta" is only 4 chars, so hostname-contains-companyname should NOT match
  const result = bg.checkUrl('https://metamask.io')
  assert.strictEqual(result.isBoycotted, false)
  bg.boycottedCompanies.delete('meta.com')
  bg.boycottedDomains.delete('meta.com')
})

test('matches long company name in domain (>= 5 chars)', () => {
  bg.boycottedCompanies.set('example.com', {
    name: 'Amazon',
    website: 'https://example.com',
  })
  // "amazon" is 6 chars, should match hostname containing it
  const result = bg.checkUrl('https://amazonprime.example.org')
  assert.strictEqual(result.isBoycotted, true)
  bg.boycottedCompanies.delete('example.com')
})

test('handles invalid URLs gracefully', () => {
  const result = bg.checkUrl('not-a-url')
  assert.strictEqual(result.isBoycotted, false)
})

test('handles chrome:// URLs gracefully', () => {
  const result = bg.checkUrl('chrome://extensions')
  assert.strictEqual(result.isBoycotted, false)
})

// ── checkBrand ────────────────────────────────────────────────────────────────
console.log('\ncheckBrand:')

// Set up brand data
bg.boycottedBrands.clear()
bg.boycottedBrands.set('amazon', { name: 'Amazon' })
bg.boycottedBrands.set('starbucks', { name: 'Starbucks' })
bg.boycottedBrands.set('cocacola', { name: 'The Coca-Cola Company' })
bg.boycottedBrands.set('nestle', { name: 'Nestle' })

test('exact match', () => {
  const result = bg.checkBrand('Amazon')
  assert.strictEqual(result.isBoycotted, true)
  assert.strictEqual(result.company.name, 'Amazon')
})

test('exact match case insensitive', () => {
  const result = bg.checkBrand('STARBUCKS')
  assert.strictEqual(result.isBoycotted, true)
})

test('no match for unrelated brand', () => {
  const result = bg.checkBrand('Nike')
  assert.strictEqual(result.isBoycotted, false)
})

test('fuzzy match: input contains boycotted brand (both >= 5 chars)', () => {
  const result = bg.checkBrand('AmazonBasics')
  assert.strictEqual(result.isBoycotted, true)
  assert.strictEqual(result.matchType, 'contains')
})

test('no fuzzy match for short brands (< 5 chars)', () => {
  bg.boycottedBrands.set('abc', { name: 'ABC Corp' })
  const result = bg.checkBrand('abcdefg')
  // "abc" is only 3 chars, should NOT fuzzy match
  assert.strictEqual(result.isBoycotted, false)
  bg.boycottedBrands.delete('abc')
})

test('no fuzzy match when isLowConfidence is true', () => {
  const result = bg.checkBrand('AmazonBasics', true)
  assert.strictEqual(result.isBoycotted, false)
})

test('null/empty brand returns not boycotted', () => {
  assert.strictEqual(bg.checkBrand(null).isBoycotted, false)
  assert.strictEqual(bg.checkBrand('').isBoycotted, false)
})

// ── loadBoycottData from storage ──────────────────────────────────────────────
console.log('\nloadBoycottData:')

await testAsync('loads domains and companies from storage', async () => {
  chrome.storage.local._store = {
    boycottData: {
      domains: ['amazon.com', 'www.amazon.com', 'starbucks.com'],
      companies: [
        { name: 'Amazon', website: 'https://amazon.com' },
        { name: 'Starbucks', website: 'https://starbucks.com' },
      ],
    },
  }

  await bg.loadBoycottData()

  // Verify via behavior (loadBoycottData reassigns internal Sets)
  assert.strictEqual(bg.checkUrl('https://amazon.com').isBoycotted, true)
  assert.strictEqual(bg.checkUrl('https://starbucks.com').isBoycotted, true)
  assert.strictEqual(bg.checkBrand('Amazon').isBoycotted, true)
  assert.strictEqual(bg.checkBrand('Starbucks').isBoycotted, true)
})

await testAsync('handles missing boycottData in storage', async () => {
  bg.boycottedDomains.clear()
  bg.boycottedCompanies.clear()
  bg.boycottedBrands.clear()

  chrome.storage.local._store = {}

  await bg.loadBoycottData()

  assert.strictEqual(bg.boycottedDomains.size, 0)
  assert.strictEqual(bg.boycottedCompanies.size, 0)
})

await testAsync('handles invalid company website URLs', async () => {
  chrome.storage.local._store = {
    boycottData: {
      domains: ['test.com'],
      companies: [
        { name: 'Good Co', website: 'https://test.com' },
        { name: 'Bad Co', website: 'not-a-url' },
        { name: 'No Website Co' },
      ],
    },
  }

  await bg.loadBoycottData()

  // Valid URL company is accessible via domain
  assert.strictEqual(bg.checkUrl('https://test.com').isBoycotted, true)
  // All companies are searchable by brand name
  assert.strictEqual(bg.checkBrand('Good Co').isBoycotted, true)
  assert.strictEqual(bg.checkBrand('Bad Co').isBoycotted, true)
  assert.strictEqual(bg.checkBrand('No Website Co').isBoycotted, true)
})

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
