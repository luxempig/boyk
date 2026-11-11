import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../context/AuthContext'
import { DEMO_MODE } from '../lib/demo'
import { getAccessToken, supabase, supabaseUrl } from '../lib/supabase'

const feedKeys = {
  timeline: ['feed', 'timeline'],
  user: userId => ['feed', 'user', userId],
  post: postId => ['feed', 'post', postId],
  replies: postId => ['feed', 'replies', postId],
  unreadCount: ['feed', 'unread-count'],
  linkPreview: url => ['feed', 'link-preview', url],
}

// Shared staleTime: feed data is fresh for 30s before refetching
const FEED_STALE_TIME = 30_000

// Fetch feed timeline (posts from followed users + own posts)
export function useFeed() {
  const { user } = useAuth()

  return useInfiniteQuery({
    queryKey: feedKeys.timeline,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('get_feed', {
        p_cursor: pageParam || null,
        p_limit: 20,
      })
      if (error) throw error
      return data || []
    },
    initialPageParam: null,
    getNextPageParam: lastPage => {
      if (!lastPage || lastPage.length < 20) return undefined
      return lastPage[lastPage.length - 1].created_at
    },
    enabled: !!user || DEMO_MODE,
    staleTime: FEED_STALE_TIME,
  })
}

// Fetch posts by a specific user
export function useUserPosts(userId) {
  return useInfiniteQuery({
    queryKey: feedKeys.user(userId),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('get_user_posts', {
        p_user_id: userId,
        p_cursor: pageParam || null,
        p_limit: 20,
      })
      if (error) throw error
      return data || []
    },
    initialPageParam: null,
    getNextPageParam: lastPage => {
      if (!lastPage || lastPage.length < 20) return undefined
      return lastPage[lastPage.length - 1].created_at
    },
    enabled: !!userId,
    staleTime: FEED_STALE_TIME,
  })
}

// Fetch a single post by ID
export function usePost(postId) {
  return useQuery({
    queryKey: feedKeys.post(postId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_post', {
        p_post_id: postId,
      })
      if (error) throw error
      return data
    },
    enabled: !!postId,
    staleTime: FEED_STALE_TIME,
  })
}

// Create a new post
export function useCreatePost() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({
      content,
      postType = 'text',
      boycottId = null,
      originalPostId = null,
      mediaUrl = null,
      mediaType = null,
      linkUrl = null,
      mediaUrls = null,
      audience = 'everyone',
      companyMentions = null,
    }) => {
      const { data, error } = await supabase.rpc('create_post', {
        p_content: content || null,
        p_post_type: postType,
        p_boycott_id: boycottId,
        p_original_post_id: originalPostId,
        p_media_url: mediaUrl,
        p_media_type: mediaType,
        p_link_url: linkUrl,
        p_media_urls: mediaUrls,
        p_audience: audience,
        p_company_mentions: companyMentions,
      })
      if (error) throw error
      return data
    },
    // Optimistic: prepend new post to feed immediately
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey: feedKeys.timeline })
      const previous = queryClient.getQueryData(feedKeys.timeline)

      if (user) {
        const optimisticPost = {
          id: `optimistic-${Date.now()}`,
          author_id: user.id,
          post_type: variables.postType || 'text',
          content: variables.content || null,
          boycott_id: variables.boycottId || null,
          original_post_id: variables.originalPostId || null,
          media_url: variables.mediaUrl || null,
          media_type: variables.mediaType || null,
          link_url: variables.linkUrl || null,
          like_count: 0,
          reply_count: 0,
          repost_count: 0,
          created_at: new Date().toISOString(),
          liked_by_me: false,
          author: {
            id: user.id,
            username: user.user_metadata?.username || user.email?.split('@')[0] || 'you',
            display_name: user.user_metadata?.display_name || null,
            profile_picture_url: user.user_metadata?.profile_picture_url || null,
          },
          boycott: variables._boycottData || null,
          _optimistic: true,
        }

        queryClient.setQueryData(feedKeys.timeline, old => {
          if (!old) return { pages: [[optimisticPost]], pageParams: [null] }
          return {
            ...old,
            pages: [[optimisticPost, ...old.pages[0]], ...old.pages.slice(1)],
          }
        })
      }

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(feedKeys.timeline, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: feedKeys.timeline })
      queryClient.invalidateQueries({ queryKey: ['feed', 'user'] })
      queryClient.invalidateQueries({ queryKey: ['feed', 'post'] })
    },
  })
}

