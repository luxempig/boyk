import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export function useConversations() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_conversations')
      if (error) throw error
      return data || []
    },
    enabled: !!user,
    staleTime: 0,
  })
}

export function useMessages(conversationId) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  useEffect(() => {
    if (!conversationId || !user) return

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, user, queryClient])

  return useQuery({
    queryKey: ['messages', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_messages', {
        p_conversation_id: conversationId,
        p_limit: 50,
      })
      if (error) throw error
      return (data || []).reverse()
    },
    enabled: !!conversationId && !!user,
    staleTime: 10_000,
  })
}

export function useSendMessage(conversationId) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async content => {
      const { data, error } = await supabase.rpc('send_message', {
        p_conversation_id: conversationId,
        p_content: content,
      })
      if (error) throw error
      return data
    },
    onMutate: async content => {
      await queryClient.cancelQueries({ queryKey: ['messages', conversationId] })
      const previous = queryClient.getQueryData(['messages', conversationId])

      queryClient.setQueryData(['messages', conversationId], old => [
        ...(old || []),
        {
          id: `optimistic-${Date.now()}`,
          conversation_id: conversationId,
          sender_id: user?.id,
          content,
          created_at: new Date().toISOString(),
          read_at: null,
          sender_username: '',
          sender_display_name: '',
          sender_profile_picture_url: null,
        },
      ])

      return { previous }
    },
    onError: (_err, _content, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['messages', conversationId], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useGetOrCreateConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async otherUserId => {
      const { data, error } = await supabase.rpc('get_or_create_conversation', {
        p_other_user_id: otherUserId,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useUnreadCount() {
  const conversations = useConversations()
  const data = conversations.data || []
  return data.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0)
}
