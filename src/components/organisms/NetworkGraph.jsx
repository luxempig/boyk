import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * NetworkGraph — Standardized network visualization component.
 *
 * Renders a central node on the left with SVG connector branches leading
 * to expandable connection-type groups on the right. SVG lines are drawn
 * to the measured DOM positions of each group header so they stay aligned
 * even when groups expand/collapse.
 *
 * Props:
 * - centralNode: { name, logoUrl?, icon?, subtitle?, gradient?, borderColor?, glowColor?, size?, onNodeClick? }
 * - branches: [{ key, label, color, data: [{id, name, ...}] }]
 * - renderItem: (item, branch) => ReactNode
 * - renderBranchHeader: (branch, isExpanded) => ReactNode (optional, overrides default pill)
 * - maxItems: number (default 8)
 * - onExplore: () => void (optional footer action)
 * - exploreLabel: string (default "Explore Full Network")
 * - exploreIcon: LucideIcon (optional)
 * - multiExpand: boolean (default false — accordion mode)
 * - defaultExpanded: string[] (keys to expand by default)
 * - expandedKeys: Set<string> (controlled mode — overrides internal state)
 * - onToggle: (key) => void (controlled mode — called on branch toggle)
 * - showAll: boolean (default false — show branches even with empty data)
 */
