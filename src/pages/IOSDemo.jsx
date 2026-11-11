import { useCallback, useEffect, useState } from 'react'

import { TESTFLIGHT_URL } from '../lib/testflight'

const DEVICE_WIDTH = 375
const DEVICE_HEIGHT = 812
const BEZEL = 16
const NOTCH_WIDTH = 160
const NOTCH_HEIGHT = 34
const CORNER_RADIUS = 50
const INNER_RADIUS = 40

function calcScale() {
  if (typeof window === 'undefined') return 0.85
  const maxH = window.innerHeight - 120
  const maxW = window.innerWidth - 48
  const frameH = DEVICE_HEIGHT + BEZEL * 2
  const frameW = DEVICE_WIDTH + BEZEL * 2
  return Math.min(maxH / frameH, maxW / frameW, 1)
}

export default function IOSDemo() {
  const [scale, setScale] = useState(calcScale)

  const handleResize = useCallback(() => setScale(calcScale()), [])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  const frameW = (DEVICE_WIDTH + BEZEL * 2) * scale
  const frameH = (DEVICE_HEIGHT + BEZEL * 2) * scale

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg-dark)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-4xl)',
            fontWeight: 'var(--font-bold)',
            color: 'var(--text-primary)',
            margin: 0,
            letterSpacing: '-0.5px',
          }}
        >
          Boyk for iOS
        </h1>
        <p
          style={{
            fontSize: '15px',
            color: 'var(--text-muted)',
            margin: 'var(--space-2) 0 0',
          }}
        >
          Interactive preview — tap and explore
        </p>
      </div>

      {/* iPhone Frame */}
      <div
        style={{
          position: 'relative',
          width: `${frameW}px`,
          height: `${frameH}px`,
          background: 'var(--bg-card)',
          borderRadius: `${CORNER_RADIUS * scale}px`,
          boxShadow: `
            0 0 0 1px var(--border),
            0 20px 60px rgba(0,0,0,0.8),
            0 0 80px rgba(244,114,182,0.12)
          `,
          overflow: 'hidden',
        }}
      >
        {/* Screen area */}
        <div
          style={{
            position: 'absolute',
            top: `${BEZEL * scale}px`,
            left: `${BEZEL * scale}px`,
            width: `${DEVICE_WIDTH * scale}px`,
            height: `${DEVICE_HEIGHT * scale}px`,
            borderRadius: `${INNER_RADIUS * scale}px`,
            overflow: 'hidden',
            background: 'var(--bg-dark)',
          }}
        >
          <iframe
            src='/explore'
            title='Boyk App Preview'
            style={{
              width: `${DEVICE_WIDTH}px`,
              height: `${DEVICE_HEIGHT}px`,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>

        {/* Dynamic Island */}
        <div
          style={{
            position: 'absolute',
            top: `${(BEZEL + 10) * scale}px`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: `${NOTCH_WIDTH * scale}px`,
            height: `${NOTCH_HEIGHT * scale}px`,
            background: '#000',
            borderRadius: `${17 * scale}px`,
            zIndex: 10,
          }}
        />

        {/* Home indicator */}
        <div
          style={{
            position: 'absolute',
            bottom: `${(BEZEL + 8) * scale}px`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: `${134 * scale}px`,
            height: `${5 * scale}px`,
            background: 'rgba(255,255,255,0.3)',
            borderRadius: `${3 * scale}px`,
            zIndex: 10,
          }}
        />
      </div>

      {/* CTA */}
      <div style={{ textAlign: 'center', marginTop: 'var(--space-6)' }}>
        <a
          href={TESTFLIGHT_URL}
          target='_blank'
          rel='noopener noreferrer'
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-6)',
            background: 'var(--glass-card)',
            border: '1px solid var(--glass-card-border)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-primary)',
            textDecoration: 'none',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-medium)',
            transition: 'all 0.2s',
          }}
        >
          <svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor'>
            <path d='M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z' />
          </svg>
          Join the iPhone beta
        </a>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-faint)',
            marginTop: 'var(--space-3)',
          }}
        >
          Free on TestFlight
        </p>
      </div>
    </div>
  )
}
