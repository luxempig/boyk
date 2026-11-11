/**
 * @component BoycottCard
 * @level Organism
 * @interactions
 *   - Renders a boycott card with expand/collapse, edit, delete, follow/unfollow actions
 *   - Expanded view shows company list, proxy expansion panel, and network navigation
 *   - Uses BoycottList (sibling), ProxyExpansionPanel (sibling), LazyImage (molecule)
 */
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { springBouncy } from '../../../lib/animations'
import { glassCard } from '../../../lib/glassStyles'
import { getCompanyLinkId } from '../../../services/neo4jGraph'
import LazyImage from '../../atoms/LazyImage'
import BoycottComments from './BoycottComments'
import BoycottCommentsPreview from './BoycottCommentsPreview'
import ProxyExpansionPanel from './ProxyExpansionPanel'

const thumbStyle = {
  width: '18px',
  height: '18px',
  borderRadius: 'var(--radius-xs)',
  flexShrink: 0,
}

function CompanyThumb({ company }) {
  const [failed, setFailed] = useState(false)

  if (!company.logo_url || failed) {
    return (
      <div
        title={company.name}
        style={{
          ...thumbStyle,
          background: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-2xs)',
          fontWeight: 'var(--font-semibold)',
          color: '#fff',
        }}
      >
        {(company.name || '?')[0].toUpperCase()}
      </div>
    )
  }

  return (
    <img
      src={company.logo_url}
      alt={company.name}
      onError={() => setFailed(true)}
      style={{
        ...thumbStyle,
        objectFit: 'contain',
        background: '#fff',
      }}
    />
  )
}

/**
 * Unified BoycottCard component for displaying boycotts
 *
 * @param {Object} props
 * @param {Object} props.boycott - The boycott data
 * @param {'owned'|'followed'|'public'} props.variant - Display variant
 * @param {boolean} props.isExpanded - Whether the card is expanded
 * @param {function} props.onToggleExpand - Callback when expansion is toggled
 * @param {function} props.onEdit - Callback for edit action (owned variant)
 * @param {function} props.onDelete - Callback for delete action (owned variant)
 * @param {function} props.onToggleVisibility - Callback for visibility toggle (owned variant)
 * @param {function} props.onRemoveCompany - Callback to remove a company (owned variant)
 * @param {function} props.onFollowToggle - Callback for follow/unfollow action (public/followed variant)
 * @param {boolean} props.isFollowing - Whether user is following this boycott
 * @param {Object} props.proxyExpansion - Object from useProxyExpansion hook
 * @param {boolean} props.isLoading - Whether proxy data is loading
 * @param {number} props.proxyCount - Total proxy count for this boycott
 * @param {boolean} props.disabled - Disable interactions
 * @param {boolean} props.showCreator - Show creator info (public/followed variant)
 */
