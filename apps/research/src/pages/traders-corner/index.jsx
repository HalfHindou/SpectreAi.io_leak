/**
 * Trader's Corner — Bloomberg Terminal Grade
 * 3-column layout: Left (Asset Intelligence) | Center (chart) | Right (Derivatives Dashboard)
 * Dense, information-rich. Every pixel earns its place.
 */
import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useMarketIntel } from '@/hooks/useMarketIntel'
import useSettingsStore from '@/store/useSettingsStore'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
// Default chart mode loads eagerly so the chart area is on screen with the
// rest of the terminal. The alternate modes (Spectre/TV/liqmap) are
// only mounted when the user clicks their pill, so their bundles defer.
import SpectreChart from '@/chart/SpectreChart'
const TradingChart = lazy(() => import('@/components/trading-chart'))
const TradingViewAdvanced = lazy(() => import('@/components/TradingViewAdvanced'))
import {
  getFundingRates, getOpenInterest, getLongShortRatios,
  getLSRatioHistory, getFundingHistory, getLiquidationData,
  getOptionsData, getOIHistory, getOIChartHistory,
  getTakerVolume, getBasisData, getCmeCot, getLiquidationFeed,
  dataFreshAt, isSyntheticSeries,
} from './tradersCornerApi'
import { getCryptoNews, getRssMarketNews } from '@/services/cryptoNewsApi'
import { useIsMobile } from '@/hooks/useMediaQuery'
import IButton from '@/components/intelligence/IButton'
import { useChartTaSurface, ChartTaSurface } from '@/components/chart-ta-surface'
import { fmt, fmtK, fmtPrice, cx, formatNewsTime } from './components/tc-formatters'
import { Tk, Spark, Shim } from './components/tc-spark'
import { FundingBars, FC } from './components/tc-funding-bars'
const LiqHeatmapPanel = lazy(() => import('@/components/liq-heatmap-panel'))
import './TradersCorner.css'
import './traders-corner.mobile.css'

// ── Chart view modes (shared by the button row + compact dropdown) ──
const CHART_MODES = [
  { key: 'chart', label: 'Chart' },
  { key: 'spectre', label: 'Spectre' },
  { key: 'tv', label: 'TradingView' },
  { key: 'liqmap', label: 'Liq Map' },
  { key: 'oichart', label: 'OI Chart' },
]

