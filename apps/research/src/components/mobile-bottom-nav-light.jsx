/**
 * The travelling light on the mobile tab bar.
 *
 * One element, two states, and the transition between them IS the animation:
 *
 *   settled   a RING around the active tab
 *   moving    a straight ROD spanning from where it left to where it is going
 *
 * Never a curve, never an end stranded in mid-air. That is achieved by drawing a
 * single stadium path whose two ends are independent points — when both ends sit
 * on the same tab the path degenerates into a circle, so the ring and the rod are
 * literally the same shape at different extensions.
 *
 * THE PHYSICS. Each end gets its own spring, and the GAP between them is what
 * makes the light feel alive:
 *
 *   head  stiff and well damped — it leaves immediately and arrives first
 *   tail  soft while there is trip left to run, then STIFFENS as the head lands
 *
 * So the rod opens as it launches, runs at length, and closes once it arrives.
 * A single spring on a single shape can only slide; two springs on two ends
 * stretch, which is the whole effect.
 *
 * Weight and brightness follow speed, in opposite directions: the stroke
 * thickens as the rod opens and DIMS exactly when it is doing the most, so the
 * fast part of the move reads as motion blur rather than as a brighter object.
 *
 * The bar can also be scrubbed: drag anywhere along it and the light follows the
 * finger, snapping to the nearest tab on release.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

/* The frame lives in a tiny store rather than in host state. The spring writes a
   frame per rAF, and the host is the whole tab bar - five buttons plus dropdown
   logic - so host state re-reconciled the entire nav on every frame of every
   move, in the exact frames the destination page is mounting. Only <TabLight>
   subscribes, so a frame now re-renders two <path> elements and nothing else. */
function createFrameStore() {
  let frame = null
  const subs = new Set()
  return {
    set(next) { frame = next; subs.forEach((fn) => fn()) },
    get: () => frame,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
  }
}

/** Head: leaves at once, arrives without wobble. */
const HEAD_K = 235
const HEAD_C = 22
/** Tail: loose at launch (62), stiff on landing (62 + 155) so the rod closes. */
const TAIL_K0 = 62
const TAIL_K1 = 155
const TAIL_C0 = 10
const TAIL_C1 = 16

/** Above this the spring is close enough that another frame changes nothing. */
const REST_EPS = 0.35
const REST_V = 6

const RING_R = 17
const SPEED_NORM = 1400

