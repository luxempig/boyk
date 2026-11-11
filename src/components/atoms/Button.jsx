import { motion } from 'framer-motion'
import React, { useMemo } from 'react'

/**
 * @component Button
 * @level Atom
 *
 * @description Reusable button with multiple variants. Includes Framer Motion tap animation
 * and accessibility compliance (min-height 44px).
 *
 * @interactions
 * - Click: Calls `onClick`. Blocked when `disabled` or `loading`.
 * - Tap: Framer Motion scale(0.95) on press
 * - Hover: Slight opacity change (ghost/icon variants) or background shift
 * - Focus: Visible focus ring for keyboard navigation
 *
 * @props
 * - variant: 'primary'|'secondary'|'danger'|'ghost'|'icon' — Visual style
 * - size: 'sm'|'md'|'lg' — Padding and font size
 * - disabled: boolean — Grays out, blocks clicks
 * - loading: boolean — Shows spinner, blocks clicks
 * - onClick: () => void — Click handler
 * - icon: ReactNode — Optional icon element
 * - iconPosition: 'left'|'right' — Icon placement (default: 'left')
 * - children: ReactNode — Button label
 * - className: string — Additional CSS
 * - style: object — Additional inline styles
 * - type: 'button'|'submit' — HTML type (default: 'button')
 * - rounded: boolean — Use pill border-radius (20px)
 */

const SIZE_STYLES = {
  sm: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' },
  md: { padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)' },
  lg: { padding: 'var(--space-3-5) var(--space-5)', fontSize: 'var(--text-md)' },
}

const VARIANT_STYLES = {
  primary: {
    background: 'var(--gradient-accent)',
    color: 'var(--text-on-accent, #fff)',
    border: 'none',
    borderRadius: 'var(--radius-full)',
    boxShadow: '0 4px 20px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.25)',
  },
  secondary: {
    background: 'var(--glass-card, rgba(30,30,50,0.35))',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius-full)',
  },
  danger: {
    background: 'transparent',
    border: '1px solid var(--danger)',
    color: 'var(--danger)',
    borderRadius: 'var(--radius-full)',
    boxShadow: '0 4px 20px var(--danger-glow)',
  },
  ghost: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius-full)',
  },
  icon: {
    background: 'none',
    border: 'none',
    padding: 'var(--space-2)',
    borderRadius: '50%',
  },
}

const Button = React.forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    onClick,
    icon,
    iconPosition = 'left',
    children,
    className = '',
    style,
    type = 'button',
    rounded = false,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading
  const isIcon = variant === 'icon'

  const buttonStyle = useMemo(() => {
    const variantStyle = VARIANT_STYLES[variant] || VARIANT_STYLES.primary
    const sizeStyle = isIcon ? {} : SIZE_STYLES[size] || SIZE_STYLES.md

    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-2)',
      fontWeight: 'var(--font-bold)',
      fontFamily: 'var(--font-heading)',
      letterSpacing: '0.01em',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      borderRadius: isIcon ? '50%' : rounded ? 'var(--radius-full)' : 'var(--radius-full)',
      minHeight: isIcon ? undefined : '44px',
      opacity: isDisabled ? 0.5 : 1,
      pointerEvents: isDisabled ? 'none' : undefined,
      transition: 'background 0.15s, opacity 0.15s',
      ...variantStyle,
      ...sizeStyle,
      ...style,
    }
  }, [variant, size, isDisabled, isIcon, rounded, style])

  return (
    <motion.button
      ref={ref}
      type={type}
      className={className}
      style={buttonStyle}
      onClick={isDisabled ? undefined : onClick}
      whileTap={isDisabled ? undefined : { scale: 0.95 }}
      disabled={isDisabled}
      {...rest}
    >
      {loading ? (
        <div className='spinner' style={{ width: 16, height: 16 }} />
      ) : (
        <>
          {icon && iconPosition === 'left' && icon}
          {children}
          {icon && iconPosition === 'right' && icon}
        </>
      )}
    </motion.button>
  )
})

export { Button }
export default Button
