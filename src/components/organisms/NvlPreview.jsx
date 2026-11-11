/**
 * @component NvlPreview
 * @level Organism
 * @interactions None — static, non-interactive graph preview for the Company detail page.
 *   Renders a force-directed layout via BasicNvlWrapper with pointerEvents disabled.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { mapCompanyToNvl, mapConnectionsToNvl } from '../../lib/nvlMappers'
import { getCompanyLinkId } from '../../services/neo4jGraph'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CONTAINER_HEIGHT = 300
const FIT_DELAY_MS = 800

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build initial NVL nodes + rels from company props. */
function buildInitialGraph(company, connections) {
  const originId = getCompanyLinkId(company) || company.id
  const originNode = mapCompanyToNvl(company, { isOrigin: true })
  const { nodes: childNodes, rels } = mapConnectionsToNvl(originId, connections || {})
  return {
    nodes: [originNode, ...childNodes],
    rels,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NvlPreview({ company, connections }) {
  const nvlRef = useRef(null)
  const [NvlComponent, setNvlComponent] = useState(null)
  const [ready, setReady] = useState(false)

  // ---------------------------------------------------------------------------
  // Lazy-load the BasicNvlWrapper
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    import('@neo4j-nvl/react').then(mod => {
      if (!cancelled) {
        setNvlComponent(() => mod.BasicNvlWrapper)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Build nodes + rels from props
  // ---------------------------------------------------------------------------
  const { nodes, rels } = useMemo(() => {
    if (!company) return { nodes: [], rels: [] }
    return buildInitialGraph(company, connections)
  }, [company, connections])

  // ---------------------------------------------------------------------------
  // Auto-fit after layout settles, then fade in
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!NvlComponent || nodes.length === 0) return

    setReady(false)
    const timer = setTimeout(() => {
      if (nvlRef.current?.fit) {
        nvlRef.current.fit(nodes.map(n => n.id))
      }
      setReady(true)
    }, FIT_DELAY_MS)

    return () => clearTimeout(timer)
  }, [NvlComponent, nodes])

  // ---------------------------------------------------------------------------
  // NVL options — static, no interaction
  // ---------------------------------------------------------------------------
  const nvlOptions = useMemo(
    () => ({
      renderer: 'canvas',
      allowDynamicMinZoom: true,
      disableTelemetry: true,
      minZoom: 0.1,
      maxZoom: 3,
    }),
    []
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!NvlComponent) {
    return (
      <div
        style={{
          width: '100%',
          height: CONTAINER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#71717a',
          fontSize: 13,
        }}
      >
        Loading graph...
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: CONTAINER_HEIGHT,
        pointerEvents: 'none',
        opacity: ready ? 1 : 0,
        transition: 'opacity 0.4s ease-in',
      }}
    >
      <NvlComponent
        ref={nvlRef}
        nodes={nodes}
        rels={rels}
        layout='forceDirected'
        nvlOptions={nvlOptions}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
