/*
 * RowQuickActions - a compact "..." menu for a leaderboard / KOL row.
 *
 * Gives the little contextual options on a project or creator WITHOUT opening
 * the full drawer: Research Zone, AI Screener, copy contract, open on X, watch.
 *
 * `items` is a list of { key, label, icon?, onClick, danger?, disabled? }.
 * Falsy entries are ignored so callers can inline-conditional an action. The
 * menu is portalled to <body> so it escapes the table's overflow, closes on an
 * outside press / Escape / scroll, and never triggers the row's own onClick.
 */
import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'
import './xd-row-actions.css'

const MENU_W = 194

function isDayMode() {
  if (typeof document === 'undefined') return false
  return !!document.querySelector('.app.app-day-mode')
}

/* Tiny monochrome glyphs for menu items - shared by the project + KOL rows. */
export function ActionIcon({ name }) {
  const p = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  switch (name) {
    case 'rz': return <svg {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
    case 'chart': return <svg {...p}><path d="M3 3v18h18" /><path d="M7 14l3-4 3 3 4-6" /></svg>
    case 'cards': return <svg {...p}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /></svg>
    case 'copy': return <svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
    case 'user': return <svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" /></svg>
    case 'x': return <svg {...p} strokeWidth="0" fill="currentColor"><path d="M17.5 3h3l-7.2 8.2L22 21h-6.3l-4.9-6.4L5.1 21H2l7.7-8.8L2 3h6.4l4.5 5.9L17.5 3Zm-1.1 16h1.7L7.7 4.8H5.9L16.4 19Z" /></svg>
    case 'star-on': return <svg {...p} fill="currentColor"><path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9L12 3Z" /></svg>
    case 'star': return <svg {...p}><path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9L12 3Z" /></svg>
    default: return null
  }
}

export default function RowQuickActions({ items, ariaLabel = 'More actions', className = '' }) {
  const list = (items || []).filter(Boolean)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const place = useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8))
    // flip above the trigger if there isn't room below
    const estH = 44 + list.length * 34
    const below = r.bottom + 6
    const top = (below + estH > window.innerHeight - 8 && r.top - estH - 6 > 8)
      ? r.top - estH - 6
      : below
    setPos({ top, left })
  }, [list.length])

  const toggle = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen((v) => !v)
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  if (!list.length) return null

  return (
    <span className={`xd-rowact${className ? ` ${className}` : ''}`} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className={`xd-rowact__trigger${open ? ' is-open' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={`xd-rowact__menu${isDayMode() ? ' day-mode' : ''}`}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {list.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`xd-rowact__item${it.danger ? ' xd-rowact__item--danger' : ''}`}
              disabled={it.disabled}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick?.(e) }}
            >
              {it.icon && <span className="xd-rowact__ico" aria-hidden="true">{it.icon}</span>}
              <span className="xd-rowact__label">{it.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}
