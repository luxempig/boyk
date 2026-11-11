import { glassCard } from '../../lib/glassStyles'
import Avatar from '../atoms/Avatar'

export function ComposeBar({
  avatarSrc,
  avatarName,
  placeholder = "What's happening?",
  onClick,
  className,
  style,
}) {
  return (
    <button
      className={className}
      onClick={onClick}
      style={{
        ...glassCard,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        width: '100%',
        border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        ...style,
      }}
    >
      <Avatar src={avatarSrc} name={avatarName || '?'} size='sm' />
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', flex: 1 }}>
        {placeholder}
      </span>
    </button>
  )
}

export default ComposeBar
