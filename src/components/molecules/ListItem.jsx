import { memo, useMemo } from 'react'

import Avatar from '../atoms/Avatar'

/**
 * @component ListItem
 * @level Molecule
 *
 * @description Horizontal row with avatar, text content, and optional action.
 *
 * @interactions
 * - Click row: Calls `onClick` (navigates to entity)
 * - Click action: Independent callback — stops propagation
 *
 * @composes
 * - Avatar — left side entity image
 *
 * @props
 * - avatar: { src, name, variant } — Avatar props (optional, no avatar if omitted)
 * - title: string — Primary text
 * - subtitle: string — Secondary text (muted)
 * - onClick: () => void — Row click handler
 * - action: ReactNode — Right-side action element
 * - className: string
 */

const truncateStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const ListItem = memo(function ListItem({
  avatar,
  title,
  subtitle,
  onClick,
  action,
  className = '',
}) {
  const containerStyle = useMemo(
    () => ({
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-2-5) 0',
      cursor: onClick ? 'pointer' : undefined,
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      transition: 'background 0.15s',
    }),
    [onClick]
  )

  const handleKeyDown = e => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      className={className}
      style={containerStyle}
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {avatar && <Avatar size='md' {...avatar} />}

      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--font-medium)',
              color: 'var(--text-primary)',
              ...truncateStyle,
            }}
          >
            {title}
          </div>
        )}
        {subtitle && (
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              ...truncateStyle,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      {action && <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{action}</div>}
    </div>
  )
})

export { ListItem }
export default ListItem
