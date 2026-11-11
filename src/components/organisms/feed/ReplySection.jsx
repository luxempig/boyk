/**
 * @component ReplySection
 * @level Organism
 * @interactions Threaded replies with collapsible threads, nested reply forms, like replies
 */
import { Heart, MessageSquare } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../../../context/AuthContext'
import { useCreateReply, useLikeReply, usePostReplies } from '../../../hooks/useFeedQueries'
import Avatar from '../../atoms/Avatar'
import { useToast } from '../Toast'

function timeAgo(dateStr) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7
    ? `${days}d`
    : new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Build a tree from flat reply list using parent_reply_id
function buildCommentTree(replies) {
  if (!replies?.length) return []
  const map = new Map()
  const roots = []

  for (const r of replies) {
    map.set(r.id, { ...r, children: [] })
  }

  for (const r of replies) {
    const node = map.get(r.id)
    if (r.parent_reply_id && map.has(r.parent_reply_id)) {
      map.get(r.parent_reply_id).children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

// Count all descendants of a comment
function countDescendants(node) {
  if (!node.children?.length) return 0
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}

// Inline reply form (used for both top-level and nested replies)
function ReplyForm({ postId, parentReplyId = null, onClose, autoFocus = false, placeholder }) {
  const { user } = useAuth()
  const toast = useToast()
  const createReply = useCreateReply()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(autoFocus)

  const handleSubmit = async () => {
    if (!user) {
      toast.info('You must be logged in to reply.')
      return
    }
    const content = text.trim()
    if (!content || createReply.isPending) return

    setText('')
    try {
      await createReply.mutateAsync({ postId, content, parentReplyId })
      onClose?.()
    } catch {
      setText(content)
    }
  }

  const handleKeyDown = e => {
    if (e.key === 'Escape') {
      onClose?.()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit()
    }
  }

  return (
    <div
      style={{
        border: focused ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      <textarea
        value={text}
        onChange={e => {
          if (!user) {
            toast.info('You must be logged in to reply.')
            return
          }
          setText(e.target.value.slice(0, 2000))
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'What are your thoughts?'}
        aria-label={parentReplyId ? 'Reply text' : 'Add a comment'}
        data-testid={parentReplyId ? 'nested-reply-textarea' : 'reply-textarea'}
        autoFocus={autoFocus} // eslint-disable-line jsx-a11y/no-autofocus -- intentional: user-initiated reply form
        rows={focused || text ? 3 : 1}
        style={{
          width: '100%',
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--bg-elevated)',
          border: 'none',
          color: 'var(--text)',
          fontSize: 'var(--text-base)',
          lineHeight: 'var(--leading-normal)',
          outline: 'none',
          resize: 'vertical',
          minHeight: focused || text ? '60px' : '32px',
          fontFamily: 'inherit',
          display: 'block',
          boxSizing: 'border-box',
        }}
      />
      {(focused || text) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
            padding: 'var(--space-1-5) var(--space-2)',
            background: 'var(--bg-elevated)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {onClose && (
            <button
              onClick={() => {
                setText('')
                onClose()
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-2xl)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--font-semibold)',
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || createReply.isPending}
            data-testid='reply-submit-button'
            style={{
              background: text.trim() ? 'var(--gradient-accent)' : 'var(--bg-card)',
              border: 'none',
              color: text.trim() ? '#fff' : 'var(--text-muted)',
              cursor: text.trim() ? 'pointer' : 'default',
              padding: 'var(--space-1) var(--space-4)',
              borderRadius: 'var(--radius-2xl)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--font-semibold)',
              opacity: createReply.isPending ? 0.6 : 1,
            }}
          >
            {createReply.isPending ? 'Posting...' : 'Reply'}
          </button>
        </div>
      )}
    </div>
  )
}

// Single threaded comment with recursive children
function Comment({ reply, depth, postId }) {
  const { user } = useAuth()
  const toast = useToast()
  const likeReply = useLikeReply()
  const [collapsed, setCollapsed] = useState(false)
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [lineHovered, setLineHovered] = useState(false)

  const hasChildren = reply.children?.length > 0
  const authorName = reply.author?.display_name || reply.author?.username || 'User'
  const authorUsername = reply.author?.username || 'user'
  const descendantCount = useMemo(() => countDescendants(reply), [reply])

  const toggleCollapse = useCallback(() => setCollapsed(c => !c), [])

  return (
    <div style={{ display: 'flex', marginTop: depth === 0 ? 'var(--space-3)' : 'var(--space-1)' }}>
      {/* Thread line — clickable to collapse */}
      <div
        role='button'
        tabIndex={0}
        aria-label={collapsed ? 'Expand thread' : 'Collapse thread'}
        onClick={toggleCollapse}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggleCollapse()
          }
        }}
        onMouseEnter={() => setLineHovered(true)}
        onMouseLeave={() => setLineHovered(false)}
        style={{
          width: '20px',
          flexShrink: 0,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'center',
          paddingTop: 'var(--space-0-5)',
        }}
      >
        <div
          style={{
            width: '2px',
            height: '100%',
            background: lineHovered ? 'var(--accent)' : 'var(--border)',
            borderRadius: '1px',
            transition: 'background 0.15s',
          }}
        />
      </div>

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 'var(--space-1-5)' }}>
        {collapsed ? (
          /* Collapsed view — single-line summary */
          <button
            onClick={() => setCollapsed(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-0-5) 0',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              fontFamily: 'inherit',
            }}
          >
            <Avatar
              src={reply.author?.profile_picture_url}
              name={reply.author?.display_name || reply.author?.username}
              size='xs'
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontWeight: 'var(--font-semibold)', color: 'var(--accent)' }}>
              {authorName}
            </span>
            <span>· {timeAgo(reply.created_at)}</span>
            {descendantCount > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                ({descendantCount + 1} {descendantCount + 1 === 1 ? 'comment' : 'comments'})
              </span>
            )}
          </button>
        ) : (
          <>
            {/* Comment header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)' }}>
              <Link
                to={`/user/${reply.author_id}`}
                onClick={e => e.stopPropagation()}
                style={{ flexShrink: 0, textDecoration: 'none' }}
              >
                <Avatar
                  src={reply.author?.profile_picture_url}
                  name={reply.author?.display_name || reply.author?.username}
                  size='xs'
                />
              </Link>
              <Link
                to={`/user/${reply.author_id}`}
                onClick={e => e.stopPropagation()}
                style={{
                  fontWeight: 'var(--font-semibold)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                {authorName}
              </Link>
              <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                @{authorUsername}
              </span>
              <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                · {timeAgo(reply.created_at)}
              </span>
            </div>

            {/* Comment body */}
            <p
              style={{
                fontSize: 'var(--text-base)',
                lineHeight: 'var(--leading-normal)',
                margin: 'var(--space-1) 0 0 0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--text)',
              }}
            >
              {reply.content}
            </p>

            {/* Actions bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-0-5)',
                marginTop: 'var(--space-0-5)',
              }}
            >
              {/* Like */}
              <button
                onClick={e => {
                  e.stopPropagation()
                  if (!user) {
                    toast.info('You must be logged in to like.')
                    return
                  }
                  likeReply.mutate({
                    replyId: reply.id,
                    liked: reply.liked_by_me,
                    postId,
                  })
                }}
                aria-label={reply.liked_by_me ? 'Unlike comment' : 'Like comment'}
                aria-pressed={!!reply.liked_by_me}
                data-testid='reply-like-button'
                data-reply-id={reply.id}
                data-like-count={reply.like_count ?? 0}
                style={{
                  background: 'none',
                  border: 'none',
                  color: reply.liked_by_me ? '#ef4444' : 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-xs2)',
                  fontWeight: 'var(--font-semibold)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  fontFamily: 'inherit',
                }}
              >
                <Heart
                  size={12}
                  fill={reply.liked_by_me ? '#ef4444' : 'none'}
                  strokeWidth={reply.liked_by_me ? 0 : 1.5}
                />
                {reply.like_count > 0 && <span>{reply.like_count}</span>}
              </button>
              {/* Reply */}
              <button
                onClick={e => {
                  e.stopPropagation()
                  if (!user) {
                    toast.info('You must be logged in to reply.')
                    return
                  }
                  setShowReplyForm(v => !v)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: showReplyForm ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-xs2)',
                  fontWeight: 'var(--font-semibold)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  fontFamily: 'inherit',
                }}
              >
                <MessageSquare size={12} />
                Reply
              </button>
            </div>

            {/* Inline reply form */}
            {showReplyForm && (
              <div style={{ marginTop: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
                <ReplyForm
                  postId={postId}
                  parentReplyId={reply.id}
                  autoFocus // eslint-disable-line jsx-a11y/no-autofocus -- user clicked Reply
                  placeholder={`Reply to ${authorName}...`}
                  onClose={() => setShowReplyForm(false)}
                />
              </div>
            )}

            {/* Nested children */}
            {hasChildren &&
              reply.children.map(child => (
                <Comment key={child.id} reply={child} depth={depth + 1} postId={postId} />
              ))}
          </>
        )}
      </div>
    </div>
  )
}

export default function ReplySection({ postId }) {
  const { data: replies, isLoading } = usePostReplies(postId, true)

  const tree = useMemo(() => buildCommentTree(replies), [replies])

  return (
    <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
      {/* Top-level reply form */}
      <ReplyForm postId={postId} placeholder='What are your thoughts?' />

      {/* Loading */}
      {isLoading && (
        <div style={{ padding: 'var(--space-4) 0', textAlign: 'center' }}>
          <div className='spinner' style={{ width: '16px', height: '16px' }} />
        </div>
      )}

      {/* Comment thread */}
      {!isLoading && tree.length > 0 && (
        <div>
          {tree.map(reply => (
            <Comment key={reply.id} reply={reply} depth={0} postId={postId} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && tree.length === 0 && (
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            padding: 'var(--space-3) 0 var(--space-1)',
            textAlign: 'center',
          }}
        >
          No comments yet — be the first to reply
        </p>
      )}
    </div>
  )
}