export default function NetworkGraph({
  centralNode,
  branches = [],
  renderItem,
  renderBranchHeader,
  maxItems = 8,
  onExplore,
  exploreLabel = 'Explore Full Network',
  exploreIcon: ExploreIcon,
  multiExpand = false,
  defaultExpanded = [],
  expandedKeys: controlledExpandedKeys,
  onToggle: controlledOnToggle,
  showAll = false,
  verticalItems = false,
  onNodeClick,
}) {
  // Internal expansion state (used when uncontrolled)
  const [internalExpanded, setInternalExpanded] = useState(() => new Set(defaultExpanded))
  const containerRef = useRef(null)
  const centralNodeRef = useRef(null)
  const groupRefs = useRef({})
  const [lineTargets, setLineTargets] = useState([])
  const [containerHeight, setContainerHeight] = useState(0)
  const [hubY, setHubY] = useState((centralNode.size || 100) / 2)
  const [measured, setMeasured] = useState(false)

  // Determine if controlled or uncontrolled
  const isControlled = controlledExpandedKeys !== undefined
  const expandedKeys = isControlled ? controlledExpandedKeys : internalExpanded

  const filteredBranches = useMemo(
    () => (showAll ? branches : branches.filter(b => b.data?.length > 0)),
    [showAll, branches]
  )

  const toggleExpand = useCallback(
    key => {
      if (isControlled) {
        controlledOnToggle?.(key)
        return
      }
      setInternalExpanded(prev => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
        } else {
          if (!multiExpand) next.clear()
          next.add(key)
        }
        return next
      })
    },
    [isControlled, controlledOnToggle, multiExpand]
  )

  // Measure group header positions, container height, and actual central node center
  const measurePositions = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    setContainerHeight(containerRect.height)

    // Measure actual central node center relative to the container
    const nodeEl = centralNodeRef.current
    if (nodeEl) {
      const nodeRect = nodeEl.getBoundingClientRect()
      const nodeCenterY = nodeRect.top - containerRect.top + nodeRect.height / 2
      setHubY(nodeCenterY)
    }

    const targets = filteredBranches.map(branch => {
      const el = groupRefs.current[branch.key]
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return rect.top - containerRect.top + rect.height / 2
    })
    setLineTargets(targets)
    setMeasured(true)
  }, [filteredBranches])

  // Re-measure on mount, expand/collapse, and resize
  // Double-measure: once immediately (for layout) and once after animation settles
  useEffect(() => {
    const raf = requestAnimationFrame(() => measurePositions())
    const timer = setTimeout(() => measurePositions(), 250)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [measurePositions, expandedKeys])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => measurePositions())
    observer.observe(container)
    return () => observer.disconnect()
  }, [measurePositions])

  const setGroupRef = useCallback((key, el) => {
    groupRefs.current[key] = el
  }, [])

  const svgWidth = 44

  return (
    <div style={{ padding: 'var(--space-5)', background: 'var(--bg-elevated)' }}>
      <div
        ref={containerRef}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 0, position: 'relative' }}
      >
        {/* Central node */}
        <div
          ref={centralNodeRef}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <CentralNode {...centralNode} />
          {onNodeClick && (
            <button
              onClick={onNodeClick}
              style={{
                marginTop: 'var(--space-1-5)',
                padding: 'var(--space-1) var(--space-2-5)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                fontSize: 'var(--text-xs2)',
                fontWeight: 'var(--font-medium)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.color = 'var(--accent)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              <ExternalLink size={10} />
              Details
            </button>
          )}
        </div>

        {/* SVG connector + groups */}
        {filteredBranches.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'stretch', position: 'relative' }}>
            {/* SVG connector lines */}
            <svg
              width={svgWidth}
              height={containerHeight || 1}
              style={{ overflow: 'visible', flexShrink: 0 }}
            >
              {measured && (
                <>
                  {/* Hub connector line from node to junction */}
                  <line
                    x1={0}
                    y1={hubY}
                    x2={svgWidth / 2}
                    y2={hubY}
                    stroke='var(--text-muted)'
                    strokeWidth={2}
                    style={{ opacity: 0.4 }}
                  />
                  {/* Junction circle */}
                  <circle
                    cx={svgWidth / 2}
                    cy={hubY}
                    r={4}
                    fill='var(--bg-card)'
                    stroke='var(--text-muted)'
                    strokeWidth={2}
                    style={{ opacity: 0.6 }}
                  />
                  {/* Branch curves from junction to each group header */}
                  {lineTargets.map((y, i) => {
                    const branch = filteredBranches[i]
                    if (y == null || !branch) return null
                    const isExpanded = expandedKeys.has(branch.key)
                    const strokeColor = branch.color
                    const strokeOpacity = isExpanded ? 0.85 : 0.25

                    const startX = svgWidth / 2
                    const startY = hubY
                    const endX = svgWidth
                    const endY = y
                    const cp1X = startX + (endX - startX) * 0.6
                    const cp1Y = startY
                    const cp2X = startX + (endX - startX) * 0.4
                    const cp2Y = endY

                    return (
                      <path
                        key={branch.key}
                        d={`M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`}
                        fill='none'
                        stroke={strokeColor}
                        strokeWidth={isExpanded ? 2.5 : 2}
                        strokeLinecap='round'
                        style={{ opacity: strokeOpacity, transition: 'opacity 0.3s ease' }}
                      />
                    )
                  })}
                </>
              )}
            </svg>

            {/* Groups column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2-5)' }}>
              {filteredBranches.map(branch => (
                <BranchGroup
                  key={branch.key}
                  branchKey={branch.key}
                  branch={branch}
                  isExpanded={expandedKeys.has(branch.key)}
                  onToggle={toggleExpand}
                  renderItem={renderItem}
                  renderBranchHeader={renderBranchHeader}
                  maxItems={maxItems}
                  setRef={setGroupRef}
                  verticalItems={verticalItems}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer action */}
      {onExplore && (
        <button
          onClick={onExplore}
          style={styles.exploreButton}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(0.92)')}
          onMouseLeave={e => {
            e.currentTarget.style.filter = ''
            e.currentTarget.style.transform = ''
          }}
          onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
          onMouseUp={e => (e.currentTarget.style.transform = '')}
        >
          {ExploreIcon && <ExploreIcon size={16} />}
          {exploreLabel}
        </button>
      )}
    </div>
  )
}

