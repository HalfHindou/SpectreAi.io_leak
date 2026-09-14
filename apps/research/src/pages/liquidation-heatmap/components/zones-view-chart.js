/**
 * Zones View Chart — simplified liquidation zone overlay on a price line chart.
 * Pure function module (no React). Generates zone data and draws to canvas.
 */

/* ─── Color constants ─── */
const DARK = {
  BG: '#0a0a12',
  GRID: 'rgba(255, 255, 255, 0.03)',
  AXIS_TEXT: 'rgba(255, 255, 255, 0.45)',
  PRICE_LINE: '#f5f5f7',
  PRICE_GLOW: 'rgba(245, 245, 247, 0.1)',
  CURRENT_DASH: 'rgba(245, 245, 247, 0.3)',
  CURRENT_PILL_BG: 'rgba(245, 245, 247, 0.12)',
  CURRENT_PILL_TEXT: '#f5f5f7',
  ZONE_LONG: [239, 68, 68],      // --bear red family
  ZONE_SHORT: [16, 185, 129],    // --bull green family
  ZONE_LABEL_ALPHA: 0.5,
  ARROW: 'rgba(255, 255, 255, 0.25)',
}

const LIGHT = {
  BG: '#f8f8fa',
  GRID: 'rgba(0, 0, 0, 0.05)',
  AXIS_TEXT: 'rgba(17, 17, 19, 0.4)',
  PRICE_LINE: '#111113',
  PRICE_GLOW: 'rgba(17, 17, 19, 0.06)',
  CURRENT_DASH: 'rgba(17, 17, 19, 0.25)',
  CURRENT_PILL_BG: 'rgba(17, 17, 19, 0.08)',
  CURRENT_PILL_TEXT: '#111113',
  ZONE_LONG: [220, 50, 50],
  ZONE_SHORT: [14, 160, 112],
  ZONE_LABEL_ALPHA: 0.4,
  ARROW: 'rgba(0, 0, 0, 0.15)',
}

const FONTS = {
  AXIS: '500 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  PRICE: '600 10px var(--font-mono)',
  ZONE_LABEL: '600 9px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  PILL: '600 11px var(--font-mono)',
}

const MARGINS = { LEFT: 60, RIGHT: 16, TOP: 12, BOTTOM: 36 }

function getTheme(dayMode) { return dayMode ? LIGHT : DARK }

/* ─── Format helpers ─── */
function fmtAxisPrice(price) {
  if (price >= 100000) return '$' + (price / 1000).toFixed(0) + 'K'
  if (price >= 10000) return '$' + (price / 1000).toFixed(1) + 'K'
  if (price >= 1000) return '$' + Math.round(price).toLocaleString()
  if (price >= 1) return '$' + price.toFixed(2)
  return '$' + price.toFixed(4)
}

function fmtTimeLabel(timestamp) {
  const d = new Date(timestamp * 1000)
  const month = d.toLocaleString('en', { month: 'short' })
  const day = d.getDate()
  const hours = d.getHours().toString().padStart(2, '0')
  const mins = d.getMinutes().toString().padStart(2, '0')
  return `${month} ${day} ${hours}:${mins}`
}

/* ─── Zone generation ─── */

