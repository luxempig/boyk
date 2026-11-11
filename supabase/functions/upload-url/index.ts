import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { getCorsHeaders } from '../_shared/cors.ts'

// Validate a Supabase session JWT by calling /auth/v1/user directly. The JS
// SDK's auth.getUser() on the server side has been flaky with the new
// asymmetric signing keys — a direct fetch is faster and more predictable.
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

// Server-enforced upload size cap. Signed into the presigned URL as
// `content-length`, so R2 rejects any PUT whose body length doesnt match.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * Generate a presigned R2 PUT URL for image uploads (profile pictures, post media).
 * Uses Cloudflare R2 (S3-compatible) to consolidate all storage on one platform.
 *
 * Deployed with --no-verify-jwt because the edge-function gateway doesn't
 * accept the ES256 JWTs minted by Supabase's new asymmetric signing keys —
 * we validate the caller's session ourselves via supabase.auth.getUser(jwt).
 *
 * Request: POST { fileName: string, contentType: string, contentLength: number,
 *                 purpose?: "post" | "profile" | "comment" }
 * Response: { uploadUrl: string, publicUrl: string }
 */

/**
 * Raster formats every client can decode.
 *
 * This is an explicit allowlist rather than a `startsWith('image/')` check.
 * That prefix test admitted `image/svg+xml`, which the web renders natively via
 * <img> but iOS cannot decode at all — so an SVG uploaded from the browser was
 * a permanently broken image in the app. Restricting at the upload boundary
 * keeps the two clients from diverging.
 *
 * It also closes a smaller hole: SVG is an executable document format (it can
 * carry <script>), so refusing it avoids serving active content from the CDN.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    // Authenticate user via direct /auth/v1/user fetch (see verifyUser helper).
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

    const { fileName, contentType, contentLength, purpose } = await req.json()

    if (!fileName || !contentType) {
      return new Response(JSON.stringify({ error: 'fileName and contentType are required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType.split(';')[0].trim().toLowerCase())) {
      return new Response(
        JSON.stringify({
          error: `Unsupported image type. Allowed: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`,
        }),
        {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      )
    }

    // contentLength is required and signed into the presigned URL so R2
    // enforces it server-side (presigned PUTs don't support content-length-range
    // policy, so we bind the byte count via the signature itself).
    if (
      typeof contentLength !== 'number' ||
      !Number.isInteger(contentLength) ||
      contentLength <= 0
    ) {
      return new Response(
        JSON.stringify({ error: 'contentLength is required and must be a positive integer' }),
        {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      )
    }
    if (contentLength > MAX_UPLOAD_BYTES) {
      return new Response(
        JSON.stringify({
          error: `File too large (max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)`,
        }),
        {
          status: 413,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      )
    }

    // R2 credentials (S3-compatible API)
    const accountId = Deno.env.get('R2_ACCOUNT_ID')
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
    const bucket = Deno.env.get('R2_BUCKET') || 'boyk-assets'
    const publicUrl = Deno.env.get('R2_PUBLIC_URL')

    if (!accountId || !accessKeyId || !secretAccessKey || !publicUrl) {
      console.error('Missing R2 environment variables')
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Build the object key based on purpose
    const extension = fileName.split('.').pop() || 'jpg'
    const prefix =
      purpose === 'post'
        ? 'post-media'
        : purpose === 'comment'
          ? 'comment-media'
          : 'profile-pictures'
    const key = `${prefix}/${user.id}-${Date.now()}.${extension}`

    // Generate presigned PUT URL using AWS Signature V4 (R2 is S3-compatible)
    const region = 'auto' // R2 uses "auto" as the region
    const host = `${accountId}.r2.cloudflarestorage.com`
    const expiresIn = 300 // 5 minutes

    const url = await generatePresignedPutUrl({
      host,
      bucket,
      key,
      contentType,
      contentLength,
      accessKeyId,
      secretAccessKey,
      region,
      expiresIn,
    })

    const objectPublicUrl = `${publicUrl}/${key}`

    return new Response(JSON.stringify({ uploadUrl: url, publicUrl: objectPublicUrl }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('upload-url error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})

// --- AWS Signature V4 presigned URL generation (works with R2's S3-compatible API) ---

async function generatePresignedPutUrl({
  host,
  bucket,
  key,
  contentType,
  contentLength,
  accessKeyId,
  secretAccessKey,
  region,
  expiresIn,
}: {
  host: string
  bucket: string
  key: string
  contentType: string
  contentLength: number
  accessKeyId: string
  secretAccessKey: string
  region: string
  expiresIn: number
}): Promise<string> {
  const endpoint = `${bucket}.${host}`
  const now = new Date()
  const dateStamp = formatDate(now)
  const amzDate = formatAmzDate(now)
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const credential = `${accessKeyId}/${credentialScope}`

  // content-length is included in signed headers so R2 binds the byte count
  // to this signature. Any PUT whose Content-Length differs gets rejected.
  const canonicalQuerystring = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(credential)}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${expiresIn}`,
    `X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost`,
  ]
    .sort()
    .join('&')

  const canonicalHeaders = `content-length:${contentLength}\ncontent-type:${contentType}\nhost:${endpoint}\n`
  const signedHeaders = 'content-length;content-type;host'

  const canonicalRequest = [
    'PUT',
    `/${encodeS3Key(key)}`,
    canonicalQuerystring,
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

  return `https://${endpoint}/${encodeS3Key(key)}?${canonicalQuerystring}&X-Amz-Signature=${signature}`
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
