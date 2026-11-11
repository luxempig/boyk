import { glassCard } from '../../lib/glassStyles'

export function MiniMap({ graphData, viewport, onViewportChange, size = 100, className }) {
  if (!graphData?.nodes?.length) return null

  const nodes = graphData.nodes
  const xs = nodes.map(n => n.x || 0)
  const ys = nodes.map(n => n.y || 0)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  const handleClick = e => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    onViewportChange?.({ x: minX + x * rangeX, y: minY + y * rangeY })
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter' || e.key === ' ') handleClick(e)
  }

  return (
    <div
      className={className}
      role='button'
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        ...glassCard,
        width: size,
        height: size,
        position: 'relative',
        cursor: 'crosshair',
        overflow: 'hidden',
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {nodes.map((node, i) => (
          <circle
            key={i}
            cx={(((node.x || 0) - minX) / rangeX) * (size - 8) + 4}
            cy={(((node.y || 0) - minY) / rangeY) * (size - 8) + 4}
            r={2}
            fill='var(--accent)'
            opacity={0.6}
          />
        ))}
        {viewport && (
          <rect
            x={((viewport.x - minX) / rangeX) * size - 15}
            y={((viewport.y - minY) / rangeY) * size - 15}
            width={30}
            height={30}
            fill='none'
            stroke='rgba(255,255,255,0.3)'
            strokeWidth={1}
          />
        )}
      </svg>
    </div>
  )
}

export default MiniMap
