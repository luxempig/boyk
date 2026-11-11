import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ShareMenu } from '../components/molecules/ShareMenu'
import EditBoycottModal from '../components/organisms/boycott/EditBoycottModal'
import ConfirmModal from '../components/organisms/ConfirmModal'
import Header from '../components/organisms/Header'
import { useToast } from '../components/organisms/Toast'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useProxyExpansion } from '../hooks/useProxyExpansion'
import { useShare } from '../hooks/useShare'
import BoycottDetailView from './boycott/BoycottDetailView'

export default function BoycottPage() {
  const { boycottId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const {
    publicBoycotts,
    myBoycotts,
    followedBoycotts,
    fetchPublicBoycotts,
    loadingState,
    hasAdoptedBoycott,
    adoptBoycott,
    unadoptBoycott,
    deleteBoycott,
  } = useApp()
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  useEffect(() => {
    if (publicBoycotts.length === 0 && !loadingState.publicBoycotts) {
      fetchPublicBoycotts()
    }
  }, [publicBoycotts.length, loadingState.publicBoycotts, fetchPublicBoycotts])

  // Effects run in declaration order, so by the time this flips the fetch
  // kick-off above has already raised its loading flag. Gating "not found" on
  // `hasMounted` means it can never flash on a deep link's first paint, before
  // the fetch has had a chance to start.
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])

  const boycott =
    publicBoycotts.find(b => b.id === boycottId) ||
    myBoycotts.find(b => b.id === boycottId) ||
    followedBoycotts.find(b => b.id === boycottId)
  // `initial` covers the AppProvider's first load on cold deep links, where the
  // per-list flags haven't been raised yet on the very first render.
  const anyBoycottsLoading =
    loadingState.initial ||
    loadingState.publicBoycotts ||
    loadingState.myBoycotts ||
    loadingState.followedBoycotts
  const isLoading = anyBoycottsLoading && !boycott
  // Only declare "not found" once the fetches have actually settled.
  const isFetched = hasMounted && !anyBoycottsLoading
  // Memoize so the array identity is stable across renders — an inline literal
  // would re-fire useProxyExpansion's autoFetch effect every render (the loading
  // state it toggles re-renders the page), creating a busy loop.
  const boycottsForProxy = useMemo(() => (boycott ? [boycott] : []), [boycott])
  const proxyExpansion = useProxyExpansion(boycottsForProxy, { autoFetch: true })

  const handleFollowToggle = async () => {
    if (!user) {
      navigate('/login')
      return
    }
    if (hasAdoptedBoycott(boycottId)) {
      await unadoptBoycott(boycottId)
    } else {
      await adoptBoycott(boycottId)
    }
  }

  const handleEdit = e => {
    e.stopPropagation()
    setIsEditing(true)
  }
  const handleDelete = e => {
    e.stopPropagation()
    setIsConfirmingDelete(true)
  }
  const confirmDelete = async () => {
    try {
      await deleteBoycott(boycottId)
      toast.success('Boycott deleted')
      navigate('/feed')
    } catch (err) {
      toast.error('Failed to delete boycott')
      console.error(err)
    } finally {
      setIsConfirmingDelete(false)
    }
  }

  const handleNavigateNetwork = () => {
    navigate(`/network?boycott=${boycottId}`, { state: { boycottId } })
  }

  const { share, menuState, closeMenu } = useShare()

  const handleShare = () => {
    share({
      url: `${window.location.origin}/boycott/${boycottId}`,
      title: boycott?.name ? `${boycott.name} — Boyk` : 'Boyk',
      type: 'boycott',
      data: {
        name: boycott?.name,
        description: boycott?.description,
        adopter_count: boycott?.adopter_count,
      },
    })
  }

  // Proxy companies = subsidiaries of directly-blocked companies that aren't
  // themselves directly blocked. Exclude the directly-blocked ids so they're
  // not double-counted. Populates once useProxyExpansion prefetches.
  const directlyBlockedIds = new Set(
    (boycott?.boycott_companies || boycott?.companies || [])
      .map(e => e.companies?.id || e.company_id)
      .filter(Boolean)
  )
  const proxyCount =
    boycott && proxyExpansion?.countTotalProxyForBoycott
      ? proxyExpansion.countTotalProxyForBoycott(boycott, directlyBlockedIds)
      : 0

  return (
    <div className='container'>
      <Header pageLabel='Boycott' />

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
          <div className='spinner' />
        </div>
      )}

      {isFetched && !boycott && (
        <div style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
            Boycott not found
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>
            This boycott may have been deleted or made private.
          </p>
          <Link
            to='/explore'
            className='btn-primary'
            style={{ display: 'inline-block', marginTop: 'var(--space-4)' }}
          >
            Browse boycotts
          </Link>
        </div>
      )}

      {boycott && (
        <section style={{ marginBottom: '100px' }}>
          <BoycottDetailView
            boycott={boycott}
            currentUserId={user?.id}
            isFollowing={hasAdoptedBoycott(boycott.id)}
            onFollowToggle={handleFollowToggle}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onNavigateNetwork={handleNavigateNetwork}
            onShare={handleShare}
            proxyCount={proxyCount}
            countSeedProxies={proxyExpansion.countProxyCompanies}
          />
        </section>
      )}
      {isEditing && boycott && (
        <EditBoycottModal boycott={boycott} onClose={() => setIsEditing(false)} />
      )}
      {isConfirmingDelete && (
        <ConfirmModal
          isOpen={true}
          title='Delete boycott?'
          message='This cannot be undone.'
          confirmText='Delete'
          danger
          onConfirm={confirmDelete}
          onClose={() => setIsConfirmingDelete(false)}
        />
      )}
      <ShareMenu state={menuState} onClose={closeMenu} />
    </div>
  )
}
