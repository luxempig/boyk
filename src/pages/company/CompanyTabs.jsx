import { motion } from 'framer-motion'

/**
 * CompanyTabs — DS Tabs (underline variant): Sora labels, mono counts, and a
 * 2px gradient-brand underline with accent glow on the active tab (same
 * treatment as the boycott detail tabs). Transparent bar with a 1px border;
 * picks up glass blur when sticky so labels stay legible over content.
 */
export function CompanyTabs({ tabs, activeKey, onChange, sticky = true, className }) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: 'var(--space-1)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        borderBottom: '1px solid var(--border)',
        maskImage: 'linear-gradient(to right, black, black calc(100% - 24px), transparent)',
        WebkitMaskImage: 'linear-gradient(to right, black, black calc(100% - 24px), transparent)',
        ...(sticky
          ? {
              position: 'sticky',
              top: 0,
              zIndex: 20,
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }
          : {}),
      }}
    >
      {tabs.map(tab => {
        const active = activeKey === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              position: 'relative',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 'var(--space-3)',
              whiteSpace: 'nowrap',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              fontSize: 'var(--text-md)',
              fontWeight: active ? 'var(--font-bold)' : 'var(--font-medium)',
              fontFamily: 'var(--font-heading)',
              transition: 'color 0.2s',
            }}
          >
            {tab.label}
            {tab.count != null && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  opacity: 0.6,
                  marginLeft: 'var(--space-1)',
                }}
              >
                ({tab.count})
              </span>
            )}
            {active && (
              <motion.div
                layoutId='tab-underline'
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 'var(--space-3)',
                  right: 'var(--space-3)',
                  height: 2,
                  background: 'var(--gradient-brand)',
                  borderRadius: 2,
                  boxShadow: '0 0 8px var(--accent-glow)',
                }}
                transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

export default CompanyTabs
