import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  checkHealth,
  getCompanyWithConnections,
  getProductByBarcode,
  getStats,
  isNeo4jId,
  searchBrands,
  searchCompanies,
  searchProducts,
} from '../services/neo4jGraph'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── isNeo4jId ───────────────────────────────────────────────

describe('isNeo4jId', () => {
  it('accepts valid Wikidata IDs', () => {
    expect(isNeo4jId('Q123456')).toBe(true)
    expect(isNeo4jId('Q1')).toBe(true)
  })

  it('accepts valid LEI codes (20 uppercase alphanumeric chars)', () => {
    expect(isNeo4jId('529900HNOAA1KXQJUQ27')).toBe(true)
    expect(isNeo4jId('ABCDEFGHIJ1234567890')).toBe(true)
  })

  it('rejects Supabase UUIDs', () => {
    expect(isNeo4jId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false)
  })

  it('rejects null, empty, and non-string values', () => {
    expect(isNeo4jId(null)).toBe(false)
    expect(isNeo4jId(undefined)).toBe(false)
    expect(isNeo4jId('')).toBe(false)
    expect(isNeo4jId(123)).toBe(false)
  })

  it('rejects lowercase LEI-length strings', () => {
    expect(isNeo4jId('abcdefghij1234567890')).toBe(false)
  })

  it('rejects Q followed by non-digits', () => {
    expect(isNeo4jId('Qabc')).toBe(false)
  })
})

// ── searchCompanies ─────────────────────────────────────────

describe('searchCompanies', () => {
  it('returns empty array for short queries', async () => {
    expect(await searchCompanies('')).toEqual([])
    expect(await searchCompanies('A')).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns search results on success', async () => {
    const mockResults = [{ name: 'Apple Inc', lei: '529900HNOAA1KXQJUQ27' }]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResults),
    })

    const results = await searchCompanies('Apple')
    expect(results).toEqual(mockResults)
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('q=Apple'))
  })

  it('encodes special characters in query', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    })

    await searchCompanies('Ben & Jerry')
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('q=Ben%20%26%20Jerry'))
  })

  it('returns empty array on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    const results = await searchCompanies('Apple')
    expect(results).toEqual([])
  })

  it('returns empty array on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const results = await searchCompanies('Apple')
    expect(results).toEqual([])
  })

  it('passes limit parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    })

    await searchCompanies('test', 5)
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=5'))
  })
})

// ── getCompanyWithConnections ───────────────────────────────

describe('getCompanyWithConnections', () => {
  it('returns null for empty companyId', async () => {
    expect(await getCompanyWithConnections(null)).toBeNull()
    expect(await getCompanyWithConnections('')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null for invalid ID format (Supabase UUID)', async () => {
    expect(await getCompanyWithConnections('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns company data for valid Wikidata ID', async () => {
    const mockCompany = { name: 'Apple Inc', wikidata_id: 'Q312' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockCompany),
    })

    const result = await getCompanyWithConnections('Q312')
    expect(result).toEqual(mockCompany)
  })

  it('returns null for 404 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

    const result = await getCompanyWithConnections('Q999999')
    expect(result).toBeNull()
  })

  it('returns null on server error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    const result = await getCompanyWithConnections('Q312')
    expect(result).toBeNull()
  })
})

// ── searchBrands ────────────────────────────────────────────

describe('searchBrands', () => {
  it('returns empty for short queries', async () => {
    expect(await searchBrands('')).toEqual([])
    expect(await searchBrands('A')).toEqual([])
  })

  it('returns brand results on success', async () => {
    const brands = [{ name: 'iPhone', wikidata_id: 'Q2766' }]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(brands),
    })

    expect(await searchBrands('iPhone')).toEqual(brands)
  })
})

// ── getProductByBarcode ─────────────────────────────────────

describe('getProductByBarcode', () => {
  it('returns null for empty barcode', async () => {
    expect(await getProductByBarcode(null)).toBeNull()
    expect(await getProductByBarcode('')).toBeNull()
  })

  it('returns product data for valid barcode', async () => {
    const product = { name: 'Coca-Cola', barcode: '049000006346' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(product),
    })

    expect(await getProductByBarcode('049000006346')).toEqual(product)
  })

  it('returns null for unknown barcode (404)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    expect(await getProductByBarcode('000000000000')).toBeNull()
  })
})

// ── searchProducts ──────────────────────────────────────────

describe('searchProducts', () => {
  it('returns empty for short queries', async () => {
    expect(await searchProducts('')).toEqual([])
    expect(await searchProducts('x')).toEqual([])
  })

  it('returns product results on success', async () => {
    const products = [{ name: 'Coca-Cola Classic' }]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(products),
    })

    expect(await searchProducts('coca')).toEqual(products)
  })
})

// ── getStats ────────────────────────────────────────────────

describe('getStats', () => {
  it('returns stats on success', async () => {
    const stats = { Company: 52000, Brand: 37000 }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(stats),
    })

    expect(await getStats()).toEqual(stats)
  })

  it('returns empty object on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'))
    expect(await getStats()).toEqual({})
  })
})

// ── checkHealth ─────────────────────────────────────────────

describe('checkHealth', () => {
  it('returns true when API is healthy', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    })

    expect(await checkHealth()).toBe(true)
  })

  it('returns false when API status is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'degraded' }),
    })

    expect(await checkHealth()).toBe(false)
  })

  it('returns false on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))
    expect(await checkHealth()).toBe(false)
  })
})
