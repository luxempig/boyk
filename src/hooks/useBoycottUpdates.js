import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useMutationErrorToast } from './useMutationErrorToast'

const PAGE_SIZE = 20

export function useFollowedUpdates() {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: ['boycott-updates', 'followed', user?.id ?? null],
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('get_my_followed_updates', {
        p_cursor: pageParam,
        p_limit: PAGE_SIZE,
      })
      if (error) throw error
      return data || []
    },
    initialPageParam: null,
    getNextPageParam: lastPage =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1].created_at,
    staleTime: 30_000,
    // gcTime: 0 so the previous user's cache entry is dropped the moment the
    // hook unmounts on sign-out, preventing a flash of their followed-updates
    // when a different user signs in. The query key is also user-scoped so
    // even without this the data wouldn't surface — but belt-and-suspenders.
    gcTime: 0,
    enabled: !!user,
  })
}

export function useCreateBoycottUpdate() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast('Could not post update.')

  return useMutation({
    mutationFn: async ({ boycottId, summary }) => {
      const { data, error } = await supabase.rpc('create_boycott_update', {
        p_boycott_id: boycottId,
        p_summary: summary,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boycott-updates', 'followed'] })
    },
    onError,
  })
}
