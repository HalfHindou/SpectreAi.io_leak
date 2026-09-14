/**
 * W-015 · Order Book Depth Widget
 * Real Binance Futures order book. Bids (green) on left, asks (red) on right.
 * Center divider at current mark price.
 */
import { useState, useEffect, useMemo } from 'react'
import { logError } from '@/lib/logger'
import './OrderBookDepth.css'

const BINANCE_FUTURES = '/api/derivatives/binance'

/**
 * Fetch real depth + mark price from Binance Futures.
 * /fapi/v1/depth returns { bids: [[price, qty]...], asks: [[price, qty]...] }
 * /fapi/v1/premiumIndex?symbol=X returns { markPrice }
 */
async function fetchDepth(symbol = 'BTCUSDT') {
  const [depthRes, markRes] = await Promise.all([
    fetch(`${BINANCE_FUTURES}/fapi/v1/depth?symbol=${symbol}&limit=50`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${BINANCE_FUTURES}/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) }),
  ])
  if (!depthRes.ok) throw new Error(`Depth ${depthRes.status}`)
  if (!markRes.ok) throw new Error(`Mark price ${markRes.status}`)

  const depth = await depthRes.json()
  const mark = await markRes.json()
  const markPrice = parseFloat(mark.markPrice)
  if (!markPrice || isNaN(markPrice)) throw new Error('Invalid mark price')

  /* Bids: descending price, accumulate volume in USD */
  const rawBids = (depth.bids || [])
    .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }))
    .filter(b => b.price > 0 && b.qty > 0)
    .sort((a, b) => b.price - a.price)
    .slice(0, 20)
  let cumBid = 0
  const bids = rawBids.map(b => {
    const usd = b.price * b.qty
    cumBid += usd
    return { price: b.price, volume: usd, cumulative: cumBid }
  })

  /* Asks: ascending price */
  const rawAsks = (depth.asks || [])
    .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }))
    .filter(a => a.price > 0 && a.qty > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 20)
  let cumAsk = 0
  const asks = rawAsks.map(a => {
    const usd = a.price * a.qty
    cumAsk += usd
    return { price: a.price, volume: usd, cumulative: cumAsk }
  })

  return { bids, asks, markPrice }
}

