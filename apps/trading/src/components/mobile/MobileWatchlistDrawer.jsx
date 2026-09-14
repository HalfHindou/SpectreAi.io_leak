/**
 * MobileWatchlistDrawer — Markets bottom sheet.
 *
 * Opened from the left side-rail's Markets tab. The body is the SAME mobile
 * board the home tab uses (MobileScreener) — not the desktop LeftPanel, which
 * stacked four rows of chrome above the first token on a phone.
 *
 * Chrome is deliberately thin: grabber + a floating close button. The board
 * brings its own sticky category pills (top) and the glass dock with
 * timeframe / chain / sort (bottom); both anchor to .mwd-body, the scroller.
 *
 * Tap a row → open the token and close the sheet. Long-press → peek (built into
 * MobileTokenRow). Swipe right → watchlist.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import MobileScreener from './home/MobileScreener'
import './MobileWatchlistDrawer.css'

export default function MobileWatchlistDrawer({
  open,
  onClose,
  selectToken,
  watchlist,
  addToWatchlist,
  removeFromWatchlist,
}) {
  const sheetRef = useRef(null)
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) setDragOffset(0)
  }, [open])

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

  /* The board keys watchlist membership by address-or-symbol; the drawer only
     ever receives the flat watchlist array. */
  const watchKeys = useMemo(() => {
    const s = new Set()
    for (const w of watchlist || []) {
      if (w?.address) s.add(w.address)
      if (w?.symbol) s.add(w.symbol)
    }
    return s
  }, [watchlist])
  const isInWatchlist = useCallback((key) => watchKeys.has(key), [watchKeys])

  // Picking a token is the drawer's whole purpose — hand it up, then get out.
  const handleSelect = useCallback((t) => {
    selectToken?.(t)
    onClose?.()
  }, [selectToken, onClose])

  if (!open) return null

  return (
    <div
      className="mwd-root"
      role="dialog"
      aria-modal="true"
      aria-label="Markets - token discovery"
    >
      <button
        type="button"
        className="mwd-backdrop"
        aria-label="Close markets"
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        className="mwd-sheet"
        /* `mwdSheetIn` fills `both`, and an animation's computed value beats an
           inline style - the entrance keyframe's translateY(0) would pin the
           sheet and the drag would never move it. Same fix as mmk-/mfs-. */
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, animation: 'none' } : undefined}
      >
        <div
          className="mwd-grabber-region"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mwd-grabber" aria-hidden="true" />
        </div>

        <button
          type="button"
          className="mwd-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={17} strokeWidth={2.2} />
        </button>

        <div className="mwd-body">
          <MobileScreener
            active={open}
            selectToken={handleSelect}
            isInWatchlist={isInWatchlist}
            addToWatchlist={addToWatchlist}
            removeFromWatchlist={removeFromWatchlist}
          />
        </div>
      </div>
    </div>
  )
}
