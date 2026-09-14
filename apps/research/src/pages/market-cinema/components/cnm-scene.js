/**
 * cnm-scene — the render loop. ZERO React, zero DOM writes outside its canvas.
 *
 * Every guard from the shared packet §"Canvas guards" is here:
 *   dpr capped · canvas.width writes guarded (an identical write still
 *   re-allocates the backing store = mobile flicker) · setTransform never
 *   ctx.scale (the welcome wrapper's scale() accumulates on every resize) ·
 *   rect read with getBoundingClientRect at draw time · 30fps gate ·
 *   document.hidden full stop · IntersectionObserver · gradients cached per
 *   resize · zero fillText (every glyph of text on this page is DOM) · zero
 *   shadowBlur / filter / additive blending · no full-canvas translucent
 *   fillRect ghost (the ground gradient is opaque — it IS the clear; the
 *   horizon glow is a band redrawn from that clear every frame, not a trail
 *   that accumulates).
 *
 * Allocation discipline: three pre-allocated pools, no object or array
 * literals in the frame path, and alpha is driven through ctx.globalAlpha with
 * constant colour strings so not one rgba() string is built per frame.
 *
 * The integrity rule this file exists to keep: nothing draws unless spawn()
 * was handed a real event off the feed. There is no idle emitter, no dust, no
 * star field, no seeded randomness that produces a particle.
 */

const DROP_POOL = 220     // matches the replay buffer's cap
const STREAK_POOL = 24
const RIPPLE_POOL = 8

// Design tokens, restated as literals because canvas cannot read CSS custom
// properties. These are --bear / --bull / warm-white from index.css :root.
const C_BEAR = '#EF4444'
const C_BULL = '#10B981'
const C_WARM = '#F5F5F7'

const LAND_MS = 300
const RIPPLE_MS = 400
const STREAK_MS = 6200
const PLATE_MS = 700

const DASH_UNKNOWN = [4, 6]
const DASH_NONE = []

// 🪤 THIS WAS THE "LAG". Measured 2026-08-13 on a 120Hz display: the main
// thread was clean (rAF p50 8.3ms, p99 9.2ms, ZERO long tasks) and the scene
// was drawing exactly 75 frames in 2.5s — 30.0fps, precisely this constant. A
// 30fps gate on a 119Hz display advances every drop in 33ms steps against an
// 8.3ms refresh: a 4× mismatch that reads as judder, not as slowness. Nothing
// was dropping frames; the page was refusing to draw them. The intensified
// rain made it far worse — a 26px disc with a 40px tail stepping ~4px per
// frame shows its stepping, where a 2px speck did not.
// The watchdog below still owns the ladder: a machine that cannot hold this
// trips `raw > 40ms` thirty times and falls to FPS_DEGRADED, exactly as before.
const FPS_NORMAL = 60
const FPS_DEGRADED = 20

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t

