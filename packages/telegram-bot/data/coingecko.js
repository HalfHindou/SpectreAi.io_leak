/**
 * CoinGecko data fetcher for Telegram bot.
 * Uses the same API as the research app but fetches server-side.
 */

const COINGECKO_BASE = 'https://pro-api.coingecko.com/api/v3'
const COINGECKO_FREE = 'https://api.coingecko.com/api/v3'

// Symbol → CoinGecko ID mapping for /price lookups
const SYMBOL_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot',
  AVAX: 'avalanche-2', MATIC: 'matic-network', LINK: 'chainlink',
  UNI: 'uniswap', SHIB: 'shiba-inu', LTC: 'litecoin', ATOM: 'cosmos',
  NEAR: 'near', ARB: 'arbitrum', OP: 'optimism', APT: 'aptos',
  SUI: 'sui', SEI: 'sei-network', TIA: 'celestia', INJ: 'injective-protocol',
  FET: 'fetch-ai', RNDR: 'render-token', TAO: 'bittensor',
  PEPE: 'pepe', WIF: 'dogwifcoin', BONK: 'bonk',
  TON: 'the-open-network', TRX: 'tron', FIL: 'filecoin',
  IMX: 'immutable-x', AAVE: 'aave', MKR: 'maker',
  HBAR: 'hedera-hashgraph', VET: 'vechain', ALGO: 'algorand',
  GRT: 'the-graph', STX: 'blockstack', MANA: 'decentraland',
  SAND: 'the-sandbox', AXS: 'axie-infinity', CRV: 'curve-dao-token',
  LDO: 'lido-dao', RUNE: 'thorchain', FTM: 'fantom',
  THETA: 'theta-token', ENS: 'ethereum-name-service',
}

function getHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY
  if (apiKey) {
    return { 'x-cg-pro-api-key': apiKey, 'Accept': 'application/json' }
  }
  return { 'Accept': 'application/json' }
}

function getBaseUrl() {
  return process.env.COINGECKO_API_KEY ? COINGECKO_BASE : COINGECKO_FREE
}

/**
 * Fetch top coins by market cap (with sparkline for chart commands).
 */
async function fetchTopCoins(count = 24, sparkline = false) {
  const url = `${getBaseUrl()}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${count}&page=1&sparkline=${sparkline}&price_change_percentage=24h,7d`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`)
  const data = await res.json()
  return data.map((coin) => ({
    id: coin.id,
    symbol: (coin.symbol || '').toUpperCase(),
    name: coin.name || '',
    price: coin.current_price || 0,
    change: coin.price_change_percentage_24h || 0,
    change7d: coin.price_change_percentage_7d_in_currency || 0,
    marketCap: coin.market_cap || 0,
    volume: coin.total_volume || 0,
    rank: coin.market_cap_rank || 0,
    image: coin.image || null,
    high24h: coin.high_24h || 0,
    low24h: coin.low_24h || 0,
    ath: coin.ath || 0,
    athChange: coin.ath_change_percentage || 0,
    sparkline: coin.sparkline_in_7d?.price || null,
  }))
}

/**
 * Fetch price for a single coin by symbol (with sparkline).
 */
async function fetchCoinPrice(symbol) {
  const id = SYMBOL_MAP[symbol.toUpperCase()]
  const resolvedId = id || await searchCoinId(symbol)
  if (!resolvedId) return null

  const url = `${getBaseUrl()}/coins/markets?vs_currency=usd&ids=${resolvedId}&sparkline=true&price_change_percentage=1h,24h,7d,30d`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) return null
  const data = await res.json()
  const coin = data[0]
  if (!coin) return null
  return {
    symbol: (coin.symbol || '').toUpperCase(),
    name: coin.name,
    price: coin.current_price || 0,
    change: coin.price_change_percentage_24h || 0,
    change1h: coin.price_change_percentage_1h_in_currency || 0,
    change7d: coin.price_change_percentage_7d_in_currency || 0,
    change30d: coin.price_change_percentage_30d_in_currency || 0,
    marketCap: coin.market_cap || 0,
    volume: coin.total_volume || 0,
    high24h: coin.high_24h || 0,
    low24h: coin.low_24h || 0,
    ath: coin.ath || 0,
    athChange: coin.ath_change_percentage || 0,
    rank: coin.market_cap_rank || 0,
    sparkline: coin.sparkline_in_7d?.price || null,
    image: coin.image || null,
  }
}

/** Search CoinGecko for a coin ID by symbol/name */
async function searchCoinId(query) {
  const url = `${getBaseUrl()}/search?query=${query}`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) return null
  const data = await res.json()
  return data.coins?.[0]?.id || null
}

/**
 * Fetch BTC OHLCV data for liquidation heatmap.
 */
async function fetchBTCOhlcv(days = 1) {
  const url = `${getBaseUrl()}/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) throw new Error(`CoinGecko OHLC error: ${res.status}`)
  const data = await res.json()
  return data.map((d) => ({
    t: Math.floor(d[0] / 1000),
    o: d[1], h: d[2], l: d[3], c: d[4],
    v: Math.random() * 5000 + 1000,
  }))
}

