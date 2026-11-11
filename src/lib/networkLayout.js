/**
 * networkLayout.js — Pure-function layout engine for the canvas network graph.
 *
 * Every function is deterministic and side-effect-free.
 * Text measurement is injected via `measureTextFn(text, fontSize, weight)`
 * so the module stays testable without a real canvas context.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NODE_R_ORIGIN = 42
export const NODE_R = 28
export const NODE_R_SMALL = 20
export const DOT_R = 5
export const DOT_R_ACTIVE = 6
export const MIN_NODE_GAP_H = 28
export const MIN_TIER_PAD = 32
export const ANIM_SPEED = 0.1

/** Max children to display per connection type before showing "+N more" */
export const MAX_VISIBLE_CHILDREN = 8

/** Connection types that fan upward from the origin */
export const UP_TYPES = new Set(['owned_by', 'suppliers', 'invested_in_by'])

/** Connection types that fan downward from the origin */
export const DOWN_TYPES = new Set(['owns', 'brands', 'customers', 'people', 'invests_in'])

// ---------------------------------------------------------------------------
// Helpers — node sizing
// ---------------------------------------------------------------------------

/** Radius of the node circle at a given tree depth. */
export function getNodeRadius(depth) {
  if (depth === 0) return NODE_R_ORIGIN
  if (depth === 1) return NODE_R
  return NODE_R_SMALL
}

/** Font size for the label text beneath/above the circle. */
export function getLabelFontSize(depth, isOrigin) {
  if (isOrigin) return 13
  if (depth <= 1) return 11
  return 10
}

/** Font size for the initials rendered inside the circle. */
export function getInitialsFontSize(depth, isOrigin) {
  if (isOrigin) return 18
  if (depth <= 1) return 14
  return 11
}

// ---------------------------------------------------------------------------
// Child type helpers
// ---------------------------------------------------------------------------

/**
 * Return the list of connection-type keys that have at least one child.
 * Preserves insertion order (Object.keys).
 */
export function getChildTypes(node) {
  if (!node.children) return []
  return Object.keys(node.children).filter(
    t => Array.isArray(node.children[t]) && node.children[t].length > 0
  )
}

// ---------------------------------------------------------------------------
// Dot layout — the coloured dots on the node perimeter
// ---------------------------------------------------------------------------

/**
 * Compute the position of each "expand" dot around a node's circle.
 *
 * Returns an array of `{ type, angle, cx, cy }` objects where cx/cy are
 * offsets from the node centre.
 *
 * For origin nodes, UP types sit on the top arc and DOWN types on the
 * bottom arc.  The bottom-arc sweep is *reversed* (left-to-right = high
 * angle to low angle) so that dot order matches the left-to-right child
 * layout order.
 */
export function getDotLayout(node, depth, labelDir) {
  const childTypes = getChildTypes(node)
  if (childTypes.length === 0) return []

  const r = getNodeRadius(depth)
  const dotDist = r // centre of dot sits ON the circle edge
  const minAngularSpacing = (DOT_R * 2 + 8) / dotDist
  const spacing = Math.max(minAngularSpacing, 0.42)

  // --- Origin node: split UP / DOWN ---
  if (node.isOrigin) {
    const upTypes = childTypes.filter(t => UP_TYPES.has(t))
    const downTypes = childTypes.filter(t => DOWN_TYPES.has(t))
    const result = []

    // UP dots centred near the top of the circle
    if (upTypes.length > 0) {
      const totalSpan = (upTypes.length - 1) * spacing
      const center = -Math.PI / 2
      for (let i = 0; i < upTypes.length; i++) {
        const angle = center - totalSpan / 2 + i * spacing
        result.push({
          type: upTypes[i],
          angle,
          cx: Math.cos(angle) * dotDist,
          cy: Math.sin(angle) * dotDist,
        })
      }
    }

    // DOWN dots centred near the bottom of the circle.
    // Sweep from LEFT (high angle) to RIGHT (low angle) to match child
    // layout order.
    if (downTypes.length > 0) {
      const totalSpan = (downTypes.length - 1) * spacing
      const center = Math.PI / 2
      for (let i = 0; i < downTypes.length; i++) {
        const angle = center + totalSpan / 2 - i * spacing
        result.push({
          type: downTypes[i],
          angle,
          cx: Math.cos(angle) * dotDist,
          cy: Math.sin(angle) * dotDist,
        })
      }
    }

    return result
  }

  // --- Non-origin node: all dots on the outward side ---
  const centerAngle = labelDir === 'up' ? -Math.PI / 2 : Math.PI / 2
  const totalSpan = (childTypes.length - 1) * spacing
  const result = []

  for (let i = 0; i < childTypes.length; i++) {
    // Bottom arc: reverse sweep (left=high angle → right=low angle)
    // Top arc:    normal sweep  (left=low angle → right=high angle)
    const angle =
      centerAngle > 0
        ? centerAngle + totalSpan / 2 - i * spacing
        : centerAngle - totalSpan / 2 + i * spacing
    result.push({
      type: childTypes[i],
      angle,
      cx: Math.cos(angle) * dotDist,
      cy: Math.sin(angle) * dotDist,
    })
  }

  return result
}

