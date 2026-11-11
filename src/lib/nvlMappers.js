import { getCompanyLinkId } from '../services/neo4jGraph'
import { CONNECTION_COLORS } from './connectionColors'

// Read accent color from CSS variable at runtime so it respects design variants
function getAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f472b6'
}

const REL_LABELS = {
  owns: 'Subsidiary',
  owned_by: 'Parent',
  invested_in_by: 'Investor',
  invests_in: 'Investment',
  brands: 'Brand',
  suppliers: 'Supplier',
  customers: 'Customer',
  people: 'Person',
  user_added: 'Added',
}

const REL_DIRECTIONS = {
  owns: 'outgoing',
  owned_by: 'outgoing',
  invested_in_by: 'incoming',
  invests_in: 'outgoing',
  brands: 'outgoing',
  suppliers: 'incoming',
  customers: 'outgoing',
  people: 'outgoing',
  user_added: 'outgoing',
}

export function mapCompanyToNvl(company, { isOrigin = false, connectionType = null } = {}) {
  const id = getCompanyLinkId(company) || company.id
  // Icons disabled: R2 public domain (r2.dev) doesn't send CORS headers,
  // so cross-origin images taint the NVL canvas renderer.
  // TODO: re-enable after setting up a custom domain with CORS for R2.
  return {
    id,
    caption: company.name,
    color: isOrigin ? getAccent() : connectionType ? CONNECTION_COLORS[connectionType] : '#71717a',
    size: isOrigin ? 40 : 25,
    pinned: false,
  }
}

export function mapConnectionsToNvl(originId, connections) {
  const nodes = []
  const rels = []
  // Track emitted node ids so a company appearing under two connection types
  // (e.g. both supplier and customer) yields a single node. The origin is
  // pre-seeded so a self-referential child never collides with it. This is the
  // shared chokepoint for all three call sites, so the unguarded initial-load
  // path is covered here too.
  const seen = new Set()
  if (originId != null) seen.add(originId)

  for (const [type, items] of Object.entries(connections)) {
    if (!items?.length) continue
    const color = CONNECTION_COLORS[type] || '#71717a'
    const direction = REL_DIRECTIONS[type] || 'outgoing'

    for (const item of items) {
      const childId = getCompanyLinkId(item) || item.id
      if (childId == null || childId === originId) continue
      if (!seen.has(childId)) {
        seen.add(childId)
        nodes.push(mapCompanyToNvl(item, { connectionType: type }))
      }

      // Emit the rel even for an already-seen node so cross-type edges are kept
      // (rel ids embed `type`, so they stay unique).
      const from = direction === 'outgoing' ? originId : childId
      const to = direction === 'outgoing' ? childId : originId
      rels.push({
        id: `${originId}-${childId}-${type}`,
        from,
        to,
        color,
        caption: REL_LABELS[type] || type,
      })
    }
  }

  return { nodes, rels }
}

export function deduplicateElements(nodes, rels, existingNodeIds, existingRelIds) {
  return {
    nodes: nodes.filter(n => !existingNodeIds.has(n.id)),
    rels: rels.filter(r => !existingRelIds.has(r.id)),
  }
}

/**
 * Assign radial positions to nodes around an origin.
 * Groups children by connection type so related nodes cluster together.
 * Mutates node objects in-place (adds x/y).
 */
export function assignRadialPositions(nodes, originId, connections) {
  const origin = nodes.find(n => n.id === originId)
  if (origin) {
    origin.x = 0
    origin.y = 0
  }

  const children = nodes.filter(n => n.id !== originId)
  if (children.length === 0) return nodes

  // Group children by connection type for sector-based placement
  const groups = []
  // Each node belongs to exactly one group. A company that appears under two
  // connection types now resolves to a single deduped node, so without this it
  // would match two groups and the sector/row math would double-count it.
  const placed = new Set()
  if (connections) {
    for (const [, items] of Object.entries(connections)) {
      if (!items?.length) continue
      const ids = new Set(items.map(item => getCompanyLinkId(item) || item.id))
      const groupNodes = children.filter(n => ids.has(n.id) && !placed.has(n.id))
      if (groupNodes.length > 0) {
        groupNodes.forEach(n => placed.add(n.id))
        groups.push(groupNodes)
      }
    }
  }

  // Fallback: if no groups resolved, treat all children as one group
  if (groups.length === 0) groups.push(children)

  const radius = Math.max(250, children.length * 20)
  let angleOffset = -Math.PI / 2 // start at top

  for (const group of groups) {
    const sectorSize = (2 * Math.PI * group.length) / children.length
    group.forEach((node, i) => {
      const angle = angleOffset + (sectorSize * (i + 0.5)) / group.length
      node.x = radius * Math.cos(angle)
      node.y = radius * Math.sin(angle)
    })
    angleOffset += sectorSize
  }

  return nodes
}

/**
 * Assign hierarchical (tree) positions: origin on the left, children stacked on the right.
 * Groups children by connection type. Mutates node objects in-place.
 */
export function assignHierarchicalPositions(nodes, originId, connections) {
  const origin = nodes.find(n => n.id === originId)
  const children = nodes.filter(n => n.id !== originId)

  if (origin) {
    origin.x = 0
    origin.y = 0
  }
  if (children.length === 0) return nodes

  // Group children by connection type
  const groups = []
  // Each node belongs to exactly one group. A company that appears under two
  // connection types now resolves to a single deduped node, so without this it
  // would match two groups and the sector/row math would double-count it.
  const placed = new Set()
  if (connections) {
    for (const [, items] of Object.entries(connections)) {
      if (!items?.length) continue
      const ids = new Set(items.map(item => getCompanyLinkId(item) || item.id))
      const groupNodes = children.filter(n => ids.has(n.id) && !placed.has(n.id))
      if (groupNodes.length > 0) {
        groupNodes.forEach(n => placed.add(n.id))
        groups.push(groupNodes)
      }
    }
  }
  if (groups.length === 0) groups.push(children)

  const rowHeight = 70
  const colWidth = 350
  let col = 1

  for (const group of groups) {
    const groupHeight = group.length * rowHeight
    let yStart = -groupHeight / 2

    for (let i = 0; i < group.length; i++) {
      group[i].x = col * colWidth
      group[i].y = yStart + i * rowHeight
    }

    // Next group goes in the next column
    col++
  }

  // If only 1 group (no connection types), center children vertically
  if (groups.length === 1) {
    const totalHeight = children.length * rowHeight
    const yStart = -totalHeight / 2
    children.forEach((node, i) => {
      node.x = colWidth
      node.y = yStart + i * rowHeight
    })
  }

  return nodes
}

/**
 * Position new child nodes around a parent node that already has x/y.
 * Used when expanding a node's connections.
 */
export function assignChildPositions(newNodes, parentX, parentY) {
  if (newNodes.length === 0) return newNodes

  const radius = Math.max(150, newNodes.length * 18)
  // Find an angle away from the origin (0,0) so children fan outward
  const parentAngle = Math.atan2(parentY || 0, parentX || 0)

  newNodes.forEach((node, i) => {
    const spread = Math.PI * 0.8 // fan across ~144 degrees
    const startAngle = parentAngle - spread / 2
    const angle = startAngle + (spread * (i + 0.5)) / newNodes.length
    node.x = (parentX || 0) + radius * Math.cos(angle)
    node.y = (parentY || 0) + radius * Math.sin(angle)
  })

  return newNodes
}
