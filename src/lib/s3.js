import { getAccessToken } from './supabase'

export const COMMENT_MEDIA_MAX_BYTES = 8 * 1024 * 1024 // 8 MB

export async function uploadProfilePicture(userId, file) {
  if (!userId || !file) throw new Error('userId and file are required')

  const token = await getAccessToken()

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      contentLength: file.size,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Upload URL request failed: ${response.status}`)
  }

  const { uploadUrl, publicUrl } = await response.json()

  // Upload directly to S3 using the presigned URL
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })

  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed: ${uploadResponse.status}`)
  }

  return publicUrl
}

export async function uploadPostMedia(file) {
  if (!file) throw new Error('File is required')

  const token = await getAccessToken()

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      contentLength: file.size,
      purpose: 'post',
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Upload URL request failed: ${response.status}`)
  }

  const { uploadUrl, publicUrl } = await response.json()

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })

  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed: ${uploadResponse.status}`)
  }

  return publicUrl
}

export async function uploadMultiplePostMedia(files) {
  if (!files || files.length === 0) return []
  const results = await Promise.all(
    files.map(async file => {
      const url = await uploadPostMedia(file)
      return { url, type: file.type }
    })
  )
  return results
}

export async function uploadCommentMedia(file) {
  if (!file) throw new Error('File is required')
  if (!file.type?.startsWith('image/')) {
    throw new Error('Only image uploads are allowed')
  }
  if (file.size > COMMENT_MEDIA_MAX_BYTES) {
    throw new Error(
      `Image is too large (max ${Math.round(COMMENT_MEDIA_MAX_BYTES / (1024 * 1024))} MB)`
    )
  }

  const token = await getAccessToken()

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      contentLength: file.size,
      purpose: 'comment',
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Upload URL request failed: ${response.status}`)
  }

  const { uploadUrl, publicUrl } = await response.json()

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })

  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed: ${uploadResponse.status}`)
  }

  return { url: publicUrl, type: file.type }
}

// Combined delete: the edge function calls delete_boycott_comment (which
// enforces user_id = auth.uid() server-side) and then cleans up R2. Caller
// passes a comment id, never a media URL — no trust chain across the wire.
export async function deleteCommentWithMedia(commentId) {
  if (!commentId) throw new Error('commentId is required')

  const token = await getAccessToken()

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-comment-media`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ commentId }),
    }
  )

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Delete comment request failed: ${response.status}`)
  }
}
