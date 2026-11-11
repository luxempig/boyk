import { AnimatePresence, motion } from 'framer-motion'
import { Check, Globe, Lock, Users, X } from 'lucide-react'

const OPTIONS = [
  {
    value: 'everyone',
    label: 'Everyone',
    description: 'Public — visible in Explore and your followers’ feeds',
    icon: Globe,
  },
  {
    value: 'followers',
    label: 'Followers',
    description: 'Only people who follow you can see this post',
    icon: Users,
  },
  {
    value: 'just_me',
    label: 'Just me',
    description: 'Private note — useful for drafts or reminders',
    icon: Lock,
  },
]

export default function ComposeAudiencePicker({ open, value, onSelect, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 10 }}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 11,
              background: 'var(--bg-elevated)',
              borderTopLeftRadius: 'var(--radius-xl)',
              borderTopRightRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-lg)',
              padding: 'var(--space-3) var(--space-4) var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 'var(--space-2)',
                borderBottom: '1px solid var(--border)',
                marginBottom: 'var(--space-1)',
              }}
            >
              <span
                style={{
                  fontSize: 'var(--text-md)',
                  fontWeight: 'var(--font-semibold)',
                  color: 'var(--text-primary)',
                }}
              >
                Who can see this?
              </span>
              <button
                type='button'
                onClick={onClose}
                aria-label='Close audience picker'
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 'var(--space-1)',
                }}
              >
                <X size={18} />
              </button>
            </div>
            {OPTIONS.map(opt => {
              const active = opt.value === value
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  type='button'
                  onClick={() => {
                    onSelect(opt.value)
                    onClose()
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3)',
                    background: active
                      ? 'var(--accent-subtle, rgba(249,115,22,0.08))'
                      : 'var(--bg-card)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'inherit',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 'var(--radius-sm)',
                      background: active ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: active ? 'var(--text-on-accent, #fff)' : 'var(--text-secondary)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--text-base)',
                        fontWeight: 'var(--font-semibold)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {opt.label}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs2)',
                        color: 'var(--text-muted)',
                        marginTop: 'var(--space-0-5)',
                        lineHeight: 1.4,
                      }}
                    >
                      {opt.description}
                    </div>
                  </div>
                  {active && <Check size={16} style={{ color: 'var(--accent)' }} />}
                </button>
              )
            })}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
