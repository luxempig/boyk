import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { removeEmailFromAccessPolicy } from '../_shared/cloudflare-access.ts'
import { getSupabaseServiceClient } from '../_shared/supabase.ts'
import { sendTelegram } from '../_shared/telegram.ts'

/**
 * Clean up expired demo access records.
 * Removes emails from CF Access policy and updates status to 'expired'.
 * Called hourly via scheduled invocation.
 *
 * Auth: requires service-role key in Authorization header.
 */
serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Verify service-role auth
  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!serviceKey || !authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabase = getSupabaseServiceClient()
    const now = new Date().toISOString()

    // Find all expired access_granted records (skip indefinite — null expiry)
    const { data: expired, error } = await supabase
      .from('demo_access')
      .select('*')
      .eq('status', 'access_granted')
      .not('access_expires_at', 'is', null)
      .lt('access_expires_at', now)

    if (error) {
      console.error('Failed to query expired records:', error)
      throw error
    }

    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ message: 'No expired records', count: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const results: { email: string; success: boolean; error?: string }[] = []

    for (const record of expired) {
      try {
        await removeEmailFromAccessPolicy(record.email)

        await supabase
          .from('demo_access')
          .update({
            status: 'expired',
            access_revoked_at: now,
          })
          .eq('id', record.id)

        results.push({ email: record.email, success: true })
      } catch (err) {
        console.error(`Failed to revoke access for ${record.email}:`, err)
        results.push({ email: record.email, success: false, error: err.message })
      }
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    if (expired.length > 0) {
      await sendTelegram(
        `🧹 <b>Demo access cleanup</b>\n` +
          `Expired: ${expired.length}\n` +
          `Revoked: ${succeeded}\n` +
          (failed > 0 ? `Failed: ${failed} ⚠️` : '')
      )
    }

    return new Response(
      JSON.stringify({ message: 'Cleanup complete', expired: expired.length, succeeded, failed }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('demo-access-cleanup error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
