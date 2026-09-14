/**
 * Liquidation Heatmap — pure canvas rendering logic.
 * Extracted from WelcomePage for maintainability.
 * All functions are stateless; React state is passed as parameters.
 */

/**
 * Generate a density matrix from real BTC candle data.
 * Produces persistent horizontal bands at key levels (Coinglass-style).
 * @param {Array} bars - OHLCV candle bars
 * @returns {Object|null} heatmap data { bars, matrix, priceMin, priceMax, priceRows, currentPrice, numCols }
 */
export function generateLiquidationMatrix(bars) {
  if (!bars || bars.length === 0) return null
  const allHighs = bars.map(b => b.h)
  const allLows = bars.map(b => b.l)
  const dataMin = Math.min(...allLows)
  const dataMax = Math.max(...allHighs)
  const currentPrice = bars[bars.length - 1].c
  const range = dataMax - dataMin
  const priceMin = dataMin - range * 0.08
  const priceMax = dataMax + range * 0.08
  const PRICE_ROWS = 120
  const priceStep = (priceMax - priceMin) / PRICE_ROWS
  const numCols = bars.length
  const avgVolume = bars.reduce((s, b) => s + b.v, 0) / bars.length
  const seededRandom = (seed) => { let x = Math.sin(seed * 9301 + 49297) * 49311; return x - Math.floor(x) }

  // Key levels: every $1000 and $500 for persistent band clustering
  const keyLevels1000 = [], keyLevels500 = [], keyLevels250 = []
  const rMin = Math.floor(priceMin / 250) * 250
  const rMax = Math.ceil(priceMax / 250) * 250
  for (let p = rMin; p <= rMax; p += 250) {
    if (p % 1000 === 0) keyLevels1000.push(p)
    else if (p % 500 === 0) keyLevels500.push(p)
    else keyLevels250.push(p)
  }

  // Precompute per-column rolling mid price for proximity calc
  const colMidPrices = bars.map(b => (b.h + b.l) / 2)

  // Build full matrix directly per-column
  const matrix = Array.from({ length: numCols }, () => new Float32Array(PRICE_ROWS))
  for (let col = 0; col < numCols; col++) {
    const bar = bars[col]
    const barMid = colMidPrices[col]
    const volWeight = 0.6 + 0.4 * Math.min(2.5, bar.v / avgVolume)

    // Compute a local "price gravity center" using nearby bars (±10)
    let gravityPrice = 0, gravityW = 0
    for (let k = Math.max(0, col - 10); k <= Math.min(numCols - 1, col + 10); k++) {
      const w = 1 / (1 + Math.abs(k - col))
      gravityPrice += colMidPrices[k] * w
      gravityW += w
    }
    gravityPrice /= gravityW

    for (let row = 0; row < PRICE_ROWS; row++) {
      const priceAtRow = priceMin + (row + 0.5) * priceStep

      // 1) Proximity to LOCAL price action (not just current price) → bands follow price
      const normDist = Math.abs(priceAtRow - gravityPrice) / range
      const proximityBase = 0.35 + 0.65 * Math.exp(-normDist * 1.4)

      // 2) Key-level clustering: strong Gaussian bumps at round numbers
      let levelBump = 0
      for (const lv of keyLevels1000) {
        const d = Math.abs(priceAtRow - lv) / priceStep
        levelBump += 1.8 * Math.exp(-(d * d) / 55)
      }
      for (const lv of keyLevels500) {
        const d = Math.abs(priceAtRow - lv) / priceStep
        levelBump += 1.0 * Math.exp(-(d * d) / 40)
      }
      for (const lv of keyLevels250) {
        const d = Math.abs(priceAtRow - lv) / priceStep
        levelBump += 0.4 * Math.exp(-(d * d) / 25)
      }
      levelBump = Math.min(levelBump, 3.5)

      // 3) Wick proximity — extra brightness near this bar's high/low/close
      const dHigh = Math.abs(priceAtRow - bar.h) / priceStep
      const dLow = Math.abs(priceAtRow - bar.l) / priceStep
      const dClose = Math.abs(priceAtRow - bar.c) / priceStep
      const wickBoost = 1.0 + 1.0 * Math.exp(-(dHigh * dHigh) / 14)
                            + 1.0 * Math.exp(-(dLow * dLow) / 14)
                            + 0.5 * Math.exp(-(dClose * dClose) / 22)

      // 4) Slight long/short asymmetry
      const sideW = priceAtRow > barMid ? 1.08 : 0.92

      // 5) Persistent row noise for organic horizontal streaks
      const rowNoise = 0.55 + 0.45 * seededRandom(row * 137 + 7)
      // 6) Per-cell micro noise
      const cellNoise = 0.75 + 0.25 * seededRandom(col * PRICE_ROWS + row + 42)

      // 7) Recency boost: recent candles get amplified density (liquidation builds up)
      const recency = 0.65 + 0.35 * (col / (numCols - 1))

      matrix[col][row] = proximityBase * (0.2 + levelBump * 0.8) * wickBoost * volWeight * sideW * rowNoise * cellNoise * recency
    }
  }

  // Normalize to [0, 1]
  let maxIntensity = 0
  for (let col = 0; col < numCols; col++) for (let row = 0; row < PRICE_ROWS; row++) if (matrix[col][row] > maxIntensity) maxIntensity = matrix[col][row]
  if (maxIntensity > 0) for (let col = 0; col < numCols; col++) for (let row = 0; row < PRICE_ROWS; row++) matrix[col][row] /= maxIntensity

  // Power curve — steep exponent pushes low values to near-black, hot zones POP
  // CoinGlass-style: extreme contrast between dead zones (black) and hot spots (vivid)
  for (let col = 0; col < numCols; col++) for (let row = 0; row < PRICE_ROWS; row++) {
    let v = matrix[col][row]
    // Steeper power curve: 0.1^0.85 = 0.14 (nearly invisible), 0.8^0.85 = 0.83 (vivid)
    v = Math.pow(v, 0.85)
    // Near-zero ambient — only a whisper of structure in dead zones
    matrix[col][row] = Math.max(v, 0.005)
  }

  return { bars, matrix, priceMin, priceMax, priceRows: PRICE_ROWS, currentPrice, numCols }
}

