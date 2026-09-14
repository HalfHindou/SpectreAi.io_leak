/**
 * Liquidation Map Chart — Coinglass-style bar chart.
 * X-axis: price levels, Y-axis: liquidation amounts ($M).
 * Stacked bars by leverage tier, cumulative long/short lines.
 */

/* ─── Color constants ─── */
const DARK = {
  BG: '#0a0a12',
  GRID: 'rgba(255, 255, 255, 0.035)',
  AXIS_TEXT: 'rgba(255, 255, 255, 0.5)',
  SEPARATOR: 'rgba(255, 255, 255, 0.06)',
  LEV_10:  '#3B63E9',
  LEV_25:  '#5B8DEF',
  LEV_50:  '#FF9F0A',
  LEV_100: '#FF453A',
  CUM_LONG:  '#FF453A',
  CUM_SHORT: '#4ECDC4',
  CURRENT_LINE: 'rgba(245, 245, 247, 0.35)',
  CURRENT_ARROW: '#f5f5f7',
  CURRENT_LABEL: 'rgba(245, 245, 247, 0.7)',
  BAR_ALPHA: 0.85,
}

const LIGHT = {
  BG: '#f8f8fa',
  GRID: 'rgba(0, 0, 0, 0.06)',
  AXIS_TEXT: 'rgba(17, 17, 19, 0.45)',
  SEPARATOR: 'rgba(0, 0, 0, 0.08)',
  LEV_10:  '#2D52D6',
  LEV_25:  '#4A7AE0',
  LEV_50:  '#E88D00',
  LEV_100: '#E03E35',
  CUM_LONG:  '#D93830',
  CUM_SHORT: '#1AAB9F',
  CURRENT_LINE: 'rgba(17, 17, 19, 0.25)',
  CURRENT_ARROW: '#111113',
  CURRENT_LABEL: 'rgba(17, 17, 19, 0.6)',
  BAR_ALPHA: 0.92,
}

const FONTS = {
  AXIS: '500 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  PRICE: '600 10px var(--font-mono)',
  AMOUNT: '500 10px var(--font-mono)',
}

function getTheme(dayMode) { return dayMode ? LIGHT : DARK }

export const LEVERAGE_TIERS = [
  { lev: 10,  key: 'lev10',  color: DARK.LEV_10,  label: '10x Leverage' },
  { lev: 25,  key: 'lev25',  color: DARK.LEV_25,  label: '25x Leverage' },
  { lev: 50,  key: 'lev50',  color: DARK.LEV_50,  label: '50x Leverage' },
  { lev: 100, key: 'lev100', color: DARK.LEV_100, label: '100x Leverage' },
]

const MARGINS = { LEFT: 68, RIGHT: 68, TOP: 14, BOTTOM: 52 }

/* ─── Format helpers ─── */
function fmtAmount(v) {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'B'
  if (v >= 1) return v.toFixed(2) + 'M'
  if (v >= 0.01) return (v * 1000).toFixed(0) + 'K'
  return '0'
}

function fmtAxisPrice(price) {
  if (price >= 10000) return '$' + (price / 1000).toFixed(0) + 'K'
  if (price >= 1000) return '$' + Math.round(price).toLocaleString()
  if (price >= 1) return '$' + price.toFixed(2)
  return '$' + price.toFixed(4)
}

/**
 * Generate liquidation map data from OHLCV bars.
 * Estimates liquidation clusters based on volume profile + leverage distribution.
 */
