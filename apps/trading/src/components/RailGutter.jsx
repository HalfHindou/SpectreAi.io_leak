/**
 * RailGutter - GMGN-style col-resize handle on a token-page rail edge.
 *
 * Zero-width grid child sitting on the rail/center boundary; its 12px hit
 * strip covers the grid gap. Drag flow copies TradingChart's proven resize
 * pattern exactly: a full-viewport transparent overlay keeps the TradingView
 * iframe (and everything else) from stealing pointer events, capture-phase
 * document listeners, DIRECT DOM writes during the drag (zero React
 * re-renders), one store commit on release.
 */
import React, { useCallback } from 'react'
import { RAIL_MIN, RAIL_MAX } from '../lib/tokenLayout'
import './RailGutter.css'

export default function RailGutter({ side, leftW, rightW, railCap = RAIL_MAX, onCommit, hidden }) {
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const main = e.currentTarget.closest('.main-layout')
    if (!main) return
    const startX = e.clientX
    const startW = side === 'left' ? leftW : rightW
    const maxW = Math.min(RAIL_MAX, railCap)
    let liveW = startW

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;cursor:col-resize;'
    document.body.appendChild(overlay)
    document.body.style.userSelect = 'none'
    main.classList.add('layout-resizing')

    const template = (l, r) => `${l}px minmax(0, 1fr) ${r}px`
    const onMove = (ev) => {
      ev.preventDefault()
      const dx = ev.clientX - startX
      // Left rail grows when dragging right; right rail grows dragging left.
      liveW = Math.max(RAIL_MIN, Math.min(maxW, Math.round(startW + (side === 'left' ? dx : -dx))))
      main.style.gridTemplateColumns = side === 'left' ? template(liveW, rightW) : template(leftW, liveW)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      overlay.remove()
      document.body.style.userSelect = ''
      main.classList.remove('layout-resizing')
      if (liveW !== startW) onCommit?.(side, liveW)
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
  }, [side, leftW, rightW, railCap, onCommit])

  return (
    <div
      className={`rail-gutter rail-gutter--${side}`}
      style={hidden ? { display: 'none' } : undefined}
      aria-hidden="true"
    >
      <div className="rail-gutter__hit" onMouseDown={handleMouseDown} />
    </div>
  )
}
