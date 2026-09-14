/**
 * arn-colosseum — THE ARENA, at night, in WebGL.
 *
 * Twelve machine books race a lit circular track inside a dark bowl. Vanilla
 * three.js, no R3F, sprite-based throughout — the same register as the Cosmos
 * engine (src/components/cosmos/cosmos-engine.js), whose thermals, picking and
 * dispose discipline this file copies deliberately.
 *
 * ── WHAT EVERY MARK MEANS ───────────────────────────────────────────────────
 *  angle on the track   total_return_pct. The lit START GATE is the balance
 *                       each book opened with; half a lap is SPAN points.
 *                       A book under water stands SHORT of the gate, always.
 *  lane (radius)        SPACING ONLY, assigned by interleaving the return
 *                       order so the two books closest in position sit
 *                       farthest apart in depth. No reader should decode it.
 *  outer warm-up lane   closed < 15. Building a record is not losing one.
 *  wake length          |total_return_pct| — the size of the result so far.
 *  wake flow + glow     weekly_pnl_pct. It is a PACE, not travel: a runner
 *                       holds its angle, because that angle is a measured
 *                       number and drifting it forward would be a forecast.
 *                       A book moves when its record moves, and never before.
 *  colour               sign of the return. Bull #10B981 / bear #EF4444.
 *  sparks + stagger     one real close off the tape with reason hard_stop or
 *                       doa_stop. Flare + crowd ripple = a winning close.
 *                       Nothing else in this file can emit a particle.
 *  the bench            active = false, seated under a cold spotlight.
 *  the jumbotron        the page's own h1, top three by return, latest close.
 *
 * ── DAY MODE ────────────────────────────────────────────────────────────────
 * The scene stays NIGHT in day mode, on purpose and by precedent: a stadium at
 * night IS the exhibit, and the liquidation heatmap's canvas card is already
 * documented as deliberately dark under `.liqp.day-mode`. Day mode instead
 * frames it as a dark media plate with a hairline rim (see arena-page.css) so
 * it reads as a screen rather than a hole. Every additive material is still
 * registered in `_additives` so a future re-blend has one place to reach.
 *
 * ── PERF ────────────────────────────────────────────────────────────────────
 * antialias off · DPR capped 1.5 desktop / 1.25 mobile · ~40fps governor
 * (30 on mobile) · document.hidden full stop · IntersectionObserver full stop
 * · 5-minute idle stop via lib/idleManager · every pool pre-allocated, zero
 * per-frame allocation · full dispose (geometries, materials, textures,
 * forceContextLoss) · `three` reaches this file ONLY through the dynamic
 * import in arn-stage.jsx, so it never lands on the arena page's own chunk.
 */
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Sprite, SpriteMaterial,
  CanvasTexture, SRGBColorSpace, LinearFilter, Color, FogExp2,
  BufferGeometry, Float32BufferAttribute, Points, PointsMaterial,
  LineBasicMaterial, LineLoop, Mesh, CircleGeometry,
  MeshBasicMaterial, AdditiveBlending, Vector3,
} from 'three'
import { subscribeActivity } from '@/lib/idleManager'

/* ── world ─────────────────────────────────────────────────────────────── */
const SPAN = 80              // points of return = half a lap
const R_MID = 92             // centre radius of the ranked lanes
const LANE_STEP = 4.6
const WARM_GAP = 8
const R_GATE_IN = 70         // the gate straddles every lane, warm-up included
const R_GATE_OUT = 136
const R_BENCH = 138
const R_STAND_0 = 148
const TIERS = 7
const TIER_DR = 11
const TIER_DY = 8.5
const SECTORS = 24           // crowd is split into sectors so a ripple is 24
                             // material writes per frame, not 18,000 floats

const WAKE_N = 8
const SPARK_N = 360
const RUN_FRAMES = 6

const BULL = 0x10b981
const BEAR = 0xef4444
const WARM_WHITE = 0xf5f5f7

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
const easeOut = (t) => 1 - (1 - t) ** 3

/* ── procedural textures (module-cached, baked once) ───────────────────── */
const _tex = new Map()

function canvasTex(key, w, h, draw) {
  if (_tex.has(key)) return _tex.get(key)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  _tex.set(key, t)
  return t
}

const glowTex = () => canvasTex('arn:glow', 128, 128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.22, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
})

const beamTex = () => canvasTex('arn:beam', 64, 256, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, 'rgba(255,255,255,0.42)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.14)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  // a soft-edged shaft: narrow at the lamp, wide at the floor
  ctx.beginPath()
  ctx.moveTo(w * 0.40, 0)
  ctx.lineTo(w * 0.60, 0)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()
})

const gateTex = () => canvasTex('arn:gate', 32, 256, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, h, 0, 0)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.42)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(w * 0.28, 0, w * 0.44, h)
})

/**
 * The runners are CHARACTERS, not dots: a luminous humanoid silhouette baked
 * at six stride phases. Sprites, not skeletal meshes — the stride is a texture
 * swap at the gait rate, which costs one material touch per runner per step.
 */
