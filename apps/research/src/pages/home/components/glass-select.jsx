/**
 * GlassSelect – Adaptive dropdown for filter/timeframe selectors
 * Desktop: inline dropdown below trigger
 * Mobile: bottom-sheet style options list
 */
import React, { useState, useRef, useEffect, useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import './glass-select.css'

const GlassSelect = ({ value, onChange, options, ariaLabel, className = '' }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)

  const selected = options.find(o => o.value === value)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const menuId = useId()
  const dropdownStyle = useAnchoredMenu({ open, isSheet: isMobile, triggerRef, maxHeight: 260, gap: 4, sheetFraction: 0.75 })

  // Close on any tap/click outside the dropdown OR trigger
  const handleDocTap = useCallback((e) => {
    if (!open) return
    if (triggerRef.current?.contains(e.target)) return
    if (dropdownRef.current?.contains(e.target)) return
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

  // Scroll active item into view when opened
  useEffect(() => {
    if (open && dropdownRef.current) {
      const active = dropdownRef.current.querySelector('.glass-select-option.active')
      if (active) active.scrollIntoView({ block: 'nearest' })
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleEsc = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus({ preventScroll: true }) } }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open])

  const handleSelect = (val) => {
    onChange({ target: { value: val } })
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  const toggleOpen = (e) => {
    e.stopPropagation()
    setOpen(prev => !prev)
  }

  return (
    <div className={`glass-select ${open ? 'open' : ''} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="glass-select-trigger"
        onClick={toggleOpen}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
      >
        {selected?.glyph ? (
          <span className="glass-select-trigger-icon glass-select-glyph" aria-hidden="true">{selected.glyph}</span>
        ) : selected?.icon ? (
          <img className="glass-select-trigger-icon" src={selected.icon} alt="" aria-hidden="true" onError={(e) => { e.target.style.visibility = 'hidden' }} />
        ) : null}
        <span className="glass-select-value">{selected?.label || '-'}</span>
        <svg className="glass-select-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && createPortal(
        <>
          <div
            className="glass-select-backdrop"
            onClick={() => setOpen(false)}
            onTouchStart={(e) => { e.preventDefault(); setOpen(false) }}
          />
          <div
            className={`glass-select-dropdown ${!isMobile ? 'glass-select-dropdown--desktop' : ''}`}
            ref={dropdownRef}
            role="listbox"
            id={menuId}
            aria-label={ariaLabel}
            style={dropdownStyle || undefined}
          >
            {isMobile && (
              <div className="glass-select-sheet-header">
                <div className="glass-select-sheet-handle" />
                <button
                  type="button"
                  className="glass-select-sheet-close"
                  onClick={() => setOpen(false)}
                  aria-label={t('homePage.glassSelect.glassselect.ariaClose', "Close")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`glass-select-option ${opt.value === value ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleSelect(opt.value) }}
              >
                {/* `glyph` is an inline node for options with no logo URL
                    (Robinhood Chain has no CoinGecko coin image). */}
                {opt.glyph ? (
                  <span className="glass-select-option-icon glass-select-glyph" aria-hidden="true">{opt.glyph}</span>
                ) : opt.icon ? (
                  <img className="glass-select-option-icon" src={opt.icon} alt="" aria-hidden="true" onError={(e) => { e.target.style.visibility = 'hidden' }} />
                ) : (
                  // Placeholder keeps label alignment uniform when some options have no icon
                  <span className="glass-select-option-icon glass-select-option-icon--placeholder" aria-hidden="true" />
                )}
                <span className="glass-select-option-label">{opt.label}</span>
                {opt.value === value && (
                  <svg className="glass-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
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

export default GlassSelect