export function generateLiquidationMap(bars) {
  if (!bars || bars.length < 5) return null

  const currentPrice = bars[bars.length - 1].c
  const range = currentPrice * 0.12
  const priceStart = currentPrice - range
  const priceEnd = currentPrice + range
  const BIN_COUNT = 80
  const binWidth = (priceEnd - priceStart) / BIN_COUNT

  const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
    priceMid: priceStart + (i + 0.5) * binWidth,
    lev10: 0, lev25: 0, lev50: 0, lev100: 0,
    total: 0,
  }))

  const levWeights = [
    { lev: 10, w: 0.40, key: 'lev10' },
    { lev: 25, w: 0.30, key: 'lev25' },
    { lev: 50, w: 0.18, key: 'lev50' },
    { lev: 100, w: 0.12, key: 'lev100' },
  ]

  const avgVolume = bars.reduce((s, b) => s + b.v, 0) / bars.length

  for (let bi = 0; bi < bars.length; bi++) {
    const bar = bars[bi]
    const recency = 0.25 + 0.75 * (bi / (bars.length - 1))
    const volNorm = Math.min(3, bar.v / avgVolume)
    const barRange = bar.h - bar.l
    if (barRange <= 0) continue

    // Distribute entry positions across the bar's price range
    const entries = [
      { price: bar.c, w: 0.35 },
      { price: (bar.o + bar.c) / 2, w: 0.25 },
      { price: bar.o, w: 0.20 },
      { price: (bar.h + bar.c) / 2, w: 0.10 },
      { price: (bar.l + bar.c) / 2, w: 0.10 },
    ]

    for (const entry of entries) {
      const posUSD = bar.v * entry.price * entry.w * volNorm * recency * 0.004
      for (const { lev, w, key } of levWeights) {
        const amt = posUSD * w / 1e6

        // Long liquidation: below entry
        const longLiqP = entry.price * (1 - 0.85 / lev)
        const lbi = Math.floor((longLiqP - priceStart) / binWidth)
        if (lbi >= 0 && lbi < BIN_COUNT) {
          bins[lbi][key] += amt
          bins[lbi].total += amt
        }

        // Short liquidation: above entry
        const shortLiqP = entry.price * (1 + 0.85 / lev)
        const sbi = Math.floor((shortLiqP - priceStart) / binWidth)
        if (sbi >= 0 && sbi < BIN_COUNT) {
          bins[sbi][key] += amt
          bins[sbi].total += amt
        }
      }
    }
  }

  // Current price bin index
  const cpIdx = Math.max(0, Math.min(BIN_COUNT - 1, Math.floor((currentPrice - priceStart) / binWidth)))

  // Cumulative lines
  const cumLong = new Array(BIN_COUNT).fill(0)
  const cumShort = new Array(BIN_COUNT).fill(0)
  let cL = 0, cS = 0
  for (let i = cpIdx; i >= 0; i--) { cL += bins[i].total; cumLong[i] = cL }
  for (let i = cpIdx; i < BIN_COUNT; i++) { cS += bins[i].total; cumShort[i] = cS }

  return {
    bins, cumLong, cumShort,
    currentPrice, cpIdx, priceStart, priceEnd, binWidth,
    binCount: BIN_COUNT,
    maxBar: Math.max(...bins.map(b => b.total), 0.01),
    maxCum: Math.max(
      ...cumLong.filter(v => v > 0),
      ...cumShort.filter(v => v > 0),
      0.01
    ),
  }
}

/**
 * Draw the Coinglass-style liquidation map onto a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 * @param {Object} data - from generateLiquidationMap
 * @param {string} filter - 'both' | 'long' | 'short'
 * @param {boolean} dayMode - light theme
 */
