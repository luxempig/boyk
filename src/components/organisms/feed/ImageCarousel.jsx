/**
 * @component ImageCarousel
 * @level Organism
 * @interactions Horizontal scroll with snap, arrow navigation, dot indicators
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

export default function ImageCarousel({ media, maxHeight = 400 }) {
  const scrollRef = useRef(null)
  const [currentIndex, setCurrentIndex] = useState(0)

  const count = media?.length || 0

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const idx = Math.round(el.scrollLeft / el.offsetWidth)
    setCurrentIndex(idx)
  }, [])

  const scrollTo = useCallback(idx => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.offsetWidth, behavior: 'smooth' })
  }, [])

  // Single image — simple render, no carousel UI
  if (count <= 1) {
    const src = media?.[0]?.media_url
    if (!src) return null
    return (
      <div
        style={{
          marginTop: 'var(--space-2-5)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        <img
          src={src}
          alt='Post attachment'
          loading='lazy'
          style={{
            width: '100%',
            maxHeight: `${maxHeight}px`,
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: 'var(--space-2-5)',
        position: 'relative',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      {/* Scrollable container */}
      <div
        ref={scrollRef}
        data-carousel-scroll=''
        onScroll={handleScroll}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {media.map((item, i) => (
          <img
            key={item.media_url}
            src={item.media_url}
            alt={`Post attachment ${i + 1}`}
            loading='lazy'
            style={{
              flex: '0 0 100%',
              width: '100%',
              maxHeight: `${maxHeight}px`,
              objectFit: 'cover',
              scrollSnapAlign: 'start',
              display: 'block',
            }}
          />
        ))}
      </div>

      {/* Left arrow */}
      {currentIndex > 0 && (
        <button
          onClick={e => {
            e.stopPropagation()
            scrollTo(currentIndex - 1)
          }}
          aria-label='Previous image'
          style={{
            position: 'absolute',
            left: 'var(--space-2)',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(0,0,0,0.5)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft size={18} />
        </button>
      )}

      {/* Right arrow */}
      {currentIndex < count - 1 && (
        <button
          onClick={e => {
            e.stopPropagation()
            scrollTo(currentIndex + 1)
          }}
          aria-label='Next image'
          style={{
            position: 'absolute',
            right: 'var(--space-2)',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(0,0,0,0.5)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronRight size={18} />
        </button>
      )}

      {/* Dot indicators */}
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-2)',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 'var(--space-1-5)',
        }}
      >
        {media.map((_, i) => (
          <button
            key={i}
            onClick={e => {
              e.stopPropagation()
              scrollTo(i)
            }}
            aria-label={`Go to image ${i + 1}`}
            style={{
              width: i === currentIndex ? '8px' : '6px',
              height: i === currentIndex ? '8px' : '6px',
              borderRadius: 'var(--radius-full)',
              background: i === currentIndex ? '#fff' : 'rgba(255,255,255,0.5)',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          />
        ))}
      </div>

      {/* Hide scrollbar via inline style tag */}
      <style>{`
        [data-carousel-scroll]::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  )
}