// 🪤 Zones are the top slice of the field's OWN density distribution, NOT an
// absolute matrix value. This was an absolute `DENSITY_THRESHOLD = 0.35`, which
// could never be met: the matrix is normalized so the single hottest CELL is
// 1.0, but a zone is tested on a row AVERAGED across every column, so a row
// would have to sit at peak intensity for the whole window to clear 0.35. The
// hottest row actually averages ~0.27 (BTC) / ~0.32 (SOL). So `rawZones` was
// always empty, `riskScore` was pinned at 0, and this tab read "0/100 LOW"
// while the header card on the same screen read "High".
//
// A percentile is used rather than a fraction of the peak because the field's
// SHAPE varies as much as its scale — peak/median ranges ~1.6x to ~5.6x across
// assets, so any fraction-of-peak cut over-segments a flat field (SOL 3d: 6
// zones) while returning nothing on a spiky one (BTC 24h clears 70% of peak on
// only 3 scattered rows, none of them adjacent). Measured across 4 assets x the
// 3 timeframes this tab offers, p80 yields 1-3 zones in all 12 combinations.
// This also matches `computeKeyLevels` (liquidation-page.jsx), which ranks
// top-N rows, so the two reads now agree by construction.
const DENSITY_PERCENTILE = 0.8
// A percentile always finds a top 20%, so a featureless field would still
// manufacture zones. Real data never dips below p80/median = 1.17, making this
// a no-op there while a uniform field (median 0) yields nothing.
const MIN_STRUCTURE_RATIO = 1.15
const MIN_CONSECUTIVE_ROWS = 3
const MERGE_GAP = 2

/**
 * Generate zone data from heatmap matrix and candle bars.
 * @param {Object} heatmapData - from useLiquidationHeatmap (matrix, priceMin, priceMax, priceRows, currentPrice, numCols)
 * @param {Array} candleBars - OHLCV bars [{ o, h, l, c, v, t }]
 * @returns {Object|null}
 */
