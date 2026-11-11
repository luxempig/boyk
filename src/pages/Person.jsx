import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import LazyImage from '../components/atoms/LazyImage'
import NotFoundState from '../components/molecules/NotFoundState'
import Header from '../components/organisms/Header'
import { useSafeState } from '../hooks/useSafeState'
import { getCompanyLinkId, getPersonById } from '../services/neo4jGraph'

const ROLE_LABELS = {
  CEO_OF: 'CEO',
  FOUNDED: 'Founder',
  BOARD_MEMBER_OF: 'Board Member',
  COMPENSATED_BY: 'Compensated By',
  SIGNIFICANT_CONTROL: 'Significant Control',
}

export default function Person() {
  const { personId } = useParams()
  const location = useLocation()
  const referrerName = location.state?.name
  const { safeSetState } = useSafeState()

  const [person, setPerson] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPerson = async () => {
      safeSetState(setLoading, true)
      try {
        const data = await getPersonById(personId)
        safeSetState(setPerson, data)
      } catch {
        // handled by getPersonById
      } finally {
        safeSetState(setLoading, false)
      }
    }

    if (personId) fetchPerson()
  }, [personId, safeSetState])

  if (loading) {
    return (
      <div className='container'>
        <Header pageLabel='Person' />
        <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-5)' }}>
          <div className='spinner'></div>
        </div>
      </div>
    )
  }

  if (!person) {
    return (
      <div className='container'>
        <Header pageLabel='Person' />
        <NotFoundState label='Person' name={referrerName} />
      </div>
    )
  }

  const companies = person.companies || []

  return (
    <div className='container'>
      <Header pageLabel='Person' />

      {/* Person Header */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              background: 'var(--accent)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-full)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontWeight: 'var(--font-bold)',
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {person.name?.charAt(0).toUpperCase() || 'P'}
          </div>
          <div style={{ flex: 1 }}>
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 'var(--font-semibold)',
                marginBottom: 'var(--space-2)',
              }}
            >
              {person.name}
            </h1>
            {person.description && (
              <p
                style={{
                  fontSize: 'var(--text-md)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                {person.description}
              </p>
            )}
            <span
              style={{
                fontSize: 'var(--text-xs2)',
                padding: 'var(--space-0-5) var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Person
            </span>
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-6)',
            marginTop: 'var(--space-5)',
            paddingTop: 'var(--space-5)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div>
            <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-semibold)' }}>
              {companies.length}
            </span>
            <span
              style={{
                fontSize: 'var(--text-base)',
                color: 'var(--text-muted)',
                marginLeft: 'var(--space-1-5)',
              }}
            >
              {companies.length === 1 ? 'company' : 'companies'}
            </span>
          </div>
        </div>
      </div>

      {/* Companies */}
      <div style={{ marginBottom: '100px' }}>
        <div
          style={{
            fontSize: 'var(--text-xs2)',
            textTransform: 'uppercase',
            letterSpacing: '2px',
            color: 'var(--text-muted)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Companies ({companies.length})
        </div>

        {companies.length === 0 ? (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              padding: 'var(--space-6)',
              textAlign: 'center',
            }}
          >
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
              No company affiliations found
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {companies.map((company, idx) => (
              <Link
                key={company.id || idx}
                to={`/company/${getCompanyLinkId(company) || company.id}`}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3) var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'border-color 0.2s',
                }}
              >
                <LazyImage
                  src={company.logo_url}
                  alt={company.name}
                  style={{
                    width: '40px',
                    height: '40px',
                    objectFit: 'contain',
                    background: '#fff',
                    borderRadius: 'var(--radius-sm)',
                    flexShrink: 0,
                  }}
                  fallback={
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-dark)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--text-lg)',
                        fontWeight: 'var(--font-semibold)',
                        color: 'var(--text-muted)',
                        flexShrink: 0,
                      }}
                    >
                      {company.name?.charAt(0).toUpperCase() || 'C'}
                    </div>
                  }
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 'var(--font-medium)',
                      fontSize: 'var(--text-md)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {company.name}
                  </div>
                  {company.role && (
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-muted)',
                        marginTop: 'var(--space-0-5)',
                      }}
                    >
                      {ROLE_LABELS[company.role] || company.role.replace(/_/g, ' ')}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-xs2)', color: 'var(--accent)' }}>View</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
