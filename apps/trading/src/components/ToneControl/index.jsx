/**
 * ToneControl — the compact background-tone pill in the header,
 * sitting next to EnvironmentCapsule.
 *
 * Lets the user re-tone the platform's dark surfaces: pick one of the
 * curated black ladders (Pure Black, Obsidian, Graphite, Slate,
 * Midnight, Mocha) and fine-tune its depth. The adjustment repaints
 * the five ladder tokens every dark background derives from — see
 * lib/bgTone.js. Obsidian at depth 0 is the stock palette.
 *
 * Interactions:
 *   - Click                       -> popover: tone swatches + depth slider
 *   - Drag the pill horizontally  -> live depth fine-tune, commit on release
 *   - Double-click                -> reset to stock
 *   - Arrow keys / mouse wheel    -> nudge depth in small steps
 *
 * Hidden in day mode (light surfaces are explicit per-component colors,
 * not the ladder) — see tone.css.
 */

import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { Contrast, SunDim, Sun, RotateCcw, Palette, ChevronRight } from 'lucide-react'
import useSettingsStore from '../../store/useSettingsStore'
import {
  applyBgTone,
  clampDepth,
  tonePreview,
  TONES,
  DEFAULT_TONE,
  DEPTH_MIN,
  DEPTH_MAX,
} from '../../lib/bgTone'
import { applyAccent, DEFAULT_ACCENT } from '../../lib/accent'
import './tone.css'

// The full customization surface (skins + accents + tones) — heavier and
// rarely opened, so it stays off the header chunk until first use.
const AppearanceStudio = lazy(() => import('../AppearanceStudio'))

const DRAG_SENS = 0.35   // px of pointer travel -> depth units (fine control)
const SNAP = 3           // |depth| <= SNAP snaps to 0 while dragging/sliding
const CLICK_SLOP = 4     // px of travel that still counts as a plain click
const NUDGE = 4          // arrow-key / wheel step

const snapDepth = (v) => (Math.abs(v) <= SNAP ? 0 : v)

