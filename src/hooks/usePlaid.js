import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { getAccessToken, supabase } from '../lib/supabase'
import { useSafeState } from './useSafeState'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : ''

export function usePlaid() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortControllerRef = useRef(null)
  const { safeSetState } = useSafeState()

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // Clear error
  const clearError = useCallback(() => {
    safeSetState(setError, null)
  }, [safeSetState])

  // Get link token for Plaid Link
  const getLinkToken = useCallback(async () => {
    if (!user) throw new Error('Please sign in to connect a bank account')
    clearError()

    try {
      const token = await getAccessToken()

      const response = await fetch(`${FUNCTIONS_URL}/plaid-link-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to initialize bank connection')
      }

      const data = await response.json()
      return data.link_token
    } catch (err) {
      safeSetState(setError, err.message)
      throw err
    }
  }, [user, clearError, safeSetState])

  // Exchange public token for access token
  const exchangeToken = useCallback(
    async (publicToken, institution) => {
      if (!user) throw new Error('Please sign in to continue')
      if (!publicToken) throw new Error('Invalid connection token')
      clearError()

      try {
        const token = await getAccessToken()

        const response = await fetch(`${FUNCTIONS_URL}/plaid-exchange-token`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            public_token: publicToken,
            institution,
          }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to connect bank account')
        }

        const data = await response.json()
        return data
      } catch (err) {
        safeSetState(setError, err.message)
        throw err
      }
    },
    [user, clearError, safeSetState]
  )

  // Sync transactions
  const syncTransactions = useCallback(async () => {
    if (!user) throw new Error('Please sign in to sync transactions')
    clearError()
    safeSetState(setLoading, true)

    // Cancel any previous sync
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      const token = await getAccessToken()

      const response = await fetch(`${FUNCTIONS_URL}/plaid-sync-transactions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to sync transactions')
      }

      const data = await response.json()
      return data
    } catch (err) {
      if (err.name === 'AbortError') {
        // Request was cancelled, don't treat as error
        return null
      }
      safeSetState(setError, err.message)
      throw err
    } finally {
      safeSetState(setLoading, false)
    }
  }, [user, clearError, safeSetState])

  // Get plaid items
  const getPlaidItems = useCallback(async () => {
    if (!user) return []
    clearError()

    try {
      const { data, error: queryError } = await supabase.rpc('get_user_plaid_items', {
        p_user_id: user.id,
      })

      if (queryError) {
        throw new Error(queryError.message || 'Failed to load connected accounts')
      }
      return data || []
    } catch (err) {
      safeSetState(setError, err.message)
      return []
    }
  }, [user, clearError, safeSetState])

  // Get spending stats
  const getSpendingStats = useCallback(
    async (startDate = null, endDate = null) => {
      if (!user) return null
      clearError()

      try {
        const { data, error: queryError } = await supabase.rpc('get_spending_stats', {
          p_user_id: user.id,
          p_start_date: startDate,
          p_end_date: endDate,
        })

        if (queryError) {
          throw new Error(queryError.message || 'Failed to load spending stats')
        }
        return data?.[0] || null
      } catch (err) {
        safeSetState(setError, err.message)
        return null
      }
    },
    [user, clearError, safeSetState]
  )

  // Get spending by company
  const getSpendingByCompany = useCallback(
    async (startDate = null, endDate = null) => {
      if (!user) return []
      clearError()

      try {
        const { data, error: queryError } = await supabase.rpc('get_spending_by_company', {
          p_user_id: user.id,
          p_start_date: startDate,
          p_end_date: endDate,
        })

        if (queryError) {
          throw new Error(queryError.message || 'Failed to load company spending')
        }
        return data || []
      } catch (err) {
        safeSetState(setError, err.message)
        return []
      }
    },
    [user, clearError, safeSetState]
  )

  // Get spending over time
  const getSpendingOverTime = useCallback(
    async (startDate = null, endDate = null, groupBy = 'day') => {
      if (!user) return []
      clearError()

      try {
        const { data, error: queryError } = await supabase.rpc('get_spending_over_time', {
          p_user_id: user.id,
          p_start_date: startDate,
          p_end_date: endDate,
          p_group_by: groupBy,
        })

        if (queryError) {
          throw new Error(queryError.message || 'Failed to load spending history')
        }
        return data || []
      } catch (err) {
        safeSetState(setError, err.message)
        return []
      }
    },
    [user, clearError, safeSetState]
  )

  // Get transactions
  const getTransactions = useCallback(
    async (startDate = null, endDate = null, limit = 100, offset = 0) => {
      if (!user) return []
      clearError()

      try {
        const { data, error: queryError } = await supabase.rpc('get_user_transactions', {
          p_user_id: user.id,
          p_start_date: startDate,
          p_end_date: endDate,
          p_limit: limit,
          p_offset: offset,
        })

        if (queryError) {
          throw new Error(queryError.message || 'Failed to load transactions')
        }
        return data || []
      } catch (err) {
        safeSetState(setError, err.message)
        return []
      }
    },
    [user, clearError, safeSetState]
  )

  // Disconnect a plaid item
  const disconnectItem = useCallback(
    async itemId => {
      if (!user) throw new Error('Please sign in to continue')
      if (!itemId) throw new Error('Invalid account')
      clearError()

      try {
        const { error: deleteError } = await supabase
          .from('plaid_items')
          .delete()
          .eq('id', itemId)
          .eq('user_id', user.id)

        if (deleteError) {
          throw new Error(deleteError.message || 'Failed to disconnect account')
        }
      } catch (err) {
        safeSetState(setError, err.message)
        throw err
      }
    },
    [user, clearError, safeSetState]
  )

  return {
    loading,
    error,
    clearError,
    getLinkToken,
    exchangeToken,
    syncTransactions,
    getPlaidItems,
    getSpendingStats,
    getSpendingByCompany,
    getSpendingOverTime,
    getTransactions,
    disconnectItem,
  }
}
