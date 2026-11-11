import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useSafeState } from '../hooks/useSafeState'
import { trackEvent } from '../lib/analytics'
import { supabase } from '../lib/supabase'
import {
  getCompanyWithConnections as neo4jGetCompany,
  searchCompanies as neo4jSearchCompanies,
} from '../services/neo4jGraph'
import { useAuth } from './AuthContext'

const AppContext = createContext(null)

// Connection types that can be blocked
export const CONNECTION_TYPES = {
  owns: { id: 'owns', label: 'Subsidiaries', description: 'Companies they own', color: '#22c55e' },
  owned_by: {
    id: 'owned_by',
    label: 'Parent companies',
    description: 'Companies that own them',
    color: '#3b82f6',
  },
  brands: { id: 'brands', label: 'Brands', description: 'Brands they own', color: '#a855f7' },
  supplier: {
    id: 'supplier',
    label: 'Suppliers',
    description: 'Companies that supply them',
    color: '#f59e0b',
  },
  customers: {
    id: 'customers',
    label: 'Customers',
    description: 'Companies they supply to',
    color: '#06b6d4',
  },
}

// Loading states for granular feedback
const INITIAL_LOADING_STATE = {
  myBoycotts: false,
  followedBoycotts: false,
  publicBoycotts: false,
  following: false,
  initial: true,
}

