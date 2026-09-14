import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { ANNOTATION_COLORS } from './use-rz-annotations'
import { NOTE_ICONS, DEFAULT_NOTE_ICON } from './note-icons'
import './rz-note-popover.css'

const POP_WIDTH = 280

function fmtPriceLocal(p) {
  if (!Number.isFinite(p)) return '—'
  if (Math.abs(p) >= 1) return `$${p.toFixed(2)}`
  if (Math.abs(p) >= 0.01) return `$${p.toFixed(4)}`
  return `$${p.toFixed(6)}`
}

function fmtTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Anchored popover for creating OR editing a chart annotation.
 * Mode: 'create' renders composer; 'view' renders text + edit/delete.
 */
export default function RzNotePopover({
  open,
  mode = 'create', // 'create' | 'view' | 'edit'
  anchor,           // { x, y } client coords
  symbol,
  draftPrice,       // for create mode — price at clicked location
  draftTs,
  note,             // for view/edit — full annotation
  fmtPrice,
  onSubmit,
  onUpdate,
  onDelete,
  onClose,
  onStartEdit,
}) {
  const { t } = useTranslation()
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [text, setText] = useState('')
  const [color, setColor] = useState(ANNOTATION_COLORS[0])
  const [icon, setIcon] = useState(DEFAULT_NOTE_ICON)
  const popRef = useRef(null)
  const inputRef = useRef(null)

  // Reset state on open / mode swap
  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && note) {
      setText(note.text || '')
      setColor(note.color || ANNOTATION_COLORS[0])
      setIcon(note.icon || DEFAULT_NOTE_ICON)
    } else if (mode === 'create') {
      setText('')
      setColor(ANNOTATION_COLORS[0])
      setIcon(DEFAULT_NOTE_ICON)
    }
    const id = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(id)
  }, [open, mode, note])

  // Position
  useLayoutEffect(() => {
    if (!open || !anchor) return
    const margin = 8
    const padding = 14
    let left = anchor.x - POP_WIDTH / 2
    if (left < margin) left = margin
    if (left + POP_WIDTH > window.innerWidth - margin) left = window.innerWidth - POP_WIDTH - margin
    let top = anchor.y + 12
    const estH = 220
    if (top + estH > window.innerHeight - margin) top = anchor.y - estH - 12
    setPos({ top, left })
  }, [open, anchor])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (popRef.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    // Defer attach to next tick to skip the click that opened us
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDown)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(id)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const isCreate = mode === 'create'
  const isEdit = mode === 'edit'
  const isView = mode === 'view'
  const fmt = fmtPrice || fmtPriceLocal
  const headerTs = isCreate ? draftTs : note?.ts
  const headerPrice = isCreate ? draftPrice : note?.price

  const handleSubmit = (e) => {
    e?.preventDefault?.()
    const t = text.trim()
    if (!t) return
    if (isCreate) {
      onSubmit?.({ text: t, color, icon, ts: draftTs, price: draftPrice })
    } else if (isEdit) {
      onUpdate?.(note.id, { text: t, color, icon })
    }
    onClose?.()
  }

  return createPortal(
    <div
      ref={popRef}
      className="rz-note-pop"
      style={{ top: pos.top, left: pos.left, width: POP_WIDTH }}
      role="dialog"
      aria-label={isCreate ? 'New note' : 'Note'}
    >
      <div className="rz-note-pop-header">
        <span className="rz-note-pop-symbol">{symbol}</span>
        <span className="rz-note-pop-meta mono">
          {fmtTs(headerTs)}
          {Number.isFinite(headerPrice) && <> · {fmt(headerPrice)}</>}
        </span>
        <button type="button" className="rz-note-pop-close" onClick={onClose} aria-label={t('researchPro.notePopover.rznotepopover.ariaClose', "Close")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {isView ? (
        <>
          <div className="rz-note-pop-text">{note?.text}</div>
          <div className="rz-note-pop-actions">
            <button type="button" className="rz-note-pop-btn rz-note-pop-btn--ghost" onClick={() => onDelete?.(note.id)}>{t('researchPro.notePopover.rznotepopover.delete', "Delete")}</button>
            <button type="button" className="rz-note-pop-btn rz-note-pop-btn--primary" onClick={() => onStartEdit?.(note)}>{t('researchPro.notePopover.rznotepopover.edit', "Edit")}</button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className="rz-note-pop-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Pin your thought on ${symbol}…`}
            rows={3}
            maxLength={280}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
            }}
          />
          <div className="rz-note-pop-foot">
            <div className="rz-note-pop-icons" style={{ '--rz-icon-color': color }}>
              {NOTE_ICONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`rz-note-pop-icon${icon === opt.id ? ' rz-note-pop-icon--active' : ''}`}
                  onClick={() => setIcon(opt.id)}
                  aria-label={opt.label}
                  title={opt.label}
                >
                  {opt.svg}
                </button>
              ))}
            </div>
            <div className="rz-note-pop-colors">
              {ANNOTATION_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`rz-note-pop-color${color === c ? ' rz-note-pop-color--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`color ${c}`}
                />
              ))}
            </div>
            <div className="rz-note-pop-actions">
              <span className="rz-note-pop-counter">{text.length}/280</span>
              <button type="button" className="rz-note-pop-btn rz-note-pop-btn--ghost" onClick={onClose}>{t('researchPro.notePopover.rznotepopover.cancel', "Cancel")}</button>
              <button type="submit" className="rz-note-pop-btn rz-note-pop-btn--primary" disabled={!text.trim()}>{isEdit ? 'Save' : 'Pin'}</button>
            </div>
          </div>
        </form>
      )}
    </div>,
    document.body,
  )
}
