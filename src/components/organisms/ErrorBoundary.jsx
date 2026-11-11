/**
 * @component ErrorBoundary
 * @level Organism
 * @interactions Catches React render errors, reports to Sentry, and provides retry/refresh/home actions.
 */
import { Component } from 'react'
import { Link } from 'react-router-dom'

import { captureError } from '../../sentry'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
    this.setState({ errorInfo })

    captureError(error, { componentStack: errorInfo?.componentStack })

    console.group('Error Details')
    console.error('Error:', error.message)
    console.error('Stack:', error.stack)
    console.error('Component Stack:', errorInfo?.componentStack)
    console.groupEnd()
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }))
  }

  handleGoHome = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }))
  }

  render() {
    if (this.state.hasError) {
      const { error, retryCount } = this.state
      const canRetry = retryCount < 3

      return (
        <div
          role='alert'
          aria-live='assertive'
          className='container'
          style={{
            paddingTop: '80px',
            textAlign: 'center',
            minHeight: '60vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'var(--danger)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 'var(--space-6)',
              fontSize: 'var(--text-5xl)',
            }}
            aria-hidden='true'
          >
            !
          </div>

          <h1
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '42px',
              letterSpacing: '2px',
              color: 'var(--text-primary)',
              marginBottom: 'var(--space-3)',
            }}
          >
            Something Went Wrong
          </h1>

          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-lg)',
              marginBottom: 'var(--space-6)',
              maxWidth: '450px',
              lineHeight: 'var(--leading-relaxed)',
            }}
          >
            {retryCount >= 3
              ? 'This error keeps happening. Please refresh the page or contact support if the problem persists.'
              : 'An unexpected error occurred. You can try again or go back to the home page.'}
          </p>

          {error && (
            <details
              style={{
                marginBottom: 'var(--space-6)',
                maxWidth: '500px',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-base)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Technical details
              </summary>
              <pre
                style={{
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  padding: 'var(--space-4)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--danger)',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {error.message || 'Unknown error'}
                {error.stack && (
                  <>
                    {'\n\n'}
                    <span style={{ color: 'var(--text-muted)' }}>
                      {error.stack.split('\n').slice(1, 5).join('\n')}
                    </span>
                  </>
                )}
              </pre>
            </details>
          )}

          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {canRetry && (
              <button
                onClick={this.handleRetry}
                aria-label='Try again'
                style={{
                  background: 'var(--gradient-accent)',
                  color: 'var(--text-on-accent)',
                  padding: 'var(--space-3-5) var(--space-8)',
                  border: 'none',
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 'var(--text-lg)',
                  letterSpacing: '2px',
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={e => {
                  e.target.style.transform = 'translateY(-2px)'
                  e.target.style.boxShadow = '0 8px 24px var(--accent-glow)'
                }}
                onMouseLeave={e => {
                  e.target.style.transform = 'translateY(0)'
                  e.target.style.boxShadow = 'none'
                }}
              >
                Try Again
              </button>
            )}

            <button
              onClick={() => window.location.reload()}
              aria-label='Refresh the page'
              style={{
                background: canRetry ? 'transparent' : 'var(--gradient-accent)',
                border: canRetry ? '1px solid var(--border)' : 'none',
                color: canRetry ? 'var(--text-secondary)' : 'white',
                padding: 'var(--space-3-5) var(--space-8)',
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 'var(--text-lg)',
                letterSpacing: '2px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Refresh Page
            </button>

            <Link
              to='/explore'
              onClick={this.handleGoHome}
              aria-label='Go to home page'
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                padding: 'var(--space-3-5) var(--space-8)',
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 'var(--text-lg)',
                letterSpacing: '2px',
                textDecoration: 'none',
                display: 'inline-block',
                transition: 'all 0.2s',
              }}
            >
              Go Home
            </Link>
          </div>

          {retryCount > 0 && (
            <p
              style={{
                marginTop: 'var(--space-6)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
              }}
            >
              Retry attempts: {retryCount}/3
            </p>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
