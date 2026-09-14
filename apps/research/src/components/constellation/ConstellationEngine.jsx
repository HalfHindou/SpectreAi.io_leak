/**
 * ConstellationEngine — a reusable, GPU-accelerated force-constellation renderer.
 *
 * THE ARCHITECTURE (the whole point of this re-build):
 *   1. d3-force runs in a WEB WORKER (sim.worker.js via useConstellationSim).
 *      The worker posts node positions back as a transferable Float32Array.
 *   2. The MAIN THREAD interpolates (lerps) the latest worker positions toward
 *      their targets every animation frame, so motion stays buttery even though
 *      the sim ticks at ~45Hz. All position state lives in refs — it NEVER
 *      triggers a React re-render per tick.
 *   3. Rendering is WebGL via three.js / R3F. The ~280 bubbles are ONE
 *      InstancedMesh (a single draw call): per-instance position, size
 *      (∝ sqrt(attention)), sector color, and authenticity (drives the glow
 *      emissive). Logos are cached circle-masked textures (atlas.js) faded in
 *      when ready; sector hub halos + connectors are light instanced/line meshes.
 *   4. frameloop="demand": we invalidate() while the layout moves / during
 *      interaction / ambient drift, and let the GPU idle when settled. Paused on
 *      document.hidden. DPR capped at min(devicePixelRatio, 2).
 *
 * REUSABLE / DATA-AGNOSTIC. Props are generic so /x-bubbles can consume the
 * same engine next. Callers pass `nodes` + `clusters` + accessors; X-Dash- (or
 * any-) specific shaping stays in the view, not here.
 *
 *   nodes:    [{ id, clusterKey, size(0..1), color:[r,g,b](0..255), glow(0..1),
 *               logo?, label?, data }]
 *   clusters: [{ key, label, color:[r,g,b], count }]  (hub groups)
 *   focusKey: cluster key to frame the camera on (or null = overview)
 *   onNodeClick(node) / onNodeHover(node|null, screenXY)
 *   reducedMotion / mobile / dayMode: quality + motion flags
 *
 * three is imported only here → this file lives in the lazy vendor-three chunk;
 * the X-Dash Map view lazy-loads it so three never touches the boot path.
 */
import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  Object3D, InstancedBufferAttribute, DynamicDrawUsage,
  AdditiveBlending, Vector2, Vector3, Raycaster,
} from 'three'
import { useConstellationSim } from './useConstellationSim'
import { getLogoTexture } from './atlas'
import { pxToWorld, easeOutQuint, hash01 } from './engine-bits'
import './constellation-engine.css'

/* ── bubble instanced shader ──────────────────────────────────────────────
   One draw call for the whole field. Per-instance attributes drive everything:
   - aColor   : sector hue (rgb 0..1)
   - aGlow    : authenticity 0..1 → emissive intensity + halo strength
   - aDim     : 0/1 focus dim (rest of map fades when a cluster is focused)
   - aHover   : 0..1 hover lift on the ring
   The fragment paints a soft-edged disc + a sector ring whose brightness scales
   with authenticity, and an inner additive glow. Apple-soft, never gamer-neon. */
const bubbleVert = /* glsl */`
  attribute vec3 aColor;
  attribute float aGlow;
  attribute float aDim;
  attribute float aHover;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vGlow;
  varying float vDim;
  varying float vHover;
  void main() {
    vUv = uv;
    vColor = aColor;
    vGlow = aGlow;
    vDim = aDim;
    vHover = aHover;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`
const bubbleFrag = /* glsl */`
  precision highp float;
  uniform float uDay;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vGlow;
  varying float vDim;
  varying float vHover;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;

    float dimF = mix(1.0, 0.16, vDim);

    // backing disc: dark glass in night, light in day — logos sit on top of this
    vec3 backNight = vec3(0.08, 0.08, 0.094);
    vec3 backDay   = vec3(1.0, 1.0, 1.0);
    vec3 back = mix(backNight, backDay, uDay);
    float discA = (1.0 - smoothstep(0.92, 1.0, d)) * dimF;

    // sector ring — brightness scales with authenticity (organic = vivid)
    float ringW = 0.06 + vHover * 0.03;
    float ring = smoothstep(1.0 - ringW - 0.02, 1.0 - ringW, d) * (1.0 - smoothstep(1.0 - 0.005, 1.0, d));
    float ringBright = (0.45 + vGlow * 0.5 + vHover * 0.4) * dimF;

    // inner authenticity glow (soft, additive feel via brightness toward center)
    float core = (1.0 - smoothstep(0.0, 0.85, d));
    float glowStr = (0.05 + vGlow * vGlow * 0.30) * dimF;

    vec3 col = back * discA;
    col += vColor * ring * ringBright;
    col += vColor * core * glowStr;

    float alpha = max(discA, ring * ringBright);
    alpha = clamp(alpha + core * glowStr * 0.6, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`

/* additive halo shader — the soft authenticity bloom around each bubble.
   Separate transparent additive InstancedMesh sized larger than the bubble. */
const haloVert = bubbleVert
const haloFrag = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vGlow;
  varying float vDim;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;
    float falloff = pow(1.0 - d, 2.2);
    float dimF = mix(1.0, 0.12, vDim);
    float strength = (0.04 + vGlow * vGlow * 0.34) * dimF;
    gl_FragColor = vec4(vColor * falloff * strength, falloff * strength);
  }
