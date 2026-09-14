/**
 * ChartStyleControl — the chart's own style button in the chart toolbar.
 *
 * Opens a terminal-styled popover to customize the CHART itself —
 * background, buy/sell candles (+ brightness), line color (+ brightness),
 * axis text, grid — independently of the platform Appearance studio
 * (skins/tones/accents never touch the chart; this control is the only
 * thing that does).
 *
 * State lives in useSettingsStore.chartStyle (lib/chartStyle.js) so all
 * three chart renderers (TV iframe, native canvas, lightweight instance)
 * restyle instantly when a value commits.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { Brush, RotateCcw, Pipette, X, Sun, SunDim } from 'lucide-react'
import useSettingsStore from '../../store/useSettingsStore'
import {
  CHART_BG_PRESETS,
  CHART_CANDLE_PRESETS,
  CHART_LINE_PRESETS,
  CHART_AXIS_LEVELS,
  CHART_GRID_LEVELS,
  BRIGHT_MIN,
  BRIGHT_MAX,
  clampBright,
  isStockChartStyle,
} from '../../lib/chartStyle'
import './chartstyle.css'

const STOCK_BG = '#111113'
const STOCK_UP = '#10B981'
const STOCK_DOWN = '#EF4444'
const BRIGHT_STEP = 10

/** rAF-throttled commit for native color-input scrubbing + slider drags. */
function useThrottledCommit(commit) {
  const rafRef = useRef(0)
  const pendingRef = useRef(null)
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])
  return (patch) => {
    pendingRef.current = patch
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      if (pendingRef.current) commit(pendingRef.current)
      pendingRef.current = null
    })
  }
}

/**
 * Brightness row: [dim −10] [slider −50..+50] [brighten +10] [value].
 * Explicit buttons + a visible slider thumb — no hidden drag gestures.
 * onStep reads the LATEST value from the store (not this render's prop)
 * so rapid clicks accumulate instead of re-committing a stale base.
 */
function BrightnessRow({ label, value, onPreview, onCommit, onStep }) {
  return (
    <div className="chs-bright-row">
      <span className="chs-pair-label">{label}</span>
      <button
        type="button"
        className="chs-step"
        onClick={() => onStep(-BRIGHT_STEP)}
        disabled={value <= BRIGHT_MIN}
        title={`Dim (−${BRIGHT_STEP})`}
        aria-label={`Dim ${label.toLowerCase()} by ${BRIGHT_STEP}`}
      >
        <SunDim size={11} strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="chs-slider-wrap">
        <input
          type="range"
          className="chs-slider"
          min={BRIGHT_MIN}
          max={BRIGHT_MAX}
          step={1}
          value={value}
          onChange={(e) => onPreview(clampBright(Number(e.target.value)))}
          onPointerUp={(e) => onCommit(clampBright(Number(e.target.value)))}
          onKeyUp={(e) => onCommit(clampBright(Number(e.target.value)))}
          onBlur={(e) => onCommit(clampBright(Number(e.target.value)))}
          onDoubleClick={() => onCommit(0)}
          aria-label={`${label} brightness, ${BRIGHT_MIN} to +${BRIGHT_MAX}`}
        />
      </div>
      <button
        type="button"
        className="chs-step"
        onClick={() => onStep(BRIGHT_STEP)}
        disabled={value >= BRIGHT_MAX}
        title={`Brighten (+${BRIGHT_STEP})`}
        aria-label={`Brighten ${label.toLowerCase()} by ${BRIGHT_STEP}`}
      >
        <Sun size={11} strokeWidth={2} aria-hidden="true" />
      </button>
      <span className={`chs-bright-value${value === 0 ? ' chs-bright-value--default' : ''}`}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  )
}

