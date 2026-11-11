/**
 * Google API helpers for edge functions.
 * Uses OAuth2 refresh token to get access tokens, then calls Sheets/Drive/Gmail APIs.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   GOOGLE_SHEET_TEMPLATE_ID  (the template spreadsheet to copy for each demo user)
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Exchange refresh token for a fresh access token. */
export async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)'
    )
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google token refresh failed: ${err}`)
  }

  const data = await res.json()
  return data.access_token
}

/**
 * Copy the template Google Sheet for a demo user and share it with their email.
 * Returns the URL of the new sheet.
 */
export async function createDemoSheet(userName: string, userEmail: string): Promise<string> {
  const templateId = Deno.env.get('GOOGLE_SHEET_TEMPLATE_ID')
  if (!templateId) {
    throw new Error('Missing GOOGLE_SHEET_TEMPLATE_ID env var')
  }

  const token = await getAccessToken()

  // 1. Copy the template spreadsheet via Drive API
  const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `Boyk Demo Feedback - ${userName}`,
    }),
  })

  if (!copyRes.ok) {
    const err = await copyRes.text()
    throw new Error(`Failed to copy template sheet: ${err}`)
  }

  const copied = await copyRes.json()
  const sheetId = copied.id

  // 2. Share the sheet with the user (editor access)
  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'writer',
      type: 'user',
      emailAddress: userEmail,
    }),
  })

  if (!permRes.ok) {
    const err = await permRes.text()
    console.error(`Failed to share sheet with ${userEmail}: ${err}`)
    // Don't fail — the sheet still exists, just not shared yet
  }

  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
}

/**
 * Send a custom HTML email via Gmail API.
 * Sends from the authenticated Google account (daniel@boyk.org).
 */
export async function sendGmail(to: string, subject: string, htmlBody: string): Promise<void> {
  const token = await getAccessToken()

  // Build RFC 2822 email with MIME
  const boundary = `boundary_${Date.now()}`
  const rawEmail = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(htmlBody))),
    `--${boundary}--`,
  ].join('\r\n')

  // Base64url encode the email
  const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail send failed: ${err}`)
  }
}

/**
 * Build the welcome email HTML for a demo user.
 */
export function buildWelcomeEmail(params: {
  name: string
  email: string
  username: string
  password: string
  magicLink: string
  sheetUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0d0d0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:36px;font-weight:700;color:#dc2626;letter-spacing:4px;margin:0;">BOYK</h1>
      <p style="font-size:13px;color:#71717a;margin:4px 0 0;letter-spacing:1px;">Corporate Intelligence & Boycott Tracking</p>
    </div>

    <!-- Main card -->
    <div style="background:#1a1a1e;border-radius:16px;border:1px solid rgba(255,255,255,0.08);padding:32px;margin-bottom:24px;">
      <h2 style="font-size:22px;font-weight:600;color:#fafafa;margin:0 0 12px;">Welcome to Boyk, ${params.name}!</h2>
      <p style="font-size:14px;color:#a1a1aa;line-height:1.6;margin:0 0 24px;">
        Your NDA has been signed and your account is ready. Click the button below to sign in instantly.
      </p>

      <!-- Magic link button -->
      <a href="${params.magicLink}" style="display:block;width:100%;padding:14px;border-radius:12px;background:#dc2626;color:#fafafa;font-size:15px;font-weight:600;text-align:center;text-decoration:none;box-sizing:border-box;">
        Sign In to Boyk
      </a>

      <!-- Credentials -->
      <div style="margin-top:24px;background:#141416;border-radius:10px;padding:16px;border:1px solid rgba(255,255,255,0.06);">
        <p style="font-size:11px;color:#71717a;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">Your Login Credentials</p>
        <div style="display:flex;justify-content:space-between;padding:6px 0;">
          <span style="font-size:12px;color:#71717a;">Email</span>
          <span style="font-size:13px;color:#fafafa;font-family:monospace;">${params.email}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:12px;color:#71717a;">Username</span>
          <span style="font-size:13px;color:#fafafa;font-family:monospace;">${params.username}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:12px;color:#71717a;">Password</span>
          <span style="font-size:13px;color:#fafafa;font-family:monospace;">${params.password}</span>
        </div>
      </div>

      <!-- Chrome Extension -->
      <div style="margin-top:20px;padding:16px;background:rgba(99,102,241,0.08);border-radius:10px;border:1px solid rgba(99,102,241,0.15);">
        <p style="font-size:13px;color:#fafafa;margin:0 0 8px;font-weight:600;">Chrome Extension</p>
        <p style="font-size:12px;color:#a1a1aa;margin:0 0 12px;line-height:1.5;">
          Get real-time boycott alerts while you browse. The extension flags companies and products on sites like Amazon.
        </p>
        <a href="https://cdn.boyk.org/extensions/boyk-extension.zip" style="display:inline-block;padding:8px 16px;border-radius:8px;background:rgba(99,102,241,0.15);color:#818cf8;font-size:13px;font-weight:600;text-decoration:none;">
          Download Extension
        </a>
        <div style="margin-top:12px;padding:12px;background:#141416;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
          <p style="font-size:11px;color:#71717a;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Install Steps</p>
          <p style="font-size:12px;color:#a1a1aa;margin:0;line-height:1.8;">
            1. Download and unzip the file<br>
            2. Open <span style="color:#fafafa;font-family:monospace;font-size:11px;">chrome://extensions</span><br>
            3. Enable <span style="color:#fafafa;">Developer Mode</span> (top right)<br>
            4. Click <span style="color:#fafafa;">Load unpacked</span> and select the folder
          </p>
        </div>
      </div>

      <!-- Google Sheet -->
      <div style="margin-top:20px;padding:16px;background:rgba(34,197,94,0.08);border-radius:10px;border:1px solid rgba(34,197,94,0.15);">
        <p style="font-size:13px;color:#fafafa;margin:0 0 8px;font-weight:600;">Your Personal Feedback Sheet</p>
        <p style="font-size:12px;color:#a1a1aa;margin:0 0 12px;line-height:1.5;">
          We've created a Google Sheet just for you. Use it to share feedback, feature ideas, bugs, or anything else — it's yours to keep indefinitely.
        </p>
        <a href="${params.sheetUrl}" style="display:inline-block;padding:8px 16px;border-radius:8px;background:rgba(34,197,94,0.15);color:#22c55e;font-size:13px;font-weight:600;text-decoration:none;">
          Open Your Feedback Sheet
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;">
      <p style="font-size:12px;color:#3f3f46;margin:0;">
        You can always sign in at <a href="https://boyk.org" style="color:#dc2626;text-decoration:underline;">boyk.org</a> using the credentials above.
      </p>
      <p style="font-size:11px;color:#27272a;margin:12px 0 0;">&copy; ${new Date().getFullYear()} Boyk. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`
}
