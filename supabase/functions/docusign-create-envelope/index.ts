import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { getCorsHeaders } from '../_shared/cors.ts'
import { requireEnv } from '../_shared/env.ts'
import { getSupabaseServiceClient } from '../_shared/supabase.ts'
import { sendTelegram } from '../_shared/telegram.ts'

/**
 * Create a DocuSign envelope for NDA signing via embedded ceremony.
 *
 * Request: POST { email: string, name: string, source?: string }
 * Response: { signingUrl: string }
 */
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { email, name, source } = await req.json()

    if (!email || !name) {
      return new Response(JSON.stringify({ error: 'email and name are required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabase = getSupabaseServiceClient()

    // Check for existing active entry (rate-limit / dedup)
    const { data: existing } = await supabase
      .from('demo_access')
      .select('id, status, access_expires_at')
      .eq('email', email.toLowerCase())
      .in('status', ['pending_signature', 'signed', 'access_granted'])
      .maybeSingle()

    if (existing) {
      if (existing.status === 'access_granted') {
        return new Response(
          JSON.stringify({
            error: 'You already have demo access. Check your email for the OTP.',
            status: existing.status,
          }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }
      if (existing.status === 'pending_signature' || existing.status === 'signed') {
        return new Response(
          JSON.stringify({
            error: 'An NDA signing is already in progress for this email.',
            status: existing.status,
          }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Get DocuSign access token via JWT Grant
    const accessToken = await getDocuSignAccessToken()
    const accountId = requireEnv('DOCUSIGN_ACCOUNT_ID')
    const baseUrl = requireEnv('DOCUSIGN_BASE_URL')
    const templateId = requireEnv('DOCUSIGN_TEMPLATE_ID')

    // Create envelope from template
    const envelopeRes = await fetch(`${baseUrl}/restapi/v2.1/accounts/${accountId}/envelopes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateId,
        templateRoles: [
          {
            email: email.toLowerCase(),
            name,
            roleName: 'Signer',
            clientUserId: email.toLowerCase(), // Enables embedded signing
          },
        ],
        status: 'sent',
      }),
    })

    if (!envelopeRes.ok) {
      const errBody = await envelopeRes.text()
      console.error('DocuSign envelope creation failed:', errBody)
      throw new Error('Failed to create NDA envelope')
    }

    const envelope = await envelopeRes.json()
    const envelopeId = envelope.envelopeId

    // Create embedded signing URL (recipient view)
    const viewRes = await fetch(
      `${baseUrl}/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          returnUrl: 'https://boyk.org/demo/?event=signing_complete',
          authenticationMethod: 'none',
          email: email.toLowerCase(),
          userName: name,
          clientUserId: email.toLowerCase(),
        }),
      }
    )

    if (!viewRes.ok) {
      const errBody = await viewRes.text()
      console.error('DocuSign recipient view failed:', errBody)
      throw new Error('Failed to create signing URL')
    }

    const view = await viewRes.json()

    // Pre-generate credentials (stored in demo_access for webhook to use)
    const tempPassword = crypto.randomUUID().slice(0, 12) + 'A1!'

    // Insert demo_access record
    const { error: insertError } = await supabase.from('demo_access').insert({
      email: email.toLowerCase(),
      name,
      envelope_id: envelopeId,
      status: 'pending_signature',
      source: source || null,
      temp_password: tempPassword,
    })

    if (insertError) {
      console.error('Failed to insert demo_access:', insertError)
      // Don't fail the request — envelope is already created
    }

    await sendTelegram(
      `📝 <b>Demo NDA requested</b>\n` +
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Source: ${source || 'unknown'}`
    )

    // Only return signing URL — credentials will be sent via email after signing
    return new Response(JSON.stringify({ signingUrl: view.url }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('docusign-create-envelope error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})

/**
 * DocuSign JWT Grant flow.
 * Uses RSA private key to sign a JWT, exchanges it for an access token.
 */
async function getDocuSignAccessToken(): Promise<string> {
  const integrationKey = requireEnv('DOCUSIGN_INTEGRATION_KEY')
  const userId = requireEnv('DOCUSIGN_USER_ID')
  const oauthUrl = requireEnv('DOCUSIGN_OAUTH_URL')
  const rsaPrivateKeyPem = requireEnv('DOCUSIGN_RSA_PRIVATE_KEY')

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'RS256' }
  const payload = {
    iss: integrationKey,
    sub: userId,
    aud: new URL(oauthUrl).hostname,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  }

  const encodedHeader = base64urlEncode(JSON.stringify(header))
  const encodedPayload = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  // Import RSA private key and sign
  const key = await importRSAPrivateKey(rsaPrivateKeyPem)
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  )
  const encodedSignature = base64urlEncodeBuffer(new Uint8Array(signature))
  const jwt = `${signingInput}.${encodedSignature}`

  // Exchange JWT for access token
  const tokenRes = await fetch(`${oauthUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text()
    console.error('DocuSign JWT Grant failed:', errBody)
    throw new Error('DocuSign authentication failed')
  }

  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

async function importRSAPrivateKey(pem: string): Promise<CryptoKey> {
  // Handle escaped newlines from env vars
  const cleanPem = pem.replace(/\\n/g, '\n')
  const pemBody = cleanPem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

  // Try PKCS8 first, fall back to PKCS1 isn't directly supported by WebCrypto
  // DocuSign typically provides PKCS1, but we wrap it for WebCrypto
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )
  } catch {
    // If PKCS8 fails, the key is likely PKCS1 — wrap it in PKCS8 ASN.1
    const pkcs8Wrapped = wrapPKCS1inPKCS8(binaryDer)
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8Wrapped,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )
  }
}

/**
 * Wrap a PKCS1 RSA private key in PKCS8 ASN.1 structure.
 */
function wrapPKCS1inPKCS8(pkcs1: Uint8Array): Uint8Array {
  // PKCS8 header for RSA (OID 1.2.840.113549.1.1.1)
  const pkcs8Header = new Uint8Array([
    0x30,
    0x82,
    0x00,
    0x00, // SEQUENCE (length placeholder)
    0x02,
    0x01,
    0x00, // INTEGER 0 (version)
    0x30,
    0x0d, // SEQUENCE
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01, // OID rsaEncryption
    0x05,
    0x00, // NULL
    0x04,
    0x82,
    0x00,
    0x00, // OCTET STRING (length placeholder)
  ])

  const totalLength = pkcs8Header.length + pkcs1.length - 4 // minus outer SEQUENCE tag+length
  const innerLength = pkcs1.length

  const result = new Uint8Array(pkcs8Header.length + pkcs1.length)
  result.set(pkcs8Header)
  result.set(pkcs1, pkcs8Header.length)

  // Patch outer SEQUENCE length (bytes 2-3)
  result[2] = (totalLength >> 8) & 0xff
  result[3] = totalLength & 0xff

  // Patch OCTET STRING length (bytes at offset 24-25)
  result[pkcs8Header.length - 2] = (innerLength >> 8) & 0xff
  result[pkcs8Header.length - 1] = innerLength & 0xff

  return result
}

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlEncodeBuffer(buf: Uint8Array): string {
  let binary = ''
  for (const byte of buf) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
