import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` that updates `delay` ms after the latest
 * change. Used to throttle expensive side-effects (search RPC calls, etc.)
 * driven by fast-changing input.
 *
 * Pattern:
 *   const debouncedQuery = useDebounce(searchQuery, 300)
 *   useEffect(() => {
 *     if (!debouncedQuery) return
 *     fetchResults(debouncedQuery)
 *   }, [debouncedQuery])
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
