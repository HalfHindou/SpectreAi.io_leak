/**
 * Brain — The All-Seeing.
 *
 * The consciousness rendered as a living eye. Generative canvas:
 *   - a soft iris (fill + fine filaments + limbal ring) tinted by the regime
 *   - an outer AWARENESS ring: one tick per live domain, brightening when fresh
 *   - a rotating camera-aperture sensor ring around it
 *   - four rings turning at the pulse / wave / tide / ocean cadences (the clocks)
 *   - 3 scan beams at different radii/speeds (one slow, one fast) sweeping the field
 *   - the desk's live intel orbits as "thoughts" (colored by lens, sized by
 *     conviction) with faint orbit trails; "watching" items drift at the periphery
 *   - a faint inward data-stream of particles = thoughts being absorbed
 *   - a moving gaze-beam locks onto the focused thought; convergence web links kin
 *   - the pupil dilates with conviction, TRACKS THE CURSOR, and the eye BLINKS
 *
 * Robust sizing: ResizeObserver + a per-frame DPR check re-derive ALL cached
 * dims/geometry, so the backing buffer never disagrees with the CSS box.
 * Motion is gated on document.hidden, viewport intersection, and
 * prefers-reduced-motion (which renders a single static frame).
 */
import React, { useRef, useEffect, useState, useMemo } from 'react'
import useBrainDesk from './use-brain-desk'
import './brain-eye.css'

const TWO_PI = Math.PI * 2
const LENS_COLOR = {
  Onchain: '#34d399', Institutional: '#60a5fa', Leverage: '#f59e0b',
  Degen: '#c084fc', Macro: '#f5f5f7', Governance: '#a78bfa', Signal: '#9ca3af', Risk: '#f87171',
}
const LENS_ANGLE = {
  Onchain: -Math.PI / 2, Institutional: -Math.PI / 6, Leverage: Math.PI / 6,
  Degen: Math.PI / 2, Macro: (5 * Math.PI) / 6, Governance: (7 * Math.PI) / 6, Signal: (3 * Math.PI) / 2,
}
// category → severity hint when no convergence conviction is attached to a thought
const SEVERITY = { liquidations: 0.9, hacks: 1, exploit: 1, hack: 1, whale: 0.8, whales: 0.8, funding: 0.72, unlock: 0.7, unlocks: 0.7, regulatory: 0.75 }

