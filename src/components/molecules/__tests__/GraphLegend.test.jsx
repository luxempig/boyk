import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import GraphLegend from '../GraphLegend'

describe('GraphLegend', () => {
  it('starts collapsed and expands on click', () => {
    render(<GraphLegend />)
    // Collapsed: no labels visible
    expect(screen.queryByText('Parents')).toBeNull()

    // Click to expand
    fireEvent.click(screen.getByText('Legend'))

    expect(screen.getByText('Parents')).toBeTruthy()
    expect(screen.getByText('Subsidiaries')).toBeTruthy()
    expect(screen.getByText('Brands')).toBeTruthy()
    expect(screen.getByText('Suppliers')).toBeTruthy()
    expect(screen.getByText('Customers')).toBeTruthy()
    expect(screen.getByText('Investors')).toBeTruthy()
    expect(screen.getByText('Investments')).toBeTruthy()
    expect(screen.getByText('People')).toBeTruthy()
    expect(screen.getByText('User-added')).toBeTruthy()
  })

  it('renders colored dots for each type when expanded', () => {
    const { container } = render(<GraphLegend />)
    fireEvent.click(screen.getByText('Legend'))
    const dots = container.querySelectorAll('[data-testid^="legend-dot-"]')
    expect(dots.length).toBe(9)
  })

  it('accepts position prop', () => {
    const { container } = render(<GraphLegend position='bottom-left' />)
    const el = container.firstChild
    expect(el.style.bottom).toBe('var(--space-3)')
    expect(el.style.left).toBe('var(--space-3)')
  })
})
