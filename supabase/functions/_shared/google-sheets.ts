/**
 * Google Sheets writer for backend syncs. Uses a dedicated OAuth client +
 * refresh token (GOOGLE_SHEETS_*) isolated from the Drive/Gmail credentials
 * used by `google-api.ts`, so adding the Sheets scope doesn't have to
 * disrupt the existing demo-sheet / welcome-email flow. The two clients
 * can be the same Google project — just minted separately.
 *
 * Required env vars:
 *   GOOGLE_SHEETS_CLIENT_ID
 *   GOOGLE_SHEETS_CLIENT_SECRET
 *   GOOGLE_SHEETS_REFRESH_TOKEN — issued with the
 *     https://www.googleapis.com/auth/spreadsheets scope
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export async function getSheetsAccessToken(): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_SHEETS_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_SHEETS_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_SHEETS_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Sheets OAuth credentials (GOOGLE_SHEETS_CLIENT_ID, GOOGLE_SHEETS_CLIENT_SECRET, GOOGLE_SHEETS_REFRESH_TOKEN)'
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
    throw new Error(`Sheets token refresh failed: ${await res.text()}`)
  }
  const data = await res.json()
  return data.access_token
}

/**
 * Append rows to the bottom of a sheet tab. Uses USER_ENTERED so dates and
 * numbers render natively; flip to RAW if you want everything as strings.
 */
export async function appendRows(params: {
  spreadsheetId: string
  tab: string
  rows: (string | number | null)[][]
  accessToken: string
}): Promise<void> {
  if (params.rows.length === 0) return
  const range = encodeURIComponent(`${params.tab}!A:Z`)
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}` +
    `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: params.rows }),
  })
  if (!res.ok) {
    throw new Error(`Sheets append failed (${res.status}): ${await res.text()}`)
  }
}

/**
 * Look up tab names by their numeric gid. Lets callers configure target
 * tabs by the gid in the spreadsheet URL instead of guessing the tab title.
 */
export async function getTabNamesByGid(params: {
  spreadsheetId: string
  accessToken: string
}): Promise<Record<number, string>> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}` +
      `?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${params.accessToken}` } }
  )
  if (!res.ok) {
    throw new Error(`Sheets metadata fetch failed: ${await res.text()}`)
  }
  const data = await res.json()
  const map: Record<number, string> = {}
  for (const s of data.sheets ?? []) {
    map[s.properties.sheetId] = s.properties.title
  }
  return map
}
