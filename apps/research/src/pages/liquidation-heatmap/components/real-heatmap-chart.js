/**
 * Pure canvas rendering for real liquidation heatmap.
 * Apple Cinematic design - deep void backgrounds, warm-white chrome,
 * smooth CoinGlass-style heatmap with blur blending.
 */
import { drawSpectreWatermark } from '@/lib/chart-watermark'

// ─── Color ramps ───
// Dark ramp = Spectre-void variant of the CoinGlass palette: the field floor
// is near-black (sits on the app's #09090b void instead of CoinGlass purple),
// then deep indigo → blue → cyan → teal → green → yellow magnet. Same band
// readability, native to the dark theme. Day ramp floors at the light page
// surface and peaks amber so bands stay readable on white.
const RAMP_DARK = [
  [13, 13, 20],    // 0.00 near-void — the FIELD floor (Spectre zero)
  [26, 28, 56],    // 0.12 deep indigo
  [38, 52, 110],   // 0.25 indigo-blue
  [44, 92, 158],   // 0.38 blue
  [54, 136, 178],  // 0.50 cyan
  [68, 172, 166],  // 0.62 teal
  [88, 198, 130],  // 0.74 green
  [130, 212, 84],  // 0.84 bright green
  [190, 222, 48],  // 0.93 lime
  [253, 231, 37],  // 1.00 yellow magnet
]
const RAMP_DAY = [
  [246, 247, 249],
  [228, 233, 244],
  [200, 214, 238],
  [158, 188, 230],
  [110, 158, 216],
  [70, 132, 198],
  [46, 148, 152],
  [70, 172, 96],
  [156, 190, 44],
  [216, 176, 24],
  [245, 158, 11],
]
function bakeLut(ramp) {
  const lut = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    const idx = t * (ramp.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, ramp.length - 1)
    const f = idx - lo
    lut[i * 3] = Math.round(ramp[lo][0] + (ramp[hi][0] - ramp[lo][0]) * f)
    lut[i * 3 + 1] = Math.round(ramp[lo][1] + (ramp[hi][1] - ramp[lo][1]) * f)
    lut[i * 3 + 2] = Math.round(ramp[lo][2] + (ramp[hi][2] - ramp[lo][2]) * f)
  }
  return lut
}
const LUT_DARK = bakeLut(RAMP_DARK)
const LUT_DAY = bakeLut(RAMP_DAY)

// Diverging ramps for Δ (delta) mode: per-column CHANGE in standing liquidity.
// Added liquidity ramps green (bull family), removed/consumed ramps red.
// Index 0 = the same field floor as the absolute ramp so low-magnitude cells
// blend into the pane instead of tinting it.
const RAMP_DPOS_DARK = [
  [13, 13, 20], [12, 52, 40], [14, 110, 80], [16, 185, 129], [110, 231, 183],
]
const RAMP_DNEG_DARK = [
  [13, 13, 20], [64, 24, 30], [150, 42, 46], [239, 68, 68], [252, 165, 165],
]
const RAMP_DPOS_DAY = [
  [246, 247, 249], [209, 250, 229], [110, 231, 183], [16, 185, 129], [5, 150, 105],
]
const RAMP_DNEG_DAY = [
  [246, 247, 249], [254, 226, 226], [252, 165, 165], [239, 68, 68], [185, 28, 28],
]
const LUT_DPOS_DARK = bakeLut(RAMP_DPOS_DARK)
const LUT_DNEG_DARK = bakeLut(RAMP_DNEG_DARK)
const LUT_DPOS_DAY = bakeLut(RAMP_DPOS_DAY)
const LUT_DNEG_DAY = bakeLut(RAMP_DNEG_DAY)

// Reusable offscreen canvas for heatmap layer
let _offCanvas = null
let _offCtx = null
function getOffscreen(w, h) {
  if (!_offCanvas) {
    _offCanvas = document.createElement('canvas')
    _offCtx = _offCanvas.getContext('2d')
  }
  if (_offCanvas.width !== w || _offCanvas.height !== h) {
    _offCanvas.width = w
    _offCanvas.height = h
  }
  return { canvas: _offCanvas, ctx: _offCtx }
}

// ── Field-build cache ───────────────────────────────────────────────────────
// 🪤 The heat field is by far the most expensive thing this file does — it
// allocates a fieldW x fieldH Float32Array (plus a second one in delta mode,
// plus a magnitude buffer), runs TWO typed-array sorts and repaints a full
// ImageData. Measured payloads: 1M = 57,546 grid cells over 527 price rows.
//
// It depends ONLY on the data, the visible column window, the threshold, the
// delta toggle and the theme — never on the cursor. But `mouse` is a dep of
// the view's render effect, so before this cache every crosshair frame rebuilt
// the whole field and re-sorted ~50k values at 60fps. Everything downstream
// (candles, axes, rail, pins, tooltip) is cheap and still runs per frame.
//
// The painted result lives in the module-level offscreen canvas, so a cache hit
// also skips the putImageData: `getOffscreen` only clears when the SIZE changes,
// and the size is part of the key. Two charts mounted at once just alternate
// keys and fall back to recomputing — slower, never wrong.
let _fieldCache = null
let _dataSeq = 0
const _dataIds = new WeakMap()
function dataKey(data) {
  let id = _dataIds.get(data)
  if (id === undefined) { id = ++_dataSeq; _dataIds.set(data, id) }
  return id
}

// Second offscreen for the horizontal-only smoothing pass (see paint step 5).
let _offMidCanvas = null
let _offMidCtx = null
function getOffscreenMid(w, h) {
  if (!_offMidCanvas) {
    _offMidCanvas = document.createElement('canvas')
    _offMidCtx = _offMidCanvas.getContext('2d')
  }
  if (_offMidCanvas.width !== w || _offMidCanvas.height !== h) {
    _offMidCanvas.width = w
    _offMidCanvas.height = h
  }
  return { canvas: _offMidCanvas, ctx: _offMidCtx }
}

