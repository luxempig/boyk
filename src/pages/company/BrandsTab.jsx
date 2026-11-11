import { Link } from 'react-router-dom'

import LazyImage from '../../components/atoms/LazyImage'
import { glassCard } from '../../lib/glassStyles'

export default function BrandsTab({ brands = [] }) {
  if (!brands.length)
    return (
      <div
        style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        No brands found
      </div>
    )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 'var(--space-3)',
        padding: 'var(--space-4) 0',
      }}
    >
      {brands.map(brand => (
        <Link
          key={brand.id || brand.name}
          to={`/brand/${brand.id}`}
          style={{
            ...glassCard,
            padding: 'var(--space-3)',
            textAlign: 'center',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <LazyImage
            src={brand.logo_url}
            alt={brand.name}
            style={{
              width: 48,
              height: 48,
              objectFit: 'contain',
              margin: '0 auto var(--space-2)',
              borderRadius: 'var(--radius-md)',
            }}
            fallback={
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto var(--space-2)',
                  fontSize: '18px',
                  color: '#fff',
                }}
              >
                {(brand.name || '?')[0]}
              </div>
            }
          />
          <div
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {brand.name}
          </div>
        </Link>
      ))}
    </div>
  )
}
