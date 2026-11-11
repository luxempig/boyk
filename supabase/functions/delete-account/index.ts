import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { getCorsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseServiceClient } from '../_shared/supabase.ts'

// Sentinel profile for reassigning orphaned boycotts
const DELETED_USER_ID = '00000000-0000-0000-0000-000000000000'

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

    // Use service role client to bypass RLS for cleanup
    const admin = getSupabaseServiceClient()

    // Ensure the sentinel "[Deleted User]" profile exists
    await admin.from('profiles').upsert(
      {
        id: DELETED_USER_ID,
        username: 'deleted-user',
        display_name: '[Deleted User]',
      },
      { onConflict: 'id' }
    )

    // 1. Delete financial data
    await admin.from('plaid_transactions').delete().eq('user_id', userId)
    await admin.from('plaid_items').delete().eq('user_id', userId)

    // 2. Reassign user's boycotts to the sentinel profile (keeps them alive for adopters)
    await admin.from('boycotts').update({ creator_id: DELETED_USER_ID }).eq('creator_id', userId)

    // 3. Remove user's adopted boycotts
    await admin.from('adopted_boycotts').delete().eq('user_id', userId)

    // 4. Remove social connections
    await admin.from('user_follows').delete().eq('follower_id', userId)
    await admin.from('user_follows').delete().eq('following_id', userId)

    // 5. Remove feed interactions (post_likes, post_reposts)
    await admin.from('post_reposts').delete().eq('user_id', userId)
    await admin.from('post_likes').delete().eq('user_id', userId)

    // 6. Remove user's replies and posts
    // (These also CASCADE from auth.users deletion, but explicit is safer)
    await admin.from('post_replies').delete().eq('author_id', userId)
    await admin.from('posts').delete().eq('author_id', userId)

    // 7. Anonymize feedback (nullable FK — set to null rather than delete)
    await admin.from('feedback_comments').update({ author_id: null }).eq('author_id', userId)
    await admin.from('feedback').update({ submitted_by: null }).eq('submitted_by', userId)

    // 8. Delete the profile
    await admin.from('profiles').delete().eq('id', userId)

    // 9. Delete the auth user (this is the final step — no going back)
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('Failed to delete auth user:', deleteError)
      return new Response(JSON.stringify({ error: 'Failed to delete account' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('delete-account error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
