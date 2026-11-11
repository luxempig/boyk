/**
 * @component LinkPreview
 * @level Organism
 * @interactions Opens external link in new tab with image, title, description
 */
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default function LinkPreview({ preview }) {
  if (!preview || !preview.url) return null

  const domain = getDomain(preview.url)

  return (
    <a
      href={preview.url}
      target='_blank'
      rel='noopener noreferrer'
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3)',
        marginTop: 'var(--space-2-5)',
        overflow: 'hidden',
      }}
    >
      {preview.image_url && (
        <img
          src={preview.image_url}
          alt=''
          style={{
            width: '80px',
            height: '80px',
            borderRadius: 'var(--radius-md)',
            objectFit: 'cover',
            flexShrink: 0,
          }}
          loading='lazy'
        />
      )}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-0-5)',
        }}
      >
        {preview.title && (
          <p
            style={{
              fontWeight: 'var(--font-semibold)',
              fontSize: 'var(--text-base)',
              margin: 0,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: '1.3',
            }}
          >
            {preview.title}
          </p>
        )}
        {preview.description && (
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              margin: 0,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: '1.3',
            }}
          >
            {preview.description}
          </p>
        )}
        <span
          style={{
            fontSize: 'var(--text-xs2)',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-0-5)',
          }}
        >
          {preview.site_name || domain}
        </span>
      </div>
    </a>
  )
}
