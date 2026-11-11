/**
 * @component PostList
 * @level Organism
 * @interactions Infinite scroll pagination, delegates like/delete/repost to PostCard
 */
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef } from 'react'

import {
  useDeletePost,
  useLikePost,
  useRepostPost,
  useUnrepostPost,
} from '../../../hooks/useFeedQueries'
import { usePaperPreview } from '../../../hooks/usePaperPreview'
import PaperPostCard from '../preview/PaperPostCard'
import PostCard from './PostCard'

export default function PostList({
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
}) {
  const sentinelRef = useRef(null)
  const likePost = useLikePost()
  const deletePost = useDeletePost()
  const repostPost = useRepostPost()
  const unrepostPost = useUnrepostPost()
  const paper = usePaperPreview()

  const handleObserver = useCallback(
    entries => {
      const [entry] = entries
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  )

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const observer = new IntersectionObserver(handleObserver, {
      rootMargin: '200px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [handleObserver])

  const posts = data?.pages?.flat() || []

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className='skeleton'
            style={{ height: '140px', borderRadius: 'var(--radius-xl)' }}
          />
        ))}
      </div>
    )
  }

  if (posts.length === 0) {
    return null // Parent handles empty state
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <AnimatePresence mode='popLayout'>
        {posts.map(post =>
          paper ? (
            <PaperPostCard key={post.id} post={post} onLike={likePost.mutate} />
          ) : (
            <PostCard
              key={post.id}
              post={post}
              onLike={likePost.mutate}
              onDelete={deletePost.mutate}
              isDeleting={deletePost.isPending && deletePost.variables === post.id}
              onRepost={repostPost.mutate}
              onUnrepost={unrepostPost.mutate}
            />
          )
        )}
      </AnimatePresence>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: '1px' }} />

      {isFetchingNextPage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4)' }}
        >
          <div className='spinner' style={{ width: '20px', height: '20px' }} />
        </motion.div>
      )}
    </div>
  )
}
