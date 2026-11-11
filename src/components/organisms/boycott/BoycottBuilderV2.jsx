/**
 * @component BoycottBuilderV2
 * @level Organism
 * @interactions
 *   - Visual node-connector interface for building boycotts (currently disabled in UI)
 *   - Horizontal tree layout with parent seeds on left, expandable connection groups on right
 *   - Fetches company connections from Neo4j API and auto-selects subsidiaries and brands
 */
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight, Loader2, Plus, Search, X } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

import { getCompanyWithConnections, isNeo4jId, searchCompanies } from '../../../services/neo4jGraph'

/**
 * Clean, calm node-connector interface for building boycotts
 * Horizontal tree layout: parent on left, connection groups on right (expandable)
 */
export default function BoycottBuilderV2({ initialSeeds = [], onSelectionChange }) {
  const [seeds, setSeeds] = useState([])
  const [expandedNodes, setExpandedNodes] = useState({})
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [loadingNodes, setLoadingNodes] = useState(new Set())
  // Track which connection groups are expanded (e.g., "seedId-owns")
  const [expandedGroups, setExpandedGroups] = useState(new Set())

  // Initialize from props (only on mount)
  useEffect(() => {
    if (initialSeeds?.length > 0 && seeds.length === 0) {
      const newSeeds = initialSeeds.filter(s => s?.id && isNeo4jId(s.id))
      if (newSeeds.length > 0) {
        newSeeds.forEach(seed => addSeed(seed))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Notify parent of selection changes
  useEffect(() => {
    if (onSelectionChange) {
      const allSelected = []
      seeds.forEach(seed => {
        if (selectedIds.has(seed.id)) allSelected.push(seed)
      })
      Object.values(expandedNodes).forEach(node => {
        ;[...(node.owns || []), ...(node.brands || [])].forEach(child => {
          if (selectedIds.has(child.id)) allSelected.push(child)
        })
      })
      onSelectionChange(allSelected)
    }
  }, [selectedIds, seeds, expandedNodes, onSelectionChange])

  // Search companies
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const results = await searchCompanies(searchQuery, 10)
        setSearchResults(results || [])
      } catch {
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Add a seed company
  const addSeed = useCallback(
    async company => {
      if (!company?.id || seeds.some(s => s.id === company.id)) return
      if (!isNeo4jId(company.id)) return

      setLoadingNodes(prev => new Set([...prev, company.id]))
      setSeeds(prev => [...prev, company])
      setSelectedIds(prev => new Set([...prev, company.id]))

      try {
        const fullCompany = await getCompanyWithConnections(company.id)
        if (fullCompany?.connections) {
          const owns = fullCompany.connections.owns || []
          const brands = fullCompany.connections.brands || []
          setExpandedNodes(prev => ({ ...prev, [company.id]: { owns, brands } }))
          // Auto-select all children
          const newIds = new Set()
          owns.forEach(c => newIds.add(c.id))
          brands.forEach(c => newIds.add(c.id))
          setSelectedIds(prev => new Set([...prev, ...newIds]))
        }
      } catch (err) {
        console.error('Error loading connections:', err)
      } finally {
        setLoadingNodes(prev => {
          const next = new Set(prev)
          next.delete(company.id)
          return next
        })
      }

      setSearchQuery('')
      setSearchResults([])
    },
    [seeds]
  )

  const removeSeed = useCallback(
    seedId => {
      setSeeds(prev => prev.filter(s => s.id !== seedId))
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(seedId)
        const children = expandedNodes[seedId]
        if (children) {
          ;[...(children.owns || []), ...(children.brands || [])].forEach(c => next.delete(c.id))
        }
        return next
      })
      setExpandedNodes(prev => {
        const next = { ...prev }
        delete next[seedId]
        return next
      })
    },
    [expandedNodes]
  )

  const toggleChild = useCallback(childId => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(childId)) next.delete(childId)
      else next.add(childId)
      return next
    })
  }, [])

  // Toggle all children in a group
  const toggleGroup = useCallback((seedId, groupType, children) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = children.every(c => next.has(c.id))
      if (allSelected) {
        // Deselect all
        children.forEach(c => next.delete(c.id))
      } else {
        // Select all
        children.forEach(c => next.add(c.id))
      }
      return next
    })
  }, [])

  // Toggle group expansion
  const toggleGroupExpanded = useCallback((seedId, groupType) => {
    const key = `${seedId}-${groupType}`
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <div style={styles.container}>
      {/* Header with search and add button */}
      <div style={styles.header}>
        <div style={styles.searchWrapper}>
          <Search style={styles.searchIcon} />
          <input
            type='text'
            placeholder='Search companies to add...'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
          {isSearching && <Loader2 style={styles.loader} />}

          {/* Search dropdown */}
          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                style={styles.dropdown}
              >
                {searchResults.map(company => (
                  <button
                    key={company.id}
                    onClick={() => addSeed(company)}
                    disabled={seeds.some(s => s.id === company.id)}
                    style={{
                      ...styles.dropdownItem,
                      background: seeds.some(s => s.id === company.id) ? '#f5f5f5' : '#fff',
                    }}
                  >
                    {company.logo_url ? (
                      <img
                        src={company.logo_url}
                        alt={company.name}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          objectFit: 'contain',
                          background: '#fff',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div style={styles.dropdownAvatar}>{company.name?.charAt(0)}</div>
                    )}
                    <div style={styles.dropdownText}>
                      <div style={styles.dropdownName}>{company.name}</div>
                      {company.hq_location && (
                        <div style={styles.dropdownMeta}>{company.hq_location}</div>
                      )}
                    </div>
                    {seeds.some(s => s.id === company.id) ? (
                      <span style={styles.addedBadge}>Added</span>
                    ) : (
                      <Plus style={{ width: 18, height: 18, color: '#f0c14b' }} />
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Add Company button - prominent */}
        <button
          onClick={() => document.querySelector('input[placeholder*="Search"]')?.focus()}
          style={styles.addButton}
        >
          <Plus style={{ width: 18, height: 18 }} />
          Add Company
        </button>
      </div>

      {/* Main canvas */}
      <div style={styles.canvas}>
        {seeds.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>
              <Search style={{ width: 32, height: 32, color: '#f0c14b' }} />
            </div>
            <div style={styles.emptyTitle}>Search for a company to start</div>
            <div style={styles.emptySubtitle}>
              Add parent companies to see their subsidiaries and brands
            </div>
          </div>
        ) : (
          seeds.map(seed => (
            <SeedTree
              key={seed.id}
              seed={seed}
              expanded={expandedNodes[seed.id]}
              selectedIds={selectedIds}
              expandedGroups={expandedGroups}
              onRemove={removeSeed}
              onToggleChild={toggleChild}
              onToggleGroup={toggleGroup}
              onToggleGroupExpanded={toggleGroupExpanded}
              isLoading={loadingNodes.has(seed.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <div>
          <strong>{selectedIds.size}</strong> entities selected
        </div>
        <div style={{ color: '#999', fontSize: 12 }}>
          {seeds.length} parent{seeds.length !== 1 ? 's' : ''} •{' '}
          {Object.values(expandedNodes).reduce(
            (a, n) => a + (n.owns?.length || 0) + (n.brands?.length || 0),
            0
          )}{' '}
          connections
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

/* Seed tree component with collapsible connection groups — ref-based SVG alignment */
function SeedTree({
  seed,
  expanded,
  selectedIds,
  expandedGroups,
  onRemove,
  onToggleChild,
  onToggleGroup,
  onToggleGroupExpanded,
  isLoading,
}) {
  const owns = expanded?.owns || []
  const brands = expanded?.brands || []
  const hasOwns = owns.length > 0
  const hasBrands = brands.length > 0
  const hasConnections = hasOwns || hasBrands

  const ownsExpanded = expandedGroups.has(`${seed.id}-owns`)
  const brandsExpanded = expandedGroups.has(`${seed.id}-brands`)

  const ownsSelectedCount = owns.filter(c => selectedIds.has(c.id)).length
  const brandsSelectedCount = brands.filter(c => selectedIds.has(c.id)).length

  // Ref-based SVG alignment
  const containerRef = useRef(null)
  const ownsRef = useRef(null)
  const brandsRef = useRef(null)
  const [containerHeight, setContainerHeight] = useState(0)
  const [lineTargets, setLineTargets] = useState([])

  const measurePositions = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    setContainerHeight(containerRect.height)
    const targets = []
    if (hasOwns && ownsRef.current) {
      const r = ownsRef.current.getBoundingClientRect()
      targets.push(r.top - containerRect.top + r.height / 2)
    }
    if (hasBrands && brandsRef.current) {
      const r = brandsRef.current.getBoundingClientRect()
      targets.push(r.top - containerRect.top + r.height / 2)
    }
    setLineTargets(targets)
  }, [hasOwns, hasBrands])

  useEffect(() => {
    const raf = requestAnimationFrame(() => measurePositions())
    return () => cancelAnimationFrame(raf)
  }, [measurePositions, ownsExpanded, brandsExpanded])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => measurePositions())
    observer.observe(container)
    return () => observer.disconnect()
  }, [measurePositions])

  const hubY = containerHeight / 2
  const svgWidth = 60

  return (
    <div style={styles.treeContainer}>
      {/* Parent node */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        style={styles.parentNode}
      >
        <button onClick={() => onRemove(seed.id)} style={styles.removeBtn}>
          <X style={{ width: 14, height: 14 }} />
        </button>
        {seed.logo_url && (
          <img
            src={seed.logo_url}
            alt={seed.name}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              objectFit: 'contain',
              background: '#fff',
              marginBottom: 4,
            }}
          />
        )}
        <div style={styles.parentName}>{seed.name}</div>
        <div style={styles.parentLabel}>(Parent)</div>
        {isLoading && <Loader2 style={styles.parentLoader} />}
      </motion.div>

      {/* Connection groups */}
      {hasConnections && (
        <div ref={containerRef} style={styles.connectionsArea}>
          {/* SVG connector — lines drawn to measured positions */}
          <svg
            width={svgWidth}
            height={containerHeight || 1}
            style={{ ...styles.svg, minHeight: 0 }}
          >
            {containerHeight > 0 && (
              <>
                <line x1='0' y1={hubY} x2='30' y2={hubY} stroke='#ccc' strokeWidth='2' />
                <circle cx='30' cy={hubY} r='6' fill='#e0e0e0' stroke='#ccc' strokeWidth='2' />
                {lineTargets.map((y, i) => (
                  <line
                    key={i}
                    x1='30'
                    y1={hubY}
                    x2={svgWidth}
                    y2={y}
                    stroke='#ccc'
                    strokeWidth='2'
                  />
                ))}
              </>
            )}
          </svg>

          {/* Connection type groups */}
          <div style={styles.groupsColumn}>
            {hasOwns && (
              <ConnectionGroup
                ref={ownsRef}
                seedId={seed.id}
                type='owns'
                label='SUBSIDIARIES'
                children={owns}
                selectedCount={ownsSelectedCount}
                isExpanded={ownsExpanded}
                selectedIds={selectedIds}
                onToggleExpanded={() => onToggleGroupExpanded(seed.id, 'owns')}
                onToggleAll={() => onToggleGroup(seed.id, 'owns', owns)}
                onToggleChild={onToggleChild}
                color='#f0c14b'
              />
            )}

            {hasBrands && (
              <ConnectionGroup
                ref={brandsRef}
                seedId={seed.id}
                type='brands'
                label='BRANDS'
                children={brands}
                selectedCount={brandsSelectedCount}
                isExpanded={brandsExpanded}
                selectedIds={selectedIds}
                onToggleExpanded={() => onToggleGroupExpanded(seed.id, 'brands')}
                onToggleAll={() => onToggleGroup(seed.id, 'brands', brands)}
                onToggleChild={onToggleChild}
                color='#888'
              />
            )}
          </div>
        </div>
      )}

      {!hasConnections && !isLoading && <div style={styles.noChildren}>No known subsidiaries</div>}
    </div>
  )
}

/* Connection group node (expandable) — forwardRef for SVG alignment */
const ConnectionGroup = forwardRef(function ConnectionGroup(
  {
    label,
    children,
    selectedCount,
    isExpanded,
    selectedIds,
    onToggleExpanded,
    onToggleAll,
    onToggleChild,
    color,
  },
  ref
) {
  const allSelected = selectedCount === children.length
  const someSelected = selectedCount > 0 && selectedCount < children.length

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      style={styles.groupContainer}
    >
      {/* Group header node — ref for SVG measurement */}
      <div ref={ref} style={styles.groupHeader}>
        <button onClick={onToggleExpanded} style={styles.expandBtn}>
          {isExpanded ? (
            <ChevronDown style={{ width: 16, height: 16, color: '#666' }} />
          ) : (
            <ChevronRight style={{ width: 16, height: 16, color: '#666' }} />
          )}
        </button>

        <button
          onClick={onToggleAll}
          style={{
            ...styles.groupNode,
            background: allSelected ? color : someSelected ? `${color}40` : '#f8f8f8',
            borderColor: allSelected || someSelected ? color : '#ddd',
          }}
        >
          <span style={{ fontWeight: 600, color: allSelected ? '#fff' : '#333' }}>{label}</span>
          <span
            style={{
              fontSize: 11,
              color: allSelected ? 'rgba(255,255,255,0.8)' : '#888',
              marginLeft: 6,
            }}
          >
            ({selectedCount}/{children.length})
          </span>
        </button>

        <div style={{ ...styles.groupDot, background: color }} />
      </div>

      {/* Expanded children */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={styles.childrenList}
          >
            {children.map((child, i) => (
              <motion.button
                key={child.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onToggleChild(child.id)}
                style={{
                  ...styles.childNode,
                  background: selectedIds.has(child.id) ? '#e8e8e8' : '#fff',
                  borderColor: selectedIds.has(child.id) ? '#555' : '#ddd',
                }}
              >
                {child.logo_url && (
                  <img
                    src={child.logo_url}
                    alt={child.name}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 2,
                      objectFit: 'contain',
                      flexShrink: 0,
                    }}
                  />
                )}
                {child.name}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})

/* Styles */
const styles = {
  container: {
    width: '100%',
    height: '100%',
    background: '#f5f5f5',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  header: {
    padding: '14px 20px',
    borderBottom: '1px solid #e0e0e0',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  searchWrapper: {
    position: 'relative',
    flex: 1,
    maxWidth: 400,
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 18,
    height: 18,
    color: '#999',
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px 10px 40px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
    background: '#fafafa',
    color: '#333',
  },
  loader: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 18,
    height: 18,
    color: '#999',
    animation: 'spin 1s linear infinite',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
    border: '1px solid #e0e0e0',
    maxHeight: 280,
    overflowY: 'auto',
    zIndex: 100,
  },
  dropdownItem: {
    width: '100%',
    padding: '10px 14px',
    border: 'none',
    borderBottom: '1px solid #f0f0f0',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  dropdownAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#f0c14b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 600,
    color: '#333',
    flexShrink: 0,
  },
  dropdownText: { flex: 1, minWidth: 0 },
  dropdownName: { fontSize: 14, fontWeight: 500, color: '#333' },
  dropdownMeta: { fontSize: 12, color: '#888' },
  addedBadge: { fontSize: 11, color: '#888' },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 16px',
    background: '#f0c14b',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    color: '#333',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  canvas: {
    flex: 1,
    padding: 32,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#888',
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: 'rgba(240, 193, 75, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 15, fontWeight: 500, marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: '#aaa' },
  footer: {
    padding: '10px 20px',
    borderTop: '1px solid #e0e0e0',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 13,
    color: '#555',
  },
  treeContainer: {
    display: 'flex',
    alignItems: 'flex-start',
  },
  parentNode: {
    width: 140,
    height: 140,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #f7e198 0%, #f0c14b 100%)',
    border: '3px solid #e5a820',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    position: 'relative',
    boxShadow: '0 4px 12px rgba(240, 193, 75, 0.25)',
    flexShrink: 0,
  },
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: '#fff',
    border: '1px solid #ddd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    color: '#666',
  },
  parentName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#333',
    textAlign: 'center',
    lineHeight: 1.2,
    wordBreak: 'break-word',
  },
  parentLabel: { fontSize: 11, color: '#666', marginTop: 2 },
  parentLoader: {
    position: 'absolute',
    bottom: -6,
    width: 16,
    height: 16,
    color: '#e5a820',
    animation: 'spin 1s linear infinite',
  },
  connectionsArea: {
    display: 'flex',
    alignItems: 'flex-start',
    marginLeft: -8,
  },
  svg: { overflow: 'visible', flexShrink: 0 },
  groupsColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingTop: 20,
  },
  groupContainer: {
    display: 'flex',
    flexDirection: 'column',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  expandBtn: {
    width: 24,
    height: 24,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  groupNode: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    borderRadius: 20,
    border: '2px solid #ddd',
    cursor: 'pointer',
    fontSize: 12,
    transition: 'all 0.15s',
  },
  groupDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    marginLeft: 8,
  },
  childrenList: {
    marginLeft: 28,
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    overflow: 'hidden',
  },
  childNode: {
    padding: '6px 12px',
    borderRadius: 16,
    border: '1px solid #ddd',
    cursor: 'pointer',
    fontSize: 12,
    color: '#333',
    textAlign: 'left',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 180,
  },
  noChildren: {
    marginLeft: 20,
    padding: '10px 14px',
    background: '#fff',
    borderRadius: 8,
    border: '1px dashed #ddd',
    color: '#888',
    fontSize: 12,
    alignSelf: 'center',
  },
}
