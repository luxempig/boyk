import { motion } from 'framer-motion'
import { Newspaper, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import ComposeBar from '../components/molecules/ComposeBar'
import LiveTicker from '../components/molecules/LiveTicker'
import SuggestedUsers from '../components/molecules/SuggestedUsers'
import ComposeModal from '../components/organisms/feed/ComposeModal'
import PostList from '../components/organisms/feed/PostList'
import UpdatesList from '../components/organisms/feed/UpdatesList'
import Header from '../components/organisms/Header'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useFollowedUpdates } from '../hooks/useBoycottUpdates'
import { useFeed, useMarkFeedRead } from '../hooks/useFeedQueries'
import { staggerItem } from '../lib/animations'

// Curated seed list surfaced to new users on the Feed empty state. Keep it
// short so the page doesn't become a browse view — the point is to get a
// new account to follow *someone* so the feed has content on next load.
const SUGGESTED_USERNAMES = ['boyka', 'luxempig', 'shajara']

// Lists bleed to the viewport edge; empty states stay within container padding.
const fullBleed = {
  marginLeft: 'calc(-1 * var(--space-5))',
  marginRight: 'calc(-1 * var(--space-5))',
}

export default function Feed() {
  const { user } = useAuth()
  const { following } = useApp()
  const [showCompose, setShowCompose] = useState(false)
  const [tab, setTab] = useState('posts')

  const feed = useFeed()
  const updates = useFollowedUpdates()
  const markRead = useMarkFeedRead()

  // Mark feed as read on mount
  useEffect(() => {
    if (user) {
      markRead.mutate()
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore scroll position when returning from post detail
  useEffect(() => {
    const savedY = sessionStorage.getItem('feed-scroll-y')
    if (savedY) {
      sessionStorage.removeItem('feed-scroll-y')
      requestAnimationFrame(() => window.scrollTo(0, parseInt(savedY, 10)))
    }
  }, [])
  const posts = feed.data?.pages?.flat() || []
  const isEmpty = !feed.isLoading && posts.length === 0

  return (
    <div className='container'>
      <Header pageLabel='Feed' />

      {posts.length > 0 && (
        <LiveTicker
          items={posts
            .slice(0, 5)
            .map(p => `@${p.author?.username || p.profiles?.username || 'user'} posted`)}
          style={{ marginBottom: 'var(--space-3)' }}
        />
      )}

      {user && (
        <ComposeBar
          avatarSrc={user.user_metadata?.avatar_url}
          avatarName={user.user_metadata?.display_name || user.email}
          placeholder="What's happening?"
          onClick={() => setShowCompose(true)}
          style={{ marginBottom: 'var(--space-4)' }}
        />
      )}

      <div
        role='tablist'
        aria-label='Feed sections'
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          borderBottom: '1px solid var(--border)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <FeedTab active={tab === 'posts'} onClick={() => setTab('posts')}>
          Posts
        </FeedTab>
        <FeedTab active={tab === 'updates'} onClick={() => setTab('updates')}>
          Updates
        </FeedTab>
      </div>

      <section style={{ marginBottom: '100px' }}>
        {tab === 'posts' ? (
          <>
            {isEmpty && following.length === 0 && user && (
              <motion.div
                {...staggerItem}
                style={{ padding: 'var(--space-6) var(--space-5) var(--space-4)' }}
              >
                <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
                  <UserPlus
                    size={40}
                    strokeWidth={1}
                    style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}
                  />
                  <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-1)' }}>
                    Your feed is empty
                  </h2>
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-md)',
                    }}
                  >
                    Start by following a few people
                  </p>
                </div>
                <SuggestedUsers usernames={SUGGESTED_USERNAMES} />
                <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
                  <Link
                    to='/explore?mode=users'
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-muted)',
                      textDecoration: 'underline',
                    }}
                  >
                    Browse all users
                  </Link>
                </div>
              </motion.div>
            )}

            {isEmpty && following.length > 0 && user && (
              <motion.div
                {...staggerItem}
                style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-5)' }}
              >
                <Newspaper
                  size={40}
                  strokeWidth={1}
                  style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}
                />
                <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
                  No posts yet
                </h2>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    marginBottom: 'var(--space-5)',
                    fontSize: 'var(--text-md)',
                  }}
                >
                  People you follow haven&apos;t posted yet. Be the first!
                </p>
                <motion.button
                  className='btn-primary'
                  onClick={() => setShowCompose(true)}
                  whileTap={{ scale: 0.95 }}
                >
                  Create a Post
                </motion.button>
              </motion.div>
            )}

            {isEmpty && !user && (
              <motion.div
                {...staggerItem}
                style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-5)' }}
              >
                <Newspaper
                  size={40}
                  strokeWidth={1}
                  style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}
                />
                <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
                  Welcome to the Feed
                </h2>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    marginBottom: 'var(--space-5)',
                    fontSize: 'var(--text-md)',
                  }}
                >
                  Sign in to follow users and see their posts here.
                </p>
                <Link to='/login' className='btn-primary'>
                  Log In
                </Link>
              </motion.div>
            )}

            <div style={fullBleed}>
              <PostList
                data={feed.data}
                fetchNextPage={feed.fetchNextPage}
                hasNextPage={feed.hasNextPage}
                isFetchingNextPage={feed.isFetchingNextPage}
                isLoading={feed.isLoading}
              />
            </div>
          </>
        ) : (
          <div style={fullBleed}>
            <UpdatesList
              data={updates.data}
              fetchNextPage={updates.fetchNextPage}
              hasNextPage={updates.hasNextPage}
              isFetchingNextPage={updates.isFetchingNextPage}
              isLoading={updates.isLoading}
              isError={updates.isError}
              refetch={updates.refetch}
            />
          </div>
        )}
      </section>

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}
    </div>
  )
}

function FeedTab({ active, onClick, children }) {
  return (
    <button
      type='button'
      role='tab'
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: 'var(--space-2-5) var(--space-3)',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        fontSize: 'var(--text-sm)',
        fontWeight: active ? 'var(--font-semibold)' : 'var(--font-medium)',
        cursor: 'pointer',
        marginBottom: '-1px',
      }}
    >
      {children}
    </button>
  )
}