function toneRGB(t) { return t === 'bull' ? [64, 220, 160] : t === 'bear' ? [248, 113, 113] : [234, 234, 240] }
function hexA(hex, a) {
  const h = String(hex || '#9ca3af').replace('#', '')
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(s, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// ── Caption hygiene — never show a null/undefined/NaN clause or a raw field dump.
const BAD_TOKEN = /\b(?:null|undefined|nan)\b/i
function sanitizeCaption(raw) {
  if (raw == null) return ''
  let s = String(raw).replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (BAD_TOKEN.test(s)) {
    // 1) drop any delimiter-bounded chunk (comma / semicolon / parens) carrying a bad token
    s = s.replace(/\s*[,;(][^,;()]*\b(?:null|undefined|nan)\b[^,;()]*\)?/gi, '')
    // 2) drop a trailing connective phrase with no delimiter ("with a momentum rank of null")
    s = s.replace(/\s+\b(?:with|and|at|of|by|for|showing|having|while|as)\b[^.,;]*\b(?:null|undefined|nan)\b[^.]*/gi, '')
    // 3) anything still carrying a bad token → cut back to the clause boundary before it
    const idx = s.search(BAD_TOKEN)
    if (idx >= 0) {
      const head = s.slice(0, idx)
      const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf('. '), head.lastIndexOf(' — '))
      s = cut > 0 ? head.slice(0, cut) : head
    }
  }
  // truncate to the first sentence for a tight caption (a bare "." after a digit = decimal, ignored)
  const dot = s.search(/[.!?](?:\s|$)/)
  if (dot >= 24) s = s.slice(0, dot + 1)
  // trim dangling connective words / punctuation left at the tail
  s = s.replace(/[\s,;:.\-—–]+$/, '')
    .replace(/\s+\b(?:with|and|at|of|by|for|the|a|an|to|in|on|is|are|was|from)\b$/i, '')
    .replace(/[\s,;:.\-—–]+$/, '')
    .trim()
  return s
}

// Compact per-domain freshness for the awareness ring (0.28 stale → 1 fresh). Skips empty domains.
function awarenessFreshness(data) {
  if (!data || typeof data !== 'object') return []
  const out = []
  for (const k in data) {
    const d = data[k]
    if (!d || typeof d !== 'object') continue
    const items = d.items
    const count = Array.isArray(items) ? items.length : (items && typeof items === 'object' ? Object.keys(items).length : 0)
    if (!count) continue
    const t = d.ts ? new Date(d.ts).getTime() : NaN
    const ageMs = Number.isFinite(t) ? Date.now() - t : null
    const fresh = ageMs != null && ageMs >= 0 && ageMs < 5 * 60_000 ? 1
      : (ageMs != null && ageMs < 60 * 60_000 ? 0.55 : 0.28)
    out.push(fresh)
  }
  return out
}

function agoShort(ts) {
  if (!ts) return null
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function BrainEye({ mind, awareness, desk: deskProp, health }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  // Prefer the parent's desk hook instance (halves the fetch fan-out); fall
  // back to our own only when mounted standalone.
  const ownDesk = useBrainDesk({ enabled: !deskProp })
  const desk = deskProp || ownDesk
  const [focus, setFocus] = useState(0)
  const stateRef = useRef({
    mouse: { x: 0, y: 0, tx: 0, ty: 0 }, t: 0, focus: 0, nodes: [], watch: [], aware: [],
    tone: [234, 234, 240], conv: 0.5, clocks: [], nextBlink: 3,
    // wake: 1 = fully conscious, ~0.45 = resting (stale data), ~0.18 = asleep
    // (offline). The eye must LOOK different when the brain is not thinking —
    // the 16-day coma of 2026-08 animated exactly like a healthy brain.
    wake: 0.7, wakeCur: 0.7, pulseT: -100, lastGen: null,
  })

  const model = useMemo(() => {
    const conv = desk.convergence || []
    const key = (a) => String(a || '').toUpperCase().replace(/^\$/, '')
    const nodes = (desk.intel || []).slice(0, 18).map((it, i) => {
      const proj = key(it.project)
      const convIdx = conv.findIndex((c) => { const a = key(c.asset); return a && (a === proj || (a.length > 2 && proj.includes(a)) || (proj.length > 2 && a.includes(proj))) })
      const cRow = convIdx >= 0 ? conv[convIdx] : null
      const conviction = cRow && Number.isFinite(cRow.conviction) ? cRow.conviction / 100 : null
      const sev = SEVERITY[String(it.category || '').toLowerCase()]
      return {
        project: it.project, read: it.read, lens: it.lens, bias: it.bias, category: it.category, convIdx,
        weight: conviction ?? sev ?? 0.5,
        color: LENS_COLOR[it.lens] || '#9ca3af',
        baseAngle: (LENS_ANGLE[it.lens] ?? (i / 18) * TWO_PI) + ((i * 37) % 100) / 260,
        orbit: 1.0 + ((i * 53) % 100) / 900,
      }
    })
    const wlist = (desk.watching || []).slice(0, 10)
    const watch = wlist.map((w, i) => ({
      label: typeof w === 'string' ? w : (w?.label || w?.asset || w?.note || ''),
      baseAngle: (i / Math.max(1, wlist.length)) * TWO_PI + 0.35,
      orbit: 1.68 + ((i * 41) % 100) / 620,
    }))
    return { nodes, watch }
  }, [desk.intel, desk.convergence, desk.watching])

  const nodes = model.nodes
  const aware = useMemo(() => awarenessFreshness(awareness), [awareness])

  useEffect(() => { if (!nodes.length) return; setFocus((f) => f % nodes.length); const id = setInterval(() => setFocus((f) => (f + 1) % nodes.length), 4200); return () => clearInterval(id) }, [nodes.length])
  useEffect(() => { stateRef.current.focus = focus }, [focus])
  useEffect(() => { stateRef.current.nodes = model.nodes; stateRef.current.watch = model.watch }, [model])
  useEffect(() => { stateRef.current.aware = aware }, [aware])
  useEffect(() => {
    const r = mind?.read
    stateRef.current.tone = toneRGB(r?.tone)
    stateRef.current.conv = (r?.conviction ?? 50) / 100
    stateRef.current.clocks = mind?.clocks || []
  }, [mind])
  useEffect(() => {
    const s = health?.status
    stateRef.current.wake = s === 'live' ? 1 : s === 'stale' ? 0.45 : s === 'offline' ? 0.18 : 0.7
  }, [health?.status])
  // A new desk generation = a visible thought: fire one synapse pulse.
  useEffect(() => {
    const st = stateRef.current
    if (desk.updatedAt && st.lastGen && desk.updatedAt !== st.lastGen) st.pulseT = st.t
    if (desk.updatedAt) st.lastGen = desk.updatedAt
  }, [desk.updatedAt])

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    let raf = 0, running = false, W = 0, H = 0, DPR = 1
    const rmql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    let reduced = !!(rmql && rmql.matches)
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + 0.2, p: Math.random() * 6.28, s: Math.random() * 0.5 + 0.15 }))
    const noise = Array.from({ length: 160 }, () => Math.random())
    // pre-allocated inward data-stream particles (no per-frame allocation in the loop)
    const streams = Array.from({ length: 30 }, () => ({ a: Math.random() * TWO_PI, r: 0.28 + Math.random() * 0.95, s: 0.0016 + Math.random() * 0.0024, w: Math.random() }))
    const beams = [
      { speed: 0.55, radius: 1.42, alpha: 0.18, width: 1.5, dir: 1 },
      { speed: 0.13, radius: 1.06, alpha: 0.11, width: 2.0, dir: 1 },
      { speed: 0.92, radius: 1.26, alpha: 0.07, width: 1.0, dir: -1 },
    ]

    function measure() {
      const r = wrap.getBoundingClientRect()
      let w = r.width || wrap.clientWidth || wrap.offsetWidth || 0
      let h = r.height || wrap.clientHeight || wrap.offsetHeight || 0
      return { w, h }
    }
    function resize() {
      const { w, h } = measure()
      if (w <= 0 || h <= 0) return // never size to 0 — keep the last good dims
      DPR = Math.min(window.devicePixelRatio || 1, 2) // re-derive live every resize (zoom / monitor move)
      W = w; H = h
      const bw = Math.max(1, Math.round(w * DPR)), bh = Math.max(1, Math.round(h * DPR))
      if (canvas.width !== bw) canvas.width = bw
      if (canvas.height !== bh) canvas.height = bh
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0) // canvas.width write resets the transform — always re-apply
      if (!running) draw() // repaint one frame with fresh dims when paused / reduced-motion
    }
    resize()
    requestAnimationFrame(resize) // catch late layout while the hero grid settles on first paint
    const ro = new ResizeObserver(resize); ro.observe(wrap)
    window.addEventListener('resize', resize) // browser zoom / DPR change that RO may miss

    const onMove = (e) => { const r = wrap.getBoundingClientRect(); stateRef.current.mouse.tx = e.clientX - r.left - W / 2; stateRef.current.mouse.ty = e.clientY - r.top - H / 2 }
    const onLeave = () => { stateRef.current.mouse.tx = 0; stateRef.current.mouse.ty = 0 }
    wrap.addEventListener('mousemove', onMove); wrap.addEventListener('mouseleave', onLeave)

    function draw() {
      // self-heal a DPR change (e.g. window dragged to another monitor) without waiting for an event
      const liveDpr = Math.min(window.devicePixelRatio || 1, 2)
      if (liveDpr !== DPR) resize()
      if (W <= 0 || H <= 0) return

      const S = stateRef.current
      S.wakeCur += (S.wake - S.wakeCur) * 0.02
      const wake = S.wakeCur
      // an unconscious brain moves slowly — every cadence scales with wakefulness
      if (!reduced) S.t += 0.016 * (0.35 + 0.65 * wake)
      S.mouse.x += (S.mouse.tx - S.mouse.x) * 0.05; S.mouse.y += (S.mouse.ty - S.mouse.y) * 0.05
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.38 // geometry re-derived from current dims every frame
      const tone = S.tone, conv = S.conv
      const tc = (a) => `rgba(${tone[0]},${tone[1]},${tone[2]},${a})`
      const breathing = 0.92 + 0.08 * Math.sin(S.t * 0.8)
      const gx = Math.max(-R * 0.16, Math.min(R * 0.16, S.mouse.x * 0.1))
      const gy = Math.max(-R * 0.16, Math.min(R * 0.16, S.mouse.y * 0.1))

      // blink schedule → lid 0..1..0; a resting eye also DROOPS — the lids sit
      // half-closed whenever the data behind the consciousness is not live.
      let lid = 0
      if (!reduced && S.t >= S.nextBlink) {
        const p = (S.t - S.nextBlink) / 0.34
        if (p >= 1) S.nextBlink = S.t + 5.5 + noise[Math.floor(S.t) % noise.length] * 6
        else lid = Math.sin(p * Math.PI)
      }
      const droop = (1 - wake) * 0.62
      lid = Math.max(lid, droop)

      ctx.clearRect(0, 0, W, H)

      // ambient glow — dims with wakefulness
      const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.85)
      g.addColorStop(0, tc((0.1 + 0.05 * Math.sin(S.t * 1.1)) * (0.45 + 0.55 * wake)))
      g.addColorStop(0.5, tc(0.028 * (0.5 + 0.5 * wake))); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

      ctx.globalCompositeOperation = 'lighter'
      // starfield
      for (const st of stars) {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(S.t * st.s + st.p))
        ctx.fillStyle = `rgba(245,245,247,${0.05 * tw})`
        ctx.beginPath(); ctx.arc(st.x * W - gx * 0.16, st.y * H - gy * 0.16, st.r, 0, 6.28); ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'

      // outer AWARENESS ring — one tick per live domain, brightening when fresh
      const aw = S.aware
      if (aw && aw.length) {
        const N = aw.length, ar = R * 1.56
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TWO_PI - Math.PI / 2
          const f = aw[i]
          const ca = Math.cos(a), sa = Math.sin(a), len = 2.5 + f * 5.5
          ctx.strokeStyle = `rgba(245,245,247,${0.045 + 0.26 * f})`
          ctx.lineWidth = f > 0.9 ? 1.5 : 1
          ctx.beginPath(); ctx.moveTo(cx + ca * ar, cy + sa * ar); ctx.lineTo(cx + ca * (ar + len), cy + sa * (ar + len)); ctx.stroke()
          if (f > 0.9) { ctx.fillStyle = 'rgba(245,245,247,0.5)'; ctx.beginPath(); ctx.arc(cx + ca * (ar + len + 2.5), cy + sa * (ar + len + 2.5), 1.1, 0, 6.28); ctx.fill() }
        }
      }

      // aperture sensor ring — fine ticks, slow rotation
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(S.t * 0.02)
      const ticks = 54, tr = R * 1.5
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * 6.28, long = i % 9 === 0, l = long ? 7 : 3.5
        ctx.strokeStyle = tc(long ? 0.2 : 0.09); ctx.lineWidth = long ? 1.3 : 1
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * tr, Math.sin(a) * tr); ctx.lineTo(Math.cos(a) * (tr + l), Math.sin(a) * (tr + l)); ctx.stroke()
      }
      ctx.restore()

      // clock rings
      const clocks = S.clocks
      const spd = [0.24, 0.15, 0.09, 0.05]
      for (let i = 0; i < 4; i++) {
        const c = clocks[i]; const rr = R * (1.12 + i * 0.15); const dir = i % 2 ? -1 : 1
        const a0 = S.t * spd[i] * dir; const ct = toneRGB(c?.tone)
        const alpha = 0.1 + 0.14 * (c?.stance ? 1 : 0.35)
        ctx.lineWidth = 1.1; ctx.strokeStyle = `rgba(${ct[0]},${ct[1]},${ct[2]},${alpha})`
        for (let s = 0; s < 3; s++) { const start = a0 + s * (6.28 / 3); ctx.beginPath(); ctx.arc(cx, cy, rr, start, start + (6.28 / 3) * 0.58); ctx.stroke() }
      }

      // watching — faint peripheral motes (things on the edge of attention)
      const wt = S.watch
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < wt.length; i++) {
        const ang = wt[i].baseAngle - S.t * 0.03
        const orbit = R * (wt[i].orbit + 0.04 * Math.sin(S.t * 0.5 + i))
        const wx = cx + Math.cos(ang) * orbit, wy = cy + Math.sin(ang) * orbit
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(S.t * 0.6 + i * 1.3))
        ctx.fillStyle = `rgba(245,245,247,${0.16 * tw})`
        ctx.beginPath(); ctx.arc(wx, wy, 1.5, 0, 6.28); ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'

      // iris fill (soft depth)
      const irisR = R * 0.8 * breathing
      const ig = ctx.createRadialGradient(cx + gx * 0.3, cy + gy * 0.3, R * 0.34, cx, cy, irisR)
      ig.addColorStop(0, tc(0.02)); ig.addColorStop(0.62, tc(0.09)); ig.addColorStop(0.92, tc(0.05)); ig.addColorStop(1, tc(0))
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, irisR, 0, 6.28); ctx.fill()

      // iris filaments (two passes, gaze-shifted)
      ctx.save(); ctx.translate(cx + gx * 0.3, cy + gy * 0.3); ctx.rotate(S.t * 0.035)
      const inner = R * 0.37
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < noise.length; i++) {
        const a = (i / noise.length) * Math.PI * 2
        const len = R * (0.58 + 0.36 * noise[i]) * breathing
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
        ctx.strokeStyle = tc(0.03 + 0.06 * noise[(i * 7) % noise.length]); ctx.lineWidth = 1; ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()

      // limbal ring (dark edge) + bright rim
      ctx.beginPath(); ctx.arc(cx, cy, irisR, 0, 6.28); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke()
      ctx.beginPath(); ctx.arc(cx, cy, irisR, 0, 6.28); ctx.lineWidth = 1.4; ctx.strokeStyle = tc(0.28); ctx.stroke()

      // thoughts, absorption + convergence web
      const ns = S.nodes, fi = S.focus
      const px = cx + gx, py = cy + gy
      const sweep = (S.t * 0.55) % (Math.PI * 2)
      // pass 1 — positions
      const pos = []
      for (let i = 0; i < ns.length; i++) {
        const ang = ns[i].baseAngle + S.t * 0.05
        const orbit = R * (ns[i].orbit + 0.05 * Math.sin(S.t * 0.7 + i))
        pos.push({ x: cx + Math.cos(ang) * orbit, y: cy + Math.sin(ang) * orbit, ang })
      }
      // convergence web — connect thoughts that belong to the same convergence
      const groups = {}
      for (let i = 0; i < ns.length; i++) { const gI = ns[i].convIdx; if (gI >= 0) (groups[gI] = groups[gI] || []).push(i) }
      ctx.globalCompositeOperation = 'lighter'
      for (const gk in groups) {
        const ids = groups[gk]; if (ids.length < 2) continue
        for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
          const A = pos[ids[a]], B = pos[ids[b]]
          ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
          // a bright bead drifting along the link = the connection forming
          const u = (S.t * 0.4 + a + b) % 1
          const mx = A.x + (B.x - A.x) * u, my = A.y + (B.y - A.y) * u
          const bg = ctx.createRadialGradient(mx, my, 0, mx, my, 4); bg.addColorStop(0, 'rgba(255,255,255,0.6)'); bg.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(mx, my, 4, 0, 6.28); ctx.fill()
        }
      }
      ctx.globalCompositeOperation = 'source-over'
      // pass 2 — scan lines, ABSORPTION pulses (node → pupil), dots sized by conviction
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i], P = pos[i], nx = P.x, ny = P.y
        const focused = i === fi, inConv = n.convIdx >= 0, w = n.weight
        let ad = Math.abs(((P.ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - sweep); ad = Math.min(ad, 2 * Math.PI - ad)
        const flare = Math.max(0, 1 - ad / 0.55)
        const lineA = Math.min(0.85, (focused ? 0.5 : inConv ? 0.26 : 0.1) + flare * 0.5)
        const lg = ctx.createLinearGradient(px, py, nx, ny)
        lg.addColorStop(0, hexA(n.color, 0)); lg.addColorStop(0.28, hexA(n.color, lineA * 0.45)); lg.addColorStop(1, hexA(n.color, lineA))
        ctx.strokeStyle = lg; ctx.lineWidth = focused ? 1.7 : inConv ? 1.2 : 1
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke()

        // ABSORPTION — a light pulse travels FROM the thought INTO the pupil
        const u = (S.t * 0.7 + i * 0.29) % 1
        const mx = nx + (px - nx) * u, my = ny + (py - ny) * u
        ctx.globalCompositeOperation = 'lighter'
        const pgl = ctx.createRadialGradient(mx, my, 0, mx, my, 5.5)
        pgl.addColorStop(0, hexA(n.color, (focused || inConv ? 0.7 : 0.42) + flare * 0.3)); pgl.addColorStop(1, hexA(n.color, 0))
        ctx.fillStyle = pgl; ctx.beginPath(); ctx.arc(mx, my, 5.5, 0, 6.28); ctx.fill()

        // dot + glow — size scales with conviction / severity weight
        const dsz = (focused ? 3.6 : inConv ? 2.7 : 2.1) * (0.78 + 0.75 * w) + flare * 1.4
        const db = focused ? 0.9 : (inConv ? 0.6 : 0.4) + flare * 0.4
        const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, dsz * 4.4)
        ng.addColorStop(0, hexA(n.color, db)); ng.addColorStop(1, hexA(n.color, 0))
        ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(nx, ny, dsz * 4.4, 0, 6.28); ctx.fill()
        ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(nx, ny, dsz, 0, 6.28); ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
        if (focused) {
          ctx.strokeStyle = hexA(n.color, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(nx, ny, dsz + 4.4, 0, 6.28); ctx.stroke()
          ctx.save(); ctx.setLineDash([3, 7]); ctx.lineDashOffset = -S.t * 26; ctx.strokeStyle = hexA(n.color, 0.38); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke(); ctx.restore()
        } else if (inConv) { ctx.strokeStyle = hexA(n.color, 0.45); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(nx, ny, dsz + 3.5, 0, 6.28); ctx.stroke() }
      }

      // scan beams — 3 arms at different radii & speeds (one slow, one fast)
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      for (let bi = 0; bi < beams.length; bi++) {
        const B = beams[bi]
        const bAlpha = B.alpha * (0.25 + 0.75 * wake) // a sleeping eye stops scanning
        const ang = S.t * B.speed * B.dir
        const bx = cx + Math.cos(ang) * R * B.radius, by = cy + Math.sin(ang) * R * B.radius
        const sg = ctx.createLinearGradient(px, py, bx, by)
        sg.addColorStop(0, tc(0)); sg.addColorStop(0.55, tc(bAlpha * 0.35)); sg.addColorStop(1, tc(bAlpha))
        ctx.strokeStyle = sg; ctx.lineWidth = B.width; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke()
        const dg = ctx.createRadialGradient(bx, by, 0, bx, by, 6); dg.addColorStop(0, tc(bAlpha * 1.8)); dg.addColorStop(1, tc(0))
        ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(bx, by, 6, 0, 6.28); ctx.fill()
      }
      ctx.restore()

      // inward data-stream — thoughts being absorbed (pre-allocated pool, drifting to the pupil)
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < streams.length; i++) {
        const p = streams[i]
        if (!reduced) p.r -= p.s
        if (p.r < 0.13) { p.r = 1; p.a = Math.random() * TWO_PI; p.w = Math.random() }
        const rr = p.r * R * 1.28
        const sx = cx + Math.cos(p.a) * rr + gx * 0.22, sy = cy + Math.sin(p.a) * rr + gy * 0.22
        const fade = Math.sin((1 - p.r) * Math.PI)
        ctx.fillStyle = `rgba(245,245,247,${0.09 + 0.22 * fade * (0.5 + 0.5 * p.w)})`
        ctx.beginPath(); ctx.arc(sx, sy, 0.7 + 1.0 * p.w * fade, 0, 6.28); ctx.fill()
      }
      ctx.restore()

      // synapse pulse — one bright ring radiating from the pupil when a fresh
      // desk generation lands (you can watch it think, ~every 10 min when live)
      const pdt = S.t - S.pulseT
      if (pdt >= 0 && pdt < 2.6) {
        const u = pdt / 2.6
        ctx.save(); ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = tc(0.34 * (1 - u))
        ctx.lineWidth = 2.2 - 1.4 * u
        ctx.beginPath(); ctx.arc(px, py, R * (0.22 + u * 1.5), 0, 6.28); ctx.stroke()
        ctx.restore()
      }

      // pupil (dilates w/ conviction + pulse, tracks cursor; constricts asleep)
      const pulse = 0.5 + 0.5 * Math.sin(S.t * 1.5)
      const pupilR = R * (0.19 + 0.06 * conv + 0.018 * pulse) * (1 - lid * 0.55) * (0.82 + 0.18 * wake)
      const pg = ctx.createRadialGradient(px, py, 0, px, py, pupilR)
      pg.addColorStop(0, 'rgba(0,0,0,1)'); pg.addColorStop(0.72, 'rgba(0,0,0,0.97)'); pg.addColorStop(1, tc(0.2))
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, pupilR, 0, 6.28); ctx.fill()
      ctx.beginPath(); ctx.arc(px, py, pupilR, 0, 6.28); ctx.strokeStyle = tc(0.7); ctx.lineWidth = 1.6; ctx.stroke()
      ctx.beginPath(); ctx.arc(px, py, pupilR * 0.6, 0, 6.28); ctx.strokeStyle = tc(0.22); ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(px - pupilR * 0.32, py - pupilR * 0.36, Math.max(1, pupilR * 0.13), 0, 6.28); ctx.fill()

      // glass-orb sheen (3D) — clipped to the iris so it reads as a lens
      ctx.save()
      ctx.beginPath(); ctx.arc(cx, cy, irisR, 0, 6.28); ctx.clip()
      const sp = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.38, R * 0.02, cx - R * 0.18, cy - R * 0.2, R * 1.15)
      sp.addColorStop(0, 'rgba(255,255,255,0.13)'); sp.addColorStop(0.4, 'rgba(255,255,255,0.04)'); sp.addColorStop(0.75, 'rgba(255,255,255,0)')
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sp; ctx.fillRect(cx - irisR, cy - irisR, irisR * 2, irisR * 2)
      ctx.globalCompositeOperation = 'source-over'
      const oc = ctx.createRadialGradient(cx + R * 0.36, cy + R * 0.42, R * 0.05, cx + R * 0.18, cy + R * 0.2, R * 1.05)
      oc.addColorStop(0, 'rgba(0,0,0,0.3)'); oc.addColorStop(0.5, 'rgba(0,0,0,0.07)'); oc.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = oc; ctx.fillRect(cx - irisR, cy - irisR, irisR * 2, irisR * 2)
      ctx.restore()
      // specular top-rim arc (light on glass)
      ctx.beginPath(); ctx.arc(cx, cy, irisR, -Math.PI * 0.82, -Math.PI * 0.18); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.6; ctx.stroke()

      // blink lids — full-width soft curtains (no vertical edges, so the droop
      // never reads as a hard box floating over the eye)
      if (lid > 0.001) {
        const cover = lid * R * 0.98
        const top = cy - R * 0.98, bot = cy + R * 0.98
        let gr = ctx.createLinearGradient(0, top, 0, top + cover)
        gr.addColorStop(0, 'rgba(7,7,9,0.94)'); gr.addColorStop(0.72, 'rgba(7,7,9,0.86)'); gr.addColorStop(1, 'rgba(7,7,9,0)')
        ctx.fillStyle = gr; ctx.fillRect(0, top, W, cover)
        gr = ctx.createLinearGradient(0, bot, 0, bot - cover)
        gr.addColorStop(0, 'rgba(7,7,9,0.94)'); gr.addColorStop(0.72, 'rgba(7,7,9,0.86)'); gr.addColorStop(1, 'rgba(7,7,9,0)')
        ctx.fillStyle = gr; ctx.fillRect(0, bot - cover, W, cover)
      }
      // resting veil — while the brain is not live the whole stage sits behind
      // a faint dark wash, so "asleep" is legible even in a static screenshot
      if (droop > 0.02) {
        ctx.fillStyle = `rgba(7,7,9,${0.34 * (droop / 0.62)})`
        ctx.fillRect(0, 0, W, H)
      }
    }

    function loop() { if (!running) return; raf = requestAnimationFrame(loop); draw() }
    function start() { if (running) return; if (reduced) { draw(); return } running = true; loop() }
    function stop() { running = false; cancelAnimationFrame(raf) }
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    const io = new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? start() : stop()), { threshold: 0.02 })
    io.observe(wrap)
    const onRM = () => { reduced = !!(rmql && rmql.matches); reduced ? (stop(), draw()) : start() }
    rmql?.addEventListener?.('change', onRM)
    start()

    return () => {
      stop(); ro.disconnect(); io.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      rmql?.removeEventListener?.('change', onRM)
      wrap.removeEventListener('mousemove', onMove); wrap.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const fnode = nodes[focus]
  const caption = fnode ? sanitizeCaption(fnode.read) : ''
  const resting = health?.status === 'stale' || health?.status === 'offline'
  const lastThought = agoShort(health?.updatedTs)
  return (
    <section className="eye" ref={wrapRef}>
      <canvas ref={canvasRef} className="eye-canvas" />
      <span className="eye-title">Spectre · The All-Seeing{resting ? ' · resting' : ''}</span>

      <div className="eye-focus">
        {resting ? (
          <span className="eye-focus-txt eye-dim">
            the eye is resting{lastThought ? ` — last thought ${lastThought}` : ''}
          </span>
        ) : fnode ? (
          <>
            <span className="eye-focus-dot" style={{ background: fnode.color }} />
            <span className="eye-focus-txt">
              <b style={{ color: fnode.color }}>{fnode.project}</b>
              {caption ? <> — {caption}</> : (fnode.lens ? <> · <span className="eye-dim">{fnode.lens} lens</span></> : null)}
            </span>
          </>
        ) : (
          <span className="eye-focus-txt eye-dim">the eye is opening…</span>
        )}
      </div>
    </section>
  )
}
