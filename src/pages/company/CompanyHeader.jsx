import { AnimatePresence, motion } from 'framer-motion'
import { Building2, ChevronDown, Globe, MapPin, Plus, Users } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import Badge from '../../components/atoms/Badge'
import { CorporateThreatScore } from '../../components/molecules/CorporateThreatScore'
import { useToast } from '../../components/organisms/Toast'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'

const CreateBoycottModal = lazy(
  () => import('../../components/organisms/boycott/CreateBoycottModal')
)

// Wider, non-circular logo container so wordmark SVGs (Alphabet, Paramount,
// Texas Roadhouse, etc.) render at a readable size. Icon-style logos still
// look fine because objectFit: contain centers them in the box.
function CompanyLogo({ src, name }) {
  const initial = name ? name[0].toUpperCase() : '?'
  const containerStyle = {
    width: 120,
    height: 72,
    borderRadius: 'var(--radius-lg)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--glass-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    padding: 6,
  }
  if (!src) {
    return (
      <div
        style={{
          ...containerStyle,
          background: 'var(--avatar-company, linear-gradient(135deg, #ec4899, #34d399))',
          color: '#fff',
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        {initial}
      </div>
    )
  }
  return (
    <div style={containerStyle}>
      <img
        src={src}
        alt={name}
        loading='lazy'
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}

// Meta chips (country / industry / employees) — mono uppercase per the design
const metaChipStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
}

export default function CompanyHeader({ company, connections }) {
  const { user } = useAuth()
  const { myBoycotts, addCompanyToBoycott } = useApp()
  const toast = useToast()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [adding, setAdding] = useState(null)
  const [boyked, setBoyked] = useState(false)
  const dropdownRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return
    const handleClick = e => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showDropdown])

  const handleAddToBoycott = useCallback(
    async boycott => {
      if (!company) return
      setAdding(boycott.id)
      try {
        await addCompanyToBoycott(
          boycott.id,
          company.id,
          false,
          false,
          false,
          company.name,
          company.logo_url,
          false,
          false
        )
        setShowDropdown(false)
        setBoyked(true)
        setTimeout(() => setBoyked(false), 3000)
      } catch (err) {
        toast.error(err.message || 'Failed to add company')
      } finally {
        setAdding(null)
      }
    },
    [company, addCompanyToBoycott, toast]
  )

  if (!company) return null

  const isParent = (connections?.owns?.length || 0) > 0
  const hasParent = (connections?.owned_by?.length || 0) > 0

  return (
    // .card-primary treatment replicated inline: the class sets overflow:hidden
    // (to clip its ::before top bar), which would clip the Boyk dropdown below.
    <div
      style={{
        position: 'relative',
        background: 'var(--gradient-card), var(--glass-bg)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-accent)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-md), 0 0 30px var(--accent-subtle)',
        padding: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
      }}
    >
      {/* Brand-gradient top bar (mirrors .card-primary::before) */}
      <div
        aria-hidden='true'
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'var(--gradient-brand)',
          boxShadow: '0 0 18px var(--accent-glow)',
          borderTopLeftRadius: 'var(--radius-card)',
          borderTopRightRadius: 'var(--radius-card)',
        }}
      />
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          alignItems: 'flex-start',
        }}
      >
        <CompanyLogo src={company.logo_url} name={company.name || '?'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontFamily: 'Sora, sans-serif',
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              color: 'var(--text-primary)',
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {company.name}
          </h1>
          {company.website && (
            <a
              href={
                company.website.startsWith('http') ? company.website : `https://${company.website}`
              }
              target='_blank'
              rel='noopener noreferrer'
              style={{
                color: 'var(--accent)',
                fontSize: 'var(--text-sm)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <Globe size={12} />
              {company.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          {(isParent || hasParent) && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                marginTop: 'var(--space-2)',
                flexWrap: 'wrap',
              }}
            >
              {/* #fbbf24 mirrors --gold: Badge's activity bg math needs a hex */}
              {isParent && (
                <Badge type='activity' color='#fbbf24' value='Parent' className='badge' />
              )}
              {hasParent && <Badge connectionKey='owned_by' value='Subsidiary' className='badge' />}
            </div>
          )}
          {company.description && (
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                marginTop: 'var(--space-1)',
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {company.description}
            </p>
          )}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-2)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {company.country && (
              <span style={metaChipStyle}>
                <MapPin size={12} />
                {company.country}
              </span>
            )}
            {company.industry && (
              <span style={metaChipStyle}>
                <Building2 size={12} />
                {company.industry}
              </span>
            )}
            {(company.employees || company.employee_count) && (
              <span style={metaChipStyle}>
                <Users size={12} />
                {Number(company.employees || company.employee_count).toLocaleString()} employees
              </span>
            )}
          </div>

          {/* Boyk button */}
          {user && (
            <div style={{ position: 'relative', marginTop: 'var(--space-3)' }} ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(v => !v)}
                aria-label={`Boyk ${company.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-4)',
                  background: boyked ? 'var(--success)' : 'var(--gradient-accent)',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  color: 'var(--text-on-accent)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: boyked
                    ? '0 4px 12px var(--success-glow)'
                    : '0 4px 12px var(--accent-glow)',
                }}
              >
                {boyked ? `You've Boyked ${company.name}` : 'Boyk'}
                {!boyked && <ChevronDown size={14} />}
              </button>

              <AnimatePresence>
                {showDropdown && !boyked && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 'var(--space-1)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-lg)',
                      boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                      zIndex: 50,
                      minWidth: 240,
                      overflow: 'hidden',
                    }}
                  >
                    {myBoycotts?.length > 0 && (
                      <>
                        <div
                          style={{
                            padding: 'var(--space-2) var(--space-3)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--text-muted)',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          Add to existing boycott
                        </div>
                        <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                          {myBoycotts.map(b => (
                            <button
                              key={b.id}
                              onClick={() => handleAddToBoycott(b)}
                              disabled={adding === b.id}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: 'var(--space-2-5) var(--space-3)',
                                background: 'none',
                                border: 'none',
                                borderBottom: '1px solid var(--border)',
                                color: 'var(--text-primary)',
                                fontSize: 'var(--text-sm)',
                                textAlign: 'left',
                                cursor: adding === b.id ? 'wait' : 'pointer',
                                opacity: adding === b.id ? 0.5 : 1,
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => (e.target.style.background = 'var(--bg-hover)')}
                              onMouseLeave={e => (e.target.style.background = 'none')}
                            >
                              {adding === b.id ? 'Adding...' : b.name || b.title}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setShowDropdown(false)
                        setShowCreateModal(true)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        width: '100%',
                        padding: 'var(--space-2-5) var(--space-3)',
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent)',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 600,
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.target.style.background = 'var(--accent-subtle)')}
                      onMouseLeave={e => (e.target.style.background = 'none')}
                    >
                      <Plus size={14} />
                      Start new boycott
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {showCreateModal && (
            <Suspense fallback={null}>
              <CreateBoycottModal
                onClose={() => setShowCreateModal(false)}
                initialCompany={company}
              />
            </Suspense>
          )}
        </div>
        {company.aggregate_score != null && (
          <CorporateThreatScore score={company.aggregate_score} size='sm' />
        )}
      </div>
    </div>
  )
}
