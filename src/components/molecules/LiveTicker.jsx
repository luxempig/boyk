import { memo } from 'react'

import { glassCard } from '../../lib/glassStyles'

/**
 * Seamless marquee. The track holds the text twice and slides exactly one copy
 * width (translateX -50%), so when the loop resets the second copy already sits
 * where the first began — no visible jump.
 *
 * Why it stays smooth:
 *  - `width: max-content` sizes the track to its content, so -50% is exactly one
 *    copy. (With the default auto width the track fills its parent and -50%
 *    becomes half the *container* — unrelated to the text period, which made the
 *    old version snap to a random offset every loop.)
 *  - `translate3d` + `will-change: transform` keep the track on its own GPU
 *    layer, so the compositor slides it without the per-loop sub-pixel raster
 *    hitch.
 *  - `memo` (compared by joined text) stops background Feed refetches from
 *    re-applying the animation and restarting it mid-scroll.
 */
function LiveTickerImpl({ items = [], speed = 40, className, style }) {
  if (!items.length) return null

  const text = items.join(' • ')
  const duration = (text.length / speed) * 2

  return (
    <div
      className={className}
      style={{
        ...glassCard,
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        padding: 'var(--space-1-5) var(--space-3)',
        position: 'relative',
        maskImage:
          'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: 'max-content',
          whiteSpace: 'nowrap',
          animation: `ticker ${duration}s linear infinite`,
          willChange: 'transform',
          backfaceVisibility: 'hidden',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--accent)',
        }}
        onMouseEnter={e => (e.currentTarget.style.animationPlayState = 'paused')}
        onMouseLeave={e => (e.currentTarget.style.animationPlayState = 'running')}
      >
        <span style={{ paddingRight: 'var(--space-8)' }}>{text}</span>
        <span style={{ paddingRight: 'var(--space-8)' }} aria-hidden='true'>
          {text}
        </span>
      </div>
      <style>{`@keyframes ticker { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-50%, 0, 0); } }`}</style>
    </div>
  )
}

// Re-render only when the visible text actually changes — Feed passes a fresh
// items array on every refetch, and re-applying the inline animation can restart
// the scroll. Comparing by joined content keeps the marquee uninterrupted.
function areEqual(prev, next) {
  return (
    prev.speed === next.speed &&
    prev.className === next.className &&
    (prev.items || []).join('') === (next.items || []).join('')
  )
}

export const LiveTicker = memo(LiveTickerImpl, areEqual)
export default LiveTicker