function formatVol(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '0'
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`
  return num.toFixed(0)
}

function formatPriceLabel(price) {
  if (price >= 1000) return `${(price / 1000).toFixed(1)}k`
  if (price >= 1) return price.toFixed(2)
  if (price >= 0.01) return price.toFixed(4)
  return price.toPrecision(3)
}

export default function OrderBookDepth({ symbol = 'BTCUSDT' }) {
  const [book, setBook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchDepth(symbol)
      .then(b => {
        if (cancelled) return
        setBook(b)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message || 'unavailable')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [symbol])

  /* Refresh every 10s */
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      fetchDepth(symbol)
        .then(setBook)
        .catch(err => logError('OrderBookDepth:refresh', err))
    }, 10_000)
    return () => clearInterval(id)
  }, [symbol])

  /* SVG dimensions */
  const W = 400
  const H = 180
  const PAD_L = 12
  const PAD_R = 12
  const PAD_T = 16
  const PAD_B = 28
  const CHART_W = W - PAD_L - PAD_R
  const CHART_H = H - PAD_T - PAD_B
  const CENTER_X = PAD_L + CHART_W / 2

  const view = useMemo(() => {
    if (!book || !book.bids?.length || !book.asks?.length) return null
    const { bids, asks, markPrice } = book

    const maxCum = Math.max(
      bids[bids.length - 1]?.cumulative || 0,
      asks[asks.length - 1]?.cumulative || 0,
    ) || 1

    const bidMinPrice = bids[bids.length - 1].price
    const askMaxPrice = asks[asks.length - 1].price

    const priceToX = (price) => {
      const totalRange = askMaxPrice - bidMinPrice || 1
      return PAD_L + ((price - bidMinPrice) / totalRange) * CHART_W
    }
    const cumToY = (cum) => PAD_T + CHART_H - (cum / maxCum) * CHART_H

    const bidPath = (() => {
      const pts = [{ x: CENTER_X, y: PAD_T + CHART_H }]
      bids.forEach((b) => {
        pts.push({ x: priceToX(b.price), y: cumToY(b.cumulative) })
      })
      const last = pts[pts.length - 1]
      pts.push({ x: last.x, y: PAD_T + CHART_H })
      pts.push({ x: CENTER_X, y: PAD_T + CHART_H })
      return pts.map((p, i) => i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`).join(' ')
    })()

    const bidLinePath = (() => {
      const pts = [{ x: CENTER_X, y: PAD_T + CHART_H }]
      bids.forEach((b) => {
        pts.push({ x: priceToX(b.price), y: cumToY(b.cumulative) })
      })
      return pts.map((p, i) => i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`).join(' ')
    })()

    const askPath = (() => {
      const pts = [{ x: CENTER_X, y: PAD_T + CHART_H }]
      asks.forEach((a) => {
        pts.push({ x: priceToX(a.price), y: cumToY(a.cumulative) })
      })
      const last = pts[pts.length - 1]
      pts.push({ x: last.x, y: PAD_T + CHART_H })
      pts.push({ x: CENTER_X, y: PAD_T + CHART_H })
      return pts.map((p, i) => i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`).join(' ')
    })()

    const askLinePath = (() => {
      const pts = [{ x: CENTER_X, y: PAD_T + CHART_H }]
      asks.forEach((a) => {
        pts.push({ x: priceToX(a.price), y: cumToY(a.cumulative) })
      })
      return pts.map((p, i) => i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`).join(' ')
    })()

    const xLabels = [
      bidMinPrice,
      bidMinPrice + (markPrice - bidMinPrice) / 2,
      markPrice,
      markPrice + (askMaxPrice - markPrice) / 2,
      askMaxPrice,
    ]

    const totalBids = bids[bids.length - 1].cumulative
    const totalAsks = asks[asks.length - 1].cumulative
    const bidRatio = totalBids / (totalBids + totalAsks)

    return {
      maxCum, priceToX, cumToY,
      bidPath, bidLinePath, askPath, askLinePath,
      xLabels, totalBids, totalAsks, bidRatio, markPrice,
    }
  }, [book])

  if (loading) {
    return (
      <div className="tcob-loading">
        <div className="tcw-shimmer" style={{ width: '70%', height: 12 }} />
        <div className="tcw-shimmer" style={{ width: '50%', height: 12 }} />
        <div className="tcw-shimmer" style={{ width: '60%', height: 12 }} />
      </div>
    )
  }

  if (error || !view) {
    return (
      <div className="tcw-empty">
        {symbol} · order book offline
      </div>
    )
  }

  const { maxCum, priceToX, bidPath, bidLinePath, askPath, askLinePath, xLabels, totalBids, totalAsks, bidRatio, markPrice } = view

  return (
    <div className="tcob">
      {/* Header stats */}
      <div className="tcob-head">
        <span className="tcob-side tcob-side--bid">
          Bids: ${formatVol(totalBids)}
        </span>
        <span className="tcob-mark">
          ${markPrice >= 1 ? markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : markPrice.toPrecision(4)}
        </span>
        <span className="tcob-side tcob-side--ask">
          Asks: ${formatVol(totalAsks)}
        </span>
      </div>

      {/* Chart */}
      <div className="tcob-chart">
        <svg
          className="tcob-svg"
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="ob-bid-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16,185,129,0.25)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.02)" />
            </linearGradient>
            <linearGradient id="ob-ask-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(239,68,68,0.25)" />
              <stop offset="100%" stopColor="rgba(239,68,68,0.02)" />
            </linearGradient>
          </defs>

          {/* Horizontal grid lines */}
          {[0.25, 0.5, 0.75].map((pct) => {
            const y = PAD_T + (1 - pct) * CHART_H
            return (
              <line
                key={pct}
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke="rgba(255,255,255,0.02)"
                strokeWidth={1}
              />
            )
          })}

          <path d={bidPath} fill="url(#ob-bid-fill)" />
          <path
            d={bidLinePath}
            fill="none"
            stroke="var(--bull)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <path d={askPath} fill="url(#ob-ask-fill)" />
          <path
            d={askLinePath}
            fill="none"
            stroke="var(--bear)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Center mark price divider */}
          <line
            x1={CENTER_X}
            y1={PAD_T}
            x2={CENTER_X}
            y2={PAD_T + CHART_H}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />

          {/* X axis price labels */}
          {xLabels.map((price, i) => {
            const x = priceToX(price)
            const isCurrent = i === 2
            return (
              <text
                key={i}
                x={x}
                y={H - 6}
                textAnchor="middle"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 8,
                  fontWeight: isCurrent ? 600 : 400,
                  fill: isCurrent ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {formatPriceLabel(price)}
              </text>
            )
          })}

          {/* Y axis cumulative labels */}
          {[0.5, 1].map((pct) => {
            const val = maxCum * pct
            const y = PAD_T + (1 - pct) * CHART_H
            return (
              <text
                key={pct}
                x={PAD_L + 4}
                y={y - 4}
                textAnchor="start"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 7,
                  fill: 'var(--text-muted)',
                }}
              >
                ${formatVol(val)}
              </text>
            )
          })}
        </svg>
      </div>

      {/* Bid/Ask ratio bar */}
      <div className="tcob-ratio">
        <span className="tcob-ratio-pct">
          {(bidRatio * 100).toFixed(0)}%
        </span>
        <div className="tcob-ratio-track">
          <div className="tcob-ratio-fill--bid" style={{ width: `${bidRatio * 100}%` }} />
          <div className="tcob-ratio-fill--ask" style={{ width: `${(1 - bidRatio) * 100}%` }} />
        </div>
        <span className="tcob-ratio-pct tcob-ratio-pct--right">
          {((1 - bidRatio) * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  )
}
