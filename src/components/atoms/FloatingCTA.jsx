import { AnimatePresence, motion } from 'framer-motion'

const VARIANT_STYLES = {
  primary: {
    background: 'var(--gradient-accent)',
    boxShadow: '0 4px 20px var(--accent-glow, rgba(244,114,182,0.35))',
  },
  danger: {
    background: 'var(--gradient-gold, linear-gradient(135deg, #f472b6, #f9a8d4))',
    boxShadow: '0 4px 20px var(--gold-glow, rgba(244,114,182,0.3))',
  },
}

export default function FloatingCTA({
  label,
  icon: Icon,
  onClick,
  variant = 'primary',
  visible = true,
  className,
}) {
  const variantStyle = VARIANT_STYLES[variant] || VARIANT_STYLES.primary

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          className={className}
          onClick={onClick}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          whileTap={{ scale: 0.95 }}
          whileHover={{ y: -2 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            position: 'fixed',
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            ...variantStyle,
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-full, 9999px)',
            padding: 'var(--space-3) var(--space-5)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            fontFamily: 'var(--font-body, Inter, sans-serif)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            zIndex: 50,
          }}
        >
          {Icon && <Icon size={16} />}
          {label}
        </motion.button>
      )}
    </AnimatePresence>
  )
}
