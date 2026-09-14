/**
 * rz-share-card.js - Research Zone token share card.
 *
 * Builds a branded "Share to X" PNG with token logo, price, 24h change,
 * a real candlestick chart drawn from OHLCV bars, performance chips and
 * key stats. Pure async function.
 */
import {
  renderShareCard,
  getSpectreLogo,
  roundRect,
  truncateText,
  generateSparkline,
  drawSparkline,
  formatLargeNumber,
  CARD_PAD,
} from '@/lib/shareToX'
import { getBars as getCryptoBars } from '@/services/codexApi'
import { getStockCandles } from '@/services/stockApi'
import { COINGECKO_LOGOS } from '@/constants/majorTokens'
import { binancePairFor } from '@/services/binanceCatalog'
import { isDev } from '@/utils/env'

// Load any token logo (local /asset path OR external URL with proxy fallback).
// preloadLogos in shareToX skips local paths, so we roll our own here.
function loadTokenLogo(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const proxyBase = isDev ? 'http://localhost:3001/api/img-proxy' : '/api/img-proxy'
    const isLocal = url.startsWith('/') && !url.startsWith('//')
    const candidates = isLocal
      ? [url]
      : [url, `${proxyBase}?url=${encodeURIComponent(url)}`]

    let i = 0
    const tryNext = () => {
      if (i >= candidates.length) return resolve(null)
      const img = new Image()
      if (!isLocal) img.crossOrigin = 'anonymous'
      const timer = setTimeout(() => { img.src = ''; i += 1; tryNext() }, 4500)
      img.onload = () => { clearTimeout(timer); resolve(img) }
      img.onerror = () => { clearTimeout(timer); i += 1; tryNext() }
      img.src = candidates[i]
    }
    tryNext()
  })
}

