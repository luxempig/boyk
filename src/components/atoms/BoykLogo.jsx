/**
 * @component BoykLogo
 * @level Atom
 *
 * Renders the boyk logo. Backed by a vectorized copy of `public/og-image.jpg`
 * (auto-traced with vtracer → svgo, 17KB) served as a static SVG asset.
 *
 * Because the artwork is a traced bitmap (not procedural), the palette is
 * baked into the SVG — `tokens`-style color overrides aren't supported.
 * Animate or tint with CSS filters (e.g. `filter: hue-rotate(…)`) if needed.
 *
 * Props:
 *   size       — width in px (height is proportional to 1408:768). default 320.
 *   className, style, ...rest — forwarded to the <img>.
 */
export default function BoykLogo({ size = 320, className, style, ...rest }) {
  return (
    <img
      src='/boyk-mark.svg'
      alt='Boyk'
      width={size}
      height={size * (768 / 1408)}
      className={className}
      style={style}
      {...rest}
    />
  )
}
