/**
 * @component SpendingChart
 * @level Organism
 * @interactions Recharts area chart showing total and boycotted spending over time with custom tooltip.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatCurrency } from '../../utils/transactionMatcher'

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          background: 'var(--bg-dark)',
          border: '1px solid var(--border)',
          padding: 'var(--space-3)',
        }}
      >
        <p style={{ marginBottom: 'var(--space-2)', fontWeight: 'var(--font-medium)' }}>{label}</p>
        {payload.map((entry, index) => (
          <p
            key={index}
            style={{
              color: entry.color,
              fontSize: 'var(--text-base)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {entry.name}: {formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    )
  }
  return null
}

export default function SpendingChart({ data, loading }) {
  if (loading) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
          height: '300px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className='spinner' />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
          height: '300px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        No spending data available
      </div>
    )
  }

  // Format data for chart
  const chartData = data.map(d => ({
    period: new Date(d.period).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    total: parseFloat(d.total_spent) || 0,
    boycotted: parseFloat(d.boycotted_spent) || 0,
  }))

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        marginBottom: 'var(--space-6)',
      }}
    >
      <h3
        style={{
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--font-medium)',
          marginBottom: 'var(--space-4)',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: 'var(--text-muted)',
        }}
      >
        Spending Over Time
      </h3>
      <ResponsiveContainer width='100%' height={250}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id='colorTotal' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='var(--accent)' stopOpacity={0.3} />
              <stop offset='95%' stopColor='var(--accent)' stopOpacity={0} />
            </linearGradient>
            <linearGradient id='colorBoycotted' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='#ef4444' stopOpacity={0.3} />
              <stop offset='95%' stopColor='#ef4444' stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' />
          <XAxis dataKey='period' stroke='var(--text-muted)' fontSize={11} tickLine={false} />
          <YAxis
            stroke='var(--text-muted)'
            fontSize={11}
            tickLine={false}
            tickFormatter={value => `$${value}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 'var(--text-sm)', paddingTop: 'var(--space-4)' }} />
          <Area
            type='monotone'
            dataKey='total'
            name='Total Spending'
            stroke='var(--accent)'
            fillOpacity={1}
            fill='url(#colorTotal)'
          />
          <Area
            type='monotone'
            dataKey='boycotted'
            name='Boycotted'
            stroke='#ef4444'
            fillOpacity={1}
            fill='url(#colorBoycotted)'
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
