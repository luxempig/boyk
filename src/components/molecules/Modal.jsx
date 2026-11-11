import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo } from 'react'

import { useFocusTrap } from '../../hooks/useFocusTrap'
import { modalBackdrop, modalContent } from '../../lib/animations'

/**
 * @component Modal
 * @level Molecule
 *
 * @description Overlay modal with backdrop, close button, escape key handling,
 * focus trap, and Framer Motion enter/exit animations. Composes Card
 * (elevated) + Button (icon/close).
 *
 * @interactions
 * - Escape key: Calls `onClose`
 * - Click backdrop (outside modal card): Calls `onClose`
 * - Click close button (X): Calls `onClose`
 * - Tab / Shift+Tab: focus is trapped inside the modal; on close, focus
 *   returns to whatever element was focused before opening
 * - Scroll: Modal content scrolls internally, body scroll is locked
 *
 * @props
 * - isOpen: boolean — Controls visibility
 * - onClose: () => void — Close handler
 * - title: string — Header text (optional)
 * - children: ReactNode — Modal body content
 * - footer: ReactNode — Optional footer slot
 * - maxWidth: number — Max width in px (default: 480)
 * - size: 'sm'|'md'|'lg' — Preset widths (400/480/600px), overridden by maxWidth
 * - showClose: boolean — Show X close button (default: true)
 * - className: string
 */

const SIZE_MAP = { sm: 400, md: 420, lg: 600 }

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth,
  size = 'md',
  showClose = true,
  className = '',
}) {
  const resolvedMaxWidth = maxWidth ?? SIZE_MAP[size] ?? SIZE_MAP.md
  const focusTrapRef = useFocusTrap(isOpen)

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return
    const handler = e => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  const backdropStyle = useMemo(
    () => ({
      position: 'fixed',
      inset: 0,
      zIndex: 500,
      background: 'var(--bg-overlay)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-5)',
    }),
    []
  )

  const contentStyle = useMemo(
    () => ({
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(var(--glass-blur-heavy, 30px))',
      WebkitBackdropFilter: 'blur(var(--glass-blur-heavy, 30px))',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-2xl)',
      width: '100%',
      maxWidth: `${resolvedMaxWidth}px`,
      maxHeight: '90vh',
      overflowY: 'auto',
      position: 'relative',
      boxShadow: 'var(--shadow-lg), 0 0 60px var(--accent-subtle)',
      color: 'var(--text)',
    }),
    [resolvedMaxWidth]
  )

  const closeButton = (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClose}
      aria-label='Close'
      className='close-btn'
    >
      &times;
    </motion.button>
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          style={backdropStyle}
          onClick={e => e.target === e.currentTarget && onClose()}
          {...modalBackdrop}
        >
          <motion.div
            ref={focusTrapRef}
            role='dialog'
            aria-modal='true'
            aria-label={title || 'Dialog'}
            className={className}
            style={contentStyle}
            onClick={e => e.stopPropagation()}
            {...modalContent}
          >
            {/* Gradient top bar */}
            <div
              style={{
                height: '3px',
                background: 'linear-gradient(90deg, #ec4899, #f472b6, #34d399)',
                borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0',
              }}
            />

            {/* Header with title */}
            {title && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--space-5) var(--space-6)',
                  borderBottom: '1px solid var(--border)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--glass-bg)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0',
                  zIndex: 10,
                }}
              >
                <h2
                  style={{
                    fontSize: 'var(--text-2xl)',
                    fontWeight: 'var(--font-bold)',
                    fontFamily: "'Sora', sans-serif",
                  }}
                >
                  {title}
                </h2>
                {showClose && closeButton}
              </div>
            )}

            {/* Close button absolute top-right when no title */}
            {!title && showClose && (
              <div
                style={{
                  position: 'absolute',
                  top: 'var(--space-4)',
                  right: 'var(--space-4)',
                  zIndex: 1,
                }}
              >
                {closeButton}
              </div>
            )}

            {/* Body */}
            <div style={{ padding: 'var(--space-6)' }}>{children}</div>

            {/* Footer */}
            {footer && (
              <div
                style={{
                  padding: 'var(--space-3) var(--space-5) var(--space-4)',
                  borderTop: '1px solid var(--border)',
                }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export { Modal }
