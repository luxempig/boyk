import { createClient } from '@supabase/supabase-js'

import { DEMO_MODE } from './demo'
import { demoFetch } from './demoBackend'

export const supabaseUrl = DEMO_MODE ? 'https://demo.invalid' : import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = DEMO_MODE ? 'demo' : import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
}

// In demo mode nothing leaves the browser: queries are answered from the
// recorded snapshot and there is no session to persist or refresh.
export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  DEMO_MODE
    ? {
        global: { fetch: demoFetch },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }
    : undefined
)

export async function getAccessToken() {
  // Always refresh to ensure we have a valid (non-expired) token
  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session?.access_token) {
    throw new Error('Not authenticated. Please sign in again.')
  }
  return data.session.access_token
}
