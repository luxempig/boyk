import { Fragment, memo, useMemo } from 'react'

import Stat from '../atoms/Stat'

/**
 * @component StatGroup
 * @level Molecule
 *
 * @description Horizontal row of Stat atoms with optional dividers.
 *
 * @interactions
 * - Delegates to individual Stat atom click handlers
 *
 * @composes
 * - Stat — individual stat display
 *
 * @props
 * - stats: { label: string, value: string|number, onClick?: () => void }[] — Stat data
 * - size: 'compact'|'default' — Passed to Stat atoms (default: 'default')
 * - loading: boolean — Shows skeleton for all stats
 * - dividers: boolean — Show vertical dividers between stats (default: false)
 * - className: string
 */

const dividerStyle = {
  width: '0.5px',
  height: 'var(--space-6)',
  background: 'rgba(255,255,255,0.06)',
  flexShrink: 0,
}

const StatGroup = memo(function StatGroup({
  stats = [],
  size = 'default',
  loading = false,
  dividers = false,
  className = '',
}) {
  const containerStyle = useMemo(
    () => ({
      display: 'flex',
      alignItems: 'center',
      gap: size === 'compact' ? 'var(--space-4)' : 'var(--space-6)',
    }),
    [size]
  )

  if (!stats.length) return null

  return (
    <div className={className} style={containerStyle}>
      {stats.map((stat, i) => (
        <Fragment key={stat.label || i}>
          {dividers && i > 0 && <div style={dividerStyle} />}
          <Stat
            label={stat.label}
            value={stat.value}
            onClick={stat.onClick}
            size={size}
            loading={loading}
          />
        </Fragment>
      ))}
    </div>
  )
})

export { StatGroup }
export default StatGroup
