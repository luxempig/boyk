import { AnimatePresence, motion } from 'framer-motion'
import { Clock, Flag, ScanLine, Share2, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import ConfidenceDot from '../components/atoms/ConfidenceDot'
import LazyImage from '../components/atoms/LazyImage'
import { ModePillToggle } from '../components/molecules/ModePillToggle'
import { ShareMenu } from '../components/molecules/ShareMenu'
import SponsoredAlternatives from '../components/molecules/SponsoredAlternatives'
import Header from '../components/organisms/Header'
import ScanHistory from '../components/organisms/ScanHistory'
import { useToast } from '../components/organisms/Toast'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useSafeState } from '../hooks/useSafeState'
import { useScanHistory } from '../hooks/useScanHistory'
import { useShare } from '../hooks/useShare'
import { trackEvent } from '../lib/analytics'
import { SOURCE_LABELS } from '../lib/provenance'
import { shareScanResult } from '../lib/shareCard'
import { getAccessToken, supabaseUrl as SUPABASE_URL } from '../lib/supabase'
import { getProductByBarcode, isNeo4jId } from '../services/neo4jGraph'

const BarcodeScanner = lazy(() => import('../components/organisms/BarcodeScanner'))
const CreateBoycottModal = lazy(() => import('../components/organisms/boycott/CreateBoycottModal'))

// Confidence is only rendered when the data carries a known level; never invented.
const CONFIDENCE_LEVELS = ['high', 'medium', 'low']

// Respect prefers-reduced-motion
const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setReduced(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

// Barcode provenance for the result card: a mono EAN/UPC data stamp plus a
// compact Product → Brand → Company ownership breadcrumb when the scan
// resolved through the knowledge graph.
function ScanTrace({ barcode, productName, brandName, company }) {
  const codeLabel = barcode?.length === 12 ? 'UPC' : 'EAN'
  const companyName = company?.name
  const showBrand =
    Boolean(brandName) && brandName.toLowerCase() !== (companyName || '').toLowerCase()
  const showChain =
    Boolean(productName) &&
    Boolean(companyName) &&
    productName.toLowerCase() !== companyName.toLowerCase()

  if (!barcode && !showChain) return null

  const segmentStyle = {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '40%',
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginTop: 'var(--space-3)',
      }}
    >
      {barcode && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs2)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
          }}
        >
          {codeLabel} {barcode}
        </div>
      )}
      {showChain && (
        <nav
          aria-label='Ownership trace'
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 'var(--space-1-5)',
            padding: 'var(--space-1-5) var(--space-3)',
            background: 'var(--bg-dark)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-full)',
            maxWidth: '100%',
          }}
        >
          <span style={segmentStyle}>{productName}</span>
          <span aria-hidden='true' style={{ color: 'var(--text-muted)' }}>
            →
          </span>
          {showBrand && (
            <>
              <span style={segmentStyle}>{brandName}</span>
              <span aria-hidden='true' style={{ color: 'var(--text-muted)' }}>
                →
              </span>
            </>
          )}
          {company?.id ? (
            <Link
              to={`/company/${company.id}`}
              style={{
                ...segmentStyle,
                color: 'var(--accent)',
                fontWeight: 'var(--font-medium)',
                textDecoration: 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
            >
              {companyName}
            </Link>
          ) : (
            <span style={{ ...segmentStyle, fontWeight: 'var(--font-medium)' }}>{companyName}</span>
          )}
        </nav>
      )}
    </div>
  )
}

function InsightRow({ color, label, detail, border }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2-5)',
        padding: 'var(--space-2-5) var(--space-3)',
        background: color.replace(')', ', 0.08)').replace('rgb', 'rgba'),
        borderRadius: 'var(--radius-md)',
        ...(border
          ? { border: `1px solid ${color.replace(')', ', 0.2)').replace('rgb', 'rgba')}` }
          : {}),
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color }}>
          {label}
        </div>
        {detail && (
          <div
            style={{
              fontSize: 'var(--text-xs2)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-0-5)',
            }}
          >
            {detail}
          </div>
        )}
      </div>
    </div>
  )
}

