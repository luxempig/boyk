// User-claimed companies & connections panel.
//
// Mountable into either EditBoycottModal (full edit affordances) or
// BoycottDetailView (read-only with edit affordances when viewer owns the
// boycott). Renders three sections:
//   1. List of user-added companies, each with its description + sources
//   2. Add-company form (collapsed by default; expands inline)
//   3. List of user-added connections (when present)
//
// Visual distinction from canonical data:
//   - Header pill "USER-CLAIMED" so it's never confused with canonical data
//   - Each row has a small "added by <user>" footer so authorship is explicit
//   - Source URLs are externally-linkable so reviewers can verify

import { ExternalLink, Plus, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAuth } from '../../../context/AuthContext'
import {
  useAddEvidence,
  useAddUserCompany,
  useAddUserConnection,
  useBoycottUserClaims,
  useRemoveEvidence,
  useRemoveUserCompany,
  useRemoveUserConnection,
  useToggleVote,
} from '../../../hooks/useUserClaims'
import { searchCompanies } from '../../../services/neo4jGraph'
import {
  PARENT_KIND_USER_COMPANY,
  PARENT_KIND_USER_CONNECTION,
  REF_KIND_USER,
  RELATION_OPTIONS,
  STANCE_AGREE,
  STANCE_DISAGREE,
} from '../../../services/userClaims/constants'

// Re-export so any future callers can import from the panel module.
export { RELATION_OPTIONS }

export default function UserClaimedCompaniesPanel({ boycottId, canEdit = false }) {
  const { data, isLoading } = useBoycottUserClaims(boycottId)
  const [showAddForm, setShowAddForm] = useState(false)

  if (!boycottId) return null

  const claims = data || { companies: [], connections: [], evidence: {}, votes: {} }
  const empty = !isLoading && claims.companies.length === 0 && claims.connections.length === 0

  return (
    <section
      style={{
        marginTop: 'var(--space-5)',
        paddingTop: 'var(--space-4)',
        borderTop: '1px solid var(--border)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-2-5)',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
          <h3
            style={{
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--font-bold)',
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            User-claimed entries
          </h3>
          <span
            title='These claims are added by the boycott creator — not part of the canonical knowledge graph.'
            style={{
              fontSize: 'var(--text-2xs)',
              color: 'var(--text-muted)',
            }}
          >
            community-sourced, not verified by Boyk
          </span>
        </div>
        {canEdit && !showAddForm && (
          <button type='button' onClick={() => setShowAddForm(true)} style={addEntryBtn}>
            <Plus size={12} /> Add company
          </button>
        )}
      </header>

      {isLoading && (
        <p style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {showAddForm && (
        <AddCustomCompanyForm boycottId={boycottId} onClose={() => setShowAddForm(false)} />
      )}

      {!isLoading && claims.companies.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {claims.companies.map(c => (
            <UserCompanyRow
              key={c.id}
              company={c}
              evidence={claims.evidence[`user_company:${c.id}`] || []}
              votes={claims.votes[`user_company:${c.id}`] || { agree: 0, disagree: 0, mine: null }}
              boycottId={boycottId}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}

      {!isLoading && (claims.connections.length > 0 || canEdit) && (
        <ConnectionsSection
          boycottId={boycottId}
          userCompanies={claims.companies}
          connections={claims.connections}
          evidence={claims.evidence}
          votes={claims.votes}
          neo4jNames={claims.neo4jNames || {}}
          canEdit={canEdit}
        />
      )}

      {!isLoading && empty && !showAddForm && (
        <p style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)', margin: 0 }}>
          {canEdit
            ? 'No custom entries yet. Click "Add custom company" to write one in with a source.'
            : 'No custom entries on this boycott.'}
        </p>
      )}
    </section>
  )
}

function UserCompanyRow({ company, evidence, votes, boycottId, canEdit }) {
  const removeMut = useRemoveUserCompany(company.boycott_id)
  const { user } = useAuth()
  const isCreator = user && company.created_by === user.id
  return (
    <li
      style={{
        padding: 'var(--space-3) 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
        }}
      >
        <LetterAvatar name={company.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1-5)',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 'var(--text-md)',
                fontWeight: 'var(--font-bold)',
                color: 'var(--text-primary)',
              }}
            >
              {company.name}
            </span>
            <UserPill />
          </div>
          {company.description && (
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                margin: 'var(--space-0-5) 0 0 0',
                lineHeight: 1.45,
              }}
            >
              {company.description}
            </p>
          )}
          <EvidenceList
            parentKind={PARENT_KIND_USER_COMPANY}
            parentId={company.id}
            boycottId={boycottId}
            evidence={evidence}
            canEdit={canEdit && isCreator}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-1-5)' }}>
          <VoteWidget
            targetKind={PARENT_KIND_USER_COMPANY}
            targetId={company.id}
            votes={votes}
            boycottId={boycottId}
            disabled={isCreator}
          />
          {canEdit && (
            <button
              type='button'
              onClick={() => {
                if (window.confirm(`Remove "${company.name}" and its sources?`)) {
                  removeMut.mutate(company.id)
                }
              }}
              title='Remove'
              style={iconBtn}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function LetterAvatar({ name, size = 36 }) {
  const letter = (name || '?')[0].toUpperCase()
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 'var(--font-bold)',
        fontSize: 'var(--text-md)',
        flexShrink: 0,
        border: '1px dashed var(--border)',
      }}
    >
      {letter}
    </div>
  )
}

function UserPill() {
  return (
    <span
      title='User-claimed — not from the canonical knowledge graph'
      style={{
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--font-extrabold)',
        color: 'var(--text-secondary)',
        padding: '1px 5px',
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-xs)',
        letterSpacing: '0.8px',
      }}
    >
      USER
    </span>
  )
}

function VoteWidget({ targetKind, targetId, votes, boycottId, disabled }) {
  const toggle = useToggleVote(boycottId)
  const { user } = useAuth()
  const cast = stance => {
    if (!user || disabled || toggle.isPending) return
    toggle.mutate({ targetKind, targetId, stance, currentMine: votes.mine })
  }
  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
      title={
        disabled
          ? "You can't vote on your own claim"
          : !user
            ? 'Sign in to vote'
            : 'Tap to agree / disagree; tap again to withdraw'
      }
    >
      <button
        type='button'
        onClick={() => cast(STANCE_AGREE)}
        disabled={!user || disabled || toggle.isPending}
        aria-label='Agree'
        aria-pressed={votes.mine === STANCE_AGREE}
        style={{
          ...voteBtnStyle(votes.mine === STANCE_AGREE, '#16a34a'),
          opacity: !user || disabled ? 0.55 : 1,
          cursor: !user || disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <ThumbsUp size={14} />
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 'var(--font-semibold)',
          }}
        >
          {votes.agree}
        </span>
      </button>
      <button
        type='button'
        onClick={() => cast(STANCE_DISAGREE)}
        disabled={!user || disabled || toggle.isPending}
        aria-label='Disagree'
        aria-pressed={votes.mine === STANCE_DISAGREE}
        style={{
          ...voteBtnStyle(votes.mine === STANCE_DISAGREE, '#dc2626'),
          opacity: !user || disabled ? 0.55 : 1,
          cursor: !user || disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <ThumbsDown size={14} />
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 'var(--font-semibold)',
          }}
        >
          {votes.disagree}
        </span>
      </button>
    </div>
  )
}

