import * as Sentry from '@sentry/react'

const DSN = import.meta.env.VITE_SENTRY_DSN

export function initSentry() {
  if (!DSN) return

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    enabled: import.meta.env.PROD,
    // Errors only. Session replay records users' screens and tracing spends
    // quota; neither is on until someone decides they should be (and the
    // privacy policy says so). The SDK sends no IP or cookies by default.
    sendDefaultPii: false,
  })
}

export function captureError(error, context) {
  if (!DSN) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

export { Sentry }
