import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useSafeState } from '../hooks/useSafeState'
import { trackEvent } from '../lib/analytics'
import { getAccessToken, supabase, supabaseUrl } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const { safeSetState } = useSafeState()

  useEffect(() => {
    let subscription = null

    const initAuth = async () => {
      try {
        // Check for session passed from Chrome extension via hash fragment
        if (window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.substring(1))
          const accessToken = hashParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token')
          const type = hashParams.get('type')

          if (accessToken && refreshToken && type === 'extension') {
            // Clear the hash from URL for cleanliness
            window.history.replaceState(null, '', window.location.pathname)

            // Restore session from extension tokens
            try {
              const { data, error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              })
              if (!error && data?.session) {
                safeSetState(setUser, data.session.user)
                safeSetState(setLoading, false)
                return
              }
            } catch (e) {
              console.error('Failed to restore session from extension:', e)
              // Fall through to normal auth
            }
          }
        }

        // Get initial session normally
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (error) {
          console.error('Error getting session:', error)
        }

        safeSetState(setUser, session?.user ?? null)
        safeSetState(setLoading, false)
      } catch (err) {
        console.error('Auth initialization error:', err)
        safeSetState(setUser, null)
        safeSetState(setLoading, false)
      }
    }

    initAuth()

    // Listen for auth changes
    const setupSubscription = async () => {
      try {
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          safeSetState(setUser, session?.user ?? null)
        })
        subscription = data.subscription
      } catch (err) {
        console.error('Error setting up auth subscription:', err)
      }
    }

    setupSubscription()

    return () => {
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [safeSetState])

  const signUp = useCallback(async (email, password, username) => {
    if (!email || !password || !username) {
      throw new Error('Email, password, and username are required')
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long')
    }

    if (username.length < 3) {
      throw new Error('Username must be at least 3 characters long')
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { username: username.trim().toLowerCase() },
        emailRedirectTo: `${window.location.origin}/`,
      },
    })

    if (error) {
      // Handle specific error cases with user-friendly messages
      const message = error.message?.toLowerCase() || ''
      if (message.includes('already registered') || message.includes('already been registered')) {
        throw new Error('An account with this email already exists. Please sign in instead.')
      }
      if (message.includes('password') && message.includes('6')) {
        throw new Error('Password must be at least 6 characters long.')
      }
      if (message.includes('valid email')) {
        throw new Error('Please enter a valid email address.')
      }
      if (message.includes('rate limit')) {
        throw new Error('Too many attempts. Please try again later.')
      }
      throw new Error(error.message || 'Failed to create account. Please try again.')
    }

    // Supabase may return a user with identities = [] if email exists (depending on settings)
    if (data?.user && data.user.identities?.length === 0) {
      throw new Error('An account with this email already exists. Please sign in instead.')
    }

    trackEvent('signup')
    return data
  }, [])

  const signIn = useCallback(async (identifier, password) => {
    if (!identifier || !password) {
      throw new Error('Email or username and password are required')
    }

    let email = identifier.trim().toLowerCase()

    // If no @ sign, treat as username and look up email
    if (!email.includes('@')) {
      const { data: foundEmail, error: lookupError } = await supabase.rpc('get_email_by_username', {
        p_username: email,
      })
      if (lookupError || !foundEmail) {
        throw new Error('Invalid username or password. Please check your credentials.')
      }
      email = foundEmail
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      const message = error.message?.toLowerCase() || ''
      if (message.includes('invalid login credentials') || message.includes('invalid')) {
        throw new Error('Invalid email or password. Please check your credentials.')
      }
      if (message.includes('email not confirmed')) {
        throw new Error('Please confirm your email before signing in. Check your inbox.')
      }
      if (message.includes('rate limit')) {
        throw new Error('Too many login attempts. Please try again later.')
      }
      throw new Error(error.message || 'Failed to sign in. Please try again.')
    }

    trackEvent('login')
    return data
  }, [])

  const signOut = useCallback(async () => {
    trackEvent('logout')
    // Always clear local user state first
    safeSetState(setUser, null)

    // Try to sign out from server (may fail if network issues)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Sign out error:', error)
      }
    } catch (err) {
      console.error('Sign out network error:', err)
    }
  }, [safeSetState])

  const resetPassword = useCallback(async email => {
    if (!email) throw new Error('Email is required')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/login`,
    })
    if (error) {
      if (error.message?.toLowerCase().includes('rate limit')) {
        throw new Error('Too many attempts. Please try again later.')
      }
      throw new Error(error.message || 'Failed to send reset email.')
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    })
    if (error) throw new Error(error.message || 'Failed to sign in with Google.')
    trackEvent('oauth_google')
  }, [])

  const deleteAccount = useCallback(async () => {
    const token = await getAccessToken()

    const res = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to delete account')
    }

    trackEvent('account_deleted')
    await supabase.auth.signOut()
    safeSetState(setUser, null)
  }, [safeSetState])

  const value = useMemo(
    () => ({
      user,
      loading,
      signUp,
      signIn,
      signOut,
      resetPassword,
      signInWithGoogle,
      deleteAccount,
      isAuthenticated: !!user,
    }),
    [user, loading, signUp, signIn, signOut, resetPassword, signInWithGoogle, deleteAccount]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
