/**
 * @component BoycottComments
 * @level Organism
 * @interactions Displays and submits comments on a boycott
 */
import { ImageIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../../../context/AuthContext'
import {
  useAddBoycottComment,
  useBoycottComments,
  useDeleteBoycottComment,
} from '../../../hooks/useBoycottComments'
import { COMMENT_MEDIA_MAX_BYTES, uploadCommentMedia } from '../../../lib/s3'
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

// Visual style for a comment based on its optional label.
// 'alternative' is the surviving suggest-edit path. 'correction' is
// no longer offered in the composer but legacy rows still render.
function commentBodyStyle(label) {
  const base = {
    fontSize: 'var(--text-sm)',
    lineHeight: 'var(--leading-relaxed)',
    marginTop: 'var(--space-0-5)',
    wordBreak: 'break-word',
  }
  if (label === 'alternative') {
    return { ...base, color: 'var(--success)' }
  }
  return { ...base, color: 'var(--text-secondary)' }
}

const LABEL_OPTIONS = [
  { key: null, label: 'Comment' },
  { key: 'alternative', label: 'Suggest edit' },
]

const MAX_MB = Math.round(COMMENT_MEDIA_MAX_BYTES / (1024 * 1024))

export default function BoycottComments({ boycottId }) {
  const { user } = useAuth()
  const { data: comments = [], isLoading } = useBoycottComments(boycottId)
  const addComment = useAddBoycottComment(boycottId)
  const deleteComment = useDeleteBoycottComment(boycottId)
  const [content, setContent] = useState('')
  const [label, setLabel] = useState(null)
  const [mediaFile, setMediaFile] = useState(null)
  const [mediaPreview, setMediaPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  // Revoke blob URL on unmount or replacement so we don't leak object URLs.
  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    }
  }, [mediaPreview])

  const handleFileSelect = e => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again after removing it
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Only images are allowed.')
      return
    }
    if (file.size > COMMENT_MEDIA_MAX_BYTES) {
      setError(`Image is too large (max ${MAX_MB} MB).`)
      return
    }
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setMediaFile(file)
    setMediaPreview(URL.createObjectURL(file))
    setError(null)
  }

  const handleRemoveMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setMediaFile(null)
    setMediaPreview(null)
    setError(null)
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (addComment.isPending || uploading) return
    if (!content.trim() && !mediaFile) return

    setError(null)
    try {
      let mediaUrl = null
      let mediaType = null
      if (mediaFile) {
        setUploading(true)
        const uploaded = await uploadCommentMedia(mediaFile)
        mediaUrl = uploaded.url
        mediaType = uploaded.type
      }
      await addComment.mutateAsync({
        content: content.trim(),
        label,
        mediaUrl,
        mediaType,
      })
      setContent('')
      setLabel(null)
      handleRemoveMedia()
    } catch (err) {
      console.error('Failed to add comment:', err)
      setError(err.message || 'Failed to post comment.')
    } finally {
      setUploading(false)
    }
  }

  const canSubmit = (content.trim() || mediaFile) && !addComment.isPending && !uploading

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        paddingTop: 'var(--space-3)',
        marginTop: 'var(--space-3)',
      }}
    >
      <p
        style={{
          fontSize: 'var(--text-xs2)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          marginBottom: 'var(--space-2-5)',
        }}
      >
        Comments {comments.length > 0 && `(${comments.length})`}
      </p>

      {/* Comment list */}
      {isLoading ? (
        <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading...</span>
        </div>
      ) : comments.length === 0 ? (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-3)',
          }}
        >
          No comments yet. Be the first to share your thoughts.
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2-5)',
            marginBottom: 'var(--space-3)',
          }}
        >
          {comments.map(comment => (
            <div key={comment.id} style={{ display: 'flex', gap: 'var(--space-2-5)' }}>
              <Link to={`/user/${comment.user_id}`} onClick={e => e.stopPropagation()}>
                <Avatar
                  src={comment.profile_picture_url}
                  name={comment.display_name || comment.username}
                  size='sm'
                />
              </Link>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--space-1-5)',
                  }}
                >
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
                  {user?.id === comment.user_id && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        deleteComment.mutate(comment.id)
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-xs)',
                        padding: 0,
                        marginLeft: 'auto',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                {comment.label && (
                  <span
                    style={{
                      display: 'inline-block',
                      marginTop: 'var(--space-1)',
                      padding: '1px var(--space-1-5)',
                      fontSize: 'var(--text-2xs)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--success)',
                      border: '1px solid var(--success)',
                    }}
                  >
                    {comment.label === 'alternative' ? 'Suggested edit' : comment.label}
                  </span>
                )}
                {comment.content && (
                  <p style={commentBodyStyle(comment.label)}>{comment.content}</p>
                )}
                {comment.media_url && (
                  <a
                    href={comment.media_url}
                    target='_blank'
                    rel='noopener noreferrer'
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'inline-block',
                      marginTop: 'var(--space-1-5)',
                      maxWidth: '100%',
                    }}
                  >
                    <img
                      src={comment.media_url}
                      alt=''
                      loading='lazy'
                      style={{
                        maxHeight: '240px',
                        maxWidth: '100%',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        display: 'block',
                      }}
                    />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comment input */}
      {user ? (
        <form
          onSubmit={handleSubmit}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key !== 'Enter') e.stopPropagation()
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
        >
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-1-5)',
              flexWrap: 'wrap',
            }}
          >
            {LABEL_OPTIONS.map(opt => {
              const active = label === opt.key
              return (
                <button
                  key={opt.label}
                  type='button'
                  onClick={() => setLabel(opt.key)}
                  style={{
                    padding: '4px var(--space-2-5)',
                    fontSize: 'var(--text-xs2)',
                    borderRadius: 'var(--radius-full)',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          {mediaPreview && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'flex-start',
                gap: 'var(--space-1-5)',
                position: 'relative',
                width: 'fit-content',
              }}
            >
              <img
                src={mediaPreview}
                alt='Selected attachment'
                style={{
                  maxHeight: '88px',
                  maxWidth: '160px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  display: 'block',
                }}
              />
              <button
                type='button'
                onClick={handleRemoveMedia}
                aria-label='Remove image'
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: 'rgba(0, 0, 0, 0.65)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                color: mediaFile ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              aria-label='Attach image'
            >
              <ImageIcon size={16} />
              <input
                type='file'
                accept='image/*'
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </label>
            <input
              type='text'
              value={content}
              onChange={e => setContent(e.target.value.slice(0, 1000))}
              onKeyDown={e => {
                e.stopPropagation()
              }}
              placeholder='Add a comment...'
              style={{
                flex: 1,
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
              }}
            />
            <button
              type='submit'
              disabled={!canSubmit}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: canSubmit ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: canSubmit ? '#fff' : 'var(--text-muted)',
                fontSize: 'var(--text-sm)',
                cursor: canSubmit ? 'pointer' : 'default',
                whiteSpace: 'nowrap',
              }}
            >
              {uploading ? 'Uploading...' : addComment.isPending ? '...' : 'Post'}
            </button>
          </div>

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 'var(--text-xs2)', margin: 0 }}>
              {error}
            </p>
          )}
        </form>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          <Link to='/login' style={{ color: 'var(--accent)' }}>
            Sign in
          </Link>{' '}
          to comment.
        </p>
      )}
    </div>
  )
}