// CoinGlass blue-cyan-green-yellow color ramp (matches real-heatmap-chart.js)
const _CG_RAMP = [
  [9, 9, 11],       // void
  [10, 10, 34],     // faint indigo
  [14, 16, 62],     // deep indigo
  [12, 30, 96],     // dark blue
  [8, 50, 136],     // blue
  [4, 78, 164],     // bright blue
  [0, 114, 182],    // blue-cyan
  [0, 150, 176],    // cyan
  [0, 176, 150],    // teal
  [8, 196, 114],    // teal-green
  [36, 212, 74],    // green
  [96, 222, 46],    // lime
  [170, 228, 26],   // yellow-green
  [234, 220, 16],   // yellow
]

// --- Axis style constants (Apple HIG dark mode) ---
const AXIS = {
  LABEL_COLOR: 'rgba(255, 255, 255, 0.55)',
  FONT: '500 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  PRICE_FONT: '500 11px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  CURRENT_FONT: '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  GRID_MAJOR: 'rgba(255, 255, 255, 0.045)',
  GRID_MINOR: 'rgba(255, 255, 255, 0.02)',
  SEPARATOR: 'rgba(255, 255, 255, 0.08)',
  TICK_LEN: 5,
  TICK_COLOR: 'rgba(255, 255, 255, 0.12)',
  CP_COLOR: 'rgba(247, 147, 26, 0.90)',
  CP_LINE: 'rgba(247, 147, 26, 0.45)',
  CP_BADGE_BG: 'rgba(247, 147, 26, 0.15)',
  CP_BADGE_BORDER: 'rgba(247, 147, 26, 0.35)',
  BG: '#0a0812',
}

const AXIS_LIGHT = {
  LABEL_COLOR: 'rgba(17, 17, 19, 0.50)',
  FONT: AXIS.FONT,
  PRICE_FONT: AXIS.PRICE_FONT,
  CURRENT_FONT: AXIS.CURRENT_FONT,
  GRID_MAJOR: 'rgba(0, 0, 0, 0.06)',
  GRID_MINOR: 'rgba(0, 0, 0, 0.03)',
  SEPARATOR: 'rgba(0, 0, 0, 0.10)',
  TICK_LEN: 5,
  TICK_COLOR: 'rgba(0, 0, 0, 0.12)',
  CP_COLOR: 'rgba(220, 120, 0, 0.95)',
  CP_LINE: 'rgba(220, 120, 0, 0.40)',
  CP_BADGE_BG: 'rgba(220, 120, 0, 0.10)',
  CP_BADGE_BORDER: 'rgba(220, 120, 0, 0.30)',
  BG: '#f8f8fa',
}

function getAxisTheme(dayMode) { return dayMode ? AXIS_LIGHT : AXIS }

/** Clean price label for axis display: $65,333 or $1.23 */
function formatAxisPrice(price) {
  if (price >= 1000) return '$' + Math.round(price).toLocaleString()
  if (price >= 1) return '$' + price.toFixed(2)
  return '$' + price.toFixed(4)
}

