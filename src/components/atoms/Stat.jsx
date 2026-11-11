import { memo, useMemo } from 'react'

import Skeleton from './Skeleton'

/**
 * @component Stat
 * @level Atom
 *
 * @description Displays a numeric value with label.
 *
 * @interactions
 * - Click: Calls `onClick` if provided (e.g., opens followers modal)
 *
 * @props
 * - label: string — Description text below value
 * - value: string|number — The displayed number/text
 * - size: 'compact'|'default' — Font sizes (default: 'default')
 * - onClick: () => void — Optional click handler
 * - loading: boolean — Shows Skeleton when true
 * - className: string
 */

const SIZE_STYLES = {
  default: {
    valueFontSize: 'var(--text-xl)',
    labelFontSize: 'var(--text-sm)',
    skeletonValueHeight: 18,
  },
  compact: {
    valueFontSize: 'var(--text-md)',
    labelFontSize: 'var(--text-xs2)',
    skeletonValueHeight: 14,
  },
}

const Stat = memo(function Stat({
  label,
  value,
  size = 'default',
  onClick,
  loading = false,
  className = '',
}) {
  const sizeStyles = SIZE_STYLES[size] || SIZE_STYLES.default

  const containerStyle = useMemo(
    () => ({
      textAlign: 'center',
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      cursor: onClick ? 'pointer' : undefined,
    }),
    [onClick]
  )

  if (loading) {
    return (
      <div className={className} style={containerStyle}>
        <Skeleton variant='line' width={40} height={sizeStyles.skeletonValueHeight} />
        <div style={{ marginTop: 'var(--space-0-5)' }}>
          <Skeleton variant='line' width={50} height={12} />
        </div>
      </div>
    )
  }

  return (
    <div
      className={className}
      style={containerStyle}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <span
        style={{
          fontSize: sizeStyles.valueFontSize,
          fontWeight: 'var(--font-bold)',
          lineHeight: 'var(--leading-none)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-heading)',
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: sizeStyles.labelFontSize,
          color: 'var(--text-muted)',
          marginTop: 'var(--space-1)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-eyebrow)',
        }}
      >
        {label}
      </span>
    </div>
  )
})

export { Stat }
export default Stat
