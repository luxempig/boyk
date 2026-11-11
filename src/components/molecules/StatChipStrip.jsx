import { glassPill } from '../../lib/glassStyles'
import { Skeleton } from '../atoms/Skeleton'

export function StatChipStrip({ chips = [], loading = false, className, style }) {
  if (loading) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
          ...style,
        }}
      >
        {[1, 2, 3, 4].map(i => (
          <Skeleton
            key={i}
            variant='rect'
            width={100}
            height={40}
            style={{ borderRadius: 'var(--radius-full)', flexShrink: 0 }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: 'var(--space-1-5)',
        overflowX: 'auto',
        paddingBottom: 'var(--space-1)',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        ...style,
      }}
    >
      {chips.map(chip => (
        <div
          key={chip.label}
          style={{
            ...glassPill,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: '4px var(--space-2)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {chip.icon && <chip.icon size={12} style={{ color: 'var(--text-muted)' }} />}
          <span
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
            }}
          >
            {chip.value}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-2xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
            }}
          >
            {chip.label}
          </span>
        </div>
      ))}
    </div>
  )
}

export default StatChipStrip
