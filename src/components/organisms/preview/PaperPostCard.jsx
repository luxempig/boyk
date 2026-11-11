import './paper.css'

import { Link, useNavigate } from 'react-router-dom'

import { mentionMapOf, tokenizeContent } from '../../../lib/renderMentions'
import LinkPreview from '../feed/LinkPreview'

function renderBody(post) {
  const tokens = tokenizeContent(post.content)
  const map = mentionMapOf(post)
  return tokens.map((tok, i) => {
    if (tok.kind === 'text') return tok.value
    const name = tok.value.slice(1)
    const id = map[name.toLowerCase()]
    const baseStyle = {
      color: 'var(--accent)',
      fontWeight: 'var(--font-semibold)',
      textDecoration: 'none',
    }
    if (id) {
      return (
        <Link
          key={`m-${i}`}
          to={'/company/' + id}
          state={{ name }}
          onClick={e => e.stopPropagation()}
          style={baseStyle}
        >
          {tok.value}
        </Link>
      )
    }
    return (
      <span key={`m-${i}`} style={baseStyle}>
        {tok.value}
      </span>
    )
  })
}

function initial(name) {
  return (name || '?').trim()[0]?.toUpperCase() || '?'
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function mediaOf(post) {
  if (post.media && Array.isArray(post.media) && post.media.length > 0) return post.media
  if (post.media_url) return [{ media_url: post.media_url, media_type: post.media_type }]
  return null
}

/**
 * Paper-preview rendering of a post. Click anywhere navigates to /post/:id.
 * Reposts and activity types fall through to /post/:id as well — visual-only.
 */
export default function PaperPostCard({ post, onLike }) {
  const navigate = useNavigate()
  if (!post) return null

  const handleLikeClick = e => {
    // Don't bubble up to the card's navigate-to-detail click handler.
    e.stopPropagation()
    onLike?.({ postId: post.id, liked: post.liked_by_me })
  }

  const author = post.author || {}
  const authorName = author.display_name || author.username || 'Unknown user'
  const authorHandle = author.username
  const boycott = post.boycott
  const media = mediaOf(post)

  const go = () => navigate(`/post/${post.id}`)

  return (
    <div
      className='paper-card'
      onClick={go}
      role='link'
      tabIndex={0}
      data-testid='feed-post-card'
      data-post-id={post.id}
      onKeyDown={e => {
        if (e.key === 'Enter') go()
      }}
    >
      <div className='pc-head'>
        <div className='pc-avatar'>
          {author.profile_picture_url ? (
            <img src={author.profile_picture_url} alt={authorName} />
          ) : (
            initial(authorName)
          )}
        </div>
        <div className='pc-author'>
          <div className='pc-author-line'>
            <span className='pc-author-name'>{authorName}</span>
            {authorHandle && <span className='pc-author-handle'>@{authorHandle}</span>}
            <span className='pc-timestamp'>{timeAgo(post.created_at)}</span>
          </div>
        </div>
      </div>

      {post.content && <div className='pc-body'>{renderBody(post)}</div>}

      {boycott && (
        <div className='pc-target'>
          <span
            className='pc-target-logo'
            style={{
              display: 'grid',
              placeItems: 'center',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            B
          </span>
          <span>
            Boycott: <strong>{boycott.name}</strong>
            {boycott.company_count != null &&
              ` · ${boycott.company_count} ${boycott.company_count === 1 ? 'company' : 'companies'}`}
          </span>
        </div>
      )}

      {media && media.length > 0 && (
        <div
          className='pc-media'
          style={
            media.length === 1
              ? undefined
              : {
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-1)',
                }
          }
        >
          {media.map(m => (
            <img
              key={m.media_url}
              src={m.media_url}
              alt=''
              loading='lazy'
              style={
                media.length === 1
                  ? { width: '100%', display: 'block' }
                  : {
                      width: '100%',
                      height: '140px',
                      objectFit: 'cover',
                      display: 'block',
                    }
              }
            />
          ))}
        </div>
      )}

      {(post.link_preview || post.link_url) && (
        <LinkPreview preview={post.link_preview || { url: post.link_url }} />
      )}

      <div className='pc-meta'>
        <span className='pc-meta-item'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
          </svg>
          {post.reply_count ?? 0}
        </span>
        <button
          type='button'
          className={`pc-meta-item pc-meta-button${post.liked_by_me ? ' active' : ''}`}
          onClick={handleLikeClick}
          aria-label={post.liked_by_me ? 'Unlike post' : 'Like post'}
          aria-pressed={!!post.liked_by_me}
          data-testid='paper-post-like-button'
        >
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill={post.liked_by_me ? 'currentColor' : 'none'}
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' />
          </svg>
          {post.like_count ?? 0}
        </button>
        <span className={`pc-meta-item${post.reposted_by_me ? ' active' : ''}`}>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3' />
          </svg>
          {post.repost_count ?? 0}
        </span>
      </div>
    </div>
  )
}
