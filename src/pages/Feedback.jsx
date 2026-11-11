import { useCallback, useEffect, useState } from 'react'

import Header from '../components/organisms/Header'
import { useToast } from '../components/organisms/Toast'
import { useAuth } from '../context/AuthContext'
import { useSafeState } from '../hooks/useSafeState'
import { getAccessToken, supabase, supabaseUrl as SUPABASE_URL } from '../lib/supabase'

const CATEGORIES = [
  { value: 'bug', label: 'Bug', color: 'var(--danger)' },
  { value: 'improvement', label: 'Improvement', color: 'var(--info)' },
  { value: 'feature', label: 'Feature Request', color: 'var(--success)' },
  { value: 'question', label: 'Question', color: 'var(--warning)' },
]

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const STATUSES = [
  { value: 'open', label: 'Open', color: 'var(--warning)' },
  { value: 'in_progress', label: 'In Progress', color: 'var(--info)' },
  { value: 'resolved', label: 'Resolved', color: 'var(--success)' },
  { value: 'wont_fix', label: "Won't Fix", color: 'var(--text-muted)' },
]

const AREAS = [
  { value: 'home', label: 'Home / Boycotts' },
  { value: 'explore', label: 'Explore' },
  { value: 'network', label: 'Network Graph' },
  { value: 'check-product', label: 'Check Product' },
  { value: 'spending', label: 'Spending Tracker' },
  { value: 'extension', label: 'Chrome Extension' },
  { value: 'company', label: 'Company Page' },
  { value: 'profile', label: 'Profile' },
  { value: 'other', label: 'Other' },
]

