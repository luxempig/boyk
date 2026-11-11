import { memo, useMemo } from 'react'

import LazyImage from './LazyImage'

/**
 * @component Avatar
 * @level Atom
 *
 * @description Displays a user, company, or brand avatar with image or fallback initials.
 * Uses LazyImage for performant image loading with Intersection Observer.
 *
 * @interactions
 * - Click: Calls `onClick` prop if provided (typically navigates to entity profile)
 *
 * @props
 * - src: string — Image URL (optional, shows fallback if missing)
 * - name: string — Entity name, used for fallback initials
 * - size: 'xs'|'sm'|'md'|'lg'|'xl' — Maps to 18/24/32/40/48px
 * - variant: 'user'|'company'|'brand' — Affects fallback background gradient
 * - onClick: () => void — Optional click handler
 * - className: string — Additional CSS classes for positioning/margins
 * - style: object — Additional inline styles
 *
 * @example
 * <Avatar src={user.avatar_url} name={user.display_name} size="lg" variant="user" />
 * <Avatar name={company.name} size="md" variant="company" onClick={() => navigate(`/company/${id}`)} />
 */

const SIZE_MAP = {
  xs: 18,
  sm: 24,
  md: 32,
  lg: 40,
  xl: 48,
}

const VARIANT_BACKGROUNDS = {
  user: 'var(--avatar-user, linear-gradient(135deg, #db2777, #f472b6))',
  company: 'var(--avatar-company, linear-gradient(135deg, #ec4899, #34d399))',
  brand: 'var(--avatar-brand, linear-gradient(135deg, #a855f7, #7c3aed))',
}

const Avatar = memo(function Avatar({
  src,
  name,
  size = 'md',
  variant = 'user',
  onClick,
  className = '',
  style,
}) {
  const sizeValue = SIZE_MAP[size] || SIZE_MAP.md
  const initial = name ? name[0].toUpperCase() : '?'
  const background = VARIANT_BACKGROUNDS[variant] || VARIANT_BACKGROUNDS.user

  const containerStyle = useMemo(
    () => ({
      width: `${sizeValue}px`,
      height: `${sizeValue}px`,
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden',
      cursor: onClick ? 'pointer' : undefined,
      border: '1px solid var(--glass-border)',
      ...style,
    }),
    [sizeValue, onClick, style]
  )

  const fallbackStyle = useMemo(
    () => ({
      ...containerStyle,
      background,
      fontSize: `${Math.round(sizeValue * 0.45)}px`,
      fontWeight: 600,
      color: '#fff',
    }),
    [containerStyle, background, sizeValue]
  )

  // Fallback: no src provided
  if (!src) {
    return (
      <div
        className={className}
        style={fallbackStyle}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={
          onClick
            ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onClick()
                }
              }
            : undefined
        }
      >
        {initial}
      </div>
    )
  }

  // Image via LazyImage with fallback
  const fallbackEl = <div style={fallbackStyle}>{initial}</div>

  return (
    <div
      className={className}
      style={containerStyle}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <LazyImage
        src={src}
        alt={name || ''}
        style={{
          width: `${sizeValue}px`,
          height: `${sizeValue}px`,
          objectFit: variant === 'user' ? 'cover' : 'contain',
          borderRadius: '50%',
        }}
        fallback={fallbackEl}
      />
    </div>
  )
})

export { Avatar }
export default Avatar
