// Shared glassmorphism style objects for consistent component styling
export const glassCard = {
  background: 'var(--glass-card, rgba(30,30,50,0.35))',
  backdropFilter: 'blur(var(--glass-blur, 20px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur, 20px))',
  border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
  borderRadius: 'var(--radius-card, 14px)',
}

export const glassPill = {
  ...glassCard,
  borderRadius: 'var(--radius-full, 9999px)',
}

export const glassInput = {
  background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
  borderRadius: 'var(--radius-card, 14px)',
}

export const glassOverlay = {
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(var(--glass-blur-heavy, 30px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-heavy, 30px))',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-2xl, 20px)',
}

// Gradient text helper (apply to element with text)
export const gradientText = {
  background: 'var(--gradient-logo, linear-gradient(135deg, #ec4899, #f472b6, #34d399))',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}
