import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import Avatar from '../components/atoms/Avatar'
import Header from '../components/organisms/Header'
import { ChatView, ConversationList } from '../components/organisms/messages'
import { useAuth } from '../context/AuthContext'
import { useGetOrCreateConversation } from '../hooks/useMessages'
import { supabase } from '../lib/supabase'

export default function Messages() {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const [activeConversation, setActiveConversation] = useState(null)
  const getOrCreate = useGetOrCreateConversation()

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const searchTimerRef = useRef(null)

  const deepLinkUserId = searchParams.get('user')

  useEffect(() => {
    if (!deepLinkUserId || !user) return

    const init = async () => {
      try {
        const conversationId = await getOrCreate.mutateAsync(deepLinkUserId)
        const { data: profileData } = await supabase.rpc('get_profile', {
          p_user_id: deepLinkUserId,
        })
        const profile = profileData?.[0]
        setActiveConversation({
          conversation_id: conversationId,
          other_user_id: deepLinkUserId,
          other_username: profile?.username || '',
          other_display_name: profile?.display_name || null,
          other_profile_picture_url: profile?.profile_picture_url || null,
        })
      } catch (err) {
        console.error('Failed to open conversation:', err)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkUserId, user])

  // Debounced user search
  const handleSearch = useCallback(
    query => {
      setSearchQuery(query)
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

      if (!query.trim()) {
        setSearchResults([])
        setSearching(false)
        return
      }

      setSearching(true)
      searchTimerRef.current = setTimeout(async () => {
        try {
          const { data, error } = await supabase.rpc('search_users', {
            p_query: query.trim(),
            p_limit: 10,
          })
          if (error) throw error
          // Filter out self
          setSearchResults((data || []).filter(u => u.id !== user?.id))
        } catch (err) {
          console.error('Search failed:', err)
          setSearchResults([])
        } finally {
          setSearching(false)
        }
      }, 300)
    },
    [user?.id]
  )

  const handleSelectUser = async selectedUser => {
    try {
      const conversationId = await getOrCreate.mutateAsync(selectedUser.id)
      setActiveConversation({
        conversation_id: conversationId,
        other_user_id: selectedUser.id,
        other_username: selectedUser.username || '',
        other_display_name: selectedUser.display_name || null,
        other_profile_picture_url: selectedUser.profile_picture_url || null,
      })
      setSearchQuery('')
      setSearchResults([])
    } catch (err) {
      console.error('Failed to open conversation:', err)
    }
  }

  if (loading) {
    return (
      <div className='container'>
        <Header pageLabel='Messages' />
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-12)' }}>
          <div className='spinner' />
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to='/login' replace />
  }

  return (
    <div
      className='container'
      style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}
    >
      <Header pageLabel={activeConversation ? 'Chat' : 'Messages'} />

      {activeConversation ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <button
            onClick={() => setActiveConversation(null)}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              padding: 'var(--space-2) var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            ← All Messages
          </button>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatView conversation={activeConversation} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Search bar */}
          <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-2) var(--space-3)',
              }}
            >
              <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type='text'
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                placeholder='Search users to message...'
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-base)',
                  outline: 'none',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setSearchResults([])
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Search results */}
          {searchQuery.trim() ? (
            <div>
              {searching ? (
                <div
                  style={{
                    padding: 'var(--space-6)',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div
                  style={{
                    padding: 'var(--space-6)',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  No users found
                </div>
              ) : (
                searchResults.map(u => (
                  <button
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      width: '100%',
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <Avatar
                      src={u.profile_picture_url}
                      name={u.display_name || u.username}
                      size='lg'
                    />
                    <div>
                      <div
                        style={{
                          fontWeight: 'var(--font-medium)',
                          fontSize: 'var(--text-base)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {u.display_name || `@${u.username}`}
                      </div>
                      {u.display_name && (
                        <div
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          @{u.username}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <ConversationList
              onSelect={conv => setActiveConversation(conv)}
              activeId={activeConversation?.conversation_id}
            />
          )}
        </div>
      )}
    </div>
  )
}