const smoothstep = (t) => t * t * (3 - 2 * t)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function mixHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)]
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)]
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`
}

/** A stadium: two arcs joined by two lines. ax === bx collapses it to a circle. */
function capsulePath(ax, bx, cy, r) {
  const l = Math.min(ax, bx)
  const rr = Math.max(ax, bx)
  return `M ${l.toFixed(2)} ${(cy - r).toFixed(2)}`
    + ` L ${rr.toFixed(2)} ${(cy - r).toFixed(2)}`
    + ` A ${r} ${r} 0 0 1 ${rr.toFixed(2)} ${(cy + r).toFixed(2)}`
    + ` L ${l.toFixed(2)} ${(cy + r).toFixed(2)}`
    + ` A ${r} ${r} 0 0 1 ${l.toFixed(2)} ${(cy - r).toFixed(2)}`
    + ' Z'
}

/**
 * @param {object}   opts
 * @param {React.RefObject} opts.hostRef  element containing the [data-mbn-slot] buttons
 * @param {number}   opts.active          index of the active slot
 * @param {string[]} opts.accents         per-slot hex accent
 * @param {(i:number)=>void} opts.onPick  fired when a scrub lands on a slot
 */
export function useTabLight({ hostRef, active, accents, onPick }) {
  const storeRef = useRef(null)
  if (!storeRef.current) storeRef.current = createFrameStore()
  const setFrame = useCallback((f) => storeRef.current.set(f), [])
  const slotsRef = useRef([])
  const aRef = useRef(null)
  const bRef = useRef(null)
  const tripRef = useRef(1)
  const rafRef = useRef(0)
  const lastTsRef = useRef(0)
  const scrubRef = useRef(null)
  const fromAccentRef = useRef(accents[active] || '#f5f5f7')

  /* The frame loop re-schedules ITSELF, so anything it closes over is frozen at
     the moment the chain started. Closing over `active` meant a move re-armed
     the loop with the OLD target, the stale frame saw itself already at that
     target, declared the spring settled and killed the chain — the light
     teleported instead of travelling. The loop reads refs and nothing else. */
  const activeRef = useRef(active)
  const accentsRef = useRef(accents)
  const pickRef = useRef(onPick)
  activeRef.current = active
  accentsRef.current = accents
  pickRef.current = onPick

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  /** Slot centres, measured from the DOM — never assumed from a column count. */
  const measure = useCallback(() => {
    const host = hostRef.current
    if (!host) return false
    const box = host.getBoundingClientRect()
    const nodes = [...host.querySelectorAll('[data-mbn-slot]')]
    if (!nodes.length || !box.width) return false
    slotsRef.current = nodes.map((n) => {
      const r = n.getBoundingClientRect()
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, r: r.width / 2 }
    })
    return true
  }, [hostRef])

  const tick = useCallback((ts) => {
    const active = activeRef.current
    const accents = accentsRef.current
    const slots = slotsRef.current
    const a = aRef.current
    const b = bRef.current
    if (!a || !b || !slots.length) return

    const dt = lastTsRef.current ? Math.min(0.032, (ts - lastTsRef.current) / 1000) : 0.016
    lastTsRef.current = ts

    const scrub = scrubRef.current
    const target = scrub != null ? scrub : (slots[active]?.x ?? a.x)

    // Whichever end is chasing furthest in the direction of travel is the head.
    const mid = (a.x + b.x) / 2
    const goingRight = target >= mid
    const head = goingRight ? b : a
    const tail = goingRight ? a : b

    // Sub-step so a dropped frame cannot make a stiff spring explode.
    const steps = Math.max(1, Math.ceil(dt / 0.008))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      const d = Math.abs(head.x - target)
      const home = smoothstep(1 - clamp01(tripRef.current > 0 ? d / tripRef.current : 0))
      head.v += (-HEAD_K * (head.x - target) - HEAD_C * head.v) * h
      tail.v += (-(TAIL_K0 + TAIL_K1 * home) * (tail.x - target) - (TAIL_C0 + TAIL_C1 * home) * tail.v) * h
      head.x += head.v * h
      tail.x += tail.v * h
    }

    const slot = slots[active] || slots[0]
    const speed = clamp01((Math.abs(a.v) + Math.abs(b.v)) / 2 / SPEED_NORM)
    const toAccent = accents[active] || '#f5f5f7'
    const spread = Math.abs(a.x - b.x)
    // Colour arrives with the head rather than switching on tap, so a move reads
    // as one light travelling and not as two different lights.
    const colour = mixHex(fromAccentRef.current, toAccent, clamp01(1 - spread / Math.max(1, tripRef.current)))

    setFrame({
      d: capsulePath(a.x, b.x, slot.y, RING_R),
      colour,
      width: 1.7 + speed * 1.7,
      opacity: 0.95 - speed * 0.4,
      glow: 0.55 - speed * 0.3,
    })

    const settled = scrub == null
      && Math.abs(a.x - target) < REST_EPS && Math.abs(b.x - target) < REST_EPS
      && Math.abs(a.v) < REST_V && Math.abs(b.v) < REST_V
    if (settled) {
      a.x = target; b.x = target; a.v = 0; b.v = 0
      fromAccentRef.current = toAccent
      setFrame({ d: capsulePath(target, target, slot.y, RING_R), colour: toAccent, width: 1.7, opacity: 0.95, glow: 0.55 })
      rafRef.current = 0
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [setFrame])

  const kick = useCallback(() => {
    if (!rafRef.current) {
      lastTsRef.current = 0
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [tick])

  // Re-target on tab change.
  useEffect(() => {
    if (!measure()) return
    const slots = slotsRef.current
    const to = slots[active]
    if (!to) return

    if (!aRef.current) {
      aRef.current = { x: to.x, v: 0 }
      bRef.current = { x: to.x, v: 0 }
      fromAccentRef.current = accents[active] || '#f5f5f7'
      setFrame({ d: capsulePath(to.x, to.x, to.y, RING_R), colour: accents[active] || '#f5f5f7', width: 1.7, opacity: 0.95, glow: 0.55 })
      return
    }
    if (reduced) {
      aRef.current = { x: to.x, v: 0 }
      bRef.current = { x: to.x, v: 0 }
      fromAccentRef.current = accents[active] || '#f5f5f7'
      setFrame({ d: capsulePath(to.x, to.x, to.y, RING_R), colour: accents[active] || '#f5f5f7', width: 1.7, opacity: 0.95, glow: 0.55 })
      return
    }
    tripRef.current = Math.max(1, Math.abs(to.x - (aRef.current.x + bRef.current.x) / 2))
    kick()
  }, [active, measure, kick, reduced, accents, setFrame])

  // Re-measure on resize / orientation change.
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      if (!measure()) return
      const to = slotsRef.current[active]
      if (!to) return
      if (aRef.current && !rafRef.current) {
        aRef.current.x = to.x; bRef.current.x = to.x
        setFrame({ d: capsulePath(to.x, to.x, to.y, RING_R), colour: accents[active] || '#f5f5f7', width: 1.7, opacity: 0.95, glow: 0.55 })
      }
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [hostRef, measure, active, accents, setFrame])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  /* ── scrub: drag the light along the bar ─────────────────────────────── */

  const nearest = useCallback((x) => {
    const slots = slotsRef.current
    let best = 0
    let bestD = Infinity
    slots.forEach((s, i) => { const d = Math.abs(s.x - x); if (d < bestD) { bestD = d; best = i } })
    return best
  }, [])

  const dragRef = useRef({ on: false, moved: false, startX: 0 })

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!measure()) return
    dragRef.current = { on: true, moved: false, startX: e.clientX }
  }, [measure])

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current
    if (!drag.on) return
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < 8) return
    if (!drag.moved) {
      drag.moved = true
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not fatal */ }
    }
    const host = hostRef.current
    if (!host) return
    const box = host.getBoundingClientRect()
    const slots = slotsRef.current
    const lo = slots[0]?.x ?? 0
    const hi = slots[slots.length - 1]?.x ?? box.width
    scrubRef.current = Math.max(lo, Math.min(hi, e.clientX - box.left))
    tripRef.current = Math.max(1, tripRef.current)
    kick()
  }, [hostRef, kick])

  const endDrag = useCallback((e) => {
    const drag = dragRef.current
    if (!drag.on) return
    dragRef.current = { on: false, moved: drag.moved, startX: 0 }
    if (scrubRef.current != null) {
      const i = nearest(scrubRef.current)
      scrubRef.current = null
      tripRef.current = Math.max(1, Math.abs((slotsRef.current[i]?.x ?? 0) - ((aRef.current?.x ?? 0) + (bRef.current?.x ?? 0)) / 2))
      kick()
      if (i !== activeRef.current) pickRef.current?.(i)
    }
    if (drag.moved) {
      // The finger travelled, so this was a scrub — swallow the click the
      // browser is about to synthesise on whichever button it happens to end on.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault() }
      e.currentTarget?.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => e.currentTarget?.removeEventListener('click', swallow, { capture: true }), 350)
    }
  }, [nearest, kick])

  return {
    light: storeRef.current,
    scrubHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  }
}

/** The light itself. Purely decorative — it never intercepts a tap. */
export function TabLight({ light }) {
  const frame = useSyncExternalStore(light.subscribe, light.get, light.get)
  if (!frame) return null
  return (
    <svg className="mbn-light" aria-hidden="true" focusable="false">
      <path
        className="mbn-light__halo"
        d={frame.d}
        stroke={frame.colour}
        strokeWidth={frame.width * 3.2}
        opacity={frame.glow}
      />
      <path
        className="mbn-light__core"
        d={frame.d}
        stroke={frame.colour}
        strokeWidth={frame.width}
        opacity={frame.opacity}
      />
    </svg>
  )
}
