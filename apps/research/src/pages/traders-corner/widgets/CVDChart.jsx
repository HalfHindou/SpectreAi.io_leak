/**
 * W-014 · CVD (Cumulative Volume Delta) Chart Widget
 * Real CVD derived from Binance Futures klines (takerBuyVolume vs takerSellVolume).
 * Positive CVD = net taker buying. Negative = net taker selling.
 * Price line overlay. Footer divergence badge.
 */
import { useState, useEffect, useMemo } from 'react'
import { logError } from '@/lib/logger'
import { getKlines } from '../tradersCornerApi'
import './CVDChart.css'

/**
 * Fetch 48 hourly candles through the shared Traders Corner adapter.
 * Spectre chart rows do not always include taker-buy volume, so the fallback
 * approximates delta from candle direction and volume instead of hammering the
 * broken local Binance proxy.
 */
async function fetchCVD(symbol = 'BTCUSDT') {
  const rows = await getKlines(symbol, '1h', 48)
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Empty klines')

  const points = []
  let cvd = 0
  for (let i = 0; i < rows.length; i++) {
    const k = rows[i]
    const close = Number(k.close)
    const open = Number(k.open ?? close)
    const totalVol = Number(k.volume ?? 0)
    const takerBuyVol = Number(k.takerBuyVolume ?? k.taker_buy_volume)
    const directionalVol = Number.isFinite(takerBuyVol)
      ? (2 * takerBuyVol - totalVol)
      : (close >= open ? totalVol : -totalVol)
    const delta = directionalVol * close
    cvd += delta
    points.push({
      index: i,
      time: k.time,
      cvd,
      price: close,
      hour: new Date(k.time).getUTCHours(),
    })
  }
  return points
}

function formatCVD(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '$0'
  const abs = Math.abs(num)
  if (abs >= 1e9) return `${num > 0 ? '+' : '-'}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${num > 0 ? '+' : '-'}$${(abs / 1e6).toFixed(1)}M`
  return `${num > 0 ? '+' : '-'}$${(abs / 1e3).toFixed(0)}K`
}