`

const tmpObj = new Object3D()
const EMPTY_LINKS = []

function Scene({
  nodes, clusters, links, layout, focusKey, highlightKey, onNodeClick, onNodeHover,
  reducedMotion, mobile, dayMode, stageSize, sim, onReady,
}) {
  // committed focus drives the CAMERA; highlight (hover OR focus) drives DIMMING.
  const dimKey = highlightKey || focusKey
  // the "Bet" field: a fixed authenticity × momentum grid. No network links.
  const isQuad = layout === 'quadrant' && !(links && links.length)
  const isReactor = layout === 'reactor' && !(links && links.length)
  // root-scoped invalidate — NOT the module-level import. With two copies of
  // three in the bundle (the "Multiple instances" warning), the module-level
  // invalidate() can target the wrong R3F root and silently no-op, leaving the
  // demand loop frozen. The store's invalidate always drives THIS canvas.
  // IMPORTANT: useThree() MUST be called before any useEffect that references
  // invalidate — const destructuring creates a TDZ that crashes the prod bundle
  // (esbuild minification turns the deps array [dimKey, invalidate] into
  // [w, A] where A is still in TDZ). Declare first, then use in effects.
  const { camera, gl, invalidate } = useThree()
  // dim is animated per-instance in useFrame, so a dimKey change must wake the
  // demand loop (a React re-render alone doesn't render under frameloop="demand").
  useEffect(() => { if (!document.hidden) invalidate() }, [dimKey, invalidate])
  const bubbleRef = useRef(null)
  const haloRef = useRef(null)
  const logoGroupRef = useRef(null)
  const linesRef = useRef(null) // network edges (LineSegments), null in galaxy mode

  // edge geometry: id→nodeIndex map + a reusable position buffer for the links.
  const idToIdx = useMemo(() => {
    const m = Object.create(null)
    for (let i = 0; i < nodes.length; i++) m[nodes[i].id] = i
    return m
  }, [nodes])
  const edgeList = links || EMPTY_LINKS
  const edgePos = useMemo(
    () => new Float32Array(Math.max(1, edgeList.length) * 2 * 3),
    [edgeList],
  )

  // Bet-field comet tails: one upward streak per node (2 verts), length ∝ how
  // hard the token is accelerating (velocity ratio). Only present in quadrant.
  const betTailsRef = useRef(null)
  const tailPos = useMemo(() => new Float32Array(Math.max(1, nodes.length) * 2 * 3), [nodes.length])

  // interpolated render positions (world units) — the lerp target lives in the
  // worker's targetsRef; these are what we actually draw.
  const renderPos = useRef(new Float32Array(0)) // [x0,y0,x1,y1,...] hubs then bodies
  const hoverRef = useRef(-1)  // hovered body index (into nodes), -1 = none
  const driftRef = useRef(0)
  // "butterfly" bloom: 0..1 eased factor that spreads the FOCUSED cluster's
  // bubbles radially out from their hub when a sector is selected, so a packed
  // blob opens up like wings. Eases back to 0 on deselect.
  const bloomRef = useRef(0)

  const nodeCount = nodes.length
  const hubCount = clusters.length

  // per-instance static attributes (color/glow) — rebuilt when data changes
  const attrs = useMemo(() => {
    const color = new Float32Array(nodeCount * 3)
    const glow = new Float32Array(nodeCount)
    for (let i = 0; i < nodeCount; i++) {
      const n = nodes[i]
      const c = n.color || [148, 156, 168]
      color[i * 3] = c[0] / 255
      color[i * 3 + 1] = c[1] / 255
      color[i * 3 + 2] = c[2] / 255
      glow[i] = Math.max(0, Math.min(1, n.glow || 0))
    }
    return { color, glow }
  }, [nodes, nodeCount])

  // dynamic per-instance attributes (dim/hover) — mutated in useFrame, uploaded
  const dimAttr = useRef(new Float32Array(nodeCount))
  const hoverAttr = useRef(new Float32Array(nodeCount))
  useEffect(() => {
    dimAttr.current = new Float32Array(nodeCount)
    hoverAttr.current = new Float32Array(nodeCount)
  }, [nodeCount])

  // logo readiness — bumped to re-render the logo planes as textures arrive.
  // CRITICAL: this bump callback MUST exist during the FIRST render, because the
  // logoPlanes useMemo (below) registers it as getLogoTexture's onReady waiter on
  // that first pass. The old version created it in a useEffect (runs AFTER the
  // first render) → the first batch of textures loaded with NO waiter registered
  // → logoTick never bumped → the planes never rendered in. THAT was the "no
  // logos" bug. A lazily-initialised ref makes the callback available immediately.
  const [logoTick, setLogoTick] = useState(0)
  const bumpRef = useRef(null)
  if (!bumpRef.current) {
    let raf = 0
    const fn = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; setLogoTick((t) => t + 1) })
    }
    fn._cancel = () => { if (raf) cancelAnimationFrame(raf) }
    bumpRef.current = fn
  }
  useEffect(() => () => { bumpRef.current && bumpRef.current._cancel && bumpRef.current._cancel() }, [])

  /* ── attach the sim wake/settle hooks → invalidate() so frameloop="demand"
       renders only while the layout moves or interaction is happening ──────── */
  useEffect(() => {
    sim.onWakeRef.current = () => { if (!document.hidden) invalidate() }
    sim.onSettleRef.current = () => { if (!document.hidden) invalidate() }
    return () => { sim.onWakeRef.current = null; sim.onSettleRef.current = null }
  }, [sim])

  /* ── pause the worker + the demand loop on document.hidden; restart on show ─ */
  useEffect(() => {
    const onVis = () => {
      sim.setHidden(document.hidden)
      if (!document.hidden) invalidate()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [sim])

  /* ── set static instance colors/glow once per data change ──────────────── */
  useEffect(() => {
    const bubble = bubbleRef.current
    const halo = haloRef.current
    if (!bubble || !halo) return
    const colorAttr = new InstancedBufferAttribute(attrs.color, 3)
    const glowAttr = new InstancedBufferAttribute(attrs.glow, 1)
    const dim = new InstancedBufferAttribute(dimAttr.current, 1)
    const hov = new InstancedBufferAttribute(hoverAttr.current, 1)
    dim.setUsage(DynamicDrawUsage)
    hov.setUsage(DynamicDrawUsage)
    for (const mesh of [bubble, halo]) {
      mesh.geometry.setAttribute('aColor', colorAttr)
      mesh.geometry.setAttribute('aGlow', glowAttr)
      mesh.geometry.setAttribute('aDim', dim)
      mesh.geometry.setAttribute('aHover', hov)
    }
    bubble.count = nodeCount
    halo.count = nodeCount
    invalidate()
  }, [attrs, nodeCount])

  /* ── camera framing on focus change (animated) ─────────────────────────── */
  const camAnim = useRef(null) // { fromX,fromY,fromZ, toX,toY,toZ, t0, dur }
  const startCamTo = useCallback((tx, ty, tz) => {
    const dur = reducedMotion ? 0 : 620
    camAnim.current = {
      fromX: camera.position.x, fromY: camera.position.y, fromZ: camera.position.z,
      toX: tx, toY: ty, toZ: tz, t0: performance.now(), dur,
    }
    invalidate()
  }, [camera, reducedMotion])

  // overview camera distance derived from stage size so the whole field fits
  const overviewZ = useMemo(() => {
    const { w, h } = stageSize
    const span = Math.max(pxToWorld(w), pxToWorld(h)) * 0.72
    return Math.max(7, span)
  }, [stageSize])

  useEffect(() => {
    const { w, h } = stageSize
    const cxW = pxToWorld(w / 2)
    const cyW = -pxToWorld(h / 2)
    if (isQuad) {
      // Bet field: frame so 1 layout-px == 1 screen-px (the DOM quadrant chrome
      // overlays in the same px space, so bubbles land on their axis cells).
      // visibleWorldHeight = 2·tan(fov/2)·z must equal pxToWorld(h) → solve z.
      const z = pxToWorld(h) / (2 * Math.tan((camera.fov * Math.PI / 180) / 2))
      startCamTo(cxW, cyW, Math.max(2.6, z))
    } else if (links && links.length) {
      // NETWORK mode: the graph is pinned at stage centre — frame it tighter so
      // the center + its callers/co-tokens fill the view (not lost at galaxy zoom).
      startCamTo(cxW, cyW, overviewZ * (mobile ? 0.82 : 0.66))
    } else if (focusKey) {
      // frame the focused cluster: center on its hub anchor, zoom in
      const hubIdx = clusters.findIndex((c) => c.key === focusKey)
      const pos = renderPos.current
      if (hubIdx >= 0 && pos.length >= (hubIdx + 1) * 2) {
        // renderPos is px; camera lives in world units → convert + flip Y
        const hx = pxToWorld(pos[hubIdx * 2])
        const hy = -pxToWorld(pos[hubIdx * 2 + 1])
        // the cluster blooms ~2x as it opens, so don't zoom too tight or it
        // overflows — frame it generously.
        startCamTo(hx, hy, overviewZ * (mobile ? 0.74 : 0.62))
      } else {
        startCamTo(cxW, cyW, overviewZ * 0.66)
      }
    } else {
      startCamTo(cxW, cyW, overviewZ)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, overviewZ, stageSize, links, isQuad, isReactor])

  /* signal "ready" once the first positions land so the view can drop the skeleton */
  const readyFiredRef = useRef(false)

  /* ── THE RENDER LOOP ──────────────────────────────────────────────────────
     - lerp render positions toward the worker's latest targets
     - write instance matrices (position + per-node size)
     - drift (ambient) + hover/dim attribute updates
     - keep invalidating while anything is still moving */
  useFrame((state, delta) => {
    // VISIBILITY GUARD: stop the demand loop entirely when the tab is hidden —
    // do NOT re-invalidate, so the GPU goes fully idle. visibilitychange
    // re-invalidates to restart.
    if (typeof document !== 'undefined' && document.hidden) return

    const targets = sim.targetsRef.current
    const bubble = bubbleRef.current
    const halo = haloRef.current
    if (!bubble || !halo) return

    let needsMore = false

    // grow render buffer to match worker output
    if (targets && renderPos.current.length !== targets.length) {
      const next = new Float32Array(targets.length)
      // seed from targets (snap on first/structural change to avoid a fly-in from 0,0)
      next.set(targets)
      renderPos.current = next
    }

    // lerp toward targets (px space)
    if (targets) {
      const rp = renderPos.current
      const k = reducedMotion ? 1 : Math.min(1, delta * 9) // ~smooth at 60fps
      for (let i = 0; i < rp.length; i++) {
        const diff = targets[i] - rp[i]
        rp[i] += diff * k
        if (Math.abs(diff) > 0.15) needsMore = true
      }
      if (!readyFiredRef.current) {
        readyFiredRef.current = true
        if (onReady) onReady()
      }
    }

    // ambient drift (calm breathing) — disabled on reduced-motion
    if (!reducedMotion) { driftRef.current += delta }
    const drift = driftRef.current

    // focus dim + hover easing (per-instance attribute lerp)
    const dimArr = dimAttr.current
    const hovArr = hoverAttr.current
    const hoverIdx = hoverRef.current
    const easeK = Math.min(1, delta * 12)

    const rp = renderPos.current

    // ── butterfly bloom: ease the spread factor + find the focused hub centre.
    //    When focusKey is set, the focused cluster's bubbles push radially out
    //    from their hub (computed in the loop) so the blob opens like wings.
    const bloomTarget = focusKey ? 1 : 0
    bloomRef.current += (bloomTarget - bloomRef.current) * Math.min(1, delta * 4.5)
    const bloom = bloomRef.current
    if (Math.abs(bloomTarget - bloom) > 0.004) needsMore = true
    let fhx = 0, fhy = 0, focusHubIdx = -1
    if (focusKey && bloom > 0.001) {
      focusHubIdx = clusters.findIndex((c) => c.key === focusKey)
      if (focusHubIdx >= 0 && rp.length >= (focusHubIdx + 1) * 2) {
        fhx = rp[focusHubIdx * 2]
        fhy = rp[focusHubIdx * 2 + 1]
      } else { focusHubIdx = -1 }
    }

    // hubs occupy indices [0, hubCount); bodies follow
    for (let i = 0; i < nodeCount; i++) {
      const n = nodes[i]
      const bodyPosIdx = (hubCount + i) * 2
      let px = rp.length > bodyPosIdx ? rp[bodyPosIdx] : 0
      let py = rp.length > bodyPosIdx ? rp[bodyPosIdx + 1] : 0

      // ambient parallax drift — clusters sway gently, more in front (bigger).
      // A touch more amplitude + a slow breath so the field feels ALIVE at rest
      // (the old values read as rigid once the layout settled).
      const sz = n.size || 0
      if (!reducedMotion) {
        const ph = (n._seed || 0) * Math.PI * 2
        px += Math.sin(drift * 0.30 + ph) * (2.2 + sz * 3.6)
        py += Math.cos(drift * 0.24 + ph) * (2.0 + sz * 3.2)
      }

      // BUTTERFLY BLOOM: spread this bubble out from its hub when its sector is
      // focused. Operate in px space, before the world conversion.
      if (focusHubIdx >= 0 && n.clusterKey === focusKey) {
        px = fhx + (px - fhx) * (1 + bloom * 1.05)
        py = fhy + (py - fhy) * (1 + bloom * 1.05)
      }

      // world coords: px → world; flip Y (screen down → world up)
      const wx = pxToWorld(px)
      const wy = -pxToWorld(py)
      // gentle z-depth by cluster + size → premium parallax between clusters
      const clusterDepth = (hash01(n.clusterKey || '') - 0.5) * 0.9
      const wz = clusterDepth + sz * 0.5

      // per-node radius (world): MIN..MAX px scaled by sqrt(attention) handled by view
      const rWorld = pxToWorld(n._rpx || 14)
      const hovTarget = i === hoverIdx ? 1 : 0
      hovArr[i] += (hovTarget - hovArr[i]) * easeK
      const hov = hovArr[i]

      const dimTarget = (dimKey && n.clusterKey !== dimKey) ? 1 : 0
      dimArr[i] += (dimTarget - dimArr[i]) * easeK

      // bubble instance. planeGeometry(1,1) has half-extent 0.5, so to make the
      // rendered disc radius == rWorld we scale by 2*rWorld (NOT rWorld — that
      // was rendering every bubble at HALF its intended size).
      // dimmed (non-focused) bubbles shrink so the focused sector pops; the
      // focused cluster itself swells a touch as it blooms.
      const dimF = dimArr[i]
      const focusGrow = (focusHubIdx >= 0 && n.clusterKey === focusKey) ? (1 + bloom * 0.12) : 1
      tmpObj.position.set(wx, wy, wz)
      // REACTOR heartbeat: a bubble carrying `_pulse` (velocity-derived) beats —
      // faster + deeper the harder it's being talked about, each on its own phase
      // so the field shimmers like a living organism. No-op for the Map (no _pulse).
      const pulse = n._pulse
        ? (1 + Math.sin(drift * (1.4 + n._pulse * 5.0) + (n._seed || 0) * 6.2831) * 0.11 * Math.min(1.3, n._pulse))
        : 1
      const scale = rWorld * 2 * (1 + hov * 0.14) * (1 - dimF * 0.34) * focusGrow * pulse
      tmpObj.scale.set(scale, scale, 1)
      tmpObj.rotation.set(0, 0, 0)
      tmpObj.updateMatrix()
      bubble.setMatrixAt(i, tmpObj.matrix)

      // halo instance (a touch larger than the bubble — the authenticity bloom)
      const haloScale = rWorld * 2 * (1.4 + (n.glow || 0) * 0.6) * (1 - dimF * 0.34) * focusGrow
      tmpObj.scale.set(haloScale, haloScale, 1)
      tmpObj.position.set(wx, wy, wz - 0.05)
      tmpObj.updateMatrix()
      halo.setMatrixAt(i, tmpObj.matrix)

      // store world pos + scale multiplier for logo planes + raycast (avoid recompute)
      n._wx = wx; n._wy = wy; n._wz = wz; n._rw = rWorld
      n._scaleMul = (1 - dimF * 0.34) * focusGrow

      if (Math.abs(hovTarget - hov) > 0.01 || Math.abs(dimTarget - dimArr[i]) > 0.01) needsMore = true
    }
    bubble.instanceMatrix.needsUpdate = true
    halo.instanceMatrix.needsUpdate = true
    if (bubble.geometry.getAttribute('aDim')) {
      bubble.geometry.getAttribute('aDim').needsUpdate = true
      bubble.geometry.getAttribute('aHover').needsUpdate = true
      halo.geometry.getAttribute('aDim').needsUpdate = true
      halo.geometry.getAttribute('aHover').needsUpdate = true
    }

    // far-zoom LOD: zoom OUT past the default frame → logos fade so the map reads
    // as a clean colored "attention weather map"; full detail as you zoom back in.
    // (Disabled in the Bet field, which is a fixed 1:1 frame.)
    const lodFade = (isQuad || isReactor) ? 1 : Math.max(0.12, 1 - Math.max(0, camera.position.z - overviewZ * 1.05) / (overviewZ * 0.9))

    // move logo planes to follow their bubbles (they share node._wx/_wy)
    const lg = logoGroupRef.current
    if (lg) {
      for (let c = 0; c < lg.children.length; c++) {
        const plane = lg.children[c]
        const idx = plane.userData.idx
        const n = nodes[idx]
        if (!n) continue
        plane.position.set(n._wx, n._wy, n._wz + 0.02)
        // _rw == rWorld (the disc radius). plane(1,1) half-extent 0.5, so to fill
        // ~82% of the disc with the logo we scale by 2*rWorld*0.82.
        const s = (n._rw || 0.14) * 2 * 0.82 * (1 + (hovArr[idx] || 0) * 0.14) * (n._scaleMul || 1)
        plane.scale.set(s, s, 1)
        // logos are the star → keep them crisp & near-opaque; authenticity is
        // carried by the ring/halo glow, not by fading the logo into the void.
        const baseA = 0.92 + (n.glow || 0) * 0.08
        plane.material.opacity = baseA * (1 - (dimArr[idx] || 0) * 0.82) * lodFade
      }
    }

    // BET FIELD comet tails: accelerating tokens (velocity > 1) shoot upward;
    // tail length ∝ acceleration. Reuses the per-node world positions above.
    if (isQuad && betTailsRef.current) {
      const tp = tailPos
      for (let i = 0; i < nodeCount; i++) {
        const n = nodes[i]
        const o = i * 6
        const vel = Number(n.data && n.data.velocity) || 1
        const accel = vel - 1
        const len = accel > 0.05 ? pxToWorld(Math.min(70, accel * 48)) : 0
        const x = n._wx || 0, y = n._wy || 0, z = (n._wz || 0) - 0.06
        tp[o] = x; tp[o + 1] = y; tp[o + 2] = z
        tp[o + 3] = x; tp[o + 4] = y + len; tp[o + 5] = z
      }
      const attr = betTailsRef.current.geometry.getAttribute('position')
      if (attr) attr.needsUpdate = true
    }

    // NETWORK EDGES: stitch each link from node center → node center (the
    // bubbles' world positions, computed above). Lines sit just behind the
    // bubbles. Galaxy mode passes no links → this is skipped.
    if (linesRef.current && edgeList.length) {
      const pos = edgePos
      for (let e = 0; e < edgeList.length; e++) {
        const a = nodes[idToIdx[edgeList[e].source]]
        const b = nodes[idToIdx[edgeList[e].target]]
        const o = e * 6
        if (!a || !b) { pos[o] = pos[o + 1] = pos[o + 3] = pos[o + 4] = 0; pos[o + 2] = pos[o + 5] = -50; continue }
        pos[o] = a._wx || 0; pos[o + 1] = a._wy || 0; pos[o + 2] = (a._wz || 0) - 0.08
        pos[o + 3] = b._wx || 0; pos[o + 4] = b._wy || 0; pos[o + 5] = (b._wz || 0) - 0.08
      }
      const attr = linesRef.current.geometry.getAttribute('position')
      if (attr) attr.needsUpdate = true
    }

    // camera tween
    if (camAnim.current) {
      const a = camAnim.current
      const tt = a.dur ? Math.min(1, (performance.now() - a.t0) / a.dur) : 1
      const e = easeOutQuint(tt)
      camera.position.x = a.fromX + (a.toX - a.fromX) * e
      camera.position.y = a.fromY + (a.toY - a.fromY) * e
      camera.position.z = a.fromZ + (a.toZ - a.fromZ) * e
      camera.lookAt(camera.position.x, camera.position.y, 0)
      if (tt >= 1) camAnim.current = null
      else needsMore = true
    } else {
      camera.lookAt(camera.position.x, camera.position.y, 0)
    }

    if (!reducedMotion) needsMore = true // ambient drift keeps a gentle heartbeat
    if (sim.runningRef.current) needsMore = true
    if (needsMore) invalidate()
  })

  /* ── logo planes: cached circle-masked textures, lazily attached ──────────
     Re-evaluated when logoTick bumps (a texture finished loading). Only nodes
     with a resolved logo get a plane; the bubble shader paints a glyph for the
     rest implicitly (handled by the view via label). */
  const logoPlanes = useMemo(() => {
    const planes = []
    for (let i = 0; i < nodeCount; i++) {
      const n = nodes[i]
      if (!n.logo) continue
      const tex = getLogoTexture(n.logo, bumpRef.current)
      if (!tex) continue
      planes.push({ idx: i, tex })
    }
    return planes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, nodeCount, logoTick])

  // debug: expose how many logo textures have resolved (read in headless verify)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__cnLogoCount = logoPlanes.length
      window.__cnNodeCount = nodeCount
    }
  }, [logoPlanes, nodeCount])

  /* ── SCREEN-SPACE picking — project every node to screen and pick the bubble
       whose rendered circle the cursor is inside (nearest on overlap), with a
       generous slop. This replaced a raycaster against the instanced quads,
       which was far too precise: clicks landed in gaps / on transparent quad
       corners and "did nothing" even when visually on a token. Projecting ~280
       points on a click (not per-frame) is cheap and rock-solid. ───────────── */
  const pickVec = useMemo(() => new Vector3(), [])
  const pickEdge = useMemo(() => new Vector3(), [])

  const pick = useCallback((clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect()
    if (!rect.width) return -1
    const px = clientX - rect.left
    const py = clientY - rect.top
    // forgiveness beyond the visible circle. A drill-down network has few, big,
    // spaced-out bubbles → be very generous (a near-miss still opens the node
    // instead of registering as an empty-click that exits the drill, "kicked
    // back"). The dense galaxy was too tight at 8px — clicks landed in the gaps
    // between packed bubbles and "did nothing"; 14px makes a click reliably grab
    // the nearest bubble while the nearest-containment tiebreak keeps overlaps
    // resolving to the front.
    const SLOP = nodeCount <= 48 ? 26 : 14
    let best = -1
    let bestScore = Infinity
    for (let i = 0; i < nodeCount; i++) {
      const n = nodes[i]
      if (n._wx == null) continue
      if (focusKey && n.clusterKey !== focusKey) continue
      // project center
      pickVec.set(n._wx, n._wy, n._wz || 0).project(camera)
      if (pickVec.z > 1) continue // behind camera
      const sx = (pickVec.x * 0.5 + 0.5) * rect.width
      const sy = (-pickVec.y * 0.5 + 0.5) * rect.height
      const dx = sx - px
      const dy = sy - py
      const dist = Math.sqrt(dx * dx + dy * dy)
      // screen radius: project a point one world-radius to the right of center
      pickEdge.set(n._wx + (n._rw || 0.14), n._wy, n._wz || 0).project(camera)
      const ex = (pickEdge.x * 0.5 + 0.5) * rect.width
      const rad = Math.max(6, Math.abs(ex - sx))
      if (dist <= rad + SLOP) {
        // inside this bubble — prefer the one whose center is closest relative
        // to its size (tightest containment), so overlaps resolve to the front.
        const score = dist / (rad + SLOP)
        if (score < bestScore) { bestScore = score; best = i }
      }
    }
    return best
  }, [camera, gl, nodes, nodeCount, focusKey, pickVec, pickEdge])

  // expose pick + node world position to the parent via the sim object (refs)
  useEffect(() => {
    sim._pick = pick
    sim._nodeScreen = (idx) => {
      const n = nodes[idx]
      if (!n) return null
      const v = new Vector3(n._wx || 0, n._wy || 0, n._wz || 0)
      v.project(camera)
      const rect = gl.domElement.getBoundingClientRect()
      return {
        x: (v.x * 0.5 + 0.5) * rect.width,
        y: (-v.y * 0.5 + 0.5) * rect.height,
      }
    }
    return () => { sim._pick = null; sim._nodeScreen = null }
  }, [pick, nodes, camera, gl, sim])

  // hover/click handlers on the canvas (registered by the parent overlay)
  useEffect(() => {
    sim._setHover = (idx) => {
      if (hoverRef.current === idx) return
      hoverRef.current = idx
      invalidate()
      if (onNodeHover) {
        if (idx < 0) onNodeHover(null, null)
        else {
          const screen = sim._nodeScreen ? sim._nodeScreen(idx) : null
          onNodeHover(nodes[idx], screen)
        }
      }
    }
    return () => { sim._setHover = null }
  }, [nodes, onNodeHover, sim])

  /* ── hub label groups — mutated imperatively each frame (NO React state per
       tick). drei <Html> reads its parent group's world matrix, so moving the
       group moves the label without re-rendering. The labels' opacity (focus
       dim) is set on the wrapper class via a ref too. ──────────────────────── */
  const hubGroupRefs = useRef([])
  useFrame(() => {
    const rp = renderPos.current
    if (rp.length < hubCount * 2) return
    for (let i = 0; i < hubCount; i++) {
      const g = hubGroupRefs.current[i]
      if (!g) continue
      g.position.set(pxToWorld(rp[i * 2]), -pxToWorld(rp[i * 2 + 1]), 0.6)
    }
  })

  const dayUniform = useMemo(() => ({ uDay: { value: dayMode ? 1 : 0 } }), [dayMode])

  return (
    <>
      {/* NETWORK EDGES (behind everything) — faint light-threads between linked
          nodes; only present in drill-down (network) mode. */}
      {edgeList.length > 0 && (
        <lineSegments ref={linesRef} frustumCulled={false} renderOrder={-1}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={edgePos.length / 3}
              array={edgePos}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial
            transparent
            opacity={0.32}
            color={dayMode ? '#1d2433' : '#aeb6ff'}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      )}

      {/* BET FIELD comet tails — upward streaks on accelerating tokens. */}
      {isQuad && (
        <lineSegments ref={betTailsRef} frustumCulled={false} renderOrder={-1}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={tailPos.length / 3}
              array={tailPos}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial
            transparent
            opacity={0.5}
            color={dayMode ? '#8a93b5' : '#cdd6ff'}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      )}

      {/* HALO field (additive, behind bubbles) — authenticity bloom */}
      <instancedMesh ref={haloRef} args={[null, null, Math.max(1, nodeCount)]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={haloVert}
          fragmentShader={haloFrag}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </instancedMesh>

      {/* BUBBLE field — one draw call: backing + ring + inner glow */}
      <instancedMesh ref={bubbleRef} args={[null, null, Math.max(1, nodeCount)]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={bubbleVert}
          fragmentShader={bubbleFrag}
          uniforms={dayUniform}
          transparent
          depthWrite={false}
        />
      </instancedMesh>

      {/* LOGO planes — cached circle-masked textures, faded in on ready */}
      <group ref={logoGroupRef}>
        {logoPlanes.map(({ idx, tex }) => (
          <mesh key={nodes[idx].id} userData={{ idx }} renderOrder={2}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* SECTOR LABELS — premium <Html> overlays. Each label rides a stable
          <group> whose position is mutated imperatively in useFrame (no React
          state per tick); drei <Html> tracks the group's world matrix. */}
      {clusters.map((c, i) => {
        const dimmed = dimKey && dimKey !== c.key
        const [r, g, b] = c.color || [148, 156, 168]
        return (
          <group key={c.key} ref={(el) => { hubGroupRefs.current[i] = el }}>
            <Html
              center
              zIndexRange={[4, 0]}
              style={{ pointerEvents: 'none', opacity: dimmed ? 0.3 : 1, transition: 'opacity 250ms cubic-bezier(0.16,1,0.3,1)' }}
              wrapperClass="ce-hub-html"
            >
              <div className="ce-hublabel" style={{ '--hue': `rgb(${r},${g},${b})` }}>
                <span className="ce-hublabel__name">{c.label}</span>
                <span className="ce-hublabel__count">{c.count}</span>
              </div>
            </Html>
          </group>
        )
      })}
    </>
  )
}

/* ── connector lines as a thin additive plane field would be heavy; we keep the
     "one cluster reads as one blob" cue via the halos + ring colors. (The old
     connector lines were a main-thread per-frame cost; the halo bloom replaces
     them and is GPU-cheap.) ───────────────────────────────────────────────── */

export default function ConstellationEngine({
  nodes = [],
  clusters = [],
  links = null,         // network mode: explicit edges [{source,target,dist?,strength?}]
  layout = 'galaxy',    // 'galaxy' | 'quadrant' (the Bet field). network is inferred from links.
  focusKey = null,      // committed cluster → camera frames it
  highlightKey = null,  // soft highlight (e.g. nav-rail hover) → dim others, no camera move
  onNodeClick,
  onNodeHover,
  onReady,
  onEmptyClick,
  controlsRef,
  stageSize = { w: 0, h: 0 },
  reducedMotion = false,
  mobile = false,
  dayMode = false,
  className = '',
}) {
  const sim = useConstellationSim()
  // quadrant ("Bet" field) only applies when NOT in a drill-down network.
  const isQuad = layout === 'quadrant' && !(links && links.length)
  const isReactor = layout === 'reactor' && !(links && links.length)
  const wrapRef = useRef(null)
  const draggingRef = useRef(null) // active-pan state
  const panRef = useRef(null)      // CameraRig sets this: (dx, dy) => pan the camera by screen-px delta
  const inertiaRaf = useRef(null)  // momentum-pan rAF after a flick (fluid, not rigid)

  const dpr = useMemo(() => Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2), [])

  /* ── (re)build the worker sim whenever the model / stage size / worker
       instance changes. workerId bumps when the worker is (re)created — under
       StrictMode the worker is torn down + rebuilt, so we MUST re-init it
       (resetting lastSig) or the sim never starts against the fresh worker. ── */
  const lastSig = useRef('')
  const lastWorkerId = useRef(0)
  useEffect(() => {
    const { w, h } = stageSize
    // network mode has NO clusters (a center-pinned graph) — only require nodes.
    if (!w || !h || !nodes.length || !sim.workerId) return
    const isNet = !!(links && links.length)
    if (sim.workerId !== lastWorkerId.current) {
      lastWorkerId.current = sim.workerId
      lastSig.current = '' // force a fresh init against the new worker
    }
    // layout payload (data-agnostic — the worker only needs ids/links/anchors)
    const cx = w / 2
    const cy = h / 2
    // wider ring → sectors separate, bubbles stop reading as one crushed blob
    const rx = Math.max(190, w * 0.44)
    const ry = Math.max(160, h * 0.44)
    const anchors = {}
    clusters.forEach((c, i) => {
      const ang = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, clusters.length)
      anchors[c.key] = { x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry }
    })
    const hubs = (isQuad || isReactor) ? [] : clusters.map((c) => ({ id: `hub:${c.key}`, key: c.key, isHub: true }))
    const simNodes = nodes.map((n) => ({
      id: n.id,
      hubKey: n.clusterKey,
      r: n._rpx || 14,
      pin: !!n._pin,
      // QUADRANT: the token's data cell (px) — authenticity × momentum.
      tx: n._tx,
      ty: n._ty,
      seed: n._seed != null ? n._seed : hash01(n.id),
      seed2: hash01(n.id + ':2'),
    }))
    // GALAXY: auto hub→node links. NETWORK: the explicit links prop. QUADRANT: none.
    const simLinks = (isQuad || isReactor)
      ? []
      : (isNet
        ? links.map((l) => ({ source: l.source, target: l.target, dist: l.dist, strength: l.strength }))
        : nodes.map((n) => ({ source: `hub:${n.clusterKey}`, target: n.id })))

    // sig must change on ANY node-set change so the worker re-inits. The old
    // sig (length + first/last id) could COLLIDE when a drill-down's caller
    // roster grew (e.g. 3 kols → 20 real callers as token-detail lands) if the
    // co-token count shifted to compensate — the worker then kept the stale
    // 3-node layout while the panel already showed all callers. A cheap full-id
    // hash makes the sig change whenever membership changes, so the graph and
    // the panel always agree.
    let idHash = 0
    for (let i = 0; i < nodes.length; i++) {
      const s = nodes[i].id || ''
      for (let j = 0; j < s.length; j++) idHash = (Math.imul(idHash, 31) + s.charCodeAt(j)) | 0
    }
    const sig = `${isReactor ? 'R' : isQuad ? 'Q' : (isNet ? 'N' : 'G')}::${clusters.map((c) => c.key).join(',')}::${nodes.length}::${idHash}::${isNet ? simLinks.length : 0}${isQuad ? `::${Math.round(w)}x${Math.round(h)}` : ''}`
    if (sig !== lastSig.current) {
      lastSig.current = sig
      sim.init({ nodes: simNodes, links: simLinks, hubs, anchors, w, h, settle: 0.92, layout: isReactor ? 'reactor' : isQuad ? 'quadrant' : (isNet ? 'network' : 'galaxy') })
    } else {
      sim.resize(w, h, anchors)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, clusters, links, isQuad, isReactor, stageSize.w, stageSize.h, sim.workerId])

  /* ── pointer interaction: hover pick (throttled to rAF) + click + pan + wheel
       zoom. Picking uses the Scene's raycaster via sim._pick — instant, no
       per-frame CPU hit-test. ──────────────────────────────────────────────── */
  const moveRaf = useRef(null)
  const lastPointer = useRef({ x: 0, y: 0 })

  const onPointerMove = useCallback((e) => {
    lastPointer.current = { x: e.clientX, y: e.clientY }
    // pan
    const drag = draggingRef.current
    if (drag) {
      const dx = e.clientX - drag.lx
      const dy = e.clientY - drag.ly
      if (Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3) drag.moved = true
      drag.lx = e.clientX
      drag.ly = e.clientY
      // smoothed velocity for the release-flick (momentum pan)
      drag.vx = drag.vx * 0.6 + dx * 0.4
      drag.vy = drag.vy * 0.6 + dy * 0.4
      // Bet field is a fixed data grid (camera locked) — drag doesn't pan it.
      if (panRef.current && !isQuad) panRef.current(dx, dy)
      return
    }
    if (moveRaf.current) return
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = null
      if (!sim._pick || !sim._setHover) return
      const idx = sim._pick(lastPointer.current.x, lastPointer.current.y)
      sim._setHover(idx)
      const el = wrapRef.current
      if (el) el.style.cursor = idx >= 0 ? 'pointer' : (isQuad ? 'default' : 'grab')
    })
  }, [sim, isQuad])

  const onPointerLeave = useCallback(() => {
    if (sim._setHover) sim._setHover(-1)
    const el = wrapRef.current
    if (el) el.style.cursor = 'default'
  }, [sim])

  const onPointerDown = useCallback((e) => {
    // grabbing kills any in-flight momentum so you can catch the field mid-glide
    if (inertiaRaf.current) { cancelAnimationFrame(inertiaRaf.current); inertiaRaf.current = null }
    draggingRef.current = { startX: e.clientX, startY: e.clientY, lx: e.clientX, ly: e.clientY, vx: 0, vy: 0, moved: false }
    const el = wrapRef.current
    if (el) { el.style.cursor = 'grabbing'; el.setPointerCapture?.(e.pointerId) }
  }, [])

  const onPointerUp = useCallback((e) => {
    const drag = draggingRef.current
    draggingRef.current = null
    const el = wrapRef.current
    if (el) { el.style.cursor = 'grab'; el.releasePointerCapture?.(e.pointerId) }
    if (drag && !drag.moved) {
      // a click (not a pan): pick + open
      if (sim._pick) {
        const idx = sim._pick(e.clientX, e.clientY)
        if (idx >= 0 && onNodeClick) onNodeClick(nodes[idx])
        else if (idx < 0 && onEmptyClick) onEmptyClick()
      }
    } else if (drag && drag.moved && !isQuad) {
      // a flick → momentum pan that glides to rest (the "fluid" feel)
      const cap = (v) => Math.max(-44, Math.min(44, v))
      let lvx = cap(drag.vx), lvy = cap(drag.vy)
      if (Math.abs(lvx) > 0.6 || Math.abs(lvy) > 0.6) {
        const step = () => {
          lvx *= 0.92; lvy *= 0.92
          if ((Math.abs(lvx) < 0.25 && Math.abs(lvy) < 0.25) || !panRef.current) { inertiaRaf.current = null; return }
          panRef.current(lvx, lvy)
          inertiaRaf.current = requestAnimationFrame(step)
        }
        inertiaRaf.current = requestAnimationFrame(step)
      }
    }
  }, [sim, nodes, onNodeClick, onEmptyClick, isQuad])

  // cancel any momentum + hover rAF on unmount
  useEffect(() => () => {
    if (inertiaRaf.current) cancelAnimationFrame(inertiaRaf.current)
    if (moveRaf.current) cancelAnimationFrame(moveRaf.current)
  }, [])

  return (
    <div
      ref={wrapRef}
      className={`ce-wrap${className ? ' ' + className : ''}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      /* explicit px dimensions from the measured stage so R3F's canvas sizes
         deterministically (no ResizeObserver race that can leave it at the
         300×150 default). The CSS still pins it absolute/inset:0 as a fallback. */
      style={{ width: stageSize.w || '100%', height: stageSize.h || '100%', cursor: isQuad ? 'default' : 'grab', touchAction: isQuad ? 'auto' : 'none' }}
    >
      <Canvas
        frameloop="demand"
        dpr={dpr}
        resize={{ debounce: 0, scroll: false }}
        gl={{ antialias: !mobile, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.1, far: 100, position: [pxToWorld(stageSize.w / 2), -pxToWorld(stageSize.h / 2), 10] }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0) }}
      >
        <SizeSync stageSize={stageSize} />
        <CameraRig panRef={panRef} controlsRef={controlsRef} stageSize={stageSize} reducedMotion={reducedMotion} lockCamera={isQuad} />
        <Scene
          nodes={nodes}
          clusters={clusters}
          links={links}
          layout={layout}
          focusKey={focusKey}
          highlightKey={highlightKey}
          onNodeClick={onNodeClick}
          onNodeHover={onNodeHover}
          onReady={onReady}
          reducedMotion={reducedMotion}
          mobile={mobile}
          dayMode={dayMode}
          stageSize={stageSize}
          sim={sim}
        />
      </Canvas>
    </div>
  )
}