export default function ToneControl() {
  const tone = useSettingsStore((s) => s.bgTone)
  const depth = useSettingsStore((s) => s.bgDepth)
  const accentColor = useSettingsStore((s) => s.accentColor)
  const setBgTone = useSettingsStore((s) => s.setBgTone)
  const setBgDepth = useSettingsStore((s) => s.setBgDepth)
  const setAccentColor = useSettingsStore((s) => s.setAccentColor)

  const [liveDepth, setLiveDepth] = useState(depth) // depth shown while interacting
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const [studioOpen, setStudioOpen] = useState(false)

  const btnRef = useRef(null)
  const popoverRef = useRef(null)
  const dragRef = useRef(null)            // { startX, startDepth, moved, raf, dx }
  const liveRef = useRef(depth)
  const toneRef = useRef(tone)
  const suppressClickRef = useRef(false)

  liveRef.current = liveDepth
  toneRef.current = tone

  // Mirror external store changes (reset from another surface, sync, etc.)
  useEffect(() => { setLiveDepth(depth) }, [depth])

  const isCustom = tone !== DEFAULT_TONE || depth !== 0 || accentColor !== DEFAULT_ACCENT
  const toneLabel = TONES.find((t) => t.id === tone)?.label || 'Obsidian'

  // Live preview without touching the store (no localStorage churn mid-drag)
  const previewDepth = useCallback((value) => {
    const v = clampDepth(value)
    setLiveDepth(v)
    applyBgTone(toneRef.current, v)
    return v
  }, [])

  // Commit persists; App's effect re-applies the same values (idempotent)
  const commitDepth = useCallback((value) => {
    const v = clampDepth(value)
    setLiveDepth(v)
    applyBgTone(toneRef.current, v)
    setBgDepth(v)
  }, [setBgDepth])

  const pickTone = useCallback((id) => {
    applyBgTone(id, liveRef.current)
    setBgTone(id)
  }, [setBgTone])

  const resetAll = useCallback(() => {
    setLiveDepth(0)
    applyBgTone(DEFAULT_TONE, 0)
    applyAccent(DEFAULT_ACCENT)
    setBgTone(DEFAULT_TONE)
    setBgDepth(0)
    setAccentColor(DEFAULT_ACCENT)
  }, [setBgTone, setBgDepth, setAccentColor])

  /* --- pill drag (depth fine-tune) -------------------------------- */

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    dragRef.current = { startX: e.clientX, startDepth: liveDepth, moved: false, raf: 0, dx: 0 }
    try { btnRef.current?.setPointerCapture?.(e.pointerId) } catch { /* stale pointer id */ }
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    d.dx = e.clientX - d.startX
    if (!d.moved && Math.abs(d.dx) <= CLICK_SLOP) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
      setOpen(false)
    }
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0
        previewDepth(snapDepth(d.startDepth + Math.round(d.dx * DRAG_SENS)))
      })
    }
  }

  const onPointerUp = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (d.raf) cancelAnimationFrame(d.raf)
    if (d.moved) {
      suppressClickRef.current = true
      setDragging(false)
      commitDepth(snapDepth(d.startDepth + Math.round(d.dx * DRAG_SENS)))
    }
  }

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setOpen((v) => !v)
  }

  const onDoubleClick = () => {
    suppressClickRef.current = false
    setOpen(false)
    resetAll()
  }

  const onKeyDown = (e) => {
    let delta = 0
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -NUDGE
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = NUDGE
    if (delta) {
      e.preventDefault()
      commitDepth(liveRef.current + delta)
    }
  }

  // Wheel nudge — manual non-passive listener (React wheel handlers are
  // passive, so preventDefault would be ignored and the page would scroll).
  useEffect(() => {
    const el = btnRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      commitDepth(liveRef.current + (e.deltaY > 0 ? -NUDGE : NUDGE))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [commitDepth])

  /* --- popover (anchored under the pill, mirrors EnvironmentCapsule) --- */

  useLayoutEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return }
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 10, left: rect.left + rect.width / 2 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={
          `tone-pill${open ? ' tone-pill--open' : ''}` +
          `${dragging ? ' tone-pill--dragging' : ''}` +
          `${isCustom ? ' tone-pill--active' : ''}`
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Background tone: ${toneLabel}${depth ? `, depth ${depth > 0 ? '+' : ''}${depth}` : ''}. Click to choose a tone, drag to fine-tune depth, double-click to reset.`}
        title="Background tone — click to choose, drag to fine-tune"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <span className="tone-pill-icon" aria-hidden="true">
          <Contrast size={14} strokeWidth={1.7} />
        </span>
        {dragging && (
          <span className="tone-pill-value">{liveDepth > 0 ? `+${liveDepth}` : `${liveDepth}`}</span>
        )}
      </button>

      {open && pos && ReactDOM.createPortal(
        <div
          ref={popoverRef}
          className="tone-popover"
          role="dialog"
          aria-label="Background tone"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
        >
          <div className="tone-popover-arrow" aria-hidden="true" />

          <div className="tone-popover-head">
            <span className="tone-popover-title">Background Tone</span>
            <span className="tone-popover-value">{toneLabel}</span>
          </div>

          <div className="tone-swatches" role="radiogroup" aria-label="Tone">
            {TONES.map((t) => {
              const { low, high } = tonePreview(t.id)
              const selected = t.id === tone
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`tone-swatch${selected ? ' tone-swatch--active' : ''}`}
                  style={{ background: `linear-gradient(180deg, ${high} 0%, ${low} 100%)` }}
                  onClick={() => pickTone(t.id)}
                  title={t.label}
                  aria-label={t.label}
                />
              )
            })}
          </div>

          <div className="tone-depth-head">
            <span className="tone-depth-label">Depth</span>
            <span className={`tone-depth-value${liveDepth === 0 ? ' tone-depth-value--default' : ''}`}>
              {liveDepth === 0 ? 'As designed' : (liveDepth > 0 ? `+${liveDepth}` : `${liveDepth}`)}
            </span>
          </div>

          <div className="tone-slider-row">
            <span className="tone-slider-end" aria-hidden="true">
              <SunDim size={13} strokeWidth={1.7} />
            </span>
            <div className="tone-slider-wrap">
              <input
                type="range"
                className="tone-slider"
                min={DEPTH_MIN}
                max={DEPTH_MAX}
                step={1}
                value={liveDepth}
                onChange={(e) => previewDepth(snapDepth(Number(e.target.value)))}
                onPointerUp={() => commitDepth(liveRef.current)}
                onKeyUp={() => commitDepth(liveRef.current)}
                onBlur={() => commitDepth(liveRef.current)}
                aria-label="Tone depth"
              />
            </div>
            <span className="tone-slider-end" aria-hidden="true">
              <Sun size={13} strokeWidth={1.7} />
            </span>
          </div>

          <button
            type="button"
            className="tone-studio-btn"
            onClick={() => { setOpen(false); setStudioOpen(true) }}
          >
            <Palette size={13} strokeWidth={1.8} aria-hidden="true" />
            <span className="tone-studio-btn-label">Skins &amp; Accents</span>
            <ChevronRight size={13} strokeWidth={2} aria-hidden="true" className="tone-studio-btn-arrow" />
          </button>

          <div className="tone-popover-foot">
            <span className="tone-popover-hint">Drag the pill to fine-tune · double-click resets</span>
            <button
              type="button"
              className="tone-reset"
              onClick={resetAll}
              disabled={!isCustom}
            >
              <RotateCcw size={11} strokeWidth={2} aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>,
        document.body
      )}

      {studioOpen && (
        <Suspense fallback={null}>
          <AppearanceStudio onClose={() => setStudioOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
