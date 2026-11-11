import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { useFocusTrap } from '../useFocusTrap'

function TrappedDialog({ active = true }) {
  const ref = useFocusTrap(active)
  return (
    <div>
      <button data-testid='outside-before'>before</button>
      <div ref={ref} role='dialog'>
        <button data-testid='first'>first</button>
        <button data-testid='middle'>middle</button>
        <button data-testid='last'>last</button>
      </div>
      <button data-testid='outside-after'>after</button>
    </div>
  )
}

describe('useFocusTrap', () => {
  it('moves initial focus to the first focusable inside the container', async () => {
    const { getByTestId } = render(<TrappedDialog />)
    // Initial focus runs in a useEffect, so wait a tick
    await act(async () => {})
    expect(getByTestId('first')).toHaveFocus()
  })

  it('wraps Tab from the last focusable back to the first', async () => {
    const user = userEvent.setup()
    const { getByTestId } = render(<TrappedDialog />)
    await act(async () => {})

    getByTestId('last').focus()
    await user.tab()
    expect(getByTestId('first')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first focusable back to the last', async () => {
    const user = userEvent.setup()
    const { getByTestId } = render(<TrappedDialog />)
    await act(async () => {})

    expect(getByTestId('first')).toHaveFocus()
    await user.tab({ shift: true })
    expect(getByTestId('last')).toHaveFocus()
  })

  it('does nothing when active=false', async () => {
    const { getByTestId } = render(<TrappedDialog active={false} />)
    await act(async () => {})
    // Focus should not have been moved into the dialog
    expect(getByTestId('first')).not.toHaveFocus()
  })
})
