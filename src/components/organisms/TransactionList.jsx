/**
 * @component TransactionList
 * @level Organism
 * @interactions Renders a list of Plaid transactions with company logos, boycott status badges, and links to company pages.
 */
import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'

import { formatCurrency } from '../../utils/transactionMatcher'
import LazyImage from '../atoms/LazyImage'

// Memoized transaction item for performance
const TransactionItem = memo(function TransactionItem({ tx }) {
  // Safely format date
  const formattedDate = useMemo(() => {
    if (!tx.date) return 'Unknown date'
    try {
      return new Date(tx.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return 'Invalid date'
    }
  }, [tx.date])

  // Get category safely
  const category =
    Array.isArray(tx.category) && tx.category.length > 0
      ? tx.category[tx.category.length - 1]
      : null

  // Get initial safely
  const initial = tx.company_name?.charAt(0) || tx.merchant_name?.charAt(0) || 'T'

  return (
    <article
      style={{
        background: tx.is_boycotted ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-card)',
        border: `1px solid ${tx.is_boycotted ? 'var(--danger)' : 'var(--border)'}`,
        padding: 'var(--space-4)',
      }}
      aria-label={`Transaction: ${tx.merchant_name || 'Unknown'} - ${formatCurrency(tx.amount)}`}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2-5)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {tx.company_logo_url ? (
              <LazyImage
                src={tx.company_logo_url}
                alt={tx.company_name || ''}
                style={{
                  width: '24px',
                  height: '24px',
                  objectFit: 'contain',
                  borderRadius: 'var(--radius-sm)',
                }}
                fallback={
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      background: 'var(--accent-fill)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--font-semibold)',
                      color: 'white',
                    }}
                  >
                    {initial}
                  </div>
                }
              />
            ) : tx.matched_company_id ? (
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  background: 'var(--accent-fill)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-semibold)',
                  color: 'white',
                }}
                aria-hidden='true'
              >
                {initial}
              </div>
            ) : null}

            <div
              style={{
                fontWeight: 'var(--font-medium)',
                fontSize: 'var(--text-lg)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {tx.merchant_name || 'Unknown Merchant'}
            </div>

            {tx.is_boycotted && (
              <span
                role='status'
                style={{
                  fontSize: 'var(--text-xs)',
                  padding: 'var(--space-0-5) var(--space-1-5)',
                  background: 'var(--danger)',
                  color: 'white',
                  textTransform: 'uppercase',
                  fontWeight: 'var(--font-semibold)',
                }}
              >
                Boycotted
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              flexWrap: 'wrap',
            }}
          >
            <span>{formattedDate}</span>

            {tx.matched_company_id && tx.company_name && (
              <>
                <span aria-hidden='true'>·</span>
                <Link
                  to={`/company/${tx.matched_company_id}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}
                >
                  {tx.company_name}
                </Link>
                {typeof tx.match_confidence === 'number' && (
                  <span style={{ fontSize: 'var(--text-xs)' }}>
                    ({Math.round(tx.match_confidence * 100)}% match)
                  </span>
                )}
              </>
            )}

            {category && (
              <>
                <span aria-hidden='true'>·</span>
                <span>{category}</span>
              </>
            )}
          </div>
        </div>

        <div
          style={{
            fontWeight: 'var(--font-semibold)',
            fontSize: 'var(--text-lg)',
            color: tx.is_boycotted ? 'var(--danger)' : 'var(--text-primary)',
            marginLeft: 'var(--space-4)',
            whiteSpace: 'nowrap',
          }}
        >
          {formatCurrency(tx.amount)}
        </div>
      </div>
    </article>
  )
})

function TransactionList({ transactions, loading }) {
  if (loading) {
    return (
      <div
        role='status'
        aria-label='Loading transactions'
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
      >
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              padding: 'var(--space-4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                className='skeleton'
                style={{ width: '60%', height: '16px', marginBottom: 'var(--space-2)' }}
              />
              <div className='skeleton' style={{ width: '40%', height: '12px' }} />
            </div>
            <div className='skeleton' style={{ width: '80px', height: '20px' }} />
          </div>
        ))}
      </div>
    )
  }

  if (!transactions || transactions.length === 0) {
    return (
      <div
        role='status'
        style={{
          textAlign: 'center',
          padding: 'var(--space-8)',
          color: 'var(--text-muted)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}
      >
        <p style={{ fontSize: 'var(--text-lg)' }}>No transactions found</p>
        <p style={{ fontSize: 'var(--text-base)', marginTop: 'var(--space-2)' }}>
          Connect a bank account to see your spending
        </p>
      </div>
    )
  }

  return (
    <div
      role='list'
      aria-label='Transaction list'
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      {transactions.map(tx => (
        <TransactionItem key={tx.id || `tx-${tx.date}-${tx.amount}`} tx={tx} />
      ))}
    </div>
  )
}

export default memo(TransactionList)