export function createScene(canvas, { onStats, onLane } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null

  const isMobile = window.matchMedia('(max-width: 768px)').matches
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2)

  /* ── pools ─────────────────────────────────────────────────────────────── */
  const drops = new Array(DROP_POOL)
  for (let i = 0; i < DROP_POOL; i++) {
    drops[i] = { on: false, side: 'long', r: 2, xf: 0.5, born: 0, dur: 0, ring: false, ripple: false, rippled: false }
  }
  const streaks = new Array(STREAK_POOL)
  for (let i = 0; i < STREAK_POOL; i++) {
    streaks[i] = { on: false, cls: 'unknown', dir: 'ltr', stroke: 1, yf: 0.5, born: 0, dur: STREAK_MS, tint: null, resolved: false, left: null, right: null, usd: 0 }
  }
  const ripples = new Array(RIPPLE_POOL)
  for (let i = 0; i < RIPPLE_POOL; i++) ripples[i] = { on: false, x: 0, y: 0, born: 0, r0: 0 }

  /* ── state ─────────────────────────────────────────────────────────────── */
  let raf = 0
  let running = false
  let paused = false
  let inView = true
  let reveal = 0            // entry: the tape draws itself L→R, 0 → 1
  let intensity = 0
  let drawnDrops = 0
  let drawnStreaks = 0
  let plateT = 0            // right wall glyph flash timestamp
  let plateTint = null
  let voidT = 0             // left void square flash (a burn arrived)

  // Tape series, projected once per change into a flat pre-allocated buffer.
  let tapeX = new Float32Array(0)
  let tapeY = new Float32Array(0)
  let tapeN = 0
  let tapeRaw = null
  let tapeDirty = true

  // Geometry + cached gradients, rebuilt only when the rect actually changes.
  let W = 0, H = 0
  let gGround = null
  let gTape = null
  let gGlow = null
  let glowTop = 0, glowH = 0
  let padX = 40, baselineY = 0, laneTop = 0, laneH = 0, railL = 0, railR = 0

  let last = 0
  let prevRaf = 0
  let lastStat = 0
  let slowRun = 0, fastRun = 0
  let degraded = false
  let activeCap = DROP_POOL

  function rebuildGeometry(w, h) {
    W = w; H = h
    padX = clamp(w * 0.045, 18, 76)
    baselineY = Math.round(h * 0.68)
    // Tuned so the 844-tall phone lands on the packet's mobile arithmetic
    // exactly: lane top 93 (clear of the 91px top HUD block), lane height 84.
    laneTop = Math.round(clamp(h * 0.11, 44, 130))
    laneH = Math.round(clamp(h * 0.10, 64, 130))
    railL = padX
    railR = w - padX

    // Depth field, not a flat plate: near-black overhead, a barely-lifted deep
    // slate AT the horizon, black again below it. Two stops carry the whole
    // illusion of a room — the eye reads the lift as distance, and the drops
    // fall out of the dark into it. Rebuilt on resize only, like every other
    // gradient here.
    const hz = clamp(baselineY / h, 0.08, 0.92)
    gGround = ctx.createLinearGradient(0, 0, 0, h)
    gGround.addColorStop(0, '#050507')
    gGround.addColorStop(hz * 0.5, '#08080d')
    gGround.addColorStop(hz, '#0e0e16')
    gGround.addColorStop(Math.min(1, hz + 0.05), '#050508')
    gGround.addColorStop(1, '#010102')

    // Horizon glow. Built once at unit alpha and dimmed at draw time through
    // globalAlpha, so intensity can move it without rebuilding a gradient or
    // allocating an rgba() string per frame.
    glowTop = Math.max(0, baselineY - h * 0.13)
    glowH = Math.max(1, Math.min(h - glowTop, h * 0.22))
    gGlow = ctx.createLinearGradient(0, glowTop, 0, glowTop + glowH)
    gGlow.addColorStop(0, 'rgba(245,245,247,0)')
    gGlow.addColorStop(0.46, 'rgba(245,245,247,1)')
    gGlow.addColorStop(1, 'rgba(245,245,247,0)')

    gTape = ctx.createLinearGradient(0, baselineY - h * 0.09, 0, h)
    gTape.addColorStop(0, 'rgba(245,245,247,0.18)')
    gTape.addColorStop(0.55, 'rgba(245,245,247,0.05)')
    gTape.addColorStop(1, 'rgba(245,245,247,0)')

    tapeDirty = true
  }

  /* ── the tape ──────────────────────────────────────────────────────────── */

  /** Horizon lift 0 → 8px is the first of the three things density drives. */
  function horizonY() { return baselineY - intensity * 8 }

  /**
   * The room's only light. It sits UNDER the tape and rides the entry reveal,
   * so the horizon warms as the tape draws itself. Above intensity 0.75 it
   * brightens with the cascade, 0.06 → 0.14 — the room gets brighter when the
   * market burns. Nothing flashes: this is a ramp on a soft band, and it is
   * the only thing on the page whose brightness depends on density.
   */
  function drawHorizonGlow() {
    if (!gGlow || reveal <= 0) return
    const a = intensity > 0.75 ? lerp(0.06, 0.14, (intensity - 0.75) / 0.25) : 0.06
    ctx.globalAlpha = a * reveal
    ctx.fillStyle = gGlow
    ctx.fillRect(0, glowTop, W, glowH)
    ctx.globalAlpha = 1
  }

  function projectTape() {
    tapeDirty = false
    const pts = tapeRaw
    tapeN = pts && pts.length >= 2 ? pts.length : 0
    if (!tapeN) return
    if (tapeX.length < tapeN) {
      tapeX = new Float32Array(tapeN + 64)
      tapeY = new Float32Array(tapeN + 64)
    }
    const x0 = padX * 1.5
    const x1 = W - padX * 1.5
    const t0 = pts[0].t
    const t1 = Math.max(pts[tapeN - 1].t, t0 + 1)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < tapeN; i++) {
      const v = pts[i].px
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const mid = (lo + hi) / 2 || 1
    // Axis floor, not smoothing: a 0.05% session must read as flat rather than
    // being auto-scaled into a mountain range. Real points, honest amplitude.
    const range = Math.max(hi - lo, Math.abs(mid) * 0.002)
    const band = H * 0.13
    const y0 = horizonY()
    for (let i = 0; i < tapeN; i++) {
      tapeX[i] = x0 + ((pts[i].t - t0) / (t1 - t0)) * (x1 - x0)
      tapeY[i] = y0 - ((pts[i].px - mid) / range) * band
    }
  }

  /** The market's own line, sampled where a drop is about to land. */
  function tapeAt(x) {
    if (tapeN < 2) return horizonY()
    if (x <= tapeX[0]) return tapeY[0]
    if (x >= tapeX[tapeN - 1]) return tapeY[tapeN - 1]
    let lo = 0, hi = tapeN - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (tapeX[m] <= x) lo = m; else hi = m
    }
    const span = tapeX[hi] - tapeX[lo] || 1
    return tapeY[lo] + ((x - tapeX[lo]) / span) * (tapeY[hi] - tapeY[lo])
  }

  function drawTape(now) {
    // Density drives the tape's presence, never its colour: 0.50 → 0.90.
    const alpha = lerp(0.5, 0.9, intensity)
    const x0 = padX * 1.5
    const x1 = W - padX * 1.5
    const revealX = x0 + (x1 - x0) * reveal
    if (reveal <= 0) return

    ctx.lineCap = 'butt'
    if (tapeN < 2) {
      // Under two collected points there is no series to draw. A flat 1px rule
      // at 0.22 — the floor of the scene, and an honest statement that we have
      // watched for less than two polls.
      const fy = Math.round(horizonY()) + 0.5
      ctx.globalAlpha = 0.22
      ctx.strokeStyle = C_WARM
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, fy)
      ctx.lineTo(revealX, fy)
      ctx.stroke()
      ctx.globalAlpha = 1
      return
    }

    let lastIdx = 0
    ctx.beginPath()
    ctx.moveTo(tapeX[0], tapeY[0])
    for (let i = 1; i < tapeN; i++) {
      if (tapeX[i] > revealX) break
      ctx.lineTo(tapeX[i], tapeY[i])
      lastIdx = i
    }
    // Area fill below — the tape is a floor, so it has a body.
    ctx.lineTo(tapeX[lastIdx], H)
    ctx.lineTo(tapeX[0], H)
    ctx.closePath()
    ctx.globalAlpha = 1
    ctx.fillStyle = gTape
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(tapeX[0], tapeY[0])
    for (let i = 1; i <= lastIdx; i++) ctx.lineTo(tapeX[i], tapeY[i])
    ctx.globalAlpha = alpha
    ctx.strokeStyle = C_WARM
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Leading-point pulse — one of exactly two infinite animations on a
    // settled screen (the other is the DOM live dot).
    const pr = 2 + Math.sin(now / 900) * 0.7
    ctx.globalAlpha = clamp(alpha + 0.08, 0, 1)
    ctx.beginPath()
    ctx.arc(tapeX[lastIdx], tapeY[lastIdx], pr, 0, Math.PI * 2)
    ctx.fillStyle = C_WARM
    ctx.fill()
    ctx.globalAlpha = 1
  }

  /* ── liquidation rain ──────────────────────────────────────────────────── */

  function takeDrop() {
    for (let i = 0; i < activeCap; i++) if (!drops[i].on) return drops[i]
    let oldest = drops[0]
    for (let i = 1; i < activeCap; i++) if (drops[i].born < oldest.born) oldest = drops[i]
    return oldest
  }

  function spawnDrop(ev, now) {
    const d = takeDrop()
    d.on = true
    d.side = ev.side
    d.r = ev.radius
    d.ring = ev.ring
    d.ripple = ev.ripple
    d.rippled = false
    d.born = now
    // Traversal 6–9s at rest, 2.5s at full cascade. Jitter is seeded from the
    // event id, so a given liquidation always falls at the same pace.
    const base = lerp(7600, 2500, intensity)
    d.dur = base + ((ev.seed % 1600) - 800) * (1 - intensity * 0.7)
    // Cascade weights the field: longs left of centre, shorts right. At rest
    // the whole width is in play for both.
    const rnd = ((ev.seed >>> 8) % 10000) / 10000
    const bias = intensity * 0.44
    const lo = ev.side === 'long' ? 0.04 : 0.04 + bias
    const hi = ev.side === 'long' ? 0.96 - bias : 0.96
    d.xf = lo + rnd * (hi - lo)
    drawnDrops++
  }

  function drawDrops(now) {
    // +40% over the packet's curve. The rain is the page's continuous life and
    // it was reading as specks; a longer taper is what makes a fall legible as
    // a fall rather than a dot appearing at two places.
    const trailScale = lerp(0.98, 1.96, intensity)
    const innerW = W - padX * 2
    for (let i = 0; i < DROP_POOL; i++) {
      const d = drops[i]
      if (!d.on) continue
      const x = padX + d.xf * innerW
      const ty = tapeAt(x)
      const p = (now - d.born) / d.dur
      const bear = d.side === 'long'
      let y, alpha, dir

      if (bear) {
        // Forced selling falls onto the market and smears down through it.
        if (p < 1) {
          const e = p * (0.55 + 0.45 * p)
          y = lerp(-d.r - 6, ty, e)
          alpha = 0.7
          dir = 1
        } else {
          const lp = (now - d.born - d.dur) / LAND_MS
          if (lp >= 1) { d.on = false; continue }
          y = ty + d.r * 1.6 * lp
          alpha = 0.7 * (1 - lp)
          dir = 1
        }
      } else {
        // Shorts push up off the line and dissipate.
        if (p >= 1) { d.on = false; continue }
        const e = p * (1.55 - 0.55 * p)
        y = lerp(ty, ty - baselineY * 0.92, e)
        alpha = 0.7 * clamp((1 - p) / 0.3, 0, 1)
        dir = -1
      }

      if (d.ripple && !d.rippled && p >= 1) {
        d.rippled = true
        pushRipple(x, ty, d.r, now)
      }

      const colour = bear ? C_BEAR : C_BULL
      // Tapered trail — three shortening segments, never a translucent
      // full-canvas fillRect ghost.
      const seg = (d.r * 2.2 * trailScale) / 3
      ctx.strokeStyle = colour
      ctx.lineCap = 'round'
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = alpha * (0.5 - k * 0.14)
        ctx.lineWidth = Math.max(0.6, d.r * (0.8 - k * 0.22))
        ctx.beginPath()
        ctx.moveTo(x, y - dir * seg * k)
        ctx.lineTo(x, y - dir * seg * (k + 1))
        ctx.stroke()
      }

      ctx.globalAlpha = alpha
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(x, y, d.r, 0, Math.PI * 2)
      ctx.fill()

      if (d.ring) {
        ctx.globalAlpha = alpha * 0.45
        ctx.strokeStyle = colour
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(x, y, d.r + 3.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  function pushRipple(x, y, r0, now) {
    for (let i = 0; i < RIPPLE_POOL; i++) {
      if (!ripples[i].on) {
        ripples[i].on = true; ripples[i].x = x; ripples[i].y = y
        ripples[i].born = now; ripples[i].r0 = r0
        return
      }
    }
  }

  function drawRipples(now) {
    for (let i = 0; i < RIPPLE_POOL; i++) {
      const rp = ripples[i]
      if (!rp.on) continue
      const p = (now - rp.born) / RIPPLE_MS
      if (p >= 1) { rp.on = false; continue }
      ctx.globalAlpha = 0.22 * (1 - p)
      ctx.strokeStyle = C_WARM
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(rp.x, rp.y, rp.r0 + p * 74, Math.PI * 1.08, Math.PI * 1.92)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  /* ── whale lane ────────────────────────────────────────────────────────── */

  function spawnStreak(ev, now) {
    let s = null
    for (let i = 0; i < STREAK_POOL; i++) if (!streaks[i].on) { s = streaks[i]; break }
    if (!s) { s = streaks[0]; for (let i = 1; i < STREAK_POOL; i++) if (streaks[i].born < s.born) s = streaks[i] }
    s.on = true
    s.cls = ev.cls
    // An unknown-counterparty transfer carries no direction claim, so it gets
    // no direction grammar either — the side is taken from the tx hash so the
    // lane does not read as one-way traffic that the data never asserted.
    s.dir = ev.cls === 'unknown' ? ((ev.seed & 1) ? 'ltr' : 'rtl') : ev.dir
    s.stroke = ev.stroke
    s.tint = ev.tint
    s.usd = ev.usd
    s.left = ev.leftLabel
    s.right = ev.rightLabel
    s.resolved = false
    s.born = now
    s.dur = STREAK_MS
    s.yf = ((ev.seed >>> 3) % 1000) / 1000
    drawnStreaks++
  }

  function drawLane(now) {
    const xA = railL
    const xB = railR
    const span = xB - xA

    // The two walls. Always present, achromatic — the only tint in the whole
    // lane lives on the right (venue) glyph, and only while it is resolving.
    ctx.globalAlpha = 0.07
    ctx.strokeStyle = C_WARM
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(xA - 6.5, laneTop - 6); ctx.lineTo(xA - 6.5, laneTop + laneH + 6)
    ctx.moveTo(xB + 6.5, laneTop - 6); ctx.lineTo(xB + 6.5, laneTop + laneH + 6)
    ctx.stroke()

    if (plateT && now - plateT < PLATE_MS) {
      const p = 1 - (now - plateT) / PLATE_MS
      ctx.globalAlpha = 0.4 * p
      ctx.fillStyle = plateTint === 'bear' ? C_BEAR : C_BULL
      ctx.fillRect(xB + 4, laneTop - 6, 5, laneH + 12)
    }
    // The void has a shape, not a name: an empty hairline square.
    if (voidT && now - voidT < 1400) {
      const p = 1 - (now - voidT) / 1400
      ctx.globalAlpha = 0.3 * p
      ctx.strokeStyle = C_WARM
      ctx.lineWidth = 1
      ctx.strokeRect(xA - 13.5, laneTop + laneH / 2 - 5.5, 11, 11)
    }
    ctx.globalAlpha = 1

    for (let i = 0; i < STREAK_POOL; i++) {
      const s = streaks[i]
      if (!s.on) continue
      const p = (now - s.born) / s.dur
      const y = Math.round(laneTop + s.yf * laneH) + 0.5
      const ltr = s.dir === 'ltr'
      let u = p                    // eased traversal fraction
      let alpha = 0.75
      let trail = 46 + s.stroke * 22
      let dashed = false

      if (s.cls === 'mint') {
        alpha = 0.75
        trail *= clamp(p * 3, 0, 1)   // grows 0 → full over the traverse
      } else if (s.cls === 'burn') {
        alpha = 0.4 * clamp((1 - p) / 0.25, 0, 1)
        trail *= clamp(1 - p * 1.15, 0.04, 1)  // tapers to a dot, then fades
      } else if (s.cls === 'redeem') {
        alpha = 0.5 * clamp((1 - p) / 0.3, 0, 1)
        trail *= clamp(1 - p * 0.8, 0.15, 1)
      } else if (s.cls === 'deposit') {
        // Decelerates over the last 15% and stops dead against the wall — the
        // only impact in the scene.
        u = p < 0.85 ? p : 0.85 + 0.15 * (1 - (1 - clamp((p - 0.85) / 0.15, 0, 1)) ** 2)
        if (p > 1) { u = 1; alpha = 0.75 * clamp(1 - (p - 1) * 4, 0, 1) }
      } else if (s.cls === 'withdrawal') {
        u = p ** 1.8                   // accelerates away from the wall
        alpha = 0.75 * clamp((1 - p) / 0.25, 0, 1)
      } else {
        alpha = 0.22
        dashed = true
      }

      if (p >= 1 && !s.resolved) {
        s.resolved = true
        if (s.cls === 'deposit') { plateT = now; plateTint = 'bear' }
        if (s.cls === 'withdrawal') { plateT = now; plateTint = 'bull' }
        if (s.cls === 'burn') voidT = now
        if (s.cls !== 'unknown' && typeof onLane === 'function') {
          onLane({ left: s.left, right: s.right, cls: s.cls, usd: s.usd })
        }
      }
      const dead = s.cls === 'deposit' ? p > 1.3 : p >= 1
      if (dead) { s.on = false; continue }

      const headX = dashed
        ? (ltr ? u * W : W - u * W)
        : (ltr ? xA + u * span : xB - u * span)
      const tailX = ltr ? headX - trail : headX + trail

      ctx.globalAlpha = clamp(alpha, 0, 1)
      ctx.strokeStyle = C_WARM
      ctx.lineWidth = s.stroke
      ctx.lineCap = 'round'
      if (dashed) ctx.setLineDash(DASH_UNKNOWN)
      ctx.beginPath()
      ctx.moveTo(tailX, y)
      ctx.lineTo(headX, y)
      ctx.stroke()
      if (dashed) ctx.setLineDash(DASH_NONE)

      if (!dashed) {
        // Head glow, doubled. shadowBlur and additive blending are both banned
        // on this page (they re-composite the whole stage), so the halo is two
        // concentric hairline strokes at falling alpha — drawn, not filtered.
        const hr = Math.max(1.6, s.stroke * 0.72)
        ctx.strokeStyle = C_WARM
        ctx.lineWidth = 1
        for (let k = 1; k <= 2; k++) {
          ctx.globalAlpha = clamp(alpha * (0.34 - (k - 1) * 0.16), 0, 1)
          ctx.beginPath()
          ctx.arc(headX, y, hr + k * 2.4, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.globalAlpha = clamp(alpha + 0.2, 0, 1)
        ctx.fillStyle = C_WARM
        ctx.beginPath()
        ctx.arc(headX, y, hr, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  /* ── frame ─────────────────────────────────────────────────────────────── */

  function frame(ts) {
    raf = requestAnimationFrame(frame)
    if (paused || !inView || document.hidden) return

    // Frame-budget watchdog (degradation ladder step 4) — silent, no UI.
    // Measured on the RAW rAF delta, not on the time since the last drawn
    // frame: a 30fps gate on a 60Hz display skips ticks, so the gated delta
    // regularly reads ~50ms on a perfectly healthy machine and would trip the
    // watchdog on everyone. The raw delta is the display's real frame cost.
    const raw = prevRaf ? ts - prevRaf : 16.7
    prevRaf = ts
    if (raw > 40) { slowRun++; fastRun = 0 } else if (raw < 25) { fastRun++; slowRun = 0 }
    if (!degraded && slowRun >= 30) { degraded = true; activeCap = DROP_POOL >> 1; slowRun = 0 }
    else if (degraded && fastRun >= 300) { degraded = false; activeCap = DROP_POOL; fastRun = 0 }

    const interval = 1000 / (degraded ? FPS_DEGRADED : FPS_NORMAL)
    const elapsed = ts - last
    if (elapsed < interval) return
    last = ts - (elapsed % interval)

    // Rect at draw time, never from state.
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const bw = Math.round(w * dpr)
    const bh = Math.round(h * dpr)
    // Guarded: writing an IDENTICAL value still re-allocates the backing store,
    // which is the mobile chart-flicker trap.
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    if (w !== W || h !== H) rebuildGeometry(w, h)
    if (tapeDirty) projectTape()

    // setTransform, never ctx.scale — scale() multiplies into the existing
    // matrix and compounds on every resize.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = gGround
    ctx.fillRect(0, 0, w, h)

    drawHorizonGlow()
    drawTape(ts)
    drawDrops(ts)
    drawRipples(ts)
    drawLane(ts)

    if (ts - lastStat >= 1000) {
      lastStat = ts
      let active = 0
      for (let i = 0; i < DROP_POOL; i++) if (drops[i].on) active++
      if (typeof onStats === 'function') onStats({ drawnDrops, drawnStreaks, active, degraded })
    }
  }

  function start() {
    if (running || paused || !inView || document.hidden) return
    running = true; last = 0; raf = requestAnimationFrame(frame)
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0 }

  const onVis = () => { if (document.hidden) stop(); else start() }
  document.addEventListener('visibilitychange', onVis)

  let io = null
  if (typeof IntersectionObserver === 'function') {
    // Out of view is treated exactly like hidden: a full stop, not a throttle.
    io = new IntersectionObserver((entries) => {
      inView = entries.some(e => e.isIntersecting)
      if (inView) start(); else stop()
    }, { threshold: 0 })
    io.observe(canvas)
  }

  if (!document.hidden) start()

  return {
    /** Hand the scene real events. Nothing else can create a particle. */
    spawn(events) {
      const now = performance.now()
      for (const ev of events) {
        if (!ev) continue
        if (ev.kind === 'liq') spawnDrop(ev, now)
        else if (ev.kind === 'whale') spawnStreak(ev, now)
      }
    },
    /** Session series collected since the page opened — [{t, px}]. */
    setTape(points) { tapeRaw = points; tapeDirty = true },
    setIntensity(v) {
      const next = clamp(Number(v) || 0, 0, 1)
      if (Math.abs(next - intensity) < 0.005) return
      intensity = next
      tapeDirty = true   // the horizon lift moves the whole projected series
    },
    setReveal(v) { reveal = clamp(Number(v) || 0, 0, 1) },
    setPaused(v) {
      const next = !!v
      if (next === paused) return
      paused = next
      if (paused) stop(); else start()
    },
    isPaused() { return paused },
    destroy() {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      if (io) io.disconnect()
    },
  }
}