export default function ChartStyleControl({ chartType = 'candles', isTV = false }) {
  const chartStyle = useSettingsStore((s) => s.chartStyle)
  const setChartStyle = useSettingsStore((s) => s.setChartStyle)
  const resetChartStyle = useSettingsStore((s) => s.resetChartStyle)

  // Only surface the section that matches what the user is looking at:
  // native line chart -> Line, everything else (native candles/holders AND
  // the TradingView widget, which is a candle chart) -> Candles only.
  const showCandlesSection = isTV || chartType !== 'line'
  const showLineSection = !isTV && chartType === 'line'

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const [candleCustomOpen, setCandleCustomOpen] = useState(false)

  const btnRef = useRef(null)
  const popoverRef = useRef(null)
  const bgInputRef = useRef(null)
  const upInputRef = useRef(null)
  const downInputRef = useRef(null)
  const lineInputRef = useRef(null)

  const throttled = useThrottledCommit(setChartStyle)
  const isStock = isStockChartStyle(chartStyle)

  // Stepper clicks read the freshest value straight from the store so
  // rapid clicking accumulates (+10, +20, ...) instead of re-applying
  // the same stale base from an older render.
  const stepBright = (key) => (delta) => {
    const cur = useSettingsStore.getState().chartStyle?.[key] || 0
    setChartStyle({ [key]: clampBright(cur + delta) })
  }

  // Anchor the popover under the trigger, right-aligned so it never
  // overflows the chart's right edge.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return }
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right - 4) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const candlePresetActive = (p) =>
    (p.up || null) === (chartStyle.up || null) && (p.down || null) === (chartStyle.down || null)
  const candleIsCustomPair = !CHART_CANDLE_PRESETS.some(candlePresetActive)
  const showCandleCustom = candleCustomOpen || candleIsCustomPair
  const bgIsCustom = !!chartStyle.bg && !CHART_BG_PRESETS.some((p) => (p.hex || null) === chartStyle.bg)
  const lineIsCustom = !!chartStyle.line && !CHART_LINE_PRESETS.some((p) => (p.hex || null) === chartStyle.line)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`tf-btn chs-trigger${open ? ' active' : ''}${!isStock ? ' chs-trigger--custom' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Chart style"
        title="Chart style — background, candles, axis"
        onClick={() => setOpen((v) => !v)}
      >
        <Brush size={13} strokeWidth={1.9} aria-hidden="true" />
      </button>

      {open && pos && ReactDOM.createPortal(
        <div
          ref={popoverRef}
          className="chs-popover"
          role="dialog"
          aria-label="Chart style"
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
        >
          <div className="chs-head">
            <span className="chs-title">Chart Style</span>
            <div className="chs-head-actions">
              <button
                type="button"
                className="chs-reset"
                onClick={resetChartStyle}
                disabled={isStock}
              >
                <RotateCcw size={10} strokeWidth={2} aria-hidden="true" />
                Reset
              </button>
              <button
                type="button"
                className="chs-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* BACKGROUND */}
          <div className="chs-row-head">
            <span className="chs-label">Background</span>
          </div>
          <div className="chs-chips" role="radiogroup" aria-label="Chart background">
            {CHART_BG_PRESETS.map((p) => {
              const selected = (p.hex || null) === (chartStyle.bg || null)
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`chs-chip${selected ? ' chs-chip--on' : ''}`}
                  onClick={() => setChartStyle({ bg: p.hex })}
                  title={p.label}
                  aria-label={p.label}
                >
                  <span className="chs-chip-fill" style={{ background: p.hex || STOCK_BG }} />
                </button>
              )
            })}
            <button
              type="button"
              className={`chs-chip chs-chip--picker${bgIsCustom ? ' chs-chip--on' : ''}`}
              onClick={() => bgInputRef.current?.click()}
              title="Custom background"
              aria-label="Custom background"
            >
              <span className="chs-chip-fill chs-chip-fill--picker">
                <Pipette size={9} strokeWidth={2} />
              </span>
            </button>
            <input
              ref={bgInputRef}
              type="color"
              className="chs-color-input"
              value={chartStyle.bg || STOCK_BG}
              onInput={(e) => throttled({ bg: e.target.value })}
              onChange={(e) => setChartStyle({ bg: e.target.value })}
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>

          {/* CANDLES — shown when the user is on a candle-capable view */}
          {showCandlesSection && (<>
          <div className="chs-row-head">
            <span className="chs-label">Candles</span>
          </div>
          <div className="chs-candles" role="radiogroup" aria-label="Candle colors">
            {CHART_CANDLE_PRESETS.map((p) => {
              const selected = candlePresetActive(p)
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`chs-candle${selected ? ' chs-candle--on' : ''}`}
                  onClick={() => setChartStyle({ up: p.up, down: p.down })}
                  title={p.label}
                  aria-label={p.label}
                >
                  <span className="chs-candle-glyph" aria-hidden="true">
                    <span className="chs-candle-bar" style={{ background: p.up || STOCK_UP }} />
                    <span className="chs-candle-bar chs-candle-bar--down" style={{ background: p.down || STOCK_DOWN }} />
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              className={`chs-candle chs-candle--picker${candleIsCustomPair ? ' chs-candle--on' : ''}`}
              onClick={() => setCandleCustomOpen((v) => !v)}
              aria-expanded={showCandleCustom}
              title="Custom buy/sell colors"
              aria-label="Custom buy/sell colors"
            >
              {/* Same picker language as the Line custom button */}
              <span className="chs-candle-picker" aria-hidden="true">
                <Pipette size={9} strokeWidth={2} />
              </span>
            </button>
          </div>

          {showCandleCustom && (
            <div className="chs-pair-row">
              <div className="chs-pair-field">
                <span className="chs-pair-label">Buy</span>
                <button
                  type="button"
                  className="chs-pair-swatch"
                  style={{ background: chartStyle.up || STOCK_UP }}
                  onClick={() => upInputRef.current?.click()}
                  title="Buy candle color"
                  aria-label="Buy candle color"
                />
                <span className="chs-pair-hex">{(chartStyle.up || STOCK_UP).toUpperCase()}</span>
              </div>
              <div className="chs-pair-field">
                <span className="chs-pair-label">Sell</span>
                <button
                  type="button"
                  className="chs-pair-swatch"
                  style={{ background: chartStyle.down || STOCK_DOWN }}
                  onClick={() => downInputRef.current?.click()}
                  title="Sell candle color"
                  aria-label="Sell candle color"
                />
                <span className="chs-pair-hex">{(chartStyle.down || STOCK_DOWN).toUpperCase()}</span>
              </div>
              <input
                ref={upInputRef}
                type="color"
                className="chs-color-input"
                value={chartStyle.up || STOCK_UP}
                onInput={(e) => throttled({ up: e.target.value })}
                onChange={(e) => setChartStyle({ up: e.target.value })}
                tabIndex={-1}
                aria-hidden="true"
              />
              <input
                ref={downInputRef}
                type="color"
                className="chs-color-input"
                value={chartStyle.down || STOCK_DOWN}
                onInput={(e) => throttled({ down: e.target.value })}
                onChange={(e) => setChartStyle({ down: e.target.value })}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          )}

          <BrightnessRow
            label="Brightness"
            value={chartStyle.candleBright || 0}
            onPreview={(v) => throttled({ candleBright: v })}
            onCommit={(v) => setChartStyle({ candleBright: v })}
            onStep={stepBright('candleBright')}
          />
          </>)}

          {/* LINE — shown when the user is on the line view */}
          {showLineSection && (<>
          <div className="chs-row-head">
            <span className="chs-label">Line</span>
          </div>
          <div className="chs-chips" role="radiogroup" aria-label="Line color">
            {CHART_LINE_PRESETS.map((p) => {
              const selected = (p.hex || null) === (chartStyle.line || null)
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`chs-chip${selected ? ' chs-chip--on' : ''}`}
                  onClick={() => setChartStyle(p.hex ? { line: p.hex } : { line: null, lineBright: 0 })}
                  title={p.id === 'auto' ? 'Auto (token color)' : p.label}
                  aria-label={p.id === 'auto' ? 'Auto (token color)' : p.label}
                >
                  {p.hex
                    ? <span className="chs-chip-fill" style={{ background: p.hex }} />
                    : <span className="chs-chip-fill chs-chip-fill--auto">A</span>}
                </button>
              )
            })}
            <button
              type="button"
              className={`chs-chip chs-chip--picker${lineIsCustom ? ' chs-chip--on' : ''}`}
              onClick={() => lineInputRef.current?.click()}
              title="Custom line color"
              aria-label="Custom line color"
            >
              <span className="chs-chip-fill chs-chip-fill--picker">
                <Pipette size={9} strokeWidth={2} />
              </span>
            </button>
            <input
              ref={lineInputRef}
              type="color"
              className="chs-color-input"
              value={chartStyle.line || '#F5F5F7'}
              onInput={(e) => throttled({ line: e.target.value })}
              onChange={(e) => setChartStyle({ line: e.target.value })}
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>

          {/* Line brightness — only meaningful once a line color is picked
              (Auto resolves to the token color at render time) */}
          {chartStyle.line && (
            <BrightnessRow
              label="Brightness"
              value={chartStyle.lineBright || 0}
              onPreview={(v) => throttled({ lineBright: v })}
              onCommit={(v) => setChartStyle({ lineBright: v })}
              onStep={stepBright('lineBright')}
            />
          )}
          </>)}

          {/* AXIS + GRID segmented rows */}
          <div className="chs-seg-row">
            <span className="chs-label">Axis</span>
            <div className="chs-seg" role="radiogroup" aria-label="Axis text">
              {CHART_AXIS_LEVELS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  role="radio"
                  aria-checked={(chartStyle.axis || null) === l.id}
                  className={`chs-seg-btn${(chartStyle.axis || null) === l.id ? ' chs-seg-btn--on' : ''}`}
                  onClick={() => setChartStyle({ axis: l.id })}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="chs-seg-row">
            <span className="chs-label">Grid</span>
            <div className="chs-seg" role="radiogroup" aria-label="Grid lines">
              {CHART_GRID_LEVELS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  role="radio"
                  aria-checked={(chartStyle.grid || null) === l.id}
                  className={`chs-seg-btn${(chartStyle.grid || null) === l.id ? ' chs-seg-btn--on' : ''}`}
                  onClick={() => setChartStyle({ grid: l.id })}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="chs-foot">Chart style is independent from skins</div>
        </div>,
        document.body
      )}
    </>
  )
}
