import { useRef, useEffect, useState, useCallback } from 'react'
import { select } from 'd3-selection'
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom'

/**
 * useGraphInteraction — handles canvas zoom/pan, node dragging, and hit-testing
 * for the ZIGChain social graph via d3-zoom.
 *
 * Supports:
 * - Pan/zoom via d3-zoom (drag empty space to pan, scroll to zoom)
 * - Individual node dragging (drag a node to reposition it in the simulation)
 * - Click to select, double-click to zoom-to-node
 * - Hover detection
 */
export default function useGraphInteraction(canvasRef, {
  nodes,
  positions,
  adjacency,
  getRadius,
  onSelectNode,
  onHoverNode,
  dragStart,
  dragMove,
  dragEnd,
  focusMode,
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState(null)
  const [draggingNodeId, setDraggingNodeId] = useState(null)

  const zoomBehaviorRef = useRef(null)
  // Pan/zoom lives ONLY in a ref. The canvas redraws every frame from its own
  // rAF loop (which reads this ref), so a React state + per-frame re-render
  // would be pure waste — it never drove the draw. Exposed as `transformRef`.
  const transformRef = useRef({ x: 0, y: 0, k: 1 })

  // Drag state refs
  const draggingNodeRef = useRef(null)
  const didDragRef = useRef(false)
  // Tracks the currently-hovered node id so mousemove only pushes React state
  // when the hovered node actually changes (not on every pixel of movement).
  const hoveredNodeRef = useRef(null)

  // Keep refs current for use inside event handlers (avoids stale closures)
  const nodesRef = useRef(nodes)
  const positionsRef = useRef(positions)
  const focusModeRef = useRef(focusMode)
  nodesRef.current = nodes
  positionsRef.current = positions
  focusModeRef.current = focusMode

  // ── Hit-test: find node at screen coordinates ────────────────────────────
  const findNodeAtPoint = useCallback((screenX, screenY) => {
    const t = transformRef.current
    // Convert screen coords → graph coords via inverse transform
    const graphX = (screenX - t.x) / t.k
    const graphY = (screenY - t.y) / t.k

    const currentNodes = nodesRef.current
    const currentPositions = positionsRef.current

    // Iterate in reverse so nodes drawn on top are hit first
    for (let i = currentNodes.length - 1; i >= 0; i--) {
      const node = currentNodes[i]
      const pos = currentPositions[node.id]
      if (!pos) continue

      const r = getRadius(node)
      const dx = graphX - pos.x
      const dy = graphY - pos.y

      if (dx * dx + dy * dy <= r * r) {
        return node.id
      }
    }
    return null
  }, [getRadius])

  // ── Set up d3-zoom on the canvas ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const sel = select(canvas)

    const zoomHandler = d3Zoom()
      .scaleExtent([0.1, 8])
      .filter((event) => {
        // Allow scroll-wheel zoom always
        if (event.type === 'wheel') return true
        // For mouse events, only allow zoom/pan if NOT on a node
        // (node dragging is handled separately below)
        if (event.type === 'mousedown') {
          const rect = canvas.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          const nodeId = findNodeAtPoint(x, y)
          if (nodeId) return false // block d3-zoom, we'll handle drag
        }
        return true
      })
      .on('zoom', (event) => {
        const { x, y, k } = event.transform
        transformRef.current = { x, y, k }
        // No setState — the canvas loop reads transformRef every frame.
      })

    sel.call(zoomHandler)

    // Prevent default double-click zoom (we handle it ourselves)
    sel.on('dblclick.zoom', null)

    zoomBehaviorRef.current = zoomHandler

    return () => {
      sel.on('.zoom', null)
    }
  }, [canvasRef, findNodeAtPoint])

  // ── Node dragging (mousedown on node → mousemove → mouseup) ──────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseDown = (e) => {
      if (e.button !== 0) return // left click only
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const nodeId = findNodeAtPoint(x, y)

      if (nodeId) {
        draggingNodeRef.current = nodeId
        didDragRef.current = false
        dragStart?.(nodeId)
        setDraggingNodeId(nodeId)
        canvas.style.cursor = 'grabbing'
        e.preventDefault()      // prevent d3-zoom from taking over
        e.stopPropagation()     // block zoom behavior from interfering
      }
    }

    const handleMouseMove = (e) => {
      const dragNodeId = draggingNodeRef.current
      if (dragNodeId) {
        didDragRef.current = true
        const rect = canvas.getBoundingClientRect()
        const screenX = e.clientX - rect.left
        const screenY = e.clientY - rect.top
        const t = transformRef.current
        const graphX = (screenX - t.x) / t.k
        const graphY = (screenY - t.y) / t.k
        dragMove?.(dragNodeId, graphX, graphY)
        return
      }

      // Normal hover detection when not dragging
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const nodeId = findNodeAtPoint(x, y)

      canvas.style.cursor = nodeId ? 'pointer' : 'grab'
      // Only re-render when the hovered node actually changes — a plain
      // mousemove over the same node (or empty space) must not re-render the page.
      if (nodeId !== hoveredNodeRef.current) {
        hoveredNodeRef.current = nodeId
        setHoveredNodeId(nodeId)
        onHoverNode?.(nodeId)
      }
    }

    const handleMouseUp = () => {
      const dragNodeId = draggingNodeRef.current
      if (dragNodeId) {
        dragEnd?.(dragNodeId)
        draggingNodeRef.current = null
        setDraggingNodeId(null)
        canvas.style.cursor = 'grab'
      }
    }

    const handleMouseLeave = () => {
      // End drag if cursor leaves the canvas
      const dragNodeId = draggingNodeRef.current
      if (dragNodeId) {
        dragEnd?.(dragNodeId)
        draggingNodeRef.current = null
        setDraggingNodeId(null)
      }
      canvas.style.cursor = 'grab'
      if (hoveredNodeRef.current !== null) {
        hoveredNodeRef.current = null
        setHoveredNodeId(null)
        onHoverNode?.(null)
      }
    }

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [canvasRef, findNodeAtPoint, onHoverNode, dragStart, dragMove, dragEnd])

  // ── Click: select node or deselect (only if not dragged) ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleClick = (e) => {
      // If we just finished a drag, don't fire click
      if (didDragRef.current) {
        didDragRef.current = false
        return
      }
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const nodeId = findNodeAtPoint(x, y)
      onSelectNode?.(nodeId)
      // In focus mode, smoothly zoom to 1.5x on the selected node
      if (nodeId && focusModeRef.current) {
        zoomToNodeSmooth(nodeId)
      }
    }

    canvas.addEventListener('click', handleClick)
    return () => canvas.removeEventListener('click', handleClick)
  }, [canvasRef, findNodeAtPoint, onSelectNode])

  // ── Double-click: zoom to node neighborhood ──────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleDblClick = (e) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const nodeId = findNodeAtPoint(x, y)

      if (nodeId) {
        zoomToNode(nodeId)
      }
    }

    canvas.addEventListener('dblclick', handleDblClick)
    return () => canvas.removeEventListener('dblclick', handleDblClick)
  }, [canvasRef, findNodeAtPoint])

  // ── Zoom helpers ─────────────────────────────────────────────────────────

  const animateTransform = useCallback((newTransform) => {
    const canvas = canvasRef.current
    const zb = zoomBehaviorRef.current
    if (!canvas || !zb) return

    select(canvas)
      .transition()
      .duration(750)
      .call(
        zb.transform,
        zoomIdentity
          .translate(newTransform.x, newTransform.y)
          .scale(newTransform.k),
      )
  }, [canvasRef])

  const resetZoom = useCallback(() => {
    animateTransform({ x: 0, y: 0, k: 1 })
  }, [animateTransform])

  // Instant reset for mode switches — the transform ref AND d3's internal
  // canvas.__zoom both persist for the page's lifetime (the canvas is always
  // mounted), so a zoom/pan from crawl mode would otherwise be applied to the
  // project graph (rendered off-screen / giant / tiny). Must go through the
  // zoom behavior so __zoom stays in sync — never assign transformRef directly.
  const resetZoomImmediate = useCallback(() => {
    const canvas = canvasRef.current
    const zb = zoomBehaviorRef.current
    if (!canvas || !zb) return
    select(canvas).call(zb.transform, zoomIdentity)
  }, [canvasRef])

  const zoomIn = useCallback(() => {
    const canvas = canvasRef.current
    const zb = zoomBehaviorRef.current
    if (!canvas || !zb) return

    select(canvas)
      .transition()
      .duration(750)
      .call(zb.scaleBy, 1.5)
  }, [canvasRef])

  const zoomOut = useCallback(() => {
    const canvas = canvasRef.current
    const zb = zoomBehaviorRef.current
    if (!canvas || !zb) return

    select(canvas)
      .transition()
      .duration(750)
      .call(zb.scaleBy, 0.667)
  }, [canvasRef])

  const zoomToNode = useCallback((nodeId) => {
    const canvas = canvasRef.current
    const pos = positionsRef.current[nodeId]
    if (!canvas || !pos) return

    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const scale = 2

    // Center the target node in the viewport at 2x zoom
    animateTransform({
      x: w / 2 - pos.x * scale,
      y: h / 2 - pos.y * scale,
      k: scale,
    })
  }, [canvasRef, animateTransform])

  // Focus mode zoom: gentler 1.5x instead of 2x
  const zoomToNodeSmooth = useCallback((nodeId) => {
    const canvas = canvasRef.current
    const pos = positionsRef.current[nodeId]
    if (!canvas || !pos) return

    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const scale = 1.5

    animateTransform({
      x: w / 2 - pos.x * scale,
      y: h / 2 - pos.y * scale,
      k: scale,
    })
  }, [canvasRef, animateTransform])

  return {
    transformRef,
    hoveredNodeId,
    draggingNodeId,
    resetZoom,
    resetZoomImmediate,
    zoomIn,
    zoomOut,
    zoomToNode,
  }
}