export function AppProvider({ children }) {
  const { user } = useAuth()
  const abortControllerRef = useRef(null)
  const { safeSetState, isMountedRef } = useSafeState()

  // State
  const [myBoycotts, setMyBoycotts] = useState([])
  const [followedBoycotts, setFollowedBoycotts] = useState([])
  const [publicBoycotts, setPublicBoycotts] = useState([])
  const [following, setFollowing] = useState([])
  const [loadingState, setLoadingState] = useState(INITIAL_LOADING_STATE)
  const [error, setError] = useState(null)

  // Helper to set loading for a specific key
  const setLoadingFor = useCallback(
    (key, value) => {
      safeSetState(setLoadingState, prev => ({ ...prev, [key]: value }))
    },
    [safeSetState]
  )

  // Clear error after timeout
  const errorTimerRef = useRef(null)
  const clearErrorAfterDelay = useCallback(
    (delay = 5000) => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
      errorTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setError(null)
        }
        errorTimerRef.current = null
      }, delay)
    },
    [isMountedRef]
  )

  // Fetch user's own boycotts
  const fetchMyBoycotts = useCallback(
    async signal => {
      if (!user) {
        safeSetState(setMyBoycotts, [])
        return []
      }

      setLoadingFor('myBoycotts', true)

      try {
        const { data, error: fetchError } = await supabase.rpc('get_my_boycotts', {
          p_user_id: user.id,
        })

        if (signal?.aborted) return []

        if (fetchError) {
          console.error('Error fetching boycotts:', fetchError)
          safeSetState(setError, 'Failed to load your boycotts. Please refresh the page.')
          clearErrorAfterDelay()
          safeSetState(setMyBoycotts, [])
          return []
        }

        safeSetState(setMyBoycotts, data || [])
        return data || []
      } catch (err) {
        if (signal?.aborted) return []
        console.error('Exception fetching boycotts:', err)
        safeSetState(setError, 'Failed to load your boycotts. Please check your connection.')
        clearErrorAfterDelay()
        safeSetState(setMyBoycotts, [])
        return []
      } finally {
        setLoadingFor('myBoycotts', false)
      }
    },
    // Key by user?.id, not user: Supabase issues a new user *object* on every
    // TOKEN_REFRESHED event even when the signed-in user is unchanged. Keying
    // by .id keeps this callback stable across token refreshes and prevents
    // the init effect (below) from firing every fetch twice on first load.
    [user?.id, safeSetState, setLoadingFor, clearErrorAfterDelay]
  )

  // Fetch boycotts user is following (adopted)
  const fetchFollowedBoycotts = useCallback(
    async signal => {
      if (!user) {
        safeSetState(setFollowedBoycotts, [])
        return []
      }

      setLoadingFor('followedBoycotts', true)

      try {
        const { data, error: fetchError } = await supabase.rpc('get_followed_boycotts', {
          p_user_id: user.id,
        })

        if (signal?.aborted) return []

        if (fetchError) {
          console.error('Error fetching followed boycotts:', fetchError)
          safeSetState(setError, 'Failed to load followed boycotts.')
          clearErrorAfterDelay()
          safeSetState(setFollowedBoycotts, [])
          return []
        }

        if (!data || data.length === 0) {
          safeSetState(setFollowedBoycotts, [])
          return []
        }

        // Get creator IDs and fetch profiles
        const creatorIds = [...new Set(data.map(b => b.creator_id))]
        const { data: profilesData } = await supabase.rpc('get_profiles_by_ids', {
          p_ids: creatorIds,
        })

        if (signal?.aborted) return []

        const profilesMap = {}
        ;(profilesData || []).forEach(p => {
          profilesMap[p.id] = p
        })

        const enrichedData = data.map(d => ({
          ...d,
          profiles: profilesMap[d.creator_id] || { username: 'unknown' },
        }))

        safeSetState(setFollowedBoycotts, enrichedData)
        return enrichedData
      } catch (err) {
        if (signal?.aborted) return []
        console.error('Exception fetching followed boycotts:', err)
        safeSetState(setFollowedBoycotts, [])
        return []
      } finally {
        setLoadingFor('followedBoycotts', false)
      }
    },
    [user?.id, safeSetState, setLoadingFor, clearErrorAfterDelay]
  )

  // Fetch public boycotts for explore page with follower counts
  const fetchPublicBoycotts = useCallback(
    async signal => {
      setLoadingFor('publicBoycotts', true)

      try {
        const { data, error: fetchError } = await supabase.rpc('get_public_boycotts')

        if (signal?.aborted) return []

        if (fetchError) {
          console.error('Error fetching public boycotts:', fetchError)
          safeSetState(setPublicBoycotts, [])
          return []
        }

        if (!data || data.length === 0) {
          safeSetState(setPublicBoycotts, [])
          return []
        }

        // Get unique creator IDs and fetch their profiles
        const creatorIds = [...new Set(data.map(b => b.creator_id))]
        const { data: profilesData } = await supabase.rpc('get_profiles_by_ids', {
          p_ids: creatorIds,
        })

        if (signal?.aborted) return []

        const profilesMap = {}
        ;(profilesData || []).forEach(p => {
          profilesMap[p.id] = p
        })

        // Add profile to each boycott
        const boycottsWithData = data.map(boycott => ({
          ...boycott,
          profiles: profilesMap[boycott.creator_id] || { username: 'unknown' },
        }))

        safeSetState(setPublicBoycotts, boycottsWithData)
        return boycottsWithData
      } catch (err) {
        if (signal?.aborted) return []
        console.error('Exception fetching public boycotts:', err)
        safeSetState(setPublicBoycotts, [])
        return []
      } finally {
        setLoadingFor('publicBoycotts', false)
      }
    },
    [safeSetState, setLoadingFor]
  )

  // Fetch users the current user is following
  const fetchFollowing = useCallback(
    async signal => {
      if (!user) {
        safeSetState(setFollowing, [])
        return []
      }

      setLoadingFor('following', true)

      try {
        const { data, error: fetchError } = await supabase.rpc('get_following', {
          p_user_id: user.id,
        })

        if (signal?.aborted) return []

        if (fetchError) {
          console.error('Error fetching following:', fetchError)
          safeSetState(setFollowing, [])
          return []
        }

        safeSetState(setFollowing, data || [])
        return data || []
      } catch (err) {
        if (signal?.aborted) return []
        console.error('Exception fetching following:', err)
        safeSetState(setFollowing, [])
        return []
      } finally {
        setLoadingFor('following', false)
      }
    },
    [user?.id, safeSetState, setLoadingFor]
  )

  // Search companies from Neo4j graph database
  const searchCompanies = useCallback(async query => {
    if (!query || query.length < 2) return []

    try {
      trackEvent('company_searched', { query })
      const results = await neo4jSearchCompanies(query, 20)
      return results
    } catch (err) {
      console.error('Exception searching companies:', err)
      return []
    }
  }, [])

  // Get company with connections from Neo4j graph database
  const getCompanyWithConnections = useCallback(async companyId => {
    if (!companyId) return null

    try {
      trackEvent('company_viewed', { company_id: companyId })
      const company = await neo4jGetCompany(companyId)
      return company
    } catch (err) {
      console.error('Exception fetching company:', err)
      return null
    }
  }, [])

  // Create a new boycott (with optimistic update)
  const createBoycott = useCallback(
    async (name, description = '', isPublic = false, sourceLinks = []) => {
      if (!user) {
        throw new Error('You must be logged in to create a boycott')
      }

      if (!name || name.trim().length === 0) {
        throw new Error('Boycott name is required')
      }

      // Optimistic: add to local state immediately with a temp ID
      const tempId = `temp-${Date.now()}`
      const optimisticBoycott = {
        id: tempId,
        name: name.trim(),
        description: description?.trim() || '',
        is_public: isPublic,
        source_links: sourceLinks,
        creator_id: user.id,
        created_at: new Date().toISOString(),
        boycott_companies: [],
        _optimistic: true,
      }
      safeSetState(setMyBoycotts, prev => [optimisticBoycott, ...prev])

      // Tie the re-fetch to the current session: if the user logs out or
      // switches mid-mutation this signal aborts, so the re-fetch's writes are
      // skipped instead of overwriting state with the previous user's data.
      const signal = abortControllerRef.current?.signal
      try {
        const { data, error: createError } = await supabase.rpc('create_boycott', {
          p_name: name.trim(),
          p_description: description?.trim() || '',
          p_is_public: isPublic,
          p_source_links: JSON.stringify(sourceLinks),
        })

        if (createError) {
          console.error('Error creating boycott:', createError)
          // Rollback optimistic update
          safeSetState(setMyBoycotts, prev => prev.filter(b => b.id !== tempId))
          if (
            createError.message?.includes('duplicate') ||
            createError.message?.includes('already exists')
          ) {
            throw new Error('You already have a boycott with this name')
          }
          throw new Error(createError.message || 'Failed to create boycott')
        }

        trackEvent('boycott_created')
        // Replace optimistic entry with real data from server
        await fetchMyBoycotts(signal)

        return data
      } catch (err) {
        // Rollback optimistic update on any error
        safeSetState(setMyBoycotts, prev => prev.filter(b => b.id !== tempId))
        throw err
      }
    },
    [user?.id, fetchMyBoycotts, safeSetState]
  )

  // Add company to boycott
  const addCompanyToBoycott = useCallback(
    async (
      boycottId,
      companyId,
      blockOwns = false,
      blockOwnedBy = false,
      blockSuppliers = false,
      companyName = null,
      companyLogoUrl = null,
      blockBrands = false,
      blockCustomers = false,
      { skipRefresh = false } = {}
    ) => {
      if (!boycottId || !companyId) {
        throw new Error('Invalid boycott or company')
      }

      const signal = abortControllerRef.current?.signal
      const { error: addError } = await supabase.rpc('add_company_to_boycott', {
        p_boycott_id: boycottId,
        p_company_id: String(companyId),
        p_company_name: companyName,
        p_company_logo_url: companyLogoUrl,
        p_block_owns: blockOwns,
        p_block_owned_by: blockOwnedBy,
        p_block_suppliers: blockSuppliers,
        p_block_brands: blockBrands,
        p_block_customers: blockCustomers,
      })

      if (addError) {
        console.error('Error adding company to boycott:', addError)
        if (addError.message?.includes('already')) {
          throw new Error('This company is already in the boycott')
        }
        throw new Error(addError.message || 'Failed to add company')
      }

      if (!skipRefresh) {
        await fetchMyBoycotts(signal)
      }
    },
    [fetchMyBoycotts]
  )

  // Remove company from boycott
  const removeCompanyFromBoycott = useCallback(
    async (boycottId, companyId, { skipRefresh = false } = {}) => {
      if (!boycottId || !companyId) {
        throw new Error('Invalid boycott or company')
      }

      const signal = abortControllerRef.current?.signal
      const { error: removeError } = await supabase.rpc('remove_company_from_boycott', {
        p_boycott_id: boycottId,
        p_company_id: String(companyId),
      })

      if (removeError) {
        console.error('Error removing company from boycott:', removeError)
        throw new Error(removeError.message || 'Failed to remove company')
      }

      if (!skipRefresh) {
        await fetchMyBoycotts(signal)
      }
    },
    [fetchMyBoycotts]
  )

  // Update company connection types in boycott
  const updateBoycottCompany = useCallback(
    async (
      boycottId,
      companyId,
      blockOwns,
      blockOwnedBy,
      blockSuppliers,
      blockBrands = false,
      blockCustomers = false,
      { skipRefresh = false } = {}
    ) => {
      if (!boycottId || !companyId) {
        throw new Error('Invalid boycott or company')
      }

      const signal = abortControllerRef.current?.signal
      const { error: updateError } = await supabase.rpc('update_boycott_company', {
        p_boycott_id: boycottId,
        p_company_id: String(companyId),
        p_block_owns: blockOwns,
        p_block_owned_by: blockOwnedBy,
        p_block_suppliers: blockSuppliers,
        p_block_brands: blockBrands,
        p_block_customers: blockCustomers,
      })

      if (updateError) {
        console.error('Error updating boycott company:', updateError)
        throw new Error(updateError.message || 'Failed to update company settings')
      }

      if (!skipRefresh) {
        await fetchMyBoycotts(signal)
      }
    },
    [fetchMyBoycotts]
  )

  // Delete boycott
  const deleteBoycott = useCallback(
    async boycottId => {
      if (!boycottId) {
        throw new Error('Invalid boycott')
      }

      const signal = abortControllerRef.current?.signal
      const { error: deleteError } = await supabase.rpc('delete_boycott', {
        p_boycott_id: boycottId,
      })

      if (deleteError) {
        console.error('Error deleting boycott:', deleteError)
        throw new Error(deleteError.message || 'Failed to delete boycott')
      }

      await fetchMyBoycotts(signal)
    },
    [fetchMyBoycotts]
  )

  // Update boycott
  const updateBoycott = useCallback(
    async (boycottId, updates) => {
      if (!boycottId) {
        throw new Error('Invalid boycott')
      }

      const signal = abortControllerRef.current?.signal
      const { error: updateError } = await supabase.rpc('update_boycott', {
        p_boycott_id: boycottId,
        p_name: updates.name ?? null,
        p_description: updates.description ?? null,
        p_is_public: updates.is_public ?? null,
        p_source_links: updates.source_links ? JSON.stringify(updates.source_links) : null,
      })

      if (updateError) {
        console.error('Error updating boycott:', updateError)
        throw new Error(updateError.message || 'Failed to update boycott')
      }

      await fetchMyBoycotts(signal)
      // Also refresh public boycotts if visibility changed
      if (updates.is_public !== undefined) {
        await fetchPublicBoycotts(signal)
      }
    },
    [fetchMyBoycotts, fetchPublicBoycotts]
  )

  // Adopt (follow) a boycott
  const adoptBoycott = useCallback(
    async boycottId => {
      if (!user) {
        throw new Error('You must be logged in to adopt a boycott')
      }
      if (!boycottId) {
        throw new Error('Invalid boycott')
      }

      const signal = abortControllerRef.current?.signal
      const { error: adoptError } = await supabase.rpc('adopt_boycott', { p_boycott_id: boycottId })

      if (adoptError) {
        console.error('Error adopting boycott:', adoptError)
        throw new Error(adoptError.message || 'Failed to adopt boycott')
      }

      trackEvent('boycott_followed')
      await fetchFollowedBoycotts(signal)
    },
    [user?.id, fetchFollowedBoycotts]
  )

  // Unadopt (unfollow) a boycott
  const unadoptBoycott = useCallback(
    async boycottId => {
      if (!user) {
        throw new Error('You must be logged in')
      }
      if (!boycottId) {
        throw new Error('Invalid boycott')
      }

      const signal = abortControllerRef.current?.signal
      const { error: unadoptError } = await supabase.rpc('unadopt_boycott', {
        p_boycott_id: boycottId,
      })

      if (unadoptError) {
        console.error('Error unadopting boycott:', unadoptError)
        throw new Error(unadoptError.message || 'Failed to unadopt boycott')
      }

      trackEvent('boycott_unfollowed')
      await fetchFollowedBoycotts(signal)
    },
    [user?.id, fetchFollowedBoycotts]
  )

  // Follow a user (direct follow for public profiles)
  const followUser = useCallback(
    async userId => {
      if (!user) {
        throw new Error('You must be logged in to follow users')
      }
      if (!userId) {
        throw new Error('Invalid user')
      }

      const signal = abortControllerRef.current?.signal
      const { error: followError } = await supabase.rpc('follow_user', { p_following_id: userId })

      if (followError) {
        console.error('Error following user:', followError)
        throw new Error(followError.message || 'Failed to follow user')
      }

      await fetchFollowing(signal)
    },
    [user?.id, fetchFollowing]
  )

  // Unfollow a user
  const unfollowUser = useCallback(
    async userId => {
      if (!user) {
        throw new Error('You must be logged in')
      }
      if (!userId) {
        throw new Error('Invalid user')
      }

      const signal = abortControllerRef.current?.signal
      const { error: unfollowError } = await supabase.rpc('unfollow_user', {
        p_following_id: userId,
      })

      if (unfollowError) {
        console.error('Error unfollowing user:', unfollowError)
        throw new Error(unfollowError.message || 'Failed to unfollow user')
      }

      await fetchFollowing(signal)
    },
    [user?.id, fetchFollowing]
  )

  // Check if user has adopted a boycott
  const hasAdoptedBoycott = useCallback(
    boycottId => {
      return followedBoycotts.some(b => b.id === boycottId)
    },
    [followedBoycotts]
  )

  // Get all blocked companies (from own + followed boycotts) - returns a function
  const getAllBlockedCompanies = useCallback(() => {
    const blocked = new Map()

    const processBoycott = boycott => {
      const companies = boycott.boycott_companies || []
      for (const bc of companies) {
        const company = bc.companies
        if (company && company.id) {
          if (!blocked.has(company.id)) {
            blocked.set(company.id, {
              ...company,
              boycotts: [boycott.name],
            })
          } else {
            const existing = blocked.get(company.id)
            if (!existing.boycotts.includes(boycott.name)) {
              existing.boycotts.push(boycott.name)
            }
          }
        }
      }
    }

    myBoycotts.forEach(processBoycott)
    followedBoycotts.forEach(processBoycott)

    return Array.from(blocked.values())
  }, [myBoycotts, followedBoycotts])

  // Computed loading state
  const loading = loadingState.initial || loadingState.myBoycotts || loadingState.followedBoycotts

  // Initial data fetch with cleanup
  useEffect(() => {
    // Cancel any previous pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    const loadData = async () => {
      setLoadingState(prev => ({ ...prev, initial: true }))
      setError(null)

      try {
        // Use Promise.allSettled to handle partial failures gracefully
        await Promise.allSettled([
          fetchMyBoycotts(signal),
          fetchFollowedBoycotts(signal),
          fetchFollowing(signal),
          fetchPublicBoycotts(signal),
        ])
      } catch (err) {
        if (!signal.aborted) {
          console.error('Error loading initial data:', err)
        }
      } finally {
        if (isMountedRef.current && !signal.aborted) {
          setLoadingState(prev => ({ ...prev, initial: false }))
        }
      }
    }

    loadData()

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [
    user?.id,
    fetchMyBoycotts,
    fetchFollowedBoycotts,
    fetchFollowing,
    fetchPublicBoycotts,
    isMountedRef,
  ])

  // Periodic refresh for user-generated content freshness (30s)
  useEffect(() => {
    if (!user) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchPublicBoycotts()
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [user, fetchPublicBoycotts])

  const value = useMemo(
    () => ({
      // State
      myBoycotts,
      followedBoycotts,
      publicBoycotts,
      following,
      loading,
      loadingState,
      error,

      // Actions — exported as the underlying useCallback identities so consumers
      // get a stable reference across renders. Wrapping with `() => fn()` here
      // re-mints the function on every useMemo recompute, which silently
      // invalidates downstream useEffect dep arrays and triggers fetch storms.
      fetchMyBoycotts,
      fetchFollowedBoycotts,
      fetchPublicBoycotts,
      searchCompanies,

      getCompanyWithConnections,

      createBoycott,
      addCompanyToBoycott,
      removeCompanyFromBoycott,
      updateBoycottCompany,
      deleteBoycott,
      updateBoycott,
      adoptBoycott,
      unadoptBoycott,
      followUser,
      unfollowUser,
      hasAdoptedBoycott,
      getAllBlockedCompanies,
      clearError: () => setError(null),
    }),
    [
      myBoycotts,
      followedBoycotts,
      publicBoycotts,
      following,
      loading,
      loadingState,
      error,
      fetchMyBoycotts,
      fetchFollowedBoycotts,
      fetchPublicBoycotts,
      searchCompanies,

      getCompanyWithConnections,

      createBoycott,
      addCompanyToBoycott,
      removeCompanyFromBoycott,
      updateBoycottCompany,
      deleteBoycott,
      updateBoycott,
      adoptBoycott,
      unadoptBoycott,
      followUser,
      unfollowUser,
      hasAdoptedBoycott,
      getAllBlockedCompanies,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