export default function Feedback() {
  const { user } = useAuth()
  const toast = useToast()
  const { safeSetState } = useSafeState()
  const [feedbackList, setFeedbackList] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedFeedback, setSelectedFeedback] = useState(null)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [filter, setFilter] = useState('all') // 'all', 'open', 'resolved'
  const [submitting, setSubmitting] = useState(false)
  const [fixingIssue, setFixingIssue] = useState(null) // ID of issue being fixed
  const [isAdmin, setIsAdmin] = useState(false)

  // Form state
  const [form, setForm] = useState({
    name: '',
    email: '',
    title: '',
    description: '',
    category: 'bug',
    priority: 'medium',
    affected_area: 'other',
    steps_to_reproduce: '',
  })

  // New comment state
  const [newComment, setNewComment] = useState('')

  // Load all feedback
  const loadFeedback = useCallback(async () => {
    safeSetState(setLoading, true)
    try {
      const { data, error } = await supabase.rpc('get_all_feedback')
      if (error) throw error
      safeSetState(setFeedbackList, data || [])
    } catch {
      toast.error('Failed to load issues')
    } finally {
      safeSetState(setLoading, false)
    }
  }, [safeSetState, toast])

  useEffect(() => {
    loadFeedback()
  }, [loadFeedback])

  // Admin-only controls (status changes, automated fixes) are gated on the
  // caller's profile role. The backend RPCs/edge functions also enforce this;
  // gating the UI just hides controls that would otherwise error for non-admins.
  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      if (!cancelled) setIsAdmin(data?.role === 'admin')
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  // Load comments for selected feedback
  const loadComments = useCallback(
    async feedbackId => {
      safeSetState(setLoadingComments, true)
      try {
        const { data, error } = await supabase
          .from('feedback_comments')
          .select('*')
          .eq('feedback_id', feedbackId)
          .order('created_at', { ascending: true })
        if (error) throw error
        safeSetState(setComments, data || [])
      } catch {
        // Silently fail for comments - not critical
      } finally {
        safeSetState(setLoadingComments, false)
      }
    },
    [safeSetState]
  )

  useEffect(() => {
    if (selectedFeedback) {
      loadComments(selectedFeedback.id)
    }
  }, [selectedFeedback, loadComments])

  // Submit new feedback
  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim() || !form.title.trim() || !form.description.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    safeSetState(setSubmitting, true)
    try {
      const { error } = await supabase.from('feedback').insert({
        submitted_by: user?.id || null,
        submitted_by_name: form.name.trim(),
        submitted_by_email: form.email.trim() || null,
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        priority: form.priority,
        affected_area: form.affected_area,
        steps_to_reproduce: form.steps_to_reproduce.trim() || null,
      })

      if (error) throw error

      // Reset form
      safeSetState(setForm, {
        name: form.name, // Keep name for convenience
        email: form.email,
        title: '',
        description: '',
        category: 'bug',
        priority: 'medium',
        affected_area: 'other',
        steps_to_reproduce: '',
      })
      safeSetState(setShowForm, false)
      toast.success('Issue submitted successfully!')
      await loadFeedback()
    } catch (err) {
      toast.error(err.message || 'Error submitting feedback. Please try again.')
    } finally {
      safeSetState(setSubmitting, false)
    }
  }

  // Add comment
  const handleAddComment = async () => {
    if (!newComment.trim() || !selectedFeedback) return

    try {
      const { error } = await supabase.from('feedback_comments').insert({
        feedback_id: selectedFeedback.id,
        author_id: user?.id || null,
        author_name: form.name || 'Anonymous',
        content: newComment.trim(),
      })

      if (error) throw error

      safeSetState(setNewComment, '')
      toast.success('Comment added')
      await loadComments(selectedFeedback.id)
      await loadFeedback() // Refresh comment count
    } catch {
      toast.error('Failed to add comment')
    }
  }

  // Filter feedback
  const filteredFeedback = feedbackList.filter(f => {
    if (filter === 'all') return true
    if (filter === 'open') return f.status === 'open' || f.status === 'in_progress'
    if (filter === 'resolved') return f.status === 'resolved' || f.status === 'wont_fix'
    return true
  })

  // Update issue status
  const updateStatus = async (feedbackId, newStatus) => {
    try {
      const { error } = await supabase.rpc('update_feedback_status', {
        feedback_id: feedbackId,
        new_status: newStatus,
      })

      if (error) throw error

      // Update local state
      safeSetState(setSelectedFeedback, prev => (prev ? { ...prev, status: newStatus } : null))
      toast.success(
        `Status updated to ${STATUSES.find(s => s.value === newStatus)?.label || newStatus}`
      )
      await loadFeedback()
    } catch {
      toast.error('Failed to update status')
    }
  }

  // Trigger fix the issue directly
  const triggerFix = async feedback => {
    if (fixingIssue) return

    safeSetState(setFixingIssue, feedback.id)
    try {
      const token = await getAccessToken()

      const response = await fetch(`${SUPABASE_URL}/functions/v1/trigger-fix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ feedbackId: feedback.id }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to trigger fix')
      }

      // Open GitHub Actions in new tab
      window.open(data.actionsUrl, '_blank')

      // Refresh to show updated status
      await loadFeedback()

      toast.success('Fix triggered! Check GitHub Actions for progress.')
    } catch (err) {
      toast.error(err.message || 'Failed to trigger fix')
    } finally {
      safeSetState(setFixingIssue, null)
    }
  }

  const getCategoryColor = cat => CATEGORIES.find(c => c.value === cat)?.color || '#888'
  const getStatusColor = status => STATUSES.find(s => s.value === status)?.color || '#888'
  const getStatusLabel = status => STATUSES.find(s => s.value === status)?.label || status
  const getAreaLabel = area => AREAS.find(a => a.value === area)?.label || area

  const formatDate = date => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className='container'>
      <Header pageLabel='Feedback' />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-1)' }}>Issues & Feedback</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
            Report bugs, suggest improvements, or ask questions
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: 'var(--space-3) var(--space-6)',
            background: 'var(--gradient-accent)',
            color: 'var(--text-on-accent)',
            border: 'none',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-medium)',
            cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : '+ New Issue'}
        </button>
      </div>

      {/* New Issue Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            padding: 'var(--space-6)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <h3 style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-lg)' }}>
            Submit New Issue
          </h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-4)',
              marginBottom: 'var(--space-4)',
            }}
          >
            <div>
              <label
                htmlFor='fb-name'
                style={{
                  display: 'block',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Your Name *
              </label>
              <input
                id='fb-name'
                type='text'
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                style={{
                  width: '100%',
                  padding: 'var(--space-2-5) var(--space-3)',
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-md)',
                }}
                required
              />
            </div>
            <div>
              <label
                htmlFor='fb-email'
                style={{
                  display: 'block',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Email (optional)
              </label>
              <input
                id='fb-email'
                type='email'
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                style={{
                  width: '100%',
                  padding: 'var(--space-2-5) var(--space-3)',
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-md)',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label
              htmlFor='fb-title'
              style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                marginBottom: 'var(--space-1)',
              }}
            >
              Title *
            </label>
            <input
              id='fb-title'
              type='text'
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder='Brief summary of the issue'
              style={{
                width: '100%',
                padding: 'var(--space-2-5) var(--space-3)',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-md)',
              }}
              required
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 'var(--space-4)',
              marginBottom: 'var(--space-4)',
            }}
          >
            <div>
              <label
                htmlFor='fb-category'
                style={{
                  display: 'block',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Category
              </label>
              <select
                id='fb-category'
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                style={{
                  width: '100%',
                  padding: 'var(--space-2-5) var(--space-3)',
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-md)',
                }}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor='fb-priority'
                style={{
                  display: 'block',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Priority
              </label>
              <select
                id='fb-priority'
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}
                style={{
                  width: '100%',
                  padding: 'var(--space-2-5) var(--space-3)',
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-md)',
                }}
              >
                {PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor='fb-area'
                style={{
                  display: 'block',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Affected Area
              </label>
              <select
                id='fb-area'
                value={form.affected_area}
                onChange={e => setForm({ ...form, affected_area: e.target.value })}
                style={{
                  width: '100%',
                  padding: 'var(--space-2-5) var(--space-3)',
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-md)',
                }}
              >
                {AREAS.map(area => (
                  <option key={area.value} value={area.value}>
                    {area.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label
              htmlFor='fb-description'
              style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                marginBottom: 'var(--space-1)',
              }}
            >
              Description *
            </label>
            <textarea
              id='fb-description'
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder='Describe the issue in detail. What did you expect to happen? What actually happened?'
              rows={4}
              style={{
                width: '100%',
                padding: 'var(--space-2-5) var(--space-3)',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-md)',
                resize: 'vertical',
              }}
              required
            />
          </div>

          {form.category === 'bug' && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label
                htmlFor='fb-steps'
                style={{
                  display: 'block',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Steps to Reproduce (for bugs)
              </label>
              <textarea
                id='fb-steps'
                value={form.steps_to_reproduce}
                onChange={e => setForm({ ...form, steps_to_reproduce: e.target.value })}
                placeholder='1. Go to...&#10;2. Click on...&#10;3. See error...'
                rows={3}
                style={{
                  width: '100%',
                  padding: 'var(--space-2-5) var(--space-3)',
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-md)',
                  resize: 'vertical',
                }}
              />
            </div>
          )}

          <button
            type='submit'
            disabled={submitting}
            style={{
              padding: 'var(--space-3) var(--space-6)',
              background: 'var(--gradient-accent)',
              color: 'var(--text-on-accent)',
              border: 'none',
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--font-medium)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Issue'}
          </button>
        </form>
      )}

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0',
          marginBottom: 'var(--space-4)',
          border: '1px solid var(--border)',
        }}
      >
        {['all', 'open', 'resolved'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: 'var(--space-2-5)',
              background: filter === f ? 'var(--accent)' : 'transparent',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              border: 'none',
              borderRight: f !== 'resolved' ? '1px solid var(--border)' : 'none',
              cursor: 'pointer',
              fontSize: 'var(--text-base)',
              textTransform: 'capitalize',
            }}
          >
            {f} (
            {
              feedbackList.filter(fb => {
                if (f === 'all') return true
                if (f === 'open') return fb.status === 'open' || fb.status === 'in_progress'
                return fb.status === 'resolved' || fb.status === 'wont_fix'
              }).length
            }
            )
          </button>
        ))}
      </div>

      {/* Feedback List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
          <div className='spinner'></div>
        </div>
      ) : filteredFeedback.length === 0 ? (
        <div
          style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--text-muted)' }}
        >
          <p>No issues found.</p>
          <button
            onClick={() => setShowForm(true)}
            style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-2-5) var(--space-5)',
              background: 'var(--gradient-accent)',
              color: 'var(--text-on-accent)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Submit the first issue
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            marginBottom: '100px',
          }}
        >
          {filteredFeedback.map(feedback => (
            <div
              key={feedback.id}
              role='button'
              tabIndex={0}
              onClick={() =>
                setSelectedFeedback(selectedFeedback?.id === feedback.id ? null : feedback)
              }
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelectedFeedback(selectedFeedback?.id === feedback.id ? null : feedback)
                }
              }}
              style={{
                background: 'var(--bg-card)',
                border:
                  selectedFeedback?.id === feedback.id
                    ? '1px solid var(--accent)'
                    : '1px solid var(--border)',
                padding: 'var(--space-4)',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 'var(--space-2)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      flexWrap: 'wrap',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        padding: 'var(--space-0-5) var(--space-2)',
                        background: getCategoryColor(feedback.category),
                        color: '#fff',
                        textTransform: 'uppercase',
                      }}
                    >
                      {feedback.category}
                    </span>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        padding: 'var(--space-0-5) var(--space-2)',
                        background: getStatusColor(feedback.status),
                        color: '#fff',
                      }}
                    >
                      {getStatusLabel(feedback.status)}
                    </span>
                    {feedback.priority === 'critical' && (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: '#ef4444',
                          fontWeight: 'var(--font-semibold)',
                        }}
                      >
                        CRITICAL
                      </span>
                    )}
                    {feedback.priority === 'high' && (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: '#f59e0b',
                          fontWeight: 'var(--font-semibold)',
                        }}
                      >
                        HIGH
                      </span>
                    )}
                  </div>
                  <h4
                    style={{
                      fontSize: '15px',
                      fontWeight: 'var(--font-medium)',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    {feedback.title}
                  </h4>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                    by {feedback.submitted_by_name} · {formatDate(feedback.created_at)}
                    {feedback.affected_area && ` · ${getAreaLabel(feedback.affected_area)}`}
                    {feedback.comment_count > 0 && (
                      <span style={{ marginLeft: 'var(--space-2)', color: 'var(--accent)' }}>
                        {feedback.comment_count}{' '}
                        {feedback.comment_count === 1 ? 'comment' : 'comments'}
                      </span>
                    )}
                  </p>
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xl)' }}>
                  {selectedFeedback?.id === feedback.id ? '▼' : '→'}
                </span>
              </div>

              {/* Expanded Details */}
              {selectedFeedback?.id === feedback.id && (
                <div
                  style={{
                    marginTop: 'var(--space-4)',
                    paddingTop: 'var(--space-4)',
                    borderTop: '1px solid var(--border)',
                  }}
                  role='presentation'
                  onClick={e => e.stopPropagation()}
                >
                  {/* Status Change — admin only */}
                  {isAdmin && (
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                      <h5
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: 'var(--text-muted)',
                          marginBottom: 'var(--space-2)',
                        }}
                      >
                        Status
                      </h5>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        {STATUSES.map(s => (
                          <button
                            key={s.value}
                            onClick={() => updateStatus(feedback.id, s.value)}
                            style={{
                              padding: 'var(--space-1-5) var(--space-3)',
                              background: feedback.status === s.value ? s.color : 'transparent',
                              color: feedback.status === s.value ? '#fff' : 'var(--text-muted)',
                              border: `1px solid ${feedback.status === s.value ? s.color : 'var(--border)'}`,
                              cursor: 'pointer',
                              fontSize: 'var(--text-sm)',
                            }}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <h5
                      style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-muted)',
                        marginBottom: 'var(--space-1)',
                      }}
                    >
                      Description
                    </h5>
                    <p style={{ fontSize: 'var(--text-md)', whiteSpace: 'pre-wrap' }}>
                      {feedback.description}
                    </p>
                  </div>

                  {feedback.resolution_notes && (
                    <div
                      style={{
                        marginBottom: 'var(--space-4)',
                        padding: 'var(--space-3)',
                        background: 'rgba(34, 197, 94, 0.1)',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                      }}
                    >
                      <h5
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: '#22c55e',
                          marginBottom: 'var(--space-1)',
                        }}
                      >
                        Resolution
                      </h5>
                      <p style={{ fontSize: 'var(--text-md)' }}>{feedback.resolution_notes}</p>
                    </div>
                  )}

                  {/* Comments & AI Context */}
                  <div style={{ marginTop: 'var(--space-4)' }}>
                    <h5
                      style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-muted)',
                        marginBottom: 'var(--space-2)',
                      }}
                    >
                      History ({comments.length})
                    </h5>

                    {loadingComments ? (
                      <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
                        <div className='spinner' style={{ width: '20px', height: '20px' }}></div>
                      </div>
                    ) : comments.length === 0 ? (
                      <p
                        style={{
                          fontSize: 'var(--text-base)',
                          color: 'var(--text-muted)',
                          marginBottom: 'var(--space-3)',
                        }}
                      >
                        No activity yet. Add a comment or trigger an AI fix.
                      </p>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--space-2)',
                          marginBottom: 'var(--space-3)',
                        }}
                      >
                        {comments.map(comment => {
                          const isAI = comment.type === 'ai_context'
                          return (
                            <div
                              key={comment.id}
                              style={{
                                padding: 'var(--space-3)',
                                background: isAI ? 'var(--accent-subtle)' : 'var(--bg-dark)',
                                border: isAI
                                  ? '1px solid var(--accent-line)'
                                  : '1px solid var(--border)',
                                borderLeft: isAI
                                  ? '3px solid var(--accent)'
                                  : '1px solid var(--border)',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 'var(--text-xs2)',
                                  color: isAI ? 'var(--accent)' : 'var(--text-muted)',
                                  marginBottom: 'var(--space-1)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 'var(--space-1-5)',
                                }}
                              >
                                {isAI && <span>🤖</span>}
                                <strong>{comment.author_name}</strong> ·{' '}
                                {formatDate(comment.created_at)}
                              </div>
                              <p
                                style={{
                                  fontSize: 'var(--text-base)',
                                  whiteSpace: 'pre-wrap',
                                  color: isAI ? 'var(--text-primary)' : 'inherit',
                                }}
                              >
                                {comment.content}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Add Comment */}
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        type='text'
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder='Add a comment or update...'
                        style={{
                          flex: 1,
                          padding: 'var(--space-2-5) var(--space-3)',
                          background: 'var(--bg-dark)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          fontSize: 'var(--text-base)',
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            handleAddComment()
                          }
                        }}
                      />
                      <button
                        onClick={handleAddComment}
                        disabled={!newComment.trim()}
                        style={{
                          padding: 'var(--space-2-5) var(--space-4)',
                          background: newComment.trim()
                            ? 'var(--gradient-accent)'
                            : 'var(--bg-dark)',
                          color: newComment.trim() ? '#fff' : 'var(--text-muted)',
                          border: '1px solid var(--border)',
                          cursor: newComment.trim() ? 'pointer' : 'not-allowed',
                          fontSize: 'var(--text-base)',
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Automated-fix trigger — admin only */}
                  {isAdmin && feedback.status !== 'resolved' && feedback.status !== 'wont_fix' && (
                    <div
                      style={{
                        marginTop: 'var(--space-4)',
                        paddingTop: 'var(--space-4)',
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      {feedback.fix_in_progress ? (
                        <div
                          style={{
                            padding: 'var(--space-3)',
                            background: 'var(--accent-subtle)',
                            border: '1px solid var(--accent-line)',
                            textAlign: 'center',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 'var(--space-2)',
                              marginBottom: 'var(--space-2)',
                            }}
                          >
                            <div
                              className='spinner'
                              style={{ width: '16px', height: '16px' }}
                            ></div>
                            <span
                              style={{ fontWeight: 'var(--font-medium)', color: 'var(--accent)' }}
                            >
                              Fix in progress...
                            </span>
                          </div>
                          <p style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                            Started{' '}
                            {feedback.fix_triggered_at
                              ? formatDate(feedback.fix_triggered_at)
                              : 'recently'}
                          </p>
                          <a
                            href='https://github.com/luxempig/Boyk/actions'
                            target='_blank'
                            rel='noopener noreferrer'
                            style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)' }}
                          >
                            View on GitHub Actions →
                          </a>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => triggerFix(feedback)}
                            disabled={fixingIssue === feedback.id}
                            style={{
                              width: '100%',
                              padding: 'var(--space-3)',
                              background:
                                fixingIssue === feedback.id
                                  ? 'var(--bg-dark)'
                                  : 'var(--gradient-accent)',
                              color: fixingIssue === feedback.id ? 'var(--text-muted)' : '#fff',
                              border: 'none',
                              cursor: fixingIssue === feedback.id ? 'not-allowed' : 'pointer',
                              fontSize: 'var(--text-md)',
                              fontWeight: 'var(--font-medium)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 'var(--space-2)',
                            }}
                          >
                            {fixingIssue === feedback.id ? (
                              <>
                                <div
                                  className='spinner'
                                  style={{ width: '16px', height: '16px' }}
                                ></div>
                                Triggering fix...
                              </>
                            ) : (
                              <>
                                <span style={{ fontSize: 'var(--text-xl)' }}>🤖</span>
                                Fix with AI
                              </>
                            )}
                          </button>
                          <p
                            style={{
                              fontSize: 'var(--text-xs2)',
                              color: 'var(--text-muted)',
                              marginTop: 'var(--space-2)',
                              textAlign: 'center',
                            }}
                          >
                            Will investigate and commit a fix directly.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
