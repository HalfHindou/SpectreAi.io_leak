/**
 * MobileMarketPulse — horizontal scrolling market data strip for mobile Welcome page.
 * Shows BTC, ETH, SOL prices, Fear & Greed, BTC dominance, and total market cap
 * as tappable glass chips in a single row.
 *
 * Props come from WelcomePage's existing hooks (useMarketPrices, useTopSectionData).
 * Hidden when isStocks is true (crypto data only).
 */
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './mobile-market-pulse.css'

/* ── Local formatters (lightweight, no external deps) ── */

function fmtCompactPrice(price) {
  if (price == null || isNaN(price)) return '-'
  const n = Number(price)
  if (n >= 1) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (n >= 0.01) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  }
  // Very small prices — show significant digits
  return n.toPrecision(4)
}

function fmtPct(value) {
  if (value == null || isNaN(value)) return null
  const n = Number(value)
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function fmtMarketCap(value) {
  if (value == null || isNaN(value) || value === 0) return '-'
  const n = Number(value)
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString('en-US')}`
}

/**
 * Determine the color class for a Fear & Greed value.
 * 0-25 Extreme Fear (red), 26-46 Fear (orange), 47-53 Neutral (gray),
 * 54-75 Greed (green), 76-100 Extreme Greed (bright green).
 */
function fgSentimentClass(value) {
  if (value == null) return ''
  const v = Number(value)
  if (v <= 25) return 'extreme-fear'
  if (v <= 46) return 'fear'
  if (v <= 53) return 'neutral'
  if (v <= 75) return 'greed'
  return 'extreme-greed'
}

/* ── Token chip definitions ── */
/* `cgId` is carried explicitly rather than left to getTokenSlug's symbol lookup:
   the chip is a fixed, known asset, so the Research Zone should never have to
   resolve "BTC" and risk landing on a same-ticker impostor. */
const TOKEN_CHIPS = [
  { symbol: 'BTC', name: 'Bitcoin', cgId: 'bitcoin', brandColor: '#F7931A', logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png' },
  { symbol: 'ETH', name: 'Ethereum', cgId: 'ethereum', brandColor: '#627EEA', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  { symbol: 'SOL', name: 'Solana', cgId: 'solana', brandColor: '#14F195', logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
]

/* ── Loading skeleton ── */
function PulseSkeleton() {
  return (
    <div className="mmp-strip" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`mmp-skeleton animate-shimmer stagger-${i + 1}`} />
      ))}
    </div>
  )
}

/* ── Individual chip components ── */

function TokenChip({ symbol, name, cgId, brandColor, logo, data, onTap }) {
  const price = data?.price != null && data.price > 0 ? Number(data.price) : null
  const change = data?.change != null ? Number(data.change) : null
  const pctStr = fmtPct(change)
  const isPositive = change != null && change >= 0

  const handleClick = useCallback(() => {
    if (onTap) onTap({ symbol, name, cgId })
  }, [onTap, symbol, name, cgId])

  return (
    <button type="button" className="mmp-chip mmp-chip--token" onClick={handleClick}>
      {logo ? (
        <img className="mmp-chip-logo-img" src={logo} alt="" width={20} height={20} loading="lazy" />
      ) : (
        <span className="mmp-chip-logo" style={{ backgroundColor: brandColor }} aria-hidden="true">
          {symbol.charAt(0)}
        </span>
      )}
      <span className="mmp-chip-symbol">{symbol}</span>
      <span className="mmp-chip-price">
        {price != null ? `$${fmtCompactPrice(price)}` : '-'}
      </span>
      {pctStr && (
        <span className={`mmp-chip-change ${isPositive ? 'positive' : 'negative'}`}>
          {pctStr}
        </span>
      )}
    </button>
  )
}

function FearGreedChip({ fearGreed }) {
  const value = fearGreed?.value
  const sentimentCls = fgSentimentClass(value)

  return (
    <div className="mmp-chip mmp-chip--stat">
      <span className={`mmp-chip-fg-value ${sentimentCls}`}>
        {value != null ? value : '-'}
      </span>
      <span className="mmp-chip-label">F&G</span>
    </div>
  )
}

function DominanceChip({ marketDominance }) {
  const { t } = useTranslation()
  const btcDom = marketDominance?.btc

  return (
    <div className="mmp-chip mmp-chip--stat">
      <span className="mmp-chip-stat-label">{t('homePage.mobileMarketPulse.dominancechip.btc', "BTC")}</span>
      <span className="mmp-chip-stat-value">
        {btcDom != null ? `${Number(btcDom).toFixed(1)}%` : '-'}
      </span>
    </div>
  )
}

function MarketCapChip({ topCoinPrices, marketDominance }) {
  const { t } = useTranslation()
  const totalMcap = useMemo(() => {
    const btcMcap = topCoinPrices?.BTC?.marketCap
    const btcDom = marketDominance?.btc
    if (btcMcap && btcDom > 0) {
      return btcMcap / (btcDom / 100)
    }
    return null
  }, [topCoinPrices, marketDominance])

  return (
    <div className="mmp-chip mmp-chip--stat">
      <span className="mmp-chip-stat-value">{fmtMarketCap(totalMcap)}</span>
      <span className="mmp-chip-label">{t('homePage.mobileMarketPulse.marketcapchip.mcap', "MCap")}</span>
    </div>
  )
}

/* ── Main component ── */

function MobileMarketPulse({
  topCoinPrices,
  fearGreed,
  marketDominance,
  isStocks,
  onOpenResearchZone,
  dayMode,
  t,
}) {
  // WS prices merged upstream in useBinanceTopCoinPrices
  const effectivePrices = topCoinPrices

  // Hide entirely in stocks mode - this is crypto-only
  if (isStocks) return null

  const hasData = effectivePrices && Object.keys(effectivePrices).length > 0

  return (
    <div className={`mmp${dayMode ? ' mmp--day' : ''}`}>
      {!hasData ? (
        <PulseSkeleton />
      ) : (
        <div className="mmp-strip">
          {/* Only token prices — stat chips (F&G, Dominance, MCap) live in QuickStats */}
          {TOKEN_CHIPS.map(({ symbol, name, cgId, brandColor, logo }) => (
            <TokenChip
              key={symbol}
              symbol={symbol}
              name={name}
              cgId={cgId}
              brandColor={brandColor}
              logo={logo}
              data={effectivePrices?.[symbol]}
              /* Research Zone, NOT the app's generic selectToken — that helper
                 treats a "terminal-capable" major (BTC/ETH/SOL are all in
                 TERMINAL_MAJOR_SYMBOLS) as a request for the trading terminal
                 and lands on the AI Screener. Tapping a price chip on the
                 welcome page reads as "tell me about this asset", not "trade
                 it" (founder, 08-05). */
              onTap={onOpenResearchZone}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Memoize with shallow price comparison ── */
export default React.memo(MobileMarketPulse, (prev, next) => {
  // Quick bailout: if structural props changed, re-render
  if (prev.isStocks !== next.isStocks) return false
  if (prev.dayMode !== next.dayMode) return false

  // Compare price data by checking BTC/ETH/SOL prices + changes
  const symbols = ['BTC', 'ETH', 'SOL']
  for (const s of symbols) {
    const a = prev.topCoinPrices?.[s]
    const b = next.topCoinPrices?.[s]
    if (a?.price !== b?.price || a?.change !== b?.change) return false
  }

  // Compare fear & greed value
  if (prev.fearGreed?.value !== next.fearGreed?.value) return false

  // Compare dominance
  if (prev.marketDominance?.btc !== next.marketDominance?.btc) return false

  // Compare market cap input (BTC marketCap)
  if (prev.topCoinPrices?.BTC?.marketCap !== next.topCoinPrices?.BTC?.marketCap) return false

  return true
})
