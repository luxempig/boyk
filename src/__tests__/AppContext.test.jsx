import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Use vi.hoisted so the mock fn is available when vi.mock factory runs
const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

// Mock supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    rpc: mockRpc,
  },
}))

// Mock neo4j service
vi.mock('../services/neo4jGraph', () => ({
  searchCompanies: vi.fn().mockResolvedValue([]),
  getCompanyWithConnections: vi.fn().mockResolvedValue(null),
}))

// Mock analytics
vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
}))

import { AppProvider, CONNECTION_TYPES, useApp } from '../context/AppContext'
import { AuthProvider } from '../context/AuthContext'

function wrapper({ children }) {
  return (
    <AuthProvider>
      <AppProvider>{children}</AppProvider>
    </AuthProvider>
  )
}

describe('AppContext', () => {
  // ── useApp hook guard ──────────────────────────────────

  it('throws when used outside AppProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useApp())).toThrow('useApp must be used within an AppProvider')
    spy.mockRestore()
  })

  // ── CONNECTION_TYPES ───────────────────────────────────

  it('exports expected connection types', () => {
    expect(CONNECTION_TYPES).toHaveProperty('owns')
    expect(CONNECTION_TYPES).toHaveProperty('owned_by')
    expect(CONNECTION_TYPES).toHaveProperty('supplier')
    expect(CONNECTION_TYPES.owns.id).toBe('owns')
  })

  // ── Initial state ──────────────────────────────────────

  it('provides initial empty state when no user', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.myBoycotts).toEqual([])
    expect(result.current.followedBoycotts).toEqual([])
    expect(result.current.publicBoycotts).toEqual([])
    expect(result.current.error).toBeNull()
  })

  // ── Validation ─────────────────────────────────────────

  it('createBoycott throws when no user is logged in', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })

    await waitFor(() => !result.current.loading)

    await expect(result.current.createBoycott('Test')).rejects.toThrow(
      'You must be logged in to create a boycott'
    )
  })

  it('addCompanyToBoycott throws for missing params', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.addCompanyToBoycott(null, 'company-id')).rejects.toThrow(
      'Invalid boycott or company'
    )
    await expect(result.current.addCompanyToBoycott('boycott-id', null)).rejects.toThrow(
      'Invalid boycott or company'
    )
  })

  it('removeCompanyFromBoycott throws for missing params', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.removeCompanyFromBoycott(null, 'c')).rejects.toThrow(
      'Invalid boycott or company'
    )
  })

  it('deleteBoycott throws for missing boycottId', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.deleteBoycott(null)).rejects.toThrow('Invalid boycott')
  })

  it('updateBoycott throws for missing boycottId', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.updateBoycott(null, { name: 'x' })).rejects.toThrow(
      'Invalid boycott'
    )
  })

  it('adoptBoycott throws when not logged in', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.adoptBoycott('some-id')).rejects.toThrow(
      'You must be logged in to adopt a boycott'
    )
  })

  it('unadoptBoycott throws when not logged in', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.unadoptBoycott('some-id')).rejects.toThrow('You must be logged in')
  })

  // ── getAllBlockedCompanies ──────────────────────────────

  it('getAllBlockedCompanies returns empty array by default', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    const blocked = result.current.getAllBlockedCompanies()
    expect(blocked).toEqual([])
  })

  // ── hasAdoptedBoycott ──────────────────────────────────

  it('hasAdoptedBoycott returns false when no boycotts followed', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    expect(result.current.hasAdoptedBoycott('some-id')).toBe(false)
  })

  // ── searchCompanies ────────────────────────────────────

  it('searchCompanies returns empty for short query', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    const results = await result.current.searchCompanies('A')
    expect(results).toEqual([])
  })

  // ── Follow user validation ─────────────────────────────

  it('followUser throws when not logged in', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.followUser('user-id')).rejects.toThrow(
      'You must be logged in to follow users'
    )
  })

  it('unfollowUser throws when not logged in', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => !result.current.loading)

    await expect(result.current.unfollowUser('user-id')).rejects.toThrow('You must be logged in')
  })
})
