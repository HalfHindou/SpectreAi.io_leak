/**
 * sim.worker.js — the CONSTELLATION ENGINE's physics worker.
 *
 * The whole point of the re-architecture: the CPU-heavy d3-force simulation
 * runs HERE, on a dedicated worker thread, NOT on the main thread. The old
 * 2D-canvas version ran the sim + 280 logo/glow redraws on the main thread
 * every frame, which starved clicks and made the map feel "crooked, laggy,
 * can't click". Here the sim ticks at its own cadence and posts only the raw
 * node positions back as a transferable Float32Array; the main thread does
 * nothing but interpolate + render on the GPU.
 *
 * PROTOCOL (main → worker):
 *   { type: 'init', nodes, links, hubs, anchors, w, h, settle } — (re)build the sim
 *   { type: 'resize', w, h, anchors }                           — re-anchor on stage resize
 *   { type: 'reheat', alpha }                                   — bump alpha (interaction/refresh)
 *   { type: 'tick' } / { type: 'stop' }                         — manual drive (unused; self-driven)
 *
 * PROTOCOL (worker → main):
 *   { type: 'positions', buffer: Float32Array[x0,y0,x1,y1,...], alpha, settled }
 *     buffer order = [...hub positions, ...body positions] (hubs first), matching
 *     the index layout the main thread maps back onto its instances.
 *
 * The worker owns a single rAF-less interval loop gated on alpha: it ticks
 * while warm, posts positions each tick, and idles (no posts) once settled.
 * On reheat it wakes back up. This is `type: 'module'` — vite.config worker.format
 * must be 'es' for the prod build (`new Worker(new URL(...), { type:'module' })`).
 */
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'

/* physics tunables — mirror the proven values from the old view, dialed for
   GPU rendering (slightly more breathing room since bubbles can be bigger). */
const ALPHA_MIN = 0.012
const ALPHA_DECAY = 0.0185
const VELOCITY_DECAY = 0.5
const HUB_COLLIDE_PAD = 12 // more separation between sector blobs so dense wells don't touch
const BODY_COLLIDE_PAD = 7 // breathing room → bubbles read individually, not crushed (was 4; packed clusters looked crowded)
const QUAD_COLLIDE_PAD = 2.5 // bet-field beeswarm: de-overlap without leaving the data cell
const TICK_MS = 1000 / 45 // sim cadence; main thread lerps to 60fps between these

let sim = null
let hubNodes = []
let bodyNodes = []
let anchors = new Map() // key -> {x,y}
let cx = 0
let cy = 0
let timer = null
let paused = false // set while the tab is hidden — freeze the sim, save CPU

function clearTimer() {
  if (timer != null) { clearTimeout(timer); timer = null }
}

/* Pack [hub..., body...] positions into the transfer buffer and post it.
   We hand ownership to the main thread (transferable), then the main thread
   posts it back on the next init/resize so we can reuse the allocation. Since
   posts are frequent, we allocate a fresh view each post to avoid the
   "buffer detached" race — cheap (one Float32Array of ~600 floats). */
function postPositions(settled) {
  const n = hubNodes.length + bodyNodes.length
  const arr = new Float32Array(n * 2)
  let i = 0
  for (let h = 0; h < hubNodes.length; h++) {
    arr[i++] = hubNodes[h].x
    arr[i++] = hubNodes[h].y
  }
  for (let b = 0; b < bodyNodes.length; b++) {
    arr[i++] = bodyNodes[b].x
    arr[i++] = bodyNodes[b].y
  }
  self.postMessage(
    { type: 'positions', buffer: arr.buffer, alpha: sim ? sim.alpha() : 0, settled },
    [arr.buffer],
  )
}

function loop() {
  if (!sim) { clearTimer(); return }
  const warm = sim.alpha() > sim.alphaMin()
  if (warm) {
    sim.tick()
    postPositions(false)
    timer = setTimeout(loop, TICK_MS)
  } else {
    // one final settled post so the main thread snaps to the resting layout
    postPositions(true)
    clearTimer()
  }
}

function arm() {
  if (timer != null) return
  if (!sim || paused) return
  timer = setTimeout(loop, 0)
}

