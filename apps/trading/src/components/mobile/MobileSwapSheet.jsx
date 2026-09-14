/**
 * MobileSwapSheet — bottom sheet overlay that mounts the existing
 * RightPanel (which contains the full Swap UI) on phones.
 *
 * Pattern: backdrop scrim + content sheet sliding up from the bottom.
 * Closing: backdrop tap, close button, drag down from the grabber,
 * or pressing Escape.
 *
 * The Swap form lives inside RightPanel (1000-line component); rather
 * than refactor it out for this release, we mount the whole panel.
 * The sheet has its own scroll context so the panel content can be
 * any height.
 */
import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import RightPanel from '../RightPanel'
import './MobileSwapSheet.css'

export default function MobileSwapSheet({ open, onClose, token, mode = 'buy' }) {
  const sheetRef = useRef(null)
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)

  // Escape to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset drag state when the sheet opens.
  useEffect(() => {
    if (open) setDragOffset(0)
  }, [open])

  // Drag-down on the grabber to dismiss.
  const handleTouchStart = (e) => {
    startYRef.current = e.touches?.[0]?.clientY ?? null
  }
  const handleTouchMove = (e) => {
    if (startYRef.current == null) return
    const dy = (e.touches?.[0]?.clientY ?? startYRef.current) - startYRef.current
    if (dy > 0) setDragOffset(dy)
  }
  const handleTouchEnd = () => {
    if (dragOffset > 120) onClose?.()
    else setDragOffset(0)
    startYRef.current = null
  }

  if (!open) return null

  return (
    <div
      className="mss-root"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'buy' ? 'Buy' : 'Sell'}
    >
      {/* Backdrop */}
      <button
        type="button"
        className="mss-backdrop"
        aria-label="Close swap"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="mss-sheet"
        /* `mssSheetIn` fills `both`, and an animation's computed value beats an
           inline style - the entrance keyframe's translateY(0) would pin the
           sheet and the drag would never move it. Same fix as mmk-/mfs-. */
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, animation: 'none' } : undefined}
      >
        {/* Drag handle + header */}
        <div
          className="mss-grabber-region"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mss-grabber" aria-hidden="true" />
        </div>

        <header className="mss-header">
          <h2 className="mss-title">
            {mode === 'buy' ? 'Buy' : 'Sell'} {token?.symbol || 'token'}
          </h2>
          <button
            type="button"
            className="mss-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        {/* Body: mount the existing RightPanel which renders the swap form
            and supporting cards. It manages its own state. */}
        <div className="mss-body">
          <RightPanel token={token} initialMode={mode} />
        </div>
      </div>
    </div>
  )
}
