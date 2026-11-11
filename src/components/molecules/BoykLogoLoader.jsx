import AnimatedBoykLogo from '../atoms/AnimatedBoykLogo'

/**
 * @component BoykLogoLoader
 * @level Molecule
 *
 * Full-surface loading screen centered around the animated logo. Uses the
 * 'loader' variant so the intro plays once on mount and then continues into
 * a breath + twinkle loop — the motion keeps going as long as the loader is
 * on screen, so users don't mistake a long wait for a stalled app.
 *
 * Props:
 *   message  — optional text shown under the logo. default null.
 *   size     — logo width in px. default 240.
 *   fullScreen — fixed overlay covering the viewport. default true.
 *   style, className — forwarded to the container.
 */
export default function BoykLogoLoader({
  message = null,
  size = 240,
  fullScreen = true,
  style,
  className,
}) {
  return (
    <div
      role='status'
      aria-busy='true'
      aria-live='polite'
      className={className}
      style={{
        position: fullScreen ? 'fixed' : 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        background: fullScreen ? 'var(--bg-dark, #0f1022)' : 'transparent',
        zIndex: fullScreen ? 9999 : 'auto',
        ...style,
      }}
    >
      <AnimatedBoykLogo size={size} variant='loader' />
      {message && (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted, #8b8ba7)',
            letterSpacing: '0.02em',
          }}
        >
          {message}
        </div>
      )}
    </div>
  )
}
