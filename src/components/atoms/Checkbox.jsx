import { memo, useMemo } from 'react'

/**
 * @component Checkbox
 * @level Atom
 *
 * @description Styled checkbox with label. Used for block type toggles in boycott modals
 * and option selections.
 *
 * @interactions
 * - Click (label or checkbox): Toggles checked state, calls `onChange(newValue)`
 *
 * @props
 * - label: string — Display text next to checkbox
 * - checked: boolean — Current state
 * - onChange: (checked: boolean) => void — State change handler
 * - disabled: boolean — Grays out, blocks interaction
 * - description: string — Optional secondary text below label
 * - className: string
 */

const Checkbox = memo(function Checkbox({
  label,
  checked = false,
  onChange,
  disabled = false,
  description,
  className = '',
}) {
  const labelStyle = useMemo(
    () => ({
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }),
    [disabled]
  )

  const boxStyle = useMemo(
    () => ({
      width: 'var(--space-4)',
      height: 'var(--space-4)',
      borderRadius: '4px',
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
      ...(checked
        ? {
            background: 'var(--accent-fill)',
            border: '1px solid transparent',
            boxShadow: '0 0 0 1px var(--border-accent)',
          }
        : {
            background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
            border: '1px solid var(--glass-card-border, rgba(255,255,255,0.08))',
          }),
    }),
    [checked, disabled]
  )

  const handleKeyDown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled) onChange?.(!checked)
    }
  }

  return (
    <div className={className}>
      <label style={labelStyle}>
        {/* Hidden native checkbox for form compatibility */}
        <input
          type='checkbox'
          checked={checked}
          onChange={e => onChange?.(e.target.checked)}
          disabled={disabled}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
          tabIndex={-1}
          aria-hidden='true'
        />
        {/* Custom styled checkbox */}
        <div
          role='checkbox'
          aria-checked={checked}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={handleKeyDown}
          onClick={() => !disabled && onChange?.(!checked)}
          style={boxStyle}
        >
          {checked && (
            <svg
              width='10'
              height='8'
              viewBox='0 0 10 8'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M1 4L3.5 6.5L9 1'
                stroke='white'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          )}
        </div>
        <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>{label}</span>
      </label>
      {description && (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            marginLeft: 'var(--space-6)',
            marginTop: 'var(--space-0-5)',
          }}
        >
          {description}
        </div>
      )}
    </div>
  )
})

export { Checkbox }
export default Checkbox
