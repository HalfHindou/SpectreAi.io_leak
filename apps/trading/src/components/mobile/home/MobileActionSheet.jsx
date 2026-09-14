/**
 * MobileActionSheet — minimal bottom sheet for the mobile home screens
 * (prefix mas-). Same look as the screener's inline MscSheet (chain/sort
 * pickers); extracted so other screens (watchlist sort) reuse one
 * implementation instead of cloning the markup.
 */
import React, { useEffect, useRef, useState } from 'react'
import './MobileActionSheet.css'

export default function MobileActionSheet({ title, open, onClose, children }) {
  // Drag-to-dismiss from the grabber + title strip, matching the other bottom
  // sheets: follow the finger down, close past 120px.
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)
  useEffect(() => { if (open) setDragOffset(0) }, [open])

  if (!open) return null

  const dragHandlers = {
    onTouchStart: (e) => { startYRef.current = e.touches?.[0]?.clientY ?? null },
    onTouchMove: (e) => {
      if (startYRef.current == null) return
      const dy = (e.touches?.[0]?.clientY ?? startYRef.current) - startYRef.current
      if (dy > 0) setDragOffset(dy)
    },
    onTouchEnd: () => {
      if (dragOffset > 120) onClose?.()
      else setDragOffset(0)
      startYRef.current = null
    },
  }

  return (
    <div className="mas-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mas-backdrop" onClick={onClose} />
      <div
        className="mas-sheet"
        // `masRise` uses fill-mode `both` and an animation's computed value
        // beats an inline style - drop it for the duration of the drag.
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, animation: 'none' } : undefined}
      >
        <div className="mas-grabber-zone" {...dragHandlers}>
          <div className="mas-grabber" />
          <div className="mas-title">{title}</div>
        </div>
        {children}
      </div>
    </div>
  )
}
