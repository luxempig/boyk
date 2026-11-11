import { useState } from 'react'

import { supabaseUrl as SUPABASE_URL } from '../lib/supabase'

const SOURCES = [
  { value: 'reddit', label: 'Reddit' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'friend', label: 'Friend referral' },
  { value: 'other', label: 'Other' },
]

function getInitialState() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('event') === 'signing_complete') {
    window.history.replaceState({}, '', '/demo')
    return 'completed'
  }
  return 'intro'
}

export default function DemoLanding() {
  const [state, setState] = useState(getInitialState) // intro | signing | completed | error
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/docusign-create-envelope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim(),
          source: source || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      // Redirect to DocuSign embedded signing
      setState('signing')
      window.location.href = data.signingUrl
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Logo / Title */}
        <div style={styles.header}>
          <h1 style={styles.logo}>BOYK</h1>
          <p style={styles.tagline}>Corporate Intelligence & Boycott Tracking</p>
        </div>

        {state === 'intro' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Try Boyk Demo</h2>
            <p style={styles.cardDesc}>
              Boyk is currently in private beta. To access the demo, please sign a short
              non-disclosure agreement. After signing, you&apos;ll receive an email with everything
              you need to get started.
            </p>

            <div style={styles.steps}>
              <Step num='1' text='Enter your info below' />
              <Step num='2' text='Sign the NDA via DocuSign' />
              <Step num='3' text='Check your email for login access' />
            </div>

            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.field}>
                <label htmlFor='name' style={styles.label}>
                  Full Name
                </label>
                <input
                  id='name'
                  type='text'
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder='Jane Doe'
                  style={styles.input}
                />
              </div>

              <div style={styles.field}>
                <label htmlFor='email' style={styles.label}>
                  Email
                </label>
                <input
                  id='email'
                  type='email'
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder='jane@example.com'
                  style={styles.input}
                />
              </div>

              <div style={styles.field}>
                <label htmlFor='source' style={styles.label}>
                  How did you hear about us?
                </label>
                <select
                  id='source'
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  style={styles.input}
                >
                  <option value=''>Select...</option>
                  {SOURCES.map(s => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {error && <p style={styles.error}>{error}</p>}

              <button type='submit' disabled={loading} style={styles.button}>
                {loading ? 'Preparing NDA...' : 'Sign NDA & Get Access'}
              </button>

              <p style={styles.finePrint}>
                By signing, you agree to keep all app features and data confidential during the beta
                period. The NDA is a standard mutual non-disclosure agreement.
              </p>
            </form>
          </div>
        )}

        {state === 'signing' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Redirecting to DocuSign...</h2>
            <p style={styles.cardDesc}>
              You&apos;re being redirected to sign the NDA. If nothing happens,{' '}
              <button
                onClick={() => setState('intro')}
                style={{ ...styles.link, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                go back and try again
              </button>
              .
            </p>
            <div style={styles.spinner} />
          </div>
        )}

        {state === 'completed' && (
          <div style={styles.card}>
            <div style={styles.checkmark}>&#10003;</div>
            <h2 style={styles.cardTitle}>NDA Signed Successfully!</h2>
            <p style={styles.cardDesc}>
              Your account is being set up now. You&apos;ll receive an email shortly at the address
              you provided with:
            </p>
            <ul style={styles.emailList}>
              <li>A one-click sign-in link to the app</li>
              <li>Your login credentials (email, username, password)</li>
              <li>A personal Google Sheet for sharing feedback</li>
            </ul>
            <p style={styles.cardDescSmall}>
              The email will arrive within a few minutes from{' '}
              <strong style={{ color: 'var(--text-primary)' }}>daniel@boyk.org</strong>. Check your
              spam folder if you don&apos;t see it.
            </p>
            <div style={styles.divider} />
            <p style={styles.cardDescSmall}>
              Once you receive the email, you can access the demo at{' '}
              <a href='https://boyk.org' style={styles.link}>
                boyk.org
              </a>
              . Your access is permanent — no time limit.
            </p>
          </div>
        )}

        {state === 'error' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Something went wrong</h2>
            <p style={styles.cardDesc}>{error}</p>
            <button onClick={() => setState('intro')} style={styles.button}>
              Try Again
            </button>
          </div>
        )}

        <footer style={styles.footer}>
          <p>&copy; {new Date().getFullYear()} Boyk. All rights reserved.</p>
        </footer>
      </div>
    </div>
  )
}

