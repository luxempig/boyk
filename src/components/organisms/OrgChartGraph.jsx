import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { CONNECTION_COLORS, CONNECTION_LABELS } from '../../lib/connectionColors'
import {
  buildTree,
  CHILD_RADIUS,
  computePositions,
  ORIGIN_RADIUS,
  perpendicularPath,
} from '../../lib/treeLayout'
import { getCompanyLinkId, getCompanyWithConnections } from '../../services/neo4jGraph'
import { useToast } from './Toast'

const OrgChartGraph = forwardRef(function OrgChartGraph(
  {
    company,
    connections,
    onCompanyClick,
    autoExpand,
    graphStateRef,
    savedGraphState,
    // 'expand' (default): single click expands/collapses in-place; double-click
    //   fires onCompanyClick. Used by the company-explorer view where
    //   expand-on-click is the natural action.
    // 'open': single click immediately fires onCompanyClick (e.g. to open a
    //   detail sheet). Used by the boycott view where users expect a modal.
    //   Pair with the ref-exposed expandNode() to expand from the sheet.
    clickAction = 'expand',
  },
  ref
) {
  const containerRef = useRef(null)

  // Tree state
  const [expandedNodes, setExpandedNodes] = useState(() => new Set())
  const [nodeData, setNodeData] = useState(() => new Map())
  const [loadingNodes, setLoadingNodes] = useState(() => new Set())

  // Pan/zoom via viewBox manipulation (not CSS transform)
  const [viewBox, setViewBox] = useState(null)
  const panRef = useRef({ active: false, startX: 0, startY: 0, startVB: null })
  const lastClick = useRef({ time: 0, id: null })

  // Get accent color from CSS
  const accentColor =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f472b6'
      : '#f472b6'

  // Initialize root node data
  const rootId = getCompanyLinkId(company) || company.id

  useEffect(() => {
    setNodeData(prev => {
      const next = new Map(prev)
      next.set(rootId, { company, connections })
      return next
    })
    setExpandedNodes(prev => {
      const next = new Set(prev)
      next.add(rootId)
      return next
    })
  }, [rootId, company, connections])

  // Restore saved state
  useEffect(() => {
    if (!savedGraphState) return
    if (savedGraphState.expandedNodes) setExpandedNodes(new Set(savedGraphState.expandedNodes))
    if (savedGraphState.nodeData) {
      const restored = new Map()
      for (const [k, v] of savedGraphState.nodeData) restored.set(k, v)
      setNodeData(restored)
    }
    if (savedGraphState.viewBox) setViewBox(savedGraphState.viewBox)
  }, [savedGraphState])

  // Save state to ref for back-navigation
  useEffect(() => {
    if (!graphStateRef) return
    graphStateRef.current = {
      expandedNodes: [...expandedNodes],
      nodeData: [...nodeData.entries()],
      viewBox,
    }
  }, [expandedNodes, nodeData, viewBox, graphStateRef])

  // Auto-expand for boycott view
  useEffect(() => {
    if (!autoExpand || autoExpand.size === 0) return

    const expandAll = async () => {
      for (const [nodeId, types] of autoExpand.entries()) {
        if (nodeData.has(nodeId)) continue
        try {
          setLoadingNodes(prev => new Set(prev).add(nodeId))
          const data = await getCompanyWithConnections(nodeId)
          if (data) {
            const filtered = {}
            const conns = data.connections || {}
            for (const t of types) {
              if (conns[t]) filtered[t] = conns[t]
            }
            setNodeData(prev => {
              const next = new Map(prev)
              next.set(nodeId, { company: data, connections: filtered })
              return next
            })
            setExpandedNodes(prev => new Set(prev).add(nodeId))
          }
        } catch (err) {
          console.error(`Failed to auto-expand ${nodeId}:`, err)
        } finally {
          setLoadingNodes(prev => {
            const next = new Set(prev)
            next.delete(nodeId)
            return next
          })
        }
      }
    }

    expandAll()
  }, [autoExpand, nodeData])

  const toast = useToast()

  // Pure expand: load data if missing, then mark expanded. Idempotent for
  // already-expanded nodes. Shared by the click handler and the imperative
  // ref (so the boycott-view sheet can expand without pivoting the graph).
  const doExpand = useCallback(
    async nodeId => {
      if (nodeData.has(nodeId)) {
        setExpandedNodes(prev => new Set(prev).add(nodeId))
        return
      }
      setLoadingNodes(prev => new Set(prev).add(nodeId))
      try {
        const data = await getCompanyWithConnections(nodeId)
        if (data) {
          setNodeData(prev => {
            const next = new Map(prev)
            next.set(nodeId, { company: data, connections: data.connections || {} })
            return next
          })
          setExpandedNodes(prev => new Set(prev).add(nodeId))
        }
      } catch (err) {
        // User clicked Expand and the fetch failed — surface a toast so they
        // know it's not just a slow network. Auto-expand failures (separate
        // path) stay silent; we don't want to spam toasts on mount.
        console.error('Failed to expand node:', err)
        toast.error("Couldn't load this node. Check your connection and try again.")
      } finally {
        setLoadingNodes(prev => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
      }
    },
    [nodeData, toast]
  )

  // Imperative API for callers (e.g. NetworkNodeSheet's "Expand" button) to
  // append a node's connections to the existing graph instead of re-rooting.
  useImperativeHandle(
    ref,
    () => ({
      expandNode: async nodeId => {
        if (!nodeId || String(nodeId).startsWith('boycott-')) return
        if (expandedNodes.has(nodeId)) return
        await doExpand(nodeId)
      },
    }),
    [doExpand, expandedNodes]
  )

  // Click handler — only fires if we didn't pan
  const handleNodeClick = useCallback(
    async (nodeId, connectionType) => {
      // 'open' mode: single click fires onCompanyClick immediately. The
      // boycott view uses this so users get a discoverable detail sheet
      // (with explicit "Expand" + "Open" buttons) instead of having to
      // know about the double-click affordance.
      if (clickAction === 'open' && !String(nodeId).startsWith('boycott-')) {
        const nodeInfo = nodeData.get(nodeId)?.company
        onCompanyClick?.(nodeId, connectionType, nodeInfo)
        return
      }

      const now = Date.now()
      // Default 'expand' mode — double-click (< 400ms) fires onCompanyClick.
      if (lastClick.current.id === nodeId && now - lastClick.current.time < 400) {
        const nodeInfo = nodeData.get(nodeId)?.company
        onCompanyClick?.(nodeId, connectionType, nodeInfo)
        lastClick.current = { time: 0, id: null }
        return
      }
      lastClick.current = { time: now, id: nodeId }

      if (String(nodeId).startsWith('boycott-')) return

      // Toggle collapse if already expanded (but never collapse root)
      if (expandedNodes.has(nodeId) && nodeId !== rootId) {
        setExpandedNodes(prev => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
        return
      }

      await doExpand(nodeId)
    },
    [clickAction, doExpand, expandedNodes, nodeData, rootId, onCompanyClick]
  )

  // Build tree and compute positions
  const tree = buildTree(rootId, nodeData, expandedNodes)
  const positions = computePositions(tree)

  // Compute natural viewBox from node positions
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const pad = 120
  const naturalVB = {
    x: (minX || 0) - pad,
    y: (minY || 0) - pad - 20,
    w: Math.max((maxX || 0) - (minX || 0) + pad * 2, 400),
    h: Math.max((maxY || 0) - (minY || 0) + pad * 2 + 20, 300),
  }

  // Compute the initial zoomed-in viewBox (no effect needed — avoids flash)
  const MAX_INITIAL_W = 500
  const initialVB = (() => {
    if (naturalVB.w <= MAX_INITIAL_W) return naturalVB
    const rootPos = positions.get(rootId)
    const cx = rootPos?.x || 0
    const cy = rootPos?.y || 0
    const aspectH = (naturalVB.h / naturalVB.w) * MAX_INITIAL_W
    const h = Math.max(aspectH, 250)
    return { x: cx - MAX_INITIAL_W / 2, y: cy - h * 0.35, w: MAX_INITIAL_W, h }
  })()

  // Restore saved viewBox from back-navigation, otherwise use computed initial
  useEffect(() => {
    if (savedGraphState?.viewBox) {
      setViewBox(savedGraphState.viewBox)
    }
  }, [savedGraphState])

  // User's panned/zoomed viewBox takes precedence, otherwise computed initial
  const vb = viewBox || initialVB

  // Pan via pointer events on the SVG background
  const onBgPointerDown = e => {
    // Only start pan from background (not from nodes)
    panRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startVB: { ...vb },
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onBgPointerMove = e => {
    if (!panRef.current.active) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Convert pixel delta to viewBox units
    const scaleX = vb.w / rect.width
    const scaleY = vb.h / rect.height
    const dx = (e.clientX - panRef.current.startX) * scaleX
    const dy = (e.clientY - panRef.current.startY) * scaleY
    setViewBox({
      ...panRef.current.startVB,
      x: panRef.current.startVB.x - dx,
      y: panRef.current.startVB.y - dy,
    })
  }

  const onBgPointerUp = () => {
    panRef.current.active = false
  }

  // Zoom via wheel — zoom toward cursor position
  const onWheel = useCallback(
    e => {
      e.preventDefault()
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const factor = e.deltaY > 0 ? 1.1 : 0.9

      // Cursor position in viewBox coordinates
      const cx = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w
      const cy = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h

      const newW = vb.w * factor
      const newH = vb.h * factor

      // Keep cursor point stable
      setViewBox({
        x: cx - (cx - vb.x) * factor,
        y: cy - (cy - vb.y) * factor,
        w: newW,
        h: newH,
      })
    },
    [vb]
  )

  // Attach wheel with passive: false (React onWheel can't preventDefault)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        touchAction: 'none',
      }}
    >
      <svg
        width='100%'
        height='100%'
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        style={{ cursor: panRef.current.active ? 'grabbing' : 'grab' }}
      >
        {/* Edges */}
        {tree.nodes
          .filter(n => n.parentId)
          .map(node => {
            const parentPos = positions.get(node.parentId)
            const childPos = positions.get(node.id)
            if (!parentPos || !childPos) return null
            const color = CONNECTION_COLORS[node.connectionType] || '#71717a'
            const isUserAdded = node.connectionType === 'user_added'
            const parentR = node.parentId === rootId ? ORIGIN_RADIUS : CHILD_RADIUS
            const d = perpendicularPath(
              parentPos.x,
              parentPos.y,
              childPos.x,
              childPos.y,
              parentR,
              CHILD_RADIUS
            )
            return (
              <path
                key={`edge-${node.parentId}-${node.id}`}
                d={d}
                fill='none'
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={isUserAdded ? '4,3' : undefined}
                opacity={isUserAdded ? 0.55 : 0.7}
              />
            )
          })}

        {/* Nodes */}
        {tree.nodes.map(node => {
          const pos = positions.get(node.id)
          if (!pos) return null
          const isRoot = node.id === rootId
          const r = isRoot ? ORIGIN_RADIUS : CHILD_RADIUS
          const color = isRoot ? accentColor : CONNECTION_COLORS[node.connectionType] || '#71717a'
          const isLoading = loadingNodes.has(node.id)
          const isExpanded = expandedNodes.has(node.id)
          const nodeInfo = nodeData.get(node.id)
          const label = nodeInfo?.company?.name || node.name || node.id

          return (
            <g
              key={`node-${node.id}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                handleNodeClick(node.id, node.connectionType)
              }}
              style={{ cursor: 'pointer' }}
            >
              {/* Invisible larger hit area for easier clicking */}
              <circle cx={pos.x} cy={pos.y} r={Math.max(r + 8, 14)} fill='transparent' />

              {/* Visible dot — user-added nodes get a dashed border + lighter fill */}
              {(() => {
                const isUserAdded = node.connectionType === 'user_added'
                return (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={r}
                    fill={isUserAdded ? 'var(--bg-card, #fff)' : color}
                    stroke={
                      isUserAdded ? color : isExpanded && !isRoot ? 'var(--text-primary)' : 'none'
                    }
                    strokeWidth={isUserAdded || (isExpanded && !isRoot) ? 1.5 : 0}
                    strokeDasharray={isUserAdded ? '3,2' : undefined}
                    opacity={isLoading ? 0.5 : 1}
                  />
                )
              })()}

              {/* Loading pulse */}
              {isLoading && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r + 4}
                  fill='none'
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.4}
                >
                  <animate
                    attributeName='r'
                    from={r + 2}
                    to={r + 12}
                    dur='1s'
                    repeatCount='indefinite'
                  />
                  <animate
                    attributeName='opacity'
                    from='0.6'
                    to='0'
                    dur='1s'
                    repeatCount='indefinite'
                  />
                </circle>
              )}

              {/* Label */}
              <text
                x={pos.x + r + 6}
                y={pos.y + 4}
                fill={isRoot ? 'var(--text-primary)' : 'var(--text-secondary)'}
                fontSize={isRoot ? 13 : 11}
                fontWeight={isRoot ? 700 : 400}
                fontFamily='var(--font-body), system-ui, sans-serif'
              >
                {label.length > 25 ? label.slice(0, 23) + '...' : label}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-3)',
          left: 'var(--space-3)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          fontSize: 'var(--text-xs2)',
          color: 'var(--text-muted)',
          background: 'var(--glass-bg)',
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--glass-border)',
          pointerEvents: 'none',
        }}
      >
        {Object.entries(CONNECTION_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color,
                display: 'inline-block',
              }}
            />
            {CONNECTION_LABELS[type] || type}
          </span>
        ))}
        <span style={{ marginLeft: 'var(--space-2)', opacity: 0.6 }}>
          Click to expand · Double-click to navigate
        </span>
      </div>
    </div>
  )
})

export default OrgChartGraph
