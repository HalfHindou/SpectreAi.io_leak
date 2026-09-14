/**
 * W-012 · Liquidation Bubbles Widget
 * Alternative liquidation view as SVG bubble map.
 * Bubbles positioned by price (X) with size proportional to liquidation volume.
 * Shorts (above price) green, longs (below price) red.
 * Powered by real Binance-cohort liquidation heatmap data.
 */
import { useMemo } from 'react'
import { useLiquidationLevels } from '../use-liquidation-levels'
import './LiquidationBubbles.css'

export default function LiquidationBubbles() {
  const { currentPrice, longs, shorts, loading, error } = useLiquidationLevels()

  const liquidations = useMemo(() => [...longs, ...shorts], [longs, shorts])

  /* SVG dimensions */
  const W = 400
  const H = 200
  const PAD_X = 40
  const PAD_Y = 30
  const CHART_W = W - PAD_X * 2
  const CHART_H = H - PAD_Y * 2

  const { minPrice, maxPrice, maxAmount } = useMemo(() => {
    if (liquidations.length === 0) return { minPrice: 0, maxPrice: 1, maxAmount: 1 }
    const prices = liquidations.map(l => l.price).concat(currentPrice || [])
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const pad = (max - min) * 0.06 || max * 0.01 || 1
    return {
      minPrice: min - pad,
      maxPrice: max + pad,
      maxAmount: Math.max(...liquidations.map(l => l.amount), 1),
    }
  }, [liquidations, currentPrice])

  const priceRange = maxPrice - minPrice || 1
  const priceToX = (price) => PAD_X + ((price - minPrice) / priceRange) * CHART_W
  const amountToRadius = (amount) => 8 + (amount / maxAmount) * 20

  const bubbles = useMemo(() => liquidations.map((liq, i) => {
    const x = priceToX(liq.price)
    const r = amountToRadius(liq.amount)
    const yNorm = 0.2 + (((i * 7 + 3) % 5) / 5) * 0.6
    const y = PAD_Y + yNorm * CHART_H
    return { ...liq, x, y, r }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [liquidations, minPrice, maxPrice, maxAmount])

  if (loading) {
    return (
      <div className="tclbb-loading">
        <div className="tcw-shimmer" style={{ width: '70%', height: 12 }} />
        <div className="tcw-shimmer" style={{ width: '50%', height: 12, animationDelay: '0.15s' }} />
        <div className="tcw-shimmer" style={{ width: '60%', height: 12, animationDelay: '0.3s' }} />
      </div>
    )
  }

  if (error || liquidations.length === 0) {
    return <div className="tcw"><div className="tcw-empty">Liquidation data unavailable</div></div>
  }

  const currentX = priceToX(currentPrice)
  const largestAmount = maxAmount * 0.85

  /* Evenly spaced price axis labels across the visible range */
  const gridPrices = [0.1, 0.3, 0.5, 0.7, 0.9].map(p => minPrice + priceRange * p)

  return (
    <div className="tclbb">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="tclbb-svg"
      >
        {[0.25, 0.5, 0.75].map((pct) => {
          const y = PAD_Y + pct * CHART_H
          return (
            <line key={pct} x1={PAD_X} y1={y} x2={W - PAD_X} y2={y}
              stroke="rgba(255,255,255,0.02)" strokeWidth={1} />
          )
        })}

        {gridPrices.map((price) => {
          const x = priceToX(price)
          return (
            <g key={price}>
              <line x1={x} y1={PAD_Y} x2={x} y2={H - PAD_Y}
                stroke="rgba(255,255,255,0.02)" strokeWidth={1} />
              <text x={x} y={H - 8} textAnchor="middle" className="tclbb-axis-label">
                {price >= 1000 ? `${(price / 1000).toFixed(1)}k` : price.toFixed(0)}
              </text>
            </g>
          )
        })}

        {/* Current price vertical dashed line */}
        <line x1={currentX} y1={PAD_Y} x2={currentX} y2={H - PAD_Y}
          stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 3" />
        <text x={Math.min(Math.max(currentX, 24), W - 24)} y={PAD_Y - 6} textAnchor="middle"
          className="tclbb-current-label">
          ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>

        {bubbles.map((b) => {
          const isLong = b.type === 'long'
          const fillColor = isLong ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'
          const strokeColor = isLong ? 'rgba(239,68,68,0.6)' : 'rgba(16,185,129,0.6)'
          const shouldPulse = b.amount >= largestAmount
          return (
            <circle
              key={`${b.price}-${b.type}`}
              cx={b.x}
              cy={b.y}
              r={b.r}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={1}
              className={`tclbb-bubble${shouldPulse ? ' tclbb-bubble--pulse' : ''}`}
            />
          )
        })}

        {bubbles.filter(b => b.r > 16).map((b) => (
          <text key={`label-${b.price}`} x={b.x} y={b.y + 3} textAnchor="middle"
            className="tclbb-bubble-label">
            {b.amount >= 1e9 ? `${(b.amount / 1e9).toFixed(1)}B` : `${(b.amount / 1e6).toFixed(0)}M`}
          </text>
        ))}
      </svg>
    </div>
  )
}