// Custom dropdown for the chart view on narrow bars. A native <select> can't be
// styled to match the design system (the option list is OS-rendered), so this
// is a glass popup with full styling control.
function ChartModeDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = CHART_MODES.find(m => m.key === value) || CHART_MODES[0]

  return (
    <div className="tc-dd" ref={ref}>
      <button
        type="button"
        className="tc-dd-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{current.label}</span>
        <svg className={cx('tc-dd-caret', open && 'open')} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="tc-dd-menu" role="listbox">
          {CHART_MODES.map(m => (
            <button
              key={m.key}
              type="button"
              role="option"
              aria-selected={m.key === value}
              className={cx('tc-dd-item', m.key === value && 'active')}
              onClick={() => { onChange(m.key); setOpen(false) }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Custom symbol dropdown for narrow chart bars (mirrors ChartModeDropdown but
// with token icons). Shares the .tc-dd* glass styling.
function ChartSymbolDropdown({ value, onChange, symbols }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="tc-dd tc-dd--sym" ref={ref}>
      <button
        type="button"
        className="tc-dd-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Tk s={value} sz={16} />
        <span>{value}</span>
        <svg className={cx('tc-dd-caret', open && 'open')} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="tc-dd-menu" role="listbox">
          {symbols.map(s => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={s === value}
              className={cx('tc-dd-item', s === value && 'active')}
              onClick={() => { onChange(s); setOpen(false) }}
            >
              <Tk s={s} sz={16} />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Squarified Treemap (Bruls, Huizing, van Wijk 2000) ──
function LiqTreemap({ oi, liqData }) {
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  const [dims, setDims] = useState({ w: 400, h: 400 })

  useEffect(() => {
    if (!boxRef.current) return
    const ro = new ResizeObserver(e => {
      const cr = e[0].contentRect
      if (cr.width > 0 && cr.height > 0) setDims({ w: Math.floor(cr.width), h: Math.floor(cr.height) })
    })
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !oi?.coins?.length) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { w, h } = dims
    canvas.width = w * dpr; canvas.height = h * dpr
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h)

    // Build per-coin long/short ratio + liq values from liqData (bySymbol from aggregator)
    const coinLSMap = {}
    const coinLiqMap = {}
    if (liqData?.bySymbol) {
      for (const [sym, d] of Object.entries(liqData.bySymbol)) {
        const total = (d.long || 0) + (d.short || 0)
        coinLSMap[sym] = total > 0 ? (d.long || 0) / total : 0.5
        coinLiqMap[sym] = total
      }
    }
    const globalLongPct = liqData?.total > 0 ? (liqData.totalLong / liqData.total) : 0.5

    // Filter out anomalous OI (e.g. BANANA contract sizing bug)
    const TOP_ASSETS = new Set(['BTC','ETH','SOL','XRP','BNB','DOGE','ADA','AVAX','LINK','DOT'])
    const saneCoins = oi.coins.filter(c => {
      if (TOP_ASSETS.has(c.symbol)) return true
      // If a non-top coin has OI > $5B on a single exchange, it's anomalous
      if ((c.oiUsd || 0) > 5e9) return false
      return true
    })

    // If real per-coin liq data is sparse, distribute total proportionally by OI
    const totalLiq = liqData?.total || 0
    const totalOIForLiq = saneCoins.slice(0, 12).reduce((s, c) => s + (c.oiUsd || 0), 0) || 1

    const coins = [...saneCoins.slice(0, 12)]
      .sort((a, b) => (b.oiUsd || 0) - (a.oiUsd || 0))
      .map(c => {
        const realLiq = coinLiqMap[c.symbol] || 0
        // Use real data if available, otherwise distribute total proportionally
        const liqVal = realLiq > 0 ? realLiq : totalLiq * ((c.oiUsd || 0) / totalOIForLiq)
        return {
          symbol: c.symbol, value: c.oiUsd || 0, price: c.price,
          liqValue: liqVal,
          color: TOKEN_ROW_COLORS[c.symbol]?.bg || '255,255,255',
          longPct: coinLSMap[c.symbol] ?? globalLongPct,
        }
      })
    const gap = 4

    // Squarified treemap: produces near-square rectangles
    const squarify = (items, rect) => {
      if (!items.length || rect.w < 2 || rect.h < 2) return []
      const totalArea = rect.w * rect.h
      const totalValue = items.reduce((s, c) => s + c.value, 0) || 1
      const rects = []

      const worst = (row, side) => {
        const rowVal = row.reduce((s, c) => s + c.value, 0)
        const rowArea = (rowVal / totalValue) * totalArea
        const rowSide = rowArea / side
        let mx = 0
        for (const c of row) {
          const cellArea = (c.value / totalValue) * totalArea
          const cellSide = cellArea / rowSide
          const aspect = Math.max(cellSide / rowSide, rowSide / cellSide)
          if (aspect > mx) mx = aspect
        }
        return mx
      }

      let remaining = [...items]
      let { x, y, w: rw, h: rh } = rect

      while (remaining.length > 0) {
        const horizontal = rw >= rh
        const side = horizontal ? rh : rw
        const row = [remaining[0]]
        let bestWorst = worst(row, side)

        let i = 1
        while (i < remaining.length) {
          const candidate = [...row, remaining[i]]
          const newWorst = worst(candidate, side)
          if (newWorst <= bestWorst) {
            row.push(remaining[i])
            bestWorst = newWorst
            i++
          } else break
        }
        remaining = remaining.slice(row.length)

        // Lay out the row
        const rowVal = row.reduce((s, c) => s + c.value, 0)
        const rowFrac = rowVal / totalValue
        const rowArea = rowFrac * totalArea

        if (horizontal) {
          const rowW = rowArea / rh
          let cy = y
          for (const c of row) {
            const cellH = (c.value / rowVal) * rh
            rects.push({ ...c, x, y: cy, w: rowW - gap, h: cellH - gap })
            cy += cellH
          }
          x += rowW; rw -= rowW
        } else {
          const rowH = rowArea / rw
          let cx = x
          for (const c of row) {
            const cellW = (c.value / rowVal) * rw
            rects.push({ ...c, x: cx, y, w: cellW - gap, h: rowH - gap })
            cx += cellW
          }
          y += rowH; rh -= rowH
        }

        // Recalculate totalArea and totalValue for remaining items
        // (not needed — fractions are relative to the original total, so the area shrinks correctly)
      }
      return rects
    }

    const rects = squarify(coins, { x: 0, y: 0, w, h })
    const maxOI = Math.max(...coins.map(c => c.value), 1)

    rects.forEach(r => {
      if (r.w < 2 || r.h < 2) return
      const rgb = r.color.split(',').map(Number)
      const logRatio = Math.log10(1 + (r.value / maxOI) * 9)
      const alpha = 0.65 + logRatio * 0.3
      const rad = Math.min(10, r.w / 4, r.h / 4)

      // Determine long/short dominance for this coin
      const lp = r.longPct
      const isLongDominant = lp > 0.52
      const isShortDominant = lp < 0.48
      // Color: green tint if more longs at risk (bearish signal), red if more shorts (bullish)
      const sentR = isLongDominant ? 16 : isShortDominant ? 239 : rgb[0]
      const sentG = isLongDominant ? 185 : isShortDominant ? 68 : rgb[1]
      const sentB = isLongDominant ? 129 : isShortDominant ? 68 : rgb[2]

      // Dark background
      ctx.fillStyle = 'rgba(0,0,0,0.4)'
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, rad); ctx.fill()

      // Main fill — blend brand color with long/short sentiment
      ctx.fillStyle = `rgba(${Math.round(rgb[0] * 0.5 + sentR * 0.5)},${Math.round(rgb[1] * 0.5 + sentG * 0.5)},${Math.round(rgb[2] * 0.5 + sentB * 0.5)},${alpha})`
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, rad); ctx.fill()

      // Gradient overlay for depth
      const grad = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h)
      grad.addColorStop(0, 'rgba(255,255,255,0.10)')
      grad.addColorStop(1, 'rgba(0,0,0,0.12)')
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, rad); ctx.fill()

      // Border — long/short colored
      const borderColor = isLongDominant
        ? `rgba(16,185,129,${0.3 + logRatio * 0.3})`
        : isShortDominant
          ? `rgba(239,68,68,${0.3 + logRatio * 0.3})`
          : 'rgba(255,255,255,0.12)'
      ctx.strokeStyle = borderColor
      ctx.lineWidth = isLongDominant || isShortDominant ? 1.5 : 1
      ctx.stroke()

      // ── Labels (dark outline + fill for contrast on any bg color) ──
      const drawText = (text, x, y, font, fillColor) => {
        ctx.font = font
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.strokeText(text, x, y)
        ctx.fillStyle = fillColor
        ctx.fillText(text, x, y)
      }
      if (r.w > 50 && r.h > 38) {
        const fs = Math.min(Math.max(16, r.w / 4.5), r.h > 70 ? 32 : 22)
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        drawText(r.symbol, r.x + 10, r.y + 8, `800 ${fs}px -apple-system, system-ui, sans-serif`, '#f5f5f7')
        if (r.h > 50) {
          // Liquidation value (real per-coin data, not OI*0.02)
          const valFs = Math.min(Math.max(11, r.w / 7), 15)
          const liqVal = r.liqValue > 0 ? fmtK(r.liqValue) : '—'
          drawText(liqVal, r.x + 10, r.y + 12 + fs, `600 ${valFs}px -apple-system, system-ui, sans-serif`, 'rgba(255,255,255,0.9)')
          // Long/Short label
          if (r.h > 65 && r.w > 70) {
            const lsLabel = isLongDominant
              ? `L ${(lp * 100).toFixed(0)}%`
              : isShortDominant
                ? `S ${((1 - lp) * 100).toFixed(0)}%`
                : 'Neutral'
            const lsColor = isLongDominant ? '#34D399' : isShortDominant ? '#F87171' : 'rgba(255,255,255,0.5)'
            const lsFs = Math.min(Math.max(9, r.w / 9), 12)
            drawText(lsLabel, r.x + 10, r.y + 16 + fs + valFs, `600 ${lsFs}px -apple-system, system-ui, sans-serif`, lsColor)
          }
        }
      } else if (r.w > 24 && r.h > 18) {
        const fs = Math.max(10, Math.min(13, r.w / 4))
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        drawText(r.symbol, r.x + r.w / 2, r.y + r.h / 2, `800 ${fs}px -apple-system, system-ui, sans-serif`, '#f5f5f7')
      }
    })
  }, [oi, liqData, dims])

  return (
    <div ref={boxRef} className="tc-treemap">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}



// ── OI Area Chart (canvas sparkline, not Recharts) ──
/**
 * Open interest is meaningless on its own — a line that goes up tells you
 * nothing about who is positioned or how. It only reads AGAINST price, and the
 * four quadrants are the whole point of the panel:
 *
 *   OI up   + price up    -> new longs        (fresh leverage chasing strength)
 *   OI up   + price down  -> new shorts       (fresh leverage pressing weakness)
 *   OI down + price up    -> short squeeze    (positions covering into strength)
 *   OI down + price down  -> long liquidation (deleveraging, positions flushed)
 *
 * So this draws both series against their own axes and states the quadrant
 * outright, rather than the bare green area it used to be.
 */
function classifyOiPrice(oiPct, pxPct) {
  if (Math.abs(oiPct) < 0.5 && Math.abs(pxPct) < 0.5) {
    return { label: 'Balanced', detail: 'Leverage and price both flat — no positioning shift', tone: 'neutral' }
  }
  const oiUp = oiPct >= 0
  const pxUp = pxPct >= 0
  if (oiUp && pxUp) return { label: 'New longs', detail: 'Fresh leverage chasing the move up', tone: 'bull' }
  if (oiUp && !pxUp) return { label: 'New shorts', detail: 'Fresh leverage pressing the move down', tone: 'bear' }
  if (!oiUp && pxUp) return { label: 'Short squeeze', detail: 'Positions covering into strength', tone: 'bull' }
  return { label: 'Long liquidation', detail: 'Deleveraging — longs flushed on the way down', tone: 'bear' }
}

function OIChartCanvas({ data, symbol, height = 420, dayMode = false }) {
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  // 🪤 The crosshair position is a REF, not state. As state it was a dep of
  // drawChart, so every pointer sample repainted the whole canvas AND tore down
  // and rebuilt the ResizeObserver below. Repaints are now rAF-coalesced to one
  // per frame, matching the heatmap view.
  const hoverRef = useRef(null)
  const rafRef = useRef(0)

  // 🪤 This used to size the canvas from a `dims` STATE seeded at `{ w: 600 }`
  // and updated by a ResizeObserver. The observer never attached: while data
  // was loading the component early-returned a different container that
  // carried no `boxRef`, so `boxRef.current` was null when the observer effect
  // ran, and its `[height]` dep array never re-ran it once the real container
  // mounted. `dims.w` stayed 600 forever, so on a Retina display the backing
  // store came out 1200px wide and was stretched across 1684 device px — a
  // 1.4x upscale. That is what read as "pixelated, weird Windows-95 font": the
  // font was always correct, just blurred by the stretch. Measuring the canvas
  // live at draw time makes the whole class of bug impossible, and the
  // container below now always carries the ref.
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !data?.length || data.length < 2) return
    const rect = canvas.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w < 80 || h < 80) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)

    const ink = dayMode ? '15,23,42' : '245,245,247'
    const OI_RGB = '59,130,246'
    const pad = { t: 46, r: 66, b: 34, l: 68 }
    const cw = w - pad.l - pad.r
    const ch = h - pad.t - pad.b
    if (cw < 40 || ch < 40) return

    const vals = data.map(d => d.value)
    const hasPrice = data.some(d => Number.isFinite(d.price) && d.price > 0)
    const pxs = hasPrice ? data.map(d => d.price).filter(p => Number.isFinite(p) && p > 0) : []

    // Pad the range off the SPAN, not off the values — scaling by 0.998/1.002
    // meant a 0.1% wiggle and a 10% collapse both filled the pane identically,
    // so the shape carried no sense of magnitude.
    const band = (arr) => {
      const lo = Math.min(...arr), hi = Math.max(...arr)
      const p = (hi - lo) * 0.12 || Math.abs(hi) * 0.002 || 1
      return { mn: lo - p, mx: hi + p, rng: (hi + p) - (lo - p) || 1 }
    }
    const oi = band(vals)
    const px = hasPrice ? band(pxs) : null
    const X = (i) => pad.l + (i / Math.max(1, data.length - 1)) * cw
    const Yoi = (v) => pad.t + (1 - (v - oi.mn) / oi.rng) * ch
    const Ypx = (v) => pad.t + (1 - (v - px.mn) / px.rng) * ch

    // Grid + dual axes: OI on the left, price on the right
    ctx.lineWidth = 1
    ctx.font = '500 10px -apple-system, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(pad.t + (i / 4) * ch) + 0.5
      ctx.strokeStyle = `rgba(${ink},0.05)`
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke()
      ctx.fillStyle = `rgba(${OI_RGB},0.75)`
      ctx.textAlign = 'right'
      ctx.fillText(fmtK(oi.mx - (i / 4) * oi.rng), pad.l - 8, y)
      if (px) {
        ctx.fillStyle = `rgba(${ink},0.4)`
        ctx.textAlign = 'left'
        ctx.fillText(fmtPrice(px.mx - (i / 4) * px.rng), w - pad.r + 8, y)
      }
    }

    // Time axis
    ctx.fillStyle = `rgba(${ink},0.35)`
    ctx.textBaseline = 'alphabetic'
    const ticks = Math.min(5, data.length)
    for (let i = 0; i < ticks; i++) {
      const idx = Math.round((i / (ticks - 1 || 1)) * (data.length - 1))
      const d = new Date(data[idx].time)
      const lbl = `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:00`
      ctx.textAlign = i === 0 ? 'left' : i === ticks - 1 ? 'right' : 'center'
      ctx.fillText(lbl, X(idx), h - 12)
    }

    // OI area + line
    ctx.beginPath()
    data.forEach((d, i) => { const x = X(i), y = Yoi(d.value); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.lineTo(X(data.length - 1), pad.t + ch)
    ctx.lineTo(X(0), pad.t + ch)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch)
    grad.addColorStop(0, `rgba(${OI_RGB},0.26)`)
    grad.addColorStop(1, `rgba(${OI_RGB},0.01)`)
    ctx.fillStyle = grad; ctx.fill()

    ctx.beginPath()
    data.forEach((d, i) => { const x = X(i), y = Yoi(d.value); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.strokeStyle = `rgb(${OI_RGB})`; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke()

    // Price line — warm white, per the design system (hue is reserved for
    // semantics; the quadrant badge below is what carries bull/bear).
    if (px) {
      ctx.beginPath()
      let started = false
      data.forEach((d, i) => {
        if (!Number.isFinite(d.price) || d.price <= 0) return
        const x = X(i), y = Ypx(d.price)
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true)
      })
      ctx.strokeStyle = `rgba(${ink},0.82)`; ctx.lineWidth = 1.4; ctx.stroke()
    }

    // Header: title, the quadrant read, and both deltas
    const first = vals[0], last = vals[vals.length - 1]
    const oiPct = first > 0 ? ((last - first) / first) * 100 : 0
    const pxPct = px && pxs.length > 1 ? ((pxs[pxs.length - 1] - pxs[0]) / pxs[0]) * 100 : 0
    const verdict = classifyOiPrice(oiPct, pxPct)
    const toneRgb = verdict.tone === 'bull' ? '16,185,129' : verdict.tone === 'bear' ? '239,68,68' : ink

    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillStyle = `rgba(${ink},0.85)`
    ctx.font = '600 12.5px -apple-system, system-ui, sans-serif'
    const hours = Math.max(1, Math.round((data[data.length - 1].time - data[0].time) / 3600e3))
    ctx.fillText(`${symbol} Open Interest vs Price · ${hours}h`, pad.l, 10)

    if (hasPrice) {
      ctx.font = '700 11px -apple-system, system-ui, sans-serif'
      const badge = `${verdict.label}`
      const bw = ctx.measureText(badge).width + 16
      const bx = pad.l, by = 28
      ctx.fillStyle = `rgba(${toneRgb},0.14)`
      ctx.beginPath(); ctx.roundRect(bx, by, bw, 16, 4); ctx.fill()
      ctx.fillStyle = `rgb(${toneRgb})`
      ctx.fillText(badge, bx + 8, by + 3.5)

      ctx.font = '500 10.5px -apple-system, system-ui, sans-serif'
      ctx.fillStyle = `rgba(${ink},0.45)`
      ctx.fillText(verdict.detail, bx + bw + 10, by + 4)
    }

    // Right-aligned current values
    ctx.textAlign = 'right'
    ctx.font = '700 13px -apple-system, system-ui, sans-serif'
    ctx.fillStyle = `rgb(${OI_RGB})`
    ctx.fillText(fmtK(last), w - pad.r, 8)
    ctx.font = '600 10.5px -apple-system, system-ui, sans-serif'
    ctx.fillStyle = `rgba(${oiPct >= 0 ? '16,185,129' : '239,68,68'},0.95)`
    ctx.fillText(`OI ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}%`, w - pad.r, 26)
    if (hasPrice) {
      ctx.fillStyle = `rgba(${pxPct >= 0 ? '16,185,129' : '239,68,68'},0.95)`
      ctx.fillText(`Price ${pxPct >= 0 ? '+' : ''}${pxPct.toFixed(2)}%`, w - pad.r, 38)
    }

    // Crosshair
    const hoverX = hoverRef.current
    if (hoverX != null && hoverX >= pad.l && hoverX <= pad.l + cw && data.length > 1) {
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(((hoverX - pad.l) / cw) * (data.length - 1))))
      const d = data[idx], hx = X(idx)
      ctx.strokeStyle = `rgba(${ink},0.28)`; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(hx, pad.t); ctx.lineTo(hx, pad.t + ch); ctx.stroke()
      ctx.fillStyle = `rgb(${OI_RGB})`
      ctx.beginPath(); ctx.arc(hx, Yoi(d.value), 3.2, 0, Math.PI * 2); ctx.fill()
      if (px && Number.isFinite(d.price) && d.price > 0) {
        ctx.fillStyle = `rgba(${ink},0.9)`
        ctx.beginPath(); ctx.arc(hx, Ypx(d.price), 3.2, 0, Math.PI * 2); ctx.fill()
      }
      const dt = new Date(d.time)
      const lines = [
        `${dt.getDate()}/${dt.getMonth() + 1} ${String(dt.getHours()).padStart(2, '0')}:00`,
        `OI ${fmtK(d.value)}`,
      ]
      if (px && Number.isFinite(d.price) && d.price > 0) lines.push(`Px ${fmtPrice(d.price)}`)
      ctx.font = '600 10.5px -apple-system, system-ui, sans-serif'
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16
      const th = lines.length * 14 + 8
      const tx = Math.min(hx + 10, pad.l + cw - tw)
      const ty = pad.t + 8
      ctx.fillStyle = dayMode ? 'rgba(255,255,255,0.95)' : 'rgba(18,18,22,0.94)'
      ctx.strokeStyle = `rgba(${ink},0.14)`
      ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 6); ctx.fill(); ctx.stroke()
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      lines.forEach((l, i) => {
        ctx.fillStyle = `rgba(${ink},${i === 0 ? 0.5 : 0.9})`
        ctx.fillText(l, tx + 8, ty + 6 + i * 14)
      })
    }
  }, [data, symbol, dayMode])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; drawChart() })
  }, [drawChart])

  useEffect(() => { drawChart() }, [drawChart])
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(scheduleDraw)
    ro.observe(box)
    return () => ro.disconnect()
  }, [scheduleDraw])

  return (
    <div
      ref={boxRef}
      style={{ width: '100%', height, position: 'relative' }}
      onMouseMove={e => { hoverRef.current = e.clientX - e.currentTarget.getBoundingClientRect().left; scheduleDraw() }}
      onMouseLeave={() => { hoverRef.current = null; scheduleDraw() }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      {!data?.length ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Shim h={24} />
        </div>
      ) : null}
    </div>
  )
}


