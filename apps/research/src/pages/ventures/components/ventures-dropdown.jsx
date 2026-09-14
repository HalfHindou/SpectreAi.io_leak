/**
 * VenturesDropdown — shared custom dropdown used across the Ventures surface.
 *
 * Replaces native <select> elements with a chevron-trigger + popover menu styled
 * via .vd-dropdown classes (see ventures-page.css). Click-outside closes the menu.
 */
import React, { useEffect, useRef, useState } from 'react'

const VenturesDropdown = ({ value, options, onChange, className = '' }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div className={`vd-dropdown ${open ? 'vd-dropdown--open' : ''} ${className}`.trim()} ref={ref}>
      <button
        className="vd-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span className="vd-dropdown-label">{selected?.label || value}</span>
        <svg className="vd-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="vd-dropdown-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`vd-dropdown-item ${opt.value === value ? 'vd-dropdown-item--active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              type="button"
            >
              {opt.label}
              {opt.value === value && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default VenturesDropdown
