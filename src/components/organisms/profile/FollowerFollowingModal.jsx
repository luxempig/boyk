import { Link } from 'react-router-dom'

import { Avatar } from '../../atoms/Avatar'
import { Modal } from '../../molecules/Modal'

/**
 * @component FollowerFollowingModal
 * @level Organism
 * @interactions Navigate to user profile from list
 *
 * Modal displaying followers or following list.
 */
export default function FollowerFollowingModal({
  isOpen,
  onClose,
  type = 'followers', // 'followers' | 'following'
  users = [],
  title,
}) {
  const modalTitle = title || (type === 'followers' ? 'Followers' : 'Following')
  const emptyMessage = type === 'followers' ? 'No followers yet' : 'Not following anyone yet'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size='md'>
      {users.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-5)' }}>
          {emptyMessage}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {users.map(user => (
            <UserListItem key={user.id} user={user} onClose={onClose} />
          ))}
        </div>
      )}
    </Modal>
  )
}

/**
 * Individual user item in the list
 */
function UserListItem({ user, onClose }) {
  return (
    <Link
      to={`/user/${user.id}`}
      onClick={onClose}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--bg-dark)',
        border: '1px solid var(--border)',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Avatar */}
      <Avatar
        src={user.profile_picture_url}
        name={user.display_name || user.username}
        size='lg'
        variant='user'
      />

      {/* User info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {user.display_name && (
          <div
            style={{
              fontWeight: 'var(--font-medium)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.display_name}
          </div>
        )}
        <div
          style={{
            fontSize: 'var(--text-base)',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          @{user.username}
        </div>
      </div>

      {/* Arrow indicator */}
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xl)', flexShrink: 0 }}>
        {'\u2192'}
      </span>
    </Link>
  )
}

/**
 * Compact avatar for inline display
 */
export function UserAvatar({ user, size = 40 }) {
  // Map pixel size to Avatar atom size prop
  const sizeMap = { 18: 'xs', 24: 'sm', 32: 'md', 40: 'lg', 48: 'xl' }
  const avatarSize = sizeMap[size] || 'lg'
  return (
    <Avatar
      src={user?.profile_picture_url}
      name={user?.display_name || user?.username}
      size={avatarSize}
      variant='user'
    />
  )
}
