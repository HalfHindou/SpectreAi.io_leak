/**
 * wst-engine-scene.js — THE WORLD ENGINE.
 *
 * A rotating armillary sphere: four nested rings and a core, each one a real
 * macro force from the World State document. Vanilla three.js, no React — the
 * host (wst-engine.jsx) mounts it through an imperative handle and never
 * re-renders per frame. This module is reached by DYNAMIC import only, so
 * three never lands on the page chunk, let alone the boot chunk
 * (check-critical-path fences the boot path; the dynamic import keeps a
 * reduced-motion or WebGL-less reader from downloading 900KB they can't use).
 *
 * ── THE HONESTY CONTRACT ──────────────────────────────────────────────────
 * Every element that MOVES or has a LENGTH is a payload field. Nothing here is
 * decoration wearing the clothes of data:
 *
 *   ring 1  arc length   = |net_liquidity.chg_4w_usd_b| on a fixed ±$300B
 *                          half-revolution — the SAME scale the tide band
 *                          prints, so the two forms agree by construction
 *           arc side     = sign of that change (drain sweeps left of the zero
 *                          mark, add sweeps right)
 *           spin + flow  = direction of that sign
 *   ring 2  arc length   = days to rates.next_fomc over an ASSUMED 42-day
 *                          inter-meeting cycle (see FOMC_CYCLE_D — derived,
 *                          not reported; the sprite states only the real
 *                          facts: days remaining and the date)
 *           amber node   = the meeting itself
 *   ring 3  thickness    = |cot_btc.*_net| / cot_btc.open_interest
 *           spin sign    = sign of that net (short rotates against long; if
 *                          both legs were long they would co-rotate — the
 *                          data decides, not the choreography)
 *   ring 4  radius label = stablecoins.total_usd_b
 *           breath sign  = sign of stablecoins.chg_7d_pct (expands on a
 *                          positive week, contracts on a negative one)
 *   core    pulse shape  = markets.regime ('chop' flickers irregularly,
 *                          anything else holds a steady beat)
 *
 * FIXED, and therefore never readable as a quantity: ring radii, particle
 * count, spin SPEED, label sizes, camera. Only length, thickness, side, sign
 * and the printed numbers carry meaning.
 *
 * ABSENCE IS VISIBLE. A missing field renders its ring as a dim, INERT
 * wireframe (no spin at all — stillness is the tell) with a "no … on file"
 * sprite. Nothing is faked, defaulted or hidden.
 *
 * ── THERMALS (the cosmos-engine budget, same rules) ───────────────────────
 * antialias off · DPR capped 1.5 desktop / 1.25 mobile · ~40fps cruise
 * governor · stops on document.hidden, on IntersectionObserver exit and on
 * the app-wide 5-min idle (host wires those) · geometry rebuilt only when the
 * document changes (every 5 minutes at most), never per frame · zero
 * allocation inside _frame · full dispose incl. forceContextLoss.
 *
 * ── DAY MODE (the liquidation-heatmap precedent) ──────────────────────────
 * The stage stays DARK in day mode and the page frames it as a deliberately
 * dark media card, exactly as `.liqp-real-heatmap--day` does for the
 * liquidation console. Reason: this scene is additive light on black — every
 * ring, glow and particle is an AdditiveBlending material, and additive white
 * over a white card washes to a flat sheet with no ring left in it. Rather
 * than re-blend six material families to Normal and lose the depth, the frame
 * changes and the instrument stays lit. Every additive material is still
 * registered in `this._add` so a future full re-blend is one loop, and
 * setDayMode() already trims the bloom so the card doesn't blaze next to
 * white page chrome.
 */
import {
  AdditiveBlending, CanvasTexture, Color, DoubleSide, Float32BufferAttribute,
  BufferGeometry, Group, LinearFilter, MathUtils, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Points, PointsMaterial, RingGeometry, Scene, Sprite,
  SpriteMaterial, SRGBColorSpace, WebGLRenderer,
} from 'three'

/* ══════════════════ constants ══════════════════ */

/** The tide band's fixed scale, reused so the two forms cannot disagree. */
const LIQ_SCALE_B = 300
/** DERIVED, NOT REPORTED: the FOMC calendar runs ~6 weeks between meetings. */
const FOMC_CYCLE_D = 42
const DAY_MS = 86_400_000

const FOV = 42
/** World-space half-height the camera must contain (outer ring + label room). */
const NEED = 9.3

const BG = 0x08080a

/* Palette: near-black space, warm-white structure, bull/bear ONLY where they
   mean direction, one amber accent on the FOMC meeting node. */
const C_STRUCT = 0xf5f5f7
const C_DIM = 0x6c6c74
const C_BULL = 0x10b981
const C_BEAR = 0xef4444
const C_AMBER = 0xf59e0b

const R_LIQ = 8.7
const R_FOMC = 6.85
const R_COT = 5.0
const R_ST = 3.35

const ARC_SEG = 200
const REVEAL_S = 1.9

const LBL_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif"

const TAU = Math.PI * 2
const easeOut = (t) => 1 - (1 - t) ** 3
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const finite = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/* ══════════════════ textures (module-cached, shared) ══════════════════ */

const _tex = new Map()
function cachedTex(key, size, draw) {
  if (_tex.has(key)) return _tex.get(key)
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d'), size)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  _tex.set(key, t)
  return t
}

