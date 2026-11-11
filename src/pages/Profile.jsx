import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import ModePillToggle from '../components/molecules/ModePillToggle'
import { BoycottList } from '../components/organisms/boycott'
import { PostList } from '../components/organisms/feed'
import Header from '../components/organisms/Header'
import {
  FollowerFollowingModal,
  ProfileEditModal,
  ProfileHeader,
  ProfileHeaderSkeleton,
} from '../components/organisms/profile'
import { useToast } from '../components/organisms/Toast'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useUserPosts } from '../hooks/useFeedQueries'
import { useProxyExpansion } from '../hooks/useProxyExpansion'
import { useSafeState } from '../hooks/useSafeState'
import { uploadProfilePicture } from '../lib/s3'
import { supabase } from '../lib/supabase'

const CreateBoycottModal = lazy(() => import('../components/organisms/boycott/CreateBoycottModal'))
const ComposeModal = lazy(() => import('../components/organisms/feed/ComposeModal'))

export default function Profile() {
  const { userId } = useParams()
  const { user: currentUser } = useAuth()
  const toast = useToast()
  const { safeSetState } = useSafeState()
  const {
    followUser,
    unfollowUser,
    following,
    adoptBoycott,
    unadoptBoycott,
    hasAdoptedBoycott,
    myBoycotts,
  } = useApp()
  const queryClient = useQueryClient()

  const [profile, setProfile] = useState(null)
  const [boycotts, setBoycotts] = useState([])
  const [followedUserBoycotts, setFollowedUserBoycotts] = useState([])
  const [followers, setFollowers] = useState([])
  const [followingList, setFollowingList] = useState([])
  const [followerCount, setFollowerCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeModal, setActiveModal] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showCreateBoycott, setShowCreateBoycott] = useState(false)
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [expandedBoycott, setExpandedBoycott] = useState(null)

  const [profileTab, setProfileTab] = useState('boycotts')

  // User posts
  const userPostsQuery = useUserPosts(userId)

  const isFollowing = following.some(f => f.id === userId)
  const isOwnProfile = currentUser?.id === userId

  // For own profile, use AppContext boycotts (stays in sync after create/edit/delete).
  // Merge in the fetched profile so cards can render name/handle/avatar
  // instead of falling back to "Unknown user".
  const displayBoycotts =
    isOwnProfile && profile
      ? myBoycotts.map(b => ({
          ...b,
          profiles: b.profiles || {
            id: profile.id,
            username: profile.username,
            display_name: profile.display_name,
            profile_picture_url: profile.profile_picture_url,
          },
        }))
      : isOwnProfile
        ? myBoycotts
        : boycotts

  // Proxy expansion for profile boycotts
  const proxyExpansion = useProxyExpansion(displayBoycotts, { autoFetch: false })

  // Prefetch proxy data when boycott expands
  const prefetchRef = useRef(proxyExpansion.prefetchBoycottProxies)
  useEffect(() => {
    prefetchRef.current = proxyExpansion.prefetchBoycottProxies
  }, [proxyExpansion.prefetchBoycottProxies])
  useEffect(() => {
    if (!expandedBoycott) return
    const boycott = displayBoycotts.find(b => b.id === expandedBoycott)
    if (boycott) prefetchRef.current(boycott)
  }, [expandedBoycott, displayBoycotts])

  useEffect(() => {
    const fetchProfile = async () => {
      safeSetState(setLoading, true)

      try {
        const { data: profileData, error: profileError } = await supabase.rpc('get_profile', {
          p_user_id: userId,
        })

        if (profileError || !profileData || profileData.length === 0) {
          safeSetState(setLoading, false)
          return
        }

        const creatorProfile = profileData[0]
        safeSetState(setProfile, creatorProfile)

        // Fetch public boycotts. Attach the creator profile so cards can
        // render "@username" instead of falling back to "@user".
        const { data: allBoycotts } = await supabase.rpc('get_my_boycotts', { p_user_id: userId })
        const publicBoycotts = (allBoycotts || []).filter(b => b.is_public)
        publicBoycotts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        safeSetState(
          setBoycotts,
          publicBoycotts.map(b => ({
            ...b,
            tracker_count: b.tracker_count || 0,
            profiles: b.profiles || {
              id: creatorProfile.id,
              username: creatorProfile.username,
              display_name: creatorProfile.display_name,
              profile_picture_url: creatorProfile.profile_picture_url,
            },
          }))
        )

        // Fetch followed boycotts
        const { data: followedData } = await supabase.rpc('get_followed_boycotts', {
          p_user_id: userId,
        })
        if (followedData && followedData.length > 0) {
          const creatorIds = [...new Set(followedData.map(b => b.creator_id))]
          const { data: creatorProfiles } = await supabase.rpc('get_profiles_by_ids', {
            p_ids: creatorIds,
          })
          const profilesMap = {}
          ;(creatorProfiles || []).forEach(p => {
            profilesMap[p.id] = p
          })
          safeSetState(
            setFollowedUserBoycotts,
            followedData.map(b => ({
              ...b,
              profiles: profilesMap[b.creator_id] || { username: 'unknown' },
            }))
          )
        } else {
          safeSetState(setFollowedUserBoycotts, [])
        }

        // Fetch followers and following (allSettled so partial failures don't block)
        const [followersRes, followerCountRes, followingRes, followingCountRes] =
          await Promise.allSettled([
            supabase.rpc('get_followers', { p_user_id: userId }),
            supabase.rpc('get_follower_count', { p_user_id: userId }),
            supabase.rpc('get_following_with_profiles', { p_user_id: userId }),
            supabase.rpc('get_following_count', { p_user_id: userId }),
          ])

        const val = (res, fallback) =>
          res.status === 'fulfilled' ? (res.value.data ?? fallback) : fallback
        safeSetState(setFollowers, val(followersRes, []))
        safeSetState(setFollowerCount, val(followerCountRes, 0))
        safeSetState(setFollowingList, val(followingRes, []))
        safeSetState(setFollowingCount, val(followingCountRes, 0))
      } catch {
        toast.error('Failed to load profile')
      } finally {
        safeSetState(setLoading, false)
      }
    }

    if (userId) fetchProfile()
  }, [userId, safeSetState, toast])

  const handleFollowToggle = async () => {
    if (!currentUser) {
      toast.info('Please sign in to follow users')
      return
    }
    if (actionLoading) return

    safeSetState(setActionLoading, true)
    try {
      if (isFollowing) {
        await unfollowUser(userId)
        toast.success(`Unfollowed @${profile?.username}`)
      } else {
        await followUser(userId)
        toast.success(`Now following @${profile?.username}`)
      }
      // Invalidate feed so followed/unfollowed user's posts appear/disappear
      queryClient.invalidateQueries({ queryKey: ['feed', 'timeline'] })
    } catch (error) {
      toast.error(error.message || 'Failed to update follow status')
    } finally {
      safeSetState(setActionLoading, false)
    }
  }

  const handleBoycottToggle = async (e, boycott) => {
    e?.stopPropagation()
    if (!currentUser) {
      toast.info('Please sign in to add boycotts')
      return
    }
    if (actionLoading) return

    safeSetState(setActionLoading, true)
    try {
      if (hasAdoptedBoycott(boycott.id)) {
        await unadoptBoycott(boycott.id)
        toast.success(`Removed "${boycott.name}" from your boycotts`)
      } else {
        await adoptBoycott(boycott.id)
        toast.success(`Added "${boycott.name}" to your boycotts`)
      }
    } catch (error) {
      toast.error(error.message || 'Failed to update boycott')
    } finally {
      safeSetState(setActionLoading, false)
    }
  }

  // Profile editing handlers
  const handleSaveProfile = async updates => {
    try {
      const { error } = await supabase.rpc('update_full_profile', {
        p_username: updates.username,
        p_display_name: updates.display_name,
        p_bio: updates.bio,
        p_profile_picture_url: updates.profile_picture_url,
      })
      if (error) throw error

      // Update local state
      setProfile(prev => ({ ...prev, ...updates }))
      toast.success('Profile updated')
    } catch (error) {
      console.error('Failed to update profile:', error)
      toast.error('Failed to update profile')
      throw error
    }
  }

  const handleUploadPicture = async file => {
    try {
      const url = await uploadProfilePicture(currentUser.id, file)
      return url
    } catch (error) {
      console.error('Failed to upload picture:', error)
      toast.error('Failed to upload picture')
      throw error
    }
  }

  // Stats for ProfileHeader
  const stats = [
    { key: 'followers', value: followerCount, label: 'followers' },
    { key: 'following', value: followingCount, label: 'following' },
    { key: 'boycotts', value: displayBoycotts.length, label: 'boycotts', accent: true },
    { key: 'followed', value: followedUserBoycotts.length, label: 'added' },
  ]

  const handleStatClick = key => {
    if (key === 'followers') setActiveModal('followers')
    else if (key === 'following') setActiveModal('following')
    else if (key === 'boycotts') setActiveModal('boycotts')
    else if (key === 'followed') setActiveModal('followed')
  }

  if (loading) {
    return (
      <div className='container'>
        <Header pageLabel='Profile' />
        <ProfileHeaderSkeleton />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className='skeleton skeleton-card' />
          <div className='skeleton skeleton-card' />
        </div>
      </div>
    )
  }

  if (!profile) {
    const isOwnBrokenSession = currentUser && currentUser.id === userId
    return (
      <div className='container'>
        <Header pageLabel='Profile' />
        <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-5)' }}>
          {isOwnBrokenSession ? (
            <>
              <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
                Session expired — please sign in again.
              </p>
              <Link to='/login' style={{ color: 'var(--accent)', display: 'inline-block' }}>
                Sign in
              </Link>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)' }}>User not found</p>
              <Link
                to='/explore'
                style={{
                  color: 'var(--accent)',
                  marginTop: 'var(--space-4)',
                  display: 'inline-block',
                }}
              >
                Back to Explore
              </Link>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className='container'>
      <Header pageLabel='Profile' />

      <ProfileHeader
        profile={profile}
        isOwnProfile={isOwnProfile}
        isFollowing={isFollowing}
        actionLoading={actionLoading}
        stats={stats}
        onEditProfile={() => setShowEditModal(true)}
        onCreateBoycott={() => setShowCreateBoycott(true)}
        onCreatePost={() => setShowCreatePost(true)}
        onFollowToggle={handleFollowToggle}
        onStatClick={handleStatClick}
        messageLink={!isOwnProfile && currentUser ? `/messages?user=${userId}` : undefined}
      />

      {/* Tab Navigation */}
      {!activeModal && (
        <>
          <ModePillToggle
            options={[
              { key: 'boycotts', label: 'Boycotts' },
              { key: 'posts', label: 'Posts' },
            ]}
            activeKey={profileTab}
            onChange={setProfileTab}
            style={{ marginBottom: 'var(--space-4)' }}
          />

          {/* Boycotts Tab */}
          {profileTab === 'boycotts' && (
            <motion.div initial='initial' animate='animate'>
              <div
                style={{
                  fontSize: 'var(--text-xs2)',
                  textTransform: 'uppercase',
                  letterSpacing: '2px',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-3)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Recent Boycotts</span>
                {displayBoycotts.length > 3 && (
                  <motion.button
                    onClick={() => setActiveModal('boycotts')}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent)',
                      fontSize: 'var(--text-xs2)',
                      cursor: 'pointer',
                      minHeight: '44px',
                      padding: 'var(--space-3)',
                    }}
                  >
                    See all
                  </motion.button>
                )}
              </div>

              <section style={{ marginBottom: '100px' }}>
                <BoycottList
                  boycotts={displayBoycotts.slice(0, 3)}
                  variant='public'
                  expandedId={expandedBoycott}
                  onToggleExpand={id => setExpandedBoycott(expandedBoycott === id ? null : id)}
                  onFollowToggle={!isOwnProfile ? handleBoycottToggle : undefined}
                  isFollowingFn={hasAdoptedBoycott}
                  proxyExpansion={proxyExpansion}
                  isLoadingFn={id => proxyExpansion.isBoycottLoading(id)}
                  proxyCountFn={boycott => proxyExpansion.countTotalProxyForBoycott(boycott)}
                  showCreator={false}
                  emptyMessage='No public boycotts yet.'
                />
              </section>
            </motion.div>
          )}

          {/* Posts Tab */}
          {profileTab === 'posts' && (
            <motion.section
              initial='initial'
              animate='animate'
              style={{
                marginBottom: '100px',
                marginLeft: 'calc(-1 * var(--space-5))',
                marginRight: 'calc(-1 * var(--space-5))',
              }}
            >
              {(userPostsQuery.data?.pages?.flat() || []).length === 0 &&
              !userPostsQuery.isLoading ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-5)' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
                    No posts yet.
                  </p>
                </div>
              ) : (
                <PostList
                  data={userPostsQuery.data}
                  fetchNextPage={userPostsQuery.fetchNextPage}
                  hasNextPage={userPostsQuery.hasNextPage}
                  isFetchingNextPage={userPostsQuery.isFetchingNextPage}
                  isLoading={userPostsQuery.isLoading}
                />
              )}
            </motion.section>
          )}
        </>
      )}

      {/* Modals */}
      <FollowerFollowingModal
        isOpen={activeModal === 'followers'}
        onClose={() => setActiveModal(null)}
        type='followers'
        users={followers}
      />

      <FollowerFollowingModal
        isOpen={activeModal === 'following'}
        onClose={() => setActiveModal(null)}
        type='following'
        users={followingList}
      />

      {/* Boycotts Modal */}
      {activeModal === 'boycotts' && (
        <div
          className='modal-overlay'
          role='dialog'
          aria-modal='true'
          onClick={e => {
            if (e.target === e.currentTarget) setActiveModal(null)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setActiveModal(null)
          }}
        >
          <div className='modal' style={{ maxHeight: '80vh' }}>
            <div className='modal-header'>
              <h2 className='modal-title'>Boycotts Created</h2>
              <button className='close-btn' onClick={() => setActiveModal(null)}>
                &times;
              </button>
            </div>
            <div className='modal-body' style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <BoycottList
                boycotts={displayBoycotts}
                variant='public'
                expandedId={expandedBoycott}
                onToggleExpand={id => setExpandedBoycott(expandedBoycott === id ? null : id)}
                onFollowToggle={!isOwnProfile ? handleBoycottToggle : undefined}
                isFollowingFn={hasAdoptedBoycott}
                proxyExpansion={proxyExpansion}
                isLoadingFn={id => proxyExpansion.isBoycottLoading(id)}
                proxyCountFn={boycott => proxyExpansion.countTotalProxyForBoycott(boycott)}
                showCreator={false}
                emptyMessage='No boycotts created yet'
              />
            </div>
          </div>
        </div>
      )}

      {/* Followed Boycotts Modal */}
      {activeModal === 'followed' && (
        <div
          className='modal-overlay'
          role='dialog'
          aria-modal='true'
          onClick={e => {
            if (e.target === e.currentTarget) setActiveModal(null)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setActiveModal(null)
          }}
        >
          <div className='modal' style={{ maxHeight: '80vh' }}>
            <div className='modal-header'>
              <h2 className='modal-title'>Added</h2>
              <button className='close-btn' onClick={() => setActiveModal(null)}>
                &times;
              </button>
            </div>
            <div className='modal-body' style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <BoycottList
                boycotts={followedUserBoycotts}
                variant='followed'
                expandedId={expandedBoycott}
                onToggleExpand={id => setExpandedBoycott(expandedBoycott === id ? null : id)}
                showCreator={true}
                emptyMessage='No added boycotts yet'
              />
            </div>
          </div>
        </div>
      )}

      {/* Profile Edit Modal */}
      {isOwnProfile && (
        <ProfileEditModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          profile={profile}
          onSave={handleSaveProfile}
          onUploadPicture={handleUploadPicture}
        />
      )}

      {showCreateBoycott && (
        <Suspense fallback={null}>
          <CreateBoycottModal onClose={() => setShowCreateBoycott(false)} />
        </Suspense>
      )}
      {showCreatePost && (
        <Suspense fallback={null}>
          <ComposeModal onClose={() => setShowCreatePost(false)} />
        </Suspense>
      )}
    </div>
  )
}
