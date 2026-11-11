import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * @component DebounceSearch
 * @level Molecule
 *
 * @description Search input with debounced callback. Shows search icon, loading state,
 * and clear button.
 *
 * @interactions
 * - Type: Updates value immediately. After `delay` ms of no typing, fires `onSearch(value)`.
 * - Click clear (X): Resets value, fires `onSearch('')`
 *
 * @props
 * - onSearch: (query: string) => void — Debounced search callback
 * - delay: number — Debounce ms (default: 300)
 * - placeholder: string — Input placeholder
 * - loading: boolean — Shows spinner instead of clear button
 * - value: string — Controlled value (optional, for external control)
 * - onChange: (value: string) => void — Immediate value change (optional)
 * - inputRef: React.Ref — Optional ref to the input element
 * - className: string
 */

export default function DebounceSearch({
  onSearch,
  delay = 300,
  placeholder = 'Search...',
  loading = false,
  value,
  onChange,
  inputRef,
  className = '',
}) {
  // Use controlled value directly when provided, internal state otherwise
  const [internalValue, setInternalValue] = useState(value ?? '')
  const displayValue = value !== undefined ? value : internalValue
  const isFirstRender = useRef(true)

  // Debounced search callback
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const timer = setTimeout(() => {
      onSearch(displayValue)
    }, delay)

    return () => clearTimeout(timer)
  }, [displayValue, delay, onSearch])

  const handleChange = e => {
    const val = e.target.value
    if (value === undefined) {
      setInternalValue(val)
    }
    onChange?.(val)
  }

  const handleClear = () => {
    if (value === undefined) {
      setInternalValue('')
    }
    onChange?.('')
    onSearch('')
  }

  return (
    <div className={className} style={{ position: 'relative', width: '100%' }}>
      {/* Search icon */}
      <Search
        size={16}
        style={{
          position: 'absolute',
          left: 'var(--space-2-5)',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--accent, #f472b6)',
          pointerEvents: 'none',
        }}
      />

      <input
        type='text'
        ref={inputRef}
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card, 14px)',
          padding: 'var(--space-2-5) var(--space-9) var(--space-2-5) var(--space-9)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-md)',
          fontFamily: 'inherit',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onFocus={e => {
          e.target.style.borderColor = 'var(--accent)'
          e.target.style.boxShadow = '0 0 0 3px rgba(244,114,182,0.15)'
        }}
        onBlur={e => {
          e.target.style.borderColor = 'var(--border)'
          e.target.style.boxShadow = 'none'
        }}
      />

      {/* Right side: loading spinner, clear button, or nothing */}
      {loading && (
        <div
          className='spinner'
          style={{
            width: 14,
            height: 14,
            position: 'absolute',
            right: 'var(--space-2-5)',
            top: '50%',
            transform: 'translateY(-50%)',
          }}
        />
      )}
      {!loading && internalValue && (
        <button
          onClick={handleClear}
          aria-label='Clear search'
          style={{
            position: 'absolute',
            right: 'var(--space-2-5)',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: 'var(--space-0-5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export { DebounceSearch }