// The live tier polls every 15s, so the header stamp only ever moves in 15s
// steps. Rendered as a bare wall-clock time it read as a broken clock — users
// compared it to their own clock, saw it lag, and reported it (2026-08-24).
// It is a data-age readout, so it now says so.
const TC_STALE_AFTER_MS = 60_000

function describeFreshness(ts) {
  if (!ts) return { label: null, stale: false, at: '' }
  const age = Math.max(0, Date.now() - ts.getTime())
  const secs = Math.round(age / 1000)
  const label = secs < 60
    ? `${secs}s ago`
    : secs < 3600
      ? `${Math.round(secs / 60)}m ago`
      : `${Math.round(secs / 3600)}h ago`
  // Four fast lanes at a 10-15s TTL against a 15s poll reach ~30s of age in
  // perfect health, so a minute is the first age that means something is wrong.
  return { label, stale: age > TC_STALE_AFTER_MS, at: ts.toLocaleTimeString() }
}

/**
 * Header freshness: the Live/Stale pill and the age of the data behind it.
 *
 * Owns its own 1s interval and re-renders only when the text it draws actually
 * changes, so the page around it never re-renders for a tick. `updatedRef` is a
 * ref the parent writes after each live poll — reading it here costs the parent
 * no render at all.
 *
 * The pill used to be a hardcoded "Live" that said Live whether or not anything
 * was arriving. It now follows the same number the stamp does.
 */
function TcFreshness({ updatedRef }) {
  const [view, setView] = useState(() => describeFreshness(updatedRef.current))
  useEffect(() => {
    const id = setInterval(() => {
      const next = describeFreshness(updatedRef.current)
      setView(prev => (
        prev.label === next.label && prev.stale === next.stale && prev.at === next.at ? prev : next
      ))
    }, 1000)
    return () => clearInterval(id)
  }, [updatedRef])

  const { label, stale, at } = view
  const state = !label ? 'Connecting' : stale ? 'Stale' : 'Live'
  return (
    <>
      <span
        className={`tc-live${stale ? ' tc-live--stale' : ''}${!label ? ' tc-live--wait' : ''}`}
        title={label
          ? `Derivatives data last changed at ${at} — refreshes every 15s`
          : 'Waiting for the first derivatives payload'}
      >
        <span className="tc-dot" />{state}
      </span>
      {label && (
        <span
          className={`tc-ts${stale ? ' tc-ts--stale' : ''}`}
          title={`Last change at ${at}`}
        >Updated {label}</span>
      )}
    </>
  )
}