function build(msg) {
  const { nodes, links, hubs, w, h } = msg
  cx = w / 2
  cy = h / 2
  anchors = new Map(Object.entries(msg.anchors || {}))

  clearTimer()
  if (sim) { sim.stop(); sim = null }

  // hub nodes seeded at their anchors
  hubNodes = hubs.map((hub) => {
    const a = anchors.get(hub.key) || { x: cx, y: cy }
    return { ...hub, x: a.x, y: a.y, vx: 0, vy: 0 }
  })
  const hubById = new Map(hubNodes.map((d) => [d.id, d]))

  // LAYOUT modes:
  //   galaxy   — hub-ringed sector blobs (the default narrative map)
  //   network  — center-pinned drill-down graph (no hubs, explicit links)
  //   quadrant — the "Bet" field: each token is pinned to a data position
  //              (tx,ty = authenticity × momentum) with collision de-overlap
  const layout = msg.layout || (hubs.length ? 'galaxy' : 'network')
  const isQuad = layout === 'quadrant'
  const isReactor = layout === 'reactor'

  // body (token) nodes. GALAXY/NETWORK: seeded near their hub anchor with
  // deterministic jitter (pin = fixed centre in a drill-down). QUADRANT: seeded
  // at their data target (tx,ty) with tiny jitter so identical cells don't stack.
  bodyNodes = nodes.map((nDef) => {
    if (isQuad) {
      const tx = nDef.tx != null ? nDef.tx : cx
      const ty = nDef.ty != null ? nDef.ty : cy
      const jx = ((nDef.seed || 0) - 0.5) * 26
      const jy = ((nDef.seed2 || 0) - 0.5) * 26
      return { ...nDef, x: tx + jx, y: ty + jy, vx: 0, vy: 0 }
    }
    const a = anchors.get(nDef.hubKey) || { x: cx, y: cy }
    const ang = (nDef.seed || 0) * Math.PI * 2
    const rad = 44 + (nDef.seed2 || 0) * 80
    const node = { ...nDef, x: a.x + Math.cos(ang) * rad, y: a.y + Math.sin(ang) * rad, vx: 0, vy: 0 }
    if (nDef.pin) { node.x = cx; node.y = cy; node.fx = cx; node.fy = cy }
    return node
  })
  const allById = new Map([...hubById, ...bodyNodes.map((d) => [d.id, d])])

  // QUADRANT: a beeswarm — pull each node to its data cell (tx,ty), collide to
  // de-overlap, nothing else. No hubs, links, or cluster gravity.
  if (isQuad) {
    sim = forceSimulation(bodyNodes)
      .force('quadX', forceX((d) => (d.tx != null ? d.tx : cx)).strength(0.55))
      .force('quadY', forceY((d) => (d.ty != null ? d.ty : cy)).strength(0.55))
      .force('collide', forceCollide()
        .radius((d) => (d.r || 11) + QUAD_COLLIDE_PAD)
        .strength(0.9)
        .iterations(2))
      .alphaMin(ALPHA_MIN)
      .alphaDecay(ALPHA_DECAY)
      .velocityDecay(VELOCITY_DECAY)
      .stop()

    sim.alpha(msg.settle != null ? msg.settle : 0.9)
    postPositions(false)
    arm()
    return
  }

  // REACTOR ("The Reactor"): a single living blob — no hubs, no links, no
  // clusters. Charge spaces the bubbles, collision packs them shoulder-to-
  // shoulder, a weak center gravity keeps the whole organism framed. Size
  // (mindshare) does the rest. The per-bubble velocity heartbeat is a render-
  // time effect (engine reads node._pulse), so the physics just needs a calm,
  // self-organizing field.
  if (isReactor) {
    sim = forceSimulation(bodyNodes)
      .force('charge', forceManyBody().strength((d) => -((d.r || 14) * 1.3 + 12)).distanceMax(380))
      .force('collide', forceCollide().radius((d) => (d.r || 11) + 3).strength(0.95).iterations(2))
      .force('cx', forceX(cx).strength(0.05))
      .force('cy', forceY(cy).strength(0.05))
      .alphaMin(ALPHA_MIN)
      .alphaDecay(ALPHA_DECAY)
      .velocityDecay(VELOCITY_DECAY)
      .stop()

    sim.alpha(msg.settle != null ? msg.settle : 0.9)
    postPositions(false)
    arm()
    return
  }

  const linkObjs = links
    .map((l) => ({ ...l, source: allById.get(l.source), target: allById.get(l.target) }))
    .filter((l) => l.source && l.target)

  // NETWORK mode = no hubs (a center-pinned drill-down graph). GALAXY mode =
  // hub-ringed sector blobs. The two want opposite force profiles.
  const isNet = hubNodes.length === 0

  sim = forceSimulation([...hubNodes, ...bodyNodes])
    // GALAXY: weak tie to the hub (cluster gravity groups). NETWORK: links are
    // the structure — hold each neighbour at its given distance from the centre.
    .force('link', forceLink(linkObjs).id((d) => d.id)
      .distance((l) => l.dist || (18 + (l.target.r || 11)))
      .strength((l) => (l.strength != null ? l.strength : (isNet ? 0.32 : 0.05))))
    // GALAXY: low charge (collision packs). NETWORK: strong charge so the
    // neighbours fan out evenly around the pinned centre instead of overlapping.
    .force('charge', forceManyBody()
      .strength((d) => (d.isHub ? -260 : (isNet ? -(220 + (d.r || 14) * 5) : -(d.r || 11) * 0.7)))
      .distanceMax(isNet ? 1400 : 420))
    // HARD no-overlap → bubbles pack shoulder-to-shoulder like bubblemaps.
    .force('collide', forceCollide()
      .radius((d) => (d.isHub ? 24 + HUB_COLLIDE_PAD : (d.r || 11) + (isNet ? 7 : BODY_COLLIDE_PAD)))
      .strength(1)
      .iterations(3))
    // STRONG pull of each token toward its sector anchor (GALAXY only) → tight,
    // separated blobs. NETWORK: no cluster gravity (the link + pin do the work).
    .force('clusterX', forceX((d) => (anchors.get(d.isHub ? d.key : d.hubKey) || { x: cx }).x)
      .strength((d) => (d.isHub ? 0.22 : (isNet ? 0 : 0.17))))
    .force('clusterY', forceY((d) => (anchors.get(d.isHub ? d.key : d.hubKey) || { y: cy }).y)
      .strength((d) => (d.isHub ? 0.22 : (isNet ? 0 : 0.17))))
    // gentle global centering keeps the whole field framed
    .force('centerX', forceX(cx).strength(isNet ? 0.05 : 0.02))
    .force('centerY', forceY(cy).strength(isNet ? 0.05 : 0.02))
    .alphaMin(ALPHA_MIN)
    .alphaDecay(ALPHA_DECAY)
    .velocityDecay(VELOCITY_DECAY)
    .stop() // we drive ticks ourselves via the setTimeout loop

  sim.alpha(msg.settle != null ? msg.settle : 0.9)
  // emit the seeded layout immediately so the GPU has something to draw,
  // then start ticking toward the settled positions.
  postPositions(false)
  arm()
}

