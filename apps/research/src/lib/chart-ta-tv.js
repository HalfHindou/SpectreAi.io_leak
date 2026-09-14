/**
 * chart-ta-tv.js — the TA layer on the TradingView Advanced chart.
 *
 * The canvas chart paints its own overlay (chart-ta-overlay.js). TradingView
 * owns its surface, so here we speak its API instead: the same data-space
 * drawings become real TV shapes, and the highlight gesture is TV's own
 * rectangle tool — the interaction a TV user already knows.
 *
 * Same shape contract as the canvas layer, so one set of drawings renders on
 * either engine and neither one gets a private format:
 *   { tool: 'hline'|'trendline'|'ray'|'rect', style, label, bias, price|a|b }
 *
 * TV times are UNIX SECONDS. Our drawings carry milliseconds. Every crossing
 * of that boundary is converted here and nowhere else.
 */

const INK = {
  resistance: '#EF4444',
  support: '#10B981',
  neckline: '#F59E0B',
  trend: '#9CA3AF',
  target: '#10B981',
  invalidation: '#EF4444',
  ai: '#06B6D4',
  user: '#E5E7EB',
}

const INK_DAY = {
  resistance: '#DC2626',
  support: '#059669',
  neckline: '#D97706',
  trend: '#64748B',
  target: '#059669',
  invalidation: '#DC2626',
  ai: '#0891B2',
  user: '#0F172A',
}

// linestyle: 0 solid, 1 dotted, 2 dashed
const DASHED = new Set(['neckline', 'target', 'invalidation'])

function inkFor(d, dayMode) {
  const table = dayMode ? INK_DAY : INK
  if (d.style && table[d.style]) return table[d.style]
  if (d.bias === 'bullish') return table.support
  if (d.bias === 'bearish') return table.resistance
  return table.trend
}

function compactPrice(v) {
  if (!Number.isFinite(v)) return ''
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (a >= 1000) return Math.round(v).toLocaleString('en-US')
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.01) return v.toFixed(4)
  return v.toPrecision(3)
}

function labelFor(d, price) {
  const role = d.label ? String(d.label).slice(0, 14) : ''
  const px = compactPrice(price)
  if (px && role) return `${px} · ${role}`
  return px || role
}

const toSec = (ms) => Math.round(Number(ms) / 1000)

/** Remove every shape this module created. Safe to call when TV is mid-reload. */
export function clearTaTvEntities(chart, idsRef) {
  if (!chart || !idsRef?.current?.length) return
  for (const id of idsRef.current) {
    try { chart.removeEntity(id) } catch { /* already gone with the widget */ }
  }
  idsRef.current = []
}

/**
 * Paint the TA drawings as TV shapes.
 * Mirrors drawTaOverlay's visual grammar: matched geometry sits back, the
 * agent's own (and confirmed) levels read a step stronger.
 */
export function drawTaOnTvChart(chart, drawings, { dayMode = false } = {}, idsRef) {
  if (!chart || !idsRef) return
  clearTaTvEntities(chart, idsRef)
  if (!Array.isArray(drawings) || !drawings.length) return

  const ids = []
  // TV needs a time span for multipoint shapes; a drawing may sit outside the
  // current view, so fall back to a padded visible range rather than dropping it.
  let vFrom = null, vTo = null
  try {
    const r = chart.getVisibleRange()
    vFrom = r.from
    vTo = r.to
  } catch { /* not ready */ }

  for (const d of drawings) {
    if (!d) continue
    const ink = inkFor(d, dayMode)
    const strong = d.source !== 'pattern' || d.confirmed
    const linewidth = strong ? 2 : 1
    const linestyle = DASHED.has(d.style) ? 2 : 0
    const base = { lock: true, disableSelection: true, disableSave: true, disableUndo: true, zOrder: 'top' }

    try {
      if (d.tool === 'hline' && Number.isFinite(d.price)) {
        const id = chart.createShape({ price: d.price }, {
          shape: 'horizontal_line',
          ...base,
          overrides: {
            linecolor: ink, linewidth, linestyle,
            showLabel: true, textcolor: ink, fontsize: 11,
            text: labelFor(d, d.price),
          },
        })
        if (id) ids.push(id)
      } else if ((d.tool === 'trendline' || d.tool === 'ray') && d.a && d.b) {
        const t1 = toSec(d.a.ts)
        const t2 = toSec(d.b.ts)
        if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue
        const id = chart.createMultipointShape(
          [{ time: t1, price: d.a.price }, { time: t2, price: d.b.price }],
          {
            shape: d.tool === 'ray' ? 'ray' : 'trend_line',
            ...base,
            overrides: {
              linecolor: ink, linewidth, linestyle,
              showLabel: !!d.label, textcolor: ink, fontsize: 11,
              text: d.label ? labelFor(d, d.b.price) : '',
              extendLeft: false, extendRight: false,
            },
          },
        )
        if (id) ids.push(id)
      } else if (d.tool === 'rect' && d.a && d.b) {
        const t1 = toSec(d.a.ts)
        const t2 = toSec(d.b.ts)
        if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue
        const id = chart.createMultipointShape(
          [{ time: t1, price: d.a.price }, { time: t2, price: d.b.price }],
          {
            shape: 'rectangle',
            ...base,
            overrides: { color: ink, linecolor: ink, linewidth: 1, backgroundColor: ink, transparency: 92 },
          },
        )
        if (id) ids.push(id)
      }
    } catch { /* TV rejects shapes while a resolution switch is in flight */ }
  }
  idsRef.current = ids
  // Keep the fallback range referenced so a future change can pad with it.
  void vFrom; void vTo
}