export default function CVDChart({ symbol = 'BTCUSDT' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCVD(symbol)
      .then(points => {
        if (cancelled) return
        setData(points)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message || 'Data temporarily unavailable')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [symbol])

  /* Refresh every 60s */
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      fetchCVD(symbol)
        .then(setData)
        .catch(err => logError('CVDChart:refresh', err))
    }, 60_000)
    return () => clearInterval(id)
  }, [symbol])

  /* SVG dimensions */
  const W = 400
  const H = 180
  const PAD_L = 48
  const PAD_R = 12
  const PAD_T = 12
  const PAD_B = 28
  const CHART_W = W - PAD_L - PAD_R
  const CHART_H = H - PAD_T - PAD_B

  const view = useMemo(() => {
    if (!data || data.length === 0) return null
    const cvdValues = data.map(d => d.cvd)
    const cvdMin = Math.min(...cvdValues)
    const cvdMax = Math.max(...cvdValues)
    const cvdRange = cvdMax - cvdMin || 1
    const priceValues = data.map(d => d.price)
    const priceMin = Math.min(...priceValues)
    const priceMax = Math.max(...priceValues)
    const priceRange = priceMax - priceMin || 1
    const cvdToY = (cvd) => PAD_T + (1 - (cvd - cvdMin) / cvdRange) * CHART_H
    const priceToY = (price) => PAD_T + (1 - (price - priceMin) / priceRange) * CHART_H
    const xStep = CHART_W / (data.length - 1)
    const zeroY = cvdToY(0)
    const zeroInRange = zeroY >= PAD_T && zeroY <= PAD_T + CHART_H
    const cvdPoints = data.map((d, i) => ({
      x: PAD_L + i * xStep,
      y: cvdToY(d.cvd),
    }))
    const cvdPath = cvdPoints.map((p, i) =>
      i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`
    ).join(' ')
    const pricePath = data.map((d, i) => {
      const x = PAD_L + i * xStep
      const y = priceToY(d.price)
      return i === 0 ? `M ${x},${y}` : `L ${x},${y}`
    }).join(' ')
    const lastCVD = data[data.length - 1].cvd
    const firstCVD = data[0].cvd
    const lastPrice = data[data.length - 1].price
    const firstPrice = data[0].price
    const cvdTrend = lastCVD > firstCVD ? 'up' : 'down'
    const priceTrend = lastPrice > firstPrice ? 'up' : 'down'
    let divergence = 'Confirming'
    let divergenceColor = 'var(--text-muted)'
    if (cvdTrend === 'up' && priceTrend === 'down') {
      divergence = 'Bullish Divergence'
      divergenceColor = 'var(--bull)'
    } else if (cvdTrend === 'down' && priceTrend === 'up') {
      divergence = 'Bearish Divergence'
      divergenceColor = 'var(--bear)'
    }
    return {
      cvdMin, cvdMax, cvdRange, cvdToY, xStep,
      zeroY, zeroInRange, cvdPath, pricePath,
      lastCVD, divergence, divergenceColor,
    }
  }, [data])

  if (loading) {
    return (
      <div className="tccvd-loading">
        <div className="tcw-shimmer" style={{ width: '70%', height: 12 }} />
        <div className="tcw-shimmer" style={{ width: '50%', height: 12 }} />
        <div className="tcw-shimmer" style={{ width: '60%', height: 12 }} />
      </div>
    )
  }

  if (error || !view) {
    return (
      <div className="tcw-empty">
        {symbol} · CVD feed offline
      </div>
    )
  }

  const { cvdMin, cvdRange, cvdToY, xStep, zeroY, zeroInRange, cvdPath, pricePath, lastCVD, divergence, divergenceColor } = view

  return (
    <div className="tccvd">
      {/* Current CVD value */}
      <div className="tccvd-head">
        <span className={`tccvd-value ${lastCVD >= 0 ? 'tccvd-value--bull' : 'tccvd-value--bear'}`}>
          {formatCVD(lastCVD)}
        </span>
        <span className="tccvd-meta">
          {data.length} bars · 1h
        </span>
      </div>

      {/* Chart */}
      <div className="tccvd-chart">
        <svg
          className="tccvd-svg"
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="cvd-bull-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16,185,129,0.15)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0)" />
            </linearGradient>
            <linearGradient id="cvd-bear-fill" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="rgba(239,68,68,0.15)" />
              <stop offset="100%" stopColor="rgba(239,68,68,0)" />
            </linearGradient>
          </defs>

          {/* Y axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const val = cvdMin + pct * cvdRange
            const y = PAD_T + (1 - pct) * CHART_H
            return (
              <g key={pct}>
                <line
                  x1={PAD_L}
                  y1={y}
                  x2={W - PAD_R}
                  y2={y}
                  stroke="rgba(255,255,255,0.03)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 6}
                  y={y + 3}
                  textAnchor="end"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 7,
                    fill: 'var(--text-muted)',
                  }}
                >
                  {formatCVD(val)}
                </text>
              </g>
            )
          })}

          {/* Zero baseline */}
          {zeroInRange && (
            <line
              x1={PAD_L}
              y1={zeroY}
              x2={W - PAD_R}
              y2={zeroY}
              stroke="var(--border-subtle)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}

          {/* CVD area fill (above zero = bull, below = bear) */}
          {zeroInRange && (
            <>
              <clipPath id="cvd-clip-above">
                <rect x={PAD_L} y={PAD_T} width={CHART_W} height={zeroY - PAD_T} />
              </clipPath>
              <path
                d={`${cvdPath} L ${PAD_L + (data.length - 1) * xStep},${zeroY} L ${PAD_L},${zeroY} Z`}
                fill="url(#cvd-bull-fill)"
                clipPath="url(#cvd-clip-above)"
              />
              <clipPath id="cvd-clip-below">
                <rect x={PAD_L} y={zeroY} width={CHART_W} height={PAD_T + CHART_H - zeroY} />
              </clipPath>
              <path
                d={`${cvdPath} L ${PAD_L + (data.length - 1) * xStep},${zeroY} L ${PAD_L},${zeroY} Z`}
                fill="url(#cvd-bear-fill)"
                clipPath="url(#cvd-clip-below)"
              />
            </>
          )}

          {/* CVD line */}
          <path
            d={cvdPath}
            fill="none"
            stroke={lastCVD >= 0 ? 'var(--bull)' : 'var(--bear)'}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Price line overlay */}
          <path
            d={pricePath}
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={1}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 2"
          />

          {/* X axis labels */}
          {data.filter((_, i) => i % 8 === 0).map((d, idx) => {
            const i = idx * 8
            const x = PAD_L + i * xStep
            return (
              <text
                key={i}
                x={x}
                y={H - 6}
                textAnchor="middle"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 8,
                  fill: 'var(--text-muted)',
                }}
              >
                {`${d.hour}:00`}
              </text>
            )
          })}

          {/* End point dot */}
          <circle
            cx={PAD_L + (data.length - 1) * xStep}
            cy={cvdToY(lastCVD)}
            r={3}
            fill={lastCVD >= 0 ? 'var(--bull)' : 'var(--bear)'}
            stroke="var(--bg-base)"
            strokeWidth={1.5}
          />
        </svg>
      </div>

      {/* Footer badge */}
      <div className="tccvd-footer">
        <div className={`tccvd-badge${
          divergence === 'Confirming'
            ? ''
            : divergence.includes('Bullish')
              ? ' tccvd-badge--bull'
              : ' tccvd-badge--bear'
        }`}>
          <span className="tccvd-badge-dot" style={{ background: divergenceColor }} />
          <span className="tccvd-badge-text" style={{ color: divergenceColor }}>
            {divergence}
          </span>
        </div>

        <span className="tccvd-overlay-note">
          Price overlay (dashed)
        </span>
      </div>
    </div>
  )
}
