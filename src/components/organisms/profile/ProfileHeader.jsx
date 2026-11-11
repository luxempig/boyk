import { AnimatePresence, motion } from 'framer-motion'
import { Megaphone, PenLine, Settings } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { spring } from '../../../lib/animations'
import Stat from '../../atoms/Stat'

/**
 * @component ProfileHeader
 * @level Organism
 * @interactions Edit profile, create boycott, follow/unfollow, stat clicks
 *
 * Profile header card with avatar, name, bio, and action buttons.
 * Used in both Home (own profile) and Profile (other users) pages.
 */
export default function ProfileHeader({
  profile,
  user,
  isOwnProfile = false,
  isFollowing = false,
  actionLoading = false,
  stats,
  onEditProfile,
  onCreateBoycott,
  onCreatePost,
  onFollowToggle,
  onStatClick,
  messageLink,
  children,
}) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const handleCreateClick = useCallback(() => {
    setCreateMenuOpen(prev => !prev)
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!createMenuOpen) return
    const handleClick = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setCreateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [createMenuOpen])

  const displayName = profile?.display_name
  const username = profile?.username || 'user'
  const bio = profile?.bio
  const profilePictureUrl = profile?.profile_picture_url
  const joinedDate = profile?.created_at

  // Get initials for avatar fallback
  const initials =
    displayName?.charAt(0).toUpperCase() ||
    username?.charAt(0).toUpperCase() ||
    user?.email?.charAt(0).toUpperCase() ||
    'U'

  return (
    <motion.div
      className='card-primary'
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      style={{
        padding: 'var(--space-5)',
        marginBottom: 'var(--space-6)',
      }}
    >
      {/* Profile Info Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          position: 'relative',
        }}
      >
        {isOwnProfile && (
          <Link
            to='/settings'
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              color: 'var(--text-muted)',
              padding: 'var(--space-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              transition: 'all 0.2s ease',
            }}
          >
            <Settings size={20} />
          </Link>
        )}
        {/* Profile Picture with glow effect */}
        <motion.div
          whileHover={{
            boxShadow: '0 0 25px var(--accent-glow), 0 0 50px var(--accent-subtle)',
            scale: 1.02,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          style={{
            width: '60px',
            height: '60px',
            background: profilePictureUrl
              ? `url(${profilePictureUrl}) center/cover`
              : 'var(--gradient-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            fontWeight: 'var(--font-bold)',
            color: 'white',
            borderRadius: '14px',
            overflow: 'hidden',
            flexShrink: 0,
            boxShadow: '0 6px 24px var(--accent-subtle), 0 0 0 1px var(--border)',
          }}
        >
          {!profilePictureUrl && initials}
        </motion.div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Display Name */}
          {displayName && (
            <h1
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 'var(--font-semibold)',
                margin: 0,
                marginBottom: 'var(--space-0-5)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </h1>
          )}

          {/* Username */}
          <span
            style={{
              fontSize: displayName ? 'var(--text-md)' : 'var(--text-2xl)',
              fontWeight: displayName ? 'var(--font-normal)' : 'var(--font-semibold)',
              color: displayName ? 'var(--text-muted)' : 'var(--text-primary)',
            }}
          >
            @{username}
          </span>

          {/* Bio */}
          {bio && (
            <p
              style={{
                fontSize: 'var(--text-base)',
                color: 'var(--text-secondary)',
                marginTop: 'var(--space-2)',
                lineHeight: 1.4,
              }}
            >
              {bio}
            </p>
          )}

          {/* Join date — mono editorial stamp */}
          {joinedDate && (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-eyebrow)',
                marginTop: 'var(--space-1-5)',
              }}
            >
              Joined{' '}
              {new Date(joinedDate).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons - Full width row */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: stats ? '0' : '0' }}>
        {isOwnProfile ? (
          <>
            <motion.button
              className='btn-secondary'
              onClick={onEditProfile}
              aria-label='Edit your profile'
              whileTap={{ scale: 0.95 }}
              style={{
                flex: 1,
                minHeight: 'var(--space-10)',
                padding: 'var(--space-2-5) var(--space-3)',
              }}
            >
              Edit Profile
            </motion.button>
            <div ref={menuRef} style={{ flex: 1, position: 'relative' }}>
              <motion.button
                className='btn-primary'
                onClick={handleCreateClick}
                aria-label='Create a new boycott or post'
                whileTap={{ scale: 0.95 }}
                style={{
                  width: '100%',
                  minHeight: 'var(--space-10)',
                  padding: 'var(--space-2-5) var(--space-3)',
                }}
              >
                + Create
              </motion.button>
              <AnimatePresence>
                {createMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    style={{
                      position: 'absolute',
                      bottom: 'calc(100% + var(--space-2))',
                      right: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-1)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-lg)',
                      padding: 'var(--space-1)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                      minWidth: '150px',
                      zIndex: 10,
                    }}
                  >
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setCreateMenuOpen(false)
                        onCreateBoycott?.()
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2-5)',
                        padding: 'var(--space-2-5) var(--space-3)',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-md)',
                        color: 'var(--text-primary)',
                        width: '100%',
                        textAlign: 'left',
                      }}
                    >
                      <Megaphone size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      Boycott
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setCreateMenuOpen(false)
                        onCreatePost?.()
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2-5)',
                        padding: 'var(--space-2-5) var(--space-3)',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-md)',
                        color: 'var(--text-primary)',
                        width: '100%',
                        textAlign: 'left',
                      }}
                    >
                      <PenLine size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      Post
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <>
            <motion.button
              className={isFollowing ? 'btn-secondary' : 'btn-follow'}
              onClick={onFollowToggle}
              disabled={actionLoading}
              aria-label={isFollowing ? `Unfollow ${username}` : `Follow ${username}`}
              whileTap={{ scale: 0.95 }}
              style={{
                flex: 1,
                minHeight: 'var(--space-10)',
                opacity: actionLoading ? 0.7 : 1,
                cursor: actionLoading ? 'wait' : 'pointer',
              }}
            >
              {actionLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
            </motion.button>
            {messageLink && (
              <Link
                to={messageLink}
                style={{
                  padding: 'var(--space-2-5) var(--space-4)',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 'var(--space-10)',
                }}
              >
                Message
              </Link>
            )}
          </>
        )}
      </div>

      {/* Stats */}
      {stats && <ProfileStats stats={stats} onStatClick={onStatClick} />}

      {children}
    </motion.div>
  )
}

