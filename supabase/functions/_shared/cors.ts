const ALLOWED_ORIGINS = [
  'https://boyk.org',
  'https://www.boyk.org',
  'https://staging.boyk.org',
  'https://boyk.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

export function getCorsHeaders(request?: Request) {
  const origin = request?.headers?.get('Origin') || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

// (Removed the static `corsHeaders` export — it hardcoded a single origin and
// was a footgun for new functions. Always use getCorsHeaders(req).)
