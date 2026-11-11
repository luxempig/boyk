import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { deleteCommentWithMedia } from '../lib/s3'
import { supabase } from '../lib/supabase'
import { useMutationErrorToast } from './useMutationErrorToast'

export function useBoycottComments(boycottId) {
  return useQuery({
    queryKey: ['boycott-comments', boycottId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_boycott_comments', {
        p_boycott_id: boycottId,
      })
      if (error) throw error
      return data || []
    },
    enabled: !!boycottId,
    staleTime: 30_000,
  })
}

export function useAddBoycottComment(boycottId) {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast('Could not post comment.')

  return useMutation({
    mutationFn: async ({ content, label = null, mediaUrl = null, mediaType = null }) => {
      const { data, error } = await supabase.rpc('add_boycott_comment', {
        p_boycott_id: boycottId,
        p_content: content,
        p_label: label,
        p_media_url: mediaUrl,
        p_media_type: mediaType,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boycott-comments', boycottId] })
    },
    onError,
  })
}

export function useDeleteBoycottComment(boycottId) {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast('Could not delete comment.')

  return useMutation({
    mutationFn: async commentId => {
      // Single edge-function call does both the DB delete (with ownership
      // check via auth.uid() inside the RPC) and the R2 cleanup. We never
      // hand a media URL across the trust boundary.
      await deleteCommentWithMedia(commentId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boycott-comments', boycottId] })
    },
    onError,
  })
}
