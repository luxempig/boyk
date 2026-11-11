import { useQuery } from '@tanstack/react-query'

import { supabase } from '../lib/supabase'

/**
 * Returns sponsored + organic alternatives for a target company.
 * Each row has alternative_company_id (Neo4j ID), is_sponsored, display_priority, pitch.
 * The caller hydrates display data (name, logo) from Neo4j.
 */
export function useProductAlternatives(targetCompanyId) {
  return useQuery({
    queryKey: ['product-alternatives', targetCompanyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_alternatives_for_company', {
        p_target_company_id: targetCompanyId,
      })
      if (error) throw error
      return data || []
    },
    enabled: !!targetCompanyId,
    staleTime: 60_000,
  })
}
