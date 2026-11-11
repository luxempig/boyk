import { BOYK_LOGO_PATHS, BOYK_LOGO_VIEWBOX } from '../../assets/boykLogoPaths'

/**
 * @component AnimatedBoykLogo
 * @level Atom
 *
 * Inline, role-tagged SVG of the traced logo. Each path's fill comes from a
 * `--logo-<role>` CSS variable, so the whole mark picks up whatever palette
 * the app is using. Defaults below map to boyk's theme tokens (the tricolor
 * logo scheme — indigo→pink→green — on dark/light bg), but any single var can
 * be overridden via the `style` prop or an ancestor CSS rule.
 *
 * The fist and wordmark both render with a tricolor gradient built from the
 * three wordmark stops below; bursts use their own per-role hues.
 *
 * CSS variables (with fallbacks):
 *   --logo-bg               background fill             (→ --bg-dark)
 *   --logo-fist             fist silhouette fallback    (→ --accent)
 *   --logo-fist-shadow      fist detail shadow          (rgba(0,0,0,0.3))
 *   --logo-wordmark-start   gradient stop 1 — indigo    (→ --accent)
 *   --logo-wordmark-mid     gradient stop 2 — pink      (→ --highlight)
 *   --logo-wordmark-end     gradient stop 3 — green     (→ --success)
 *   --logo-wordmark-shadow  letter-hole cutout          (→ --bg-dark)
 *   --logo-green            burst accent A              (→ --gold)
 *   --logo-blue             burst accent B              (→ --accent-dark)
 *   --logo-pink             burst accent C              (→ --accent-light)
 *
 * Props:
 *   size     — width in px or any CSS length. default 320.
 *   variant  — motion preset: 'static' | 'intro' | 'loader' | 'pulse' | 'spin' | 'bloom'.
 *              default 'static'.
 *   className, style — forwarded to the wrapper.
 */
export default function AnimatedBoykLogo({
  size = 320,
  variant = 'static',
  className,
  style,
  ...rest
}) {
  const gradId = 'boyk-wordmark-grad'
  const fistGradId = 'boyk-fist-grad'
  return (
    <div
      className={className}
      data-variant={variant}
      style={{
        // Defaults wire each logo var to a theme token. Callers can override
        // any `--logo-*` var via the `style` prop or an outer CSS rule
        // without touching the component.
        '--logo-bg': 'var(--bg-dark, #0a0a0a)',
        '--logo-fist': 'var(--accent, #f472b6)',
        '--logo-fist-shadow': 'rgba(0, 0, 0, 0.3)',
        '--logo-wordmark-start': 'var(--accent, #f472b6)',
        '--logo-wordmark-mid': 'var(--highlight, #ec4899)',
        '--logo-wordmark-end': 'var(--success, #34d399)',
        '--logo-wordmark-shadow': 'var(--bg-dark, #0a0a0a)',
        '--logo-green': 'var(--success, #22c55e)',
        '--logo-blue': 'var(--info, #06b6d4)',
        '--logo-pink': 'var(--highlight, #ec4899)',
        width: size,
        aspectRatio: '1408 / 768',
        display: 'inline-block',
        ...style,
      }}
      {...rest}
    >
      <style>{VARIANT_CSS}</style>
      <svg
        viewBox={BOYK_LOGO_VIEWBOX}
        xmlns='http://www.w3.org/2000/svg'
        style={{ width: '100%', height: '100%', display: 'block' }}
        role='img'
        aria-label='Boyk'
      >
        <defs>
          {/* Wordmark sweeps the full logo tricolor (indigo→pink→green) across
              the four letter paths; userSpaceOnUse keeps it continuous. */}
          <linearGradient
            id={gradId}
            x1='553'
            y1='0'
            x2='823'
            y2='0'
            gradientUnits='userSpaceOnUse'
          >
            <stop offset='0' stopColor='var(--logo-wordmark-start)' />
            <stop offset='0.5' stopColor='var(--logo-wordmark-mid)' />
            <stop offset='1' stopColor='var(--logo-wordmark-end)' />
          </linearGradient>
          {/* Fist gets the same tricolor across its own bounds (objectBoundingBox)
              so the mark's largest shape is no longer flat indigo. */}
          <linearGradient id={fistGradId} x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0' stopColor='var(--logo-wordmark-start)' />
            <stop offset='0.5' stopColor='var(--logo-wordmark-mid)' />
            <stop offset='1' stopColor='var(--logo-wordmark-end)' />
          </linearGradient>
        </defs>
        {BOYK_LOGO_PATHS.map((p, idx) => (
          <path
            key={idx}
            className={`layer ${roleClass(p.role)}`}
            fill={fillForRole(p.role, gradId, fistGradId)}
            d={p.d}
            style={p.i != null ? { '--i': p.i } : undefined}
          />
        ))}
      </svg>
    </div>
  )
}

