import { getCompanyLinkId } from '../services/neo4jGraph'

// Layout constants
const LEVEL_GAP_Y = 80
const SIBLING_GAP_X = 140
const GROUP_GAP_X = 60
const ORIGIN_RADIUS = 10
const CHILD_RADIUS = 6

/**
 * Build a flat tree structure from a root node and its expanded children.
 */
export function buildTree(rootId, nodeData, expandedNodes) {
  const nodes = [{ id: rootId, parentId: null, connectionType: null, depth: 0 }]
  const children = new Map()

  function addChildren(parentId, depth) {
    const data = nodeData.get(parentId)
    if (!data || !expandedNodes.has(parentId)) return

    const conns = data.connections || {}
    const parentChildren = []

    for (const [type, items] of Object.entries(conns)) {
      if (!items?.length) continue
      for (const item of items) {
        const childId = getCompanyLinkId(item) || item.id
        if (nodes.some(n => n.id === childId)) continue
        nodes.push({
          id: childId,
          parentId,
          connectionType: type,
          depth: depth + 1,
          name: item.name || null,
        })
        parentChildren.push(childId)

        if (expandedNodes.has(childId) && nodeData.has(childId)) {
          addChildren(childId, depth + 1)
        }
      }
    }

    children.set(parentId, parentChildren)
  }

  addChildren(rootId, 0)
  return { nodes, children }
}

/**
 * Compute x,y positions for each node in a hierarchical tree layout.
 */
export function computePositions(tree) {
  const { nodes, children } = tree
  const positions = new Map()

  if (nodes.length === 0) return positions

  const subtreeWidth = new Map()

  function getSubtreeWidth(nodeId) {
    if (subtreeWidth.has(nodeId)) return subtreeWidth.get(nodeId)
    const kids = children.get(nodeId) || []
    if (kids.length === 0) {
      subtreeWidth.set(nodeId, SIBLING_GAP_X)
      return SIBLING_GAP_X
    }

    const kidNodes = kids.map(id => nodes.find(n => n.id === id)).filter(Boolean)
    let totalWidth = 0
    let prevType = null
    for (const kid of kidNodes) {
      const w = getSubtreeWidth(kid.id)
      if (prevType && kid.connectionType !== prevType) {
        totalWidth += GROUP_GAP_X
      }
      totalWidth += w
      prevType = kid.connectionType
    }

    subtreeWidth.set(nodeId, Math.max(totalWidth, SIBLING_GAP_X))
    return subtreeWidth.get(nodeId)
  }

  getSubtreeWidth(nodes[0].id)

  function assignPositions(nodeId, centerX, y) {
    positions.set(nodeId, { x: centerX, y })

    const kids = children.get(nodeId) || []
    if (kids.length === 0) return

    const kidNodes = kids.map(id => nodes.find(n => n.id === id)).filter(Boolean)
    const totalW = getSubtreeWidth(nodeId)
    let startX = centerX - totalW / 2
    let prevType = null

    for (const kid of kidNodes) {
      if (prevType && kid.connectionType !== prevType) {
        startX += GROUP_GAP_X
      }
      const kidW = getSubtreeWidth(kid.id)
      const kidCenterX = startX + kidW / 2
      assignPositions(kid.id, kidCenterX, y + LEVEL_GAP_Y)
      startX += kidW
      prevType = kid.connectionType
    }
  }

  assignPositions(nodes[0].id, 0, 0)
  return positions
}

/**
 * Generate SVG path string for a perpendicular polyline from parent to child.
 */
export function perpendicularPath(px, py, cx, cy, parentRadius, childRadius) {
  const startY = py + parentRadius
  const endY = cy - childRadius
  const midY = startY + (endY - startY) * 0.5
  return `M ${px} ${startY} V ${midY} H ${cx} V ${endY}`
}

export { CHILD_RADIUS, LEVEL_GAP_Y, ORIGIN_RADIUS }