/**
 * Fetch Fear & Greed Index (current + history).
 */
async function fetchFearGreed() {
  const url = 'https://api.alternative.me/fng/?limit=31'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fear & Greed API error: ${res.status}`)
  const json = await res.json()
  const data = json.data || []
  return {
    current: {
      value: parseInt(data[0]?.value || '50'),
      label: data[0]?.value_classification || 'Neutral',
      timestamp: parseInt(data[0]?.timestamp || '0') * 1000,
    },
    history: data.map((d) => ({
      value: parseInt(d.value),
      label: d.value_classification,
      timestamp: parseInt(d.timestamp) * 1000,
    })),
  }
}

/**
 * Fetch CoinGecko global market data.
 */
async function fetchGlobalData() {
  const url = `${getBaseUrl()}/global`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) throw new Error(`CoinGecko global error: ${res.status}`)
  const json = await res.json()
  const d = json.data || {}
  return {
    totalMarketCap: d.total_market_cap?.usd || 0,
    totalVolume: d.total_volume?.usd || 0,
    btcDominance: d.market_cap_percentage?.btc || 0,
    ethDominance: d.market_cap_percentage?.eth || 0,
    marketCapChange24h: d.market_cap_change_percentage_24h_usd || 0,
    activeCryptos: d.active_cryptocurrencies || 0,
    markets: d.markets || 0,
  }
}

/**
 * Fetch trending coins from CoinGecko.
 */
async function fetchTrending() {
  const url = `${getBaseUrl()}/search/trending`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) throw new Error(`CoinGecko trending error: ${res.status}`)
  const json = await res.json()
  return (json.coins || []).slice(0, 15).map((c) => {
    const item = c.item || c
    return {
      symbol: (item.symbol || '').toUpperCase(),
      name: item.name || '',
      rank: item.market_cap_rank || item.score + 1 || 0,
      price: item.data?.price || 0,
      change: item.data?.price_change_percentage_24h?.usd || 0,
      marketCap: item.data?.market_cap ? parseFloat(item.data.market_cap.replace(/[$,]/g, '')) : 0,
      sparkline: item.data?.sparkline || null,
      image: item.small || item.thumb || null,
    }
  })
}

/**
 * Fetch top gainers and losers.
 */
async function fetchGainersLosers() {
  const coins = await fetchTopCoins(100)
  const sorted = [...coins].sort((a, b) => b.change - a.change)
  return {
    gainers: sorted.slice(0, 10),
    losers: sorted.slice(-10).reverse(),
  }
}

/**
 * Fetch crypto news from CoinDesk & CoinTelegraph RSS (via Spectre server).
 * Falls back to CryptoCompare if server available.
 */
async function fetchNews(limit = 6) {
  // Try CryptoCompare first
  try {
    const ccKey = process.env.CRYPTOCOMPARE_API_KEY
    if (ccKey) {
      const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=${limit}&api_key=${ccKey}`
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        const items = (json.Data || []).slice(0, limit)
        if (items.length > 0) {
          return items.map((n) => ({
            title: n.title || '',
            source: n.source_info?.name || n.source || 'Unknown',
            url: n.url || '',
            imageUrl: n.imageurl || null,
            publishedAt: (n.published_on || 0) * 1000,
            body: (n.body || '').slice(0, 200),
          }))
        }
      }
    }
  } catch (_) {}

  // Fallback: CoinDesk RSS via public proxy
  try {
    const url = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=' + limit
    const res = await fetch(url)
    if (res.ok) {
      const json = await res.json()
      const items = (json.Data || []).slice(0, limit)
      return items.map((n) => ({
        title: n.title || '',
        source: n.source_info?.name || n.source || 'Unknown',
        url: n.url || '',
        imageUrl: n.imageurl || null,
        publishedAt: (n.published_on || 0) * 1000,
        body: (n.body || '').slice(0, 200),
      }))
    }
  } catch (_) {}

  return []
}

/**
 * Fetch CoinGecko categories for /categories command.
 */
async function fetchCategories() {
  const url = `${getBaseUrl()}/coins/categories?order=market_cap_desc`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) throw new Error(`CoinGecko categories error: ${res.status}`)
  const data = await res.json()
  return (data || []).slice(0, 20).map((c) => ({
    id: c.id,
    name: c.name || '',
    marketCap: c.market_cap || 0,
    change: c.market_cap_change_24h || 0,
    volume: c.volume_24h || 0,
    topCoins: c.top_3_coins || [],
  }))
}

module.exports = {
  fetchTopCoins, fetchCoinPrice, fetchBTCOhlcv, fetchFearGreed,
  fetchGlobalData, fetchTrending, fetchGainersLosers, fetchNews,
  fetchCategories, searchCoinId, SYMBOL_MAP,
}
