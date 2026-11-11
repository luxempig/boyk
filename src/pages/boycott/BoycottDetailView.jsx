import {
  Flag,
  Globe,
  Link as LinkIcon,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Repeat2,
  Share2,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import Avatar from '../../components/atoms/Avatar'
import ReportBoycottModal from '../../components/organisms/boycott/ReportBoycottModal'
import UserClaimedCompaniesPanel from '../../components/organisms/boycott/UserClaimedCompaniesPanel'
import { useToast } from '../../components/organisms/Toast'
import { useAuth } from '../../context/AuthContext'
import {
  useAddBoycottComment,
  useBoycottComments,
  useDeleteBoycottComment,
} from '../../hooks/useBoycottComments'
import { getCompanyLinkId } from '../../services/neo4jGraph'
import SeedConfigModal from './SeedConfigModal'

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function connectionSummary(bc) {
  const parts = []
  if (bc.block_owns) parts.push('subsidiaries')
  if (bc.block_owned_by) parts.push('parents')
  if (bc.block_brands) parts.push('brands')
  if (bc.block_suppliers) parts.push('suppliers')
  if (bc.block_customers) parts.push('customers')
  return parts
}

function StatTile({ label, value, accent }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: 'var(--space-2-5) var(--space-3)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-inset, var(--bg-card-hover))',
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--font-bold)',
          color: accent ? 'var(--accent)' : 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-2xs)',
          color: 'var(--text-muted)',
          marginTop: 'var(--space-1-5)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-eyebrow)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
    </div>
  )
}

function ActionButton({ icon: Icon, label, onClick, primary, disabled, testId, ariaLabel }) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || label}
      data-testid={testId}
      style={{
        flex: label ? 1 : '0 0 auto',
        padding: 'var(--space-2-5) var(--space-3)',
        borderRadius: 'var(--radius-full)',
        background: primary ? 'var(--gradient-accent)' : 'var(--glass-card)',
        border: primary ? 'none' : '1px solid var(--glass-card-border, var(--border))',
        color: primary ? 'var(--text-on-accent, #fff)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-heading)',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--font-bold)',
        letterSpacing: '0.01em',
        boxShadow: primary ? '0 4px 16px var(--accent-glow)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-1-5)',
      }}
    >
      <Icon size={14} />
      {label && <span>{label}</span>}
    </button>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      type='button'
      role='menuitem'
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        padding: 'var(--space-2) var(--space-3)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 'var(--text-sm)',
        color: danger ? 'var(--danger, #dc2626)' : 'var(--text-primary)',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-card-hover)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  )
}