/** Context-aware time label: 24h→HH:MM, 3d→MM/DD HH:MM, 7d→Day MM/DD */
export function formatAxisTime(timestamp, timeframe) {
  const d = new Date(timestamp * 1000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  if (timeframe === '24h') return `${hh}:${mm}`
  if (timeframe === '7d') return `${days[d.getDay()]} ${mo}/${dd}`
  return `${mo}/${dd} ${hh}:${mm}`
}

/**
 * Draw the liquidation heatmap onto a canvas element.
 * Supports an optional viewport for pan/zoom (renders only the visible slice).
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 * @param {Object} liqHeatmapData - output of generateLiquidationMatrix
 * @param {Function} fmtPrice - price formatter function
 * @param {Object} [viewport] - { startCol, endCol, visiblePriceMin, visiblePriceMax }
 * @param {string} [sensitivity='med'] - 'low' | 'med' | 'high'
 * @param {string} [timeframe='24h'] - '24h' | '3d' | '7d'
 */
export function drawLiquidationCanvas(canvas, container, liqHeatmapData, fmtPrice, viewport, sensitivity = 'med', timeframe = '24h', dayMode = false) {
  if (!liqHeatmapData || !canvas || !container) return
  const A = getAxisTheme(dayMode)
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = container.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height
  // TOP_MARGIN 22 leaves a clear band at the top so the highest price axis
  // label never collides with overlaid toolbar buttons / sticky chrome that
  // sit on the same canvas container on mobile.
  const LEFT_MARGIN = 44, RIGHT_MARGIN = 65, TOP_MARGIN = 22, BOTTOM_MARGIN = 28
  const cL = LEFT_MARGIN, cR = W - RIGHT_MARGIN, cT = TOP_MARGIN, cB = H - BOTTOM_MARGIN
  const cW = cR - cL, cH = cB - cT
  const { bars, matrix, priceMin, priceMax, priceRows, currentPrice, numCols } = liqHeatmapData
  const globalPriceStep = (priceMax - priceMin) / priceRows

  // Viewport bounds — fall back to full data when no viewport provided
  const startCol = Math.max(0, viewport?.startCol ?? 0)
  const endCol = Math.min(numCols, viewport?.endCol ?? numCols)
  const viewPriceMin = viewport?.visiblePriceMin ?? priceMin
  const viewPriceMax = viewport?.visiblePriceMax ?? priceMax
  const viewCols = endCol - startCol
  const viewPriceRange = viewPriceMax - viewPriceMin

  const colW = cW / viewCols
  const scaleY = (price) => cB - ((price - viewPriceMin) / viewPriceRange) * cH

  // Background
  ctx.fillStyle = A.BG
  ctx.fillRect(0, 0, W, H)

  // Heatmap colormap — CoinGlass purple palette
  // Render to small offscreen canvas at matrix resolution, then scale up
  // with bilinear interpolation for smooth, flowing band aesthetic
  const gamma = sensitivity === 'high' ? 0.3 : sensitivity === 'low' ? 0.8 : 0.5

  // Determine visible price rows for the offscreen canvas
  const visRowStart = Math.max(0, Math.floor((viewPriceMin - priceMin) / globalPriceStep) - 1)
  const visRowEnd = Math.min(priceRows, Math.ceil((viewPriceMax - priceMin) / globalPriceStep) + 1)
  const visRows = visRowEnd - visRowStart

  if (viewCols > 0 && visRows > 0) {
    // Small offscreen canvas: 1 pixel per matrix cell
    const offW = viewCols
    const offH = visRows
    const offCanvas = document.createElement('canvas')
    offCanvas.width = offW
    offCanvas.height = offH
    const offCtx = offCanvas.getContext('2d')
    const offImg = offCtx.createImageData(offW, offH)
    const px = offImg.data

    for (let col = startCol; col < endCol; col++) {
      const x = col - startCol
      for (let row = visRowStart; row < visRowEnd; row++) {
        const raw = matrix[col][row]
        if (raw < 0.02) continue // skip truly empty cells
        const t = Math.pow(raw, gamma)
        let r, g, b, a
        // CoinGlass-style blue-cyan-green-yellow ramp
        const ci = t * 13 // 14 color stops (0-13)
        const lo = Math.floor(ci)
        const hi = Math.min(lo + 1, 13)
        const f = ci - lo
        const CR = _CG_RAMP
        r = Math.round(CR[lo][0] + (CR[hi][0] - CR[lo][0]) * f)
        g = Math.round(CR[lo][1] + (CR[hi][1] - CR[lo][1]) * f)
        b = Math.round(CR[lo][2] + (CR[hi][2] - CR[lo][2]) * f)
        a = t < 0.06 ? Math.round(t / 0.06 * 80) : Math.min(255, Math.round(80 + t * 175))
        // Y is inverted: row 0 = priceMin = bottom, but canvas Y=0 = top
        const y = offH - 1 - (row - visRowStart)
        const idx = (y * offW + x) * 4
        // Alpha composite over existing
        const existA = px[idx + 3] / 255
        const newA = a / 255
        const outA = newA + existA * (1 - newA)
        if (outA > 0) {
          px[idx]     = Math.round((r * newA + px[idx] * existA * (1 - newA)) / outA)
          px[idx + 1] = Math.round((g * newA + px[idx + 1] * existA * (1 - newA)) / outA)
          px[idx + 2] = Math.round((b * newA + px[idx + 2] * existA * (1 - newA)) / outA)
          px[idx + 3] = Math.round(outA * 255)
        }
      }
    }
    offCtx.putImageData(offImg, 0, 0)

    // Scale up with smooth interpolation → flowing bands, no pixel dots
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(offCanvas, cL, cT, cW, cH)
    ctx.restore()
  }

  // Draw candlesticks (only visible columns) — clip to chart area
  ctx.save()
  ctx.beginPath()
  ctx.rect(cL, cT, cW, cH)
  ctx.clip()
  const candleW = Math.max(1.5, colW * 0.45)
  for (let col = startCol; col < endCol; col++) {
    const bar = bars[col]
    const viewCol = col - startCol
    const x = cL + viewCol * colW + colW / 2
    const isGreen = bar.c >= bar.o
    const bodyColor = isGreen ? 'rgba(52, 211, 153, 0.85)' : 'rgba(239, 83, 80, 0.85)'
    const wickColor = isGreen ? 'rgba(52, 211, 153, 0.7)' : 'rgba(239, 83, 80, 0.7)'
    const highY = scaleY(bar.h)
    const lowY = scaleY(bar.l)
    if (highY > cB + 50 || lowY < cT - 50) continue // far out of view
    ctx.strokeStyle = wickColor
    ctx.lineWidth = Math.max(0.8, candleW * 0.15)
    ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke()
    const oY = scaleY(bar.o), cY2 = scaleY(bar.c)
    const bodyTop = Math.min(oY, cY2)
    const bodyH = Math.max(1, Math.abs(oY - cY2))
    ctx.fillStyle = bodyColor
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH)
    ctx.strokeStyle = dayMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH)
  }
  ctx.restore()

  // --- Chart boundary separator lines ---
  ctx.strokeStyle = A.SEPARATOR
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cR, cT); ctx.lineTo(cR, cB); ctx.stroke() // right
  ctx.beginPath(); ctx.moveTo(cL, cB); ctx.lineTo(cR, cB); ctx.stroke() // bottom
  ctx.beginPath(); ctx.moveTo(cL, cT); ctx.lineTo(cL, cB); ctx.stroke() // left

  // --- Y-axis price labels (right side, monospace) ---
  ctx.textAlign = 'left'
  const priceSteps = 6
  for (let i = 0; i <= priceSteps; i++) {
    const price = viewPriceMin + (viewPriceRange / priceSteps) * i
    const y = scaleY(price)
    // Horizontal grid line
    ctx.strokeStyle = A.GRID_MAJOR
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(cL, y); ctx.lineTo(cR, y); ctx.stroke()
    // Tick mark
    ctx.strokeStyle = A.TICK_COLOR
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cR, y); ctx.lineTo(cR + A.TICK_LEN, y); ctx.stroke()
    // Price label
    ctx.fillStyle = A.LABEL_COLOR
    ctx.font = A.PRICE_FONT
    ctx.fillText(formatAxisPrice(price), cR + A.TICK_LEN + 4, y + 3.5)
  }

  // --- Current price indicator (pill badge) ---
  if (currentPrice >= viewPriceMin && currentPrice <= viewPriceMax) {
    const cpY = scaleY(currentPrice)
    // Dashed line across chart
    ctx.strokeStyle = A.CP_LINE
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.beginPath(); ctx.moveTo(cL, cpY); ctx.lineTo(cR, cpY); ctx.stroke()
    ctx.setLineDash([])
    // Pill badge in price axis margin
    ctx.font = A.CURRENT_FONT
    const cpText = formatAxisPrice(currentPrice)
    const cpTW = ctx.measureText(cpText).width
    const bPx = 6, bPy = 4, bR = 4
    const bW = cpTW + bPx * 2, bH = 10 + bPy * 2
    const bX = cR + 2, bY = cpY - bH / 2
    // Rounded rect background (fallback to plain rect if roundRect unavailable)
    ctx.beginPath()
    if (ctx.roundRect) { ctx.roundRect(bX, bY, bW, bH, bR) } else { ctx.rect(bX, bY, bW, bH) }
    ctx.fillStyle = A.CP_BADGE_BG
    ctx.fill()
    ctx.strokeStyle = A.CP_BADGE_BORDER
    ctx.lineWidth = 1
    ctx.stroke()
    // Price text centered in badge
    ctx.fillStyle = A.CP_COLOR
    ctx.textAlign = 'center'
    ctx.fillText(cpText, bX + bW / 2, cpY + 3.5)
    ctx.textAlign = 'left'
  }

  // --- X-axis time labels (bottom, context-aware format) ---
  ctx.textAlign = 'center'
  const labelCount = Math.min(7, viewCols)
  const labelInterval = Math.max(1, Math.floor(viewCols / labelCount))
  for (let i = 0; i < viewCols; i += labelInterval) {
    const globalIdx = startCol + i
    if (globalIdx >= bars.length) break
    const x = cL + i * colW + colW / 2
    // Vertical grid line (ultra-subtle)
    ctx.strokeStyle = A.GRID_MINOR
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(x, cT); ctx.lineTo(x, cB); ctx.stroke()
    // Tick mark below chart
    ctx.strokeStyle = A.TICK_COLOR
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, cB); ctx.lineTo(x, cB + A.TICK_LEN); ctx.stroke()
    // Time label
    ctx.fillStyle = A.LABEL_COLOR
    ctx.font = A.FONT
    ctx.fillText(formatAxisTime(bars[globalIdx].t, timeframe), x, H - 5)
  }

  // --- Left intensity bar (matches heatmap gradient) ---
  const barX = 6, barW = 12, barTop = cT + 8, barBottom = cB - 8
  const gradient = ctx.createLinearGradient(barX, barBottom, barX, barTop)
  // Purple CoinGlass-style gradient
  gradient.addColorStop(0, 'rgba(10, 4, 18, 0.15)')
  gradient.addColorStop(0.08, 'rgba(18, 7, 42, 0.40)')
  gradient.addColorStop(0.18, 'rgba(48, 15, 92, 0.65)')
  gradient.addColorStop(0.30, 'rgba(98, 30, 160, 0.82)')
  gradient.addColorStop(0.42, 'rgba(158, 48, 190, 0.92)')
  gradient.addColorStop(0.55, 'rgba(218, 83, 170, 0.97)')
  gradient.addColorStop(0.68, 'rgba(243, 135, 125, 1)')
  gradient.addColorStop(0.80, 'rgba(255, 190, 140, 1)')
  gradient.addColorStop(0.92, 'rgba(255, 225, 185, 1)')
  gradient.addColorStop(1, 'rgba(255, 250, 240, 1)')
  ctx.fillStyle = gradient
  ctx.fillRect(barX, barTop, barW, barBottom - barTop)
  ctx.strokeStyle = dayMode ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 0.5
  ctx.strokeRect(barX, barTop, barW, barBottom - barTop)
  ctx.fillStyle = dayMode ? 'rgba(17, 17, 19, 0.45)' : 'rgba(255, 255, 255, 0.45)'
  ctx.font = '500 8px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('High', barX + barW / 2, barTop - 4)
  ctx.fillText('Low', barX + barW / 2, barBottom + 10)

  // Store dims for hover — include viewport info for correct tooltip mapping
  canvas._liqDims = {
    cL, cR, cT, cB, cW, cH, colW,
    priceMin: viewPriceMin, priceMax: viewPriceMax, priceRows,
    numCols: viewCols, bars: bars.slice(startCol, endCol),
    matrix, startCol, endCol,
    globalPriceMin: priceMin, globalPriceMax: priceMax,
    timeframe,
  }
}

