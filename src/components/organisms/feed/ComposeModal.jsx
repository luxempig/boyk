/**
 * @component ComposeModal
 * @level Organism
 * @interactions Creates posts with text, multi-image upload, link preview,
 *   boycott embed. Live preview + drag-and-drop + bottom-sheet boycott picker.
 *   Mobile-style header (Cancel / New post / Post), author + audience strip,
 *   labeled pill toolbar with Attach boycott as the featured action, and
 *   localStorage draft auto-save.
 */
import { motion } from 'framer-motion'
import {
  AtSign,
  ChevronDown,
  Globe,
  Image as ImageIcon,
  Link as LinkIcon,
  Megaphone,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useApp } from '../../../context/AppContext'
import { useAuth } from '../../../context/AuthContext'
import { useCreatePost, useLinkPreview } from '../../../hooks/useFeedQueries'
import { uploadMultiplePostMedia } from '../../../lib/s3'
import Avatar from '../../atoms/Avatar'
import { Modal } from '../../molecules/Modal'
import BoycottEmbed from './BoycottEmbed'
import ComposeAudiencePicker from './ComposeAudiencePicker'
import ComposeBoycottPicker from './ComposeBoycottPicker'
import ComposeMentionAutocomplete from './ComposeMentionAutocomplete'
import ComposePreview from './ComposePreview'
import LinkPreview from './LinkPreview'

const AUDIENCE_LABELS = {
  everyone: 'Everyone',
  followers: 'Followers',
  just_me: 'Just me',
}

const MAX_CHARS = 300
const MAX_IMAGES = 4
const DRAFT_KEY = 'compose_draft_v1'

