import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { appendRows, getSheetsAccessToken } from '../_shared/google-sheets.ts'
import { getSupabaseServiceClient } from '../_shared/supabase.ts'

/**
 * Append new rows from Supabase moderation tables to a Google Sheet on a
 * cursor basis. Runs on a 5-minute schedule (configure via pg_cron or
 * supabase scheduled functions). Idempotent per cursor advance: if Sheets
 * is down or returns an error, the cursor doesn't move and the next run
 * retries the same rows.
 *
 * Required env (same OAuth client used by google-api.ts):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN — must have been issued with the
 *     https://www.googleapis.com/auth/spreadsheets scope (see setup doc)
 *   SYNC_SPREADSHEET_ID — the spreadsheet doc id (boyk's reports/feedback doc)
 *   SYNC_TAB_REPORTS    — tab name for boycott_reports (default 'reports')
 *   SYNC_TAB_FEEDBACK   — tab name for user_feedback   (default 'feedback')
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
 *
 * Auth: requires Bearer service-role key. Matches the demo-access-cleanup
 * pattern so scheduled invocations can hit it via the same mechanism.
 */
serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Verify the caller is service-role. We decode the JWT payload rather than
  // string-comparing against SUPABASE_SERVICE_ROLE_KEY because the latter has
  // historically rotated out of sync with what's stored in client .env files.
  // verify_jwt: true on the function already validates the JWT signature at
  // the gateway, so by the time we get here the token is authentic — we only
  // need to confirm the role claim.
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '')
  let role: string | null = null
  try {
    const payload = JSON.parse(atob(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    role = payload.role
  } catch {
    /* fall through to 401 */
  }
  if (role !== 'service_role') {
    return new Response('Unauthorized', { status: 401 })
  }

  const spreadsheetId = Deno.env.get('SYNC_SPREADSHEET_ID')
  if (!spreadsheetId) {
    return jsonError('Missing SYNC_SPREADSHEET_ID env var')
  }
  const tabReports = Deno.env.get('SYNC_TAB_REPORTS') ?? 'reports'
  const tabFeedback = Deno.env.get('SYNC_TAB_FEEDBACK') ?? 'feedback'

  const supabase = getSupabaseServiceClient()

  let accessToken: string
  try {
    accessToken = await getSheetsAccessToken()
  } catch (err) {
    return jsonError(`Sheets auth failed: ${(err as Error).message}`)
  }

  const summary: Record<string, { synced: number; error: string | null }> = {}

  summary.boycott_reports = await syncTable({
    supabase,
    table: 'boycott_reports',
    tab: tabReports,
    spreadsheetId,
    accessToken,
    select: 'id, boycott_id, reporter_id, reason, details, status, created_at, updated_at',
    toRow: r => [
      r.id,
      r.boycott_id,
      r.reporter_id,
      r.reason,
      r.details ?? '',
      r.status,
      r.created_at,
      r.updated_at,
    ],
  })

  summary.user_feedback = await syncTable({
    supabase,
    table: 'user_feedback',
    tab: tabFeedback,
    spreadsheetId,
    accessToken,
    select: 'id, user_id, email, message, image_url, created_at',
    toRow: r => [
      r.id,
      r.user_id ?? '',
      r.email ?? '',
      r.message ?? '',
      r.image_url ?? '',
      r.created_at,
    ],
  })

  return new Response(JSON.stringify({ ok: true, summary }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

async function syncTable(params: {
  supabase: ReturnType<typeof getSupabaseServiceClient>
  table: string
  tab: string
  spreadsheetId: string
  accessToken: string
  select: string
  toRow: (row: Row) => (string | number | null)[]
}): Promise<{ synced: number; error: string | null }> {
  const { supabase, table, tab, spreadsheetId, accessToken, select, toRow } = params

  // Load cursor (epoch by default).
  const { data: state, error: stateErr } = await supabase
    .from('sheet_sync_state')
    .select('last_synced_at')
    .eq('table_name', table)
    .single()
  if (stateErr) {
    return { synced: 0, error: `cursor read failed: ${stateErr.message}` }
  }
  const cursor = state?.last_synced_at ?? '1970-01-01T00:00:00Z'

  // Pull rows newer than the cursor, capped to a sane batch so a backfill
  // can't blow through Sheets quota in a single invocation.
  const { data: rows, error: rowsErr } = await supabase
    .from(table)
    .select(select)
    .gt('created_at', cursor)
    .order('created_at', { ascending: true })
    .limit(500)
  if (rowsErr) {
    return { synced: 0, error: `rows read failed: ${rowsErr.message}` }
  }
  if (!rows || rows.length === 0) {
    await supabase
      .from('sheet_sync_state')
      .update({ last_run_at: new Date().toISOString(), last_error: null })
      .eq('table_name', table)
    return { synced: 0, error: null }
  }

  // Append. If this throws, the cursor stays put and the next run retries.
  try {
    await appendRows({
      spreadsheetId,
      tab,
      rows: rows.map(toRow),
      accessToken,
    })
  } catch (err) {
    const message = (err as Error).message
    await supabase
      .from('sheet_sync_state')
      .update({ last_run_at: new Date().toISOString(), last_error: message })
      .eq('table_name', table)
    return { synced: 0, error: message }
  }

  // Advance cursor to the newest created_at we wrote.
  const newCursor = rows[rows.length - 1].created_at as string
  const { error: updateErr } = await supabase
    .from('sheet_sync_state')
    .update({
      last_synced_at: newCursor,
      last_run_at: new Date().toISOString(),
      last_error: null,
      rows_synced: (state ? 0 : 0) + rows.length,
    })
    .eq('table_name', table)
  if (updateErr) {
    return {
      synced: rows.length,
      error: `cursor advance failed (rows written): ${updateErr.message}`,
    }
  }
  return { synced: rows.length, error: null }
}

function jsonError(message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}
