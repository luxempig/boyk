/**
 * @component DemoFeedbackBanner
 * @level Organism
 * @interactions Fixed-position feedback button that opens FeedbackModal; only visible on demo domain for authenticated users.
 */
import { AnimatePresence } from 'framer-motion'
import { MessageSquare, Puzzle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import FeedbackModal from './FeedbackModal'

export default function DemoFeedbackBanner() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isDemo = host === 'boyk.org' || host === 'staging.boyk.org'
  const isIframe = typeof window !== 'undefined' && window.self !== window.top

  if (!isDemo || !user || isIframe) return null

  return (
    <>
      {/* Chrome Extension button — right above Give Feedback */}
      <button
        onClick={() => navigate('/extension')}
        aria-label='Install Chrome Extension'
        style={{
          position: 'fixed',
          bottom: '128px',
          right: 'var(--space-4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2-5) var(--space-4)',
          background: 'var(--bg-card)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-full)',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--font-semibold)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          cursor: 'pointer',
        }}
      >
        <Puzzle size={16} />
        Extension
      </button>

      <button
        onClick={() => setShowModal(true)}
        aria-label='Give feedback on the demo'
        style={{
          position: 'fixed',
          bottom: '80px',
          right: 'var(--space-4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2-5) var(--space-4)',
          background: 'var(--gradient-accent)',
          color: 'var(--text-on-accent)',
          border: 'none',
          borderRadius: 'var(--radius-full)',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--font-semibold)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          cursor: 'pointer',
        }}
      >
        <MessageSquare size={16} />
        Give Feedback
      </button>

      <AnimatePresence>
        {showModal && <FeedbackModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </>
  )
}
