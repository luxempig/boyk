import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPlaidClient } from '../_shared/plaid.ts'
import { getSupabaseClient, getSupabaseServiceClient } from '../_shared/supabase.ts'

serve(async req => {
  const cors = getCorsHeaders(req)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization')
    const supabase = getSupabaseClient(authHeader)

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { public_token, institution } = await req.json()

    if (!public_token) {
      return new Response(JSON.stringify({ error: 'public_token is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const plaid = getPlaidClient()

    // Exchange public token for access token
    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token,
    })

    const { access_token, item_id } = exchangeResponse.data

    // Store in database using service role to bypass RLS for insertion
    const serviceClient = getSupabaseServiceClient()

    const { data: plaidItem, error: insertError } = await serviceClient
      .from('plaid_items')
      .upsert(
        {
          user_id: user.id,
          item_id,
          access_token,
          institution_name: institution?.name || null,
          created_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,item_id',
        }
      )
      .select()
      .single()

    if (insertError) {
      console.error('Error storing plaid item:', insertError)
      return new Response(JSON.stringify({ error: 'Failed to store connection' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        item_id: plaidItem.id,
        institution_name: institution?.name,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error exchanging token:', error)
    return new Response(JSON.stringify({ error: error.message || 'Failed to exchange token' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
