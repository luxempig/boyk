import { useEffect, useRef } from 'react'

// Selector for elements that participate in keyboard tab order. Excludes
// disabled inputs and tabindex="-1" (which is read-only-focusable, not in
// tab cycle). Matches the WHATWG / MDN definition of "tabbable" reasonably
// closely without pulling in a focus-trap library for a few dozen lines.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Trap keyboard focus inside a container while it is `active`.
 *
 * Returns a ref to attach to the container. While active:
 * - Initial focus moves to the first focusable element inside the container.
 * - Tab from the last focusable wraps to the first; Shift+Tab from the first
 *   wraps to the last. Focus cannot escape into background content.
 * - On unmount / deactivation, focus returns to whatever was active when the
 *   trap was first installed.
 *
 * Pair with role="dialog" + aria-modal="true" on the container for screen-
 * reader semantics; the trap itself only handles keyboard mechanics.
 */
export function useFocusTrap(active = true) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null

    // Move initial focus inside. Skip if the user has already clicked into a
    // specific input — leave their selection alone.
    if (!container.contains(document.activeElement)) {
      const focusables = container.querySelectorAll(FOCUSABLE_SELECTOR)
      const first = focusables[0]
      if (first instanceof HTMLElement) {
        first.focus()
      } else if (typeof container.focus === 'function') {
        container.focus()
      }
    }

    const handleKeyDown = event => {
      if (event.key !== 'Tab') return

      // Filter only on aria-hidden — browsers natively skip display:none and
      // visibility:hidden elements during tab navigation, so we don't need to
      // re-check layout here. (offsetParent !== null was the previous test
      // but it always returns null in jsdom and breaks unit tests; the
      // browser-native skip is the right enforcement layer for real layout.)
      const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        el => !el.hasAttribute('aria-hidden')
      )
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      // Best-effort restore. The trigger may no longer be in the DOM (e.g.
      // navigation away while modal was open) — silently ignore.
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return containerRef
}
