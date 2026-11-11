/**
 * @component BoycottCommentsPreview
 * @level Organism
 * @interactions Inline 2-comment preview shown on collapsed BoycottCard.
 * Click expands the parent card to reveal the full thread.
 *
 * Note: spec calls for "first two most-liked" comments, but the
 * boycott_comments table currently has no like infrastructure. Falls back
 * to chronological (most recent first) until likes_count is added.
 */
import { Link } from 'react-router-dom'

import { useBoycottComments } from '../../../hooks/useBoycottComments'
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

export default function BoycottCommentsPreview({ boycottId, onMore }) {
  const { data: comments = [], isLoading } = useBoycottComments(boycottId)

  if (isLoading || comments.length === 0) return null

  // TODO: order by likes_count desc once comment likes ship
  const top = comments.slice(0, 2)
  const remaining = comments.length - top.length

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        padding: 'var(--space-3) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2-5)',
      }}
    >
      {top.map(comment => (
        <div key={comment.id} style={{ display: 'flex', gap: 'var(--space-2-5)' }}>
          <Link to={`/user/${comment.user_id}`} onClick={e => e.stopPropagation()}>
            <Avatar
              src={comment.profile_picture_url}
              name={comment.display_name || comment.username}
              size='sm'
            />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-1-5)' }}>
              <Link
                to={`/user/${comment.user_id}`}
                onClick={e => e.stopPropagation()}
                style={{
                  fontWeight: 'var(--font-semibold)',
                  fontSize: 'var(--text-sm)',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                {comment.display_name || `@${comment.username}`}
              </Link>
              <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                {timeAgo(comment.created_at)}
              </span>
            </div>
            <p
              style={{
                fontSize: 'var(--text-sm)',
                lineHeight: 'var(--leading-snug)',
                color: 'var(--text-secondary)',
                marginTop: 'var(--space-0-5)',
                wordBreak: 'break-word',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {comment.content}
            </p>
          </div>
        </div>
      ))}
      {remaining > 0 && (
        <button
          type='button'
          onClick={e => {
            e.stopPropagation()
            onMore?.()
          }}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--accent)',
            fontSize: 'var(--text-xs2)',
            cursor: 'pointer',
            textAlign: 'left',
            alignSelf: 'flex-start',
          }}
        >
          View {remaining} more {remaining === 1 ? 'comment' : 'comments'}
        </button>
      )}
    </div>
  )
}