function Tab({ active, label, count, onClick }) {
  return (
    <button
      type='button'
      onClick={onClick}
      style={{
        padding: 'var(--space-3) 0',
        marginRight: 'var(--space-4)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-heading)',
        fontSize: 'var(--text-base)',
        fontWeight: active ? 'var(--font-bold)' : 'var(--font-medium)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        borderBottom: '2px solid transparent',
        borderImage: active ? 'var(--gradient-brand, var(--accent)) 1' : 'none',
        marginBottom: '-1px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
      }}
    >
      {label}
      {typeof count === 'number' && (
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            padding: '1px var(--space-1-5)',
            borderRadius: 'var(--radius-full)',
            background: active ? 'var(--accent-subtle, var(--bg-elevated))' : 'var(--bg-elevated)',
            color: active ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: 'var(--font-bold)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function SeedRow({ entry, canConfigure, onConfigure, proxyCount }) {
  const company = entry.companies
  if (!company) return null
  const connections = connectionSummary(entry)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {company.logo_url ? (
        <img
          src={company.logo_url}
          alt={company.name}
          style={{
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-sm)',
            objectFit: 'contain',
            background: '#fff',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)',
            color: 'var(--text-on-accent, #fff)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 'var(--font-bold)',
            fontSize: 'var(--text-md)',
            flexShrink: 0,
          }}
        >
          {(company.name || '?')[0].toUpperCase()}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)' }}>
          <Link
            to={`/company/${getCompanyLinkId(company)}`}
            state={{ name: company.name }}
            style={{
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--font-bold)',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {company.name}
          </Link>
          <span
            style={{
              fontSize: 'var(--text-2xs)',
              fontWeight: 'var(--font-extrabold)',
              color: 'var(--accent)',
              padding: '1px 5px',
              background: 'var(--accent-subtle, var(--bg-elevated))',
              borderRadius: 'var(--radius-xs)',
              letterSpacing: '0.8px',
            }}
          >
            SEED
          </span>
        </div>
        <div
          style={{
            fontSize: 'var(--text-xs2)',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-0-5)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: connections.length
                ? 'var(--success)'
                : 'var(--border-strong, var(--border))',
              flexShrink: 0,
            }}
          />
          {connections.length ? (
            <>
              <span>Blocks {connections.join(', ')}</span>
              {proxyCount > 0 && (
                <span style={{ color: 'var(--accent)', fontWeight: 'var(--font-semibold)' }}>
                  +{proxyCount} companies
                </span>
              )}
            </>
          ) : (
            <span>Direct only</span>
          )}
        </div>
      </div>

      {canConfigure && (
        <button
          type='button'
          onClick={onConfigure}
          style={{
            padding: 'var(--space-1) var(--space-2-5)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-xs2)',
            fontWeight: 'var(--font-semibold)',
            cursor: 'pointer',
          }}
        >
          Configure
        </button>
      )}
    </div>
  )
}

const COMMENT_TYPES = [
  { id: 'comment', label: 'Comment', icon: MessageCircle, dbValue: null },
  { id: 'edit', label: 'Suggest edit', icon: Repeat2, dbValue: 'alternative' },
]

function CommentsPanel({ boycottId }) {
  const { user } = useAuth()
  const toast = useToast()
  const { data: comments = [], isLoading } = useBoycottComments(boycottId)
  const addComment = useAddBoycottComment(boycottId)
  const deleteComment = useDeleteBoycottComment(boycottId)

  const [type, setType] = useState('comment')
  const [draft, setDraft] = useState('')

  const placeholder = {
    comment: 'Add a comment…',
    edit: 'Suggest an edit to this boycott — missing companies, inaccurate scope, etc.',
  }[type]

  const footerHint = `Posting as @${user?.user_metadata?.username || 'you'}`

  const submit = async e => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || addComment.isPending) return
    const label = COMMENT_TYPES.find(t => t.id === type)?.dbValue ?? null
    try {
      await addComment.mutateAsync({ content, label })
      setDraft('')
      setType('comment')
    } catch (err) {
      toast.error(err.message || 'Failed to post comment')
    }
  }

  return (
    <div style={{ padding: 'var(--space-4) 0' }}>
      {/* Inviting empty state */}
      {comments.length === 0 && !isLoading && (
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background:
              'linear-gradient(135deg, var(--accent-subtle, var(--bg-elevated)), transparent 60%)',
            border: '1px solid var(--border-accent, var(--accent))',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-bold)',
              color: 'var(--text-primary)',
            }}
          >
            Be the first to share your thoughts
          </div>
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              marginTop: 'var(--space-1)',
              lineHeight: 1.5,
            }}
          >
            Suggest a product alternative or correct a company's listing — your contribution is
            reviewed by the community.
          </div>
        </div>
      )}

      {/* Composer */}
      {user && (
        <form
          onSubmit={submit}
          style={{
            background: 'var(--bg-sunken, var(--bg-card-hover))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div
            role='tablist'
            style={{
              display: 'flex',
              padding: 4,
              gap: 2,
              borderBottom: '1px solid var(--border)',
            }}
          >
            {COMMENT_TYPES.map(t => {
              const Icon = t.icon
              const active = t.id === type
              const activeColor = t.id === 'edit' ? 'var(--success)' : 'var(--accent)'
              return (
                <button
                  key={t.id}
                  role='tab'
                  aria-selected={active}
                  type='button'
                  onClick={() => setType(t.id)}
                  style={{
                    flex: 1,
                    padding: 'var(--space-1-5) var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: active ? 'var(--bg-card)' : 'transparent',
                    color: active ? activeColor : 'var(--text-secondary)',
                    fontSize: 'var(--text-xs2)',
                    fontWeight: 'var(--font-semibold)',
                    cursor: 'pointer',
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-1)',
                  }}
                >
                  <Icon size={12} />
                  {t.label}
                </button>
              )
            })}
          </div>
          <div style={{ background: 'var(--bg-card)' }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value.slice(0, 1000))}
              placeholder={placeholder}
              rows={2}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: 'var(--space-2-5)',
                fontSize: 'var(--text-base)',
                color: 'var(--text-primary)',
                resize: 'vertical',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-1-5) var(--space-2-5)',
                borderTop: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                {footerHint}
              </span>
              <button
                type='submit'
                disabled={!draft.trim() || addComment.isPending}
                style={{
                  padding: 'var(--space-1-5) var(--space-3)',
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  background: draft.trim() ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
                  color: draft.trim() ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-bold)',
                  cursor: draft.trim() ? 'pointer' : 'default',
                }}
              >
                {addComment.isPending ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Comments list */}
      {isLoading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {comments.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 'var(--space-2-5)' }}>
              <Avatar src={c.profile_picture_url} name={c.display_name || c.username} size='sm' />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--space-1-5)',
                    marginBottom: 'var(--space-0-5)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--font-bold)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {c.display_name || `@${c.username}`}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                    {timeAgo(c.created_at)}
                  </span>
                  {c.label && (
                    <span
                      style={{
                        fontSize: 'var(--text-2xs)',
                        fontWeight: 'var(--font-bold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        padding: '1px var(--space-1-5)',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--success)',
                        color: 'var(--success)',
                      }}
                    >
                      {c.label === 'alternative' ? 'Suggested edit' : c.label}
                    </span>
                  )}
                  {user?.id === c.user_id && (
                    <button
                      type='button'
                      onClick={() => deleteComment.mutate(c.id)}
                      style={{
                        marginLeft: 'auto',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: 'var(--text-xs2)',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: c.label === 'alternative' ? 'var(--success)' : 'var(--text-primary)',
                    lineHeight: 1.5,
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {c.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BoycottDetailView({
  boycott,
  currentUserId,
  isFollowing,
  onFollowToggle,
  onEdit,
  onDelete,
  onNavigateNetwork,
  onShare,
  proxyCount = 0,
  countSeedProxies,
}) {
  const [tab, setTab] = useState('companies')
  const [configSeed, setConfigSeed] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const menuRef = useRef(null)
  const companies = boycott.boycott_companies || []
  const isOwner = currentUserId && boycott.creator_id === currentUserId
  const creatorHandle = boycott.profiles?.username

  // Close the more-actions menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = e => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const handleCopyLink = async () => {
    setMenuOpen(false)
    const url = `${window.location.origin}/boycott/${boycott.id}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Ignore — clipboard can be denied in some contexts. The full share
      // flow with platform buttons is available via the top-bar Share button.
    }
  }

  const handleDeleteFromMenu = () => {
    setMenuOpen(false)
    onDelete?.()
  }

  return (
    <div
      style={{
        background: 'var(--glass-card, var(--bg-card))',
        backdropFilter: 'blur(var(--glass-blur, 20px))',
        WebkitBackdropFilter: 'blur(var(--glass-blur, 20px))',
        border: '1px solid var(--glass-card-border, var(--border))',
        borderRadius: 'var(--radius-card, 14px)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: 'var(--space-4) var(--space-5) var(--space-3)' }}>
        <div
          className='eyebrow'
          style={{ marginBottom: 'var(--space-2)', color: 'var(--text-muted)' }}
        >
          Expose · Boycott · Resist
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-md)',
              background: 'var(--gradient-accent, var(--accent))',
              color: 'var(--text-on-accent, #fff)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              boxShadow: '0 4px 16px var(--accent-glow)',
            }}
          >
            <Megaphone size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-4xl)',
                fontWeight: 'var(--font-bold)',
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              {boycott.name}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
                marginTop: 'var(--space-1-5)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1-5)',
                flexWrap: 'wrap',
              }}
            >
              {creatorHandle && (
                <>
                  <span>
                    by{' '}
                    <Link
                      to={`/user/${boycott.creator_id}`}
                      style={{
                        color: 'var(--accent)',
                        fontWeight: 'var(--font-semibold)',
                        textDecoration: 'none',
                      }}
                    >
                      @{creatorHandle}
                    </Link>
                  </span>
                  <span>·</span>
                </>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <Globe size={11} />
                Public
              </span>
              {boycott.created_at && (
                <>
                  <span>·</span>
                  <span>Created {timeAgo(boycott.created_at)}</span>
                </>
              )}
            </div>
            {boycott.description && (
              <p
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-secondary)',
                  marginTop: 'var(--space-2)',
                  lineHeight: 1.5,
                }}
              >
                {boycott.description}
              </p>
            )}
          </div>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type='button'
              aria-label='More actions'
              aria-expanded={menuOpen}
              aria-haspopup='menu'
              onClick={() => setMenuOpen(o => !o)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-sm)',
                background: menuOpen ? 'var(--bg-card-hover)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div
                role='menu'
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  minWidth: 180,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  overflow: 'hidden',
                  zIndex: 10,
                }}
              >
                <MenuItem icon={LinkIcon} label='Copy link' onClick={handleCopyLink} />
                {!isOwner && (
                  <MenuItem
                    icon={Flag}
                    label='Report boycott'
                    onClick={() => {
                      setMenuOpen(false)
                      setReportOpen(true)
                    }}
                  />
                )}
                {isOwner && onDelete && (
                  <MenuItem
                    icon={Trash2}
                    label='Delete boycott'
                    onClick={handleDeleteFromMenu}
                    danger
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: 'grid',
          // minmax(0, 1fr): plain 1fr is minmax(auto, 1fr), so the nowrap
          // 'SPEND AVOIDED' label's min-content widens its track unequally.
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 'var(--space-2)',
          padding: '0 var(--space-5) var(--space-3)',
        }}
      >
        <StatTile label='seeds' value={companies.length} />
        <StatTile label='blocked' value={proxyCount || '—'} />
        <StatTile label='followers' value={boycott.tracker_count || 0} accent />
        <StatTile label='spend avoided' value='—' />
      </div>

      {/* Action row */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          padding: '0 var(--space-5) var(--space-3)',
        }}
      >
        {isOwner ? (
          <ActionButton
            icon={Plus}
            label='Edit'
            primary
            onClick={onEdit}
            testId='boycott-detail-edit-button'
          />
        ) : (
          <ActionButton
            icon={isFollowing ? Users : Plus}
            label={isFollowing ? 'Following' : 'Follow'}
            primary
            onClick={onFollowToggle}
            testId='boycott-detail-follow-button'
            ariaLabel={isFollowing ? 'Unfollow boycott' : 'Follow boycott'}
          />
        )}
        <ActionButton icon={Repeat2} label='Network' onClick={onNavigateNetwork} />
        <ActionButton icon={Share2} onClick={onShare} />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          padding: '0 var(--space-5)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Tab
          active={tab === 'companies'}
          label='Companies'
          count={companies.length}
          onClick={() => setTab('companies')}
        />
        <Tab active={tab === 'comments'} label='Comments' onClick={() => setTab('comments')} />
      </div>

      <div style={{ padding: '0 var(--space-5)' }}>
        {tab === 'companies' && (
          <div style={{ paddingBottom: 'var(--space-3)' }}>
            {companies.map(entry => (
              <SeedRow
                key={entry.id}
                entry={entry}
                canConfigure={isOwner}
                onConfigure={() => setConfigSeed(entry)}
                // Same company-id derivation useProxyExpansion uses for its
                // cache keys; returns 0 for unfetched/failed seeds, so the
                // '+N companies' affordance stays hidden for them.
                proxyCount={
                  countSeedProxies?.(boycott.id, entry.companies?.id || entry.company_id) || 0
                }
              />
            ))}
            {isOwner && (
              <button
                type='button'
                onClick={onEdit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-1-5)',
                  width: '100%',
                  padding: 'var(--space-2-5)',
                  marginTop: 'var(--space-3)',
                  border: '1px dashed var(--border-strong, var(--border))',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-semibold)',
                  cursor: 'pointer',
                }}
              >
                <Plus size={14} />
                Add seed company
              </button>
            )}
          </div>
        )}
        {tab === 'comments' && <CommentsPanel boycottId={boycott.id} />}
      </div>

      {/* Quiet delete footer — owners only */}
      {isOwner && onDelete && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--space-3) var(--space-5)',
            borderTop: '1px solid var(--border)',
            fontSize: 'var(--text-xs2)',
            color: 'var(--text-muted)',
          }}
        >
          <span>You own this boycott</span>
          <button
            type='button'
            onClick={onDelete}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-xs2)',
              fontWeight: 'var(--font-medium)',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Delete boycott
          </button>
        </div>
      )}

      {configSeed && (
        <SeedConfigModal
          boycottId={boycott.id}
          seedEntry={configSeed}
          onClose={() => setConfigSeed(null)}
        />
      )}

      {reportOpen && (
        <ReportBoycottModal
          boycottId={boycott.id}
          boycottName={boycott.name}
          onClose={() => setReportOpen(false)}
        />
      )}

      <UserClaimedCompaniesPanel boycottId={boycott.id} canEdit={isOwner} />
    </div>
  )
}
