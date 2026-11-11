/**
 * @component ToastProvider / useToast
 * @level Organism
 * @interactions Context-based toast notification system with success/error/warning/info types and auto-dismiss.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const ToastContext = createContext(null)

// Toast types with their styling
const TOAST_TYPES = {
  success: {
    background: 'var(--success)',
    icon: '✓',
  },
  error: {
    background: 'var(--danger)',
    icon: '✕',
  },
  warning: {
    background: '#f59e0b',
    icon: '⚠',
  },
  info: {
    background: 'var(--accent-fill)',
    icon: 'ℹ',
  },
}

function Toast({ id, message, type = 'info', onRemove }) {
  const [isExiting, setIsExiting] = useState(false)
  const config = TOAST_TYPES[type] || TOAST_TYPES.info

  // Auto-dismiss with pause-on-hover/focus: track the remaining time so the
  // countdown resumes where it left off instead of restarting.
  const timerRef = useRef(null)
  const startedAtRef = useRef(0)
  const remainingRef = useRef(4000)
  const isExitingRef = useRef(false)

  const dismiss = useCallback(() => {
    if (isExitingRef.current) return
    isExitingRef.current = true
    setIsExiting(true)
    setTimeout(() => onRemove(id), 300)
  }, [id, onRemove])

  const pauseTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
  }, [])

  const resumeTimer = useCallback(() => {
    if (timerRef.current || isExitingRef.current) return
    startedAtRef.current = Date.now()
    timerRef.current = setTimeout(dismiss, remainingRef.current)
  }, [dismiss])

  useEffect(() => {
    resumeTimer()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [resumeTimer])

  const handleClose = () => {
    pauseTimer()
    dismiss()
  }

  const urgent = type === 'error' || type === 'warning'

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocus={pauseTimer}
      onBlur={resumeTimer}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3-5) var(--space-4)',
        background: 'var(--bg-card)',
        border: `1px solid ${config.background}`,
        borderLeft: `4px solid ${config.background}`,
        boxShadow: `0 4px 20px rgba(0, 0, 0, 0.4), 0 0 20px ${config.background}33`,
        animation: isExiting ? 'slideOutRight 0.3s ease forwards' : 'slideInRight 0.3s ease',
        maxWidth: '360px',
        width: '100%',
      }}
    >
      <span
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: config.background,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--font-bold)',
          color: 'white',
          flexShrink: 0,
        }}
      >
        {config.icon}
      </span>
      <span style={{ flex: 1, fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>
        {message}
      </span>
      <button
        onClick={handleClose}
        aria-label='Dismiss notification'
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 'var(--space-1)',
          fontSize: 'var(--text-lg)',
          lineHeight: 'var(--leading-none)',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => (e.target.style.color = 'var(--text-primary)')}
        onMouseLeave={e => (e.target.style.color = 'var(--text-muted)')}
      >
        ×
      </button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    return id
  }, [])

  const removeToast = useCallback(id => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Convenience methods
  const toast = useMemo(
    () => ({
      success: message => addToast(message, 'success'),
      error: message => addToast(message, 'error'),
      warning: message => addToast(message, 'warning'),
      info: message => addToast(message, 'info'),
    }),
    [addToast]
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast container */}
      <div
        role='region'
        aria-label='Notifications'
        style={{
          position: 'fixed',
          top: 'var(--space-5)',
          right: 'var(--space-5)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2-5)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2-5)',
          }}
        >
          {toasts.map(t => (
            <Toast key={t.id} {...t} onRemove={removeToast} />
          ))}
        </div>
      </div>
      {/* Toast animations */}
      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOutRight {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
