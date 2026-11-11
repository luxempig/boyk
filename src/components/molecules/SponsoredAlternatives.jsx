/**
 * @component SponsoredAlternatives
 * @level Molecule
 * @interactions Surfaces sponsored + organic alternative companies for a
 * scanned product whose company conflicts with the user's boycotts.
 *
 * Hydrates each alternative's display data (name, logo, website) from the
 * Neo4j API. Sponsored alternatives are tagged and shown first by the RPC.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useProductAlternatives } from '../../hooks/useProductAlternatives'
import { getCompanyWithConnections } from '../../services/neo4jGraph'

function AlternativeCard({ alt, company }) {
  if (!company) return null
  return (
    <Link
      to={`/company/${alt.alternative_company_id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--bg-card)',
        border: alt.is_sponsored ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      {company.logo_url && (
        <img
          src={company.logo_url}
          alt={company.name}
          style={{
            width: 36,
            height: 36,
            objectFit: 'contain',
            background: '#fff',
            borderRadius: 'var(--radius-sm)',
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
          }}
        >
          <span
            style={{
              fontWeight: 'var(--font-medium)',
              fontSize: 'var(--text-md)',
            }}
          >
            {company.name}
          </span>
          {alt.is_sponsored && (
            <span
              style={{
                fontSize: 'var(--text-2xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px var(--space-1-5)',
              }}
            >
              Sponsored
            </span>
          )}
        </div>
        {alt.pitch && (
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              marginTop: 'var(--space-0-5)',
              lineHeight: 'var(--leading-snug)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {alt.pitch}
          </p>
        )}
      </div>
    </Link>
  )
}

export default function SponsoredAlternatives({ targetCompanyId }) {
  const { data: alternatives = [], isLoading } = useProductAlternatives(targetCompanyId)
  const [companyMap, setCompanyMap] = useState({})

  useEffect(() => {
    let cancelled = false
    if (alternatives.length === 0) return
    const ids = alternatives.map(a => a.alternative_company_id)
    Promise.all(
      ids.map(id =>
        getCompanyWithConnections(id)
          .then(c => [id, c])
          .catch(() => [id, null])
      )
    ).then(pairs => {
      if (cancelled) return
      const next = {}
      for (const [id, c] of pairs) next[id] = c
      setCompanyMap(next)
    })
    return () => {
      cancelled = true
    }
  }, [alternatives])

  if (isLoading || alternatives.length === 0) return null

  return (
    <div
      style={{
        marginTop: 'var(--space-5)',
        padding: 'var(--space-4)',
        background: 'var(--bg-dark)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <h4 className='subsection-label' style={{ marginBottom: 'var(--space-3)' }}>
        Recommended alternatives
      </h4>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {alternatives.map(alt => (
          <AlternativeCard
            key={alt.id}
            alt={alt}
            company={companyMap[alt.alternative_company_id]}
          />
        ))}
      </div>
    </div>
  )
}
