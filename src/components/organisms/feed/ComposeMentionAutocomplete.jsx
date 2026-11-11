import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { searchCompanies } from '../../../services/neo4jGraph'

/**
 * Floating dropdown that suggests companies to mention.
 *
 * Parent passes `query` (the current @-prefix text the user is typing) and
 * `onPick(company)`. We debounce the query, hit Neo4j search, and render up
 * to 6 results. Empty when query is shorter than 2 chars.
 */
export default function ComposeMentionAutocomplete({ query, anchor, onPick, onClose }) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const trimmed = (query || '').trim()
    if (trimmed.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const data = await searchCompanies(trimmed, 6)
        if (cancelled) return
        setResults(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  if (!query || query.length < 1) return null

  const showHint = query.trim().length < 2
  const showEmpty = !showHint && !loading && results.length === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      style={{
        position: 'absolute',
        top: anchor?.top ?? 0,
        left: anchor?.left ?? 0,
        width: anchor?.width ?? 320,
        maxWidth: 'calc(100% - 32px)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 30,
        overflow: 'hidden',
      }}
      role='listbox'
    >
      <div
        style={{
          padding: '6px var(--space-3)',
          fontSize: 'var(--text-2xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          fontWeight: 'var(--font-bold)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Tag a company</span>
        <button
          type='button'
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-xs2)',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          esc
        </button>
      </div>
      {showHint && (
        <div
          style={{
            padding: 'var(--space-2-5) var(--space-3)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          Keep typing a company name…
        </div>
      )}
      {loading && !showHint && (
        <div
          style={{
            padding: 'var(--space-2-5) var(--space-3)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          Searching…
        </div>
      )}
      {showEmpty && (
        <div
          style={{
            padding: 'var(--space-2-5) var(--space-3)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          No matches.
        </div>
      )}
      {!loading && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {results.map(c => (
            <button
              key={c.id}
              type='button'
              role='option'
              aria-selected={false}
              onClick={() => onPick(c)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2-5)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {c.logo_url ? (
                <img
                  src={c.logo_url}
                  alt={c.name}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 'var(--radius-xs)',
                    objectFit: 'contain',
                    background: '#fff',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 'var(--radius-xs)',
                    background: 'var(--accent)',
                    color: 'var(--text-on-accent, #fff)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    fontWeight: 'var(--font-bold)',
                    flexShrink: 0,
                  }}
                >
                  {(c.name || '?')[0].toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--font-semibold)',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </div>
                {c.country && (
                  <div
                    style={{
                      fontSize: 'var(--text-xs2)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {c.country}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  )
}
