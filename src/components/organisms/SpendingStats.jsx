/**
 * @component SpendingStats
 * @level Organism
 * @interactions Displays summary stat cards for total spent, boycotted spend, transactions, and matched count.
 */
import { formatCurrency } from '../../utils/transactionMatcher'

export default function SpendingStats({ stats, loading }) {
  if (loading) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              padding: 'var(--space-5)',
              height: '100px',
            }}
          >
            <div
              className='skeleton'
              style={{ width: '60%', height: '14px', marginBottom: 'var(--space-3)' }}
            />
            <div className='skeleton' style={{ width: '80%', height: '28px' }} />
          </div>
        ))}
      </div>
    )
  }

  if (!stats) {
    return null
  }

  const statCards = [
    {
      label: 'Total Spent',
      value: formatCurrency(stats.total_spent || 0),
      color: 'var(--text-primary)',
    },
    {
      label: 'Boycotted Spend',
      value: formatCurrency(stats.boycotted_spent || 0),
      color: 'var(--danger)',
      highlight: true,
    },
    {
      label: 'Transactions',
      value: stats.total_transactions || 0,
      color: 'var(--text-primary)',
    },
    {
      label: 'Matched',
      value: `${stats.matched_transactions || 0} / ${stats.total_transactions || 0}`,
      color: 'var(--accent)',
    },
  ]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-6)',
      }}
    >
      {statCards.map((card, idx) => (
        <div
          key={idx}
          style={{
            background: card.highlight ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-card)',
            border: `1px solid ${card.highlight ? 'var(--danger)' : 'var(--border)'}`,
            padding: 'var(--space-5)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: 'var(--space-2)',
            }}
          >
            {card.label}
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 'var(--font-semibold)',
              color: card.color,
            }}
          >
            {card.value}
          </div>
        </div>
      ))}
    </div>
  )
}
