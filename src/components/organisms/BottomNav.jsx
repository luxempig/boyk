/**
 * @component BottomNav
 * @level Organism
 * @interactions Fixed bottom navigation with Explore/Feed tabs, central Create button with popup menu for boycotts and posts.
 */
import { AnimatePresence, motion } from 'framer-motion'
import {
  Info,
  Megaphone,
  Newspaper,
  PenLine,
  Plus,
  ScanBarcode,
  Search,
  User,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { useFeedUnreadCount } from '../../hooks/useFeedQueries'
import { springQuick } from '../../lib/animations'
import { DEMO_MODE } from '../../lib/demo'

const CreateBoycottModal = lazy(() => import('./boycott/CreateBoycottModal'))
const ComposeModal = lazy(() => import('./feed/ComposeModal'))

const leftItems = [
  { to: '/feed', label: 'Feed', icon: Newspaper },
  { to: '/check', label: 'Check', icon: ScanBarcode },
]

const rightItems = [{ to: '/explore', label: 'Explore', icon: Search }]

export default function BottomNav() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const unreadCount = useFeedUnreadCount()
  const isProfileActive = user && location.pathname === `/user/${user.id}`
  const feedBadge = unreadCount.data || 0
  const [menuOpen, setMenuOpen] = useState(false)
  const [showBoycott, setShowBoycott] = useState(false)
  const [showPost, setShowPost] = useState(false)

  const handleCreate = useCallback(() => {
    if (!user) {
      navigate('/login')
      return
    }
    setMenuOpen(prev => !prev)
  }, [user, navigate])

  // Close the create menu whenever the route changes — dock NavLinks navigate
  // client-side without a popstate event, so the popstate listener below never
  // fires for them and the menu stayed open over the new page. Guarded
  // setState-during-render (React's "storing information from previous
  // renders" pattern) so the menu closes before the new page paints.
  const [lastPathname, setLastPathname] = useState(location.pathname)
  if (lastPathname !== location.pathname) {
    setLastPathname(location.pathname)
    if (menuOpen) setMenuOpen(false)
  }

  // Close menu on navigation, outside tap, or Escape (focus returns to trigger)
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        document.querySelector('[data-testid="bottomnav-create-button"]')?.focus()
      }
    }
    window.addEventListener('popstate', close)
    window.addEventListener('keydown', onKeyDown)
    // Move focus into the menu (ARIA menu pattern); rAF waits for the portal/
    // animation mount so the node exists.
    const raf = requestAnimationFrame(() => {
      document.querySelector('#create-menu [role="menuitem"]')?.focus()
    })
    return () => {
      window.removeEventListener('popstate', close)
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(raf)
    }
  }, [menuOpen])

  return (
    <>
      {/* Backdrop to close menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setMenuOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              zIndex: 99,
            }}
          />
        )}
      </AnimatePresence>

      <nav
        role='navigation'
        aria-label='Main navigation'
        style={{
          position: 'fixed',
          bottom: 'var(--space-4, 16px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 2 * var(--space-5, 20px))',
          maxWidth: '440px',
          borderRadius: 'var(--radius-2xl, 20px)',
          background: 'var(--dock-bg, rgba(18,18,26,0.92))',
          backdropFilter: 'blur(var(--glass-blur, 20px))',
          WebkitBackdropFilter: 'blur(var(--glass-blur, 20px))',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 100,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            padding: 'var(--space-1) var(--space-2)',
          }}
        >
          {/* Left nav items — Feed & Check */}
          {leftItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              style={{ textDecoration: 'none', flex: 1 }}
              aria-label={item.label}
            >
              {({ isActive }) => (
                <NavItem
                  icon={item.icon}
                  label={item.label}
                  isActive={isActive}
                  badge={item.to === '/feed' ? feedBadge : 0}
                />
              )}
            </NavLink>
          ))}

          {/* Center elevated Create button + popup menu */}
          {!DEMO_MODE && (
            <div
              style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative' }}
            >
              <CenterButton
                icon={menuOpen ? X : Plus}
                label='Create'
                onClick={handleCreate}
                menuOpen={menuOpen}
              />
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    id='create-menu'
                    role='menu'
                    aria-label='Create'
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    style={{
                      position: 'absolute',
                      bottom: '70px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                      alignItems: 'center',
                    }}
                  >
                    <CreateMenuButton
                      icon={Megaphone}
                      label='Boycott'
                      onClick={() => {
                        setMenuOpen(false)
                        setShowBoycott(true)
                      }}
                      delay={0.05}
                    />
                    <CreateMenuButton
                      icon={PenLine}
                      label='Post'
                      onClick={() => {
                        setMenuOpen(false)
                        setShowPost(true)
                      }}
                      delay={0}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Right nav items — Explore */}
          {rightItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              style={{ textDecoration: 'none', flex: 1 }}
              aria-label={item.label}
            >
              {({ isActive }) => (
                <NavItem icon={item.icon} label={item.label} isActive={isActive} />
              )}
            </NavLink>
          ))}

          {/* Profile — navigates to current user's profile */}
          <button
            type='button'
            onClick={() => {
              if (DEMO_MODE) navigate('/about')
              else if (user) navigate(`/user/${user.id}`)
              else navigate('/login')
            }}
            style={{
              flex: 1,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
            }}
            aria-label={DEMO_MODE ? 'About' : 'Profile'}
          >
            {DEMO_MODE ? (
              <NavItem icon={Info} label='About' isActive={location.pathname === '/about'} />
            ) : (
              <NavItem icon={User} label='Profile' isActive={isProfileActive} />
            )}
          </button>
        </div>
      </nav>

      {showBoycott && (
        <Suspense fallback={null}>
          <CreateBoycottModal onClose={() => setShowBoycott(false)} />
        </Suspense>
      )}
      {showPost && (
        <Suspense fallback={null}>
          <ComposeModal onClose={() => setShowPost(false)} />
        </Suspense>
      )}
    </>
  )
}

