/**
 * @component CreateBoycottModal
 * @level Organism
 * @interactions
 *   - Modal dialog for creating a new boycott with name, description, visibility
 *   - Includes company search with debounced query and per-company connection-type toggles
 *   - Consumes AppContext for createBoycott, addCompanyToBoycott, searchCompanies
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useApp } from '../../../context/AppContext'
import { triggerBoycottOgRegeneration } from '../../../lib/ogImage'
import { normalizeSourceLink } from '../../../lib/sourceLink'
import { isNeo4jId } from '../../../services/neo4jGraph'
// import BoycottBuilderV2 from './BoycottBuilderV2' // Visual builder hidden for now
import Avatar from '../../atoms/Avatar'
import Modal from '../../molecules/Modal'

export default function CreateBoycottModal({ onClose, initialCompany }) {
  const navigate = useNavigate()
  const {
    createBoycott,
    addCompanyToBoycott,
    fetchMyBoycotts,
    searchCompanies,
    getCompanyWithConnections,
  } = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)

  // Builder mode: 'simple' or 'visual' — visual builder hidden for now
  // const [builderMode, setBuilderMode] = useState('simple')

  // Company search state
  const [showCompanySearch, setShowCompanySearch] = useState(false)
  const [companyQuery, setCompanyQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedCompanies, setSelectedCompanies] = useState(() => {
    if (!initialCompany) return []
    return [
      {
        company: initialCompany,
        blockOwns: false,
        blockOwnedBy: false,
        blockSuppliers: false,
        blockBrands: false,
        blockCustomers: false,
      },
    ]
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const hasSubmittedRef = useRef(false) // Prevent double-submit
  const [sourceLinks, setSourceLinks] = useState([])
  const [newLink, setNewLink] = useState('')
  const typeLabel = isPublic ? 'Boycott' : 'Blacklist'

  const handleSubmit = async e => {
    e.preventDefault()
    if (!name.trim() || isSubmitting || hasSubmittedRef.current) return

    hasSubmittedRef.current = true // Lock immediately
    setIsSubmitting(true)
    setError('')

    let boycott = null

    try {
      // Create the boycott with chosen visibility
      boycott = await createBoycott(name.trim(), description.trim(), isPublic, sourceLinks)
    } catch (err) {
      console.error('Error creating boycott:', err)
      // Detect "duplicate name" — either the raw Postgres unique-violation
      // message or the user-facing wrapper AppContext.createBoycott throws.
      const errorMsg = err?.message || String(err)
      const isDuplicate =
        errorMsg.includes('duplicate') ||
        errorMsg.includes('unique') ||
        errorMsg.includes('already exists') ||
        errorMsg.includes('already have a boycott')
      if (isDuplicate) {
        setError(
          `You already have a boycott named "${name.trim()}". Please choose a different name.`
        )
      } else {
        setError('Failed to create boycott. Please try again.')
      }
      setIsSubmitting(false)
      hasSubmittedRef.current = false // Unlock on error so user can retry
      return
    }

    // createBoycott returns a JSON object with the full boycott data
    const boycottId = boycott?.id

    // Validate that boycott was actually created
    if (!boycottId) {
      console.error('Boycott creation returned invalid data:', boycott)
      setError('Failed to create boycott - no ID returned. Please try again.')
      setIsSubmitting(false)
      hasSubmittedRef.current = false
      return
    }

    if (selectedCompanies.length > 0) {
      // Add selected companies to the boycott
      const failedCompanies = []

      for (const entry of selectedCompanies) {
        const company = entry.company
        // Validate company has required data
        if (!company?.id) {
          console.error('Company missing ID:', company)
          failedCompanies.push({
            name: company?.name || 'Unknown Company',
            error: 'Company data missing ID',
          })
          continue
        }

        try {
          await addCompanyToBoycott(
            boycottId,
            company.id,
            entry.blockOwns,
            entry.blockOwnedBy,
            entry.blockSuppliers,
            company.name,
            company.logo_url || null,
            entry.blockBrands,
            entry.blockCustomers,
            { skipRefresh: true }
          )
        } catch (err) {
          console.error(`Error adding company ${company.name || company.id}:`, err)
          failedCompanies.push({
            name: company.name || 'Unknown Company',
            error: err.message || String(err),
          })
        }
      }

      // If any companies failed to add, show error and don't close
      if (failedCompanies.length > 0) {
        const companyList = failedCompanies.map(f => f.name).join(', ')
        const errorDetails = failedCompanies[0].error
        setError(
          `Failed to add ${failedCompanies.length} company(ies): ${companyList}. Error: ${errorDetails}`
        )
        setIsSubmitting(false)
        hasSubmittedRef.current = false // Unlock so user can try again
        return
      }
    }

    // Final refresh so the boycott list shows correct company count
    await fetchMyBoycotts()

    // Fire-and-forget OG image generation. Only public boycotts get an image;
    // the edge function rejects private ones on the server.
    if (isPublic) {
      triggerBoycottOgRegeneration(boycottId)
    }

    setIsSubmitting(false)
    onClose()
    // Navigate to the new boycott's detail page so the user can immediately
    // add custom companies / connections / sources via the panel that lives there.
    navigate(`/boycott/${boycottId}`)
  }

  // Debounced search as user types
  useEffect(() => {
    if (!companyQuery.trim() || companyQuery.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const results = await searchCompanies(companyQuery)
        setSearchResults(results)
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        setIsSearching(false)
      }
    }, 300) // 300ms debounce

    return () => clearTimeout(timer)
  }, [companyQuery, searchCompanies])

  const handleAddCompany = async company => {
    if (!company?.id) {
      console.error('Cannot add company without ID:', company)
      return
    }

    // Get company with connections for display (only if valid Neo4j ID)
    let companyWithConnections = null
    if (isNeo4jId(company.id)) {
      try {
        companyWithConnections = await getCompanyWithConnections(company.id)
      } catch (err) {
        console.error('Error fetching company connections:', err)
        // Continue with original company data
      }
    }

    const companyToAdd = companyWithConnections || company

    if (!selectedCompanies.some(c => c.company?.id === company.id || c.id === company.id)) {
      // Add company with per-company connection type settings
      setSelectedCompanies(prev => [
        ...prev,
        {
          company: companyToAdd,
          blockOwns: true, // Default: block subsidiaries
          blockOwnedBy: false,
          blockBrands: true, // Default: block brands
          blockSuppliers: false,
          blockCustomers: false,
        },
      ])
    }
    setShowCompanySearch(false)
    setCompanyQuery('')
    setSearchResults([])
  }

  const removeCompany = companyId => {
    setSelectedCompanies(selectedCompanies.filter(c => c.company?.id !== companyId))
  }

  const updateCompanyBlockSettings = (companyId, field, value) => {
    setSelectedCompanies(prev =>
      prev.map(c => (c.company?.id === companyId ? { ...c, [field]: value } : c))
    )
  }

  const getConnectionCount = (company, type) => {
    if (!company.connections) return 0
    switch (type) {
      case 'owns':
        return company.connections.owns?.length || 0
      case 'owned_by':
        return company.connections.owned_by?.length || 0
      case 'brands':
        return company.connections.brands?.length || 0
      case 'supplier':
        return company.connections.suppliers?.length || 0
      case 'customers':
        return company.connections.customers?.length || 0
      default:
        return 0
    }
  }

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

  // Visual Builder Mode - disabled for now, keeping code for future use
  // if (builderMode === 'visual') { ... }

  return (
    <Modal
      isOpen={true}
      onClose={
        showCompanySearch
          ? () => {
              setShowCompanySearch(false)
              setSearchResults([])
            }
          : onClose
      }
      title={showCompanySearch ? 'Search Company' : `New ${typeLabel}`}
    >
      {showCompanySearch ? (
        <div>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className='form-label' htmlFor='create-company-search'>
              Search Companies
            </label>
            <input
              id='create-company-search'
              type='text'
              className='input-field'
              placeholder='Start typing to search...'
              value={companyQuery}
              onChange={e => setCompanyQuery(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <p
              style={{
                fontSize: 'var(--text-xs2)',
                color: 'var(--text-muted)',
                marginTop: 'var(--space-2)',
              }}
            >
              {isSearching ? 'Searching...' : 'Search 65,000+ companies in our database'}
            </p>
          </div>

          {isSearching && (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
              <div className='spinner'></div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {searchResults.map(company => (
                <div
                  key={company.id}
                  style={{
                    background: 'var(--bg-dark)',
                    border: '1px solid var(--border)',
                    padding: 'var(--space-4)',
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
                      gap: 'var(--space-3)',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Avatar
                      src={company.logo_url}
                      name={company.name}
                      size='lg'
                      variant='company'
                      style={{ borderRadius: 'var(--radius-sm)', width: 36, height: 36 }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)' }}>
                        {company.name}
                        {company.type === 'brand' && (
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--text-muted)',
                              fontWeight: 'var(--font-normal)',
                              marginLeft: 'var(--space-1-5)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            Brand
                          </span>
                        )}
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
                      </h3>
                      <p
                        style={{
                          fontSize: 'var(--text-xs2)',
                          color: 'var(--text-muted)',
                          marginTop: 'var(--space-0-5)',
                        }}
                      >
                        {[
                          company.industry,
                          company.country,
                          company.owner_name && `Owned by ${company.owner_name}`,
                          company.hq_location &&
                            !company.country &&
                            !company.owner_name &&
                            company.hq_location,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {(company.subsidiary_count > 0 || company.brand_count > 0) && (
                        <div
                          style={{
                            display: 'flex',
                            gap: 'var(--space-2)',
                            marginTop: 'var(--space-1)',
                            flexWrap: 'wrap',
                          }}
                        >
                          {company.subsidiary_count > 0 && (
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                color: '#22c55e',
                                background: 'rgba(34, 197, 94, 0.1)',
                                padding: '1px var(--space-1-5)',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              {company.subsidiary_count} subsidiaries
                            </span>
                          )}
                          {company.brand_count > 0 && (
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                color: '#a855f7',
                                background: 'rgba(168, 85, 247, 0.1)',
                                padding: '1px var(--space-1-5)',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              {company.brand_count} brands
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type='button'
                    className='btn-follow'
                    onClick={() => handleAddCompany(company)}
                    disabled={selectedCompanies.some(
                      c => c.company?.id === company.id || c.id === company.id
                    )}
                  >
                    {selectedCompanies.some(
                      c => c.company?.id === company.id || c.id === company.id
                    )
                      ? 'Added'
                      : 'Add'}
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
            }}
            style={{
              width: '100%',
              background: 'transparent',
              border: '1px solid var(--border)',
              padding: 'var(--space-3-5)',
              color: 'var(--text-secondary)',
              fontFamily: "'Space Grotesk', sans-serif",
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
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label className='form-label' htmlFor='create-boycott-name'>
              Boycott Name
            </label>
            <input
              id='create-boycott-name'
              type='text'
              className='input-field'
              placeholder='Enter boycott name...'
              value={name}
              onChange={e => setName(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              required
            />
          </div>

          {/* Simple List Mode */}
          <div
            style={{
              background: 'var(--bg-dark)',
              border: '1px dashed var(--border)',
              padding: 'var(--space-5)',
              marginBottom: 'var(--space-6)',
            }}
          >
            <button
              type='button'
              onClick={() => setShowCompanySearch(true)}
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--border)',
                padding: 'var(--space-3-5)',
                color: 'var(--accent)',
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 'var(--text-base)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: 'pointer',
                marginBottom: selectedCompanies.length > 0 ? 'var(--space-4)' : '0',
              }}
            >
              + Add a Company / Organization
            </button>

            {/* Selected Seeds */}
            {selectedCompanies.length > 0 && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <p
                  style={{
                    fontSize: 'var(--text-xs2)',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  Seed Companies ({selectedCompanies.length})
                </p>
                {selectedCompanies.map(entry => {
                  const company = entry.company
                  const connectionOptions = [
                    { key: 'blockOwns', type: 'owns', label: 'Subsidiaries', color: '#22c55e' },
                    {
                      key: 'blockOwnedBy',
                      type: 'owned_by',
                      label: 'Parent companies',
                      color: '#3b82f6',
                    },
                    { key: 'blockBrands', type: 'brands', label: 'Brands', color: '#a855f7' },
                    {
                      key: 'blockSuppliers',
                      type: 'supplier',
                      label: 'Suppliers',
                      color: '#f59e0b',
                    },
                    {
                      key: 'blockCustomers',
                      type: 'customers',
                      label: 'Customers',
                      color: '#06b6d4',
                    },
                  ]

                  return (
                    <div
                      key={company.id}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: 'var(--space-3)',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Seed header */}
                      <div
                        style={{
                          padding: 'var(--space-3) var(--space-3-5)',
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
                          <Avatar
                            src={company.logo_url}
                            name={company.name}
                            size='sm'
                            variant='company'
                            style={{ borderRadius: 'var(--radius-sm)' }}
                          />
                          <span
                            style={{
                              fontWeight: 'var(--font-semibold)',
                              fontSize: 'var(--text-md)',
                            }}
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
                          style={{
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: 'var(--text-xl)',
                            background: 'none',
                            border: 'none',
                            padding: 'var(--space-1) var(--space-2)',
                          }}
                          onClick={() => removeCompany(company.id)}
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
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-2)',
                          }}
                        >
                          {connectionOptions.map(opt => {
                            const count = getConnectionCount(company, opt.type)
                            return (
                              <label
                                key={opt.key}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 'var(--space-2)',
                                  fontSize: 'var(--text-base)',
                                  cursor: 'pointer',
                                  opacity: count === 0 ? 0.5 : 1,
                                }}
                              >
                                <input
                                  type='checkbox'
                                  checked={entry[opt.key]}
                                  disabled={count === 0}
                                  onChange={e =>
                                    updateCompanyBlockSettings(
                                      company.id,
                                      opt.key,
                                      e.target.checked
                                    )
                                  }
                                  style={{ accentColor: 'var(--accent)' }}
                                />
                                <span style={{ color: opt.color }}>●</span>
                                {opt.label}
                                <span
                                  style={{
                                    color: 'var(--text-muted)',
                                    fontSize: 'var(--text-xs2)',
                                  }}
                                >
                                  ({count})
                                </span>
                              </label>
                            )
                          })}
                        </div>
                        {/* Enrichment badges */}
                        {(() => {
                          const donations = company.connections?.political_donations?.length || 0
                          const recallCount = company.recalls?.length || 0
                          const contractCount = company.government_contracts?.length || 0
                          if (donations === 0 && recallCount === 0 && contractCount === 0)
                            return null
                          return (
                            <div
                              style={{
                                display: 'flex',
                                gap: 'var(--space-1-5)',
                                marginTop: 'var(--space-2-5)',
                                flexWrap: 'wrap',
                              }}
                            >
                              {recallCount > 0 && (
                                <span
                                  style={{
                                    fontSize: 'var(--text-xs)',
                                    color: '#ef4444',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    padding: 'var(--space-0-5) var(--space-2)',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  {recallCount} recall{recallCount !== 1 ? 's' : ''}
                                </span>
                              )}
                              {donations > 0 && (
                                <span
                                  style={{
                                    fontSize: 'var(--text-xs)',
                                    color: '#a855f7',
                                    background: 'rgba(168, 85, 247, 0.1)',
                                    padding: 'var(--space-0-5) var(--space-2)',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  {donations} political donation{donations !== 1 ? 's' : ''}
                                </span>
                              )}
                              {contractCount > 0 && (
                                <span
                                  style={{
                                    fontSize: 'var(--text-xs)',
                                    color: '#3b82f6',
                                    background: 'rgba(59, 130, 246, 0.1)',
                                    padding: 'var(--space-0-5) var(--space-2)',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  {contractCount} gov contract
                                  {contractCount !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Visual Builder button - hidden for now */}
          </div>

          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label className='form-label' htmlFor='create-boycott-desc'>
              Description
            </label>
            <textarea
              id='create-boycott-desc'
              className='input-field'
              placeholder='Why are you creating this boycott?'
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Sources / Links */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label className='form-label' htmlFor='create-boycott-source-link'>
              Sources / Links
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <input
                id='create-boycott-source-link'
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
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <span className='form-label'>Visibility</span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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

          {error && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger)',
                padding: 'var(--space-3)',
                marginTop: 'var(--space-4)',
                color: 'var(--danger)',
                fontSize: 'var(--text-base)',
              }}
            >
              {error}
            </div>
          )}

          <p
            style={{
              fontSize: 'var(--text-xs2)',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-3)',
              padding: 'var(--space-2)',
              border: '1px dashed var(--border)',
              background: 'var(--bg-dark, rgba(0,0,0,0.04))',
            }}
          >
            After creating, you can add <strong>custom companies and connections</strong> that
            aren't in our database — with sources to back them up — from the boycott's detail page.
          </p>

          <button
            type='submit'
            disabled={isSubmitting || !name.trim()}
            style={{
              width: '100%',
              background: isSubmitting ? 'var(--text-muted)' : 'var(--gradient-accent)',
              border: 'none',
              padding: 'var(--space-4)',
              color: 'white',
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 'var(--text-2xl)',
              letterSpacing: '2px',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              marginTop: 'var(--space-6)',
            }}
          >
            {isSubmitting ? 'Creating...' : `Create ${typeLabel}`}
          </button>
        </form>
      )}
    </Modal>
  )
}
