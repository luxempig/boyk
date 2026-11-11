/**
 * @component EditBoycottModal
 * @level Organism
 * @interactions
 *   - Modal dialog for editing an existing boycott's name, description, visibility, and companies
 *   - Supports adding/removing companies with connection-type toggles and delete confirmation
 *   - Consumes AppContext for updateBoycott, addCompanyToBoycott, removeCompanyFromBoycott
 */
import { useEffect, useState } from 'react'

import { useApp } from '../../../context/AppContext'
import { useCreateBoycottUpdate } from '../../../hooks/useBoycottUpdates'
import { useDebounce } from '../../../hooks/useDebounce'
import { useCreatePost } from '../../../hooks/useFeedQueries'
import { buildBoycottUpdateSummary } from '../../../lib/boycottDiff'
import { triggerBoycottOgRegeneration } from '../../../lib/ogImage'
import { normalizeSourceLink } from '../../../lib/sourceLink'
// import BoycottBuilderV2 from './BoycottBuilderV2' // Visual builder hidden for now
import Avatar from '../../atoms/Avatar'
import Modal from '../../molecules/Modal'
import UserClaimedCompaniesPanel from './UserClaimedCompaniesPanel'

export default function EditBoycottModal({ boycott, onClose, onDelete }) {
  const {
    updateBoycott,
    addCompanyToBoycott,
    removeCompanyFromBoycott,
    updateBoycottCompany,
    deleteBoycott,
    fetchMyBoycotts,
    searchCompanies,
  } = useApp()

  // Delete confirmation handler. `onDelete` is only supplied by Home.jsx; on
  // Explore/BoycottPage it's undefined, so fall back to deleting directly via
  // the context and closing the modal ourselves.
  const handleConfirmDelete = () => {
    if (onDelete) {
      onDelete(boycott.id)
    } else {
      deleteBoycott(boycott.id)
      onClose()
    }
  }

  const [name, setName] = useState(boycott.name || '')
  const [description, setDescription] = useState(boycott.description || '')
  const [isPublic, setIsPublic] = useState(boycott.is_public ?? true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Companies in the boycott
  const [companies, setCompanies] = useState([])

  // Company search state — companyQuery is the live input value;
  // debouncedCompanyQuery drives the network fetch (300ms behind keystrokes).
  const [showCompanySearch, setShowCompanySearch] = useState(false)
  const [companyQuery, setCompanyQuery] = useState('')
  const debouncedCompanyQuery = useDebounce(companyQuery, 300)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)

  // New company connection types (for adding new companies)
  const [newCompanyConnectionTypes, setNewCompanyConnectionTypes] = useState({
    owns: false,
    owned_by: false,
    brands: false,
    suppliers: false,
    customers: false,
  })

  const [sourceLinks, setSourceLinks] = useState(
    Array.isArray(boycott.source_links) ? boycott.source_links : []
  )
  const [newLink, setNewLink] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  // Post-save flow: after a save with detected changes, swap the modal body
  // to a "want to also share this?" prompt with an optional caption.
  const [showPostPrompt, setShowPostPrompt] = useState(false)
  const [pendingSummary, setPendingSummary] = useState('')
  const [postCaption, setPostCaption] = useState('')
  const [isPosting, setIsPosting] = useState(false)
  const createBoycottUpdate = useCreateBoycottUpdate()
  const createPost = useCreatePost()
  const typeLabel = isPublic ? 'Boycott' : 'Blacklist'

  const handleAddLink = () => {
    const { url, error: validationError } = normalizeSourceLink(newLink)
    if (validationError) {
      setError(validationError)
      return
    }
    if (sourceLinks.includes(url)) {
      setError('That link is already in the list.')
      return
    }
    setSourceLinks(prev => [...prev, url])
    setNewLink('')
    setError('')
  }

  const handleRemoveLink = url => {
    setSourceLinks(prev => prev.filter(l => l !== url))
  }

  // Initialize companies from boycott
  useEffect(() => {
    if (boycott.boycott_companies) {
      setCompanies(
        boycott.boycott_companies.map(bc => ({
          id: bc.companies?.id || bc.company_id,
          name: bc.companies?.name || 'Unknown',
          block_owns: bc.block_owns || false,
          block_owned_by: bc.block_owned_by || false,
          block_brands: bc.block_brands || false,
          block_suppliers: bc.block_suppliers || false,
          block_customers: bc.block_customers || false,
          isNew: false,
        }))
      )
    }
  }, [boycott])

  // Search as the debounced query settles. Filters out companies already in
  // the boycott so users don't see duplicates in the picker.
  useEffect(() => {
    if (!debouncedCompanyQuery.trim()) {
      setSearchResults([])
      return
    }
    let cancelled = false
    setIsSearching(true)
    searchCompanies(debouncedCompanyQuery)
      .then(results => {
        if (cancelled) return
        const filtered = results.filter(r => !companies.some(c => c.id === r.id))
        setSearchResults(filtered)
      })
      .catch(err => {
        if (!cancelled) console.error('Search error:', err)
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedCompanyQuery, companies, searchCompanies])

  const handleAddCompany = company => {
    setCompanies([
      ...companies,
      {
        id: company.id,
        name: company.name,
        logo_url: company.logo_url || null,
        block_owns: newCompanyConnectionTypes.owns,
        block_owned_by: newCompanyConnectionTypes.owned_by,
        block_brands: newCompanyConnectionTypes.brands,
        block_suppliers: newCompanyConnectionTypes.suppliers,
        block_customers: newCompanyConnectionTypes.customers,
        isNew: true,
      },
    ])
    setShowCompanySearch(false)
    setCompanyQuery('')
    setSearchResults([])
    setNewCompanyConnectionTypes({
      owns: false,
      owned_by: false,
      brands: false,
      suppliers: false,
      customers: false,
    })
  }

  const handleRemoveCompany = companyId => {
    setCompanies(companies.filter(c => c.id !== companyId))
  }

  const handleToggleConnection = (companyId, connectionType) => {
    setCompanies(
      companies.map(c => {
        if (c.id === companyId) {
          return { ...c, [connectionType]: !c[connectionType] }
        }
        return c
      })
    )
  }

  // Snapshot of the state we want to diff against. Built once per save call
  // (not memoized) so it always reflects the prop at save-time, not at
  // mount-time — important if the parent re-renders mid-edit.
  const buildInitialState = () => ({
    name: boycott.name || '',
    description: boycott.description || '',
    isPublic: boycott.is_public ?? true,
    sourceLinks: Array.isArray(boycott.source_links) ? boycott.source_links : [],
    companies: (boycott.boycott_companies || []).map(bc => ({
      id: bc.companies?.id || bc.company_id,
      name: bc.companies?.name || 'Unknown',
      block_owns: bc.block_owns,
      block_owned_by: bc.block_owned_by,
      block_brands: bc.block_brands,
      block_suppliers: bc.block_suppliers,
      block_customers: bc.block_customers,
    })),
  })

  const handleSave = async () => {
    if (!name.trim() || isSaving) return

    const initialState = buildInitialState()

    setIsSaving(true)
    setError('')

    try {
      // Update boycott name/description/visibility
      await updateBoycott(boycott.id, {
        name: name.trim(),
        description: description.trim(),
        is_public: isPublic,
        source_links: sourceLinks,
      })

      // Get original company IDs
      const originalCompanyIds = new Set(
        (boycott.boycott_companies || []).map(bc => bc.companies?.id || bc.company_id)
      )

      // Get current company IDs
      const currentCompanyIds = new Set(companies.map(c => c.id))

      // Remove companies that were deleted. Each mutation skips its own refetch
      // (skipRefresh) so we can do a single fetchMyBoycotts() after the loops,
      // mirroring CreateBoycottModal.
      for (const bc of boycott.boycott_companies || []) {
        const companyId = bc.companies?.id || bc.company_id
        if (!currentCompanyIds.has(companyId)) {
          await removeCompanyFromBoycott(boycott.id, companyId, { skipRefresh: true })
        }
      }

      // Add new companies and update existing ones
      for (const company of companies) {
        if (company.isNew) {
          // Add new company
          await addCompanyToBoycott(
            boycott.id,
            company.id,
            company.block_owns,
            company.block_owned_by,
            company.block_suppliers,
            company.name,
            company.logo_url || null,
            company.block_brands,
            company.block_customers,
            { skipRefresh: true }
          )
        } else if (originalCompanyIds.has(company.id)) {
          // Update existing company connection types
          const original = boycott.boycott_companies.find(
            bc => (bc.companies?.id || bc.company_id) === company.id
          )

          // Only update if something changed
          if (
            original &&
            (original.block_owns !== company.block_owns ||
              original.block_owned_by !== company.block_owned_by ||
              original.block_brands !== company.block_brands ||
              original.block_suppliers !== company.block_suppliers ||
              original.block_customers !== company.block_customers)
          ) {
            await updateBoycottCompany(
              boycott.id,
              company.id,
              company.block_owns,
              company.block_owned_by,
              company.block_suppliers,
              company.block_brands,
              company.block_customers,
              { skipRefresh: true }
            )
          }
        }
      }

      // Single refresh after all company mutations so the boycott list reflects
      // the new state without N intermediate refetches.
      await fetchMyBoycotts()

      // Fire-and-forget OG image regeneration so the next share preview
      // reflects the new state. Only public boycotts have OG images; the
      // edge function rejects private ones server-side either way.
      if (isPublic) {
        triggerBoycottOgRegeneration(boycott.id)
      }

      // After persisting changes, compute a one-line summary of what changed
      // and (if any change was detected) record a boycott_updates row + offer
      // an optional follow-up post.
      const summary = buildBoycottUpdateSummary(initialState, {
        name,
        description,
        isPublic,
        sourceLinks,
        companies,
      })

      if (summary) {
        try {
          await createBoycottUpdate.mutateAsync({ boycottId: boycott.id, summary })
        } catch (updateErr) {
          // The save itself succeeded — failing to record the update is not
          // worth blocking the user. Log and proceed without the prompt.
          console.warn('Failed to record boycott update:', updateErr)
          onClose()
          return
        }
        setPendingSummary(summary)
        setShowPostPrompt(true)
      } else {
        onClose()
      }
    } catch (err) {
      console.error('Error saving boycott:', err)
      setError('Failed to save changes. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePostUpdate = async () => {
    if (isPosting) return
    setIsPosting(true)
    try {
      await createPost.mutateAsync({
        content: postCaption.trim() || pendingSummary,
        postType: 'boycott_share',
        boycottId: boycott.id,
      })
      onClose()
    } catch (err) {
      console.error('Failed to post update:', err)
      setError('Failed to post. Please try again.')
    } finally {
      setIsPosting(false)
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={
        showPostPrompt
          ? onClose
          : showCompanySearch
            ? () => {
                setShowCompanySearch(false)
                setSearchResults([])
              }
            : onClose
      }
      title={
        showPostPrompt ? 'Share update' : showCompanySearch ? 'Add Company' : `Edit ${typeLabel}`
      }
    >
      {showPostPrompt ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div
            style={{
              padding: 'var(--space-3)',
              background: 'var(--bg-dark)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <p
              style={{
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: 'var(--space-2)',
              }}
            >
              Followers will see
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              {pendingSummary}
            </p>
          </div>

          <div>
            <label
              className='form-label'
              htmlFor='edit-boycott-post-caption'
              style={{ marginBottom: 'var(--space-2)' }}
            >
              Add a note (optional)
            </label>
            <textarea
              id='edit-boycott-post-caption'
              className='input-field'
              value={postCaption}
              onChange={e => setPostCaption(e.target.value.slice(0, 300))}
              placeholder='Why this change?'
              rows={3}
              style={{ resize: 'vertical' }}
            />
            <p
              style={{
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
                marginTop: 'var(--space-1)',
              }}
            >
              {postCaption.length} / 300
            </p>
          </div>

          {error && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger)',
                padding: 'var(--space-3)',
                color: 'var(--danger)',
                fontSize: 'var(--text-base)',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type='button'
              onClick={onClose}
              disabled={isPosting}
              style={{
                flex: 1,
                padding: 'var(--space-3)',
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-base)',
                cursor: isPosting ? 'not-allowed' : 'pointer',
              }}
            >
              Skip
            </button>
            <button
              type='button'
              onClick={handlePostUpdate}
              disabled={isPosting}
              style={{
                flex: 1,
                padding: 'var(--space-3)',
                background: 'var(--gradient-accent)',
                border: 'none',
                color: 'var(--text-on-accent)',
                fontSize: 'var(--text-base)',
                fontWeight: 'var(--font-medium)',
                cursor: isPosting ? 'not-allowed' : 'pointer',
              }}
            >
              {isPosting ? 'Posting...' : 'Post'}
            </button>
          </div>
        </div>
      ) : showCompanySearch ? (
        <div>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className='form-label' htmlFor='edit-company-search'>
              Search Companies
            </label>
            <input
              id='edit-company-search'
              type='text'
              className='input-field'
              placeholder='Start typing to search...'
              value={companyQuery}
              onChange={e => setCompanyQuery(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          {/* Connection types for new company */}
          <div
            style={{
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-3)',
              background: 'var(--bg-dark)',
              border: '1px solid var(--border)',
            }}
          >
            <p
              style={{
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: 'var(--space-3)',
              }}
            >
              Also block these connections:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label className='checkbox-item'>
                <input
                  type='checkbox'
                  checked={newCompanyConnectionTypes.owns}
                  onChange={e =>
                    setNewCompanyConnectionTypes({
                      ...newCompanyConnectionTypes,
                      owns: e.target.checked,
                    })
                  }
                />
                <span className='checkbox-box'></span>
                <span className='checkbox-label'>Subsidiaries</span>
              </label>
              <label className='checkbox-item'>
                <input
                  type='checkbox'
                  checked={newCompanyConnectionTypes.owned_by}
                  onChange={e =>
                    setNewCompanyConnectionTypes({
                      ...newCompanyConnectionTypes,
                      owned_by: e.target.checked,
                    })
                  }
                />
                <span className='checkbox-box'></span>
                <span className='checkbox-label'>Parent companies</span>
              </label>
              <label className='checkbox-item'>
                <input
                  type='checkbox'
                  checked={newCompanyConnectionTypes.suppliers}
                  onChange={e =>
                    setNewCompanyConnectionTypes({
                      ...newCompanyConnectionTypes,
                      suppliers: e.target.checked,
                    })
                  }
                />
                <span className='checkbox-box'></span>
                <span className='checkbox-label'>Suppliers</span>
              </label>
              <label className='checkbox-item'>
                <input
                  type='checkbox'
                  checked={newCompanyConnectionTypes.brands}
                  onChange={e =>
                    setNewCompanyConnectionTypes({
                      ...newCompanyConnectionTypes,
                      brands: e.target.checked,
                    })
                  }
                />
                <span className='checkbox-box'></span>
                <span className='checkbox-label'>Brands</span>
              </label>
              <label className='checkbox-item'>
                <input
                  type='checkbox'
                  checked={newCompanyConnectionTypes.customers}
                  onChange={e =>
                    setNewCompanyConnectionTypes({
                      ...newCompanyConnectionTypes,
                      customers: e.target.checked,
                    })
                  }
                />
                <span className='checkbox-box'></span>
                <span className='checkbox-label'>Customers</span>
              </label>
            </div>
          </div>

          {isSearching && (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
              <div className='spinner'></div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {searchResults.map(company => (
                <div
                  key={company.id}
                  style={{
                    background: 'var(--bg-dark)',
                    border: '1px solid var(--border)',
                    padding: 'var(--space-3)',
                    marginBottom: 'var(--space-2)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2-5)',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Avatar
                      src={company.logo_url}
                      name={company.name}
                      size='md'
                      variant='company'
                      style={{ borderRadius: 'var(--radius-sm)' }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <span
                        style={{
                          fontWeight: 'var(--font-medium)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {company.name}
                        {company.sanctioned && (
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--danger, #ef4444)',
                              fontWeight: 'var(--font-semibold)',
                              marginLeft: 'var(--space-1-5)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            Sanctioned
                          </span>
                        )}
                      </span>
                      {(company.industry || company.country) && (
                        <p
                          style={{
                            fontSize: 'var(--text-xs2)',
                            color: 'var(--text-muted)',
                            marginTop: 'var(--space-0-5)',
                          }}
                        >
                          {[company.industry, company.country].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type='button'
                    className='btn-follow'
                    onClick={() => handleAddCompany(company)}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}

          {searchResults.length === 0 && companyQuery && !isSearching && (
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--text-md)',
                textAlign: 'center',
                padding: 'var(--space-5)',
              }}
            >
              No companies found matching "{companyQuery}"
            </p>
          )}

          <button
            type='button'
            onClick={() => {
              setShowCompanySearch(false)
              setSearchResults([])
              setCompanyQuery('')
            }}
            style={{
              width: '100%',
              background: 'transparent',
              border: '1px solid var(--border)',
              padding: 'var(--space-3-5)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-base)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              cursor: 'pointer',
              marginTop: 'var(--space-4)',
            }}
          >
            ← Back
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <label className='form-label' htmlFor='edit-boycott-name'>
              Boycott Name
            </label>
            <input
              id='edit-boycott-name'
              type='text'
              className='input-field'
              placeholder='Enter boycott name...'
              value={name}
              onChange={e => setName(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 'var(--space-5)' }}>
            <label className='form-label' htmlFor='edit-boycott-desc'>
              Description
            </label>
            <textarea
              id='edit-boycott-desc'
              className='input-field'
              placeholder='Why are you creating this boycott?'
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Sources / Links */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <label className='form-label' htmlFor='edit-boycott-source-link'>
              Sources / Links
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <input
                id='edit-boycott-source-link'
                type='url'
                className='input-field'
                placeholder='https://...'
                value={newLink}
                onChange={e => setNewLink(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddLink()
                  }
                }}
                style={{ flex: 1 }}
              />
              <button
                type='button'
                onClick={handleAddLink}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  padding: 'var(--space-2) var(--space-3-5)',
                  color: 'var(--accent)',
                  fontSize: 'var(--text-base)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  minHeight: '44px',
                }}
              >
                + Add
              </button>
            </div>
            {sourceLinks.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-1)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                {sourceLinks.map(url => (
                  <div
                    key={url}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      background: 'var(--bg-dark)',
                      border: '1px solid var(--border)',
                      padding: 'var(--space-1-5) var(--space-3)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--accent)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {(() => {
                        try {
                          const u = new URL(url)
                          return u.hostname + (u.pathname !== '/' ? u.pathname : '')
                        } catch {
                          return url
                        }
                      })()}
                    </span>
                    <button
                      type='button'
                      onClick={() => handleRemoveLink(url)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: 'var(--text-xl)',
                        cursor: 'pointer',
                        padding: '0 var(--space-1)',
                        flexShrink: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p
              style={{
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
              }}
            >
              Add news articles, reports, or other sources supporting this{' '}
              {isPublic ? 'boycott' : 'blacklist'}
            </p>
          </div>

          {/* Visibility Toggle */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <span className='form-label'>Visibility</span>
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
              }}
            >
              <button
                type='button'
                onClick={() => setIsPublic(true)}
                style={{
                  flex: 1,
                  background: isPublic ? 'var(--accent)' : 'transparent',
                  border: '1px solid var(--border)',
                  padding: 'var(--space-3)',
                  minHeight: '44px',
                  color: isPublic ? '#fff' : 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                Boycott (Public)
              </button>
              <button
                type='button'
                onClick={() => setIsPublic(false)}
                style={{
                  flex: 1,
                  background: !isPublic ? 'var(--accent)' : 'transparent',
                  border: '1px solid var(--border)',
                  padding: 'var(--space-3)',
                  minHeight: '44px',
                  color: !isPublic ? '#fff' : 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                Blacklist (Private)
              </button>
            </div>
            <p
              style={{
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
                marginTop: 'var(--space-2)',
              }}
            >
              {isPublic
                ? 'Others can discover and follow this boycott'
                : 'A personal blacklist only you can see'}
            </p>
          </div>

          {/* Mode Toggle - visual builder hidden for now */}

          {/* Companies Section */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'var(--space-3)',
              }}
            >
              <label className='form-label' style={{ margin: 0 }}>
                Companies ({companies.length})
              </label>
              <button
                type='button'
                onClick={() => setShowCompanySearch(true)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--accent)',
                  padding: 'var(--space-2) var(--space-3-5)',
                  minHeight: '44px',
                  color: 'var(--accent)',
                  fontSize: 'var(--text-xs2)',
                  cursor: 'pointer',
                }}
              >
                + Add
              </button>
            </div>

            {companies.length === 0 ? (
              <div
                style={{
                  background: 'var(--bg-dark)',
                  border: '1px dashed var(--border)',
                  padding: 'var(--space-6)',
                  textAlign: 'center',
                }}
              >
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)' }}>
                  No companies added yet
                </p>
                <button
                  type='button'
                  onClick={() => setShowCompanySearch(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: 'var(--text-base)',
                    cursor: 'pointer',
                    marginTop: 'var(--space-2)',
                    minHeight: '44px',
                  }}
                >
                  + Add a company
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                {companies.map(company => (
                  <div
                    key={company.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Seed header */}
                    <div
                      style={{
                        padding: 'var(--space-2-5) var(--space-3-5)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: '1px solid var(--border)',
                        background: 'rgba(255, 61, 0, 0.05)',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)' }}
                      >
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: 'var(--accent)',
                          }}
                        />
                        <span
                          style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-md)' }}
                        >
                          {company.name}
                        </span>
                        <span
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--accent)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          SEED
                        </span>
                      </div>
                      <button
                        type='button'
                        onClick={() => handleRemoveCompany(company.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: 'var(--text-xl)',
                          cursor: 'pointer',
                          padding: 'var(--space-1) var(--space-2)',
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {/* Block settings */}
                    <div style={{ padding: 'var(--space-3) var(--space-3-5)' }}>
                      <p
                        style={{
                          fontSize: 'var(--text-xs2)',
                          color: 'var(--text-muted)',
                          marginBottom: 'var(--space-2-5)',
                        }}
                      >
                        Also block connections:
                      </p>
                      <div
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
                      >
                        {[
                          { field: 'block_owns', label: 'Subsidiaries', color: '#22c55e' },
                          { field: 'block_owned_by', label: 'Parents', color: '#3b82f6' },
                          { field: 'block_brands', label: 'Brands', color: '#a855f7' },
                          { field: 'block_suppliers', label: 'Suppliers', color: '#f59e0b' },
                          { field: 'block_customers', label: 'Customers', color: '#06b6d4' },
                        ].map(opt => (
                          <label
                            key={opt.field}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--space-2)',
                              fontSize: 'var(--text-base)',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type='checkbox'
                              checked={company[opt.field]}
                              onChange={() => handleToggleConnection(company.id, opt.field)}
                              style={{ accentColor: 'var(--accent)' }}
                            />
                            <span style={{ color: opt.color }}>●</span>
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <UserClaimedCompaniesPanel boycottId={boycott.id} canEdit />

          {error && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger)',
                padding: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
                color: 'var(--danger)',
                fontSize: 'var(--text-base)',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <button
              type='button'
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              style={{
                width: '100%',
                background:
                  isSaving || !name.trim() ? 'var(--text-muted)' : 'var(--gradient-accent)',
                border: 'none',
                padding: 'var(--space-4)',
                color: 'white',
                fontSize: 'var(--text-md)',
                fontWeight: 'var(--font-medium)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: isSaving || !name.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {isSaving ? 'Saving...' : `Save ${typeLabel}`}
            </button>

            {/* Delete Section */}
            {showDeleteConfirm ? (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--danger)',
                  padding: 'var(--space-4)',
                }}
              >
                <p
                  style={{
                    fontSize: 'var(--text-base)',
                    marginBottom: 'var(--space-3)',
                    color: 'var(--danger)',
                  }}
                >
                  Are you sure you want to delete this boycott? This cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type='button'
                    onClick={() => setShowDeleteConfirm(false)}
                    style={{
                      flex: 1,
                      padding: 'var(--space-3)',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--text-base)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    onClick={handleConfirmDelete}
                    style={{
                      flex: 1,
                      padding: 'var(--space-3)',
                      background: 'var(--danger)',
                      border: 'none',
                      color: 'white',
                      fontSize: 'var(--text-base)',
                      fontWeight: 'var(--font-medium)',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                type='button'
                onClick={() => setShowDeleteConfirm(true)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '1px solid var(--danger)',
                  padding: 'var(--space-3-5)',
                  color: 'var(--danger)',
                  fontSize: 'var(--text-base)',
                  cursor: 'pointer',
                }}
              >
                Delete Boycott
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
