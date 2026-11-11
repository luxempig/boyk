import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Building2, ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { CONNECTION_COLORS } from '../../lib/connectionColors'
import { getCompanyWithConnections } from '../../services/neo4jGraph'
import NetworkGraph from './NetworkGraph'

const CONNECTION_GROUPS = [
  { key: 'owned_by', label: 'Parents', color: CONNECTION_COLORS.owned_by },
  { key: 'owns', label: 'Subsidiaries', color: CONNECTION_COLORS.owns },
  { key: 'brands', label: 'Brands', color: CONNECTION_COLORS.brands },
  { key: 'suppliers', label: 'Suppliers', color: CONNECTION_COLORS.suppliers },
  { key: 'customers', label: 'Customers', color: CONNECTION_COLORS.customers },
]

const EXPANDABLE_KEYS = new Set(['owned_by', 'owns', 'suppliers', 'customers'])
const MAX_DEPTH = 6
const MAX_ITEMS_PER_GROUP = 15
const GROUP_COLOR_MAP = Object.fromEntries(CONNECTION_GROUPS.map(g => [g.key, g.color]))

/**
 * NetworkExplorer — Interactive inline tree exploration.
 *
 * Renders a central company hub via NetworkGraph, then allows recursive
 * inline expansion of child companies. Click the toggle arrow to expand
 * a company's connections as a sub-tree. Supports drag-to-pan and
 * scroll in both directions. "Collapse All" retracts the entire tree.
 */