/* SizeSync — explicitly drive R3F's renderer size from the measured stage.
   R3F v8 auto-measures the container via react-use-measure, but its initial
   observation can be late (it never fired until a resize in headless), leaving
   the canvas at its 300×150 default. We already measure the stage in the view,
   so push that size into the R3F store directly — deterministic everywhere,
   and a no-op once R3F's own measure agrees. */
function SizeSync({ stageSize }) {
  const setSize = useThree((s) => s.setSize)
  const setDpr = useThree((s) => s.setDpr)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const { w, h } = stageSize
    if (!w || !h) return
    setSize(w, h)
    setDpr(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2))
    invalidate()
  }, [stageSize, setSize, setDpr, invalidate])
  return null
}

/* CameraRig — owns imperative pan + wheel zoom + the controlsRef API (zoom
   buttons / reset from the view chrome). Lives inside the Canvas so it has the
   camera; exposes a (dx,dy) pan fn to the wrapper. */
function CameraRig({ panRef, controlsRef, stageSize, reducedMotion, lockCamera = false }) {
  const { camera, gl, invalidate } = useThree()

  // pan: the wrapper calls panRef(dxPx, dyPx) during a drag. We convert the
  // screen-px delta to a world delta at the camera's current zoom so the field
  // tracks the cursor 1:1 regardless of zoom level.
  useEffect(() => {
    panRef.current = (dx, dy) => {
      const rect = gl.domElement.getBoundingClientRect()
      if (!rect.height) return
      const worldH = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z
      const worldPerPx = worldH / rect.height
      camera.position.x -= dx * worldPerPx
      camera.position.y += dy * worldPerPx
      invalidate()
    }
    return () => { panRef.current = null }
  }, [camera, gl, panRef])

  // wheel zoom (dolly along z), tastefully constrained
  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e) => {
      // Bet field is a fixed data grid — let the wheel scroll the page, don't dolly.
      if (lockCamera) return
      e.preventDefault()
      // Proportional + damped zoom. The old `*1.12` per wheel EVENT made trackpad
      // pinch (which fires dozens of events per gesture) wildly over-sensitive.
      // Clamp the per-event delta and map it through exp() so one notch is gentle
      // and a fling still ramps smoothly.
      const d = Math.max(-50, Math.min(50, e.deltaY))
      const factor = Math.exp(d * 0.0015)
      camera.position.z = Math.max(2.6, Math.min(36, camera.position.z * factor))
      invalidate()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [camera, gl, lockCamera])

  // imperative controls for the view's zoom buttons / reset. A short eased
  // dolly/recenter keeps it premium rather than a hard snap.
  const anim = useRef(null)
  useFrame(() => {
    const a = anim.current
    if (!a) return
    const tt = a.dur ? Math.min(1, (performance.now() - a.t0) / a.dur) : 1
    const e = easeOutQuint(tt)
    camera.position.x = a.fx + (a.tx - a.fx) * e
    camera.position.y = a.fy + (a.ty - a.fy) * e
    camera.position.z = a.fz + (a.tz - a.fz) * e
    if (tt >= 1) anim.current = null
    invalidate()
  })
  useEffect(() => {
    if (!controlsRef) return undefined
    const dur = reducedMotion ? 0 : 260
    const ease = (tx, ty, tz) => {
      anim.current = {
        fx: camera.position.x, fy: camera.position.y, fz: camera.position.z,
        tx, ty, tz, t0: performance.now(), dur,
      }
      invalidate()
    }
    controlsRef.current = {
      zoomBy: (factor) => {
        const tz = Math.max(2.2, Math.min(40, camera.position.z / factor))
        ease(camera.position.x, camera.position.y, tz)
      },
      reset: () => {
        const { w, h } = stageSize
        const span = Math.max(pxToWorld(w), pxToWorld(h)) * 0.72
        ease(pxToWorld(w / 2), -pxToWorld(h / 2), Math.max(7, span))
      },
    }
    return () => { if (controlsRef) controlsRef.current = null }
  }, [camera, controlsRef, stageSize, reducedMotion])

  return null
}