function Step({ num, text }) {
  return (
    <div style={styles.step}>
      <span style={styles.stepNum}>{num}</span>
      <span style={styles.stepText}>{text}</span>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100dvh',
    background: 'var(--bg-dark)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-6)',
    fontFamily: 'var(--font-body)',
  },
  container: {
    maxWidth: '480px',
    width: '100%',
  },
  header: {
    textAlign: 'center',
    marginBottom: 'var(--space-8)',
  },
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: '48px',
    fontWeight: 'var(--font-bold)',
    color: 'var(--accent)',
    margin: 0,
    letterSpacing: '4px',
  },
  tagline: {
    fontSize: 'var(--text-md)',
    color: 'var(--text-muted)',
    margin: 'var(--space-1) 0 0',
    letterSpacing: '1px',
  },
  card: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-xl)',
    border: '1px solid var(--border)',
    padding: 'var(--space-8)',
    marginBottom: 'var(--space-6)',
  },
  cardTitle: {
    fontFamily: 'var(--font-heading)',
    fontSize: 'var(--text-3xl)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-primary)',
    margin: '0 0 var(--space-3)',
  },
  cardDesc: {
    fontSize: 'var(--text-md)',
    color: 'var(--text-secondary)',
    lineHeight: 'var(--leading-relaxed)',
    margin: '0 0 var(--space-6)',
  },
  cardDescSmall: {
    fontSize: 'var(--text-base)',
    color: 'var(--text-muted)',
    lineHeight: 'var(--leading-relaxed)',
    margin: '0 0 var(--space-4)',
  },
  emailList: {
    color: 'var(--text-primary)',
    fontSize: 'var(--text-md)',
    lineHeight: 2,
    paddingLeft: 'var(--space-5)',
    margin: '0 0 var(--space-5)',
  },
  divider: {
    height: '1px',
    background: 'var(--border)',
    margin: 'var(--space-5) 0',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    marginBottom: '28px',
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  stepNum: {
    width: '28px',
    height: '28px',
    borderRadius: 'var(--radius-full)',
    background: 'var(--accent-subtle)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--font-semibold)',
    flexShrink: 0,
  },
  stepText: {
    fontSize: 'var(--text-md)',
    color: 'var(--text-primary)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1-5)',
  },
  label: {
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-secondary)',
  },
  input: {
    padding: 'var(--space-2-5) var(--space-3-5)',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-md)',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  button: {
    display: 'block',
    width: '100%',
    padding: 'var(--space-3-5)',
    borderRadius: 'var(--radius-lg)',
    border: 'none',
    background: 'var(--gradient-accent)',
    color: 'var(--text-on-accent)',
    fontSize: '15px',
    fontWeight: 'var(--font-semibold)',
    cursor: 'pointer',
    textAlign: 'center',
    textDecoration: 'none',
    transition: 'opacity 0.2s',
  },
  error: {
    color: 'var(--danger-strong)',
    fontSize: 'var(--text-base)',
    margin: 0,
    padding: 'var(--space-2) var(--space-3)',
    background: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 'var(--radius-md)',
  },
  finePrint: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-faint)',
    lineHeight: 'var(--leading-normal)',
    margin: 0,
    textAlign: 'center',
  },
  link: {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-0-5)',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid var(--border)',
    borderTopColor: 'var(--accent)',
    borderRadius: 'var(--radius-full)',
    animation: 'spin 0.8s linear infinite',
    margin: 'var(--space-6) auto 0',
  },
  checkmark: {
    width: '48px',
    height: '48px',
    borderRadius: 'var(--radius-full)',
    background: 'rgba(52, 211, 153, 0.15)',
    color: 'var(--success)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: 'var(--font-bold)',
    marginBottom: 'var(--space-4)',
  },
  footer: {
    textAlign: 'center',
    color: 'var(--text-faint)',
    fontSize: 'var(--text-sm)',
  },
}
