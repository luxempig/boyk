import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { getSupabaseServiceClient } from '../_shared/supabase.ts'
import { sendTelegram } from '../_shared/telegram.ts'

/**
 * Sends a Telegram alert when something is reported.
 *
 * Called by the boycott_reports_notify / content_reports_notify triggers with
 * { table, id }. The caller is not authenticated, so the body is only a
 * pointer: the report is re-read here with the service role, and only one
 * that is open and was created or reopened in the last few minutes produces
 * an alert. A forged call can at most repeat an alert for a real, fresh report.
 */

const TABLES = ['boycott_reports', 'content_reports'] as const
const FRESH_MS = 5 * 60 * 1000

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clip(s: string | null | undefined, n = 200) {
  if (!s) return ''
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n)}…` : one
}

serve(async req => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })

  let table: string, id: string
  try {
    ;({ table, id } = await req.json())
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!TABLES.includes(table as (typeof TABLES)[number]) || typeof id !== 'string') {
    return new Response(null, { status: 400 })
  }

  const db = getSupabaseServiceClient()
  const { data: report } = await db.from(table).select('*').eq('id', id).maybeSingle()
  if (!report || report.status !== 'open') return new Response(null, { status: 204 })
  if (Date.now() - new Date(report.updated_at).getTime() > FRESH_MS) {
    return new Response(null, { status: 204 })
  }

  const { data: reporter } = await db
    .from('profiles')
    .select('username')
    .eq('id', report.reporter_id)
    .maybeSingle()

  let kind: string
  let target: string
  let targetCol: string
  let targetId: string
  if (table === 'boycott_reports') {
    kind = 'boycott'
    targetCol = 'boycott_id'
    targetId = report.boycott_id
    const { data } = await db.from('boycotts').select('name').eq('id', targetId).maybeSingle()
    target = `"${clip(data?.name, 80)}"`
  } else {
    kind = report.content_type
    targetCol = 'content_id'
    targetId = report.content_id
    if (kind === 'user') {
      const { data } = await db.from('profiles').select('username').eq('id', targetId).maybeSingle()
      target = `@${data?.username ?? 'unknown'}`
    } else {
      const from = kind === 'post' ? 'posts' : 'post_replies'
      const { data } = await db.from(from).select('content').eq('id', targetId).maybeSingle()
      target = `"${clip(data?.content, 120)}"`
    }
  }

  const { count } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(targetCol, targetId)
    .eq('status', 'open')

  const lines = [
    `🚩 <b>New report: ${esc(kind)}</b>`,
    esc(target),
    `Reason: ${esc(report.reason)}`,
    report.details ? `Details: ${esc(clip(report.details))}` : null,
    `Reported by @${esc(reporter?.username ?? 'unknown')}`,
    `Open reports on this ${esc(kind)}: ${count ?? 1}`,
    `Review in Supabase → table ${table}, id ${report.id}`,
  ].filter(Boolean)

  await sendTelegram(lines.join('\n'))
  return new Response(null, { status: 204 })
})
