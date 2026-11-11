import { Link } from 'react-router-dom'

import { glassCard } from '../../lib/glassStyles'

export default function BoycottsTab({
  boycotts = [],
  boycottCount = 0,
  companyId,
  expandedBoycott,
  setExpandedBoycott,
  expandedProxyCompany,
  handleExpandProxy,
  proxyCompanies,
  countProxyCompanies,
  CONNECTION_TYPES,
}) {
  if (!boycotts.length)
    return (
      <div
        style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        {boycottCount > 0
          ? `This company is in ${boycottCount} private boycott${boycottCount === 1 ? '' : 's'} you don't have access to`
          : 'No boycotts targeting this company'}
      </div>
    )

  return (
    <div style={{ padding: 'var(--space-4) 0' }}>
      {boycotts.map(boycott => {
        const companies = boycott.boycott_companies || []
        const isExpanded = expandedBoycott === boycott.id

        return (
          <div
            key={boycott.id}
            style={{
              ...glassCard,
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
              cursor: 'pointer',
            }}
            onClick={() => setExpandedBoycott(isExpanded ? null : boycott.id)}
            role='button'
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setExpandedBoycott(isExpanded ? null : boycott.id)
              }
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}
                >
                  {boycott.name}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  by{' '}
                  <Link
                    to={`/user/${boycott.creator_id}`}
                    style={{
                      color: 'var(--accent)',
                      textDecoration: 'none',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    @{boycott.profiles?.username || 'unknown'}
                  </Link>
                  {' · '}
                  {companies.length} companies
                </div>
              </div>
              <span
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-xl)',
                }}
              >
                {isExpanded ? '\u25BC' : '\u2192'}
              </span>
            </div>

            {/* Expanded boycott details */}
            {isExpanded && (
              <div
                role='presentation'
                style={{
                  marginTop: 'var(--space-3)',
                  paddingTop: 'var(--space-3)',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.key === 'Escape' && e.stopPropagation()}
              >
                {boycott.description && (
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-sm)',
                      marginBottom: 'var(--space-3)',
                    }}
                  >
                    {boycott.description}
                  </p>
                )}

                {companies.length === 0 ? (
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    No companies in this boycott.
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                    }}
                  >
                    {companies.map(entry => {
                      const entryCompany = entry.companies
                      if (!entryCompany) return null

                      const connectionTypes = []
                      if (entry.block_owns) connectionTypes.push('owns')
                      if (entry.block_owned_by) connectionTypes.push('owned_by')
                      if (entry.block_brands) connectionTypes.push('brands')
                      if (entry.block_suppliers) connectionTypes.push('supplier')
                      if (entry.block_customers) connectionTypes.push('customers')

                      const hasProxyBlocking = connectionTypes.length > 0
                      const proxyKey = `${boycott.id}-${entryCompany.id}`
                      const isProxyExpanded =
                        expandedProxyCompany?.boycottId === boycott.id &&
                        expandedProxyCompany?.companyId === entryCompany.id
                      const proxyData = proxyCompanies[proxyKey]
                      const proxyCount = countProxyCompanies(proxyKey)
                      const isCurrentCompany = entryCompany.id === companyId

                      return (
                        <div key={entry.id || entryCompany.id}>
                          <div
                            style={{
                              background: isCurrentCompany
                                ? 'rgba(255, 61, 0, 0.1)'
                                : 'rgba(255,255,255,0.03)',
                              border: isCurrentCompany
                                ? '1px solid var(--accent)'
                                : '1px solid rgba(255,255,255,0.06)',
                              padding: 'var(--space-3)',
                              borderRadius: 'var(--radius-md)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                {isCurrentCompany ? (
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color: 'var(--accent)',
                                    }}
                                  >
                                    {entryCompany.name} (this company)
                                  </span>
                                ) : (
                                  <Link
                                    to={`/company/${entryCompany.id}`}
                                    style={{
                                      fontWeight: 500,
                                      color: 'inherit',
                                      textDecoration: 'none',
                                    }}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {entryCompany.name}
                                  </Link>
                                )}
                                {hasProxyBlocking && (
                                  <button
                                    onClick={e =>
                                      handleExpandProxy(e, boycott.id, entryCompany.id, entry)
                                    }
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      padding: 0,
                                      fontSize: 'var(--text-xs)',
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
                                        : `Blocking: ${connectionTypes.map(ct => CONNECTION_TYPES[ct]?.label).join(', ')}`}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: 'var(--text-xs)',
                                      }}
                                    >
                                      {isProxyExpanded ? '\u25BC' : '\u25B6'}
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Proxy companies */}
                            {isProxyExpanded && proxyData && (
                              <div
                                style={{
                                  marginTop: 'var(--space-3)',
                                  paddingTop: 'var(--space-3)',
                                  borderTop: '1px solid rgba(255,255,255,0.06)',
                                }}
                              >
                                {[
                                  {
                                    key: 'owns',
                                    label: 'Subsidiaries',
                                  },
                                  {
                                    key: 'owned_by',
                                    label: 'Parent Companies',
                                  },
                                  { key: 'brands', label: 'Brands' },
                                  {
                                    key: 'supplier',
                                    label: 'Suppliers',
                                  },
                                  {
                                    key: 'customers',
                                    label: 'Customers',
                                  },
                                ].map(
                                  ({ key, label }) =>
                                    proxyData[key]?.length > 0 && (
                                      <div
                                        key={key}
                                        style={{
                                          marginBottom: 'var(--space-2)',
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontSize: 'var(--text-xs)',
                                            color: 'var(--text-muted)',
                                            textTransform: 'uppercase',
                                            marginBottom: 'var(--space-1)',
                                          }}
                                        >
                                          {label} ({proxyData[key].length})
                                        </div>
                                        <div
                                          style={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: 'var(--space-1)',
                                          }}
                                        >
                                          {proxyData[key].map(c => (
                                            <Link
                                              key={c.id}
                                              to={
                                                key === 'brands'
                                                  ? `/brand/${c.id}`
                                                  : `/company/${c.id}`
                                              }
                                              onClick={e => e.stopPropagation()}
                                              style={{
                                                fontSize: 'var(--text-xs)',
                                                padding: 'var(--space-1) var(--space-2)',
                                                background: 'var(--bg-elevated)',
                                                border: '1px solid var(--border)',
                                                borderRadius: 'var(--radius-sm)',
                                                color: 'var(--text-secondary)',
                                                textDecoration: 'none',
                                              }}
                                            >
                                              {c.name}
                                            </Link>
                                          ))}
                                        </div>
                                      </div>
                                    )
                                )}
                                {proxyCount === 0 && (
                                  <p
                                    style={{
                                      fontSize: 'var(--text-sm)',
                                      color: 'var(--text-muted)',
                                    }}
                                  >
                                    No connected companies found
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {boycotts.length < boycottCount && (
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginTop: 'var(--space-2)',
          }}
        >
          + {boycottCount - boycotts.length} private boycott
          {boycottCount - boycotts.length === 1 ? '' : 's'} you don&apos;t have access to
        </p>
      )}
    </div>
  )
}