// Like a post
export function useLikePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, liked }) => {
      if (liked) {
        const { error } = await supabase.rpc('unlike_post', { p_post_id: postId })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('like_post', { p_post_id: postId })
        if (error) throw error
      }
      return { postId, liked: !liked }
    },
    // Optimistic update
    onMutate: async ({ postId, liked }) => {
      // Cancel in-flight queries for both list-shaped feeds and the detail page.
      await queryClient.cancelQueries({ queryKey: feedKeys.timeline })
      await queryClient.cancelQueries({ queryKey: feedKeys.post(postId) })

      // List-shaped (infinite query) caches: timeline + per-user posts.
      const updatePages = old => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map(page =>
            page.map(post =>
              post.id === postId
                ? {
                    ...post,
                    liked_by_me: !liked,
                    like_count: liked ? Math.max(0, post.like_count - 1) : post.like_count + 1,
                  }
                : post
            )
          ),
        }
      }
      queryClient.setQueriesData({ queryKey: feedKeys.timeline }, updatePages)
      queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, updatePages)

      // Single-post detail cache (flat object, no `pages`). Patching this is
      // what makes the heart flip instantly on /post/:id.
      queryClient.setQueryData(feedKeys.post(postId), old =>
        old
          ? {
              ...old,
              liked_by_me: !liked,
              like_count: liked
                ? Math.max(0, (old.like_count ?? 0) - 1)
                : (old.like_count ?? 0) + 1,
            }
          : old
      )

      return { postId, previousLiked: liked }
    },
    onError: (_err, _vars, context) => {
      // Revert on error
      if (context) {
        const revert = old => {
          if (!old?.pages) return old
          return {
            ...old,
            pages: old.pages.map(page =>
              page.map(post =>
                post.id === context.postId
                  ? {
                      ...post,
                      liked_by_me: context.previousLiked,
                      like_count: context.previousLiked
                        ? post.like_count + 1
                        : Math.max(0, post.like_count - 1),
                    }
                  : post
              )
            ),
          }
        }
        queryClient.setQueriesData({ queryKey: feedKeys.timeline }, revert)
        queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, revert)

        // Revert the detail-page cache too.
        queryClient.setQueryData(feedKeys.post(context.postId), old =>
          old
            ? {
                ...old,
                liked_by_me: context.previousLiked,
                like_count: context.previousLiked
                  ? (old.like_count ?? 0) + 1
                  : Math.max(0, (old.like_count ?? 0) - 1),
              }
            : old
        )
      }
    },
  })
}

// Delete a post
export function useDeletePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async postId => {
      const { error } = await supabase.rpc('delete_post', { p_post_id: postId })
      if (error) throw error
      return postId
    },
    // Optimistic: remove post from feed immediately
    onMutate: async postId => {
      await queryClient.cancelQueries({ queryKey: feedKeys.timeline })
      const previous = queryClient.getQueriesData({ queryKey: ['feed'] })

      const removePost = old => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map(page => page.filter(post => post.id !== postId)),
        }
      }
      // Only touch infinite-query caches (timeline + per-user). The single
      // post detail cache has a different shape and would crash on `.pages`.
      queryClient.setQueriesData({ queryKey: feedKeys.timeline }, removePost)
      queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, removePost)

      return { previous }
    },
    onError: (_err, _vars, context) => {
      // Restore all feed caches on error
      if (context?.previous) {
        context.previous.forEach(([key, data]) => {
          queryClient.setQueryData(key, data)
        })
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: feedKeys.timeline })
      queryClient.invalidateQueries({ queryKey: ['feed', 'user'] })
      queryClient.invalidateQueries({ queryKey: ['feed', 'post'] })
    },
  })
}

// Get replies for a post
export function usePostReplies(postId, enabled = false) {
  return useQuery({
    queryKey: feedKeys.replies(postId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_post_replies', {
        p_post_id: postId,
        p_limit: 200,
      })
      if (error) throw error
      return data || []
    },
    enabled: !!postId && enabled,
    staleTime: FEED_STALE_TIME,
  })
}

// Create a reply
export function useCreateReply() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, content, parentReplyId = null }) => {
      const { data, error } = await supabase.rpc('create_reply', {
        p_post_id: postId,
        p_content: content,
        p_parent_reply_id: parentReplyId,
      })
      if (error) throw error
      return { replyId: data, postId }
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: feedKeys.replies(data.postId) })
      queryClient.invalidateQueries({ queryKey: feedKeys.post(data.postId) })
      // Update reply_count in feed caches (timeline + user queries only)
      const updatePages = old => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map(page =>
            page.map(post =>
              post.id === data.postId ? { ...post, reply_count: post.reply_count + 1 } : post
            )
          ),
        }
      }
      queryClient.setQueriesData({ queryKey: feedKeys.timeline }, updatePages)
      queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, updatePages)
    },
  })
}