function runnerTex(frame) {
  return canvasTex(`arn:run:${frame}`, 128, 128, (ctx, S) => {
    const ph = (frame / RUN_FRAMES) * Math.PI * 2
    const H = S * 0.80
    const gy = S * 0.95
    const x0 = S * 0.50
    const hipY = gy - H * 0.46
    const L1 = H * 0.245
    const L2 = H * 0.235
    const sw = 0.62
    const kb = 0.95
    const lean = 0.20

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(255,255,255,0.9)'
    ctx.shadowBlur = S * 0.09
    ctx.lineWidth = H * 0.085

    for (let k = 0; k < 2; k++) {
      const th = ph + k * Math.PI
      const hipA = sw * Math.sin(th)
      const kneeA = kb * clamp(-Math.sin(th - 0.8), 0, 1)
      const kx = x0 + Math.sin(hipA) * L1
      const ky = hipY + Math.cos(hipA) * L1
      const sa = hipA - kneeA
      ctx.globalAlpha = k === 0 ? 1 : 0.82
      ctx.beginPath()
      ctx.moveTo(x0, hipY)
      ctx.lineTo(kx, ky)
      ctx.lineTo(kx + Math.sin(sa) * L2, Math.min(gy, ky + Math.cos(sa) * L2))
      ctx.stroke()
    }

    const sl = Math.sin(lean)
    const cl = Math.cos(lean)
    const neckX = x0 + sl * H * 0.34
    const neckY = hipY - cl * H * 0.34
    const shX = x0 + sl * H * 0.28
    const shY = hipY - cl * H * 0.28

    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.moveTo(x0, hipY)
    ctx.lineTo(neckX, neckY)
    ctx.stroke()

    ctx.globalAlpha = 0.72
    ctx.lineWidth = H * 0.068
    for (let k = 0; k < 2; k++) {
      const th = ph + k * Math.PI + Math.PI
      const shA = sw * 0.8 * Math.sin(th)
      const elA = shA - 0.55 * clamp(Math.sin(th + 0.4), 0, 1)
      const ex = shX + Math.sin(shA) * H * 0.17
      const ey = shY + Math.cos(shA) * H * 0.17
      ctx.beginPath()
      ctx.moveTo(shX, shY)
      ctx.lineTo(ex, ey)
      ctx.lineTo(ex + Math.sin(elA) * H * 0.16, ey + Math.cos(elA) * H * 0.16)
      ctx.stroke()
    }

    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(neckX + sl * H * 0.11, neckY - cl * H * 0.11, H * 0.105, 0, Math.PI * 2)
    ctx.fill()
  })
}

const seatedTex = () => canvasTex('arn:seated', 128, 128, (ctx, S) => {
  const H = S * 0.66
  const gy = S * 0.95
  const x0 = S * 0.46
  const seatY = gy - H * 0.42
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(255,255,255,0.55)'
  ctx.shadowBlur = S * 0.05

  ctx.globalAlpha = 0.38
  ctx.lineWidth = H * 0.05
  ctx.beginPath()
  ctx.moveTo(x0 - H * 0.62, seatY); ctx.lineTo(x0 + H * 0.52, seatY)
  ctx.moveTo(x0 - H * 0.50, seatY); ctx.lineTo(x0 - H * 0.50, gy)
  ctx.moveTo(x0 + H * 0.40, seatY); ctx.lineTo(x0 + H * 0.40, gy)
  ctx.stroke()

  ctx.globalAlpha = 0.9
  ctx.lineWidth = H * 0.085
  ctx.beginPath()
  ctx.moveTo(x0 - H * 0.10, seatY)
  ctx.lineTo(x0 + H * 0.26, seatY)
  ctx.lineTo(x0 + H * 0.30, gy)
  ctx.stroke()

  const neckX = x0 + H * 0.08
  const neckY = seatY - H * 0.40
  ctx.beginPath()
  ctx.moveTo(x0 - H * 0.10, seatY)
  ctx.lineTo(neckX, neckY)
  ctx.stroke()
  ctx.globalAlpha = 0.62
  ctx.beginPath()
  ctx.moveTo(neckX - H * 0.02, neckY + H * 0.10)
  ctx.lineTo(x0 + H * 0.20, seatY - H * 0.03)
  ctx.stroke()
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(neckX + H * 0.05, neckY - H * 0.11, H * 0.105, 0, Math.PI * 2)
  ctx.fill()
})

/** Name banner over a runner. Cached by content — a poll that changes nothing
 *  re-uses the texture instead of baking a new one. */
function bannerTex(name, delta, tone) {
  const key = `arn:lbl:${name}|${delta}|${tone}`
  return canvasTex(key, 512, 152, (ctx, W) => {
    const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    // Every banner is one texture size, so the TYPE shrinks to fit rather than
    // the sprite — the retired book's "$18.71 of $100 · deactivated" has to
    // land on the same plate as "+0.3%".
    const fit = (text, start, max) => {
      let s = start
      ctx.font = `600 ${s}px ${SANS}`
      while (s > 22 && ctx.measureText(text).width > max) {
        s -= 2
        ctx.font = `600 ${s}px ${SANS}`
      }
    }
    ctx.textAlign = 'center'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 14
    ctx.fillStyle = 'rgba(245,245,247,0.96)'
    fit(name, 58, W - 40)
    ctx.fillText(name, W / 2, 62)
    ctx.fillStyle = tone > 0 ? 'rgba(52,211,153,0.98)'
      : tone < 0 ? 'rgba(248,113,113,0.98)'
        : 'rgba(245,245,247,0.78)'
    fit(delta, 54, W - 40)
    ctx.fillText(delta, W / 2, 130)
  })
}