/**
 * Highlight-to-analyse on TV: arm TV's own rectangle tool, then read the shape
 * the user drew and hand back the window in OUR units (ms + price).
 *
 * Returns a disposer. Calling it disarms the tool and removes the marquee.
 */
/**
 * Page-space rect of TradingView's PRICE PANE (excludes its left tool rail and
 * right price axis), measured from the widget's own iframe document.
 *
 * 🪤 Why this exists: arming TV's rectangle line tool does NOT reliably produce
 * a shape here — measured, `drawing_event` only ever emitted
 * 'properties_changed' and getAllShapes() never grew. Rather than depend on
 * TV's drawing internals, the highlight gesture is captured on our own overlay
 * positioned exactly over this rect, and x is converted to time through
 * getVisibleRange(). The iframe is same-origin (self-hosted charting_library),
 * so this measurement is legal and cheap.
 */
export function getTvPlotRect(container) {
  try {
    const iframe = container?.querySelector?.('iframe')
    const doc = iframe?.contentDocument
    if (!iframe || !doc) return null
    const fr = iframe.getBoundingClientRect()
    // The price pane is the largest canvas in the document.
    let best = null
    for (const c of doc.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect()
      if (r.width < 80 || r.height < 80) continue
      if (!best || r.width * r.height > best.width * best.height) best = r
    }
    if (!best) return null
    return { left: fr.left + best.left, top: fr.top + best.top, width: best.width, height: best.height }
  } catch {
    return null
  }
}

/** The window TV is currently showing, in milliseconds. */
export function getTvVisibleRange(chart) {
  try {
    const r = chart.getVisibleRange()
    if (!r || !Number.isFinite(r.from) || !Number.isFinite(r.to)) return null
    return { fromTs: r.from * 1000, toTs: r.to * 1000 }
  } catch {
    return null
  }
}

/**
 * Draw tools on TV: arm TradingView's OWN line tool rather than reimplementing
 * one on top of its surface. The user gets the handles, snapping and magnet
 * behaviour they already know, and the drawing is TV's to keep.
 *
 * Returns a disposer that puts the cursor back.
 */
const TV_TOOL = {
  'draw:trendline': 'trend_line',
  'draw:hline': 'horizontal_line',
  'draw:rect': 'rectangle',
}

export function startTvDrawTool(widget, taMode) {
  const tool = TV_TOOL[taMode]
  if (!widget || !tool) return () => {}
  try { widget.selectLineTool(tool) } catch { /* older build */ }
  return () => { try { widget.selectLineTool('cursor') } catch { /* noop */ } }
}

/**
 * TradingView's CURRENT resolution, in minutes.
 *
 * 🪤 The app's `chartTimeframe` setting is NOT the TV chart's resolution — TV
 * has its own interval selector. Reading the app setting produced a 1W read of
 * a 38-day window the user was viewing on 1h: five bars, no patterns, two
 * lines. Ask the widget.
 */
export function getTvResolutionMinutes(chart) {
  try {
    const r = String(chart.resolution() ?? '')
    if (!r) return null
    if (/^\d+$/.test(r)) return Number(r)               // "1", "60", "240"
    const m = r.match(/^(\d*)([SDWM])$/i)
    if (!m) return null
    const n = Number(m[1] || 1)
    const unit = m[2].toUpperCase()
    if (unit === 'S') return n / 60
    if (unit === 'D') return n * 1440
    if (unit === 'W') return n * 10080
    if (unit === 'M') return n * 43200
    return null
  } catch {
    return null
  }
}
