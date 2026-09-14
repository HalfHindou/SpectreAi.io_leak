/**
 * W-050 · AI Screener Widget
 * AI-filtered market scan table with signal badges and heat pill visualization.
 * Uses real trending tokens from Codex + Binance real-time prices.
 */
import { useMemo } from 'react'
import { useTrendingTokens, useBinanceTopCoinPrices } from '@/hooks/useCodexData'
import './AIScreener.css'

/* ---------- helpers ---------- */

function formatPrice(raw) {
  const price = Number(raw)
  if (!price || isNaN(price)) return '--'
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (price >= 1) return `$${price.toFixed(2)}`
  return `$${price.toFixed(4)}`
}

function formatVolume(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '--'
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`
  return `$${num.toFixed(0)}`
}

/** Derive signal from 24h change */
function deriveSignal(change) {
  if (change > 5) return 'BREAKOUT'
  if (change > 2) return 'ACCUMULATE'
  if (change < -5) return 'AVOID'
  if (change < -2) return 'AVOID'
  return 'WATCH'
}

/** Derive heat score (0-100) from volume relative to a baseline average */
function deriveHeat(volume, avgVolume) {
  if (!volume || !avgVolume || avgVolume === 0) return 50
  const ratio = volume / avgVolume
  // ratio 0.5 -> 20, 1.0 -> 50, 2.0 -> 80, 3.0+ -> 95
  return Math.max(0, Math.min(100, Math.round(ratio * 40 + 10)))
}

/* ---------- signal config (dynamic per-signal — stays inline) ---------- */

const SIGNAL_CONFIG = {
  ACCUMULATE: { bg: 'var(--bull-muted)', color: 'var(--bull)', pulse: false },
  WATCH: { bg: 'rgba(167,139,250,0.12)', color: 'var(--violet)', pulse: false },
  AVOID: { bg: 'var(--bear-muted)', color: 'var(--bear)', pulse: false },
  BREAKOUT: { bg: 'rgba(16,185,129,0.15)', color: 'var(--bull)', pulse: true },
}

/* ---------- heat pill (dynamic dot position — stays inline) ---------- */

function HeatPill({ value }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="tcas-heat">
      <div className="tcas-heat-dot" style={{ left: `${pct}%` }} />
    </div>
  )
}

/* ---------- major symbols for Binance overlay ---------- */

const BINANCE_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'AVAX', 'DOGE', 'ADA', 'XRP', 'DOT', 'LINK']

/* ---------- component ---------- */

export default function AIScreener() {
  const { tokens, loading: trendingLoading } = useTrendingTokens()
  const { prices: binancePrices, loading: binanceLoading } = useBinanceTopCoinPrices(BINANCE_SYMBOLS, 10000)

  const loading = trendingLoading && binanceLoading

  // Merge trending tokens with Binance real-time prices for major coins
  const data = useMemo(() => {
    if (!tokens || tokens.length === 0) {
      // Fallback: use Binance prices as standalone rows when trending is unavailable
      if (!binancePrices || Object.keys(binancePrices).length === 0) return null
      return BINANCE_SYMBOLS
        .filter(sym => binancePrices[sym])
        .map(sym => {
          const bp = binancePrices[sym]
          const change24h = bp.change || 0
          const signal = deriveSignal(change24h)
          return {
            asset: sym,
            name: sym,
            price: bp.price,
            change1h: bp.change1h || 0,
            change24h,
            volume: bp.volume || 0,
            signal,
            heat: deriveHeat(bp.volume, 500e6),
          }
        })
    }

    // Calculate average volume for heat scoring
    const volumes = tokens.map(t => t.volume24h || 0).filter(v => v > 0)
    const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1

    return tokens.slice(0, 12).map(token => {
      const sym = (token.symbol || '').toUpperCase()
      // Overlay Binance real-time price for major coins
      const bp = binancePrices[sym]
      const price = bp?.price || token.price || 0
      const change24h = bp?.change ?? token.change ?? 0
      const change1h = bp?.change1h ?? token.change1h ?? 0
      const volume = bp?.volume || token.volume24h || 0
      const signal = deriveSignal(change24h)
      const heat = deriveHeat(volume, avgVolume)

      return {
        asset: sym,
        name: token.name || sym,
        price,
        change1h,
        change24h,
        volume,
        signal,
        heat,
      }
    })
  }, [tokens, binancePrices])

  return (
    <div className="tcas">
      {/* Table header */}
      <div className="tcas-thead">
        <span className="tcas-th tcas-th--asset">Asset</span>
        <span className="tcas-th tcas-th--price">Price</span>
        <span className="tcas-th tcas-th--num">1h</span>
        <span className="tcas-th tcas-th--num">24h</span>
        <span className="tcas-th tcas-th--vol">Vol</span>
        <span className="tcas-th tcas-th--signal">Signal</span>
        <span className="tcas-th tcas-th--heat">Heat</span>
      </div>

      {/* Table body */}
      <div className="tcas-tbody">
        {loading || !data ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="tcas-skeleton-cell">
              <div className="tcw-shimmer tcas-skeleton" />
            </div>
          ))
        ) : (
          data.map((row) => {
            const sigCfg = SIGNAL_CONFIG[row.signal] || SIGNAL_CONFIG.WATCH
            const h1Positive = row.change1h >= 0
            const h24Positive = row.change24h >= 0

            return (
              <div key={row.asset} className="tcas-row">
                <span className="tcas-asset">{row.asset}</span>
                <span className="tcas-price">{formatPrice(row.price)}</span>

                <span className={`tcas-change ${h1Positive ? 'tcas-change--bull' : 'tcas-change--bear'}`}>
                  {h1Positive ? '▲' : '▼'}{Math.abs(Number(row.change1h) || 0).toFixed(1)}%
                </span>

                <span className={`tcas-change ${h24Positive ? 'tcas-change--bull' : 'tcas-change--bear'}`}>
                  {h24Positive ? '▲' : '▼'}{Math.abs(Number(row.change24h) || 0).toFixed(1)}%
                </span>

                <span className="tcas-vol">{formatVolume(row.volume)}</span>

                {/* Signal badge */}
                <div className="tcas-signal-cell">
                  <span
                    className={`tcas-signal${sigCfg.pulse ? ' tcas-signal--pulse' : ''}`}
                    style={{ background: sigCfg.bg, color: sigCfg.color }}
                  >{row.signal}</span>
                </div>

                {/* Heat pill */}
                <div className="tcas-heat-cell">
                  <HeatPill value={row.heat} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