const fmtPriceForShare = (n) => {
  if (n == null || isNaN(n)) return '-'
  const abs = Math.abs(n)
  if (abs >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
  if (abs >= 0.01) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 2 })}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 2 })}`
}

const fmtAxisPrice = (n) => {
  if (n == null || isNaN(n)) return '-'
  const abs = Math.abs(n)
  if (abs >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (abs >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (abs >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

const fmtPct = (n) => {
  if (n == null || isNaN(n)) return '-'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

// Mirror the on-page chart's timeframe → resolution + window size so the
// share card uses the same data the user is looking at.
const RESOLUTION_MAP = {
  '1M': '1',
  '5M': '5',
  '15M': '15',
  '1H': '60',
  '4H': '240',
  '1D': '1D',
  '1W': '1W',
}

// Hours of history to fetch for each timeframe (matches trading-chart.jsx).
const PERIOD_HOURS = {
  '1M': 24,
  '5M': 115,
  '15M': 350,
  '1H': 1400,
  '4H': 5600,
  '1D': 33600,
  '1W': 235200,
}

function pickRange(timeframe) {
  const now = Math.floor(Date.now() / 1000)
  const hours = PERIOD_HOURS[timeframe] || PERIOD_HOURS['1H']
  return {
    res: RESOLUTION_MAP[timeframe] || '60',
    from: now - hours * 3600,
    to: now,
  }
}

async function fetchBarsSafe({ symbol, address, networkId, cgId, isStock, timeframe }) {
  try {
    const { res, from, to } = pickRange(timeframe)
    if (isStock) {
      const out = await getStockCandles(symbol, RESOLUTION_MAP[timeframe] || '60', from, to)
      return out?.getBars || []
    }
    const binancePair = binancePairFor(symbol)
    const out = await getCryptoBars(symbol, res, from, to, networkId || 1, cgId || null, binancePair)
    return out?.getBars || []
  } catch (err) {
    console.warn('[rz-share-card] bars fetch failed:', err)
    return []
  }
}

// Pick the visible window the on-page chart shows: roughly the last ~80
// bars for short timeframes, more for longer ones - same shape as image.
function trimVisible(bars, timeframe) {
  if (!bars || bars.length === 0) return bars
  const visibleCount = {
    '1M': 90, '5M': 90, '15M': 90, '1H': 90, '4H': 90, '1D': 90, '1W': 90,
  }[timeframe] || 90
  return bars.length > visibleCount ? bars.slice(-visibleCount) : bars
}

function computeBounds(bars, useOHLC) {
  let min = Infinity
  let max = -Infinity
  for (const b of bars) {
    if (useOHLC) {
      if (b.l < min) min = b.l
      if (b.h > max) max = b.h
    } else {
      if (b.c < min) min = b.c
      if (b.c > max) max = b.c
    }
  }
  return { min, max }
}

function drawAxisAndLastPrice(ctx, x, y, w, yFor, min, max, lastPrice, isBull, c) {
  const labels = [
    { p: max, y: yFor(max) },
    { p: (max + min) / 2, y: yFor((max + min) / 2) },
    { p: min, y: yFor(min) },
  ]
  ctx.font = `500 9px Inter, system-ui, sans-serif`
  ctx.fillStyle = c.muted
  ctx.textAlign = 'right'
  for (const lab of labels) {
    ctx.fillText(fmtAxisPrice(lab.p), x + w - 4, lab.y + 3)
  }

  if (lastPrice == null) return
  const lastY = yFor(lastPrice)
  ctx.save()
  ctx.strokeStyle = isBull ? c.bull : c.bear
  ctx.lineWidth = 0.8
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(x, lastY)
  ctx.lineTo(x + w - 50, lastY)
  ctx.stroke()
  ctx.restore()

  ctx.font = `600 9.5px Inter, system-ui, sans-serif`
  ctx.fillStyle = isBull ? c.bull : c.bear
  ctx.textAlign = 'right'
  ctx.fillText(fmtAxisPrice(lastPrice), x + w - 4, lastY - 3)
}

function drawCandles(ctx, bars, x, y, w, h, c, timeframe) {
  if (!bars || bars.length === 0) return
  const data = trimVisible(bars, timeframe)
  const { min, max } = computeBounds(data, true)
  if (!isFinite(min) || !isFinite(max) || max === min) return

  const range = max - min
  const padTop = 8
  const padBottom = 8
  const innerH = h - padTop - padBottom
  const yFor = (p) => y + padTop + (1 - (p - min) / range) * innerH

  const slot = w / data.length
  const bodyW = Math.max(2, Math.min(8, slot * 0.62))

  for (let i = 0; i < data.length; i++) {
    const b = data[i]
    const cx = x + slot * i + slot / 2
    const isBull = b.c >= b.o
    const color = isBull ? c.bull : c.bear

    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, yFor(b.h))
    ctx.lineTo(cx, yFor(b.l))
    ctx.stroke()

    const yo = yFor(b.o)
    const yc = yFor(b.c)
    const top = Math.min(yo, yc)
    const bh = Math.max(1, Math.abs(yc - yo))
    ctx.fillStyle = color
    ctx.fillRect(cx - bodyW / 2, top, bodyW, bh)
  }

  const last = data[data.length - 1]
  drawAxisAndLastPrice(ctx, x, y, w, yFor, min, max, last.c, last.c >= last.o, c)
}

function drawLineArea(ctx, bars, x, y, w, h, c, timeframe) {
  if (!bars || bars.length === 0) return
  const data = trimVisible(bars, timeframe)
  const closes = data.map((b) => b.c)
  const { min, max } = computeBounds(data, false)
  if (!isFinite(min) || !isFinite(max) || max === min) return

  const range = max - min
  const padTop = 8
  const padBottom = 8
  const innerH = h - padTop - padBottom
  const yFor = (p) => y + padTop + (1 - (p - min) / range) * innerH
  const xFor = (i) => x + (i / (closes.length - 1)) * w

  const first = closes[0]
  const last = closes[closes.length - 1]
  const isBull = last >= first
  const lineColor = c.isLight ? '#1d1d1f' : '#f5f5f7'

  // Area fill
  ctx.beginPath()
  ctx.moveTo(xFor(0), y + h)
  for (let i = 0; i < closes.length; i++) {
    ctx.lineTo(xFor(i), yFor(closes[i]))
  }
  ctx.lineTo(xFor(closes.length - 1), y + h)
  ctx.closePath()
  const areaGrad = ctx.createLinearGradient(0, y, 0, y + h)
  areaGrad.addColorStop(0, c.isLight ? 'rgba(29,29,31,0.10)' : 'rgba(245,245,247,0.14)')
  areaGrad.addColorStop(1, 'transparent')
  ctx.fillStyle = areaGrad
  ctx.fill()

  // Line
  ctx.beginPath()
  for (let i = 0; i < closes.length; i++) {
    const px = xFor(i)
    const py = yFor(closes[i])
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  drawAxisAndLastPrice(ctx, x, y, w, yFor, min, max, last, isBull, c)
}

export async function generateRzTokenShareCard({
  symbol,
  tokenName,
  tokenLogo,
  price,
  tokenData = {},
  isStock = false,
  timeframe = '1H',
  chartType = 'candles',
  chartToken = null,
}) {
  // TradingView/x embed types - render candles as the closest equivalent.
  const renderMode = chartType === 'line' ? 'line' : 'candles'
  const change24h = Number(tokenData.change24h) || 0
  const change1h = Number(tokenData.change1h) || 0
  const change7d = Number(tokenData.change7d) || 0
  const change30d = Number(tokenData.change30d) || 0
  const mcap = tokenData.marketCap ?? tokenData.mcap
  const volume = tokenData.volume24h ?? tokenData.volume
  const fdv = tokenData.fdv

  const isUp = change24h >= 0
  const sentRgb = change24h >= 0.05 ? '16, 185, 129' : change24h <= -0.05 ? '239, 68, 68' : '142, 142, 147'

  const description = `${isStock ? '📈' : '🪙'} $${symbol}${tokenName && tokenName !== symbol ? ` (${tokenName})` : ''}\n\n${fmtPriceForShare(price)}  ${fmtPct(change24h)} (24h)\n\nDeep dive on Spectre AI - on-chain, sentiment & technicals.\n\n@Spectre__Ai #${symbol} ${isStock ? '#stocks' : '#crypto'}`

  const resolvedLogoUrl = tokenLogo || COINGECKO_LOGOS[(symbol || '').toUpperCase()] || null

  const [spectreLogo, tokenImg, bars] = await Promise.all([
    getSpectreLogo(),
    loadTokenLogo(resolvedLogoUrl),
    fetchBarsSafe({
      symbol,
      address: chartToken?.address,
      networkId: chartToken?.networkId,
      cgId: chartToken?.cgId,
      isStock,
      timeframe,
    }),
  ])

  const imageUrl = renderShareCard(
    (ctx, w, contentTop, c, fonts) => {
      const pad = CARD_PAD
      let y = contentTop

      // Sentiment ambient glow
      const glow = ctx.createRadialGradient(w / 2, y + 80, 0, w / 2, y + 80, w * 0.6)
      glow.addColorStop(0, `rgba(${sentRgb}, ${c.isLight ? 0.06 : 0.10})`)
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.fillRect(0, contentTop - 12, w, 280)

      // Hero block: logo + symbol/name on left, price + change on right
      const heroH = 84
      const logoSize = 56
      const logoX = pad
      const logoY = y + 4

      // Token logo (rounded)
      if (tokenImg) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2)
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(tokenImg, logoX, logoY, logoSize, logoSize)
        ctx.restore()
        ctx.strokeStyle = c.cardBorder
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 - 0.5, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.fillStyle = c.fallbackBg
        ctx.beginPath()
        ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = c.fallbackText
        ctx.font = `700 22px ${fonts.body}`
        ctx.textAlign = 'center'
        ctx.fillText((symbol || '?').slice(0, 1), logoX + logoSize / 2, logoY + logoSize / 2 + 8)
      }

      // Symbol + name (left of hero)
      const textX = logoX + logoSize + 14
      ctx.textAlign = 'left'
      ctx.fillStyle = c.symbol
      ctx.font = `700 24px ${fonts.body}`
      ctx.fillText(symbol || '', textX, logoY + 24)

      ctx.fillStyle = c.name
      ctx.font = `400 12px ${fonts.body}`
      const maxNameW = (w / 2) - textX - 8
      ctx.fillText(truncateText(ctx, tokenName || '', maxNameW), textX, logoY + 42)

      // Timeframe pill (under name)
      const tfText = `${timeframe} CHART`
      ctx.font = `600 9px ${fonts.body}`
      const tfW = ctx.measureText(tfText).width + 14
      roundRect(ctx, textX, logoY + 50, tfW, 18, 5)
      ctx.fillStyle = c.tfBadgeBg
      ctx.fill()
      ctx.fillStyle = c.tfBadgeText
      ctx.textAlign = 'left'
      ctx.fillText(tfText, textX + 7, logoY + 62.5)

      // Price + change (right of hero)
      ctx.textAlign = 'right'
      ctx.fillStyle = c.symbol
      ctx.font = `700 28px ${fonts.body}`
      ctx.fillText(fmtPriceForShare(price), w - pad, logoY + 26)

      // 24h change pill
      const chText = fmtPct(change24h) + ' 24h'
      ctx.font = `600 11px ${fonts.body}`
      const chW = ctx.measureText(chText).width + 18
      const chPillX = w - pad - chW
      roundRect(ctx, chPillX, logoY + 38, chW, 22, 6)
      ctx.fillStyle = c.isLight
        ? (isUp ? 'rgba(5,150,105,0.10)' : 'rgba(220,38,38,0.10)')
        : (isUp ? 'rgba(52,211,153,0.14)' : 'rgba(248,113,113,0.14)')
      ctx.fill()
      ctx.fillStyle = isUp ? c.bull : c.bear
      ctx.textAlign = 'left'
      ctx.fillText(chText, chPillX + 9, logoY + 53)

      y += heroH + 4

      // Chart area (real candles when available, sparkline fallback)
      const chartX = pad
      const chartY = y
      const chartW = w - pad * 2
      const chartH = 150

      const cardGrad = ctx.createLinearGradient(chartX, chartY, chartX, chartY + chartH)
      cardGrad.addColorStop(0, c.isLight ? 'rgba(0,0,0,0.018)' : 'rgba(255,255,255,0.025)')
      cardGrad.addColorStop(1, c.isLight ? 'rgba(0,0,0,0.008)' : 'rgba(255,255,255,0.01)')
      roundRect(ctx, chartX, chartY, chartW, chartH, 12)
      ctx.fillStyle = cardGrad
      ctx.fill()
      ctx.strokeStyle = c.cardBorder
      ctx.lineWidth = 0.5
      roundRect(ctx, chartX + 0.5, chartY + 0.5, chartW - 1, chartH - 1, 12)
      ctx.stroke()

      // Inner padding for chart drawing area
      const innerX = chartX + 14
      const innerY = chartY + 14
      const innerW = chartW - 28 - 56 // leave room for right axis labels
      const innerH = chartH - 28

      if (bars && bars.length > 1) {
        if (renderMode === 'line') {
          drawLineArea(ctx, bars, innerX, innerY, innerW + 56, innerH, c, timeframe)
        } else {
          drawCandles(ctx, bars, innerX, innerY, innerW + 56, innerH, c, timeframe)
        }
      } else {
        // Fallback: synthetic sparkline so the card still renders if bars failed
        const fallback = generateSparkline(change24h, 64)
        drawSparkline(ctx, fallback, innerX, innerY, innerW + 56, innerH, c, isUp)
        ctx.font = `500 9px ${fonts.body}`
        ctx.fillStyle = c.muted
        ctx.textAlign = 'center'
        ctx.fillText('chart preview', chartX + chartW / 2, chartY + chartH - 8)
      }

      y += chartH + 16

      // Performance chips
      const chipLabels = isStock
        ? [{ label: '24H', value: change24h }]
        : [
            { label: '1H', value: change1h },
            { label: '24H', value: change24h },
            { label: '7D', value: change7d },
            { label: '30D', value: change30d },
          ]
      const chipW = (w - pad * 2 - (chipLabels.length - 1) * 8) / chipLabels.length
      const chipH = 50
      let cx = pad
      chipLabels.forEach((chip) => {
        const chipBg = ctx.createLinearGradient(cx, y, cx + chipW, y + chipH)
        chipBg.addColorStop(0, c.isLight ? 'rgba(0,0,0,0.022)' : 'rgba(255,255,255,0.03)')
        chipBg.addColorStop(1, c.isLight ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.012)')
        roundRect(ctx, cx, y, chipW, chipH, 10)
        ctx.fillStyle = chipBg
        ctx.fill()
        ctx.strokeStyle = c.cardBorder
        ctx.lineWidth = 0.5
        roundRect(ctx, cx + 0.5, y + 0.5, chipW - 1, chipH - 1, 10)
        ctx.stroke()

        ctx.textAlign = 'center'
        ctx.font = `600 9px ${fonts.body}`
        ctx.fillStyle = c.thColor
        ctx.fillText(chip.label, cx + chipW / 2, y + 16)

        const isP = chip.value >= 0
        ctx.font = `700 14px ${fonts.body}`
        ctx.fillStyle = chip.value === 0 ? c.muted : (isP ? c.bull : c.bear)
        ctx.fillText(fmtPct(chip.value), cx + chipW / 2, y + 36)

        cx += chipW + 8
      })

      y += chipH + 16

      // Stats row (Mcap | Volume | FDV)
      const stats = []
      if (mcap) stats.push({ label: 'Market Cap', value: formatLargeNumber(mcap) })
      if (volume) stats.push({ label: '24H Volume', value: formatLargeNumber(volume) })
      if (fdv && !isStock) stats.push({ label: 'FDV', value: formatLargeNumber(fdv) })

      if (stats.length > 0) {
        const colW = (w - pad * 2) / stats.length
        stats.forEach((stat, i) => {
          const sx = pad + i * colW
          ctx.textAlign = 'center'
          ctx.font = `500 9.5px ${fonts.body}`
          ctx.fillStyle = c.muted
          ctx.fillText(stat.label.toUpperCase(), sx + colW / 2, y + 12)

          ctx.font = `700 14px ${fonts.body}`
          ctx.fillStyle = c.symbol
          ctx.fillText(stat.value, sx + colW / 2, y + 32)
        })
        y += 44
      }

      return (y - contentTop)
    },
    {
      title: tokenName ? `${tokenName} - ${isStock ? 'Stock' : 'Token'} Snapshot` : 'Token Snapshot',
      badges: [
        { text: timeframe, filled: false },
        { text: symbol || '', filled: true },
      ],
      logo: spectreLogo,
    },
  )

  return { imageUrl, description }
}