/**
 * Analyze the liquidation density matrix and derive AI insights.
 * Pure function — no side effects, safe for useMemo.
 * @param {Object|null} heatmapData - output of generateLiquidationMatrix
 * @returns {Object|null} AI insights object or null if no data
 */
export function analyzeLiquidationMatrix(heatmapData) {
  if (!heatmapData) return null
  const { bars, matrix, priceMin, priceMax, priceRows, currentPrice, numCols } = heatmapData
  const priceStep = (priceMax - priceMin) / priceRows
  const currentRow = Math.floor((currentPrice - priceMin) / priceStep)

  // --- Market Bias: sum density above vs below currentPrice ---
  let densityAbove = 0, densityBelow = 0
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < priceRows; row++) {
      if (row >= currentRow) densityAbove += matrix[col][row]
      else densityBelow += matrix[col][row]
    }
  }
  const totalDensity = densityAbove + densityBelow
  const longDominance = densityBelow > densityAbove // more liq below = long-heavy
  const imbalance = totalDensity > 0
    ? Math.abs(densityAbove - densityBelow) / totalDensity * 100
    : 0

  // --- Cascade Risk: count high-density row clusters (>0.7 avg intensity) ---
  const rowAvgs = new Float32Array(priceRows)
  for (let row = 0; row < priceRows; row++) {
    let sum = 0
    for (let col = 0; col < numCols; col++) sum += matrix[col][row]
    rowAvgs[row] = sum / numCols
  }
  let clusterCount = 0, inCluster = false
  for (let row = 0; row < priceRows; row++) {
    if (rowAvgs[row] > 0.7) {
      if (!inCluster) { clusterCount++; inCluster = true }
    } else {
      inCluster = false
    }
  }

  // --- Price Magnet: row with highest aggregate density ---
  let magnetRow = 0, magnetMax = 0
  for (let row = 0; row < priceRows; row++) {
    const agg = rowAvgs[row]
    if (agg > magnetMax) { magnetMax = agg; magnetRow = row }
  }
  const magnetPrice = priceMin + (magnetRow + 0.5) * priceStep
  const magnetDist = Math.abs(magnetPrice - currentPrice) / currentPrice * 100

  // --- Volume Trend: compare first-half vs second-half average volume ---
  const halfIdx = Math.floor(bars.length / 2)
  let volFirst = 0, volSecond = 0
  for (let i = 0; i < halfIdx; i++) volFirst += bars[i].v
  for (let i = halfIdx; i < bars.length; i++) volSecond += bars[i].v
  volFirst /= halfIdx || 1
  volSecond /= (bars.length - halfIdx) || 1
  const volChange = volFirst > 0 ? ((volSecond - volFirst) / volFirst * 100) : 0

  // --- Price Delta: % change over period ---
  const firstClose = bars[0]?.c || 1
  const lastClose = bars[bars.length - 1]?.c || 1
  const priceDelta = ((lastClose - firstClose) / firstClose * 100)

  const riskLevel = imbalance > 40 ? 'High' : imbalance > 20 ? 'Medium' : 'Low'

  return {
    bias: longDominance ? 'Long-Heavy' : 'Short-Heavy',
    biasColor: longDominance ? '#FF453A' : '#30D158',
    imbalance: imbalance.toFixed(1),
    riskLevel,
    riskColor: imbalance > 40 ? '#FF453A' : imbalance > 20 ? '#FF9F0A' : '#30D158',
    cascadeRisk: clusterCount > 3 ? 'Elevated' : 'Normal',
    cascadeColor: clusterCount > 3 ? '#FF9F0A' : '#30D158',
    magnetPrice: '$' + Math.round(magnetPrice).toLocaleString(),
    signals: [
      {
        label: 'Volume Trend',
        value: (volChange >= 0 ? '+' : '') + volChange.toFixed(1) + '%',
        status: Math.abs(volChange) < 10 ? 'neutral' : volChange > 0 ? 'bullish' : 'bearish',
      },
      {
        label: 'Price \u0394',
        value: (priceDelta >= 0 ? '+' : '') + priceDelta.toFixed(2) + '%',
        status: Math.abs(priceDelta) < 0.5 ? 'neutral' : priceDelta > 0 ? 'bullish' : 'bearish',
      },
      {
        label: 'Density Clusters',
        value: clusterCount.toString(),
        status: clusterCount > 3 ? 'bearish' : clusterCount > 1 ? 'neutral' : 'bullish',
      },
      {
        label: 'Magnet Distance',
        value: magnetDist.toFixed(1) + '%',
        status: magnetDist < 1 ? 'bearish' : magnetDist < 3 ? 'neutral' : 'bullish',
      },
    ],
    summary: longDominance
      ? `Heavy long liquidation clusters detected below current price. A ${imbalance.toFixed(0)}% imbalance suggests vulnerability to downside cascades. Exercise caution with leveraged long positions.`
      : `Short liquidation concentration above current price indicates squeeze potential. ${imbalance.toFixed(0)}% imbalance favors upward pressure if key resistance levels break.`,
  }
}

