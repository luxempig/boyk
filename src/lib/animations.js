// Shared Framer Motion animation constants
// Used across Home.jsx, Profile.jsx, and other components

// Spring physics configuration - natural, bouncy feel
export const spring = {
  type: 'spring',
  damping: 25,
  stiffness: 300,
}

// Gentler spring for larger elements
export const springGentle = {
  type: 'spring',
  damping: 30,
  stiffness: 200,
}

// Quick spring for micro-interactions
export const springQuick = {
  type: 'spring',
  damping: 20,
  stiffness: 400,
}

// === Premium Animation Springs ===

// More impactful bouncy spring
export const springBouncy = {
  type: 'spring',
  damping: 15,
  stiffness: 400,
}

// Smooth, elegant transitions
export const springSmooth = {
  type: 'spring',
  damping: 30,
  stiffness: 200,
}

// Snappy, responsive feel
export const springSnappy = {
  type: 'spring',
  damping: 25,
  stiffness: 500,
}

// Fade in with upward motion
export const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: spring,
}

// Fade in from side (for cards)
export const fadeInRight = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
  transition: spring,
}

// Simple fade
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
}

// Scale up entrance (for modals, cards)
export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: spring,
}

// Button tap feedback
export const tapScale = {
  whileTap: { scale: 0.95 },
  transition: springQuick,
}

// Hover glow effect (combine with custom boxShadow)
export const hoverGlow = {
  whileHover: {
    scale: 1.02,
  },
  transition: springQuick,
}

// Card hover with subtle lift
export const cardHover = {
  whileHover: {
    x: 4,
    transition: springQuick,
  },
}

// Stagger children animations - enhanced
export const staggerContainer = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
}

// Child item for stagger - enhanced with spring
export const staggerItem = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', damping: 20, stiffness: 300 },
  },
}

// Collapse/Expand animation for accordions
export const collapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: springGentle,
}

// Reduced motion variants (respects user preference)
export const reducedMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.01 },
}

// Helper to check for reduced motion preference
export const prefersReducedMotion = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Get appropriate animation based on user preference
export const getMotionProps = (normalProps, reducedProps = reducedMotion) => {
  return prefersReducedMotion() ? reducedProps : normalProps
}

// === MICROINTERACTIONS (Sprint 2) ===

// Button tap with hover glow
export const buttonTap = {
  whileTap: { scale: 0.95 },
  whileHover: {
    scale: 1.02,
    boxShadow: '0 0 20px var(--accent-glow)',
  },
  transition: springQuick,
}

// Primary button with stronger glow
export const buttonPrimary = {
  whileTap: { scale: 0.95 },
  whileHover: {
    y: -2,
    boxShadow: '0 8px 24px var(--accent-glow)',
  },
  transition: springQuick,
}

// Card press effect with subtle lift
export const cardPress = {
  whileTap: { scale: 0.98 },
  whileHover: {
    y: -2,
    boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
  },
  transition: spring,
}

// === Premium Card Interactions ===

// Card lift on hover with spring physics
export const cardLift = {
  whileHover: {
    y: -4,
    transition: { type: 'spring', damping: 20, stiffness: 300 },
  },
  whileTap: { scale: 0.98 },
}

// Button glow on hover
export const buttonGlow = {
  whileHover: {
    y: -3,
    boxShadow: '0 8px 30px rgba(255,85,0,0.5), 0 0 60px rgba(255,85,0,0.25)',
  },
  whileTap: { y: -1, scale: 0.98 },
}

// Avatar glow ring effect
export const avatarGlow = {
  whileHover: {
    boxShadow: '0 0 25px rgba(255, 85, 0, 0.5), 0 0 50px rgba(255, 85, 0, 0.3)',
  },
  transition: springQuick,
}

// FAB float animation
export const fabFloat = {
  animate: {
    y: [0, -4, 0],
  },
  transition: {
    duration: 3,
    repeat: Infinity,
    ease: 'easeInOut',
  },
}

// Nav item active state
export const navItemActive = {
  animate: {
    scale: 1.15,
    y: -2,
  },
  transition: { type: 'spring', stiffness: 400, damping: 20 },
}

// Icon pulse animation (for attention)
export const iconPulse = {
  animate: {
    scale: [1, 1.1, 1],
  },
  transition: {
    duration: 2,
    repeat: Infinity,
    ease: 'easeInOut',
  },
}

// Subtle glow pulse
export const glowPulse = {
  animate: {
    boxShadow: [
      '0 0 0 rgba(255, 61, 0, 0)',
      '0 0 20px rgba(255, 61, 0, 0.3)',
      '0 0 0 rgba(255, 61, 0, 0)',
    ],
  },
  transition: {
    duration: 2,
    repeat: Infinity,
    ease: 'easeInOut',
  },
}

// Success checkmark animation
export const successPop = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: {
    type: 'spring',
    damping: 15,
    stiffness: 500,
  },
}

// Page enter transition
export const pageEnter = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: spring,
}

// Page enter from bottom
export const pageEnterUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: spring,
}

// Modal backdrop
export const modalBackdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
}

// Modal content slide up
export const modalContent = {
  initial: { opacity: 0, y: 50, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 30, scale: 0.95 },
  transition: spring,
}

// Bottom sheet for mobile
export const bottomSheet = {
  initial: { y: '100%' },
  animate: { y: 0 },
  exit: { y: '100%' },
  transition: {
    type: 'spring',
    damping: 30,
    stiffness: 300,
  },
}

// Notification toast
export const toastAnimation = {
  initial: { opacity: 0, y: -20, scale: 0.9 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -20, scale: 0.9 },
  transition: springQuick,
}

// List item with delay based on index
export const staggerItemWithDelay = (index, maxDelay = 10) => ({
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      ...spring,
      delay: Math.min(index, maxDelay) * 0.05,
    },
  },
})

// Drag handle indicator
export const dragHandle = {
  whileHover: { scaleX: 1.1 },
  whileTap: { scaleX: 1.2 },
  transition: springQuick,
}

// === Crystalline Redesign Animations ===

// Scan line sweep for ScanFrame
export const scanLineSweep = {
  animate: { y: ['0%', '100%'] },
  transition: { duration: 2, repeat: Infinity, ease: 'linear' },
}

// Gauge arc reveal for CorporateThreatScore
export const gaugeArc = targetDash => ({
  initial: { strokeDashoffset: 157 },
  animate: { strokeDashoffset: 157 - targetDash },
  transition: { type: 'spring', damping: 25, stiffness: 80 },
})

// Bottom sheet slide with drag support
export const sheetSlide = {
  initial: { y: '100%' },
  animate: { y: 0 },
  exit: { y: '100%' },
  transition: { type: 'spring', damping: 30, stiffness: 300 },
}

// Floating dock idle bob
export const dockFloat = {
  animate: { y: [0, -2, 0] },
  transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
}

// Glow pulse with accent color (replaces orange glow)
export const accentGlowPulse = {
  animate: {
    boxShadow: [
      '0 0 0 rgba(244,114,182,0)',
      '0 0 20px rgba(244,114,182,0.3)',
      '0 0 0 rgba(244,114,182,0)',
    ],
  },
  transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
}

// Pill toggle sliding indicator
export const pillSlide = {
  layout: true,
  transition: { type: 'spring', damping: 25, stiffness: 400 },
}