export function generateZonesData(heatmapData, candleBars) {
  if (!heatmapData || !candleBars || candleBars.length < 5) return null

  const { matrix, priceMin: heatPriceMin, priceMax: heatPriceMax, priceRows, currentPrice, numCols } = heatmapData
  const priceStep = (heatPriceMax - heatPriceMin) / priceRows

  // 1. Aggregate row-wise: average density across all columns for each row
  const rowAvgs = new Array(priceRows)
  for (let row = 0; row < priceRows; row++) {
    let sum = 0
    for (let col = 0; col < numCols; col++) {
      sum += matrix[col][row]
    }
    rowAvgs[row] = sum / numCols
  }

  // 2. Find contiguous ranges of the densest rows in THIS field (min consecutive
  //    rows). Comparing against the median rather than dividing by it keeps a
  //    uniform field (median 0) at zero zones instead of producing NaN.
  const ascRowAvgs = [...rowAvgs].sort((a, b) => a - b)
  const peakRowAvg = ascRowAvgs[ascRowAvgs.length - 1]
  const medianRowAvg = ascRowAvgs[Math.floor(ascRowAvgs.length / 2)]
  const densityFloor = ascRowAvgs[Math.min(ascRowAvgs.length - 1, Math.floor(ascRowAvgs.length * DENSITY_PERCENTILE))]
  const hasStructure = densityFloor > medianRowAvg * MIN_STRUCTURE_RATIO
  const rawZones = []
  let zoneStart = -1
  for (let row = 0; row <= priceRows; row++) {
    const above = hasStructure && row < priceRows && rowAvgs[row] > densityFloor
    if (above && zoneStart === -1) {
      zoneStart = row
    } else if (!above && zoneStart !== -1) {
      if (row - zoneStart >= MIN_CONSECUTIVE_ROWS) {
        rawZones.push({ startRow: zoneStart, endRow: row - 1 })
      }
      zoneStart = -1
    }
  }

  // 3. Merge nearby zones (gap < MERGE_GAP rows)
  const merged = []
  for (const zone of rawZones) {
    if (merged.length > 0) {
      const prev = merged[merged.length - 1]
      if (zone.startRow - prev.endRow <= MERGE_GAP) {
        prev.endRow = zone.endRow
        continue
      }
    }
    merged.push({ ...zone })
  }

  // 4. Build zone objects with price ranges and density
  const zones = merged.map(z => {
    let densitySum = 0
    let count = 0
    for (let row = z.startRow; row <= z.endRow; row++) {
      densitySum += rowAvgs[row]
      count++
    }
    // Normalized against the peak row for the same reason as the threshold —
    // raw row averages top out near 0.3, so feeding them to riskScore below
    // (proximity x density x 100) capped the score at ~30 and the tab could
    // never report anything above "Moderate", even with a cluster at spot.
    const avgDensity = densitySum / count / peakRowAvg
    const zonePriceMin = heatPriceMin + z.startRow * priceStep
    const zonePriceMax = heatPriceMin + (z.endRow + 1) * priceStep
    const zoneCenter = (zonePriceMin + zonePriceMax) / 2
    const side = zoneCenter > currentPrice ? 'short' : 'long'
    return {
      priceMin: zonePriceMin,
      priceMax: zonePriceMax,
      avgDensity: Math.min(1, avgDensity),
      side,
      label: side === 'long' ? 'Long Liquidation Zone' : 'Short Liquidation Zone',
    }
  })

  // 5. Price line from candle bars
  const priceLine = candleBars.map(bar => ({ time: bar.t, close: bar.c }))

  // Chart Y range from bars (with padding)
  let barsMin = Infinity, barsMax = -Infinity
  for (const bar of candleBars) {
    if (bar.l < barsMin) barsMin = bar.l
    if (bar.h > barsMax) barsMax = bar.h
  }
  const barRange = barsMax - barsMin
  const chartPriceMin = barsMin - barRange * 0.05
  const chartPriceMax = barsMax + barRange * 0.05

  // 6. Risk score: based on highest density zone proximity to current price
  let riskScore = 0
  if (zones.length > 0) {
    let maxRisk = 0
    for (const zone of zones) {
      const zoneCenter = (zone.priceMin + zone.priceMax) / 2
      const distPct = Math.abs((zoneCenter - currentPrice) / currentPrice) * 100
      // Closer + denser = higher risk
      const proximityFactor = Math.max(0, 1 - distPct / 10) // 0 at 10%+ away, 1 at current price
      const zoneRisk = proximityFactor * zone.avgDensity * 100
      if (zoneRisk > maxRisk) maxRisk = zoneRisk
    }
    riskScore = Math.round(Math.min(100, maxRisk))
  }

  let riskLabel = 'Low'
  if (riskScore >= 80) riskLabel = 'Extreme'
  else if (riskScore >= 60) riskLabel = 'High'
  else if (riskScore >= 40) riskLabel = 'Moderate-High'
  else if (riskScore >= 20) riskLabel = 'Moderate'

  // 7. Signals: top 2-4 zones as plain English text
  const sortedZones = [...zones].sort((a, b) => b.avgDensity - a.avgDensity).slice(0, 4)
  const signals = sortedZones.map(zone => {
    const zoneCenter = (zone.priceMin + zone.priceMax) / 2
    const distPct = ((zoneCenter - currentPrice) / currentPrice) * 100
    const distStr = (distPct >= 0 ? '+' : '') + distPct.toFixed(1) + '%'
    const priceStr = fmtAxisPrice(zoneCenter)

    let text
    if (zone.side === 'long') {
      text = `Strong long cluster at ${priceStr} (${distStr})`
    } else {
      text = `Short squeeze risk above ${priceStr} (${distStr})`
    }
    return { text, side: zone.side }
  })

  return {
    priceLine,
    zones,
    riskScore,
    riskLabel,
    signals,
    currentPrice,
    priceMin: chartPriceMin,
    priceMax: chartPriceMax,
  }
}


/* ─── Canvas drawing ─── */

/**
 * Draw the zones chart onto a canvas with high-DPI scaling.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 * @param {Object} data - from generateZonesData
 * @param {boolean} dayMode
 */
