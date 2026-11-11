import { useCallback, useEffect, useRef } from 'react'

/**
 * Hook to safely update state only when component is mounted.
 * Prevents "Can't perform a React state update on an unmounted component" warnings.
 *
 * Usage:
 *   const { safeSetState, isMounted, isMountedRef } = useSafeState()
 *   safeSetState(setLoading, true)
 *   if (isMounted()) { ... }
 */
export function useSafeState() {
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const safeSetState = useCallback((setter, value) => {
    if (isMountedRef.current) {
      setter(value)
    }
  }, [])

  const isMounted = useCallback(() => isMountedRef.current, [])

  return { safeSetState, isMounted, isMountedRef }
}

export default useSafeState
