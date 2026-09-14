/**
 * rz-chart-ta.jsx — the Research Zone chart's TA surface.
 *
 *   RzTaToolMenu — the drawing-tool popover (anchored to the chart toolbar)
 *   RzTaStrip    — what the pattern matcher actually found, above the chart
 *
 * The matcher's output is shown as its own strip rather than only inside the
 * agent's answer: the geometry is measured, so it stands on its own, and it
 * lands the instant you release the drag instead of after a stream.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { CHART_PATTERNS } from '@/lib/chart-patterns'
import './rz-chart-ta.css'

const POP_WIDTH = 216

const TOOLS = [
  {
    mode: 'draw:trendline',
    label: 'Trend line',
    hint: 'Drag between two points',
    icon: <path d="M3 15L8 9l4 3 5-8" />,
  },
  {
    mode: 'draw:hline',
    label: 'Horizontal level',
    hint: 'Click a price',
    icon: <path d="M3 10h14" />,
  },
  {
    mode: 'draw:rect',
    label: 'Zone box',
    hint: 'Drag a supply/demand box',
    icon: <rect x="3.5" y="5.5" width="13" height="9" rx="1" />,
  },
]

export function RzTaToolMenu({ open, anchorRect, taMode, onPick, onUndo, onClear, canUndo, hasDrawings, onClose }) {
  const { t } = useTranslation()
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const popRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !anchorRect) return
    const margin = 8
    let left = anchorRect.left
    if (left + POP_WIDTH > window.innerWidth - margin) left = window.innerWidth - POP_WIDTH - margin
    if (left < margin) left = margin
    setPos({ top: anchorRect.bottom + 8, left })
  }, [open, anchorRect])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!popRef.current?.contains(e.target)) onClose?.() }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
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

  return createPortal(
    <div ref={popRef} className="rzta-pop" style={{ top: pos.top, left: pos.left, width: POP_WIDTH }} role="menu">
      <div className="rzta-pop-head">{t('researchPro.chartTa.rztatoolmenu.draw', "Draw")}</div>
      {TOOLS.map(tool => (
        <button
          key={tool.mode}
          type="button"
          role="menuitem"
          className={`rzta-pop-item${taMode === tool.mode ? ' rzta-pop-item--active' : ''}`}
          onClick={() => onPick?.(tool.mode)}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {tool.icon}
          </svg>
          <span className="rzta-pop-item-text">
            <span className="rzta-pop-item-label">{tool.label}</span>
            <span className="rzta-pop-item-hint">{tool.hint}</span>
          </span>
        </button>
      ))}
      <div className="rzta-pop-sep" />
      <button type="button" className="rzta-pop-item rzta-pop-item--sm" onClick={onUndo} disabled={!canUndo}>
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 5L4 9l4 4" /><path d="M4 9h8a4 4 0 0 1 0 8h-1" />
        </svg>
        <span className="rzta-pop-item-label">{t('researchPro.chartTa.rztatoolmenu.undoLast', "Undo last")}</span>
      </button>
      <button type="button" className="rzta-pop-item rzta-pop-item--sm rzta-pop-item--danger" onClick={onClear} disabled={!hasDrawings}>
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6h12" /><path d="M8 6V4h4v2" /><path d="M6 6l1 10h6l1-10" />
        </svg>
        <span className="rzta-pop-item-label">{t('researchPro.chartTa.rztatoolmenu.clearAllLines', "Clear all lines")}</span>
      </button>
    </div>,
    document.body,
  )
}

// ────────────────────────────────────────────────────────────────────────────

function fmt(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.01) return v.toFixed(4)
  return v.toPrecision(3)
}

/**
 * The matcher's read of the selected window. Shows what geometry was actually
 * found — including "nothing matched", which is a real answer and the one a
 * pattern tool is most tempted to fake.
 */
