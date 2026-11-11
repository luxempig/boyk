import { Network } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import NotFoundState from '../components/molecules/NotFoundState'
import Header from '../components/organisms/Header'
import { useToast } from '../components/organisms/Toast'
import { CONNECTION_TYPES } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useSafeState } from '../hooks/useSafeState'
import { supabase } from '../lib/supabase'
import { getCompanyWithConnections } from '../services/neo4jGraph'
import BoycottsTab from './company/BoycottsTab'
import BrandsTab from './company/BrandsTab'
import CompanyHeader from './company/CompanyHeader'
import { CompanyTabs } from './company/CompanyTabs'
import NetworkTab from './company/NetworkTab'
import OverviewTab from './company/OverviewTab'
import PeopleTab from './company/PeopleTab'
import ProvenanceBadge from './company/ProvenanceBadge'

export default function Company() {
  const { companyId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const referrerName = location.state?.name
  const { user } = useAuth()
  const toast = useToast()
  const { safeSetState } = useSafeState()

  // Tab state
  const [activeTab, setActiveTab] = useState('overview')

  const [company, setCompany] = useState(null)
  const [connections, setConnections] = useState({
    owns: [],
    owned_by: [],
    suppliers: [],
    customers: [],
    brands: [],
    people: [],
    political_donations: [],
  })
  const [boycottCount, setBoycottCount] = useState(0)
  const [boycotts, setBoycotts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedBoycott, setExpandedBoycott] = useState(null)
  const [expandedProxyCompany, setExpandedProxyCompany] = useState(null)
  const [proxyCompanies, setProxyCompanies] = useState({})

  useEffect(() => {
    // Stale-response guard: navigating company A→B must not let A's slower
    // response overwrite B's state. `cancelled` is flipped in cleanup.
    let cancelled = false

    const fetchCompanyData = async () => {
      safeSetState(setLoading, true)

      try {
        // Fetch company with connections from Neo4j
        const neo4jCompany = await getCompanyWithConnections(companyId)
        if (cancelled) return

        let companyResult = null
        if (neo4jCompany) {
          companyResult = neo4jCompany
          safeSetState(setCompany, companyResult)
          // Set connections from Neo4j data
          safeSetState(setConnections, {
            owns: neo4jCompany.connections?.owns || [],
            owned_by: neo4jCompany.connections?.owned_by || [],
            suppliers: neo4jCompany.connections?.suppliers || [],
            customers: neo4jCompany.connections?.customers || [],
            brands: neo4jCompany.connections?.brands || [],
            people: neo4jCompany.connections?.people || [],
            political_donations: neo4jCompany.connections?.political_donations || [],
          })
        } else {
          // Fallback to Supabase for boycott-related data
          const { data: companyData, error: companyError } = await supabase.rpc('get_company', {
            p_company_identifier: companyId,
          })
          if (cancelled) return

          if (!companyError && companyData) {
            companyResult = Array.isArray(companyData) ? companyData[0] : companyData
          }

          if (companyResult) {
            safeSetState(setCompany, companyResult)
            safeSetState(setConnections, {
              owns: [],
              owned_by: [],
              suppliers: [],
              customers: [],
              brands: [],
              people: [],
              political_donations: [],
            })
          } else {
            safeSetState(setLoading, false)
            return
          }
        }

        // Get boycotts for this company
        const { data: boycottsData } = await supabase.rpc('get_boycotts_for_company', {
          p_company_identifier: companyId,
        })
        if (cancelled) return

        // Get total boycott count
        const totalBoycottCount = boycottsData?.length || 0
        safeSetState(setBoycottCount, totalBoycottCount)

        // Get profiles for boycott creators
        if (boycottsData && boycottsData.length > 0) {
          const creatorIds = [...new Set(boycottsData.map(b => b.creator_id))]
          const { data: profilesData } = await supabase.rpc('get_profiles_by_ids', {
            p_ids: creatorIds,
          })
          if (cancelled) return

          const profilesMap = {}
          ;(profilesData || []).forEach(p => {
            profilesMap[p.id] = p
          })

          // Fetch full boycott details for each visible boycott.
          // NOTE: N+1 — one get_my_boycotts RPC per creator. Revisit with a
          // batched RPC that returns boycott_companies for a set of boycott IDs.
          const boycottsWithDetails = await Promise.all(
            boycottsData.map(async b => {
              const { data: fullBoycott } = await supabase.rpc('get_my_boycotts', {
                p_user_id: b.creator_id,
              })
              const thisBoycott = (fullBoycott || []).find(fb => fb.id === b.id)
              return {
                ...b,
                profiles: profilesMap[b.creator_id] || { username: 'unknown' },
                boycott_companies: thisBoycott?.boycott_companies || [],
              }
            })
          )
          if (cancelled) return

          safeSetState(setBoycotts, boycottsWithDetails)
        } else {
          safeSetState(setBoycotts, [])
        }
      } catch {
        if (!cancelled) toast.error('Failed to load company data')
      } finally {
        if (!cancelled) safeSetState(setLoading, false)
      }
    }

    if (companyId) {
      fetchCompanyData()
    }

    return () => {
      cancelled = true
    }
  }, [companyId, user?.id, safeSetState, toast])

  // Fetch proxy companies from Neo4j graph
  const fetchProxyCompanies = useCallback(async (targetCompanyId, entry) => {
    const data = { owns: [], owned_by: [], brands: [], supplier: [], customers: [] }

    try {
      const companyData = await getCompanyWithConnections(targetCompanyId)
      if (!companyData || !companyData.connections) return data

      // Only include connections based on what the boycott blocks
      if (entry.block_owns && companyData.connections.owns) {
        data.owns = companyData.connections.owns
      }
      if (entry.block_owned_by && companyData.connections.owned_by) {
        data.owned_by = companyData.connections.owned_by
      }
      if (entry.block_brands && companyData.connections.brands) {
        data.brands = companyData.connections.brands
      }
      if (entry.block_suppliers && companyData.connections.suppliers) {
        data.supplier = companyData.connections.suppliers
      }
      if (entry.block_customers && companyData.connections.customers) {
        data.customers = companyData.connections.customers
      }
    } catch (err) {
      console.error('Error fetching proxy companies:', err)
    }

    return data
  }, [])

  const handleExpandProxy = async (e, boycottId, targetCompanyId, entry) => {
    e.stopPropagation()
    const key = `${boycottId}-${targetCompanyId}`
    const isExpanded =
      expandedProxyCompany?.boycottId === boycottId &&
      expandedProxyCompany?.companyId === targetCompanyId

    if (isExpanded) {
      setExpandedProxyCompany(null)
      return
    }

    if (!proxyCompanies[key]) {
      const data = await fetchProxyCompanies(targetCompanyId, entry)
      setProxyCompanies(prev => ({ ...prev, [key]: data }))
    }

    setExpandedProxyCompany({ boycottId, companyId: targetCompanyId })
  }

  const countProxyCompanies = key => {
    const data = proxyCompanies[key]
    if (!data) return 0
    return (
      (data.owns?.length || 0) +
      (data.owned_by?.length || 0) +
      (data.brands?.length || 0) +
      (data.supplier?.length || 0) +
      (data.customers?.length || 0)
    )
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'network', label: 'Network' },
    {
      key: 'people',
      label: 'People',
      count: connections.people?.length || undefined,
    },
    {
      key: 'brands',
      label: 'Brands',
      count: connections.brands?.length || undefined,
    },
    { key: 'intel', label: 'Intel' },
    { key: 'boycotts', label: 'Boycotts', count: boycottCount || undefined },
  ]

  if (loading) {
    return (
      <div className='container'>
        <Header pageLabel='Company' />
        <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-5)' }}>
          <div className='spinner'></div>
        </div>
      </div>
    )
  }

  if (!company) {
    return (
      <div className='container'>
        <Header pageLabel='Company' />
        <NotFoundState label='Company' name={referrerName} />
      </div>
    )
  }

  return (
    <div className='container'>
      <Header pageLabel='Company' />
      <main
        style={{
          maxWidth: 600,
          margin: '0 auto',
          padding: '0 0 100px',
        }}
      >
        <CompanyHeader company={company} connections={connections} />
        <CompanyTabs tabs={tabs} activeKey={activeTab} onChange={setActiveTab} />

        {activeTab === 'overview' && <OverviewTab company={company} connections={connections} />}

        {activeTab === 'network' && <NetworkTab company={company} connections={connections} />}

        {activeTab === 'people' && <PeopleTab people={connections.people} />}

        {activeTab === 'brands' && <BrandsTab brands={connections.brands} />}

        {activeTab === 'intel' && <EnrichmentSection company={company} connections={connections} />}

        {activeTab === 'boycotts' && (
          <BoycottsTab
            boycotts={boycotts}
            boycottCount={boycottCount}
            companyId={companyId}
            expandedBoycott={expandedBoycott}
            setExpandedBoycott={setExpandedBoycott}
            expandedProxyCompany={expandedProxyCompany}
            handleExpandProxy={handleExpandProxy}
            proxyCompanies={proxyCompanies}
            countProxyCompanies={countProxyCompanies}
            CONNECTION_TYPES={CONNECTION_TYPES}
          />
        )}

        {/* Explore Full Network button */}
        {activeTab === 'network' && (
          <button
            onClick={() => navigate(`/network?company=${companyId}`)}
            className='btn-primary'
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-3)',
            }}
          >
            <Network size={16} />
            Explore Full Network
          </button>
        )}
      </main>
    </div>
  )
}