export function drawLiquidationMap(canvas, container, data, filter = 'both', dayMode = false) {
  if (!data || !canvas || !container) return
  const C = getTheme(dayMode)
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = container.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height
  const cL = MARGINS.LEFT, cR = W - MARGINS.RIGHT
  const cT = MARGINS.TOP, cB = H - MARGINS.BOTTOM
  const cW = cR - cL, cH = cB - cT

  const { bins, cumLong, cumShort, currentPrice, cpIdx, priceStart, priceEnd, binCount, maxBar, maxCum } = data

  // Filter: compute effective max for visible bars
  let effectiveMaxBar = maxBar
  if (filter !== 'both') {
    let fMax = 0
    for (let i = 0; i < binCount; i++) {
      const show = filter === 'long' ? i <= cpIdx : i >= cpIdx
      if (show && bins[i].total > fMax) fMax = bins[i].total
    }
    effectiveMaxBar = Math.max(fMax, 0.01)
  }

  const barW = cW / binCount
  const scaleBar = (v) => (v / effectiveMaxBar) * cH * 0.75
  const scaleCum = (v) => (v / maxCum) * cH * 0.85
  const priceToX = (price) => cL + ((price - priceStart) / (priceEnd - priceStart)) * cW

  // ── Background ──
  ctx.fillStyle = C.BG
  ctx.fillRect(0, 0, W, H)

  // ── Y-axis left grid + labels (bar amounts) ──
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.font = FONTS.AMOUNT
  const ySteps = 5
  for (let i = 0; i <= ySteps; i++) {
    const val = (effectiveMaxBar * 0.75 / ySteps) * i
    const y = cB - scaleBar(val)
    // Grid line
    ctx.strokeStyle = C.GRID
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(cL, y); ctx.lineTo(cR, y); ctx.stroke()
    // Label
    ctx.fillStyle = C.AXIS_TEXT
    ctx.fillText(fmtAmount(val), cL - 6, y)
  }

  // ── Y-axis right labels (cumulative amounts) ──
  ctx.textAlign = 'left'
  for (let i = 0; i <= ySteps; i++) {
    const val = (maxCum * 0.85 / ySteps) * i
    const y = cB - scaleCum(val)
    ctx.fillStyle = C.AXIS_TEXT
    ctx.fillText(fmtAmount(val), cR + 6, y)
  }

  // ── Draw bars ──
  const gap = Math.max(0.5, barW * 0.08)
  const drawBarW = barW - gap
  const tierKeys = ['lev10', 'lev25', 'lev50', 'lev100']
  const tierColors = [C.LEV_10, C.LEV_25, C.LEV_50, C.LEV_100]

  for (let i = 0; i < binCount; i++) {
    const bin = bins[i]
    if (bin.total < 0.001) continue

    // Apply filter
    const isLong = i < cpIdx
    const isShort = i > cpIdx
    if (filter === 'long' && !isLong) continue
    if (filter === 'short' && !isShort) continue

    const x = cL + i * barW + gap / 2
    let stackY = cB

    // Draw stacked tiers bottom-to-top
    for (let ti = 0; ti < tierKeys.length; ti++) {
      const val = bin[tierKeys[ti]]
      if (val < 0.0001) continue
      const h = scaleBar(val)
      const topY = stackY - h

      ctx.fillStyle = tierColors[ti]
      ctx.globalAlpha = i === cpIdx ? 0.25 : C.BAR_ALPHA

      // Rounded top only on the last visible tier
      const isTopTier = ti === tierKeys.length - 1 || tierKeys.slice(ti + 1).every(k => bin[k] < 0.0001)
      if (isTopTier && h > 3 && drawBarW > 3) {
        const r = Math.min(2.5, drawBarW / 4, h / 2)
        ctx.beginPath()
        ctx.moveTo(x, stackY)
        ctx.lineTo(x, topY + r)
        ctx.quadraticCurveTo(x, topY, x + r, topY)
        ctx.lineTo(x + drawBarW - r, topY)
        ctx.quadraticCurveTo(x + drawBarW, topY, x + drawBarW, topY + r)
        ctx.lineTo(x + drawBarW, stackY)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.fillRect(x, topY, drawBarW, h)
      }
      stackY = topY
    }
    ctx.globalAlpha = 1
  }

  // ── Cumulative Long line (red, going left from current price) ──
  ctx.save()
  ctx.beginPath()
  ctx.rect(cL, cT, cW, cH)
  ctx.clip()

  // Cumulative long
  ctx.beginPath()
  ctx.strokeStyle = C.CUM_LONG
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  let started = false
  for (let i = cpIdx; i >= 0; i--) {
    if (cumLong[i] === 0 && !started) continue
    const x = cL + (i + 0.5) * barW
    const y = cB - scaleCum(cumLong[i])
    if (!started) { ctx.moveTo(x, y); started = true }
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  // Glow (subtle in light mode)
  ctx.strokeStyle = C.CUM_LONG
  ctx.globalAlpha = dayMode ? 0.08 : 0.15
  ctx.lineWidth = 8
  ctx.stroke()
  ctx.globalAlpha = 1

  // Cumulative short
  ctx.beginPath()
  ctx.strokeStyle = C.CUM_SHORT
  ctx.lineWidth = 2.5
  started = false
  for (let i = cpIdx; i < binCount; i++) {
    if (cumShort[i] === 0 && !started) continue
    const x = cL + (i + 0.5) * barW
    const y = cB - scaleCum(cumShort[i])
    if (!started) { ctx.moveTo(x, y); started = true }
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.strokeStyle = C.CUM_SHORT
  ctx.globalAlpha = dayMode ? 0.08 : 0.15
  ctx.lineWidth = 8
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.restore()

  // ── Current price indicator ──
  const cpX = priceToX(currentPrice)
  ctx.strokeStyle = C.CURRENT_LINE
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  ctx.beginPath(); ctx.moveTo(cpX, cT); ctx.lineTo(cpX, cB); ctx.stroke()
  ctx.setLineDash([])

  // Arrow at top
  ctx.fillStyle = C.CURRENT_ARROW
  ctx.beginPath()
  ctx.moveTo(cpX, cT + 2)
  ctx.lineTo(cpX - 5, cT + 10)
  ctx.lineTo(cpX + 5, cT + 10)
  ctx.closePath()
  ctx.fill()

  // Current price label below chart
  ctx.font = '600 11px var(--font-mono)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const cpLabel = 'Current Price:' + fmtAxisPrice(currentPrice).replace('$', '')
  ctx.fillStyle = C.CURRENT_LABEL
  ctx.fillText(cpLabel, cpX, cB + 24)

  // ── Border separators ──
  ctx.strokeStyle = C.SEPARATOR
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cL, cT); ctx.lineTo(cL, cB); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cR, cT); ctx.lineTo(cR, cB); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cL, cB); ctx.lineTo(cR, cB); ctx.stroke()

  // ── X-axis price labels ──
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = FONTS.PRICE
  const xLabelCount = Math.min(10, binCount)
  const xLabelInterval = Math.max(1, Math.floor(binCount / xLabelCount))
  for (let i = 0; i < binCount; i += xLabelInterval) {
    const price = priceStart + (i + 0.5) * data.binWidth
    const x = cL + (i + 0.5) * barW
    ctx.fillStyle = C.AXIS_TEXT
    ctx.fillText(fmtAxisPrice(price), x, cB + 6)
  }

  // ── Store dims for tooltip ──
  canvas._mapDims = {
    cL, cR, cT, cB, cW, cH, barW,
    priceStart, priceEnd, binCount, bins, cpIdx,
    currentPrice, cumLong, cumShort,
    effectiveMaxBar, maxCum,
    scaleBar, scaleCum,
  }
}