// Wordmark and fist both pull from a <linearGradient> for a continuous
// indigo→pink→green sweep (the full logo color scheme). Bursts and everything
// else use their per-role var.
function fillForRole(role, gradId, fistGradId) {
  if (role === 'wordmark') return `url(#${gradId})`
  if (role === 'fist') return `url(#${fistGradId})`
  return `var(--logo-${role})`
}

// Class tags drive the CSS animations. Burst paths share a "burst" class so
// one selector can target all three hues.
function roleClass(role) {
  if (role === 'green' || role === 'blue' || role === 'pink') return `burst ${role}`
  return role
}

const VARIANT_CSS = `
  [data-variant] .layer {
    transform-box: view-box;
    transform-origin: 704px 384px;
  }

  /* INTRO — assemble from empty state */
  @keyframes boyk-burst-pop {
    0%   { transform: scale(0); opacity: 0; }
    60%  { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes boyk-fist-punch {
    0%   { transform: translateY(40px) scale(0.92); opacity: 0; }
    50%  { transform: translateY(-6px) scale(1.03); opacity: 1; }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }
  @keyframes boyk-wordmark-fade {
    0%   { transform: translateY(16px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  [data-variant="intro"] .burst {
    transform-box: fill-box;
    transform-origin: center;
    opacity: 0;
    animation: boyk-burst-pop 700ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    animation-delay: calc(var(--i, 0) * 18ms + 400ms);
  }
  [data-variant="intro"] .fist {
    opacity: 0;
    animation: boyk-fist-punch 650ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    animation-delay: 50ms;
  }
  [data-variant="intro"] .wordmark {
    opacity: 0;
    animation: boyk-wordmark-fade 500ms ease-out forwards;
    animation-delay: 2200ms;
  }

  /* LOADER — intro once, then breath/twinkle loop forever. */
  [data-variant="loader"] .fist {
    transform-origin: 704px 440px;
    opacity: 0;
    animation:
      boyk-fist-punch 650ms cubic-bezier(0.34, 1.56, 0.64, 1) 50ms forwards,
      boyk-breath 2.4s ease-in-out 800ms infinite;
  }
  [data-variant="loader"] .burst {
    transform-box: fill-box;
    transform-origin: center;
    opacity: 0;
    animation:
      boyk-burst-pop 700ms cubic-bezier(0.34, 1.56, 0.64, 1) calc(var(--i, 0) * 18ms + 400ms) forwards,
      boyk-twinkle 1.4s ease-in-out calc(var(--i, 0) * 18ms + 1300ms) infinite;
  }
  [data-variant="loader"] .wordmark {
    opacity: 0;
    animation: boyk-wordmark-fade 500ms ease-out 2200ms forwards;
  }

  /* PULSE — gentle idle motion */
  @keyframes boyk-breath {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.025); }
  }
  @keyframes boyk-twinkle {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.55; }
  }
  [data-variant="pulse"] .fist {
    transform-origin: 704px 440px;
    animation: boyk-breath 3.4s ease-in-out infinite;
  }
  [data-variant="pulse"] .burst {
    animation: boyk-twinkle 1.6s ease-in-out infinite;
    animation-delay: calc(var(--i, 0) * 40ms);
  }

  /* SPIN — burst rotates around fist center */
  @keyframes boyk-orbit {
    to { transform: rotate(360deg); }
  }
  [data-variant="spin"] .burst {
    animation: boyk-orbit 14s linear infinite;
  }

  /* BLOOM — hover-only */
  [data-variant="bloom"] .burst {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 450ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  [data-variant="bloom"]:hover .burst {
    transform: scale(1.3);
  }
  [data-variant="bloom"] .fist {
    transform-origin: 704px 440px;
    transition: transform 300ms ease-out;
  }
  [data-variant="bloom"]:hover .fist {
    transform: scale(1.05) translateY(-8px);
  }

  @media (prefers-reduced-motion: reduce) {
    [data-variant] .layer { animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important; }
  }
`