function voteBtnStyle(active, accentColor) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: active ? `${accentColor}1f` : 'var(--bg-elevated, transparent)',
    border: `1px solid ${active ? accentColor : 'var(--border)'}`,
    color: active ? accentColor : 'var(--text-secondary)',
    padding: '4px 9px',
    cursor: 'pointer',
    borderRadius: 'var(--radius-md)',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  }
}

function AddCustomCompanyForm({ boycottId, onClose }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [quote, setQuote] = useState('')
  const [error, setError] = useState(null)

  const addCompany = useAddUserCompany(boycottId)
  const addEv = useAddEvidence(boycottId)
  const submitting = addCompany.isPending || addEv.isPending

  const submit = async e => {
    e.preventDefault()
    setError(null)
    try {
      const trimmedName = name.trim()
      if (!trimmedName) {
        setError('Name is required.')
        return
      }
      if (!/^https?:\/\//i.test(url.trim())) {
        setError('Source URL must start with http(s)://.')
        return
      }
      const company = await addCompany.mutateAsync({
        name: trimmedName,
        description: description.trim() || null,
      })
      await addEv.mutateAsync({
        parentKind: PARENT_KIND_USER_COMPANY,
        parentId: company.id,
        url: url.trim(),
        source_label: sourceLabel.trim() || null,
        quote: quote.trim() || null,
      })
      setName('')
      setDescription('')
      setUrl('')
      setSourceLabel('')
      setQuote('')
      onClose()
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        border: '1px solid var(--border)',
        padding: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
        background: 'var(--bg, white)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-2)',
        }}
      >
        <strong style={{ fontSize: 'var(--text-sm)' }}>
          Add a company that isn't in our database
        </strong>
        <button
          type='button'
          onClick={onClose}
          style={iconBtn}
          title='Cancel'
          aria-label='Cancel adding company'
        >
          <X size={14} />
        </button>
      </div>

      <Field
        label='Company name'
        value={name}
        onChange={setName}
        required
        placeholder='e.g., Acme Holdings LLC'
      />
      <Field
        label='Description (optional)'
        value={description}
        onChange={setDescription}
        placeholder='1 line of context, e.g., "Parent of XYZ"'
      />
      <Field
        label='Source URL'
        type='url'
        value={url}
        onChange={setUrl}
        required
        placeholder='https://…'
        help='Link to a source supporting that this company exists / is relevant.'
      />
      <Field
        label='Source label (optional)'
        value={sourceLabel}
        onChange={setSourceLabel}
        placeholder='e.g., SEC filing, ProPublica, court doc'
      />
      <Field
        label='Quoted excerpt (optional)'
        value={quote}
        onChange={setQuote}
        placeholder='Pulled passage from the source'
      />

      {error && (
        <p style={{ fontSize: 'var(--text-xs2)', color: 'var(--danger, #dc2626)', marginTop: 8 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)' }}>
        <button type='submit' disabled={submitting} style={primaryBtn}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button type='button' onClick={onClose} disabled={submitting} style={secondaryBtn}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({ label, value, onChange, type = 'text', required, placeholder, help }) {
  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <label
        style={{
          display: 'block',
          fontSize: 'var(--text-xs2)',
          color: 'var(--text-secondary)',
          marginBottom: 2,
        }}
      >
        {label}
        {required && <span style={{ color: 'var(--danger, #dc2626)' }}> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className='input-field'
        style={{ width: '100%' }}
      />
      {help && (
        <p
          style={{
            fontSize: 'var(--text-xs2)',
            color: 'var(--text-muted)',
            margin: '2px 0 0 0',
          }}
        >
          {help}
        </p>
      )}
    </div>
  )
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const iconBtn = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  padding: 4,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--radius-sm)',
}

const primaryBtn = {
  background: 'var(--gradient-accent)',
  color: 'var(--text-on-accent, #fff)',
  border: 'none',
  padding: '8px 16px',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--font-semibold)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
}

const secondaryBtn = {
  background: 'transparent',
  border: '1px solid var(--border)',
  padding: '8px 16px',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--font-semibold)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
}

const addEntryBtn = {
  background: 'transparent',
  border: '1px solid var(--border)',
  padding: '5px 11px',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--font-semibold)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
}

