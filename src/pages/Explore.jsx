import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import LazyImage from '../components/atoms/LazyImage'
import ModePillToggle from '../components/molecules/ModePillToggle'
import StatChipStrip from '../components/molecules/StatChipStrip'
import { BoycottList, EditBoycottModal } from '../components/organisms/boycott'
import ConfirmModal from '../components/organisms/ConfirmModal'
import Header from '../components/organisms/Header'
import { useToast } from '../components/organisms/Toast'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useProxyExpansion } from '../hooks/useProxyExpansion'
import { useUsersByFollowers } from '../hooks/useQueries'
import { glassInput } from '../lib/glassStyles'
import { supabase } from '../lib/supabase'
import { getStats, searchCompanies } from '../services/neo4jGraph'

// Search modes, deep-linkable via /explore?mode=users|connections|boycotts.
// 'connections' is the user-facing alias for the internal 'companies' mode.
const EXPLORE_MODES = ['boycotts', 'companies', 'users']
const MODE_ALIASES = { connections: 'companies' }

function modeFromParams(params) {
  const raw = params.get('mode')
  const mode = MODE_ALIASES[raw] || raw
  return EXPLORE_MODES.includes(mode) ? mode : 'boycotts'
}

export default function Explore() {
  const { user } = useAuth()
  const toast = useToast()
  // Use loadingState.publicBoycotts (the per-key map) so the spinner reflects
  // the public-boycotts fetch specifically, not the my/followed init bundle.
  // Earlier code read .loading (a boolean OR of initial+my+followed) which
  // never reflected the publicBoycotts fetch state.
  const { publicBoycotts, adoptBoycott, unadoptBoycott, hasAdoptedBoycott, loadingState } = useApp()
  const loading = loadingState.publicBoycotts
  // Mode lives in the URL so /explore?mode=users deep-links (e.g. from the
  // Feed empty state) and back/forward navigation restores the right tab.
  const [searchParams, setSearchParams] = useSearchParams()
  const searchMode = modeFromParams(searchParams)
  const [searchQuery, setSearchQuery] = useState('')
  const [userResults, setUserResults] = useState([])
  const [userSearchLoading, setUserSearchLoading] = useState(false)
  const [userSearchError, setUserSearchError] = useState(null)
  const [expandedBoycott, setExpandedBoycott] = useState(null)
  const [companyResults, setCompanyResults] = useState([])
  const [companySearchLoading, setCompanySearchLoading] = useState(false)
  const [dbStats, setDbStats] = useState(null)

  // Fetch DB stats on mount
  useEffect(() => {
    getStats().then(s => {
      if (s && s.Company) setDbStats(s)
    })
  }, [])

  // Search companies when query changes in companies mode
  useEffect(() => {
    if (searchMode !== 'companies' || !searchQuery.trim()) {
      setCompanyResults([])
      return
    }

    setCompanySearchLoading(true)
    const debounce = setTimeout(async () => {
      const results = await searchCompanies(searchQuery, 30)
      setCompanyResults(results)
      setCompanySearchLoading(false)
    }, 300)
    return () => {
      clearTimeout(debounce)
      setCompanySearchLoading(false)
    }
  }, [searchQuery, searchMode])

  // Proxy expansion hook
  const proxyExpansion = useProxyExpansion(publicBoycotts, { autoFetch: false })

  // Prefetch proxy data when boycott expands
  const prefetchRef = useRef(proxyExpansion.prefetchBoycottProxies)
  useEffect(() => {
    prefetchRef.current = proxyExpansion.prefetchBoycottProxies
  }, [proxyExpansion.prefetchBoycottProxies])
  useEffect(() => {
    if (!expandedBoycott) return
    const boycott = publicBoycotts.find(b => b.id === expandedBoycott)
    if (boycott) {
      prefetchRef.current(boycott)
    }
  }, [expandedBoycott, publicBoycotts])

  // Search for users when query changes
  useEffect(() => {
    if (searchMode !== 'users' || !searchQuery.trim()) {
      setUserResults([])
      return
    }

    const searchUsers = async () => {
      setUserSearchLoading(true)
      setUserSearchError(null)
      try {
        const { data, error } = await supabase.rpc('search_users', {
          p_query: searchQuery,
          p_limit: 20,
        })
        if (error) {
          setUserSearchError('Failed to search users. Please try again.')
          setUserResults([])
        } else {
          setUserResults(data || [])
        }
      } catch {
        setUserSearchError('An unexpected error occurred.')
        setUserResults([])
      } finally {
        setUserSearchLoading(false)
      }
    }

    const debounce = setTimeout(searchUsers, 300)
    return () => clearTimeout(debounce)
  }, [searchQuery, searchMode])

  // Filter and sort boycotts — most followed first
  const filteredBoycotts = useMemo(() => {
    let result = publicBoycotts
    if (searchMode === 'boycotts' && searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        boycott =>
          boycott.name.toLowerCase().includes(query) ||
          boycott.description?.toLowerCase().includes(query) ||
          boycott.profiles?.username?.toLowerCase().includes(query) ||
          boycott.boycott_companies?.some(bc => bc.companies?.name?.toLowerCase().includes(query))
      )
    }
    return [...result].sort((a, b) => (b.tracker_count || 0) - (a.tracker_count || 0))
  }, [publicBoycotts, searchQuery, searchMode])

  const handleFollowToggle = async (e, boycott) => {
    e.stopPropagation()
    if (!user) {
      toast.info('Please sign in to follow boycotts')
      return
    }

    try {
      if (hasAdoptedBoycott(boycott.id)) {
        await unadoptBoycott(boycott.id)
        toast.success('Unfollowed boycott')
      } else {
        await adoptBoycott(boycott.id)
        toast.success('Now following boycott')
      }
    } catch (error) {
      toast.error(error.message || 'Failed to update')
    }
  }

  const handleModeSwitch = mode => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev)
        if (mode === 'boycotts') {
          next.delete('mode')
        } else {
          next.set('mode', mode)
        }
        return next
      },
      { replace: true }
    )
    setSearchQuery('')
    setUserSearchError(null)
    setExpandedBoycott(null)
    proxyExpansion.closeExpanded()
  }

  return (
    <div className='container'>
      <Header pageLabel='Explore' />

      {/* DB Stats Banner */}
      <StatChipStrip
        chips={[
          { label: 'Companies', value: dbStats?.Company?.toLocaleString() || '—' },
          { label: 'Brands', value: dbStats?.Brand?.toLocaleString() || '—' },
          { label: 'Products', value: dbStats?.Product?.toLocaleString() || '—' },
          { label: 'People', value: dbStats?.Person?.toLocaleString() || '—' },
        ]}
        loading={!dbStats}
        style={{ marginBottom: 'var(--space-4)' }}
      />

      {/* Mode Toggle */}
      <ModePillToggle
        options={[
          { key: 'boycotts', label: 'Boycotts' },
          { key: 'companies', label: 'Connections' },
          { key: 'users', label: 'People' },
        ]}
        activeKey={searchMode}
        onChange={handleModeSwitch}
        style={{ marginBottom: 'var(--space-3)' }}
      />

      {/* Search Input */}
      <div className='search-container' style={{ marginBottom: 'var(--space-6)' }}>
        <span className='search-icon'>&#8981;</span>
        <input
          type='text'
          className='search-input'
          placeholder={
            searchMode === 'boycotts'
              ? 'Search boycotts...'
              : searchMode === 'companies'
                ? 'Search 65K+ companies...'
                : 'Search users...'
          }
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            ...glassInput,
          }}
        />
      </div>

      {searchMode === 'companies' ? (
        <CompanySearchResults
          searchQuery={searchQuery}
          companyResults={companyResults}
          companySearchLoading={companySearchLoading}
        />
      ) : searchMode === 'users' ? (
        <UserSearchResults
          searchQuery={searchQuery}
          userResults={userResults}
          userSearchLoading={userSearchLoading}
          userSearchError={userSearchError}
        />
      ) : (
        <BoycottSearchResults
          searchQuery={searchQuery}
          filteredBoycotts={filteredBoycotts}
          loading={loading}
          expandedBoycott={expandedBoycott}
          setExpandedBoycott={setExpandedBoycott}
          handleFollowToggle={handleFollowToggle}
          hasAdoptedBoycott={hasAdoptedBoycott}
          proxyExpansion={proxyExpansion}
          user={user}
        />
      )}
    </div>
  )
}

