import { useQuery } from '@tanstack/react-query'

import { supabase } from '../lib/supabase'

// Fetch users by followers (cached)
export function useUsersByFollowers(limit = 50) {
  return useQuery({
    queryKey: ['usersByFollowers', limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_users_by_followers', { p_limit: limit })
      if (error) throw error
      return data || []
    },
    staleTime: 1000 * 60 * 2,
  })
}
