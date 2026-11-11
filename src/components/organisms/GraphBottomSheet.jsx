/**
 * @component GraphBottomSheet
 * @level Organism
 * @interactions
 *   - Slide-up panel for node details in graph view
 *   - Drag down to dismiss, click backdrop to close, Escape key to close
 *   - View Company and Add to Boycott action buttons
 */
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, Plus } from 'lucide-react'

import { useFocusTrap } from '../../hooks/useFocusTrap'
import { sheetSlide } from '../../lib/animations'
import { glassOverlay } from '../../lib/glassStyles'
import Avatar from '../atoms/Avatar'
import { Badge } from '../atoms/Badge'
import Button from '../atoms/Button'

export default function GraphBottomSheet({
  isOpen,
  onClose,
  node,
  onViewCompany,
  onAddToBoycott,
  className,
}) {
  const focusTrapRef = useFocusTrap(isOpen && !!node)
  if (!node) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.3)',
              zIndex: 200,
            }}
          />

          {/* Sheet */}
          <motion.div
            ref={focusTrapRef}
            role='dialog'
            aria-modal='true'
            aria-label={node?.name || 'Node details'}
            className={className}
            {...sheetSlide}
            drag='y'
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) onClose()
            }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              ...glassOverlay,
              borderRadius: '20px 20px 0 0',
              padding: 'var(--space-4) var(--space-5) var(--space-6)',
              zIndex: 201,
              maxHeight: '50vh',
              overflowY: 'auto',
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
            }}
            tabIndex={-1}
          >
            {/* Drag handle */}
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.2)',
                margin: '0 auto var(--space-4)',
              }}
            />

            {/* Node info */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <Avatar src={node.logoUrl} name={node.name || '?'} size='lg' variant='company' />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'Sora, sans-serif',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.name}
                </div>
                {node.subtitle && (
                  <div
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-muted)',
                      marginTop: 'var(--space-0-5)',
                    }}
                  >
                    {node.subtitle}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  {node.source && (
                    <Badge type='activity' value={node.source} color='var(--accent)' size='sm' />
                  )}
                  {node.confidence != null && (
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-1)',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background:
                            node.confidence > 0.7
                              ? '#34d399'
                              : node.confidence > 0.4
                                ? '#fbbf24'
                                : '#fb7185',
                          display: 'inline-block',
                        }}
                      />
                      {Math.round(node.confidence * 100)}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <Button
                variant='primary'
                rounded
                onClick={() => onViewCompany?.(node.id)}
                icon={<ExternalLink size={16} />}
                style={{ flex: 1 }}
              >
                View Company
              </Button>
              <Button
                variant='secondary'
                rounded
                onClick={() => onAddToBoycott?.(node)}
                icon={<Plus size={16} />}
                style={{ flex: 1 }}
              >
                Add to Boycott
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