/**
 * Return a single neutral "expand" indicator for an unfetched non-origin node.
 * Returns null if: node is origin, already fetched, has populated children, or at max depth.
 */
export function getUnfetchedIndicator(node, depth, labelDir, fetchedNodeIds, maxDepth = 6) {
  if (node.isOrigin) return null
  if (depth >= maxDepth) return null
  if (fetchedNodeIds.has(node.id)) return null
  if (getChildTypes(node).length > 0) return null

  const r = getNodeRadius(depth)
  const angle = labelDir === 'up' ? -Math.PI / 2 : Math.PI / 2
  return {
    angle,
    cx: Math.cos(angle) * r,
    cy: Math.sin(angle) * r,
  }
}

// ---------------------------------------------------------------------------
// Spatial extents
// ---------------------------------------------------------------------------

/**
 * Visual width of a single node (circle + label), ignoring children.
 * Used as the minimum column width when laying out a subtree.
 */
export function nodeVisualWidth(node, depth, measureTextFn) {
  const r = getNodeRadius(depth)
  const labelFs = getLabelFontSize(depth, node.isOrigin)
  const labelW = measureTextFn(node.label, labelFs, 500)
  return Math.max(r * 2 + DOT_R * 2, labelW + 12) + MIN_NODE_GAP_H
}

/**
 * Vertical extent of a node measured from its centre.
 * Returns `{ above, below }` — the distance from centre to the top/bottom
 * edge of the node's visual footprint (circle + label).
 */
export function nodeExtent(node, depth, labelDir) {
  const r = getNodeRadius(depth)
  const labelH = getLabelFontSize(depth, node.isOrigin) + 6

  if (node.isOrigin) {
    return { above: r + DOT_R + 2, below: r + labelH + 4 }
  }

  if (labelDir === 'up') {
    return { above: r + labelH + 4, below: r + DOT_R + 2 }
  }
  return { above: r + DOT_R + 2, below: r + labelH + 4 }
}

// ---------------------------------------------------------------------------
// Subtree width
// ---------------------------------------------------------------------------

/**
 * Recursive width of a node's subtree, accounting for expanded children.
 *
 * @param {object}   node           — tree node
 * @param {number}   depth          — current depth
 * @param {string}   direction      — 'up' | 'down'
 * @param {Map}      expandedState  — Map<nodeId, Set<connectionType>>
 * @param {Function} measureTextFn  — (text, fontSize, weight) => number
 */
export function subtreeWidth(node, depth, direction, expandedState, measureTextFn) {
  const w = nodeVisualWidth(node, depth, measureTextFn)

  const types = expandedState.get(node.id)
  if (!types || types.size === 0) return w

  let childrenW = 0
  for (const type of types) {
    for (const kid of node.children[type] || []) {
      childrenW += subtreeWidth(kid, depth + 1, direction, expandedState, measureTextFn)
    }
  }

  return Math.max(w, childrenW)
}

// ---------------------------------------------------------------------------
// Full tree layout — radial hub-and-spoke
// ---------------------------------------------------------------------------

/** Distance from parent to children at each depth level. */
const RADIAL_DISTANCES = [130, 110, 90, 80, 70, 65]
function getRadialDistance(parentDepth) {
  return RADIAL_DISTANCES[Math.min(parentDepth, RADIAL_DISTANCES.length - 1)]
}

/**
 * Lay out the full tree starting from `rootNode` using a radial fan layout.
 *
 * Origin children spread in arcs: UP types in the upper semicircle,
 * DOWN types in the lower semicircle. Deeper nodes fan outward in the
 * same direction as their incoming angle from parent.
 *
 * @param {object}   rootNode       — the origin node (isOrigin should be true)
 * @param {Map}      expandedState  — Map<nodeId, Set<connectionType>>
 * @param {number}   centerX        — x position of the root node
 * @param {number}   centerY        — y position of the root node
 * @param {Function} measureTextFn  — (text, fontSize, weight) => number (unused but kept for API compat)
 * @returns {{ nodes: Array, edges: Array }}
 */
