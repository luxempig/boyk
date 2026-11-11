import Markdown from 'markdown-to-jsx'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'

import privacyContent from '../../docs/legal/privacy-policy.md?raw'
import tosContent from '../../docs/legal/terms-of-service.md?raw'

const docs = {
  '/terms': { content: tosContent, title: 'Terms of Service' },
  '/privacy': { content: privacyContent, title: 'Privacy Policy' },
}

export default function Legal() {
  const { pathname } = useLocation()
  const doc = docs[pathname]

  useEffect(() => {
    if (doc) {
      document.title = `${doc.title} - Boyk`
    }
    return () => {
      document.title = 'Boyk'
    }
  }, [doc])

  if (!doc) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <p>Page not found.</p>
        <Link to='/' style={{ color: 'var(--accent)' }}>
          Go home
        </Link>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg-dark)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Minimal header */}
      <header
        style={{
          padding: 'var(--space-4) var(--space-6)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          to='/'
          style={{
            color: 'var(--text-primary)',
            textDecoration: 'none',
            fontWeight: 'var(--font-bold)',
            fontSize: 'var(--text-lg)',
          }}
        >
          Boyk
        </Link>
        <Link
          to='/'
          style={{
            color: 'var(--text-muted)',
            textDecoration: 'none',
            fontSize: 'var(--text-sm)',
          }}
        >
          Back to app
        </Link>
      </header>

      {/* Legal content */}
      <main
        className='prose prose-invert'
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: 'var(--space-8) var(--space-6)',
          lineHeight: '1.7',
        }}
      >
        <Markdown>{doc.content}</Markdown>
      </main>
    </div>
  )
}
