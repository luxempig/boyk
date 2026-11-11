import { motion } from 'framer-motion'
import { memo, useMemo } from 'react'

import { springQuick } from '../../lib/animations'
import { glassCard } from '../../lib/glassStyles'

/**
 * @component Card
 * @level Atom
 *
 * @description Container with consistent border, background, and border-radius.
 * Clickable variant adds hover lift animation.
 *
 * @interactions
 * - Click: Calls `onClick` (clickable variant only)
 * - Hover: Clickable variant lifts 4px with spring animation
 *
 * @props
 * - variant: 'default'|'elevated'|'glass'|'clickable' — Visual style
 * - padding: 'none'|'sm'|'md'|'lg' — Internal padding (0/8/12/16px)
 * - onClick: () => void — Makes card clickable
 * - className: string — Additional CSS
 * - children: ReactNode
 * - style: object
 */

const PADDING_MAP = {
  none: '0px',
  sm: 'var(--space-2)',
  md: 'var(--space-3)',
  lg: 'var(--space-4)',
}

const Card = memo(function Card({
  variant = 'default',
  padding = 'md',
  onClick,
  className = '',
  children,
  style,
}) {
  const isClickable = variant === 'clickable'
  const paddingValue = PADDING_MAP[padding] ?? PADDING_MAP.md

  const cardStyle = useMemo(() => {
    const base = {
      ...glassCard,
      padding: paddingValue,
    }

    if (variant === 'elevated') {
      return {
        ...base,
        background: 'var(--bg-elevated)',
        ...style,
      }
    }

    if (variant === 'glass') {
      return {
        ...base,
        ...style,
      }
    }

    // default and clickable
    return {
      ...base,
      cursor: isClickable ? 'pointer' : undefined,
      ...style,
    }
  }, [variant, paddingValue, isClickable, style])

  if (isClickable) {
    return (
      <motion.div
        className={className}
        style={cardStyle}
        onClick={onClick}
        whileHover={{
          y: -4,
          transition: { type: 'spring', damping: 20, stiffness: 300 },
        }}
        whileTap={{ scale: 0.98, transition: springQuick }}
      >
        {children}
      </motion.div>
    )
  }

  return (
    <div className={className} style={cardStyle}>
      {children}
    </div>
  )
})

export { Card }
export default Card
