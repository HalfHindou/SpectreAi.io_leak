/**
 * ThemeGlobe — the draggable orb that opens a theme picker.
 *
 * Extracted from pro-theme-studio.jsx 2026-08-08 because Spectre LITE needs the
 * SAME control. It used to be PRO-only and, since it floats above every page
 * and LITE is a fixed full-screen overlay, it landed on top of LITE offering
 * PRO's looks — which did nothing there (founder: "themes don't work in lite").
 * The answer is not to hide it from LITE but to let LITE mount its own, wired
 * to its own picker: `onOpen` is the whole difference between the two hosts.
 *
 * Position (side + vertical fraction) is shared via one localStorage key, so a
 * user who drags it in PRO finds it in the same place in LITE. On phones only
 * `side` carries over — see posStyle for why the vertical half cannot.
 */
import React, { useEffect, useRef, useState } from 'react'
import { openThemeStudio } from '@/lib/theme-studio'
import './theme-globe.css'

const GLOBE_POS_KEY = 'spectre-globe-pos-v1'
const DRAG_THRESHOLD = 7

function readGlobePos() {
  try {
    const raw = localStorage.getItem(GLOBE_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if ((p?.side === 'left' || p?.side === 'right') && Number.isFinite(p?.topFrac)) return p
  } catch { /* noop */ }
  return null
}

export default function ThemeGlobe({ onOpen, label = 'Themes' }) {
  const [pos, setPos] = useState(readGlobePos)
  const [drag, setDrag] = useState(null) // {x, y} while actively dragging
  const [, forceTick] = useState(0)
  const gesture = useRef(null)

  // stored position resolves against the live viewport → re-render on resize
  useEffect(() => {
    const onResize = () => forceTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return
    const r = e.currentTarget.getBoundingClientRect()
    gesture.current = {
      startX: e.clientX, startY: e.clientY,
      dx: e.clientX - r.left, dy: e.clientY - r.top,
      size: r.width, moved: false,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const g = gesture.current
    if (!g) return
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return
    g.moved = true
    setDrag({ x: e.clientX - g.dx, y: e.clientY - g.dy })
  }
  const onPointerUp = (e) => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (!g.moved) { setDrag(null); (onOpen || openThemeStudio)(); return }
    const cx = e.clientX - g.dx + g.size / 2
    const next = {
      side: cx < window.innerWidth / 2 ? 'left' : 'right',
      topFrac: Math.min(0.9, Math.max(0.06, (e.clientY - g.dy) / window.innerHeight)),
    }
    // stay in left/top pixel positioning for the release too, so the snap to
    // the edge ANIMATES instead of teleporting (left→right property swaps
    // don't transition — the "super weird" mobile drag)
    setDrag(null)
    setPos(next)
    try { localStorage.setItem(GLOBE_POS_KEY, JSON.stringify(next)) } catch { /* noop */ }
  }

  const isPhone = window.innerWidth <= 768
  const size = isPhone ? 36 : 40
  const posStyle = (p) => {
    const vh = window.innerHeight
    // PHONES DOCK TO THE BOTTOM CORNER. The stored position is one key shared
    // with desktop on purpose, but only `side` survives the trip: a fraction
    // dragged on a 1400px desktop resolves to mid-height on an 844px phone,
    // and on a phone — unlike desktop, where content is centred with margins —
    // every list row runs the full width, so mid-height right edge IS the
    // change%/star column. Measured 2026-08-31 at 390px: the orb sat on
    // Tether's $478m (Vitals), the brief copy (Today), the Derivatives Pulse
    // card (Markets) and a price label on the Research chart. The strip above
    // the tab bar is the only part of a phone screen that is chrome, not data,
    // so that is where it parks — still draggable, still side-aware.
    const minTop = isPhone ? vh - 200 : 60
    const maxTop = isPhone ? vh - 104 - size : vh - 160
    const top = Math.min(maxTop, Math.max(minTop, p.topFrac * vh))
    const left = p.side === 'left' ? 10 : window.innerWidth - size - 10
    return { left, top, right: 'auto', bottom: 'auto', transform: 'none' }
  }
  const style = drag
    ? { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto', transform: 'none' }
    : pos
      ? posStyle(pos)
      : undefined // default spot lives in CSS: above the Monarch fab

  return (
    <button
      type="button"
      className={`pro-theme-globe${drag ? ' is-dragging' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { gesture.current = null; setDrag(null) }}
      aria-label={label}
      title={label}
    >
      {/* the orb is layered so every animation is compositor-only and never
          fights the button's own hover/drag transforms: glow breathes behind,
          the body floats, two sheens counter-rotate inside it */}
      <span className="pro-theme-globe-glow" aria-hidden="true" />
      <span className="pro-theme-globe-body" aria-hidden="true">
        <span className="pro-theme-globe-swirl" />
        <span className="pro-theme-globe-swirl pro-theme-globe-swirl--b" />
        <span className="pro-theme-globe-core" />
      </span>
    </button>
  )
}
