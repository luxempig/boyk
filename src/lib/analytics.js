const DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN
const API_HOST = import.meta.env.VITE_PLAUSIBLE_API_HOST || 'https://plausible.io'

function isEnabled() {
  if (!DOMAIN) return false
  if (typeof navigator !== 'undefined' && navigator.doNotTrack === '1') return false
  return true
}

/**
 * Track a page view. Called automatically on route changes.
 */
export function trackPageView(pathname) {
  if (!isEnabled()) return

  try {
    fetch(`${API_HOST}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        n: 'pageview',
        u: `${window.location.origin}${pathname}`,
        d: DOMAIN,
        r: document.referrer || null,
      }),
    }).catch(() => {})
  } catch {
    // Silently fail - analytics should never break the app
  }
}

/**
 * Track a custom event.
 *
 * Events:
 *  - boycott_created
 *  - boycott_followed
 *  - boycott_unfollowed
 *  - company_searched { query }
 *  - company_viewed { company_id }
 *  - product_scanned { barcode }
 *  - signup
 *  - login
 *  - logout
 */
export function trackEvent(name, props) {
  if (!isEnabled()) return

  try {
    fetch(`${API_HOST}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        n: name,
        u: window.location.href,
        d: DOMAIN,
        p: props || undefined,
      }),
    }).catch(() => {})
  } catch {
    // Silently fail
  }
}
