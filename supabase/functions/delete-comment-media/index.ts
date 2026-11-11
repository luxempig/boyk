import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { getCorsHeaders } from '../_shared/cors.ts'

// Validate a Supabase session JWT by calling /auth/v1/user. Mirrors the
// pattern in upload-url; see that file for the rationale (asymmetric signing
// keys break supabase.auth.getUser() server-side).
async function verifyUser(jwt: string): Promise<{ id: string } | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: anonKey,
    },
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return body?.id ? { id: body.id } : null
}

/**
 * Delete a boycott comment + its R2 media in one server-side step.
 *
 * Earlier version took an arbitrary `mediaUrl` and deleted it whenever the
 * caller was authenticated, trusting the prior `delete_boycott_comment` RPC
 * to have validated ownership. That trust chain meant any authenticated user
 * who got hold of a URL (e.g. via the public comments feed) could delete
 * another user's media.
 *
 * Now: caller passes a `commentId`. We invoke `delete_boycott_comment` RPC
 * with the caller's JWT — that RPC enforces `user_id = auth.uid()` and
 * returns the media URL of the row it deleted (or NULL). Only on success do
 * we follow up with the R2 DELETE. Ownership check and DB delete happen
 * atomically inside the RPC; we never act on caller-supplied URLs.
 *
 * Request:  POST { commentId: string }
 * Response: { ok: true } | { error: string }
 */
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const jwt = authHeader?.replace(/^Bearer\s+/i, '')
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const user = await verifyUser(jwt)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { commentId } = await req.json()
    if (!commentId || typeof commentId !== 'string') {
      return new Response(JSON.stringify({ error: 'commentId is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const accountId = Deno.env.get('R2_ACCOUNT_ID')
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
    const bucket = Deno.env.get('R2_BUCKET') || 'boyk-assets'
    const publicUrl = Deno.env.get('R2_PUBLIC_URL')

    if (!supabaseUrl || !anonKey || !accountId || !accessKeyId || !secretAccessKey || !publicUrl) {
      console.error('Missing environment variables')
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Call delete_boycott_comment under the caller's JWT. The RPC enforces
    // user_id = auth.uid() and returns the media_url of the deleted row.
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_boycott_comment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_id: commentId }),
    })
    if (!rpcRes.ok) {
      // Log the raw Supabase error server-side for debugging, but don't echo
      // it back to the caller — the body can include internal table names or
      // PG error details that we don't want exposed to clients.
      const body = await rpcRes.text().catch(() => '')
      console.error('delete_boycott_comment RPC failed:', rpcRes.status, body)
      const status = rpcRes.status === 401 || rpcRes.status === 403 ? rpcRes.status : 400
      const errorMessage =
        status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Comment delete failed'
      return new Response(JSON.stringify({ error: errorMessage }), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const mediaUrl = (await rpcRes.json()) as string | null

    // No media → DB-only delete succeeded, nothing more to do.
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Extract the R2 key. The URL came from our own DB so this is a sanity
    // check, not security — but cheap and useful for catching schema drift.
    const prefix = `${publicUrl.replace(/\/$/, '')}/`
    if (!mediaUrl.startsWith(prefix)) {
      console.warn('Comment media_url is not an R2 asset, skipping cleanup:', mediaUrl)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const key = mediaUrl.slice(prefix.length)
    if (!key.startsWith('comment-media/')) {
      console.warn('Comment media_url is outside comment-media/, skipping cleanup:', key)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const result = await deleteR2Object({
      accountId,
      bucket,
      key,
      accessKeyId,
      secretAccessKey,
    })

    // R2 returns 204 No Content on success and 404 if the key is already gone.
    // Treat 404 as success — the goal (object absent) is met either way. Note
    // that even on R2 failure the comment row is already deleted, so we
    // surface a 200 so the frontend doesn't try to undo (the comment IS gone).
    if (result.status !== 204 && result.status !== 404) {
      console.error('R2 delete failed (comment row already deleted):', result.status, result.body)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('delete-comment-media error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})

// --- R2 server-side DELETE with AWS Signature V4 ---
//
// Duplicated sig v4 primitives from upload-url/index.ts. If/when we add a
// third R2 operation, extract these into _shared/r2.ts.

async function deleteR2Object({
  accountId,
  bucket,
  key,
  accessKeyId,
  secretAccessKey,
}: {
  accountId: string
  bucket: string
  key: string
  accessKeyId: string
  secretAccessKey: string
}): Promise<{ status: number; body: string }> {
  const region = 'auto'
  const host = `${bucket}.${accountId}.r2.cloudflarestorage.com`
  const now = new Date()
  const dateStamp = formatDate(now)
  const amzDate = formatAmzDate(now)
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:UNSIGNED-PAYLOAD\n` + `x-amz-date:${amzDate}\n`

  const canonicalRequest = [
    'DELETE',
    `/${encodeS3Key(key)}`,
    '',
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, 's3')
  const signature = await hmacHex(signingKey, stringToSign)

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${host}/${encodeS3Key(key)}`, {
    method: 'DELETE',
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
    },
  })
  const body = await res.text().catch(() => '')
  return { status: res.status, body }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function hmacHex(key: ArrayBuffer | Uint8Array, data: string): Promise<string> {
  const sig = await hmac(key, data)
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode('AWS4' + secretKey), dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}
