import { useState } from 'react'

import { CONNECTION_COLORS, CONNECTION_LABELS } from '../../lib/connectionColors'
import { glassCard } from '../../lib/glassStyles'

const TYPES = Object.keys(CONNECTION_COLORS)

export default function GraphLegend({ position = 'top-right' }) {
  const [collapsed, setCollapsed] = useState(true)

  const posStyle =
    position === 'bottom-left'
      ? { bottom: 'var(--space-3)', left: 'var(--space-3)' }
      : { top: 'var(--space-3)', right: 'var(--space-3)' }

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
        ...glassCard,
        padding: collapsed ? 'var(--space-1) var(--space-2)' : 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-xs2)',
        color: 'var(--text-secondary)',
        pointerEvents: 'auto',
        zIndex: 10,
        userSelect: 'none',
      }}
    >
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 0,
          fontSize: 'var(--text-xs2)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}
      >
        Legend
        <span style={{ fontSize: 'var(--text-2xs)' }}>{collapsed ? '▲' : '▼'}</span>
      </button>
      {!collapsed && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            marginTop: 'var(--space-1-5)',
          }}
        >
          {TYPES.map(type => (
            <div
              key={type}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)' }}
            >
              <span
                data-testid={`legend-dot-${type}`}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: CONNECTION_COLORS[type],
                  display: 'inline-block',
                  flexShrink: 0,
                  boxShadow: `0 0 4px ${CONNECTION_COLORS[type]}40`,
                }}
              />
              <span>{CONNECTION_LABELS[type]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
