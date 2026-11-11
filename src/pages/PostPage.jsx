import { useParams } from 'react-router-dom'

import PostCard from '../components/organisms/feed/PostCard'
import Header from '../components/organisms/Header'
import {
  useDeletePost,
  useLikePost,
  usePost,
  useRepostPost,
  useUnrepostPost,
} from '../hooks/useFeedQueries'

export default function PostPage() {
  const { postId } = useParams()
  const { data: post, isLoading, error } = usePost(postId)
  const likePost = useLikePost()
  const deletePost = useDeletePost()
  const repostPost = useRepostPost()
  const unrepostPost = useUnrepostPost()

  return (
    <div className='container'>
      <Header pageLabel='Post' />

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
          <div className='spinner' />
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-5)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
            Failed to load post
          </p>
        </div>
      )}

      {!isLoading && !error && !post && (
        <div style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
            Post not found
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
            This post may have been deleted.
          </p>
        </div>
      )}

      {post && (
        <section style={{ marginBottom: '100px' }}>
          <PostCard
            post={post}
            variant='detail'
            onLike={likePost.mutate}
            onDelete={deletePost.mutate}
            isDeleting={deletePost.isPending && deletePost.variables === post.id}
            onRepost={repostPost.mutate}
            onUnrepost={unrepostPost.mutate}
          />
        </section>
      )}
    </div>
  )
}
