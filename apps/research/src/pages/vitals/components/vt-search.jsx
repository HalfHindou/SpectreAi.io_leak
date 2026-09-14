/**
 * vt-search.jsx — jump to any platform.
 *
 * Server-ranked so a two-letter query does not ship the whole 1,950-row
 * universe to the browser to be filtered there.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usd, count } from './vt-format'

/**
 * `onPick` turns the box into a PICKER rather than a jump: compare needs to
 * collect several platforms without leaving the page.
 */
export default function VtSearch({ onPick = null, placeholder, exclude = [] }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setRows([]); return undefined }
    let cancelled = false
    const t = setTimeout(() => {
      fetch(`/api/vitals?fn=search&q=${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(15_000) })
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return
          const skip = new Set(exclude)
          setRows((json.rows || []).filter((r) => !skip.has(r.slug)))
          setCursor(0)
        })
        .catch(() => { if (!cancelled) setRows([]) })
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, exclude.join(',')])

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [])

  const go = (slug) => {
    setOpen(false); setQ('')
    if (onPick) onPick(slug)
    else navigate(`/vitals/${slug}`)
  }

  const onKey = (e) => {
    if (!rows.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[cursor].slug) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="vt-search" ref={boxRef}>
      <input
        className="vt-search__input"
        type="search"
        value={q}
        placeholder={placeholder || 'Search any platform — fomo, Jupiter, Hyperliquid…'}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        aria-label="Search platforms"
        autoComplete="off"
      />
      {open && rows.length ? (
        <ul className="vt-search__results" role="listbox">
          {rows.map((r, i) => (
            <li key={r.slug}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={`vt-search__row${i === cursor ? ' is-cursor' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r.slug)}
              >
                <span className="vt-search__name">{r.name}</span>
                <span className="vt-search__meta">{r.category}</span>
                <span className="vt-search__val">
                  {r.dau != null ? `${count(r.dau)} users` : usd(r.fees30d)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
