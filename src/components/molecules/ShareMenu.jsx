/**
 * @component ShareMenu
 * @level Molecule
 *
 * @description Share dialog presented as a fallback to navigator.share — i.e.
 * shown on desktop, or on mobile when the native sheet isn't available. Lists
 * a "Copy link" primary action plus per-platform share buttons (Twitter,
 * WhatsApp, Facebook, LinkedIn, Threads, Bluesky, Reddit, Telegram, Email,
 * and Messages on touch devices).
 *
 * Instagram is intentionally absent — no web intent exists. IG users on
 * mobile get it via the native share sheet (which fires before this menu).
 *
 * @props
 * - state: { url, short, long, title } | null — open when non-null
 * - onClose: () => void
 */
import {
  AtSign,
  Cloud,
  Copy,
  Facebook,
  Linkedin,
  Mail,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Send,
  Twitter,
} from 'lucide-react'
import { useState } from 'react'

import { trackEvent } from '../../lib/analytics'
import { DESKTOP_ORDER, isTouchDevice, MOBILE_EXTRA, SHARE_TARGETS } from '../../lib/shareTargets'
import { Modal } from './Modal'

const ICON_MAP = {
  Twitter,
  Facebook,
  Linkedin,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Send,
  AtSign,
  Cloud,
  Mail,
}

export function ShareMenu({ state, onClose }) {
  const [copied, setCopied] = useState(false)
  const isOpen = state !== null

  const handleCopy = async () => {
    if (!state) return
    try {
      await navigator.clipboard.writeText(state.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Silent — the button label won't change to "Copied!" if clipboard fails
    }
  }

  const handlePlatform = key => {
    if (!state) return
    const target = SHARE_TARGETS[key]
    if (!target) return
    const intentUrl = target.build({
      url: state.url,
      short: state.short,
      long: state.long,
    })
    trackEvent('share_initiated', { platform: key, type: state.type })
    // mailto: and sms: schemes prefer location.assign (some browsers block
    // window.open for protocol handlers). Everything else opens in a new tab.
    if (intentUrl.startsWith('mailto:') || intentUrl.startsWith('sms:')) {
      window.location.assign(intentUrl)
    } else {
      window.open(intentUrl, '_blank', 'noopener,noreferrer')
    }
    onClose()
  }

  const handleCopyTracked = async () => {
    trackEvent('share_initiated', { platform: 'copy_link', type: state?.type })
    await handleCopy()
  }

  const order = isTouchDevice() ? [...DESKTOP_ORDER, ...MOBILE_EXTRA] : DESKTOP_ORDER

  return (
    <Modal isOpen={isOpen} onClose={onClose} title='Share' size='sm'>
      {/* Copy link row */}
      <button
        type='button'
        onClick={handleCopyTracked}
        data-testid='share-copy-link'
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          width: '100%',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          marginBottom: 'var(--space-4)',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent-fill)',
            color: 'white',
            flexShrink: 0,
          }}
        >
          <Copy size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 'var(--font-medium)',
              fontSize: 'var(--text-sm)',
              marginBottom: 2,
            }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </div>
          <div
            style={{
              fontSize: 'var(--text-xs2)',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {state?.url}
          </div>
        </div>
      </button>

      {/* Platform grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-2)',
        }}
      >
        {order.map(key => {
          const target = SHARE_TARGETS[key]
          if (!target) return null
          const Icon = ICON_MAP[target.icon]
          return (
            <button
              key={key}
              type='button'
              onClick={() => handlePlatform(key)}
              data-testid={`share-target-${key}`}
              aria-label={`Share to ${target.label}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-1-5)',
                padding: 'var(--space-2)',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: target.color,
                  color: 'white',
                  flexShrink: 0,
                }}
              >
                {Icon ? <Icon size={20} /> : null}
              </div>
              <span
                style={{
                  fontSize: 'var(--text-xs2)',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}
              >
                {target.label}
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
