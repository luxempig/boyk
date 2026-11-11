/**
 * @component UpdatesList
 * @level Organism
 * @interactions Renders the auto-generated boycott_updates feed for boycotts
 *               the current user has adopted. Mirrors PostList's infinite-scroll shape.
 */
import { Megaphone } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import Avatar from '../../atoms/Avatar'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

export default function UpdatesList({
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isError,
  refetch,
}) {
  const sentinelRef = useRef(null)

  useEffect(() => {
    if (!hasNextPage) return
    const node = sentinelRef.current
    if (!node) return
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '300px' }
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading updates...
      </div>
    )
  }

  // Error must render BEFORE the empty state — otherwise a backend failure is
  // indistinguishable from a legitimately empty feed.
  if (isError) {
    return (
      <div style={{ padding: 'var(--space-10) var(--space-5)', textAlign: 'center' }}>
        <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
          Couldn&apos;t load updates
        </h3>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Something went wrong on our end.
        </p>
        <button
          type='button'
          onClick={() => refetch?.()}
          style={{
            padding: 'var(--space-2) var(--space-5)',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  const updates = data?.pages?.flat() || []

  if (updates.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--space-10) var(--space-5)',
          textAlign: 'center',
        }}
      >
        <Megaphone
          size={40}
          strokeWidth={1}
          style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}
        />
        <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
          No updates yet
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          Follow some boycotts and you&apos;ll see changes here as they happen.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {updates.map(u => (
        <article
          key={u.id}
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-5)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Link to={`/user/${u.author_id}`}>
            <Avatar src={u.profile_picture_url} name={u.display_name || u.username} size='sm' />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--space-1-5)',
                flexWrap: 'wrap',
              }}
            >
              <Link
                to={`/user/${u.author_id}`}
                style={{
                  fontWeight: 'var(--font-semibold)',
                  fontSize: 'var(--text-sm)',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                {u.display_name || `@${u.username}`}
              </Link>
              <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                updated{' '}
                <Link
                  to={`/boycott/${u.boycott_id}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}
                >
                  {u.boycott_name}
                </Link>{' '}
                · {timeAgo(u.created_at)}
              </span>
            </div>
            <p
              style={{
                margin: 'var(--space-1) 0 0',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                lineHeight: 'var(--leading-relaxed)',
              }}
            >
              {u.summary}
            </p>
          </div>
        </article>
      ))}

      <div ref={sentinelRef} style={{ height: 1 }} />
      {isFetchingNextPage && (
        <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading...
        </div>
      )}
    </div>
  )
}