/* Central node circle */
const CentralNode = memo(function CentralNode({
  name,
  logoUrl,
  icon: Icon,
  subtitle,
  gradient = 'linear-gradient(135deg, var(--accent-light) 0%, var(--accent) 100%)',
  borderColor = 'var(--accent-dark)',
  glowColor = 'var(--accent-glow)',
  size = 100,
  animate: shouldAnimate = true,
}) {
  const baseStyle = {
    width: size,
    height: size,
    borderRadius: 'var(--radius-full)',
    background: gradient,
    border: `3px solid ${borderColor}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-2-5)',
    flexShrink: 0,
  }

  const children = (
    <>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={name}
          style={{
            width: size * 0.3,
            height: size * 0.3,
            borderRadius: 'var(--radius-md)',
            objectFit: 'contain',
            background: '#fff',
            marginBottom: 'var(--space-1)',
          }}
        />
      ) : Icon ? (
        <Icon size={size * 0.28} color='#fff' style={{ marginBottom: 'var(--space-1)' }} />
      ) : null}
      <div
        style={{
          fontSize: Math.max(10, size * 0.11),
          fontWeight: 'var(--font-semibold)',
          color: '#fff',
          textAlign: 'center',
          lineHeight: 'var(--leading-snug)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {name}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: Math.max(9, size * 0.09),
            color: 'rgba(255,255,255,0.8)',
            marginTop: 'var(--space-0-5)',
          }}
        >
          {subtitle}
        </div>
      )}
    </>
  )

  if (!shouldAnimate) {
    return <div style={{ ...baseStyle, boxShadow: `0 4px 12px ${glowColor}` }}>{children}</div>
  }

  return (
    <motion.div
      animate={{
        boxShadow: [
          `0 4px 12px ${glowColor}`,
          `0 4px 24px ${glowColor}`,
          `0 4px 12px ${glowColor}`,
        ],
      }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      style={baseStyle}
    >
      {children}
    </motion.div>
  )
})

/* Single branch group: header pill + expandable items */
const BranchGroup = memo(function BranchGroup({
  branchKey,
  branch,
  isExpanded,
  onToggle,
  renderItem,
  renderBranchHeader,
  maxItems,
  setRef,
  verticalItems,
}) {
  const hasItems = branch.data?.length > 0
  const handleToggle = useCallback(() => onToggle(branchKey), [onToggle, branchKey])
  const handleRef = useCallback(el => setRef(branchKey, el), [setRef, branchKey])

  return (
    <div>
      {/* Group header — custom or default pill. Ref'd for SVG alignment. */}
      <div ref={handleRef}>
        {renderBranchHeader ? (
          <button
            className='network-branch-btn'
            onClick={handleToggle}
            aria-expanded={isExpanded}
            style={{
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              width: '100%',
              textAlign: 'left',
            }}
          >
            {renderBranchHeader(branch, isExpanded)}
          </button>
        ) : (
          <button
            className='network-branch-btn'
            onClick={handleToggle}
            aria-expanded={isExpanded}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3-5)',
              background: isExpanded ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: `2px solid ${isExpanded ? branch.color : 'var(--border)'}`,
              borderRadius: 'var(--radius-2xl)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--font-medium)',
              color: 'var(--text-primary)',
              transition: 'all 0.2s ease',
              boxShadow: isExpanded
                ? `0 0 0 1px ${branch.color}20, 0 2px 8px ${branch.color}15`
                : '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 'var(--radius-full)',
                background: branch.color,
                flexShrink: 0,
              }}
            />
            {branch.label}
            <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--font-normal)' }}>
              ({branch.data?.length || 0})
            </span>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>

      {/* Expanded items */}
      <AnimatePresence>
        {isExpanded && hasItems && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              overflow: 'hidden',
              marginLeft: 'var(--space-2)',
              marginTop: 'var(--space-1-5)',
              paddingLeft: 'var(--space-3)',
              borderLeft: `2px solid ${branch.color}30`,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: verticalItems ? 'column' : 'row',
                flexWrap: verticalItems ? 'nowrap' : 'wrap',
                gap: 'var(--space-1-5)',
                maxWidth: verticalItems ? undefined : 320,
              }}
            >
              {branch.data.slice(0, maxItems).map(item =>
                renderItem ? (
                  <div key={item.id}>{renderItem(item, branch)}</div>
                ) : (
                  <span
                    key={item.id}
                    style={{
                      padding: 'var(--space-1) var(--space-2-5)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-lg)',
                      fontSize: 'var(--text-xs2)',
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                  >
                    {item.name}
                  </span>
                )
              )}
              {branch.data.length > maxItems && (
                <span
                  style={{
                    padding: 'var(--space-1) var(--space-2-5)',
                    fontSize: 'var(--text-xs2)',
                    color: 'var(--text-muted)',
                  }}
                >
                  +{branch.data.length - maxItems} more
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

const styles = {
  exploreButton: {
    marginTop: 'var(--space-4)',
    width: '100%',
    padding: 'var(--space-3)',
    background: 'var(--gold)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-on-gold, #18181b)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    transition: 'filter 0.15s ease, transform 0.1s ease',
  },
}
