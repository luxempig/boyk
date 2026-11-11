import ConfidenceDot from '../../components/atoms/ConfidenceDot'
import { getSourceUrl, SOURCE_LABELS } from '../../lib/provenance'

const CONFIDENCE_TITLES = {
  high: 'High confidence — verified by authoritative source',
  medium: 'Medium confidence — corroboration pending',
  low: 'Low confidence — single unverified source',
}

const sourceTagStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-2xs)',
  color: 'var(--text-muted)',
  background: 'var(--bg-dark)',
  padding: '1px 5px',
  borderRadius: 'var(--radius-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

/**
 * ProvenanceBadge — the sourced-claim stamp: mono source tag (linked to the
 * original record when resolvable), ConfidenceDot, and corroboration count.
 * Expects relationship rows from connections.* (source, confidence,
 * corroborated_by) per the Neo4j API payload.
 */
export default function ProvenanceBadge({ item }) {
  if (!item.source) return null
  const label = SOURCE_LABELS[item.source] || item.source
  const corroborated = item.corroborated_by?.length > 0
  const url = getSourceUrl(item)

  const labelEl = url ? (
    <a
      href={url}
      target='_blank'
      rel='noopener noreferrer'
      style={{ ...sourceTagStyle, textDecoration: 'none', cursor: 'pointer' }}
      title={`View source on ${label}`}
      onClick={e => e.stopPropagation()}
      onMouseEnter={e => {
        e.currentTarget.style.color = 'var(--info)'
        e.currentTarget.style.textDecoration = 'underline'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--text-muted)'
        e.currentTarget.style.textDecoration = 'none'
      }}
    >
      {label}
    </a>
  ) : (
    <span style={sourceTagStyle}>{label}</span>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
      {labelEl}
      {item.confidence && (
        <span
          style={{ display: 'inline-flex', cursor: 'help' }}
          title={CONFIDENCE_TITLES[item.confidence] || `${item.confidence} confidence`}
        >
          <ConfidenceDot level={item.confidence} showLabel={false} size={7} />
        </span>
      )}
      {corroborated && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--info)',
          }}
          title={`Corroborated by: ${item.corroborated_by.join(', ')}`}
        >
          +{item.corroborated_by.length}
        </span>
      )}
    </div>
  )
}

export { ProvenanceBadge }