function resize(msg) {
  if (!sim) return
  cx = msg.w / 2
  cy = msg.h / 2
  anchors = new Map(Object.entries(msg.anchors || {}))
  // update the anchored forces to the new geometry, then reheat. The quadrant
  // sim has none of these (it re-inits with fresh tx/ty on resize), so guard.
  const cX = sim.force('clusterX')
  if (cX) {
    cX.x((d) => (anchors.get(d.isHub ? d.key : d.hubKey) || { x: cx }).x)
    sim.force('clusterY').y((d) => (anchors.get(d.isHub ? d.key : d.hubKey) || { y: cy }).y)
    sim.force('centerX').x(cx)
    sim.force('centerY').y(cy)
  }
  sim.alpha(Math.max(sim.alpha(), 0.6))
  arm()
}

self.onmessage = (e) => {
  const msg = e.data
  if (!msg || !msg.type) return
  try {
    handle(msg)
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err), stack: String(err && err.stack || '') })
  }
}

function handle(msg) {
  switch (msg.type) {
    case 'init': build(msg); break
    case 'resize': resize(msg); break
    case 'reheat':
      if (sim) { sim.alpha(Math.max(sim.alpha(), msg.alpha || 0.5)); arm() }
      break
    case 'pause': paused = true; clearTimer(); break
    case 'resume': paused = false; arm(); break
    case 'stop': clearTimer(); if (sim) sim.stop(); break
    default: break
  }
}
