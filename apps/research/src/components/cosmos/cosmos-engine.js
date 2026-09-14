/**
 * cosmos-engine.js — the Spectre Cosmos renderer.
 *
 * A cinematic WebGL universe (vanilla three.js, no R3F): the market leader
 * burns at the center as a sun; every other token is a planet whose orbit
 * distance is its PERFORMANCE (gainers spiral toward the light, losers drift
 * into the outer dark), whose size is market cap, and whose glow color is
 * direction. Three morphing layouts (solar 3D / flat map / ecosystem galaxy),
 * an inertial camera rig (orbit / pan / dolly, fly-to focus, cinematic
 * auto-drift), and sprite-based rendering with the shared logo atlas.
 *
 * three is imported only here + atlas.js → the whole engine lives in the lazy
 * vendor-three chunk. The Cosmos view lazy-loads it, so three never touches
 * the app boot path (check-critical-path guards this).
 *
 * Body positions live entirely inside the engine — React never re-renders per
 * frame. The view talks to the engine through an imperative handle:
 *   setData({sun,bodies,groups}) · setView('solar'|'map'|'galaxy')
 *   focusBody(id|null) · setCinematic(b) · setSpeed(x) · setDayMode(b)
 *   setLinks(pairs) · setRunning(b) · resetCamera() · resize() · dispose()
 * and listens via callbacks: onHover(body|null, x, y) · onSelect(body|null).
 *
 * Hierarchical orbits: a body with `parentId` is a MOON — it runs the same
 * orbit math but centered on its parent's live position instead of the sun.
 * Parents tick first (setData orders parentless bodies ahead), so drag,
 * galaxy morphing and camera work carry the whole swarm for free. Data with
 * no parentId behaves exactly as before.
 */
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Sprite, SpriteMaterial,
  CanvasTexture, SRGBColorSpace, LinearFilter, Color, FogExp2,
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Points,
  PointsMaterial, LineBasicMaterial, Line, LineLoop, LineSegments,
  AdditiveBlending, NormalBlending, Vector3, MathUtils,
} from 'three'
import { getLogoTexture } from '@/components/constellation/atlas'
import { WORLD, orbitForChange, hash01 } from './cosmos-data'

// CoinGecko's image CDN 503s CORS-mode requests when the URL carries the
// `?timestamp` cache-buster, but serves CORS-clean without it. Canvas
// textures need CORS-clean pixels, so strip the query before the atlas load.
const cleanLogoUrl = (src) => (src ? String(src).split('?')[0] : src)

/* ══════════════════ procedural textures (module-cached) ══════════════════ */
const _texCache = new Map()

function canvasTex(key, size, draw) {
  if (_texCache.has(key)) return _texCache.get(key)
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d'), size)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  _texCache.set(key, tex)
  return tex
}

const glowTex = () => canvasTex('glow', 128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

const coreTex = () => canvasTex('core', 256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,240,1)')
  g.addColorStop(0.18, 'rgba(255,238,180,1)')
  g.addColorStop(0.45, 'rgba(255,190,70,0.85)')
  g.addColorStop(0.75, 'rgba(255,130,20,0.28)')
  g.addColorStop(1, 'rgba(255,110,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

const ringTex = () => canvasTex('ring', 128, (ctx, s) => {
  // hairline outer rim + soft inner halo — finer than the old flat stroke
  ctx.strokeStyle = 'rgba(255,255,255,1)'
  ctx.lineWidth = s * 0.018
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s * 0.455, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = s * 0.05
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s * 0.415, 0, Math.PI * 2)
  ctx.stroke()
})

/* shared glass overlay for every chip: top-left specular crescent, hairline
   rim light, soft bottom shade — the 3D-orb feel of the classic bubbles */
const glassTex = () => canvasTex('glass', 128, (ctx, s) => {
  ctx.save()
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2)
  ctx.clip()
  // specular crescent
  const spec = ctx.createRadialGradient(s * 0.34, s * 0.26, 0, s * 0.42, s * 0.36, s * 0.62)
  spec.addColorStop(0, 'rgba(255,255,255,0.42)')
  spec.addColorStop(0.35, 'rgba(255,255,255,0.10)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = spec
  ctx.fillRect(0, 0, s, s)
  // bottom depth shade
  const shade = ctx.createRadialGradient(s * 0.5, s * 0.88, 0, s * 0.5, s * 0.72, s * 0.6)
  shade.addColorStop(0, 'rgba(0,0,0,0.30)')
  shade.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, s, s)
  ctx.restore()
  // hairline rim light
  ctx.strokeStyle = 'rgba(255,255,255,0.34)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s / 2 - 1.6, -Math.PI * 0.85, -Math.PI * 0.1)
  ctx.stroke()
})

const starTex = () => canvasTex('star', 32, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.4)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

/* day-mode sky: a soft radial paper gradient instead of a flat dead grey */
const dayBgTex = () => canvasTex('daybg', 512, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s * 0.42, s * 0.05, s / 2, s / 2, s * 0.75)
  g.addColorStop(0, '#fbfcfe')
  g.addColorStop(0.45, '#f2f4f9')
  g.addColorStop(1, '#e2e7f0')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

function nebulaTex(seedKey, rgb) {
  return canvasTex(`neb:${seedKey}`, 256, (ctx, s) => {
    // a few soft blobs blended into one wisp
    for (let i = 0; i < 5; i++) {
      const h = hash01(seedKey + i)
      const h2 = hash01(seedKey + i + 'b')
      const x = s * (0.28 + h * 0.44)
      const y = s * (0.28 + h2 * 0.44)
      const r = s * (0.2 + h * 0.28)
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.16)`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    }
  })
}

/* sector star: colored disc carrying its world count */
function sectorChipTex(key, count, rgb) {
  return canvasTex(`sector:${key}:${count}`, 128, (ctx, s) => {
    ctx.beginPath()
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2)
    const g = ctx.createRadialGradient(s * 0.35, s * 0.35, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`)
    g.addColorStop(1, `rgba(${Math.round(rgb[0] * 0.3)},${Math.round(rgb[1] * 0.3)},${Math.round(rgb[2] * 0.3)},0.65)`)
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`
    ctx.lineWidth = 3.5
    ctx.stroke()
    ctx.fillStyle = 'rgba(245,245,247,0.98)'
    ctx.font = `700 ${s * 0.4}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(count), s / 2, s / 2 - 6)
    ctx.font = `600 ${s * 0.14}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.fillStyle = 'rgba(245,245,247,0.6)'
    ctx.fillText('WORLDS', s / 2, s / 2 + s * 0.22)
  })
}

function fallbackChipTex(sym, rgb) {
  const letter = (sym || '?')[0]
  return canvasTex(`chip:${sym}`, 128, (ctx, s) => {
    ctx.beginPath()
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2)
    const g = ctx.createLinearGradient(0, 0, s, s)
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.34)`)
    g.addColorStop(1, `rgba(${Math.round(rgb[0] * 0.4)},${Math.round(rgb[1] * 0.4)},${Math.round(rgb[2] * 0.4)},0.5)`)
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.8)`
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = 'rgba(245,245,247,0.95)'
    ctx.font = `700 ${s * 0.44}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(letter, s / 2, s / 2 + 2)
  })
}

