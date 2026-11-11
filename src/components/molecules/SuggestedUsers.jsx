import { motion } from 'framer-motion'
import { UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import Avatar from '../atoms/Avatar'

/**
 * @component SuggestedUsers
 * @level Molecule
 *
 * Shows a short list of profiles a new user is likely to want to follow.
 * Usernames are passed in by the caller (see the Feed empty state for the
 * current set). Any user already being followed is filtered out. Clicking
 * "Follow" calls AppContext.followUser which optimistically updates state.
 */
export default function SuggestedUsers({ usernames }) {
  const { user } = useAuth()
  const { following, followUser } = useApp()
  // Seed with [] (loaded, empty) when the caller passed no usernames — avoids
  // a pointless skeleton flash and the setState-in-effect anti-pattern.
  const hasUsernames = Boolean(usernames && usernames.length > 0)
  const [profiles, setProfiles] = useState(hasUsernames ? null : [])
  const [error, setError] = useState(null)
  const [pendingFollow, setPendingFollow] = useState(new Set())

  useEffect(() => {
    if (!hasUsernames) return
    let cancelled = false
    const load = async () => {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, username, display_name, profile_picture_url, bio')
        .in('username', usernames)
      if (cancelled) return
      if (err) {
        setError(err.message || 'Failed to load suggestions')
        setProfiles([])
        return
      }
      // Preserve the caller's order so the list feels curated, not random.
      const byUsername = Object.fromEntries((data || []).map(p => [p.username, p]))
      const ordered = usernames.map(u => byUsername[u]).filter(Boolean)
      setProfiles(ordered)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [usernames, hasUsernames])

  if (profiles === null) {
    return (
      <div
        aria-busy='true'
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) 0',
        }}
      >
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className='skeleton'
            style={{ height: 56, borderRadius: 'var(--radius-md)' }}
          />
        ))}
      </div>
    )
  }

  if (error || profiles.length === 0) {
    return null
  }

  const followingIds = new Set((following || []).map(f => f.id))
  const visible = profiles.filter(p => p.id !== user?.id && !followingIds.has(p.id))
  if (visible.length === 0) return null

  return (
    <section
      aria-label='Suggested users to follow'
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) 0',
      }}
    >
      {visible.map(p => {
        const isPending = pendingFollow.has(p.id)
        return (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-2-5) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
            }}
          >
            <Link to={`/user/${p.id}`} style={{ flexShrink: 0 }}>
              <Avatar src={p.profile_picture_url} name={p.display_name || p.username} size='md' />
            </Link>
            <Link
              to={`/user/${p.id}`}
              style={{
                flex: 1,
                minWidth: 0,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div
                style={{
                  fontWeight: 'var(--font-semibold)',
                  fontSize: 'var(--text-md)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.display_name || p.username}
              </div>
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                @{p.username}
              </div>
            </Link>
            <motion.button
              type='button'
              whileTap={{ scale: 0.95 }}
              disabled={isPending}
              onClick={async () => {
                setPendingFollow(prev => new Set(prev).add(p.id))
                try {
                  await followUser(p.id)
                } catch {
                  setPendingFollow(prev => {
                    const next = new Set(prev)
                    next.delete(p.id)
                    return next
                  })
                }
              }}
              className='btn-primary'
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-1-5) var(--space-3)',
                fontSize: 'var(--text-sm)',
                opacity: isPending ? 0.6 : 1,
              }}
            >
              <UserPlus size={14} />
              <span>Follow</span>
            </motion.button>
          </motion.div>
        )
      })}
    </section>
  )
}
