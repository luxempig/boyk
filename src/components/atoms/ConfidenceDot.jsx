/**
 * @component ConfidenceDot
 * @level Atom
 * @interactions The sourced-claim signal from the design system: a colored dot
 *               (green/amber/red) for high/medium/low confidence, optionally
 *               with a mono uppercase label and source note. Boyk's way of
 *               showing a claim is backed by evidence.
 */

const LEVELS = {
  high: { color: 'var(--confidence-high)', text: 'High' },
  medium: { color: 'var(--confidence-medium)', text: 'Medium' },
  low: { color: 'var(--confidence-low)', text: 'Low' },
}

export default function ConfidenceDot({
  level = 'high',
  showLabel = true,
  source,
  size = 10,
  style = {},
}) {
  const cfg = LEVELS[level] || LEVELS.high
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-2xs)',
        ...style,
      }}
    >
      <span
        aria-hidden='true'
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: cfg.color,
          boxShadow: `0 0 8px ${cfg.color}`,
          flexShrink: 0,
        }}
      />
      {showLabel && (
        <span
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-secondary)',
          }}
        >
          {cfg.text}
        </span>
      )}
      {source && <span style={{ color: 'var(--text-muted)' }}>· {source}</span>}
    </span>
  )
}
