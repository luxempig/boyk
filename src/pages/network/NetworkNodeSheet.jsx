import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Expand, ExternalLink, X } from 'lucide-react'

import { useFocusTrap } from '../../hooks/useFocusTrap'
import { CONNECTION_COLORS } from '../../lib/connectionColors'
import { getCompanyWithConnections } from '../../services/neo4jGraph'

function initials(name) {
  if (!name) return '?'
  const parts = name.split(/\s+/).filter(Boolean)
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

function pickConnections(company) {
  if (!company) return []
  const chips = []
  const pushFrom = (arr, type) => {
    ;(arr || []).slice(0, 6).forEach(item => {
      chips.push({
        id: item.id,
        name: item.name,
        type,
        color: CONNECTION_COLORS[type] || 'var(--text-muted)',
      })
    })
  }
  pushFrom(company.subsidiaries, 'owns')
  pushFrom(company.parents, 'owned_by')
  pushFrom(company.brands, 'brands')
  pushFrom(company.suppliers, 'suppliers')
  pushFrom(company.customers, 'customers')
  return chips.slice(0, 6)
}

function statsOf(company) {
  if (!company) return { subsidiaries: 0, brands: 0, parents: 0 }
  return {
    subsidiaries: (company.subsidiaries || []).length,
    brands: (company.brands || []).length,
    parents: (company.parents || []).length,
  }
}

const typeVerb = {
  owns: 'owns',
  owned_by: 'owned by',
  brands: 'brand',
  suppliers: 'supplier',
  customers: 'customer',
}

/**
 * Sheet that appears when a node in the network graph is clicked.
 * Fetches the company's details on open, then renders stats + a few
 * direct connections as clickable chips, with Expand and Open actions.
 */
export default function NetworkNodeSheet({
  nodeId,
  hint, // { name, logo_url } — optimistic rendering before fetch resolves
  onClose,
  onExpand,
  onOpen,
}) {
  const {
    data: company,
    isPending: loading,
    isError: error,
  } = useQuery({
    queryKey: ['company-detail', nodeId],
    queryFn: () => getCompanyWithConnections(nodeId),
    enabled: !!nodeId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  const name = company?.name || hint?.name || '—'
  const logoUrl = company?.logo_url || hint?.logo_url
  const country = company?.country
  const industry = company?.industry
  const ticker = company?.ticker
  const stats = statsOf(company)
  const chips = pickConnections(company)
  const focusTrapRef = useFocusTrap(true)

  return (
    <AnimatePresence>
      <motion.aside
        ref={focusTrapRef}
        role='dialog'
        aria-modal='true'
        aria-label={name}
        key='sheet'
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 340,
          maxHeight: 'calc(100% - 32px)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 20,
        }}
      >
        {/* Header — top accent bar + logo tile */}
        <div
          style={{
            padding: 'var(--space-5)',
            background:
              'linear-gradient(180deg, var(--accent-subtle, rgba(249,115,22,0.08)) 0%, var(--bg-card) 60%)',
            borderBottom: '1px solid var(--border)',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: 'var(--gradient-accent, var(--accent))',
            }}
          />
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
          </button>

          {logoUrl ? (
            <img
              src={logoUrl}
              alt={name}
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-md)',
                objectFit: 'contain',
                background: '#fff',
                marginBottom: 'var(--space-2)',
                boxShadow: 'var(--shadow-sm)',
              }}
            />
          ) : (
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-full)',
                background:
                  'linear-gradient(135deg, var(--ink-800, var(--text-primary)), var(--ink-600, var(--text-secondary)))',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 'var(--font-bold)',
                fontSize: 22,
                marginBottom: 'var(--space-2)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {initials(name)}
            </div>
          )}

          {ticker && (
            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                fontWeight: 'var(--font-semibold)',
                marginBottom: 'var(--space-0-5)',
              }}
            >
              {ticker}
            </div>
          )}

          <div
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--font-bold)',
              letterSpacing: '-0.015em',
              lineHeight: 1.15,
              color: 'var(--text-primary)',
              paddingRight: 'var(--space-6)',
            }}
          >
            {name}
          </div>

          {(country || industry) && (
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1-5)',
                flexWrap: 'wrap',
                marginTop: 'var(--space-1)',
              }}
            >
              {country && <span>{country}</span>}
              {country && industry && (
                <span
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: 'var(--text-faint, var(--text-muted))',
                  }}
                />
              )}
              {industry && <span>{industry}</span>}
            </div>
          )}
        </div>

        {/* Body */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          {error ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              Couldn't load details for this company.
            </div>
          ) : (
            <>
              {/* Stats row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 'var(--space-2)',
                  paddingBottom: 'var(--space-3)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {[
                  { v: stats.subsidiaries, l: 'Subsidiaries' },
                  { v: stats.brands, l: 'Brands' },
                  { v: stats.parents, l: 'Parents' },
                ].map(s => (
                  <div key={s.l}>
                    <div
                      style={{
                        fontSize: 'var(--text-xl)',
                        fontWeight: 'var(--font-bold)',
                        letterSpacing: '-0.01em',
                        lineHeight: 1,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {loading ? '—' : s.v}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-2xs)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--text-muted)',
                        fontWeight: 'var(--font-semibold)',
                        marginTop: 'var(--space-0-5)',
                      }}
                    >
                      {s.l}
                    </div>
                  </div>
                ))}
              </div>

              {/* Direct connections */}
              {!loading && chips.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 'var(--font-bold)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      color: 'var(--text-muted)',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    Direct connections
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1-5)' }}>
                    {chips.map((c, i) => (
                      <span
                        key={`${c.type}-${c.id || i}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'var(--space-1-5)',
                          padding: '5px 10px 5px 8px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          fontSize: 'var(--text-sm)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: c.color,
                          }}
                        />
                        <strong style={{ fontWeight: 'var(--font-semibold)' }}>{c.name}</strong>
                        <em
                          style={{
                            fontStyle: 'normal',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono, monospace)',
                            fontSize: 10,
                          }}
                        >
                          {typeVerb[c.type] || c.type}
                        </em>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              paddingTop: 'var(--space-2)',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              type='button'
              onClick={onExpand}
              disabled={loading}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--font-semibold)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1-5)',
              }}
            >
              <Expand size={14} />
              Expand
            </button>
            <button
              type='button'
              onClick={onOpen}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 'var(--radius-full)',
                border: 'none',
                background: 'var(--gradient-accent)',
                color: 'var(--text-on-accent, #fff)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--font-bold)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1-5)',
              }}
            >
              Open full page
              <ExternalLink size={14} />
            </button>
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