// Like a reply
export function useLikeReply() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ replyId, liked, postId }) => {
      if (liked) {
        const { error } = await supabase.rpc('unlike_reply', { p_reply_id: replyId })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('like_reply', { p_reply_id: replyId })
        if (error) throw error
      }
      return { replyId, liked: !liked, postId }
    },
    onMutate: async ({ replyId, liked, postId }) => {
      await queryClient.cancelQueries({ queryKey: feedKeys.replies(postId) })

      queryClient.setQueryData(feedKeys.replies(postId), old => {
        if (!old) return old
        return old.map(r =>
          r.id === replyId
            ? {
                ...r,
                liked_by_me: !liked,
                like_count: liked ? Math.max(0, r.like_count - 1) : r.like_count + 1,
              }
            : r
        )
      })

      return { replyId, previousLiked: liked, postId }
    },
    onError: (_err, _vars, context) => {
      if (context) {
        queryClient.setQueryData(feedKeys.replies(context.postId), old => {
          if (!old) return old
          return old.map(r =>
            r.id === context.replyId
              ? {
                  ...r,
                  liked_by_me: context.previousLiked,
                  like_count: context.previousLiked
                    ? r.like_count + 1
                    : Math.max(0, r.like_count - 1),
                }
              : r
          )
        })
      }
    },
  })
}

// Repost a post
export function useRepostPost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId }) => {
      const { data, error } = await supabase.rpc('repost_post', { p_post_id: postId })
      if (error) throw error
      return { postId, repostId: data }
    },
    onMutate: async ({ postId }) => {
      await queryClient.cancelQueries({ queryKey: feedKeys.timeline })

      const updatePages = old => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map(page =>
            page.map(post => {
              const targetId = post.original_post_id || post.id
              if (targetId === postId || post.id === postId) {
                return {
                  ...post,
                  reposted_by_me: true,
                  repost_count: post.repost_count + 1,
                }
              }
              return post
            })
          ),
        }
      }

      queryClient.setQueriesData({ queryKey: feedKeys.timeline }, updatePages)
      queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, updatePages)
      return { postId }
    },
    onError: (_err, _vars, context) => {
      if (context) {
        const revert = old => {
          if (!old?.pages) return old
          return {
            ...old,
            pages: old.pages.map(page =>
              page.map(post => {
                const targetId = post.original_post_id || post.id
                if (targetId === context.postId || post.id === context.postId) {
                  return {
                    ...post,
                    reposted_by_me: false,
                    repost_count: Math.max(0, post.repost_count - 1),
                  }
                }
                return post
              })
            ),
          }
        }
        queryClient.setQueriesData({ queryKey: feedKeys.timeline }, revert)
        queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, revert)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: feedKeys.timeline })
      queryClient.invalidateQueries({ queryKey: ['feed', 'user'] })
      queryClient.invalidateQueries({ queryKey: ['feed', 'post'] })
    },
  })
}

// Unrepost a post
export function useUnrepostPost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId }) => {
      const { error } = await supabase.rpc('unrepost_post', { p_post_id: postId })
      if (error) throw error
      return { postId }
    },
    onMutate: async ({ postId }) => {
      await queryClient.cancelQueries({ queryKey: feedKeys.timeline })

      const updatePages = old => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map(page =>
            page.map(post => {
              const targetId = post.original_post_id || post.id
              if (targetId === postId || post.id === postId) {
                return {
                  ...post,
                  reposted_by_me: false,
                  repost_count: Math.max(0, post.repost_count - 1),
                }
              }
              return post
            })
          ),
        }
      }

      queryClient.setQueriesData({ queryKey: feedKeys.timeline }, updatePages)
      queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, updatePages)
      return { postId }
    },
    onError: (_err, _vars, context) => {
      if (context) {
        const revert = old => {
          if (!old?.pages) return old
          return {
            ...old,
            pages: old.pages.map(page =>
              page.map(post => {
                const targetId = post.original_post_id || post.id
                if (targetId === context.postId || post.id === context.postId) {
                  return {
                    ...post,
                    reposted_by_me: true,
                    repost_count: post.repost_count + 1,
                  }
                }
                return post
              })
            ),
          }
        }
        queryClient.setQueriesData({ queryKey: feedKeys.timeline }, revert)
        queryClient.setQueriesData({ queryKey: ['feed', 'user'] }, revert)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: feedKeys.timeline })
      queryClient.invalidateQueries({ queryKey: ['feed', 'user'] })
      queryClient.invalidateQueries({ queryKey: ['feed', 'post'] })
    },
  })
}

// Get unread feed count (polls every 60s)
export function useFeedUnreadCount() {
  const { user } = useAuth()

  return useQuery({
    queryKey: feedKeys.unreadCount,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_feed_unread_count')
      if (error) throw error
      return data || 0
    },
    enabled: !!user,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

// Fetch link preview from edge function
export function useLinkPreview(url) {
  const { user } = useAuth()

  return useQuery({
    queryKey: feedKeys.linkPreview(url),
    queryFn: async () => {
      const token = await getAccessToken()

      const res = await fetch(`${supabaseUrl}/functions/v1/link-preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      })

      if (!res.ok) throw new Error('Failed to fetch link preview')
      return res.json()
    },
    enabled: !!user && !!url && url.length > 0,
    staleTime: 5 * 60_000, // 5 minutes
    retry: false,
  })
}

// Mark feed as read
export function useMarkFeedRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_feed_read')
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.setQueryData(feedKeys.unreadCount, 0)
    },
  })
}
