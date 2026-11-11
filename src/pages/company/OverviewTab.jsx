import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import Badge from '../../components/atoms/Badge'
import LazyImage from '../../components/atoms/LazyImage'
import Stat from '../../components/atoms/Stat'
import ProvenanceBadge from './ProvenanceBadge'

export default function OverviewTab({ company, connections }) {
  if (!company) return null

  // Country / industry / employees already live in the header meta chips —
  // only non-duplicated facts here, as a plain Stat row per the design.
  const stats = [
    company.revenue && {
      label: 'Revenue',
      value:
        typeof company.revenue === 'number'
          ? `$${(company.revenue / 1e9).toFixed(1)}B`
          : company.revenue,
    },
    company.founded && {
      label: 'Founded',
      value: String(company.founded).slice(0, 4),
    },
    connections?.owns?.length > 0 && {
      label: 'Subsidiaries',
      value: connections.owns.length.toLocaleString(),
    },
  ].filter(Boolean)

  const connectionSections = [
    {
      key: 'owns',
      label: 'Subsidiaries',
      badge: 'Owns',
      connectionKey: 'owns',
      data: connections?.owns,
      linkPrefix: '/company/',
    },
    {
      key: 'owned_by',
      label: 'Parent Companies',
      badge: 'Parent',
      connectionKey: 'owned_by',
      data: connections?.owned_by,
      linkPrefix: '/company/',
    },
    {
      key: 'suppliers',
      label: 'Suppliers',
      badge: 'Supplier',
      connectionKey: 'suppliers',
      data: connections?.suppliers,
      linkPrefix: '/company/',
    },
    {
      key: 'customers',
      label: 'Customers',
      badge: 'Customer',
      connectionKey: 'customers',
      data: connections?.customers,
      linkPrefix: '/company/',
    },
  ].filter(s => s.data?.length > 0)

  return (
    <div style={{ padding: 'var(--space-4) 0' }}>
      {/* Stat row */}
      {stats.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-4)',
            margin: '0 var(--space-1) var(--space-5)',
          }}
        >
          {stats.map(s => (
            <Stat key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      )}

      {/* Connection sections */}
      {connectionSections.map(section => (
        <div key={section.key} style={{ marginBottom: 'var(--space-4)' }}>
          <h3 className='eyebrow' style={{ margin: '0 0 var(--space-2)' }}>
            {section.label} ({section.data.length})
          </h3>
          {section.data.slice(0, 10).map(item => (
            <Link
              key={item.id || item.name}
              to={`${section.linkPrefix}${item.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2-5)',
                padding: 'var(--space-3) var(--space-1)',
                textDecoration: 'none',
                color: 'var(--text-primary)',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                borderRadius: 'var(--radius-sm)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <LazyImage
                src={item.logo_url}
                alt={item.name}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--radius-sm)',
                  objectFit: 'contain',
                  background: '#fff',
                }}
                fallback={
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 'var(--radius-sm)',
                      background:
                        'var(--avatar-company, linear-gradient(135deg, #ec4899, #34d399))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      color: '#fff',
                    }}
                  >
                    {(item.name || '?')[0]}
                  </div>
                }
              />
              <span
                style={{
                  fontSize: 'var(--text-md)',
                  fontWeight: 'var(--font-semibold)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.name}
              </span>
              {item.ownership_percentage && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}
                >
                  {item.ownership_percentage}%
                </span>
              )}
              <ProvenanceBadge item={item} />
              <Badge
                connectionKey={section.connectionKey}
                value={section.badge}
                className='badge'
              />
              <ChevronRight size={16} color='var(--text-faint)' style={{ flexShrink: 0 }} />
            </Link>
          ))}
          {section.data.length > 10 && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: 'var(--space-2) 0',
              }}
            >
              + {section.data.length - 10} more
            </div>
          )}
        </div>
      ))}

      {connectionSections.length === 0 && stats.length === 0 && (
        <div
          style={{
            padding: 'var(--space-6)',
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          No overview data available
        </div>
      )}
    </div>
  )
}
