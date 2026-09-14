/**
 * PmSelect — custom dropdown matching design-system.md.
 *
 * Native <select> popups are rendered by the OS and cannot be styled, so the
 * open menu broke the cinematic look (system white menu, system font). This
 * replaces it with a glass popup: warm-white text, blur, checkmark on the
 * active row. Closed trigger reuses .pm-filter-select so it stays pixel-identical
 * to the rest of the filter bar (day mode inherited for free).
 *
 * Keyboard: Enter/Space/ArrowDown opens; ArrowUp/Down move; Enter selects;
 * Escape closes. Outside click closes.
 */
import { useRef, useState, useEffect, useCallback } from 'react'

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const CheckMark = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

// Options can be string[] (label = value) or { value, label }[] (i18n labels
// detached from canonical filter values). Internally normalized to the object
// form so the popup, keyboard nav and selection logic stay identical.
function normalizeOption(o) {
  if (o == null) return { value: '', label: '' }
  if (typeof o === 'string') return { value: o, label: o }
  return { value: o.value, label: o.label ?? o.value }
}

export default function PmSelect({ value, options, onChange, ariaLabel, className = '' }) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)

  const normalized = options.map(normalizeOption)
  const selectedLabel = normalized.find((o) => o.value === value)?.label ?? value

  const close = useCallback(() => setOpen(false), [])

  // Outside click + escape
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  // Sync highlight to current value when opening, scroll it into view
  useEffect(() => {
    if (!open) return
    const idx = Math.max(0, normalized.findIndex((o) => o.value === value))
    setHighlight(idx)
  }, [open, value, options])  // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (opt) => {
      onChange(opt.value)
      setOpen(false)
    },
    [onChange]
  )

  const onTriggerKey = (e) => {
    // ArrowDown-while-open must be tested FIRST. It used to sit at the end of
    // the chain, where the opening branch had already swallowed every
    // ArrowDown - so pressing Down in an open list committed the highlighted
    // row instead of moving to the next one.
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      setHighlight((h) => Math.min(normalized.length - 1, h + 1))
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) setOpen(true)
      else commit(normalized[highlight])
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    }
  }

  return (
    <div className={`pm-select${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`pm-filter-select pm-select-trigger${open ? ' pm-select-trigger-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="pm-select-value">{selectedLabel}</span>
        <span className="pm-select-chev" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>

      {open && (
        <ul className="pm-select-menu" role="listbox" ref={menuRef} tabIndex={-1}>
          {normalized.map((opt, i) => {
            const selected = opt.value === value
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={selected}
                className={`pm-select-option${selected ? ' pm-select-option-selected' : ''}${i === highlight ? ' pm-select-option-active' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(opt)}
              >
                <span>{opt.label}</span>
                {selected && (
                  <span className="pm-select-check" aria-hidden="true">
                    <CheckMark />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
