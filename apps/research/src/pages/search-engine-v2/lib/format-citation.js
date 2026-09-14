/**
 * Format helpers for citation display.
 */

// Map a Spectre endpoint path to a clean human label.
// `/v1/prices/BTC` -> "Prices · BTC"
// `/v1/derivatives/composite/dashboard/BTC` -> "Derivatives · BTC"
// `/v1/news?limit=8` -> "News"
export function endpointLabel(endpoint) {
  if (!endpoint) return ''
  const path = endpoint.split('?')[0].replace(/^\/v1\//, '').replace(/\/+$/, '')
  const parts = path.split('/')
  const head = parts[0]
  const last = parts[parts.length - 1]
  const isTicker = /^[A-Z]{2,8}$/.test(last)
  const headLabel = head.charAt(0).toUpperCase() + head.slice(1).replace(/-/g, ' ')

  // Special cases
  if (path === 'sentiment/fear-greed') return 'Fear & Greed'
  if (path === 'global') return 'Global'
  if (path.startsWith('movers/')) return `Movers · ${parts[1] || ''}`.trim()
  if (path === 'intelligence/signals') return 'Signals'
  if (path === 'news') return 'News'
  if (path === 'news/breaking') return 'Breaking'
  if (path === 'trending') return 'Trending'
  if (path === 'gas') return 'Gas'
  if (path === 'defi/protocols') return 'DeFi Protocols'
  if (path === 'stablecoins') return 'Stablecoins'
  if (path.startsWith('discovery/')) return `Discovery · ${parts[1]}`
  if (path.startsWith('smart-money/')) return `Smart Money`
  if (path.startsWith('institutional/')) return `Institutional · ${last}`
  if (path.startsWith('derivatives/')) {
    return isTicker ? `Derivatives · ${last}` : 'Derivatives'
  }

  if (isTicker) return `${headLabel} · ${last}`
  return headLabel
}

// Color-grade latency for the badge.
export function latencyTone(ms) {
  if (ms == null) return 'neutral'
  if (ms < 200) return 'fast'
  if (ms < 500) return 'medium'
  return 'slow'
}

// Short one-line description per slot for the citation card subtitle.
export function slotDescription(slot) {
  const map = {
    price: 'Live spot, market cap, 24h change',
    technicals: 'RSI, MACD, EMAs, signal grade',
    chart: 'OHLC candles, last 168 bars',
    institutional: 'Maturity, liquidity, dev, onchain',
    derivatives: 'Funding, OI, long/short ratio',
    funding: 'Composite funding across exchanges',
    liquidations: 'Recent long + short liquidations',
    dashboard: 'Composite derivatives dashboard',
    holders: 'Top holders + distribution curve',
    whales: 'Large transactions, last 24h',
    news: 'Latest headlines, multi-source',
    breaking: 'Breaking news + market-moving alerts',
    signals: 'AI-generated trade and on-chain signals',
    feargreed: 'Crypto Fear & Greed index',
    global: 'Total market cap, BTC dominance',
    gainers: 'Top gainers, 24h',
    losers: 'Top losers, 24h',
    trending: 'Trending tokens by search velocity',
    hot: 'On-chain hot tokens',
    new: 'Recently launched tokens',
    defi_protocols: 'TVL leaders, 24h delta',
    stablecoins: 'Stablecoin supply + flows',
    brain: 'Spectre brain — market stance + narratives',
  }
  // Match slot or strip the _SYMBOL suffix for per-asset slots
  if (map[slot]) return map[slot]
  const base = slot.split('_')[0]
  return map[base] || 'Spectre data'
}