// ══════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════
export default function TradersCornerPage() {
  const { t } = useTranslation()
  const dayMode = useSettingsStore(s => s.dayMode)
  const isMobile = useIsMobile()
  // useMarketIntel previously ran in `full` mode by default, which fans
  // out 8 upstream calls per bundle and also polls the news-driven Alpha
  // Feed every 3 min. /traders-corner only consumes `dominance`,
  // `altSeasonIndex`, and a global long/short ratio for the header strip
  // — the first two are in the slim bundle, and the LS ratio is already
  // available in the page's own `lsRatios` state (from getLongShortRatios).
  // Slim mode drops 5 upstream calls per intel cycle (~300/hour per
  // visitor) and the entire fetchAlpha poll loop.
  const intel = useMarketIntel(60_000, { mode: 'slim' })
  const [chartSymbol, setChartSymbol] = useState('BTC')
  const [assetSearch, setAssetSearch] = useState('')
  // Filter against the settled value so each keystroke doesn't re-sort 30 rows.
  const debouncedAssetSearch = useDebouncedValue(assetSearch, 120)
  const [chartTf, setChartTf] = useState('1H')
  const [funding, setFunding] = useState(null)
  const [oi, setOI] = useState(null)
  const [lsRatios, setLSRatios] = useState(null)
  const [cot, setCot] = useState(null)
  const [lsHistory, setLSHistory] = useState(null)
  const [fundingHistory, setFundingHistory] = useState(null)
  const [liqData, setLiqData] = useState(null)
  const [options, setOptions] = useState(null)
  const [oiHistory, setOIHistory] = useState(null)
  // priceHistory used to be a single BTC klines array stored at index 4 of the
  // live tier batch, then read as a map keyed by symbol (always undefined).
  // The "Hot" sort and per-row chg badge below kept returning null - the
  // upstream call was dead weight. Left as null so the existing reads still
  // short-circuit cleanly.
  const priceHistory = null
  const [takerVol, setTakerVol] = useState(null)
  const [basisData, setBasisData] = useState(null)
  // Age of the data on screen (see dataFreshAt), not the time of the last poll.
  // A ref (not state) so a tick that only moves the readout doesn't re-render
  // the whole page — the <TcFreshness> child reads this on its own 1s interval.
  const lastUpdatedRef = useRef(null)
  const [chartMode, setChartMode] = useState('chart')
  const [chartType, setChartType] = useState('candle') // candle | line | area
  const [liqWindow, setLiqWindow] = useState('24h') // 1h | 4h | 12h | 24h
  const [news, setNews] = useState([])
  const [assetSort, setAssetSort] = useState('oi')
  const [liqFeed, setLiqFeed] = useState([])
  const [oiHistoryData, setOIHistoryData] = useState(null)

  // ── Live derivatives tier (15 s) ──
  // Funding rates, OI, long/short ratios, liquidations and taker volume have
  // client-side cache TTLs of 10-60 s; polling at 15 s keeps the live feel
  // without hammering past the underlying TTL.
  //
  // Each fetch is wired to its own setter so the UI paints progressively as
  // results return - previously the whole batch waited on the slowest call
  // (Promise.allSettled barrier), which made fast data feel as slow as the
  // worst tier-1 timeout.
  const loadLiveData = useCallback(async () => {
    const calls = [
      getFundingRates().then(setFunding),
      getOpenInterest().then(setOI),
      getLongShortRatios().then(setLSRatios),
      getLiquidationData().then(setLiqData),
      getTakerVolume().then(setTakerVol),
    ].map((p) => p.catch(() => {}))
    await Promise.allSettled(calls)
    // NOT `new Date()`. The cache layer answers a failed fetch with the last
    // good payload, so a poll where every upstream died still settles cleanly —
    // stamping the poll time kept the header claiming "just updated" over
    // numbers that had stopped moving. dataFreshAt reads the cache entries'
    // own timestamps, which only advance on a real success.
    lastUpdatedRef.current = dataFreshAt()
  }, [])

  // ── Slow derivatives tier (60 s) ──
  // History series and basis don't change inside their own client-side
  // cache windows (60-120 s). Polling them at 15 s was almost pure cache
  // hits + React render churn 4× per minute. 60 s matches the underlying
  // refresh granularity of these series.
  const loadSlowData = useCallback(async () => {
    const calls = [
      getLSRatioHistory().then(setLSHistory),
      getFundingHistory().then(setFundingHistory),
      getOIHistory().then(setOIHistory),
      getBasisData().then(setBasisData),
    ].map((p) => p.catch(() => {}))
    await Promise.allSettled(calls)
  }, [])

  // ── Very slow tier (5 min) ──
  // Options chains roll only on contract expiry and the client-side cache
  // is 5 min. Polling at 15 s was 20 wasted cache hits per real fetch.
  const loadOptionsData = useCallback(async () => {
    try {
      const data = await getOptionsData()
      if (data) setOptions(data)
    } catch { /* silent */ }
    // CFTC Commitment of Traders publishes ONCE A WEEK (Friday, for the
    // Tuesday close), so it rides the slowest tier there is.
    try {
      const rows = await getCmeCot()
      if (Array.isArray(rows) && rows.length) setCot(rows)
    } catch { /* silent */ }
  }, [])

  // ── News tier (3 min, single fetch on mount) ──
  // News was previously bundled into the 15 s tick, riding on top of the
  // service-layer 60 s cache. News doesn't update inside 15-second
  // windows; bumping to 3 min matches both the service cache and the
  // way users actually read the strip.
  const loadNews = useCallback(async () => {
    try {
      const rss = await getRssMarketNews(null, 12)
      const list = rss?.length ? rss : await getCryptoNews(null, 12)
      if (list?.length) setNews(list)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    // Critical path: live + slow tiers feed the hero strip and asset list -
    // visible above the fold, run immediately.
    loadLiveData()
    loadSlowData()

    // Deferred: news strip is below the fold, options + liq feed are slow
    // tiers that don't need to compete with the first 500ms of network time.
    // requestIdleCallback yields the main thread to React commit and image
    // decoding first.
    const runIdle = (fn) => {
      if (typeof window === 'undefined') return
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(fn, { timeout: 2000 })
      } else {
        setTimeout(fn, 300)
      }
    }
    runIdle(loadOptionsData)
    runIdle(loadNews)
  }, [loadLiveData, loadSlowData, loadOptionsData, loadNews])

  useAdaptivePolling(loadLiveData, { interval: 15_000 })
  useAdaptivePolling(loadSlowData, { interval: 60_000 })
  useAdaptivePolling(loadOptionsData, { interval: 5 * 60_000 })
  useAdaptivePolling(loadNews, { interval: 3 * 60_000 })

  // Fetch liquidation feed (recent events). Bumped from 30 s -> 60 s —
  // the liquidation EVENT FEED (the rolling list of recent liquidations,
  // distinct from the aggregate getLiquidationData() volume number) is
  // an editorial surface, not a microstructure signal. 60 s matches the
  // upstream cache.
  const loadLiqFeed = useCallback(async () => {
    // PRIMARY: the Spectre v1 liquidation tape — a real multi-exchange event
    // stream (okx/binance/bybit, seconds old). The Express Binance-only
    // WebSocket below is a DEV-ONLY aggregator: `/api/market/liquidations`
    // has no serverless mirror, so in production it 404s, and even in dev it
    // was reporting `connected: true` with eventCount 0 — which is why this
    // panel sat on "Awaiting liquidation events…" indefinitely.
    try {
      const events = await getLiquidationFeed()
      if (events.length) { setLiqFeed(events.slice(0, 20)); return }
    } catch { /* fall through to the Express aggregator */ }
    try {
      const res = await fetch('/api/market/liquidations', { signal: AbortSignal.timeout(6000) })
      if (!res.ok) return
      const data = await res.json()
      if (data?.recent?.length) setLiqFeed(data.recent.slice(0, 20))
    } catch { /* silent */ }
  }, [])
  useEffect(() => {
    // Deferred to idle: the liquidation feed sits in the right rail below
    // the asset list and isn't on the critical path for first paint.
    if (typeof window === 'undefined') { loadLiqFeed(); return }
    const cb = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(loadLiqFeed, { timeout: 2000 })
      : setTimeout(loadLiqFeed, 300)
    return () => {
      if (typeof window.cancelIdleCallback === 'function' && typeof cb === 'number') {
        window.cancelIdleCallback(cb)
      } else {
        clearTimeout(cb)
      }
    }
  }, [loadLiqFeed])
  useAdaptivePolling(loadLiqFeed, { interval: 60_000 })

  // Fetch OI history for OI Chart tab — cached 60s, so re-entering the tab is free
  useEffect(() => {
    if (chartMode !== 'oichart') return
    let cancelled = false
    const sym = chartSymbol + 'USDT'
    getOIChartHistory(sym)
      .then(series => { if (!cancelled) setOIHistoryData(series) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [chartMode, chartSymbol])

  const fMatrix = useMemo(() => {
    if (!funding) return []
    const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'ARB', 'OP', 'NEAR', 'SUI', 'PEPE']
    return COINS.map(sym => ({
      symbol: sym, Spectre: funding[sym]?.Spectre ?? funding[sym]?._avg, Binance: funding[sym]?.Binance, Bybit: funding[sym]?.Bybit,
      OKX: funding[sym]?.OKX, avg: funding[sym]?._avg,
    })).filter(r => r.Spectre != null || r.Binance != null || r.Bybit != null || r.OKX != null)
  }, [funding])

  // ls is no longer in the slim intel bundle — derive a global average
  // from the per-symbol lsRatios state we already fetch via the live
  // tier. Keeps the header strip's "—" -> "1.07" experience identical.
  const ls = useMemo(() => {
    const rows = lsRatios?.global
    if (!Array.isArray(rows) || rows.length === 0) return null
    const vals = rows
      .map((r) => parseFloat(r?.longShortRatio))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (!vals.length) return null
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    return { ratio: avg }
  }, [lsRatios])
  const dom = intel.dominance
  const alt = intel.altSeasonIndex

  // Sorted asset list for left sidebar
  const sortedAssets = useMemo(() => {
    if (!oi?.coins) return []
    const coins = oi.coins
      .filter(c => !debouncedAssetSearch || c.symbol.toLowerCase().includes(debouncedAssetSearch.toLowerCase()))
    if (assetSort === 'oi') return coins.slice(0, 30)
    if (assetSort === 'hot') {
      return [...coins].sort((a, b) => {
        const aH = priceHistory?.[a.symbol]
        const bH = priceHistory?.[b.symbol]
        const aVol = aH?.length > 1 ? Math.abs(aH[aH.length - 1] - aH[0]) / (aH[0] || 1) : 0
        const bVol = bH?.length > 1 ? Math.abs(bH[bH.length - 1] - bH[0]) / (bH[0] || 1) : 0
        return bVol - aVol
      }).slice(0, 30)
    }
    if (assetSort === 'liq') {
      const bySymLiq = liqData?.bySymbol || {}
      return [...coins].sort((a, b) => {
        const aLiq = bySymLiq[a.symbol] ? (bySymLiq[a.symbol].long || 0) + (bySymLiq[a.symbol].short || 0) : 0
        const bLiq = bySymLiq[b.symbol] ? (bySymLiq[b.symbol].long || 0) + (bySymLiq[b.symbol].short || 0) : 0
        return bLiq - aLiq
      }).slice(0, 30)
    }
    return coins.slice(0, 30)
  }, [oi, debouncedAssetSearch, assetSort, priceHistory, liqData])

  const liqActive = useMemo(() => {
    if (!liqData?.windows?.[liqWindow]) return liqData
    const w = liqData.windows[liqWindow]
    return { ...liqData, totalLong: w.long, totalShort: w.short, total: w.total, bySymbol: w.bySymbol || liqData.bySymbol || {} }
  }, [liqData, liqWindow])
  const liqPctL = liqActive?.total > 0 ? (liqActive.totalLong / liqActive.total * 100) : 50

  const liqWindows = liqData?.windows || null

  // Stable token literal for the chart components — a fresh {symbol} object
  // each render would defeat their memoization on every unrelated tick.
  const chartToken = useMemo(() => ({ symbol: chartSymbol }), [chartSymbol])

  // ── Chart TA layer — the shared surface (same engine as the Research Zone) ──
  const tcChartRef = useRef(null)
  const tcTa = useChartTaSurface({ symbol: chartSymbol, chartRef: tcChartRef, dayMode })

  // ── AI Intelligence card: narrative + risk + conviction ──
  // String-building + an oi.coins linear scan; recompute only when the inputs
  // change, not on every funding/L-S/taker tick.
  const aiNarrative = useMemo(() => {
    if (!liqData) return null
    const regime = liqData.regime || 'NEUTRAL'
    const fundAvg = liqData.fundingAvg || 0
    const longs = liqActive?.totalLong || 0
    const shorts = liqActive?.totalShort || 0
    const total = liqActive?.total || 0
    const longPct = total > 0 ? Math.round(longs / total * 100) : 50
    const shortPct = 100 - longPct
    const flow = liqData.whaleFlow || 0
    const absFlow = Math.abs(flow)

    if (total <= 0) return 'Awaiting market data.'

    // Sentence 1: regime + liquidation skew
    const regimeWord = regime === 'BULL' ? 'bullish' : regime === 'BEAR' ? 'bearish' : 'neutral'
    let s1 = ''
    if (shortPct > 60) {
      s1 = `Strong ${regimeWord} bias with ${fmtK(total)} in ${liqWindow} liquidations, ${shortPct}% targeting shorts — classic squeeze setup.`
    } else if (longPct > 60) {
      s1 = `${longPct}% of ${fmtK(total)} in ${liqWindow} liquidations hit longs — overleveraged bulls getting flushed, watch for a reversal.`
    } else {
      s1 = `${fmtK(total)} liquidated over ${liqWindow} with a balanced ${longPct}/${shortPct} long/short split — no clear directional flush yet.`
    }

    // Sentence 2: whale flow + funding
    let s2 = ''
    if (absFlow > 100e6) {
      s2 = flow > 0
        ? `${fmtK(flow)} whale inflow confirms institutional accumulation.`
        : `${fmtK(absFlow)} whale outflow signals institutional distribution.`
    } else if (absFlow > 10e6) {
      s2 = flow > 0
        ? `Moderate whale inflow of ${fmtK(flow)} leans constructive.`
        : `Moderate whale outflow of ${fmtK(absFlow)} adds caution.`
    }

    if (fundAvg > 0.03) {
      s2 += (s2 ? ' ' : '') + `Funding elevated at +${fmt(fundAvg, 4)}% — longs paying premium, crowding risk.`
    } else if (fundAvg < -0.01) {
      s2 += (s2 ? ' ' : '') + `Negative funding at ${fmt(fundAvg, 4)}% — shorts paying premium, squeeze potential.`
    }

    // Sentence 3: actionable context
    let s3 = ''
    const btcPrice = oi?.coins?.find(c => c.symbol === 'BTC')?.price
    if (btcPrice) {
      const level = btcPrice > 1000 ? `$${fmtK(btcPrice)}` : fmtPrice(btcPrice)
      if (regime === 'BULL' && shortPct > 55) {
        s3 = `Watch for continuation above ${level}.`
      } else if (regime === 'BEAR' && longPct > 55) {
        s3 = `Key support near ${level} under pressure.`
      }
    }

    return [s1, s2, s3].filter(Boolean).join(' ')
  }, [liqData, liqActive, oi, liqWindow])

  const aiRisk = useMemo(() => {
    if (!liqData) return null
    const fundAvg = Math.abs(liqData.fundingAvg || 0)
    const total = liqActive?.total || 0
    if (fundAvg > 0.05 || total > 500e6) return 'HIGH'
    if (fundAvg > 0.02 || total > 100e6) return 'MEDIUM'
    return 'LOW'
  }, [liqData, liqActive])

  const aiConviction = useMemo(() => {
    if (!liqData) return null
    const fundAvg = Math.abs(liqData.fundingAvg || 0)
    const longs = liqActive?.totalLong || 0
    const shorts = liqActive?.totalShort || 0
    const total = liqActive?.total || 1
    const skew = Math.abs(longs - shorts) / total
    return Math.min(95, Math.round((skew * 60) + (Math.min(fundAvg, 0.1) * 350)))
  }, [liqData, liqActive])

  // ── Funding AI analysis (center column) ──
  const fundingAnalysis = useMemo(() => {
    if (!(fMatrix.length > 0 && lsRatios?.global?.length > 0)) return null
    const btcFunding = fMatrix.find(r => r.symbol === 'BTC')
    const btcAvg = btcFunding?.avg || 0
    const btcLS = lsRatios.global.find(g => g.symbol === 'BTC')
    const longPct = btcLS ? parseFloat(btcLS.longAccount) * 100 : 50
    const shortPct = 100 - longPct
    let analysis = ''
    let sc = ''
    if (btcAvg < -0.01 && shortPct > 55) {
      analysis = `Negative BTC funding (${fmt(btcAvg, 4)}%) with ${fmt(shortPct, 1)}% shorts signals overleveraged shorts — potential squeeze setup.`
      sc = 'up'
    } else if (btcAvg > 0.02 && longPct > 55) {
      analysis = `Positive BTC funding (+${fmt(btcAvg, 4)}%) with ${fmt(longPct, 1)}% longs signals overleveraged longs — correction risk.`
      sc = 'dn'
    } else {
      analysis = `BTC funding at ${btcAvg >= 0 ? '+' : ''}${fmt(btcAvg, 4)}% with ${fmt(longPct, 1)}% longs / ${fmt(shortPct, 1)}% shorts — balanced positioning, range-bound expected.`
    }
    return { analysis, sc }
  }, [fMatrix, lsRatios])

  // ── L/S market summary bar (right rail) ──
  const lsSummary = useMemo(() => {
    if (!(lsRatios?.global?.length > 0)) return null
    const allLongs = lsRatios.global.reduce((s, g) => s + parseFloat(g.longAccount || 0), 0)
    const avgLong = (allLongs / lsRatios.global.length) * 100
    const avgShort = 100 - avgLong
    const dominant = avgShort > avgLong ? 'Short' : 'Long'
    const dominantPct = Math.max(avgLong, avgShort)
    return { avgLong, avgShort, dominant, dominantPct }
  }, [lsRatios])

  // ── Taker buy-pressure summary ──
  const takerSummary = useMemo(() => {
    if (!(takerVol?.length > 0)) return null
    return takerVol.reduce((s, c) => s + c.buyRatio, 0) / takerVol.length * 100
  }, [takerVol])

  const TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H', '1D']
  const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']

  return (
    <div className={`tc${isMobile ? ' tc-mobile' : ''}`}>
      {/* ═══ HEADER BAR ═══ */}
      <header className="tc-header">
        <div className="tc-header-l">
          <h1 className="tc-h1">Traders Corner</h1>
          <div className="tc-header-meta">
            <div className="tc-exchanges">
              {['Binance', 'Bybit', 'OKX', 'Deribit'].map(ex => (
                <span key={ex} className="tc-exb" data-ex={ex.toLowerCase()}>{ex}</span>
              ))}
            </div>
            <TcFreshness updatedRef={lastUpdatedRef} />
          </div>
        </div>
        {/* Header-right strip removed - data already in stat cards below */}
      </header>

      {/* ═══ MOBILE ASSET STRIP ═══ */}
      {isMobile && (
        <div className="mtc-asset-strip">
          {oi?.coins?.slice(0, 15).map(c => (
            <button key={c.symbol} className={cx('mtc-asset-pill', chartSymbol === c.symbol && 'mtc-asset-pill--active')}
              onClick={() => setChartSymbol(c.symbol)}>
              <Tk s={c.symbol} sz={20} />
              <span className="mtc-asset-pill-sym">{c.symbol}</span>
              <span className="mtc-asset-pill-price">{fmtPrice(c.price)}</span>
            </button>
          ))}
        </div>
      )}

      {/* ═══ MAIN 3-COLUMN TERMINAL ═══ */}
      <div className="tc-terminal">

        {/* ─── LEFT SIDEBAR: Asset Intelligence Panel ─── */}
        <aside className="tc-left">
          <div className="tc-card tc-assets-card">
            <div className="tc-card-head-sm">
              <span className="tc-card-label">{t('tradersCorner.assets', 'Assets')}</span>
              <div className="tc-asset-sorts">
                {[['oi', 'By OI'], ['hot', 'Hot'], ['liq', 'Liq']].map(([k, label]) => (
                  <button key={k} className={cx('tc-sort-btn', assetSort === k && 'active')} onClick={() => setAssetSort(k)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="tc-search-wrap">
              <input
                className="tc-search"
                type="text"
                placeholder={t('tradersCorner.searchAssets', 'Search assets...')}
                value={assetSearch}
                onChange={e => setAssetSearch(e.target.value)}
              />
            </div>
            <div className="tc-asset-list">
              {sortedAssets.map((c, i) => {
                const bg = TOKEN_ROW_COLORS[c.symbol]?.bg
                const sparkColor = bg ? `rgb(${bg})` : '#f5f5f7'
                const fr = funding?.[c.symbol]?._avg
                const ph = priceHistory?.[c.symbol]
                const pchg = ph?.length > 1 ? ((ph[ph.length - 1] - ph[0]) / (ph[0] || 1) * 100) : null
                return (
                  <button key={c.symbol} className={cx('tc-asset', chartSymbol === c.symbol && 'active')}
                    onClick={() => setChartSymbol(c.symbol)} style={{ '--ri': i }}>
                    <div className="tc-asset-left">
                      <Tk s={c.symbol} sz={20} />
                      <div className="tc-asset-info">
                        <div className="tc-asset-name-row">
                          <span className="tc-asset-sym">{c.symbol}</span>
                          {fr != null && <span className={cx('tc-fr-dot', fr >= 0 ? 'pos' : 'neg')} title={`Funding: ${fr >= 0 ? '+' : ''}${fr.toFixed(4)}%`} />}
                        </div>
                        <span className="tc-asset-oi">{fmtK(c.oiUsd)} OI</span>
                      </div>
                    </div>
                    <div className="tc-asset-right">
                      <div className="tc-asset-price-row">
                        <span className="tc-asset-price">{fmtPrice(c.price)}</span>
                        {pchg != null && (
                          <span className={cx('tc-asset-chg', pchg >= 0 ? 'up' : 'dn')}>
                            {pchg >= 0 ? '+' : ''}{pchg.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      {ph && <Spark data={ph} color={sparkColor} w={44} h={16} />}
                    </div>
                  </button>
                )
              })}
            </div>
            {/* Mini Market Summary */}
            <div className="tc-mkt-summary">
              <div className="tc-mkt-row">
                <span className="tc-mkt-k">{t('tradersCorner.totalMarketOI', 'Total Market OI')}</span>
                <span className="tc-mkt-v">{fmtK(liqData?.totalMarketOI || oi?.total)}</span>
              </div>
              <div className="tc-mkt-row">
                <span className="tc-mkt-k">{t('tradersCorner.liquidations24h', '24h Liquidations')}</span>
                <span className="tc-mkt-v">{fmtK(liqData?.windows?.['24h']?.total)}</span>
              </div>
              <div className="tc-mkt-row">
                <span className="tc-mkt-k">{t('tradersCorner.btcDominance', 'BTC Dominance')}</span>
                <span className="tc-mkt-v">{dom?.btc ? fmt(dom.btc, 1) + '%' : '---'}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* ─── CENTER: Data strip + Chart + Data panels ─── */}
        <main className="tc-center">
          {/* ═══ DATA STRIP — CoinGlass-style hero cards + rekt grid ═══ */}
          {/* ── Row 1: Two hero cards (OI + Liquidation) ── */}
          <div className="tc-hero-row">
            <div className="tc-hero-card">
              <div className="tc-hero-top">
                <span className="tc-hero-label">Open Interest</span>
                {/* A delta is a claim about change over time. When the series is
                    the flat placeholder there IS no time in it, and printing
                    "+0.00%" states something false rather than nothing. */}
                {oiHistory?.length > 1 && !isSyntheticSeries(oiHistory) && (() => {
                  const first = oiHistory[0]?.oiValue || oiHistory[0]?.total || oiHistory[0]
                  const last = oiHistory[oiHistory.length - 1]?.oiValue || oiHistory[oiHistory.length - 1]?.total || oiHistory[oiHistory.length - 1]
                  if (!(first > 0) || !(last > 0)) return null
                  const pct = ((last - first) / first) * 100
                  return <span className={cx('tc-hero-change', pct >= 0 ? 'up' : 'dn')}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}% <i className="tc-hero-win">48h</i></span>
                })()}
              </div>
              <div className="tc-hero-body">
                <span className="tc-hero-val">{fmtK(liqData?.totalMarketOI || oi?.total)}</span>
                {liqData?.totalMarketOI && oi?.total ? (
                  <span className="tc-hero-sub">Agg: {fmtK(oi.total)}</span>
                ) : null}
                {oiHistory?.length > 1 && !isSyntheticSeries(oiHistory) && <Spark data={oiHistory.map(d => d.oiValue || d.total || d)} color="#34d399" w={100} h={32} />}
              </div>
            </div>

            <div className="tc-hero-card">
              <div className="tc-hero-top">
                <span className="tc-hero-label">Liquidation</span>
                {liqData?.connected && <span className="tc-ws-dot" title="WebSocket connected" />}
              </div>
              <div className="tc-hero-body">
                <span className="tc-hero-main">
                  <span className="tc-hero-val">{fmtK(liqActive?.total)}</span>
                  <IButton size="sm" metricType="liquidation" metricValue={fmtK(liqActive?.total)} metricLabel={`${liqWindow} Liquidations`} />
                </span>
                {liqWindows && <Spark data={['1h','4h','12h','24h'].map(w => liqWindows[w]?.total || 0)} color="#34d399" w={100} h={32} />}
              </div>
            </div>
          </div>

          {/* ── Row 2: Rekt grid (1h/4h/12h/24h) ── */}
          <div className="tc-rekt-row">
            {['1h', '4h', '12h', '24h'].map(w => {
              const wd = liqWindows?.[w]
              return (
                <button key={w} className={cx('tc-rekt-card', liqWindow === w && 'active')} onClick={() => setLiqWindow(w)}>
                  <div className="tc-rekt-head">
                    <span className="tc-rekt-tf">{w} Rekt</span>
                    <span className="tc-rekt-total">{fmtK(wd?.total || 0)}</span>
                  </div>
                  <div className="tc-rekt-splits">
                    <div className="tc-rekt-split">
                      <span className="tc-rekt-side">Long</span>
                      <span className="tc-rekt-amt dn">{fmtK(wd?.long || 0)}</span>
                    </div>
                    <div className="tc-rekt-split">
                      <span className="tc-rekt-side">Short</span>
                      <span className="tc-rekt-amt up">{fmtK(wd?.short || 0)}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* ── AI Intelligence Card ── */}
          {liqData && (
            <div className={cx('tc-ai-intel', liqData.regime === 'BULL' ? 'tc-ai-intel--bull' : liqData.regime === 'BEAR' ? 'tc-ai-intel--bear' : '')}>
              <div className="tc-ai-intel-header">
                <span className="tc-ai-dot" />
                <span>Intelligence</span>
                <span className="tc-ai-badge">{(liqData.regime || 'NEUTRAL').replace('_', ' ')}</span>
              </div>
              <p className="tc-ai-text">{aiNarrative}</p>
              <div className="tc-ai-meta">
                <span>Risk: {aiRisk}</span>
                <span>Conviction: {aiConviction}%</span>
              </div>
            </div>
          )}

          {/* ── Row 3: Index + Options + Macro strip ── */}
          <div className="tc-data-strip">
            <div className="tc-strip-group">
              <span className="tc-strip-label">BTC.D</span>
              <span className="tc-strip-val">{dom?.btc ? fmt(dom.btc, 1) + '%' : '—'}</span>
              {dom?.btc && <IButton size="sm" metricType="btc-dominance" metricValue={`${fmt(dom.btc, 1)}%`} metricLabel="BTC Dominance" />}
            </div>
            <div className="tc-strip-group">
              <span className="tc-strip-label">ETH.D</span>
              <span className="tc-strip-val">{dom?.eth ? fmt(dom.eth, 1) + '%' : '—'}</span>
            </div>
            <div className="tc-strip-group">
              <span className="tc-strip-label">Alt Season</span>
              <span className={cx('tc-strip-val', alt?.value >= 75 ? 'up' : alt?.value < 25 ? 'dn' : '')}>{alt?.value != null ? Math.round(alt.value) + '/100' : '—'}</span>
            </div>
            <div className="tc-strip-group">
              <span className="tc-strip-label">L/S</span>
              <span className={cx('tc-strip-val', ls?.ratio > 1.1 ? 'up' : ls?.ratio < 0.9 ? 'dn' : '')}>{ls?.ratio?.toFixed(2) || '—'}</span>
            </div>
            <div className="tc-strip-group">
              <span className="tc-strip-label">Funding</span>
              <span className={cx('tc-strip-val', liqData?.fundingAvg > 0.02 ? 'dn' : liqData?.fundingAvg < -0.01 ? 'up' : '')}>{liqData?.fundingAvg != null ? (liqData.fundingAvg >= 0 ? '+' : '') + fmt(liqData.fundingAvg, 4) + '%' : '—'}</span>
            </div>
            <div className="tc-strip-group">
              <span className="tc-strip-label">P/C Ratio</span>
              <span className={cx('tc-strip-val', options?.putCallRatio > 1 ? 'dn' : '')}>{options?.putCallRatio ? fmt(options.putCallRatio, 2) : '—'}</span>
            </div>
            <div className="tc-strip-group">
              <span className="tc-strip-label">Max Pain</span>
              <span className="tc-strip-val">{options?.maxPain ? fmtK(options.maxPain) : '—'}</span>
            </div>
            <div className="tc-strip-group">
              <span className="tc-strip-label">IV</span>
              <span className="tc-strip-val">{options?.currentIV != null ? fmt(options.currentIV, 1) + '%' : '—'}</span>
            </div>
            <span className={cx('tc-rekt-meta-pill', alt?.value < 25 ? 'btc' : alt?.value >= 75 ? 'alt' : 'neutral')}>
              {alt?.value < 25 ? 'BTC Season' : alt?.value >= 75 ? 'Alt Season' : 'Neutral'}
            </span>
          </div>

          {/* ═══ CHART ═══ */}
          <div className="tc-card tc-chart-card">
            <div className="tc-chart-bar">
              <div className="tc-chart-symbols">
                {SYMBOLS.map(s => (
                  <button key={s} className={cx('tc-sym-btn', chartSymbol === s && 'active')} onClick={() => setChartSymbol(s)}>
                    <Tk s={s} sz={18} /><span className="tc-sym-label">{s}</span>
                  </button>
                ))}
              </div>
              {/* Compact symbol dropdown — replaces the pill row on narrow screens */}
              <ChartSymbolDropdown value={chartSymbol} onChange={setChartSymbol} symbols={SYMBOLS} />
              <div className="tc-chart-mode">
                <button className={cx('tc-mode-btn', chartMode === 'chart' && 'active')} onClick={() => setChartMode('chart')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 6-6"/></svg>
                  Chart
                </button>
                <button className={cx('tc-mode-btn', chartMode === 'spectre' && 'active')} onClick={() => setChartMode('spectre')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><rect x="6" y="7" width="3" height="10" rx="0.5"/><rect x="10.5" y="4" width="3" height="13" rx="0.5"/><rect x="15" y="9" width="3" height="8" rx="0.5"/></svg>
                  Spectre
                </button>
                <button className={cx('tc-mode-btn', chartMode === 'tv' && 'active')} onClick={() => setChartMode('tv')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 12l4-6 4 3 6-5"/><circle cx="21" cy="4" r="1.5" fill="currentColor"/></svg>
                  TradingView
                </button>
                <button className={cx('tc-mode-btn', chartMode === 'liqmap' && 'active')} onClick={() => setChartMode('liqmap')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><rect x="7" y="8" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.3"/><rect x="11" y="5" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.6"/><rect x="15" y="10" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.9"/><rect x="7" y="13" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.5"/><rect x="11" y="10" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.7"/></svg>
                  Liq Map
                </button>
                <button className={cx('tc-mode-btn', chartMode === 'oichart' && 'active')} onClick={() => setChartMode('oichart')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 17 C9 14, 11 10, 13 11 S17 8, 21 6" /><path d="M7 17 C9 14, 11 10, 13 11 S17 8, 21 6 V18 H7 Z" fill="currentColor" opacity="0.15"/></svg>
                  OI Chart
                </button>
              </div>
              {/* Compact dropdown — replaces the mode button row on narrow screens */}
              <ChartModeDropdown value={chartMode} onChange={setChartMode} />
              {chartMode === 'chart' && (
                <>
                  <div className="tc-chart-types">
                    <button className={cx('tc-type-btn', chartType === 'candle' && 'active')} onClick={() => setChartType('candle')} aria-label={t('tradersCorner.chartCandle', 'Candlestick')}>
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="4" y1="2" x2="4" y2="14" /><rect x="2" y="5" width="4" height="5" rx="0.5" fill="currentColor" stroke="none" />
                        <line x1="12" y1="3" x2="12" y2="13" /><rect x="10" y="6" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
                      </svg>
                    </button>
                    <button className={cx('tc-type-btn', chartType === 'line' && 'active')} onClick={() => setChartType('line')} aria-label={t('tradersCorner.chartLine', 'Line')}>
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1,12 5,7 9,9 15,3" />
                      </svg>
                    </button>
                    <button className={cx('tc-type-btn', chartType === 'area' && 'active')} onClick={() => setChartType('area')} aria-label={t('tradersCorner.chartArea', 'Area')}>
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1,12 L5,7 L9,9 L15,3 L15,14 L1,14 Z" fill="currentColor" opacity="0.2" />
                        <polyline points="1,12 5,7 9,9 15,3" stroke="currentColor" strokeWidth="1.5" fill="none" />
                      </svg>
                    </button>
                  </div>
                  <div className="tc-chart-tfs">
                    {TIMEFRAMES.map(tf => (
                      <button key={tf} className={cx('tc-tf-btn', chartTf === tf && 'active')} onClick={() => setChartTf(tf)}>{tf}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="tc-chart-wrap">
              {chartMode === 'chart' ? (
                <SpectreChart token={chartToken} timeframe={chartTf} chartType={chartType} dayMode={dayMode} height={420} showToolbar={false} />
              ) : chartMode === 'spectre' ? (
                <Suspense fallback={<div className="tc-chart-loading" style={{ height: 420 }}><Shim h={420} /></div>}>
                  <TradingChart
                    ref={tcChartRef}
                    token={chartToken}
                    dayMode={dayMode}
                    embedHeight={420}
                    embedMode
                    extraToolButtons={tcTa.toolButtons}
                    {...tcTa.chartProps}
                  />
                </Suspense>
              ) : chartMode === 'tv' ? (
                <Suspense fallback={<div className="tc-chart-loading" style={{ height: 420 }}><Shim h={420} /></div>}>
                  <TradingViewAdvanced symbol={chartSymbol} timeframe={chartTf || '1H'} dayMode={dayMode} height={420} />
                </Suspense>
              ) : chartMode === 'oichart' ? (
                <OIChartCanvas data={oiHistoryData} symbol={chartSymbol} height={420} dayMode={dayMode} />
              ) : chartMode === 'liqmap' ? (
                // The SAME heatmap as /liquidation-heatmap and the Command
                // Center's Liquidation tab. It fetches its own series, so it
                // no longer depends on `extHeatmapData` landing first — which
                // is what used to drop this panel onto LiqMapCanvas, the crude
                // OHLC-only synthesizer that drew a blurred band across a fixed
                // ±12% window (blob stopped ~55% across, price axis narrower
                // than the candles beside it).
                <Suspense fallback={<div className="tc-chart-loading" style={{ height: 420 }}><Shim h={420} /></div>}>
                  <LiqHeatmapPanel
                    symbol={`${chartSymbol}USDT`}
                    enabled
                    dayMode={dayMode}
                    fmtPrice={fmtPrice}
                    height={420}
                    note={null}
                  />
                </Suspense>
              ) : null}
            {chartMode === 'spectre' && <ChartTaSurface ta={tcTa} />}
            </div>
          </div>

          {/* ═══ HEATMAP + FUNDING — 2 columns below chart ═══ */}
          <div className="tc-bottom-panels">
            {/* Liquidation Heatmap */}
            <div className="tc-card">
              <div className="tc-card-head">
                <div>
                  <h3 className="tc-card-title">Liquidation Heatmap</h3>
                  <span className="tc-card-sub">Open Interest distribution · color = long/short dominance</span>
                </div>
                {liqData?.regime && <span className="tc-badge-sm">{liqData.regime}</span>}
              </div>
              <LiqTreemap oi={oi} liqData={liqActive} />
              {liqActive && liqActive.total > 0 && (
                <div className="tc-liq-footer">
                  <div className="tc-liq-footer-stat">
                    <span className="tc-liq-footer-k">Total ({liqWindow})</span>
                    <span className="tc-liq-footer-v">{fmtK(liqActive.total)}</span>
                  </div>
                  <div className="tc-liq-footer-bar">
                    <div className="tc-liq-bar-l" style={{ width: `${liqPctL}%` }} />
                    <div className="tc-liq-bar-s" style={{ width: `${100 - liqPctL}%` }} />
                  </div>
                  <div className="tc-liq-footer-stat dn">
                    <span className="tc-liq-footer-k">Longs</span>
                    <span className="tc-liq-footer-v">{fmtK(liqActive.totalLong)}</span>
                  </div>
                  <div className="tc-liq-footer-stat up">
                    <span className="tc-liq-footer-k">Shorts</span>
                    <span className="tc-liq-footer-v">{fmtK(liqActive.totalShort)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Funding Rates */}
            <div className="tc-card">
              <div className="tc-card-head">
                <div>
                  <h3 className="tc-card-title">Funding Rates</h3>
                  <span className="tc-card-sub">8h · color = magnitude</span>
                </div>
              </div>
              {fundingHistory?.length > 0 && !isSyntheticSeries(fundingHistory) && <FundingBars data={fundingHistory.slice(-56)} />}
              <div className="tc-scroll">
                <table className="tc-tbl">
                  <thead><tr>
                    <th className="tc-al">Asset</th>
                    <th>Spectre</th>
                    <th>Binance</th>
                    <th>Bybit</th>
                    <th>Avg</th>
                    <th>Signal</th>
                  </tr></thead>
                  <tbody>
                    {!fMatrix.length && <tr><td colSpan={6}><Shim /></td></tr>}
                    {fMatrix.slice(0, 10).map((r, ri) => {
                      const avg = r.avg || 0
                      const sig = avg > 0.05 ? 'Crowded' : avg < -0.03 ? 'Shorts Pay' : avg > 0.02 ? 'L Bias' : avg < -0.01 ? 'S Bias' : 'Neutral'
                      const sc = avg > 0.03 ? 'dn' : avg < -0.02 ? 'up' : ''
                      return (
                        <tr key={r.symbol} style={{ '--ri': ri }}>
                          <td className="tc-al"><Tk s={r.symbol} sz={14} /><span className="tc-sym">{r.symbol}</span></td>
                          <FC v={r.Spectre} bold />
                          <FC v={r.Binance} />
                          <FC v={r.Bybit} />
                          <FC v={r.avg} bold />
                          <td><span className={cx('tc-sig', sc)}>{sig}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Funding AI Analysis */}
              {fundingAnalysis && (
                <div className={cx('tc-ai-funding', fundingAnalysis.sc)}>
                  <span className="tc-ai-dot" />
                  <span className="tc-ai-funding-text">{fundingAnalysis.analysis}</span>
                </div>
              )}
            </div>

          </div>

          {/* News Feed - full width below both liq heatmap & funding */}
          {news?.length > 0 && (
            <div className="tc-card tc-news-card tc-news-wide">
              <div className="tc-card-head-sm">
                <span className="tc-card-label">News</span>
              </div>
              <div className="tc-news-grid">
                {news.slice(0, 10).map(item => (
                  <a key={item.id || item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="tc-news-item">
                    <span className="tc-news-title">{item.title}</span>
                    <div className="tc-news-meta">
                      <span className="tc-news-source">{item.source}</span>
                      <span className="tc-news-time">{formatNewsTime(item.publishedOn)}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* ─── RIGHT SIDEBAR: Derivatives Dashboard ─── */}
        <aside className="tc-right">
          {/* Long/Short Ratio */}
          <div className="tc-card">
            <div className="tc-card-head">
              <div>
                <h3 className="tc-card-title">Long/Short Ratio</h3>
                <span className="tc-card-sub">Account positioning · cross-exchange</span>
              </div>
            </div>
            {/* Market L/S summary bar */}
            {lsSummary && (
              <div className="tc-ls-summary">
                <span className={cx('tc-ls-summary-label', lsSummary.dominant === 'Short' ? 'dn' : 'up')}>
                  Market: {fmt(lsSummary.dominantPct, 1)}% {lsSummary.dominant}
                </span>
                <div className="tc-ls-summary-bar">
                  <div className="tc-ls-bar-long" style={{ width: `${lsSummary.avgLong}%` }} />
                  <div className="tc-ls-bar-short" style={{ width: `${lsSummary.avgShort}%` }} />
                </div>
              </div>
            )}
            <div className="tc-scroll tc-scroll-sm">
              <table className="tc-tbl tc-tbl-dense">
                <thead><tr>
                  <th className="tc-al">Asset</th>
                  <th>L/S</th>
                  <th>Long%</th>
                  <th>Signal</th>
                </tr></thead>
                <tbody>
                  {!lsRatios && <tr><td colSpan={4}><Shim /></td></tr>}
                  {lsRatios?.global?.slice(0, 10).map((g, ri) => {
                    const tt = lsRatios.topTrader?.find(t => t.symbol === g.symbol)
                    const gR = parseFloat(g.longShortRatio)
                    const ttR = tt ? parseFloat(tt.longShortRatio) : null
                    const longs = parseFloat(g.longAccount) * 100
                    const shorts = 100 - longs
                    // The Spectre feed carries account-level global positioning
                    // only (no top-trader cohort), so read the signal off the
                    // global ratio when `tt` is absent instead of flatlining
                    // every row to "Mixed".
                    const sig = gR > 1.3 && (ttR == null || ttR > 1.3) ? 'Bearish'
                      : gR < 0.8 && (ttR == null || ttR < 0.8) ? 'Bullish' : 'Mixed'
                    const sc = sig === 'Bearish' ? 'dn' : sig === 'Bullish' ? 'up' : ''
                    return (
                      <tr key={g.symbol} style={{ '--ri': ri }}>
                        <td className="tc-al"><Tk s={g.symbol} sz={13} /><span className="tc-sym-sm">{g.symbol}</span></td>
                        <td className="tc-mono-cell">{gR.toFixed(2)}</td>
                        <td>
                          <div className="tc-ls-dual-bar">
                            <div className="tc-ls-dual-long" style={{ width: `${longs}%` }} />
                            <div className="tc-ls-dual-short" style={{ width: `${shorts}%` }} />
                            <span className="tc-ls-dual-val">{fmt(longs, 0)}%</span>
                          </div>
                        </td>
                        <td><span className={cx('tc-sig-sm', sc)}>{sig}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* CME institutional positioning — CFTC Commitment of Traders.
              The only feed on this page that shows REGULATED institutions
              rather than the offshore perp crowd, and it is the other side of
              the L/S table directly above it. Weekly, so it is dated openly. */}
          {cot?.length > 0 && (
            <div className="tc-card">
              <div className="tc-card-head-sm">
                <span className="tc-card-label">CME Positioning</span>
                <span className="tc-cot-asof">
                  CFTC · wk {new Date(cot[0].ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div className="tc-cot-list">
                {cot.slice(0, 2).map((c) => {
                  const netUp = c.net >= 0
                  const dUp = c.delta != null && c.delta >= 0
                  const total = c.longs + c.shorts
                  const longPct = total > 0 ? (c.longs / total) * 100 : 50
                  return (
                    <div className="tc-cot" key={c.asset}>
                      <div className="tc-cot-top">
                        <span className="tc-cot-id"><Tk s={c.asset} sz={14} /><b>{c.asset}</b><i title={`CME ${c.market}`}>{c.market}</i></span>
                        <span className={cx('tc-cot-net', netUp ? 'up' : 'dn')}>
                          {netUp ? '+' : '−'}{Math.abs(c.net).toLocaleString('en-US')}
                          <i>net {netUp ? 'long' : 'short'}</i>
                        </span>
                      </div>
                      <div className="tc-cot-spark">
                        <svg viewBox={`0 0 100 26`} preserveAspectRatio="none" aria-hidden>
                          <line x1="0" y1="13" x2="100" y2="13" className="tc-cot-zero" />
                          <polyline
                            className={cx('tc-cot-line', netUp ? 'up' : 'dn')}
                            fill="none"
                            vectorEffect="non-scaling-stroke"
                            points={c.series.map((pt, i) => {
                              const x = c.series.length > 1 ? (i / (c.series.length - 1)) * 100 : 50
                              const y = 13 - (pt.net / c.span) * 12
                              return `${x.toFixed(1)},${y.toFixed(1)}`
                            }).join(' ')}
                          />
                        </svg>
                      </div>
                      <div className="tc-cot-bar" title={`${c.longs.toLocaleString('en-US')} long · ${c.shorts.toLocaleString('en-US')} short`}>
                        <span className="tc-cot-bar-l" style={{ width: `${longPct}%` }} />
                        <span className="tc-cot-bar-s" style={{ width: `${100 - longPct}%` }} />
                      </div>
                      <div className="tc-cot-foot">
                        <span className={cx('tc-cot-d', dUp ? 'up' : 'dn')}>
                          {c.delta == null ? '—' : `${dUp ? '+' : '−'}${Math.abs(c.delta).toLocaleString('en-US')} wk`}
                        </span>
                        <span className="tc-cot-meta">
                          {c.flipped
                            ? `flipped net ${netUp ? 'long' : 'short'}`
                            : c.netShareOfOi != null
                              ? `${Math.abs(c.netShareOfOi).toFixed(0)}% of OI`
                              : `${c.traders} traders`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="tc-cot-note">Speculator net position, {cot[0].weeks}-week history</div>
            </div>
          )}

          {/* Taker Buy Pressure */}
          {takerVol?.length > 0 && (
            <div className="tc-card">
              <div className="tc-card-head-sm">
                <span className="tc-card-label">Taker Pressure</span>
                {takerSummary != null && (
                  <span className={cx('tc-taker-summary', takerSummary > 52 ? 'up' : takerSummary < 48 ? 'dn' : '')}>
                    {takerSummary > 52 ? 'Buy pressure' : takerSummary < 48 ? 'Sell pressure' : 'Neutral'} {fmt(takerSummary, 1)}%
                  </span>
                )}
              </div>
              <div className="tc-taker-list">
                {takerVol.slice(0, 8).map(c => {
                  const bp = (c.buyRatio * 100)
                  return (
                    <div key={c.symbol} className="tc-tkr">
                      <Tk s={c.symbol} sz={13} />
                      <span className="tc-sym-sm">{c.symbol}</span>
                      <div className="tc-tkr-track">
                        <div className="tc-tkr-fill" style={{ width: `${bp}%` }} />
                      </div>
                      <span className={cx('tc-tkr-v', bp > 52 ? 'up' : bp < 48 ? 'dn' : '')}>{fmt(bp, 1)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Open Interest Rankings */}
          <div className="tc-card tc-oi-card">
            <div className="tc-card-head-sm">
              <span className="tc-card-label">Open Interest</span>
              <span className="tc-card-label-sub">{fmtK(oi?.total)}</span>
            </div>
            <div className="tc-oi-list">
              {oi?.coins?.slice(0, 10).map((c, i) => {
                const pct = oi.total > 0 ? (c.oiUsd / oi.total * 100) : 0
                const rgb = TOKEN_ROW_COLORS[c.symbol]?.bg || '255,255,255'
                const ph = priceHistory?.[c.symbol]
                const oiChg = ph?.length > 1 ? ((ph[ph.length - 1] - ph[0]) / (ph[0] || 1) * 100) : null
                return (
                  <div key={c.symbol} className="tc-oi-row" style={{ '--ri': i }}>
                    <div className="tc-oi-row-l">
                      <Tk s={c.symbol} sz={14} />
                      <span className="tc-oi-sym">{c.symbol}</span>
                    </div>
                    <div className="tc-oi-bar-wrap">
                      <div className="tc-oi-bar-fill" style={{ width: `${Math.min(100, pct * 2.5)}%`, background: `rgba(${rgb},0.3)` }} />
                    </div>
                    <span className="tc-oi-val">{fmtK(c.oiUsd)}</span>
                    <span className="tc-oi-pct">{fmt(pct, 1)}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Futures Basis + Carry Signal */}
          {basisData?.length > 0 && (
            <div className="tc-card tc-basis-card">
              <div className="tc-card-head-sm">
                <span className="tc-card-label">Futures Basis</span>
              </div>
              <div className="tc-basis-list">
                {basisData.slice(0, 6).map(c => {
                  const ann = c.annualized || 0
                  const carry = ann > 5 ? 'Contango' : ann < -5 ? 'Backwardation' : 'Neutral'
                  const carryCls = ann > 5 ? 'up' : ann < -5 ? 'dn' : ''
                  return (
                    <div key={c.symbol} className="tc-basis-row">
                      <div className="tc-basis-left">
                        <Tk s={c.symbol} sz={13} />
                        <span className="tc-basis-sym">{c.symbol}</span>
                      </div>
                      <span className={cx('tc-basis-v', c.basis > 0 ? 'up' : 'dn')}>
                        {c.basis > 0 ? '+' : ''}{fmt(c.basis, 4)}%
                      </span>
                      <span className={cx('tc-basis-ann', c.annualized > 0 ? 'up' : 'dn')}>
                        {fmt(c.annualized, 1)}% ann
                      </span>
                      <span className={cx('tc-carry-sig', carryCls)}>{carry}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Liquidation Feed */}
          <div className="tc-card tc-liqfeed-card">
            <div className="tc-card-head-sm">
              <span className="tc-card-label">Liquidation Feed</span>
              <span className="tc-liqfeed-live"><span className="tc-dot" />Live</span>
            </div>
            <div className="tc-liqfeed-list">
              {liqFeed.length === 0 && <div className="tc-liqfeed-empty">Awaiting liquidation events...</div>}
              {liqFeed.slice(0, 20).map((ev, i) => {
                // The Spectre tape names the liquidated side directly. Exchange
                // feeds instead give the CLOSING ORDER side, where a SELL closes
                // (i.e. liquidates) a LONG — the old `=== 'Buy'` test had that
                // backwards and rendered every exchange event as SHORT.
                const evSide = String(ev.side || '').toUpperCase()
                const isLong = evSide === 'LONG' || evSide === 'SELL'
                const ago = ev.time ? formatNewsTime(ev.time) : ''
                return (
                  <div key={i} className={cx('tc-liqfeed-row', isLong ? 'liq-long' : 'liq-short')} style={{ '--ri': i }}>
                    <span className="tc-liqfeed-time">{ago}</span>
                    <span className="tc-liqfeed-sym">{ev.symbol || '---'}</span>
                    <span className={cx('tc-liqfeed-side', isLong ? 'dn' : 'up')}>{isLong ? 'LONG' : 'SHORT'}</span>
                    <span className="tc-liqfeed-amt">{fmtK(ev.amount || ev.usdValue || 0)}</span>
                    <span className="tc-liqfeed-ex">{ev.exchange || ''}</span>
                  </div>
                )
              })}
            </div>
          </div>

        </aside>
      </div>

      <footer className="tc-foot">
        Binance Futures · Bybit · OKX · Deribit — Auto-refresh 15s{liqData?.connected ? ' · WS Live' : ''}
      </footer>
    </div>
  )
}