export function drawZonesChart(canvas, container, data, dayMode = false) {
  if (!data || !canvas || !container) return

  const C = getTheme(dayMode)
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = container.getBoundingClientRect()

  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const W = rect.width
  const H = rect.height
  const cL = MARGINS.LEFT
  const cR = W - MARGINS.RIGHT
  const cT = MARGINS.TOP
  const cB = H - MARGINS.BOTTOM
  const cW = cR - cL
  const cH = cB - cT

  const { priceLine, zones, currentPrice, priceMin, priceMax } = data
  const priceRange = priceMax - priceMin

  // Helpers
  const priceToY = (price) => cB - ((price - priceMin) / priceRange) * cH
  const timeToX = (idx) => cL + (idx / (priceLine.length - 1)) * cW

  // ── 1. Background ──
  ctx.fillStyle = C.BG
  ctx.fillRect(0, 0, W, H)

  // ── 2. Y-axis grid lines + price labels ──
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.font = FONTS.PRICE

  const ySteps = 6
  const priceStepSize = priceRange / ySteps
  for (let i = 0; i <= ySteps; i++) {
    const price = priceMin + priceStepSize * i
    const y = priceToY(price)

    // Grid line
    ctx.strokeStyle = C.GRID
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(cL, y)
    ctx.lineTo(cR, y)
    ctx.stroke()

    // Price label
    ctx.fillStyle = C.AXIS_TEXT
    ctx.fillText(fmtAxisPrice(price), cL - 6, y)
  }

  // ── 3. X-axis time labels ──
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = FONTS.AXIS

  const xLabelCount = Math.min(6, priceLine.length)
  const xLabelInterval = Math.max(1, Math.floor(priceLine.length / xLabelCount))
  for (let i = 0; i < priceLine.length; i += xLabelInterval) {
    const x = timeToX(i)
    ctx.fillStyle = C.AXIS_TEXT
    ctx.fillText(fmtTimeLabel(priceLine[i].time), x, cB + 6)
  }

  // ── 4. Zone bands (drawn FIRST, behind everything) ──
  for (const zone of zones) {
    const yTop = priceToY(zone.priceMax)
    const yBot = priceToY(zone.priceMin)
    const zoneH = yBot - yTop
    if (zoneH < 1) continue

    const rgb = zone.side === 'long' ? C.ZONE_LONG : C.ZONE_SHORT
    const fillAlpha = 0.04 + zone.avgDensity * 0.12
    const borderAlpha = fillAlpha + 0.08

    // Zone fill
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${fillAlpha})`
    ctx.fillRect(cL, yTop, cW, zoneH)

    // Top/bottom borders
    ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${borderAlpha})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cL, yTop)
    ctx.lineTo(cR, yTop)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cL, yBot)
    ctx.lineTo(cR, yBot)
    ctx.stroke()

    // Zone label at right edge
    ctx.font = FONTS.ZONE_LABEL
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const labelText = zone.side === 'long' ? 'LONG LIQ ZONE' : 'SHORT LIQ ZONE'
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${C.ZONE_LABEL_ALPHA})`
    const labelY = yTop + zoneH / 2
    // Only draw if zone is tall enough
    if (zoneH > 14) {
      ctx.fillText(labelText, cR - 4, labelY)
    }

    // Small arrows pointing toward current price from zone edges
    const cpY = priceToY(currentPrice)
    const arrowX = cL + 14
    ctx.fillStyle = C.ARROW
    if (zone.side === 'long') {
      // Zone is below current price — arrow pointing UP from zone top
      const ay = yTop
      if (ay > cpY + 8) {
        ctx.beginPath()
        ctx.moveTo(arrowX, ay - 2)
        ctx.lineTo(arrowX - 4, ay + 6)
        ctx.lineTo(arrowX + 4, ay + 6)
        ctx.closePath()
        ctx.fill()
      }
    } else {
      // Zone is above current price — arrow pointing DOWN from zone bottom
      const ay = yBot
      if (ay < cpY - 8) {
        ctx.beginPath()
        ctx.moveTo(arrowX, ay + 2)
        ctx.lineTo(arrowX - 4, ay - 6)
        ctx.lineTo(arrowX + 4, ay - 6)
        ctx.closePath()
        ctx.fill()
      }
    }
  }

  // ── 5. Price line with glow ──
  if (priceLine.length > 1) {
    // Glow pass
    ctx.save()
    ctx.beginPath()
    ctx.rect(cL, cT, cW, cH)
    ctx.clip()

    ctx.beginPath()
    ctx.strokeStyle = C.PRICE_GLOW
    ctx.lineWidth = 8
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (let i = 0; i < priceLine.length; i++) {
      const x = timeToX(i)
      const y = priceToY(priceLine[i].close)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Main line
    ctx.beginPath()
    ctx.strokeStyle = C.PRICE_LINE
    ctx.lineWidth = 2
    for (let i = 0; i < priceLine.length; i++) {
      const x = timeToX(i)
      const y = priceToY(priceLine[i].close)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.restore()
  }

  // ── 6. Current price: dashed horizontal line + pill label ──
  const cpY = priceToY(currentPrice)
  if (cpY >= cT && cpY <= cB) {
    ctx.strokeStyle = C.CURRENT_DASH
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(cL, cpY)
    ctx.lineTo(cR, cpY)
    ctx.stroke()
    ctx.setLineDash([])

    // Price pill at right edge
    const pillText = fmtAxisPrice(currentPrice)
    ctx.font = FONTS.PILL
    const pillW = ctx.measureText(pillText).width + 12
    const pillH = 20
    const pillX = cR - pillW - 2
    const pillY = cpY - pillH / 2

    // Pill background
    const pillR = 4
    ctx.fillStyle = C.CURRENT_PILL_BG
    ctx.beginPath()
    ctx.moveTo(pillX + pillR, pillY)
    ctx.lineTo(pillX + pillW - pillR, pillY)
    ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR)
    ctx.lineTo(pillX + pillW, pillY + pillH - pillR)
    ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH)
    ctx.lineTo(pillX + pillR, pillY + pillH)
    ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR)
    ctx.lineTo(pillX, pillY + pillR)
    ctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY)
    ctx.closePath()
    ctx.fill()

    // Pill text
    ctx.fillStyle = C.CURRENT_PILL_TEXT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(pillText, pillX + pillW / 2, pillY + pillH / 2)
  }

  // ── Store dims for tooltip ──
  canvas._zonesDims = {
    cL, cR, cT, cB, cW, cH,
    priceMin, priceMax, priceRange,
    priceLine, zones, currentPrice,
    priceToY, timeToX,
  }
}