/**
 * EnrichmentSection - Expandable corporate intelligence data
 */
function EnrichmentSection({ company, connections }) {
  const [expanded, setExpanded] = useState(null)

  if (!company) return null

  const sections = [
    {
      key: 'political_donations',
      label: 'Political Donations',
      data: connections.political_donations || [],
      color: '#ec4899',
      columns: ['name', 'party', 'office', 'state', 'amount', 'year', 'source'],
      formatRow: d => ({
        name: d.name,
        party: d.party,
        office: d.office,
        state: d.state,
        amount: d.amount ? `$${Number(d.amount).toLocaleString()}` : '',
        year: d.year,
        source: d.source,
      }),
    },
    {
      key: 'government_contracts',
      label: 'Gov. Contracts',
      data: company.government_contracts || [],
      color: '#3b82f6',
      columns: ['agency', 'description', 'amount', 'start_date', 'source'],
      formatRow: d => ({
        agency: d.agency,
        description: d.description?.slice(0, 80) + (d.description?.length > 80 ? '...' : ''),
        amount: d.amount ? `$${Number(d.amount).toLocaleString()}` : '',
        start_date: d.start_date?.slice(0, 10),
        source: d.source,
      }),
    },
    {
      key: 'recalls',
      label: 'Recalls',
      data: company.recalls || [],
      color: '#ef4444',
      columns: ['product_name', 'reason', 'date', 'status', 'source'],
      formatRow: d => ({
        product_name: d.product_name?.slice(0, 40),
        reason: d.reason?.slice(0, 100) + (d.reason?.length > 100 ? '...' : ''),
        date: d.date?.slice(0, 10),
        status: d.status,
        source: d.source,
      }),
    },
    {
      key: 'violations',
      label: 'Violations',
      data: company.violations || [],
      color: '#ef4444',
    },
    {
      key: 'environmental_violations',
      label: 'EPA Violations',
      data: company.environmental_violations || [],
      color: '#f97316',
    },
    {
      key: 'lobbying',
      label: 'Lobbying Records',
      data: company.lobbying || [],
      color: '#eab308',
    },
    {
      key: 'subsidies',
      label: 'Subsidies',
      data: company.subsidies || [],
      color: '#22c55e',
    },
    {
      key: 'offshore_entities',
      label: 'Offshore Entities',
      data: company.offshore_entities || [],
      color: '#a855f7',
    },
    {
      key: 'esg_scores',
      label: 'ESG Scores',
      data: company.esg_scores || [],
      color: '#06b6d4',
    },
    {
      key: 'consumer_complaints',
      label: 'Consumer Complaints',
      data: company.consumer_complaints || [],
      color: '#f97316',
    },
    {
      key: 'facilities',
      label: 'Facilities',
      data: company.facilities || [],
      color: '#64748b',
    },
  ].filter(s => s.data.length > 0)

  if (sections.length === 0)
    return (
      <div
        style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        No corporate intelligence data available
      </div>
    )

  return (
    <div style={{ padding: 'var(--space-4) 0' }}>
      {/* Count badges grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 'var(--space-2)',
          marginBottom: expanded ? 'var(--space-4)' : 0,
        }}
      >
        {sections.map(s => (
          <button
            key={s.key}
            onClick={() => setExpanded(expanded === s.key ? null : s.key)}
            style={{
              padding: 'var(--space-2-5) var(--space-3)',
              background: expanded === s.key ? `${s.color}15` : 'var(--bg-card)',
              border: `1px solid ${expanded === s.key ? s.color : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              transition: 'all 0.15s',
            }}
          >
            <span
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 'var(--font-bold)',
                color: s.color,
              }}
            >
              {s.data.length}
            </span>
            <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)', flex: 1 }}>
              {s.label}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              {expanded === s.key ? '\u25BC' : '\u25B6'}
            </span>
          </button>
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && <EnrichmentDetail section={sections.find(s => s.key === expanded)} />}
    </div>
  )
}

function EnrichmentDetail({ section }) {
  if (!section) return null

  const { data, label, color, columns, formatRow } = section

  // For sections with defined columns, show a table
  if (columns && formatRow) {
    const rows = data.slice(0, 20).map(formatRow)
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          marginTop: 'var(--space-3)',
        }}
      >
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--border)',
            fontSize: 'var(--text-xs2)',
            fontWeight: 'var(--font-semibold)',
            color: color,
          }}
        >
          {label} ({data.length} records{data.length > 20 ? ', showing first 20' : ''})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr>
                {columns.map(col => (
                  <th
                    key={col}
                    style={{
                      textAlign: 'left',
                      padding: 'var(--space-1-5) var(--space-2-5)',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      fontWeight: 'var(--font-medium)',
                      textTransform: 'capitalize',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {columns.map(col => (
                    <td
                      key={col}
                      style={{
                        padding: 'var(--space-1-5) var(--space-2-5)',
                        color: 'var(--text-secondary)',
                        maxWidth: '250px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {col === 'source' && row[col] ? (
                        <ProvenanceBadge item={data[i]} />
                      ) : (
                        row[col] || '\u2014'
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // Generic display: show all properties of each item
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginTop: 'var(--space-3)',
      }}
    >
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--border)',
          fontSize: 'var(--text-xs2)',
          fontWeight: 'var(--font-semibold)',
          color: color,
        }}
      >
        {label} ({data.length} records{data.length > 20 ? ', showing first 20' : ''})
      </div>
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {data.slice(0, 20).map((item, i) => {
          const entries = Object.entries(item).filter(
            ([k, v]) =>
              v != null &&
              k !== 'last_updated' &&
              k !== 'source' &&
              k !== 'company_name' &&
              k !== 'confidence' &&
              k !== 'corroborated_by' &&
              k !== 'evidence_sources' &&
              k !== 'source_record_id' &&
              k !== 'source_url' &&
              k !== 'wikidata_id' &&
              k !== 'lei'
          )
          return (
            <div
              key={i}
              style={{
                padding: 'var(--space-2)',
                background: 'var(--bg-dark)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-sm)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-2)',
                }}
              >
                <div style={{ flex: 1 }}>
                  {entries.map(([k, v]) => (
                    <span
                      key={k}
                      style={{ marginRight: 'var(--space-3)', color: 'var(--text-secondary)' }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>{k.replace(/_/g, ' ')}: </span>
                      {typeof v === 'number' ? v.toLocaleString() : String(v).slice(0, 100)}
                    </span>
                  ))}
                </div>
                <ProvenanceBadge item={item} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
