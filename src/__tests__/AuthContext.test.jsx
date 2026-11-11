import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Mock supabase before importing AuthContext
vi.mock('../lib/supabase', () => {
  const mockAuth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    setSession: vi.fn(),
  }
  return {
    supabase: {
      auth: mockAuth,
    },
  }
})

import { AuthProvider, useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

function wrapper({ children }) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('AuthContext', () => {
  // ── useAuth hook guard ──────────────────────────────────

  it('throws when used outside AuthProvider', () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider')
    spy.mockRestore()
  })

  // ── Initial state ──────────────────────────────────────

  it('starts with loading=true and user=null', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    // Initially loading is true
    expect(result.current.user).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('sets loading=false after session check', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  // ── signUp ─────────────────────────────────────────────

  it('signUp validates required fields', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.signUp('', 'pass123', 'user')).rejects.toThrow(
      'Email, password, and username are required'
    )
    await expect(result.current.signUp('a@b.c', '', 'user')).rejects.toThrow(
      'Email, password, and username are required'
    )
    await expect(result.current.signUp('a@b.c', 'pass123', '')).rejects.toThrow(
      'Email, password, and username are required'
    )
  })

  it('signUp validates password length', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.signUp('a@b.c', '12345', 'user')).rejects.toThrow(
      'Password must be at least 6 characters'
    )
  })

  it('signUp validates username length', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.signUp('a@b.c', 'pass123', 'ab')).rejects.toThrow(
      'Username must be at least 3 characters'
    )
  })

  it('signUp normalizes email to lowercase and trimmed', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: '1', identities: [{}] } },
      error: null,
    })

    await act(async () => {
      await result.current.signUp('  Test@Email.COM  ', 'pass123', 'username')
    })

    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@email.com',
      })
    )
  })

  it('signUp detects duplicate email from identities', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: '1', identities: [] } },
      error: null,
    })

    await expect(result.current.signUp('a@b.c', 'pass123', 'user')).rejects.toThrow(
      'already exists'
    )
  })

  // ── signIn ─────────────────────────────────────────────

  it('signIn validates required fields', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.signIn('', 'pass')).rejects.toThrow(
      'Email or username and password are required'
    )
    await expect(result.current.signIn('a@b.c', '')).rejects.toThrow(
      'Email or username and password are required'
    )
  })

  it('signIn normalizes email', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: { user: { id: '1' } } },
      error: null,
    })

    await act(async () => {
      await result.current.signIn('  USER@Test.com  ', 'password')
    })

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@test.com',
      })
    )
  })

  it('signIn maps invalid credentials error', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid login credentials' },
    })

    await expect(result.current.signIn('a@b.c', 'wrong')).rejects.toThrow(
      'Invalid email or password'
    )
  })

  // ── signOut ────────────────────────────────────────────

  it('signOut clears user state immediately', async () => {
    // Start with an active session
    supabase.auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: '1', email: 'a@b.c' } } },
      error: null,
    })
    supabase.auth.signOut.mockResolvedValueOnce({ error: null })

    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.signOut()
    })

    expect(result.current.user).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('signOut handles signOut network error gracefully', async () => {
    supabase.auth.signOut.mockRejectedValueOnce(new Error('network'))

    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => !result.current.loading)

    // Should not throw
    await act(async () => {
      await result.current.signOut()
    })

    expect(result.current.user).toBeNull()
  })
})