const glowTex = () => cachedTex('wste:glow', 128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.22, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.58, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

const coreTex = () => cachedTex('wste:core', 256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.16, 'rgba(248,248,252,0.92)')
  g.addColorStop(0.42, 'rgba(226,230,240,0.34)')
  g.addColorStop(0.74, 'rgba(200,208,224,0.07)')
  g.addColorStop(1, 'rgba(190,200,220,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

const dotTex = () => cachedTex('wste:dot', 64, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.32)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

/** Text with optional letter-spacing, drawn per-character (ctx.letterSpacing
    is not universally supported and this label set is tiny). */
function drawTracked(ctx, text, x, y, tracking) {
  if (!tracking) { ctx.fillText(text, x, y); return }
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + tracking
  }
}

/**
 * Render label lines to a canvas texture.
 * lines: [{ t, size, weight, color, tracking, alpha }]
 * Returns { tex, w, h } with w/h in CSS pixels (the sprite is scaled from
 * those so a label is the same physical size at any hero height).
 */
function labelTex(lines) {
  const dpr = 2
  const pad = 5
  const probe = document.createElement('canvas').getContext('2d')
  let w = 0
  let h = pad * 2
  const rows = lines.map((l) => {
    probe.font = `${l.weight || 600} ${l.size}px ${LBL_FONT}`
    const tr = l.tracking || 0
    const width = probe.measureText(l.t).width + tr * Math.max(0, l.t.length - 1)
    w = Math.max(w, width)
    const lh = Math.round(l.size * 1.42)
    h += lh
    return { lh, tr }
  })
  w = Math.ceil(w + pad * 2)
  h = Math.ceil(h)

  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.ceil(w * dpr))
  c.height = Math.max(2, Math.ceil(h * dpr))
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.textBaseline = 'top'
  let y = pad
  lines.forEach((l, i) => {
    ctx.font = `${l.weight || 600} ${l.size}px ${LBL_FONT}`
    ctx.fillStyle = l.color
    ctx.globalAlpha = l.alpha == null ? 1 : l.alpha
    drawTracked(ctx, l.t, pad, y + (rows[i].lh - l.size) * 0.35, rows[i].tr)
    y += rows[i].lh
  })
  ctx.globalAlpha = 1

  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  return { tex, w, h }
}

/* ══════════════════ formatting (sprite text only) ══════════════════ */
/* Deliberately NOT imported from wst-format.js: that module is the DOM data
   layer's single implementation and this file must not become a second
   consumer that could drift it. These four helpers exist only to print into a
   texture, and they follow the same conventions (U+2212 minus, grouped). */
const MINUS = '−'
const grp = (n) => Math.abs(Math.round(n)).toLocaleString('en-US')
const sgnUsdB = (n) => `${n > 0 ? '+' : n < 0 ? MINUS : ''}$${grp(n)}B`
const sgnInt = (n) => `${n > 0 ? '+' : n < 0 ? MINUS : ''}${grp(n)}`
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function shortDay(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}

/* ══════════════════ the engine ══════════════════ */

export class WorldEngine {
  constructor(host, opts = {}) {
    this.host = host
    this.isMobile = !!opts.isMobile
    this.dayMode = !!opts.dayMode
    this.running = true

    /* every AdditiveBlending material, registered for a day-mode re-blend */
    this._add = []
    this._disposables = []

    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)

