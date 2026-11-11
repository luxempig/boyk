import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Chrome,
  Compass,
  ScanBarcode,
  Target,
} from 'lucide-react'
import { useState } from 'react'

import { useFocusTrap } from '../../hooks/useFocusTrap'
import { spring } from '../../lib/animations'

const STORAGE_KEY = 'boyk_onboarding_complete'

/**
 * Multi-step onboarding modal for new users
 * Shows when user has no boycotts and hasn't completed onboarding
 */
export default function OnboardingModal({ isOpen, onClose }) {
  const [currentStep, setCurrentStep] = useState(0)
  const focusTrapRef = useFocusTrap(isOpen)

  const steps = [
    {
      id: 'welcome',
      icon: Target,
      iconColor: 'var(--accent)',
      title: 'Welcome to Boyk',
      description:
        'Take a stand with your wallet. Create boycotts to rally others, or keep a personal blacklist of companies to avoid.',
      illustration: <WelcomeIllustration />,
    },
    {
      id: 'create',
      icon: Target,
      iconColor: 'var(--success)',
      title: 'Create Boycotts & Posts',
      description:
        'Tap the + button to create a boycott or write a post. Add companies you want to avoid and the reasons why. Make boycotts public so others can follow, or keep them private.',
      illustration: <CreateIllustration />,
    },
    {
      id: 'check',
      icon: ScanBarcode,
      iconColor: 'var(--warning, #f59e0b)',
      title: 'Scan & Check Products',
      description:
        'Use the barcode scanner to check products while shopping. Instantly see if a product or its parent company is on any of your boycotts.',
      illustration: <CheckIllustration />,
    },
    {
      id: 'extension',
      icon: Chrome,
      iconColor: '#4285F4',
      title: 'Chrome Extension',
      description:
        'Install our Chrome extension for real-time alerts when shopping online. It warns you before buying from boycotted companies.',
      illustration: <ExtensionIllustration />,
    },
    {
      id: 'explore',
      icon: Compass,
      iconColor: 'var(--info)',
      title: 'Explore & Follow',
      description:
        'Discover boycotts created by others on the Explore page. Follow the ones that align with your values and see your collective impact grow.',
      illustration: <ExploreIllustration />,
    },
  ]

  const markComplete = () => {
    localStorage.setItem(STORAGE_KEY, 'true')
  }

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    markComplete()
    onClose?.()
  }

  if (!isOpen) return null

  const step = steps[currentStep]
  const isLastStep = currentStep === steps.length - 1
  const isFirstStep = currentStep === 0

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg-overlay)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-5)',
        }}
      >
        <motion.div
          ref={focusTrapRef}
          role='dialog'
          aria-modal='true'
          aria-label='Welcome to Boyk'
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.95 }}
          transition={spring}
          style={{
            width: '100%',
            maxWidth: '420px',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-2xl)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          {/* Progress dots */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-5) var(--space-5) 0',
            }}
          >
            {steps.map((_, index) => (
              <motion.div
                key={index}
                animate={{
                  width: index === currentStep ? '24px' : '8px',
                  background: index === currentStep ? 'var(--accent)' : 'var(--border)',
                }}
                transition={spring}
                style={{
                  height: '8px',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
            ))}
          </div>

          {/* Content */}
          <AnimatePresence mode='wait'>
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={spring}
              style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
              }}
            >
              {/* Illustration */}
              <div style={{ marginBottom: 'var(--space-6)' }}>{step.illustration}</div>

              {/* Icon badge */}
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: `${step.iconColor}20`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto var(--space-4)',
                }}
              >
                <step.icon size={24} color={step.iconColor} />
              </div>

              {/* Title */}
              <h2
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 'var(--text-4xl)',
                  letterSpacing: '1px',
                  marginBottom: 'var(--space-3)',
                  color: 'var(--text-primary)',
                }}
              >
                {step.title}
              </h2>

              {/* Description */}
              <p
                style={{
                  fontSize: 'var(--text-md)',
                  lineHeight: 'var(--leading-relaxed)',
                  color: 'var(--text-secondary)',
                  marginBottom: 'var(--space-6)',
                }}
              >
                {step.description}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-4) var(--space-6) var(--space-6)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {!isFirstStep ? (
              <button
                onClick={handlePrev}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-md)',
                  cursor: 'pointer',
                  padding: 'var(--space-2)',
                }}
              >
                <ChevronLeft size={18} />
                Back
              </button>
            ) : (
              <button
                onClick={handleSkip}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-md)',
                  cursor: 'pointer',
                  padding: 'var(--space-2)',
                }}
              >
                Skip
              </button>
            )}

            {!isLastStep ? (
              <motion.button
                onClick={handleNext}
                whileTap={{ scale: 0.95 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  background: 'var(--gradient-accent)',
                  border: 'none',
                  color: 'var(--text-on-accent)',
                  fontSize: 'var(--text-md)',
                  fontWeight: 'var(--font-semibold)',
                  cursor: 'pointer',
                  padding: 'var(--space-2-5) var(--space-5)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                Next
                <ChevronRight size={18} />
              </motion.button>
            ) : (
              <motion.button
                onClick={handleSkip}
                whileTap={{ scale: 0.95 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  background: 'var(--success)',
                  border: 'none',
                  color: 'white',
                  fontSize: 'var(--text-md)',
                  fontWeight: 'var(--font-semibold)',
                  cursor: 'pointer',
                  padding: 'var(--space-2-5) var(--space-5)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <Check size={18} />
                Done
              </motion.button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * Check if onboarding should be shown
 */
export function shouldShowOnboarding(myBoycotts, followedBoycotts) {
  const completed = localStorage.getItem(STORAGE_KEY)
  if (completed === 'true') return false

  // Show if user has no boycotts and no followed boycotts
  return myBoycotts?.length === 0 && followedBoycotts?.length === 0
}

/**
 * Reset onboarding (for testing)
 */
export function resetOnboarding() {
  localStorage.removeItem(STORAGE_KEY)
}

// Illustrations
function WelcomeIllustration() {
  return (
    <svg width='160' height='120' viewBox='0 0 160 120' fill='none'>
      <circle cx='80' cy='60' r='45' stroke='var(--accent)' strokeWidth='2' strokeDasharray='8 4' />
      <circle cx='80' cy='60' r='30' stroke='var(--border)' strokeWidth='2' />
      <circle cx='80' cy='60' r='15' fill='var(--accent)' />
      <path d='M65 30L80 15L95 30' stroke='var(--accent)' strokeWidth='2' strokeLinecap='round' />
      <path d='M65 90L80 105L95 90' stroke='var(--accent)' strokeWidth='2' strokeLinecap='round' />
      <path d='M30 60L15 60' stroke='var(--border)' strokeWidth='2' strokeLinecap='round' />
      <path d='M145 60L130 60' stroke='var(--border)' strokeWidth='2' strokeLinecap='round' />
    </svg>
  )
}

function CreateIllustration() {
  return (
    <svg width='160' height='120' viewBox='0 0 160 120' fill='none'>
      <rect x='40' y='25' width='80' height='70' rx='8' stroke='var(--border)' strokeWidth='2' />
      <path d='M55 50H105' stroke='var(--border)' strokeWidth='2' strokeLinecap='round' />
      <path d='M55 65H95' stroke='var(--border)' strokeWidth='2' strokeLinecap='round' />
      <path d='M55 80H85' stroke='var(--border)' strokeWidth='2' strokeLinecap='round' />
      <circle cx='120' cy='85' r='20' fill='var(--success)' />
      <path
        d='M112 85L118 91L128 81'
        stroke='white'
        strokeWidth='3'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

function CheckIllustration() {
  return (
    <svg width='160' height='120' viewBox='0 0 160 120' fill='none'>
      {/* Barcode lines */}
      <rect x='45' y='25' width='4' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='53' y='25' width='2' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='59' y='25' width='5' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='68' y='25' width='3' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='75' y='25' width='2' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='81' y='25' width='4' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='89' y='25' width='2' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='95' y='25' width='5' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='104' y='25' width='3' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      <rect x='111' y='25' width='2' height='55' fill='var(--text-primary)' fillOpacity='0.7' />
      {/* Scanner line */}
      <line
        x1='35'
        y1='52'
        x2='125'
        y2='52'
        stroke='var(--accent)'
        strokeWidth='2'
        strokeDasharray='4 2'
      />
      {/* Check badge */}
      <circle cx='115' cy='90' r='18' fill='var(--warning, #f59e0b)' />
      <path
        d='M108 90L113 95L122 86'
        stroke='white'
        strokeWidth='3'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

function ExtensionIllustration() {
  return (
    <svg width='160' height='120' viewBox='0 0 160 120' fill='none'>
      <rect x='25' y='20' width='110' height='75' rx='4' stroke='var(--border)' strokeWidth='2' />
      <rect x='25' y='20' width='110' height='20' fill='var(--border)' fillOpacity='0.3' />
      <circle cx='40' cy='30' r='4' fill='#FF5F57' />
      <circle cx='52' cy='30' r='4' fill='#FEBC2E' />
      <circle cx='64' cy='30' r='4' fill='#28C840' />
      <rect
        x='100'
        y='50'
        width='25'
        height='35'
        rx='4'
        fill='var(--accent)'
        fillOpacity='0.2'
        stroke='var(--accent)'
        strokeWidth='2'
      />
      <path
        d='M107 62L112 67L118 58'
        stroke='var(--accent)'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path d='M107 75H118' stroke='var(--accent)' strokeWidth='2' strokeLinecap='round' />
    </svg>
  )
}

function ExploreIllustration() {
  return (
    <svg width='160' height='120' viewBox='0 0 160 120' fill='none'>
      <circle cx='60' cy='50' r='25' stroke='var(--border)' strokeWidth='2' />
      <circle cx='100' cy='50' r='25' stroke='var(--border)' strokeWidth='2' />
      <circle cx='80' cy='80' r='25' stroke='var(--border)' strokeWidth='2' />
      <circle cx='80' cy='60' r='10' fill='var(--info)' />
      <path d='M30 30L45 45' stroke='var(--accent)' strokeWidth='2' strokeLinecap='round' />
      <path d='M130 30L115 45' stroke='var(--accent)' strokeWidth='2' strokeLinecap='round' />
      <path d='M80 105L80 115' stroke='var(--accent)' strokeWidth='2' strokeLinecap='round' />
    </svg>
  )
}
