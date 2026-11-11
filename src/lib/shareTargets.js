/**
 * Pure URL builders for social-share targets.
 *
 * Each target exposes:
 *   - label:  user-facing string for the menu
 *   - icon:   lucide-react component name (looked up by ShareMenu)
 *   - color:  accent color hex used for the icon background in ShareMenu
 *   - build({ url, short, long }): returns the share intent URL to open
 *
 * Conventions:
 *   - `url` is the canonical Boyk link (e.g. https://boyk.org/post/abc).
 *     The builder adds utm_source/utm_medium automatically.
 *   - `short` is the ≤240-char message for character-limited platforms (Twitter).
 *   - `long`  is the full message for everywhere else (WhatsApp, email, etc.).
 *   - Builders return a string. The caller opens it via window.open or a link.
 *
 * Instagram is intentionally omitted — IG has no web share intent. The native
 * mobile share sheet (navigator.share) handles IG; on desktop we can't.
 */

const enc = encodeURIComponent

function addUtm(rawUrl, source) {
  try {
    const u = new URL(rawUrl)
    u.searchParams.set('utm_source', source)
    u.searchParams.set('utm_medium', 'share')
    return u.toString()
  } catch {
    return rawUrl
  }
}

export const SHARE_TARGETS = {
  twitter: {
    label: 'Twitter / X',
    icon: 'Twitter',
    color: '#1DA1F2',
    build: ({ url, short }) => {
      const tagged = addUtm(url, 'twitter')
      return `https://twitter.com/intent/tweet?text=${enc(short)}&url=${enc(tagged)}`
    },
  },
  whatsapp: {
    label: 'WhatsApp',
    icon: 'MessageCircle',
    color: '#25D366',
    build: ({ url, long }) => {
      const tagged = addUtm(url, 'whatsapp')
      // WhatsApp ignores a separate URL param — embed it in the text.
      return `https://wa.me/?text=${enc(`${long}\n\n${tagged}`)}`
    },
  },
  facebook: {
    label: 'Facebook',
    icon: 'Facebook',
    color: '#1877F2',
    build: ({ url }) => {
      // Facebook scrapes its own OG preview; user-supplied text is ignored.
      const tagged = addUtm(url, 'facebook')
      return `https://www.facebook.com/sharer/sharer.php?u=${enc(tagged)}`
    },
  },
  linkedin: {
    label: 'LinkedIn',
    icon: 'Linkedin',
    color: '#0A66C2',
    build: ({ url }) => {
      const tagged = addUtm(url, 'linkedin')
      return `https://www.linkedin.com/sharing/share-offsite/?url=${enc(tagged)}`
    },
  },
  reddit: {
    label: 'Reddit',
    icon: 'MessageSquare',
    color: '#FF4500',
    build: ({ url, short }) => {
      const tagged = addUtm(url, 'reddit')
      return `https://www.reddit.com/submit?url=${enc(tagged)}&title=${enc(short)}`
    },
  },
  telegram: {
    label: 'Telegram',
    icon: 'Send',
    color: '#26A5E4',
    build: ({ url, long }) => {
      const tagged = addUtm(url, 'telegram')
      return `https://t.me/share/url?url=${enc(tagged)}&text=${enc(long)}`
    },
  },
  threads: {
    label: 'Threads',
    icon: 'AtSign',
    color: '#000000',
    build: ({ url, long }) => {
      const tagged = addUtm(url, 'threads')
      // Threads doesn't accept a URL param; prepend it to the text.
      return `https://www.threads.net/intent/post?text=${enc(`${long}\n\n${tagged}`)}`
    },
  },
  bluesky: {
    label: 'Bluesky',
    icon: 'Cloud',
    color: '#0085FF',
    build: ({ url, long }) => {
      const tagged = addUtm(url, 'bluesky')
      return `https://bsky.app/intent/compose?text=${enc(`${long}\n\n${tagged}`)}`
    },
  },
  email: {
    label: 'Email',
    icon: 'Mail',
    color: '#6B7280',
    build: ({ url, short, long }) => {
      const tagged = addUtm(url, 'email')
      const subject = short
      const body = `${long}\n\n${tagged}`
      return `mailto:?subject=${enc(subject)}&body=${enc(body)}`
    },
  },
  sms: {
    label: 'Messages',
    icon: 'MessageSquareText',
    color: '#34C759',
    build: ({ url, long }) => {
      const tagged = addUtm(url, 'sms')
      // iOS expects sms:&body=, Android accepts sms:?body=. The `&` form works
      // on both when there's no recipient.
      return `sms:&body=${enc(`${long} ${tagged}`)}`
    },
  },
}

// Order shown in the desktop menu. SMS is appended only on touch devices
// (ShareMenu decides at render time).
export const DESKTOP_ORDER = [
  'twitter',
  'whatsapp',
  'facebook',
  'linkedin',
  'threads',
  'bluesky',
  'reddit',
  'telegram',
  'email',
]

export const MOBILE_EXTRA = ['sms']

export function isTouchDevice() {
  if (typeof window === 'undefined') return false
  return 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)
}
