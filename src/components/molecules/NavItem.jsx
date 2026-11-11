import { memo, useMemo } from 'react'

/**
 * @component NavItem
 * @level Molecule
 *
 * @description Bottom navigation item with icon, label, active glow, and optional badge.
 * Extracted from BottomNav's inline NavItem component.
 *
 * @interactions
 * - Click: Calls `onClick` (route navigation)
 *
 * @props
 * - icon: LucideIcon — Icon component from lucide-react
 * - label: string — Nav item label
 * - active: boolean — Highlights with accent color and glow when true
 * - onClick: () => void — Navigation handler
 * - badge: number — Notification count (0 or undefined = hidden)
 * - className: string
 */

const labelBaseStyle = {
  fontSize: '8px',
  fontWeight: 'var(--font-medium)',
}

const NavItem = memo(function NavItem({
  icon: Icon,
  label,
  active = false,
  onClick,
  badge,
  className = '',
}) {
  const containerStyle = useMemo(
    () => ({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-1)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 'var(--space-2) var(--space-4)',
      position: 'relative',
      minWidth: '64px',
      fontFamily: 'inherit',
    }),
    []
  )

  const iconColor = active ? 'var(--accent)' : 'var(--text-muted)'

  const iconContainerStyle = useMemo(
    () => ({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      filter: active ? 'drop-shadow(0 0 6px var(--accent))' : 'none',
    }),
    [active]
  )

  const labelStyle = useMemo(
    () => ({
      ...labelBaseStyle,
      fontWeight: active ? 'var(--font-semibold)' : 'var(--font-medium)',
      color: iconColor,
    }),
    [active, iconColor]
  )

  return (
    <button className={className} style={containerStyle} onClick={onClick} type='button'>
      <div style={iconContainerStyle}>
        <Icon size={18} style={{ color: iconColor }} />
      </div>

      <span style={labelStyle}>{label}</span>

      {/* Active indicator dot */}
      {active && (
        <div
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: '0 0 6px var(--accent-glow)',
          }}
        />
      )}

      {/* Badge */}
      {badge > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'var(--space-0-5)',
            right: 'var(--space-2)',
            background: 'var(--danger, #ef4444)',
            color: '#fff',
            fontSize: 'var(--text-2xs)',
            fontWeight: 'var(--font-bold)',
            minWidth: 'var(--space-4)',
            height: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 var(--space-1)',
            lineHeight: 1,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </div>
      )}
    </button>
  )
})

export { NavItem }
export default NavItem
