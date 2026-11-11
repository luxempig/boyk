import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const ATTR = 'data-preview'
const VALUE = 'paper'
const OFF_VALUE = 'off'
const STORAGE_KEY = 'preview_mode'

// Paper mode is now the default treatment for BoycottCard / PostCard rendering.
// Users (or testers) can opt out via ?preview=off; the choice persists in
// localStorage.
//
//   ?preview=off   → turn paper off, store the opt-out
//   ?preview=paper → re-enable explicitly, clear the opt-out
//   no param       → defaults to paper unless the user opted out
function resolveActive(search) {
  if (typeof window === 'undefined') return true
  const params = new URLSearchParams(search || '')
  const qp = params.get('preview')
  if (qp === VALUE) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    return true
  }
  if (qp === OFF_VALUE || qp === 'reset') {
    try {
      localStorage.setItem(STORAGE_KEY, OFF_VALUE)
    } catch {
      // ignore
    }
    return false
  }
  try {
    return localStorage.getItem(STORAGE_KEY) !== OFF_VALUE
  } catch {
    return true
  }
}

/**
 * Controls the "paper" card design (tweet-style BoycottCard + PostCard).
 * Paper is the default. Opt out with ?preview=off (persists in
 * localStorage). Re-enable with ?preview=paper.
 * Sets data-preview="paper" on <html> so scoped CSS applies.
 */
export function usePaperPreview() {
  const location = useLocation()
  const active = useMemo(() => resolveActive(location.search), [location.search])

  useEffect(() => {
    const root = document.documentElement
    if (active) {
      root.setAttribute(ATTR, VALUE)
    } else {
      root.removeAttribute(ATTR)
    }
  }, [active])

  return active
}
