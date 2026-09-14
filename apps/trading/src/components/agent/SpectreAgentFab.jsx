/**
 * SpectreAgentFab - the draggable Spectre-logo button that opens the agent
 * panel. Pointer-event drag with a 6px click-vs-drag threshold; position
 * (viewport percentages + snapped side) persists in useSettingsStore.agentFab
 * so it survives reloads and never lands off-screen. Renders nothing while
 * the panel is open (the panel header carries the close).
 */
import { useCallback, useEffect, useRef } from 'react'
import useSettingsStore from '../../store/useSettingsStore'
import './SpectreAgentFab.css'

const DRAG_THRESHOLD = 6
const FAB_SIZE = 48
const EDGE_GAP = 14

function dockH() {
  if (typeof window === 'undefined') return 109
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--mtp-dock-h')
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : 109
}

function maxTop(mobile) {
  const h = window.innerHeight
  return mobile
    ? Math.max(8, h - dockH() - FAB_SIZE - EDGE_GAP)
    : h - 56
}

function defaultPos(mobile) {
  if (!mobile) return { xPct: 96, yPct: 62 }
  const w = window.innerWidth || 390
  const h = window.innerHeight || 844
  const x = Math.max(8, w - FAB_SIZE - EDGE_GAP)
  return { xPct: (x / w) * 100, yPct: (maxTop(true) / h) * 100 }
}

export default function SpectreAgentFab({ open, onOpen, mobile = false, listening = false }) {
  // Mobile keeps its own persisted position (agentFabMobile) so a desktop
  // drag never bleeds onto the phone's very different viewport.
  const agentFabDesktop = useSettingsStore((s) => s.agentFab)
  const agentFabMobile = useSettingsStore((s) => s.agentFabMobile)
  const setAgentFabDesktop = useSettingsStore((s) => s.setAgentFab)
  const setAgentFabMobile = useSettingsStore((s) => s.setAgentFabMobile)
  const agentFab = mobile ? agentFabMobile : agentFabDesktop
  const setAgentFab = mobile ? setAgentFabMobile : setAgentFabDesktop

  const btnRef = useRef(null)
  const dragRef = useRef(null) // { startX, startY, origX, origY, dragging }

  // Position from persisted percentages, clamped only enough to stay fully
  // on-screen (8px margins) - the FAB can sit ANYWHERE incl. the header/center.
  const applyPosition = useCallback((xPct, yPct) => {
    const el = btnRef.current
    if (!el) return
    const x = Math.min(Math.max((xPct / 100) * window.innerWidth, 8), window.innerWidth - 56)
    const y = Math.min(Math.max((yPct / 100) * window.innerHeight, 8), maxTop(mobile))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [mobile])

  useEffect(() => {
    if (!mobile) return
    try {
      if (localStorage.getItem('spectre-agentfab-mobile-v2')) return
      localStorage.setItem('spectre-agentfab-mobile-v2', '1')
      const def = defaultPos(true)
      if ((agentFab?.yPct ?? 0) < def.yPct - 5) setAgentFab({ ...def, side: 'right' })
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const place = () => {
      const def = defaultPos(mobile)
      applyPosition(agentFab?.xPct ?? def.xPct, agentFab?.yPct ?? def.yPct)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [agentFab?.xPct, agentFab?.yPct, applyPosition, mobile])

  const onPointerDown = useCallback((e) => {
    const el = btnRef.current
    if (!el) return
    el.setPointerCapture?.(e.pointerId)
    const rect = el.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, dragging: false }
  }, [])

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    const el = btnRef.current
    if (!d || !el) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.dragging = true
    el.classList.add('sagent-fab--dragging')
    const x = Math.min(Math.max(d.origX + dx, 8), window.innerWidth - 56)
    const y = Math.min(Math.max(d.origY + dy, 8), maxTop(mobile))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [mobile])

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current
    const el = btnRef.current
    dragRef.current = null
    if (!el) return
    el.classList.remove('sagent-fab--dragging')
    if (!d) return
    if (!d.dragging) { onOpen?.(); return }
    // Free placement: persist exactly where the user dropped it (no edge snap).
    // `side` is kept only as a hint for the panel's default open side.
    const rect = el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const side = centerX < window.innerWidth / 2 ? 'left' : 'right'
    const xPct = (rect.left / window.innerWidth) * 100
    const yPct = (rect.top / window.innerHeight) * 100
    setAgentFab({ xPct, yPct, side })
    applyPosition(xPct, yPct)
  }, [onOpen, setAgentFab, applyPosition])

  // Keep the node mounted while the panel is open (hidden via class) - a
  // conditional `return null` would swap in a FRESH button on close without
  // re-running the position effect (deps unchanged), leaving it at 0,0.
  return (
    <button
      ref={btnRef}
      type="button"
      className={`sagent-fab${open ? ' sagent-fab--hidden' : ''}${listening ? ' sagent-fab--listening' : ''}`}
      aria-label="Open Spectre Agent"
      title={listening ? 'Listening - say "Hey Spectre" or tap to talk' : 'Spectre Agent'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="sagent-fab__wave" aria-hidden="true" />
      <img src="/spectre-icon.png" alt="" className="sagent-fab__logo" draggable={false} />
    </button>
  )
}
