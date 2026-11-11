/**
 * @component Header
 * @level Organism
 * @interactions Top navigation bar with back button, logo, messages link, network link, and profile/login action.
 */
import { ArrowLeft, MessageCircle, User } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { useUnreadCount } from '../../hooks/useMessages'
import { DEMO_MODE } from '../../lib/demo'
import { gradientText } from '../../lib/glassStyles'

export default function Header({ pageLabel }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const messageUnreadCount = useUnreadCount()

  const isRootRoute =
    ['/', '/explore', '/feed', '/check', '/messages', '/login', '/signup'].includes(
      location.pathname
    ) ||
    (location.pathname === '/network' && !location.search)

  return (
    <header className='header' style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {!isRootRoute && (
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/feed'))}
            aria-label='Go back'
            style={{
              background: 'transparent',
              border: 'none',
              padding: 'var(--space-2)',
              marginRight: 'var(--space-2)',
              marginLeft: 'calc(-1 * var(--space-2))',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <Link to='/feed' style={{ textDecoration: 'none' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-4xl)',
              fontWeight: 'var(--font-bold)',
              letterSpacing: '-0.02em',
              ...gradientText,
              filter: 'drop-shadow(0 0 12px var(--accent-glow))',
            }}
          >
            boyk
          </span>
        </Link>
        {pageLabel && (
          <span
            style={{
              marginLeft: 'var(--space-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs2)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-eyebrow)',
              fontWeight: 'var(--font-medium)',
            }}
          >
            / {pageLabel}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {/* Messages */}
        {!DEMO_MODE && (
          <Link
            to='/messages'
            aria-label='Messages'
            style={{
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              position: 'relative',
            }}
            title='Messages'
          >
            <MessageCircle size={20} />
            {messageUnreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  minWidth: '18px',
                  height: '18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--highlight, #ec4899)',
                  color: '#fff',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--font-bold)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 var(--space-1)',
                  border: '2px solid var(--bg-dark)',
                }}
              >
                {messageUnreadCount > 99 ? '99+' : messageUnreadCount}
              </span>
            )}
          </Link>
        )}

        {/* Network Icon */}
        <Link
          to='/network'
          aria-label='Network Visualization'
          style={{
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
          }}
          title='Network Visualization'
        >
          <svg
            width='18'
            height='18'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <circle cx='12' cy='5' r='3' />
            <circle cx='5' cy='19' r='3' />
            <circle cx='19' cy='19' r='3' />
            <line x1='12' y1='8' x2='5' y2='16' />
            <line x1='12' y1='8' x2='19' y2='16' />
          </svg>
        </Link>

        {user ? (
          <Link
            to={`/user/${user.id}`}
            aria-label='Profile'
            style={{
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
            }}
            title='Profile'
          >
            <User size={20} />
          </Link>
        ) : (
          <button
            onClick={() => navigate(DEMO_MODE ? '/about' : '/login')}
            style={{
              background: 'var(--gradient-accent)',
              border: 'none',
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-on-accent)',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-semibold)',
              cursor: 'pointer',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {DEMO_MODE ? 'About' : 'Log In'}
          </button>
        )}
      </div>
    </header>
  )
}
