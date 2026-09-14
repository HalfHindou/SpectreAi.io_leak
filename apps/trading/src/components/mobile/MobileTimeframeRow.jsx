/**
 * MobileTimeframeRow — big thumb-reach timeframe pills under the chart
 * (Vector/GMGN pattern). Replaces the old toolbar TF dropdown.
 *
 * Only the four most-used timeframes get a permanent pill; the rest live
 * behind a "More" trigger so the row stays dense and never has to be
 * side-scrolled to reach the toggles beside it. When the active timeframe
 * is one of the extras the trigger BECOMES that label (and highlights), so
 * the current selection is always visible on the bar.
 *
 * Wiring: DOM-clicks the hidden desktop `.chart-controls` timeframe
 * buttons via clickTfButton, and polls readActiveTimeframe (800ms) so
 * the active pill stays in sync with the chart — same mechanic as
 * MobileChartToolbar's type sync.
 */
import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { clickTfButton, readActiveTimeframe, clampLeft } from './MobileChartToolbar'
import './MobileTimeframeRow.css'

/* Always-visible pills. */
const DEFAULT_TFS = ['1m', '15m', '1H', '1D']
/* Everything else, reachable from the More popover. Labels must match the
   desktop `timeframes` array in TradingChart.jsx verbatim — clickTfButton
   resolves them by button text. */
const MORE_TFS = ['5m', '4H', '12H', '1W', '1M', 'All']

/* Matches .mct-dropdown--tf min-width — keeps the popover inside the viewport. */
const MENU_W = 132

/* CASE-SENSITIVE on purpose: '1m' is one minute and '1M' is one month. Both
   exist, so an uppercase compare would light the 1m pill for a monthly chart. */
const eqTf = (a, b) => String(a) === String(b)

export default function MobileTimeframeRow({ chartRootRef }) {
  const [tf, setTf] = useState('1H')
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos] = useState({ top: 0, left: 0 })
  const moreBtnRef = useRef(null)
  const rowRef = useRef(null)

  useEffect(() => {
    const sync = () => {
      const next = readActiveTimeframe(chartRootRef?.current)
      if (next) setTf((cur) => (next !== cur ? next : cur))
    }
    sync()
    // Same as MobileChartToolbar: don't poll the chart DOM on a hidden tab.
    const id = setInterval(() => { if (!document.hidden) sync() }, 800)
    return () => clearInterval(id)
  }, [chartRootRef])

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const active = row.querySelector('.mtf-pill.is-active')
    if (!active) return
    const left = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2
    const max = row.scrollWidth - row.clientWidth
    row.scrollTo({ left: Math.max(0, Math.min(max, left)), behavior: 'smooth' })
  }, [tf])

  // Close on an outside tap or Escape (mirrors MobileChartToolbar's menus).
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e) => {
      const insideBtn = moreBtnRef.current?.contains(e.target)
      const insideMenu = e.target?.closest?.('.mtf-more-menu')
      if (!insideBtn && !insideMenu) setMoreOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const pick = (next) => {
    setTf(next) // optimistic; the poll reconciles in <=800ms
    setMoreOpen(false)
    clickTfButton(chartRootRef?.current, next)
  }

  const openMore = () => {
    if (moreBtnRef.current) {
      // Right-align the menu to the trigger (it sits at the row's end, so a
      // left-aligned panel would hang off the edge), then clamp both sides.
      const r = moreBtnRef.current.getBoundingClientRect()
      setMorePos({ top: r.bottom + 6, left: clampLeft(r.right - MENU_W, MENU_W) })
    }
    setMoreOpen((v) => !v)
  }

  // An extra TF is selected → the trigger carries its label instead of "More".
  const activeExtra = MORE_TFS.find((t) => eqTf(tf, t)) || null

  return (
    <div className="mtf" role="tablist" aria-label="Chart timeframe" ref={rowRef}>
      {DEFAULT_TFS.map((t) => {
        const active = eqTf(tf, t)
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active}
            className={`mtf-pill ${active ? 'is-active' : ''}`}
            onClick={() => pick(t)}
          >
            {t}
          </button>
        )
      })}

      <button
        ref={moreBtnRef}
        type="button"
        className={`mtf-pill mtf-more ${activeExtra ? 'is-active' : ''}${moreOpen ? ' is-open' : ''}`}
        onClick={openMore}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-label={activeExtra ? `Timeframe ${activeExtra}. More timeframes` : 'More timeframes'}
      >
        {activeExtra || 'More'}
        <ChevronDown size={12} strokeWidth={2.2} className="mtf-more-caret" />
      </button>

      {moreOpen && ReactDOM.createPortal(
        <div
          className="mct-dropdown mct-dropdown--tf mtf-more-menu"
          role="menu"
          style={{ position: 'fixed', top: morePos.top, left: morePos.left }}
        >
          {MORE_TFS.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              className={`mct-dropdown-row ${eqTf(tf, t) ? 'is-active' : ''}`}
              onClick={() => pick(t)}
            >
              <span className="mct-dropdown-row-label">{t}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
