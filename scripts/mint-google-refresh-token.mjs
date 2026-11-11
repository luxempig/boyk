#!/usr/bin/env node
/**
 * Mint a fresh GOOGLE_REFRESH_TOKEN for the Boyk edge functions.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
 *     node scripts/mint-google-refresh-token.mjs
 *
 * What it does:
 *   1. Starts a local HTTP server on 127.0.0.1:8765.
 *   2. Prints a Google OAuth consent URL — paste it in your browser
 *      (signed in as daniel@boyk.org).
 *   3. Catches the redirect callback, exchanges the auth code for a
 *      refresh token, and prints the token plus the supabase command
 *      to store it.
 *
 * Prerequisite:
 *   In Google Cloud Console → APIs & Services → Credentials → your
 *   OAuth Client, add this to Authorized redirect URIs:
 *     http://localhost:8765/callback
 *   (Click Save. Wait ~30s for it to propagate.)
 *
 * The minted refresh token covers Drive + Gmail + Sheets so the
 * existing demo-sheet and email flows keep working alongside the new
 * Sheets sync.
 */

import http from 'node:http'
import { URL } from 'node:url'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = 'http://localhost:8765/callback'
const PORT = 8765

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets',
]

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Missing env vars. Run:\n' +
      '  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/mint-google-refresh-token.mjs'
  )
  process.exit(1)
}

const authURL = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authURL.searchParams.set('client_id', CLIENT_ID)
authURL.searchParams.set('redirect_uri', REDIRECT_URI)
authURL.searchParams.set('response_type', 'code')
authURL.searchParams.set('scope', SCOPES.join(' '))
authURL.searchParams.set('access_type', 'offline')
authURL.searchParams.set('prompt', 'consent')

const server = http.createServer(async (req, res) => {
  const reqURL = new URL(req.url, `http://localhost:${PORT}`)
  if (reqURL.pathname !== '/callback') {
    res.writeHead(404)
    res.end()
    return
  }

  const code = reqURL.searchParams.get('code')
  const err = reqURL.searchParams.get('error')
  if (err || !code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end(`OAuth error: ${err || 'no code returned'}`)
    console.error(`\nOAuth callback error: ${err || 'no code'}`)
    server.close()
    process.exit(1)
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    const data = await tokenRes.json()
    if (!tokenRes.ok || !data.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`Token exchange failed: ${JSON.stringify(data)}`)
      console.error(`\nToken exchange failed:`, data)
      server.close()
      process.exit(1)
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(
      '<h2>Success — refresh token saved to disk.</h2>' +
        '<p>You can close this tab. The script will continue in your terminal.</p>'
    )

    const outPath = process.env.REFRESH_TOKEN_OUT_PATH || '/tmp/boyk-google-refresh-token'
    const fs = await import('node:fs/promises')
    await fs.writeFile(outPath, data.refresh_token, { mode: 0o600 })

    console.log('\n✅ Refresh token minted and written to ' + outPath)
    console.log('Scopes granted: ' + (data.scope || '(check via tokeninfo)'))
    console.log('The token is NOT printed to stdout to avoid leaking via shell logs.')

    server.close()
    process.exit(0)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(`Unexpected error: ${e.message}`)
    console.error('\nUnexpected error:', e)
    server.close()
    process.exit(1)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Listening on ${REDIRECT_URI}`)
  console.log('\nOpen this URL in a browser signed in as daniel@boyk.org:\n')
  console.log('  ' + authURL.toString())
  console.log('\nWaiting for callback…\n')
})