/* compact USD for canvas labels (dossier shows precise localized values) */
function fmtUsdShort(v) {
  const n = Number(v) || 0
  if (!n) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toPrecision(3)}`
}

function labelTex(sym, changeStr, positive, day, tone) {
  const key = `lbl:${sym}:${changeStr}:${day ? 'd' : 'n'}:${tone || (positive ? 'p' : 'n')}`
  if (_texCache.has(key)) return _texCache.get(key)
  // labels are keyed by their text, so long sessions accumulate stale ones —
  // evict the label slice of the cache when it grows past ~600 entries
  if (_texCache.size > 600) {
    for (const k of _texCache.keys()) {
      if (k.startsWith('lbl:')) { _texCache.get(k).dispose(); _texCache.delete(k) }
    }
  }
  // 512×144 = the old 256×72 at 2x density (same aspect, so the sprite scale
  // code is untouched): label text was the most visible pixelation on phones
  const c = document.createElement('canvas')
  const W = 512, H = 144
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.textAlign = 'center'
  const ink = day ? 'rgba(15,23,42,0.92)' : 'rgba(245,245,247,0.95)'
  if (!day) {
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 12
  }
  ctx.fillStyle = ink
  // long titles (names, sector labels) shrink to fit the canvas
  const size = (sym.length > 14 ? 20 : sym.length > 9 ? 25 : 30) * 2
  ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.fillText(sym, W / 2, 64)
  ctx.font = '600 48px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillStyle = tone === 'social'
    ? (day ? 'rgba(14,116,144,0.95)' : 'rgba(155,233,255,0.95)')
    : positive
      ? (day ? 'rgba(5,150,105,0.95)' : 'rgba(52,211,153,0.95)')
      : (day ? 'rgba(220,38,38,0.95)' : 'rgba(248,113,113,0.95)')
  ctx.fillText(changeStr, W / 2, 124)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  _texCache.set(key, tex)
  return tex
}

/* ══════════════════ view presets ══════════════════ */
const VIEWS = {
  solar:  { pitch: 0.46, dist: 235, panLock: false },
  map:    { pitch: 1.48, dist: 265, panLock: true },
  galaxy: { pitch: 0.62, dist: 340, panLock: false },
}
const NIGHT_BG = 0x020207
const DAY_BG = 0xeef1f6

const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5)
const _SUN_POS = new Vector3(0, 0, 0)

export class CosmosEngine {
  constructor(container, opts = {}) {
    this.container = container
    this.opts = opts
    this.onHover = opts.onHover || (() => {})
    this.onSelect = opts.onSelect || (() => {})
    this.isMobile = !!opts.isMobile
    this.reducedMotion = !!opts.reducedMotion
    this.dayMode = !!opts.dayMode

    this.time = 0       // orbital clock — scaled by speedMul (0 under reduced motion)
    this.wall = 0       // wall clock — always advances (spawn animations)
    this.speedMul = this.reducedMotion ? 0 : 1
    this.cinematic = false
    this.running = true
    this.viewMode = 'solar'
    this.inclineMul = 1        // 1 in solar, 0 in map (tweened)
    this.galaxyMix = 0         // 0 orbital layouts, 1 galaxy layout (tweened)
    this._raf = null
    this._lastT = performance.now()
    this._tweens = []
    this._bodies = []
    this._bodyById = new Map()
    this._sun = null
    this._groups = []
    this._hovered = null
    this._focused = null
    this._social = null
    this._comets = []
    this._cometById = new Map()
    this.labelMode = opts.labelMode || 'change'

    // restore a previous session's view (fullscreen remounts a fresh engine)
    if (opts.initialView && VIEWS[opts.initialView]) {
      this.viewMode = opts.initialView
      this.inclineMul = opts.initialView === 'map' ? 0 : 1
      this.galaxyMix = opts.initialView === 'galaxy' ? 1 : 0
    }

    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)

    this.scene = new Scene()
    this.scene.background = new Color(this.dayMode ? DAY_BG : NIGHT_BG)
    this.scene.fog = new FogExp2(this.dayMode ? DAY_BG : NIGHT_BG, this.dayMode ? 0.0006 : 0.0011)

    this.camera = new PerspectiveCamera(52, w / h, 0.5, 4000)

    // GPU-thermals budget (dev Macs were heating up):
    // - antialias OFF — a sprite-only scene gains nothing from MSAA (every
    //   edge is an alpha-textured quad), but pays its full fill cost
    // - DPR capped at 1.5 (was 2): 44% fewer pixels on retina; a glow field
    //   reads identically and logos stay sharp at 1.5
    // - no preserveDrawingBuffer — it forces a buffer copy EVERY frame on
    //   Mac; snapshot() does its own synchronous render + readback in one
    //   task, which is safe on a visible tab (hidden tabs are black anyway)
    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    // ADAPTIVE resolution (2026-07-13 mobile fix): the fixed 1.25 mobile cap
    // read visibly pixelated on dpr-3 phones. Start at 1.5 and let the frame
    // governor step UP to 2.0 when the device proves it has headroom, DOWN to
    // 1.0 when it can't hold the frame budget — sharp where affordable, fluid
    // where not. Desktop keeps its 1.5 thermals cap.
    this._dprSteps = [1, 1.25, 1.5, 1.75, 2]
      .filter((v) => v <= Math.min(window.devicePixelRatio || 1, this.isMobile ? 2 : 1.5))
    if (!this._dprSteps.length) this._dprSteps = [Math.min(window.devicePixelRatio || 1, 1)]
    this._dprIdx = this._dprSteps.reduce((best, v, i) => (v <= 1.5 ? i : best), 0)
    this._renderMsEma = 8
    this._dprFrames = 0
    // idle cruise floor: mobile drifts at ~30fps (slow orbits read identical,
    // ~25% less GPU), desktop ~40fps; interaction/tweens always run uncapped
    this._cruiseMs = this.isMobile ? 33 : 24
    this._gapEma = 16
    this._lastRenderAt = 0
    this.renderer.setPixelRatio(this._dprSteps[this._dprIdx])
    this.renderer.setSize(w, h)
    this.renderer.domElement.className = 'cosmos-canvas'
    container.appendChild(this.renderer.domElement)

    // Context-loss recovery: the browser can evict our context under GPU
    // pressure (other WebGL tabs, mobile Safari, GPU reset). preventDefault
    // tells three.js a restore is coming (it recompiles programs itself);
    // without these handlers the loop keeps "rendering" into a dead context
    // and the universe stays permanently black until a full remount.
    this._onCtxLost = (e) => { e.preventDefault(); this.setRunning(false) }
    this._onCtxRestored = () => { this.setRunning(true); this._kick?.() }
    this.renderer.domElement.addEventListener('webglcontextlost', this._onCtxLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onCtxRestored, false)

    // camera rig state (spherical around a target)
    const preset = VIEWS[this.viewMode]
    const skipIntro = this.reducedMotion || opts.skipIntro
    this.rig = {
      target: new Vector3(0, 0, 0),
      yaw: this.viewMode === 'map' ? 0 : -0.6,
      pitch: preset.pitch + (skipIntro ? 0 : 0.3),
      dist: skipIntro ? preset.dist : preset.dist * 1.9,
      yawVel: 0, pitchVel: 0,
      panVel: new Vector3(),
    }

    this._buildBackdrop()
    this._buildSunVisual()
    this._buildGuideRings()
    this._buildBelt()
    this._buildShootingStars()
    if (this.dayMode) this._applyDayLook()

    this._bindInput()

    // cinematic intro flight
    if (!skipIntro) {
      this._tween(this.rig, { pitch: preset.pitch, dist: preset.dist, yaw: this.viewMode === 'map' ? 0 : 0.12 }, 2.0)
    }

    this._onVis = () => { if (!document.hidden) this._kick() }
    document.addEventListener('visibilitychange', this._onVis)
    this._kick()
  }

  /* ── backdrop: starfield layers + nebulas + dust ── */
  _buildBackdrop() {
    this.backdrop = new Group()
    const mkStars = (count, rMin, rMax, size, opacity) => {
      const pos = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        // random point on a shell
        const u = Math.random() * 2 - 1
        const th = Math.random() * Math.PI * 2
        const r = rMin + Math.random() * (rMax - rMin)
        const s = Math.sqrt(1 - u * u)
        pos[i * 3] = s * Math.cos(th) * r
        pos[i * 3 + 1] = u * r * 0.7
        pos[i * 3 + 2] = s * Math.sin(th) * r
      }
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(pos, 3))
      const mat = new PointsMaterial({
        size, map: starTex(), transparent: true, opacity,
        depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
        color: 0xcdd6ff,
      })
      const pts = new Points(geo, mat)
      pts.userData.baseOpacity = opacity
      this.backdrop.add(pts)
      return pts
    }
    this._starsFar = mkStars(this.isMobile ? 500 : 1100, 700, 1400, 3.2, 0.75)
    this._starsNear = mkStars(this.isMobile ? 160 : 380, 300, 650, 5.5, 0.5)

    this._nebulas = []
    const nebs = [
      ['nebA', [96, 110, 200], 620, [-420, -80, -560]],
      ['nebB', [40, 140, 160], 540, [500, 60, -420]],
      ['nebC', [200, 140, 80], 480, [80, -140, 620]],
    ]
    for (const [key, rgb, size, p] of nebs) {
      // additive nebulas are pure fill cost — on mobile shave the quad area
      // ~28% and a touch of opacity; the sky reads the same on a phone panel
      const m = new SpriteMaterial({
        map: nebulaTex(key, rgb), transparent: true, opacity: this.isMobile ? 0.42 : 0.5,
        depthWrite: false, blending: AdditiveBlending,
      })
      const sp = new Sprite(m)
      const ns = this.isMobile ? size * 0.85 : size
      sp.scale.set(ns, ns, 1)
      sp.position.set(p[0], p[1], p[2])
      this._nebulas.push(sp)
      this.backdrop.add(sp)
    }
    this.scene.add(this.backdrop)
  }

  /* ── the sun (visual shell; chip texture set in setData) ── */
  _buildSunVisual() {
    this.sunGroup = new Group()
    const R = WORLD.sunRadius

    const mk = (tex, scale, opacity, color) => {
      const m = new SpriteMaterial({
        map: tex, transparent: true, opacity,
        depthWrite: false, blending: AdditiveBlending,
        color: color != null ? new Color(color) : new Color(0xffffff),
      })
      const s = new Sprite(m)
      s.scale.set(scale, scale, 1)
      this.sunGroup.add(s)
      return s
    }
    // corona quads cover a big slice of the screen when zoomed — mobile gets
    // a slightly tighter fire (area −30%), same silhouette
    this._sunCorona = mk(glowTex(), R * (this.isMobile ? 7.5 : 9), 0.46, 0xff9a2a)
    this._sunMid = mk(glowTex(), R * (this.isMobile ? 4.5 : 5.2), 0.75, 0xffc75e)
    this._sunCore = mk(coreTex(), R * 3.0, 1)

    // the leader's logo, riding inside the fire
    this._sunChipMat = new SpriteMaterial({ map: null, transparent: true, opacity: 0 })
    this._sunChip = new Sprite(this._sunChipMat)
    this._sunChip.scale.set(R * 1.5, R * 1.5, 1)
    this._sunChip.userData.isSun = true
    this.sunGroup.add(this._sunChip)

    this.scene.add(this.sunGroup)
  }

  /* ── orbit guide rings (solar/map) ── */
  _buildGuideRings() {
    this.ringsGroup = new Group()
    const mkRing = (r, opacity) => {
      const seg = 128
      const pos = new Float32Array(seg * 3)
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2
        pos[i * 3] = Math.cos(a) * r
        pos[i * 3 + 2] = Math.sin(a) * r
      }
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(pos, 3))
      const mat = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false })
      const ring = new LineLoop(geo, mat)
      ring.userData.baseOpacity = opacity
      this.ringsGroup.add(ring)
      return ring
    }
    mkRing(WORLD.minOrbit + 8, 0.05)
    mkRing(WORLD.neutralOrbit * 0.68, 0.04)
    this._neutralRing = mkRing(WORLD.neutralOrbit, 0.075) // the ±0% frontier
    mkRing((WORLD.neutralOrbit + WORLD.maxOrbit) / 2, 0.04)
    mkRing(WORLD.maxOrbit, 0.05)
    this.scene.add(this.ringsGroup)

    // focused body's own orbit path (hidden until focus)
    {
      const seg = 160
      const pos = new Float32Array(seg * 3)
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(pos, 3))
      this._focusRingGeo = geo
      this._focusRing = new LineLoop(geo, new LineBasicMaterial({
        color: 0xf5f5f7, transparent: true, opacity: 0, depthWrite: false,
      }))
      this.scene.add(this._focusRing)
    }

    // galaxy constellation lines (rebuilt in _rebuildGalaxyLines)
    this._galaxyLines = null
  }

  _rebuildGalaxyLines() {
    if (this._galaxyLines) {
      this.scene.remove(this._galaxyLines)
      this._galaxyLines.geometry.dispose()
      this._galaxyLines.material.dispose()
      this._galaxyLines = null
    }
    if (!this._groups.length) return
    // connect each cluster member to its hub neighbor chain (star-sign feel):
    // hub-nearest chain = sort members by local phase and link consecutive ones,
    // plus every 4th member back to the cluster's first (spokes).
    const verts = []
    const cols = []
    for (const g of this._groups) {
      const members = g.members.map(i => this._bodies[i]).filter(Boolean)
      if (members.length < 2) continue
      const c = g.color
      for (let i = 0; i < members.length - 1; i++) {
        const a = members[i], b = members[i + 1]
        verts.push(a._pos.x, a._pos.y, a._pos.z, b._pos.x, b._pos.y, b._pos.z)
        for (let k = 0; k < 2; k++) cols.push(c[0] / 255, c[1] / 255, c[2] / 255)
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(verts, 3))
    geo.setAttribute('color', new Float32BufferAttribute(cols, 3))
    this._galaxyLines = new LineSegments(geo, new LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: AdditiveBlending,
    }))
    this.scene.add(this._galaxyLines)
  }

  /* ── asteroid belt: dust at the gain/loss frontier ── */
  _buildBelt() {
    const count = this.isMobile ? 240 : 520
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = WORLD.neutralOrbit + (Math.random() - 0.5) * 9
      pos[i * 3] = Math.cos(a) * r
      pos[i * 3 + 1] = (Math.random() - 0.5) * 2.4
      pos[i * 3 + 2] = Math.sin(a) * r
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    this._belt = new Points(geo, new PointsMaterial({
      size: 1.6, map: starTex(), transparent: true, opacity: 0.4,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
      color: 0xaab4cc,
    }))
    this.scene.add(this._belt)
  }

  /* ── shooting stars: rare background streaks ── */
  _buildShootingStars() {
    this._streaks = []
    for (let s = 0; s < 2; s++) {
      const group = new Group()
      const parts = []
      for (let i = 0; i < 7; i++) {
        const m = new SpriteMaterial({
          map: glowTex(), transparent: true, opacity: 0,
          depthWrite: false, blending: AdditiveBlending, color: 0xdfe8ff,
        })
        const sp = new Sprite(m)
        const scale = 7 - i * 0.8
        sp.scale.set(scale, scale, 1)
        group.add(sp)
        parts.push(sp)
      }
      group.visible = false
      this.scene.add(group)
      this._streaks.push({ group, parts, active: false, t: 0, nextAt: 4 + s * 5 + Math.random() * 6, from: new Vector3(), dir: new Vector3() })
    }
  }

  _updateStreaks(dt) {
    if (this.dayMode || this.reducedMotion) return
    for (const st of this._streaks) {
      if (!st.active) {
        if (this.wall >= st.nextAt) {
          st.active = true
          st.t = 0
          st.group.visible = true
          const yaw = Math.random() * Math.PI * 2
          st.from.set(Math.cos(yaw) * 520, 120 + Math.random() * 220, Math.sin(yaw) * 520)
          st.dir.set(Math.cos(yaw + 2.2), -0.55 - Math.random() * 0.4, Math.sin(yaw + 2.2)).normalize()
        }
        continue
      }
      st.t += dt
      const life = 1.3
      const k = st.t / life
      if (k >= 1) {
        st.active = false
        st.group.visible = false
        st.nextAt = this.wall + 6 + Math.random() * 9
        continue
      }
      const head = st.from.clone().addScaledVector(st.dir, k * 620)
      const fade = Math.sin(k * Math.PI)
      st.parts.forEach((sp, i) => {
        const back = i * 6.5
        sp.position.copy(head).addScaledVector(st.dir, -back)
        sp.material.opacity = fade * (0.7 - i * 0.09)
      })
    }
  }

  /* ══════════════════ social layer (X Dash) ══════════════════ */
  setSocial(payload) {
    this._social = payload || null
    this._applySocial()
    this._kick()
  }

  /* generic body↔body relationship lines (X Bubbles co-mention edges):
     pairs = [{a: bodyId, b: bodyId, w: 0..1, color?: [r,g,b]}]. One
     LineSegments for the whole set — vertices chase the live positions in
     the frame loop, weight drives per-edge brightness. */
  setLinks(pairs) {
    this._linkPairsRaw = Array.isArray(pairs) ? pairs : []
    this._applyLinks()
    this._kick()
  }

  _applyLinks() {
    if (this._linkLines) {
      this.scene.remove(this._linkLines)
      this._linkLines.geometry.dispose()
      this._linkLines.material.dispose()
      this._linkLines = null
    }
    this._linkPairs = []
    const verts = []
    const cols = []
    for (const p of this._linkPairsRaw || []) {
      const a = this._bodyById.get(p.a)
      const b = this._bodyById.get(p.b)
      if (!a || !b) continue
      const w = MathUtils.clamp(p.w ?? 0.5, 0, 1)
      this._linkPairs.push({ a, b })
      verts.push(a._pos.x, a._pos.y, a._pos.z, b._pos.x, b._pos.y, b._pos.z)
      const c = p.color || [125, 211, 252]
      const f = 0.25 + w * 0.75
      for (let k = 0; k < 2; k++) cols.push((c[0] / 255) * f, (c[1] / 255) * f, (c[2] / 255) * f)
    }
    if (!verts.length) return
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(verts, 3))
    geo.setAttribute('color', new Float32BufferAttribute(cols, 3))
    this._linkLines = new LineSegments(geo, new LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: this.dayMode ? NormalBlending : AdditiveBlending,
    }))
    this._linkLines.frustumCulled = false
    this.scene.add(this._linkLines)
  }

  _applySocial() {
    const social = this._social
    // 1 — auras on in-universe planets
    const auraById = new Map((social?.auras || []).map(a => [a.id, a]))
    for (const b of this._bodies) {
      const aura = auraById.get(b.id)
      b._social = aura || null
      if (aura && !b._aura) {
        const ring = new Sprite(new SpriteMaterial({
          map: ringTex(), transparent: true, depthWrite: false,
          blending: AdditiveBlending, color: 0x67e8f9, opacity: 0,
        }))
        const wave = new Sprite(new SpriteMaterial({
          map: ringTex(), transparent: true, depthWrite: false,
          blending: AdditiveBlending, color: 0x67e8f9, opacity: 0,
        }))
        b._node.add(ring)
        b._node.add(wave)
        b._aura = ring
        b._auraWave = wave
      } else if (!aura && b._aura) {
        b._node.remove(b._aura); b._aura.material.dispose()
        b._node.remove(b._auraWave); b._auraWave.material.dispose()
        b._aura = null; b._auraWave = null
      }
    }

    // 2 — comets for trending tokens beyond the map
    const rows = social?.comets || []
    const nextIds = new Set(rows.map(c => c.id))
    for (const [id, c] of this._cometById) {
      if (!nextIds.has(id)) {
        this.scene.remove(c._node)
        this._disposeNode(c._node)
        // Tail sprites are parented to the SCENE, not c._node, so _disposeNode
        // misses them — remove + dispose each or they linger as frozen streaks
        // (and leak SpriteMaterials) until the next full unmount.
        if (Array.isArray(c._tail)) {
          for (const sp of c._tail) {
            this.scene.remove(sp)
            if (sp.material && !sp.material._shared) sp.material.dispose()
          }
          c._tail = []
        }
        this._cometById.delete(id)
      }
    }
    for (const row of rows) {
      let c = this._cometById.get(row.id)
      if (!c) {
        c = { ...row }
        const node = new Group()
        // coma — the bright envelope around the head
        const coma = new Sprite(new SpriteMaterial({
          map: glowTex(), transparent: true, depthWrite: false,
          blending: AdditiveBlending, color: 0x9be9ff, opacity: 0.85,
        }))
        coma.scale.set(13, 13, 1)
        node.add(coma)
        // head — the token's logo riding the comet
        const chipMat = new SpriteMaterial({ map: null, transparent: true })
        const chip = new Sprite(chipMat)
        chip.scale.set(5.4, 5.4, 1)
        node.add(chip)
        // label
        const label = new Sprite(new SpriteMaterial({ map: null, transparent: true, depthWrite: false }))
        node.add(label)
        c._node = node
        c._chip = chip
        c._coma = coma
        c._label = label
        c._pos = new Vector3()
        c._trail = []
        // tail sprites reuse the glow texture, faded along the history
        const TAIL = this.isMobile ? 12 : 20
        c._tail = []
        for (let i = 0; i < TAIL; i++) {
          const m = new SpriteMaterial({
            map: glowTex(), transparent: true, opacity: 0,
            depthWrite: false, blending: AdditiveBlending, color: 0x7dd8ff,
          })
          const sp = new Sprite(m)
          this.scene.add(sp)
          c._tail.push(sp)
        }
        node.userData.body = c
        this.scene.add(node)
        this._cometById.set(row.id, c)
      } else {
        // refresh social numbers on an existing comet
        Object.assign(c, row, { _node: c._node, _chip: c._chip, _coma: c._coma, _label: c._label, _pos: c._pos, _trail: c._trail, _tail: c._tail, _theta: c._theta })
      }
      c._theta = c._theta ?? c.ellipse.theta
      // visuals
      const setChip = (tex) => { c._chip.material.map = tex; c._chip.material.needsUpdate = true }
      if (c.token.logo) {
        const src = cleanLogoUrl(c.token.logo)
        const tex = getLogoTexture(src, () => { const t2 = getLogoTexture(src); if (t2) setChip(t2) })
        setChip(tex || fallbackChipTex(c.id, [125, 216, 255]))
      } else {
        setChip(fallbackChipTex(c.id, [125, 216, 255]))
      }
      c._label.material.map = labelTex(`${c.id} ☄`, `${c.mentions} mentions`, true, this.dayMode)
      c._label.material.needsUpdate = true
      c._label.visible = this.labelMode !== 'off'
      const clh = 17 * (72 / 256)
      c._label.scale.set(17, clh, 1)
      c._label.position.set(0, 0, 0)
      c._label.center.set(0.5, 0.5 + 5.6 / clh)
    }
    this._comets = [...this._cometById.values()]
    this._refreshPickables()
    // sprites created above default to night (additive) — re-blend for day
    if (this.dayMode) this._applyDayLook()
  }

  _refreshPickables() {
    this._pickables = this._bodies.map(b => b._chip)
      .concat(this._comets.map(c => c._chip))
      .concat(this._sunChip ? [this._sunChip] : [])
  }

  _updateComets(dt) {
    for (const c of this._comets) {
      const { a, e, node, incline, speed } = c.ellipse
      // Kepler-flavored sweep: faster near the sun (dθ ∝ 1/r²)
      const r = (a * (1 - e * e)) / (1 + e * Math.cos(c._theta))
      c._theta += dt * this.speedMul * speed * Math.pow((a * (1 - e)) / Math.max(6, r), 1.5) * 2.2
      const x0 = Math.cos(c._theta) * r
      const z0 = Math.sin(c._theta) * r
      // rotate ellipse by its node angle, tilt by inclination
      const x = x0 * Math.cos(node) - z0 * Math.sin(node)
      const z = x0 * Math.sin(node) + z0 * Math.cos(node)
      const y = Math.sin(c._theta) * r * Math.sin(incline)
      c._pos.set(x, y, z)
      c._node.position.copy(c._pos)

      // coma brightens near the sun
      const heat = MathUtils.clamp(1.6 - r / 110, 0.35, 1.25)
      c._coma.material.opacity = 0.5 * heat + Math.sin(this.wall * 5 + c.ellipse.node) * 0.06
      const cs = 11 + heat * 5
      c._coma.scale.set(cs, cs, 1)

      // tail: ring-buffer of past positions, sprites fade along it
      if (this.speedMul > 0) {
        c._trail.unshift({ x, y, z })
        if (c._trail.length > c._tail.length * 3) c._trail.pop()
      }
      const step = 3
      c._tail.forEach((sp, i) => {
        const p = c._trail[Math.min(c._trail.length - 1, (i + 1) * step)]
        if (!p) { sp.material.opacity = 0; return }
        sp.position.set(p.x, p.y, p.z)
        const f = 1 - i / c._tail.length
        sp.material.opacity = 0.34 * f * f * heat
        const s = (6.5 - i * 0.22) * (0.7 + heat * 0.35)
        sp.scale.set(s, s, 1)
      })

      // label readable when close-ish to camera
      const d = this.camera.position.distanceTo(c._pos)
      c._label.material.opacity = MathUtils.clamp(1.5 - d / 240, 0.25, 0.95)
    }
  }

  /* ══════════════════ data ══════════════════ */
  setData({ sun, bodies, groups }) {
    // sun chip
    this._sun = sun
    if (sun?.token?.logo) {
      const sunLogo = cleanLogoUrl(sun.token.logo)
      const tex = getLogoTexture(sunLogo, () => {
        const t = getLogoTexture(sunLogo)
        if (t && this._sunChipMat) { this._sunChipMat.map = t; this._sunChipMat.opacity = 0.95; this._sunChipMat.needsUpdate = true }
      })
      if (tex) { this._sunChipMat.map = tex; this._sunChipMat.opacity = 0.95; this._sunChipMat.needsUpdate = true }
    } else if (sun) {
      this._sunChipMat.map = fallbackChipTex(sun.id, [255, 200, 90])
      this._sunChipMat.opacity = 0.95
      this._sunChipMat.needsUpdate = true
    }

    const prev = this._bodyById
    const nextById = new Map()
    const group = new Group()

    // moons (parentId) must tick AFTER their parents so they read this
    // frame's parent position — order parentless bodies first (stable sort,
    // also staggers spawn so planets appear before their swarms)
    if (bodies.some((b) => b.parentId)) {
      bodies = [...bodies].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0))
    }

    const spawnBase = this.wall
    bodies.forEach((b, idx) => {
      const old = prev.get(b.id)
      const node = old?._node || this._makeBodyNode(b)
      if (old?._node) {
        // reusing the old node: carry the sprite refs onto the fresh body object
        b._glow = old._glow; b._ring = old._ring; b._chip = old._chip; b._glass = old._glass; b._label = old._label
        b._aura = old._aura; b._auraWave = old._auraWave; b._nova = old._nova
        b._trailLine = old._trailLine
      }
      // carry current rendered position + smoothed orbit across refreshes (no re-explosion)
      const parentNow = b.parentId ? nextById.get(b.parentId) : null
      b._pos = old?._pos || (parentNow?._pos
        ? parentNow._pos.clone().add(new Vector3(
          Math.cos(b.phase) * b.orbitRadius, 0, Math.sin(b.phase) * b.orbitRadius))
        : new Vector3(
          Math.cos(b.phase) * b.orbitRadius, 0, Math.sin(b.phase) * b.orbitRadius))
      b._orbitRadiusCur = old?._orbitRadiusCur
      b._node = node
      b._spawnAt = old ? -1 : spawnBase + idx * 0.014
      b._scale = old ? 1 : 0
      b._hoverMix = 0
      // refresh visuals that depend on data (change direction / label)
      this._applyBodyLook(b)
      node.userData.body = b
      group.add(node)
      nextById.set(b.id, b)
    })

    // dispose nodes for tokens that left the universe
    for (const [id, old] of prev) {
      if (!nextById.has(id) && old._node) this._disposeNode(old._node)
    }

    if (this.bodiesGroup) this.scene.remove(this.bodiesGroup)
    this.bodiesGroup = group
    this.scene.add(group)

    // resolve moon → parent references (after the loop so order can't matter)
    for (const b of bodies) b._parent = b.parentId ? (nextById.get(b.parentId) || null) : null

    this._bodies = bodies
    this._bodyById = nextById
    this._groups = groups
    // how far the galaxy layout reaches — the camera frames to this
    let ext = 0
    for (const g of groups) {
      if (g.hub) ext = Math.max(ext, Math.hypot(g.hub.x, g.hub.z) + (g.rad || 0))
    }
    this._galaxyExtent = ext || 150
    if (this.viewMode === 'galaxy') {
      this._tween(this.rig, { dist: Math.max(VIEWS.galaxy.dist, this._galaxyExtent * 1.9) }, 1.2)
    }
    this._rebuildGalaxyLines()
    this._assignMoverTrails()
    // re-apply the social layer onto the fresh body objects (auras/comets),
    // which also rebuilds pickables — order-safe vs the React effect race
    this._applySocial()
    // link lines reference body objects, which were just replaced — re-resolve
    if (this._linkPairsRaw?.length) this._applyLinks()

    // keep focus alive across refreshes (comets survive via _cometById)
    if (this._focused && !this._focused.isSun
        && !nextById.has(this._focused.id) && !this._cometById.has(this._focused.id)) {
      this.focusBody(null)
    }
    this._kick()
  }

  /* orbital trails for the top-3 movers — a fading arc behind the planet */
  _assignMoverTrails() {
    const SEG = 44
    if (!this._trails) {
      this._trails = []
      for (let i = 0; i < 3; i++) {
        const geo = new BufferGeometry()
        geo.setAttribute('position', new BufferAttribute(new Float32Array(SEG * 3), 3))
        geo.setAttribute('color', new BufferAttribute(new Float32Array(SEG * 3), 3))
        const line = new Line(geo, new LineBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.85,
          depthWrite: false, blending: AdditiveBlending,
        }))
        line.frustumCulled = false
        line.visible = false
        this.scene.add(line)
        this._trails.push({ line, seg: SEG, body: null })
      }
    }
    const top = [...this._bodies]
      .filter(b => Math.abs(b.change) >= 2)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 3)
    this._trails.forEach((tr, i) => {
      tr.body = top[i] || null
      tr.line.visible = !!tr.body
    })
  }

  _updateTrails() {
    if (!this._trails) return
    const gm = this.galaxyMix
    for (const tr of this._trails) {
      const b = tr.body
      if (!b || gm > 0.5) { tr.line.visible = false; continue }
      tr.line.visible = true
      const pos = tr.line.geometry.getAttribute('position')
      const col = tr.line.geometry.getAttribute('color')
      const R = b._orbitRadiusCur
      const inc = b.incline * this.inclineMul
      const t0 = this.time * b.speed + b.phase
      const span = 1.15 // radians of arc behind the planet
      const positive = (b.change || 0) >= 0
      const cr = positive ? 0.2 : 0.97, cg = positive ? 0.83 : 0.44, cb = positive ? 0.6 : 0.44
      for (let i = 0; i < tr.seg; i++) {
        const k = i / (tr.seg - 1)
        const a = t0 - k * span
        pos.setXYZ(i,
          Math.cos(a) * R,
          Math.sin(a + b.inclinePhase) * R * Math.sin(inc),
          Math.sin(a) * R)
        const f = (1 - k) * (1 - k) * 0.7
        col.setXYZ(i, cr * f, cg * f, cb * f)
      }
      pos.needsUpdate = true
      col.needsUpdate = true
    }
  }

  _makeBodyNode(b) {
    const node = new Group()

    const glowMat = new SpriteMaterial({
      map: glowTex(), transparent: true, depthWrite: false,
      blending: this.dayMode ? NormalBlending : AdditiveBlending,
    })
    const glow = new Sprite(glowMat)
    node.add(glow)

    const ringMat = new SpriteMaterial({
      map: ringTex(), transparent: true, depthWrite: false, opacity: 0.55,
    })
    const ring = new Sprite(ringMat)
    node.add(ring)

    const chipMat = new SpriteMaterial({ map: null, transparent: true })
    const chip = new Sprite(chipMat)
    node.add(chip)

    const glassMat = new SpriteMaterial({
      map: glassTex(), transparent: true, depthWrite: false, opacity: 0.55,
    })
    const glass = new Sprite(glassMat)
    node.add(glass)

    const labelMat = new SpriteMaterial({ map: null, transparent: true, depthWrite: false, opacity: 0.9 })
    const label = new Sprite(labelMat)
    node.add(label)

    b._glow = glow; b._ring = ring; b._chip = chip; b._glass = glass; b._label = label
    return node
  }

  /* set per-body visuals from data (called on create + every data refresh) */
  _applyBodyLook(b) {
    const r = b.radius
    const positive = (b.change || 0) >= 0
    const intensity = b.noMarket
      ? Math.min(1, (b.velocity || 0.6) / 2.4)
      : Math.min(1, Math.abs(b.change || 0) / 12)

    // pure-social bodies (X Dash universe, no market feed) burn cyan;
    // data builders may pin an explicit glow (e.g. authenticity ramp)
    b._glow.material.color.set(b.glowColor != null
      ? b.glowColor
      : (b.noMarket ? 0x22d3ee : positive ? 0x34d399 : 0xf87171))
    // tighter, dimmer halo: crowded regions used to smear into a wash AND the
    // giant additive quads were the single biggest fill cost on the GPU
    b._glow.material.opacity = this.dayMode ? 0.12 + intensity * 0.16 : 0.15 + intensity * 0.4
    // per-body glow quads are the scene's biggest overdraw when planets
    // cluster — mobile trims the halo area ~22%, reads identical at phone size
    const glowK = this.isMobile ? (3.0 + intensity * 1.7) : (3.4 + intensity * 2.2)
    b._glow.scale.set(r * glowK, r * glowK, 1)

    b._ring.material.color.setRGB(b.groupColor[0] / 255, b.groupColor[1] / 255, b.groupColor[2] / 255)
    b._ring.material.opacity = this.dayMode ? 0.6 : 0.38
    b._ring.scale.set(r * 2.42, r * 2.42, 1)

    b._glass.scale.set(r * 2.14, r * 2.14, 1)
    b._glass.material.opacity = this.dayMode ? 0.4 : 0.55

    const setChip = (tex) => {
      b._chip.material.map = tex
      b._chip.material.needsUpdate = true
    }
    if (b.isSector) {
      setChip(sectorChipTex(b.id, b.count || 0, b.groupColor))
    } else if (b.token.logo) {
      const logoSrc = cleanLogoUrl(b.token.logo)
      const tex = getLogoTexture(logoSrc, () => {
        const t = getLogoTexture(logoSrc)
        if (t) setChip(t)
      })
      setChip(tex || fallbackChipTex(b.id, b.groupColor))
    } else {
      setChip(fallbackChipTex(b.id, b.groupColor))
    }
    b._chip.scale.set(r * 2.1, r * 2.1, 1)

    // label content follows the label mode (change % / price / mcap / name /
    // off). Sector stars keep their labels in 'off' — they're navigation.
    b._label.visible = this.labelMode !== 'off' || !!b.isSector
    const changePct = `${positive ? '+' : ''}${(b.change || 0).toFixed(1)}%`
    let line1 = b.id
    let line2 = changePct
    let tone = null
    if (b.isSector) {
      line1 = (b.labelTitle || b.id).toUpperCase()
      line2 = this.labelMode === 'mcap' ? fmtUsdShort(b.token.marketCap) : changePct
    } else if (b.subLabel) {
      line2 = b.subLabel
      tone = 'social'
    } else if (this.labelMode === 'price') {
      line2 = fmtUsdShort(b.token.price)
    } else if (this.labelMode === 'mcap') {
      line2 = fmtUsdShort(b.token.marketCap)
    } else if (this.labelMode === 'name') {
      const nm = b.token.name || b.id
      line1 = nm.length > 16 ? nm.slice(0, 15) + '…' : nm
    }
    b._label.material.map = labelTex(line1, line2, positive, this.dayMode, tone)
    b._label.material.needsUpdate = true
    const lw = Math.max(9, r * 3.2)
    const lh = lw * (72 / 256)
    b._label.scale.set(lw, lh, 1)
    // anchor via sprite.center, NOT a world-space y offset: the quad hangs
    // straight below the planet in SCREEN space at any camera angle
    // (a world offset drifts sideways when viewed from an azimuth)
    b._label.position.set(0, 0, 0)
    b._label.center.set(0.5, 0.5 + (r * 1.55) / lh)

    // supernova shockwave for extreme movers (±10%+): an expanding ring that
    // detonates every few seconds — you can spot the violence from orbit
    const extreme = Math.abs(b.change || 0) >= 10
    if (extreme && !b._nova) {
      const nova = new Sprite(new SpriteMaterial({
        map: ringTex(), transparent: true, depthWrite: false,
        blending: AdditiveBlending, opacity: 0,
      }))
      b._node.add(nova)
      b._nova = nova
    } else if (!extreme && b._nova) {
      b._node.remove(b._nova)
      b._nova.material.dispose()
      b._nova = null
    }
    if (b._nova) b._nova.material.color.set((b.change || 0) >= 0 ? 0x34d399 : 0xf87171)

    // orbit params re-target on refreshed change% (jitter preserved).
    // Social-universe bodies orbit by LEADERBOARD RANK, moons by their
    // builder-assigned parent-relative radius — never re-target those.
    if (!b.social && !b.parentId) b.orbitRadius = orbitForChange(b.change) + (b.orbitJitter || 0)
    b._orbitRadiusCur = b._orbitRadiusCur ?? b.orbitRadius
  }

  _disposeNode(node) {
    node.traverse((o) => {
      if (o.material) {
        // atlas textures are shared; only dispose materials
        o.material.dispose()
      }
    })
  }

  /* ══════════════════ views / modes ══════════════════ */
  setView(mode) {
    if (!VIEWS[mode] || mode === this.viewMode) return
    this.viewMode = mode
    const v = VIEWS[mode]
    const dist = mode === 'galaxy'
      ? Math.max(v.dist, (this._galaxyExtent || 150) * 1.9)
      : v.dist
    this._tween(this.rig, { pitch: v.pitch, dist }, 1.4)
    this._tween(this, {
      inclineMul: mode === 'map' ? 0 : 1,
      galaxyMix: mode === 'galaxy' ? 1 : 0,
    }, 1.6)
    if (mode === 'map') this._tween(this.rig, { yaw: 0 }, 1.4)
    this._kick()
  }

  setDayMode(day) {
    this.dayMode = !!day
    this._applyDayLook()
    for (const b of this._bodies) {
      b._glow.material.blending = day ? NormalBlending : AdditiveBlending
      b._glow.material.needsUpdate = true
      this._applyBodyLook(b)
    }
    this._applySocial() // regenerate comet labels + re-blend social sprites
    this._kick()
  }

  /* Everything additive glows against the night. Against a light sky additive
     washes to a white blob (the "day mode looks bad" bug) — so day mode swaps
     the sky for a paper gradient and re-blends every luminous material. */
  _applyDayLook() {
    const day = this.dayMode
    if (day) {
      this.scene.background = dayBgTex()
      this.scene.fog.color = new Color(0xe9edf4)
      this.scene.fog.density = 0.0006
    } else {
      this.scene.background = new Color(NIGHT_BG)
      this.scene.fog.color = new Color(NIGHT_BG)
      this.scene.fog.density = 0.0011
    }
    this.backdrop.visible = !day
    for (const ring of this.ringsGroup.children) {
      ring.material.color.set(day ? 0x0f172a : 0xffffff)
    }
    this._focusRing.material.color.set(day ? 0x0f172a : 0xf5f5f7)

    const reBlend = (mat, dayColor, nightColor) => {
      mat.blending = day ? NormalBlending : AdditiveBlending
      if (dayColor != null) mat.color.set(day ? dayColor : nightColor)
      mat.needsUpdate = true
    }
    // sun: defined amber star by day, blazing additive corona by night
    reBlend(this._sunCorona.material, 0xf59e0b, 0xff9a2a)
    reBlend(this._sunMid.material, 0xf97316, 0xffc75e)
    reBlend(this._sunCore.material)
    // asteroid belt: ink dust by day
    if (this._belt) reBlend(this._belt.material, 0x64748b, 0xaab4cc)
    // mover trails + galaxy constellation lines
    if (this._trails) for (const tr of this._trails) reBlend(tr.line.material)
    if (this._galaxyLines) reBlend(this._galaxyLines.material)
    if (this._linkLines) reBlend(this._linkLines.material)
    // shooting stars only exist at night
    if (this._streaks) {
      for (const st of this._streaks) {
        if (day) { st.active = false; st.group.visible = false }
      }
    }
    // comets: teal-ink comet by day
    for (const c of this._comets) {
      reBlend(c._coma.material, 0x0e7490, 0x9be9ff)
      for (const sp of c._tail) reBlend(sp.material, 0x0891b2, 0x7dd8ff)
    }
    // social auras + supernova rings
    for (const b of this._bodies) {
      if (b._aura) { reBlend(b._aura.material, 0x0891b2, 0x67e8f9); reBlend(b._auraWave.material, 0x0891b2, 0x67e8f9) }
      if (b._nova) { b._nova.material.blending = day ? NormalBlending : AdditiveBlending; b._nova.material.needsUpdate = true }
    }
  }

  setSpeed(mult) {
    this.speedMul = this.reducedMotion ? 0 : mult
    this._kick()
  }

  /** What the under-planet labels show: 'change' | 'price' | 'mcap' | 'name' | 'off' */
  setLabelMode(mode) {
    if (mode === this.labelMode) return
    this.labelMode = mode
    for (const b of this._bodies) this._applyBodyLook(b)
    for (const c of this._comets) c._label.visible = mode !== 'off'
    this._kick()
  }

  setCinematic(on) {
    this.cinematic = !!on && !this.reducedMotion
    if (this.cinematic) {
      // the tour: drift, then periodically fly to an interesting world,
      // linger, pull back out — a self-running documentary of the market
      this._tour = { phase: 'drift', nextAt: this.wall + 3.5, body: null }
    } else {
      if (this._tour?.body && !this._focused) {
        this._tweenVec(this.rig.target, new Vector3(0, 0, 0), 1.2)
        this._tween(this.rig, { dist: VIEWS[this.viewMode].dist }, 1.2)
      }
      this._tour = null
    }
    this._kick()
  }

  _stepTour(dt) {
    const tour = this._tour
    if (!tour || this._focused || !this._bodies.length) return
    if (tour.phase === 'drift') {
      if (this.wall >= tour.nextAt) {
        // prefer the violent and the loud; fall back to anyone
        const pool = this._bodies.filter(b => Math.abs(b.change || 0) >= 4 || (b._social && b._social.intensity > 0.55))
        const all = pool.length >= 3 ? pool : this._bodies
        tour.body = all[Math.floor(Math.random() * all.length)]
        tour.phase = 'visit'
        tour.until = this.wall + 5.5
        this._tween(this.rig, { dist: MathUtils.clamp(tour.body.radius * 24, 58, 120) }, 2.4)
      }
    } else if (tour.phase === 'visit') {
      if (tour.body?._pos) this.rig.target.lerp(tour.body._pos, Math.min(1, dt * 2.2))
      if (this.wall >= tour.until || !tour.body) {
        tour.phase = 'drift'
        tour.nextAt = this.wall + 6 + Math.random() * 5
        tour.body = null
        this._tween(this.rig, { dist: VIEWS[this.viewMode].dist }, 2.6)
        this._tweenVec(this.rig.target, new Vector3(0, 0, 0), 2.6)
      }
    }
  }

  /** Keyboard navigation: small camera adjustments (map view pans, others orbit). */
  nudge({ yaw = 0, pitch = 0, zoom = 1, panX = 0, panY = 0 } = {}) {
    if (VIEWS[this.viewMode].panLock) {
      this._panBy(panX, panY)
    } else {
      this.rig.yaw += yaw
      this.rig.pitch = MathUtils.clamp(this.rig.pitch + pitch, 0.08, 1.5)
    }
    if (zoom !== 1) this.rig.dist = MathUtils.clamp(this.rig.dist * zoom, 28, 620)
    this._kick()
  }

  resetCamera() {
    const v = VIEWS[this.viewMode]
    this.focusBody(null)
    this._tween(this.rig, { pitch: v.pitch, dist: v.dist, yaw: this.viewMode === 'map' ? 0 : this.rig.yaw % (Math.PI * 2) }, 1.0)
    this._tweenVec(this.rig.target, new Vector3(0, 0, 0), 1.0)
    this._kick()
  }

  /** Look up a focusable object (planet or comet) by symbol. */
  findBody(id) {
    return this._bodyById.get(id) || this._cometById.get(id) || null
  }

  /** Fly the camera to a body or comet (id), or null to release focus. */
  focusBody(id) {
    const body = id ? (this._bodyById.get(id) || this._cometById.get(id)) : null
    this._focused = body || (id === 'SUN_FOCUS' ? { isSun: true } : null)
    if (id === 'SUN_FOCUS') {
      this._tweenVec(this.rig.target, new Vector3(0, 0, 0), 1.2)
      this._tween(this.rig, { dist: WORLD.sunRadius * 14 }, 1.2)
    } else if (body?.isComet) {
      this._tween(this.rig, { dist: 74 }, 1.3)
    } else if (body) {
      // camera follows the moving planet each frame; here just dolly in
      this._tween(this.rig, { dist: MathUtils.clamp(body.radius * 22, 46, 140) }, 1.3)
    } else {
      const v = VIEWS[this.viewMode]
      this._tweenVec(this.rig.target, new Vector3(0, 0, 0), 1.1)
      this._tween(this.rig, { dist: v.dist }, 1.1)
    }
    this._focusRing.material.opacity = 0 // re-fades in per frame while focused
    this._kick()
  }

  /* ══════════════════ input ══════════════════ */
  _bindInput() {
    const el = this.renderer.domElement
    const st = {
      down: false, moved: false, x: 0, y: 0, button: 0,
      pinchD: 0, mode: 'rotate',
      lastX: 0, lastY: 0, lastT: 0,
    }
    this._inputState = st

    this._onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      // grabbing the wheel pauses the cinematic tour's current visit
      if (this._tour) { this._tour.phase = 'drift'; this._tour.nextAt = this.wall + 10; this._tour.body = null }
      st.down = true
      st.moved = false
      st.button = e.button
      st.x = st.lastX = e.clientX
      st.y = st.lastY = e.clientY
      st.lastT = performance.now()
      this.rig.yawVel = 0; this.rig.pitchVel = 0; this.rig.panVel.set(0, 0, 0)
      this._interactUntil = performance.now() + 400
      // press ON a world = grab it (drag the planet, not the camera);
      // press on space = steer the camera. Suns and comets stay on rails.
      const grabbed = e.button === 0 ? this._pickAt(e.clientX, e.clientY) : null
      st.dragBody = grabbed && !grabbed.isSun && !grabbed.isComet ? grabbed : null
      el.setPointerCapture?.(e.pointerId)
    }

    this._onPointerMove = (e) => {
      if (!st.down) {
        this._hoverAt(e.clientX, e.clientY)
        return
      }
      const dx = e.clientX - st.lastX
      const dy = e.clientY - st.lastY
      // click-vs-drag: total displacement from the press point, not per-move
      if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 5) {
        st.moved = true
        // a real drag begins — drop the hover card so it doesn't ride along
        if (this._hovered) { this._hovered = null; this.onHover(null, 0, 0) }
      }
      if (st.dragBody) {
        // the world follows the finger on its own screen-parallel plane;
        // on release the orbital spring glides it home
        const b = st.dragBody
        const target = this._pointerToWorld(e.clientX, e.clientY, b._pos)
        if (target) {
          b._dragging = true
          b._dragPos = target
          this.renderer.domElement.style.cursor = 'grabbing'
        }
        st.lastX = e.clientX; st.lastY = e.clientY; st.lastT = performance.now()
        this._kick()
        return
      }
      const pan = VIEWS[this.viewMode].panLock || st.button === 2 || e.shiftKey
      if (pan) this._panBy(dx, dy)
      else {
        this.rig.yaw -= dx * 0.005
        this.rig.pitch = MathUtils.clamp(this.rig.pitch + dy * 0.004, 0.08, 1.5)
      }
      const now = performance.now()
      const dt = Math.max(1, now - st.lastT)
      if (!pan) {
        // inertia sample, clamped so a jittery release can't flick the camera
        this.rig.yawVel = MathUtils.clamp((-dx * 0.005 / dt) * 16, -0.05, 0.05)
        this.rig.pitchVel = MathUtils.clamp((dy * 0.004 / dt) * 16, -0.05, 0.05)
      }
      st.lastX = e.clientX; st.lastY = e.clientY; st.lastT = now
      this._kick()
    }

    this._onPointerUp = (e) => {
      if (!st.down) return
      st.down = false
      el.releasePointerCapture?.(e.pointerId)
      if (st.dragBody) {
        st.dragBody._dragging = false
        st.dragBody._dragPos = null
        st.dragBody = null
        this.renderer.domElement.style.cursor = 'grab'
      }
      if (!st.moved) this._selectAt(e.clientX, e.clientY)
    }

    this._onPointerCancel = (e) => {
      // the browser claimed the gesture (mobile touch-action:pan-y page
      // scroll) — reset drag state but NEVER treat a canceled pan as a click
      if (!st.down) return
      st.down = false
      el.releasePointerCapture?.(e.pointerId)
      if (st.dragBody) {
        st.dragBody._dragging = false
        st.dragBody._dragPos = null
        st.dragBody = null
        this.renderer.domElement.style.cursor = 'grab'
      }
    }

    this._onWheel = (e) => {
      e.preventDefault()
      const k = Math.exp(e.deltaY * 0.0012)
      this.rig.dist = MathUtils.clamp(this.rig.dist * k, 28, 620)
      this._interactUntil = performance.now() + 400
      this._kick()
    }

    this._onContext = (e) => e.preventDefault()

    // touch pinch
    this._touches = new Map()
    this._onTouchStart = (e) => { for (const t of e.changedTouches) this._touches.set(t.identifier, { x: t.clientX, y: t.clientY }) }
    this._onTouchMove = (e) => {
      if (this._touches.size === 2 && e.touches.length === 2) {
        e.preventDefault()
        const [a, b] = [e.touches[0], e.touches[1]]
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        if (st.pinchD > 0) {
          this.rig.dist = MathUtils.clamp(this.rig.dist * (st.pinchD / d), 28, 620)
          this._kick()
        }
        st.pinchD = d
      }
    }
    this._onTouchEnd = (e) => {
      for (const t of e.changedTouches) this._touches.delete(t.identifier)
      if (this._touches.size < 2) st.pinchD = 0
    }
    this._onLeave = () => { if (this._hovered) { this._hovered = null; this.onHover(null, 0, 0) } }

    el.addEventListener('pointerdown', this._onPointerDown)
    el.addEventListener('pointermove', this._onPointerMove)
    el.addEventListener('pointerup', this._onPointerUp)
    el.addEventListener('pointercancel', this._onPointerCancel)
    el.addEventListener('pointerleave', this._onLeave)
    el.addEventListener('wheel', this._onWheel, { passive: false })
    el.addEventListener('contextmenu', this._onContext)
    el.addEventListener('touchstart', this._onTouchStart, { passive: true })
    el.addEventListener('touchmove', this._onTouchMove, { passive: false })
    el.addEventListener('touchend', this._onTouchEnd, { passive: true })
  }

  _panBy(dx, dy) {
    // panning is an explicit "let me move elsewhere" — release the focus
    // follow, or it re-centers the target every frame and the drag fights
    // the camera (rotate/zoom keep the focus: orbiting a world is natural)
    if (this._focused) {
      this._focused = null
      this.onSelect(null)
    }
    // translate in the camera's ground plane
    const scale = this.rig.dist * 0.0016
    const yaw = this.rig.yaw
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    this.rig.target.addScaledVector(right, -dx * scale)
    this.rig.target.addScaledVector(fwd, -dy * scale)
    const lim = WORLD.maxOrbit * 1.3
    this.rig.target.x = MathUtils.clamp(this.rig.target.x, -lim, lim)
    this.rig.target.z = MathUtils.clamp(this.rig.target.z, -lim, lim)
  }

  /** Screen-space picking: nearest world within a generous pixel halo.
      Sprite raycasting made small/far worlds nearly unclickable — their quads
      shrink with distance AND they keep orbiting while you aim (Gleb's
      "long distance bubbles are hard to click"). Projecting every body to
      screen pixels and taking the closest within max(26px, screenRadius*1.4)
      makes every world a fair target at any zoom. */
  _pickAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const px = clientX - rect.left
    const py = clientY - rect.top
    const halfW = rect.width / 2
    const halfH = rect.height / 2
    const fovScale = halfH / Math.tan((this.camera.fov * Math.PI / 180) / 2)
    const v = new Vector3()
    let best = null
    let bestD = Infinity
    const consider = (pos, worldR, payload) => {
      v.copy(pos).project(this.camera)
      if (v.z > 1 || v.z < -1) return // outside the view depth
      const sx = (v.x + 1) * halfW
      const sy = (1 - v.y) * halfH
      const camDist = this.camera.position.distanceTo(pos)
      if (camDist <= 0.001) return
      const screenR = (worldR / camDist) * fovScale
      const d = Math.hypot(sx - px, sy - py)
      const tolerance = Math.max(26, screenR * 1.4)
      if (d < tolerance && d < bestD) { bestD = d; best = payload }
    }
    for (const b of this._bodies) consider(b._pos, b.radius, b)
    for (const c of this._comets) consider(c._pos, 5.5, c)
    consider(_SUN_POS, WORLD.sunRadius * 1.3, { isSun: true, sun: this._sun })
    return best
  }

  /* project the pointer onto the screen-parallel plane through refPoint —
     lets a grabbed planet track the finger 1:1 at its own depth */
  _pointerToWorld(clientX, clientY, refPoint) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    const p = new Vector3(ndcX, ndcY, 0.5).unproject(this.camera)
    const dir = p.sub(this.camera.position).normalize()
    const n = new Vector3()
    this.camera.getWorldDirection(n)
    const denom = dir.dot(n)
    if (Math.abs(denom) < 1e-6) return null
    const t = refPoint.clone().sub(this.camera.position).dot(n) / denom
    if (t <= 0) return null
    return this.camera.position.clone().addScaledVector(dir, t)
  }

  _hoverAt(clientX, clientY) {
    const body = this._pickAt(clientX, clientY)
    const prev = this._hovered
    this._hovered = body
    this.renderer.domElement.style.cursor = body ? 'pointer' : 'grab'
    if (body !== prev || body) this.onHover(body, clientX, clientY)
    if (body !== prev) this._kick()
  }

  _selectAt(clientX, clientY) {
    const body = this._pickAt(clientX, clientY)
    if (body?.isSun) {
      this.focusBody('SUN_FOCUS')
      this.onSelect({ isSun: true, sun: this._sun })
      return
    }
    if (body?.isSector) {
      // sector stars are portals — the view drills into them, no camera chase
      this.onSelect(body)
    } else if (body) {
      this.focusBody(body.id)
      this.onSelect(body)
    } else if (this._focused) {
      this.focusBody(null)
      this.onSelect(null)
    }
    // a click hands the story to the dossier — kill the hover card so it
    // doesn't sit stale at the click position while the camera flies away
    if (this._hovered) {
      this._hovered = null
      this.onHover(null, 0, 0)
    }
  }

  /* ══════════════════ tweens ══════════════════ */
  _tween(obj, to, dur) {
    // replace any running tween on the same object+keys
    const keys = Object.keys(to)
    this._tweens = this._tweens.filter(tw => tw.obj !== obj || !tw.keys.some(k => keys.includes(k)))
    this._tweens.push({
      obj, keys, from: keys.reduce((a, k) => { a[k] = obj[k]; return a }, {}),
      to, t: 0, dur,
    })
    this._kick()
  }

  _tweenVec(vec, to, dur) {
    this._tweens = this._tweens.filter(tw => tw.obj !== vec)
    this._tweens.push({ obj: vec, vec: true, from: vec.clone(), to: to.clone(), t: 0, dur })
    this._kick()
  }

  _stepTweens(dt) {
    if (!this._tweens.length) return
    for (const tw of this._tweens) {
      tw.t = Math.min(1, tw.t + dt / tw.dur)
      const e = easeOutQuint(tw.t)
      if (tw.vec) tw.obj.copy(tw.from.clone().lerp(tw.to, e))
      else for (const k of tw.keys) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e
    }
    this._tweens = this._tweens.filter(tw => tw.t < 1)
  }

  /* ══════════════════ frame loop ══════════════════ */
  setRunning(on) {
    this.running = !!on
    if (on) this._kick()
    else if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null }
  }

  _kick() {
    if (this._raf == null && this.running) this._raf = requestAnimationFrame(this._frame)
  }

  _frame = () => {
    this._raf = null
    if (!this.running || document.hidden) return

    const now = performance.now()
    // frame governor: orbital drift doesn't need 60fps — cruise at ~40 and
    // only run uncapped while the user is actively steering or a camera
    // tween is in flight. A third less GPU work for an invisible difference.
    const interacting = this._inputState?.down
      || now < (this._interactUntil || 0)
      || this._tweens.length > 0
    if (!interacting && now - this._lastT < this._cruiseMs) {
      this._raf = requestAnimationFrame(this._frame)
      return
    }

    const dt = Math.min(0.05, (now - this._lastT) / 1000)
    this._lastT = now
    this.time += dt * this.speedMul
    this.wall += dt

    this._stepTweens(dt)

    // cinematic drift + tour
    if (this.cinematic) {
      this.rig.yaw += dt * 0.055
      this.rig.dist += Math.sin(this.time * 0.35) * dt * 1.6
      this._stepTour(dt)
    }

    // inertia
    if (!this._inputState?.down) {
      if (Math.abs(this.rig.yawVel) > 0.00003) {
        this.rig.yaw += this.rig.yawVel
        this.rig.yawVel *= 0.93
      }
      if (Math.abs(this.rig.pitchVel) > 0.00003) {
        this.rig.pitch = MathUtils.clamp(this.rig.pitch + this.rig.pitchVel, 0.08, 1.5)
        this.rig.pitchVel *= 0.93
      }
    }

    /* ── bodies ── */
    const ease = 1 - Math.exp(-dt * 2.6)
    const gm = this.galaxyMix
    for (const b of this._bodies) {
      // smooth orbit-radius re-targeting when the change% refreshes
      b._orbitRadiusCur += (b.orbitRadius - b._orbitRadiusCur) * ease

      const t = this.time * b.speed + b.phase
      const R = b._orbitRadiusCur
      const inc = b.incline * this.inclineMul
      const ox = Math.cos(t) * R
      const oz = Math.sin(t) * R
      const oy = Math.sin(t + b.inclinePhase) * R * Math.sin(inc)

      let tx = ox, ty = oy, tz = oz
      if (b._parent && b._parent._pos) {
        // moon: same orbit math centered on the parent. The parent already
        // ticked this frame (setData orders parents first) and its position
        // carries the active view/drag — the swarm rides along for free.
        tx = b._parent._pos.x + ox
        ty = b._parent._pos.y + oy
        tz = b._parent._pos.z + oz
      } else if (gm > 0.0001 && b.galaxy) {
        const g = b.galaxy
        const gt = this.time * 0.12 + g.phase
        const gx = g.cx + Math.cos(gt) * g.r
        const gz = g.cz + Math.sin(gt) * g.r
        const gy = g.y * this.inclineMul
        tx = ox + (gx - ox) * gm
        ty = oy + (gy - oy) * gm
        tz = oz + (gz - oz) * gm
      }
      if (b._dragging && b._dragPos) {
        // grabbed: chase the finger hard; orbital spring resumes on release
        const grip = Math.min(1, dt * 16)
        b._pos.lerp(b._dragPos, grip)
      } else {
        b._pos.x += (tx - b._pos.x) * ease
        b._pos.y += (ty - b._pos.y) * ease
        b._pos.z += (tz - b._pos.z) * ease
      }
      b._node.position.copy(b._pos)

      // spawn scale-in (wall clock, so it completes even under reduced motion)
      if (b._spawnAt >= 0) {
        const st = MathUtils.clamp((this.wall - b._spawnAt) / 0.6, 0, 1)
        b._scale = easeOutQuint(st)
        if (st >= 1) b._spawnAt = -1
      }
      // hover lift
      const targetHover = (this._hovered === b || this._focused === b || b._dragging) ? 1 : 0
      b._hoverMix += (targetHover - b._hoverMix) * Math.min(1, dt * 8)
      const s = b._scale * (1 + b._hoverMix * 0.35)
      b._node.scale.set(s, s, s)
      b._ring.material.opacity = (this.dayMode ? 0.6 : 0.38) + b._hoverMix * 0.45

      // social aura: steady cyan halo + a slow radio-wave ring
      if (b._aura && b._social) {
        const int_ = b._social.intensity || 0.5
        const pulse2 = 1 + Math.sin(this.wall * 2.2 + b.seed * 9) * 0.07
        const ar = b.radius * 3.1 * pulse2
        b._aura.scale.set(ar, ar, 1)
        b._aura.material.opacity = (this.dayMode ? 0.5 : 0.4) * int_
        const wt = (this.wall * 0.45 + b.seed) % 1
        const wr = b.radius * (2.4 + wt * 4.2)
        b._auraWave.scale.set(wr, wr, 1)
        b._auraWave.material.opacity = (1 - wt) * 0.3 * int_
      }

      // supernova detonation cycle
      if (b._nova) {
        const cyc = (this.wall * 0.42 + b.seed * 7) % 2.6
        if (cyc < 1.5) {
          const k = cyc / 1.5
          const nr = b.radius * (2.2 + k * 7.5)
          b._nova.scale.set(nr, nr, 1)
          b._nova.material.opacity = (1 - k) * (1 - k) * 0.55
        } else {
          b._nova.material.opacity = 0
        }
      }
    }

    /* comets + trails + belt + streaks */
    this._updateComets(dt)
    this._updateTrails()
    this._updateStreaks(dt)
    if (this._belt) {
      this._belt.rotation.y += dt * this.speedMul * 0.012
      this._belt.material.opacity = 0.4 * (1 - gm) * (this.dayMode ? 0.55 : 1)
    }

    /* label declutter: text earns its place by SCREEN SIZE. Worlds smaller
       than ~9px on screen stay silent (their overlapping labels were the
       zoomed-out mess), fading in through ~16px; hover/focus always speaks. */
    const camPos = this.camera.position
    const labelFovScale = (this.renderer.domElement.clientHeight / 2)
      / Math.tan((this.camera.fov * Math.PI / 180) / 2)
    for (const b of this._bodies) {
      const d = camPos.distanceTo(b._pos)
      const screenR = (b.radius / Math.max(1, d)) * labelFovScale
      let o = MathUtils.clamp((screenR - 9) / 7, 0, 1)   // 9px → 0, 16px → 1
      o *= MathUtils.clamp(1.6 - d / 260, 0.25, 1)        // gentle depth fade
      if (b._hoverMix > 0.05) o = Math.max(o, b._hoverMix)
      b._label.material.opacity = o * (this.dayMode ? 0.95 : 0.9) * b._scale
    }

    /* sun breathing */
    const pulse = 1 + Math.sin(this.time * 1.4) * 0.045
    this._sunCore.scale.set(WORLD.sunRadius * 3.0 * pulse, WORLD.sunRadius * 3.0 * pulse, 1)
    this._sunMid.scale.set(WORLD.sunRadius * 5.2 * (2 - pulse), WORLD.sunRadius * 5.2 * (2 - pulse), 1)
    this._sunCorona.material.opacity = this.dayMode ? 0.3 : 0.42 + Math.sin(this.time * 0.9) * 0.08

    /* rings/lines crossfade with view */
    const ringO = 1 - gm
    for (const ring of this.ringsGroup.children) {
      ring.material.opacity = (ring.userData.baseOpacity ?? 0.05) * ringO * (this.dayMode ? 2.2 : 1)
    }
    if (this._galaxyLines) this._galaxyLines.material.opacity = gm * (this.dayMode ? 0.35 : 0.22)
    if (this._galaxyLines && gm > 0.001) {
      // follow the drifting bodies
      const attr = this._galaxyLines.geometry.getAttribute('position')
      let vi = 0
      for (const g of this._groups) {
        const members = g.members.map(i => this._bodies[i]).filter(Boolean)
        if (members.length < 2) continue
        for (let i = 0; i < members.length - 1; i++) {
          const a = members[i], c = members[i + 1]
          attr.setXYZ(vi++, a._pos.x, a._pos.y, a._pos.z)
          attr.setXYZ(vi++, c._pos.x, c._pos.y, c._pos.z)
        }
      }
      attr.needsUpdate = true
    }

    /* relationship links (co-mention edges) follow their bodies in every view */
    if (this._linkLines && this._linkPairs?.length) {
      const attr = this._linkLines.geometry.getAttribute('position')
      let vi = 0
      for (const lp of this._linkPairs) {
        attr.setXYZ(vi++, lp.a._pos.x, lp.a._pos.y, lp.a._pos.z)
        attr.setXYZ(vi++, lp.b._pos.x, lp.b._pos.y, lp.b._pos.z)
      }
      attr.needsUpdate = true
      const linkO = this.dayMode ? 0.34 : 0.2
      this._linkLines.material.opacity += (linkO - this._linkLines.material.opacity) * Math.min(1, dt * 2)
    }

    /* focused body: follow + orbit path highlight (comets show their tail instead) */
    const f = this._focused
    if (f && !f.isSun && f._pos) {
      this.rig.target.lerp(f._pos, Math.min(1, dt * 4))
      if (!f.isComet && !f._parent) {
        // (moons skip the ring — it is drawn about the ORIGIN, not the parent)
        // redraw its orbit path
        const seg = 160
        const attr = this._focusRingGeo.getAttribute('position')
        const R = f._orbitRadiusCur
        const inc = f.incline * this.inclineMul
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2
          attr.setXYZ(i,
            Math.cos(a) * R,
            Math.sin(a + f.inclinePhase) * R * Math.sin(inc),
            Math.sin(a) * R)
        }
        attr.needsUpdate = true
        this._focusRing.material.opacity += (((1 - gm) * 0.28) - this._focusRing.material.opacity) * Math.min(1, dt * 3)
      } else {
        this._focusRing.material.opacity *= Math.max(0, 1 - dt * 4)
      }
    } else {
      this._focusRing.material.opacity *= Math.max(0, 1 - dt * 4)
    }

    /* starfield twinkle (cheap: whole-layer opacity oscillation) */
    if (!this.dayMode) {
      this._starsNear.material.opacity = this._starsNear.userData.baseOpacity * (0.8 + 0.2 * Math.sin(this.time * 1.7))
      this._starsFar.material.opacity = this._starsFar.userData.baseOpacity * (0.85 + 0.15 * Math.sin(this.time * 1.1 + 2))
      this.backdrop.rotation.y += dt * 0.004
    }

    /* camera from rig */
    const { yaw, pitch, dist, target } = this.rig
    const cp = Math.cos(pitch), sp = Math.sin(pitch)
    this.camera.position.set(
      target.x + Math.sin(yaw) * cp * dist,
      target.y + sp * dist,
      target.z + Math.cos(yaw) * cp * dist,
    )
    this.camera.lookAt(target)

    this.renderer.render(this.scene, this.camera)

    // adaptive-DPR governor: EMA of the actual work per frame (physics +
    // render submit — vsync wait excluded by measuring inside the frame).
    // Wide hysteresis (>15ms down, <6ms up) + 120-frame cadence so it
    // settles on a step instead of oscillating.
    const workMs = performance.now() - now
    this._renderMsEma += (workMs - this._renderMsEma) * 0.08
    // achieved interval between RENDERED frames — the JS-side EMA can't see a
    // fill-rate-bound GPU (render submit returns fast while the compositor
    // drowns); a swollen real interval can
    if (this._lastRenderAt) {
      const gap = now - this._lastRenderAt
      if (gap < 500) this._gapEma += (gap - this._gapEma) * 0.08
    }
    this._lastRenderAt = now
    if (++this._dprFrames >= 120) {
      this._dprFrames = 0
      const gpuBound = this._gapEma > this._cruiseMs + 26
      if ((this._renderMsEma > 15 || gpuBound) && this._dprIdx > 0) this._setDprStep(this._dprIdx - 1)
      else if (this._renderMsEma < 6 && this._gapEma < this._cruiseMs + 9
        && this._dprIdx < this._dprSteps.length - 1) this._setDprStep(this._dprIdx + 1)
    }

    this._raf = requestAnimationFrame(this._frame)
  }

  _setDprStep(idx) {
    this._dprIdx = idx
    this._renderMsEma = 10 // re-center so one switch doesn't cascade into more
    this._gapEma = this._cruiseMs
    this.renderer.setPixelRatio(this._dprSteps[idx])
    this.renderer.setSize(Math.max(1, this.container.clientWidth), Math.max(1, this.container.clientHeight))
  }

  /** Capture the current frame as a PNG data-URL (for the share card).
      A fresh synchronous render right before toDataURL means we don't need
      preserveDrawingBuffer (which would cost memory on every frame). */
  snapshot() {
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }

  /* ══════════════════ lifecycle ══════════════════ */
  resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this._kick()
  }

  dispose() {
    this.setRunning(false)
    document.removeEventListener('visibilitychange', this._onVis)
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this._onPointerDown)
    el.removeEventListener('pointermove', this._onPointerMove)
    el.removeEventListener('pointerup', this._onPointerUp)
    el.removeEventListener('pointercancel', this._onPointerCancel)
    el.removeEventListener('pointerleave', this._onLeave)
    el.removeEventListener('wheel', this._onWheel)
    el.removeEventListener('contextmenu', this._onContext)
    el.removeEventListener('touchstart', this._onTouchStart)
    el.removeEventListener('touchmove', this._onTouchMove)
    el.removeEventListener('touchend', this._onTouchEnd)
    el.removeEventListener('webglcontextlost', this._onCtxLost)
    el.removeEventListener('webglcontextrestored', this._onCtxRestored)
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material && !o.material._shared) o.material.dispose()
    })
    // dispose() frees programs/render-targets but NOT the underlying WebGL
    // context — that only happens via forceContextLoss() or non-deterministic
    // GC. Without it, every mount (fullscreen toggle, Bubbles<->Cosmos switch)
    // leaks a live context; Chrome force-loses the oldest at ~16 -> black canvas.
    try { this.renderer.forceContextLoss() } catch { /* context already lost */ }
    this.renderer.dispose()
    if (el.parentNode) el.parentNode.removeChild(el)
  }
}
