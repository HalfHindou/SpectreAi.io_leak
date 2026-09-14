/**
 * W-011 · Liquidation Bars Widget
 * Signature liquidation heatmap bar visualization.
 * Short clusters ABOVE current price (shorts blow out as price rises),
 * long clusters BELOW current price (longs blow out as price falls).
 * Powered by real Binance-cohort liquidation heatmap data.
 */
import { useLiquidationLevels } from '../use-liquidation-levels'
import './LiquidationBars.css'

// Deterministic shimmer widths so the skeleton doesn't flicker between renders.
const SHIMMER_WIDTHS = ['72%', '54%', '83%', '61%', '76%', '58%']

function formatAmount(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '$0'
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`
  return `$${num.toFixed(0)}`
}

function formatPrice(num) {
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function LiqBar({ price, amount, type, maxAmount, animDelay }) {
  const pct = maxAmount > 0 ? (amount / maxAmount) * 100 : 0
  return (
    <div className="tclb-bar">
      <span className="tclb-price">${formatPrice(price)}</span>
      <div className="tclb-track">
        <div
          className={`tclb-fill tclb-fill--${type}`}
          style={{ width: `${pct}%`, transitionDelay: `${animDelay}ms` }}
        />
      </div>
      <span className="tclb-amount">{formatAmount(amount)}</span>
    </div>
  )
}

export default function LiquidationBars() {
  const { currentPrice, longs, shorts, loading, error } = useLiquidationLevels()

  if (loading) {
    return (
      <div className="tcw" style={{ gap: 10, padding: '8px 0' }}>
        {SHIMMER_WIDTHS.map((w, i) => (
          <div
            key={i}
            className="tcw-shimmer tclb-skeleton"
            style={{ width: w, animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    )
  }

  if (error || (longs.length === 0 && shorts.length === 0)) {
    return <div className="tcw"><div className="tcw-empty">Liquidation data unavailable</div></div>
  }

  const maxAmount = Math.max(
    ...longs.map(l => l.amount),
    ...shorts.map(l => l.amount),
    1,
  )

  const allLevels = [...longs, ...shorts]
  const biggest = allLevels.reduce((max, l) => (l.amount > max.amount ? l : max), allLevels[0])
  const nextHunt = biggest
    ? `$${formatPrice(biggest.price)} ${biggest.type === 'long' ? 'longs' : 'shorts'} (${formatAmount(biggest.amount)})`
    : '—'

  return (
    <div className="tcw" style={{ gap: 4 }}>
      {/* Short liquidations (above price) - highest price at top */}
      <div className="tclb-section">
        <div className="tcw-label tclb-section-label tclb-section-label--short">Short Liquidations</div>
        {[...shorts].reverse().map((liq, i) => (
          <LiqBar key={liq.price} price={liq.price} amount={liq.amount}
            type="short" maxAmount={maxAmount} animDelay={i * 80} />
        ))}
      </div>

      {/* Current price divider */}
      <div className="tclb-current">
        <div className="tclb-current-line" />
        <span className="tclb-current-price">${formatPrice(currentPrice)}</span>
        <div className="tclb-current-line" />
      </div>

      {/* Long liquidations (below price) */}
      <div className="tclb-section">
        <div className="tcw-label tclb-section-label tclb-section-label--long">Long Liquidations</div>
        {[...longs].reverse().map((liq, i) => (
          <LiqBar key={liq.price} price={liq.price} amount={liq.amount}
            type="long" maxAmount={maxAmount} animDelay={(i + shorts.length) * 80} />
        ))}
      </div>

      <div className="tclb-footer">Next major hunt: {nextHunt}</div>
    </div>
  )
}
