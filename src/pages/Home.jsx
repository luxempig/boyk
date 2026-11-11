import { motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { BoycottList, BoycottListSkeleton } from '../components/organisms/boycott'
import { CreateBoycottModal } from '../components/organisms/boycott'
import { EditBoycottModal } from '../components/organisms/boycott'
import ConfirmModal from '../components/organisms/ConfirmModal'
import { ComposeModal, PostCard } from '../components/organisms/feed'
import Header from '../components/organisms/Header'
import OnboardingModal, { shouldShowOnboarding } from '../components/organisms/OnboardingModal'
import {
  FollowerFollowingModal,
  ProfileEditModal,
  ProfileHeader,
  ProfileHeaderSkeleton,
} from '../components/organisms/profile'
import { useToast } from '../components/organisms/Toast'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useDeletePost, useLikePost, useUserPosts } from '../hooks/useFeedQueries'
import { useProxyExpansion } from '../hooks/useProxyExpansion'
import { uploadProfilePicture } from '../lib/s3'
import { supabase } from '../lib/supabase'

export default function Home() {
  const { user, loading: authLoading } = useAuth()

  // Redirect unauthenticated users to explore
  if (!authLoading && !user) {
    return <Navigate to='/feed' replace />
  }

  return <HomeContent />
}

