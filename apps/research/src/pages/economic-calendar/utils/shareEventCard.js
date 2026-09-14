/**
 * shareEventCard - Renders a branded PNG share card for a calendar event.
 * Uses the shared shareToX canvas pipeline so the visual language matches
 * the Top Coins share card and other Spectre share surfaces.
 */

import {
  renderShareCard,
  getSpectreLogo,
  truncateText,
  roundRect,
  CARD_PAD,
} from '@/lib/shareToX'
import { formatEventTime, formatEventDate, getCountryFlag } from './formatters'
import { getTimezoneLabel } from './timezone'

const IMPACT_LABEL = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
}

const IMPACT_COLOR = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: 'rgba(255,255,255,0.35)',
}

function computeOutcome(event) {
  const actualNum = typeof event.actual === 'number'
    ? event.actual
    : parseFloat(String(event.actual ?? '').replace(/[^0-9.\-+]/g, ''))
  const forecastNum = typeof event.forecast === 'number'
    ? event.forecast
    : parseFloat(String(event.forecast ?? '').replace(/[^0-9.\-+]/g, ''))
  if (!Number.isFinite(actualNum) || !Number.isFinite(forecastNum)) return null
  if (forecastNum === 0) {
    if (actualNum === 0) return { label: 'IN LINE', color: 'neutral', pct: 0 }
    return { label: actualNum > 0 ? 'BEAT' : 'MISS', color: actualNum > 0 ? 'bull' : 'bear', pct: null }
  }
  const pct = ((actualNum - forecastNum) / Math.abs(forecastNum)) * 100
  if (Math.abs(pct) < 2) return { label: 'IN LINE', color: 'neutral', pct }
  return { label: pct > 0 ? 'BEAT' : 'MISS', color: pct > 0 ? 'bull' : 'bear', pct }
}

function fmtVal(v) {
  if (v == null || v === '') return '—'
  return String(v)
}

export async function renderEventShareCard(event) {
  if (!event) return null
  const spectreLogo = await getSpectreLogo()
  const outcome = computeOutcome(event)
  const impactLabel = IMPACT_LABEL[event.impact] || 'EVENT'
  const impactColor = IMPACT_COLOR[event.impact] || IMPACT_COLOR.low

  const timeLabel = `${formatEventTime(event.dateTime)} ${getTimezoneLabel()}`
  const dateLabel = formatEventDate(event.dateTime)
  const flag = event.country ? getCountryFlag(event.country) : ''
  const currency = event.currency || event.country || ''

  return renderShareCard(
    (ctx, w, contentTop, c, fonts) => {
      const pad = CARD_PAD
      let y = contentTop + 8

      // ── Impact pill + meta row ─────────────────────────────
      ctx.save()
      ctx.textAlign = 'left'
      const pillY = y
      const pillH = 22
      ctx.font = `700 10px ${fonts.body}`
      const pillW = Math.ceil(ctx.measureText(impactLabel).width) + 20
      ctx.fillStyle = `${impactColor}22`
      roundRect(ctx, pad, pillY, pillW, pillH, 6)
      ctx.fill()
      ctx.fillStyle = impactColor
      ctx.textBaseline = 'middle'
      ctx.fillText(impactLabel, pad + 10, pillY + pillH / 2 + 0.5)
      ctx.restore()

      // Meta (flag · currency · date) right-aligned
      ctx.save()
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'
      ctx.font = `500 12px ${fonts.body}`
      ctx.fillStyle = c.muted
      const metaParts = [flag, currency, dateLabel].filter(Boolean)
      ctx.fillText(metaParts.join('  ·  '), w - pad, pillY + pillH / 2 + 0.5)
      ctx.restore()

      y += pillH + 18

      // ── Event name ─────────────────────────────────────────
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.font = `700 26px ${fonts.body}`
      ctx.fillStyle = c.symbol
      const nameMaxW = w - pad * 2
      const name = truncateText(ctx, event.name || 'Event', nameMaxW)
      ctx.fillText(name, pad, y + 22)
      y += 32

      // ── Time ────────────────────────────────────────────────
      ctx.font = `500 13px ${fonts.mono}`
      ctx.fillStyle = c.muted
      ctx.fillText(timeLabel, pad, y + 14)
      y += 34

      // ── Values card (Prev / Fcst / Actual / Outcome) ───────
      const cardX = pad
      const cardW = w - pad * 2
      const cardH = 98
      ctx.fillStyle = c.cardBg
      roundRect(ctx, cardX, y, cardW, cardH, 12)
      ctx.fill()
      ctx.strokeStyle = c.cardBorder
      ctx.lineWidth = 1
      roundRect(ctx, cardX + 0.5, y + 0.5, cardW - 1, cardH - 1, 12)
      ctx.stroke()

      const hasOutcome = !!outcome
      const cols = hasOutcome ? 4 : 3
      const colW = cardW / cols
      const items = [
        { label: 'PREV', value: fmtVal(event.previous), color: c.symbol },
        { label: 'FCST', value: fmtVal(event.forecast), color: c.symbol },
        { label: 'ACTUAL', value: fmtVal(event.actual), color: c.symbol },
      ]
      if (hasOutcome) {
        const outcomeColor = outcome.color === 'bull' ? c.bull : outcome.color === 'bear' ? c.bear : c.muted
        const outcomeValue = outcome.pct != null
          ? `${outcome.pct > 0 ? '+' : ''}${outcome.pct.toFixed(1)}%`
          : outcome.label
        items.push({ label: outcome.label, value: outcomeValue, color: outcomeColor })
      }

      items.forEach((item, i) => {
        const cx = cardX + colW * i + colW / 2
        ctx.textAlign = 'center'
        ctx.font = `700 9.5px ${fonts.body}`
        ctx.fillStyle = c.thColor
        ctx.fillText(item.label, cx, y + 30)
        ctx.font = `600 22px ${fonts.mono}`
        ctx.fillStyle = item.color
        const truncated = truncateText(ctx, item.value, colW - 12)
        ctx.fillText(truncated, cx, y + 66)
      })

      // Column separators
      for (let i = 1; i < cols; i++) {
        const sx = cardX + colW * i
        ctx.fillStyle = c.cardBorder
        ctx.fillRect(sx, y + 18, 1, cardH - 36)
      }

      y += cardH + 24

      // ── Optional tagline ───────────────────────────────────
      if (event.category) {
        ctx.textAlign = 'left'
        ctx.font = `600 10px ${fonts.body}`
        ctx.fillStyle = c.thColor
        ctx.fillText((event.category || '').toUpperCase(), pad, y + 12)
        y += 24
      }

      return y - contentTop
    },
    {
      title: 'Economic Calendar',
      subtitle: 'Spectre Intelligence Hub',
      logo: spectreLogo,
    }
  )
}
