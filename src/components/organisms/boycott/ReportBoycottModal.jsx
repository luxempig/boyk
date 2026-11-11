/**
 * @component ReportBoycottModal
 * @level Organism
 * @interactions Modal for reporting a boycott. Posts to the
 *   report_boycott(p_boycott_id, p_reason, p_details) Supabase RPC,
 *   which enforces "details required when reason='other'" server-side.
 */
import { useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { Modal } from '../../molecules/Modal'
import { useToast } from '../Toast'

const MAX_DETAILS = 1000

const REASONS = [
  { value: 'spam', label: 'Spam or promotional content' },
  { value: 'misinformation', label: 'False or misleading claims' },
  { value: 'harassment', label: 'Harassment, hate speech, or targeting' },
  { value: 'off_topic', label: 'Not a real boycott' },
  { value: 'duplicate', label: 'Duplicate of an existing boycott' },
  { value: 'illegal', label: 'Illegal activity, doxxing, or threats' },
  { value: 'inappropriate', label: 'NSFW or gratuitous violence' },
  { value: 'other', label: 'Something else' },
]

export default function ReportBoycottModal({ boycottId, boycottName, onClose }) {
  const toast = useToast()

  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const trimmedDetails = details.trim()
  const detailsRequired = reason === 'other'
  const canSubmit = !!reason && (!detailsRequired || trimmedDetails.length > 0) && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      const { error: rpcError } = await supabase.rpc('report_boycott', {
        p_boycott_id: boycottId,
        p_reason: reason,
        p_details: trimmedDetails || null,
      })
      if (rpcError) {
        if (rpcError.code === '28000') {
          throw new Error('Sign in to report a boycott.')
        }
        throw new Error(rpcError.message || 'Couldn’t submit your report.')
      }
      toast.success('Thanks — we’ll review this report.')
      onClose()
    } catch (err) {
      setError(err.message || 'Couldn’t submit your report. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
      <button
        type='button'
        onClick={onClose}
        disabled={submitting}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-2xl)',
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--font-semibold)',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
      <button
        type='button'
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          padding: 'var(--space-2) var(--space-6)',
          background: canSubmit ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
          border: 'none',
          borderRadius: 'var(--radius-2xl)',
          color: canSubmit ? '#fff' : 'var(--text-muted)',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--font-semibold)',
          cursor: canSubmit ? 'pointer' : 'default',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Submitting…' : 'Submit report'}
      </button>
    </div>
  )

  const detailsCount = trimmedDetails.length

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title='Report this boycott'
      footer={footer}
      maxWidth={520}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
          Why are you reporting{' '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--font-semibold)' }}>
            {boycottName || 'this boycott'}
          </span>
          ?
        </p>

        <fieldset
          style={{
            border: 0,
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}
        >
          <legend className='sr-only'>Report reason</legend>
          {REASONS.map(r => {
            const checked = reason === r.value
            return (
              <label
                key={r.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: checked ? 'var(--bg-card-hover)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <input
                  type='radio'
                  name='report-reason'
                  value={r.value}
                  checked={checked}
                  onChange={() => setReason(r.value)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {r.label}
                </span>
              </label>
            )
          })}
        </fieldset>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
          <label
            htmlFor='report-details'
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--font-semibold)',
              color: 'var(--text-primary)',
            }}
          >
            {detailsRequired ? (
              <>
                Details <span style={{ color: 'var(--danger)' }}>*</span>
              </>
            ) : (
              <>Details (optional)</>
            )}
          </label>
          <textarea
            id='report-details'
            value={details}
            onChange={e => setDetails(e.target.value.slice(0, MAX_DETAILS))}
            placeholder={
              detailsRequired ? 'Please describe the issue.' : 'Add context if you’d like.'
            }
            rows={4}
            style={{
              padding: 'var(--space-3)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'inherit',
              resize: 'vertical',
              minHeight: 80,
            }}
          />
          <div
            style={{
              fontSize: 'var(--text-2xs)',
              color: 'var(--text-muted)',
              textAlign: 'right',
            }}
          >
            {detailsCount}/{MAX_DETAILS}
          </div>
        </div>

        {error && (
          <div
            role='alert'
            style={{
              padding: 'var(--space-2-5) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-subtle, rgba(220, 38, 38, 0.1))',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
