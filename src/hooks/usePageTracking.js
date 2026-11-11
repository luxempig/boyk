import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { trackPageView } from '../lib/analytics'

export function usePageTracking() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    // Include search so Plausible parses utm_source / utm_medium from inbound
    // share links.
    trackPageView(`${pathname}${search}`)
  }, [pathname, search])
}
