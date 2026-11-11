import { glassCard } from '../../lib/glassStyles'

export default function MetricTile({ value, label, icon: Icon, className, style }) {
  return (
    <div
      className={className}
      style={{
        ...glassCard,
        padding: 'var(--space-4)',
        textAlign: 'center',
        ...style,
      }}
    >
      {Icon && (
        <Icon size={16} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }} />
      )}
      <div
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--font-bold)',
          color: 'var(--text-primary)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginTop: 'var(--space-1)',
        }}
      >
        {label}
      </div>
    </div>
  )
}
