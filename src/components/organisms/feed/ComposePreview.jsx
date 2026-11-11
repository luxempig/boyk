import { tokenizeContent } from '../../../lib/renderMentions'
import Avatar from '../../atoms/Avatar'
import BoycottEmbed from './BoycottEmbed'
import LinkPreview from './LinkPreview'

function renderBody(content) {
  const tokens = tokenizeContent(content)
  return tokens.map((tok, i) => {
    if (tok.kind === 'text') return tok.value
    return (
      <span key={'m-' + i} style={{ color: 'var(--accent)', fontWeight: 'var(--font-semibold)' }}>
        {tok.value}
      </span>
    )
  })
}

/**
 * Renders a live preview of the post currently being composed.
 * Mirrors the feed post layout so users see what they're about to publish.
 */
export default function ComposePreview({
  author,
  content,
  mediaPreviews = [],
  boycott,
  linkPreview,
}) {
  const displayName = author?.display_name || author?.email || 'You'
  const username = author?.username || 'you'
  const avatarUrl = author?.avatar_url

  const gridStyle =
    mediaPreviews.length === 1
      ? { display: 'block' }
      : {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-1)',
        }

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--space-2-5)', alignItems: 'center' }}>
        <Avatar src={avatarUrl} name={displayName} size='sm' />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 'var(--font-semibold)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
            }}
          >
            {displayName}
          </div>
          <div style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
            @{username} · just now
          </div>
        </div>
      </div>

      {content?.trim() ? (
        <p
          style={{
            margin: 0,
            color: 'var(--text-primary)',
            fontSize: 'var(--text-base)',
            lineHeight: 'var(--leading-normal)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {renderBody(content)}
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            color: 'var(--text-muted)',
            fontSize: 'var(--text-base)',
            fontStyle: 'italic',
          }}
        >
          Your post will appear here…
        </p>
      )}

      {mediaPreviews.length > 0 && (
        <div
          style={{
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            ...gridStyle,
          }}
        >
          {mediaPreviews.map(src => (
            <img
              key={src}
              src={src}
              alt=''
              style={{
                width: '100%',
                height: mediaPreviews.length === 1 ? 'auto' : '120px',
                maxHeight: '200px',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ))}
        </div>
      )}

      {boycott && <BoycottEmbed boycott={boycott} />}
      {linkPreview?.title && <LinkPreview preview={linkPreview} />}
    </div>
  )
}
