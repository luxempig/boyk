import './paper.css'

import { useNavigate } from 'react-router-dom'

function initial(name) {
  return (name || '?').trim()[0]?.toUpperCase() || '?'
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Paper-preview rendering of a boycott. Visual-only — click anywhere navigates
 * to /boycott/:id. Interactive affordances (edit/delete/follow/expand) are left
 * to the regular BoycottCard in default mode; this card is for comparison.
 */
export default function PaperBoycottCard({
  boycott,
  isFollowing = false,
  onFollowToggle,
  disabled = false,
}) {
  const navigate = useNavigate()
  if (!boycott) return null

  const creator = boycott.profiles || {}
  const creatorName = creator.display_name || creator.username || 'Unknown user'
  const creatorHandle = creator.username
  const companies = boycott.boycott_companies || []
  const firstCompany = companies.find(bc => bc.companies)?.companies
  const additionalCount = Math.max(0, (boycott.company_count ?? companies.length) - 1)

  const go = () => navigate(`/boycott/${boycott.id}`)

  const handleFollowClick = e => {
    // Keep the card's navigate-to-detail click from firing.
    e.stopPropagation()
    if (disabled) return
    // Match BoycottCard's (event, boycott) callback contract — consumers
    // (Explore, Profile) call e.stopPropagation() and read boycott.id.
    onFollowToggle?.(e, boycott)
  }

  return (
    <div
      className='paper-card'
      onClick={go}
      role='link'
      tabIndex={0}
      data-testid='feed-boycott-card'
      data-boycott-id={boycott.id}
      onKeyDown={e => {
        if (e.key === 'Enter') go()
      }}
    >
      <div className='pc-head'>
        <div className='pc-avatar'>
          {creator.profile_picture_url ? (
            <img src={creator.profile_picture_url} alt={creatorName} />
          ) : (
            initial(creatorName)
          )}
        </div>
        <div className='pc-author'>
          <div className='pc-author-line'>
            <span className='pc-author-name'>{creatorName}</span>
            {creatorHandle && <span className='pc-author-handle'>@{creatorHandle}</span>}
            <span className='pc-timestamp'>{timeAgo(boycott.created_at)}</span>
          </div>
        </div>
        <span className='pc-badge'>
          <span className='pc-badge-dot' />
          Boycott
        </span>
      </div>

      <div className='pc-title'>{boycott.name}</div>

      {firstCompany && (
        <div className='pc-target'>
          {firstCompany.logo_url ? (
            <img src={firstCompany.logo_url} alt={firstCompany.name} className='pc-target-logo' />
          ) : (
            <span
              className='pc-target-logo'
              style={{
                display: 'grid',
                placeItems: 'center',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {initial(firstCompany.name)}
            </span>
          )}
          <span>
            Target: <strong>{firstCompany.name}</strong>
            {additionalCount > 0 && ` · +${additionalCount} more`}
          </span>
        </div>
      )}

      {boycott.description && <div className='pc-body'>{boycott.description}</div>}

      <div className='pc-meta'>
        <span className='pc-meta-item'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
          </svg>
          {boycott.comment_count ?? 0}
        </span>
        <button
          type='button'
          className={`pc-meta-item pc-meta-button${isFollowing ? ' active' : ''}`}
          onClick={handleFollowClick}
          disabled={disabled || !onFollowToggle}
          aria-label={isFollowing ? 'Unfollow boycott' : 'Follow boycott'}
          aria-pressed={!!isFollowing}
          data-testid='paper-boycott-follow-button'
        >
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill={isFollowing ? 'currentColor' : 'none'}
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' />
          </svg>
          {boycott.tracker_count ?? 0}
        </button>
        <span className='pc-meta-views'>
          {boycott.company_count ?? companies.length}{' '}
          {(boycott.company_count ?? companies.length) === 1 ? 'company' : 'companies'}
        </span>
      </div>
    </div>
  )
}
