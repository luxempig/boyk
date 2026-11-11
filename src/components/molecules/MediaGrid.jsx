import { memo, useMemo } from 'react'

/**
 * @component MediaGrid
 * @level Molecule
 *
 * @description Responsive image grid for post media. Auto-adjusts layout based on count:
 * 1=full width, 2=side-by-side, 3=1 large + 2 small, 4=2x2 grid.
 *
 * @interactions
 * - Click image: Calls `onImageClick(index)` for fullscreen/lightbox
 *
 * @props
 * - media: string[] — Array of image URLs
 * - onImageClick: (index: number) => void — Image click handler
 * - className: string
 */

const containerStyle = {
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
}

const baseImageStyle = {
  cursor: 'pointer',
  objectFit: 'cover',
  width: '100%',
  height: '100%',
  display: 'block',
}

const singleImageStyle = {
  ...baseImageStyle,
  maxHeight: '400px',
  minHeight: undefined,
}

const gridImageStyle = {
  ...baseImageStyle,
  minHeight: '150px',
}

const MediaGrid = memo(function MediaGrid({ media, onImageClick, className = '' }) {
  const count = media?.length || 0

  const gridStyle = useMemo(() => {
    if (count === 2) {
      return {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-0-5)',
      }
    }
    if (count === 3 || count === 4) {
      return {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 'var(--space-0-5)',
      }
    }
    return null
  }, [count])

  if (!media || count === 0) return null

  const imageButtonStyle = {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    display: 'block',
    width: '100%',
    height: '100%',
  }

  // Single image — full width
  if (count === 1) {
    return (
      <div className={className} style={containerStyle}>
        <button
          type='button'
          onClick={() => onImageClick?.(0)}
          aria-label='View image'
          style={imageButtonStyle}
        >
          <img src={media[0]} alt='Media 1' loading='lazy' style={singleImageStyle} />
        </button>
      </div>
    )
  }

  return (
    <div className={className} style={{ ...containerStyle, ...gridStyle }}>
      {media.slice(0, 4).map((url, index) => (
        <button
          type='button'
          key={url}
          onClick={() => onImageClick?.(index)}
          aria-label={`View image ${index + 1}`}
          style={{
            ...imageButtonStyle,
            ...(count === 3 && index === 0 ? { gridRow: '1 / 3' } : undefined),
          }}
        >
          <img src={url} alt={`Media ${index + 1}`} loading='lazy' style={gridImageStyle} />
        </button>
      ))}
    </div>
  )
})

export { MediaGrid }
export default MediaGrid
