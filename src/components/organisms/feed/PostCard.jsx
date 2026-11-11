/**
 * @component PostCard
 * @level Organism
 * @interactions Likes, reposts, deletes, navigates to post detail, expands replies
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Heart, MessageCircle, Repeat2, Share2, Trash2 } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../../../context/AuthContext'
import { useShare } from '../../../hooks/useShare'
import { springQuick } from '../../../lib/animations'
import Avatar from '../../atoms/Avatar'
import { ShareMenu } from '../../molecules/ShareMenu'
import { useToast } from '../Toast'
import BoycottEmbed from './BoycottEmbed'
import ImageCarousel from './ImageCarousel'
import LinkPreview from './LinkPreview'
import ReplySection from './ReplySection'

// Render @mentions and #hashtags as styled pills
function renderContent(text) {
  if (!text) return null
  const parts = text.split(/(@[a-zA-Z0-9_]+|#[a-zA-Z0-9_]+)/g)
  return parts.map((part, i) => {
    if (/^@[a-zA-Z0-9_]+$/.test(part)) {
      const username = part.slice(1)
      return (
        <Link
          key={i}
          to={`/explore?q=${username}`}
          onClick={e => e.stopPropagation()}
          style={{
            color: 'var(--accent)',
            textDecoration: 'none',
            fontWeight: 'var(--font-medium)',
            background: 'var(--accent-subtle)',
            padding: '1px 6px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {part}
        </Link>
      )
    }
    if (/^#[a-zA-Z0-9_]+$/.test(part)) {
      return (
        <span
          key={i}
          style={{
            color: 'var(--gold)',
            background: 'rgba(244,114,182,0.1)',
            padding: '1px 6px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {part}
        </span>
      )
    }
    return part
  })
}

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
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Get media array for a post — supports new multi-media and legacy single media_url
function getPostMedia(post) {
  if (post.media && Array.isArray(post.media) && post.media.length > 0) {
    return post.media
  }
  if (post.media_url) {
    return [{ media_url: post.media_url, media_type: post.media_type, sort_order: 0 }]
  }
  return null
}

function PostCard({ post, onLike, onDelete, isDeleting, onRepost, onUnrepost, variant = 'feed' }) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { share, menuState, closeMenu } = useShare()
  const [showReplies, setShowReplies] = useState(variant === 'detail')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const contentRef = useRef(null)

  const isDetail = variant === 'detail'
  const isRepost = post.post_type === 'repost' || post.post_type === 'boycott_repost'

  // For reposts, show original post content
  const displayPost = isRepost && post.original_post ? post.original_post : post
  const displayAuthor = displayPost.author || {}
  const displayName = displayAuthor.display_name || displayAuthor.username || 'User'
  const displayUsername = displayAuthor.username || 'user'
  const displayAvatarUrl = displayAuthor.profile_picture_url

  // Repost indicator author (the person who reposted)
  const repostAuthor = isRepost ? post.author || {} : null

  const isOwn = user?.id === post.author_id

  const media = getPostMedia(displayPost)

  // Detect content truncation in feed mode (re-checks on resize)
  useLayoutEffect(() => {
    if (isDetail || !contentRef.current) return
    const el = contentRef.current
    const check = () => setIsTruncated(el.scrollHeight > el.clientHeight)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isDetail, displayPost.content])

  // Auto-dismiss delete confirmation after 3s
  useEffect(() => {
    if (!showDeleteConfirm) return
    const timer = setTimeout(() => setShowDeleteConfirm(false), 3000)
    return () => clearTimeout(timer)
  }, [showDeleteConfirm])

  const handleNavigateToPost = () => {
    sessionStorage.setItem('feed-scroll-y', String(window.scrollY))
    navigate(`/post/${post.id}`)
  }

  const handleLike = e => {
    e.stopPropagation()
    if (!user) {
      toast.info('You must be logged in to like a post.')
      return
    }
    onLike?.({ postId: post.id, liked: post.liked_by_me })
  }

  const handleRepost = e => {
    e.stopPropagation()
    if (!user) {
      toast.info('You must be logged in to repost.')
      return
    }
    if (isOwn) {
      toast.info('You cannot repost your own post.')
      return
    }
    const targetId = post.original_post_id || post.id
    if (post.reposted_by_me) {
      onUnrepost?.({ postId: targetId })
    } else {
      onRepost?.({ postId: targetId })
    }
  }

  const handleDelete = e => {
    e.stopPropagation()
    if (showDeleteConfirm) {
      onDelete?.(post.id)
      setShowDeleteConfirm(false)
    } else {
      setShowDeleteConfirm(true)
    }
  }

  const handleReplyClick = e => {
    e.stopPropagation()
    if (isDetail) {
      setShowReplies(!showReplies)
    } else {
      handleNavigateToPost()
    }
  }

  const handleShare = e => {
    e.stopPropagation()
    share({
      url: `${window.location.origin}/post/${post.id}`,
      type: 'post',
      data: {
        content: displayPost.content,
        author_display_name: displayName,
        author_username: displayUsername,
        boycott_name: displayPost.boycott?.name,
      },
    })
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      data-testid='post-card'
      data-post-id={post.id}
      style={{
        padding: 'var(--space-4)',
        borderBottom: '1px solid var(--border)',
        opacity: isDeleting ? 0.5 : 1,
      }}
    >
      {/* Repost indicator */}
      {isRepost && (
        <Link
          to={`/user/${post.author_id}`}
          onClick={e => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
            fontSize: 'var(--text-xs2)',
            color: 'var(--text-muted)',
            marginBottom: 'var(--space-2)',
            paddingLeft: 'var(--space-1)',
            textDecoration: 'none',
          }}
        >
          <Repeat2 size={13} />
          <span>@{repostAuthor?.username || 'user'} reposted</span>
        </Link>
      )}

      {/* Author row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2-5)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <Link
          to={`/user/${displayPost.author_id || post.author_id}`}
          onClick={e => e.stopPropagation()}
          style={{ flexShrink: 0 }}
        >
          <Avatar
            src={displayAvatarUrl}
            name={displayName}
            size='lg'
            style={{ width: 36, height: 36, border: '2px solid var(--border)' }}
          />
        </Link>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)' }}>
            <Link
              to={`/user/${displayPost.author_id || post.author_id}`}
              onClick={e => e.stopPropagation()}
              style={{
                fontWeight: 'var(--font-semibold)',
                fontSize: 'var(--text-md)',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              {displayName}
            </Link>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              @{displayUsername}
            </span>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>&middot;</span>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              {timeAgo(displayPost.created_at || post.created_at)}
            </span>
          </div>
        </div>

        {/* Delete button (own posts) */}
        {isOwn && (
          <motion.button
            onClick={handleDelete}
            whileTap={{ scale: 0.9 }}
            style={{
              background: showDeleteConfirm ? 'var(--danger)' : 'transparent',
              border: 'none',
              color: showDeleteConfirm ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              padding: showDeleteConfirm ? 'var(--space-1-5) var(--space-2-5)' : 'var(--space-1-5)',
              borderRadius: 'var(--radius-md)',
              minHeight: 'var(--space-8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-1)',
              fontSize: 'var(--text-xs2)',
              fontWeight: showDeleteConfirm ? 'var(--font-semibold)' : 'var(--font-normal)',
            }}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete post'}
          >
            <Trash2 size={14} />
            {showDeleteConfirm && <span>Delete?</span>}
          </motion.button>
        )}
      </div>

      {/* Content */}
      {displayPost.content && (
        <div style={{ position: 'relative' }}>
          <div
            ref={contentRef}
            style={{
              fontSize: 'var(--text-md)',
              lineHeight: 'var(--leading-normal)',
              margin: '0 0 var(--space-0-5) 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(isDetail ? {} : { maxHeight: '150px', overflow: 'hidden' }),
            }}
          >
            {renderContent(displayPost.content)}
          </div>
          {!isDetail && isTruncated && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 'var(--space-12)',
                // Feed rows are transparent on the page background — fade to
                // --bg-dark, not --bg-card, or truncated posts get a gray slab.
                background: 'linear-gradient(transparent, var(--bg-dark))',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                paddingBottom: 'var(--space-0-5)',
              }}
            >
              <button
                onClick={e => {
                  e.stopPropagation()
                  handleNavigateToPost()
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-semibold)',
                  padding: 'var(--space-0-5) var(--space-2)',
                }}
              >
                Show more
              </button>
            </div>
          )}
        </div>
      )}

      {/* Media — carousel for multi-image, single image for legacy */}
      {media && <ImageCarousel media={media} maxHeight={isDetail ? 600 : 400} />}

      {/* Link preview — cached OG data, or fallback to raw link_url */}
      {displayPost.link_preview || post.link_preview ? (
        <LinkPreview preview={displayPost.link_preview || post.link_preview} />
      ) : displayPost.link_url || post.link_url ? (
        <LinkPreview preview={{ url: displayPost.link_url || post.link_url }} />
      ) : null}

      {/* Boycott embed */}
      {(displayPost.boycott || post.boycott) && (
        <BoycottEmbed boycott={displayPost.boycott || post.boycott} />
      )}

      {/* Engagement bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-2)',
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Like */}
        <motion.button
          onClick={handleLike}
          whileTap={{ scale: 0.85 }}
          transition={springQuick}
          aria-label={post.liked_by_me ? 'Unlike post' : 'Like post'}
          aria-pressed={!!post.liked_by_me}
          data-testid='post-like-button'
          data-like-count={post.like_count ?? 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            background: 'none',
            border: 'none',
            color: post.liked_by_me ? 'var(--highlight)' : 'var(--text-muted)',
            cursor: 'pointer',
            padding: 'var(--space-1-5) var(--space-2-5)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            minHeight: 'var(--space-8)',
          }}
        >
          <Heart
            size={16}
            fill={post.liked_by_me ? 'var(--highlight)' : 'none'}
            strokeWidth={post.liked_by_me ? 0 : 1.5}
          />
          {post.like_count > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)' }}>{post.like_count}</span>
          )}
        </motion.button>

        {/* Reply */}
        <motion.button
          onClick={handleReplyClick}
          whileTap={{ scale: 0.85 }}
          transition={springQuick}
          aria-label={showReplies ? 'Hide replies' : 'Show replies'}
          aria-expanded={showReplies}
          data-testid='post-reply-button'
          data-reply-count={post.reply_count ?? 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            background: 'none',
            border: 'none',
            color: showReplies ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            padding: 'var(--space-1-5) var(--space-2-5)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            minHeight: 'var(--space-8)',
          }}
        >
          <MessageCircle size={16} />
          {post.reply_count > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)' }}>{post.reply_count}</span>
          )}
        </motion.button>

        {/* Repost */}
        <motion.button
          onClick={handleRepost}
          whileTap={{ scale: 0.85 }}
          transition={springQuick}
          aria-label={post.reposted_by_me ? 'Undo repost' : 'Repost'}
          aria-pressed={!!post.reposted_by_me}
          data-testid='post-repost-button'
          data-repost-count={post.repost_count ?? 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            background: 'none',
            border: 'none',
            color: post.reposted_by_me ? '#22c55e' : 'var(--text-muted)',
            cursor: 'pointer',
            padding: 'var(--space-1-5) var(--space-2-5)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            minHeight: 'var(--space-8)',
          }}
        >
          <Repeat2 size={16} />
          {post.repost_count > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)' }}>{post.repost_count}</span>
          )}
        </motion.button>

        {/* Share */}
        <motion.button
          onClick={handleShare}
          whileTap={{ scale: 0.85 }}
          transition={springQuick}
          aria-label='Share post'
          data-testid='post-share-button'
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 'var(--space-1-5) var(--space-2-5)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            minHeight: 'var(--space-8)',
            marginLeft: 'auto',
          }}
        >
          <Share2 size={16} />
        </motion.button>
      </div>

      {/* Reply section */}
      {isDetail ? (
        showReplies && <ReplySection postId={post.id} />
      ) : (
        <AnimatePresence>
          {showReplies && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              style={{ overflow: 'hidden' }}
            >
              <ReplySection postId={post.id} />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <ShareMenu state={menuState} onClose={closeMenu} />
    </motion.div>
  )
}

// Memoized: the feed list passes stable props (TanStack mutate fns + structurally
// shared post objects), so a like/repost on one card no longer re-renders all.
export default memo(PostCard)
