import stringSimilarity from 'string-similarity'

/**
 * Clean merchant name for matching
 * Removes store numbers, corporate suffixes, and special characters
 */
export function cleanMerchantName(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[#0-9]+/g, '')
    .replace(/\s+(inc|llc|corp|co|ltd|limited)\.?$/i, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
}

/**
 * Match a transaction merchant to a company
 * Returns { company, confidence } or null
 */
export function matchTransaction(merchantName, companies) {
  if (!merchantName || !companies?.length) return null

  const cleaned = cleanMerchantName(merchantName)
  if (!cleaned) return null

  let bestMatch = null
  let bestScore = 0

  for (const company of companies) {
    const companyName = company.name.toLowerCase()

    // Exact substring match - high confidence
    if (cleaned.includes(companyName) || companyName.includes(cleaned)) {
      return { company, confidence: 0.95 }
    }

    // Fuzzy match
    const score = stringSimilarity.compareTwoStrings(cleaned, companyName)
    if (score > 0.6 && score > bestScore) {
      bestScore = score
      bestMatch = company
    }
  }

  return bestMatch ? { company: bestMatch, confidence: bestScore } : null
}

/**
 * Format currency amount
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

/**
 * Get date range based on period selection
 */
export function getDateRange(period) {
  const endDate = new Date()
  const startDate = new Date()

  switch (period) {
    case '7d':
      startDate.setDate(endDate.getDate() - 7)
      break
    case '30d':
      startDate.setDate(endDate.getDate() - 30)
      break
    case '90d':
      startDate.setDate(endDate.getDate() - 90)
      break
    case 'all':
    default:
      return { startDate: null, endDate: null }
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  }
}