function CompanyInsights({ company }) {
  const donations = company.connections?.political_donations || []
  const recalls = company.recalls || []
  const govContracts = company.government_contracts || []
  const violations = company.violations || []
  const envViolations = company.environmental_violations || []
  const complaints = company.consumer_complaints || []
  const subsidies = company.subsidies || []
  const lobbying = company.lobbying || []
  const esgScores = company.esg_scores || []
  const offshore = company.offshore_entities || []
  const facilities = company.facilities || []

  const totalDonations = donations.reduce((sum, d) => sum + (Number(d.amount) || 0), 0)
  const totalContracts = govContracts.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const totalSubsidies = subsidies.reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
  const allViolations = [...violations, ...envViolations]

  const rows = []

  if (recalls.length > 0) {
    rows.push(
      <InsightRow
        key='recalls'
        color='rgb(239, 68, 68)'
        border
        label={`${recalls.length} Product Recall${recalls.length !== 1 ? 's' : ''}`}
        detail={recalls
          .slice(0, 2)
          .map(r => r.product_name || r.reason)
          .filter(Boolean)
          .join('; ')}
      />
    )
  }

  if (offshore.length > 0) {
    rows.push(
      <InsightRow
        key='offshore'
        color='rgb(239, 68, 68)'
        border
        label={`${offshore.length} Offshore Entit${offshore.length !== 1 ? 'ies' : 'y'}`}
        detail='Linked entities in offshore leak databases'
      />
    )
  }

  if (allViolations.length > 0) {
    rows.push(
      <InsightRow
        key='violations'
        color='rgb(245, 158, 11)'
        border
        label={`${allViolations.length} Violation${allViolations.length !== 1 ? 's' : ''}`}
        detail={envViolations.length > 0 ? `${envViolations.length} environmental` : undefined}
      />
    )
  }

  if (complaints.length > 0) {
    rows.push(
      <InsightRow
        key='complaints'
        color='rgb(245, 158, 11)'
        label={`${complaints.length} Consumer Complaint${complaints.length !== 1 ? 's' : ''}`}
        detail='CFPB consumer complaint records'
      />
    )
  }

  if (donations.length > 0) {
    rows.push(
      <InsightRow
        key='donations'
        color='rgb(168, 85, 247)'
        label={`${totalDonations > 0 ? `$${totalDonations.toLocaleString()} ` : ''}Political Donations`}
        detail={`${donations.length} contribution${donations.length !== 1 ? 's' : ''} on record`}
      />
    )
  }

  if (lobbying.length > 0) {
    rows.push(
      <InsightRow
        key='lobbying'
        color='rgb(168, 85, 247)'
        label={`${lobbying.length} Lobbying Record${lobbying.length !== 1 ? 's' : ''}`}
      />
    )
  }

  if (govContracts.length > 0) {
    rows.push(
      <InsightRow
        key='contracts'
        color='rgb(59, 130, 246)'
        label={`${govContracts.length} Gov Contract${govContracts.length !== 1 ? 's' : ''}${totalContracts > 0 ? ` ($${totalContracts.toLocaleString()})` : ''}`}
      />
    )
  }

  if (subsidies.length > 0) {
    rows.push(
      <InsightRow
        key='subsidies'
        color='rgb(59, 130, 246)'
        label={`${subsidies.length} Subsid${subsidies.length !== 1 ? 'ies' : 'y'}${totalSubsidies > 0 ? ` ($${totalSubsidies.toLocaleString()})` : ''}`}
      />
    )
  }

  if (esgScores.length > 0) {
    rows.push(
      <InsightRow
        key='esg'
        color='rgb(34, 197, 94)'
        label={`${esgScores.length} ESG Score${esgScores.length !== 1 ? 's' : ''}`}
        detail='Environmental, Social & Governance ratings'
      />
    )
  }

  if (facilities.length > 0) {
    rows.push(
      <InsightRow
        key='facilities'
        color='rgb(107, 114, 128)'
        label={`${facilities.length} Production Facilit${facilities.length !== 1 ? 'ies' : 'y'}`}
      />
    )
  }

  if (rows.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--bg-dark)',
        padding: 'var(--space-4)',
        marginTop: 'var(--space-5)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'left',
      }}
    >
      <h4 className='subsection-label' style={{ marginBottom: 'var(--space-3)' }}>
        Corporate Intelligence
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2-5)' }}>
        {rows}
      </div>
    </div>
  )
}

