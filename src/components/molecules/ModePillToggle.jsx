import { motion } from 'framer-motion'

import { glassPill } from '../../lib/glassStyles'

export function ModePillToggle({ options, activeKey, onChange, size = 'md', className, style }) {
  const height = size === 'sm' ? 36 : 44
  return (
    <div
      className={className}
      style={{
        ...glassPill,
        display: 'flex',
        padding: 4,
        position: 'relative',
        ...style,
      }}
    >
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            flex: 1,
            position: 'relative',
            zIndex: 1,
            border: 'none',
            background: 'transparent',
            padding: `0 var(--space-4)`,
            height: height - 8,
            borderRadius: 'var(--radius-full)',
            color: activeKey === opt.key ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: 'var(--text-sm)',
            fontWeight: activeKey === opt.key ? 600 : 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            transition: 'color 0.2s',
          }}
        >
          {opt.icon && <opt.icon size={16} />}
          {opt.label}
          {activeKey === opt.key && (
            <motion.div
              layoutId='pill-indicator'
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--accent-fill)',
                borderRadius: 'var(--radius-full)',
                zIndex: -1,
              }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            />
          )}
        </button>
      ))}
    </div>
  )
}

export default ModePillToggle