function isValidUrl(str) {
  try {
    const url = new URL(str)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
function saveDraft(draft) {
  try {
    if (!draft || (!draft.content && !draft.linkUrl && !draft.boycottId)) {
      localStorage.removeItem(DRAFT_KEY)
      return
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // private mode / blocked
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // ignore
  }
}

// Circular SVG counter — ring fills as user types; flips to danger near the limit.
function CharCounterRing({ used, max }) {
  const pct = Math.min(1, used / max)
  const remaining = max - used
  const nearLimit = remaining <= 20
  const over = remaining < 0
  const size = 24
  const stroke = 2.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct)
  const color = over ? 'var(--danger)' : nearLimit ? '#f59e0b' : 'var(--accent)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          stroke='var(--border)'
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap='round'
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.15s ease, stroke 0.15s ease' }}
        />
      </svg>
      {nearLimit && (
        <span
          style={{
            fontSize: 'var(--text-xs2)',
            fontVariantNumeric: 'tabular-nums',
            color: over ? 'var(--danger)' : '#f59e0b',
            fontWeight: 'var(--font-semibold)',
          }}
        >
          {remaining}
        </span>
      )}
    </div>
  )
}

// Pill button used in the new toolbar. `featured` styles it as the primary
// (orange) action — Attach boycott uses this since boycott is Boyk's main
// primitive and should never feel like an afterthought.
function ToolPill({ icon: Icon, label, onClick, active, featured, disabled, soon }) {
  const styles = featured
    ? {
        background: 'var(--accent-subtle, rgba(249,115,22,0.1))',
        border: '1px solid var(--accent)',
        color: 'var(--accent)',
        fontWeight: 'var(--font-bold)',
      }
    : active
      ? {
          background: 'var(--accent-subtle, rgba(249,115,22,0.1))',
          border: '1px solid var(--accent)',
          color: 'var(--accent)',
          fontWeight: 'var(--font-semibold)',
        }
      : {
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          fontWeight: 'var(--font-medium)',
        }
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      title={soon ? 'Coming soon' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        padding: 'var(--space-1-5) var(--space-3)',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...styles,
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

export default function ComposeModal({ onClose }) {
  const { user } = useAuth()
  const { myBoycotts, followedBoycotts, publicBoycotts } = useApp()
  const createPost = useCreatePost()
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaPreviewsRef = useRef([])

  // Restore any saved draft once on mount via lazy state initialisers
  const [content, setContent] = useState(() => loadDraft()?.content || '')
  const [postType, setPostType] = useState('text')
  const [selectedBoycott, setSelectedBoycott] = useState(null)
  const [mediaFiles, setMediaFiles] = useState([])
  const [mediaPreviews, setMediaPreviews] = useState([])
  const [linkUrl, setLinkUrl] = useState(() => loadDraft()?.linkUrl || '')
  const debouncedLinkUrlRef = useRef('')
  const [debouncedLinkUrl, setDebouncedLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(() => !!loadDraft()?.linkUrl)
  const [showBoycottPicker, setShowBoycottPicker] = useState(false)
  const [showAudiencePicker, setShowAudiencePicker] = useState(false)
  const [audience, setAudience] = useState('everyone')
  // Map of canonical mention name → { id, name }, populated as user picks from autocomplete
  const [mentions, setMentions] = useState({})
  // Active @ trigger info: { token, start } where token is the @-prefixed substring being typed
  const [mentionTrigger, setMentionTrigger] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('edit')
  const [dragging, setDragging] = useState(false)

  // Auto-save draft as the user types. We only persist text content + link URL —
  // boycott/media re-attach in one click and aren't worth the restore complexity.
  useEffect(() => {
    saveDraft({ content: content.trim(), linkUrl: linkUrl.trim() })
  }, [content, linkUrl])

  // Debounce link URL for preview fetching (500ms)
  useEffect(() => {
    const trimmed = linkUrl.trim()
    const valid = trimmed && isValidUrl(trimmed) ? trimmed : ''
    if (valid === debouncedLinkUrlRef.current) return
    const timer = setTimeout(() => {
      debouncedLinkUrlRef.current = valid
      setDebouncedLinkUrl(valid)
    }, 500)
    return () => clearTimeout(timer)
  }, [linkUrl])

  const linkPreview = useLinkPreview(debouncedLinkUrl)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    mediaPreviewsRef.current = mediaPreviews
  }, [mediaPreviews])

  useEffect(() => {
    return () => {
      mediaPreviewsRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  const addFiles = useCallback(
    incoming => {
      const files = Array.from(incoming || [])
      if (!files.length) return

      const remaining = MAX_IMAGES - mediaFiles.length
      if (remaining <= 0) {
        setError(`Maximum ${MAX_IMAGES} images allowed`)
        return
      }

      const validFiles = []
      for (const file of files.slice(0, remaining)) {
        if (!file.type.startsWith('image/')) {
          setError('Only images are supported')
          return
        }
        if (file.size > 5 * 1024 * 1024) {
          setError('Each image must be under 5MB')
          return
        }
        validFiles.push(file)
      }

      if (files.length > remaining) {
        setError(`Only ${remaining} more image${remaining === 1 ? '' : 's'} can be added`)
      } else {
        setError(null)
      }

      const newPreviews = validFiles.map(f => URL.createObjectURL(f))
      setMediaFiles(prev => [...prev, ...validFiles])
      setMediaPreviews(prev => [...prev, ...newPreviews])
    },
    [mediaFiles.length]
  )

  const handleMediaSelect = useCallback(
    e => {
      addFiles(e.target.files)
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [addFiles]
  )

  const handleRemoveMedia = useCallback(
    index => {
      URL.revokeObjectURL(mediaPreviews[index])
      setMediaFiles(prev => prev.filter((_, i) => i !== index))
      setMediaPreviews(prev => prev.filter((_, i) => i !== index))
    },
    [mediaPreviews]
  )

  const handleSelectBoycott = useCallback(boycott => {
    setSelectedBoycott(boycott)
    setPostType('boycott_share')
    setShowBoycottPicker(false)
  }, [])

  const handleRemoveBoycott = useCallback(() => {
    setSelectedBoycott(null)
    setPostType('text')
  }, [])

  // @-mention trigger: detect an @-prefixed token at the cursor with no
  // whitespace between the @ and the cursor. Show the autocomplete when found.
  const detectMentionTrigger = useCallback((text, cursorPos) => {
    if (cursorPos == null) {
      setMentionTrigger(null)
      return
    }
    const before = text.slice(0, cursorPos)
    const match = /(^|\s)(@\S{0,40})$/.exec(before)
    if (!match) {
      setMentionTrigger(null)
      return
    }
    const token = match[2]
    const start = before.length - token.length
    setMentionTrigger({ token, start })
  }, [])

  const pickMention = useCallback(
    company => {
      if (!mentionTrigger) return
      const { start, token } = mentionTrigger
      const safeName = company.name.replace(/\s+/g, ' ').trim()
      const replacement = '@' + safeName + ' '
      const before = content.slice(0, start)
      const after = content.slice(start + token.length)
      const next = (before + replacement + after).slice(0, MAX_CHARS)
      setContent(next)
      setMentions(prev => ({ ...prev, [safeName]: { id: company.id, name: safeName } }))
      setMentionTrigger(null)
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        const pos = (before + replacement).length
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    },
    [content, mentionTrigger]
  )

  const handleDragOver = e => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault()
      if (!dragging) setDragging(true)
    }
  }
  const handleDragLeave = e => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragging(false)
  }
  const handleDrop = e => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }

  const handleSubmit = async () => {
    if (createPost.isPending || uploading) return
    if (!content.trim() && !selectedBoycott && mediaFiles.length === 0) return

    setError(null)

    try {
      let mediaUrls = null

      if (mediaFiles.length > 0) {
        setUploading(true)
        mediaUrls = await uploadMultiplePostMedia(mediaFiles)
        setUploading(false)
      }

      // Only send mentions whose @name still appears in the final content.
      // Plain substring match — \b regex breaks on names ending in punctuation
      // (e.g. "Apple Inc.").
      const usedMentions = Object.values(mentions).filter(m => content.includes('@' + m.name))

      await createPost.mutateAsync({
        content: content.trim() || null,
        postType,
        boycottId: selectedBoycott?.id || null,
        mediaUrl: null,
        mediaType: null,
        mediaUrls,
        linkUrl: linkUrl.trim() || null,
        audience,
        companyMentions: usedMentions.length ? usedMentions : null,
        _boycottData: selectedBoycott
          ? {
              id: selectedBoycott.id,
              name: selectedBoycott.name,
              description: selectedBoycott.description,
              company_count: selectedBoycott.boycott_companies?.length || 0,
              tracker_count: selectedBoycott.tracker_count || 0,
            }
          : null,
      })

      clearDraft()
      onClose()
    } catch (err) {
      setUploading(false)
      setError(err.message || 'Failed to create post')
    }
  }

  const charsUsed = content.length
  const charsLeft = MAX_CHARS - charsUsed
  const canPost =
    (content.trim().length > 0 || selectedBoycott || mediaFiles.length > 0) && charsLeft >= 0
  const isSubmitting = createPost.isPending || uploading

  const previewGridStyle =
    mediaPreviews.length === 1
      ? { display: 'block' }
      : {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-1)',
        }

  // Prefer username over email so the compose greeting reads naturally.
  // Fall back to email-local-part only if neither display_name nor username
  // is set on the user_metadata (legacy accounts).
  const authorUsername = user?.user_metadata?.username
  const authorName =
    user?.user_metadata?.display_name || authorUsername || user?.email?.split('@')[0] || 'You'
  const authorAvatar = user?.user_metadata?.avatar_url
  const authorForPreview = useMemo(
    () =>
      user
        ? {
            display_name: user.user_metadata?.display_name || authorUsername || null,
            username: authorUsername,
            avatar_url: user.user_metadata?.avatar_url,
          }
        : null,
    [user, authorUsername]
  )

  return (
    <Modal isOpen={true} onClose={onClose} showClose={false} maxWidth={520}>
      <div style={{ position: 'relative' }}>
        {/* Mobile-style header: Cancel · New post · Post */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            margin: '-20px -20px 0',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border)',
            gap: 'var(--space-3)',
          }}
        >
          <button
            type='button'
            onClick={onClose}
            style={{
              justifySelf: 'start',
              background: 'none',
              border: 'none',
              padding: 'var(--space-1-5) var(--space-2)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-medium)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <div
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-bold)',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
            }}
          >
            New post
          </div>
          <div
            style={{
              justifySelf: 'end',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <CharCounterRing used={charsUsed} max={MAX_CHARS} />
            <motion.button
              onClick={handleSubmit}
              disabled={!canPost || isSubmitting}
              whileTap={{ scale: 0.95 }}
              aria-label='Publish post'
              data-testid='compose-submit-button'
              style={{
                padding: 'var(--space-1-5) var(--space-3)',
                background: canPost ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                color: canPost ? '#fff' : 'var(--text-muted)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--font-bold)',
                cursor: canPost ? 'pointer' : 'default',
                opacity: isSubmitting ? 0.7 : 1,
                fontFamily: 'inherit',
              }}
            >
              {uploading ? 'Uploading…' : isSubmitting ? 'Posting…' : 'Post'}
            </motion.button>
          </div>
        </div>

        {/* Author + audience strip */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
            margin: '0 -20px',
            padding: 'var(--space-3) var(--space-4) 0',
          }}
        >
          <Avatar src={authorAvatar} name={authorName} size='md' />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--font-semibold)',
                color: 'var(--text-primary)',
              }}
            >
              {authorName}
            </div>
            <button
              type='button'
              onClick={() => setShowAudiencePicker(true)}
              aria-haspopup='dialog'
              style={{
                marginTop: 'var(--space-1)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-full)',
                background: 'var(--accent-subtle, rgba(249,115,22,0.08))',
                border: '1px solid var(--border-accent, var(--accent))',
                color: 'var(--accent)',
                fontSize: 'var(--text-2xs)',
                fontWeight: 'var(--font-bold)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <Globe size={11} />
              {AUDIENCE_LABELS[audience]}
              <ChevronDown size={10} />
            </button>
          </div>
          {/* Edit / Preview tiny segmented toggle (kept from previous design) */}
          <div
            role='tablist'
            style={{
              display: 'inline-flex',
              background: 'var(--bg-sunken, var(--bg-card-hover))',
              borderRadius: 'var(--radius-full)',
              padding: 2,
              alignSelf: 'center',
              flexShrink: 0,
            }}
          >
            {['edit', 'preview'].map(m => (
              <button
                key={m}
                role='tab'
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                style={{
                  padding: 'var(--space-0-5) var(--space-2)',
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  background: mode === m ? 'var(--bg-elevated)' : 'transparent',
                  color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--font-semibold)',
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                  boxShadow: mode === m ? 'var(--shadow-sm)' : 'none',
                  fontFamily: 'inherit',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {mode === 'preview' ? (
          <div style={{ padding: 'var(--space-4) 0' }}>
            <ComposePreview
              author={authorForPreview}
              content={content}
              mediaPreviews={mediaPreviews}
              boycott={selectedBoycott}
              linkPreview={linkPreview.data}
            />
          </div>
        ) : (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              margin: '0 -20px',
              padding: 'var(--space-3) var(--space-4) var(--space-4)',
              position: 'relative',
              background: dragging ? 'var(--accent-subtle, rgba(249,115,22,0.08))' : 'transparent',
              transition: 'background 0.15s ease',
            }}
          >
            {dragging && (
              <div
                style={{
                  position: 'absolute',
                  inset: 6,
                  border: '2px dashed var(--accent)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--accent)',
                  fontWeight: 'var(--font-semibold)',
                  fontSize: 'var(--text-sm)',
                  pointerEvents: 'none',
                  background: 'rgba(255,255,255,0.6)',
                }}
              >
                Drop images to attach
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => {
                const next = e.target.value.slice(0, MAX_CHARS)
                setContent(next)
                detectMentionTrigger(next, e.target.selectionStart)
              }}
              onKeyDown={e => {
                if (e.key === 'Escape' && mentionTrigger) {
                  e.preventDefault()
                  setMentionTrigger(null)
                }
              }}
              onSelect={e => detectMentionTrigger(content, e.target.selectionStart)}
              placeholder={`What's on your mind, ${authorName.split(' ')[0]}?`}
              aria-label='Post content'
              data-testid='compose-textarea'
              rows={4}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: 'var(--text)',
                fontSize: 'var(--text-lg)',
                lineHeight: 'var(--leading-normal)',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            {mentionTrigger && (
              <ComposeMentionAutocomplete
                query={mentionTrigger.token.slice(1)}
                anchor={{ top: 8, left: 8, width: 320 }}
                onPick={pickMention}
                onClose={() => setMentionTrigger(null)}
              />
            )}

            {/* Tip: only when textarea is empty (avoids redundant noise) */}
            {!content && !mediaPreviews.length && !selectedBoycott && (
              <div
                style={{
                  fontSize: 'var(--text-xs2)',
                  color: 'var(--text-muted)',
                  marginTop: 'var(--space-2)',
                  lineHeight: 1.5,
                }}
              >
                Tip: tap{' '}
                <span
                  style={{
                    background: 'var(--accent-subtle, rgba(249,115,22,0.1))',
                    color: 'var(--accent)',
                    padding: '1px 5px',
                    borderRadius: 4,
                    fontWeight: 'var(--font-semibold)',
                  }}
                >
                  Attach boycott
                </span>{' '}
                below to share a boycott alongside this post.
              </div>
            )}

            {mediaPreviews.length > 0 && (
              <div
                style={{
                  marginTop: 'var(--space-3)',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  ...previewGridStyle,
                }}
              >
                {mediaPreviews.map((preview, i) => (
                  <div key={preview} style={{ position: 'relative' }}>
                    <img
                      src={preview}
                      alt={`Upload preview ${i + 1}`}
                      style={{
                        width: '100%',
                        height: mediaPreviews.length === 1 ? 'auto' : '140px',
                        maxHeight: '200px',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                    <button
                      onClick={() => handleRemoveMedia(i)}
                      aria-label='Remove image'
                      style={{
                        position: 'absolute',
                        top: 'var(--space-1-5)',
                        right: 'var(--space-1-5)',
                        width: 24,
                        height: 24,
                        borderRadius: 'var(--radius-full)',
                        background: 'rgba(0,0,0,0.6)',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedBoycott && (
              <div style={{ position: 'relative', marginTop: 'var(--space-3)' }}>
                <BoycottEmbed boycott={selectedBoycott} />
                <button
                  onClick={handleRemoveBoycott}
                  aria-label='Remove boycott'
                  style={{
                    position: 'absolute',
                    top: 'var(--space-4)',
                    right: 'var(--space-2)',
                    width: 24,
                    height: 24,
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(0,0,0,0.6)',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {showLinkInput && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <input
                  type='url'
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  placeholder='https://...'
                  aria-label='Link URL'
                  style={{
                    width: '100%',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text)',
                    fontSize: 'var(--text-base)',
                    outline: 'none',
                  }}
                />
                {linkPreview.isLoading && debouncedLinkUrl && (
                  <div
                    style={{
                      marginTop: 'var(--space-1-5)',
                      fontSize: 'var(--text-xs2)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Fetching preview…
                  </div>
                )}
                {linkPreview.data && linkPreview.data.title && (
                  <LinkPreview preview={linkPreview.data} />
                )}
              </div>
            )}

            {error && (
              <p
                style={{
                  color: 'var(--danger)',
                  fontSize: 'var(--text-sm)',
                  marginTop: 'var(--space-2)',
                }}
              >
                {error}
              </p>
            )}
          </div>
        )}

        {/* Toolbar — Boycott as the featured pill, scrollable on narrow widths */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
            margin: '0 -20px -20px',
            padding: 'var(--space-2-5) var(--space-4)',
            borderTop: '1px solid var(--border)',
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          <ToolPill
            icon={Megaphone}
            label={selectedBoycott ? `Boycott · ${selectedBoycott.name}` : 'Attach boycott'}
            featured
            onClick={() => setShowBoycottPicker(true)}
          />

          <label style={{ display: 'inline-block', flexShrink: 0 }}>
            <ToolPill
              icon={ImageIcon}
              label={
                mediaFiles.length > 0 ? `Photos · ${mediaFiles.length}/${MAX_IMAGES}` : 'Photos'
              }
              active={mediaFiles.length > 0}
              disabled={mediaFiles.length >= MAX_IMAGES}
              onClick={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*'
              multiple
              onChange={handleMediaSelect}
              disabled={mediaFiles.length >= MAX_IMAGES}
              style={{ display: 'none' }}
            />
          </label>

          <ToolPill
            icon={LinkIcon}
            label='Link'
            active={showLinkInput || !!debouncedLinkUrl}
            onClick={() => setShowLinkInput(v => !v)}
          />

          <ToolPill icon={AtSign} label='Tag company' soon disabled />
        </div>

        <ComposeBoycottPicker
          open={showBoycottPicker}
          onClose={() => setShowBoycottPicker(false)}
          onSelect={handleSelectBoycott}
          myBoycotts={myBoycotts}
          followedBoycotts={followedBoycotts}
          allBoycotts={publicBoycotts}
        />

        <ComposeAudiencePicker
          open={showAudiencePicker}
          value={audience}
          onSelect={setAudience}
          onClose={() => setShowAudiencePicker(false)}
        />
      </div>
    </Modal>
  )
}