function NavItem({ icon: Icon, label, isActive, badge = 0 }) {
  return (
    <motion.div
      whileTap={{ scale: 0.9 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: 'var(--space-2) var(--space-1)',
        position: 'relative',
      }}
    >
      <motion.div
        animate={{
          scale: isActive ? 1.1 : 1,
          y: isActive ? -2 : 0,
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: isActive ? 'drop-shadow(0 0 6px var(--accent-glow))' : 'none',
          position: 'relative',
        }}
      >
        <Icon
          size={20}
          strokeWidth={isActive ? 2.4 : 2}
          style={{
            color: isActive ? 'var(--accent)' : 'var(--dock-icon)',
            transition: 'color 0.2s ease',
          }}
        />
        {/* Unread badge */}
        <AnimatePresence>
          {badge > 0 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={springQuick}
              style={{
                position: 'absolute',
                top: '-6px',
                right: '-10px',
                minWidth: '16px',
                height: '16px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--highlight, #ec4899)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 var(--space-1)',
                fontSize: 'var(--text-2xs)',
                fontWeight: 'var(--font-bold)',
                color: '#fff',
                lineHeight: 'var(--leading-none)',
              }}
            >
              {badge > 99 ? '99+' : badge}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-2xs)',
          fontWeight: isActive ? 'var(--font-semibold)' : 'var(--font-medium)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: isActive ? 'var(--accent)' : 'var(--dock-icon)',
          transition: 'color 0.2s ease',
        }}
      >
        {label}
      </span>
      {isActive && (
        <motion.div
          layoutId='activeIndicator'
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: '0 0 6px var(--accent-glow)',
            marginTop: 'var(--space-0-5)',
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        />
      )}
    </motion.div>
  )
}

function CenterButton({ icon: Icon, label, onClick, menuOpen = false }) {
  return (
    <motion.div
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      role='button'
      tabIndex={0}
      aria-label={label}
      aria-haspopup='menu'
      aria-expanded={menuOpen}
      aria-controls='create-menu'
      data-testid='bottomnav-create-button'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        marginTop: 'calc(-1 * var(--space-4))',
        cursor: 'pointer',
      }}
    >
      <motion.div
        whileHover={{ scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: 'var(--gradient-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 28px var(--accent-glow)',
        }}
      >
        <motion.div
          animate={{ rotate: Icon === X ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          style={{ display: 'flex' }}
        >
          <Plus size={22} strokeWidth={2.5} style={{ color: 'var(--text-on-accent, #0b0b10)' }} />
        </motion.div>
      </motion.div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-2xs)',
          fontWeight: 'var(--font-semibold)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--dock-icon)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {label}
      </span>
    </motion.div>
  )
}

function CreateMenuButton({ icon: Icon, label, onClick, delay = 0 }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 500, damping: 28 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      role='menuitem'
      aria-label={`Create ${label}`}
      data-testid={`create-menu-${label.toLowerCase()}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2-5)',
        padding: 'var(--space-2-5) var(--space-5)',
        background: 'var(--glass-card, rgba(30,30,50,0.35))',
        border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
        borderRadius: 'var(--radius-full)',
        cursor: 'pointer',
        fontSize: 'var(--text-md)',
        fontWeight: 'var(--font-medium)',
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        minWidth: '140px',
      }}
    >
      <Icon size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      {label}
    </motion.button>
  )
}
