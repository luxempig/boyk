import { motion } from 'framer-motion'

import { gaugeArc } from '../../lib/animations'

const SIZE_MAP = { sm: 80, md: 120, lg: 160 }

function getColor(score) {
  if (score <= 33) return '#34d399'
  if (score <= 66) return '#fbbf24'
  return '#fb7185'
}

export function CorporateThreatScore({
  score = 0,
  size = 'md',
  label = 'Threat Score',
  className,
}) {
  const s = SIZE_MAP[size] || SIZE_MAP.md
  const color = getColor(score)
  const arcLength = 157
  const targetDash = (arcLength * Math.min(score, 100)) / 100

  return (
    <div className={className} style={{ textAlign: 'center' }}>
      <svg viewBox='0 0 120 70' width={s} height={(s * 70) / 120}>
        {/* Background arc */}
        <path
          d='M 10 60 A 50 50 0 0 1 110 60'
          stroke='rgba(255,255,255,0.06)'
          strokeWidth='8'
          fill='none'
        />
        {/* Score arc */}
        <motion.path
          d='M 10 60 A 50 50 0 0 1 110 60'
          stroke={color}
          strokeWidth='8'
          fill='none'
          strokeLinecap='round'
          strokeDasharray={arcLength}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          {...gaugeArc(targetDash)}
        />
        {/* Score number */}
        <text
          x='60'
          y='52'
          textAnchor='middle'
          fill='white'
          fontSize='24'
          fontFamily='Sora'
          fontWeight='700'
        >
          {score}
        </text>
      </svg>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginTop: 'var(--space-1)',
        }}
      >
        {label}
      </div>
    </div>
  )
}

export default CorporateThreatScore
