/**
 * Unit tests for content.js Amazon brand extraction logic
 * Tests the brand text parsing/cleanup patterns
 *
 * Run: node chrome-extension/tests/content.test.mjs
 */

import assert from 'assert'

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

// Extract the brand text cleanup logic from content.js
function cleanAmazonBrandText(brandText) {
  return brandText
    .replace(/Visit the\s+/i, '')
    .replace(/\s+Store$/i, '')
    .replace(/Brand:\s*/i, '')
    .replace(/by\s+/i, '')
    .trim()
}

// ── cleanAmazonBrandText ──────────────────────────────────────────────────────
console.log('\ncleanAmazonBrandText:')

test('extracts brand from "Visit the Apple Store"', () => {
  assert.strictEqual(cleanAmazonBrandText('Visit the Apple Store'), 'Apple')
})

test('extracts brand from "Brand: Samsung"', () => {
  assert.strictEqual(cleanAmazonBrandText('Brand: Samsung'), 'Samsung')
})

test('extracts brand from "by Anker"', () => {
  assert.strictEqual(cleanAmazonBrandText('by Anker'), 'Anker')
})

test('handles "Visit the Coca-Cola Store" with hyphen', () => {
  assert.strictEqual(cleanAmazonBrandText('Visit the Coca-Cola Store'), 'Coca-Cola')
})

test('trims whitespace', () => {
  assert.strictEqual(cleanAmazonBrandText('  Nike  '), 'Nike')
})

test('handles plain brand name', () => {
  assert.strictEqual(cleanAmazonBrandText('Sony'), 'Sony')
})

test('handles "Brand:  Multiple Spaces"', () => {
  assert.strictEqual(cleanAmazonBrandText('Brand:  LG Electronics'), 'LG Electronics')
})

// ── Amazon URL detection ──────────────────────────────────────────────────────
console.log('\nAmazon URL detection:')

function isAmazonProductPage(url) {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    return (
      hostname.includes('amazon.') &&
      (urlObj.pathname.includes('/dp/') ||
        urlObj.pathname.includes('/gp/product/') ||
        urlObj.pathname.includes('/product/'))
    )
  } catch {
    return false
  }
}

test('detects standard /dp/ product URL', () => {
  assert.strictEqual(isAmazonProductPage('https://www.amazon.com/Some-Product/dp/B08N5WRWNW'), true)
})

test('detects /gp/product/ URL', () => {
  assert.strictEqual(isAmazonProductPage('https://www.amazon.com/gp/product/B08N5WRWNW'), true)
})

test('detects amazon.co.uk product', () => {
  assert.strictEqual(isAmazonProductPage('https://www.amazon.co.uk/dp/B08N5WRWNW'), true)
})

test('rejects amazon homepage', () => {
  assert.strictEqual(isAmazonProductPage('https://www.amazon.com/'), false)
})

test('rejects non-amazon product page', () => {
  assert.strictEqual(isAmazonProductPage('https://www.ebay.com/dp/123'), false)
})

test('rejects amazon search page', () => {
  assert.strictEqual(isAmazonProductPage('https://www.amazon.com/s?k=headphones'), false)
})

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
