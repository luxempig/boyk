import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { getCorsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseServiceClient } from '../_shared/supabase.ts'

// GDPR/CCPA data export: returns everything we store about the authenticated
// user as a downloadable JSON document. Queries run with the service role to
// bypass RLS, but every single one is filtered strictly to the user id taken
// from the verified JWT (same auth pattern as delete-account).

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Authenticate the user making the request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const supabase = getSupabaseClient(authHeader)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: authError?.message || 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const userId = user.id

    // Service role client bypasses RLS — every query below MUST stay filtered
    // to the verified userId and nothing else.
    const admin = getSupabaseServiceClient()

    const must = <T>(
      label: string,
      result: { data: T | null; error: { message: string } | null }
    ): T => {
      if (result.error) {
        throw new Error(`${label}: ${result.error.message}`)
      }
      return (result.data ?? []) as T
    }

    const [
      profile,
      posts,
      replies,
      boycotts,
      adoptedBoycotts,
      following,
      followers,
      messages,
      feedback,
      feedbackComments,
    ] = await Promise.all([
      admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
      admin.from('posts').select('*').eq('author_id', userId).order('created_at'),
      admin.from('post_replies').select('*').eq('author_id', userId).order('created_at'),
      admin.from('boycotts').select('*').eq('creator_id', userId).order('created_at'),
      admin.from('adopted_boycotts').select('*').eq('user_id', userId),
      admin.from('user_follows').select('*').eq('follower_id', userId),
      admin.from('user_follows').select('*').eq('following_id', userId),
      admin.from('messages').select('*').eq('sender_id', userId).order('created_at'),
      admin.from('feedback').select('*').eq('submitted_by', userId),
      admin.from('feedback_comments').select('*').eq('author_id', userId),
    ])

    if (profile.error) {
      throw new Error(`profile: ${profile.error.message}`)
    }

    const exportPayload = {
      export_version: 1,
      generated_at: new Date().toISOString(),
      account: {
        id: userId,
        email: user.email ?? null,
        created_at: user.created_at ?? null,
      },
      profile: profile.data ?? null,
      posts: must('posts', posts),
      replies: must('replies', replies),
      boycotts: must('boycotts', boycotts),
      adopted_boycotts: must('adopted_boycotts', adoptedBoycotts),
      follows: {
        following: must('following', following),
        followers: must('followers', followers),
      },
      messages_sent: must('messages', messages),
      feedback: {
        submissions: must('feedback', feedback),
        comments: must('feedback_comments', feedbackComments),
      },
    }

    return new Response(JSON.stringify(exportPayload, null, 2), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="boyk-data-export.json"',
      },
    })
  } catch (error) {
    console.error('export-data error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
