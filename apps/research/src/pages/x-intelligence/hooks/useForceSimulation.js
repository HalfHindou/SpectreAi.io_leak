import { useRef, useEffect, useState, useCallback } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
} from 'd3-force'
import { getNodeRadius } from '../data/zigchainGraph'

// Stable empty references to avoid re-render loops from new object creation
const EMPTY_POSITIONS = Object.freeze({})
const EMPTY_HUB_SET = new Set()

/**
 * useForceSimulation — wraps a D3-force simulation for the ZIGChain social graph.
 *
 * D3-force mutates the node objects it receives (adding x, y, vx, vy, index).
 * This hook deep-clones the incoming arrays so callers never see mutations.
 *
 * @param {Array}  nodes        — array of node objects (must have `id`, `followers`)
 * @param {Array}  links        — array of link objects (must have `source`, `target`, `tweetCount`)
 * @param {Object} dimensions   — { width, height } of the canvas
 *
 * @returns {{ positions, isSettled, reheat, simulationRef }}
 */
export default function useForceSimulation(nodes, links, { width, height }, organizeByType = false, hubNodeIds = EMPTY_HUB_SET, radiusScale = 1) {
  const HUB_NODE_IDS = hubNodeIds
  const simulationRef = useRef(null)
  const nodesMapRef = useRef(new Map()) // nodeId → d3 sim node object (for dragging)
  const positionsRef = useRef(EMPTY_POSITIONS)
  // Persistent settled positions, keyed by node id, carried ACROSS rebuilds so
  // a filter toggle / crawl drill-down doesn't discard the layout and re-seed
  // every node to its orbital slot (which caused the "jump and re-settle").
  // Updated each tick from the live node objects; read on rebuild to seed
  // surviving ids in place — only genuinely NEW ids get orbital-seeded.
  const livePosCacheRef = useRef(new Map()) // id → { x, y, vx, vy }
  const tickCountRef = useRef(0)
  // While true, the tick handler skips the auto-stop check so the simulation
  // keeps moving for the duration of a drag — even after it had already
  // settled and hit MAX_TICKS.
  const isDraggingRef = useRef(false)

  const [positions, setPositions] = useState(EMPTY_POSITIONS)
  const [isSettled, setIsSettled] = useState(false)

  // ── Reheat ───────────────────────────────────────────────────────────────
  const reheat = useCallback(() => {
    if (simulationRef.current) {
      tickCountRef.current = 0
      setIsSettled(false)
      simulationRef.current.alpha(0.8).restart()
    }
  }, [])

  // ── Drag API — exposed so the interaction hook can move individual nodes ─
  const dragStart = useCallback((nodeId) => {
    const sim = simulationRef.current
    const simNode = nodesMapRef.current.get(nodeId)
    if (!sim || !simNode) return
    isDraggingRef.current = true
    // Reset the tick cap so the auto-stop in the tick handler doesn't fire
    // on the very next frame for graphs that have already hit MAX_TICKS.
    tickCountRef.current = 0
    simNode.fx = simNode.x
    simNode.fy = simNode.y
    // Sustained warmth via alphaTarget so the simulation keeps ticking the
    // whole time the user is holding the bubble.
    sim.alphaTarget(0.3).restart()
  }, [])

  const dragMove = useCallback((nodeId, graphX, graphY) => {
    const simNode = nodesMapRef.current.get(nodeId)
    if (!simNode) return
    simNode.fx = graphX
    simNode.fy = graphY
  }, [])

  const dragEnd = useCallback((nodeId) => {
    const sim = simulationRef.current
    const simNode = nodesMapRef.current.get(nodeId)
    if (!sim || !simNode) return
    isDraggingRef.current = false
    simNode.fx = null
    simNode.fy = null
    // Spring-back cooldown: release alphaTarget and feed a final pulse so
    // neighbors visibly relax around the dropped position.
    sim.alphaTarget(0).alpha(0.4)
    // Re-sync React state once now that drag is over so downstream
    // consumers (sidebar counts etc.) see the final post-drag layout.
    setPositions({ ...positionsRef.current })
  }, [])

  // ── Build / rebuild simulation when inputs change ────────────────────────
  useEffect(() => {
    // Guard: need a valid viewport and at least one node
    if (!width || !height || nodes.length === 0) {
      positionsRef.current = EMPTY_POSITIONS
      setPositions(EMPTY_POSITIONS)
      return
    }

    // Stop any running simulation before creating a new one
    if (simulationRef.current) {
      simulationRef.current.stop()
      simulationRef.current = null
    }

    const cx = width / 2
    const cy = height / 2

    // Deep-clone nodes — D3-force mutates these by adding x, y, vx, vy, index
    // Pre-position the hub at exact center so it never wanders on filter
    // changes — but ONLY in single-hub (project) mode. Crawl has ~20 hubs:
    // center-pinning them all made every rebuild collapse-then-explode (hubs
    // teleport to cx,cy for 500ms while their cached KOLs wait at the old
    // ring). Crawl hubs are seeded below from cache / their compass slot.
    const multiHub = HUB_NODE_IDS.size > 1
    const nodesCopy = nodes.map((n) => {
      const copy = { ...n }
      if (!multiHub && HUB_NODE_IDS.has(copy.id)) {
        copy.x = cx
        copy.y = cy
        copy.fx = cx  // temporarily pin, released after settling begins
        copy.fy = cy
      }
      return copy
    })

    // Build lookup map for drag access
    const nodesMap = new Map()
    for (const n of nodesCopy) nodesMap.set(n.id, n)
    nodesMapRef.current = nodesMap

    // Deep-clone links — D3-force replaces source/target strings with object refs
    const linksCopy = links.map((e) => ({ ...e }))

    // Reset tick counter
    tickCountRef.current = 0
    setIsSettled(false)

    // ── Pre-compute orbital positions (compass-point symmetry) ─────────────
    // Projects arranged at cardinal/intercardinal positions: N, NE, E, SE, S, SW, W, NW
    // Most connected projects get primary compass slots, overflow fills secondary rings.
    // KOLs cluster toward their most-connected project's compass zone.
    // Exchanges sit on a wider outer orbit.

    // Crawl mode = many hub nodes (one per project). Treat every hub as a
    // peer on the compass ring rather than as the lone centerpiece — this is
    // what produces the galaxy-of-projects layout. Project mode = exactly one
    // hub, kept at the center with KOLs orbiting it.
    const isCrawlMode = HUB_NODE_IDS.size > 1
    const projects = isCrawlMode
      ? nodesCopy.filter((n) => HUB_NODE_IDS.has(n.id))
      : nodesCopy.filter((n) => n.type === 'project' && !HUB_NODE_IDS.has(n.id))
    const exchanges = nodesCopy.filter((n) => n.type === 'exchange')

    // Orbital radii scale with viewport
    // Single-hub graphs (API loaded) use tighter radius to keep nodes visible
    const isSingleHub = !isCrawlMode && projects.length === 0 && HUB_NODE_IDS.size <= 1
    // Crawl uses the widest orbit (40% of min dim) so 20 project hubs + their
    // KOL clouds don't overlap. Single-hub uses tighter 28%. Multi-project
    // (static ZIG graph with sub-projects) uses default 38%.
    // Crawl uses 32% of min dim — bigger than single-hub (28%) so 20 project
    // clusters have breathing room, but small enough that everything stays
    // comfortably in-frame at default zoom (was 42% which pushed nodes to
    // the edges and made them look tiny).
    const orbitRadius = Math.min(width, height) * (isCrawlMode ? 0.32 : isSingleHub ? 0.28 : 0.38)
    const outerOrbitRadius = orbitRadius * (isSingleHub ? 1.4 : 1.8)

    // 8 compass angles: N, NE, E, SE, S, SW, W, NW (starting from top, clockwise)
    const COMPASS_ANGLES = [
      -Math.PI / 2,           // N   (top)
      -Math.PI / 4,           // NE
      0,                       // E   (right)
      Math.PI / 4,            // SE
      Math.PI / 2,            // S   (bottom)
      Math.PI * 3 / 4,        // SW
      Math.PI,                 // W   (left)
      -Math.PI * 3 / 4,       // NW
    ]

    const projectAngles = new Map()

    // Sort projects by connection count (most connected get prime compass slots)
    const sortedProjects = [...projects].sort((a, b) => {
      const ac = linksCopy.filter((l) => l.source === a.id || l.target === a.id).length
      const bc = linksCopy.filter((l) => l.source === b.id || l.target === b.id).length
      return bc - ac
    })

    sortedProjects.forEach((p, i) => {
      if (i < 8) {
        // Primary ring: exact compass positions
        const angle = COMPASS_ANGLES[i]
        projectAngles.set(p.id, {
          x: cx + Math.cos(angle) * orbitRadius,
          y: cy + Math.sin(angle) * orbitRadius,
        })
      } else {
        // Secondary ring: halfway between compass points, slightly further out
        const secondaryIdx = i - 8
        const angle = COMPASS_ANGLES[secondaryIdx % 8] + Math.PI / 8 // offset by 22.5 degrees
        const r = orbitRadius * 1.15
        projectAngles.set(p.id, {
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
        })
      }
    })

    // Exchanges: outer ring, evenly spaced but offset from project positions
    exchanges.forEach((e, i) => {
      // Start between compass points so they don't collide with projects
      const angle = (i / Math.max(1, exchanges.length)) * Math.PI * 2 + Math.PI / 16
      projectAngles.set(e.id, {
        x: cx + Math.cos(angle) * outerOrbitRadius,
        y: cy + Math.sin(angle) * outerOrbitRadius,
      })
    })

    // Pre-compute: which compass zone does each KOL belong to?
    // EVERY KOL gets a zone — connected ones go near their project,
    // unconnected ones distribute evenly around the outer ring.
    //
    // In CRAWL mode: bridge KOLs (touching multiple projects) get pulled to
    // the centroid of all the projects they mention, so they visibly sit
    // BETWEEN clusters — that's the storytelling beat the whole feature is
    // built around.
    const kolZones = new Map()
    let unconnectedIdx = 0
    const kols = nodesCopy.filter((n) => n.type === 'kol' && !HUB_NODE_IDS.has(n.id))

    for (const n of kols) {
      // Collect all project hub neighbors and the strongest single neighbor.
      const projectNeighbors = []
      let bestTarget = null
      let bestCount = 0
      for (const link of linksCopy) {
        const otherId = link.source === n.id ? link.target : (link.target === n.id ? link.source : null)
        if (!otherId) continue
        const otherPos = projectAngles.get(otherId)
        if (!otherPos) continue
        projectNeighbors.push({ id: otherId, pos: otherPos, weight: link.tweetCount || 1 })
        if (link.tweetCount > bestCount) {
          bestCount = link.tweetCount
          bestTarget = otherId
        }
      }
      const isBridge = projectNeighbors.length >= 2

      let angle, distMult
      if (isCrawlMode && isBridge) {
        // Bridge KOL: weighted centroid of all the projects they mention.
        // This is what makes "shared mindshare" visible — the bubble settles
        // between clusters proportional to how it's split.
        let sx = 0, sy = 0, w = 0
        for (const pn of projectNeighbors) {
          sx += pn.pos.x * pn.weight
          sy += pn.pos.y * pn.weight
          w += pn.weight
        }
        kolZones.set(n.id, {
          x: w > 0 ? sx / w : cx,
          y: w > 0 ? sy / w : cy,
        })
        continue
      }
      if (bestTarget && isSingleHub) {
        // Single-hub: distribute KOLs in a tighter ring around the hub
        const kolIdx = kols.indexOf(n)
        angle = (kolIdx / Math.max(1, kols.length)) * Math.PI * 2
        distMult = 0.6 + (n.tier === 'S' ? 0.2 : n.tier === 'A' ? 0.4 : n.tier === 'B' ? 0.7 : 0.9) + Math.random() * 0.3
      } else if (bestTarget) {
        // Multi-hub non-bridge: sit on the outer arc of their project's zone.
        const projPos = projectAngles.get(bestTarget)
        angle = Math.atan2(projPos.y - cy, projPos.x - cx)
        const jitter = (Math.random() - 0.5) * 0.5
        angle += jitter
        distMult = isCrawlMode ? 1.05 + Math.random() * 0.25 : 1.3 + Math.random() * 0.7
      } else {
        // Unconnected KOL: distribute evenly around outer ring
        angle = (unconnectedIdx / Math.max(1, kols.length)) * Math.PI * 2
        unconnectedIdx++
        distMult = 1.6 + Math.random() * 0.5
      }

      kolZones.set(n.id, {
        x: cx + Math.cos(angle) * orbitRadius * distMult,
        y: cy + Math.sin(angle) * orbitRadius * distMult,
      })
    }

    // ── Pre-position ALL nodes at their target positions ─────────────────
    // This ensures the simulation starts organized, not chaotic.
    //
    // Position preservation: if a node SURVIVED the previous layout (its id is
    // in the live cache), seed it from its last settled position so it barely
    // moves on rebuild. Only genuinely NEW ids fall through to the orbital /
    // zone seed. Hub nodes stay pinned at center (handled above) regardless.
    const posCache = livePosCacheRef.current
    let hasSurvivors = false
    for (const n of nodesCopy) {
      // Single-hub mode: the hub is already pinned at center. Crawl hubs fall
      // through — cache seed first (no re-orbit on rebuild), compass slot for
      // genuinely new hubs.
      if (!multiHub && HUB_NODE_IDS.has(n.id)) continue
      const cached = posCache.get(n.id)
      // Only reuse FINITE cached coords; seed the node at rest (no carried
      // velocity). Carrying vx/vy meant a rebuild that landed mid-motion kept
      // flinging nodes outward — the "graph goes crazy / bubbles fly off" bug.
      if (cached && Number.isFinite(cached.x) && Number.isFinite(cached.y)) {
        n.x = cached.x
        n.y = cached.y
        n.vx = 0
        n.vy = 0
        hasSurvivors = true
        continue
      }
      const orbital = projectAngles.get(n.id)
      const zone = kolZones.get(n.id)
      if (orbital) {
        n.x = orbital.x
        n.y = orbital.y
      } else if (zone) {
        n.x = zone.x
        n.y = zone.y
      }
    }

    // ── Create simulation ──────────────────────────────────────────────────
    // KEY INSIGHT: Hub links (to zignaly/zigchain) must be VERY weak or they
    // pull everything into a center blob. Zone positioning forces must dominate.
    const sim = forceSimulation(nodesCopy)
      .force(
        'link',
        forceLink(linksCopy)
          .id((d) => d.id)
          .distance((d) => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source
            const tid = typeof d.target === 'object' ? d.target.id : d.target
            const isHubLink = HUB_NODE_IDS.has(sid) || HUB_NODE_IDS.has(tid)
            if (isSingleHub) {
              // Single-hub: tighter layout, distance by tier
              if (isHubLink) return orbitRadius * 0.6
              return 40 + (1 / Math.max(1, d.tweetCount)) * 40
            }
            if (isHubLink) return orbitRadius * 1.2
            return 80 + (1 / Math.max(1, d.tweetCount)) * 80
          })
          .strength((d) => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source
            const tid = typeof d.target === 'object' ? d.target.id : d.target
            const isHubLink = HUB_NODE_IDS.has(sid) || HUB_NODE_IDS.has(tid)
            if (isSingleHub) {
              // Single-hub: stronger links pull nodes closer to hub
              if (isHubLink) return 0.02
              return 0.03 + Math.min(d.tweetCount, 10) * 0.003
            }
            if (isHubLink) return 0.003
            return 0.01 + Math.min(d.tweetCount, 10) * 0.001
          }),
      )
      .force(
        'charge',
        forceManyBody()
          .strength((d) => {
            const isHub = d.isHub || HUB_NODE_IDS.has(d.id)
            if (isSingleHub) {
              if (isHub) return -600 * radiusScale
              return (-40 - getNodeRadius(d, radiusScale) * 1.8) * radiusScale
            }
            // Crawl mode: temper charge so 200+ KOL nodes don't oscillate.
            // The compass-ring forces handle most layout; charge just keeps
            // nearby bubbles from overlapping.
            if (isHub) return (isCrawlMode ? -480 : -800) * radiusScale
            if (d.type === 'project') return -160 * radiusScale
            if (d.type === 'exchange') return -120 * radiusScale
            return isCrawlMode
              ? (-45 - getNodeRadius(d, radiusScale) * 1.3) * radiusScale
              : (-80 - getNodeRadius(d, radiusScale) * 2.4) * radiusScale
          })
          // Cap repulsion distance so far-away bubbles don't tug on each
          // other across the entire canvas (the main source of slow drift).
          .distanceMax(isSingleHub ? 800 : (isCrawlMode ? 600 : 2400)),
      )
      .force(
        'collide',
        forceCollide()
          .radius((d) => getNodeRadius(d, radiusScale) + (((d.isHub || HUB_NODE_IDS.has(d.id)) ? 80 : 18) * radiusScale))
          // Lower collision strength in crawl mode so overlap-resolution
          // doesn't spring-load the sim into oscillation.
          .strength(isCrawlMode ? 0.75 : 0.95)
          .iterations(isCrawlMode ? 2 : 3),
      )
      // Zone positioning forces — these DOMINATE the layout.
      // In crawl mode hub projects are on the compass ring (projectAngles
      // contains them); in project mode the single hub is pulled to cx,cy.
      .force('hubX', forceX((d) => {
        const orbital = projectAngles.get(d.id)
        if (orbital) return orbital.x
        if (HUB_NODE_IDS.has(d.id)) return cx
        const zone = kolZones.get(d.id)
        if (zone) return zone.x
        return cx
      }).strength((d) => {
        if (projectAngles.has(d.id)) return isCrawlMode ? 0.22 : 0.18
        if (HUB_NODE_IDS.has(d.id)) return 0.3
        if (kolZones.has(d.id)) return isCrawlMode ? 0.085 : 0.06
        return 0.008
      }))
      .force('hubY', forceY((d) => {
        const orbital = projectAngles.get(d.id)
        if (orbital) return orbital.y
        if (HUB_NODE_IDS.has(d.id)) return cy
        const zone = kolZones.get(d.id)
        if (zone) return zone.y
        return cy
      }).strength((d) => {
        if (projectAngles.has(d.id)) return isCrawlMode ? 0.22 : 0.18
        if (HUB_NODE_IDS.has(d.id)) return 0.3
        if (kolZones.has(d.id)) return isCrawlMode ? 0.085 : 0.06
        return 0.008
      }))
      // Faster cooldown + higher friction in crawl mode = no perpetual
      // bouncing with 200+ nodes. The compass-ring forces will still position
      // everything, the sim just stops vibrating after settling.
      .alphaDecay(isCrawlMode ? 0.018 : 0.006)
      .velocityDecay(isCrawlMode ? 0.7 : 0.4)

    // ── Organize by type: tighter clustering ────────────────────────────────
    if (organizeByType) {
      // Override: group KOLs around their most-connected project
      sim.force('typeX', forceX((d) => {
        // Compass slot wins over hub-center — crawl hubs ARE in projectAngles
        // and must not be dragged back to the middle (mirrors hubX ordering).
        if (projectAngles.has(d.id)) return projectAngles.get(d.id).x
        if (HUB_NODE_IDS.has(d.id)) return cx
        // Find this KOL's most-connected project neighbor
        const neighbors = linksCopy
          .filter((l) => l.source === d.id || l.target === d.id)
          .map((l) => l.source === d.id ? l.target : l.source)
        for (const nid of neighbors) {
          const pos = projectAngles.get(nid)
          if (pos) return pos.x
        }
        return cx
      }).strength(0.04))

      sim.force('typeY', forceY((d) => {
        if (projectAngles.has(d.id)) return projectAngles.get(d.id).y
        if (HUB_NODE_IDS.has(d.id)) return cy
        const neighbors = linksCopy
          .filter((l) => l.source === d.id || l.target === d.id)
          .map((l) => l.source === d.id ? l.target : l.source)
        for (const nid of neighbors) {
          const pos = projectAngles.get(nid)
          if (pos) return pos.y
        }
        return cy
      }).strength(0.04))
    }

    // Hard cap on simulation runtime — once we hit this, force-stop. Beyond
    // settling, residual jitter just makes the canvas look unstable.
    const MAX_TICKS = isCrawlMode ? 280 : 600

    // Reuse the same position-record objects across ticks to avoid GC
    // pressure from allocating 100+ small objects every frame.
    const positionsPool = {}
    positionsRef.current = positionsPool

    sim.on('tick', () => {
      tickCountRef.current += 1

      // Mutate the pool in place. Canvas RAF reads positionsRef.current
      // directly, so it always sees fresh coords without a React render.
      // Also mirror into the cross-rebuild cache so the NEXT rebuild can seed
      // survivors from their settled position instead of re-orbiting them.
      const posCache = livePosCacheRef.current
      for (const n of nodesCopy) {
        const slot = positionsPool[n.id]
        if (slot) {
          slot.x = n.x
          slot.y = n.y
        } else {
          positionsPool[n.id] = { x: n.x, y: n.y }
        }
        const c = posCache.get(n.id)
        if (c) {
          c.x = n.x; c.y = n.y; c.vx = n.vx || 0; c.vy = n.vy || 0
        } else {
          posCache.set(n.id, { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 })
        }
      }

      const dragging = isDraggingRef.current
      // While dragging, do NOT touch React state — the canvas reads
      // positionsRef every frame, so React re-renders are wasted work.
      // Otherwise sync occasionally for sidebars / count / hit-test consumers.
      // The canvas always draws from positionsRef (live), so this React sync
      // only needs to be frequent enough for non-canvas consumers; every 10
      // ticks (vs 3) cuts the settle-time re-render storm ~3x. The final
      // settle sync below still lands the exact resting positions.
      if (!dragging && tickCountRef.current % 10 === 0) {
        setPositions({ ...positionsPool })
      }

      // Settled or hit the safety cap — STOP. d3-force will otherwise keep
      // running quietly in the background, occasionally tweaking positions
      // and making the user see bubbles "bounce." Never stop while the
      // user is actively dragging.
      if (!dragging && (sim.alpha() < 0.01 || tickCountRef.current > MAX_TICKS)) {
        setIsSettled(true)
        setPositions({ ...positionsPool })
        sim.stop()
      }
    })

    simulationRef.current = sim

    // Warm-start: if this rebuild reuses an existing layout (survivors seeded
    // from the cache above, already at their settled positions), run a moderate
    // re-settle. Surviving nodes barely move (they're already spread); new ids
    // ease into the gaps. IMPORTANT: let it cool to d3's DEFAULT alphaMin so the
    // layout fully settles — a raised alphaMin stopped it early, leaving an
    // under-settled "firework" radial pattern that the cache then perpetuated
    // across rebuilds. A cold layout (no survivors) keeps d3's default reheat.
    if (hasSurvivors) {
      sim.alpha(0.45).alphaMin(0.001).restart()
    }

    // Release hub pins after a brief settling period so they gently settle
    const releaseTimer = setTimeout(() => {
      for (const [id, simNode] of nodesMap) {
        if (HUB_NODE_IDS.has(id)) {
          simNode.fx = null
          simNode.fy = null
        }
      }
    }, 500)

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      clearTimeout(releaseTimer)
      sim.stop()
      sim.on('tick', null)
    }
  }, [nodes, links, width, height, organizeByType, radiusScale])

  return {
    positions,
    positionsRef,
    isSettled,
    reheat,
    simulationRef,
    dragStart,
    dragMove,
    dragEnd,
  }
}