export default function NetworkExplorer({ centralCompany, initialConnections = {} }) {
  const navigate = useNavigate()
  const [expandedNodes, setExpandedNodes] = useState(new Set())
  const nodeCacheRef = useRef(new Map())
  const [loadingNodes, setLoadingNodes] = useState(new Set())
  const [errorNodes, setErrorNodes] = useState(new Set())
  const scrollRef = useRef(null)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })

  const connectionTypes = useMemo(
    () => [
      {
        key: 'owned_by',
        label: 'Parents',
        color: CONNECTION_COLORS.owned_by,
        data: initialConnections.owned_by || [],
      },
      {
        key: 'owns',
        label: 'Subsidiaries',
        color: CONNECTION_COLORS.owns,
        data: initialConnections.owns || [],
      },
      {
        key: 'brands',
        label: 'Brands',
        color: CONNECTION_COLORS.brands,
        data: initialConnections.brands || [],
      },
      {
        key: 'suppliers',
        label: 'Suppliers',
        color: CONNECTION_COLORS.suppliers,
        data: initialConnections.suppliers || [],
      },
      {
        key: 'customers',
        label: 'Customers',
        color: CONNECTION_COLORS.customers,
        data: initialConnections.customers || [],
      },
    ],
    [initialConnections]
  )

  const totalConnections = connectionTypes.reduce((sum, t) => sum + (t.data?.length || 0), 0)

  // Track expanded state for synchronous reads in toggleNode
  const expandedNodesRef = useRef(new Set())

  // Toggle node expansion and fetch connections if needed
  // Uses refs for cache to avoid recreating this callback on every cache update
  const toggleNode = useCallback(async nodeId => {
    const wasExpanded = expandedNodesRef.current.has(nodeId)
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (wasExpanded) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      expandedNodesRef.current = next
      return next
    })

    if (wasExpanded) return
    if (nodeCacheRef.current.has(nodeId)) return

    setLoadingNodes(prev => new Set(prev).add(nodeId))
    setErrorNodes(prev => {
      const next = new Set(prev)
      next.delete(nodeId)
      return next
    })
    try {
      const data = await getCompanyWithConnections(nodeId)
      if (data?.connections) {
        nodeCacheRef.current.set(nodeId, data.connections)
        // Force a re-render by toggling loading state
        setLoadingNodes(prev => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
      } else {
        setErrorNodes(prev => new Set(prev).add(nodeId))
        setLoadingNodes(prev => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
      }
    } catch (err) {
      console.error('Error loading connections:', err)
      setErrorNodes(prev => new Set(prev).add(nodeId))
      setLoadingNodes(prev => {
        const next = new Set(prev)
        next.delete(nodeId)
        return next
      })
    }
  }, [])

  // Retry a failed node load, ensuring it stays expanded
  const retryNode = useCallback(async nodeId => {
    nodeCacheRef.current.delete(nodeId)
    setErrorNodes(prev => {
      const n = new Set(prev)
      n.delete(nodeId)
      return n
    })
    setExpandedNodes(prev => {
      const next = new Set(prev).add(nodeId)
      expandedNodesRef.current = next
      return next
    })
    setLoadingNodes(prev => new Set(prev).add(nodeId))
    try {
      const data = await getCompanyWithConnections(nodeId)
      if (data?.connections) {
        nodeCacheRef.current.set(nodeId, data.connections)
      } else {
        setErrorNodes(prev => new Set(prev).add(nodeId))
      }
    } catch {
      setErrorNodes(prev => new Set(prev).add(nodeId))
    } finally {
      setLoadingNodes(prev => {
        const n = new Set(prev)
        n.delete(nodeId)
        return n
      })
    }
  }, [])

  const collapseAll = useCallback(() => {
    expandedNodesRef.current = new Set()
    setExpandedNodes(new Set())
  }, [])

  // Drag-to-pan handlers — attach to window while dragging to prevent stuck state
  const handleMouseDown = useCallback(e => {
    if (e.target.closest('button, a, [role="button"]')) return
    isDragging.current = true
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollRef.current?.scrollLeft || 0,
      scrollTop: scrollRef.current?.scrollTop || 0,
    }
    if (scrollRef.current) scrollRef.current.style.cursor = 'grabbing'
    e.preventDefault()
  }, [])

  const handleMouseMove = useCallback(e => {
    if (!isDragging.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = dragStart.current.scrollLeft - dx
      scrollRef.current.scrollTop = dragStart.current.scrollTop - dy
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab'
  }, [])

  // Attach global mousemove/mouseup while component is mounted to prevent stuck drag
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // Recursive tree item renderer — ancestors set prevents infinite cycles
  // Defined as a stable function that reads from refs
  const renderTreeItem = useCallback(
    function renderTreeItemInner(item, branchKey, depth, ancestors) {
      const isAncestor = ancestors.has(item.id)
      const isExpanded = !isAncestor && expandedNodes.has(item.id)
      const isLoading = !isAncestor && loadingNodes.has(item.id)
      const hasError = !isAncestor && errorNodes.has(item.id)
      const connections = nodeCacheRef.current.get(item.id)
      const canExpand = EXPANDABLE_KEYS.has(branchKey) && depth < MAX_DEPTH && !isAncestor

      return (
        <div style={{ width: '100%' }}>
          {/* Item row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            {canExpand ? (
              <button
                onClick={() => toggleNode(item.id)}
                aria-expanded={isExpanded}
                aria-label={`Expand ${item.name} connections`}
                style={{
                  width: 22,
                  height: 22,
                  padding: 0,
                  background: isExpanded ? 'var(--bg-card-hover)' : 'none',
                  border: `1px solid ${isExpanded ? 'var(--text-muted)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-xs)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isExpanded ? 'var(--text-primary)' : 'var(--text-muted)',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
              >
                {isLoading ? (
                  <Loader2 size={11} className='animate-spin' />
                ) : isExpanded ? (
                  <ChevronDown size={11} />
                ) : (
                  <ChevronRight size={11} />
                )}
              </button>
            ) : (
              <div style={{ width: 22, flexShrink: 0 }} />
            )}
            <Link
              to={branchKey === 'brands' ? `/brand/${item.id}` : `/company/${item.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-1) var(--space-2-5)',
                background: isExpanded ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                border: `1px solid ${isExpanded ? 'var(--text-muted)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-lg)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'all 0.15s ease',
              }}
            >
              {item.logo_url ? (
                <img
                  src={item.logo_url}
                  alt=''
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 'var(--radius-xs)',
                    objectFit: 'contain',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 'var(--radius-xs)',
                    background: 'var(--accent-fill)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 'var(--font-semibold)',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {item.name?.charAt(0)}
                </span>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
            </Link>
          </div>

          {/* Sub-tree */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div
                  style={{
                    marginLeft: 11,
                    marginTop: 'var(--space-1)',
                    paddingLeft: 11,
                    borderLeft: `2px solid ${GROUP_COLOR_MAP[branchKey] || 'var(--border)'}30`,
                  }}
                >
                  {/* Error state */}
                  {hasError && !connections && (
                    <div
                      style={{
                        padding: 'var(--space-2) 0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-1-5)',
                        fontSize: 'var(--text-xs2)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <AlertCircle size={12} style={{ color: '#ef4444' }} />
                      Failed to load connections
                      <button
                        onClick={() => retryNode(item.id)}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: 'var(--space-0-5) var(--space-1-5)',
                          fontSize: 'var(--text-xs)',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {/* Loading state */}
                  {isLoading && !connections && (
                    <div
                      style={{
                        padding: 'var(--space-2) 0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-1-5)',
                        fontSize: 'var(--text-xs2)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Loader2 size={12} className='animate-spin' />
                      Loading connections...
                    </div>
                  )}
                  {connections &&
                    CONNECTION_GROUPS.map(group => {
                      const items = connections[group.key]
                      if (!items?.length) return null
                      return (
                        <div key={group.key} style={{ marginBottom: 'var(--space-1-5)' }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--space-1-5)',
                              fontFamily: 'Sora, sans-serif',
                              fontSize: 'var(--text-xs)',
                              fontWeight: 'var(--font-semibold)',
                              color: group.color,
                              padding: 'var(--space-1) 0 var(--space-0-5)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: group.color,
                                flexShrink: 0,
                              }}
                            />
                            {group.label} ({items.length})
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 'var(--space-1)',
                            }}
                          >
                            {items.slice(0, MAX_ITEMS_PER_GROUP).map(child => {
                              const nextAncestors = new Set(ancestors)
                              nextAncestors.add(item.id)
                              return (
                                <div key={child.id}>
                                  {renderTreeItemInner(child, group.key, depth + 1, nextAncestors)}
                                </div>
                              )
                            })}
                            {items.length > MAX_ITEMS_PER_GROUP && (
                              <span
                                style={{
                                  fontSize: 'var(--text-xs)',
                                  color: 'var(--text-muted)',
                                  padding: 'var(--space-0-5) 0 var(--space-0-5) 26px',
                                }}
                              >
                                +{items.length - MAX_ITEMS_PER_GROUP} more
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  {connections && CONNECTION_GROUPS.every(g => !connections[g.key]?.length) && (
                    <div
                      style={{
                        fontSize: 'var(--text-xs2)',
                        color: 'var(--text-muted)',
                        padding: 'var(--space-1) 0',
                      }}
                    >
                      No known connections
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )
    },
    [expandedNodes, loadingNodes, errorNodes, toggleNode, retryNode]
  )

  const rootAncestors = useMemo(() => new Set([centralCompany.id]), [centralCompany.id])
  const renderRootItem = useCallback(
    (item, branch) => renderTreeItem(item, branch.key, 0, rootAncestors),
    [renderTreeItem, rootAncestors]
  )

  return (
    <div style={styles.container}>
      {/* Collapse All header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: 'var(--space-1) var(--space-2)',
          minHeight: 36,
        }}
      >
        <AnimatePresence>
          {expandedNodes.size > 0 && (
            <motion.button
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              onClick={collapseAll}
              style={styles.collapseButton}
            >
              <RotateCcw size={12} />
              Collapse All ({expandedNodes.size})
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {totalConnections > 0 ? (
        <>
          {/* Scrollable/draggable container */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div ref={scrollRef} onMouseDown={handleMouseDown} style={styles.scrollContainer}>
            <div
              style={{
                minWidth: 'fit-content',
                paddingBottom: 'var(--space-10)',
                cursor: 'default',
              }}
            >
              <NetworkGraph
                centralNode={{
                  name: centralCompany.name,
                  logoUrl: centralCompany.logo_url,
                  subtitle: `${totalConnections} connection${totalConnections !== 1 ? 's' : ''}`,
                  gradient: 'linear-gradient(135deg, #c084fc 0%, #a855f7 100%)',
                  borderColor: '#9333ea',
                  glowColor: 'rgba(168, 85, 247, 0.25)',
                  size: 120,
                }}
                branches={connectionTypes}
                multiExpand
                defaultExpanded={['owns', 'brands']}
                verticalItems
                renderItem={renderRootItem}
                maxItems={20}
                onNodeClick={() => navigate(`/company/${centralCompany.id}`)}
              />
            </div>
          </div>
        </>
      ) : (
        <div style={styles.emptyState}>
          <Building2
            style={{
              width: 32,
              height: 32,
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-3)',
            }}
          />
          <div style={{ fontSize: 'var(--text-md)', color: 'var(--text-muted)' }}>
            No known connections
          </div>
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-1)',
            }}
          >
            This company has no subsidiaries, parents, or brands in our database
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  },
  collapseButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-1-5)',
    padding: 'var(--space-1-5) var(--space-3)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  scrollContainer: {
    flex: 1,
    overflow: 'auto',
    cursor: 'grab',
    userSelect: 'none',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-10)',
    textAlign: 'center',
  },
}