function HomeContent() {
  const { user } = useAuth()
  const toast = useToast()
  const { myBoycotts, followedBoycotts, deleteBoycott, removeCompanyFromBoycott, loading } =
    useApp()

  // UI State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPostModal, setShowPostModal] = useState(false)
  const [expandedBoycott, setExpandedBoycott] = useState(null)
  const [editingBoycott, setEditingBoycott] = useState(null)
  const [activeTab, setActiveTab] = useState('created')
  const [activeModal, setActiveModal] = useState(null)
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: null, data: null })
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Check for onboarding on mount
  useEffect(() => {
    if (!user) return
    if (!loading && shouldShowOnboarding(myBoycotts, followedBoycotts)) {
      // Delay slightly to let profile load first
      const timer = setTimeout(() => setShowOnboarding(true), 500)
      return () => clearTimeout(timer)
    }
  }, [user, loading, myBoycotts, followedBoycotts])

  // Profile State
  const [profile, setProfile] = useState(null)
  const [followerCount, setFollowerCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [followers, setFollowers] = useState([])
  const [followingList, setFollowingList] = useState([])

  // Proxy expansion for owned boycotts
  const ownedProxyExpansion = useProxyExpansion(myBoycotts, { autoFetch: true, keyPrefix: '' })
  // Proxy expansion for followed boycotts
  const followedProxyExpansion = useProxyExpansion(followedBoycotts, {
    autoFetch: true,
    keyPrefix: 'followed-',
  })

  // All directly blocked company IDs for proxy counting
  const directlyBlockedIds = useMemo(() => {
    const ids = new Set()
    ;[...myBoycotts, ...followedBoycotts].forEach(boycott => {
      ;(boycott.boycott_companies || []).forEach(entry => {
        if (entry.companies?.id) ids.add(entry.companies.id)
      })
    })
    return ids
  }, [myBoycotts, followedBoycotts])

  // Fetch profile and follow data
  useEffect(() => {
    const fetchData = async () => {
      if (!user) return

      const [profileRes, followerCountRes, followingCountRes, followersRes, followingRes] =
        await Promise.all([
          supabase.rpc('get_profile', { p_user_id: user.id }),
          supabase.rpc('get_follower_count', { p_user_id: user.id }),
          supabase.rpc('get_following_count', { p_user_id: user.id }),
          supabase.rpc('get_followers', { p_user_id: user.id }),
          supabase.rpc('get_following_with_profiles', { p_user_id: user.id }),
        ])

      const profileData = profileRes.data?.[0] || null
      setProfile(profileData)
      setFollowerCount(followerCountRes.data || 0)
      setFollowingCount(followingCountRes.data || 0)
      setFollowers(followersRes.data || [])
      setFollowingList(followingRes.data || [])
    }

    fetchData()
    // Key on user?.id, not the user object: Supabase mints a new user object on
    // every token refresh, which would otherwise re-run these 5 RPCs needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Prefetch proxy data when boycott expands
  const followedPrefetchRef = useRef(followedProxyExpansion.prefetchBoycottProxies)
  const ownedPrefetchRef = useRef(ownedProxyExpansion.prefetchBoycottProxies)
  useEffect(() => {
    followedPrefetchRef.current = followedProxyExpansion.prefetchBoycottProxies
  }, [followedProxyExpansion.prefetchBoycottProxies])
  useEffect(() => {
    ownedPrefetchRef.current = ownedProxyExpansion.prefetchBoycottProxies
  }, [ownedProxyExpansion.prefetchBoycottProxies])
  useEffect(() => {
    if (!expandedBoycott) return

    const isTracked = expandedBoycott.startsWith('followed-')
    const boycottId = isTracked ? expandedBoycott.replace('followed-', '') : expandedBoycott
    const boycottList = isTracked ? followedBoycotts : myBoycotts
    const boycott = boycottList.find(b => b.id === boycottId)

    if (boycott) {
      if (isTracked) {
        followedPrefetchRef.current(boycott)
      } else {
        ownedPrefetchRef.current(boycott)
      }
    }
  }, [expandedBoycott, myBoycotts, followedBoycotts])

  // Handlers
  const handleDeleteBoycott = (e, boycottId) => {
    e.stopPropagation()
    setConfirmModal({ isOpen: true, type: 'deleteBoycott', data: { boycottId } })
  }

  const confirmDeleteBoycott = async () => {
    try {
      await deleteBoycott(confirmModal.data.boycottId)
      setExpandedBoycott(null)
      toast.success('Boycott deleted successfully')
    } catch (error) {
      toast.error(error.message || 'Failed to delete boycott')
    }
  }

  const handleRemoveCompany = (e, boycottId, companyId) => {
    e.stopPropagation()
    setConfirmModal({ isOpen: true, type: 'removeCompany', data: { boycottId, companyId } })
  }

  const confirmRemoveCompany = async () => {
    try {
      await removeCompanyFromBoycott(confirmModal.data.boycottId, confirmModal.data.companyId)
      toast.success('Company removed from boycott')
    } catch (error) {
      toast.error(error.message || 'Failed to remove company')
    }
  }

  const handleSaveProfile = async data => {
    const { error } = await supabase.rpc('update_full_profile', {
      p_username: data.username,
      p_display_name: data.display_name,
      p_bio: data.bio,
      p_profile_picture_url: data.profile_picture_url,
    })

    if (error) throw error

    setProfile(prev => ({ ...prev, ...data }))
    toast.success('Profile updated')
  }

  const handleUploadPicture = async file => {
    return await uploadProfilePicture(user.id, file)
  }

  // User posts for Posts tab
  const userPosts = useUserPosts(user?.id)
  const likePost = useLikePost()
  const deletePostMutation = useDeletePost()

  // Stats for ProfileHeader
  const stats = [
    { key: 'created', value: myBoycotts.length, label: 'boycotts', accent: true },
    { key: 'added', value: followedBoycotts.length, label: 'added' },
    { key: 'followers', value: followerCount, label: 'followers' },
    { key: 'following', value: followingCount, label: 'following' },
  ]

  const handleStatClick = key => {
    if (key === 'created') setActiveTab('created')
    else if (key === 'added') setActiveTab('added')
    else if (key === 'followers') setActiveModal('followers')
    else if (key === 'following') setActiveModal('following')
  }

  // Loading
  if (loading) {
    return (
      <div className='container'>
        <Header pageLabel='My Profile' />
        <ProfileHeaderSkeleton />
        <BoycottListSkeleton count={3} />
      </div>
    )
  }

  return (
    <div className='container'>
      <Header pageLabel='My Profile' />

      <ProfileHeader
        profile={profile}
        user={user}
        isOwnProfile={true}
        stats={stats}
        onEditProfile={() => {
          if (!user) {
            toast.info('Please sign in to edit your profile')
            return
          }
          setActiveModal('editProfile')
        }}
        onCreateBoycott={() => {
          if (!user) {
            toast.info('Please sign in to create a boycott')
            return
          }
          setShowCreateModal(true)
        }}
        onCreatePost={() => {
          if (!user) {
            toast.info('Please sign in to create a post')
            return
          }
          setShowPostModal(true)
        }}
        onStatClick={handleStatClick}
      />

      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '0',
          marginBottom: 'var(--space-4)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {['created', 'added', 'posts'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: 'var(--space-3)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-medium)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            {tab === 'created' && `My Boycotts (${myBoycotts.length})`}
            {tab === 'added' && `Following (${followedBoycotts.length})`}
            {tab === 'posts' && 'Posts'}
          </button>
        ))}
      </div>

      {/* My Boycotts Tab */}
      {activeTab === 'created' && (
        <motion.section initial='initial' animate='animate' style={{ marginBottom: '100px' }}>
          <BoycottList
            boycotts={myBoycotts}
            variant='owned'
            expandedId={expandedBoycott}
            onToggleExpand={id => setExpandedBoycott(expandedBoycott === id ? null : id)}
            onEdit={(e, boycott) => {
              e.stopPropagation()
              setEditingBoycott(boycott)
            }}
            onDelete={handleDeleteBoycott}
            onRemoveCompany={handleRemoveCompany}
            proxyExpansion={ownedProxyExpansion}
            isLoadingFn={id => ownedProxyExpansion.isBoycottLoading(id)}
            proxyCountFn={boycott =>
              ownedProxyExpansion.countTotalProxyForBoycott(boycott, directlyBlockedIds)
            }
            emptyMessage="You haven't created any boycotts yet."
            emptyAction={
              <motion.button
                className='btn-primary'
                onClick={() => {
                  if (!user) {
                    toast.info('Please sign in to create a boycott')
                    return
                  }
                  setShowCreateModal(true)
                }}
                whileTap={{ scale: 0.95 }}
              >
                Create Your First Boycott
              </motion.button>
            }
          />
        </motion.section>
      )}

      {/* Following Tab */}
      {activeTab === 'added' && (
        <motion.section initial='initial' animate='animate' style={{ marginBottom: '100px' }}>
          <BoycottList
            boycotts={followedBoycotts}
            variant='followed'
            expandedId={expandedBoycott}
            onToggleExpand={id =>
              setExpandedBoycott(expandedBoycott === `followed-${id}` ? null : `followed-${id}`)
            }
            proxyExpansion={followedProxyExpansion}
            isLoadingFn={id => followedProxyExpansion.isBoycottLoading(id)}
            proxyCountFn={boycott =>
              followedProxyExpansion.countTotalProxyForBoycott(boycott, directlyBlockedIds)
            }
            showCreator={true}
            emptyMessage="You haven't added any boycotts yet."
            emptyAction={
              <Link to='/explore' className='btn-primary'>
                Explore Boycotts
              </Link>
            }
          />
        </motion.section>
      )}

      {/* Posts Tab */}
      {activeTab === 'posts' && (
        <motion.section
          initial='initial'
          animate='animate'
          style={{
            marginBottom: '100px',
            marginLeft: 'calc(-1 * var(--space-5))',
            marginRight: 'calc(-1 * var(--space-5))',
          }}
        >
          {userPosts.isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  className='skeleton'
                  style={{ height: '140px', borderRadius: 'var(--radius-xl)' }}
                />
              ))}
            </div>
          ) : (userPosts.data?.pages?.flat() || []).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-5)' }}>
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-md)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                You haven&apos;t posted anything yet.
              </p>
              <Link to='/feed' className='btn-primary'>
                Go to Feed
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(userPosts.data?.pages?.flat() || []).map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onLike={likePost.mutate}
                  onDelete={deletePostMutation.mutate}
                  isDeleting={
                    deletePostMutation.isPending && deletePostMutation.variables === post.id
                  }
                />
              ))}
            </div>
          )}
        </motion.section>
      )}

      {/* Modals */}
      {showCreateModal && <CreateBoycottModal onClose={() => setShowCreateModal(false)} />}
      {showPostModal && <ComposeModal onClose={() => setShowPostModal(false)} />}
      {editingBoycott && (
        <EditBoycottModal
          boycott={editingBoycott}
          onClose={() => setEditingBoycott(null)}
          onDelete={async boycottId => {
            try {
              await deleteBoycott(boycottId)
              setEditingBoycott(null)
              toast.success('Boycott deleted')
            } catch (error) {
              toast.error(error.message || 'Failed to delete boycott')
            }
          }}
        />
      )}

      <ProfileEditModal
        isOpen={activeModal === 'editProfile'}
        onClose={() => setActiveModal(null)}
        profile={profile}
        onSave={handleSaveProfile}
        onUploadPicture={handleUploadPicture}
      />

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

      {/* Confirm Modals */}
      <ConfirmModal
        isOpen={confirmModal.isOpen && confirmModal.type === 'deleteBoycott'}
        onClose={() => setConfirmModal({ isOpen: false, type: null, data: null })}
        onConfirm={confirmDeleteBoycott}
        title='Delete Boycott'
        message='Are you sure you want to delete this boycott? This action cannot be undone.'
        confirmText='Delete'
        danger
      />
      <ConfirmModal
        isOpen={confirmModal.isOpen && confirmModal.type === 'removeCompany'}
        onClose={() => setConfirmModal({ isOpen: false, type: null, data: null })}
        onConfirm={confirmRemoveCompany}
        title='Remove Company'
        message='Remove this company from the boycott?'
        confirmText='Remove'
        danger
      />
      {/* Onboarding Modal for New Users */}
      <OnboardingModal isOpen={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </div>
  )
}
