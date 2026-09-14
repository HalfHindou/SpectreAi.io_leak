/**
 * etf-share-card — the shareable Spot ETF Net Flows PNG.
 *
 * Beta report (ChainROI, 2026-08-19), two asks against the ETF flow graphic
 * the bot posts:
 *   1. "1D and 7D flows info in same line" → every asset reads as one line,
 *      `Bitcoin  1D +$517.2M · 7D +$477.7M`, and each issuer row carries both
 *      columns side by side. No hunting across two blocks.
 *   2. "easy to crop, then no info it belongs to Spectre" → the card is drawn
 *      through renderShareCard, which stamps the mark through the centre.
 *
 * Mounted from the Pro ETF surface (dedicated page + Command Center Flows tab)
 * and from Lite, so one renderer answers every "share this" in the app.
 */
import {
  renderShareCard,
  getSpectreLogo,
  roundRect,
  truncateText,
  CARD_PAD,
  FONT,
} from '@/lib/shareToX'

const ASSETS = [
  { key: 'BTC', slug: 'btc', name: 'Bitcoin', dot: '#f7931a' },
  { key: 'ETH', slug: 'eth', name: 'Ethereum', dot: '#8a92ff' },
]

/* ── formatters (the ETF surfaces' own, kept identical so the card and the
      page can never disagree on a number) ────────────────────────────── */

