import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { memo, useCallback, useState } from 'react'

import { springBouncy } from '../../lib/animations'

/**
 * @component Expandable
 * @level Molecule
 *
 * @description Collapsible section with animated height transition.
 *
 * @interactions
 * - Click header: Toggles expand/collapse, calls `onToggle(newExpanded)`
 * - Keyboard (Enter/Space on header): Same as click
 *
 * @props
 * - header: ReactNode — Always-visible clickable header content
 * - children: ReactNode — Collapsible content
 * - isExpanded: boolean — Controlled mode (optional)
 * - onToggle: (expanded: boolean) => void — Toggle callback
 * - defaultExpanded: boolean — Initial state for uncontrolled mode (default: false)
 * - animated: boolean — Enable animation (default: true)
 * - showChevron: boolean — Show chevron indicator (default: true)
 * - className: string
 */

const Expandable = memo(function Expandable({
  header,
  children,
  isExpanded,
  onToggle,
  defaultExpanded = false,
  animated = true,
  showChevron = true,
  className = '',
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)

  const expanded = isExpanded !== undefined ? isExpanded : internalExpanded

  const toggle = useCallback(() => {
    const newVal = !expanded
    if (isExpanded === undefined) {
      setInternalExpanded(newVal)
    }
    onToggle?.(newVal)
  }, [expanded, isExpanded, onToggle])

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    },
    [toggle]
  )

  return (
    <div className={className}>
      {/* Header */}
      <div
        role='button'
        tabIndex={0}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          borderRadius: 'var(--radius-md)',
          transition: 'background 0.15s',
        }}
      >
        <div style={{ flex: 1 }}>{header}</div>
        {showChevron && (
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronDown size={16} style={{ color: 'var(--accent)' }} />
          </motion.div>
        )}
      </div>

      {/* Collapsible content */}
      {animated ? (
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              style={{ overflow: 'hidden' }}
              transition={{
                height: springBouncy,
                opacity: { duration: 0.2 },
              }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        expanded && children
      )}
    </div>
  )
})

export { Expandable }
export default Expandable
