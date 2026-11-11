import { memo, useMemo } from 'react'

import { CONNECTION_COLORS } from '../../lib/connectionColors'

/**
 * @component Badge
 * @level Atom
 *
 * @description Displays a colored badge/chip for connection types, activity types, or status indicators.
 * Pre-configured color mappings for boycott connection types.
 *
 * @interactions
 * - None (static display element)
 *
 * @props
 * - type: 'connection'|'activity'|'status' — Determines styling variant
 * - value: string — The badge text
 * - color: string — Override color (auto-mapped for connection types)
 * - connectionKey: string — Auto-maps to a shared connection color from lib/connectionColors
 *   (owns, owned_by, brands, suppliers, customers, invested_in_by, invests_in, people, user_added)
 * - icon: ReactNode — Optional leading icon
 * - size: 'sm'|'md' — Small (12px) or medium (13px) text
 * - dot: boolean — Show colored dot indicator before text (default true for connection type)
 * - className: string — Additional CSS classes
 */

const Badge = memo(function Badge({
  type = 'connection',
  value,
  color,
  connectionKey,
  icon,
  size = 'sm',
  dot,
  className = '',
}) {
  const resolvedColor =
    color || (connectionKey && CONNECTION_COLORS[connectionKey]) || 'var(--accent)'
  const showDot = dot !== undefined ? dot : type === 'connection'
  const fontSize = size === 'md' ? 'var(--text-base)' : 'var(--text-sm)'

  const style = useMemo(() => {
    if (type === 'activity') {
      // Parse hex to rgba for translucent background
      const hexToRgb = hex => {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `${r}, ${g}, ${b}`
      }
      const rgb = resolvedColor.startsWith('#') ? hexToRgb(resolvedColor) : null

      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        padding: 'var(--space-1) var(--space-2)',
        borderRadius: 'var(--radius-full)',
        fontSize,
        background: rgb ? `rgba(${rgb}, 0.1)` : `${resolvedColor}20`,
        color: resolvedColor,
        fontWeight: 'var(--font-medium)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
      }
    }

    if (type === 'status') {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        padding: 'var(--space-1-5) var(--space-3)',
        borderRadius: 'var(--radius-full)',
        fontSize,
        background: `linear-gradient(135deg, ${resolvedColor}, ${resolvedColor}cc)`,
        color: '#fff',
        fontWeight: 'var(--font-bold)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }
    }

    // Default: connection type
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-1-5)',
      fontSize,
      borderRadius: 'var(--radius-full)',
    }
  }, [type, resolvedColor, fontSize])

  return (
    <span className={className} style={style}>
      {icon}
      {showDot && <span style={{ color: resolvedColor, lineHeight: 1 }}>{'\u25CF'}</span>}
      <span style={type === 'connection' ? { color: 'var(--text-muted)' } : undefined}>
        {value}
      </span>
    </span>
  )
})

export { Badge }
export default Badge