/**
 * Handle mouse move on liquidation map — compute tooltip data.
 */
export function handleMapMouseMove(e, setTooltip) {
  const canvas = e.target
  if (!canvas || !canvas._mapDims) return
  const d = canvas._mapDims
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  if (x < d.cL || x > d.cR || y < d.cT || y > d.cB) {
    setTooltip(t => t.visible ? { ...t, visible: false } : t)
    return
  }

  const binIdx = Math.floor((x - d.cL) / d.barW)
  if (binIdx < 0 || binIdx >= d.binCount) {
    setTooltip(t => t.visible ? { ...t, visible: false } : t)
    return
  }

  const bin = d.bins[binIdx]
  const isLong = binIdx < d.cpIdx
  const distPct = ((bin.priceMid - d.currentPrice) / d.currentPrice * 100)
  const snappedX = d.cL + (binIdx + 0.5) * d.barW

  setTooltip({
    visible: true,
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    snappedX,
    price: bin.priceMid,
    side: isLong ? 'Long Liquidation' : 'Short Liquidation',
    sideClass: isLong ? 'long' : 'short',
    distance: (distPct >= 0 ? '+' : '') + distPct.toFixed(2) + '%',
    lev10: bin.lev10,
    lev25: bin.lev25,
    lev50: bin.lev50,
    lev100: bin.lev100,
    total: bin.total,
    cumLong: d.cumLong[binIdx] || 0,
    cumShort: d.cumShort[binIdx] || 0,
    dims: { cL: d.cL, cR: d.cR, cT: d.cT, cB: d.cB },
  })
}

export function handleMapMouseLeave(setTooltip) {
  setTooltip(t => t.visible ? { visible: false } : t)
}