/**
 * Draw a standalone BTC candlestick chart onto a canvas element.
 * Reuses the same MARGINS, axis styling, and viewport system as the heatmap.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 * @param {Array} bars - OHLCV candle bars { t, o, h, l, c, v }
 * @param {Function} fmtPrice - price formatter function
 * @param {Object} [viewport] - { startCol, endCol, visiblePriceMin, visiblePriceMax }
 * @param {string} [timeframe='24h'] - '24h' | '3d' | '7d'
 */
export function drawCandleChart(canvas, container, bars, fmtPrice, viewport, timeframe = '24h', dayMode = false, liqHeatmapData = null) {
  if (!bars || !bars.length || !canvas || !container) return
  const A = getAxisTheme(dayMode)
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = container.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height
  // Match liquidation canvas top margin so price labels stay clear of the
  // overlaid chart toolbar on mobile.
  const LEFT_MARGIN = 44, RIGHT_MARGIN = 65, TOP_MARGIN = 22, BOTTOM_MARGIN = 28
  const cL = LEFT_MARGIN, cR = W - RIGHT_MARGIN, cT = TOP_MARGIN, cB = H - BOTTOM_MARGIN
  const cW = cR - cL, cH = cB - cT
  const numCols = bars.length

  // Viewport bounds
  const startCol = Math.max(0, viewport?.startCol ?? 0)
  const endCol = Math.min(numCols, viewport?.endCol ?? numCols)
  const viewCols = endCol - startCol
  const visibleBars = bars.slice(startCol, endCol)

  // Price range from viewport or compute from visible bars
  let viewPriceMin, viewPriceMax
  if (viewport?.visiblePriceMin != null) {
    viewPriceMin = viewport.visiblePriceMin
    viewPriceMax = viewport.visiblePriceMax
  } else {
    viewPriceMin = Math.min(...visibleBars.map(b => b.l))
    viewPriceMax = Math.max(...visibleBars.map(b => b.h))
    const range = viewPriceMax - viewPriceMin
    viewPriceMin -= range * 0.05
    viewPriceMax += range * 0.05
  }
  const viewPriceRange = viewPriceMax - viewPriceMin
  const colW = cW / viewCols
  const scaleY = (price) => cB - ((price - viewPriceMin) / viewPriceRange) * cH
  const currentPrice = bars[bars.length - 1].c

  // Background
  ctx.fillStyle = A.BG
  ctx.fillRect(0, 0, W, H)

  // --- Y-axis grid lines (behind candles) ---
  const priceSteps = 6
  for (let i = 0; i <= priceSteps; i++) {
    const price = viewPriceMin + (viewPriceRange / priceSteps) * i
    const y = scaleY(price)
    ctx.strokeStyle = A.GRID_MAJOR
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(cL, y); ctx.lineTo(cR, y); ctx.stroke()
  }

  // --- X-axis grid lines (behind candles) ---
  const labelCount = Math.min(7, viewCols)
  const labelInterval = Math.max(1, Math.floor(viewCols / labelCount))
  for (let i = 0; i < viewCols; i += labelInterval) {
    const x = cL + i * colW + colW / 2
    ctx.strokeStyle = A.GRID_MINOR
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(x, cT); ctx.lineTo(x, cB); ctx.stroke()
  }

  // --- Liquidation density overlay (behind candles) ---
  if (liqHeatmapData && liqHeatmapData.matrix) {
    const { matrix, priceMin: gPMin, priceMax: gPMax, priceRows, numCols: gNumCols } = liqHeatmapData
    const gPStep = (gPMax - gPMin) / priceRows
    const gamma = 0.5

    // Determine visible row range
    const visRowStart = Math.max(0, Math.floor((viewPriceMin - gPMin) / gPStep) - 1)
    const visRowEnd = Math.min(priceRows, Math.ceil((viewPriceMax - gPMin) / gPStep) + 1)
    const visRows = visRowEnd - visRowStart

    if (viewCols > 0 && visRows > 0) {
      const offW = viewCols
      const offH = visRows
      const offCanvas = document.createElement('canvas')
      offCanvas.width = offW
      offCanvas.height = offH
      const offCtx = offCanvas.getContext('2d')
      const offImg = offCtx.createImageData(offW, offH)
      const px = offImg.data

      for (let col = startCol; col < endCol; col++) {
        const x = col - startCol
        for (let row = visRowStart; row < visRowEnd; row++) {
          const raw = matrix[col]?.[row] || 0
          if (raw < 0.02) continue
          const t = Math.pow(raw, gamma)
          let r, g, b, a
          // CoinGlass-style purple palette — HIGH CONTRAST (matches drawLiquidationCanvas)
          if (t < 0.08) {
            const p = t / 0.08
            r = Math.round(10 + 8 * p)
            g = Math.round(4 + 3 * p)
            b = Math.round(18 + 24 * p)
            a = Math.round(8 + 40 * p)
          } else if (t < 0.18) {
            const p = (t - 0.08) / 0.10
            r = Math.round(18 + 30 * p)
            g = Math.round(7 + 8 * p)
            b = Math.round(42 + 50 * p)
            a = Math.round(48 + 100 * p)
          } else if (t < 0.30) {
            const p = (t - 0.18) / 0.12
            r = Math.round(48 + 50 * p)
            g = Math.round(15 + 15 * p)
            b = Math.round(92 + 68 * p)
            a = Math.round(148 + 60 * p)
          } else if (t < 0.42) {
            const p = (t - 0.30) / 0.12
            r = Math.round(98 + 60 * p)
            g = Math.round(30 + 18 * p)
            b = Math.round(160 + 30 * p)
            a = Math.round(208 + 25 * p)
          } else if (t < 0.55) {
            const p = (t - 0.42) / 0.13
            r = Math.round(158 + 60 * p)
            g = Math.round(48 + 35 * p)
            b = Math.round(190 - 20 * p)
            a = Math.round(233 + 12 * p)
          } else if (t < 0.68) {
            const p = (t - 0.55) / 0.13
            r = Math.round(218 + 25 * p)
            g = Math.round(83 + 52 * p)
            b = Math.round(170 - 45 * p)
            a = Math.round(245 + 5 * p)
          } else if (t < 0.80) {
            const p = (t - 0.68) / 0.12
            r = Math.round(243 + 10 * p)
            g = Math.round(135 + 55 * p)
            b = Math.round(125 + 15 * p)
            a = 252
          } else if (t < 0.92) {
            const p = (t - 0.80) / 0.12
            r = 255
            g = Math.round(190 + 35 * p)
            b = Math.round(140 + 45 * p)
            a = 255
          } else {
            const p = Math.min(1, (t - 0.92) / 0.08)
            r = 255
            g = Math.round(225 + 25 * p)
            b = Math.round(185 + 55 * p)
            a = 255
          }
          // Reduce alpha for overlay transparency (candles must stay prominent)
          a = Math.round(a * 0.4)

          // Y is inverted: row 0 = priceMin = bottom, but canvas Y=0 = top
          const y = offH - 1 - (row - visRowStart)
          const idx = (y * offW + x) * 4
          // Alpha composite over existing pixels
          const existA = px[idx + 3] / 255
          const newA = a / 255
          const outA = newA + existA * (1 - newA)
          if (outA > 0) {
            px[idx]     = Math.round((r * newA + px[idx] * existA * (1 - newA)) / outA)
            px[idx + 1] = Math.round((g * newA + px[idx + 1] * existA * (1 - newA)) / outA)
            px[idx + 2] = Math.round((b * newA + px[idx + 2] * existA * (1 - newA)) / outA)
            px[idx + 3] = Math.round(outA * 255)
          }
        }
      }
      offCtx.putImageData(offImg, 0, 0)

      // Scale up with smooth interpolation for flowing bands
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.globalAlpha = 0.5
      ctx.drawImage(offCanvas, cL, cT, cW, cH)
      ctx.globalAlpha = 1.0
      ctx.restore()
    }
  }

  // --- Draw candlesticks ---
  ctx.save()
  ctx.beginPath()
  ctx.rect(cL, cT, cW, cH)
  ctx.clip()
  const candleW = Math.max(2, colW * 0.6)
  for (let col = startCol; col < endCol; col++) {
    const bar = bars[col]
    const viewCol = col - startCol
    const x = cL + viewCol * colW + colW / 2
    const isGreen = bar.c >= bar.o
    const bodyColor = isGreen ? '#22c55e' : '#ef4444'
    const wickColor = isGreen ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)'
    const highY = scaleY(bar.h)
    const lowY = scaleY(bar.l)
    if (highY > cB + 50 || lowY < cT - 50) continue
    // Wick
    ctx.strokeStyle = wickColor
    ctx.lineWidth = Math.max(1, candleW * 0.12)
    ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke()
    // Body
    const oY = scaleY(bar.o), cY2 = scaleY(bar.c)
    const bodyTop = Math.min(oY, cY2)
    const bodyH = Math.max(1, Math.abs(oY - cY2))
    ctx.fillStyle = bodyColor
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH)
    // Body border for visibility
    if (candleW >= 4) {
      ctx.strokeStyle = isGreen ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
      ctx.lineWidth = 0.5
      ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH)
    }
  }
  ctx.restore()

  // --- Chart boundary separator lines ---
  ctx.strokeStyle = A.SEPARATOR
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cR, cT); ctx.lineTo(cR, cB); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cL, cB); ctx.lineTo(cR, cB); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cL, cT); ctx.lineTo(cL, cB); ctx.stroke()

  // --- Y-axis price labels (right side) ---
  ctx.textAlign = 'left'
  for (let i = 0; i <= priceSteps; i++) {
    const price = viewPriceMin + (viewPriceRange / priceSteps) * i
    const y = scaleY(price)
    ctx.strokeStyle = A.TICK_COLOR
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cR, y); ctx.lineTo(cR + A.TICK_LEN, y); ctx.stroke()
    ctx.fillStyle = A.LABEL_COLOR
    ctx.font = A.PRICE_FONT
    ctx.fillText(formatAxisPrice(price), cR + A.TICK_LEN + 4, y + 3.5)
  }

  // --- Current price indicator ---
  if (currentPrice >= viewPriceMin && currentPrice <= viewPriceMax) {
    const cpY = scaleY(currentPrice)
    ctx.strokeStyle = A.CP_LINE
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.beginPath(); ctx.moveTo(cL, cpY); ctx.lineTo(cR, cpY); ctx.stroke()
    ctx.setLineDash([])
    // Pill badge
    ctx.font = A.CURRENT_FONT
    const cpText = formatAxisPrice(currentPrice)
    const cpTW = ctx.measureText(cpText).width
    const bPx = 6, bPy = 4, bR = 4
    const bW = cpTW + bPx * 2, bH = 10 + bPy * 2
    const bX = cR + 2, bY = cpY - bH / 2
    ctx.beginPath()
    if (ctx.roundRect) { ctx.roundRect(bX, bY, bW, bH, bR) } else { ctx.rect(bX, bY, bW, bH) }
    ctx.fillStyle = A.CP_BADGE_BG
    ctx.fill()
    ctx.strokeStyle = A.CP_BADGE_BORDER
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = A.CP_COLOR
    ctx.textAlign = 'center'
    ctx.fillText(cpText, bX + bW / 2, cpY + 3.5)
    ctx.textAlign = 'left'
  }

  // --- X-axis time labels ---
  ctx.textAlign = 'center'
  for (let i = 0; i < viewCols; i += labelInterval) {
    const globalIdx = startCol + i
    if (globalIdx >= bars.length) break
    const x = cL + i * colW + colW / 2
    ctx.strokeStyle = A.TICK_COLOR
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, cB); ctx.lineTo(x, cB + A.TICK_LEN); ctx.stroke()
    ctx.fillStyle = A.LABEL_COLOR
    ctx.font = A.FONT
    ctx.fillText(formatAxisTime(bars[globalIdx].t, timeframe), x, H - 5)
  }

  // Store dims for hover (same structure as heatmap for tooltip compatibility)
  canvas._liqDims = {
    cL, cR, cT, cB, cW, cH, colW,
    priceMin: viewPriceMin, priceMax: viewPriceMax, priceRows: 120,
    numCols: viewCols, bars: visibleBars,
    matrix: null, startCol, endCol,
    globalPriceMin: viewPriceMin, globalPriceMax: viewPriceMax,
    timeframe, isCandleChart: true,
  }
}

