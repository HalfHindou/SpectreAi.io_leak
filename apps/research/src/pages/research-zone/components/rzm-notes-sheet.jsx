/**
 * RzmNotesSheet — mobile bottom-sheet for Research Zone chart notes.
 *
 * Desktop pins notes by clicking a precise (time, price) point on the chart.
 * On a small touch chart that gesture is too fragile, so the mobile model is
 * a NOTES LIST: "Add note" pins a note to the CURRENT price + time (the latest
 * bar). The result is the same annotation object desktop creates, so the pin
 * still renders on the chart (via RzChartSection's existing `annotations` prop)
 * and the note is the SAME data per token — both surfaces read/write the same
 * `spectre-rz-annotations:{SYMBOL}` localStorage key through useRzAnnotations.
 *
 * The parent (research-zone-mobile) owns the single useRzAnnotations instance
 * and passes its `annotations` / `add` / `remove` in as props, so the chart
 * pins and this list stay live-synced.
 *
 * Terminal/minimal per .claude/rules — warm-white chrome, colour only on the
 * per-note accent dots. Prefix: rzns-
 */
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ANNOTATION_COLORS } from './use-rz-annotations'
import { NOTE_ICONS, DEFAULT_NOTE_ICON, getNoteIcon } from './note-icons'
import './rzm-notes-sheet.css'

const MAX_LEN = 280

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

function fmtPriceLocal(p) {
  if (!Number.isFinite(p)) return '—'
  if (Math.abs(p) >= 1) return `$${p.toFixed(2)}`
  if (Math.abs(p) >= 0.01) return `$${p.toFixed(4)}`
  return `$${p.toFixed(6)}`
}

function fmtTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function RzmNotesSheet({
  open,
  onClose,
  symbol,
  currentPrice,
  fmtPrice,
  dayMode = false,
  annotations = [],
  onAdd,      // (text, { color, icon }) => note  — from useRzAnnotations.add
  onRemove,   // (id) => void                     — from useRzAnnotations.remove
}) {
  const [text, setText] = useState('')
  const [color, setColor] = useState(ANNOTATION_COLORS[0])
  const [icon, setIcon] = useState(DEFAULT_NOTE_ICON)
  const [composerOpen, setComposerOpen] = useState(false)
  const inputRef = useRef(null)

  // Drag-to-dismiss from the header (the grabber alone is a 4px miss on a
  // phone). Same 120px threshold the trading-app sheets use.
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)
  useEffect(() => { if (open) setDragOffset(0) }, [open])
  const dragHandlers = {
    onTouchStart: (e) => {
      // A touch that starts on a control (close) is not a drag.
      if (e.target?.closest?.('button')) { startYRef.current = null; return }
      startYRef.current = e.touches?.[0]?.clientY ?? null
    },
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

  const sym = String(symbol || '').toUpperCase()
  const fmt = fmtPrice || fmtPriceLocal
  const priceReady = Number.isFinite(currentPrice)

  // Body scroll lock while open (mirrors RzmAgentSheet)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Esc / hardware-back close
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset composer when the sheet closes or the token changes
  useEffect(() => {
    if (!open) { setComposerOpen(false); setText(''); setColor(ANNOTATION_COLORS[0]); setIcon(DEFAULT_NOTE_ICON) }
  }, [open, sym])

  // Focus the textarea when the composer opens
  useEffect(() => {
    if (composerOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 60)
      return () => clearTimeout(id)
    }
  }, [composerOpen])

  // Newest first
  const sortedNotes = useMemo(() => {
    const list = Array.isArray(annotations) ? annotations.slice() : []
    return list.sort((a, b) => (b?.ts || b?.createdAt || 0) - (a?.ts || a?.createdAt || 0))
  }, [annotations])

  const handleAdd = () => {
    const t = text.trim()
    if (!t) return
    // Pins to the current price + time (latest bar) — useRzAnnotations defaults
    // ts:Date.now() and price:currentPrice when not overridden here.
    onAdd?.(t, { color, icon })
    setText('')
    setColor(ANNOTATION_COLORS[0])
    setIcon(DEFAULT_NOTE_ICON)
    setComposerOpen(false)
  }

  const sheet = (
    <div
      className={`rzns-root ${open ? 'rzns-open' : ''} ${dayMode ? 'app app-day-mode' : ''}`}
      aria-hidden={!open}
    >
      <div className="rzns-scrim" onClick={onClose} />

      <div
        className="rzns-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Notes for ${sym}`}
        // The open/close transform lives on the class + a transition; kill the
        // transition while dragging so the sheet tracks the finger 1:1.
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, transition: 'none' } : undefined}
      >
        {/* Header - also the drag-to-dismiss surface */}
        <div className="rzns-header" {...dragHandlers}>
          <div className="rzns-grabber" aria-hidden />
          <div className="rzns-header-row">
            <div className="rzns-title">
              <span className="rzns-title-main">Notes</span>
              <span className="rzns-title-sym">{sym}</span>
              {sortedNotes.length > 0 && <span className="rzns-title-count">{sortedNotes.length}</span>}
            </div>
            <button type="button" className="rzns-close" onClick={onClose} aria-label="Close notes">
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="rzns-body">
          {/* Composer */}
          {composerOpen ? (
            <div className="rzns-composer">
              <div className="rzns-composer-anchor">
                Pins at <span className="rzns-num">{priceReady ? fmt(currentPrice) : '—'}</span> · <span className="rzns-num">{fmtTs(Date.now())}</span>
              </div>
              <textarea
                ref={inputRef}
                className="rzns-textarea"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
                placeholder={`Pin your thought on ${sym}…`}
                rows={3}
                maxLength={MAX_LEN}
              />
              <div className="rzns-picker-row">
                <div className="rzns-icons" role="radiogroup" aria-label="Note icon" style={{ '--rzns-accent': color }}>
                  {NOTE_ICONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={icon === opt.id}
                      className={`rzns-icon-btn${icon === opt.id ? ' is-active' : ''}`}
                      onClick={() => setIcon(opt.id)}
                      aria-label={opt.label}
                    >
                      {opt.svg}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rzns-colors" role="radiogroup" aria-label="Note colour">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    className={`rzns-color-btn${color === c ? ' is-active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`colour ${c}`}
                  />
                ))}
              </div>
              <div className="rzns-composer-actions">
                <span className="rzns-counter rzns-num">{text.length}/{MAX_LEN}</span>
                <button type="button" className="rzns-btn rzns-btn--ghost" onClick={() => { setComposerOpen(false); setText('') }}>Cancel</button>
                <button type="button" className="rzns-btn rzns-btn--primary" onClick={handleAdd} disabled={!text.trim()}>Add note</button>
              </div>
            </div>
          ) : (
            <button type="button" className="rzns-add-cta" onClick={() => setComposerOpen(true)}>
              <span className="rzns-add-cta-plus" aria-hidden>+</span>
              Add note {priceReady && <span className="rzns-add-cta-at rzns-num">at {fmt(currentPrice)}</span>}
            </button>
          )}

          {/* List */}
          {sortedNotes.length > 0 ? (
            <ul className="rzns-list" aria-label={`Saved notes for ${sym}`}>
              {sortedNotes.map((n) => {
                const noteColor = n.color || ANNOTATION_COLORS[0]
                return (
                  <li key={n.id} className="rzns-item">
                    <span className="rzns-item-icon" style={{ color: noteColor }} aria-hidden>
                      {getNoteIcon(n.icon).svg}
                    </span>
                    <div className="rzns-item-main">
                      <div className="rzns-item-text">{n.text}</div>
                      <div className="rzns-item-meta rzns-num">
                        {fmtTs(n.ts || n.createdAt)}
                        {Number.isFinite(n.price) && <> · {fmt(n.price)}</>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rzns-item-delete"
                      onClick={() => onRemove?.(n.id)}
                      aria-label="Delete note"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            !composerOpen && (
              <div className="rzns-empty">
                No notes yet. Add one to pin your thesis to {sym} at the current price.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}

export default React.memo(RzmNotesSheet)