/**
 * Stats row showing follower/following/boycott counts.
 * Renders the DS Stat atom (value over uppercase mono label) per stat.
 */
export function ProfileStats({ stats, onStatClick }) {
  return (
    <motion.div
      initial='initial'
      animate='animate'
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        paddingTop: 'var(--space-5)',
        marginTop: 'var(--space-5)',
        borderTop: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      {stats.map((stat, index) => (
        <motion.div
          key={stat.key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.08, type: 'spring', damping: 20, stiffness: 300 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Stat
            value={stat.value}
            label={stat.label}
            onClick={stat.clickable !== false ? () => onStatClick?.(stat.key) : undefined}
          />
        </motion.div>
      ))}
    </motion.div>
  )
}

/**
 * Skeleton loader for ProfileHeader
 */
export function ProfileHeaderSkeleton() {
  return (
    <div
      className='glass-card'
      style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-6)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <div className='skeleton skeleton-avatar' />
        <div style={{ flex: 1 }}>
          <div
            className='skeleton skeleton-text-lg'
            style={{ width: '120px', marginBottom: 'var(--space-2)' }}
          />
          <div className='skeleton skeleton-text' style={{ width: '80px' }} />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-6)',
          paddingTop: 'var(--space-5)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div className='skeleton skeleton-stat' />
        <div className='skeleton skeleton-stat' />
        <div className='skeleton skeleton-stat' />
        <div className='skeleton skeleton-stat' />
      </div>
    </div>
  )
}
