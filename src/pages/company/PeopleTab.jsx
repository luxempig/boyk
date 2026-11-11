import { Link } from 'react-router-dom'

import Avatar from '../../components/atoms/Avatar'
import ProvenanceBadge from './ProvenanceBadge'

// Source/confidence can sit on the person or on its relationship row — normalize
// into the shape ProvenanceBadge expects (with the person id for deep-links).
function personProvenance(person) {
  const rel = person.rel || {}
  return {
    source: person.source || rel.source,
    confidence: person.confidence || rel.confidence,
    corroborated_by: person.corroborated_by || rel.corroborated_by,
    source_url: person.source_url || rel.source_url,
    id: person.id,
    wikidata_id: person.wikidata_id,
    lei: person.lei,
  }
}

export default function PeopleTab({ people = [] }) {
  if (!people.length)
    return (
      <div
        style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        No key people found
      </div>
    )

  return (
    <div style={{ padding: 'var(--space-4) 0' }}>
      {people.map((person, idx) => (
        <Link
          key={person.id || idx}
          to={`/person/${person.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) 0',
            textDecoration: 'none',
            color: 'inherit',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <Avatar name={person.name} size='md' variant='user' />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {person.name}
            </div>
            {person.role && (
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  textTransform: 'capitalize',
                }}
              >
                {person.role.replace(/_/g, ' ')}
              </div>
            )}
            {person.total_compensation && (
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                }}
              >
                Total comp: ${(person.total_compensation / 1e6).toFixed(1)}M
                {person.comp_fiscal_year ? ` (${person.comp_fiscal_year})` : ''}
              </div>
            )}
          </div>
          {(person.source || person.rel?.source) && (
            <ProvenanceBadge item={personProvenance(person)} />
          )}
        </Link>
      ))}
    </div>
  )
}
