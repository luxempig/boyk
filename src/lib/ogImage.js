import { getAccessToken } from './supabase'

/**
 * Fire-and-forget regeneration of a boycott's Open Graph image.
 *
 * The edge function does the work of rendering the PNG, uploading to R2, and
 * writing the resulting URL back to `boycotts.og_image_url`. The browser
 * doesn't need to wait — the fresh image only matters when someone shares the
 * URL on social, which always lags the save by at least a few seconds.
 *
 * Safe to call for any boycott — the edge function rejects private boycotts
 * and non-creators on the server side.
 */
export async function triggerBoycottOgRegeneration(boycottId) {
  if (!boycottId) return
  try {
    const token = await getAccessToken()
    if (!token) return
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-boycott-og-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ boycottId }),
    })
  } catch (err) {
    // The OG image is a polish feature — failures must never block the save
    // flow or surface to users. Log for observability and move on.
    console.warn('OG image regeneration failed:', err)
  }
}
