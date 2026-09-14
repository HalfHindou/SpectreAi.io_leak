/**
 * AgentChartCard - the agent's chart presentation. When the agent runs TA
 * (get_bars_summary) the server emits a 'visual' payload: the real candles
 * it analyzed plus the supply/demand zones and EMA series it computed, and
 * this card DRAWS them - the "show, don't tell" half of the answer.
 *
 * Two modes:
 *   - static (chat thread): compact 340px card, everything drawn, one
 *     entry animation.
 *   - presenting (voice stage): the card scales to the stage (sachart--
 *     stage), and a `reveal` prop maps element -> 0..1 so the scene draws
 *     itself in sync with the SPEECH - candles sweep behind a glowing
 *     scan-line frontier, zones march their dashes in as he says
 *     "demand", the EMA strokes itself with a lit pen.
 *
 * Pure canvas (no chart lib on the agent path). DPR-aware; metrics scale
 * with width (big stage = bigger type, price rail, time axis); redraws on
 * resize and day-mode flips (body.theme-light).
 */
import { useCallback, useEffect, useRef } from 'react'
import { fmtPrice, fmtCount } from './presentationCues'
import './AgentChartCard.css'

const RES_LABELS = { 5: '5m', 15: '15m', 60: '1h', 240: '4h', '1D': '1D' }

const FULL_REVEAL = { candles: 1, 'zones-supply': 1, 'zones-demand': 1, ema: 1, vwap: 1 }

function palette(isDay) {
  return isDay
    ? {
      up: '#059669', down: '#dc2626',
      grid: 'rgba(15, 23, 42, 0.07)', text: 'rgba(71, 85, 105, 0.9)',
      zoneSupply: 'rgba(220, 38, 38, 0.09)', zoneDemand: 'rgba(5, 150, 105, 0.09)',
      edgeSupply: 'rgba(220, 38, 38, 0.45)', edgeDemand: 'rgba(5, 150, 105, 0.5)',
      labelSupply: '#b91c1c', labelDemand: '#047857',
      last: 'rgba(15, 23, 42, 0.75)', vwap: 'rgba(15, 23, 42, 0.28)',
      emaFast: 'rgba(15, 23, 42, 0.85)', emaSlow: 'rgba(15, 23, 42, 0.38)',
      scan: 'rgba(15, 23, 42, 0.22)',
    }
    : {
      up: '#10B981', down: '#EF4444',
      grid: 'rgba(255, 255, 255, 0.05)', text: 'rgba(245, 245, 247, 0.45)',
      zoneSupply: 'rgba(239, 68, 68, 0.10)', zoneDemand: 'rgba(16, 185, 129, 0.10)',
      edgeSupply: 'rgba(239, 68, 68, 0.5)', edgeDemand: 'rgba(16, 185, 129, 0.55)',
      labelSupply: '#F87171', labelDemand: '#34D399',
      last: 'rgba(245, 245, 247, 0.8)', vwap: 'rgba(245, 245, 247, 0.3)',
      emaFast: 'rgba(245, 245, 247, 0.85)', emaSlow: 'rgba(245, 245, 247, 0.38)',
      scan: 'rgba(245, 245, 247, 0.2)',
    }
}

