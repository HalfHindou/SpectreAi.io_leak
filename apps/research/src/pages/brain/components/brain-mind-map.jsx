/**
 * Brain — The Observatory (Mind tab).
 *
 * The market-intelligence consciousness, drawn as a living celestial chart:
 * the regime read burns at the core; narratives orbit the inner ring;
 * projects the Brain is conscious of hold the middle ring (sized by attention,
 * tinted by their own GRADED record); reinforced intel, hunted signals and
 * lessons orbit their project as satellites; mined patterns drift on the
 * outer shell. Constellation lines are real co-mentions from trader theses.
 * Amber halos are the Brain's own self-audit (wiki lint) flagging its beliefs.
 *
 * Engineered for near-zero GPU: 2D canvas, DPR ≤ 1.5, pre-baked glow sprites
 * (no per-frame shadowBlur), deterministic ring layout (no force sim), 30fps
 * cap on a slow orbital drift that fully STOPS when the tab is hidden, the
 * canvas is off-screen, or the user has been idle 4 minutes.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import useBrainGraph, { useBrainActivity, streamLine } from './use-brain-graph'
import './brain-mind-map.css'

/* ── palettes (canvas reads these; CSS handles the chrome) ─────────────────
   THE GRADE (founder, 2026-08-25: "no big design changes" — the at-rest look
   was still white dots + hairlines): the scene now has TEMPERATURE DEPTH.
   The core is the light source — warm gold — and its light cools with
   distance: inner shells warm, mid shells neutral, the sensory rim cool
   blue. Two temperature poles only, no rainbow. Resting synapses are
   near-invisible — a link EXISTS when a signal lights it. */
const PALETTES = {
  dark: {
    bg: '#04050a', star: 'rgba(185,205,240,0.55)', ring: 'rgba(190,205,235,0.055)',
    ringStrong: 'rgba(200,212,240,0.10)', text: 'rgba(245,245,247,0.95)',
    textDim: 'rgba(245,245,247,0.62)', link: 'rgba(195,210,240,0.05)',
    linkHot: 'rgba(255,246,228,0.6)', core: [255, 238, 198],
    pulse: [255, 246, 226],
    bull: [52, 211, 153], bear: [248, 113, 113], neutral: [214, 216, 224],
    lint: [245, 158, 11],
    // the light gradient: core-warm → neutral → rim-cool
    tempWarm: [255, 240, 214], tempMid: [230, 234, 244], tempCool: [166, 197, 236],
  },
  day: {
    // PAPER, not gray (founder: "day mode is bad and gray lol"): a bright
    // warm-white sheet, nodes as INK with real weight, the core a warm amber
    // sun. Same two temperature poles as dark — warm amber ink near the core,
    // cool blue ink at the rim — on a clean page.
    bg: '#fbfbfd', star: 'rgba(100,116,139,0.28)', ring: 'rgba(15,23,42,0.07)',
    ringStrong: 'rgba(15,23,42,0.12)', text: 'rgba(15,23,42,0.95)',
    textDim: 'rgba(15,23,42,0.6)', link: 'rgba(51,65,85,0.08)',
    linkHot: 'rgba(146,96,20,0.75)', core: [212, 145, 30],
    pulse: [146, 96, 20],
    bull: [5, 150, 105], bear: [220, 38, 38], neutral: [71, 85, 105],
    lint: [180, 83, 9],
    tempWarm: [160, 108, 30], tempMid: [55, 65, 88], tempCool: [42, 88, 158],
  },
}

/* where a node sits between the warm core light and the cool rim */
function tempTint(p, ring) {
  const r = Math.max(0, Math.min(1, ring || 0))
  const a = r < 0.5 ? p.tempWarm : p.tempMid
  const b = r < 0.5 ? p.tempMid : p.tempCool
  const k = r < 0.5 ? r / 0.5 : (r - 0.5) / 0.5
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - k) + b[i] * k))
}

const TYPE_LABEL = {
  core: 'The Read', organ: 'Sensory feed', lens: 'Thinking lens', world: 'World state',
  narrative: 'Narrative', project: 'Project', thesis: 'Trader post', news: 'Headline',
  intel: 'Intel', pattern: 'Pattern', lesson: 'Lesson', signal: 'Signal',
}
const FPS_MS = 1000 / 30
const IDLE_STOP_MS = 4 * 60_000

function fmtCap(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${Math.round(n / 1e3)}K`
}

/* streamLine (the inner voice formatter) now lives in use-brain-graph.js —
   shared with the Cortex tab's activity feed */
const tsHHMM = (ts) => { try { return new Date(ts).toTimeString().slice(0, 5) } catch { return '' } }
function ago(ts) {
  if (!ts) return null
  const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`
}

/* tone → rgb blend toward bull/bear from neutral — SUBTLE: warm-white stays
   dominant (the design bar: tone is a whisper, not a neon). */
function toneRgb(p, tone) {
  const t = Math.max(-1, Math.min(1, Number(tone) || 0))
  const base = p.neutral, tint = t >= 0 ? p.bull : p.bear
  const k = Math.abs(t) * 0.42
  return [0, 1, 2].map((i) => Math.round(base[i] * (1 - k) + tint[i] * k))
}

/* pre-baked orb sprite: a crisp luminous core + tight halo, no runtime
   shadowBlur. Halo kept TIGHT so 160 bodies read as stars, not fog. */