/**
 * User search results section
 */
function UserSearchResults({ searchQuery, userResults, userSearchLoading, userSearchError }) {
  // With no query, browse the most-followed users instead of a dead end.
  const defaultUsers = useUsersByFollowers(20)
  const displayUsers = searchQuery ? userResults : defaultUsers.data || []
  const isLoading = searchQuery ? userSearchLoading : defaultUsers.isLoading

  return (
    <div style={{ marginBottom: '100px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div className='eyebrow'>
          {searchQuery ? (
            <>
              Results for "<span style={{ color: 'var(--accent)' }}>{searchQuery}</span>"
            </>
          ) : (
            <>Popular Users</>
          )}
        </div>
      </div>

      {userSearchError && (
        <div
          style={{
            background: 'rgba(251, 113, 133, 0.1)',
            border: '1px solid var(--danger)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            color: 'var(--danger)',
            fontSize: 'var(--text-base)',
          }}
        >
          {userSearchError}
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <div className='spinner'></div>
        </div>
      ) : displayUsers.length === 0 && !userSearchError ? (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-md)',
            textAlign: 'center',
            padding: 'var(--space-8)',
          }}
        >
          {searchQuery ? `No users found matching "${searchQuery}"` : 'No users to show yet'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {displayUsers.map((profile, idx) => (
            <Link
              key={profile.id}
              to={`/user/${profile.id}`}
              className='card card-clickable animate-fade-in-up'
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                textDecoration: 'none',
                color: 'inherit',
                animationDelay: `${Math.min(idx, 9) * 0.05}s`,
              }}
            >
              <LazyImage
                src={profile.profile_picture_url}
                alt={profile.username || 'User'}
                style={{
                  width: '48px',
                  height: '48px',
                  objectFit: 'cover',
                  border: '1px solid var(--border)',
                  flexShrink: 0,
                }}
                fallback={
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      background: 'var(--bg-dark)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--text-xl)',
                      fontWeight: 'var(--font-semibold)',
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {(profile.display_name || profile.username)?.charAt(0).toUpperCase() || '?'}
                  </div>
                }
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'var(--font-medium)', fontSize: '15px' }}>
                  {profile.display_name || profile.username}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                  @{profile.username}
                  {profile.follower_count > 0 && (
                    <span style={{ marginLeft: 'var(--space-2)', color: 'var(--accent)' }}>
                      {profile.follower_count}{' '}
                      {profile.follower_count === 1 ? 'follower' : 'followers'}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Company search results from Neo4j knowledge graph
 */
function CompanySearchResults({ searchQuery, companyResults, companySearchLoading }) {
  return (
    <div style={{ marginBottom: '100px' }}>
      {!searchQuery && (
        <div
          style={{
            textAlign: 'center',
            padding: 'var(--space-12) var(--space-6)',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-md)',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              margin: '0 auto var(--space-3)',
              borderRadius: 'var(--radius-full)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-3xl)',
              color: 'var(--accent)',
            }}
          >
            &#8981;
          </div>
          Search our database of 65,000+ companies to explore corporate ownership, brands, and
          connections.
        </div>
      )}

      {searchQuery && (
        <div className='eyebrow' style={{ marginBottom: 'var(--space-3)' }}>
          Results for "<span style={{ color: 'var(--accent)' }}>{searchQuery}</span>"
          {!companySearchLoading && ` (${companyResults.length})`}
        </div>
      )}

      {companySearchLoading && (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <div className='spinner'></div>
        </div>
      )}

      {searchQuery && !companySearchLoading && companyResults.length === 0 && (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-md)',
            textAlign: 'center',
            padding: 'var(--space-8)',
          }}
        >
          No companies found matching &ldquo;{searchQuery}&rdquo;
        </p>
      )}

      {companyResults.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {companyResults.map((company, idx) => (
            <Link
              key={company.id}
              to={`/company/${company.id}`}
              className='card card-clickable animate-fade-in-up'
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                textDecoration: 'none',
                color: 'inherit',
                animationDelay: `${Math.min(idx, 9) * 0.05}s`,
              }}
            >
              {company.logo_url ? (
                <LazyImage
                  src={company.logo_url}
                  alt={company.name}
                  style={{
                    width: '44px',
                    height: '44px',
                    objectFit: 'contain',
                    background: 'white',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    padding: 'var(--space-1)',
                    flexShrink: 0,
                  }}
                  fallback={<CompanyInitial name={company.name} />}
                />
              ) : (
                <CompanyInitial name={company.name} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 'var(--font-medium)',
                    fontSize: '15px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {company.name}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: 'var(--space-2-5)',
                    flexWrap: 'wrap',
                  }}
                >
                  {company.country && <span>{company.country}</span>}
                  {company.industry && (
                    <span style={{ color: 'var(--text-secondary)' }}>{company.industry}</span>
                  )}
                  {company.brand_count > 0 && (
                    <span>
                      {company.brand_count} brand{company.brand_count !== 1 ? 's' : ''}
                    </span>
                  )}
                  {company.subsidiary_count > 0 && (
                    <span>
                      {company.subsidiary_count}{' '}
                      {company.subsidiary_count !== 1 ? 'subsidiaries' : 'subsidiary'}
                    </span>
                  )}
                </div>
              </div>
              {company.sanctioned && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--font-semibold)',
                    letterSpacing: 'var(--tracking-wide)',
                    color: 'var(--danger)',
                    background: 'rgba(251, 113, 133, 0.1)',
                    padding: 'var(--space-0-5) var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    flexShrink: 0,
                  }}
                  title={`On the US Treasury (OFAC) ${(company.sanction_lists || ['SDN']).join(' and ')} list${(company.sanction_programs || []).length ? `: ${company.sanction_programs.join(', ')}` : ''}`}
                >
                  OFAC SANCTIONED
                </span>
              )}
              <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function CompanyInitial({ name }) {
  return (
    <div
      style={{
        width: '44px',
        height: '44px',
        background: 'var(--accent)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-heading)',
        fontSize: 'var(--text-xl)',
        fontWeight: 'var(--font-bold)',
        color: 'var(--text-on-accent, #fff)',
        flexShrink: 0,
      }}
    >
      {name?.charAt(0).toUpperCase() || '?'}
    </div>
  )
}

/**
 * Boycott search results section
 */
function BoycottSearchResults({
  searchQuery,
  filteredBoycotts,
  loading,
  expandedBoycott,
  setExpandedBoycott,
  handleFollowToggle,
  hasAdoptedBoycott,
  proxyExpansion,
  user,
}) {
  const toast = useToast()
  const { deleteBoycott } = useApp()
  const [editingBoycott, setEditingBoycott] = useState(null)
  const [deletingBoycottId, setDeletingBoycottId] = useState(null)

  const handleEdit = (e, boycott) => {
    e.stopPropagation()
    setEditingBoycott(boycott)
  }
  const handleDelete = (e, boycottId) => {
    e.stopPropagation()
    setDeletingBoycottId(boycottId)
  }
  const confirmDelete = async () => {
    if (!deletingBoycottId) return
    try {
      await deleteBoycott(deletingBoycottId)
      toast.success('Boycott deleted')
      setExpandedBoycott(null)
    } catch (err) {
      toast.error('Failed to delete boycott')
      console.error(err)
    } finally {
      setDeletingBoycottId(null)
    }
  }

  return (
    <div style={{ marginBottom: '100px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div className='eyebrow'>
          {searchQuery ? (
            <>
              Results for "<span style={{ color: 'var(--accent)' }}>{searchQuery}</span>" (
              {filteredBoycotts.length})
            </>
          ) : (
            <>Explore Boycotts ({filteredBoycotts.length})</>
          )}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--text-faint, var(--text-muted))',
          }}
        >
          Most followed first
        </div>
      </div>

      {loading && !filteredBoycotts.length ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <div className='spinner'></div>
        </div>
      ) : (
        <section>
          <BoycottList
            boycotts={filteredBoycotts}
            variant='public'
            expandedId={expandedBoycott}
            onToggleExpand={id => setExpandedBoycott(expandedBoycott === id ? null : id)}
            onFollowToggle={handleFollowToggle}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isFollowingFn={hasAdoptedBoycott}
            currentUserId={user?.id}
            proxyExpansion={proxyExpansion}
            isLoadingFn={id => proxyExpansion.isBoycottLoading(id)}
            proxyCountFn={boycott => proxyExpansion.countTotalProxyForBoycott(boycott)}
            showCreator={true}
            emptyMessage={
              searchQuery
                ? `No boycotts found matching "${searchQuery}"`
                : 'No public boycotts available.'
            }
          />
          {editingBoycott && (
            <EditBoycottModal boycott={editingBoycott} onClose={() => setEditingBoycott(null)} />
          )}
          {deletingBoycottId && (
            <ConfirmModal
              isOpen={true}
              title='Delete boycott?'
              message='This cannot be undone.'
              confirmText='Delete'
              danger
              onConfirm={confirmDelete}
              onClose={() => setDeletingBoycottId(null)}
            />
          )}
        </section>
      )}
    </div>
  )
}
