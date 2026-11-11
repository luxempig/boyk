import { describe, expect, it } from 'vitest'

import {
  computeAutoFit,
  DOWN_TYPES,
  getChildTypes,
  getDotLayout,
  getUnfetchedIndicator,
  layoutTree,
  subtreeWidth,
  UP_TYPES,
} from '../networkLayout'

describe('networkLayout', () => {
  // Mock measureText that returns reasonable widths
  const measureText = (text, fontSize) => text.length * fontSize * 0.5

  const leaf = { id: 'a', label: 'Test Co', children: {} }
  const parentWithKids = {
    id: 'root',
    label: 'Root',
    isOrigin: true,
    children: {
      owns: [
        { id: 'c1', label: 'Child 1', children: {} },
        { id: 'c2', label: 'Child 2', children: {} },
      ],
      owned_by: [{ id: 'p1', label: 'Parent 1', children: {} }],
    },
  }

  describe('UP_TYPES / DOWN_TYPES', () => {
    it('classifies owned_by and suppliers as UP', () => {
      expect(UP_TYPES.has('owned_by')).toBe(true)
      expect(UP_TYPES.has('suppliers')).toBe(true)
    })
    it('classifies invested_in_by as UP', () => {
      expect(UP_TYPES.has('invested_in_by')).toBe(true)
    })
    it('classifies owns, brands, customers, people as DOWN', () => {
      expect(DOWN_TYPES.has('owns')).toBe(true)
      expect(DOWN_TYPES.has('brands')).toBe(true)
      expect(DOWN_TYPES.has('customers')).toBe(true)
      expect(DOWN_TYPES.has('people')).toBe(true)
    })
    it('classifies invests_in as DOWN', () => {
      expect(DOWN_TYPES.has('invests_in')).toBe(true)
    })
  })

  describe('getChildTypes', () => {
    it('returns empty for leaf', () => {
      expect(getChildTypes(leaf)).toEqual([])
    })
    it('returns types with non-empty children', () => {
      const types = getChildTypes(parentWithKids)
      expect(types).toContain('owns')
      expect(types).toContain('owned_by')
    })
  })

  describe('getDotLayout', () => {
    it('returns empty for node with no children', () => {
      expect(getDotLayout(leaf, 1, 'down')).toEqual([])
    })
    it('returns dots for node with children', () => {
      const dots = getDotLayout(parentWithKids, 0, 'down')
      expect(dots.length).toBe(2) // owns + owned_by
      const types = dots.map(d => d.type)
      expect(types).toContain('owns')
      expect(types).toContain('owned_by')
    })
    it('places UP dots on top arc and DOWN dots on bottom arc for origin', () => {
      const dots = getDotLayout(parentWithKids, 0, 'down')
      const upDot = dots.find(d => d.type === 'owned_by')
      const downDot = dots.find(d => d.type === 'owns')
      expect(upDot.cy).toBeLessThan(0) // above center
      expect(downDot.cy).toBeGreaterThan(0) // below center
    })
    it('dot left-to-right order matches type order for bottom arc', () => {
      const node = {
        id: 'x',
        label: 'X',
        isOrigin: true,
        children: {
          owns: [leaf],
          brands: [leaf],
          customers: [leaf],
        },
      }
      const dots = getDotLayout(node, 0, 'down')
      const downDots = dots.filter(d => DOWN_TYPES.has(d.type))
      // Left-to-right: cx should increase
      for (let i = 1; i < downDots.length; i++) {
        expect(downDots[i].cx).toBeGreaterThan(downDots[i - 1].cx)
      }
    })
    it('each dot has angle, cx, cy properties', () => {
      const dots = getDotLayout(parentWithKids, 0, 'down')
      for (const dot of dots) {
        expect(dot).toHaveProperty('type')
        expect(dot).toHaveProperty('angle')
        expect(dot).toHaveProperty('cx')
        expect(dot).toHaveProperty('cy')
      }
    })
  })

  describe('subtreeWidth', () => {
    it('returns node visual width for leaf', () => {
      const w = subtreeWidth(leaf, 1, 'down', new Map(), measureText)
      expect(w).toBeGreaterThan(0)
    })
    it('returns wider width when children expanded', () => {
      const expanded = new Map([['root', new Set(['owns'])]])
      const wExpanded = subtreeWidth(parentWithKids, 0, 'down', expanded, measureText)
      const wCollapsed = subtreeWidth(parentWithKids, 0, 'down', new Map(), measureText)
      expect(wExpanded).toBeGreaterThan(wCollapsed)
    })
  })

  describe('layoutTree', () => {
    it('returns origin node at specified center position', () => {
      const { nodes } = layoutTree(parentWithKids, new Map(), 400, 300, measureText)
      const origin = nodes.find(n => n.node.id === 'root')
      expect(origin).toBeDefined()
      expect(origin.x).toBe(400)
    })
    it('places expanded children below origin for DOWN types', () => {
      const expanded = new Map([['root', new Set(['owns'])]])
      const { nodes, edges } = layoutTree(parentWithKids, expanded, 400, 300, measureText)
      const origin = nodes.find(n => n.node.id === 'root')
      const child = nodes.find(n => n.node.id === 'c1')
      expect(child).toBeDefined()
      expect(child.y).toBeGreaterThan(origin.y)
      expect(edges.length).toBe(2)
    })
    it('places expanded parents above origin for UP types', () => {
      const expanded = new Map([['root', new Set(['owned_by'])]])
      const { nodes } = layoutTree(parentWithKids, expanded, 400, 300, measureText)
      const origin = nodes.find(n => n.node.id === 'root')
      const parent = nodes.find(n => n.node.id === 'p1')
      expect(parent).toBeDefined()
      expect(parent.y).toBeLessThan(origin.y)
    })
    it('returns only origin when nothing expanded', () => {
      const { nodes, edges } = layoutTree(parentWithKids, new Map(), 400, 300, measureText)
      expect(nodes.length).toBe(1)
      expect(edges.length).toBe(0)
    })
  })

  describe('getUnfetchedIndicator', () => {
    it('returns null for origin nodes', () => {
      const origin = { id: 'r', label: 'Root', isOrigin: true, children: { owns: [leaf] } }
      expect(getUnfetchedIndicator(origin, 0, 'down', new Set())).toBeNull()
    })

    it('returns null for already-fetched nodes', () => {
      const fetched = new Set(['a'])
      expect(getUnfetchedIndicator(leaf, 1, 'down', fetched)).toBeNull()
    })

    it('returns null at max depth', () => {
      expect(getUnfetchedIndicator(leaf, 6, 'down', new Set())).toBeNull()
    })

    it('returns indicator for unfetched non-origin node', () => {
      const result = getUnfetchedIndicator(leaf, 1, 'down', new Set())
      expect(result).not.toBeNull()
      expect(result).toHaveProperty('cx')
      expect(result).toHaveProperty('cy')
      expect(result).toHaveProperty('angle')
    })

    it('places indicator on bottom for labelDir=down', () => {
      const result = getUnfetchedIndicator(leaf, 1, 'down', new Set())
      expect(result.cy).toBeGreaterThan(0)
    })

    it('places indicator on top for labelDir=up', () => {
      const result = getUnfetchedIndicator(leaf, 1, 'up', new Set())
      expect(result.cy).toBeLessThan(0)
    })

    it('returns null for node that already has populated children', () => {
      const withKids = {
        id: 'x',
        label: 'X',
        children: { owns: [{ id: 'k1', label: 'K1', children: {} }] },
      }
      expect(getUnfetchedIndicator(withKids, 1, 'down', new Set())).toBeNull()
    })
  })

  describe('computeAutoFit', () => {
    it('returns default for empty nodes', () => {
      const result = computeAutoFit([], 800, 600, measureText)
      expect(result.zoom).toBe(1)
    })
    it('returns zoom and offset for nodes', () => {
      const { nodes } = layoutTree(
        parentWithKids,
        new Map([['root', new Set(['owns'])]]),
        400,
        300,
        measureText
      )
      const result = computeAutoFit(nodes, 800, 600, measureText)
      expect(result).toHaveProperty('x')
      expect(result).toHaveProperty('y')
      expect(result).toHaveProperty('zoom')
      expect(result.zoom).toBeGreaterThan(0)
      expect(result.zoom).toBeLessThanOrEqual(1.2)
    })
  })
})

import { CONNECTION_COLORS, CONNECTION_LABELS } from '../connectionColors'

describe('connectionColors', () => {
  it('exports CONNECTION_LABELS with matching keys', () => {
    const colorKeys = Object.keys(CONNECTION_COLORS)
    const labelKeys = Object.keys(CONNECTION_LABELS)
    expect(labelKeys).toEqual(colorKeys)
    for (const key of labelKeys) {
      expect(typeof CONNECTION_LABELS[key]).toBe('string')
      expect(CONNECTION_LABELS[key].length).toBeGreaterThan(0)
    }
  })
})
