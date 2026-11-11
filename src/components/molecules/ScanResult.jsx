import { AlertCircle, CheckCircle, HelpCircle } from 'lucide-react'

import { glassCard } from '../../lib/glassStyles'

const STATUS_CONFIG = {
  safe: { icon: CheckCircle, color: 'var(--success, #34d399)', label: 'Safe' },
  flagged: { icon: AlertCircle, color: 'var(--danger, #fb7185)', label: 'Flagged' },
  unknown: { icon: HelpCircle, color: 'var(--text-muted)', label: 'Unknown' },
}

export function ScanResult({ name, status = 'unknown', logo, onPress, className }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unknown
  const StatusIcon = config.icon

  return (
    <button
      className={className}
      onClick={onPress}
      style={{
        ...glassCard,
        width: 120,
        padding: 'var(--space-3)',
        textAlign: 'center',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        fontFamily: 'inherit',
      }}
    >
      {logo && (
        <img
          src={logo}
          alt=''
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-md)',
            objectFit: 'contain',
            margin: '0 auto var(--space-2)',
          }}
        />
      )}
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-1)',
          marginTop: 'var(--space-1)',
        }}
      >
        <StatusIcon size={12} style={{ color: config.color }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-2xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: config.color,
          }}
        >
          {config.label}
        </span>
      </div>
    </button>
  )
}

export default ScanResult
