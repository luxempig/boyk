/**
 * @component CanvasNetworkGraph
 * @level Organism
 * @interactions Canvas-rendered network graph with pan/zoom, dot-based expansion, and lazy child fetching from Neo4j.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CONNECTION_COLORS } from '../../lib/connectionColors'
import { clearImageCache, getLoadedImage, preloadImages } from '../../lib/networkImageLoader'
import {
  ANIM_SPEED,
  computeAutoFit,
  DOT_R,
  DOT_R_ACTIVE,
  getChildTypes,
  getDotLayout,
  getInitialsFontSize,
  getLabelFontSize,
  getUnfetchedIndicator,
  layoutTree,
} from '../../lib/networkLayout'
import { getCompanyLinkId, getCompanyWithConnections } from '../../services/neo4jGraph'
import GraphLegend from '../molecules/GraphLegend'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CARD_COLOR_LIGHT = '#27272a'
const BORDER_COLOR = 'rgba(0,0,0,0.12)'
const MAX_DEPTH = 6

// Read theme colors from CSS variables at draw time so node accents and
// labels remain legible across light and dark themes.
function readThemeColors() {
  const styles = getComputedStyle(document.documentElement)
  return {
    primary: styles.getPropertyValue('--text-primary').trim() || '#e4e4e7',
    secondary: styles.getPropertyValue('--text-secondary').trim() || '#a1a1aa',
    muted: styles.getPropertyValue('--text-muted').trim() || '#71717a',
    accent: styles.getPropertyValue('--accent').trim() || '#f472b6',
    accentGlow: styles.getPropertyValue('--accent-glow').trim() || 'rgba(244, 114, 182, 0.45)',
  }
}

// Rewrite the alpha channel of an rgb()/rgba() or #rrggbb color string.
// Used to derive gradient stops from the computed --accent-glow token.
function withAlpha(color, alpha) {
  const rgbaMatch = color.match(/rgba?\(([^)]+)\)/)
  if (rgbaMatch) {
    const [r, g, b] = rgbaMatch[1].split(',').map(part => part.trim())
    return `rgba(${r},${g},${b},${alpha})`
  }
  const hexMatch = color.match(/^#([0-9a-f]{6})$/i)
  if (hexMatch) {
    const int = parseInt(hexMatch[1], 16)
    return `rgba(${(int >> 16) & 255},${(int >> 8) & 255},${int & 255},${alpha})`
  }
  return `rgba(244,114,182,${alpha})` // fallback: brand pink accent
}

// ---------------------------------------------------------------------------
// Pure helpers (no React dependencies)
// ---------------------------------------------------------------------------

function lerp(a, b, t) {
  return a + (b - a) * t
}

function mapChild(item) {
  return {
    id: getCompanyLinkId(item) || item.id,
    label: item.name,
    logo_url: item.logo_url,
    children: {},
  }
}

function capChildren(items) {
  return items.map(c => mapChild(c))
}

function buildTree(company, connections) {
  return {
    id: getCompanyLinkId(company) || company.id,
    label: company.name,
    logo_url: company.logo_url,
    isOrigin: true,
    children: {
      owned_by: capChildren(connections.owned_by || []),
      owns: capChildren(connections.owns || []),
      invested_in_by: capChildren(connections.invested_in_by || []),
      invests_in: capChildren(connections.invests_in || []),
      brands: capChildren(connections.brands || []),
      suppliers: capChildren(connections.suppliers || []),
      customers: capChildren(connections.customers || []),
      people: capChildren(connections.people || []),
    },
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Collect all image URLs from a tree for preloading
function collectTreeImageUrls(node) {
  const urls = []
  if (node.logo_url) urls.push(node.logo_url)
  for (const type of Object.keys(node.children || {})) {
    for (const child of node.children[type] || []) {
      urls.push(...collectTreeImageUrls(child))
    }
  }
  return urls
}

const GRAPH_STATE_KEY = 'network-graph-state'

export default function CanvasNetworkGraph({ company, connections, onCompanyClick, autoExpand }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const ctxRef = useRef(null)
  const dprRef = useRef(window.devicePixelRatio || 1)
  const themeColorsRef = useRef({
    primary: '#e4e4e7',
    secondary: '#a1a1aa',
    muted: '#71717a',
    accent: '#f472b6',
    accentGlow: 'rgba(244, 114, 182, 0.45)',
  })

  // Track current company ID for save-on-navigate
  const companyIdRef = useRef(null)

  // Tree data (mutable ref to avoid re-renders)
  const treeRef = useRef(null)
  const expandedStateRef = useRef(new Map())
  const fetchedNodesRef = useRef(new Set())

  // Animation state (all mutable refs)
  const nodePositionsRef = useRef(new Map())
  const currentEdgesRef = useRef([])
  const animatingRef = useRef(false)

  // Viewport
  const vpXRef = useRef(0)
  const vpYRef = useRef(0)
  const vpZoomRef = useRef(1)
  const vpTargetXRef = useRef(0)
  const vpTargetYRef = useRef(0)
  const vpTargetZoomRef = useRef(1)

  // Whether the next layout is the initial one (auto-expand + custom zoom)
  const isInitialLayoutRef = useRef(false)

  // Drag state
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 })
  const didDragRef = useRef(false)

  // Pinch state
  const lastPinchDistRef = useRef(0)

  // Loading UI state (triggers re-render for the loading indicator)
  const [loadingNode, setLoadingNode] = useState(null)

  // -------------------------------------------------------------------------
  // Text measurement
  // -------------------------------------------------------------------------
  const textWidthCache = useRef({})
  const textWidthCacheSize = useRef(0)
  const measureTextFn = useCallback((text, fontSize, weight) => {
    const key = `${text}|${fontSize}|${weight}`
    if (textWidthCache.current[key] !== undefined) return textWidthCache.current[key]
    const ctx = ctxRef.current
    if (!ctx) return text.length * fontSize * 0.5
    // Evict cache when it gets too large
    if (textWidthCacheSize.current > 500) {
      textWidthCache.current = {}
      textWidthCacheSize.current = 0
    }
    ctx.save()
    ctx.font = `${weight} ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
    const w = ctx.measureText(text).width
    ctx.restore()
    textWidthCache.current[key] = w
    textWidthCacheSize.current++
    return w
  }, [])

  // -------------------------------------------------------------------------
  // Drawing functions (read from refs, defined inside component)
  // -------------------------------------------------------------------------

  function drawEdge(ctx, from, to, edge, alpha) {
    const color = CONNECTION_COLORS[edge.type] || '#555'
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    const fromX = from.x + from.r * Math.cos(angle)
    const fromY = from.y + from.r * Math.sin(angle)
    const toX = to.x - to.r * Math.cos(angle)
    const toY = to.y - to.r * Math.sin(angle)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(toX, toY)
    ctx.stroke()

    // Arrowhead at the "to" end
    const arrowLen = 8
    const arrowWidth = Math.PI / 7
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(toX, toY)
    ctx.lineTo(
      toX - arrowLen * Math.cos(angle - arrowWidth),
      toY - arrowLen * Math.sin(angle - arrowWidth)
    )
    ctx.lineTo(
      toX - arrowLen * Math.cos(angle + arrowWidth),
      toY - arrowLen * Math.sin(angle + arrowWidth)
    )
    ctx.closePath()
    ctx.fill()

    ctx.restore()
  }

  function drawNode(ctx, pos) {
    const { x, y, r, node, depth, alpha, labelDir } = pos
    const isOrigin = node.isOrigin
    const expandedTypes = expandedStateRef.current.get(node.id)

    ctx.save()
    ctx.globalAlpha = alpha

    // Subtle glow for origin only
    if (isOrigin) {
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.8)
      glow.addColorStop(0, withAlpha(themeColorsRef.current.accentGlow, 0.1))
      glow.addColorStop(1, withAlpha(themeColorsRef.current.accentGlow, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, r * 1.8, 0, Math.PI * 2)
      ctx.fill()
    }

    // Draw circle with logo or fallback
    const img = getLoadedImage(node.logo_url)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)

    if (img) {
      // White background for PNG transparency
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      // Clip and draw logo
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.clip()
      const size = r * 2
      ctx.drawImage(img, x - r, y - r, size, size)
      ctx.restore()
    } else {
      // Lighter fallback circle with initial
      ctx.fillStyle = CARD_COLOR_LIGHT
      ctx.fill()
      // Draw initial
      const initials = node.label?.charAt(0)?.toUpperCase() || '?'
      const fontSize = getInitialsFontSize(depth, isOrigin)
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = themeColorsRef.current.primary
      ctx.fillText(initials, x, y)
    }

    // Border
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.lineWidth = isOrigin ? 2 : 1.5
    ctx.strokeStyle = isOrigin ? themeColorsRef.current.accent : BORDER_COLOR
    ctx.stroke()

    // Label below/above the circle
    const labelFs = getLabelFontSize(depth, isOrigin)
    const sign = labelDir === 'up' ? -1 : 1
    const labelY = y + sign * (r + DOT_R + 4 + labelFs * 0.5)
    ctx.font = `500 ${labelFs}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = isOrigin
      ? themeColorsRef.current.primary
      : depth <= 1
        ? themeColorsRef.current.primary
        : themeColorsRef.current.secondary
    ctx.fillText(node.label, x, labelY)

    // Indicator dots ON circle border (skip at max depth)
    const dots = depth < MAX_DEPTH ? getDotLayout(node, depth, labelDir) : []
    for (const dot of dots) {
      const expanded = expandedTypes?.has(dot.type)
      const dr = expanded ? DOT_R_ACTIVE : DOT_R
      const dotCx = x + dot.cx
      const dotCy = y + dot.cy

      // Background to mask the circle border
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(dotCx, dotCy, dr + 2.5, 0, Math.PI * 2)
      ctx.fillStyle = img ? '#ffffff' : CARD_COLOR_LIGHT
      ctx.fill()

      // The dot itself
      ctx.beginPath()
      ctx.arc(dotCx, dotCy, dr, 0, Math.PI * 2)
      ctx.fillStyle = CONNECTION_COLORS[dot.type] || '#555'
      ctx.globalAlpha = alpha * (expanded ? 1 : 0.3)
      ctx.fill()

      // Subtle ring for expanded dots
      if (expanded) {
        ctx.globalAlpha = alpha * 0.35
        ctx.lineWidth = 1.5
        ctx.strokeStyle = CONNECTION_COLORS[dot.type]
        ctx.beginPath()
        ctx.arc(dotCx, dotCy, dr + 4, 0, Math.PI * 2)
        ctx.stroke()
      }

      ctx.globalAlpha = alpha
    }

    // Unfetched expand indicator (neutral dot for nodes not yet fetched)
    const unfetchedDot =
      depth < MAX_DEPTH
        ? getUnfetchedIndicator(node, depth, labelDir, fetchedNodesRef.current, MAX_DEPTH)
        : null
    if (unfetchedDot) {
      const uCx = x + unfetchedDot.cx
      const uCy = y + unfetchedDot.cy
      const uR = DOT_R

      // Background mask
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(uCx, uCy, uR + 2.5, 0, Math.PI * 2)
      ctx.fillStyle = img ? '#ffffff' : CARD_COLOR_LIGHT
      ctx.fill()

      // Dot — neutral gray, semi-transparent
      ctx.beginPath()
      ctx.arc(uCx, uCy, uR, 0, Math.PI * 2)
      ctx.fillStyle = themeColorsRef.current.muted
      ctx.globalAlpha = alpha * 0.4
      ctx.fill()

      // Plus sign inside the dot
      ctx.globalAlpha = alpha * 0.7
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.2
      const pSize = uR * 0.5
      ctx.beginPath()
      ctx.moveTo(uCx - pSize, uCy)
      ctx.lineTo(uCx + pSize, uCy)
      ctx.moveTo(uCx, uCy - pSize)
      ctx.lineTo(uCx, uCy + pSize)
      ctx.stroke()

      ctx.globalAlpha = alpha
    }

    ctx.restore()
  }

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = ctxRef.current
    if (!ctx) return
    const dpr = dprRef.current
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    themeColorsRef.current = readThemeColors()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    ctx.save()
    ctx.translate(vpXRef.current, vpYRef.current)
    ctx.scale(vpZoomRef.current, vpZoomRef.current)

    // Edges first
    for (const edge of currentEdgesRef.current) {
      const from = nodePositionsRef.current.get(edge.fromId)
      const to = nodePositionsRef.current.get(edge.toId)
      if (!from || !to) continue
      const alpha = Math.min(from.alpha, to.alpha) * 0.5
      if (alpha < 0.01) continue
      drawEdge(ctx, from, to, edge, alpha)
    }

    // Nodes on top
    const sorted = [...nodePositionsRef.current.values()]
      .filter(p => p.alpha > 0.01)
      .sort((a, b) => a.depth - b.depth)
    for (const pos of sorted) drawNode(ctx, pos)

    // Empty state: show hint when origin has no connections
    if (sorted.length === 1 && sorted[0].node.isOrigin) {
      const types = getChildTypes(sorted[0].node)
      if (types.length === 0) {
        const origin = sorted[0]
        ctx.font = '400 12px -apple-system, BlinkMacSystemFont, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = themeColorsRef.current.muted
        ctx.fillText('No known connections', origin.x, origin.y + origin.r + 40)
      }
    }

    ctx.restore()
  }

  // -------------------------------------------------------------------------
  // Animation loop
  // -------------------------------------------------------------------------

  function animate() {
    let moving = false
    const positions = nodePositionsRef.current

    for (const [, pos] of positions) {
      if (
        Math.abs(pos.targetX - pos.x) > 0.3 ||
        Math.abs(pos.targetY - pos.y) > 0.3 ||
        Math.abs(pos.targetAlpha - pos.alpha) > 0.005
      ) {
        pos.x = lerp(pos.x, pos.targetX, ANIM_SPEED)
        pos.y = lerp(pos.y, pos.targetY, ANIM_SPEED)
        pos.alpha = lerp(pos.alpha, pos.targetAlpha, ANIM_SPEED)
        moving = true
      } else {
        pos.x = pos.targetX
        pos.y = pos.targetY
        pos.alpha = pos.targetAlpha
      }
    }

    const vpX = vpXRef.current
    const vpY = vpYRef.current
    const vpZoom = vpZoomRef.current
    if (
      Math.abs(vpX - vpTargetXRef.current) > 0.3 ||
      Math.abs(vpY - vpTargetYRef.current) > 0.3 ||
      Math.abs(vpZoom - vpTargetZoomRef.current) > 0.001
    ) {
      vpXRef.current = lerp(vpX, vpTargetXRef.current, ANIM_SPEED)
      vpYRef.current = lerp(vpY, vpTargetYRef.current, ANIM_SPEED)
      vpZoomRef.current = lerp(vpZoom, vpTargetZoomRef.current, ANIM_SPEED)
      moving = true
    } else {
      vpXRef.current = vpTargetXRef.current
      vpYRef.current = vpTargetYRef.current
      vpZoomRef.current = vpTargetZoomRef.current
    }

    draw()

    for (const [id, pos] of positions) {
      if (pos.alpha < 0.01 && pos.targetAlpha === 0) positions.delete(id)
    }

    if (moving) {
      requestAnimationFrame(animate)
    } else {
      animatingRef.current = false
    }
  }

  // -------------------------------------------------------------------------
  // State save/restore for back-navigation
  // -------------------------------------------------------------------------

  function saveGraphState() {
    const id = companyIdRef.current
    const tree = treeRef.current
    if (!id || !tree) return
    try {
      const state = {
        companyId: id,
        tree,
        expanded: [...expandedStateRef.current.entries()].map(([nid, types]) => [nid, [...types]]),
        viewport: {
          x: vpTargetXRef.current,
          y: vpTargetYRef.current,
          zoom: vpTargetZoomRef.current,
        },
        fetchedNodes: [...fetchedNodesRef.current],
      }
      sessionStorage.setItem(GRAPH_STATE_KEY, JSON.stringify(state))
    } catch {
      /* ignore quota errors */
    }
  }

  function tryRestoreGraphState(companyId) {
    try {
      const raw = sessionStorage.getItem(GRAPH_STATE_KEY)
      if (!raw) return false
      const state = JSON.parse(raw)
      if (state.companyId !== companyId) return false
      sessionStorage.removeItem(GRAPH_STATE_KEY)

      treeRef.current = state.tree
      expandedStateRef.current = new Map(
        state.expanded.map(([nid, types]) => [nid, new Set(types)])
      )
      fetchedNodesRef.current = new Set(state.fetchedNodes)
      nodePositionsRef.current = new Map()
      currentEdgesRef.current = []

      // Set viewport directly (no animation)
      vpXRef.current = state.viewport.x
      vpYRef.current = state.viewport.y
      vpZoomRef.current = state.viewport.zoom
      vpTargetXRef.current = state.viewport.x
      vpTargetYRef.current = state.viewport.y
      vpTargetZoomRef.current = state.viewport.zoom
      isInitialLayoutRef.current = false

      // Preload images then layout
      const urls = collectTreeImageUrls(state.tree)
      scheduleLayout()
      preloadImages(urls).then(() => {
        if (!animatingRef.current) {
          animatingRef.current = true
          animate()
        }
      })
      return true
    } catch {
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Layout scheduling
  // -------------------------------------------------------------------------

  function scheduleLayout() {
    const tree = treeRef.current
    if (!tree) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = dprRef.current
    const canvasW = canvas.width / dpr
    const canvasH = canvas.height / dpr

    const { nodes, edges } = layoutTree(
      tree,
      expandedStateRef.current,
      canvasW / 2,
      canvasH * 0.42,
      measureTextFn
    )

    currentEdgesRef.current = edges
    const activeIds = new Set(nodes.map(n => n.node.id))

    for (const { node, x, y, r, depth, connectionType, labelDir } of nodes) {
      let pos = nodePositionsRef.current.get(node.id)
      if (!pos) {
        const parentEdge = edges.find(e => e.toId === node.id)
        const parentPos = parentEdge ? nodePositionsRef.current.get(parentEdge.fromId) : null
        pos = {
          x: parentPos ? parentPos.x : x,
          y: parentPos ? parentPos.y : y,
          targetX: x,
          targetY: y,
          r,
          depth,
          alpha: 0,
          targetAlpha: 1,
          node,
          connectionType,
          labelDir,
        }
        nodePositionsRef.current.set(node.id, pos)
      }
      pos.targetX = x
      pos.targetY = y
      pos.targetAlpha = 1
      pos.r = r
      pos.depth = depth
      pos.node = node
      pos.connectionType = connectionType
      pos.labelDir = labelDir
    }

    for (const [, pos] of nodePositionsRef.current) {
      if (!activeIds.has(pos.node.id)) pos.targetAlpha = 0
    }

    if (isInitialLayoutRef.current) {
      // Initial load: use auto-fit to center all expanded nodes
      const fit = computeAutoFit(nodes, canvasW, canvasH, measureTextFn)
      vpTargetXRef.current = fit.x
      vpTargetYRef.current = fit.y
      vpTargetZoomRef.current = fit.zoom
      // Snap viewport immediately so first frame is positioned correctly
      vpXRef.current = fit.x
      vpYRef.current = fit.y
      vpZoomRef.current = fit.zoom
      isInitialLayoutRef.current = false
    }

    if (!animatingRef.current) {
      animatingRef.current = true
      animate()
    }
  }

  // -------------------------------------------------------------------------
  // Hit detection
  // -------------------------------------------------------------------------

  function screenToWorld(sx, sy) {
    return {
      x: (sx - vpXRef.current) / vpZoomRef.current,
      y: (sy - vpYRef.current) / vpZoomRef.current,
    }
  }

  function findDotAt(wx, wy) {
    const entries = [...nodePositionsRef.current.entries()].reverse()
    for (const [, pos] of entries) {
      if (pos.alpha < 0.3) continue

      // Check regular expansion dots first
      const dots = getDotLayout(pos.node, pos.depth, pos.labelDir)
      for (const dot of dots) {
        const dx = wx - (pos.x + dot.cx)
        const dy = wy - (pos.y + dot.cy)
        const hitR = DOT_R + 12
        if (dx * dx + dy * dy < hitR * hitR) {
          return { node: pos.node, type: dot.type }
        }
      }

      // Check unfetched expand indicator
      const unfetched = getUnfetchedIndicator(
        pos.node,
        pos.depth,
        pos.labelDir,
        fetchedNodesRef.current,
        MAX_DEPTH
      )
      if (unfetched) {
        const dx = wx - (pos.x + unfetched.cx)
        const dy = wy - (pos.y + unfetched.cy)
        const hitR = DOT_R + 12
        if (dx * dx + dy * dy < hitR * hitR) {
          return { node: pos.node, type: '__unfetched__' }
        }
      }
    }
    return null
  }

  function findNodeAt(wx, wy) {
    const entries = [...nodePositionsRef.current.entries()].reverse()
    for (const [, pos] of entries) {
      if (pos.alpha < 0.3) continue
      const dx = wx - pos.x
      const dy = wy - pos.y
      if (dx * dx + dy * dy < (pos.r - DOT_R) * (pos.r - DOT_R)) return pos
    }
    return null
  }

  // -------------------------------------------------------------------------
  // Expansion logic
  // -------------------------------------------------------------------------

  function populateChildren(node, apiConnections) {
    const ancestors = getAncestorIds(node.id)
    ancestors.add(node.id) // also exclude self
    for (const key of [
      'owned_by',
      'owns',
      'invested_in_by',
      'invests_in',
      'brands',
      'suppliers',
      'customers',
      'people',
    ]) {
      const items = apiConnections[key]
      if (items?.length > 0 && (!node.children[key] || node.children[key].length === 0)) {
        node.children[key] = items.map(c => mapChild(c)).filter(c => !ancestors.has(c.id))
      }
    }
  }

  function collapseDescendants(node, type) {
    for (const kid of node.children[type] || []) {
      const kidTypes = expandedStateRef.current.get(kid.id)
      if (kidTypes) {
        for (const t of kidTypes) collapseDescendants(kid, t)
        kidTypes.clear()
      }
    }
  }

  // Get the depth of a node by looking it up in current positions
  function getNodeDepth(nodeId) {
    const pos = nodePositionsRef.current.get(nodeId)
    return pos ? pos.depth : 0
  }

  // Collect ancestor IDs from root down to a given node
  function getAncestorIds(targetId) {
    const ancestors = new Set()
    function walk(n) {
      if (n.id === targetId) return true
      ancestors.add(n.id)
      for (const type of Object.keys(n.children)) {
        for (const kid of n.children[type] || []) {
          if (walk(kid)) return true
        }
      }
      ancestors.delete(n.id)
      return false
    }
    if (treeRef.current) walk(treeRef.current)
    return ancestors
  }

  async function handleDotClick(node, connectionType) {
    // Depth limit: don't expand past MAX_DEPTH
    const depth = getNodeDepth(node.id)
    if (depth >= MAX_DEPTH) return

    // Unfetched node: fetch connections, show colored dots (don't expand yet)
    if (connectionType === '__unfetched__') {
      if (fetchedNodesRef.current.has(node.id)) return
      setLoadingNode(node.id)
      try {
        const data = await getCompanyWithConnections(node.id)
        if (data?.connections) {
          populateChildren(node, data.connections)
          fetchedNodesRef.current.add(node.id)
          // Preload logos so they're ready when user expands a type
          const urls = Object.values(data.connections)
            .flat()
            .map(c => c.logo_url)
          preloadImages(urls).then(() => scheduleLayout())
        }
      } finally {
        setLoadingNode(null)
      }
      scheduleLayout()
      return
    }

    let types = expandedStateRef.current.get(node.id)
    if (!types) {
      types = new Set()
      expandedStateRef.current.set(node.id, types)
    }

    if (types.has(connectionType)) {
      // Collapse
      types.delete(connectionType)
      collapseDescendants(node, connectionType)
      scheduleLayout()
      return
    }

    // Check if we need to fetch children
    const kids = node.children[connectionType]
    if ((!kids || kids.length === 0) && !fetchedNodesRef.current.has(node.id)) {
      setLoadingNode(node.id)
      try {
        const data = await getCompanyWithConnections(node.id)
        if (data?.connections) {
          populateChildren(node, data.connections)
          fetchedNodesRef.current.add(node.id)
          // Preload new logos
          const urls = Object.values(data.connections)
            .flat()
            .map(c => c.logo_url)
          preloadImages(urls).then(() => scheduleLayout())
        }
      } finally {
        setLoadingNode(null)
      }
    }

    types.add(connectionType)
    scheduleLayout()
  }

  // -------------------------------------------------------------------------
  // Canvas setup and resize
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctxRef.current = ctx
    const container = containerRef.current

    function resize() {
      if (!container) return
      const rect = container.getBoundingClientRect()
      dprRef.current = window.devicePixelRatio || 1
      canvas.width = rect.width * dprRef.current
      canvas.height = rect.height * dprRef.current
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'
      scheduleLayout()
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Build tree on company change
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!company) return
    companyIdRef.current = company.id || getCompanyLinkId(company)

    // Try to restore saved state (from back navigation)
    if (tryRestoreGraphState(companyIdRef.current)) {
      return () => clearImageCache()
    }

    // Build tree from company data
    const tree = buildTree(company, connections || {})
    treeRef.current = tree
    fetchedNodesRef.current = new Set()
    nodePositionsRef.current = new Map()
    currentEdgesRef.current = []
    textWidthCache.current = {}

    // Auto-expand all connection types that have children for the origin
    const expanded = new Map()
    const types = getChildTypes(tree)
    if (types.length > 0) {
      expanded.set(tree.id, new Set(types))
    }
    expandedStateRef.current = expanded
    isInitialLayoutRef.current = true

    // Preload images
    const urls = [
      company.logo_url,
      ...Object.values(connections || {})
        .flat()
        .map(c => c.logo_url),
    ]
    // Initial layout (uses custom zoom via isInitialLayoutRef)
    scheduleLayout()

    // Once images load, just redraw — layout/zoom is already set
    preloadImages(urls).then(() => {
      if (!animatingRef.current) {
        animatingRef.current = true
        animate()
      }
    })

    // Auto-expand blocked connection types for boycott child nodes
    if (autoExpand && autoExpand.size > 0) {
      ;(async () => {
        for (const type of Object.keys(tree.children)) {
          for (const child of tree.children[type]) {
            const expandTypes = autoExpand.get(child.id)
            if (!expandTypes || expandTypes.length === 0) continue
            try {
              const data = await getCompanyWithConnections(child.id)
              if (data?.connections) {
                populateChildren(child, data.connections)
                fetchedNodesRef.current.add(child.id)
                const childExpanded = new Set()
                for (const et of expandTypes) {
                  if (child.children[et]?.length > 0) childExpanded.add(et)
                }
                if (childExpanded.size > 0) {
                  expandedStateRef.current.set(child.id, childExpanded)
                }
              }
            } catch {
              /* skip nodes that fail to load */
            }
          }
        }
        isInitialLayoutRef.current = true
        const allUrls = collectTreeImageUrls(tree)
        preloadImages(allUrls).then(() => scheduleLayout())
        scheduleLayout()
      })()
    }

    return () => clearImageCache()
  }, [company?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Pointer events
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function handlePointerDown(e) {
      isDraggingRef.current = true
      didDragRef.current = false
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        vpX: vpTargetXRef.current,
        vpY: vpTargetYRef.current,
      }
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = 'grabbing'
    }

    function handlePointerMove(e) {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true
      vpTargetXRef.current = dragStartRef.current.vpX + dx
      vpTargetYRef.current = dragStartRef.current.vpY + dy
      if (!animatingRef.current) {
        animatingRef.current = true
        animate()
      }
    }

    function handlePointerUp(e) {
      isDraggingRef.current = false
      canvas.style.cursor = 'grab'
      if (didDragRef.current) return

      const rect = canvas.getBoundingClientRect()
      const { x: wx, y: wy } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)

      // Priority: dots first
      const dotHit = findDotAt(wx, wy)
      if (dotHit) {
        handleDotClick(dotHit.node, dotHit.type)
        return
      }

      const nodeHit = findNodeAt(wx, wy)
      if (nodeHit && onCompanyClick) {
        saveGraphState()
        onCompanyClick(nodeHit.node.id, nodeHit.connectionType)
      }
    }

    function handleWheel(e) {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.08 : 0.93
      const newZoom = Math.max(0.25, Math.min(2.5, vpTargetZoomRef.current * factor))
      vpTargetXRef.current = sx - (sx - vpTargetXRef.current) * (newZoom / vpTargetZoomRef.current)
      vpTargetYRef.current = sy - (sy - vpTargetYRef.current) * (newZoom / vpTargetZoomRef.current)
      vpTargetZoomRef.current = newZoom
      if (!animatingRef.current) {
        animatingRef.current = true
        animate()
      }
    }

    function handleTouchStart(e) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy)
      }
    }

    function handleTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault()
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (lastPinchDistRef.current > 0) {
          const scale = dist / lastPinchDistRef.current
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
          const newZoom = Math.max(0.25, Math.min(2.5, vpTargetZoomRef.current * scale))
          vpTargetXRef.current =
            cx - (cx - vpTargetXRef.current) * (newZoom / vpTargetZoomRef.current)
          vpTargetYRef.current =
            cy - (cy - vpTargetYRef.current) * (newZoom / vpTargetZoomRef.current)
          vpTargetZoomRef.current = newZoom
          if (!animatingRef.current) {
            animatingRef.current = true
            animate()
          }
        }
        lastPinchDistRef.current = dist
      }
    }

    function handleTouchEnd() {
      lastPinchDistRef.current = 0
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    canvas.addEventListener('touchend', handleTouchEnd)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
      canvas.removeEventListener('touchend', handleTouchEnd)
    }
  }, [onCompanyClick]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', cursor: 'grab', touchAction: 'none' }} />
      <GraphLegend />
      <AnimatePresence>
        {loadingNode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--text-secondary)',
              pointerEvents: 'none',
            }}
          >
            Loading connections...
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