/* ─── Tooltip handlers ─── */

/**
 * Handle mouse move on zones chart — compute tooltip data.
 */
export function handleZonesMouseMove(e, setTooltip) {
  const canvas = e.target
  if (!canvas || !canvas._zonesDims) return

  const d = canvas._zonesDims
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  if (x < d.cL || x > d.cR || y < d.cT || y > d.cB) {
    setTooltip(t => t.visible ? { ...t, visible: false } : t)
    return
  }

  // Price at cursor Y position
  const priceAtY = d.priceMax - ((y - d.cT) / d.cH) * d.priceRange

  // Find closest price line point for X
  const pctX = (x - d.cL) / d.cW
  const idx = Math.round(pctX * (d.priceLine.length - 1))
  const clampedIdx = Math.max(0, Math.min(d.priceLine.length - 1, idx))
  const linePoint = d.priceLine[clampedIdx]
  const snappedX = d.timeToX(clampedIdx)
  const snappedY = d.priceToY(linePoint.close)

  // Check if cursor is inside a zone
  let activeZone = null
  for (const zone of d.zones) {
    if (priceAtY >= zone.priceMin && priceAtY <= zone.priceMax) {
      activeZone = zone
      break
    }
  }

  setTooltip({
    visible: true,
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    snappedX,
    snappedY,
    price: linePoint.close,
    time: linePoint.time,
    zone: activeZone,
    dims: { cL: d.cL, cR: d.cR, cT: d.cT, cB: d.cB },
  })
}

/**
 * Handle mouse leave on zones chart.
 */
export function handleZonesMouseLeave(setTooltip) {
  setTooltip(t => t.visible ? { visible: false } : t)
}
