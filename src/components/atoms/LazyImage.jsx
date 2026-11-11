import { memo, useEffect, useRef, useState } from 'react'

/**
 * @component LazyImage
 * @level Atom
 * @interactions Loads images lazily via IntersectionObserver with fade-in transition and error fallback.
 */
const LazyImage = memo(function LazyImage({
  src,
  alt = '',
  style = {},
  fallback = null,
  className = '',
  onLoad,
  onError,
}) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [isInView, setIsInView] = useState(false)
  const imgRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: '50px', // Start loading 50px before entering viewport
        threshold: 0,
      }
    )

    if (imgRef.current) {
      observer.observe(imgRef.current)
    }

    return () => observer.disconnect()
  }, [])

  const handleLoad = () => {
    setIsLoaded(true)
    onLoad?.()
  }

  const handleError = () => {
    setHasError(true)
    onError?.()
  }

  // Upgrade http:// to https:// for Wikimedia URLs to avoid mixed content warnings
  const safeSrc = src?.replace(/^http:\/\/(commons\.wikimedia\.org)/, 'https://$1')

  // Show fallback if no src, error, or while loading
  if (!safeSrc || hasError) {
    return fallback
  }

  // Separate dimensional props (for wrapper) from visual props (for img)
  const { width, height, minWidth, minHeight, maxWidth, maxHeight, ...imgStyle } = style

  const wrapperStyle = {
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    position: 'relative',
    overflow: 'hidden',
  }

  return (
    <div ref={imgRef} style={wrapperStyle} className={className}>
      {isInView ? (
        <img
          src={safeSrc}
          alt={alt}
          loading='lazy'
          decoding='async'
          onLoad={handleLoad}
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            ...imgStyle,
            opacity: isLoaded ? 1 : 0,
            transition: 'opacity 0.2s ease-in-out',
          }}
        />
      ) : (
        // Placeholder while not in view
        <div
          style={{
            width: '100%',
            height: '100%',
            background:
              'linear-gradient(135deg, rgba(30,30,50,0.3), rgba(244,114,182,0.06), rgba(30,30,50,0.3))',
          }}
        />
      )}
    </div>
  )
})

export default LazyImage
