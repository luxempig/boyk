import { motion } from 'framer-motion'
import { memo, useMemo } from 'react'

/**
 * @component Skeleton
 * @level Atom
 *
 * @description Loading placeholder with shimmer animation.
 *
 * @interactions
 * - None (loading placeholder)
 *
 * @props
 * - variant: 'line'|'circle'|'rect' — Shape (default: 'line')
 * - width: string|number — CSS width (default: '100%' for line)
 * - height: string|number — CSS height (default: 16 for line)
 * - count: number — Render N skeletons stacked vertically (default: 1)
 * - className: string
 * - style: object
 */

const VARIANT_DEFAULTS = {
  line: { width: '100%', height: 16, borderRadius: 'var(--radius-sm)' },
  circle: { width: 32, height: 32, borderRadius: '50%' },
  rect: { width: '100%', height: 80, borderRadius: 'var(--radius-md)' },
}

const shimmerTransition = {
  duration: 1.5,
  repeat: Infinity,
  ease: 'easeInOut',
}

const shimmerAnimate = {
  backgroundPosition: ['-200% 0', '200% 0'],
}

const Skeleton = memo(function Skeleton({
  variant = 'line',
  width,
  height,
  count = 1,
  className = '',
  style,
}) {
  const defaults = VARIANT_DEFAULTS[variant] || VARIANT_DEFAULTS.line

  const itemStyle = useMemo(() => {
    const w = width ?? defaults.width
    const h = height ?? defaults.height

    return {
      width: typeof w === 'number' ? `${w}px` : w,
      height: typeof h === 'number' ? `${h}px` : h,
      borderRadius: defaults.borderRadius,
      background:
        'linear-gradient(90deg, rgba(30,30,50,0.3), rgba(244,114,182,0.06), rgba(30,30,50,0.3))',
      backgroundSize: '200% 100%',
      ...style,
    }
  }, [width, height, defaults, style])

  if (count <= 1) {
    return (
      <motion.div
        className={className}
        style={itemStyle}
        animate={shimmerAnimate}
        transition={shimmerTransition}
      />
    )
  }

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          style={itemStyle}
          animate={shimmerAnimate}
          transition={{ ...shimmerTransition, delay: i * 0.1 }}
        />
      ))}
    </div>
  )
})

export { Skeleton }
export default Skeleton
