import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { addEmailToAccessPolicy } from '../_shared/cloudflare-access.ts'
import { buildWelcomeEmail, createDemoSheet, sendGmail } from '../_shared/google-api.ts'
import { getSupabaseServiceClient } from '../_shared/supabase.ts'
import { sendTelegram } from '../_shared/telegram.ts'

// All webhook responses are JSON for parity with the rest of the edge fn
// surface. DocuSign Connect doesn't read the response body — it only checks
// the status code — so the shape change is callsite-safe.
const JSON_HEADERS = { 'Content-Type': 'application/json' }
function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/**
 * DocuSign Connect webhook handler.
 * Triggered when an envelope is completed (NDA signed).
 * Verifies HMAC signature, grants CF Access, creates Google Sheet,
 * sends welcome email, updates demo_access record.
 */
serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.text()

    // Verify HMAC signature
    const signature = req.headers.get('X-DocuSign-Signature-1')
    const secret = Deno.env.get('DOCUSIGN_WEBHOOK_SECRET')

    if (!signature || !secret) {
      console.error('Missing webhook signature or secret')
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const isValid = await verifyHMAC(secret, body, signature)
    if (!isValid) {
      console.error('Invalid webhook HMAC signature')
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const payload = JSON.parse(body)
    const event = payload.event
    const envelopeId = payload.data?.envelopeId || payload.envelopeId

    console.log(`DocuSign webhook: event=${event}, envelopeId=${envelopeId}`)

    // Only process completed envelopes
    if (event !== 'envelope-completed') {
      return jsonResponse({ ok: true, ignored: true, event }, 200)
    }

    if (!envelopeId) {
      console.error('No envelopeId in webhook payload')
      return jsonResponse({ error: 'Missing envelopeId' }, 400)
    }

    const supabase = getSupabaseServiceClient()

    // Look up the demo_access record
    const { data: record, error: lookupError } = await supabase
      .from('demo_access')
      .select('*')
      .eq('envelope_id', envelopeId)
      .maybeSingle()

    if (lookupError || !record) {
      console.error('demo_access record not found for envelope:', envelopeId, lookupError)
      return jsonResponse({ ok: true, ignored: true, reason: 'demo_access record not found' }, 200)
    }

    // Update to signed
    const now = new Date().toISOString()

    await supabase
      .from('demo_access')
      .update({ status: 'signed', signed_at: now })
      .eq('id', record.id)

    // Add email to Cloudflare Access policy
    try {
      await addEmailToAccessPolicy(record.email)
    } catch (cfError) {
      console.error('Failed to add email to CF Access:', cfError)
      await sendTelegram(
        `⚠️ <b>CF Access grant failed</b>\n` +
          `Email: ${record.email}\n` +
          `Error: ${cfError.message}\n` +
          `Manual action needed!`
      )
      // Still update the record as signed — manual intervention needed
      return jsonResponse({ ok: true, warning: 'cf-access-grant-failed' }, 200)
    }

    // Auto-provision Supabase account for the demo user
    let accountStatus = 'skipped'
    let username = ''
    let tempPassword = ''
    try {
      // Check if user already exists by email
      const { data: existingUsers } = await supabase.auth.admin.listUsers({
        filter: `email.eq.${record.email.toLowerCase()}`,
        page: 1,
        perPage: 1,
      })
      const existing = existingUsers?.users?.[0]

      if (existing) {
        accountStatus = 'existing'
        username = existing.user_metadata?.username || record.email.split('@')[0]
        tempPassword = record.temp_password || '(use magic link)'
        console.log('Supabase user already exists for', record.email)
      } else {
        // Generate credentials
        const baseUsername =
          record.name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 20) || 'demo'
        username = baseUsername + '_' + Date.now().toString(36).slice(-4)
        tempPassword = record.temp_password || crypto.randomUUID().slice(0, 12) + 'A1!'

        const { error: createError } = await supabase.auth.admin.createUser({
          email: record.email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { username, full_name: record.name },
        })

        if (createError) {
          console.error('Failed to create Supabase user:', createError)
          accountStatus = 'failed'
        } else {
          accountStatus = 'created'
        }
      }
    } catch (err) {
      console.error('Supabase account provisioning error:', err)
      accountStatus = 'error'
    }

    // Generate magic link for direct sign-in
    let magicLink = 'https://boyk.org'
    try {
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: record.email,
        options: {
          redirectTo: 'https://boyk.org',
        },
      })
      if (linkError) {
        console.error('Failed to generate magic link:', linkError)
      } else if (linkData?.properties?.action_link) {
        magicLink = linkData.properties.action_link
      }
    } catch (err) {
      console.error('Magic link generation error:', err)
    }

    // Create personal Google Sheet for the user
    let sheetUrl = ''
    try {
      sheetUrl = await createDemoSheet(record.name, record.email)
    } catch (err) {
      console.error('Failed to create demo sheet:', err)
      // Non-fatal — continue without sheet
    }

    // Send custom welcome email via Gmail
    let emailStatus = 'skipped'
    try {
      const html = buildWelcomeEmail({
        name: record.name,
        email: record.email,
        username,
        password: tempPassword,
        magicLink,
        sheetUrl: sheetUrl || 'https://boyk.org',
      })
      await sendGmail(record.email, 'Welcome to Boyk — Your Demo Access is Ready', html)
      emailStatus = 'sent'
    } catch (err) {
      console.error('Failed to send welcome email:', err)
      emailStatus = 'failed'
    }

    // Update to access_granted (indefinite — no expiry)
    await supabase
      .from('demo_access')
      .update({
        status: 'access_granted',
        access_granted_at: now,
        access_expires_at: null, // Indefinite access
        google_sheet_url: sheetUrl || null,
      })
      .eq('id', record.id)

    await sendTelegram(
      `✅ <b>Demo access granted</b>\n` +
        `Name: ${record.name}\n` +
        `Email: ${record.email}\n` +
        `Account: ${accountStatus}\n` +
        `Email: ${emailStatus}\n` +
        `Sheet: ${sheetUrl ? 'created' : 'failed'}\n` +
        `Access: indefinite`
    )

    return jsonResponse({ ok: true }, 200)
  } catch (error) {
    console.error('docusign-webhook error:', error)
    return jsonResponse({ error: 'Internal error' }, 500)
  }
})

/**
 * Verify DocuSign HMAC-SHA256 signature.
 */
async function verifyHMAC(
  secret: string,
  body: string,
  expectedSignature: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )

  // Use crypto.subtle.verify for constant-time comparison
  const expectedBytes = Uint8Array.from(atob(expectedSignature), c => c.charCodeAt(0))
  return crypto.subtle.verify('HMAC', key, expectedBytes, new TextEncoder().encode(body))
}
