import { useState } from 'react'

import AnimatedBoykLogo from '../components/atoms/AnimatedBoykLogo'
import BoykLogoLoader from '../components/molecules/BoykLogoLoader'

const VARIANTS = [
  { key: 'static', label: 'static', hint: 'no motion — baseline' },
  { key: 'intro', label: 'intro', hint: 'fist punches up, burst pops in, wordmark fades' },
  {
    key: 'loader',
    label: 'loader',
    hint: 'intro, then continuous breath + twinkle for loading states',
  },
  { key: 'pulse', label: 'pulse', hint: 'continuous idle breath + twinkle' },
  { key: 'spin', label: 'spin', hint: 'burst orbits around the fist center' },
  { key: 'bloom', label: 'bloom', hint: 'hover to trigger burst flare' },
]

export default function LogoDemo() {
  // The "intro" and "loader" variants only animate on mount. A nonce key lets
  // us remount to replay.
  const [introNonce, setIntroNonce] = useState(0)
  const [loaderNonce, setLoaderNonce] = useState(0)
  const [fakeLoading, setFakeLoading] = useState(false)

  function simulateLoad() {
    setFakeLoading(true)
    setTimeout(() => setFakeLoading(false), 4500)
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: 'var(--text-2xl)' }}>AnimatedBoykLogo</h1>
      <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)' }}>
        Six variants driven by CSS classes on the traced SVG paths.
      </p>
      <button
        type='button'
        onClick={simulateLoad}
        style={{
          marginBottom: 32,
          padding: '8px 14px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: 'var(--accent)',
          color: 'var(--text-on-accent, #fff)',
          fontWeight: 'var(--font-semibold)',
          cursor: 'pointer',
        }}
      >
        Show full-screen loader (4.5s)
      </button>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 20,
        }}
      >
        {VARIANTS.map(v => {
          const isReplayable = v.key === 'intro' || v.key === 'loader'
          const replayKey =
            v.key === 'intro' ? introNonce : v.key === 'loader' ? loaderNonce : v.key
          const replayClick =
            v.key === 'intro'
              ? () => setIntroNonce(n => n + 1)
              : v.key === 'loader'
                ? () => setLoaderNonce(n => n + 1)
                : null
          return (
            <div
              key={v.key}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 16,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--text-xs2)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--text-muted)',
                  }}
                >
                  {v.label}
                </span>
                {isReplayable && (
                  <button
                    type='button'
                    onClick={replayClick}
                    style={{
                      fontSize: 'var(--text-xs2)',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    replay
                  </button>
                )}
              </div>
              <AnimatedBoykLogo
                key={replayKey}
                size='100%'
                variant={v.key}
                style={{ width: '100%' }}
              />
              <p
                style={{
                  margin: '12px 0 0 0',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                }}
              >
                {v.hint}
              </p>
            </div>
          )
        })}
      </div>

      {fakeLoading && <BoykLogoLoader message='Loading your feed…' />}
    </div>
  )
}