function fmtTick(tSec, resolution) {
  const d = new Date(tSec * 1000)
  if (!Number.isFinite(d.getTime())) return ''
  if (resolution === '1D') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const easeOutQ = (r) => 1 - (1 - r) * (1 - r)

/** Aggregate the visual's bars into daily volume (USD via the day's close),
    newest <=7 days - the volume slide's data. */
function dailyVolumes(bars) {
  const days = new Map()
  for (const b of bars) {
    const v = b?.[5]
    if (!Number.isFinite(v) || v <= 0) continue
    const d = new Date(b[0] * 1000)
    const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    const e = days.get(key) || { t: key / 1000, vol: 0, open: b[1], close: b[4] }
    e.vol += v
    e.close = b[4]
    days.set(key, e)
  }
  return [...days.values()].sort((a, b) => a.t - b.t).slice(-7).map((d) => ({ ...d, usd: d.vol * d.close }))
}

/** The volume slide: daily bars RISE in sequence as the voice reaches
    "volume" - gradient bodies, the heaviest day glows with its value, day
    labels beneath, dollar scale on the rail. */
function drawVolume(canvas, visual, isDay, reveal = FULL_REVEAL) {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const days = dailyVolumes(Array.isArray(visual.bars) ? visual.bars : [])
  if (!days.length) return
  const C = palette(isDay)
  const big = w > 460
  const padT = big ? 14 : 10
  const padB = big ? 26 : 20 // day labels
  const railW = big ? 58 : 50
  const fontPx = big ? 11 : 9
  const plotW = w - railW - 2
  const plotH = h - padT - padB
  const maxUsd = days.reduce((m, d) => Math.max(m, d.usd), 0) || 1
  const maxIdx = days.findIndex((d) => d.usd === maxUsd)
  const volR = Number.isFinite(reveal.volume) ? Math.min(1, Math.max(0, reveal.volume)) : 1

  // Grid + dollar rail
  ctx.font = `${fontPx}px Geist, system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 3; i++) {
    const frac = i / 3
    const gy = padT + plotH * (1 - frac)
    ctx.strokeStyle = C.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(plotW, gy)
    ctx.stroke()
    ctx.fillStyle = C.text
    ctx.textAlign = 'left'
    ctx.fillText(frac === 0 ? '0' : `$${fmtCount(maxUsd * frac)}`, plotW + 5, Math.max(7, gy))
  }
  // Baseline
  ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.18)' : 'rgba(255, 255, 255, 0.12)'
  ctx.beginPath()
  ctx.moveTo(0, padT + plotH)
  ctx.lineTo(plotW, padT + plotH)
  ctx.stroke()

  const slotW = plotW / days.length
  const barW = Math.max(8, slotW * (big ? 0.52 : 0.6))
  const breathe = 0.5 + 0.5 * Math.sin(performance.now() / 320) // alive while presenting
  days.forEach((d, i) => {
    // Sequential rise: each bar starts a beat after its neighbor.
    const r = easeOutQ(Math.min(1, Math.max(0, volR * 1.6 - (i / days.length) * 0.6)))
    if (r <= 0.01) return
    const fullH = Math.max(2, (d.usd / maxUsd) * plotH)
    const bh = fullH * r
    const x = i * slotW + (slotW - barW) / 2
    const yTop = padT + plotH - bh
    const up = d.close >= d.open
    const base = up ? C.up : C.down
    const isMax = i === maxIdx
    const grad = ctx.createLinearGradient(0, yTop, 0, padT + plotH)
    grad.addColorStop(0, base)
    grad.addColorStop(1, isDay ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.04)')
    if (isMax && r > 0.6) {
      // The heaviest day BREATHES - a slow living glow while on stage.
      ctx.shadowColor = base
      ctx.shadowBlur = (big ? 8 : 5) + 8 * breathe
    }
    ctx.globalAlpha = isMax ? 1 : 0.82
    ctx.fillStyle = grad
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, yTop, barW, bh, [4, 4, 0, 0])
    else ctx.rect(x, yTop, barW, bh)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
    // Every bar carries its value once risen (the heaviest + latest lead)
    if (r > 0.8) {
      const lead = isMax || i === days.length - 1
      ctx.globalAlpha = Math.min(1, (r - 0.8) / 0.2) * (lead ? 1 : 0.55)
      ctx.font = `${lead ? 600 : 500} ${lead ? fontPx : fontPx - 1}px Geist, system-ui, sans-serif`
      ctx.fillStyle = isDay ? '#0f172a' : '#f5f5f7'
      ctx.textAlign = 'center'
      ctx.fillText(`$${fmtCount(d.usd)}`, x + barW / 2, Math.max(padT + 6, yTop - 9))
      ctx.globalAlpha = 1
    }
    // Day label
    ctx.font = `${fontPx - 1}px Geist, system-ui, sans-serif`
    ctx.fillStyle = C.text
    ctx.textAlign = 'center'
    ctx.fillText(new Date(d.t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), x + barW / 2, h - 9)
  })

  // Average line - the week's benchmark, drawn after the bars settle
  const avgUsd = days.reduce((a, d) => a + d.usd, 0) / days.length
  const avgAlpha = Math.min(1, Math.max(0, (volR - 0.65) / 0.35))
  if (avgAlpha > 0 && avgUsd > 0) {
    const ay = padT + plotH * (1 - avgUsd / maxUsd)
    ctx.globalAlpha = avgAlpha
    ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.45)' : 'rgba(245, 245, 247, 0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(0, ay)
    ctx.lineTo(plotW, ay)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `600 ${fontPx - 1}px Geist, system-ui, sans-serif`
    ctx.fillStyle = isDay ? 'rgba(15, 23, 42, 0.6)' : 'rgba(245, 245, 247, 0.65)'
    ctx.textAlign = 'left'
    ctx.fillText(`AVG $${fmtCount(avgUsd)}`, 4, Math.max(padT + 6, ay - 8))
    ctx.globalAlpha = 1
  }

  // One-time shine sweep across the plot as the rise completes
  if (volR > 0.55 && volR < 1) {
    const sx = plotW * ((volR - 0.55) / 0.45)
    const sw = Math.min(60, plotW * 0.18)
    const shine = ctx.createLinearGradient(sx - sw, 0, sx + sw, 0)
    const glow = isDay ? 'rgba(15, 23, 42, 0.07)' : 'rgba(245, 245, 247, 0.09)'
    shine.addColorStop(0, 'rgba(0,0,0,0)')
    shine.addColorStop(0.5, glow)
    shine.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = shine
    ctx.fillRect(Math.max(0, sx - sw), padT, sw * 2, plotH)
  }
}

function draw(canvas, visual, isDay, reveal = FULL_REVEAL) {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const bars = (Array.isArray(visual.bars) ? visual.bars : []).filter(
    (b) => Array.isArray(b) && b.length >= 5 && Number.isFinite(b[2]) && Number.isFinite(b[3]),
  )
  if (bars.length < 2) return
  const zones = (Array.isArray(visual.zones) ? visual.zones : []).filter(
    (z) => Number.isFinite(z?.top) && Number.isFinite(z?.bottom) && z.top > z.bottom,
  )
  const C = palette(isDay)
  const rv = (key) => {
    const v = reveal[key]
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
  }

  // Metrics scale with the card: the stage card is 2x the thread card.
  const big = w > 460
  const padT = big ? 10 : 6
  const padB = big ? 24 : 6 // stage keeps a time-axis row
  const railW = big ? 58 : 46
  const fontPx = big ? 11 : 9
  const zoneFontPx = big ? 10 : 8
  const plotW = w - railW - 2
  const plotH = h - padT - padB

  // Price range: bar highs/lows, expanded toward zones but clamped so a
  // far-off zone can never crush the candles into a flat line.
  let lo = Infinity
  let hi = -Infinity
  for (const b of bars) { if (b[3] < lo) lo = b[3]; if (b[2] > hi) hi = b[2] }
  const span0 = hi - lo || Math.abs(hi) || 1
  for (const z of zones) {
    lo = Math.min(lo, Math.max(z.bottom, lo - span0 * 0.18))
    hi = Math.max(hi, Math.min(z.top, hi + span0 * 0.18))
  }
  const span1 = hi - lo || 1
  lo -= span1 * 0.05
  hi += span1 * 0.05
  const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * plotH

  // Grid + right price rail (stage = finer grid)
  ctx.font = `${fontPx}px Geist, system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const gridN = big ? 4 : 3
  for (let i = 0; i <= gridN; i++) {
    const p = lo + ((hi - lo) * i) / gridN
    const gy = y(p)
    ctx.strokeStyle = C.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(plotW, gy)
    ctx.stroke()
    ctx.fillStyle = C.text
    ctx.textAlign = 'left'
    ctx.fillText(fmtPrice(p), plotW + 5, Math.min(h - padB - 2, Math.max(6, gy)))
  }

  // Time axis (stage only): three ticks across the window
  if (big) {
    ctx.fillStyle = C.text
    ctx.font = `${fontPx - 1}px Geist, system-ui, sans-serif`
    ctx.textAlign = 'center'
    for (const frac of [0.08, 0.5, 0.92]) {
      const idx = Math.min(bars.length - 1, Math.round(bars.length * frac))
      const label = fmtTick(bars[idx][0], visual.resolution)
      if (label) ctx.fillText(label, (idx + 0.5) * (plotW / bars.length), h - 9)
    }
  }

  // Zone bands - the drawn supply/demand areas the agent talks to. Reveal:
  // band alpha ramps, the edge dash MARCHES in left->right (lineDashOffset
  // animates while revealing - the "being drawn" feel), the chip label
  // fades in on the tail of the ramp.
  ctx.font = `600 ${zoneFontPx}px Geist, system-ui, sans-serif`
  const placedLabelYs = [] // adjacent zones must not stack labels on top of each other
  const chipH = zoneFontPx + 6
  for (const z of zones) {
    const r = rv(z.type === 'supply' ? 'zones-supply' : 'zones-demand')
    if (r <= 0) continue
    const top = y(z.top)
    const bot = y(z.bottom)
    const zh = Math.max(2, bot - top)
    const supply = z.type === 'supply'
    // Arrival flash: brightens through the reveal's back half, settles at
    // r=1 - the zone ANNOUNCES itself the moment he names it.
    const flash = Math.sin(Math.PI * Math.min(1, Math.max(0, (r - 0.5) / 0.5)))
    ctx.globalAlpha = Math.min(1, r + flash * 0.7)
    ctx.fillStyle = supply ? C.zoneSupply : C.zoneDemand
    ctx.fillRect(0, top, plotW, zh)
    ctx.globalAlpha = 1
    ctx.strokeStyle = supply ? C.edgeSupply : C.edgeDemand
    ctx.lineWidth = 1 + flash * 0.8
    if (flash > 0.05) {
      ctx.shadowColor = supply ? C.edgeSupply : C.edgeDemand
      ctx.shadowBlur = 8 * flash
    }
    ctx.setLineDash([4, 3])
    if (r < 1) ctx.lineDashOffset = -((performance.now() / 40) % 7) // marching while drawing
    const edge = y(z.price)
    ctx.beginPath()
    ctx.moveTo(0, edge)
    ctx.lineTo(plotW * r, edge)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
    ctx.shadowBlur = 0
    ctx.lineWidth = 1
    const labelAlpha = Math.min(1, Math.max(0, (r - 0.55) / 0.3))
    if (labelAlpha > 0) {
      ctx.globalAlpha = labelAlpha
      ctx.textAlign = 'right'
      let ly = supply ? Math.max(padT + 7, top + 8) : Math.min(h - padB - 5, bot - 6)
      let guard = 0
      const gap = chipH + 2
      while (placedLabelYs.some((p) => Math.abs(p - ly) < gap) && guard++ < 8) ly += supply ? gap : -gap
      ly = Math.min(h - padB - 5, Math.max(padT + 7, ly))
      placedLabelYs.push(ly)
      // Chip behind the label - readable over candles
      const label = `${supply ? 'SUPPLY' : 'DEMAND'} ${fmtPrice(z.price)}`
      const tw = ctx.measureText(label).width
      ctx.fillStyle = isDay ? 'rgba(255, 255, 255, 0.78)' : 'rgba(9, 9, 11, 0.62)'
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(plotW - 4 - tw - 5, ly - chipH / 2, tw + 10, chipH, 4)
      else ctx.rect(plotW - 4 - tw - 5, ly - chipH / 2, tw + 10, chipH)
      ctx.fill()
      ctx.fillStyle = supply ? C.labelSupply : C.labelDemand
      ctx.fillText(label, plotW - 4 - 5 + 1, ly)
      ctx.globalAlpha = 1
    }
  }

  // VWAP
  const vwapR = rv('vwap')
  if (vwapR > 0 && Number.isFinite(visual.vwap) && visual.vwap > lo && visual.vwap < hi) {
    ctx.globalAlpha = vwapR
    ctx.strokeStyle = C.vwap
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(0, y(visual.vwap))
    ctx.lineTo(plotW, y(visual.vwap))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // Candles - sweep left->right behind a glowing scan-line frontier; the
  // frontier candle fades in fractionally so the sweep is liquid, not
  // steppy.
  const cw = plotW / bars.length
  const bodyW = Math.max(1.5, Math.min(big ? 14 : 9, cw * 0.62))
  const candlesR = rv('candles')
  const frontier = bars.length * candlesR
  const candleCount = Math.ceil(frontier)
  for (let i = 0; i < candleCount; i++) {
    const [, o, hB, lB, c] = bars[i]
    const cx = i * cw + cw / 2
    const up = c >= o
    const alpha = i === candleCount - 1 && candlesR < 1 ? Math.max(0.15, frontier - (candleCount - 1)) : 1
    ctx.globalAlpha = alpha
    ctx.strokeStyle = up ? C.up : C.down
    ctx.fillStyle = up ? C.up : C.down
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, y(hB))
    ctx.lineTo(cx, y(lB))
    ctx.stroke()
    const yo = y(o)
    const yc = y(c)
    ctx.fillRect(cx - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(1, Math.abs(yc - yo)))
  }
  ctx.globalAlpha = 1
  if (candlesR > 0.01 && candlesR < 1) {
    // The scan line: a soft trailing glow + a bright leading edge
    const sx = Math.min(plotW - 1, frontier * cw)
    const trail = Math.min(30, sx)
    const grad = ctx.createLinearGradient(sx - trail, 0, sx, 0)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, C.scan)
    ctx.fillStyle = grad
    ctx.fillRect(sx - trail, padT, trail, plotH)
    ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.5)' : 'rgba(245, 245, 247, 0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(sx, padT)
    ctx.lineTo(sx, padT + plotH)
    ctx.stroke()
  }

  // EMA 8/21 - the indicator draws itself point by point as the voice
  // reaches it: glowing stroke while the pen moves, settled tag after.
  const emaR = rv('ema')
  const emaFast = visual.ema?.fast
  const emaSlow = visual.ema?.slow
  if (emaR > 0 && Array.isArray(emaFast) && emaFast.length >= 2) {
    const n = Math.min(bars.length, emaFast.length)
    const upto = Math.max(2, Math.round(n * emaR))
    const strokeSeries = (series, color, width, glow) => {
      if (!Array.isArray(series)) return null
      if (glow) {
        ctx.shadowColor = isDay ? 'rgba(15, 23, 42, 0.4)' : 'rgba(245, 245, 247, 0.5)'
        ctx.shadowBlur = big ? 6 : 4
      }
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      let last = null
      for (let i = 0; i < upto && i < series.length; i++) {
        const v = series[i]
        if (!Number.isFinite(v)) continue
        const cx = i * cw + cw / 2
        const cy = y(v)
        if (last == null) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
        last = { x: cx, y: cy }
      }
      ctx.stroke()
      ctx.shadowBlur = 0
      return last
    }
    // Completion flash: the finished line glows once as it lands.
    const emaFlash = Math.sin(Math.PI * Math.min(1, Math.max(0, (emaR - 0.7) / 0.3)))
    strokeSeries(emaSlow, C.emaSlow, big ? 1.3 : 1, false)
    const pen = strokeSeries(emaFast, C.emaFast, big ? 1.7 : 1.25, emaR < 1 || emaFlash > 0.05)
    if (pen && emaR < 1) {
      // The drawing pen - glowing while the line strokes itself
      ctx.shadowColor = isDay ? 'rgba(15, 23, 42, 0.55)' : 'rgba(245, 245, 247, 0.85)'
      ctx.shadowBlur = big ? 9 : 7
      ctx.fillStyle = C.emaFast
      ctx.beginPath()
      ctx.arc(pen.x, pen.y, big ? 3 : 2.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    }
    if (pen && emaR >= 0.9) {
      // Tag fades in over the draw's last stretch, collision-avoided
      ctx.font = `600 ${zoneFontPx}px Geist, system-ui, sans-serif`
      ctx.globalAlpha = Math.min(1, (emaR - 0.9) / 0.1)
      ctx.fillStyle = C.emaFast
      ctx.textAlign = 'right'
      let ly = Math.min(h - padB - 5, Math.max(padT + 7, pen.y - 7))
      let guard = 0
      while (placedLabelYs.some((p) => Math.abs(p - ly) < chipH + 2) && guard++ < 8) ly -= chipH + 2
      ly = Math.min(h - padB - 5, Math.max(padT + 7, ly))
      placedLabelYs.push(ly)
      ctx.fillText('EMA 8/21', plotW - 4, ly)
      ctx.globalAlpha = 1
    }
  }

  // Last close marker + rail pill. When the voice talks about the CURRENT
  // PRICE, the 'price' cue drives a spotlight: a soft band sweeps around
  // the level, the line brightens, the pill glows - then it all settles.
  const last = Number.isFinite(visual.lastClose) ? visual.lastClose : bars[bars.length - 1][4]
  if (Number.isFinite(last)) {
    const ly = y(last)
    const priceR = Number.isFinite(reveal.price) ? Math.min(1, Math.max(0, reveal.price)) : 0
    const pulse = Math.sin(Math.PI * priceR) // rises and settles across the ramp
    if (pulse > 0.03) {
      // Spotlight band around the price level
      const bandH = 16 + 10 * pulse
      const grad = ctx.createLinearGradient(0, ly - bandH, 0, ly + bandH)
      const glow = isDay ? `rgba(15, 23, 42, ${0.10 * pulse})` : `rgba(245, 245, 247, ${0.10 * pulse})`
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.5, glow)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, ly - bandH, plotW, bandH * 2)
    }
    ctx.strokeStyle = C.last
    ctx.lineWidth = 1 + pulse
    ctx.setLineDash([1, 2])
    if (pulse > 0.03) {
      ctx.shadowColor = isDay ? 'rgba(15, 23, 42, 0.6)' : 'rgba(245, 245, 247, 0.7)'
      ctx.shadowBlur = 8 * pulse
    }
    ctx.beginPath()
    ctx.moveTo(0, ly)
    ctx.lineTo(plotW, ly)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.shadowBlur = 0
    ctx.lineWidth = 1
    ctx.font = `600 ${fontPx}px Geist, system-ui, sans-serif`
    const label = fmtPrice(last)
    const tw = ctx.measureText(label).width
    const pillH = fontPx + 6
    if (pulse > 0.03) {
      ctx.shadowColor = isDay ? 'rgba(15, 23, 42, 0.55)' : 'rgba(245, 245, 247, 0.65)'
      ctx.shadowBlur = 12 * pulse
    }
    ctx.fillStyle = isDay ? '#0f172a' : '#f5f5f7'
    const py = Math.min(h - padB - 2, Math.max(8, ly))
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(plotW + 1, py - pillH / 2, tw + 10, pillH, 4)
    else ctx.rect(plotW + 1, py - pillH / 2, tw + 10, pillH)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = isDay ? '#ffffff' : '#09090b'
    ctx.textAlign = 'left'
    ctx.fillText(label, plotW + 6, py)
  }
}

