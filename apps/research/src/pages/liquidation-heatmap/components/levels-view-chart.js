/**
 * Levels View Chart — Hero time-series chart with horizontal liquidation level BANDS.
 * Y-axis: price, X-axis: time (standard trading chart orientation).
 * Liquidation bands are the DOMINANT visual element — glowing colored zones.
 * Thin candlesticks overlaid on top. Right-edge price pills for each level.
 */

/* ─── Leverage tiers (kept for legend compatibility) ─── */
export const LEVERAGE_TIERS = [
  { lev: 10, key: 'lev10', label: '10x Leverage', color: '#3B82F6' },
  { lev: 25, key: 'lev25', label: '25x Leverage', color: '#06B6D4' },
  { lev: 50, key: 'lev50', label: '50x Leverage', color: '#F59E0B' },
  { lev: 100, key: 'lev100', label: '100x Leverage', color: '#EF4444' },
]

/* ─── Layout constants ─── */
const LEFT_MARGIN = 10
const RIGHT_MARGIN = 112
const TOP_MARGIN = 16
const BOTTOM_MARGIN = 36

/* ─── Pill sizing ─── */
const PILL_W = 96
const PILL_H = 30
const PILL_GAP = 2
const PILL_X_OFFSET = 10

/* ─── Font stacks ─── */
const MONO = 'var(--font-mono), var(--font-mono), ui-monospace, monospace'
const SYSTEM = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'

/* ─── Helpers ─── */
function formatPrice(price) {
  if (price >= 10000) return '$' + (price / 1000).toFixed(1) + 'K'
  if (price >= 1000) return '$' + price.toFixed(0)
  if (price >= 1) return '$' + price.toFixed(2)
  return '$' + price.toFixed(4)
}

