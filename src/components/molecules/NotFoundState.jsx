import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

/**
 * Consistent "not found" state for entities referenced in our DB but no longer
 * present in the graph (Neo4j). Used by Company, Brand, Person pages.
 *
 * Rather than dumping users back on /explore, we offer history.back() so the
 * click lands them where they came from (usually a boycott or a search).
 */
export default function NotFoundState({ label = 'Entity', name }) {
  const navigate = useNavigate()
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  return (
    <div
      style={{
        textAlign: 'center',
        padding: 'var(--space-12) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      <p style={{ color: 'var(--text-primary)', fontSize: 'var(--text-lg)' }}>
        {name ? (
          <>
            <strong>{name}</strong> is no longer tracked
          </>
        ) : (
          `${label} not found`
        )}
      </p>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        This can happen when an entity is removed from our data sources or merged into another
        record.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-3)',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {canGoBack && (
          <button
            type='button'
            onClick={() => navigate(-1)}
            className='btn-secondary'
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1-5)' }}
          >
            <ArrowLeft size={14} />
            Go back
          </button>
        )}
        <Link to='/explore' className='btn-primary'>
          Explore
        </Link>
      </div>
    </div>
  )
}