export default function AgentChartCard({ visual, symbol, reveal, view = 'price' }) {
  const canvasRef = useRef(null)
  const revealRef = useRef(reveal)
  revealRef.current = reveal

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !visual) return
    const isDay = document.body.classList.contains('theme-light')
    if (view === 'volume') drawVolume(canvas, visual, isDay, revealRef.current || FULL_REVEAL)
    else draw(canvas, visual, isDay, revealRef.current || FULL_REVEAL)
  }, [visual, view])

  // Presenting: AgentPresentation hands a fresh reveal map each frame.
  // Static (chat thread): reveal is undefined and this fires once per visual.
  useEffect(() => { redraw() }, [redraw, reveal])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !visual) return undefined
    const ro = new ResizeObserver(redraw)
    ro.observe(canvas)
    const mo = new MutationObserver(redraw)
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [visual, redraw])

  if (!visual || visual.kind !== 'chart' || !visual.bars?.length) return null

  const res = RES_LABELS[visual.resolution] || String(visual.resolution || '')
  const zones = Array.isArray(visual.zones) ? visual.zones : []
  const demand = zones.filter((z) => z.type === 'demand')
  const supply = zones.filter((z) => z.type === 'supply')
  const name = visual.symbol || symbol || 'Chart'
  const trend = visual.trend || 'sideways'
  const presenting = !!reveal
  const volumeView = view === 'volume'

  return (
    <div
      className={`sachart${presenting ? ' sachart--stage' : ''}`}
      role="img"
      aria-label={volumeView
        ? `${name} daily volume bars`
        : `${name} ${res} chart, trend ${trend}, ${demand.length} demand and ${supply.length} supply zones`}
    >
      <div className="sachart__head">
        <span className="sachart__title">{name} - {volumeView ? 'VOLUME' : res}</span>
        {volumeView
          ? <span className="sachart__trend">DAILY</span>
          : <span className={`sachart__trend sachart__trend--${trend}`}>{trend === 'up' ? 'UPTREND' : trend === 'down' ? 'DOWNTREND' : 'SIDEWAYS'}</span>}
      </div>
      <canvas ref={canvasRef} className="sachart__canvas" />
      {/* Legend only in the chat thread - on stage the beat label narrates. */}
      {!presenting && zones.length > 0 && (
        <div className="sachart__legend">
          {demand.length > 0 && (
            <span className="sachart__key sachart__key--demand">Demand {demand.map((z) => fmtPrice(z.price)).join(' / ')}</span>
          )}
          {supply.length > 0 && (
            <span className="sachart__key sachart__key--supply">Supply {supply.map((z) => fmtPrice(z.price)).join(' / ')}</span>
          )}
        </div>
      )}
    </div>
  )
}
