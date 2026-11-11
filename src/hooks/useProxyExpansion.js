import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getCompanyLinkId, getCompanyWithConnections } from '../services/neo4jGraph'

// Cap parallel Neo4j fetches inside one boycott prefetch. Combined with the
// 3-at-a-time outer chunking in prefetchAllProxies, a /home with 10 boycotts
// of 50 companies each can no longer launch 30 × 50 = 1500 in-flight calls.
// Kept low because uncached company-detail queries on the 0.25 vCPU App
// Runner slow each other down past the worker's origin timeout when run
// 4-wide (observed 504s on the boycott detail page).
const PREFETCH_CONCURRENCY = 2

/**
 * Hook for managing proxy company expansion in boycott lists
 * Handles fetching, caching, and state management for proxy companies
 * (subsidiaries/brands, parent companies, suppliers)
 */
export function useProxyExpansion(boycotts = [], options = {}) {
  const { autoFetch = false, keyPrefix = '' } = options

  const [expandedProxy, setExpandedProxy] = useState(null)
  const [proxyCompanies, setProxyCompanies] = useState({})
  const [loadingProxies, setLoadingProxies] = useState(new Set())

  // Ref to track which keys are already fetched or in-flight, preventing re-fetch loops
  const fetchedKeysRef = useRef(new Set())

  const getProxyKey = useCallback(
    (boycottId, companyId) => {
      return `${keyPrefix}${boycottId}-${companyId}`
    },
    [keyPrefix]
  )

  // Fetch proxy companies from Neo4j API
  const fetchProxyCompanies = useCallback(async (companyId, entry) => {
    try {
      // Use Neo4j-compatible ID (LEI or wikidata_qid) from the company object
      const neo4jId = entry?.companies ? getCompanyLinkId(entry.companies) : companyId
      const companyData = await getCompanyWithConnections(neo4jId)
      if (!companyData?.connections) {
        return { owns: [], owned_by: [], brands: [], supplier: [], customers: [] }
      }

      return {
        owns: companyData.connections.owns || [],
        owned_by: companyData.connections.owned_by || [],
        brands: companyData.connections.brands || [],
        supplier: companyData.connections.suppliers || [],
        customers: companyData.connections.customers || [],
      }
    } catch (err) {
      // Return null on FAILURE (timeout, network) so callers can distinguish
      // it from a company with genuinely no connections — failures must not
      // be cached for the whole session as "no connections".
      console.error('Error fetching proxy companies:', err)
      return null
    }
  }, [])

  const toggleProxyExpansion = useCallback(
    async (e, boycottId, companyId, entry) => {
      if (e) e.stopPropagation()

      const key = getProxyKey(boycottId, companyId)
      const isCurrentlyExpanded =
        expandedProxy?.boycottId === boycottId && expandedProxy?.companyId === companyId

      if (isCurrentlyExpanded) {
        setExpandedProxy(null)
        return
      }

      if (!fetchedKeysRef.current.has(key)) {
        fetchedKeysRef.current.add(key)
        setLoadingProxies(prev => new Set([...prev, key]))
        const data = await fetchProxyCompanies(companyId, entry)
        if (data) {
          setProxyCompanies(prev => ({ ...prev, [key]: data }))
        } else {
          // Failed fetch: forget the key so the next expand retries it.
          fetchedKeysRef.current.delete(key)
        }
        setLoadingProxies(prev => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }

      setExpandedProxy({ boycottId, companyId })
    },
    [expandedProxy, fetchProxyCompanies, getProxyKey]
  )

  const countProxyCompanies = useCallback(
    (boycottId, companyId) => {
      const key = getProxyKey(boycottId, companyId)
      const data = proxyCompanies[key]
      if (!data) return 0
      return (
        (data.owns?.length || 0) +
        (data.owned_by?.length || 0) +
        (data.brands?.length || 0) +
        (data.supplier?.length || 0) +
        (data.customers?.length || 0)
      )
    },
    [proxyCompanies, getProxyKey]
  )

  const getProxyData = useCallback(
    (boycottId, companyId) => {
      const key = getProxyKey(boycottId, companyId)
      return proxyCompanies[key]
    },
    [proxyCompanies, getProxyKey]
  )

  const isProxyExpanded = useCallback(
    (boycottId, companyId) => {
      return expandedProxy?.boycottId === boycottId && expandedProxy?.companyId === companyId
    },
    [expandedProxy]
  )

  // Prefetch proxy data for all companies in a boycott
  const prefetchBoycottProxies = useCallback(
    async boycott => {
      const entries = boycott?.boycott_companies || boycott?.companies
      if (!entries) return

      const loadingKey = `${keyPrefix}${boycott.id}`
      setLoadingProxies(prev => new Set([...prev, loadingKey]))

      try {
        // Bounded worker pool: at most PREFETCH_CONCURRENCY entries fetch at
        // once, with the rest waiting their turn. Stops a boycott containing
        // 50+ companies from saturating the Neo4j connection pool on its own.
        let cursor = 0
        const worker = async () => {
          while (cursor < entries.length) {
            const entry = entries[cursor++]
            const companyId = entry.companies?.id || entry.company_id
            const key = getProxyKey(boycott.id, companyId)
            if (fetchedKeysRef.current.has(key)) continue
            fetchedKeysRef.current.add(key)
            const data = await fetchProxyCompanies(companyId, entry)
            if (data) {
              setProxyCompanies(prev => ({ ...prev, [key]: data }))
            } else {
              // Failed fetch: forget the key so a manual expand can retry.
              fetchedKeysRef.current.delete(key)
            }
          }
        }
        const workerCount = Math.min(PREFETCH_CONCURRENCY, entries.length)
        await Promise.all(Array.from({ length: workerCount }, worker))
      } finally {
        setLoadingProxies(prev => {
          const next = new Set(prev)
          next.delete(loadingKey)
          return next
        })
      }
    },
    [fetchProxyCompanies, getProxyKey, keyPrefix]
  )

  // Prefetch proxy data for all boycotts
  const prefetchAllProxies = useCallback(
    async boycottsToFetch => {
      if (!boycottsToFetch?.length) return

      // Fetch in parallel but limit concurrency
      const chunkSize = 3
      for (let i = 0; i < boycottsToFetch.length; i += chunkSize) {
        const chunk = boycottsToFetch.slice(i, i + chunkSize)
        await Promise.all(chunk.map(b => prefetchBoycottProxies(b)))
      }
    },
    [prefetchBoycottProxies]
  )

  // Count total proxy companies for a boycott
  const countTotalProxyForBoycott = useCallback(
    (boycott, directlyBlockedIds = new Set()) => {
      const entries = boycott?.boycott_companies || boycott?.companies
      if (!entries) return 0

      let total = 0
      for (const entry of entries) {
        const companyId = entry.companies?.id || entry.company_id
        const key = getProxyKey(boycott.id, companyId)
        const data = proxyCompanies[key]
        if (data) {
          // Count subsidiaries not already directly blocked
          const subs = data.owns?.filter(c => !directlyBlockedIds.has(c.id)) || []
          total += subs.length
        }
      }
      return total
    },
    [proxyCompanies, getProxyKey]
  )

  const isBoycottLoading = useCallback(
    boycottId => {
      return loadingProxies.has(`${keyPrefix}${boycottId}`)
    },
    [loadingProxies, keyPrefix]
  )

  useEffect(() => {
    if (autoFetch && boycotts.length > 0) {
      prefetchAllProxies(boycotts)
    }
  }, [autoFetch, boycotts, prefetchAllProxies])

  const closeExpanded = useCallback(() => {
    setExpandedProxy(null)
  }, [])

  return useMemo(
    () => ({
      expandedProxy,
      proxyCompanies,
      loadingProxies,
      toggleProxyExpansion,
      prefetchBoycottProxies,
      prefetchAllProxies,
      closeExpanded,
      countProxyCompanies,
      countTotalProxyForBoycott,
      getProxyData,
      isProxyExpanded,
      isBoycottLoading,
      getProxyKey,
    }),
    [
      expandedProxy,
      proxyCompanies,
      loadingProxies,
      toggleProxyExpansion,
      prefetchBoycottProxies,
      prefetchAllProxies,
      closeExpanded,
      countProxyCompanies,
      countTotalProxyForBoycott,
      getProxyData,
      isProxyExpanded,
      isBoycottLoading,
      getProxyKey,
    ]
  )
}
