import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPlaidClient } from '../_shared/plaid.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'
import { CountryCode, Products } from 'npm:plaid@23.0.0'

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

    const plaid = getPlaidClient()

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Boyk',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })

    return new Response(JSON.stringify({ link_token: response.data.link_token }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error creating link token:', error)
    return new Response(JSON.stringify({ error: error.message || 'Failed to create link token' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
