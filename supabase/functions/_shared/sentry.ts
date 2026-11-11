const SENTRY_DSN = Deno.env.get('SENTRY_DSN')

export function captureException(error: Error, context?: Record<string, unknown>): void {
  if (!SENTRY_DSN) return

  const payload = {
    exception: {
      values: [
        {
          type: error.name || 'Error',
          value: error.message,
          stacktrace: error.stack
            ? {
                frames: error.stack
                  .split('\n')
                  .slice(1)
                  .map(line => ({ filename: line.trim() })),
              }
            : undefined,
        },
      ],
    },
    level: 'error',
    platform: 'node',
    server_name: 'supabase-edge-functions',
    environment: Deno.env.get('ENVIRONMENT') || 'production',
    extra: context,
  }

  // Fire and forget - don't block the response
  const dsn = new URL(SENTRY_DSN)
  const projectId = dsn.pathname.replace('/', '')
  const publicKey = dsn.username
  const sentryUrl = `https://${dsn.hostname}/api/${projectId}/store/?sentry_version=7&sentry_key=${publicKey}`

  fetch(sentryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Silently ignore Sentry reporting failures
  })
}

export function withSentry(
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req)
    } catch (error) {
      captureException(error as Error, {
        url: req.url,
        method: req.method,
      })
      throw error
    }
  }
}