export default function BoycottCard({
  boycott,
  variant = 'public',
  isExpanded = false,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleVisibility,
  onRemoveCompany,
  onFollowToggle,
  isFollowing = false,
  proxyExpansion,
  isLoading = false,
  proxyCount = 0,
  disabled = false,
  showCreator = true,
  currentUserId = null,
}) {
  const navigate = useNavigate()
  const companies = boycott.boycott_companies || []
  const companyCount = companies.length
  const companyPreviews = companies.filter(e => e.companies?.name).map(e => e.companies)
  const isOwner = currentUserId && boycott.creator_id === currentUserId

  const handleCardClick = () => {
    onToggleExpand?.()
  }

  const handleViewNetwork = e => {
    e.stopPropagation()
    navigate(`/network?boycott=${boycott.id}`, { state: { boycottId: boycott.id } })
  }

  return (
    <motion.div layout style={{ ...glassCard, borderRadius: 0 }}>
      {/* Inline 2-comment preview (collapsed only) — placed after card header below */}
      {/* Card Header */}
      <motion.div
        className='card-secondary card-clickable'
        onClick={handleCardClick}
        whileHover={{
          y: -4,
          transition: { type: 'spring', damping: 20, stiffness: 300 },
        }}
        whileTap={{ scale: 0.98 }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-4) var(--space-5)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 'var(--font-medium)', fontSize: 'var(--text-lg)' }}>
            {boycott.name}
          </span>
          {boycott.is_public === false && (
            <span
              style={{
                fontSize: 'var(--text-2xs)',
                color: 'var(--text-muted)',
                background: 'var(--bg-elevated)',
                padding: '1px var(--space-1-5)',
                borderRadius: 'var(--radius-sm)',
                marginLeft: 'var(--space-2)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                verticalAlign: 'middle',
              }}
            >
              Blacklist
            </span>
          )}
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-1)',
            }}
          >
            {variant === 'followed' || (variant === 'public' && showCreator) ? (
              <>
                by{' '}
                <Link
                  to={`/user/${boycott.creator_id}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}
                  onClick={e => e.stopPropagation()}
                >
                  @{boycott.profiles?.username || 'unknown'}
                </Link>
                {' \u00B7 '}
              </>
            ) : null}
            {companyCount} {companyCount === 1 ? 'company' : 'companies'}
            {isLoading && <span style={{ color: 'var(--text-muted)' }}> + loading...</span>}
            {!isLoading && proxyCount > 0 && (
              <span
                title='Companies connected through ownership, subsidiaries, or supply chains'
                style={{ color: 'var(--accent)' }}
              >
                {' '}
                + {proxyCount} by proxy
              </span>
            )}
            {boycott.tracker_count > 0 && (
              <span>
                {' \u00B7 '}
                {boycott.tracker_count} {boycott.tracker_count === 1 ? 'follower' : 'followers'}
              </span>
            )}
          </p>
          {!isExpanded && companyPreviews.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                marginTop: 'var(--space-1-5)',
                alignItems: 'center',
              }}
            >
              {companyPreviews.slice(0, 5).map(c => (
                <CompanyThumb key={c.id} company={c} />
              ))}
              {companyPreviews.length > 5 && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  +{companyPreviews.length - 5}
                </span>
              )}
            </div>
          )}
          {!isExpanded && boycott.description && (
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                marginTop: 'var(--space-2)',
                lineHeight: 'var(--leading-snug)',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {boycott.description}
            </p>
          )}
        </div>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}
        >
          {/* Edit button — visible whenever the viewer is the owner */}
          {(variant === 'owned' || isOwner) && onEdit && (
            <motion.button
              onClick={e => {
                e.stopPropagation()
                onEdit?.(e, boycott)
              }}
              aria-label={`Edit ${boycott.name}`}
              whileTap={{ scale: 0.95 }}
              style={{
                minHeight: '44px',
                padding: 'var(--space-3) var(--space-4)',
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs2)',
                cursor: 'pointer',
              }}
            >
              Edit
            </motion.button>
          )}

          {/* Public/followed variant actions — hide Follow on own boycotts */}
          {(variant === 'public' || variant === 'followed') &&
            onFollowToggle &&
            boycott.creator_id !== currentUserId && (
              <button
                className={isFollowing ? 'btn-secondary' : 'btn-follow'}
                onClick={e => {
                  e.stopPropagation()
                  onFollowToggle?.(e, boycott)
                }}
                disabled={disabled}
                aria-label={isFollowing ? 'Unfollow boycott' : 'Follow boycott'}
                aria-pressed={isFollowing}
                data-testid='boycott-follow-button'
                data-boycott-id={boycott.id}
                style={{ whiteSpace: 'nowrap' }}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}

          {/* Expand indicator */}
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{ color: 'var(--text-muted)', display: 'flex' }}
          >
            <ChevronDown size={18} />
          </motion.span>
        </div>
      </motion.div>

      {/* Tweet-style inline preview of top comments when collapsed */}
      {!isExpanded && <BoycottCommentsPreview boycottId={boycott.id} onMore={onToggleExpand} />}

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springBouncy}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderTop: 'none',
              borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: 'var(--space-4)' }}>
              {/* Description */}
              {boycott.description && (
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-base)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  {boycott.description}
                </p>
              )}

              {/* Source Links */}
              {boycott.source_links?.length > 0 && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <p
                    style={{
                      fontFamily: 'Sora, sans-serif',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    Sources / Links
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    {boycott.source_links.map(url => (
                      <a
                        key={url}
                        href={url}
                        target='_blank'
                        rel='noopener noreferrer'
                        onClick={e => e.stopPropagation()}
                        style={{
                          color: 'var(--accent)',
                          fontSize: 'var(--text-sm)',
                          textDecoration: 'none',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {(() => {
                          try {
                            const u = new URL(url)
                            return u.hostname + (u.pathname !== '/' ? u.pathname : '')
                          } catch {
                            return url
                          }
                        })()}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Company List */}
              {companies.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
                  No companies added yet.
                </p>
              ) : (
                <>
                  <p
                    style={{
                      fontFamily: 'Sora, sans-serif',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    Companies
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {companies.map(entry => (
                      <CompanyEntry
                        key={entry.id}
                        entry={entry}
                        boycottId={boycott.id}
                        variant={variant}
                        onRemove={onRemoveCompany}
                        proxyExpansion={proxyExpansion}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Action buttons */}
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-4)',
                  flexWrap: 'wrap',
                }}
              >
                <motion.button
                  onClick={handleViewNetwork}
                  aria-label={`View network for ${boycott.name}`}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    minHeight: '44px',
                    padding: 'var(--space-3) var(--space-4)',
                    background: 'var(--gradient-accent)',
                    border: 'none',
                    color: 'var(--text-on-accent)',
                    fontSize: 'var(--text-sm)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: 'pointer',
                  }}
                >
                  View Network
                </motion.button>

                {(variant === 'owned' || isOwner) && onDelete && (
                  <motion.button
                    onClick={e => {
                      e.stopPropagation()
                      onDelete?.(e, boycott.id)
                    }}
                    aria-label={`Delete ${boycott.name}`}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      minHeight: '44px',
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'transparent',
                      border: '1px solid var(--danger)',
                      color: 'var(--danger)',
                      fontSize: 'var(--text-sm)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      cursor: 'pointer',
                    }}
                  >
                    Delete Boycott
                  </motion.button>
                )}
              </div>

              {/* Comments */}
              <BoycottComments boycottId={boycott.id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * Individual company entry within expanded boycott card
 * Shows seed companies with their configured connection types to block
 */
function CompanyEntry({ entry, boycottId, variant, onRemove, proxyExpansion }) {
  const company = entry.companies
  if (!company) return null

  const connectionTypes = []
  if (entry.block_owns) connectionTypes.push('owns')
  if (entry.block_owned_by) connectionTypes.push('owned_by')
  if (entry.block_brands) connectionTypes.push('brands')
  if (entry.block_suppliers) connectionTypes.push('supplier')
  if (entry.block_customers) connectionTypes.push('customers')

  const hasProxyBlocking = connectionTypes.length > 0

  // Get proxy data from hook if available
  const proxyData = proxyExpansion?.getProxyData?.(boycottId, company.id)
  const proxyCount = proxyExpansion?.countProxyCompanies?.(boycottId, company.id) || 0
  const isProxyExpanded = proxyExpansion?.isProxyExpanded?.(boycottId, company.id)

  const handleProxyToggle = e => {
    proxyExpansion?.toggleProxyExpansion?.(e, boycottId, company.id, entry)
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {/* Seed header */}
      <div
        style={{
          padding: 'var(--space-2-5) var(--space-3-5)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: hasProxyBlocking ? '1px solid var(--border)' : 'none',
          background: 'rgba(255, 61, 0, 0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2-5)',
            flex: 1,
            minWidth: 0,
          }}
        >
          {company.logo_url ? (
            <LazyImage
              src={company.logo_url}
              alt={company.name}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--radius-sm)',
                flexShrink: 0,
              }}
              fallback={
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 'var(--text-xs2)',
                    fontWeight: 'var(--font-semibold)',
                    color: '#fff',
                  }}
                >
                  {(company.name || '?')[0].toUpperCase()}
                </div>
              }
            />
          ) : (
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--accent)',
                flexShrink: 0,
              }}
            />
          )}
          <Link
            to={`/company/${getCompanyLinkId(company)}`}
            state={{ name: company.name }}
            style={{
              fontWeight: 'var(--font-semibold)',
              fontSize: 'var(--text-md)',
              color: 'inherit',
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            onClick={e => e.stopPropagation()}
          >
            {company.name}
          </Link>
          <span
            title='Seed company — directly targeted by this boycott'
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--accent)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              flexShrink: 0,
            }}
          >
            SEED
          </span>
        </div>

        {/* Remove button (owned variant only) */}
        {variant === 'owned' && onRemove && (
          <button
            onClick={e => onRemove(e, boycottId, company.id)}
            style={{
              padding: 'var(--space-1) var(--space-2)',
              background: 'transparent',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Remove
          </button>
        )}
      </div>

      {/* Connection types being blocked */}
      {!hasProxyBlocking && (
        <div
          style={{
            padding: 'var(--space-2-5) var(--space-3-5)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}
        >
          Direct only — no related companies blocked
        </div>
      )}
      {hasProxyBlocking && (
        <div style={{ padding: 'var(--space-2-5) var(--space-3-5)' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              marginBottom: proxyExpansion ? 'var(--space-2)' : 0,
            }}
          >
            {connectionTypes.map(ct => {
              const info = {
                owns: { color: '#22c55e', label: 'Subsidiaries' },
                owned_by: { color: '#3b82f6', label: 'Parents' },
                brands: { color: '#a855f7', label: 'Brands' },
                supplier: { color: '#f59e0b', label: 'Suppliers' },
                customers: { color: '#06b6d4', label: 'Customers' },
              }[ct]
              if (!info) return null
              return (
                <span
                  key={ct}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1-5)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  <span style={{ color: info.color }}>●</span>
                  <span style={{ color: 'var(--text-muted)' }}>{info.label}</span>
                </span>
              )
            })}
          </div>

          {/* Proxy expansion toggle */}
          {proxyExpansion && (
            <ProxyExpansionPanel
              proxyData={proxyData}
              isExpanded={isProxyExpanded}
              onToggle={handleProxyToggle}
              connectionTypes={connectionTypes}
              proxyCount={proxyCount}
              companyName={company.name}
            />
          )}
        </div>
      )}
    </div>
  )
}
