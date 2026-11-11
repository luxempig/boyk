import { Link } from 'react-router-dom'

import Header from '../components/organisms/Header'

export default function NotFound() {
  return (
    <div className='container'>
      <Header pageLabel='Not Found' />
      <div
        style={{
          paddingTop: 'var(--space-10)',
          textAlign: 'center',
          minHeight: '50vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '120px',
            letterSpacing: '4px',
            color: 'var(--accent)',
            marginBottom: '0',
            lineHeight: 'var(--leading-none)',
          }}
        >
          404
        </h1>
        <h2
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'var(--text-4xl)',
            letterSpacing: '2px',
            marginBottom: 'var(--space-4)',
          }}
        >
          Page Not Found
        </h2>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-md)',
            marginBottom: 'var(--space-8)',
            maxWidth: '300px',
          }}
        >
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to='/explore'
          style={{
            background: 'var(--gradient-accent)',
            color: 'var(--text-on-accent)',
            padding: 'var(--space-3-5) var(--space-8)',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'var(--text-lg)',
            letterSpacing: '2px',
            textDecoration: 'none',
          }}
        >
          Explore
        </Link>
      </div>
    </div>
  )
}
