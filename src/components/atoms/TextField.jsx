import React, { memo, useMemo, useState } from 'react'

/**
 * @component TextField
 * @level Atom
 *
 * @description Text input or textarea with optional character counter, label, and error state.
 *
 * @interactions
 * - Type: Updates value via `onChange`. Auto-truncates at `maxLength` if set.
 * - Focus: Shows accent-colored border highlight
 * - Blur: Returns to default border
 *
 * @props
 * - value: string — Current input value
 * - onChange: (value: string) => void — Value change handler (receives string, not event)
 * - maxLength: number — Max characters (optional)
 * - rows: number — Textarea rows (renders textarea when > 1, input when 1 or omitted)
 * - placeholder: string
 * - showCounter: boolean — Show remaining character count
 * - label: string — Label text above input
 * - error: string — Error message below input (turns border red)
 * - disabled: boolean
 * - className: string
 * - autoFocus: boolean
 * - onKeyDown: (e: KeyboardEvent) => void — Key handler (e.g., Cmd+Enter to submit)
 */

const TextField = memo(
  React.forwardRef(function TextField(
    {
      value = '',
      onChange,
      maxLength,
      rows,
      placeholder,
      showCounter = false,
      label,
      error,
      disabled = false,
      className = '',
      autoFocus = false,
      onKeyDown,
    },
    ref
  ) {
    const [focused, setFocused] = useState(false)

    const isTextarea = rows && rows > 1

    const borderColor = error ? 'var(--danger)' : focused ? 'var(--accent)' : 'var(--border)'

    const inputStyle = useMemo(
      () => ({
        width: '100%',
        background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid',
        borderColor,
        borderRadius: 'var(--radius-card, 14px)',
        padding: 'var(--space-3)',
        color: 'var(--text-primary)',
        fontSize: 'var(--text-md)',
        fontFamily: 'inherit',
        outline: 'none',
        resize: isTextarea ? 'vertical' : undefined,
        opacity: disabled ? 0.5 : 1,
        boxShadow: focused ? '0 0 0 3px rgba(244,114,182,0.15)' : undefined,
      }),
      [borderColor, isTextarea, disabled, focused]
    )

    const handleChange = e => {
      const raw = e.target.value
      onChange?.(maxLength ? raw.slice(0, maxLength) : raw)
    }

    const charsLeft = maxLength ? maxLength - value.length : null
    const showCharCounter = showCounter && maxLength && charsLeft !== null && charsLeft < 200

    const sharedProps = {
      ref,
      value,
      onChange: handleChange,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      placeholder,
      disabled,
      autoFocus,
      onKeyDown,
      style: inputStyle,
    }

    return (
      <div className={className}>
        {label && (
          <label
            style={{
              fontFamily: 'var(--font-heading)',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              fontSize: 'var(--text-xs)',
              marginBottom: 'var(--space-1-5)',
              display: 'block',
              color: 'rgba(244,114,182,0.6)',
            }}
          >
            {label}
          </label>
        )}

        {isTextarea ? (
          <textarea rows={rows} {...sharedProps} />
        ) : (
          <input type='text' {...sharedProps} />
        )}

        {error && (
          <div
            style={{
              color: 'var(--danger)',
              fontSize: 'var(--text-sm)',
              marginTop: 'var(--space-1)',
            }}
          >
            {error}
          </div>
        )}

        {showCharCounter && (
          <div
            style={{
              textAlign: 'right',
              fontSize: 'var(--text-sm)',
              marginTop: 'var(--space-1)',
              color: charsLeft < 50 ? 'var(--danger)' : 'var(--text-muted)',
            }}
          >
            {charsLeft}
          </div>
        )}
      </div>
    )
  })
)

export { TextField }
export default TextField
