/**
 * @component ConfirmModal
 * @level Organism
 * @interactions Accessible confirmation dialog with focus trap, keyboard handling, and async confirm action.
 */
import { memo, useCallback, useEffect, useRef } from 'react'

function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  loading = false,
}) {
  const modalRef = useRef(null)
  const confirmButtonRef = useRef(null)
  const cancelButtonRef = useRef(null)

  // Handle escape key
  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Escape' && !loading) {
        onClose()
      }
      // Trap focus within modal
      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll('button:not([disabled])')
        if (focusableElements && focusableElements.length > 0) {
          const firstElement = focusableElements[0]
          const lastElement = focusableElements[focusableElements.length - 1]

          if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault()
            lastElement.focus()
          } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    },
    [onClose, loading]
  )

  // Focus management
  useEffect(() => {
    if (isOpen) {
      // Save previously focused element
      const previouslyFocused = document.activeElement

      // Focus the cancel button when modal opens (safer default)
      cancelButtonRef.current?.focus()

      // Add escape listener
      document.addEventListener('keydown', handleKeyDown)

      // Prevent body scroll
      document.body.style.overflow = 'hidden'

      return () => {
        document.removeEventListener('keydown', handleKeyDown)
        document.body.style.overflow = ''
        // Restore focus
        previouslyFocused?.focus?.()
      }
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const handleConfirm = async () => {
    if (loading) return
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      // Error is handled by parent
      console.error('Confirm action failed:', err)
    }
  }

  const handleOverlayClick = e => {
    if (e.target === e.currentTarget && !loading) {
      onClose()
    }
  }

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby={title ? 'confirm-modal-title' : undefined}
      aria-describedby='confirm-modal-message'
      tabIndex={-1}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'var(--bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: 'var(--space-5)',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={modalRef}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          maxWidth: '400px',
          width: '100%',
          padding: 'var(--space-6)',
          animation: 'slideUp 0.3s ease',
        }}
      >
        {title && (
          <h3
            id='confirm-modal-title'
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--font-semibold)',
              marginBottom: 'var(--space-3)',
              color: danger ? 'var(--danger)' : 'var(--text-primary)',
              fontFamily: "'Inter', sans-serif",
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}
          >
            {danger && (
              <span style={{ marginRight: 'var(--space-2)' }} aria-hidden='true'>
                ⚠
              </span>
            )}
            {title}
          </h3>
        )}
        <p
          id='confirm-modal-message'
          style={{
            fontSize: 'var(--text-md)',
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-6)',
            lineHeight: 'var(--leading-relaxed)',
          }}
        >
          {message}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            ref={cancelButtonRef}
            className='btn-secondary'
            onClick={onClose}
            disabled={loading}
            aria-label={cancelText}
            style={{
              flex: 1,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={handleConfirm}
            disabled={loading}
            aria-label={confirmText}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              opacity: loading ? 0.8 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading && (
              <span
                className='spinner'
                style={{ width: '14px', height: '14px', borderWidth: '2px' }}
                aria-hidden='true'
              />
            )}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(ConfirmModal)
