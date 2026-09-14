/**
 * SpectreAgentPanel - the docked agent chat panel (desktop + embed). Mounts
 * ONLY inside TokenDetailsProvider (App.jsx token view) - the context
 * assembler reads useSharedTokenDetails and would throw elsewhere. The
 * fetch-bearing context hooks live here (mount-gated: panel open = data
 * assembly on; api-patterns.md L pattern 1).
 *
 * Full movement control: free-drag by the header (grip affordance), resize
 * from the bottom-right corner. The DOCKED position/size persists
 * (useSettingsStore.agentPanel) and defaults to opening right next to the FAB.
 * FULL VIEW is a larger centered mode over a backdrop that is ALSO fully
 * drag/resizable (its position is session-local). Everything clamps on-screen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, Trash2, GripVertical, Maximize2, Minimize2 } from 'lucide-react'
import { useAgentTokenContext } from '../../hooks/useAgentTokenContext'
import { useAgentChat } from '../../hooks/useAgentChat'
import { useAgentBrief, briefForDigest } from '../../hooks/useAgentBrief'
import { useAgentVoice } from '../../hooks/useAgentVoice'
import AgentChatSurface from './AgentChatSurface'
import AgentOrdersRow from './AgentOrdersRow'
import './SpectreAgentPanel.css'

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const MIN_W = 300
const MIN_H = 360

// One layout model for both modes. Null on small viewports (CSS bottom-sheet)
// and embed. Full view: large, centered by default, overridable by fullPos.
// Docked: persisted spot, else beside the FAB at its actual location.
function panelLayout(fab, panelPos, surface, fullView, fullPos) {
  if (typeof window === 'undefined' || surface === 'embed') return null
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (vw <= 520) return null
  const M = 16
  if (fullView) {
    const W = clamp(Number(fullPos?.w) || Math.min(1040, vw - 2 * M), MIN_W, vw - 2 * M)
    const H = clamp(Number(fullPos?.h) || Math.min(900, vh - 2 * M), MIN_H, vh - 2 * M)
    const left = Number.isFinite(fullPos?.left) ? fullPos.left : (vw - W) / 2
    const top = Number.isFinite(fullPos?.top) ? fullPos.top : (vh - H) / 2
    return { W, H, left: clamp(left, M, vw - W - M), top: clamp(top, M, vh - H - M) }
  }
  const defW = Math.min(380, vw - 2 * M)
  const defH = Math.min(640, Math.round(vh * 0.84), vh - 2 * M)
  const W = clamp(Number(panelPos?.w) || defW, MIN_W, vw - 2 * M)
  const H = clamp(Number(panelPos?.h) || defH, MIN_H, vh - 2 * M)
  let left
  let top
  if (panelPos && Number.isFinite(panelPos.xPct)) {
    left = (panelPos.xPct / 100) * vw
    top = (panelPos.yPct / 100) * vh
  } else {
    const fabSize = 48
    const gap = 12
    const fabX = (clamp(Number(fab?.xPct ?? 96), 0, 100) / 100) * vw
    const fabY = (clamp(Number(fab?.yPct ?? 62), 0, 100) / 100) * vh
    left = fabX + fabSize / 2 > vw / 2 ? fabX - gap - W : fabX + fabSize + gap
    top = fabY + fabSize / 2 - H / 2
  }
  return { W, H, left: clamp(left, M, vw - W - M), top: clamp(top, M, vh - H - M) }
}

export default function SpectreAgentPanel({ token, fab, panelPos, onPanelMove, side = 'right', surface = 'desktop', onClose, onSelectToken, autoVoice = false, voiceEpoch = 0, onVoiceActiveChange }) {
  const { ready, getDigest } = useAgentTokenContext(token, { surface })

  // The opening brief ("Jarvis mode") - server-generated + KV-cached, so
  // this is one fetch per token per fresh-window across ALL users. Mounted
  // here = only while the panel is open (the cost gate stays mount-gating).
  const { brief, loading: briefLoading } = useAgentBrief(token, { surface })
  const voice = useAgentVoice(token, brief, { surface })
  const briefRef = useRef(null)
  useEffect(() => { briefRef.current = brief }, [brief])

  // Follow-up questions must know what the user was just told: carry a
  // compact brief summary on the digest (ref-read so chat identity is
  // stable across brief arrivals).
  const getDigestWithBrief = useCallback(() => {
    const d = getDigest?.()
    if (!d) return d
    const carry = briefForDigest(briefRef.current)
    return carry ? { ...d, agentBrief: carry } : d
  }, [getDigest])

  const chat = useAgentChat(token, { getDigest: getDigestWithBrief, surface })

  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const resizeRef = useRef(null)
  const [fullView, setFullView] = useState(false)
  const [fullPos, setFullPos] = useState(null) // session-local full-view geometry

  const floating = typeof window !== 'undefined' && !!panelLayout(fab, panelPos, surface, fullView, fullPos)

  // Apply size + position on the node directly (before paint - no flash, no
  // React/DOM fight during a drag). Re-runs on open, mode/FAB/persisted change,
  // and resize (clamped into view).
  const applyLayout = useCallback(() => {
    const el = panelRef.current
    if (!el) return
    const lay = panelLayout(fab, panelPos, surface, fullView, fullPos)
    if (!lay) { // mobile / embed - clear inline, let the CSS bottom-sheet drive
      for (const p of ['left', 'top', 'right', 'bottom', 'width', 'height']) el.style[p] = ''
      return
    }
    el.style.width = `${lay.W}px`
    el.style.height = `${lay.H}px`
    el.style.left = `${Math.round(lay.left)}px`
    el.style.top = `${Math.round(lay.top)}px`
    el.style.right = 'auto'
    el.style.bottom = 'auto'
  }, [fab, panelPos, surface, fullView, fullPos])

  useLayoutEffect(() => { applyLayout() }, [applyLayout])
  useEffect(() => {
    window.addEventListener('resize', applyLayout)
    return () => window.removeEventListener('resize', applyLayout)
  }, [applyLayout])

  // Persist a drag/resize result to the right place: full-view geometry is
  // session-local; docked position + size persist to the store.
  const commit = useCallback((rect) => {
    if (fullView) {
      setFullPos({ left: rect.left, top: rect.top, w: Math.round(rect.width), h: Math.round(rect.height) })
    } else {
      onPanelMove?.({
        xPct: (rect.left / window.innerWidth) * 100,
        yPct: (rect.top / window.innerHeight) * 100,
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      })
    }
  }, [fullView, onPanelMove])

  // ── Header drag (capture on the HEADER so pointerup lands and the drop
  //    places wherever released - works in docked AND full view) ──
  const onDragDown = useCallback((e) => {
    if (e.target.closest?.('.sagent-panel__iconbtn')) return // keep buttons clickable
    if (!panelRef.current || !floating) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const rect = panelRef.current.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, w: rect.width, h: rect.height, dragging: false }
  }, [floating])

  const onDragMove = useCallback((e) => {
    const d = dragRef.current
    const el = panelRef.current
    if (!d || !el) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.dragging && Math.hypot(dx, dy) < 4) return
    d.dragging = true
    el.classList.add('sagent-panel--dragging')
    const M = 16
    el.style.left = `${clamp(d.origX + dx, M, window.innerWidth - d.w - M)}px`
    el.style.top = `${clamp(d.origY + dy, M, window.innerHeight - d.h - M)}px`
    el.style.right = 'auto'
    el.style.bottom = 'auto'
  }, [])

  const onDragUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const d = dragRef.current
    const el = panelRef.current
    dragRef.current = null
    if (!el) return
    el.classList.remove('sagent-panel--dragging')
    if (!d || !d.dragging) return
    commit(el.getBoundingClientRect())
  }, [commit])

  // ── Bottom-right resize (docked AND full view) ──
  const onResizeDown = useCallback((e) => {
    e.stopPropagation()
    if (!panelRef.current) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const rect = panelRef.current.getBoundingClientRect()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: rect.width, origH: rect.height, left: rect.left, top: rect.top }
  }, [])

  const onResizeMove = useCallback((e) => {
    const r = resizeRef.current
    const el = panelRef.current
    if (!r || !el) return
    const M = 16
    el.classList.add('sagent-panel--dragging')
    el.style.width = `${clamp(r.origW + (e.clientX - r.startX), MIN_W, window.innerWidth - r.left - M)}px`
    el.style.height = `${clamp(r.origH + (e.clientY - r.startY), MIN_H, window.innerHeight - r.top - M)}px`
  }, [])

  const onResizeUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const r = resizeRef.current
    const el = panelRef.current
    resizeRef.current = null
    if (!el) return
    el.classList.remove('sagent-panel--dragging')
    if (!r) return
    commit(el.getBoundingClientRect())
  }, [commit])

  const effSide = fab?.side === 'left' ? 'left' : side

  return (
    <>
      {fullView && <div className="sagent-backdrop" onClick={() => setFullView(false)} />}
      <div ref={panelRef} className={`sagent-panel sagent-panel--${effSide}${fullView ? ' sagent-panel--full' : ''}`} role="dialog" aria-label="Spectre Agent">
        <div
          className={`sagent-panel__header${floating ? ' sagent-panel__header--drag' : ''}`}
          onPointerDown={floating ? onDragDown : undefined}
          onPointerMove={floating ? onDragMove : undefined}
          onPointerUp={floating ? onDragUp : undefined}
          onPointerCancel={floating ? onDragUp : undefined}
        >
          <div className="sagent-panel__identity">
            {floating && <GripVertical size={14} className="sagent-panel__grip" aria-hidden="true" />}
            <img src="/spectre-icon.png" alt="" className="sagent-panel__logo" draggable={false} />
            <div className="sagent-panel__titles">
              <span className="sagent-panel__title">Spectre Agent</span>
              <span className="sagent-panel__subtitle">
                {token?.symbol ? `${token.symbol}` : ''}
                {chat.meta?.degraded ? ' - limited mode' : ''}
                {!ready && token?.symbol ? ' - loading data' : ''}
              </span>
            </div>
          </div>
          <div className="sagent-panel__actions">
            {chat.messages.length > 0 && (
              <button type="button" className="sagent-panel__iconbtn" title="Clear conversation" onClick={chat.clear}>
                <Trash2 size={14} />
              </button>
            )}
            <button
              type="button"
              className="sagent-panel__iconbtn"
              title={fullView ? 'Exit full view' : 'Full view'}
              onClick={() => setFullView((v) => !v)}
            >
              {fullView ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button type="button" className="sagent-panel__iconbtn" title="Close" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        <AgentChatSurface chat={chat} tokenSymbol={token?.symbol} surface={surface} onSelectToken={onSelectToken} brief={brief} briefLoading={briefLoading} voice={voice} autoVoice={autoVoice} voiceEpoch={voiceEpoch} onVoiceActiveChange={onVoiceActiveChange} />

        {surface !== 'embed' && <AgentOrdersRow token={token} surface={surface} />}

        <div className="sagent-panel__foot">
          Analysis, not financial advice. Trades always need your confirmation.
        </div>

        {floating && (
          <div
            className="sagent-panel__resize"
            title="Drag to resize"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
          />
        )}
      </div>
    </>
  )
}