export function fmtK(v) {
  if (v == null || isNaN(v)) return '--'
  const a = Math.abs(v)
  if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'
  return '$' + v.toFixed(2)
}

function defaultFmtPrice(v) {
  if (v == null || isNaN(v)) return '--'
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (v >= 1) return '$' + v.toFixed(2)
  return '$' + v.toFixed(4)
}

// Design tokens — two full theme sets (dark/day). Selected once per draw via
// `const T = opts?.dayMode ? THEME_DAY : THEME_DARK` at the top of
// drawRealHeatmap; every color in the file reads from T from that point on.
const THEME_DARK = {
  bg: '#09090b', fieldFloor: '#0d0d14',
  textPrimary: 'rgba(245, 245, 247, 0.9)', textSecondary: 'rgba(245, 245, 247, 0.5)',
  textMuted: 'rgba(245, 245, 247, 0.35)',
  // Price/time axis labels get their own, brighter tone. textSecondary (0.5)
  // at 11px over the heavy axis panel was genuinely hard to read, which made
  // it hard to tell what level a band sat at.
  axisText: 'rgba(245, 245, 247, 0.8)',
  borderSubtle: 'rgba(255, 255, 255, 0.04)', borderDefault: 'rgba(255, 255, 255, 0.06)',
  gridLine: 'rgba(255, 255, 255, 0.075)',
  panelBg: 'rgba(9, 9, 11, 0.92)', panelBgHeavy: 'rgba(9, 9, 11, 0.95)', tipBg: 'rgba(9, 9, 11, 0.88)',
  bull: '#10B981', bear: '#EF4444',
  amber: 'rgba(245, 158, 11, 0.85)', amberBg: 'rgba(245, 158, 11, 0.9)', amberText: '#09090b',
  candleOutline: 'rgba(0, 0, 0, 0.6)', candleBodyOutline: 'rgba(0, 0, 0, 0.5)',
  crosshair: 'rgba(245, 245, 247, 0.15)',
  printStroke: 'rgba(255, 255, 255, 0.55)',
  pinLine: 'rgba(245, 245, 247, 0.45)', pinBg: 'rgba(9, 9, 11, 0.9)',
  lut: LUT_DARK, lutDPos: LUT_DPOS_DARK, lutDNeg: LUT_DNEG_DARK, dark: true,
}
const THEME_DAY = {
  bg: '#ffffff', fieldFloor: '#f6f7f9',
  textPrimary: 'rgba(15, 23, 42, 0.92)', textSecondary: 'rgba(71, 85, 105, 0.9)',
  textMuted: 'rgba(100, 116, 139, 0.7)',
  axisText: 'rgba(30, 41, 59, 0.95)',
  borderSubtle: 'rgba(15, 23, 42, 0.06)', borderDefault: 'rgba(15, 23, 42, 0.1)',
  gridLine: 'rgba(15, 23, 42, 0.09)',
  panelBg: 'rgba(255, 255, 255, 0.92)', panelBgHeavy: 'rgba(255, 255, 255, 0.96)', tipBg: 'rgba(255, 255, 255, 0.94)',
  bull: '#059669', bear: '#DC2626',
  amber: 'rgba(217, 119, 6, 0.9)', amberBg: 'rgba(217, 119, 6, 0.95)', amberText: '#ffffff',
  candleOutline: 'rgba(255, 255, 255, 0.7)', candleBodyOutline: 'rgba(255, 255, 255, 0.55)',
  crosshair: 'rgba(15, 23, 42, 0.25)',
  printStroke: 'rgba(15, 23, 42, 0.4)',
  pinLine: 'rgba(15, 23, 42, 0.45)', pinBg: 'rgba(255, 255, 255, 0.95)',
  lut: LUT_DAY, lutDPos: LUT_DPOS_DAY, lutDNeg: LUT_DNEG_DAY, dark: false,
}
const FONT_MONO = '\'JetBrains Mono\', \'SF Mono\', ui-monospace, monospace'

// ── Layout constants, shared with HeatmapView's pointer hit-testing ──────────
// The view classifies a pointer into chart / priceAxis / timeAxis by these
// widths; if its copy drifts from the draw's, the drag bands land off the
// visible axis. Export them so there is exactly one source.
export const NARROW_W = 500
/** Phone-width canvases drop the cumulative-liquidity rail entirely. */
export function isNarrowCanvas(w) { return w <= NARROW_W }
/** The right price axis needs more room at phone width: a 5-digit BTC price in
 *  the current-price pill measures ~82px, which overflowed the old fixed 76 and
 *  clipped the pill against the canvas edge. */
export function priceAxisWidthFor(w) { return isNarrowCanvas(w) ? 86 : 76 }
export const TIME_AXIS_H = 36
const FONT_BODY = '-apple-system, BlinkMacSystemFont, \'SF Pro Display\', system-ui, sans-serif'