/**
 * Handle mouse move on liquidation heatmap canvas — compute tooltip + crosshair data.
 * Viewport-aware: uses startCol offset stored in _liqDims.
 * @param {MouseEvent} e
 * @param {Function} setLiqTooltip - state setter for tooltip
 */
export function handleLiqMouseMove(e, setLiqTooltip) {
  const canvas = e.target
  if (!canvas || !canvas._liqDims) return
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const d = canvas._liqDims
  if (x < d.cL || x > d.cR || y < d.cT || y > d.cB) { setLiqTooltip(t => t.visible ? { ...t, visible: false } : t); return }
  const col = Math.floor((x - d.cL) / d.colW)
  if (col < 0 || col >= d.numCols) { setLiqTooltip(t => t.visible ? { ...t, visible: false } : t); return }
  // Map pixel Y to price using viewport price range
  const yFraction = 1 - (y - d.cT) / (d.cB - d.cT)
  const priceAtCursor = d.priceMin + yFraction * (d.priceMax - d.priceMin)
  // Find the nearest matrix row using global price coordinates
  const globalPriceMin = d.globalPriceMin ?? d.priceMin
  const globalPriceMax = d.globalPriceMax ?? d.priceMax
  const globalPriceStep = (globalPriceMax - globalPriceMin) / d.priceRows
  const row = Math.floor((priceAtCursor - globalPriceMin) / globalPriceStep)
  if (row < 0 || row >= d.priceRows) { setLiqTooltip(t => t.visible ? { ...t, visible: false } : t); return }
  // Get intensity from the global matrix using startCol offset
  const globalCol = (d.startCol ?? 0) + col
  const intensity = d.matrix[globalCol]?.[row] ?? 0
  const bar = d.bars[col]
  if (!bar) { setLiqTooltip(t => t.visible ? { ...t, visible: false } : t); return }
  const date = new Date(bar.t * 1000)
  // Detect cluster zone: high-density when 3+ adjacent rows are >0.6
  let isCluster = false
  let adjacentHigh = 0
  for (let r = Math.max(0, row - 2); r <= Math.min(d.priceRows - 1, row + 2); r++) {
    if ((d.matrix[globalCol]?.[r] ?? 0) > 0.6) adjacentHigh++
  }
  isCluster = adjacentHigh >= 3
  // Crosshair: snap X to column center
  const snappedX = d.cL + col * d.colW + d.colW / 2
  const timeStr = formatAxisTime(bar.t, d.timeframe || '24h')
  setLiqTooltip({
    visible: true, x: e.clientX - rect.left, y: e.clientY - rect.top,
    price: priceAtCursor,
    densityPct: Math.round(intensity * 100),
    amount: (intensity * 88.35).toFixed(1),
    isCluster,
    bar, // OHLC data for tooltip
    time: timeStr,
    // Crosshair data
    snappedX,
    crosshairY: y,
    dims: { cL: d.cL, cR: d.cR, cT: d.cT, cB: d.cB },
  })
}

/**
 * Handle mouse leave on liquidation heatmap canvas — hide tooltip.
 * @param {Function} setLiqTooltip - state setter for tooltip
 */
export function handleLiqMouseLeave(setLiqTooltip) {
  setLiqTooltip(t => t.visible ? { visible: false, x: 0, y: 0, price: 0, densityPct: 0, amount: 0, isCluster: false, bar: null, time: '', snappedX: 0, crosshairY: 0, dims: null } : t)
}
