// Match RFC 3986 scheme prefix: alpha (alpha | digit | + | - | .)* :
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * Normalize a user-entered source link into a canonical http(s) URL.
 *
 * - Trims whitespace.
 * - Prepends `https://` when no scheme is provided so `nytimes.com/article` works.
 * - Rejects non-http(s) schemes (e.g. `javascript:`, `mailto:`, `ftp:`).
 *
 * @param {string} input
 * @returns {{ url: string, error: null } | { url: null, error: string }}
 */
export function normalizeSourceLink(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return { url: null, error: 'Please enter a URL.' }

  const candidate = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return { url: null, error: 'Please enter a valid URL.' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: null, error: 'Source URL must start with http(s)://.' }
  }

  return { url: parsed.toString(), error: null }
}
