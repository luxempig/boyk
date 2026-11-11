// Cache of loaded Image objects: url -> { img, loaded, failed, promise }
const imageCache = new Map()

/**
 * Preload a logo image. Returns a promise that resolves to the Image
 * or null if loading fails.
 */
export function preloadImage(url) {
  if (!url) return Promise.resolve(null)
  const cached = imageCache.get(url)
  if (cached?.loaded) return Promise.resolve(cached.img)
  if (cached?.failed) return Promise.resolve(null)
  if (cached?.promise) return cached.promise

  const entry = { img: null, loaded: false, failed: false, promise: null }
  entry.promise = new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      entry.img = img
      entry.loaded = true
      resolve(img)
    }
    img.onerror = () => {
      entry.failed = true
      resolve(null)
    }
    img.src = url
  })
  imageCache.set(url, entry)
  return entry.promise
}

/**
 * Get a previously loaded image synchronously (for drawing in animation frames).
 * Returns the Image object or null.
 */
export function getLoadedImage(url) {
  if (!url) return null
  const cached = imageCache.get(url)
  return cached?.loaded ? cached.img : null
}

/**
 * Preload multiple images in parallel. Returns when all are attempted.
 */
export function preloadImages(urls) {
  return Promise.all(urls.filter(Boolean).map(preloadImage))
}

/**
 * Clear cache (for cleanup on unmount).
 */
export function clearImageCache() {
  imageCache.clear()
}