// ─── Evidence list with add/remove affordances ─────────────────────

function EvidenceList({ parentKind, parentId, boycottId, evidence, canEdit }) {
  const [adding, setAdding] = useState(false)
  const removeMut = useRemoveEvidence(boycottId)
  if (evidence.length === 0 && !canEdit) return null
  return (
    <div style={{ margin: '6px 0 0 0' }}>
      {evidence.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}
        >
          {evidence.map(e => (
            <li
              key={e.id}
              style={{
                fontSize: 'var(--text-xs)',
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: 'var(--space-1-5)',
                lineHeight: 1.5,
              }}
            >
              <a
                href={e.url}
                target='_blank'
                rel='noreferrer'
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontWeight: 'var(--font-semibold)',
                }}
              >
                {e.source_label || hostname(e.url)}
                <ExternalLink size={11} />
              </a>
              {e.quote && (
                <span
                  style={{
                    color: 'var(--text-secondary)',
                    fontStyle: 'italic',
                  }}
                >
                  “{e.quote}”
                </span>
              )}
              {canEdit && (
                <button
                  type='button'
                  title='Remove this source'
                  onClick={() => {
                    if (window.confirm('Remove this source?')) {
                      removeMut.mutate({ evidenceId: e.id, parentKind, parentId })
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: '0 2px',
                    fontSize: 'var(--text-xs2)',
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !adding && (
        <button
          type='button'
          onClick={() => setAdding(true)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-xs2)',
            padding: '2px 0',
            marginTop: 4,
          }}
        >
          + add source
        </button>
      )}
      {adding && (
        <AddEvidenceForm
          parentKind={parentKind}
          parentId={parentId}
          boycottId={boycottId}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function AddEvidenceForm({ parentKind, parentId, boycottId, onClose }) {
  const [url, setUrl] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [quote, setQuote] = useState('')
  const [error, setError] = useState(null)
  const addEv = useAddEvidence(boycottId)
  const submit = async e => {
    e.preventDefault()
    setError(null)
    if (!/^https?:\/\//i.test(url.trim())) {
      setError('URL must start with http(s)://')
      return
    }
    try {
      await addEv.mutateAsync({
        parentKind,
        parentId,
        url: url.trim(),
        source_label: sourceLabel.trim() || null,
        quote: quote.trim() || null,
      })
      onClose()
    } catch (err) {
      setError(err.message || String(err))
    }
  }
  return (
    <form
      onSubmit={submit}
      style={{
        marginTop: 4,
        padding: 'var(--space-2)',
        border: '1px solid var(--border)',
        background: 'var(--bg, white)',
      }}
    >
      <input
        type='url'
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder='https://…'
        required
        className='input-field'
        style={{ width: '100%', fontSize: 'var(--text-xs2)', marginBottom: 4 }}
      />
      <input
        type='text'
        value={sourceLabel}
        onChange={e => setSourceLabel(e.target.value)}
        placeholder='Source label (optional)'
        className='input-field'
        style={{ width: '100%', fontSize: 'var(--text-xs2)', marginBottom: 4 }}
      />
      <input
        type='text'
        value={quote}
        onChange={e => setQuote(e.target.value)}
        placeholder='Quoted excerpt (optional)'
        className='input-field'
        style={{ width: '100%', fontSize: 'var(--text-xs2)', marginBottom: 4 }}
      />
      {error && (
        <p style={{ fontSize: 'var(--text-xs2)', color: 'var(--danger, #dc2626)' }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type='submit'
          disabled={addEv.isPending}
          style={{ ...primaryBtn, padding: '3px 8px', fontSize: 'var(--text-xs2)' }}
        >
          {addEv.isPending ? '…' : 'Add'}
        </button>
        <button
          type='button'
          onClick={onClose}
          style={{ ...secondaryBtn, padding: '3px 8px', fontSize: 'var(--text-xs2)' }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Connections section ─────────────────────────────────────────────

function ConnectionsSection({
  boycottId,
  userCompanies,
  connections,
  evidence,
  votes,
  neo4jNames,
  canEdit,
}) {
  const [showForm, setShowForm] = useState(false)
  return (
    <div
      style={{
        marginTop: 'var(--space-4)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px dashed var(--border)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-2)',
          gap: 'var(--space-2)',
        }}
      >
        <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', margin: 0 }}>
          Custom connections{connections.length > 0 ? ` (${connections.length})` : ''}
        </h4>
        {canEdit && !showForm && (
          <button
            type='button'
            onClick={() => setShowForm(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              padding: '4px 10px',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--text-secondary)',
            }}
          >
            <Plus size={12} /> Add connection
          </button>
        )}
      </header>

      {showForm && (
        <AddConnectionForm
          boycottId={boycottId}
          userCompanies={userCompanies}
          onClose={() => setShowForm(false)}
        />
      )}

      {connections.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {connections.map(c => (
            <UserConnectionRow
              key={c.id}
              connection={c}
              userCompanies={userCompanies}
              neo4jNames={neo4jNames}
              evidence={evidence[`user_connection:${c.id}`] || []}
              votes={votes[`user_connection:${c.id}`] || { agree: 0, disagree: 0, mine: null }}
              boycottId={boycottId}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function UserConnectionRow({
  connection,
  userCompanies,
  neo4jNames,
  evidence,
  votes,
  boycottId,
  canEdit,
}) {
  const removeMut = useRemoveUserConnection(connection.boycott_id)
  const { user } = useAuth()
  const isCreator = user && connection.created_by === user.id

  const sourceName = describeRef(
    connection.source_kind,
    connection.source_id,
    userCompanies,
    neo4jNames
  )
  const targetName = describeRef(
    connection.target_kind,
    connection.target_id,
    userCompanies,
    neo4jNames
  )
  const relationLabel =
    connection.relation === 'other'
      ? connection.relation_label || 'related to'
      : RELATION_OPTIONS.find(r => r.value === connection.relation)?.label || connection.relation

  return (
    <li style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--space-1-5)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.4,
            }}
          >
            <ConnectionRefLabel name={sourceName.name} isUser={sourceName.user} />
            <span
              style={{
                fontSize: 'var(--text-2xs)',
                fontWeight: 'var(--font-bold)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-elevated)',
                padding: '2px 7px',
                borderRadius: 'var(--radius-pill, 999px)',
              }}
            >
              {relationLabel}
            </span>
            <ConnectionRefLabel name={targetName.name} isUser={targetName.user} />
          </div>
          {connection.description && (
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                margin: 'var(--space-1) 0 0 0',
                lineHeight: 1.45,
              }}
            >
              {connection.description}
            </p>
          )}
          <EvidenceList
            parentKind={PARENT_KIND_USER_CONNECTION}
            parentId={connection.id}
            boycottId={boycottId}
            evidence={evidence}
            canEdit={canEdit && isCreator}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-1-5)' }}>
          <VoteWidget
            targetKind={PARENT_KIND_USER_CONNECTION}
            targetId={connection.id}
            votes={votes}
            boycottId={boycottId}
            disabled={isCreator}
          />
          {canEdit && (
            <button
              type='button'
              onClick={() => {
                if (window.confirm('Remove this connection and its sources?')) {
                  removeMut.mutate(connection.id)
                }
              }}
              title='Remove'
              style={iconBtn}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

// Inline user badge for ref labels in connection rows + picker results.
// Visually matches the SEED pill (solid background, uppercase 2xs) but uses
// the muted text color so it parallels rather than competes.
function UserBadge() {
  return (
    <span
      title='User-claimed — not from the canonical knowledge graph'
      style={{
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--font-extrabold)',
        padding: '1px 5px',
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        borderRadius: 'var(--radius-xs)',
        flexShrink: 0,
      }}
    >
      USER
    </span>
  )
}

// Connection-row ref: company name in a tight chip with the USER badge if
// applicable. Used for both source and target so the layout stays scannable.
function ConnectionRefLabel({ name, isUser }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontWeight: 'var(--font-semibold)',
        color: 'var(--text-primary)',
      }}
    >
      {name}
      {isUser && <UserBadge />}
    </span>
  )
}

function describeRef(kind, id, userCompanies, neo4jNames) {
  if (kind === REF_KIND_USER) {
    const uc = userCompanies.find(c => c.id === id)
    return { name: uc ? uc.name : '(removed)', user: true }
  }
  // Neo4j ref — prefer the resolved name from the bundle, fall back to the id.
  const resolved = neo4jNames?.[id]
  if (resolved?.name) return { name: resolved.name, user: false }
  return { name: id, user: false }
}

function AddConnectionForm({ boycottId, userCompanies, onClose }) {
  const [source, setSource] = useState(null)
  const [target, setTarget] = useState(null)
  const [relation, setRelation] = useState('owns')
  const [relationLabel, setRelationLabel] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [quote, setQuote] = useState('')
  const [error, setError] = useState(null)

  const addConn = useAddUserConnection(boycottId)
  const addEv = useAddEvidence(boycottId)
  const submitting = addConn.isPending || addEv.isPending

  const submit = async e => {
    e.preventDefault()
    setError(null)
    try {
      if (!source) return setError('Pick a source company.')
      if (!target) return setError('Pick a target company.')
      if (source.kind === target.kind && String(source.id) === String(target.id)) {
        return setError("Source and target can't be the same company.")
      }
      if (relation === 'other' && !relationLabel.trim()) {
        return setError('Provide a label for the custom relation.')
      }
      if (!/^https?:\/\//i.test(url.trim())) {
        return setError('Source URL must start with http(s)://.')
      }
      const conn = await addConn.mutateAsync({
        source: { kind: source.kind, id: source.id },
        target: { kind: target.kind, id: target.id },
        relation,
        relation_label: relation === 'other' ? relationLabel.trim() : null,
        description: description.trim() || null,
      })
      await addEv.mutateAsync({
        parentKind: PARENT_KIND_USER_CONNECTION,
        parentId: conn.id,
        url: url.trim(),
        source_label: sourceLabel.trim() || null,
        quote: quote.trim() || null,
      })
      onClose()
    } catch (err) {
      // 23505 = unique violation: same connection already exists
      if (err?.code === '23505') {
        setError('That exact connection already exists on this boycott.')
      } else {
        setError(err.message || String(err))
      }
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        border: '1px solid var(--border)',
        padding: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
        background: 'var(--bg, white)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-2)',
        }}
      >
        <strong style={{ fontSize: 'var(--text-sm)' }}>Add a custom connection</strong>
        <button
          type='button'
          onClick={onClose}
          style={iconBtn}
          title='Cancel'
          aria-label='Cancel adding connection'
        >
          <X size={14} />
        </button>
      </div>

      <FieldLabel>Source company</FieldLabel>
      <CompanyPicker
        userCompanies={userCompanies}
        value={source}
        onChange={setSource}
        placeholder='Type to search 65,000+ companies or pick a custom one'
      />

      <FieldLabel>Relation</FieldLabel>
      <select
        value={relation}
        onChange={e => setRelation(e.target.value)}
        className='input-field'
        style={{ width: '100%', marginBottom: 'var(--space-2)' }}
      >
        {RELATION_OPTIONS.map(r => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      {relation === 'other' && (
        <Field
          label='Custom relation label'
          value={relationLabel}
          onChange={setRelationLabel}
          required
          placeholder="e.g., 'sponsors', 'sister org of'"
        />
      )}

      <FieldLabel>Target company</FieldLabel>
      <CompanyPicker
        userCompanies={userCompanies}
        value={target}
        onChange={setTarget}
        placeholder='Type to search'
      />

      <Field
        label='Description (optional)'
        value={description}
        onChange={setDescription}
        placeholder='1 line of context'
      />
      <Field
        label='Source URL'
        type='url'
        value={url}
        onChange={setUrl}
        required
        placeholder='https://…'
        help='Link to a source supporting this connection.'
      />
      <Field
        label='Source label (optional)'
        value={sourceLabel}
        onChange={setSourceLabel}
        placeholder='e.g., SEC filing, ProPublica, court doc'
      />
      <Field
        label='Quoted excerpt (optional)'
        value={quote}
        onChange={setQuote}
        placeholder='Pulled passage from the source'
      />

      {error && (
        <p style={{ fontSize: 'var(--text-xs2)', color: 'var(--danger, #dc2626)', marginTop: 8 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)' }}>
        <button type='submit' disabled={submitting} style={primaryBtn}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button type='button' onClick={onClose} disabled={submitting} style={secondaryBtn}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function FieldLabel({ children }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 'var(--text-xs2)',
        color: 'var(--text-secondary)',
        marginBottom: 2,
      }}
    >
      {children}
    </label>
  )
}

function CompanyPicker({ userCompanies, value, onChange, placeholder }) {
  const [query, setQuery] = useState('')
  const [neoResults, setNeoResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setNeoResults([])
      return undefined
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchCompanies(query)
        setNeoResults((results || []).slice(0, 5))
      } catch {
        setNeoResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const userMatches = userCompanies
    .filter(uc => uc.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5)

  if (value) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2) var(--space-3)',
          border: '1px solid var(--border)',
          marginBottom: 'var(--space-2)',
          background: 'var(--bg-dark, rgba(0,0,0,0.04))',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)' }}>
          <strong>{value.label}</strong>
          {value.kind === REF_KIND_USER && <UserBadge />}
        </span>
        <button
          type='button'
          onClick={() => onChange(null)}
          style={iconBtn}
          title='Change'
          aria-label='Clear selection'
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  const showResults = query.trim().length >= 2

  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <input
        type='text'
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        className='input-field'
        style={{ width: '100%' }}
      />
      {showResults && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '4px 0 0 0',
            border: '1px solid var(--border)',
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          {searching && (
            <li
              style={{
                padding: 'var(--space-2)',
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
              }}
            >
              Searching…
            </li>
          )}
          {userMatches.map(uc => (
            <PickerOption
              key={`u:${uc.id}`}
              label={uc.name}
              kind='user'
              onClick={() => {
                onChange({ kind: REF_KIND_USER, id: uc.id, label: uc.name })
                setQuery('')
              }}
            />
          ))}
          {neoResults.map(r => (
            <PickerOption
              key={`n:${r.id}`}
              label={r.name}
              kind='neo4j'
              onClick={() => {
                onChange({ kind: 'neo4j', id: r.id, label: r.name })
                setQuery('')
              }}
            />
          ))}
          {!searching && userMatches.length === 0 && neoResults.length === 0 && (
            <li
              style={{
                padding: 'var(--space-2)',
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
              }}
            >
              No matches. Add this name as a custom company first if it isn't in the database.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function PickerOption({ label, kind, onClick }) {
  return (
    <li>
      <button
        type='button'
        onClick={onClick}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: 'var(--space-2) var(--space-3)',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)' }}>{label}</span>
        {kind === REF_KIND_USER && <UserBadge />}
      </button>
    </li>
  )
}
