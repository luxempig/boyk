/**
 * @component NvlNetworkGraph
 * @level Organism
 * @interactions Interactive network graph powered by Neo4j NVL with force-directed/hierarchical layouts,
 *   click-to-expand popover, in-graph search, and auto-expand for boycott views.
 */
import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  assignChildPositions,
  assignHierarchicalPositions,
  assignRadialPositions,
  deduplicateElements,
  mapCompanyToNvl,
  mapConnectionsToNvl,
} from '../../lib/nvlMappers'
import { getCompanyLinkId, getCompanyWithConnections } from '../../services/neo4jGraph'
import GraphLegend from '../molecules/GraphLegend'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// User-facing layout modes (we compute positions manually for both)
const LAYOUT_FORCE = 'radial'
const LAYOUT_HIERARCHY = 'hierarchical'

// Shared pill style for overlay controls — uses CSS vars for theme compat
const PILL = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-xs2)',
  color: 'var(--text-secondary)',
  userSelect: 'none',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build initial NVL nodes + rels from company props, with radial positions. */
function buildInitialGraph(company, connections) {
  const originId = getCompanyLinkId(company) || company.id
  const originNode = mapCompanyToNvl(company, { isOrigin: true })
  const { nodes: childNodes, rels } = mapConnectionsToNvl(originId, connections || {})
  const nodes = [originNode, ...childNodes]
  assignRadialPositions(nodes, originId, connections)
  return { nodes, rels, originId }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NvlNetworkGraph({
  company,
  connections,
  onCompanyClick,
  autoExpand,
  graphStateRef,
  savedGraphState,
}) {
  const nvlRef = useRef(null)

  // Node/rel state
  const [nodes, setNodes] = useState([])
  const [rels, setRels] = useState([])

  // Dedup sets — tracked via ref for O(1) lookups without re-renders
  const nodeIdsRef = useRef(new Set())
  const relIdsRef = useRef(new Set())

  // Metadata: maps node id -> { connectionType } for click routing
  const nodeMetaRef = useRef(new Map())

  // Layout toggle
  const [layout, setLayout] = useState(LAYOUT_FORCE)

  // Loading indicator for expansion
  const [expanding, setExpanding] = useState(false)

  // Track which nodes have been expanded
  const expandedNodesRef = useRef(new Set())

  // Guard against concurrent expansions
  const expandingRef = useRef(false)

  // Connections ref for layout recomputation
  const connectionsRef = useRef(null)

  // Origin ID ref for stable callbacks
  const originIdRef = useRef(null)

  // Wrapper ref to hold the InteractiveNvlWrapper component (lazy-loaded)
  const [NvlComponent, setNvlComponent] = useState(null)

  // Container ref for wheel-event override
  const containerRef = useRef(null)

  // Node action popover state
  const [popover, setPopover] = useState(null)
  const popoverRef = useRef(null)

  // In-graph search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef(null)

  // ---------------------------------------------------------------------------
  // Prevent page scroll over graph — allows NVL wheel-zoom to work
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = e => e.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [NvlComponent])

  // ---------------------------------------------------------------------------
  // Lazy-load the NVL React wrapper
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    import('@neo4j-nvl/react').then(mod => {
      if (!cancelled) {
        setNvlComponent(() => mod.InteractiveNvlWrapper)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Initialize graph when company/connections change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!company) return

    const originId = getCompanyLinkId(company) || company.id
    originIdRef.current = originId
    connectionsRef.current = connections

    // Restore from saved state if available (e.g. back-navigation)
    if (savedGraphState?.nodes?.length) {
      const saved = savedGraphState
      setNodes(saved.nodes)
      setRels(saved.rels)
      nodeIdsRef.current = new Set(saved.nodes.map(n => n.id))
      relIdsRef.current = new Set(saved.rels.map(r => r.id))
      expandedNodesRef.current = new Set(saved.expandedNodeIds || [])
      nodeMetaRef.current = new Map(Object.entries(saved.nodeMeta || {}))
      if (saved.layout) setLayout(saved.layout)

      const timer = setTimeout(() => {
        if (nvlRef.current?.fit) {
          nvlRef.current.fit(saved.nodes.map(n => n.id))
        }
      }, 600)
      return () => clearTimeout(timer)
    }

    // Normal initialization: build graph from company + connections
    const { nodes: initNodes, rels: initRels } = buildInitialGraph(company, connections)

    // Reset dedup tracking
    const nIds = new Set(initNodes.map(n => n.id))
    const rIds = new Set(initRels.map(r => r.id))
    nodeIdsRef.current = nIds
    relIdsRef.current = rIds
    expandedNodesRef.current = new Set()

    // Build metadata map
    const meta = new Map()
    if (connections) {
      for (const [type, items] of Object.entries(connections)) {
        if (!items?.length) continue
        for (const item of items) {
          const childId = getCompanyLinkId(item) || item.id
          meta.set(childId, { connectionType: type })
        }
      }
    }
    nodeMetaRef.current = meta

    setNodes(initNodes)
    setRels(initRels)

    // Apply radial positions and fit to view
    const timer = setTimeout(() => {
      const nvl = nvlRef.current
      if (!nvl) return
      if (nvl.setNodePositions) {
        nvl.setNodePositions(initNodes, false)
      }
      setTimeout(() => {
        if (nvl.fit) nvl.fit(initNodes.map(n => n.id))
      }, 300)
    }, 300)

    return () => clearTimeout(timer)
  }, [company?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Keep graphStateRef in sync so the parent can snapshot before navigating
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!graphStateRef) return
    graphStateRef.current = {
      nodes,
      rels,
      expandedNodeIds: [...expandedNodesRef.current],
      nodeMeta: Object.fromEntries(nodeMetaRef.current),
      layout,
    }
  }, [nodes, rels, layout, graphStateRef])

  // ---------------------------------------------------------------------------
  // Auto-expand for boycott views
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!autoExpand || autoExpand.size === 0 || !company) return

    let cancelled = false

    async function runAutoExpand() {
      const allNewNodes = []
      const allNewRels = []

      for (const [childId, expandTypes] of autoExpand.entries()) {
        if (cancelled) break
        if (!expandTypes?.length) continue
        if (expandedNodesRef.current.has(childId)) continue

        try {
          const data = await getCompanyWithConnections(childId)
          if (!data?.connections || cancelled) continue

          // Only expand the requested connection types
          const filteredConnections = {}
          for (const t of expandTypes) {
            if (data.connections[t]?.length) {
              filteredConnections[t] = data.connections[t]
            }
          }

          const { nodes: newNodes, rels: newRels } = mapConnectionsToNvl(
            childId,
            filteredConnections
          )
          const { nodes: dedupedNodes, rels: dedupedRels } = deduplicateElements(
            newNodes,
            newRels,
            nodeIdsRef.current,
            relIdsRef.current
          )

          // Update metadata
          for (const [type, items] of Object.entries(filteredConnections)) {
            if (!items?.length) continue
            for (const item of items) {
              const id = getCompanyLinkId(item) || item.id
              if (!nodeMetaRef.current.has(id)) {
                nodeMetaRef.current.set(id, { connectionType: type })
              }
            }
          }

          // Track IDs
          for (const n of dedupedNodes) nodeIdsRef.current.add(n.id)
          for (const r of dedupedRels) relIdsRef.current.add(r.id)

          allNewNodes.push(...dedupedNodes)
          allNewRels.push(...dedupedRels)
          expandedNodesRef.current.add(childId)
        } catch {
          /* skip nodes that fail to load */
        }
      }

      if (!cancelled && (allNewNodes.length > 0 || allNewRels.length > 0)) {
        // Position new nodes around their parent before adding to graph
        const nvl = nvlRef.current
        const positions = nvl?.getNodePositions?.() || []
        const posMap = new Map()
        for (const p of positions) {
          if (p?.id != null) posMap.set(p.id, { x: p.x || 0, y: p.y || 0 })
        }
        for (const [childId] of autoExpand.entries()) {
          const parentPos = posMap.get(childId)
          if (parentPos) {
            const childNodes = allNewNodes.filter(n =>
              allNewRels.some(
                r => (r.from === childId && r.to === n.id) || (r.to === childId && r.from === n.id)
              )
            )
            assignChildPositions(childNodes, parentPos.x, parentPos.y)
          }
        }

        setNodes(prev => [...prev, ...allNewNodes])
        setRels(prev => [...prev, ...allNewRels])

        // Fit all nodes after auto-expansion settles
        setTimeout(() => {
          if (!cancelled && nvlRef.current?.fit) {
            nvlRef.current.fit([...nodeIdsRef.current])
          }
        }, 800)
      }
    }

    runAutoExpand()
    return () => {
      cancelled = true
    }
  }, [autoExpand, company?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Expand a node's connections
  // ---------------------------------------------------------------------------
  const expandNode = useCallback(async nodeId => {
    if (!nodeId) return
    if (expandedNodesRef.current.has(nodeId)) return
    if (String(nodeId).startsWith('boycott-')) return
    if (expandingRef.current) return

    expandingRef.current = true
    setExpanding(true)
    setPopover(null)
    try {
      const data = await getCompanyWithConnections(nodeId)
      if (!data?.connections) return

      const { nodes: newNodes, rels: newRels } = mapConnectionsToNvl(nodeId, data.connections)
      const { nodes: dedupedNodes, rels: dedupedRels } = deduplicateElements(
        newNodes,
        newRels,
        nodeIdsRef.current,
        relIdsRef.current
      )

      // Update metadata
      for (const [type, items] of Object.entries(data.connections)) {
        if (!items?.length) continue
        for (const item of items) {
          const id = getCompanyLinkId(item) || item.id
          if (!nodeMetaRef.current.has(id)) {
            nodeMetaRef.current.set(id, { connectionType: type })
          }
        }
      }

      // Track IDs
      for (const n of dedupedNodes) nodeIdsRef.current.add(n.id)
      for (const r of dedupedRels) relIdsRef.current.add(r.id)
      expandedNodesRef.current.add(nodeId)

      if (dedupedNodes.length > 0 || dedupedRels.length > 0) {
        // Position new nodes around the expanded parent
        const positions = nvlRef.current?.getNodePositions?.() || []
        let parentX = 0
        let parentY = 0
        for (const p of positions) {
          if (p?.id === nodeId) {
            parentX = p.x || 0
            parentY = p.y || 0
            break
          }
        }
        assignChildPositions(dedupedNodes, parentX, parentY)

        setNodes(prev => [...prev, ...dedupedNodes])
        setRels(prev => [...prev, ...dedupedRels])
      }
    } catch (err) {
      console.error('Failed to expand node:', err)
    } finally {
      expandingRef.current = false
      setExpanding(false)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Node click: show action popover
  // ---------------------------------------------------------------------------
  const lastClickPosRef = useRef({ x: 0, y: 0 })
  const nodeClickedRef = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onPointerUp = e => {
      // Ignore clicks inside the popover so buttons can fire
      if (popoverRef.current?.contains(e.target)) return
      const rect = el.getBoundingClientRect()
      lastClickPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      nodeClickedRef.current = false
      Promise.resolve().then(() => {
        if (!nodeClickedRef.current) setPopover(null)
      })
    }
    el.addEventListener('pointerup', onPointerUp)
    return () => el.removeEventListener('pointerup', onPointerUp)
  }, [NvlComponent])

  const handleNodeClick = useCallback(node => {
    if (!node?.id) return
    nodeClickedRef.current = true
    const isBoycottNode = String(node.id).startsWith('boycott-')
    const isExpanded = expandedNodesRef.current.has(node.id)

    setPopover({
      nodeId: node.id,
      caption: node.caption || node.id,
      x: lastClickPosRef.current.x,
      y: lastClickPosRef.current.y,
      canExpand: !isBoycottNode && !isExpanded,
      connectionType: nodeMetaRef.current.get(node.id)?.connectionType,
    })
  }, [])

  const handlePopoverVisit = useCallback(() => {
    if (!popover || !onCompanyClick) return
    onCompanyClick(popover.nodeId, popover.connectionType)
    setPopover(null)
  }, [popover, onCompanyClick])

  const handlePopoverExpand = useCallback(() => {
    if (!popover) return
    expandNode(popover.nodeId)
  }, [popover, expandNode])

  // ---------------------------------------------------------------------------
  // In-graph search: filter nodes by caption, zoom to match
  // ---------------------------------------------------------------------------
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return []
    const q = searchQuery.toLowerCase()
    return nodes.filter(n => n.caption?.toLowerCase().includes(q)).slice(0, 8)
  }, [searchQuery, nodes])

  const handleSearchSelect = useCallback(nodeId => {
    setSearchQuery('')
    setSearchOpen(false)
    if (nvlRef.current?.fit) {
      nvlRef.current.fit([nodeId])
    }
  }, [])

  const handleSearchToggle = useCallback(() => {
    setSearchOpen(prev => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 50)
      } else {
        setSearchQuery('')
      }
      return !prev
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Mouse event callbacks for InteractiveNvlWrapper
  // ---------------------------------------------------------------------------
  const mouseEventCallbacks = useMemo(
    () => ({
      onNodeClick: handleNodeClick,
      onZoom: true,
      onPan: true,
    }),
    [handleNodeClick]
  )

  // ---------------------------------------------------------------------------
  // NVL options
  // ---------------------------------------------------------------------------
  const nvlOptions = useMemo(
    () => ({
      renderer: 'canvas',
      allowDynamicMinZoom: true,
      disableTelemetry: true,
      minZoom: 0.1,
      maxZoom: 3,
    }),
    []
  )

  // We always use "free" layout since we compute positions manually
  const nvlLayout = 'free'
  const layoutOptions = undefined

  // ---------------------------------------------------------------------------
  // Layout toggle
  // ---------------------------------------------------------------------------
  const toggleLayout = useCallback(() => {
    setLayout(prev => (prev === LAYOUT_FORCE ? LAYOUT_HIERARCHY : LAYOUT_FORCE))
  }, [])

  // ---------------------------------------------------------------------------
  // Handle layout change: recompute positions manually and apply
  // ---------------------------------------------------------------------------
  const prevLayoutRef = useRef(layout)
  useEffect(() => {
    if (layout === prevLayoutRef.current) return
    prevLayoutRef.current = layout

    const nvl = nvlRef.current
    if (!nvl || nodes.length === 0) return

    const oId = originIdRef.current
    // Recompute positions based on selected layout mode
    const positioned =
      layout === LAYOUT_HIERARCHY
        ? assignHierarchicalPositions([...nodes], oId, connectionsRef.current)
        : assignRadialPositions([...nodes], oId, connectionsRef.current)

    if (nvl.setNodePositions) {
      nvl.setNodePositions(positioned, false)
    }

    const timer = setTimeout(() => {
      if (nvl.fit) nvl.fit(nodes.map(n => n.id))
    }, 200)
    return () => clearTimeout(timer)
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!NvlComponent) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-base)',
        }}
      >
        Loading graph...
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* NVL graph */}
      <NvlComponent
        ref={nvlRef}
        nodes={nodes}
        rels={rels}
        layout={nvlLayout}
        layoutOptions={layoutOptions}
        nvlOptions={nvlOptions}
        mouseEventCallbacks={mouseEventCallbacks}
        style={{ width: '100%', height: '100%' }}
      />

      {/* ── Top-left: layout toggle ── */}
      <button
        onClick={toggleLayout}
        title={
          layout === LAYOUT_FORCE ? 'Switch to hierarchical layout' : 'Switch to radial layout'
        }
        style={{
          ...PILL,
          position: 'absolute',
          top: 'var(--space-3)',
          left: 'var(--space-3)',
          zIndex: 10,
          padding: 'var(--space-1-5) var(--space-3)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1-5)',
        }}
      >
        <span style={{ fontSize: 'var(--text-base)' }}>
          {layout === LAYOUT_FORCE ? '\u2B73' : '\u2B6E'}
        </span>
        {layout === LAYOUT_FORCE ? 'Hierarchical' : 'Radial'}
      </button>

      {/* ── Top-right: search ── */}
      <div
        style={{ position: 'absolute', top: 'var(--space-3)', right: 'var(--space-3)', zIndex: 10 }}
      >
        {searchOpen ? (
          <div style={{ position: 'relative' }}>
            <div
              style={{
                ...PILL,
                display: 'flex',
                alignItems: 'center',
                padding: 'var(--space-1) var(--space-2)',
                gap: 'var(--space-1-5)',
                width: 200,
              }}
            >
              <Search size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder='Find node...'
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-xs2)',
                  width: '100%',
                  padding: 'var(--space-0-5) 0',
                }}
              />
              <button
                onClick={handleSearchToggle}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                  display: 'flex',
                }}
              >
                <X size={13} />
              </button>
            </div>
            {searchResults.length > 0 && (
              <div
                style={{
                  ...PILL,
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 'var(--space-1)',
                  width: 200,
                  padding: 'var(--space-1) 0',
                  maxHeight: 200,
                  overflowY: 'auto',
                }}
              >
                {searchResults.map(n => (
                  <button
                    key={n.id}
                    onClick={() => handleSearchSelect(n.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      width: '100%',
                      padding: 'var(--space-1-5) var(--space-2-5)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontSize: 'var(--text-xs2)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-subtle)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 'var(--radius-full)',
                        background: n.color || 'var(--text-muted)',
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {n.caption}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={handleSearchToggle}
            style={{
              ...PILL,
              padding: 'var(--space-1-5) var(--space-3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1-5)',
            }}
          >
            <Search size={12} />
            Find
          </button>
        )}
      </div>

      {/* ── Bottom-left: legend ── */}
      <GraphLegend position='bottom-left' />

      {/* ── Node action popover ── */}
      {popover && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            left: popover.x,
            top: `calc(${popover.y}px + var(--space-3))`,
            transform: 'translateX(-50%)',
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-2) var(--space-1)',
            zIndex: 20,
            display: 'flex',
            gap: 'var(--space-1)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <button
            onClick={handlePopoverVisit}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-1-5) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Visit
          </button>
          {popover.canExpand && (
            <button
              onClick={handlePopoverExpand}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--success)',
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-1-5) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-bold)' }}>+</span>
              Expand
            </button>
          )}
        </div>
      )}

      {/* ── Bottom-center: loading indicator ── */}
      {expanding && (
        <div
          style={{
            position: 'absolute',
            bottom: 'var(--space-4)',
            left: '50%',
            transform: 'translateX(-50%)',
            ...PILL,
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-lg)',
            fontSize: 'var(--text-sm)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          Loading connections...
        </div>
      )}
    </div>
  )
}
