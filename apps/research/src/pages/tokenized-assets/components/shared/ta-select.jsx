/**
 * TaSelect — custom dropdown for the tokenized-assets screener filters.
 * Replaces native <select> (OS-styled popup) with a design-system menu:
 * portal-rendered, click-outside + Escape to close, mobile bottom-sheet.
 *
 * API mirrors a native select on purpose — onChange receives
 * { target: { value } } so existing `e.target.value` handlers work unchanged.
 */
import React, { useState, useRef, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import './ta-select.css'

export default function TaSelect({ value, onChange, options, ariaLabel, className = '' }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const selected = options.find(o => o.value === value)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const menuId = useId()
  const menuStyle = useAnchoredMenu({ open, isSheet: isMobile, triggerRef, maxHeight: 280, gap: 6, sheetFraction: 0.6 })

  // Close on click/tap outside the trigger or menu.
  const handleDocTap = useCallback((e) => {
    if (!open) return
    if (triggerRef.current?.contains(e.target)) return
    if (menuRef.current?.contains(e.target)) return
    setOpen(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      document.addEventListener('touchstart', handleDocTap, { passive: true, capture: true })
      document.addEventListener('mousedown', handleDocTap, { capture: true })
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('touchstart', handleDocTap, { capture: true })
      document.removeEventListener('mousedown', handleDocTap, { capture: true })
    }
  }, [open, handleDocTap])

  // Bring the selected option into view when the menu opens.
  useEffect(() => {
    if (open && menuRef.current) {
      const active = menuRef.current.querySelector('.ta-select-option.is-active')
      if (active) active.scrollIntoView({ block: 'nearest' })
    }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onEsc = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus({ preventScroll: true }) } }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open])

  const handleSelect = (val) => {
    onChange({ target: { value: val } })
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  return (
    <div className={`ta-select ${open ? 'is-open' : ''} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="ta-select-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen(p => !p) }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
      >
        <span className="ta-select-value">{selected?.label ?? '--'}</span>
        <svg className="ta-select-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && createPortal(
        <>
          <div
            className="ta-select-backdrop"
            onClick={() => setOpen(false)}
            onTouchStart={(e) => { e.preventDefault(); setOpen(false) }}
          />
          <div
            ref={menuRef}
            className={`ta-select-menu ${isMobile ? 'ta-select-menu--sheet' : 'ta-select-menu--pop'}`}
            role="listbox"
            id={menuId}
            aria-label={ariaLabel}
            style={menuStyle || undefined}
          >
            {isMobile && (
              <div className="ta-select-sheet-head">
                <div className="ta-select-sheet-handle" />
              </div>
            )}
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`ta-select-option ${opt.value === value ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleSelect(opt.value) }}
              >
                <span className="ta-select-option-label">{opt.label}</span>
                {opt.value === value && (
                  <svg className="ta-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
