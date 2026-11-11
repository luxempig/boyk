import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  LayoutList,
  Network as NetworkIcon,
  Search,
  Share2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import LazyImage from '../components/atoms/LazyImage'
import Header from '../components/organisms/Header'
import OrgChartGraph from '../components/organisms/OrgChartGraph'
import { useApp } from '../context/AppContext'
import { useDebounce } from '../hooks/useDebounce'
import { useBoycottUserClaims } from '../hooks/useUserClaims'
import { spring } from '../lib/animations'
import { CONNECTION_COLORS } from '../lib/connectionColors'
import { getCompanyLinkId, getCompanyWithConnections } from '../services/neo4jGraph'
import NetworkNodeSheet from './network/NetworkNodeSheet'

/**
 * Network Explorer Page
 *
 * A full-page interactive graph for exploring corporate connections.
 * Features:
 * - Search and start from any company
 * - URL param support (?company=id or ?boycott=id)
 * - Full-screen graph exploration
 * - Click to select, double-click to navigate
 */
export default function Network() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { searchCompanies, myBoycotts, followedBoycotts, publicBoycotts } = useApp()
  const allBoycotts = useMemo(
    () => [...(myBoycotts || []), ...(followedBoycotts || []), ...(publicBoycotts || [])],
    [myBoycotts, followedBoycotts, publicBoycotts]
  )

  // State
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [companyConnections, setCompanyConnections] = useState(null)
  const [loading, setLoading] = useState(false)
  // 'not-found' | 'fetch-error' | null — distinguishes a missing company from
  // an actual network/Neo4j failure so the UI can render different messaging.
  const [loadError, setLoadError] = useState(null)
  const [showSearch, setShowSearch] = useState(true)

  // Boycott — resolved synchronously from URL param + navigation state or context
  const boycottId = searchParams.get('boycott')
  const selectedBoycott = useMemo(() => {
    if (!boycottId) return null
    // Prefer boycott passed via navigation state (immediate, works on SPA nav)
    if (location.state?.boycottId === boycottId || location.state?.boycott?.id === boycottId) {
      return location.state.boycott || allBoycotts?.find(b => b.id === boycottId) || null
    }
    // Fall back to context lookup (works on hard refresh after data loads)
    return allBoycotts?.find(b => b.id === boycottId) || null
  }, [boycottId, location.state, allBoycotts])

  // Ref to track loaded company to prevent re-fetching
  const loadedCompanyRef = useRef(null)

  // User-claimed companies on the selected boycott (rendered as dashed nodes)
  const userClaimsQuery = useBoycottUserClaims(boycottId)
  const userClaimedCompanies = userClaimsQuery.data?.companies || []

  // View mode: 'graph' or 'list'
  const [viewMode, setViewMode] = useState('list')

  // Graph state ref + restored state for back-navigation persistence
  const graphStateRef = useRef(null)
  const [savedGraphState, setSavedGraphState] = useState(null)

  // Imperative handle on OrgChartGraph so the node-detail sheet can append
  // a node's connections to the existing graph instead of re-rooting it.
  const graphRef = useRef(null)

  // Search state — searchQuery is the live input value; debouncedQuery is what
  // actually drives the network fetch (300ms behind the keystrokes).
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const debouncedQuery = useDebounce(searchQuery, 300)

  // Node-detail sheet (graph view): { id, type, name, logo_url } | null
  const [sheetNode, setSheetNode] = useState(null)

  // Load company with connections from Neo4j API
  const loadCompany = useCallback(async companyId => {
    setLoading(true)
    setLoadError(null)
    try {
      const company = await getCompanyWithConnections(companyId)

      if (!company) {
        setLoadError('not-found')
        setLoading(false)
        return
      }

      setSelectedCompany({
        ...company,
        id: company.id || companyId,
      })

      const connections = company.connections || {}
      setCompanyConnections({
        owns: connections.owns || [],
        owned_by: connections.owned_by || [],
        invested_in_by: connections.invested_in_by || [],
        invests_in: connections.invests_in || [],
        suppliers: connections.suppliers || [],
        customers: connections.customers || [],
        brands: connections.brands || [],
        people: connections.people || [],
      })
      setShowSearch(false)
    } catch (err) {
      console.error('Error loading company:', err)
      setLoadError('fetch-error')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load company from URL param — try cache first for instant back-navigation
  useEffect(() => {
    const companyId = searchParams.get('company')

    // URL no longer has company param — clear state (e.g., user pressed back)
    if (!companyId) {
      if (loadedCompanyRef.current) {
        loadedCompanyRef.current = null
        setSelectedCompany(null)
        setCompanyConnections(null)
        setSavedGraphState(null)
        setShowSearch(true)
      }
      return
    }

    if (loadedCompanyRef.current === companyId) return
    loadedCompanyRef.current = companyId

    // Try to restore from sessionStorage (saved before navigating away)
    try {
      const cached = sessionStorage.getItem('network-company-cache')
      if (cached) {
        const data = JSON.parse(cached)
        if (data.id === companyId) {
          sessionStorage.removeItem('network-company-cache')
          setSelectedCompany(data.company)
          setCompanyConnections(data.connections)
          if (data.viewMode) setViewMode(data.viewMode)
          if (data.graphState) setSavedGraphState(data.graphState)
          setShowSearch(false)
          return
        }
      }
    } catch {
      /* ignore */
    }

    loadCompany(companyId)
  }, [searchParams, loadCompany])

  // Save company data + graph state before navigating away (for instant restore on back)
  const saveAndNavigate = useCallback(
    path => {
      if (selectedCompany && companyConnections) {
        try {
          sessionStorage.setItem(
            'network-company-cache',
            JSON.stringify({
              id: searchParams.get('company'),
              company: selectedCompany,
              connections: companyConnections,
              viewMode,
              graphState: graphStateRef.current || null,
            })
          )
        } catch {
          /* ignore quota errors */
        }
      }
      navigate(path)
    },
    [navigate, selectedCompany, companyConnections, searchParams, viewMode]
  )

  // Fire the search RPC each time the debounced query settles.
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setSearchResults([])
      return
    }
    let cancelled = false
    setIsSearching(true)
    searchCompanies(debouncedQuery)
      .then(results => {
        if (!cancelled) setSearchResults(results || [])
      })
      .catch(err => {
        if (!cancelled) console.error('Search error:', err)
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, searchCompanies])

  // Handle company selection from search — only navigate, let useEffect handle loading
  const handleSelectCompany = company => {
    setSearchQuery('')
    setSearchResults([])
    setSavedGraphState(null)
    navigate(`/network?company=${company.id}`)
  }

  // Go back — always browser-back so user returns to exactly where they were
  const handleReset = () => navigate(-1)

  // Boycott view
  if (selectedBoycott) {
    const fakeCompany = {
      id: `boycott-${selectedBoycott.id}`,
      name: selectedBoycott.name,
      logo_url: null,
      isOrigin: true,
      label: selectedBoycott.name,
      isBoycott: true,
    }

    const boycottCompanies = (selectedBoycott.boycott_companies || []).filter(c => c.companies)

    const fakeConnections = {
      owns: boycottCompanies.map(c => c.companies),
      owned_by: [],
      suppliers: [],
      customers: [],
      brands: [],
      // User-claimed companies hang off the boycott root with a dashed style.
      // Prefix the id with "user:" so it never collides with a Neo4j id and
      // the click handler can route appropriately.
      user_added: userClaimedCompanies.map(uc => ({
        id: `user:${uc.id}`,
        name: uc.name,
        logo_url: null,
      })),
    }

    // Build autoExpand map: for each boycotted company, expand the connection types that are blocked
    const autoExpandMap = new Map()
    for (const entry of boycottCompanies) {
      const id = getCompanyLinkId(entry.companies) || entry.companies.id
      const types = []
      if (entry.block_owns) types.push('owns')
      if (entry.block_owned_by) types.push('owned_by')
      if (entry.block_brands) types.push('brands')
      if (entry.block_suppliers) types.push('suppliers')
      if (entry.block_customers) types.push('customers')
      if (types.length > 0) autoExpandMap.set(id, types)
    }

    return (
      <div className='container' style={{ paddingBottom: 0 }}>
        <Header pageLabel='Network' />
        <div style={explorerLayout}>
          <div style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)' }}>
            <button onClick={handleReset} style={headerBtnStyle}>
              <ArrowLeft size={14} />
              Back
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <OrgChartGraph
              ref={graphRef}
              company={fakeCompany}
              connections={fakeConnections}
              autoExpand={autoExpandMap}
              clickAction='open'
              onCompanyClick={(id, connectionType, nodeInfo) => {
                if (String(id).startsWith('boycott-')) return
                // User-claimed nodes don't exist in Neo4j; route back to the
                // boycott detail where the user-claims panel lives.
                if (String(id).startsWith('user:')) {
                  navigate(`/boycott/${selectedBoycott.id}`)
                  return
                }
                // Brands / people still navigate directly (no graph-side
                // expansion model for those today).
                if (connectionType === 'brands') {
                  navigate(`/brand/${id}`)
                  return
                }
                if (connectionType === 'people') {
                  navigate(`/person/${id}`)
                  return
                }
                // Companies → open the detail sheet so user can review +
                // pick Open or Expand instead of being teleported away.
                setSheetNode({
                  id,
                  type: connectionType,
                  name: nodeInfo?.name,
                  logo_url: nodeInfo?.logo_url,
                })
              }}
            />
            {sheetNode && (
              <NetworkNodeSheet
                nodeId={sheetNode.id}
                hint={{ name: sheetNode.name, logo_url: sheetNode.logo_url }}
                onClose={() => setSheetNode(null)}
                onExpand={() => {
                  // Append the picked company's connections to the existing
                  // boycott graph rather than re-rooting it. The graph keeps
                  // the boycott as the origin; the picked node gains a child
                  // ring of its connections.
                  const id = sheetNode.id
                  setSheetNode(null)
                  graphRef.current?.expandNode(id)
                }}
                onOpen={() => {
                  const id = sheetNode.id
                  setSheetNode(null)
                  navigate(`/company/${id}`)
                }}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  // Company explorer view (single early return instead of duplicated JSX)
  if (selectedCompany && companyConnections && !loading) {
    return (
      <div className='container' style={{ paddingBottom: 0 }}>
        <Header pageLabel='Network' />
        <div style={explorerLayout}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-2) 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
              <button
                onClick={() => setViewMode('graph')}
                style={{
                  ...headerBtnStyle,
                  background: viewMode === 'graph' ? 'var(--accent)' : 'transparent',
                  color: viewMode === 'graph' ? '#fff' : 'var(--text-secondary)',
                  borderColor: viewMode === 'graph' ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <Share2 size={14} />
                Graph
              </button>
              <button
                onClick={() => setViewMode('list')}
                style={{
                  ...headerBtnStyle,
                  background: viewMode === 'list' ? 'var(--accent)' : 'transparent',
                  color: viewMode === 'list' ? '#fff' : 'var(--text-secondary)',
                  borderColor: viewMode === 'list' ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <LayoutList size={14} />
                List
              </button>
            </div>
            <button onClick={handleReset} style={headerBtnStyle}>
              <Search size={14} />
              New Search
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {viewMode === 'graph' ? (
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <OrgChartGraph
                  ref={graphRef}
                  company={selectedCompany}
                  connections={companyConnections}
                  graphStateRef={graphStateRef}
                  savedGraphState={savedGraphState}
                  onCompanyClick={(id, connectionType, nodeInfo) => {
                    // Brands + people don't have a graph-expand path — jump straight.
                    if (connectionType === 'brands') {
                      saveAndNavigate(`/brand/${id}`)
                      return
                    }
                    if (connectionType === 'people') {
                      saveAndNavigate(`/person/${id}`)
                      return
                    }
                    // Company nodes → open detail sheet
                    setSheetNode({
                      id,
                      type: connectionType,
                      name: nodeInfo?.name,
                      logo_url: nodeInfo?.logo_url,
                    })
                  }}
                />
                {sheetNode && (
                  <NetworkNodeSheet
                    nodeId={sheetNode.id}
                    hint={{ name: sheetNode.name, logo_url: sheetNode.logo_url }}
                    onClose={() => setSheetNode(null)}
                    onExpand={() => {
                      // Append connections in-place — keep the existing root
                      // (selectedCompany), grow the graph outward.
                      const id = sheetNode.id
                      setSheetNode(null)
                      graphRef.current?.expandNode(id)
                    }}
                    onOpen={() => {
                      const id = sheetNode.id
                      setSheetNode(null)
                      saveAndNavigate(`/company/${id}`)
                    }}
                  />
                )}
              </div>
            ) : (
              <CompanyListView
                company={selectedCompany}
                connections={companyConnections}
                onCompanyClick={id => saveAndNavigate(`/company/${id}`)}
                onBrandClick={id => saveAndNavigate(`/brand/${id}`)}
                onPersonClick={id => saveAndNavigate(`/person/${id}`)}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  // Error view — Neo4j fetch failed or company not found. Shown instead of
  // a blank screen so users get an actionable message + a way back.
  if (loadError) {
    const isNotFound = loadError === 'not-found'
    return (
      <div className='container' style={{ paddingBottom: 0 }}>
        <Header pageLabel='Network' />
        <div
          style={{
            textAlign: 'center',
            padding: 'var(--space-10) var(--space-5)',
            maxWidth: '480px',
            margin: '0 auto',
          }}
        >
          <h2
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--font-semibold)',
              marginBottom: 'var(--space-3)',
            }}
          >
            {isNotFound ? 'Company not found' : "Couldn't load this company"}
          </h2>
          <p
            style={{
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-6)',
              lineHeight: 'var(--leading-relaxed)',
            }}
          >
            {isNotFound
              ? "We couldn't find a company with that ID. It may have been removed or the link may be wrong."
              : 'The connection to our knowledge graph failed. Check your network and try again — your data is safe.'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
            <button
              onClick={() => {
                setLoadError(null)
                navigate('/network')
              }}
              style={headerBtnStyle}
            >
              New search
            </button>
            {!isNotFound && (
              <button
                onClick={() => {
                  const companyId = searchParams.get('company')
                  if (companyId) {
                    setLoadError(null)
                    loadCompany(companyId)
                  }
                }}
                style={{
                  ...headerBtnStyle,
                  background: 'var(--gradient-accent)',
                  color: 'var(--text-on-accent)',
                  borderColor: 'var(--accent)',
                }}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Search view
  return (
    <div className='container' style={{ paddingBottom: 0 }}>
      <Header pageLabel='Network' />

      <AnimatePresence mode='wait'>
        {showSearch && !selectedCompany ? (
          <motion.div
            key='search'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={spring}
            style={{ paddingBottom: '100px' }}
          >
            {/* Hero Section */}
            <div
              style={{
                textAlign: 'center',
                padding: 'var(--space-10) var(--space-5)',
                marginBottom: 'var(--space-6)',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  background: 'var(--accent)',
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto var(--space-5)',
                  opacity: 0.9,
                }}
              >
                <NetworkIcon size={40} color='#fff' />
              </div>
              <h1
                style={{
                  fontSize: 'var(--text-4xl)',
                  // Bebas Neue is never loaded — use the design display face.
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  letterSpacing: '2px',
                  marginBottom: 'var(--space-3)',
                }}
              >
                EXPLORE THE NETWORK
              </h1>
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-md)',
                  maxWidth: '400px',
                  margin: '0 auto',
                }}
              >
                Search for any company to visualize its corporate connections, subsidiaries, parent
                companies, and suppliers.
              </p>
            </div>

            {/* Search Box */}
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>
              <div style={{ position: 'relative', marginBottom: 'var(--space-6)' }}>
                <Search
                  size={20}
                  style={{
                    position: 'absolute',
                    left: 'var(--space-4)',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type='text'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder='Search companies...'
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  style={{
                    width: '100%',
                    background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
                    borderRadius: 'var(--radius-card, 14px)',
                    padding: 'var(--space-4) var(--space-4) var(--space-4) var(--space-12)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-lg)',
                    outline: 'none',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSearchResults([])
                    }}
                    style={{
                      position: 'absolute',
                      right: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 'var(--space-1)',
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Search Status */}
              {isSearching && (
                <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                  <div className='spinner'></div>
                </div>
              )}

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div
                  style={{
                    background: 'var(--glass-card, rgba(30,30,50,0.35))',
                    backdropFilter: 'blur(var(--glass-blur, 20px))',
                    WebkitBackdropFilter: 'blur(var(--glass-blur, 20px))',
                    border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
                    borderRadius: 'var(--radius-card, 14px)',
                    maxHeight: '400px',
                    overflowY: 'auto',
                    overflow: 'hidden',
                  }}
                >
                  {searchResults.map((company, index) => (
                    <button
                      key={company.id}
                      onClick={() => handleSelectCompany(company)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3-5) var(--space-4)',
                        background: 'transparent',
                        border: 'none',
                        borderBottom:
                          index < searchResults.length - 1 ? '1px solid var(--border)' : 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'inherit',
                        minHeight: '64px',
                      }}
                    >
                      <LazyImage
                        src={company.logo_url}
                        alt={company.name}
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: 'var(--radius-md)',
                          objectFit: 'contain',
                          background: 'var(--bg-elevated)',
                          flexShrink: 0,
                        }}
                        fallback={
                          <div
                            style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--accent)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#fff',
                              fontWeight: 'var(--font-semibold)',
                              flexShrink: 0,
                            }}
                          >
                            {company.name?.charAt(0)}
                          </div>
                        }
                      />
                      <div style={{ flex: 1 }}>
                        <div
                          style={{ fontWeight: 'var(--font-medium)', fontSize: 'var(--text-md)' }}
                        >
                          {company.name}
                        </div>
                        {company.hq_location && (
                          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                            {company.hq_location}
                          </div>
                        )}
                      </div>
                      <span style={{ color: 'var(--accent)', fontSize: 'var(--text-sm)' }}>
                        Explore →
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* No Results */}
              {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 'var(--space-8)',
                    color: 'var(--text-muted)',
                  }}
                >
                  No companies found matching &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          </motion.div>
        ) : loading ? (
          <motion.div
            key='loading'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              textAlign: 'center',
              padding: '80px var(--space-5)',
            }}
          >
            <div
              className='spinner'
              role='status'
              aria-label='Loading network'
              style={{ margin: '0 auto var(--space-4)' }}
            />
            <p style={{ color: 'var(--text-muted)' }}>Loading network...</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

const explorerLayout = {
  marginBottom: 0,
  height: 'calc(100dvh - 140px)',
  display: 'flex',
  flexDirection: 'column',
}

const headerBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--border)',
  padding: 'var(--space-2) var(--space-4)',
  minHeight: '40px',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-1-5)',
}

/**
 * CompanyListView — Text/list alternative to the canvas graph.
 * Shows all connection groups as expandable sections.
 */
function CompanyListView({ company, connections, onCompanyClick, onBrandClick, onPersonClick }) {
  const [expanded, setExpanded] = useState(new Set(['owns', 'owned_by']))

  const toggle = key => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const groups = [
    { key: 'owned_by', label: 'Parent Companies', items: connections.owned_by || [] },
    { key: 'owns', label: 'Subsidiaries', items: connections.owns || [] },
    { key: 'invested_in_by', label: 'Investors', items: connections.invested_in_by || [] },
    { key: 'invests_in', label: 'Investments', items: connections.invests_in || [] },
    { key: 'brands', label: 'Brands', items: connections.brands || [] },
    { key: 'suppliers', label: 'Suppliers', items: connections.suppliers || [] },
    { key: 'customers', label: 'Customers', items: connections.customers || [] },
    {
      key: 'people',
      label: 'Key People',
      items: (connections.people || []).map(p => ({
        ...p,
        name: p.name + (p.role ? ` (${p.role.replace(/_/g, ' ').toLowerCase()})` : ''),
      })),
    },
  ].filter(g => g.items.length > 0)

  const totalConnections = groups.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        padding: 'var(--space-5) 0',
        background: 'var(--bg-elevated)',
      }}
    >
      {/* Company header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3-5)',
          padding: '0 var(--space-5) var(--space-5)',
          borderBottom: '1px solid var(--border)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {company.logo_url ? (
          <img
            src={company.logo_url}
            alt={company.name}
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-lg)',
              objectFit: 'contain',
              background: 'var(--bg-elevated)',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-lg)',
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 'var(--text-2xl)',
              fontWeight: 'var(--font-semibold)',
              flexShrink: 0,
            }}
          >
            {company.name?.charAt(0)}
          </div>
        )}
        <div>
          <div style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-xl)' }}>
            {company.name}
          </div>
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
            {totalConnections > 0
              ? `${totalConnections} connections across ${groups.length} categories`
              : 'No known connections'}
          </div>
        </div>
      </div>

      {/* Connection groups */}
      <div
        style={{
          padding: '0 var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {groups.map(group => {
          const isExpanded = expanded.has(group.key)
          const color = CONNECTION_COLORS[group.key]

          return (
            <div
              key={group.key}
              style={{
                background: 'var(--glass-card, rgba(30,30,50,0.35))',
                backdropFilter: 'blur(var(--glass-blur, 20px))',
                WebkitBackdropFilter: 'blur(var(--glass-blur, 20px))',
                border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
                borderRadius: 'var(--radius-card, 14px)',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => toggle(group.key)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2-5)',
                  padding: 'var(--space-3-5) var(--space-4)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 'var(--radius-full)',
                    background: color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontWeight: 'var(--font-semibold)',
                    fontSize: 'var(--text-md)',
                    flex: 1,
                  }}
                >
                  {group.label}
                </span>
                <span
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                    marginRight: 'var(--space-2)',
                  }}
                >
                  {group.items.length}
                </span>
                {isExpanded ? (
                  <ChevronDown size={16} color='var(--text-muted)' />
                ) : (
                  <ChevronRight size={16} color='var(--text-muted)' />
                )}
              </button>

              {isExpanded && (
                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    padding: 'var(--space-1) 0',
                  }}
                >
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() =>
                        group.key === 'brands'
                          ? onBrandClick(item.id)
                          : group.key === 'people'
                            ? onPersonClick?.(item.id)
                            : onCompanyClick(item.id)
                      }
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2-5)',
                        padding: 'var(--space-2-5) var(--space-4)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      {item.logo_url ? (
                        <img
                          src={item.logo_url}
                          alt={item.name}
                          onError={e => {
                            e.target.style.display = 'none'
                          }}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 'var(--radius-md)',
                            objectFit: 'contain',
                            background: 'var(--bg-elevated)',
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 'var(--radius-md)',
                            background: color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontSize: 'var(--text-xs2)',
                            fontWeight: 'var(--font-semibold)',
                            flexShrink: 0,
                          }}
                        >
                          {item.name?.charAt(0)}
                        </div>
                      )}
                      <span style={{ fontSize: 'var(--text-base)', flex: 1 }}>{item.name}</span>
                      <ChevronRight size={14} color='var(--text-muted)' />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {groups.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: 'var(--space-10)',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-md)',
            }}
          >
            No connections found for this company.
          </div>
        )}
      </div>
    </div>
  )
}
