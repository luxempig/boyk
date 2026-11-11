/**
 * Neo4j Graph API Service
 * Connects to the Boyk Neo4j API for company graph data
 */

// API base URL - proxied through Vite in dev and Cloudflare Pages Functions in production
const API_BASE = '/neo4j-api'

/**
 * Check if an ID is a valid Neo4j ID (LEI or Wikidata ID)
 * This prevents 404 errors from passing Supabase UUIDs to the Neo4j API
 * @param {string} id - ID to validate
 * @returns {boolean} - True if valid Neo4j ID
 */
export function isNeo4jId(id) {
  if (!id || typeof id !== 'string') return false
  // Wikidata ID format: Q followed by digits (e.g., Q123456)
  if (/^Q\d+$/.test(id)) return true
  // LEI format: exactly 20 alphanumeric characters (uppercase)
  if (/^[A-Z0-9]{20}$/.test(id)) return true
  return false
}

/**
 * Get the best ID for company links/lookups (prefers Neo4j IDs over Supabase UUIDs)
 * @param {Object} company - Company object with id, lei, wikidata_qid
 * @returns {string} - wikidata_qid, LEI, or fallback to id
 */
export function getCompanyLinkId(company) {
  if (!company) return ''
  return company.wikidata_qid || company.lei || company.id || ''
}

/**
 * Search companies by name
 * @param {string} query - Search query
 * @param {number} limit - Maximum results to return
 * @returns {Promise<Array>} - Array of company objects
 */
export async function searchCompanies(query, limit = 20) {
  if (!query || query.length < 2) {
    return []
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/companies/search?q=${encodeURIComponent(query)}&limit=${limit}`
    )

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Company search error:', err)
    return []
  }
}

/**
 * Get a company by ID (LEI or wikidata_id) with its connections
 * @param {string} companyId - Company LEI or wikidata_id
 * @returns {Promise<Object|null>} - Company with connections or null
 */
export async function getCompanyWithConnections(companyId) {
  if (!companyId) {
    return null
  }

  // Validate ID format to prevent 404s from Supabase UUIDs
  if (!isNeo4jId(companyId)) {
    console.warn(`getCompanyWithConnections: Invalid Neo4j ID format: ${companyId}`)
    return null
  }

  try {
    const response = await fetch(`${API_BASE}/api/companies/${encodeURIComponent(companyId)}`)

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      throw new Error(`Get company failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Get company error:', err)
    return null
  }
}

/**
 * Search brands by name
 * @param {string} query - Search query
 * @param {number} limit - Maximum results to return
 * @returns {Promise<Array>} - Array of brand objects
 */
export async function searchBrands(query, limit = 20) {
  if (!query || query.length < 2) {
    return []
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/brands/search?q=${encodeURIComponent(query)}&limit=${limit}`
    )

    if (!response.ok) {
      throw new Error(`Brand search failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Brand search error:', err)
    return []
  }
}

/**
 * Get a brand by ID (wikidata_id) with its owner company and products
 * @param {string} brandId - Brand wikidata_id
 * @returns {Promise<Object|null>} - Brand with company and products or null
 */
export async function getBrandById(brandId) {
  if (!brandId) return null

  try {
    const response = await fetch(`${API_BASE}/api/brands/${encodeURIComponent(brandId)}`)

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Get brand failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Get brand error:', err)
    return null
  }
}

export async function getPersonById(personId) {
  if (!personId) return null

  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(personId)}`)

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Get person failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Get person error:', err)
    return null
  }
}

/**
 * Get database statistics
 * @returns {Promise<Object>} - Stats object with node counts
 */
export async function getStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats`)

    if (!response.ok) {
      throw new Error(`Stats failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Stats error:', err)
    return {}
  }
}

/**
 * Check API health
 * @returns {Promise<boolean>} - True if API is healthy
 */
export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/api/health`)
    if (!response.ok) return false
    const data = await response.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

/**
 * Look up a product by barcode
 * @param {string} barcode - UPC/EAN barcode
 * @returns {Promise<Object|null>} - Product with brand/company info or null
 */
export async function getProductByBarcode(barcode) {
  if (!barcode) {
    return null
  }

  try {
    const response = await fetch(`${API_BASE}/api/products/barcode/${encodeURIComponent(barcode)}`)

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      throw new Error(`Product lookup failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Product lookup error:', err)
    return null
  }
}

/**
 * Search products by name
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} - Array of products
 */
export async function searchProducts(query, limit = 20) {
  if (!query || query.length < 2) {
    return []
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/products/search?q=${encodeURIComponent(query)}&limit=${limit}`
    )

    if (!response.ok) {
      throw new Error(`Product search failed: ${response.status}`)
    }

    return await response.json()
  } catch (err) {
    console.error('Product search error:', err)
    return []
  }
}
