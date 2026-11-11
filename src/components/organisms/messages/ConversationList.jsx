import { useConversations } from '../../../hooks/useMessages'
import Avatar from '../../atoms/Avatar'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m`
  if (diffHrs < 24) return `${diffHrs}h`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function ConversationList({ onSelect, activeId }) {
  const { data: conversations, isLoading, isFetching } = useConversations()

  const showSkeleton = isLoading || (isFetching && (!conversations || conversations.length === 0))

  if (showSkeleton) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className='skeleton'
            style={{
              height: '64px',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-2)',
            }}
          />
        ))}
      </div>
    )
  }

  if (!conversations || conversations.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-16) var(--space-5)',
          gap: 'var(--space-3)',
        }}
      >
        <span style={{ fontSize: '2rem' }}>💬</span>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)', textAlign: 'center' }}>
          No messages yet
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
          Visit a user&apos;s profile and tap Message to start a conversation.
        </p>
      </div>
    )
  }

  return (
    <div>
      {conversations.map(conv => {
        const isActive = conv.conversation_id === activeId
        const unread = Number(conv.unread_count) || 0

        return (
          <button
            key={conv.conversation_id}
            onClick={() => onSelect(conv)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              width: '100%',
              padding: 'var(--space-3) var(--space-4)',
              background: isActive ? 'var(--bg-secondary)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Avatar
              src={conv.other_profile_picture_url}
              name={conv.other_display_name || conv.other_username}
              size='lg'
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 'var(--space-0-5)',
                }}
              >
                <span
                  style={{
                    fontWeight: unread > 0 ? 'var(--font-semibold)' : 'var(--font-medium)',
                    fontSize: 'var(--text-base)',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {conv.other_display_name || `@${conv.other_username}`}
                </span>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    flexShrink: 0,
                    marginLeft: 'var(--space-2)',
                  }}
                >
                  {formatTime(conv.last_message_at)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: unread > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
                    fontWeight: unread > 0 ? 'var(--font-medium)' : 'var(--font-normal)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {conv.last_message_content || 'No messages yet'}
                </span>
                {unread > 0 && (
                  <span
                    style={{
                      minWidth: '18px',
                      height: '18px',
                      borderRadius: 'var(--radius-md)',
                      background: '#ef4444',
                      color: '#fff',
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 'var(--font-bold)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 var(--space-1)',
                      flexShrink: 0,
                    }}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