export default function CheckProduct() {
  const {
    searchCompanies,
    getAllBlockedCompanies,
    getCompanyWithConnections,
    myBoycotts,
    followedBoycotts,
  } = useApp()
  const { user } = useAuth()
  const toast = useToast()
  const { safeSetState } = useSafeState()
  const prefersReducedMotion = usePrefersReducedMotion()
  const { history: scanHistory, addScan, clearHistory } = useScanHistory()
  const { share, menuState, closeMenu } = useShare()

  const [activeTab, setActiveTab] = useState('check') // 'check' | 'history'
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [companyDetail, setCompanyDetail] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [result, setResult] = useState(null)
  const [alternatives, setAlternatives] = useState(null)
  const [loadingAlternatives, setLoadingAlternatives] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [scannerFile, setScannerFile] = useState(null)
  const [activeResultIndex, setActiveResultIndex] = useState(-1)
  const [showCreateBoycott, setShowCreateBoycott] = useState(false)

  const [manualBarcode, setManualBarcode] = useState('')
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  // Barcode that returned no product — drives a persistent inline message so
  // the dead-end isn't only signalled by a 4s toast. Cleared on input/lookup.
  const [barcodeNotFound, setBarcodeNotFound] = useState(null)

  const searchInputRef = useRef(null)
  const listboxRef = useRef(null)
  const fileInputRef = useRef(null)
  const lastScanTypeRef = useRef('search') // 'search' or 'barcode'
  const lastProductRef = useRef(null) // product name from barcode scan
  const lastProductSourceRef = useRef(null) // 'openfoodfacts' when the lookup came from the OFF index (ODbL attribution)
  const lastBarcodeRef = useRef(null) // raw EAN/UPC behind the current result (data stamp)
  const lastBrandRef = useRef(null) // brand the product resolved through (ownership trace)
  const blockedCompanies = useMemo(() => getAllBlockedCompanies(), [getAllBlockedCompanies])
  const allBoycottsForLookup = useMemo(
    () => [...(myBoycotts || []), ...(followedBoycotts || [])],
    [myBoycotts, followedBoycotts]
  )

  // --- Animation presets ---
  const springResult = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, scale: 0.95, y: 10 },
        animate: { opacity: 1, scale: 1, y: 0 },
        transition: { type: 'spring', stiffness: 300, damping: 25 },
      }

  const springIcon = prefersReducedMotion
    ? {}
    : {
        initial: { scale: 0 },
        animate: { scale: 1 },
        transition: { type: 'spring', stiffness: 400, damping: 15, delay: 0.15 },
      }

  // --- Search with debounce ---
  const searchTimerRef = useRef(null)
  const searchQueryRef = useRef('')

  const handleSearch = query => {
    lastScanTypeRef.current = 'search'
    lastProductRef.current = null
    lastBarcodeRef.current = null
    lastBrandRef.current = null
    safeSetState(setSearchQuery, query)
    safeSetState(setResult, null)
    safeSetState(setSelectedCompany, null)
    safeSetState(setCompanyDetail, null)
    safeSetState(setAlternatives, null)
    safeSetState(setActiveResultIndex, -1)
    searchQueryRef.current = query

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    if (query.length < 2) {
      safeSetState(setSearchResults, [])
      safeSetState(setIsSearching, false)
      return
    }

    safeSetState(setIsSearching, true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchCompanies(query)
        // Only update if query hasn't changed since we fired
        if (searchQueryRef.current === query) {
          safeSetState(setSearchResults, results.slice(0, 5))
        }
      } catch {
        if (searchQueryRef.current === query) toast.error('Search failed')
      } finally {
        if (searchQueryRef.current === query) safeSetState(setIsSearching, false)
      }
    }, 300)
  }

  // --- Keyboard navigation for search results ---
  const handleSearchKeyDown = e => {
    if (!searchResults.length) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveResultIndex(prev => Math.min(prev + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveResultIndex(prev => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && activeResultIndex >= 0) {
      e.preventDefault()
      handleSelectCompany(searchResults[activeResultIndex])
    } else if (e.key === 'Escape') {
      setSearchResults([])
      setActiveResultIndex(-1)
    }
  }

  // --- Select company & check conflicts ---
  const handleManualBarcode = async e => {
    e.preventDefault()
    const barcode = manualBarcode.trim()
    if (!barcode || barcodeLoading) return
    if (!/^\d{8,14}$/.test(barcode)) {
      toast.error('Enter a valid UPC (12 digits) or EAN (13 digits) barcode')
      return
    }
    setBarcodeLoading(true)
    setBarcodeNotFound(null)
    try {
      const product = await getProductByBarcode(barcode)
      if (!product) {
        setBarcodeNotFound(barcode)
        setBarcodeLoading(false)
        return
      }
      trackEvent('product_scanned', { barcode, method: 'manual' })
      lastScanTypeRef.current = 'barcode'
      lastProductRef.current = product.name || null
      lastProductSourceRef.current = product.source || null
      lastBarcodeRef.current = product.barcode || barcode
      lastBrandRef.current = product.brand_name || null
      const company = product.company_name
        ? { name: product.company_name, id: product.company_id }
        : { name: product.name }
      setManualBarcode('')
      if (company.id) {
        handleSelectCompany(company)
      } else {
        handleSearch(company.name)
      }
    } catch {
      toast.error('Failed to look up barcode')
    } finally {
      setBarcodeLoading(false)
    }
  }

  const handleSelectCompany = async company => {
    setSelectedCompany(company)
    setSearchQuery(company.name)
    setSearchResults([])
    setActiveResultIndex(-1)
    setIsChecking(true)
    setResult(null)
    setAlternatives(null)
    setCompanyDetail(null)
    setShowCreateBoycott(false)
    trackEvent('product_check', { company: company.name })

    const conflicts = []

    // Direct block check
    const blockedCompany = blockedCompanies.find(
      bc => bc.id === company.id || bc.name.toLowerCase() === company.name.toLowerCase()
    )

    if (blockedCompany) {
      conflicts.push(
        ...blockedCompany.boycotts.map(boycottName => ({
          boycottName,
          reason: 'Directly blocked',
          companyName: blockedCompany.name,
        }))
      )
    }

    // Proxy blocking: check parent companies + fetch enrichment data
    let companyData = null
    try {
      companyData = isNeo4jId(company.id) ? await getCompanyWithConnections(company.id) : null
      if (companyData) setCompanyDetail(companyData)
      if (companyData?.connections?.owned_by) {
        for (const parent of companyData.connections.owned_by) {
          const blockedParent = blockedCompanies.find(
            bc => bc.id === parent.id || bc.name.toLowerCase() === parent.name?.toLowerCase()
          )
          if (blockedParent) {
            conflicts.push(
              ...blockedParent.boycotts.map(boycottName => ({
                boycottName,
                reason: `Owned by ${blockedParent.name}`,
                companyName: company.name,
                // Provenance from the OWNED_BY relationship — only when present
                source: parent.source || null,
                confidence: CONFIDENCE_LEVELS.includes(parent.confidence)
                  ? parent.confidence
                  : null,
              }))
            )
          }
        }
      }
    } catch (err) {
      console.error('Error checking proxy blocking:', err)
    }

    setIsChecking(false)
    const checkResult = { hasConflict: conflicts.length > 0, conflicts }
    setResult(checkResult)

    // Save to scan history
    addScan({
      type: lastScanTypeRef.current,
      companyName: company.name,
      companyId: company.id || null,
      companyLogoUrl: company.logo_url || null,
      productName: lastProductRef.current || null,
      hasConflict: checkResult.hasConflict,
      conflicts: checkResult.conflicts.slice(0, 5),
    })
  }

  // --- Fetch AI alternatives (simplified: one button, no product type prompt) ---
  const fetchAlternatives = useCallback(async () => {
    if (!selectedCompany || !result) return

    safeSetState(setLoadingAlternatives, true)
    safeSetState(setAlternatives, null)
    trackEvent('find_alternatives', { company: selectedCompany.name })

    try {
      const token = await getAccessToken()

      const firstConflict = result.conflicts?.[0]
      const boycott = firstConflict
        ? [...myBoycotts, ...followedBoycotts].find(b => b.name === firstConflict.boycottName)
        : undefined

      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-alternatives`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          blockedCompany: { name: selectedCompany.name, description: selectedCompany.description },
          productQuery: searchQuery,
          boycottInfo: boycott
            ? { name: boycott.name, description: boycott.description }
            : undefined,
        }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Failed to fetch alternatives (${response.status})`)
      }
      const data = await response.json()
      if (data.error) throw new Error(data.error)
      safeSetState(setAlternatives, data)
    } catch (err) {
      toast.error(err.message || 'Failed to find alternatives')
    } finally {
      safeSetState(setLoadingAlternatives, false)
    }
  }, [selectedCompany, result, searchQuery, myBoycotts, followedBoycotts, safeSetState, toast])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = e => {
      if (listboxRef.current && !listboxRef.current.contains(e.target)) {
        setSearchResults([])
        setActiveResultIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className='container'>
      <Header pageLabel='Check' />

      <h1 className='page-title'>Check a Product</h1>
      <p className='page-subtitle'>See if a brand conflicts with your boycotts</p>

      {/* Mode toggle */}
      <ModePillToggle
        options={[
          { key: 'check', label: 'Check', icon: ScanLine },
          { key: 'history', label: 'History', icon: Clock },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ margin: 'var(--space-3) auto', display: 'flex', justifyContent: 'center' }}
      />

      {/* History tab */}
      {activeTab === 'history' && (
        <ScanHistory
          history={scanHistory}
          onClear={clearHistory}
          onRecheck={entry => {
            setActiveTab('check')
            handleSearch(entry.companyName)
          }}
        />
      )}

      {/* Check tab — Search bar with inline scan button */}
      {activeTab !== 'check' ? null : (
        <>
          {/* Search bar with inline scan button */}
          <div ref={listboxRef} style={{ position: 'relative' }}>
            <div className='search-container'>
              <span className='search-icon'>⌕</span>
              <input
                ref={searchInputRef}
                type='text'
                className='search-input'
                placeholder='Search company or brand...'
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-label='Search for a company or brand'
                aria-autocomplete='list'
                aria-controls='check-search-listbox'
                aria-activedescendant={
                  activeResultIndex >= 0 ? `check-result-${activeResultIndex}` : undefined
                }
                style={{ paddingRight: '52px' }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: 'var(--space-2)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                }}
              >
                <input
                  type='file'
                  ref={fileInputRef}
                  accept='image/*'
                  className='hidden'
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setScannerFile(file)
                      setShowScanner(true)
                    }
                    // Reset input so the same file can be selected again
                    e.target.value = ''
                  }}
                />
                <motion.button
                  type='button'
                  onClick={() => fileInputRef.current?.click()}
                  aria-label='Scan product barcode'
                  whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
                  style={{
                    padding: 'var(--space-2)',
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '36px',
                    minHeight: '36px',
                  }}
                >
                  <ScanLine size={18} />
                </motion.button>
              </div>
            </div>

            {/* Search results dropdown */}
            <AnimatePresence>
              {searchResults.length > 0 && !selectedCompany && (
                <motion.ul
                  id='check-search-listbox'
                  role='listbox'
                  aria-label='Search results'
                  initial={prefersReducedMotion ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderTop: 'none',
                    borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                    overflow: 'hidden',
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                  }}
                >
                  {searchResults.map((company, idx) => (
                    <motion.li
                      key={company.id}
                      id={`check-result-${idx}`}
                      role='option'
                      aria-selected={activeResultIndex === idx}
                      initial={prefersReducedMotion ? false : { opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: prefersReducedMotion ? 0 : idx * 0.03 }}
                      onClick={() => handleSelectCompany(company)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectCompany(company)
                        }
                      }}
                      tabIndex={-1}
                      style={{
                        padding: 'var(--space-3-5) var(--space-4)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        borderBottom:
                          idx < searchResults.length - 1 ? '1px solid var(--border)' : 'none',
                        background:
                          activeResultIndex === idx ? 'var(--bg-card-hover)' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <LazyImage
                        src={company.logo_url}
                        alt={company.name}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: 'var(--radius-sm)',
                          objectFit: 'contain',
                          background: 'var(--bg-elevated)',
                          flexShrink: 0,
                        }}
                        fallback={
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--accent)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--text-on-accent, #fff)',
                              fontSize: 'var(--text-md)',
                              fontWeight: 'var(--font-semibold)',
                              flexShrink: 0,
                            }}
                          >
                            {company.name?.charAt(0).toUpperCase()}
                          </div>
                        }
                      />
                      <span
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: 'var(--text-md)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {company.name}
                      </span>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>

          {/* Manual barcode entry */}
          {!selectedCompany && !result && (
            <form
              onSubmit={handleManualBarcode}
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                alignItems: 'center',
                marginBottom: barcodeNotFound ? 'var(--space-2)' : 'var(--space-4)',
              }}
            >
              <input
                type='text'
                inputMode='numeric'
                pattern='[0-9]*'
                value={manualBarcode}
                onChange={e => {
                  setManualBarcode(e.target.value.replace(/\D/g, '').slice(0, 14))
                  setBarcodeNotFound(null)
                }}
                placeholder='Or enter barcode (UPC/EAN)...'
                aria-label='Enter product barcode (UPC or EAN)'
                style={{
                  flex: 1,
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
                  borderRadius: 'var(--radius-card, 14px)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-base)',
                  letterSpacing: '0.04em',
                  outline: 'none',
                }}
              />
              <button
                type='submit'
                disabled={barcodeLoading || !manualBarcode.trim()}
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  background: manualBarcode.trim()
                    ? 'var(--gradient-accent)'
                    : 'var(--bg-elevated)',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  color: manualBarcode.trim() ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-bold)',
                  cursor: manualBarcode.trim() ? 'pointer' : 'default',
                  opacity: barcodeLoading ? 0.7 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {barcodeLoading ? '...' : 'Look up'}
              </button>
            </form>
          )}

          {/* Persistent barcode not-found state — survives past the toast */}
          {!selectedCompany && !result && barcodeNotFound && (
            <div
              role='status'
              aria-live='polite'
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--space-1-5)',
                flexWrap: 'wrap',
                padding: 'var(--space-2-5) var(--space-3)',
                marginBottom: 'var(--space-4)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              No product found for{' '}
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  letterSpacing: '0.04em',
                }}
              >
                {barcodeNotFound}
              </code>
              . Try searching by name instead.
            </div>
          )}

          {/* Searching spinner */}
          {isSearching && (
            <div
              role='status'
              aria-live='polite'
              style={{ textAlign: 'center', padding: 'var(--space-5)' }}
            >
              <div className='spinner' style={{ width: '24px', height: '24px' }} />
              <span className='sr-only'>Searching...</span>
            </div>
          )}

          {/* Checking state */}
          {isChecking && (
            <div
              role='status'
              aria-live='polite'
              style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-5)' }}
            >
              <div className='spinner' />
              <p
                style={{
                  fontSize: 'var(--text-md)',
                  color: 'var(--text-secondary)',
                  marginTop: 'var(--space-4)',
                }}
              >
                Checking corporate connections...
              </p>
            </div>
          )}

          {/* Result Card */}
          <AnimatePresence mode='wait'>
            {result && !isChecking && (
              <motion.div key={result.hasConflict ? 'conflict' : 'success'} {...springResult}>
                {result.hasConflict ? (
                  <div className='result-card conflict' role='alert'>
                    <motion.div className='result-icon' {...springIcon}>
                      <ShieldAlert size={48} />
                    </motion.div>
                    <h2 className='result-title'>Conflict Found</h2>
                    <p className='result-description'>
                      {selectedCompany?.name} conflicts with your boycotts.
                    </p>

                    {/* Barcode stamp + ownership trace */}
                    {lastScanTypeRef.current === 'barcode' && (
                      <ScanTrace
                        barcode={lastBarcodeRef.current}
                        productName={lastProductRef.current}
                        brandName={lastBrandRef.current}
                        company={selectedCompany}
                      />
                    )}

                    {/* Company enrichment summary */}
                    {companyDetail && <CompanyInsights company={companyDetail} />}

                    {/* Conflict details */}
                    <div
                      style={{
                        background: 'var(--bg-inset, var(--bg-dark))',
                        border: '1px solid var(--border)',
                        padding: 'var(--space-4)',
                        marginTop: 'var(--space-5)',
                        borderRadius: 'var(--radius-md)',
                        textAlign: 'left',
                      }}
                    >
                      <h4 className='subsection-label' style={{ marginBottom: 'var(--space-3)' }}>
                        Conflicts with
                      </h4>
                      {result.conflicts.map((conflict, idx) => {
                        const boycott = allBoycottsForLookup.find(
                          b => b.name === conflict.boycottName
                        )
                        return (
                          <div
                            key={idx}
                            style={{
                              padding: 'var(--space-2-5) 0',
                              borderBottom:
                                idx < result.conflicts.length - 1
                                  ? '1px solid var(--border)'
                                  : 'none',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 'var(--space-2) var(--space-3)',
                              }}
                            >
                              {boycott?.id ? (
                                <Link
                                  to={`/boycott/${boycott.id}`}
                                  style={{
                                    color: 'var(--accent)',
                                    fontWeight: 'var(--font-medium)',
                                    fontSize: 'var(--text-md)',
                                    textDecoration: 'none',
                                  }}
                                  onMouseEnter={e =>
                                    (e.currentTarget.style.textDecoration = 'underline')
                                  }
                                  onMouseLeave={e =>
                                    (e.currentTarget.style.textDecoration = 'none')
                                  }
                                >
                                  {conflict.boycottName}
                                </Link>
                              ) : (
                                <span
                                  style={{
                                    color: 'var(--accent)',
                                    fontWeight: 'var(--font-medium)',
                                    fontSize: 'var(--text-md)',
                                  }}
                                >
                                  {conflict.boycottName}
                                </span>
                              )}
                              <span
                                style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}
                              >
                                ({conflict.reason})
                              </span>
                              {conflict.confidence && (
                                <ConfidenceDot
                                  level={conflict.confidence}
                                  source={
                                    conflict.source
                                      ? SOURCE_LABELS[conflict.source] || conflict.source
                                      : undefined
                                  }
                                  size={8}
                                />
                              )}
                            </div>
                            {boycott?.description && (
                              <p
                                style={{
                                  fontSize: 'var(--text-sm)',
                                  color: 'var(--text-secondary)',
                                  marginTop: 'var(--space-1-5)',
                                  lineHeight: 1.4,
                                  fontStyle: 'italic',
                                }}
                              >
                                {boycott.description}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Sponsored / curated alternatives — shown above the AI option */}
                    {selectedCompany?.id && (
                      <SponsoredAlternatives targetCompanyId={selectedCompany.id} />
                    )}

                    {/* Action buttons */}
                    {!alternatives && !loadingAlternatives && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--space-2-5)',
                          marginTop: 'var(--space-5)',
                        }}
                      >
                        <motion.button
                          className='btn-primary'
                          onClick={fetchAlternatives}
                          whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                          whileTap={prefersReducedMotion ? {} : { scale: 0.97 }}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 'var(--space-2)',
                          }}
                        >
                          <Sparkles size={16} />
                          Find Alternatives
                        </motion.button>
                        <motion.button
                          onClick={async () => {
                            const conflict = result.conflicts[0]
                            const boycott = allBoycottsForLookup.find(
                              b => b.name === conflict?.boycottName
                            )
                            const status = await shareScanResult({
                              companyName: selectedCompany?.name,
                              productName: lastProductRef.current,
                              boycottName: conflict?.boycottName,
                              reason: boycott?.description || conflict?.reason,
                            })
                            if (status === 'shared') {
                              toast.success('Shared!')
                            } else if (status === 'downloaded') {
                              // Desktop fallback: image is saved. Surface the
                              // platform menu so the user has a real path forward.
                              toast.success('Image saved — pick a platform to share')
                              share({
                                url: boycott?.id
                                  ? `${window.location.origin}/boycott/${boycott.id}`
                                  : 'https://boyk.org',
                                type: 'scan',
                                data: {
                                  company_name: selectedCompany?.name,
                                  product_name: lastProductRef.current,
                                  boycott_name: conflict?.boycottName,
                                  reason: boycott?.description || conflict?.reason,
                                },
                              })
                            } else if (status === 'failed') {
                              toast.error("Couldn't generate the share image")
                            }
                          }}
                          whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
                          whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
                          style={{
                            padding: 'var(--space-3) var(--space-4)',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-lg)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          aria-label='Share result'
                        >
                          <Share2 size={18} />
                        </motion.button>
                      </div>
                    )}

                    {/* Loading alternatives */}
                    {loadingAlternatives && (
                      <div
                        role='status'
                        aria-live='polite'
                        style={{
                          textAlign: 'center',
                          padding: 'var(--space-6)',
                          marginTop: 'var(--space-5)',
                        }}
                      >
                        <div className='spinner' style={{ width: '24px', height: '24px' }} />
                        <p
                          style={{
                            fontSize: 'var(--text-md)',
                            color: 'var(--text-muted)',
                            marginTop: 'var(--space-3)',
                          }}
                        >
                          Finding ethical alternatives...
                        </p>
                      </div>
                    )}

                    {/* Alternatives list */}
                    {alternatives?.alternatives && (
                      <div
                        style={{
                          marginTop: 'var(--space-5)',
                          background: 'var(--bg-inset, var(--bg-dark))',
                          border: '1px solid var(--border)',
                          padding: 'var(--space-4)',
                          borderRadius: 'var(--radius-md)',
                        }}
                      >
                        <h4
                          className='subsection-label'
                          style={{
                            marginBottom: 'var(--space-4)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                          }}
                        >
                          <Sparkles size={14} />
                          Recommended Alternatives
                        </h4>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                          }}
                        >
                          {alternatives.alternatives.map((alt, idx) => (
                            <motion.div
                              key={idx}
                              initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                delay: prefersReducedMotion ? 0 : idx * 0.08,
                                type: 'spring',
                                stiffness: 300,
                                damping: 25,
                              }}
                              style={{
                                background: 'var(--bg-card)',
                                padding: 'var(--space-3-5)',
                                borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border)',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 'var(--font-semibold)',
                                  color: 'var(--success)',
                                  marginBottom: 'var(--space-1)',
                                  fontSize: 'var(--text-md)',
                                }}
                              >
                                {alt.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 'var(--text-md)',
                                  color: 'var(--text-secondary)',
                                  marginBottom: 'var(--space-1-5)',
                                }}
                              >
                                {alt.description}
                              </div>
                              <div
                                style={{
                                  fontSize: 'var(--text-xs2)',
                                  color: 'var(--text-muted)',
                                  fontStyle: 'italic',
                                }}
                              >
                                {alt.reason}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                        {alternatives.note && (
                          <p
                            style={{
                              marginTop: 'var(--space-4)',
                              fontSize: 'var(--text-xs2)',
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                              padding: 'var(--space-3)',
                              background: 'var(--bg-card)',
                              borderRadius: 'var(--radius-md)',
                            }}
                          >
                            Note: {alternatives.note}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className='result-card success' role='alert'>
                    <motion.div className='result-icon' {...springIcon}>
                      <ShieldCheck size={48} />
                    </motion.div>
                    <h2 className='result-title'>
                      {user ? 'No Conflicts Found' : 'Product Found'}
                    </h2>
                    <p className='result-description'>
                      {user
                        ? "This brand doesn't conflict with any of your active boycotts."
                        : 'Sign in to check this product against your boycotts.'}
                    </p>
                    {!user && (
                      <Link
                        to='/login'
                        className='btn-primary'
                        style={{ marginTop: 'var(--space-4)', display: 'inline-block' }}
                      >
                        Log In
                      </Link>
                    )}

                    {/* Barcode stamp + ownership trace */}
                    {lastScanTypeRef.current === 'barcode' && (
                      <ScanTrace
                        barcode={lastBarcodeRef.current}
                        productName={lastProductRef.current}
                        brandName={lastBrandRef.current}
                        company={selectedCompany}
                      />
                    )}

                    {/* Company enrichment summary */}
                    {companyDetail && <CompanyInsights company={companyDetail} />}

                    {/* Action buttons */}
                    {user && !alternatives && !loadingAlternatives && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--space-2-5)',
                          marginTop: 'var(--space-5)',
                        }}
                      >
                        <motion.button
                          className='btn-primary'
                          onClick={fetchAlternatives}
                          whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                          whileTap={prefersReducedMotion ? {} : { scale: 0.97 }}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 'var(--space-2)',
                          }}
                        >
                          <Sparkles size={16} />
                          Find Alternatives
                        </motion.button>
                        {selectedCompany && (
                          <motion.button
                            className='btn-danger'
                            onClick={() => setShowCreateBoycott(true)}
                            whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                            whileTap={prefersReducedMotion ? {} : { scale: 0.97 }}
                            style={{
                              flex: 1,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 'var(--space-2)',
                            }}
                          >
                            <Flag size={16} />
                            Boycott this
                          </motion.button>
                        )}
                      </div>
                    )}

                    {/* Loading alternatives */}
                    {loadingAlternatives && (
                      <div
                        role='status'
                        aria-live='polite'
                        style={{
                          textAlign: 'center',
                          padding: 'var(--space-6)',
                          marginTop: 'var(--space-5)',
                        }}
                      >
                        <div className='spinner' style={{ width: '24px', height: '24px' }} />
                        <p
                          style={{
                            fontSize: 'var(--text-md)',
                            color: 'var(--text-muted)',
                            marginTop: 'var(--space-3)',
                          }}
                        >
                          Finding ethical alternatives...
                        </p>
                      </div>
                    )}

                    {/* Alternatives list */}
                    {alternatives?.alternatives && (
                      <div
                        style={{
                          marginTop: 'var(--space-5)',
                          background: 'var(--bg-inset, var(--bg-dark))',
                          border: '1px solid var(--border)',
                          padding: 'var(--space-4)',
                          borderRadius: 'var(--radius-md)',
                        }}
                      >
                        <h4
                          className='subsection-label'
                          style={{
                            marginBottom: 'var(--space-4)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                          }}
                        >
                          <Sparkles size={14} />
                          Recommended Alternatives
                        </h4>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                          }}
                        >
                          {alternatives.alternatives.map((alt, idx) => (
                            <motion.div
                              key={idx}
                              initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                delay: prefersReducedMotion ? 0 : idx * 0.08,
                                type: 'spring',
                                stiffness: 300,
                                damping: 25,
                              }}
                              style={{
                                background: 'var(--bg-card)',
                                padding: 'var(--space-3-5)',
                                borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border)',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 'var(--font-semibold)',
                                  color: 'var(--success)',
                                  marginBottom: 'var(--space-1)',
                                  fontSize: 'var(--text-md)',
                                }}
                              >
                                {alt.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 'var(--text-md)',
                                  color: 'var(--text-secondary)',
                                  marginBottom: 'var(--space-1-5)',
                                }}
                              >
                                {alt.description}
                              </div>
                              <div
                                style={{
                                  fontSize: 'var(--text-xs2)',
                                  color: 'var(--text-muted)',
                                  fontStyle: 'italic',
                                }}
                              >
                                {alt.reason}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                        {alternatives.note && (
                          <p
                            style={{
                              marginTop: 'var(--space-4)',
                              fontSize: 'var(--text-xs2)',
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                              padding: 'var(--space-3)',
                              background: 'var(--bg-card)',
                              borderRadius: 'var(--radius-md)',
                            }}
                          >
                            Note: {alternatives.note}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ODbL attribution — required whenever the lookup came from the
              Open Food Facts index (see boyk-data-etl/tools/off-ingest) */}
          {result &&
            !isChecking &&
            lastScanTypeRef.current === 'barcode' &&
            lastProductSourceRef.current === 'openfoodfacts' && (
              <p
                className='off-attribution'
                style={{
                  fontSize: '0.75rem',
                  opacity: 0.7,
                  textAlign: 'center',
                  marginTop: 'var(--space-2)',
                }}
              >
                Product data from{' '}
                <a href='https://world.openfoodfacts.org' target='_blank' rel='noopener noreferrer'>
                  Open Food Facts
                </a>{' '}
                (
                <a
                  href='https://opendatacommons.org/licenses/odbl/1-0/'
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  ODbL
                </a>
                ) ·{' '}
                <a
                  href='https://cdn.boyk.org/datasets/boyk-off-brand-extract.csv.gz'
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  open extract
                </a>
              </p>
            )}

          {/* USDA FoodData Central is public domain, so no license applies,
              but the product data is theirs, not Open Food Facts'. */}
          {result &&
            !isChecking &&
            lastScanTypeRef.current === 'barcode' &&
            lastProductSourceRef.current === 'usda_fdc' && (
              <p
                className='off-attribution'
                style={{
                  fontSize: '0.75rem',
                  opacity: 0.7,
                  textAlign: 'center',
                  marginTop: 'var(--space-2)',
                }}
              >
                Product data from{' '}
                <a href='https://fdc.nal.usda.gov' target='_blank' rel='noopener noreferrer'>
                  USDA FoodData Central
                </a>
              </p>
            )}

          {/* Barcode Scanner (lazy loaded) */}
          <Suspense fallback={null}>
            <AnimatePresence>
              {showScanner && (
                <BarcodeScanner
                  initialFile={scannerFile}
                  onProductFound={scanResult => {
                    setShowScanner(false)
                    setScannerFile(null)
                    if (scanResult.product) {
                      lastScanTypeRef.current = 'barcode'
                      lastProductRef.current = scanResult.product?.name || null
                      lastProductSourceRef.current = scanResult.product?.source || null
                      lastBarcodeRef.current =
                        scanResult.barcode || scanResult.product?.barcode || null
                      lastBrandRef.current =
                        scanResult.product?.brand_name || scanResult.brand?.name || null
                      const companyToCheck = scanResult.company ||
                        scanResult.brand || { name: scanResult.product.name }
                      if (companyToCheck.id) {
                        handleSelectCompany(companyToCheck)
                      } else {
                        handleSearch(companyToCheck.name)
                      }
                    }
                  }}
                  onClose={() => {
                    setShowScanner(false)
                    setScannerFile(null)
                  }}
                />
              )}
            </AnimatePresence>
          </Suspense>

          {/* Create boycott pre-seeded with the checked company (lazy loaded) */}
          {showCreateBoycott && selectedCompany && (
            <Suspense fallback={null}>
              <CreateBoycottModal
                onClose={() => setShowCreateBoycott(false)}
                initialCompany={selectedCompany}
              />
            </Suspense>
          )}
        </>
      )}
      <ShareMenu state={menuState} onClose={closeMenu} />
    </div>
  )
}
