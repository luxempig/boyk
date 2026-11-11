import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useToast } from '../components/organisms/Toast'
import { useAuth } from '../context/AuthContext'
import { glassOverlay, gradientText } from '../lib/glassStyles'
import { validateUsername } from '../lib/username'

// Validation helpers
const validateEmail = email => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

const validatePassword = password => {
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter'
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter'
  if (!/[0-9]/.test(password)) return 'Password must contain a number'
  return null
}

export default function Auth({ mode = 'login' }) {
  const { user, signIn, signUp, resetPassword, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const formId = useId()
  const [isLogin, setIsLogin] = useState(mode === 'login')

  useEffect(() => {
    setIsLogin(mode === 'login')
    setError(null)
    setFieldErrors({})
    setMessage(null)
  }, [mode])

  useEffect(() => {
    if (user) {
      navigate('/')
    }
  }, [user, navigate])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  const handleForgotPassword = async e => {
    e.preventDefault()
    if (!validateEmail(email)) {
      setFieldErrors({ email: 'Please enter a valid email address' })
      return
    }
    setLoading(true)
    setError(null)
    try {
      await resetPassword(email)
      setMessage('Password reset link sent! Check your email.')
      toast.success('Reset link sent to your email')
    } catch (err) {
      setError(err.message)
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle()
    } catch (err) {
      toast.error(err.message || 'Failed to sign in with Google')
    }
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setMessage(null)

    // Validate fields
    const errors = {}

    if (isLogin) {
      // Login accepts email or username — just check non-empty
      if (!email.trim()) {
        errors.email = 'Please enter your email or username'
      }
    } else {
      // Signup requires valid email
      if (!validateEmail(email)) {
        errors.email = 'Please enter a valid email address'
      }

      const usernameError = validateUsername(username)
      if (usernameError) errors.username = usernameError

      const passwordError = validatePassword(password)
      if (passwordError) errors.password = passwordError
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setLoading(true)

    try {
      if (isLogin) {
        await signIn(email, password)
        toast.success('Welcome back!')
      } else {
        await signUp(email, password, username)
        setMessage('Check your email to confirm your account')
        toast.success('Account created! Check your email.')
      }
    } catch (err) {
      setError(err.message)
      toast.error(err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='container' style={{ paddingTop: '60px', position: 'relative' }}>
      {/* Atmosphere: indigo glow above, pink resist glow below */}
      <div
        aria-hidden='true'
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(244, 114, 182, 0.14), transparent 55%), radial-gradient(ellipse at 50% 100%, rgba(236, 72, 153, 0.1), transparent 50%)',
        }}
      />
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
        <Link to='/' style={{ textDecoration: 'none' }}>
          <h1
            style={{
              // Inline-block so background-clip:text spans only the glyphs —
              // a block-level h1 stretches the gradient across the full
              // container and the text samples just the middle (pink) stop.
              // Centered by the parent's textAlign.
              display: 'inline-block',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-6xl, 48px)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              ...gradientText,
              filter: 'drop-shadow(0 0 20px var(--accent-glow))',
              marginBottom: 'var(--space-2)',
            }}
          >
            boyk
          </h1>
        </Link>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            letterSpacing: '0.18em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}
        >
          Expose · Boycott · Resist
        </p>
      </div>

      <div
        style={{
          ...glassOverlay,
          padding: 'var(--space-6)',
          maxWidth: '400px',
          margin: '0 auto',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--text-3xl)',
            fontWeight: 'var(--font-bold)',
            letterSpacing: 'var(--tracking-tight)',
            marginBottom: 'var(--space-6)',
            textAlign: 'center',
          }}
        >
          {isLogin ? 'Sign In' : 'Create Account'}
        </h2>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor={`${formId}-username`} className='form-label'>
                Username
              </label>
              <input
                id={`${formId}-username`}
                type='text'
                className='input-field'
                placeholder='Choose a username'
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase())}
                required={!isLogin}
                aria-describedby={`${formId}-username-hint`}
                aria-invalid={!!fieldErrors.username}
                autoComplete='username'
                style={{
                  background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  borderRadius: 'var(--radius-card, 14px)',
                  ...(fieldErrors.username ? { borderColor: 'var(--danger)' } : {}),
                }}
              />
              {fieldErrors.username && (
                <p
                  role='alert'
                  style={{
                    color: 'var(--danger)',
                    fontSize: 'var(--text-sm)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  {fieldErrors.username}
                </p>
              )}
              <p
                id={`${formId}-username-hint`}
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-xs2)',
                  marginTop: 'var(--space-1)',
                }}
              >
                3-20 characters, letters, numbers, underscores only
              </p>
            </div>
          )}

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor={`${formId}-email`} className='form-label'>
              {mode === 'login' ? 'Email or Username' : 'Email'}
            </label>
            <input
              id={`${formId}-email`}
              type={mode === 'login' ? 'text' : 'email'}
              className='input-field'
              placeholder={mode === 'login' ? 'Email or username' : 'Enter your email'}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              aria-invalid={!!fieldErrors.email}
              autoComplete={mode === 'login' ? 'username' : 'email'}
              style={{
                background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderRadius: 'var(--radius-card, 14px)',
                ...(fieldErrors.email ? { borderColor: 'var(--danger)' } : {}),
              }}
            />
            {fieldErrors.email && (
              <p
                role='alert'
                style={{
                  color: 'var(--danger)',
                  fontSize: 'var(--text-sm)',
                  marginTop: 'var(--space-1)',
                }}
              >
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label htmlFor={`${formId}-password`} className='form-label'>
              Password
            </label>
            <input
              id={`${formId}-password`}
              type='password'
              className='input-field'
              placeholder={isLogin ? 'Enter your password' : 'Create a strong password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              aria-describedby={!isLogin ? `${formId}-password-hint` : undefined}
              aria-invalid={!!fieldErrors.password}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              style={{
                background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderRadius: 'var(--radius-card, 14px)',
                ...(fieldErrors.password ? { borderColor: 'var(--danger)' } : {}),
              }}
            />
            {fieldErrors.password && (
              <p
                role='alert'
                style={{
                  color: 'var(--danger)',
                  fontSize: 'var(--text-sm)',
                  marginTop: 'var(--space-1)',
                }}
              >
                {fieldErrors.password}
              </p>
            )}
            {!isLogin && (
              <p
                id={`${formId}-password-hint`}
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-xs2)',
                  marginTop: 'var(--space-1)',
                }}
              >
                8+ characters with uppercase, lowercase, and number
              </p>
            )}
            {isLogin && (
              <button
                type='button'
                onClick={handleForgotPassword}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                  padding: 0,
                  marginTop: 'var(--space-2)',
                }}
              >
                Forgot password?
              </button>
            )}
          </div>

          {error && (
            <div
              role='alert'
              aria-live='polite'
              style={{
                background: 'rgba(251, 113, 133, 0.1)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
                color: 'var(--danger)',
                fontSize: 'var(--text-base)',
              }}
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role='status'
              aria-live='polite'
              style={{
                background: 'rgba(52, 211, 153, 0.1)',
                border: '1px solid var(--success)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
                color: 'var(--success)',
                fontSize: 'var(--text-base)',
              }}
            >
              {message}
            </div>
          )}

          <button
            type='submit'
            disabled={loading}
            style={{
              width: '100%',
              background: 'var(--gradient-accent)',
              border: 'none',
              padding: 'var(--space-4)',
              color: 'var(--text-on-accent, #fff)',
              fontFamily: 'var(--font-heading)',
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--font-bold)',
              letterSpacing: '0.01em',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              borderRadius: 'var(--radius-full)',
              boxShadow: '0 4px 20px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            {loading ? 'Loading...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            margin: 'var(--space-6) 0',
          }}
        >
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-faint, var(--text-muted))',
              fontSize: 'var(--text-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            or
          </span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        </div>

        <button
          type='button'
          onClick={handleGoogleSignIn}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
            background: 'var(--glass-card, rgba(30,30,50,0.35))',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
            borderRadius: 'var(--radius-full)',
            padding: 'var(--space-3)',
            cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
            fontWeight: 'var(--font-semibold)',
            fontSize: 'var(--text-base)',
            color: 'var(--text-secondary)',
          }}
        >
          <svg width='18' height='18' viewBox='0 0 24 24'>
            <path
              d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z'
              fill='#4285F4'
            />
            <path
              d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
              fill='#34A853'
            />
            <path
              d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
              fill='#FBBC05'
            />
            <path
              d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
              fill='#EA4335'
            />
          </svg>
          Continue with Google
        </button>

        <div
          style={{
            marginTop: 'var(--space-6)',
            textAlign: 'center',
            paddingTop: 'var(--space-6)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)' }}>
            {isLogin ? "Don't have an account?" : 'Already have an account?'}
          </p>
          <button
            onClick={() => navigate(isLogin ? '/signup' : '/login')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--font-medium)',
              marginTop: 'var(--space-2)',
            }}
          >
            {isLogin ? 'Create Account' : 'Sign In'}
          </button>
        </div>
        {/* Legal links */}
        <div
          style={{
            marginTop: 'var(--space-6)',
            textAlign: 'center',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          <Link to='/terms' style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>
            Terms
          </Link>
          {' · '}
          <Link to='/privacy' style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>
            Privacy
          </Link>
        </div>
      </div>
    </div>
  )
}
