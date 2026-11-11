import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../../../context/AuthContext'
import { useMessages, useSendMessage } from '../../../hooks/useMessages'
import Avatar from '../../atoms/Avatar'

function formatMessageTime(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function autoResize(textarea) {
  if (!textarea) return
  textarea.style.height = 'auto'
  const maxHeight = 96 // ~4 lines
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
}

function groupByDate(messages) {
  const groups = []
  let currentDate = null
  let currentGroup = null

  messages.forEach(msg => {
    const d = new Date(msg.created_at)
    const dateStr = d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
    if (dateStr !== currentDate) {
      currentDate = dateStr
      currentGroup = { date: dateStr, messages: [] }
      groups.push(currentGroup)
    }
    currentGroup.messages.push(msg)
  })

  return groups
}

export default function ChatView({ conversation }) {
  const { user } = useAuth()
  const { data: messages, isLoading } = useMessages(conversation.conversation_id)
  const sendMessage = useSendMessage(conversation.conversation_id)
  const [text, setText] = useState('')
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async e => {
    e.preventDefault()
    const content = text.trim()
    if (!content || sendMessage.isPending) return
    setText('')
    try {
      await sendMessage.mutateAsync(content)
    } catch (err) {
      setText(content)
      console.error('Failed to send message:', err)
    }
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const groups = groupByDate(messages || [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(12px)',
          flexShrink: 0,
        }}
      >
        <Link
          to={`/user/${conversation.other_user_id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2-5)',
            textDecoration: 'none',
          }}
        >
          <Avatar
            src={conversation.other_profile_picture_url}
            name={conversation.other_display_name || conversation.other_username}
            size='md'
          />
          <div>
            <div
              style={{
                fontWeight: 'var(--font-semibold)',
                fontSize: 'var(--text-base)',
                color: 'var(--text-primary)',
              }}
            >
              {conversation.other_display_name || `@${conversation.other_username}`}
            </div>
            {conversation.other_display_name && (
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                @{conversation.other_username}
              </div>
            )}
          </div>
        </Link>
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        {isLoading && (
          <div
            style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-8)' }}
          >
            Loading...
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <div
            style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-8)' }}
          >
            No messages yet. Say hello!
          </div>
        )}

        {groups.map(group => (
          <div key={group.date}>
            <div
              style={{
                textAlign: 'center',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: 'var(--space-3) 0',
                letterSpacing: '0.5px',
              }}
            >
              {group.date}
            </div>
            {group.messages.map(msg => {
              const isOwn = msg.sender_id === user?.id

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    justifyContent: isOwn ? 'flex-end' : 'flex-start',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  <div style={{ maxWidth: '75%' }}>
                    <div
                      style={{
                        padding: 'var(--space-2-5) var(--space-3-5)',
                        borderRadius: isOwn
                          ? 'var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)'
                          : 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
                        background: isOwn ? 'var(--accent)' : 'var(--bg-elevated)',
                        color: isOwn ? '#fff' : 'var(--text-primary)',
                        fontSize: 'var(--text-base)',
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs2)',
                        color: 'var(--text-muted)',
                        marginTop: '2px',
                        textAlign: isOwn ? 'right' : 'left',
                        paddingInline: 'var(--space-1)',
                      }}
                    >
                      {formatMessageTime(msg.created_at)}
                      {isOwn && msg.read_at && (
                        <span style={{ marginLeft: 'var(--space-1)' }}>Read</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--border)',
          background: 'var(--glass-bg)',
          flexShrink: 0,
          paddingBottom: 'calc(80px + var(--space-3) + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => {
            setText(e.target.value)
            autoResize(e.target)
          }}
          onKeyDown={handleKeyDown}
          placeholder='Message...'
          rows={1}
          style={{
            flex: 1,
            padding: 'var(--space-2-5) var(--space-3)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-base)',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            overflow: 'hidden',
          }}
        />
        <button
          type='submit'
          disabled={!text.trim() || sendMessage.isPending}
          style={{
            padding: 'var(--space-2-5) var(--space-4)',
            background: 'var(--gradient-accent)',
            border: 'none',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-on-accent)',
            fontWeight: 'var(--font-semibold)',
            fontSize: 'var(--text-sm)',
            cursor: !text.trim() || sendMessage.isPending ? 'not-allowed' : 'pointer',
            opacity: !text.trim() || sendMessage.isPending ? 0.5 : 1,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}
