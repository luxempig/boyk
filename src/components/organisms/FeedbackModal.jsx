/**
 * @component FeedbackModal
 * @level Organism
 * @interactions Modal for submitting user feedback via Supabase.
 */
import { useEffect, useRef, useState } from 'react'

import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { Checkbox } from '../atoms/Checkbox'
import { Modal } from '../molecules/Modal'
import { useToast } from './Toast'

const MAX_MESSAGE = 2000

export default function FeedbackModal({ onClose }) {
  const { user } = useAuth()
  const toast = useToast()
  const textareaRef = useRef(null)

  const [message, setMessage] = useState('')
  const [shareEmail, setShareEmail] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    if (submitting) return
    if (!message.trim()) {
      setError('Please enter a message')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      const { error: insertError } = await supabase.from('user_feedback').insert({
        user_id: user.id,
        email: shareEmail ? user.email : null,
        message: message.trim(),
      })

      if (insertError) throw insertError

      toast.success('Thanks for your feedback!')
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  const charsLeft = MAX_MESSAGE - message.length

  const footerContent = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      <button
        onClick={handleSubmit}
        disabled={!message.trim() || submitting}
        style={{
          padding: 'var(--space-2) var(--space-6)',
          background: message.trim() ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
          border: 'none',
          borderRadius: 'var(--radius-2xl)',
          color: message.trim() ? '#fff' : 'var(--text-muted)',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--font-semibold)',
          cursor: message.trim() ? 'pointer' : 'default',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Sending...' : 'Send Feedback'}
      </button>
    </div>
  )

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title='Give Feedback'
      footer={footerContent}
      maxWidth={480}
    >
      <textarea
        ref={textareaRef}
        value={message}
        onChange={e => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
        placeholder='Tell us what you think, report a bug, or suggest a feature...'
        rows={5}
        style={{
          width: '100%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          fontSize: 'var(--text-md)',
          lineHeight: 'var(--leading-normal)',
          resize: 'vertical',
          outline: 'none',
          padding: 'var(--space-3)',
          fontFamily: 'inherit',
        }}
      />

      {charsLeft <= 200 && (
        <div
          style={{
            textAlign: 'right',
            fontSize: 'var(--text-sm)',
            color: charsLeft < 50 ? 'var(--danger)' : 'var(--text-muted)',
            marginTop: 'var(--space-1)',
          }}
        >
          {charsLeft}
        </div>
      )}

      {/* Email opt-in */}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Checkbox
          checked={shareEmail}
          onChange={setShareEmail}
          label='Share my email so we can follow up'
        />
      </div>

      {error && (
        <p
          style={{
            color: 'var(--danger)',
            fontSize: 'var(--text-sm)',
            marginTop: 'var(--space-2)',
          }}
        >
          {error}
        </p>
      )}
    </Modal>
  )
}