function fUsd(n, signed) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : signed && n > 0 ? '+' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${Math.round(a)}`
}

function fCoin(n, sym) {
  if (n == null || !isFinite(n)) return '—'
  return `${Math.round(n).toLocaleString('en-US')}${sym ? ` ${sym}` : ''}`
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    })
  } catch {
    return iso
  }
}

function foldIssuers(issuers, topN = 6) {
  const list = (issuers || []).filter((i) => (i.holdingsUsd || 0) > 0)
  if (list.length <= topN + 1) return list
  const head = list.slice(0, topN)
  const rest = list.slice(topN)
  const sum = (k) => rest.reduce((acc, r) => acc + (Number(r[k]) || 0), 0)
  return [...head, {
    issuer: 'Others',
    _others: true,
    tickers: [],
    holdingsUsd: sum('holdingsUsd'),
    holdingsCoin: sum('holdingsCoin'),
    flow1dUsd: sum('flow1dUsd'),
    flow7dUsd: sum('flow7dUsd'),
  }]
}

const flowColor = (v, c) => (v > 0 ? c.bull : v < 0 ? c.bear : c.neutral)

/* ── the 1D/7D pair, always on one line ───────────────────────────────── */

function drawFlowPair(ctx, c, rightX, y, flow1d, flow7d) {
  // draws right-to-left so the pair hugs the card edge whatever the widths
  ctx.textAlign = 'right'
  ctx.font = `700 13px ${FONT}`
  const v7 = fUsd(flow7d, true)
  ctx.fillStyle = flowColor(flow7d, c)
  ctx.fillText(v7, rightX, y)
  let x = rightX - ctx.measureText(v7).width - 5

  ctx.font = `600 10px ${FONT}`
  ctx.fillStyle = c.muted
  ctx.fillText('7D', x, y)
  x -= ctx.measureText('7D').width + 10

  ctx.fillStyle = c.neutral
  ctx.fillText('·', x, y)
  x -= 10

  ctx.font = `700 13px ${FONT}`
  const v1 = fUsd(flow1d, true)
  ctx.fillStyle = flowColor(flow1d, c)
  ctx.fillText(v1, x, y)
  x -= ctx.measureText(v1).width + 5

  ctx.font = `600 10px ${FONT}`
  ctx.fillStyle = c.muted
  ctx.fillText('1D', x, y)
}

/* ── the daily-flow bars under each asset headline ────────────────────── */

function drawFlowBars(ctx, c, series, x, y, w, h) {
  const pts = (series || []).slice(-24)
  if (pts.length < 2) return
  const mid = y + h / 2
  const flows = pts.map((d) => Number(d.flowUsd) || 0)
  const maxA = Math.max(1, ...flows.map((f) => Math.abs(f)))
  const step = w / pts.length
  const bw = Math.max(2, Math.min(9, step - 2.5))

  ctx.strokeStyle = c.whiteAlpha(0.10)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, mid)
  ctx.lineTo(x + w, mid)
  ctx.stroke()

  flows.forEach((f, i) => {
    const bh = Math.max(1.5, (Math.abs(f) / maxA) * (h / 2 - 2))
    const bx = x + i * step + (step - bw) / 2
    ctx.fillStyle = f >= 0 ? c.bull : c.bear
    ctx.globalAlpha = 0.85
    roundRect(ctx, bx, f >= 0 ? mid - bh : mid, bw, bh, 1.5)
    ctx.fill()
    ctx.globalAlpha = 1
  })
}

/* ── one asset headline panel ─────────────────────────────────────────── */

function drawAssetPanel(ctx, c, meta, side, series, x, y, w) {
  const H = 96
  const t = (side && side.total) || {}

  roundRect(ctx, x, y, w, H, 12)
  ctx.fillStyle = c.cardBg
  ctx.fill()
  ctx.strokeStyle = c.cardBorder
  ctx.lineWidth = 1
  ctx.stroke()

  const px = x + 16
  // asset name + colour dot
  ctx.beginPath()
  ctx.arc(px + 4, y + 21, 4, 0, Math.PI * 2)
  ctx.fillStyle = meta.dot
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.font = `700 15px ${FONT}`
  ctx.fillStyle = c.symbol
  ctx.fillText(meta.name, px + 15, y + 26)

  // 1D + 7D, one line, right-aligned
  drawFlowPair(ctx, c, x + w - 16, y + 26, t.flow1dUsd, t.flow7dUsd)

  // holdings line
  ctx.textAlign = 'left'
  ctx.font = `500 11px ${FONT}`
  ctx.fillStyle = c.muted
  const held = [fUsd(t.holdingsUsd), fCoin(t.holdingsCoin, meta.key)]
    .filter((v) => v && v !== '—')
    .join('  ·  ')
  ctx.fillText(held ? `${held} held in spot ETFs` : 'Holdings warming up', px, y + 45)

  drawFlowBars(ctx, c, series, px, y + 54, w - 32, 30)
  return H
}

/* ── the issuer table for the asset on screen ─────────────────────────── */

function drawIssuerTable(ctx, c, meta, side, asOf, x, y, w) {
  const rows = foldIssuers(side && side.issuers, 6)
  const t = (side && side.total) || {}
  const colHold = x + 352
  const col1d = x + 462
  const col7d = x + w

  let cy = y
  ctx.textAlign = 'left'
  ctx.font = `700 13px ${FONT}`
  ctx.fillStyle = c.symbol
  ctx.fillText(`${meta.name} ETF issuers`, x, cy + 12)
  if (asOf) {
    ctx.textAlign = 'right'
    ctx.font = `500 10.5px ${FONT}`
    ctx.fillStyle = c.date
    ctx.fillText(`as of ${asOf}`, col7d, cy + 12)
  }
  cy += 26

  // column heads — Holdings / 1D net / 7D net read across one line
  ctx.font = `600 9.5px ${FONT}`
  ctx.fillStyle = c.thColor
  ctx.textAlign = 'left'
  ctx.fillText('ISSUER', x, cy)
  ctx.textAlign = 'right'
  ctx.fillText('HOLDINGS', colHold, cy)
  ctx.fillText('1D NET', col1d, cy)
  ctx.fillText('7D NET', col7d, cy)
  cy += 8

  const ROW = 30
  rows.forEach((r, i) => {
    const ry = cy + i * ROW
    if (i % 2 === 1) {
      ctx.fillStyle = c.rowAlt
      ctx.fillRect(x - 8, ry, w + 16, ROW)
    }

    ctx.textAlign = 'left'
    ctx.font = `600 12.5px ${FONT}`
    ctx.fillStyle = r._others ? c.muted : c.symbol
    const name = truncateText(ctx, r.issuer, 150)
    ctx.fillText(name, x, ry + 19)

    const tick = Array.isArray(r.tickers) && r.tickers.length ? r.tickers.join(' · ') : ''
    if (tick) {
      const nameW = ctx.measureText(name).width
      ctx.font = `500 10px ${FONT}`
      ctx.fillStyle = c.name
      ctx.fillText(truncateText(ctx, tick, 190 - nameW), x + nameW + 7, ry + 19)
    }

    ctx.textAlign = 'right'
    ctx.font = `600 12px ${FONT}`
    ctx.fillStyle = c.price
    ctx.fillText(fUsd(r.holdingsUsd), colHold, ry + 19)

    ctx.font = `700 12px ${FONT}`
    ctx.fillStyle = flowColor(r.flow1dUsd, c)
    ctx.fillText(fUsd(r.flow1dUsd, true), col1d, ry + 19)
    ctx.fillStyle = flowColor(r.flow7dUsd, c)
    ctx.fillText(fUsd(r.flow7dUsd, true), col7d, ry + 19)
  })
  cy += rows.length * ROW

  // total
  ctx.strokeStyle = c.whiteAlpha(0.10)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, cy + 0.5)
  ctx.lineTo(x + w, cy + 0.5)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.font = `800 13px ${FONT}`
  ctx.fillStyle = c.symbol
  ctx.fillText('Total', x, cy + 23)
  ctx.textAlign = 'right'
  ctx.font = `700 12.5px ${FONT}`
  ctx.fillStyle = c.price
  ctx.fillText(fUsd(t.holdingsUsd), colHold, cy + 23)
  ctx.font = `800 12.5px ${FONT}`
  ctx.fillStyle = flowColor(t.flow1dUsd, c)
  ctx.fillText(fUsd(t.flow1dUsd, true), col1d, cy + 23)
  ctx.fillStyle = flowColor(t.flow7dUsd, c)
  ctx.fillText(fUsd(t.flow7dUsd, true), col7d, cy + 23)

  return cy + 34 - y
}

/* ── post text: the same one-line-per-asset shape as the bot caption ──── */

export function etfShareText(summary, asOf) {
  const b = (summary && summary.btc && summary.btc.total) || {}
  const e = (summary && summary.eth && summary.eth.total) || {}
  const dot = (v) => (v > 0 ? '🟢' : v < 0 ? '🔴' : '⚪️')
  return [
    `📊 Spot ETF Net Flows${asOf ? ` · ${asOf}` : ''}`,
    '',
    `Bitcoin ${dot(b.flow1dUsd)} 1D ${fUsd(b.flow1dUsd, true)} · 7D ${fUsd(b.flow7dUsd, true)}`,
    `Ethereum ${dot(e.flow1dUsd)} 1D ${fUsd(e.flow1dUsd, true)} · 7D ${fUsd(e.flow7dUsd, true)}`,
    '',
    `Holdings: ${fUsd(b.holdingsUsd)} BTC · ${fUsd(e.holdingsUsd)} ETH`,
    '',
    '@Spectre__Ai',
  ].join('\n')
}

/**
 * Build the ETF share card.
 *
 * @param {object} opts
 * @param {object} opts.summary  /v1/etf/summary payload ({ btc, eth })
 * @param {object} opts.charts   { BTC: series[], ETH: series[] } (optional)
 * @param {string} opts.asset    'BTC' | 'ETH' — which issuer table to print
 * @returns {{ imageUrl: string, description: string }}
 */
export async function generateEtfShareCard({ summary, charts = {}, asset = 'BTC' } = {}) {
  if (!summary || !summary.btc) throw new Error('etf share: no summary')
  const meta = ASSETS.find((a) => a.key === asset) || ASSETS[0]
  const side = summary[meta.slug]
  const asOf = fmtDate((side && side.asOf) || summary.btc.asOf || summary.eth?.asOf)
  const logo = await getSpectreLogo()

  const imageUrl = renderShareCard(
    (ctx, w, contentTop, c) => {
      const pad = CARD_PAD
      const innerW = w - pad * 2
      let y = contentTop + 2

      ASSETS.forEach((a) => {
        const h = drawAssetPanel(ctx, c, a, summary[a.slug], charts[a.key], pad, y, innerW)
        y += h + 12
      })

      y += 4
      y += drawIssuerTable(ctx, c, meta, side, asOf, pad, y, innerW)

      return y - contentTop
    },
    {
      title: 'Spot ETF Net Flows',
      subtitle: asOf ? `as of ${asOf}` : 'Bitcoin & Ethereum',
      logo,
      badges: [{ text: meta.key, filled: true }],
    }
  )

  return { imageUrl, description: etfShareText(summary, asOf) }
}

export default generateEtfShareCard