    this.scene = new Scene()
    this.scene.background = new Color(BG)
    this.camera = new PerspectiveCamera(FOV, w / h, 0.5, 400)

    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this._dprCap = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.25 : 1.5)
    this.renderer.setPixelRatio(this._dprCap)
    this.renderer.setSize(w, h)
    this.renderer.domElement.className = 'wste-canvas'
    host.appendChild(this.renderer.domElement)

    /* Context loss: the browser can evict us under GPU pressure. preventDefault
       tells three a restore is coming; without it the loop renders into a dead
       context forever and the hero stays black. */
    this._onCtxLost = (e) => { e.preventDefault(); this.setRunning(false) }
    this._onCtxRestored = () => { this.setRunning(true) }
    this.renderer.domElement.addEventListener('webglcontextlost', this._onCtxLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onCtxRestored, false)

    /* camera rig — idle orbit + mouse parallax, both eased, never snapped */
    this.rig = { yaw: -0.55, pitch: 0.30, dist: 30, tYaw: 0, tPitch: 0 }
    this._par = { x: 0, y: 0, tx: 0, ty: 0 }

    this.time = 0
    this._t0 = 0
    this._sweep = -1
    this._cruiseMs = this.isMobile ? 33 : 24
    this._lastT = performance.now()
    this._lastRender = 0
    this._raf = null

    this._build()
    this._fit()
    this._bind()
    this.setDayMode(this.dayMode)
    this._kick()
  }

  /* ── static structure (built once; setDoc only swaps arcs + labels) ── */
  _build() {
    this.root = new Group()
    this.scene.add(this.root)

    this.rings = {}
    // tilts chosen so the four planes read as an armillary sphere rather than
    // a set of concentric circles: no two share a normal.
    this.rings.liq = this._ring('liq', { rx: -Math.PI / 2 + 0.30, ry: 0.10, rz: 0 })
    this.rings.fomc = this._ring('fomc', { rx: -Math.PI / 2 + 1.02, ry: 0, rz: 0.58 })
    this.rings.cot = this._ring('cot', { rx: -Math.PI / 2 - 0.62, ry: 0.72, rz: 0 })
    this.rings.st = this._ring('st', { rx: -Math.PI / 2 + 0.14, ry: -0.34, rz: 0 })

    /* ring 1 · liquidity — base track, arc, zero mark, travelling head */
    this.liqBase = this._mesh(new RingGeometry(R_LIQ - 0.16, R_LIQ + 0.16, 128, 1), C_STRUCT, 0.085)
    this.rings.liq.spin.add(this.liqBase)
    this.liqZero = this._mesh(new RingGeometry(R_LIQ - 0.46, R_LIQ + 0.46, 1, 1, -0.004, 0.008), C_STRUCT, 0.55)
    this.rings.liq.spin.add(this.liqZero)
    this.liqEnd = this._mesh(new RingGeometry(R_LIQ - 0.30, R_LIQ + 0.30, 1, 1, Math.PI - 0.003, 0.006), C_STRUCT, 0.20)
    this.rings.liq.spin.add(this.liqEnd)
    this.liqArc = { mesh: null, seg: ARC_SEG, reverse: false }
    this.liqHead = this._sprite(glowTex(), C_BEAR, 0.9)
    this.liqHead.visible = false
    this.rings.liq.spin.add(this.liqHead)

    /* ring 2 · FOMC — base track, remaining arc, meeting node */
    this.fomcBase = this._mesh(new RingGeometry(R_FOMC - 0.12, R_FOMC + 0.12, 128, 1), C_STRUCT, 0.075)
    this.rings.fomc.spin.add(this.fomcBase)
    this.fomcArc = { mesh: null, seg: ARC_SEG, reverse: true }
    this.fomcNode = this._sprite(glowTex(), C_AMBER, 0.95)
    this.fomcNode.position.set(R_FOMC, 0, 0)
    this.fomcNode.scale.setScalar(1.5)
    this.fomcNode.visible = false
    this.rings.fomc.spin.add(this.fomcNode)

    /* ring 3 · CME positioning — two counter-rotating half-rings */
    this.cotBase = this._mesh(new RingGeometry(R_COT - 0.06, R_COT + 0.06, 128, 1), C_STRUCT, 0.07)
    this.rings.cot.spin.add(this.cotBase)
    this.cotLevSpin = new Group()
    this.cotAmSpin = new Group()
    this.rings.cot.spin.add(this.cotLevSpin, this.cotAmSpin)
    this.cotLev = { mesh: null, seg: ARC_SEG, reverse: false }
    this.cotAm = { mesh: null, seg: ARC_SEG, reverse: false }

    /* ring 4 · stablecoin atmosphere — a fixed particle band */
    this.stGuide = this._mesh(new RingGeometry(R_ST - 0.03, R_ST + 0.03, 96, 1), C_STRUCT, 0.10)
    this.rings.st.spin.add(this.stGuide)
    this.stPoints = this._particles(this.isMobile ? 520 : 900)
    this.rings.st.spin.add(this.stPoints)

    /* core */
    this.core = this._sprite(coreTex(), C_STRUCT, 0.9)
    this.core.scale.setScalar(1.7)
    this.root.add(this.core)
    this.coreHalo = this._sprite(glowTex(), C_STRUCT, 0.22)
    this.coreHalo.scale.setScalar(4.6)
    this.root.add(this.coreHalo)

    /* The stars are the only element in this scene that is not a measurement,
       and they are deliberately the only KIND of element that could not be
       mistaken for one. No decorative meridians, no frame rings, no guide
       arcs: an absent force renders as a dim still ring, so any dim ring that
       meant nothing would be indistinguishable from a missing report. */
    this._buildStars()

    /* labels — children of the TILT group, not the spin group, so they hold
       still while the ring turns underneath them. Angles are hand-placed to
       four separate quadrants; the camera oscillates rather than orbiting a
       full revolution precisely so those placements hold. */
    this.labels = this.isMobile ? {
      /* A 390px stage cannot hold six labels: a label is sized in SCREEN
         pixels, so six of them eat the frame and the outer two run off it.
         The phone keeps the two the masthead is about — the tide and the
         countdown — plus the regime word, at fixed spots that the camera sway
         cannot push off-frame. Rings three and four still SHOW their state
         (arc, thickness, spin, particles) and still go still and dim when
         their report is missing; their figures are printed in the bands a
         screen below, which is where a phone reader reads them anyway. */
      liq: this._label(this.root, -3.4, 4.5, 0.5),
      fomc: this._label(this.root, 3.4, 4.5, 0.5),
      lev: this._label(this.rings.cot.tilt, 0, 0, 0.5),
      am: this._label(this.rings.cot.tilt, 0, 0, 0.5),
      st: this._label(this.rings.st.tilt, 0, 0, 0.5),
      core: this._label(this.root, 0, -4.7, 0.5),
    } : {
      liq: this._labelAt(this.rings.liq, R_LIQ + 0.75, Math.PI * 0.98),
      fomc: this._labelAt(this.rings.fomc, R_FOMC + 0.7, 1.30),
      lev: this._labelAt(this.rings.cot, R_COT + 0.9, 3.72),
      am: this._labelAt(this.rings.cot, R_COT + 1.0, -0.92),
      st: this._labelAt(this.rings.st, R_ST + 2.4, 2.55),
      core: this._label(this.root, 0, -3.15, 0.5),
    }
  }

  /** On a phone, rings 3 and 4 speak through geometry alone. */
  _hide(slot) {
    slot.sprite.visible = false
    slot.sprite.material.opacity = 0
  }

  _buildStars() {
    const n = this.isMobile ? 200 : 380
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1
      const th = Math.random() * TAU
      const r = 34 + Math.random() * 56
      const s = Math.sqrt(1 - u * u)
      pos[i * 3] = Math.cos(th) * s * r
      pos[i * 3 + 1] = u * r
      pos[i * 3 + 2] = Math.sin(th) * s * r
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    const mat = new PointsMaterial({
      size: 0.42, color: C_DIM, transparent: true, opacity: 0.55,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
      map: dotTex(),
    })
    mat._sharedMap = true
    this._add.push(mat)
    this.stars = new Points(geo, mat)
    this.scene.add(this.stars)
  }

  /** Place a label on a ring's own plane, at `a` radians from its zero mark. */
  _labelAt(ring, radius, a) {
    return this._label(
      ring.tilt,
      Math.cos(a) * radius,
      Math.sin(a) * radius,
      Math.cos(a) < -0.15 ? 1 : Math.cos(a) > 0.15 ? 0 : 0.5,
    )
  }

  _ring(key, tilt) {
    const g = new Group()
    g.rotation.set(tilt.rx, tilt.ry, tilt.rz)
    const spin = new Group()
    g.add(spin)
    this.root.add(g)
    return { key, tilt: g, spin, rate: 0 }
  }

  _mesh(geo, color, opacity) {
    const mat = new MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide,
    })
    this._add.push(mat)
    const m = new Mesh(geo, mat)
    m.userData.baseOpacity = opacity
    return m
  }

  _sprite(map, color, opacity) {
    const mat = new SpriteMaterial({
      map, color, transparent: true, opacity, depthWrite: false,
      depthTest: false, blending: AdditiveBlending,
    })
    mat._sharedMap = true
    this._add.push(mat)
    const s = new Sprite(mat)
    s.userData.baseOpacity = opacity
    return s
  }

  _particles(count) {
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU
      const r = R_ST + (Math.random() - 0.5) * 0.78
      const z = (Math.random() - 0.5) * 0.5
      pos[i * 3] = Math.cos(a) * r
      pos[i * 3 + 1] = Math.sin(a) * r
      pos[i * 3 + 2] = z
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    const mat = new PointsMaterial({
      size: 0.075, color: C_STRUCT, transparent: true, opacity: 0.5,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
      map: dotTex(),
    })
    mat._sharedMap = true
    this._add.push(mat)
    const p = new Points(geo, mat)
    p.userData.baseOpacity = 0.5
    return p
  }

  /** A repositionable label slot. cx: sprite anchor (0 = grows right, 1 = left). */
  _label(parent, x, y, cx) {
    // sizeAttenuation OFF is load-bearing, not a preference: it is what makes
    // the label a constant SCREEN size, which is what _layoutLabel's scale
    // maths assumes. With it on, a 0.03-unit sprite 27 units away is invisible.
    const mat = new SpriteMaterial({
      transparent: true, opacity: 0, depthWrite: false, depthTest: false,
      sizeAttenuation: false,
    })
    const s = new Sprite(mat)
    s.center.set(cx, 0.5)
    s.position.set(x, y, 0)
    s.renderOrder = 10
    s.visible = false
    parent.add(s)
    return { sprite: s, w: 1, h: 1 }
  }

  _setLabel(slot, lines) {
    const { tex, w, h } = labelTex(lines)
    const mat = slot.sprite.material
    if (mat.map) mat.map.dispose()
    mat.map = tex
    mat.opacity = 1
    mat.needsUpdate = true
    slot.w = w
    slot.h = h
    slot.sprite.visible = true
    this._layoutLabel(slot)
  }

  /** Constant on-screen size: with sizeAttenuation off, screen-height fraction
      = 0.5 * scale / tan(fov/2), so scale = 2 * fraction * tan(fov/2). */
  _layoutLabel(slot) {
    const hostH = Math.max(1, this.host.clientHeight)
    const px = slot.h
    const scaleY = 2 * (px / hostH) * Math.tan((FOV * Math.PI) / 360)
    slot.sprite.scale.set(scaleY * (slot.w / slot.h), scaleY, 1)
  }

  _layoutLabels() {
    for (const k in this.labels) this._layoutLabel(this.labels[k])
  }

  /* ── data ─────────────────────────────────────────────────────────────── */

  /**
   * Rebuild every data-driven geometry. Called on mount and whenever the
   * document version changes — at most once per 5-minute poll, never per
   * frame.
   */
  setDoc(doc, nowMs = Date.now()) {
    this.doc = doc || null
    this._t0 = this.time // restart the reveal against the current clock

    this._liq(doc?.net_liquidity)
    this._fomc(doc?.rates, nowMs)
    this._cot(doc?.cot_btc)
    this._stables(doc?.stablecoins)
    this._core(doc?.markets)

    this._kick()
  }

  _swapArc(slot, parent, geo, color, opacity, rotZ) {
    if (slot.mesh) {
      parent.remove(slot.mesh)
      slot.mesh.geometry.dispose()
      const i = this._add.indexOf(slot.mesh.material)
      if (i >= 0) this._add.splice(i, 1)
      slot.mesh.material.dispose()
      slot.mesh = null
    }
    if (!geo) return
    const m = this._mesh(geo, color, opacity)
    m.rotation.z = rotZ || 0
    m.geometry.setDrawRange(0, 0)
    parent.add(m)
    slot.mesh = m
  }

  /** RING 1 — the tide. Half a revolution = $300B, the tide band's own scale. */
  _liq(nl) {
    const chg = finite(nl?.chg_4w_usd_b)
    const level = finite(nl?.usd_b)
    this.liqSign = chg == null ? 0 : Math.sign(chg)
    this.liqFrac = chg == null ? 0 : Math.min(Math.abs(chg) / LIQ_SCALE_B, 1)

    const inert = chg == null
    this.rings.liq.rate = inert ? 0 : -0.048 * (this.liqSign || 1)
    this.liqBase.material.opacity = inert ? 0.05 : 0.085
    this.liqZero.visible = !inert
    this.liqEnd.visible = !inert

    if (inert) {
      this._swapArc(this.liqArc, this.rings.liq.spin, null)
      this.liqHead.visible = false
      this.rings.liq.tilt.rotation.z = 0
      this._setLabel(this.labels.liq, this.isMobile ? [
        { t: 'NO LIQUIDITY READ', size: 11, weight: 700, tracking: 0.8, color: '#a9a9b2' },
      ] : [
        { t: 'NET LIQUIDITY', size: 10, weight: 700, tracking: 1.6, color: '#8b8b93' },
        { t: 'NO READ ON FILE', size: 13, weight: 600, color: '#a9a9b2' },
      ])
      return
    }

    const len = this.liqFrac * Math.PI
    const geo = new RingGeometry(R_LIQ - 0.24, R_LIQ + 0.24, ARC_SEG, 1, 0, len)
    const col = this.liqSign < 0 ? C_BEAR : C_BULL
    // geometry always runs 0 → len so the reveal grows OUT of the zero mark;
    // a drain is placed by rotating the finished arc to the left of zero.
    this._swapArc(this.liqArc, this.rings.liq.spin, geo, col, 0.62, this.liqSign < 0 ? -len : 0)
    this.liqArcLen = len
    this.liqHead.material.color.setHex(col)
    this.liqHead.scale.setScalar(1.15)
    this.liqHead.visible = true

    const tint = this.liqSign < 0 ? '#f08a86' : '#5fd3ae'
    /* The mobile variant drops the eyebrow's long third line rather than
       shrinking it: a label is sized as a fraction of the STAGE, so a 180px
       line that reads as a caption on desktop is 41% of a 438px phone stage
       and runs straight off the frame. Every value it drops is printed in the
       band two screens down. */
    this._setLabel(this.labels.liq, this.isMobile ? [
      { t: 'NET LIQUIDITY', size: 9, weight: 700, tracking: 1.2, color: '#9a9aa3' },
      { t: sgnUsdB(chg), size: 19, weight: 700, color: tint },
    ] : [
      { t: 'NET LIQUIDITY', size: 10, weight: 700, tracking: 1.6, color: '#9a9aa3' },
      { t: sgnUsdB(chg), size: 26, weight: 700, color: tint },
      {
        t: level != null ? `FOUR WEEKS · LEVEL $${grp(level)}B` : 'FOUR WEEKS',
        size: 10, weight: 600, tracking: 0.8, color: '#8b8b93',
      },
    ])
  }

  /** RING 2 — the countdown. Lit arc = time REMAINING, ending at the node. */
  _fomc(rates, nowMs) {
    const iso = typeof rates?.next_fomc === 'string' ? rates.next_fomc : null
    const t = iso ? Date.parse(iso) : NaN
    const msLeft = Number.isFinite(t) ? t - nowMs : NaN
    const has = Number.isFinite(msLeft) && msLeft > -DAY_MS

    this.rings.fomc.rate = has ? 0.021 : 0
    this.fomcBase.material.opacity = has ? 0.075 : 0.05
    this.fomcNode.visible = has

    if (!has) {
      this._swapArc(this.fomcArc, this.rings.fomc.spin, null)
      this._setLabel(this.labels.fomc, this.isMobile ? [
        { t: 'NO FOMC ON FILE', size: 11, weight: 700, tracking: 0.8, color: '#a9a9b2' },
      ] : [
        { t: 'FOMC', size: 10, weight: 700, tracking: 1.6, color: '#8b8b93' },
        { t: 'NO MEETING ON THE CALENDAR', size: 12, weight: 600, color: '#a9a9b2' },
      ])
      return
    }

    const days = Math.max(0, msLeft) / DAY_MS
    const frac = Math.min(days / FOMC_CYCLE_D, 1)
    const len = Math.max(frac * TAU, 0.02)
    const geo = new RingGeometry(R_FOMC - 0.18, R_FOMC + 0.18, ARC_SEG, 1, 0, len)
    this._swapArc(this.fomcArc, this.rings.fomc.spin, geo, C_STRUCT, 0.34, -len)

    const d = Math.floor(days)
    const hrs = Math.floor((days - d) * 24)
    this._setLabel(this.labels.fomc, this.isMobile ? [
      { t: 'NEXT FOMC', size: 9, weight: 700, tracking: 1.2, color: '#9a9aa3' },
      { t: `${d}d`, size: 17, weight: 700, color: '#f0efe9' },
      { t: shortDay(iso) || '', size: 9, weight: 600, tracking: 0.8, color: '#e0b060' },
    ] : [
      { t: 'NEXT FOMC', size: 10, weight: 700, tracking: 1.6, color: '#9a9aa3' },
      { t: `${d}d ${hrs}h`, size: 22, weight: 700, color: '#f0efe9' },
      { t: shortDay(iso) || '', size: 11, weight: 600, tracking: 1.1, color: '#e0b060' },
    ])
  }

  /** RING 3 — the tug of war. Thickness = share of open interest. */
  _cot(cot) {
    const oi = finite(cot?.open_interest)
    const lev = finite(cot?.leveraged_funds_net)
    const am = finite(cot?.asset_managers_net)
    const has = oi != null && oi > 0 && (lev != null || am != null)

    this.cotBase.material.opacity = has ? 0.07 : 0.05

    if (!has) {
      this._swapArc(this.cotLev, this.cotLevSpin, null)
      this._swapArc(this.cotAm, this.cotAmSpin, null)
      this.rings.cot.rate = 0
      this.cotLevRate = 0
      this.cotAmRate = 0
      if (this.isMobile) { this._hide(this.labels.lev) } else {
        this._setLabel(this.labels.lev, [
          { t: 'CME POSITIONING', size: 10, weight: 700, tracking: 1.6, color: '#8b8b93' },
          { t: 'NO REPORT ON FILE', size: 13, weight: 600, color: '#a9a9b2' },
        ])
      }
      this._hide(this.labels.am)
      return
    }

    this.rings.cot.rate = 0.012
    const th = (n) => 0.09 + 0.52 * Math.min(Math.abs(n) / oi, 1)

    if (this.isMobile) { this._hide(this.labels.lev); this._hide(this.labels.am) }

    if (lev != null) {
      const t1 = th(lev)
      this._swapArc(
        this.cotLev, this.cotLevSpin,
        new RingGeometry(R_COT + 0.10, R_COT + 0.10 + t1, ARC_SEG, 1, 0, Math.PI * 0.86),
        lev < 0 ? C_BEAR : C_BULL, 0.5, 0,
      )
      this.cotLevRate = 0.085 * (lev < 0 ? -1 : 1)
      if (!this.isMobile) {
        this._setLabel(this.labels.lev, [
          { t: 'LEVERAGED FUNDS', size: 10, weight: 700, tracking: 1.6, color: '#9a9aa3' },
          { t: sgnInt(lev), size: 17, weight: 700, color: lev < 0 ? '#f08a86' : '#5fd3ae' },
        ])
      }
    } else {
      this._swapArc(this.cotLev, this.cotLevSpin, null)
      this.cotLevRate = 0
      if (!this.isMobile) {
        this._setLabel(this.labels.lev, [
          { t: 'LEVERAGED FUNDS', size: 10, weight: 700, tracking: 1.6, color: '#8b8b93' },
          { t: 'NOT IN THIS REPORT', size: 12, weight: 600, color: '#a9a9b2' },
        ])
      }
    }

    if (am != null) {
      const t2 = th(am)
      this._swapArc(
        this.cotAm, this.cotAmSpin,
        new RingGeometry(R_COT - 0.10 - t2, R_COT - 0.10, ARC_SEG, 1, Math.PI, Math.PI * 0.86),
        am < 0 ? C_BEAR : C_BULL, 0.5, 0,
      )
      this.cotAmRate = 0.085 * (am < 0 ? -1 : 1)
      if (!this.isMobile) {
        this._setLabel(this.labels.am, [
          { t: 'ASSET MANAGERS', size: 10, weight: 700, tracking: 1.6, color: '#9a9aa3' },
          { t: sgnInt(am), size: 17, weight: 700, color: am < 0 ? '#f08a86' : '#5fd3ae' },
        ])
      }
    } else {
      this._swapArc(this.cotAm, this.cotAmSpin, null)
      this.cotAmRate = 0
      if (!this.isMobile) {
        this._setLabel(this.labels.am, [
          { t: 'ASSET MANAGERS', size: 10, weight: 700, tracking: 1.6, color: '#8b8b93' },
          { t: 'NOT IN THIS REPORT', size: 12, weight: 600, color: '#a9a9b2' },
        ])
      }
    }
  }

  /** RING 4 — the float. Breath DIRECTION is the seven-day sign. */
  _stables(st) {
    const total = finite(st?.total_usd_b)
    const chg = finite(st?.chg_7d_pct)
    this.stSign = chg == null ? 0 : Math.sign(chg)
    const has = total != null

    this.stPoints.visible = has
    this.stGuide.material.opacity = has ? 0.10 : 0.05
    this.rings.st.rate = has ? 0.030 : 0

    if (this.isMobile) this._hide(this.labels.st)

    if (!has) {
      if (!this.isMobile) {
        this._setLabel(this.labels.st, [
          { t: 'STABLECOIN FLOAT', size: 10, weight: 700, tracking: 1.6, color: '#8b8b93' },
          { t: 'NO FLOAT ON FILE', size: 12, weight: 600, color: '#a9a9b2' },
        ])
      }
      return
    }

    const pct = chg == null ? null
      : `${chg > 0 ? '+' : chg < 0 ? MINUS : ''}${Math.abs(chg).toFixed(2)}% 7D`
    if (this.isMobile) return
    this._setLabel(this.labels.st, [
      { t: 'STABLECOIN FLOAT', size: 10, weight: 700, tracking: 1.6, color: '#9a9aa3' },
      { t: `$${grp(total)}B`, size: 20, weight: 700, color: '#f0efe9' },
      pct
        ? { t: pct, size: 11, weight: 600, tracking: 0.6, color: chg < 0 ? '#f08a86' : '#5fd3ae' }
        : { t: 'SEVEN-DAY CHANGE NOT REPORTED', size: 9, weight: 600, tracking: 0.6, color: '#8b8b93' },
    ])
  }

  /** CORE — the pulse SHAPE is the regime word. */
  _core(markets) {
    const regime = typeof markets?.regime === 'string' && markets.regime.trim()
      ? markets.regime.trim().toLowerCase()
      : null
    this.regime = regime
    this.coreChop = regime === 'chop' || regime === 'choppy' || regime === 'range'
    this._setLabel(this.labels.core, regime
      ? [{ t: regime.toUpperCase(), size: this.isMobile ? 9 : 11, weight: 700, tracking: this.isMobile ? 1.6 : 2.2, color: '#c9c9d2' }]
      : [{ t: 'NO REGIME ON FILE', size: this.isMobile ? 8 : 10, weight: 700, tracking: 1.4, color: '#8b8b93' }])
  }

  /* ── the heartbeat, made visible ──────────────────────────────────────── */
  /** One slow bright revolution sweep — fired when the edition increments. */
  pulse() {
    this._sweep = 0
    this._kick()
  }

  /* ── theme ────────────────────────────────────────────────────────────── */
  setDayMode(on) {
    this.dayMode = !!on
    // The stage stays dark (see the file header). Day mode only trims the
    // bloom so the card doesn't blaze beside white page chrome. `this._add`
    // holds every additive material if a full re-blend is ever wanted.
    this._bloom = on ? 0.82 : 1
    this._kick()
  }

  /* ── lifecycle ────────────────────────────────────────────────────────── */
  setRunning(on) {
    const next = !!on
    if (next === this.running) { if (next) this._kick(); return }
    this.running = next
    if (next) { this._lastT = performance.now(); this._kick() } else if (this._raf) {
      cancelAnimationFrame(this._raf)
      this._raf = null
    }
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.camera.aspect = w / h
    this._fit()
    this.renderer.setSize(w, h)
    this._layoutLabels()
    this._kick()
  }

  _fit() {
    const aspect = this.camera.aspect || 1
    // Labels are a fraction of the STAGE, not of the world, so a phone-sized
    // stage needs the armillary pulled back to leave them a margin to sit in.
    let dist = (NEED * (this.isMobile ? 1.22 : 1)) / Math.tan((FOV * Math.PI) / 360)
    // a narrow hero is width-bound, so pull back until the outer ring fits
    if (aspect < 1.18) dist *= 1.18 / Math.max(aspect, 0.5)
    this.rig.dist = dist
    this.camera.updateProjectionMatrix()
  }

  _bind() {
    this._onPointer = (e) => {
      if (e.pointerType === 'touch') return // never fight a scrolling finger
      const r = this.host.getBoundingClientRect()
      if (!r.width || !r.height) return
      this._par.tx = ((e.clientX - r.left) / r.width - 0.5) * 2
      this._par.ty = ((e.clientY - r.top) / r.height - 0.5) * 2
      this._kick()
    }
    this._onLeave = () => { this._par.tx = 0; this._par.ty = 0 }
    this.host.addEventListener('pointermove', this._onPointer, { passive: true })
    this.host.addEventListener('pointerleave', this._onLeave, { passive: true })
    this._onVis = () => { if (!document.hidden) { this._lastT = performance.now(); this._kick() } }
    document.addEventListener('visibilitychange', this._onVis)
  }

  _kick() {
    if (this._raf == null && this.running) this._raf = requestAnimationFrame(this._frame)
  }

  /* ══════════════════ frame (zero allocation past this line) ══════════════ */
  _frame = () => {
    this._raf = null
    if (!this.running || document.hidden) return

    const now = performance.now()
    if (now - this._lastRender < this._cruiseMs) {
      this._raf = requestAnimationFrame(this._frame)
      return
    }
    const dt = Math.min(0.05, (now - this._lastT) / 1000)
    this._lastT = now
    this._lastRender = now
    this.time += dt

    /* reveal + version sweep */
    const rev = clamp01((this.time - this._t0) / REVEAL_S)
    if (this._sweep >= 0) {
      this._sweep += dt / 2.6
      if (this._sweep > 1) this._sweep = -1
    }
    const sw = this._sweep
    const bloom = this._bloom == null ? 1 : this._bloom

    /* ring 1 — arc grows out of the zero mark, head flows in the drain sense */
    const p1 = easeOut(clamp01((rev - 0) / 0.75))
    this._reveal(this.liqArc, p1)
    if (this.liqArc.mesh) {
      const breathe = 1 + Math.sin(this.time * 0.55) * 0.06
      this.liqArc.mesh.material.opacity = 0.62 * breathe * bloom * this._swBoost(sw, 0)
    }
    if (this.liqHead.visible && this.liqArcLen) {
      const f = (this.time * 0.30) % 1
      const a = (this.liqSign < 0 ? -1 : 1) * f * this.liqArcLen
      this.liqHead.position.set(Math.cos(a) * R_LIQ, Math.sin(a) * R_LIQ, 0)
      this.liqHead.material.opacity = (0.25 + 0.65 * Math.sin(f * Math.PI)) * p1 * bloom
    }

    /* ring 2 — the countdown arc, revealed back from the meeting node */
    const p2 = easeOut(clamp01((rev - 0.12) / 0.72))
    this._reveal(this.fomcArc, p2)
    if (this.fomcArc.mesh) {
      this.fomcArc.mesh.material.opacity = 0.34 * bloom * this._swBoost(sw, 0.16)
    }
    if (this.fomcNode.visible) {
      const beat = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 1.9))
      this.fomcNode.material.opacity = beat * p2 * bloom
    }

    /* ring 3 — the two legs turn against each other */
    const p3 = easeOut(clamp01((rev - 0.24) / 0.7))
    this._reveal(this.cotLev, p3)
    this._reveal(this.cotAm, p3)
    this.cotLevSpin.rotation.z += (this.cotLevRate || 0) * dt
    this.cotAmSpin.rotation.z += (this.cotAmRate || 0) * dt
    if (this.cotLev.mesh) this.cotLev.mesh.material.opacity = 0.5 * bloom * this._swBoost(sw, 0.3)
    if (this.cotAm.mesh) this.cotAm.mesh.material.opacity = 0.5 * bloom * this._swBoost(sw, 0.3)

    /* ring 4 — the float breathes in the direction of its seven-day sign */
    const p4 = easeOut(clamp01((rev - 0.34) / 0.66))
    if (this.stPoints.visible) {
      const br = Math.sin(this.time * 0.42)
      const dir = this.stSign < 0 ? -1 : 1
      this.stPoints.scale.setScalar(1 + dir * br * 0.035)
      this.stPoints.material.opacity = (0.34 + 0.2 * (0.5 + 0.5 * dir * br)) * p4 * bloom * this._swBoost(sw, 0.44)
      this.stPoints.material.size = 0.07 + 0.012 * br * dir
    }

    /* core — regime decides the SHAPE of the beat, not its brightness */
    let cp
    if (this.regime == null) cp = 0.30
    else if (this.coreChop) {
      cp = 0.52
        + 0.20 * Math.sin(this.time * 2.3)
        + 0.16 * Math.sin(this.time * 5.7 + 1.3)
        + 0.10 * Math.sin(this.time * 11.3 + 0.7)
    } else {
      cp = 0.62 + 0.24 * Math.sin(this.time * 1.15)
    }
    const cRev = easeOut(clamp01(rev / 0.5))
    this.core.material.opacity = cp * cRev * bloom * this._swBoost(sw, 0.56)
    this.core.scale.setScalar(1.55 + cp * 0.4)
    this.coreHalo.material.opacity = 0.11 * cp * cRev * bloom
    this.coreHalo.scale.setScalar(4.3 + cp * 1.1)

    /* ring spin (plus the sweep's extra revolution) */
    for (const k in this.rings) {
      const r = this.rings[k]
      r.spin.rotation.z += r.rate * dt
    }
    if (sw >= 0) {
      const e = easeOut(clamp01(sw))
      const prev = this._sweepE == null ? 0 : this._sweepE
      const d = (e - prev) * TAU
      this._sweepE = e
      for (const k in this.rings) this.rings[k].spin.rotation.z += d * (this.rings[k].rate < 0 ? -1 : 1)
    } else {
      this._sweepE = 0
    }

    /* Camera: a slow OSCILLATION, not a revolution, plus eased mouse parallax.
       A full orbit would swing every label through every other label's screen
       position; a ±0.17rad sway over 40 seconds gives the scene its drift and
       keeps the four labels in the four quadrants they were placed in. */
    this._par.x += (this._par.tx - this._par.x) * Math.min(1, dt * 2.6)
    this._par.y += (this._par.ty - this._par.y) * Math.min(1, dt * 2.6)
    if (this.stars) this.stars.rotation.y += dt * 0.004
    const yaw = this.rig.yaw + Math.sin(this.time * 0.157) * 0.17 + this._par.x * 0.19
    const pitch = MathUtils.clamp(
      this.rig.pitch + Math.sin(this.time * 0.098) * 0.035 - this._par.y * 0.13,
      0.06, 0.72,
    )
    const cd = Math.cos(pitch) * this.rig.dist
    this.camera.position.set(Math.sin(yaw) * cd, Math.sin(pitch) * this.rig.dist, Math.cos(yaw) * cd)
    this.camera.lookAt(0, 0, 0)

    this.renderer.render(this.scene, this.camera)
    this._raf = requestAnimationFrame(this._frame)
  }

  /** Arc reveal by index range — no geometry is rebuilt, nothing allocates. */
  _reveal(slot, p) {
    const m = slot.mesh
    if (!m) return
    const seg = Math.round(slot.seg * clamp01(p))
    if (slot.reverse) m.geometry.setDrawRange((slot.seg - seg) * 6, seg * 6)
    else m.geometry.setDrawRange(0, seg * 6)
    m.visible = seg > 0
  }

  /** The sweep's brightening bell, delayed per ring so it travels outward-in. */
  _swBoost(sw, delay) {
    if (sw < 0) return 1
    const x = (sw - delay) / 0.34
    if (x <= -1 || x >= 1) return 1
    return 1 + 1.5 * (1 - x * x)
  }

  dispose() {
    this.setRunning(false)
    document.removeEventListener('visibilitychange', this._onVis)
    this.host.removeEventListener('pointermove', this._onPointer)
    this.host.removeEventListener('pointerleave', this._onLeave)
    const el = this.renderer.domElement
    el.removeEventListener('webglcontextlost', this._onCtxLost)
    el.removeEventListener('webglcontextrestored', this._onCtxRestored)

    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      const m = o.material
      if (!m) return
      // label textures are per-instance and must go; the shared procedural
      // atlas (glow/core/dot) is module-cached and outlives this engine
      if (m.map && !m._sharedMap) m.map.dispose()
      m.dispose()
    })
    // dispose() frees programs and render targets but NOT the WebGL context;
    // without forceContextLoss every remount leaks one and Chrome kills the
    // oldest at ~16, leaving a permanently black canvas.
    try { this.renderer.forceContextLoss() } catch { /* already lost */ }
    this.renderer.dispose()
    if (el.parentNode) el.parentNode.removeChild(el)
    this._add.length = 0
  }
}

export default WorldEngine
