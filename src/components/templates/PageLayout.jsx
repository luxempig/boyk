import { memo } from 'react'

/**
 * @component PageLayout
 * @level Template
 *
 * @description Standard page wrapper providing consistent layout structure.
 * Handles content width constraints and bottom padding for BottomNav clearance.
 *
 * @interactions
 * - None (layout shell, no interactive behavior)
 *
 * @props
 * - children: ReactNode — Page content
 * - maxWidth: number — Max content width in px (default: 600)
 * - className: string — Additional CSS on content area
 * - style: object — Additional inline styles
 * - fullWidth: boolean — Disable maxWidth constraint (default: false)
 * - variant: 'standard' | 'immersive' — 'immersive' disables bottom padding for full-bleed pages (default: 'standard')
 *
 * @example
 * <PageLayout>
 *   <h1>Page Title</h1>
 *   <div>Content...</div>
 * </PageLayout>
 */

const PageLayout = memo(function PageLayout({
  children,
  maxWidth = 600,
  className = '',
  style,
  fullWidth = false,
  variant = 'standard',
}) {
  const isImmersive = variant === 'immersive'
  const pb = isImmersive ? 0 : 100

  return (
    <div
      className={className}
      style={{
        minHeight: '100dvh',
        paddingBottom: pb,
        ...(fullWidth
          ? { padding: `0 var(--space-4) ${pb}px` }
          : {
              maxWidth,
              margin: '0 auto',
              padding: `0 var(--space-4) ${pb}px`,
            }),
        ...style,
      }}
    >
      {children}
    </div>
  )
})

export { PageLayout }
export default PageLayout