function makeSprite(rgb, r, halo = 1.9, coreAlpha = 0.95, light = false) {
  const size = Math.ceil(r * halo * 2) + 4
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const g = c.getContext('2d')
  const cx = size / 2
  const [R, G, B] = rgb
  // halo (fades fast)
  const grad = g.createRadialGradient(cx, cx, r * 0.4, cx, cx, r * halo)
  grad.addColorStop(0, `rgba(${R},${G},${B},${coreAlpha * (light ? 0.35 : 0.5)})`)
  grad.addColorStop(0.45, `rgba(${R},${G},${B},${coreAlpha * 0.10})`)
  grad.addColorStop(1, `rgba(${R},${G},${B},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  // crisp core — a white-hot heart on the night sky, solid INK on paper (the
  // white center read as a pale smudge in day mode)
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, r * 0.55)
  if (light) {
    core.addColorStop(0, `rgba(${R},${G},${B},${Math.min(1, coreAlpha * 1.1)})`)
    core.addColorStop(0.6, `rgba(${R},${G},${B},${coreAlpha * 0.9})`)
  } else {
    core.addColorStop(0, `rgba(255,255,255,${Math.min(1, coreAlpha * 1.05)})`)
    core.addColorStop(0.5, `rgba(${R},${G},${B},${coreAlpha})`)
  }
  core.addColorStop(1, `rgba(${R},${G},${B},0)`)
  g.fillStyle = core
  g.beginPath(); g.arc(cx, cx, r * 0.62, 0, Math.PI * 2); g.fill()
  return { canvas: c, size }
}

/* pure glow sprite — no crisp core; drawn additively under motes/flares so
   traveling signals read as light, not painted dots. Baked once. */
function makeGlowSprite(rgb, r, alpha = 0.55) {
  const size = Math.ceil(r * 2) + 2
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const g = c.getContext('2d')
  const cx = size / 2
  const [R, G, B] = rgb
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, r)
  grad.addColorStop(0, `rgba(${R},${G},${B},${alpha})`)
  grad.addColorStop(0.5, `rgba(${R},${G},${B},${alpha * 0.28})`)
  grad.addColorStop(1, `rgba(${R},${G},${B},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return { canvas: c, size }
}

/* the core's corona — pure smooth luminosity, NO structure. The first cut
   drew gradient fills CLIPPED by ellipse paths: the gradient still had alpha
   at the ellipse edge, so three overlapping "arms" rendered as hard-edged
   gray petals at zoom (founder: "ugly unstyled piece of light"). The cure is
   gradients that ARE elliptical — draw a circular radial gradient in a
   scaled context so alpha reaches exactly zero at the edge. No seams at any
   zoom, just light falling off the way light does. */
function makeCoronaSprite(rgb, r) {
  const size = Math.ceil(r * 2) + 4
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const g = c.getContext('2d')
  const cx = size / 2
  const [R, G, B] = rgb
  // steep exponential-feeling falloff: hot heart, long faint breath
  const glow = g.createRadialGradient(cx, cx, 0, cx, cx, r)
  glow.addColorStop(0, `rgba(${R},${G},${B},0.50)`)
  glow.addColorStop(0.16, `rgba(${R},${G},${B},0.20)`)
  glow.addColorStop(0.42, `rgba(${R},${G},${B},0.06)`)
  glow.addColorStop(1, `rgba(${R},${G},${B},0)`)
  g.fillStyle = glow
  g.fillRect(0, 0, size, size)
  // two whisper-soft elliptical hazes at different angles — an asymmetry the
  // slow rotation makes visible, without ever showing an edge
  for (const [rot, ky, a] of [[0.5, 0.55, 0.10], [2.1, 0.46, 0.07]]) {
    g.save()
    g.translate(cx, cx)
    g.rotate(rot)
    g.scale(1, ky)
    const hz = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.96)
    hz.addColorStop(0, `rgba(${R},${G},${B},${a})`)
    hz.addColorStop(0.5, `rgba(${R},${G},${B},${a * 0.38})`)
    hz.addColorStop(1, `rgba(${R},${G},${B},0)`)
    g.fillStyle = hz
    g.fillRect(-r, -r, r * 2, r * 2)
    g.restore()
  }
  return { canvas: c, size }
}

/* ── deterministic celestial layout — the shells of a mind ─────────────────
   core 0 → lenses 0.15 (cognition) → narratives 0.29 → world+patterns 0.42
   (beliefs) → projects 0.58 (entities) → free percepts 0.76 (posts/news the
   brain just read) → organs 0.95 (the sensory rim). Parented percepts orbit
   their project as satellites — perception attaches to what it touches. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
function buildLayout(data) {
  const nodes = data.nodes.map((n) => ({ ...n }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const ringOf = (list, ring, jitter, speed, aOff = 0) => {
    list.forEach((n, i) => {
      n.ring = ring + ((i % 5) - 2) * jitter
      n.baseA = i * GOLDEN + aOff
      n.speed = speed * (i % 3 === 0 ? 1.2 : 1)
      n.labelRank = i
    })
  }
  const lenses = nodes.filter((n) => n.type === 'lens').sort((a, b) => b.w - a.w)
  lenses.forEach((n, i) => { // evenly spaced cognition ring
    n.ring = 0.15; n.baseA = (i / Math.max(1, lenses.length)) * Math.PI * 2 + 0.5
    n.speed = 0.000012; n.labelRank = i
  })
  ringOf(nodes.filter((n) => n.type === 'narrative').sort((a, b) => b.w - a.w), 0.29, 0.012, 0.00001, 0.7)
  ringOf(nodes.filter((n) => n.type === 'world' || n.type === 'pattern').sort((a, b) => b.w - a.w), 0.42, 0.014, 0.000008, 1.4)
  ringOf(nodes.filter((n) => n.type === 'project').sort((a, b) => b.w - a.w), 0.58, 0.022, 0.0000065, 0.2)
  ringOf(nodes.filter((n) => !n.parent && (n.type === 'thesis' || n.type === 'news' || n.type === 'lesson' || n.type === 'intel' || n.type === 'signal')).sort((a, b) => b.w - a.w), 0.76, 0.018, 0.0000055, 2.3)
  const organs = nodes.filter((n) => n.type === 'organ')
  organs.forEach((n, i) => { // the sensory rim — evenly spaced, nearly still
    n.ring = 0.95; n.baseA = (i / Math.max(1, organs.length)) * Math.PI * 2 + 0.25
    n.speed = 0.0000018; n.labelRank = i
  })
  const perParent = new Map()
  nodes.filter((n) => n.parent && byId.has(n.parent)).forEach((n) => {
    const k = (perParent.get(n.parent) || 0)
    perParent.set(n.parent, k + 1)
    n.satIdx = k
    n.satR = 0.038 + (k % 3) * 0.015
    n.satA = k * GOLDEN * 2 + 0.4
    n.satSpeed = 0.00006 * (k % 2 ? -1 : 1)
  })
  const core = byId.get('core')
  if (core) { core.ring = 0; core.baseA = 0; core.speed = 0 }
  const links = (data.links || []).filter((l) => byId.has(l.s) && byId.has(l.t))
  return { nodes, byId, links }
}

/* position at time t (unit circle space — the screen mapping is anisotropic,
   so the sky fills the whole frame instead of a centered disc) */
function posOf(n, byId, t, out) {
  if (n.type === 'core') { out.x = 0; out.y = 0; return out }
  if (n.parent) {
    const p = byId.get(n.parent)
    if (p) {
      const pp = posOf(p, byId, t, { x: 0, y: 0 })
      const a = n.satA + t * n.satSpeed
      out.x = pp.x + Math.cos(a) * n.satR
      out.y = pp.y + Math.sin(a) * n.satR * 1.3
      return out
    }
  }
  const a = n.baseA + t * (n.speed || 0)
  out.x = Math.cos(a) * n.ring
  out.y = Math.sin(a) * n.ring
  return out
}

function radiusOf(n) {
  if (n.type === 'core') return 13
  if (n.type === 'lens') return 4.6
  if (n.type === 'organ') return 3.4
  if (n.type === 'world') return 3.2
  if (n.type === 'narrative') return 4.2 + Math.min(4.2, n.w * 0.42)
  if (n.type === 'project') return 2.4 + Math.min(6, Math.sqrt(Math.max(0, n.w)) * 0.95)
  if (n.type === 'thesis') return 1.5 + Math.min(1.4, (n.w - 1.8) * 0.8)
  if (n.type === 'news') return 1.6
  if (n.type === 'intel') return 1.3 + Math.min(1.8, n.w * 0.24)
  if (n.type === 'signal') return 1.8
  if (n.type === 'lesson') return 1.6
  return 2.0 // pattern
}

/* ── the component ─────────────────────────────────────────────────────────── */
export default function BrainMindMap({ dayMode }) {
  const { loading, error, data, refetch } = useBrainGraph()
  const { feed, drain } = useBrainActivity()
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const [hoverInfo, setHoverInfo] = useState(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [regimeLive, setRegimeLive] = useState(null)
  // legend → canvas: hover previews a node type, click pins it — the map dims
  // everything else so a reader can ask "show me just the intel" by touch
  const [typeSel, setTypeSel] = useState({ ty: null, pinned: false })
  const typeFocusRef = useRef(null)
  typeFocusRef.current = typeSel.ty
  const stateRef = useRef({})
  const bloomedRef = useRef(false)
  const drainRef = useRef(drain)
  drainRef.current = drain
  const regimeRef = useRef(setRegimeLive)
  regimeRef.current = setRegimeLive

  const graph = useMemo(() => (data ? buildLayout(data) : null), [data])
  const palette = PALETTES[dayMode ? 'day' : 'dark']

  const select = useCallback((id) => {
    setSelected(id)
    const st = stateRef.current
    if (st && st.flyTo && id) st.flyTo(id)
  }, [])

  // Cortex → sky handoff: the Cortex tab stashes a node id, we fly to it once.
  // Declared AFTER select — a dep-array reference above its const is a
  // render-time TDZ crash (the documented trap).
  useEffect(() => {
    if (!graph) return undefined
    try {
      const f = sessionStorage.getItem('spectre-brain-focus')
      if (f) sessionStorage.removeItem('spectre-brain-focus')
      if (f && graph.byId.has(f)) {
        // the engine mounts in its own effect — give it a beat before flying
        const t = setTimeout(() => select(f), 350)
        return () => clearTimeout(t)
      }
    } catch { /* private mode */ }
    return undefined
  }, [graph, select])

  /* the render engine — one effect owns canvas lifecycle */
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !graph) return undefined

    const ctx = canvas.getContext('2d')
    // Full device resolution — the 1.5 cap read as PIXELATED text on retina
    // (founder screenshot 2026-08-25). This canvas is sprite-blit + thin
    // strokes, not per-pixel work; dpr 2 is well inside the 30fps budget.
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let W = 0, H = 0
    let cam = { x: 0, y: 0, z: 1 } // pan (unit space) + zoom
    let camT = null                 // fly-to tween target
    let running = true
    let visible = true
    let lastFrame = 0
    let lastActivity = Date.now()
    // bloom only on FIRST build — data refreshes rebuild the engine silently
    const isRefresh = bloomedRef.current
    let bornAt = isRefresh ? -1e9 : performance.now()
    bloomedRef.current = true
    let raf = 0
    let hoverId = null
    let dragging = false
    let dragMoved = false
    let dragStart = null

    const { nodes, byId, links } = graph
    const p = palette

    /* stars — parallax layers with a slow per-star twinkle (phase-seeded so
       the field shimmers instead of strobing) */
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const stars = Array.from({ length: 240 }, () => ({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, r: rnd() < 0.85 ? 0.6 : 1.1, a: 0.18 + rnd() * 0.55, layer: rnd() < 0.5 ? 0.35 : 0.7, ph: rnd() * Math.PI * 2, tw: 0.4 + rnd() * 0.6 }))

    /* the cinematic layer (founder call 2026-08-25: "more immersive, premium,
       wow — but aesthetic"): everything below is PRE-BAKED sprites moved by
       transforms — zero per-frame gradient allocation, 30fps cap unchanged.
       Additive compositing is dark-mode only (additive washes white on paper —
       the cosmos _applyDayLook lesson). */
    // by identity, never by bg literal — the grade retinted the void once and
    // a string compare silently flipped dark mode into day compositing
    const isDay = p === PALETTES.day
    const ADD = isDay ? 'source-over' : 'lighter'
    const coronaSprite = makeCoronaSprite(p.core, 120)
    const pulseGlow = makeGlowSprite(p.pulse, 9, isDay ? 0.28 : 0.5)
    const focusGlow = makeGlowSprite(p.core, 46, isDay ? 0.12 : 0.2)
    const nebulaSprites = (isDay
      ? [[196, 148, 62], [88, 118, 178]]
      : [[148, 163, 220], [134, 190, 190]]
    ).map((rgb) => makeGlowSprite(rgb, 260, isDay ? 0.045 : 0.11))

    /* sprites per node (baked once) + lint halo sprites.
       THE GRADE: each node's base color is its position in the core's light
       (warm inner → cool rim, tempTint) with the bull/bear tone blended on
       top; the rim also gets bokeh — larger, softer, dimmer halos — so depth
       reads even in a still frame. */
    const sprites = new Map()
    for (const n of nodes) {
      const ringPos = n.ring ?? (n.parent ? (byId.get(n.parent)?.ring ?? 0.6) : 0.6)
      let rgb
      if (n.type === 'core') rgb = p.core
      else {
        const base = tempTint(p, ringPos)
        const tn = Math.max(-1, Math.min(1, Number(n.tone) || 0))
        const tint = tn >= 0 ? p.bull : p.bear
        const k = Math.abs(tn) * 0.42
        rgb = [0, 1, 2].map((i) => Math.round(base[i] * (1 - k) + tint[i] * k))
      }
      const r = radiusOf(n)
      const dimType = n.type === 'intel' || n.type === 'lesson' || n.type === 'pattern'
      const halo = n.type === 'core' ? 2.6 : 1.9 + ringPos * 1.15
      const alpha = (dimType ? 0.62 : 0.9) * (1 - ringPos * 0.2)
      sprites.set(n.id, makeSprite(rgb, r * 1.7, halo, alpha, isDay))
    }
    const lintHalo = makeSprite(p.lint, 15, 2.4, 0.3, isDay)

    /* anisotropic mapping — the mind fills the whole frame */
    const scaleX = () => W * 0.465
    const scaleY = () => H * 0.42
    const toScreen = (u, out) => {
      out.x = W / 2 + (u.x - cam.x) * scaleX() * cam.z
      out.y = H / 2 + (u.y - cam.y) * scaleY() * cam.z
      return out
    }

    /* baked depth layer: vignette + core aura + faint nebulae (drawn once) */
    let bgLayer = null
    function bakeBg() {
      bgLayer = document.createElement('canvas')
      bgLayer.width = W; bgLayer.height = H
      const g = bgLayer.getContext('2d')
      const day = isDay
      if (!day) {
        // deep-space wash: cool indigo falls from the top, so the void has a
        // grade instead of being flat black
        const space = g.createLinearGradient(0, 0, 0, H)
        space.addColorStop(0, 'rgba(24,32,64,0.30)')
        space.addColorStop(0.45, 'rgba(12,16,34,0.10)')
        space.addColorStop(1, 'rgba(6,8,18,0)')
        g.fillStyle = space; g.fillRect(0, 0, W, H)
      }
      // the core's light pooling at the center — WARM, it is the sun
      const aura = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.min(W, H) * 0.46)
      aura.addColorStop(0, day ? 'rgba(212,145,30,0.055)' : 'rgba(255,236,196,0.06)')
      aura.addColorStop(0.5, day ? 'rgba(212,145,30,0.018)' : 'rgba(255,236,196,0.02)')
      aura.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = aura; g.fillRect(0, 0, W, H)
      // nebulae moved out of the static bake — they DRIFT now (see draw())
      const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, day ? 'rgba(238,238,244,0.65)' : 'rgba(0,0,0,0.5)')
      g.fillStyle = vig; g.fillRect(0, 0, W, H)
    }

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      W = Math.max(320, rect.width); H = Math.max(360, rect.height)
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bakeBg()
      draw(performance.now(), true)
    }

    const neighborSets = new Map()
    const linksOf = new Map()
    for (const l of links) {
      if (!neighborSets.has(l.s)) neighborSets.set(l.s, new Set())
      if (!neighborSets.has(l.t)) neighborSets.set(l.t, new Set())
      neighborSets.get(l.s).add(l.t); neighborSets.get(l.t).add(l.s)
      if (!linksOf.has(l.s)) linksOf.set(l.s, []); if (!linksOf.has(l.t)) linksOf.set(l.t, [])
      linksOf.get(l.s).push(l); linksOf.get(l.t).push(l)
    }

    /* ── THE LIFE: perception pulses travel organ → percept → entity → core ──
       Spawn rates are the organs' REAL 24h reading volumes — this is the
       Brain literally collecting and processing, not decoration. */
    const perceivedBy = new Map()   // organId -> [perceptIds]
    const perceptTo = new Map()     // perceptId -> entityId (project|narrative)
    const projectNarr = new Map()   // projectId -> narrativeId
    const lensTargets = []          // [lensId, projectId] attention pairs
    for (const l of links) {
      if (l.k === 'perceived') {
        if (!perceivedBy.has(l.s)) perceivedBy.set(l.s, [])
        perceivedBy.get(l.s).push(l.t)
      }
      if (l.k === 'names' || l.k === 'about' || l.k === 'fact' || l.k === 'hunted' || l.k === 'lesson') {
        if (!perceptTo.has(l.s)) perceptTo.set(l.s, l.t)
      }
      if (l.k === 'member') projectNarr.set(l.t, l.s)
      if (l.k === 'attending') lensTargets.push([l.s, l.t])
    }
    // satellites without explicit percept links still point at their parent
    for (const n of nodes) if (n.parent && !perceptTo.has(n.id)) perceptTo.set(n.id, n.parent)
    const organSpawn = [] // {organId, nextAt, gapMs}
    for (const n of nodes) {
      if (n.type !== 'organ') continue
      const vol = Math.max(1, Number(n.meta && n.meta.vol_24h) || 1)
      const perMin = vol / 1440
      // Cadence still scales with the organ's REAL 24h volume, but the ceiling
      // is 6.5s, not 18s — at 18s every organ sat on the clamp and the whole
      // brain averaged ~1 visible pulse, which read as asleep (founder,
      // 2026-08-25). Busier organs still pulse visibly faster inside the band.
      const gapMs = Math.max(1200, Math.min(6500, 45000 / Math.max(0.1, Math.sqrt(perMin))))
      organSpawn.push({ organId: n.id, nextAt: performance.now() + Math.random() * gapMs, gapMs })
    }
    const pulses = []       // {path:[ids], seg, segStart, segDur}
    const MAX_PULSES = 30
    const flares = new Map() // id -> intensity 0..1
    const flare = (id, v) => flares.set(id, Math.min(1, (flares.get(id) || 0) + v))
    const waves = []        // wave start timestamps
    const rings = []        // action-potential rings {id, startAt, rgb}
    const comets = []       // REAL events in flight {fromId,toId,label,tone,startAt,dur,glyph}
    let thinkStart = 0      // the think-cycle sequence window
    let lastWaveAt = 0
    if (isRefresh) waves.push(performance.now()) // fresh thought arriving

    /* real cognition events → animations */
    const nodeFor = (sym) => {
      if (!sym) return null
      const id = `project:${String(sym).toLowerCase()}`
      return byId.has(id) ? id : null
    }
    function animateEvent(e, delay) {
      const at = performance.now() + delay
      if (e.t === 'news' || e.t === 'post' || e.t === 'fact') {
        const from = e.t === 'news' ? 'organ:news' : 'organ:xdash'
        const to = (e.id && byId.has(e.id) ? e.id : null) || nodeFor(e.sym) || 'core'
        if (!byId.has(from)) return
        comets.push({
          fromId: from, toId: to, startAt: at, dur: 1600,
          label: e.t === 'post' ? `@${e.author}` : e.t === 'news' ? (e.source || 'news') : `fact ×${e.obs}`,
          tone: e.stance === 'bull' ? 0.6 : e.stance === 'bear' ? -0.6 : 0,
        })
      } else if (e.t === 'call') {
        const to = nodeFor(e.sym)
        const from = e.src === 'lens' && e.lens && byId.has(`lens:${e.lens}`) ? `lens:${e.lens}` : 'core'
        if (to) comets.push({ fromId: from, toId: to, startAt: at, dur: 1100, beam: true, glyph: e.direction === 'bear' ? '▼' : '▲', tone: e.direction === 'bear' ? -0.8 : 0.8, label: e.tier === 'shadow' ? `${e.direction} · shadow` : e.direction })
        else flare('core', 0.8)
      } else if (e.t === 'grade') {
        const to = nodeFor(e.sym)
        if (to) { rings.push({ id: to, startAt: at, tone: e.hit ? 0.9 : -0.9 }); flare(to, 0.8) }
      } else if (e.t === 'cycle') {
        thinkStart = at
        if (e.regime && regimeRef.current) setTimeout(() => regimeRef.current(e.regime), delay + 2000)
      }
    }
    function drainEvents() {
      const evs = drainRef.current ? drainRef.current() : []
      // animate newest-first with a stagger so arrivals read as a stream
      evs.slice(0, 10).forEach((e, i) => animateEvent(e, 300 + i * 620))
    }

    function buildPath(organId) {
      const percepts = perceivedBy.get(organId)
      const path = [organId]
      if (percepts && percepts.length) {
        const pct = percepts[(Math.random() * percepts.length) | 0]
        path.push(pct)
        const ent = perceptTo.get(pct)
        if (ent && Math.random() < 0.85) {
          path.push(ent)
          const narr = projectNarr.get(ent)
          if (narr && Math.random() < 0.6) path.push(narr)
          if (Math.random() < 0.55) path.push('core')
        }
      } else {
        path.push('core') // organs with no individual percepts feed the core direct
      }
      return path
    }

    function stepLife(now) {
      drainEvents()
      // spawn from organs at their true cadence
      for (const os of organSpawn) {
        if (now >= os.nextAt && pulses.length < MAX_PULSES) {
          pulses.push({ path: buildPath(os.organId), seg: 0, segStart: now, segDur: 620 + Math.random() * 420 })
          os.nextAt = now + os.gapMs * (0.65 + Math.random() * 0.7)
        }
      }
      // an occasional attention pulse: a lens reaches out to what it watches
      if (lensTargets.length && Math.random() < 0.02 && pulses.length < MAX_PULSES) {
        const [ln, pj] = lensTargets[(Math.random() * lensTargets.length) | 0]
        pulses.push({ path: [ln, pj], seg: 0, segStart: now, segDur: 900 })
      }
      // heartbeat: a slow ambient wave; a burst when a NEW desk cycle lands
      if (now - lastWaveAt > 9000) { waves.push(now); lastWaveAt = now }
      // decay flares
      for (const [id, v] of flares) {
        const nv = v * 0.94
        if (nv < 0.02) flares.delete(id); else flares.set(id, nv)
      }
    }

    /* consistent synapse curvature: control point bows left of a→b */
    function ctrl(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const bow = Math.min(26, d * 0.09)
      return { x: (a.x + b.x) / 2 - (dy / d) * bow, y: (a.y + b.y) / 2 + (dx / d) * bow }
    }
    const qp = (a, c, b, t) => ({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
    })

    function drawPulses(now) {
      const [PR, PG, PB] = p.pulse
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pl = pulses[i]
        const a = positions.get(pl.path[pl.seg])
        const b = positions.get(pl.path[pl.seg + 1])
        if (!a || !b) { pulses.splice(i, 1); continue }
        let k = (now - pl.segStart) / pl.segDur
        if (k >= 1) {
          flare(pl.path[pl.seg + 1], 0.6)
          pl.seg++
          pl.segStart = now
          if (pl.seg >= pl.path.length - 1) { pulses.splice(i, 1); continue }
          k = 0
        }
        const ke = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
        const c = ctrl(a, b)
        const pos = qp(a, c, b, ke)
        // lit synapse under the traveling signal
        ctx.globalAlpha = 0.14
        ctx.strokeStyle = p.linkHot
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke()
        // the signal itself: a glowing mote with a short trail — light, not paint
        ctx.globalCompositeOperation = ADD
        const gh = pulseGlow.size / 2
        ctx.globalAlpha = 0.9
        ctx.drawImage(pulseGlow.canvas, pos.x - gh, pos.y - gh)
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = `rgba(${PR},${PG},${PB},0.9)`
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 1.6, 0, Math.PI * 2); ctx.fill()
        const tp = qp(a, c, b, Math.max(0, ke - 0.06))
        ctx.globalAlpha = 0.3
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 1.1, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    /* REAL events in flight: labeled comets + call beams */
    function drawComets(now) {
      for (let i = comets.length - 1; i >= 0; i--) {
        const cm = comets[i]
        if (now < cm.startAt) continue
        const a = positions.get(cm.fromId), b = positions.get(cm.toId)
        if (!a || !b) { comets.splice(i, 1); continue }
        const k = (now - cm.startAt) / cm.dur
        if (k >= 1) {
          flare(cm.toId, cm.beam ? 1 : 0.85)
          rings.push({ id: cm.toId, startAt: now, tone: cm.tone, glyph: cm.glyph })
          comets.splice(i, 1)
          continue
        }
        const ke = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
        const c = ctrl(a, b)
        const pos = qp(a, c, b, ke)
        const rgb = toneRgb(p, cm.tone)
        if (cm.beam) {
          // a decision traveling: the whole synapse burns while it moves
          ctx.globalAlpha = 0.4
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.8)`
          ctx.lineWidth = 1.6
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke()
        }
        // glow under the head — an event in flight is a point of light
        ctx.globalCompositeOperation = ADD
        ctx.globalAlpha = cm.beam ? 1 : 0.85
        const cgh = (pulseGlow.size / 2) * 1.3
        ctx.drawImage(pulseGlow.canvas, pos.x - cgh, pos.y - cgh, cgh * 2, cgh * 2)
        ctx.globalCompositeOperation = 'source-over'
        // comet head + tapering trail
        for (let s = 0; s < 4; s++) {
          const tt = Math.max(0, ke - s * 0.045)
          const tpos = qp(a, c, b, tt)
          ctx.globalAlpha = (cm.beam ? 0.95 : 0.85) * (1 - s * 0.24)
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`
          ctx.beginPath(); ctx.arc(tpos.x, tpos.y, (cm.beam ? 2.6 : 2.1) - s * 0.35, 0, Math.PI * 2); ctx.fill()
        }
        if (cm.label) {
          ctx.globalAlpha = 0.85
          ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
          ctx.fillStyle = p.textDim
          ctx.textAlign = 'left'
          ctx.fillText(cm.label, pos.x + 7, pos.y - 5)
          ctx.textAlign = 'center'
        }
        ctx.globalAlpha = 1
      }
    }

    /* action-potential rings + arrival glyphs */
    function drawRings(now) {
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg = rings[i]
        const age = now - rg.startAt
        if (age > 1200) { rings.splice(i, 1); continue }
        const pos = positions.get(rg.id)
        if (!pos) continue
        const n = byId.get(rg.id)
        const base = n ? radiusOf(n) : 4
        const k = age / 1200
        const rgb = toneRgb(p, rg.tone)
        ctx.globalAlpha = (1 - k) * 0.55
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`
        ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.arc(pos.x, pos.y, base * (1.4 + k * 2.6), 0, Math.PI * 2); ctx.stroke()
        if (rg.glyph && age < 1000) {
          ctx.globalAlpha = 1 - age / 1000
          ctx.font = '700 13px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`
          ctx.fillText(rg.glyph, pos.x, pos.y - base * 2.4 - 6)
        }
        ctx.globalAlpha = 1
      }
    }

    /* the think sequence: gather → synthesize → radiate */
    function drawThink(now) {
      if (!thinkStart || now < thinkStart) return
      const tk = (now - thinkStart) / 2400
      if (tk >= 1) {
        waves.push(now); waves.push(now + 260); waves.push(now + 520)
        flare('core', 1)
        thinkStart = 0
        return
      }
      const corePos = positions.get('core')
      if (!corePos) return
      const ke = tk < 0.5 ? 2 * tk * tk : 1 - Math.pow(-2 * tk + 2, 2) / 2
      const [PR, PG, PB] = p.pulse
      for (const os of organSpawn) {
        const op = positions.get(os.organId)
        if (!op) continue
        const x = op.x + (corePos.x - op.x) * ke
        const y = op.y + (corePos.y - op.y) * ke
        ctx.globalAlpha = 0.7
        ctx.fillStyle = `rgba(${PR},${PG},${PB},0.9)`
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.1
        ctx.strokeStyle = p.linkHot
        ctx.beginPath(); ctx.moveTo(op.x, op.y); ctx.lineTo(corePos.x, corePos.y); ctx.stroke()
      }
      flare('core', 0.12)
      ctx.globalAlpha = 1
    }

    const u = { x: 0, y: 0 }, sc = { x: 0, y: 0 }
    const positions = new Map() // id -> screen pos (per frame)

    function draw(now, force) {
      if (!force && now - lastFrame < FPS_MS) return
      lastFrame = now
      const t = now
      const birth = Math.min(1, (now - bornAt) / 900)
      const focus = hoverId || selected

      ctx.fillStyle = p.bg
      ctx.fillRect(0, 0, W, H)
      if (bgLayer) ctx.drawImage(bgLayer, 0, 0)

      /* aurora nebulae — two baked glow fields on a slow Lissajous drift, so
         the deep background breathes instead of sitting still */
      ctx.globalCompositeOperation = ADD
      for (let i = 0; i < nebulaSprites.length; i++) {
        const nb = nebulaSprites[i]
        const bx = i === 0 ? W * 0.22 : W * 0.78
        const by = i === 0 ? H * 0.30 : H * 0.68
        const nx = bx + Math.sin(t * 0.000021 + i * 2.1) * W * 0.05
        const ny = by + Math.cos(t * 0.000017 + i * 1.3) * H * 0.06
        const sscale = 1 + Math.sin(t * 0.000013 + i * 4) * 0.12
        const half = (nb.size / 2) * sscale
        ctx.drawImage(nb.canvas, nx - half, ny - half, half * 2, half * 2)
      }
      ctx.globalCompositeOperation = 'source-over'

      /* starfield (parallax with camera, gentle twinkle) */
      for (const s of stars) {
        const sx = W / 2 + (s.x - cam.x * s.layer * 0.3) * scaleX() * 1.15
        const sy = H / 2 + (s.y - cam.y * s.layer * 0.3) * scaleY() * 1.15
        if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue
        ctx.globalAlpha = s.a * 0.7 * (0.72 + 0.28 * Math.sin(t * 0.0006 * s.tw + s.ph))
        ctx.fillStyle = p.star
        ctx.fillRect(sx, sy, s.r, s.r)
      }
      ctx.globalAlpha = 1

      /* wireframe: the shells of the mind */
      const sx0 = scaleX() * cam.z, sy0 = scaleY() * cam.z
      const cx = W / 2 - cam.x * sx0, cy = H / 2 - cam.y * sy0
      ctx.lineWidth = 1
      for (const [rr, strong] of [[0.15, false], [0.29, false], [0.42, false], [0.58, true], [0.76, false], [0.95, true]]) {
        ctx.strokeStyle = strong ? p.ringStrong : p.ring
        ctx.beginPath()
        ctx.ellipse(cx, cy, rr * sx0, rr * sy0, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      /* orrery gleam — a bright arc segment sweeping each strong ring, in
         opposite directions: the instrument is running, not parked */
      for (const [rr, spd, dir] of [[0.58, 0.00005, 1], [0.95, 0.000032, -1]]) {
        const a0 = t * spd * dir
        ctx.globalAlpha = 0.30
        ctx.strokeStyle = p.linkHot
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.ellipse(cx, cy, rr * sx0, rr * sy0, 0, a0, a0 + 0.85)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      /* the corona — The Read burning at the center, slowly rotating */
      const coreBreathe = 1 + Math.sin(t * 0.0011) * 0.05
      ctx.globalCompositeOperation = ADD
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(t * 0.00009)
      // zoom-clamped: the glow grows a LITTLE as you fly in, but never
      // swallows the viewport — at cam.z 3 the first cut filled half the frame
      const coronaHalf = (coronaSprite.size / 2) * coreBreathe * Math.min(1.35, Math.sqrt(cam.z)) * ((flares.get('core') || 0) * 0.35 + 1)
      ctx.globalAlpha = isDay ? 0.45 : 0.75
      ctx.drawImage(coronaSprite.canvas, -coronaHalf, -coronaHalf, coronaHalf * 2, coronaHalf * 2)
      ctx.restore()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1

      /* thought waves — the desk cycle's heartbeat rippling outward */
      for (let i = waves.length - 1; i >= 0; i--) {
        const age = now - waves[i]
        if (age < 0) continue // scheduled, not yet born
        if (age > 2400) { waves.splice(i, 1); continue }
        const k = age / 2400
        ctx.globalAlpha = (1 - k) * 0.28
        ctx.strokeStyle = p.linkHot
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.ellipse(cx, cy, k * 0.98 * sx0, k * 0.98 * sy0, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      /* positions this frame */
      for (const n of nodes) {
        posOf(n, byId, t, u)
        toScreen(u, sc)
        let pos = positions.get(n.id)
        if (!pos) { pos = { x: 0, y: 0 }; positions.set(n.id, pos) }
        // entrance: bloom out from core
        pos.x = cx + (sc.x - cx) * (birth === 1 ? 1 : easeOut(birth))
        pos.y = cy + (sc.y - cy) * (birth === 1 ? 1 : easeOut(birth))
      }

      /* links — synapse curves, not wires */
      const tf = typeFocusRef.current
      for (const l of links) {
        const a = positions.get(l.s), b = positions.get(l.t)
        if (!a || !b) continue
        const hot = focus && (l.s === focus || l.t === focus)
        if (focus && !hot) ctx.globalAlpha = 0.22
        if (tf && !hot) {
          const sn = byId.get(l.s), tn = byId.get(l.t)
          const touches = (sn && sn.type === tf) || (tn && tn.type === tf)
          ctx.globalAlpha = touches ? 0.6 : 0.05
        }
        ctx.strokeStyle = hot ? p.linkHot : p.link
        ctx.lineWidth = hot ? 1.2 : Math.min(1, 0.4 + (l.w || 1) * 0.12)
        const c = ctrl(a, b)
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke()
        ctx.globalAlpha = 1
      }

      /* focus spotlight — a soft pool of light under the node being examined */
      if (focus) {
        const fpos = positions.get(focus)
        if (fpos) {
          ctx.globalCompositeOperation = ADD
          const fh = focusGlow.size / 2
          ctx.drawImage(focusGlow.canvas, fpos.x - fh, fpos.y - fh)
          ctx.globalCompositeOperation = 'source-over'
        }
      }

      /* nodes */
      const breathe = 1 + Math.sin(t * 0.0011) * 0.05
      for (const n of nodes) {
        const pos = positions.get(n.id)
        if (!pos || pos.x < -60 || pos.x > W + 60 || pos.y < -60 || pos.y > H + 60) continue
        const spr = sprites.get(n.id)
        const dim = (focus && n.id !== focus && !(neighborSets.get(focus) || EMPTY_SET).has(n.id))
          || (tf && n.type !== tf && n.type !== 'core')
        const fl = flares.get(n.id) || 0
        const zz = (n.type === 'core' ? breathe : 1) * (1 + fl * 0.5)
        const half = (spr.size / 2) * zz * (n.id === focus ? 1.18 : 1)
        if (n.flags && n.flags.length) {
          const pulse = 0.75 + Math.sin(t * 0.002 + pos.x) * 0.25
          ctx.globalAlpha = (dim ? 0.25 : 0.85) * pulse
          ctx.drawImage(lintHalo.canvas, pos.x - lintHalo.size / 2, pos.y - lintHalo.size / 2)
        }
        ctx.globalAlpha = Math.min(1, (dim ? 0.28 : 1) + fl * 0.4)
        ctx.drawImage(spr.canvas, pos.x - half, pos.y - half, half * 2, half * 2)
        // organs + lenses wear a thin ring — instruments, not stars
        if (n.type === 'organ' || n.type === 'lens') {
          ctx.strokeStyle = n.tone < -0.5 ? `rgba(${p.bear.join(',')},0.55)` : p.ringStrong
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.arc(pos.x, pos.y, radiusOf(n) * 1.55, 0, Math.PI * 2); ctx.stroke()
        }
        ctx.globalAlpha = 1
      }

      /* the traveling signals ride above everything */
      drawPulses(now)
      drawComets(now)
      drawRings(now)
      drawThink(now)

      /* labels: core + top narratives + top/hovered projects (breathing room) */
      ctx.textAlign = 'center'
      for (const n of nodes) {
        const pos = positions.get(n.id)
        if (!pos) continue
        const isFocus = n.id === focus
        const isNeighbor = focus && (neighborSets.get(focus) || EMPTY_SET).has(n.id)
        const show = n.type === 'core' || isFocus || isNeighbor
          || n.type === 'organ' || n.type === 'lens' || n.type === 'world'
          || (n.type === 'narrative' && n.labelRank < 10)
          || (n.type === 'project' && (n.labelRank < 20 || cam.z > 1.4))
          || (n.type === 'thesis' && (n.labelRank < 10 || cam.z > 1.5))
          || (n.type === 'news' && (n.labelRank < 6 || cam.z > 1.5))
        if (!show) continue
        const dim = focus && !isFocus && !isNeighbor
        const small = n.type === 'thesis' || n.type === 'news'
        ctx.globalAlpha = dim ? 0.18 : isFocus ? 1 : small ? 0.7 : 0.88
        const px = n.type === 'core' ? 13 : n.type === 'organ' || n.type === 'lens' ? 10.5 : n.type === 'narrative' ? 11 : small ? 9.5 : 10.5
        ctx.font = `${n.type === 'core' ? 700 : 600} ${px}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif`
        let label = n.type === 'project' ? `$${n.label}` : n.label
        if (n.type === 'organ' || n.type === 'lens') label = label.toUpperCase()
        const max = n.type === 'news' ? 34 : 24
        const txt = label.length > max ? `${label.slice(0, max - 1)}…` : label
        const ly = pos.y + radiusOf(n) * 1.9 + 11
        // halo underlay keeps type readable over stars and synapses
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3
        ctx.strokeStyle = p.bg === '#050507' ? 'rgba(5,5,7,0.75)' : 'rgba(246,247,249,0.85)'
        ctx.strokeText(txt, pos.x, ly)
        ctx.fillStyle = isFocus ? p.text : p.textDim
        ctx.fillText(txt, pos.x, ly)
      }
      ctx.globalAlpha = 1
    }

    function easeOut(x) { return 1 - Math.pow(1 - x, 3) }
    const EMPTY_SET = new Set()

    function frame(now) {
      raf = 0
      if (!running || !visible) return
      /* camera tween */
      if (camT) {
        cam.x += (camT.x - cam.x) * 0.14
        cam.y += (camT.y - cam.y) * 0.14
        cam.z += (camT.z - cam.z) * 0.14
        if (Math.abs(camT.x - cam.x) + Math.abs(camT.y - cam.y) + Math.abs(camT.z - cam.z) < 0.004) camT = null
      }
      const idle = Date.now() - lastActivity > IDLE_STOP_MS
      stepLife(now)
      draw(now, false)
      if (!idle || camT) raf = requestAnimationFrame(frame)
      // idle: freeze the sky; resume on any pointer activity
    }
    const wake = () => {
      lastActivity = Date.now()
      if (!raf && running && visible) raf = requestAnimationFrame(frame)
    }

    /* hit test on screen positions */
    function nodeAt(mx, my) {
      let best = null, bestD = 1e9
      for (const n of nodes) {
        const pos = positions.get(n.id)
        if (!pos) continue
        const r = Math.max(9, radiusOf(n) * 2.2)
        const d = (pos.x - mx) ** 2 + (pos.y - my) ** 2
        if (d < r * r && d < bestD) { best = n; bestD = d }
      }
      return best
    }

    const onMove = (e) => {
      wake()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      if (dragging && dragStart) {
        const s = unitScale() * cam.z
        cam.x -= (mx - dragStart.x) / s; cam.y -= (my - dragStart.y) / s
        dragStart = { x: mx, y: my }; dragMoved = true; camT = null
        return
      }
      const n = nodeAt(mx, my)
      const id = n ? n.id : null
      if (id !== hoverId) {
        hoverId = id
        canvas.style.cursor = id ? 'pointer' : 'grab'
        setHoverInfo(n && n.type !== 'core' ? { x: mx, y: my, node: n } : null)
      } else if (n && hoverInfo) {
        setHoverInfo((h) => (h ? { ...h, x: mx, y: my } : h))
      }
    }
    const onDown = (e) => { wake(); dragging = true; dragMoved = false; const rect = canvas.getBoundingClientRect(); dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top }; canvas.style.cursor = 'grabbing' }
    const onUp = (e) => {
      canvas.style.cursor = 'grab'
      const wasDrag = dragMoved
      dragging = false; dragStart = null
      if (wasDrag) return
      const rect = canvas.getBoundingClientRect()
      const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top)
      setSelected(n && n.type !== 'core' ? n.id : null)
      if (n && n.type !== 'core') flyTo(n.id)
    }
    const onWheel = (e) => {
      e.preventDefault(); wake()
      const nz = Math.max(0.55, Math.min(3, cam.z * (e.deltaY > 0 ? 0.9 : 1.1)))
      cam.z = nz; camT = null
    }
    const onDbl = () => { wake(); camT = { x: 0, y: 0, z: 1 } ; setSelected(null) }
    const onLeave = () => { hoverId = null; setHoverInfo(null); dragging = false; dragStart = null }

    function flyTo(id) {
      const n = byId.get(id)
      if (!n) return
      posOf(n, byId, performance.now(), u)
      camT = { x: u.x * 0.72, y: u.y * 0.72, z: Math.max(cam.z, 1.5) }
      wake()
    }
    stateRef.current.flyTo = flyTo

    /* visibility guards */
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0 }
    }, { threshold: 0.05 })
    io.observe(wrap)
    const onVis = () => { if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0 } } else wake() }
    document.addEventListener('visibilitychange', onVis)

    const ro = new ResizeObserver(() => resize())
    ro.observe(wrap)

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDbl)

    resize()
    wake()

    return () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      io.disconnect(); ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDbl)
    }
  }, [graph, palette]) // eslint-disable-line react-hooks/exhaustive-deps

  const selNode = useMemo(() => (graph && selected ? graph.byId.get(selected) : null), [graph, selected])
  const selLinks = useMemo(() => {
    if (!graph || !selected) return []
    const out = []
    for (const l of graph.links) {
      const other = l.s === selected ? l.t : l.t === selected ? l.s : null
      if (!other) continue
      const n = graph.byId.get(other)
      if (n && n.type !== 'core') out.push(n)
      if (out.length >= 10) break
    }
    return out
  }, [graph, selected])

  if (loading && !data) {
    return (
      <div className="bm bm--loading">
        <div className="sk bm-sk" style={{ height: 420 }} />
      </div>
    )
  }
  if (error && !data) {
    return (
      <div className="bm bm--error">
        The consciousness map could not load. <button type="button" onClick={refetch}>Retry</button>
      </div>
    )
  }
  const counts = data?.counts || {}
  const lint = data?.lint || []

  return (
    <div className="bm">
      <div className="bm-stage" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label="Brain consciousness map" />
      <div className="bm-bar">
        <div className="bm-stats">
          <span className="bm-stat"><b>{counts.nodes ?? '—'}</b> nodes</span>
          <span className="bm-stat"><b>{counts.links ?? '—'}</b> links</span>
          <span className="bm-stat"><b>{counts.wiki_pages ?? '—'}</b> wiki pages</span>
          {data?.generated_at && <span className="bm-stat bm-stat--dim">updated {ago(data.generated_at)} ago</span>}
        </div>
        <div className="bm-legend" role="group" aria-label="highlight a layer of the mind">
          {[
            ['organ', 'organ', 'Feeds', counts.organs],
            ['lens', 'lens', 'Lenses', counts.lenses],
            ['narrative', 'narrative', 'Narratives', counts.narratives],
            ['project', 'project', 'Projects', counts.projects],
            ['thesis', 'intel', 'Posts', counts.theses],
            ['news', 'intel', 'News', counts.news],
            ['intel', 'intel', 'Intel', counts.intel],
            ['pattern', 'pattern', 'Patterns', counts.patterns],
            ['signal', 'signal', 'Signals', counts.signals],
          ].map(([ty, dot, label, c]) => (
            <button
              key={ty} type="button"
              className={`bm-leg${typeSel.ty === ty ? ' bm-leg--on' : ''}`}
              aria-pressed={typeSel.ty === ty && typeSel.pinned}
              onMouseEnter={() => setTypeSel((s) => (s.pinned ? s : { ty, pinned: false }))}
              onMouseLeave={() => setTypeSel((s) => (s.pinned ? s : { ty: null, pinned: false }))}
              onClick={() => setTypeSel((s) => (s.ty === ty && s.pinned ? { ty: null, pinned: false } : { ty, pinned: true }))}
            >
              <i className={`bm-dot bm-dot--${dot}`} />{label} <b>{c}</b>
            </button>
          ))}
        </div>
        {lint.length > 0 && (
          <button type="button" className={`bm-audit${auditOpen ? ' bm-audit--open' : ''}`} onClick={() => setAuditOpen((v) => !v)}>
            <i className="bm-audit-dot" />Self-audit: {lint.length} open finding{lint.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {auditOpen && lint.length > 0 && (
        <div className="bm-audit-list">
          {lint.slice(0, 8).map((f, i) => (
            <button
              key={i} type="button"
              className={`bm-finding bm-finding--${f.severity}`}
              onClick={() => { if (f.slug && graph?.byId.has(f.slug)) select(f.slug) }}
            >
              <span className="bm-finding-kind">{f.kind}</span>
              <span className="bm-finding-text">{f.finding}</span>
            </button>
          ))}
        </div>
      )}

          {feed.length > 0 && (
            <div className="bm-stream" aria-label="stream of consciousness">
              <span className="bm-stream-tag">stream of consciousness</span>
              {feed.slice(0, 7).map((e) => {
                const ln = streamLine(e)
                const target = (graph?.byId?.has(e.id) ? e.id : null) || (e.sym && graph?.byId?.has(`project:${e.sym.toLowerCase()}`) ? `project:${e.sym.toLowerCase()}` : null)
                return (
                  <button
                    key={e.id} type="button" className="bm-stream-row"
                    onClick={() => { if (target) select(target) }}
                    disabled={!target}
                  >
                    <span className="bm-stream-ts">{tsHHMM(e.ts)}</span>
                    <span className={`bm-stream-chip${ln.tone ? ` bm-stream-chip--${ln.tone}` : ''}`}>{ln.chip}</span>
                    <span className="bm-stream-text">{ln.text}</span>
                  </button>
                )
              })}
            </div>
          )}
          {(regimeLive || data?.core?.regime) && (
            <div className="bm-regime">
              <i className="bm-regime-dot" aria-hidden />
              <span className="bm-regime-k">The read</span>
              <span className="bm-regime-text">{regimeLive || data.core.regime}</span>
            </div>
          )}
          {hoverInfo && !selNode && (
            <div className="bm-tip" style={{ left: Math.min(hoverInfo.x + 14, 9999), top: hoverInfo.y + 12 }}>
              <span className="bm-tip-type">{TYPE_LABEL[hoverInfo.node.type]}</span>
              <span className="bm-tip-label">{hoverInfo.node.type === 'project' ? `$${hoverInfo.node.label}` : hoverInfo.node.label}</span>
              {hoverInfo.node.meta?.mcap && <span className="bm-tip-sub">{fmtCap(hoverInfo.node.meta.mcap)}{hoverInfo.node.meta.altitude === 'micro' ? ' · attention play' : ''}</span>}
            </div>
          )}
          <div className="bm-hint">drag to pan · scroll to zoom · click a body · double-click to reset</div>

        {selNode && (
          <aside className="bm-dossier">
            <div className="bm-d-head">
              <span className="bm-d-type">{TYPE_LABEL[selNode.type] || selNode.type}</span>
              <button type="button" className="bm-d-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <h3 className="bm-d-title">{selNode.type === 'project' ? `$${selNode.label}` : selNode.label}</h3>

            {selNode.type === 'project' && (
              <div className="bm-d-cells">
                {selNode.meta?.mcap != null && (
                  <div className="bm-d-cell"><span>Size</span><b>{fmtCap(selNode.meta.mcap)}{selNode.meta.altitude === 'micro' ? ' · attention play' : ''}</b></div>
                )}
                {Number.isFinite(selNode.meta?.chg24) && (
                  <div className="bm-d-cell"><span>24h</span><b className={selNode.meta.chg24 >= 0 ? 'bm-up' : 'bm-down'}>{selNode.meta.chg24 >= 0 ? '+' : ''}{selNode.meta.chg24.toFixed(1)}%</b></div>
                )}
                {selNode.meta?.record?.n > 0 && (
                  <div className="bm-d-cell"><span>Desk record 7d</span><b>{selNode.meta.record.hit24 ?? '—'}% hit · {selNode.meta.record.n} graded</b></div>
                )}
                {selNode.meta?.intel && (
                  <div className="bm-d-cell"><span>Intel</span><b>{selNode.meta.intel.n_facts} facts · ×{selNode.meta.intel.obs} observed</b></div>
                )}
                {selNode.meta?.theses_48h > 0 && (
                  <div className="bm-d-cell"><span>Trader theses 48h</span><b>{selNode.meta.theses_48h}</b></div>
                )}
              </div>
            )}
            {selNode.type === 'narrative' && (
              <div className="bm-d-cells">
                <div className="bm-d-cell"><span>Theses 48h</span><b>{selNode.meta?.n_theses}</b></div>
                <div className="bm-d-cell"><span>Stance</span><b>{selNode.meta?.bulls} bull / {selNode.meta?.bears} bear</b></div>
                <div className="bm-d-cell"><span>Avg conviction</span><b>{selNode.meta?.conviction}</b></div>
              </div>
            )}
            {selNode.type === 'pattern' && (
              <div className="bm-d-cells">
                <div className="bm-d-cell"><span>Sample</span><b>n={selNode.meta?.n}</b></div>
                <div className="bm-d-cell"><span>Hit rate</span><b>{selNode.meta?.hit_rate_pct}%</b></div>
                {selNode.meta?.avg_pnl_pct != null && <div className="bm-d-cell"><span>Avg pnl</span><b>{selNode.meta.avg_pnl_pct}%</b></div>}
              </div>
            )}
            {selNode.type === 'intel' && (
              <div className="bm-d-cells">
                <div className="bm-d-cell"><span>Category</span><b>{selNode.meta?.category}</b></div>
                <div className="bm-d-cell"><span>Reinforced</span><b>×{selNode.meta?.obs}{selNode.meta?.official ? ' · official source' : ''}</b></div>
              </div>
            )}
            {selNode.type === 'signal' && (
              <div className="bm-d-cells">
                <div className="bm-d-cell"><span>Detector</span><b>{selNode.meta?.detector}</b></div>
                {selNode.meta?.graded != null && <div className="bm-d-cell"><span>Graded</span><b className={selNode.meta.graded ? 'bm-up' : 'bm-down'}>{selNode.meta.graded ? 'hit' : 'miss'}</b></div>}
              </div>
            )}
            {selNode.type === 'lesson' && selNode.meta?.watch && (
              <p className="bm-d-note"><b>Watch next time:</b> {selNode.meta.watch}</p>
            )}
            {selNode.type === 'organ' && (
              <div className="bm-d-cells">
                <div className="bm-d-cell"><span>24h volume</span><b>{selNode.meta?.vol_24h?.toLocaleString?.('en-US') ?? '—'} readings</b></div>
                <div className="bm-d-cell"><span>Freshness</span><b className={selNode.meta?.healthy ? 'bm-up' : 'bm-down'}>{selNode.fresh_h != null ? `${selNode.fresh_h}h ago` : 'unknown'}{selNode.meta?.healthy ? '' : ' · stale'}</b></div>
              </div>
            )}
            {selNode.type === 'lens' && (
              <div className="bm-d-cells">
                <div className="bm-d-cell"><span>Stances 14d</span><b>{selNode.meta?.n_stances_14d}</b></div>
                <div className="bm-d-cell"><span>Hit 24h</span><b>{selNode.meta?.hit24 ?? '—'}%</b></div>
                {selNode.meta?.ev24 != null && <div className="bm-d-cell"><span>Expectancy</span><b className={selNode.meta.ev24 >= 0 ? 'bm-up' : 'bm-down'}>{selNode.meta.ev24 >= 0 ? '+' : ''}{selNode.meta.ev24}%</b></div>}
              </div>
            )}
            {selNode.type === 'thesis' && (
              <>
                {selNode.meta?.thesis && <p className="bm-d-note">&ldquo;{selNode.meta.thesis}&rdquo;</p>}
                <div className="bm-d-cells">
                  {selNode.meta?.stance && <div className="bm-d-cell"><span>Stance</span><b className={selNode.meta.stance === 'bull' ? 'bm-up' : selNode.meta.stance === 'bear' ? 'bm-down' : ''}>{selNode.meta.stance}{selNode.meta.conviction ? ` · conv ${selNode.meta.conviction}` : ''}</b></div>}
                  {selNode.meta?.followers && <div className="bm-d-cell"><span>Reach</span><b>{selNode.meta.followers.toLocaleString('en-US')} followers{selNode.meta.emerging ? ' · emerging alpha' : ''}</b></div>}
                </div>
              </>
            )}
            {selNode.type === 'news' && (
              <div className="bm-d-cells">
                {selNode.meta?.source && <div className="bm-d-cell"><span>Source</span><b>{selNode.meta.source}</b></div>}
                {selNode.meta?.importance != null && <div className="bm-d-cell"><span>Importance</span><b>{selNode.meta.importance}</b></div>}
                {selNode.fresh_h != null && <div className="bm-d-cell"><span>Age</span><b>{selNode.fresh_h}h</b></div>}
              </div>
            )}
            {selNode.type === 'world' && selNode.meta && (
              <div className="bm-d-cells">
                {Object.entries(selNode.meta).slice(0, 5).map(([k, v]) => (
                  (typeof v === 'string' || typeof v === 'number') ? (
                    <div className="bm-d-cell" key={k}><span>{k.replace(/_/g, ' ')}</span><b>{String(v).slice(0, 40)}</b></div>
                  ) : null
                ))}
              </div>
            )}

            {selNode.flags?.length > 0 && (
              <div className="bm-d-flags">
                {selNode.flags.map((f, i) => (
                  <p key={i} className="bm-d-flag"><span>{f.kind}</span>{f.finding}</p>
                ))}
              </div>
            )}

            {selLinks.length > 0 && (
              <div className="bm-d-linked">
                <span className="bm-d-linked-tag">Connected</span>
                <div className="bm-d-chips">
                  {selLinks.map((n) => (
                    <button key={n.id} type="button" className="bm-d-chip" onClick={() => select(n.id)}>
                      {n.type === 'project' ? `$${n.label}` : n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