function formatAmount(amount) {
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(1) + 'B'
  if (amount >= 1) return '$' + amount.toFixed(1) + 'M'
  return '$' + (amount * 1000).toFixed(0) + 'K'
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function niceGridStep(range, targetSteps) {
  const rough = range / targetSteps
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / pow
  let nice
  if (norm <= 1.5) nice = 1
  else if (norm <= 3) nice = 2
  else if (norm <= 7) nice = 5
  else nice = 10
  return nice * pow
}

/**
 * Generate levels data from candle bars + liquidation heatmap data.
 * Aggregates row densities from the heatmap matrix and picks top 8-12 peak levels.
 *
 * @param {Array} candleBars - Array of { t, o, h, l, c, v } from Binance
 * @param {Object} liqHeatmapData - { bars, matrix, priceMin, priceMax, priceRows, currentPrice, numCols }
 * @returns {Object|null}
 */
export function generateLevelsData(candleBars, liqHeatmapData) {
  if (!candleBars || candleBars.length < 5) return null
  if (!liqHeatmapData || !liqHeatmapData.matrix) return null

  const { matrix, priceMin, priceMax, priceRows, currentPrice, numCols } = liqHeatmapData
  const priceStep = (priceMax - priceMin) / priceRows

  // 1. Aggregate each row's density across ALL columns
  const rowDensity = new Array(priceRows).fill(0)
  let maxDensity = 0
  for (let col = 0; col < numCols; col++) {
    const colData = matrix[col]
    if (!colData) continue
    for (let row = 0; row < priceRows; row++) {
      rowDensity[row] += colData[row] || 0
    }
  }
  for (let row = 0; row < priceRows; row++) {
    if (rowDensity[row] > maxDensity) maxDensity = rowDensity[row]
  }
  if (maxDensity === 0) maxDensity = 1

  // Normalize
  for (let row = 0; row < priceRows; row++) {
    rowDensity[row] /= maxDensity
  }

  // 2. Find peaks — pick independently from long side (below current) and
  //    short side (above current) so a long-heavy order book can't starve shorts.
  const MIN_DENSITY = 0.02
  const MIN_GAP = 3
  const PER_SIDE_TARGET = 6
  const PER_SIDE_MAX = 8
  const MAX_PEAKS = 12

  const currentRow = (currentPrice - priceMin) / priceStep

  // Collect all local maxima, tagged by side relative to currentPrice
  const longCandidates = []
  const shortCandidates = []
  const pushCandidate = (row, density) => {
    if (density <= MIN_DENSITY) return
    const c = { row, density }
    if (row < currentRow) longCandidates.push(c)
    else shortCandidates.push(c)
  }

  for (let r = 1; r < priceRows - 1; r++) {
    if (rowDensity[r] > rowDensity[r - 1] && rowDensity[r] >= rowDensity[r + 1]) {
      pushCandidate(r, rowDensity[r])
    }
  }
  // Edges
  if (priceRows > 0 && rowDensity[0] >= (rowDensity[1] || 0)) {
    pushCandidate(0, rowDensity[0])
  }
  if (priceRows > 1 && rowDensity[priceRows - 1] >= rowDensity[priceRows - 2]) {
    pushCandidate(priceRows - 1, rowDensity[priceRows - 1])
  }

  longCandidates.sort((a, b) => b.density - a.density)
  shortCandidates.sort((a, b) => b.density - a.density)

  // Greedy pick from a candidate list respecting min gap against existing peaks
  const pickPeaks = (candidates, existing, limit, minGap) => {
    const result = []
    for (const c of candidates) {
      if (result.length >= limit) break
      const tooClose = existing.some(p => Math.abs(p.row - c.row) < minGap)
             || result.some(p => Math.abs(p.row - c.row) < minGap)
      if (!tooClose) result.push(c)
    }
    return result
  }

  let peaks = []
  peaks = peaks.concat(pickPeaks(longCandidates, peaks, PER_SIDE_TARGET, MIN_GAP))
  peaks = peaks.concat(pickPeaks(shortCandidates, peaks, PER_SIDE_TARGET, MIN_GAP))

  // If slots remain up to MAX_PEAKS, pull extras (tighter gap) from whichever side has them
  const remainingSlots = () => Math.max(0, MAX_PEAKS - peaks.length)
  if (remainingSlots() > 0) {
    const longCount = peaks.filter(p => p.row < currentRow).length
    const shortCount = peaks.length - longCount
    const longRoom = Math.min(remainingSlots(), PER_SIDE_MAX - longCount)
    if (longRoom > 0) peaks = peaks.concat(pickPeaks(longCandidates, peaks, longRoom, 2))
    const shortRoom = Math.min(remainingSlots(), PER_SIDE_MAX - shortCount)
    if (shortRoom > 0) peaks = peaks.concat(pickPeaks(shortCandidates, peaks, shortRoom, 2))
  }

  // 3. Build level objects
  const maxPeakDensity = peaks.length > 0 ? Math.max(...peaks.map(p => p.density)) : 1

  const levels = peaks.map(p => {
    const price = priceMin + (p.row + 0.5) * priceStep
    const side = price < currentPrice ? 'long' : 'short'
    const intensity = p.density / maxPeakDensity

    // Check if any candle bar has grabbed this level
    let grabbed = false
    let grabbedCol = -1
    for (let i = 0; i < candleBars.length; i++) {
      const bar = candleBars[i]
      if (side === 'long' && bar.l <= price) {
        grabbed = true
        grabbedCol = i
        break
      }
      if (side === 'short' && bar.h >= price) {
        grabbed = true
        grabbedCol = i
        break
      }
    }

    // 2026-05-26 beta-quality fix: removed Math.random() jitter on liquidation estimates.
    // estAmount is a heuristic derived from density intensity — keep it deterministic so
    // the same level shows the same number on every render (no shimmering tooltips).
    const estAmount = intensity * 60

    return { price, side, intensity, estAmount, grabbed, grabbedCol, row: p.row }
  })

  // Sort levels by price for consistent rendering
  levels.sort((a, b) => a.price - b.price)

  // 4. Magnet: non-grabbed level closest to currentPrice with highest intensity
  let magnetPrice = null
  let magnetScore = -1
  for (const lvl of levels) {
    if (lvl.grabbed) continue
    const dist = Math.abs(lvl.price - currentPrice)
    const score = lvl.intensity / (1 + dist / currentPrice)
    if (score > magnetScore) {
      magnetScore = score
      magnetPrice = lvl.price
    }
  }

  return {
    candles: candleBars,
    levels,
    currentPrice,
    magnetPrice,
    priceMin: liqHeatmapData.priceMin,
    priceMax: liqHeatmapData.priceMax,
    numCols: liqHeatmapData.numCols,
  }
}

/**
 * Draw the levels chart onto a canvas.
 * Rendering order (back to front):
 *   1. Background
 *   2. Subtle grid
 *   3. Liquidation zone bands (HERO — glowing filled horizontal bands)
 *   4. Right-edge price pills
 *   5. Thin candlesticks (overlaid on bands)
 *   6. Current price dashed line + pill
 *   7. Magnet arrow
 *   8. Axes labels
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 * @param {Object} data - from generateLevelsData
 * @param {string} filter - 'both' | 'long' | 'short'
 * @param {boolean} dayMode
 */
export function drawLevelsChart(canvas, container, data, filter = 'both', dayMode = false) {
  if (!data || !canvas || !container) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = container.getBoundingClientRect()

  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = rect.width + 'px'
  canvas.style.height = rect.height + 'px'
  ctx.scale(dpr, dpr)

  const W = rect.width
  const H = rect.height
  const cL = LEFT_MARGIN
  const cR = W - RIGHT_MARGIN
  const cT = TOP_MARGIN
  const cB = H - BOTTOM_MARGIN
  const cW = cR - cL
  const cH = cB - cT

  const { candles, levels, currentPrice, magnetPrice, priceMin, priceMax, numCols } = data

  // Scale helpers
  const scaleY = (price) => cT + (1 - (price - priceMin) / (priceMax - priceMin)) * cH

  // ── 1. Background ──
  ctx.fillStyle = dayMode ? '#f8f9fa' : '#0a0a12'
  ctx.fillRect(0, 0, W, H)

  // ── 2. Subtle grid lines ──
  const priceRange = priceMax - priceMin
  const gridStep = niceGridStep(priceRange, 6)
  const gridStart = Math.ceil(priceMin / gridStep) * gridStep

  ctx.strokeStyle = dayMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  for (let p = gridStart; p <= priceMax; p += gridStep) {
    const y = scaleY(p)
    if (y < cT || y > cB) continue
    ctx.beginPath()
    ctx.moveTo(cL, y)
    ctx.lineTo(cR, y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Filter visible levels once, sort by price (top to bottom on screen = high to low price)
  const visibleLevels = levels
    .filter((lvl) => {
      if (filter === 'long' && lvl.side === 'short') return false
      if (filter === 'short' && lvl.side === 'long') return false
      const y = scaleY(lvl.price)
      return y >= cT - 30 && y <= cB + 30
    })
    .map((lvl) => ({ ...lvl, y: scaleY(lvl.price) }))
    .sort((a, b) => a.y - b.y)

  // ── 3. LIQUIDATION ZONE BANDS — softer, cleaner, intensity-driven ──
  for (const level of visibleLevels) {
    const { y, side, intensity, grabbed } = level
    const isLong = side === 'long'
    const fade = grabbed ? 0.35 : 1.0

    const r = isLong ? 239 : 16
    const g = isLong ? 68 : 185
    const b = isLong ? 68 : 129

    // Band width is thinner now: 2-6px half, gentler visual weight
    const bandHalf = 2 + intensity * 4
    const glowHalf = bandHalf * 2.4

    // Single soft glow (one pass, not three) — gradient for organic feel
    const glowGrad = ctx.createLinearGradient(0, y - glowHalf, 0, y + glowHalf)
    const peakAlpha = (0.10 + intensity * 0.22) * fade
    glowGrad.addColorStop(0, `rgba(${r},${g},${b},0)`)
    glowGrad.addColorStop(0.5, `rgba(${r},${g},${b},${peakAlpha})`)
    glowGrad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = glowGrad
    ctx.fillRect(cL, y - glowHalf, cW, glowHalf * 2)

    // Crisp center line — stronger when intense
    const lineAlpha = (0.45 + intensity * 0.4) * fade
    ctx.strokeStyle = `rgba(${r},${g},${b},${lineAlpha})`
    ctx.lineWidth = grabbed ? 1 : 1 + intensity * 1.5
    if (grabbed) ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(cL, y)
    ctx.lineTo(cR, y)
    ctx.stroke()
    if (grabbed) ctx.setLineDash([])

    // Grabbed marker — minimal pulse dot (no starburst chaos)
    if (grabbed && level.grabbedCol >= 0) {
      const grabX = cL + (level.grabbedCol / numCols) * cW
      ctx.save()
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`
      ctx.beginPath()
      ctx.arc(grabX, y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = dayMode ? 'rgba(255,255,255,0.9)' : 'rgba(245,245,247,0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(grabX, y, 5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // ── 4. Right-edge PRICE PILLS (with collision resolution) ──
  // Assign each pill a target Y (= band Y), then relax pushing overlapping
  // neighbors apart while keeping them as close to target as possible.
  const pillTotalH = PILL_H + PILL_GAP
  const pills = visibleLevels.map((lvl) => ({
    level: lvl,
    targetY: lvl.y,
    y: lvl.y,
  }))

  // Simple top-down sweep: if current pill overlaps the previous, push it down.
  for (let i = 1; i < pills.length; i++) {
    const prev = pills[i - 1]
    const minY = prev.y + pillTotalH
    if (pills[i].y < minY) pills[i].y = minY
  }
  // Bottom-up sweep: if any pill has been pushed below viewport, pull up the chain.
  const maxBottom = cB + 10
  for (let i = pills.length - 1; i >= 0; i--) {
    const p = pills[i]
    const maxY = i === pills.length - 1 ? maxBottom - PILL_H : pills[i + 1].y - pillTotalH
    if (p.y > maxY) p.y = maxY
  }
  // Top-down again to eliminate any residual overlap after clamp
  for (let i = 1; i < pills.length; i++) {
    const prev = pills[i - 1]
    const minY = prev.y + pillTotalH
    if (pills[i].y < minY) pills[i].y = minY
  }

  const pillX = cR + PILL_X_OFFSET

  for (const p of pills) {
    const { level, y: pillY, targetY } = p
    const isLong = level.side === 'long'
    const fade = level.grabbed ? 0.55 : 1.0

    const r = isLong ? 239 : 16
    const g = isLong ? 68 : 185
    const b = isLong ? 68 : 129

    // Connector line from band to pill if displaced
    const displaced = Math.abs(pillY + PILL_H / 2 - targetY) > 1
    if (displaced) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.25 * fade})`
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(cR, targetY)
      ctx.lineTo(pillX, pillY + PILL_H / 2)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Pill background (flatter, cleaner)
    const bgAlpha = (level.grabbed ? 0.07 : 0.14) * (dayMode ? 0.55 : 1)
    ctx.fillStyle = `rgba(${r},${g},${b},${bgAlpha})`
    roundRect(ctx, pillX, pillY, PILL_W, PILL_H, 7)
    ctx.fill()

    // Left accent stripe — identity marker
    ctx.fillStyle = `rgba(${r},${g},${b},${0.85 * fade})`
    roundRect(ctx, pillX, pillY, 3, PILL_H, 7)
    ctx.fill()

    // Border
    ctx.strokeStyle = `rgba(${r},${g},${b},${(level.grabbed ? 0.12 : 0.22) * (dayMode ? 0.7 : 1)})`
    ctx.lineWidth = 1
    roundRect(ctx, pillX, pillY, PILL_W, PILL_H, 7)
    ctx.stroke()

    // Price (top row)
    const priceColor = isLong ? '#F87171' : '#34D399'
    ctx.fillStyle = level.grabbed
      ? (dayMode ? 'rgba(100,100,100,0.55)' : 'rgba(200,200,200,0.45)')
      : priceColor
    ctx.font = `700 12px ${MONO}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(formatPrice(level.price), pillX + 9, pillY + 10)

    // Amount (bottom row, muted)
    ctx.fillStyle = dayMode ? 'rgba(0,0,0,0.42)' : 'rgba(245,245,247,0.5)'
    ctx.font = `500 10px ${MONO}`
    ctx.fillText('~' + formatAmount(level.estAmount), pillX + 9, pillY + 22)

    // Intensity tick on far right of pill (mini-bar)
    const tickX = pillX + PILL_W - 8
    const tickTopY = pillY + 6
    const tickH = PILL_H - 12
    ctx.fillStyle = dayMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'
    ctx.fillRect(tickX, tickTopY, 3, tickH)
    ctx.fillStyle = `rgba(${r},${g},${b},${0.7 * fade})`
    ctx.fillRect(tickX, tickTopY + tickH * (1 - level.intensity), 3, tickH * level.intensity)
  }

  // ── 5. Thin candlesticks (overlaid on bands) ──
  const candleW = Math.max(1, Math.min(3, (cW / numCols) * 0.35))
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]
    const x = cL + (i + 0.5) * (cW / numCols)
    const isGreen = bar.c >= bar.o

    // Wick — thin hairline, slightly brighter to read over bands
    ctx.strokeStyle = dayMode ? 'rgba(0,0,0,0.35)' : 'rgba(245,245,247,0.45)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, scaleY(bar.h))
    ctx.lineTo(x, scaleY(bar.l))
    ctx.stroke()

    // Body — fully opaque so candles stay legible across the red/green wash
    ctx.fillStyle = isGreen
      ? (dayMode ? 'rgba(16,185,129,1)' : 'rgba(52,211,153,1)')
      : (dayMode ? 'rgba(239,68,68,1)' : 'rgba(248,113,113,1)')
    const bodyTop = scaleY(Math.max(bar.o, bar.c))
    const bodyBot = scaleY(Math.min(bar.o, bar.c))
    const bodyH = Math.max(1, bodyBot - bodyTop)
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH)
  }

  // ── 6. Current price dashed line + pill ──
  const cpY = scaleY(currentPrice)
  ctx.strokeStyle = 'rgba(247, 147, 26, 0.8)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(cL, cpY)
  ctx.lineTo(cR, cpY)
  ctx.stroke()
  ctx.setLineDash([])

  // Current price right-edge pill (matches level-pill width, slightly shorter)
  const cpPillW = PILL_W
  const cpPillH = 22
  const cpPillX = cR + PILL_X_OFFSET
  const cpPillY = cpY - cpPillH / 2
  ctx.fillStyle = dayMode ? 'rgba(247,147,26,0.14)' : 'rgba(247,147,26,0.28)'
  roundRect(ctx, cpPillX, cpPillY, cpPillW, cpPillH, 7)
  ctx.fill()
  ctx.strokeStyle = 'rgba(247,147,26,0.4)'
  ctx.lineWidth = 1
  roundRect(ctx, cpPillX, cpPillY, cpPillW, cpPillH, 7)
  ctx.stroke()
  // Left accent stripe to match level pills
  ctx.fillStyle = 'rgba(247,147,26,0.9)'
  roundRect(ctx, cpPillX, cpPillY, 3, cpPillH, 7)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 180, 60, 1)'
  ctx.font = `700 12px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(formatPrice(currentPrice), cpPillX + 9, cpY)

  // ── 7. Magnet indicator ──
  if (magnetPrice != null) {
    const dir = magnetPrice > currentPrice ? -1 : 1 // arrow direction in Y space (inverted)
    const arrowX = cR - 20
    const arrowBaseY = cpY + dir * 8
    const arrowTipY = cpY + dir * 24

    ctx.fillStyle = dayMode ? 'rgba(0,0,0,0.25)' : 'rgba(245,245,247,0.35)'
    ctx.beginPath()
    ctx.moveTo(arrowX, arrowTipY)
    ctx.lineTo(arrowX - 5, arrowBaseY)
    ctx.lineTo(arrowX + 5, arrowBaseY)
    ctx.closePath()
    ctx.fill()

    // Label
    ctx.font = `600 9px ${SYSTEM}`
    ctx.textAlign = 'center'
    ctx.textBaseline = dir > 0 ? 'top' : 'bottom'
    ctx.fillStyle = dayMode ? 'rgba(0,0,0,0.3)' : 'rgba(245,245,247,0.30)'
    ctx.fillText('MAGNET', arrowX, arrowTipY + dir * 3)
  }

  // ── 8a. Y-axis labels (left gutter — pills own the right side now) ──
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `500 10px ${MONO}`
  ctx.fillStyle = dayMode ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.32)'

  // Only show extreme top/bottom labels to give price orientation without clutter
  const extremes = [priceMax, priceMin]
  for (const p of extremes) {
    const y = scaleY(p)
    if (y < cT + 4 || y > cB - 4) continue
    ctx.fillText(formatPrice(p), cL + 4, y)
  }

  // ── 8b. X-axis labels (bottom) ──
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = `500 10px ${SYSTEM}`
  ctx.fillStyle = dayMode ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)'

  const labelCount = Math.min(8, Math.max(3, Math.floor(cW / 80)))
  const step = Math.max(1, Math.floor(candles.length / labelCount))
  for (let i = 0; i < candles.length; i += step) {
    const bar = candles[i]
    const x = cL + (i + 0.5) * (cW / numCols)
    if (x < cL + 20 || x > cR - 20) continue
    // 🪤 `bar.t` is epoch SECONDS (levels-view.jsx's tooltip already does
    // `time * 1000`). This axis passed it straight to `new Date()`, i.e. read
    // seconds as milliseconds — so every tick landed in Jan 1970 and, because
    // consecutive bars then differed by milliseconds, they ALL printed the same
    // minute. On screen: "1/21 16:53, 1/21 16:54, 1/21 16:54, 1/21 16:54…".
    // Magnitude guard so it still works if the source ever switches to ms.
    const d = new Date(bar.t < 1e12 ? bar.t * 1000 : bar.t)
    const label = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    ctx.fillText(label, x, cB + 6)
  }

  // ── Store dims for tooltip ──
  canvas._levelsDims = {
    cL, cR, cT, cB, cW, cH,
    priceMin: data.priceMin,
    priceMax: data.priceMax,
    numCols: data.numCols,
    candles: data.candles,
    levels: data.levels,
    currentPrice: data.currentPrice,
    filter,
  }

  // Return visible-level count so the component can show an empty-state hint
  return { visibleLevelCount: visibleLevels.length }
}

/**
 * Handle mouse move on levels chart — compute tooltip data.
 */
export function handleLevelsMouseMove(e, setTooltip) {
  const canvas = e.target
  if (!canvas || !canvas._levelsDims) return
  const d = canvas._levelsDims
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  if (mx < d.cL || mx > d.cR || my < d.cT || my > d.cB) {
    setTooltip(t => t.visible ? { ...t, visible: false } : t)
    return
  }

  const priceRange = d.priceMax - d.priceMin
  const cursorPrice = d.priceMax - ((my - d.cT) / d.cH) * priceRange

  // Find nearest candle
  const colWidth = d.cW / d.numCols
  const candleIdx = Math.round((mx - d.cL) / colWidth - 0.5)
  const clampedIdx = Math.max(0, Math.min(d.candles.length - 1, candleIdx))
  const nearestCandle = d.candles[clampedIdx]
  const snappedX = d.cL + (clampedIdx + 0.5) * colWidth

  // Find nearest liquidation level — respect current filter
  const filter = d.filter || 'both'
  let nearestLevel = null
  let minDist = Infinity
  for (const lvl of d.levels) {
    if (filter === 'long' && lvl.side === 'short') continue
    if (filter === 'short' && lvl.side === 'long') continue
    const dist = Math.abs(lvl.price - cursorPrice)
    if (dist < minDist) {
      minDist = dist
      nearestLevel = lvl
    }
  }

  setTooltip({
    visible: true,
    x: mx,
    y: my,
    price: cursorPrice,
    time: nearestCandle ? nearestCandle.t : null,
    nearestLevel,
    snappedX,
    dims: { cT: d.cT, cB: d.cB },
  })
}

/**
 * Handle mouse leave on levels chart.
 */
export function handleLevelsMouseLeave(setTooltip) {
  setTooltip(t => t.visible ? { visible: false } : t)
}