export function drawRealHeatmap(canvas, dims, data, klines, mouse, view, fmtPrice, opts) {
  if (!canvas || !data || !data.grid.length) return
  const priceFmt = fmtPrice || defaultFmtPrice
  const T = opts?.dayMode ? THEME_DAY : THEME_DARK

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const { w, h } = dims

  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)

  // Layout zones
  const narrow = isNarrowCanvas(w)
  const sidebarW = opts?.hideSidebar ? 0 : 84
  const priceAxisW = priceAxisWidthFor(w)
  const timeAxisH = TIME_AXIS_H
  // Axis type shrinks a step at phone width so the labels + pill clear the edge.
  const axisFontPx = narrow ? 10 : 11
  // Left color-scale legend (CoinGlass anatomy): gradient bar + max label.
  const legendW = opts?.hideSidebar ? 0 : 30
  const chartL = legendW
  const chartR = w - sidebarW - priceAxisW
  const chartW = chartR - chartL
  // chartT leaves room for the topmost price-axis label; with textBaseline
  // 'middle' and 11px font, y=0 would clip the top half of the highest
  // price label. A 14px top inset keeps it fully visible and avoids the
  // collision with the chart toolbar sitting directly above on mobile.
  const chartT = 14
  const chartB = h - timeAxisH
  const chartH = chartB - chartT
  const sideL = chartR
  const sideR = w - priceAxisW
  const axisL = sideR

  if (chartW <= 0 || chartH <= 0) return

  const { rows, cols, grid, timeArray, priceArray } = data
  const vStart = Math.max(0, view.start)
  const vEnd = Math.min(cols - 1, view.end < 0 ? cols - 1 : view.end)
  const vCols = vEnd - vStart + 1

  // Klines inside the visible heatmap window (needed for framing + overlay).
  const hmStartTs = timeArray[vStart] || 0
  const hmEndTs = timeArray[vEnd] || hmStartTs + 1
  const hmSpan = hmEndTs - hmStartTs || 1
  const visibleKlines = klines ? klines.filter(k => k.time >= hmStartTs && k.time <= hmEndTs) : []
  const lastPrice0 = visibleKlines.length > 0 ? visibleKlines[visibleKlines.length - 1].close
    : klines && klines.length > 0 ? klines[klines.length - 1].close
    : null

  // Grid bounds (full synthesized price range — reachable by zooming out).
  let gridLo, gridHi
  if (priceArray && priceArray.length > 0) {
    const ts = priceArray.length > 1 ? priceArray[1] - priceArray[0] : 25
    gridLo = priceArray[0]
    gridHi = priceArray[priceArray.length - 1] + ts
  } else if (klines && klines.length > 0) {
    gridLo = Math.min(...klines.map(k => k.low))
    gridHi = Math.max(...klines.map(k => k.high))
  }
  if (gridLo == null) { gridLo = 60000; gridHi = 80000 }

  // Default frame = candle range + 35% padding each side (the CoinGlass
  // default view: price fills most of the pane, near-price liquidity fills
  // the rest; the far 10x bands live off-frame until the user zooms out).
  let minP, maxP
  if (visibleKlines.length > 0) {
    let cLo = Infinity, cHi = -Infinity
    for (const k of visibleKlines) {
      if (k.low < cLo) cLo = k.low
      if (k.high > cHi) cHi = k.high
    }
    const cSpan = Math.max(cHi - cLo, cHi * 0.02)
    minP = Math.max(gridLo, cLo - cSpan * 0.35)
    maxP = Math.min(gridHi, cHi + cSpan * 0.35)
  } else {
    minP = gridLo
    maxP = gridHi
  }

  // User-driven vertical zoom centered on last price (or frame midpoint).
  // view.priceZoom > 1 zooms IN (smaller visible range), < 1 zooms OUT
  // toward the full grid bounds.
  const priceZoom = Math.max(0.1, Math.min(10, view?.priceZoom ?? 1))
  if (priceZoom !== 1) {
    const center = lastPrice0 != null ? lastPrice0 : (minP + (maxP - minP) / 2)
    const half = (maxP - minP) / (2 * priceZoom)
    minP = Math.max(gridLo, center - half)
    maxP = Math.min(gridHi, center + half)
  }

  // User-driven vertical pan (chart-body drag). Clamped so the window never
  // leaves the synthesized grid — the interaction layer clamps too, this is
  // the safety net for stale offsets after a data/timeframe change.
  const priceOffset = view?.priceOffset || 0
  if (priceOffset) {
    const dP = Math.max(gridLo - minP, Math.min(gridHi - maxP, priceOffset))
    minP += dP
    maxP += dP
  }

  const fullRange = maxP - minP
  const priceToY = (price) => chartT + chartH - ((price - minP) / fullRange) * chartH
  const yToPrice = (y) => minP + (1 - (y - chartT) / chartH) * fullRange

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // ═══════════════════════════════════════════════════
  // Background
  // ═══════════════════════════════════════════════════
  ctx.fillStyle = T.bg
  ctx.fillRect(0, 0, w, h)

  const lastPrice = lastPrice0 != null ? lastPrice0 : (minP + fullRange / 2)

  // ═══════════════════════════════════════════════════
  // LAYER 1: CoinAnk-style heatmap field
  // Render the native cols×rows liquidation grid into a tiny ImageData, then
  // let the GPU bilinear-upscale it to full chart size via drawImage. This is
  // how CoinAnk/CoinGlass get smooth gradients: low-res field + interpolation,
  // not per-pixel painting + box blur. The whole plot area is colored (purple
  // floor), so there is no black void between bands.
  // ═══════════════════════════════════════════════════
  const cellW = chartW / vCols
  const tickSize = priceArray && priceArray.length > 1 ? priceArray[1] - priceArray[0] : (fullRange / rows)

  const fieldW = vCols
  const fieldH = rows
  const deltaMode = !!opts?.deltaMode
  // User-driven percentile cut — the CoinGlass "Liquidity Threshold" slider
  // (their UI default 0.85): cells below the chosen percentile of nonzero
  // density are cut to the field floor entirely.
  const LIQUIDITY_THRESHOLD = Math.max(0.5, Math.min(1, opts?.threshold ?? 0.85))

  // Everything from here to `putImageData` is cursor-independent — see the
  // _fieldCache note at the top of the file. Recompute only when one of these
  // actually changes.
  const fieldKey = `${dataKey(data)}|${vStart}|${vEnd}|${fieldW}|${fieldH}|${deltaMode ? 1 : 0}|${LIQUIDITY_THRESHOLD}|${opts?.dayMode ? 1 : 0}`
  const { canvas: offCanvas, ctx: offCtx } = getOffscreen(fieldW, fieldH)

  if (!_fieldCache || _fieldCache.key !== fieldKey) {
    // Max value for color scaling (97th percentile via partial sort)
    const vals = new Float32Array(grid.length)
    let vc = 0
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i].value
      if (v !== 0) vals[vc++] = Math.abs(v)
    }
    const used = vals.subarray(0, vc)
    used.sort()
    const maxVal = vc > 0 ? used[Math.floor(vc * 0.97)] || used[vc - 1] : 1

    // 1. Accumulate sparse cells into a dense cols×rows field (additive, so
    //    overlapping cohort bands reinforce instead of max-blending).
    const field = new Float32Array(fieldW * fieldH)
    for (const g of grid) {
      if (g.col < vStart || g.col > vEnd) continue
      const fr = g.row
      if (fr < 0 || fr >= fieldH) continue
      field[fr * fieldW + (g.col - vStart)] += Math.abs(g.value)
    }

    // 2. NO smoothing of the field — the server now emits discrete 1-row
    //    liquidation lines (close-price entries × leverage tiers) and any blur
    //    re-merges them into the featureless glow the founder rejected.

    // 2b. Δ (delta) mode: paint the per-column CHANGE in standing liquidity
    //     instead of the absolute level. Positive = liquidity added at that
    //     moment (band born/reinforced), negative = consumed or pulled. The
    //     first visible column has no predecessor in the window → 0 (floor).
    //     Everything DERIVED from liquidity (cumulative rail, pins, magnets,
    //     tooltip cum) keeps reading the absolute `field`.
    let dfield = null
    if (deltaMode) {
      dfield = new Float32Array(fieldW * fieldH)
      for (let r = 0; r < fieldH; r++) {
        const off = r * fieldW
        for (let ix = 1; ix < fieldW; ix++) dfield[off + ix] = field[off + ix] - field[off + ix - 1]
      }
    }
    const paintF = deltaMode ? dfield : field

    // 3. LIQUIDITY THRESHOLD + log tone mapping — the CoinGlass recipe (their
    //    UI ships with "Liquidity Threshold = 0.85"): cells below the 85th
    //    percentile of nonzero density are CUT to the purple floor entirely.
    //    That is what turns a noisy barcode into a clean field with only the
    //    levels that matter. Survivors map log(v) onto the ramp so ordinary
    //    lines land cyan/teal and only true magnets reach yellow.
    const fvals = new Float32Array(fieldW * fieldH)
    let fvc = 0
    // Percentile stats over MAGNITUDE — |Δ| in delta mode, plain value otherwise.
    for (let i = 0; i < paintF.length; i++) {
      const a = paintF[i] < 0 ? -paintF[i] : paintF[i]
      if (a > 0) fvals[fvc++] = a
    }
    let toneLo = 1, toneHi = 2
    if (fvc > 0) {
      const fsub = fvals.subarray(0, fvc)
      fsub.sort()
      toneLo = fsub[Math.min(fvc - 1, Math.floor(fvc * LIQUIDITY_THRESHOLD))] || fsub[0] || 1
      toneHi = fsub[Math.floor(fvc * 0.999)] || fsub[fvc - 1] || toneLo * 10
      if (toneHi <= toneLo) toneHi = toneLo * 10
    }
    const lnLo = Math.log(toneLo)
    const invLnRange = 1 / (Math.log(toneHi) - lnLo)
    const lowCut = toneLo // below the threshold: pure floor

    // 4. Paint the field into a fieldW×fieldH ImageData. Image row 0 = top =
    //    highest price = grid row (fieldH-1), so flip the row index.
    const imgData = offCtx.createImageData(fieldW, fieldH)
    const px = imgData.data
    for (let iy = 0; iy < fieldH; iy++) {
      const gr = fieldH - 1 - iy
      const rowOff = gr * fieldW
      const outOff = iy * fieldW
      for (let ix = 0; ix < fieldW; ix++) {
        const v0 = paintF[rowOff + ix]
        const av = v0 < 0 ? -v0 : v0
        // Survivors start at 0.15 (dim indigo, just above the floor) — the
        // wide ramp keeps most bands indigo/blue/teal so only the true magnets
        // in the top ~1% reach yellow, matching the CoinGlass distribution.
        const t = av > lowCut ? 0.15 + 0.85 * (Math.log(av) - lnLo) * invLnRange : 0
        const lutIdx = (t >= 1 ? 255 : (t < 0 ? 0 : t * 255)) | 0
        const o = (outOff + ix) * 4
        const li = lutIdx * 3
        const lut = deltaMode ? (v0 >= 0 ? T.lutDPos : T.lutDNeg) : T.lut
        px[o] = lut[li]
        px[o + 1] = lut[li + 1]
        px[o + 2] = lut[li + 2]
        px[o + 3] = 255
      }
    }
    offCtx.putImageData(imgData, 0, 0)

    _fieldCache = { key: fieldKey, field, dfield, maxVal, toneHi }
  }

  const { field, dfield, maxVal, toneHi } = _fieldCache

  // 5. Flat-fill the plot area with the field floor, then upscale in TWO
  //    passes: horizontal stretch WITH smoothing (columns blend into smooth
  //    time), then vertical stretch WITHOUT smoothing so each price row stays
  //    a crisp 1-2px line — the CoinGlass texture. One bilinear pass over both
  //    axes feathered adjacent rows back into wide bands.
  ctx.fillStyle = T.fieldFloor
  ctx.fillRect(chartL, chartT, chartW, chartH)
  const fieldTopY = priceToY(priceArray ? priceArray[rows - 1] + tickSize : maxP)
  const fieldBotY = priceToY(priceArray ? priceArray[0] : minP)
  const midW = Math.max(1, Math.round(chartW))
  const { canvas: midCanvas, ctx: midCtx } = getOffscreenMid(midW, fieldH)
  midCtx.imageSmoothingEnabled = true
  midCtx.imageSmoothingQuality = 'high'
  midCtx.clearRect(0, 0, midW, fieldH)
  midCtx.drawImage(offCanvas, 0, 0, midW, fieldH)
  // The default frame is tighter than the synthesized grid, so the upscaled
  // field extends beyond the pane — clip it to the chart rect.
  ctx.save()
  ctx.beginPath()
  ctx.rect(chartL, chartT, chartW, chartH)
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(midCanvas, chartL, fieldTopY, chartW, fieldBotY - fieldTopY)
  ctx.imageSmoothingEnabled = true
  ctx.restore()

  // ═══════════════════════════════════════════════════
  // Left color-scale legend (CoinGlass anatomy)
  // ═══════════════════════════════════════════════════
  if (legendW > 0) {
    const barW = 10
    const barX = Math.floor((legendW - barW) / 2)
    const steps = 64
    const stepH = chartH / steps
    for (let s = 0; s < steps; s++) {
      if (deltaMode) {
        // Diverging: added (green) strong at top → floor mid → removed (red)
        // strong at bottom.
        const frac = s / (steps - 1)
        const half = frac < 0.5
        const t = half ? 1 - frac * 2 : (frac - 0.5) * 2
        const lut = half ? T.lutDPos : T.lutDNeg
        const li = ((t * 255) | 0) * 3
        ctx.fillStyle = `rgb(${lut[li]}, ${lut[li + 1]}, ${lut[li + 2]})`
      } else {
        // top = peak of the ramp, bottom = floor
        const t = 1 - s / (steps - 1)
        const li = ((t * 255) | 0) * 3
        ctx.fillStyle = `rgb(${T.lut[li]}, ${T.lut[li + 1]}, ${T.lut[li + 2]})`
      }
      ctx.fillRect(barX, chartT + s * stepH, barW, stepH + 1)
    }
    ctx.strokeStyle = T.borderDefault
    ctx.lineWidth = 1
    ctx.strokeRect(barX + 0.5, chartT + 0.5, barW - 1, chartH - 1)
    // Max cell value label above the bar (± magnitude in delta mode)
    ctx.font = `9px ${FONT_MONO}`
    ctx.fillStyle = T.textSecondary
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText((deltaMode ? '±' : '') + fmtK(toneHi).replace('$', ''), barX, chartT - 3)
  }

  // Hairline plot border — the near-void field floor needs a subtle frame so
  // the pane reads as a surface against the page background.
  ctx.strokeStyle = T.borderDefault
  ctx.lineWidth = 1
  ctx.strokeRect(chartL + 0.5, chartT + 0.5, chartW - 1, chartH - 1)

  // Subtle grid lines
  const pSteps = Math.min(10, Math.floor(chartH / 48))
  for (let i = 1; i < pSteps; i++) {
    const price = minP + (fullRange * i) / pSteps
    const y = priceToY(price)
    ctx.strokeStyle = T.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(chartL, y)
    ctx.lineTo(chartR, y)
    ctx.stroke()
  }

  // ═══════════════════════════════════════════════════
  // LAYER 2: Candlestick overlay (prominent, outlined)
  // ═══════════════════════════════════════════════════
  if (visibleKlines.length > 0) {
    // Clip candles to the pane — a zoomed-in frame can push wicks off-frame.
    ctx.save()
    ctx.beginPath()
    ctx.rect(chartL, chartT, chartW, chartH)
    ctx.clip()
    const klineInterval = visibleKlines.length > 1 ? visibleKlines[1].time - visibleKlines[0].time : 1800000
    // Wider body: fill more of the kline slot
    const slotW = (klineInterval / hmSpan) * chartW
    // CoinGlass-size candles: small and crisp, never chunky blocks.
    const bodyW = Math.max(2, Math.min(slotW * 0.8, 6))

    for (let i = 0; i < visibleKlines.length; i++) {
      const k = visibleKlines[i]
      const kx = chartL + ((k.time - hmStartTs + klineInterval * 0.5) / hmSpan) * chartW
      if (kx < chartL - bodyW || kx > chartR + bodyW) continue
      const isUp = k.close >= k.open

      const oY = priceToY(k.open)
      const cY = priceToY(k.close)
      const hY = priceToY(k.high)
      const lY = priceToY(k.low)
      const bTop = Math.min(oY, cY)
      const bH = Math.max(1, Math.abs(cY - oY))

      // Dark outline behind candle for contrast against heatmap
      ctx.strokeStyle = T.candleOutline
      ctx.lineWidth = bodyW + 1
      ctx.beginPath()
      ctx.moveTo(kx, hY)
      ctx.lineTo(kx, lY)
      ctx.stroke()

      // Wick
      ctx.strokeStyle = isUp ? T.bull : T.bear
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(kx, hY)
      ctx.lineTo(kx, lY)
      ctx.stroke()

      // Body with dark outline
      ctx.fillStyle = T.candleBodyOutline
      ctx.fillRect(kx - bodyW / 2 - 1, bTop - 1, bodyW + 2, bH + 2)

      // Solid filled body
      ctx.fillStyle = isUp ? T.bull : T.bear
      ctx.fillRect(kx - bodyW / 2, bTop, bodyW, bH)
    }
    ctx.restore()
  }

  // ═══════════════════════════════════════════════════
  // LAYER 2b: REAL liquidation prints (Spectre tape — Bybit full feed + OKX)
  // ═══════════════════════════════════════════════════
  let printHits = []
  const printEvents = opts?.showPrints !== false && opts?.prints?.events?.length ? opts.prints.events : null
  if (printEvents) {
    const exFilter = opts?.exchangeFilter || null
    const inView = []
    for (const e of printEvents) {
      if (exFilter && e.ex !== exFilter) continue
      if (e.t < hmStartTs || e.t > hmEndTs) continue
      const x = chartL + ((e.t - hmStartTs) / hmSpan) * chartW
      const y = priceToY(e.p)
      if (y < chartT || y > chartB) continue
      inView.push({ x, y, e })
    }
    // Cap to the 600 largest in view; draw big→small so small stay visible on top.
    inView.sort((a, b) => b.e.usd - a.e.usd)
    printHits = inView.slice(0, 600)
    for (let i = 0; i < printHits.length; i++) {
      const d = printHits[i]
      // $100 → ~1.5px, $1M → ~5px, clamp 5 — small enough to never bury the
      // candles under the overlay.
      const r = Math.max(1.5, Math.min(5, 1.5 + (Math.log10(d.e.usd) - 2) * 1.6))
      const isLong = d.e.side === 'long'
      ctx.beginPath()
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
      ctx.fillStyle = isLong
        ? (T.dark ? 'rgba(239, 68, 68, 0.4)' : 'rgba(220, 38, 38, 0.4)')
        : (T.dark ? 'rgba(16, 185, 129, 0.4)' : 'rgba(5, 150, 105, 0.4)')
      ctx.fill()
      ctx.lineWidth = 0.75
      ctx.strokeStyle = T.printStroke
      ctx.stroke()
    }
    // Exchange filter emptied the overlay (e.g. Binance: the tape collects
    // Bybit+OKX only) — say so instead of a silently blank overlay.
    if (exFilter && inView.length === 0 && printEvents.length > 0) {
      ctx.font = `9px ${FONT_MONO}`
      ctx.fillStyle = T.textMuted
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`no ${exFilter} prints in tape`, chartL + 8, chartB - 6)
    }
    // Honest window caption when the tape covers less than the visible range.
    const visHours = hmSpan / 3600_000
    const covered = opts?.prints?.window_covered_hours || 0
    if (covered > 0 && visHours > covered * 1.25) {
      ctx.font = `9px ${FONT_MONO}`
      ctx.fillStyle = T.textMuted
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`prints: last ${Math.round(covered)}h`, chartL + 8, chartB - 6)
    }
  }

  // Current price line (skip when the zoomed frame pushed it off-pane;
  // the axis pill below clamps to the pane edge instead).
  const lastPriceY = priceToY(lastPrice)
  if (lastPriceY >= chartT && lastPriceY <= chartB) {
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = T.amber
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(chartL, lastPriceY)
    ctx.lineTo(sideR, lastPriceY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ═══════════════════════════════════════════════════
  // LAYER 2c: pinned levels (click-to-pin)
  // ═══════════════════════════════════════════════════
  const pins = Array.isArray(opts?.pins) ? opts.pins : []
  if (pins.length) {
    // Standing $ at a level = latest visible column's field value around that row.
    const lastCol = vEnd - vStart
    const standingAt = (price) => {
      const r = Math.floor((price - (priceArray ? priceArray[0] : minP)) / tickSize)
      let sum = 0
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr
        if (rr >= 0 && rr < rows) sum += field[rr * fieldW + lastCol]
      }
      return sum
    }
    ctx.font = `bold 10px ${FONT_MONO}`
    for (const price of pins) {
      const y = priceToY(price)
      if (y < chartT || y > chartB) continue
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = T.pinLine
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(chartL, y)
      ctx.lineTo(sideR, y)
      ctx.stroke()
      ctx.setLineDash([])
      const label = `${priceFmt(price)} · ${fmtK(standingAt(price))}`
      const tw = ctx.measureText(label).width
      // A ~130px label parked at the right edge covers the newest candles —
      // the ones being read. At phone width there is no room to spare, so the
      // label moves to the left (older) side of the pane instead.
      const bx = narrow ? chartL + 4 : chartR - tw - 22
      ctx.fillStyle = T.pinBg
      ctx.beginPath()
      ctx.roundRect(bx, y - 10, tw + 18, 20, 4)
      ctx.fill()
      ctx.strokeStyle = T.borderDefault
      ctx.lineWidth = 0.5
      ctx.stroke()
      ctx.fillStyle = T.textPrimary
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + 6, y)
      // small × affordance
      ctx.fillStyle = T.textMuted
      ctx.fillText('×', bx + tw + 9, y)
    }
  }

  // ═══════════════════════════════════════════════════
  // LAYER 3: Cumulative liquidity panel (CoinGlass right rail)
  // Cumulative liquidation $ from the current price outward, computed on the
  // LATEST visible column. Green stepped curve above price = cumulative
  // short-liq $, red below = cumulative long-liq $. Faint per-row bars show
  // the raw standing liquidity at each level.
  // ═══════════════════════════════════════════════════
  if (sidebarW > 0) {
  const lastCol = vEnd - vStart
  let curRow = 0
  if (priceArray) {
    for (let r = 0; r < rows; r++) { if (priceArray[r] <= lastPrice) curRow = r }
  }
  const cumUp = new Float64Array(rows)
  const cumDn = new Float64Array(rows)
  let acc = 0
  for (let r = curRow + 1; r < rows; r++) { acc += field[r * fieldW + lastCol]; cumUp[r] = acc }
  let maxCum = acc
  acc = 0
  for (let r = curRow - 1; r >= 0; r--) { acc += field[r * fieldW + lastCol]; cumDn[r] = acc }
  if (acc > maxCum) maxCum = acc
  if (maxCum === 0) maxCum = 1

  ctx.fillStyle = T.panelBg
  ctx.fillRect(sideL, chartT, sidebarW, chartH)
  const panelPad = 6
  const panelW = sidebarW - panelPad * 2

  // Faint per-row bars — raw standing liquidity per level.
  let maxRowV = 0
  for (let r = 0; r < rows; r++) {
    const v = field[r * fieldW + lastCol]
    if (v > maxRowV) maxRowV = v
  }
  if (maxRowV > 0 && priceArray) {
    for (let r = 0; r < rows; r++) {
      const v = field[r * fieldW + lastCol]
      if (v <= 0) continue
      const y = priceToY(priceArray[r] + tickSize / 2)
      if (y < chartT || y > chartB) continue
      const bw = (v / maxRowV) * panelW
      ctx.fillStyle = r > curRow
        ? (T.dark ? 'rgba(16, 185, 129, 0.16)' : 'rgba(5, 150, 105, 0.16)')
        : (T.dark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(220, 38, 38, 0.16)')
      ctx.fillRect(sideL + panelPad, y - 0.5, bw, 1)
    }
  }

  // Stepped cumulative curves.
  const drawCum = (fromRow, toRow, arr, color) => {
    if (!priceArray) return
    ctx.strokeStyle = color
    ctx.lineWidth = 1.25
    ctx.beginPath()
    let started = false
    const step = fromRow <= toRow ? 1 : -1
    for (let r = fromRow; step > 0 ? r <= toRow : r >= toRow; r += step) {
      const y = priceToY(priceArray[r] + tickSize / 2)
      if (y < chartT - 2 || y > chartB + 2) continue
      const x = sideL + panelPad + (arr[r] / maxCum) * panelW
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  drawCum(curRow + 1, rows - 1, cumUp, T.dark ? 'rgba(52, 211, 153, 0.9)' : 'rgba(5, 150, 105, 0.9)')
  drawCum(curRow - 1, 0, cumDn, T.dark ? 'rgba(248, 113, 113, 0.9)' : 'rgba(220, 38, 38, 0.9)')

  // Hairline divider against the field.
  ctx.strokeStyle = T.borderDefault
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(sideL + 0.5, chartT)
  ctx.lineTo(sideL + 0.5, chartB)
  ctx.stroke()
  } // end sidebarW > 0

  // ═══════════════════════════════════════════════════
  // Price axis
  // ═══════════════════════════════════════════════════
  ctx.fillStyle = T.panelBgHeavy
  ctx.fillRect(axisL, 0, priceAxisW, h)

  ctx.strokeStyle = T.gridLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(axisL, chartT)
  ctx.lineTo(axisL, chartB)
  ctx.stroke()

  ctx.font = `${axisFontPx}px ${FONT_MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= pSteps; i++) {
    const price = minP + (fullRange * i) / pSteps
    const y = priceToY(price)
    if (Math.abs(y - lastPriceY) < 26) continue
    // The extreme ticks land exactly on chartT / chartB, and with a middle
    // baseline half the glyph then falls outside the plot — the lowest price
    // was being sliced in half by the time-axis strip. Clamp so both ends stay
    // fully readable.
    const ly = Math.max(chartT + 7, Math.min(chartB - 7, y))
    ctx.fillStyle = T.axisText
    ctx.fillText(priceFmt(price), axisL + 8, ly)
  }

  // Current price pill
  const pLabel = priceFmt(lastPrice)
  ctx.font = `bold ${axisFontPx}px ${FONT_MONO}`
  const pillTw = ctx.measureText(pLabel).width
  const pillW = pillTw + 16
  const pillH = 24
  const pillX = axisL + 2
  const pillCenterY = Math.max(chartT + pillH / 2, Math.min(chartB - pillH / 2, lastPriceY))
  const pillY = pillCenterY - pillH / 2

  ctx.fillStyle = T.amberBg
  ctx.beginPath()
  ctx.roundRect(pillX, pillY, pillW, pillH, 5)
  ctx.fill()
  ctx.strokeStyle = T.dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.12)'
  ctx.lineWidth = 0.5
  ctx.stroke()
  ctx.fillStyle = T.amberText
  ctx.font = `bold ${axisFontPx}px ${FONT_MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(pLabel, pillX + 8, pillCenterY + 0.5)

  // ═══════════════════════════════════════════════════
  // Time axis
  // ═══════════════════════════════════════════════════
  ctx.fillStyle = T.bg
  ctx.fillRect(0, chartB, w, timeAxisH)

  ctx.strokeStyle = T.borderSubtle
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, chartB)
  ctx.lineTo(chartR, chartB)
  ctx.stroke()

  const isMobileCanvas = w <= 500
  ctx.font = `${isMobileCanvas ? 9 : 10}px ${FONT_BODY}`
  ctx.fillStyle = T.textMuted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const tLabels = Math.min(isMobileCanvas ? 4 : 10, vCols)
  for (let i = 0; i < tLabels; i++) {
    const ci = vStart + Math.floor((i / Math.max(tLabels - 1, 1)) * (vCols - 1))
    const ts = timeArray[ci]
    if (!ts) continue
    const d = new Date(ts)

    const hour = d.getHours()
    let label
    if (i === 0 || (i > 0 && timeArray[vStart + Math.floor(((i - 1) / Math.max(tLabels - 1, 1)) * (vCols - 1))] &&
        new Date(timeArray[vStart + Math.floor(((i - 1) / Math.max(tLabels - 1, 1)) * (vCols - 1))]).getDate() !== d.getDate())) {
      label = isMobileCanvas ? `${d.getMonth() + 1}/${d.getDate()}` : `${dayNames[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}`
      ctx.fillStyle = T.textSecondary
    } else {
      const h24 = hour
      const min = d.getMinutes()
      if (isMobileCanvas) {
        label = `${h24}:${String(min).padStart(2, '0')}`
      } else {
        const ampm = hour >= 12 ? 'PM' : 'AM'
        const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
        label = min === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(min).padStart(2, '0')} ${ampm}`
      }
      ctx.fillStyle = T.textMuted
    }

    const px2 = chartL + ((ci - vStart) / vCols) * chartW + cellW / 2
    ctx.fillText(label, px2, chartB + 10)
  }

  // ═══════════════════════════════════════════════════
  // LAYER 4: Crosshair + tooltip
  // ═══════════════════════════════════════════════════
  if (mouse && mouse.x >= chartL && mouse.x <= chartR && mouse.y >= chartT && mouse.y <= chartB) {
    const mx = mouse.x
    const my = mouse.y

    // Nearest print bubble within 8px wins the tooltip.
    let hoverPrint = null
    let bestD = 8
    for (const d of printHits) {
      const dist = Math.hypot(d.x - mx, d.y - my)
      if (dist < bestD) { bestD = dist; hoverPrint = d }
    }

    ctx.strokeStyle = T.crosshair
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(mx, chartT)
    ctx.lineTo(mx, chartB)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(chartL, my)
    ctx.lineTo(sideR, my)
    ctx.stroke()
    ctx.setLineDash([])

    const curPrice = yToPrice(my)
    const colFrac = (mx - chartL) / chartW
    const curCol = Math.min(vEnd, Math.max(vStart, Math.round(vStart + colFrac * (vCols - 1))))
    const curTime = timeArray[curCol]

    let curRow = 0
    if (priceArray) {
      for (let r = 0; r < priceArray.length; r++) {
        if (priceArray[r] <= curPrice) curRow = r
      }
    } else {
      curRow = Math.floor(((curPrice - minP) / fullRange) * rows)
    }
    // Direct field read (the field is already aggregated by the field-paint
    // pass above) — faster than the old grid scan and reflects the same
    // additive density the heatmap itself renders.
    const curVal = field[curRow * fieldW + (curCol - vStart)] || 0

    // Time badge
    if (curTime) {
      const td = new Date(curTime)
      const tLabel = `${monthNames[td.getMonth()]} ${td.getDate()}, ${td.getHours().toString().padStart(2, '0')}:${td.getMinutes().toString().padStart(2, '0')}`
      ctx.font = `10px ${FONT_MONO}`
      const tw = ctx.measureText(tLabel).width
      const tbW = tw + 12
      ctx.fillStyle = T.panelBg
      ctx.beginPath()
      ctx.roundRect(mx - tbW / 2, chartB + 2, tbW, timeAxisH - 4, 4)
      ctx.fill()
      ctx.strokeStyle = T.borderDefault
      ctx.lineWidth = 0.5
      ctx.stroke()
      ctx.fillStyle = T.textPrimary
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(tLabel, mx, chartB + timeAxisH / 2)
    }

    // Price badge
    const yLabel = priceFmt(curPrice)
    ctx.font = `10px ${FONT_MONO}`
    const yw = ctx.measureText(yLabel).width
    ctx.fillStyle = T.panelBg
    ctx.beginPath()
    ctx.roundRect(axisL + 2, my - 10, yw + 12, 20, 4)
    ctx.fill()
    ctx.strokeStyle = T.borderDefault
    ctx.lineWidth = 0.5
    ctx.stroke()
    ctx.fillStyle = T.textPrimary
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(yLabel, axisL + 8, my)

    // Glass tooltip
    const tipPad = 12
    const tipLineH = 18
    const tipLines = []
    if (hoverPrint) {
      const e = hoverPrint.e
      const td = new Date(e.t)
      tipLines.push({ label: 'REAL LIQUIDATION', value: '', dim: true })
      tipLines.push({ label: e.ex.toUpperCase(), value: e.side === 'long' ? 'LONG REKT' : 'SHORT REKT' })
      tipLines.push({ label: 'Size', value: fmtK(e.usd), highlight: true })
      tipLines.push({ label: 'Price', value: priceFmt(e.p) })
      tipLines.push({
        label: td.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + ', ' +
          td.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        value: '', dim: true,
      })
    } else {
      if (curTime) {
        const td = new Date(curTime)
        tipLines.push({
          label: td.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + ', ' +
            td.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          value: '', dim: true,
        })
      }
      tipLines.push({ label: 'Price', value: priceFmt(curPrice) })
      if (deltaMode) {
        const dv = dfield[curRow * fieldW + (curCol - vStart)] || 0
        tipLines.push({
          label: dv >= 0 ? 'Liq added' : 'Liq removed',
          value: (dv >= 0 ? '+' : '−') + fmtK(Math.abs(dv)),
          highlight: Math.abs(dv) > toneHi * 0.5,
        })
      } else {
        tipLines.push({ label: 'Liq Value', value: fmtK(curVal), highlight: curVal > maxVal * 0.5 })
      }
      // Cumulative liq $ between the CURRENT price and the hovered level, in
      // the hovered column — "how much fuel between here and there".
      {
        const colIdx = curCol - vStart
        const curPriceRow = Math.floor((lastPrice - (priceArray ? priceArray[0] : minP)) / tickSize)
        const lo = Math.min(curPriceRow, curRow)
        const hi = Math.max(curPriceRow, curRow)
        let cum = 0
        for (let r = Math.max(0, lo); r <= Math.min(rows - 1, hi); r++) cum += field[r * fieldW + colIdx]
        tipLines.push({
          label: curPrice < lastPrice ? 'Cum. longs to here' : 'Cum. shorts to here',
          value: fmtK(cum),
        })
      }
    }

    ctx.font = `10px ${FONT_MONO}`
    const maxLabelW = Math.max(...tipLines.map(l => ctx.measureText(l.label).width))
    const maxValW = Math.max(...tipLines.map(l => ctx.measureText(l.value).width), 0)
    const tipW = tipPad * 2 + maxLabelW + (maxValW > 0 ? 16 + maxValW : 0)
    const tipH = tipPad * 2 + tipLines.length * tipLineH - 4

    let tipX = mx + 16
    let tipY = my - tipH - 10
    if (tipX + tipW > chartR) tipX = mx - tipW - 16
    if (tipY < chartT + 4) tipY = my + 16

    ctx.fillStyle = T.tipBg
    ctx.beginPath()
    ctx.roundRect(tipX, tipY, tipW, tipH, 8)
    ctx.fill()
    ctx.strokeStyle = T.borderDefault
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(tipX, tipY, tipW, tipH, 8)
    ctx.stroke()
    ctx.strokeStyle = T.borderSubtle
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(tipX + 8, tipY + 0.5)
    ctx.lineTo(tipX + tipW - 8, tipY + 0.5)
    ctx.stroke()

    tipLines.forEach((line, li) => {
      const ly = tipY + tipPad + li * tipLineH
      ctx.font = `10px ${FONT_MONO}`
      ctx.fillStyle = line.dim ? T.textMuted : T.textSecondary
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(line.label, tipX + tipPad, ly)
      if (line.value) {
        ctx.fillStyle = line.highlight ? T.amber : T.textPrimary
        ctx.font = `bold 10px ${FONT_MONO}`
        ctx.textAlign = 'right'
        ctx.fillText(line.value, tipX + tipW - tipPad, ly)
      }
    })
  }

  // 🪤 Anchor to the PLOTTED area, not the raw canvas. Without a `plot` rect
  // this defaults to the bottom-right of the whole canvas — which is the price
  // axis column — so the lockup sat straight on top of the lowest price label.
  drawSpectreWatermark(ctx, {
    w, h, dark: T.dark, ghost: false, corner: 'bl',
    plot: { x: chartL, y: chartT, w: chartW, h: chartB - chartT },
  })

  return { chartL, chartR, chartW, chartT, chartB, sidebarW, priceAxisW, minP, maxP, gridLo, gridHi }
}
