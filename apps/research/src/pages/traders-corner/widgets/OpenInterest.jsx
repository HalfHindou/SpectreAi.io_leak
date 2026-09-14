/**
 * W-003 · Open Interest Widget
 * Shows aggregate OI value (BTC contracts * BTC price), 24h change,
 * and funding rate with directional label.
 * Powered by useMarketIntel real-time data.
 */
import { useMarketIntel } from '@/hooks/useMarketIntel'
import './OpenInterest.css'

/* ---------- helpers ---------- */

function formatOI(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '$0'
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`
  return `$${num.toLocaleString()}`
}

/* ---------- component ---------- */

export default function OpenInterest() {
  const { openInterest, fundingRates, tickers, loading } = useMarketIntel()

  // BTC price from tickers (real CoinGecko/Binance data)
  const btcPrice = tickers?.majorCoins?.btc?.price || 0
  const ethPrice = tickers?.majorCoins?.eth?.price || 0

  // Compute dollar-value OI: BTC contracts * BTC price
  const oiValue = openInterest.btc > 0 ? openInterest.btc * btcPrice : 0

  // ETH OI in USD for secondary display
  const ethOI = openInterest.eth || 0
  const ethOIUsd = ethOI > 0 ? ethOI * ethPrice : 0

  // BTC funding rate
  const fundingRate = fundingRates.btc || 0
  const fundingPositive = fundingRate >= 0

  // Total OI = BTC + ETH in USD
  const totalOI = oiValue + ethOIUsd

  return (
    <div className="tcoi">
      {/* OI Value */}
      {loading ? (
        <div className="tcw-shimmer tcoi-skeleton-value" />
      ) : (
        <div className="tcoi-value">{formatOI(totalOI)}</div>
      )}

      {/* BTC + ETH OI breakdown */}
      {loading ? (
        <div className="tcw-shimmer tcoi-skeleton-breakdown" />
      ) : (
        <div className="tcoi-breakdown">
          <div className="tcoi-leg">
            <span className="tcoi-leg-label">BTC</span>
            {oiValue > 0 ? formatOI(oiValue) : '—'}
          </div>
          <div className="tcoi-leg">
            <span className="tcoi-leg-label">ETH</span>
            {ethOIUsd > 0 ? formatOI(ethOIUsd) : '—'}
          </div>
        </div>
      )}

      {/* Funding Rate */}
      <div className="tcoi-funding">
        {loading ? (
          <div className="tcw-shimmer tcoi-skeleton-funding" />
        ) : (
          <div className="tcoi-funding-row">
            <span className="tcoi-funding-rate">
              {Number(fundingRate) >= 0 ? '+' : ''}{Number(fundingRate || 0).toFixed(4)}%
            </span>
            <span className="tcoi-funding-label">
              {fundingPositive ? 'LONGS PAYING' : 'SHORTS PAYING'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
