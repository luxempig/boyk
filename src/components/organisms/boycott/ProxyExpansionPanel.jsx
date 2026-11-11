/**
 * @component ProxyExpansionPanel
 * @level Organism
 * @interactions
 *   - Displays proxy (indirect) companies grouped by connection type in an expandable panel
 *   - ProxyExpansionBadge provides a compact inline variant for proxy count display
 *   - Used inside BoycottCard to show subsidiary, parent, supplier, brand, customer connections
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'

import { spring } from '../../../lib/animations'
import { getCompanyLinkId } from '../../../services/neo4jGraph'

/**
 * Displays proxy companies (subsidiaries, parent companies, suppliers)
 * in an expandable panel format
 */
export default function ProxyExpansionPanel({
  proxyData,
  isExpanded,
  onToggle,
  connectionTypes = [],
  proxyCount = 0,
  companyName: _companyName,
  showToggle = true,
  onCompanyClick,
}) {
  if (!showToggle && !isExpanded) return null

  const hasProxyBlocking = connectionTypes.length > 0

  if (!hasProxyBlocking) return null

  const CONNECTION_LABELS = {
    owns: 'Subsidiaries',
    owned_by: 'Parent Companies',
    brands: 'Brands',
    supplier: 'Suppliers',
    customers: 'Customers',
  }

  return (
    <div>
      {/* Toggle Button */}
      {showToggle && (
        <button
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: 'var(--text-xs2)',
            color: 'var(--accent)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            marginTop: 'var(--space-1)',
          }}
        >
          <span>
            {proxyData
              ? `1 + ${proxyCount} blocked (1 direct, ${proxyCount} by proxy)`
              : `Blocking: ${connectionTypes.map(ct => CONNECTION_LABELS[ct] || ct).join(', ')}`}
          </span>
          <span style={{ fontSize: 'var(--text-xs)' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
        </button>
      )}

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && proxyData && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            style={{
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-3)',
                borderTop: '1px solid var(--border)',
              }}
            >
              {/* Dynamic sections for each connection type with data */}
              {Object.entries(CONNECTION_LABELS).map(([key, label]) =>
                proxyData[key]?.length > 0 ? (
                  <ProxySection
                    key={key}
                    type={key}
                    title={label}
                    companies={proxyData[key]}
                    onCompanyClick={onCompanyClick}
                  />
                ) : null
              )}

              {/* No proxy companies found */}
              {proxyCount === 0 && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                  No connected companies found in database
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Section displaying a category of proxy companies
 */
function ProxySection({ type, title, companies, onCompanyClick }) {
  if (!companies?.length) return null

  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          marginBottom: 'var(--space-1)',
          letterSpacing: '1px',
        }}
      >
        {title} ({companies.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {companies.map(company => (
          <Link
            key={company.id}
            to={
              type === 'brands' ? `/brand/${company.id}` : `/company/${getCompanyLinkId(company)}`
            }
            onClick={e => {
              e.stopPropagation()
              onCompanyClick?.(company)
            }}
            style={{
              fontSize: 'var(--text-xs2)',
              padding: 'var(--space-1) var(--space-2)',
              background: 'var(--bg-dark)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            {company.logo_url && (
              <img
                src={company.logo_url}
                alt={company.name}
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: 'var(--radius-xs)',
                  objectFit: 'contain',
                }}
              />
            )}
            {company.name}
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * Compact version for inline display
 */
export function ProxyExpansionBadge({ proxyCount, isLoading, onClick }) {
  if (isLoading) {
    return (
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {' + loading...'}
      </span>
    )
  }

  if (proxyCount > 0) {
    return (
      <button
        onClick={onClick}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--accent)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
        }}
      >
        {' + '}
        {proxyCount} by proxy
      </button>
    )
  }

  return null
}
