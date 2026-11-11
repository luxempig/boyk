import { describe, expect, it } from 'vitest'

import { deduplicateElements, mapCompanyToNvl, mapConnectionsToNvl } from '../lib/nvlMappers'

describe('mapCompanyToNvl', () => {
  it('maps an origin company to an NVL node', () => {
    const company = {
      id: 'Q95',
      name: 'Google',
      logo_url: 'https://pub-24822932e9b541bd9c542070c9dcdb3b.r2.dev/logos/google.com.png',
    }
    const node = mapCompanyToNvl(company, { isOrigin: true })
    expect(node).toEqual({
      id: 'Q95',
      caption: 'Google',
      // The origin node takes the accent (brand pink); jsdom has no CSS vars,
      // so this is the fallback.
      color: '#f472b6',
      size: 40,
      pinned: false,
    })
    // Icons disabled due to R2 CORS — no icon property expected
    expect(node.icon).toBeUndefined()
  })

  it('uses connection type color for non-origin nodes', () => {
    const company = { id: 'Q123', name: 'Waze', logo_url: null }
    const node = mapCompanyToNvl(company, { connectionType: 'owns' })
    expect(node.color).toBe('#22c55e') // green for subsidiaries
    expect(node.size).toBe(25)
    expect(node.icon).toBeUndefined()
  })
})

describe('mapConnectionsToNvl', () => {
  it('maps connections to NVL nodes and relationships', () => {
    const originId = 'Q95'
    const connections = {
      owns: [{ id: 'Q123', name: 'Waze', logo_url: null }],
      owned_by: [{ id: 'Q456', name: 'Alphabet', logo_url: null }],
      brands: [],
      suppliers: [],
      customers: [],
      people: [],
    }
    const { nodes, rels } = mapConnectionsToNvl(originId, connections)
    expect(nodes).toHaveLength(2)
    expect(rels).toHaveLength(2)

    const wazeNode = nodes.find(n => n.id === 'Q123')
    expect(wazeNode.caption).toBe('Waze')
    expect(wazeNode.color).toBe('#22c55e') // green for owns

    const ownsRel = rels.find(r => r.to === 'Q123')
    expect(ownsRel.from).toBe('Q95')
    expect(ownsRel.color).toBe('#22c55e')
    expect(ownsRel.caption).toBe('Subsidiary')

    // owned_by: arrow goes from origin to parent (origin points to its parent)
    const parentRel = rels.find(r => r.to === 'Q456')
    expect(parentRel.from).toBe('Q95')
    expect(parentRel.caption).toBe('Parent')
  })

  it('emits a single node when a company appears under two connection types', () => {
    const dup = { id: 'Q999', name: 'Acme', logo_url: null }
    const { nodes, rels } = mapConnectionsToNvl('Q1', {
      suppliers: [dup],
      customers: [dup],
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('Q999')
    // both directional edges are still kept (distinct rel ids via type)
    expect(rels).toHaveLength(2)
    expect(new Set(rels.map(r => r.id)).size).toBe(2)
  })

  it('does not emit a child node that collides with the origin id', () => {
    const { nodes } = mapConnectionsToNvl('Q1', {
      owns: [{ id: 'Q1', name: 'Self', logo_url: null }],
    })
    expect(nodes).toHaveLength(0)
  })

  it('skips empty connection types', () => {
    const { nodes, rels } = mapConnectionsToNvl('Q1', {
      owns: [],
      owned_by: [],
      brands: [],
      suppliers: [],
      customers: [],
      people: [],
    })
    expect(nodes).toHaveLength(0)
    expect(rels).toHaveLength(0)
  })
})

describe('deduplicateElements', () => {
  it('filters out nodes and rels that already exist', () => {
    const existingIds = new Set(['Q123'])
    const existingRelIds = new Set(['Q95-Q123-owns'])
    const nodes = [
      { id: 'Q123', caption: 'Waze' },
      { id: 'Q789', caption: 'Fitbit' },
    ]
    const rels = [{ id: 'Q95-Q123-owns' }, { id: 'Q95-Q789-owns' }]
    const result = deduplicateElements(nodes, rels, existingIds, existingRelIds)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('Q789')
    expect(result.rels).toHaveLength(1)
    expect(result.rels[0].id).toBe('Q95-Q789-owns')
  })
})
