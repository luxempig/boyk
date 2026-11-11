import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import LazyImage from '../components/atoms/LazyImage'
import NotFoundState from '../components/molecules/NotFoundState'
import Header from '../components/organisms/Header'
import { useSafeState } from '../hooks/useSafeState'
import { getBrandById, getCompanyLinkId } from '../services/neo4jGraph'
import ProvenanceBadge from './company/ProvenanceBadge'

export default function Brand() {
  const { brandId } = useParams()
  const location = useLocation()
  const referrerName = location.state?.name
  const { safeSetState } = useSafeState()

  const [brand, setBrand] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchBrand = async () => {
      safeSetState(setLoading, true)
      try {
        const data = await getBrandById(brandId)
        safeSetState(setBrand, data)
      } catch {
        // handled by getBrandById
      } finally {
        safeSetState(setLoading, false)
      }
    }

    if (brandId) fetchBrand()
  }, [brandId, safeSetState])

  if (loading) {
    return (
      <div className='container'>
        <Header pageLabel='Brand' />
        <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-5)' }}>
          <div className='spinner'></div>
        </div>
      </div>
    )
  }

  if (!brand) {
    return (
      <div className='container'>
        <Header pageLabel='Brand' />
        <NotFoundState label='Brand' name={referrerName} />
      </div>
    )
  }

  const products = brand.products || []

  return (
    <div className='container'>
      <Header pageLabel='Brand' />

      {/* Brand Header */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
          <LazyImage
            src={brand.logo_url}
            alt={brand.name}
            style={{
              width: '120px',
              height: '72px',
              objectFit: 'contain',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '6px',
              flexShrink: 0,
            }}
            fallback={
              <div
                style={{
                  width: '120px',
                  height: '72px',
                  background: 'var(--accent)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 'var(--font-bold)',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {brand.name?.charAt(0).toUpperCase() || 'B'}
              </div>
            }
          />
          <div style={{ flex: 1 }}>
            <h1
              style={{
                fontSize: 'var(--text-3xl)',
                fontWeight: 'var(--font-semibold)',
                marginBottom: 'var(--space-2)',
              }}
            >
              {brand.name}
            </h1>
            {brand.description && (
              <p
                style={{
                  fontSize: 'var(--text-md)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                {brand.description}
              </p>
            )}
            <span
              style={{
                fontSize: 'var(--text-xs2)',
                padding: 'var(--space-0-5) var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(168, 85, 247, 0.1)',
                color: '#a855f7',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Brand
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
              {products.length}
            </span>
            <span
              style={{
                fontSize: 'var(--text-base)',
                color: 'var(--text-muted)',
                marginLeft: 'var(--space-1-5)',
              }}
            >
              {products.length === 1 ? 'product' : 'products'}
            </span>
          </div>
        </div>
      </div>

      {/* Owner Company */}
      {brand.company && (
        <div
          style={{
            background: 'var(--bg-dark)',
            border: '1px solid var(--border)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid var(--border)',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-medium)',
              color: 'var(--text-secondary)',
            }}
          >
            Owned by
          </div>
          <div style={{ padding: 'var(--space-4)' }}>
            <Link
              to={`/company/${getCompanyLinkId(brand.company)}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'border-color 0.2s',
              }}
            >
              <LazyImage
                src={brand.company.logo_url}
                alt={brand.company.name}
                style={{
                  width: '32px',
                  height: '32px',
                  objectFit: 'contain',
                  background: '#fff',
                  borderRadius: 'var(--radius-sm)',
                  flexShrink: 0,
                }}
                fallback={
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      background: 'var(--bg-dark)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--text-md)',
                      fontWeight: 'var(--font-semibold)',
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {brand.company.name?.charAt(0).toUpperCase() || 'C'}
                  </div>
                }
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: 'var(--font-medium)',
                    fontSize: '15px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  {brand.company.name}
                  <ProvenanceBadge item={brand.company} />
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-xs2)',
                    color: 'var(--accent)',
                    marginTop: 'var(--space-0-5)',
                  }}
                >
                  View company profile
                </div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Products */}
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
          Products ({products.length})
        </div>

        {products.length === 0 ? (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              padding: 'var(--space-6)',
              textAlign: 'center',
            }}
          >
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
              No products found for this brand
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {products.map((product, idx) => (
              <motion.div
                key={product.barcode || idx}
                className='animate-fade-in-up'
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3) var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  animationDelay: `${Math.min(idx, 9) * 0.05}s`,
                }}
              >
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    style={{
                      width: '40px',
                      height: '40px',
                      objectFit: 'contain',
                      borderRadius: 'var(--radius-sm)',
                      background: '#fff',
                      flexShrink: 0,
                    }}
                    onError={e => {
                      e.target.style.display = 'none'
                    }}
                  />
                ) : (
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
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    P
                  </div>
                )}
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
                    {product.name || 'Unnamed product'}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-0-5)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {product.barcode && <span>{product.barcode}</span>}
                    {product.category && (
                      <span>
                        {product.barcode ? ' · ' : ''}
                        {product.category}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
