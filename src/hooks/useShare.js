import { useCallback, useState } from 'react'

import { buildShareText } from '../lib/shareText'

/**
 * useShare — single share entry point for posts, boycotts, scans.
 *
 * Mobile path: hits navigator.share to invoke the native OS sheet (which
 * includes Instagram, WhatsApp, SMS, etc. that the user has installed).
 *
 * Desktop / unsupported / fallback path: surfaces the ShareMenu component
 * with platform-specific buttons. The hook owns the menu state.
 *
 * Usage:
 *   const { share, menuState, closeMenu } = useShare()
 *   <button onClick={() => share({ url, type: 'post', data: post })}>Share</button>
 *   <ShareMenu state={menuState} onClose={closeMenu} />
 */
export function useShare() {
  const [menuState, setMenuState] = useState(null)

  const share = useCallback(async ({ url, type, data, title }) => {
    const { short, long } = buildShareText({ type, data })
    const payload = { url, short, long, title: title || short, type }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: payload.title,
          text: long,
          url,
        })
        return
      } catch (err) {
        // AbortError = user dismissed the sheet on purpose — respect that
        // and don't pop the fallback menu in their face.
        if (err?.name === 'AbortError') return
        // Any other error (NotAllowedError, permissions, etc.) → fall through
        // to the menu so the share still completes somewhere.
      }
    }

    setMenuState(payload)
  }, [])

  const closeMenu = useCallback(() => setMenuState(null), [])

  return { share, menuState, closeMenu }
}
