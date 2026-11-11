import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useMutationErrorToast } from '../useMutationErrorToast'

// Mock the Toast module so we can spy on what gets called.
const errorMock = vi.fn()
vi.mock('../../components/organisms/Toast', () => ({
  useToast: () => ({
    error: errorMock,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}))

describe('useMutationErrorToast', () => {
  it('returns a function that calls toast.error with the error message', () => {
    errorMock.mockClear()
    const { result } = renderHook(() => useMutationErrorToast('fallback'))
    result.current(new Error('something broke'))
    expect(errorMock).toHaveBeenCalledWith('something broke')
  })

  it('falls back to the supplied fallback string when the error has no message', () => {
    errorMock.mockClear()
    const { result } = renderHook(() => useMutationErrorToast('Could not save.'))
    result.current({})
    expect(errorMock).toHaveBeenCalledWith('Could not save.')
  })

  it('uses the default fallback when none is supplied', () => {
    errorMock.mockClear()
    const { result } = renderHook(() => useMutationErrorToast())
    result.current(null)
    expect(errorMock).toHaveBeenCalledWith('Action failed. Please try again.')
  })

  it('handles undefined err gracefully', () => {
    errorMock.mockClear()
    const { result } = renderHook(() => useMutationErrorToast('fb'))
    result.current(undefined)
    expect(errorMock).toHaveBeenCalledWith('fb')
  })
})
