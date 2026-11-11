/**
 * @component BoycottList
 * @level Organism
 * @interactions
 *   - Renders an animated stagger list of BoycottCard components
 *   - Delegates expand, edit, delete, follow, and proxy actions to parent via callbacks
 *   - Exports BoycottListSkeleton for loading state
 */
import { motion } from 'framer-motion'

import { usePaperPreview } from '../../../hooks/usePaperPreview'
import { staggerContainer, staggerItem } from '../../../lib/animations'
import PaperBoycottCard from '../preview/PaperBoycottCard'
import BoycottCard from './BoycottCard'

/**
 * Animated list of BoycottCards with stagger effect
 */
export default function BoycottList({
  boycotts = [],
  variant = 'public',
  expandedId = null,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleVisibility,
  onRemoveCompany,
  onFollowToggle,
  isFollowingFn,
  proxyExpansion,
  isLoadingFn,
  proxyCountFn,
  disabled = false,
  showCreator = true,
  currentUserId = null,
  emptyMessage = 'No boycotts yet.',
  emptyAction,
}) {
  const paper = usePaperPreview()

  if (boycotts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}
      >
        <p style={{ marginBottom: emptyAction ? 'var(--space-4)' : 0 }}>{emptyMessage}</p>
        {emptyAction}
      </motion.div>
    )
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial='initial'
      animate='animate'
      style={{ display: 'flex', flexDirection: 'column', gap: 0 }}
    >
      {boycotts.map(boycott => {
        const isExpanded = expandedId === boycott.id || expandedId === `followed-${boycott.id}`
        const isFollowing = isFollowingFn?.(boycott.id) || false
        const isLoading = isLoadingFn?.(boycott.id) || false
        const proxyCount = proxyCountFn?.(boycott) || 0

        return (
          <motion.div key={boycott.id} variants={staggerItem} layout>
            {paper ? (
              <PaperBoycottCard
                boycott={boycott}
                isFollowing={isFollowing}
                onFollowToggle={onFollowToggle}
                disabled={disabled || isLoading}
              />
            ) : (
              <BoycottCard
                boycott={boycott}
                variant={variant}
                isExpanded={isExpanded}
                onToggleExpand={() => onToggleExpand?.(boycott.id)}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onRemoveCompany={onRemoveCompany}
                onFollowToggle={onFollowToggle}
                isFollowing={isFollowing}
                proxyExpansion={proxyExpansion}
                isLoading={isLoading}
                proxyCount={proxyCount}
                disabled={disabled}
                showCreator={showCreator}
                currentUserId={currentUserId}
              />
            )}
          </motion.div>
        )
      })}
    </motion.div>
  )
}

/**
 * Skeleton loader for BoycottList
 */
export function BoycottListSkeleton({ count = 3 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className='skeleton skeleton-card' />
      ))}
    </div>
  )
}