/* ── the engine ────────────────────────────────────────────────────────── */
export function createColosseum(container, opts = {}) {
  const onSelect = opts.onSelect || (() => {})
  const isMobile = !!opts.isMobile

  let renderer
  try {
    renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
  } catch { return null }
  if (!renderer.getContext()) return null

  const W0 = Math.max(1, container.clientWidth)
  const H0 = Math.max(1, container.clientHeight)
  // css size, cached — the per-frame label declutter must not force layout
  let viewW = W0
  let viewH = H0

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5))
  renderer.setSize(W0, H0)
  renderer.domElement.className = 'arn-stage__canvas'
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(0x04040a)
  scene.fog = new FogExp2(0x04040a, 0.0013)

  const camera = new PerspectiveCamera(48, W0 / H0, 1, 2000)

  const _additives = []       // every additive material, for a future re-blend
  const _disposables = []     // geometries + materials this file owns

  const addMat = (m, additive = true) => {
    _disposables.push(m)
    if (additive) _additives.push(m)
    return m
  }

  /* ── the bowl ────────────────────────────────────────────────────────── */
  const world = new Group()
  scene.add(world)

  // Track floor: a dark disc with a wet sheen. The "reflection" is a mirrored
  // radial gradient, not a render target — there is no second pass anywhere.
  {
    const g = new CircleGeometry(R_STAND_0 - 6, 72)
    _disposables.push(g)
    const m = addMat(new MeshBasicMaterial({
      color: 0x0a0a12, transparent: true, opacity: 0.94, depthWrite: false,
    }), false)
    const floor = new Mesh(g, m)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.6
    world.add(floor)

    const sheen = new Sprite(addMat(new SpriteMaterial({
      map: glowTex(), transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: 0x3d4a6b, opacity: 0.22,
    })))
    sheen.scale.set(R_STAND_0 * 1.7, R_STAND_0 * 1.7, 1)
    sheen.position.set(0, 0.4, 0)
    // laid flat so the sheen pools on the track rather than facing the camera
    sheen.material.rotation = 0
    world.add(sheen)
  }

  // Lane rings — hairlines, the structure of the track. Rebuilt with the
  // roster because a lane only exists if a book stands in it.
  const laneRings = new Group()
  world.add(laneRings)
  const ringMat = addMat(new LineBasicMaterial({
    color: 0xc9d6f2, transparent: true, opacity: 0.10, depthWrite: false,
  }), false)
  ringMat._shared = true

  function rebuildRings(radii) {
    for (let i = laneRings.children.length - 1; i >= 0; i--) {
      const o = laneRings.children[i]
      laneRings.remove(o)
      o.geometry.dispose()
    }
    for (const r of radii) {
      const pts = new Float32Array(97 * 3)
      for (let i = 0; i < 97; i++) {
        const a = (i / 96) * Math.PI * 2
        pts[i * 3] = Math.cos(a) * r
        pts[i * 3 + 1] = 0.2
        pts[i * 3 + 2] = Math.sin(a) * r
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(pts, 3))
      laneRings.add(new LineLoop(g, ringMat))
    }
  }

  // Crowd: concentric tiers of point sprites, split into angular sectors so a
  // ripple costs SECTORS material writes instead of a per-vertex upload.
  const sectors = new Array(SECTORS)
  {
    const perSector = isMobile ? 42 : 78
    const tex = glowTex()
    for (let s = 0; s < SECTORS; s++) {
      const pos = new Float32Array(perSector * 3)
      let p = 0
      for (let i = 0; i < perSector; i++) {
        const tier = i % TIERS
        const a = ((s + (i / perSector)) / SECTORS) * Math.PI * 2
          + (Math.sin(i * 12.9898) * 0.5 + 0.5) * (Math.PI * 2 / SECTORS) * 0.9
        const r = R_STAND_0 + tier * TIER_DR + (Math.sin(i * 78.233) * 0.5 + 0.5) * 5
        pos[p++] = Math.cos(a) * r
        pos[p++] = 4 + tier * TIER_DY + (Math.sin(i * 43.11) * 0.5 + 0.5) * 3
        pos[p++] = Math.sin(a) * r
      }
      const geo = new BufferGeometry()
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
      _disposables.push(geo)
      const mat = addMat(new PointsMaterial({
        map: tex, size: isMobile ? 4.0 : 4.2, transparent: true, depthWrite: false,
        blending: AdditiveBlending, color: 0x9fb4d8, opacity: 0.30, sizeAttenuation: true,
      }))
      const pts = new Points(geo, mat)
      pts.userData.a = ((s + 0.5) / SECTORS) * Math.PI * 2
      world.add(pts)
      sectors[s] = pts
    }
  }

  // Light shafts — six lamps raking the bowl.
  const shafts = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4
    const sp = new Sprite(addMat(new SpriteMaterial({
      map: beamTex(), transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: 0xbcd0f5, opacity: 0.10,
    })))
    sp.scale.set(74, 132, 1)
    sp.position.set(Math.cos(a) * (R_STAND_0 * 0.72), 60, Math.sin(a) * (R_STAND_0 * 0.72))
    sp.userData.a = a
    world.add(sp)
    shafts.push(sp)
  }

  /* ── the start gate: the waterline, standing up ──────────────────────── */
  const gate = new Group()
  world.add(gate)
  {
    for (let k = 0; k < 2; k++) {
      const post = new Sprite(addMat(new SpriteMaterial({
        map: gateTex(), transparent: true, depthWrite: false,
        blending: AdditiveBlending, color: 0xffffff, opacity: 0.55,
      })))
      post.scale.set(7, 54, 1)
      post.position.set(k === 0 ? R_GATE_IN : R_GATE_OUT, 26, 0)
      gate.add(post)
    }
    const bar = new Sprite(addMat(new SpriteMaterial({
      map: glowTex(), transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: 0xffffff, opacity: 0.5,
    })))
    bar.scale.set(R_GATE_OUT - R_GATE_IN + 16, 11, 1)
    bar.position.set((R_GATE_IN + R_GATE_OUT) / 2, 2.5, 0)
    gate.add(bar)
  }

  /* ── the jumbotron ───────────────────────────────────────────────────── */
  const boardCanvas = document.createElement('canvas')
  boardCanvas.width = 1024
  boardCanvas.height = 512
  const boardTex = new CanvasTexture(boardCanvas)
  boardTex.colorSpace = SRGBColorSpace
  boardTex.minFilter = LinearFilter
  // A billboard, not a plane: the camera makes a full revolution every minute
  // and a stadium screen that is edge-on for half of it is a screen nobody can
  // read. Real jumbotrons are four-sided for exactly this reason.
  const jumbo = new Sprite(addMat(new SpriteMaterial({
    map: boardTex, transparent: true, depthWrite: false, opacity: 0.97,
  }), false))
  jumbo.scale.set(158, 79, 1)
  jumbo.position.set(0, 92, 0)
  world.add(jumbo)
  {
    const halo = new Sprite(addMat(new SpriteMaterial({
      map: glowTex(), transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: 0x8fa8d8, opacity: 0.20,
    })))
    halo.scale.set(264, 158, 1)
    halo.position.copy(jumbo.position)
    world.add(halo)
  }

  function paintBoard(b) {
    const ctx = boardCanvas.getContext('2d')
    const W = 1024
    const H = 512
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(6,6,12,0.93)'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(245,245,247,0.20)'
    ctx.lineWidth = 3
    ctx.strokeRect(6, 6, W - 12, H - 12)

    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(245,245,247,0.46)'
    ctx.font = '600 26px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.fillText('THE ARENA', 46, 62)

    ctx.fillStyle = 'rgba(245,245,247,0.96)'
    ctx.font = '600 47px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    const words = String(b?.headline || '').split(' ')
    let line = ''
    let y = 128
    for (const w of words) {
      const t = line ? `${line} ${w}` : w
      if (ctx.measureText(t).width > W - 92 && line) { ctx.fillText(line, 46, y); y += 56; line = w }
      else line = t
      if (y > 210) break
    }
    if (line && y <= 210) ctx.fillText(line, 46, y)

    ctx.strokeStyle = 'rgba(245,245,247,0.12)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(46, 240); ctx.lineTo(W - 46, 240); ctx.stroke()

    // The list is named, because a board that just shows three rows invites
    // the reader to assume it is the page's rank. It is not — it is return.
    ctx.fillStyle = 'rgba(245,245,247,0.42)'
    ctx.font = '600 22px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.fillText('BY RETURN SINCE START', 46, 274)

    const top = b?.top || []
    for (let i = 0; i < Math.min(3, top.length); i++) {
      const row = top[i]
      const ry = 322 + i * 48
      ctx.fillStyle = 'rgba(245,245,247,0.40)'
      ctx.font = '600 30px ui-monospace, Menlo, monospace'
      ctx.fillText(String(i + 1).padStart(2, '0'), 46, ry)
      ctx.fillStyle = 'rgba(245,245,247,0.92)'
      ctx.font = '600 34px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
      ctx.fillText(row.name, 110, ry)
      ctx.textAlign = 'right'
      ctx.fillStyle = row.tone > 0 ? 'rgba(52,211,153,0.98)' : row.tone < 0 ? 'rgba(248,113,113,0.98)' : 'rgba(245,245,247,0.7)'
      ctx.font = '600 34px ui-monospace, Menlo, monospace'
      ctx.fillText(row.delta, W - 46, ry)
      ctx.textAlign = 'left'
    }

    if (b?.latest) {
      ctx.fillStyle = 'rgba(245,245,247,0.42)'
      // Shrink-to-fit: a long book name + reason clips off the plate edge
      // otherwise, and a stadium screen with amputated words reads broken.
      let ls = 24
      ctx.font = `600 ${ls}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
      while (ls > 15 && ctx.measureText(b.latest).width > W - 92) {
        ls -= 1
        ctx.font = `600 ${ls}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
      }
      ctx.fillText(b.latest, 46, 468)
    }
    boardTex.needsUpdate = true
  }
  paintBoard(null)

  /* ── sparks: one pre-allocated pool, nothing else may emit ───────────── */
  const sparkPos = new Float32Array(SPARK_N * 3)
  const sparkCol = new Float32Array(SPARK_N * 3)
  const sparkVel = new Float32Array(SPARK_N * 3)
  const sparkBase = new Float32Array(SPARK_N * 3)
  const sparkLife = new Float32Array(SPARK_N)
  let sparkHead = 0
  let sparksAlive = 0
  const sparkGeo = new BufferGeometry()
  sparkGeo.setAttribute('position', new Float32BufferAttribute(sparkPos, 3))
  sparkGeo.setAttribute('color', new Float32BufferAttribute(sparkCol, 3))
  _disposables.push(sparkGeo)
  const sparkMat = addMat(new PointsMaterial({
    map: glowTex(), size: 4.2, transparent: true, depthWrite: false,
    blending: AdditiveBlending, vertexColors: true, opacity: 0.95, sizeAttenuation: true,
  }))
  const sparkPts = new Points(sparkGeo, sparkMat)
  sparkPts.frustumCulled = false
  world.add(sparkPts)
  for (let i = 0; i < SPARK_N; i++) sparkPos[i * 3 + 1] = -9999

  function burst(x, y, z, r, g, b) {
    for (let n = 0; n < 34; n++) {
      const i = sparkHead
      sparkHead = (sparkHead + 1) % SPARK_N
      const a = Math.random() * Math.PI * 2
      const up = 0.25 + Math.random() * 0.95
      const sp = 14 + Math.random() * 26
      sparkPos[i * 3] = x; sparkPos[i * 3 + 1] = y; sparkPos[i * 3 + 2] = z
      sparkVel[i * 3] = Math.cos(a) * sp
      sparkVel[i * 3 + 1] = up * sp
      sparkVel[i * 3 + 2] = Math.sin(a) * sp
      sparkBase[i * 3] = r; sparkBase[i * 3 + 1] = g; sparkBase[i * 3 + 2] = b
      sparkCol[i * 3] = r; sparkCol[i * 3 + 1] = g; sparkCol[i * 3 + 2] = b
      sparkLife[i] = 1
    }
    sparksAlive = 1
    sparkGeo.attributes.color.needsUpdate = true
  }

  /* ── runners ─────────────────────────────────────────────────────────── */
  const runners = []
  const runnerByKey = new Map()
  const phases = new Map()
  const _v = new Vector3()
  // label-declutter scratch, pre-allocated — the loop must not allocate
  const lblOrder = []
  const lblAcc = new Float32Array(32)

  function makeRunner() {
    const node = new Group()
    const body = new Sprite(addMat(new SpriteMaterial({
      map: runnerTex(0), transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: 0xffffff, opacity: 0.95,
    })))
    body.scale.set(17, 17, 1)
    body.position.y = 8
    node.add(body)

    const halo = new Sprite(addMat(new SpriteMaterial({
      map: glowTex(), transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: 0xffffff, opacity: 0.55,
    })))
    halo.scale.set(30, 30, 1)
    halo.position.y = 8
    node.add(halo)

    const pool = new Sprite(addMat(new SpriteMaterial({
      map: glowTex(), transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: 0xffffff, opacity: 0.4,
    })))
    pool.scale.set(26, 10, 1)
    pool.position.y = 0.6
    node.add(pool)

    const banner = new Sprite(addMat(new SpriteMaterial({
      map: null, transparent: true, depthWrite: false, opacity: 0.95,
    }), false))
    banner.scale.set(44, 13, 1)
    banner.position.y = 26
    node.add(banner)

    const wake = new Array(WAKE_N)
    for (let i = 0; i < WAKE_N; i++) {
      const s = new Sprite(addMat(new SpriteMaterial({
        map: glowTex(), transparent: true, depthWrite: false,
        blending: AdditiveBlending, color: 0xffffff, opacity: 0,
      })))
      s.scale.set(12, 12, 1)
      world.add(s)                 // parented to the world: the wake is left
      wake[i] = s                  // BEHIND, it does not ride the runner
    }

    world.add(node)
    return {
      node, body, halo, pool, banner, wake,
      key: '', name: '', theta: 0, radius: R_MID, pace: 0.5, tint: 0,
      mag: 0, retired: false, building: false, benchIdx: 0,
      phase: 0, wakeU: 0, frame: 0, stumbleT: 0, flareT: 0, x: 0, z: 0,
      lblA: 1, lblT: 1,
    }
  }

  /**
   * `list` items: { key, name, returnPct, weeklyPct, building, retired, delta,
   *                 benchLine }.
   * Lane assignment interleaves the return order (1st outermost, 2nd
   * innermost, 3rd second-out, …) so two books that share an angle never share
   * a radius. Deterministic and stable across polls.
   */
  function setRoster(list) {
    const ranked = []
    const warm = []
    const bench = []
    for (const it of list || []) {
      if (!it || !it.key) continue
      if (it.retired) bench.push(it)
      else if (it.building) warm.push(it)
      else ranked.push(it)
    }
    const byRet = (a, b) => (b.returnPct ?? -1e9) - (a.returnPct ?? -1e9)
    ranked.sort(byRet)
    warm.sort(byRet)

    const seen = new Set()
    const n = ranked.length
    const half = ((n - 1) / 2) * LANE_STEP
    for (let i = 0; i < n; i++) {
      const li = (i % 2 === 0) ? (i >> 1) : (n - 1 - ((i - 1) >> 1))
      seat(ranked[i], R_MID + half - li * LANE_STEP, seen)
    }
    for (let k = 0; k < warm.length; k++) {
      seat(warm[k], R_MID + half + WARM_GAP + k * LANE_STEP, seen)
    }
    // Each benched book gets its own seat along the bench arc — one shared
    // radius AND one shared angle would stack every retired book on the same
    // point the day a second one retires.
    for (let k = 0; k < bench.length; k++) {
      seat(bench[k], R_BENCH, seen)
      runnerByKey.get(bench[k].key).benchIdx = k
    }

    for (let i = runners.length - 1; i >= 0; i--) {
      const r = runners[i]
      if (seen.has(r.key)) continue
      phases.set(r.key, r.phase)
      dropRunner(r)
      runners.splice(i, 1)
      runnerByKey.delete(r.key)
    }

    // A lane only exists because a book stands in it, so the rings are built
    // AFTER the departures — a retired book must not leave its lane behind.
    const radii = []
    for (const r of runners) if (!r.retired) radii.push(r.radius)
    rebuildRings(radii)
  }

  function seat(it, radius, seen) {
    let r = runnerByKey.get(it.key)
    if (!r) {
      r = makeRunner()
      r.key = it.key
      r.phase = phases.get(it.key) ?? (it.key.length % 7) * 0.9
      runners.push(r)
      runnerByKey.set(it.key, r)
    }
    seen.add(it.key)
    r.name = it.name
    r.retired = !!it.retired
    r.building = !!it.building
    const ret = Number.isFinite(it.returnPct) ? it.returnPct : 0
    r.theta = clamp(ret / SPAN, -1, 1) * Math.PI
    r.tint = ret > 0 ? 1 : ret < 0 ? -1 : 0
    r.mag = clamp(Math.abs(ret) / 60, 0, 1)
    const wk = Number.isFinite(it.weeklyPct) ? it.weeklyPct : null
    const nrm = wk == null ? -0.3 : clamp(wk / 30, -1.5, 0.5)
    r.pace = r.retired ? 0 : 0.16 + 0.84 * ((nrm + 1.5) / 2)
    r.radius = radius

    const col = r.retired ? 0x8fa0bd : r.tint > 0 ? BULL : r.tint < 0 ? BEAR : WARM_WHITE
    r.halo.material.color.setHex(col)
    r.pool.material.color.setHex(col)
    r.body.material.color.setHex(r.retired ? 0x9fb0c9 : WARM_WHITE)
    r.body.material.opacity = r.retired ? 0.7 : r.building ? 0.72 : 0.95
    r.halo.material.opacity = r.retired ? 0.25 : 0.35 + 0.35 * r.mag
    for (let i = 0; i < WAKE_N; i++) r.wake[i].material.color.setHex(col)

    if (r.retired) {
      r.body.material.map = seatedTex()
      r.body.scale.set(19, 19, 1)
      r.body.position.y = 7
      r.pool.material.opacity = 0.14
    } else {
      r.body.scale.set(17, 17, 1)
      r.body.position.y = 8
      r.pool.material.opacity = 0.30 + 0.3 * r.mag
    }
    r.body.material.needsUpdate = true
    r.frame = -1          // force one stride re-bind on the next frame

    const tex = bannerTex(it.name, it.delta || '', r.retired ? 0 : r.tint)
    if (r.banner.material.map !== tex) {
      r.banner.material.map = tex
      r.banner.material.needsUpdate = true
    }
    r.banner.position.y = r.retired ? 22 : 26
    r.banner.scale.set(54, 16, 1)
    if (r.retired) for (let i = 0; i < WAKE_N; i++) r.wake[i].material.opacity = 0
  }

  function dropRunner(r) {
    world.remove(r.node)
    r.node.traverse((o) => { if (o.material) o.material.dispose() })
    for (const s of r.wake) { world.remove(s); s.material.dispose() }
  }

  /* ── the bench spotlight ─────────────────────────────────────────────── */
  const benchLight = new Sprite(addMat(new SpriteMaterial({
    map: beamTex(), transparent: true, depthWrite: false,
    blending: AdditiveBlending, color: 0xc8d6f0, opacity: 0,
  })))
  benchLight.scale.set(40, 84, 1)
  world.add(benchLight)

  /* ── ripples ─────────────────────────────────────────────────────────── */
  const ripples = new Array(4)
  for (let i = 0; i < 4; i++) ripples[i] = { on: false, t: 0, a: 0 }
  function pushRipple(a) {
    for (let i = 0; i < 4; i++) if (!ripples[i].on) { ripples[i].on = true; ripples[i].t = 0; ripples[i].a = a; return }
    ripples[0].on = true; ripples[0].t = 0; ripples[0].a = a
  }

  /* ── camera rig ──────────────────────────────────────────────────────── */
  // Framing: close enough that the bowl OVERFLOWS the frame edges — the
  // stands wrap past the sides, so the reader is inside the arena, not
  // inspecting a diorama of one. The sightline still clears the near tier
  // tops (~58 up at radius ~225): at dist 315 / pitch 0.44 the ray from the
  // camera (~283 out, ~134 up) to the target passes ~104 up at the near
  // stand — headed-verified 2026-08-13 after the first cut (dist 400) read
  // as a distant model filling 40% of the stage.
  const HOME_DIST = isMobile ? 400 : 315
  const rig = {
    yaw: -0.55, pitch: 0.44, dist: HOME_DIST,
    target: new Vector3(0, 14, 0),
    parX: 0, parY: 0, parTX: 0, parTY: 0,
  }
  let tween = null
  let pendingSelect = null

  function applyCamera(breath) {
    const d = rig.dist * breath
    const p = clamp(rig.pitch + rig.parY, 0.14, 1.15)
    const y = rig.yaw + rig.parX
    camera.position.set(
      rig.target.x + Math.cos(y) * Math.cos(p) * d,
      rig.target.y + Math.sin(p) * d,
      rig.target.z + Math.sin(y) * Math.cos(p) * d,
    )
    camera.lookAt(rig.target)
  }

  /* ── input ───────────────────────────────────────────────────────────── */
  const el = renderer.domElement
  let hovered = null

  function pickAt(clientX, clientY) {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const px = clientX - rect.left
    const py = clientY - rect.top
    let best = null
    let bestD = (isMobile ? 46 : 40) ** 2
    for (const r of runners) {
      _v.set(r.x, 12, r.z).project(camera)
      const sx = (_v.x * 0.5 + 0.5) * rect.width
      const sy = (-_v.y * 0.5 + 0.5) * rect.height
      const d = (sx - px) ** 2 + (sy - py) ** 2
      if (d < bestD) { bestD = d; best = r }
    }
    return best
  }

  const onMove = (e) => {
    const rect = el.getBoundingClientRect()
    rig.parTX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.30
    rig.parTY = ((e.clientY - rect.top) / rect.height - 0.5) * -0.16
    const hit = pickAt(e.clientX, e.clientY)
    if (hit !== hovered) {
      hovered = hit
      el.style.cursor = hit ? 'pointer' : 'default'
    }
  }
  const onLeave = () => { rig.parTX = 0; rig.parTY = 0; hovered = null; el.style.cursor = 'default' }
  function goHome() {
    tween = {
      t: 0, dur: 0.9,
      fromT: rig.target.clone(), toT: new Vector3(0, 14, 0),
      fromD: rig.dist, toD: HOME_DIST,
    }
  }
  const onKey = (e) => {
    if (e.key === 'Escape' && (tween || rig.dist !== HOME_DIST)) { pendingSelect = null; goHome() }
  }
  const onClick = (e) => {
    const hit = pickAt(e.clientX, e.clientY)
    // A click on the floor is a click on nothing: return the orbit.
    if (!hit) { if (rig.dist !== HOME_DIST) goHome(); return }
    // Swoop, then hand off. The camera arrives before the page changes.
    tween = {
      t: 0, dur: 0.8,
      fromT: rig.target.clone(), toT: new Vector3(hit.x * 0.55, 12, hit.z * 0.55),
      fromD: rig.dist, toD: isMobile ? 205 : 175,
    }
    pendingSelect = hit.key
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('click', onClick)
  window.addEventListener('keydown', onKey)

  /* ── loop ────────────────────────────────────────────────────────────── */
  let raf = 0
  let running = false
  let inView = true
  let idleStopped = false
  let drawn = false
  let lastT = performance.now()
  let t0 = 0
  const cruiseMs = isMobile ? 33 : 24

  function frame() {
    raf = 0
    if (!running || document.hidden || !inView || idleStopped) return
    const now = performance.now()
    if (now - lastT < cruiseMs) { raf = requestAnimationFrame(frame); return }
    const dt = Math.min(0.05, (now - lastT) / 1000)
    lastT = now
    if (!t0) t0 = now
    const wall = (now - t0) / 1000
    const entry = easeOut(clamp(wall / 1.6, 0, 1))

    /* camera: one revolution a minute, a breathing dolly, a parallax nudge */
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur)
      const e = easeOut(tween.t)
      rig.target.copy(tween.fromT).lerp(tween.toT, e)
      rig.dist = lerp(tween.fromD, tween.toD, e)
      if (tween.t >= 1) {
        const wasSwoop = pendingSelect
        tween = null
        if (wasSwoop) {
          pendingSelect = null
          // Come home first, then hand off. If the takeover never opens (a book
          // the roster carries but the board does not), the orbit resumes
          // instead of leaving the camera parked on one runner.
          goHome()
          onSelect(wasSwoop)
        }
      }
    } else {
      rig.yaw += dt * (Math.PI * 2 / 60)
    }
    rig.parX += (rig.parTX - rig.parX) * (1 - Math.exp(-dt * 3.2))
    rig.parY += (rig.parTY - rig.parY) * (1 - Math.exp(-dt * 3.2))
    applyCamera(1 + Math.sin(wall * 0.22) * 0.035)

    /* the bowl breathes with the lamps */
    for (let i = 0; i < shafts.length; i++) {
      const s = shafts[i]
      s.material.opacity = (0.10 + 0.06 * (0.5 + 0.5 * Math.sin(wall * 0.5 + i))) * entry
    }
    // The gate itself never moves — only its brightness, which breathes so the
    // reader's eye finds the reference line before it finds the runners.
    const gateA = (0.42 + 0.10 * Math.sin(wall * 0.6)) * entry
    gate.children[0].material.opacity = gateA
    gate.children[1].material.opacity = gateA
    gate.children[2].material.opacity = gateA * 0.85

    /* crowd ripples */
    let anyRipple = false
    for (let i = 0; i < ripples.length; i++) {
      const rp = ripples[i]
      if (!rp.on) continue
      rp.t += dt / 2.2
      if (rp.t >= 1) { rp.on = false; continue }
      anyRipple = true
    }
    for (let s = 0; s < SECTORS; s++) {
      const sec = sectors[s]
      let boost = 0
      if (anyRipple) {
        for (let i = 0; i < ripples.length; i++) {
          const rp = ripples[i]
          if (!rp.on) continue
          let d = Math.abs(sec.userData.a - rp.a)
          if (d > Math.PI) d = Math.PI * 2 - d
          const front = rp.t * Math.PI
          const k = Math.exp(-((d - front) ** 2) / 0.10)
          boost = Math.max(boost, k * (1 - rp.t) * 0.62)
        }
      }
      sec.material.opacity = (0.36 + 0.06 * Math.sin(wall * 0.7 + s) + boost) * entry
    }

    /* labels: screen-space declutter. Placement is measured and untouchable,
       so when the pack bunches near the gate (every return within a few
       points of zero — the normal state of this roster) the BANNERS yield
       instead: extremes and the hovered book keep their name, the middle of
       the pack fades its plate until the camera or the data separates them.
       Headed-verified 2026-08-13: without this, ten names smear into one
       unreadable block at the gate. */
    {
      const sw = viewW || 1
      const sh = viewH || 1
      lblOrder.length = 0
      for (const r of runners) lblOrder.push(r)
      lblOrder.sort((a, b) =>
        (b === hovered ? 1 : 0) - (a === hovered ? 1 : 0) || b.mag - a.mag)
      let accN = 0
      for (const r of lblOrder) {
        _v.set(r.x, 26, r.z).project(camera)
        const sx = (_v.x * 0.5 + 0.5) * sw
        const sy = (-_v.y * 0.5 + 0.5) * sh
        let ok = true
        for (let i = 0; i < accN; i++) {
          if (Math.abs(sx - lblAcc[i * 2]) < 128 && Math.abs(sy - lblAcc[i * 2 + 1]) < 40) { ok = false; break }
        }
        if (ok && accN < 16) { lblAcc[accN * 2] = sx; lblAcc[accN * 2 + 1] = sy; accN++ }
        r.lblT = ok ? 1 : 0
        r.lblA += (r.lblT - r.lblA) * (1 - Math.exp(-dt * 7))
      }
    }

    /* runners */
    for (const r of runners) {
      if (r.retired) {
        const ba = -0.9 + r.benchIdx * 0.16
        r.x = Math.cos(ba) * r.radius
        r.z = Math.sin(ba) * r.radius
        r.node.position.set(r.x, 0, r.z)
        benchLight.position.set(r.x, 40, r.z)
        benchLight.material.opacity = 0.13 * entry * (0.86 + 0.14 * Math.sin(wall * 0.7))
        r.banner.material.opacity = 0.9 * entry * r.lblA
        continue
      }

      r.phase = (r.phase + dt * (0.85 + 2.4 * r.pace) * Math.PI * 2) % (Math.PI * 2)
      r.wakeU = (r.wakeU + dt * (0.34 + 0.92 * r.pace)) % 1
      const fr = Math.floor((r.phase / (Math.PI * 2)) * RUN_FRAMES) % RUN_FRAMES
      if (fr !== r.frame) {
        r.frame = fr
        r.body.material.map = runnerTex(fr)
        r.body.material.needsUpdate = true
      }

      // Stride sway: ±small ALONG the track. The angle itself never drifts —
      // it is a measured number, not a projection.
      const sway = (0.006 + 0.020 * r.pace) * Math.sin(r.phase)
      let a = r.theta + sway
      let bob = 0
      let lean = 0

      if (r.stumbleT) {
        const t = (now - r.stumbleT) / 620
        if (t >= 1) r.stumbleT = 0
        else { const s = Math.sin(Math.PI * t); bob = -3.4 * s; lean = 0.5 * s }
      }
      if (r.flareT) {
        const t = (now - r.flareT) / 520
        if (t >= 1) r.flareT = 0
        else bob = 7 * Math.sin(Math.PI * t)
      }

      r.x = Math.cos(a) * r.radius
      r.z = Math.sin(a) * r.radius
      r.node.position.set(r.x, bob, r.z)
      r.body.material.rotation = lean
      r.halo.material.opacity = (r.retired ? 0.25 : 0.32 + 0.34 * r.mag
        + (r.flareT ? 0.5 : 0)) * entry
      r.banner.material.opacity = (r.building ? 0.72 : 0.95) * entry * r.lblA

      // The wake streams BACKWARD and dies. It is emitted energy, not travel:
      // length is |return|, flow rate and brightness are the week's pace.
      const arc = 0.05 + 0.42 * r.mag
      for (let i = 0; i < WAKE_N; i++) {
        const s = r.wake[i]
        // wakeU is its own wrapped accumulator: wrapping `phase` by 2pi would
        // make the wake jump, and never wrapping it loses float precision.
        const u = (r.wakeU + i / WAKE_N) % 1
        const wa = a - u * arc
        const wr = r.radius + Math.sin(u * 6.0) * 0.9
        s.position.set(Math.cos(wa) * wr, 7 - u * 2.6, Math.sin(wa) * wr)
        const k = (1 - u) ** 1.6
        s.material.opacity = k * (0.10 + 0.40 * r.pace) * (0.35 + 0.65 * r.mag) * entry
        const sc = 5 + 12 * k * (0.5 + 0.5 * r.mag)
        s.scale.set(sc, sc, 1)
      }
    }

    /* sparks */
    if (sparksAlive) {
      let alive = 0
      for (let i = 0; i < SPARK_N; i++) {
        if (sparkLife[i] <= 0) continue
        alive++
        sparkLife[i] -= dt / 1.15
        if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -9999; continue }
        sparkVel[i * 3 + 1] -= 52 * dt
        sparkPos[i * 3] += sparkVel[i * 3] * dt
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt
        if (sparkPos[i * 3 + 1] < 0.6) { sparkPos[i * 3 + 1] = 0.6; sparkVel[i * 3 + 1] *= -0.32 }
        const k = sparkLife[i] * sparkLife[i]
        sparkCol[i * 3] = sparkBase[i * 3] * k
        sparkCol[i * 3 + 1] = sparkBase[i * 3 + 1] * k
        sparkCol[i * 3 + 2] = sparkBase[i * 3 + 2] * k
      }
      sparksAlive = alive
      sparkGeo.attributes.position.needsUpdate = true
      sparkGeo.attributes.color.needsUpdate = true
    }

    renderer.render(scene, camera)
    drawn = true
    raf = requestAnimationFrame(frame)
  }

  function start() {
    if (running || document.hidden || !inView || idleStopped) return
    running = true
    lastT = performance.now()
    raf = requestAnimationFrame(frame)
  }
  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const onVis = () => { if (document.hidden) stop(); else start() }
  document.addEventListener('visibilitychange', onVis)

  let io = null
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting)
      if (inView) start(); else stop()
    }, { threshold: 0 })
    io.observe(el)
  }

  // 5-minute idle stop — a stadium nobody is watching costs nothing.
  const unsubIdle = subscribeActivity((active) => {
    idleStopped = !active
    if (active) start(); else stop()
  })

  applyCamera(1)
  start()

  return {
    setRoster,
    setBoard: paintBoard,
    /** One real close off the tape. Nothing else can move a runner. */
    pulse(key, kind) {
      const r = runnerByKey.get(key)
      if (!r || r.retired) return
      const now = performance.now()
      if (kind === 'stumble') {
        r.stumbleT = now
        const c = new Color(BEAR)
        burst(r.x, 9, r.z, c.r, c.g, c.b)
      } else {
        r.flareT = now
        pushRipple(Math.atan2(r.z, r.x))
      }
      start()
    },
    resize() {
      const w = Math.max(1, container.clientWidth)
      const h = Math.max(1, container.clientHeight)
      viewW = w
      viewH = h
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      start()
    },
    hasDrawn() { return drawn },
    dispose() {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      if (io) io.disconnect()
      if (typeof unsubIdle === 'function') unsubIdle()
      for (const r of runners) { phases.set(r.key, r.phase); dropRunner(r) }
      runners.length = 0
      runnerByKey.clear()
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) o.material.dispose()
      })
      for (const d of _disposables) { try { d.dispose() } catch { /* already gone */ } }
      boardTex.dispose()
      // dispose() frees programs but NOT the context; without forceContextLoss
      // every remount leaks one and Chrome force-loses the oldest at ~16.
      try { renderer.forceContextLoss() } catch { /* already lost */ }
      renderer.dispose()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}

export { SPAN as ARENA_SPAN }