export function RzTaStrip({ analysis, error, onDismiss, onClearLines, hasDrawings, play = null, onPlay, onStopPlay, onNextBeat, onPrevBeat }) {
  const { t } = useTranslation()
  const [openId, setOpenId] = useState(null)

  if (error) {
    return (
      <div className="rzta-strip rzta-strip--error">
        <span className="rzta-strip-msg">{error}</span>
        <button type="button" className="rzta-strip-x" onClick={onDismiss} aria-label={t('researchPro.chartTa.rztastrip.ariaDismiss', "Dismiss")}>×</button>
      </div>
    )
  }
  if (!analysis?.ok) return null

  const { stats, patterns = [], candles = [] } = analysis

  return (
    <div className="rzta-strip">
      <div className="rzta-strip-head">
        <span className="rzta-strip-tf">{stats.tfLabel}</span>
        <span className="rzta-strip-window">
          {stats.bars} bars · {stats.durationLabel}
        </span>
        <span className={`rzta-strip-chg ${stats.changePct >= 0 ? 'is-up' : 'is-down'}`}>
          {stats.changePct >= 0 ? '+' : ''}{stats.changePct.toFixed(2)}%
        </span>
        <span className="rzta-strip-spacer" />
        {onPlay && !play && (
          <button type="button" className="rzta-strip-btn rzta-strip-btn--play" onClick={onPlay}>
            <svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M6 4l10 6-10 6z" /></svg>
            {t('researchPro.chartTa.rztastrip.walkMeThroughIt', "Walk me through it")}
          </button>
        )}
        {hasDrawings && (
          <button type="button" className="rzta-strip-btn" onClick={onClearLines}>{t('researchPro.chartTa.rztastrip.clearLines', "Clear lines")}</button>
        )}
        <button type="button" className="rzta-strip-x" onClick={onDismiss} aria-label={t('researchPro.chartTa.rztastrip.ariaDismiss', "Dismiss")}>×</button>
      </div>

      {play && (
        <div className="rzta-play" role="status" aria-live="polite">
          <div className="rzta-play-progress">
            {play.beats.map((_, i) => (
              <span key={i} className={`rzta-play-dot${i === play.i ? ' is-on' : ''}${i < play.i ? ' is-done' : ''}`} />
            ))}
          </div>
          <div className="rzta-play-text">
            <span className="rzta-play-title">{play.beats[play.i]?.title}</span>
            <span className="rzta-play-body">{play.beats[play.i]?.body}</span>
          </div>
          <div className="rzta-play-controls">
            <button type="button" onClick={onPrevBeat} disabled={play.i === 0} aria-label={t('researchPro.chartTa.rztastrip.ariaPrevious', "Previous")}>‹</button>
            <span className="rzta-play-count">{play.i + 1}/{play.beats.length}</span>
            <button type="button" onClick={onNextBeat} aria-label={t('researchPro.chartTa.rztastrip.ariaNext', "Next")}>›</button>
            <button type="button" className="rzta-play-stop" onClick={onStopPlay} aria-label={t('researchPro.chartTa.rztastrip.ariaStop', "Stop")}>✕</button>
          </div>
        </div>
      )}

      <div className="rzta-strip-body">
        {patterns.length === 0 && (
          <span className="rzta-strip-none">
            No classical pattern matched this window cleanly — the levels and indicators still stand.
          </span>
        )}
        {patterns.map(p => {
          const isOpen = openId === p.id
          return (
            <div key={p.id} className={`rzta-pat rzta-pat--${p.bias}${isOpen ? ' rzta-pat--open' : ''}`}>
              <button type="button" className="rzta-pat-head" onClick={() => setOpenId(isOpen ? null : p.id)}>
                <span className="rzta-pat-dot" aria-hidden />
                <span className="rzta-pat-name">{p.name}</span>
                <span className="rzta-pat-kind">{p.kind}</span>
                <span className="rzta-pat-fit">{Math.round((p.confidence || 0) * 100)}% fit</span>
              </button>
              {isOpen && (
                <div className="rzta-pat-body">
                  <p className="rzta-pat-def">{p.definition}</p>
                  {p.note && <p className="rzta-pat-measured">{p.note}</p>}
                  <dl className="rzta-pat-levels">
                    <div><dt>{t('researchPro.chartTa.rztastrip.confirms', "Confirms")}</dt><dd>{p.confirmation}</dd></div>
                    {Number.isFinite(p.target) && <div><dt>{t('researchPro.chartTa.rztastrip.target', "Target")}</dt><dd className="mono">{fmt(p.target)}</dd></div>}
                    {Number.isFinite(p.invalidation) && <div><dt>{t('researchPro.chartTa.rztastrip.invalidAboveBelow', "Invalid above/below")}</dt><dd className="mono">{fmt(p.invalidation)}</dd></div>}
                  </dl>
                </div>
              )}
            </div>
          )
        })}
        {candles.map(c => (
          <span key={c.id} className={`rzta-candle rzta-candle--${c.bias}`} title={c.definition}>
            {c.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export { CHART_PATTERNS }