export function layoutTree(rootNode, expandedState, centerX, centerY, _measureTextFn) {
  const result = []
  const edges = []

  /**
   * Count visible descendants (expanded children + their expanded children, etc.)
   * Used to allocate angular budget proportionally.
   */
  function countVisibleDescendants(node) {
    const expanded = expandedState.get(node.id)
    if (!expanded || expanded.size === 0) return 0
    let count = 0
    for (const type of expanded) {
      for (const kid of node.children[type] || []) {
        count += 1 + countVisibleDescendants(kid)
      }
    }
    return count
  }

  function placeNode(node, cx, cy, depth, parentId, connectionType, incomingAngle, angularBudget) {
    const r = getNodeRadius(depth)
    let labelDir = 'down'
    if (incomingAngle !== null && Math.sin(incomingAngle) < -0.2) {
      labelDir = 'up'
    }

    result.push({
      node,
      x: cx,
      y: cy,
      r,
      depth,
      parentId,
      connectionType,
      labelDir,
      alpha: 1,
    })

    const expanded = expandedState.get(node.id)
    if (!expanded || expanded.size === 0) return

    const activeTypes = getChildTypes(node).filter(t => expanded.has(t))
    if (activeTypes.length === 0) return

    if (node.isOrigin) {
      const upKids = collectKids(
        node,
        activeTypes.filter(t => UP_TYPES.has(t))
      )
      const downKids = collectKids(
        node,
        activeTypes.filter(t => DOWN_TYPES.has(t))
      )
      if (upKids.length > 0) fanOut(node, cx, cy, depth, upKids, -Math.PI / 2, Math.PI)
      if (downKids.length > 0) fanOut(node, cx, cy, depth, downKids, Math.PI / 2, Math.PI)
    } else {
      const outAngle = incomingAngle ?? Math.PI / 2
      const budget = angularBudget ?? Math.PI
      const allKids = collectKids(node, activeTypes)
      if (allKids.length > 0) fanOut(node, cx, cy, depth, allKids, outAngle, budget)
    }
  }

  function collectKids(node, types) {
    const kids = []
    for (const t of types) {
      for (const k of node.children[t] || []) kids.push({ kid: k, type: t })
    }
    return kids
  }

  function fanOut(parent, px, py, parentDepth, kids, centerAngle, totalBudget) {
    const n = kids.length
    const childDepth = parentDepth + 1
    const childR = getNodeRadius(childDepth)
    const minGap = childR * 2 + MIN_NODE_GAP_H
    const baseDist = getRadialDistance(parentDepth)

    // Clamp total budget to avoid wrapping past 270°
    const maxArc = Math.PI * 1.5
    const budget = Math.min(totalBudget, maxArc)

    // Compute minimum arc needed to avoid direct child overlap
    const neededArc = n <= 1 ? 0 : ((n - 1) * minGap) / baseDist
    const arc = Math.min(Math.max(neededArc, (n - 1) * 0.3), budget)

    // If children can't fit at base distance, push outward
    const dist =
      arc > 0 && neededArc > budget ? Math.max(((n - 1) * minGap) / budget, baseDist) : baseDist

    // Compute weight for each child proportional to 1 + visible descendants
    const weights = kids.map(({ kid }) => 1 + countVisibleDescendants(kid))
    const totalWeight = weights.reduce((s, w) => s + w, 0)

    // Build cumulative positions: each child sits at the centre of its budget slice
    const positions = []
    let cumulative = 0
    for (let i = 0; i < n; i++) {
      const fraction = weights[i] / totalWeight
      const childBudgetFraction = fraction * budget
      const midpoint = cumulative + fraction / 2
      positions.push({ midpoint, childBudget: childBudgetFraction })
      cumulative += fraction
    }

    for (let i = 0; i < n; i++) {
      const { kid, type } = kids[i]
      // Map midpoint [0,1] → angle offset from center
      const t = positions[i].midpoint - 0.5
      const angle = centerAngle + t * arc
      const kidX = px + Math.cos(angle) * dist
      const kidY = py + Math.sin(angle) * dist

      edges.push({
        fromId: parent.id,
        toId: kid.id,
        type,
        direction: UP_TYPES.has(type) ? 'up' : 'down',
      })
      placeNode(kid, kidX, kidY, childDepth, parent.id, type, angle, positions[i].childBudget)
    }
  }

  placeNode(rootNode, centerX, centerY, 0, null, null, null)
  return { nodes: result, edges }
}

// ---------------------------------------------------------------------------
// Auto-fit camera
// ---------------------------------------------------------------------------

/**
 * Compute camera transform (x, y, zoom) that fits all laid-out nodes within
 * the given canvas dimensions.
 *
 * @param {Array}    nodes          — output of layoutTree().nodes
 * @param {number}   canvasW        — canvas width in CSS pixels
 * @param {number}   canvasH        — canvas height in CSS pixels
 * @param {Function} measureTextFn  — (text, fontSize, weight) => number
 * @returns {{ x: number, y: number, zoom: number }}
 */
export function computeAutoFit(nodes, canvasW, canvasH, measureTextFn) {
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 }

  const pad = 80
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const n of nodes) {
    const ext = nodeExtent(n.node, n.depth, n.labelDir)
    const labelFs = getLabelFontSize(n.depth, n.node.isOrigin)
    const halfW = Math.max(n.r + DOT_R, measureTextFn(n.node.label, labelFs, 500) / 2 + 6)
    minX = Math.min(minX, n.x - halfW)
    maxX = Math.max(maxX, n.x + halfW)
    minY = Math.min(minY, n.y - ext.above)
    maxY = Math.max(maxY, n.y + ext.below)
  }

  const contentW = maxX - minX + pad * 2
  const contentH = maxY - minY + pad * 2
  const zoom = Math.max(0.45, Math.min(canvasW / contentW, canvasH / contentH, 1.2))

  return {
    zoom,
    x: canvasW / 2 - ((minX + maxX) / 2) * zoom,
    y: canvasH / 2 - ((minY + maxY) / 2) * zoom,
  }
}
