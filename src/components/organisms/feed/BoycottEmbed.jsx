/**
 * @component BoycottEmbed
 * @level Organism
 * @interactions Links to the dedicated boycott detail page at /boycott/:id
 */
import { Link } from 'react-router-dom'

export default function BoycottEmbed({ boycott }) {
  if (!boycott) return null

  return (
    <Link
      to={`/boycott/${boycott.id}`}
      onClick={e => e.stopPropagation()}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        borderLeft: '3px solid var(--accent)',
        padding: 'var(--space-2) var(--space-3)',
        marginTop: 'var(--space-2-5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-1)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: 'var(--accent)',
            fontWeight: 'var(--font-semibold)',
          }}
        >
          Boycott
        </span>
      </div>
      <p style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-md)', margin: 0 }}>
        {boycott.name}
      </p>
      {boycott.description && (
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {boycott.description}
        </p>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-1-5)' }}>
        {boycott.company_count > 0 && (
          <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
            {boycott.company_count} {boycott.company_count === 1 ? 'company' : 'companies'}
          </span>
        )}
        {boycott.tracker_count > 0 && (
          <span style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
            {boycott.tracker_count} {boycott.tracker_count === 1 ? 'follower' : 'followers'}
          </span>
        )}
      </div>
    </Link>
  )
}
