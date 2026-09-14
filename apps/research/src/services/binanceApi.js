import { logError } from '@/lib/logger'
import { getSpectrePricesBySymbols } from '@/services/spectreMarketApi'

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3'
const DEFAULT_QUOTE = 'USDT'
/**
 * Top coin prices: Binance first (proxy or CORS), then CoinGecko free API.
 * Same return shape so Discover always gets real-time prices.
 */
const BINANCE_TICKER_URL = '/api/binance-ticker'
// 2026-05-28 hide-apis: same-origin /api/coingecko/* -> /api/cg-proxy.
const COINGECKO_SIMPLE_PRICE = '/api/coingecko/simple/price'
const COINGECKO_COINS_MARKETS = '/api/coingecko/coins/markets'

/** Binance uses USDT pairs */
const SYMBOL_TO_PAIR = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  BNB: 'BNBUSDT',
  SOL: 'SOLUSDT',
  ARB: 'ARBUSDT',
  OP: 'OPUSDT',
  MATIC: 'MATICUSDT',
  AVAX: 'AVAXUSDT',
  LINK: 'LINKUSDT',
  UNI: 'UNIUSDT',
  XRP: 'XRPUSDT',
  ADA: 'ADAUSDT',
  DOGE: 'DOGEUSDT',
  DOT: 'DOTUSDT',
  PEPE: 'PEPEUSDT',
  SHIB: 'SHIBUSDT',
  WIF: 'WIFUSDT',
  BONK: 'BONKUSDT',
  FLOKI: 'FLOKIUSDT',
  NEAR: 'NEARUSDT',
  APT: 'APTUSDT',
  SUI: 'SUIUSDT',
  INJ: 'INJUSDT',
  AAVE: 'AAVEUSDT',
  FET: 'FETUSDT',
  TAO: 'TAOUSDT',
  RENDER: 'RENDERUSDT',
  GRT: 'GRTUSDT',
  USDT: null,
  USDC: null,
}

/** Symbol → CoinGecko id for fallback when Binance is blocked/unavailable */
const SYMBOL_TO_COINGECKO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  SOL: 'solana',
  ARB: 'arbitrum',
  OP: 'optimism',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  UNI: 'uniswap',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  ATOM: 'cosmos',
  LTC: 'litecoin',
  NEAR: 'near',
  APT: 'aptos',
  SUI: 'sui',
  INJ: 'injective-protocol',
  AAVE: 'aave',
  MKR: 'maker',
  CRV: 'curve-dao-token',
  LDO: 'lido-dao',
  GRT: 'the-graph',
  RENDER: 'render-token',
  RNDR: 'render-token',
  FET: 'fetch-ai',
  TAO: 'bittensor',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  BONK: 'bonk',
  SHIB: 'shiba-inu',
  FLOKI: 'floki',
  SPECTRE: 'spectre-ai',
}

/**
 * Fetch 24h ticker for all symbols (one request), then map to requested symbols.
 * @param {string[]} symbols - e.g. ['BTC', 'ETH', 'SOL']
 * @returns {Promise<Record<string, { price: number, change: number, volume: number, marketCap?: number }>>}
 */
// How old a Spectre /v1/prices row may be before we stop trusting it as the
// LIVE price. The Hetzner ingester normally updates ~every minute; when it
// stalls (2026-07-06: frozen 3.5h, RZ hero showed BTC ~3% off the real tape
// while the TV chart - fed by real Binance klines - was correct) the row must
// fall through to the live Binance ticker instead of being served as fresh.
// Rows WITHOUT an updated_at are treated as fresh - we only demote known-stale.
const SPECTRE_PRICE_STALE_MS = 5 * 60 * 1000

// Exported so sharedBinancePrices (the realtime store feeding the ticker +
// watchlist rows) can apply the same ingester-stall guard: a stalled
// /v1/prices still returns rows - just frozen ones - so an "empty map"
// fallback check alone never catches it.
export function isSpectreRowStale(row) {
  const ts = Date.parse(row?.updatedAt || '')
  return Number.isFinite(ts) && Date.now() - ts > SPECTRE_PRICE_STALE_MS
}

export async function getBinancePrices(symbols) {
  if (!symbols || symbols.length === 0) return {}

  // Spectre-first (cost war: Hetzner serves these, Binance proxy is fallback).
  // Known-stale rows are collected and overlaid with the live ticker below.
  let spectreMapped = null
  const staleSymbols = []
  try {
    const spectre = await getSpectrePricesBySymbols(symbols)
    if (spectre && Object.keys(spectre).length > 0) {
      const mapped = {}
      for (const [symbol, row] of Object.entries(spectre)) {
        mapped[symbol] = {
          price: row.price,
          change: row.change24h ?? row.change,
          volume: row.volume,
          marketCap: row.marketCap,
          liquidity: row.liquidity,
          highPrice: row.high24h,
          lowPrice: row.low24h,
          change1h: row.change1h,
          change7d: row.change7d,
          change30d: row.change30d,
          change1y: row.change1y,
        }
        if (isSpectreRowStale(row)) staleSymbols.push(symbol)
      }
      if (staleSymbols.length === 0) return mapped
      spectreMapped = mapped
    }
  } catch {
    // Fall back to legacy ticker proxy below.
  }

  const pairs = symbols
    .map((s) => (typeof s === 'string' ? s.toUpperCase() : s))
    .filter((s) => s && s !== 'USDT' && s !== 'USDC')
    .map((s) => SYMBOL_TO_PAIR[s] || `${s}USDT`)

  if (pairs.length === 0) {
    if (spectreMapped) return spectreMapped
    const out = {}
    if (symbols.map((s) => (typeof s === 'string' ? s : '').toUpperCase()).includes('USDT')) out['USDT'] = { price: 1, change: 0, volume: 0 }
    if (symbols.map((s) => (typeof s === 'string' ? s : '').toUpperCase()).includes('USDC')) out['USDC'] = { price: 1, change: 0, volume: 0 }
    return out
  }

  const parseTickers = (all) => {
    const byPair = {}
    if (Array.isArray(all)) {
      all.forEach((t) => { byPair[t.symbol] = t })
    }
    const result = {}
    symbols.forEach((sym) => {
      const S = typeof sym === 'string' ? sym.toUpperCase() : sym
      if (S === 'USDT' || S === 'USDC') {
        result[S] = { price: 1, change: 0, volume: 0 }
        return
      }
      const pair = SYMBOL_TO_PAIR[S] || `${S}USDT`
      const t = byPair[pair]
      if (!t || t.lastPrice == null) return
      const price = parseFloat(t.lastPrice) || 0
      const change = parseFloat(t.priceChangePercent) || 0
      const volume = parseFloat(t.quoteVolume) || 0
      const highPrice = parseFloat(t.highPrice) || 0
      const lowPrice = parseFloat(t.lowPrice) || 0
      result[S] = { price, change, volume, highPrice, lowPrice }
    })
    return result
  }

  const tryFetch = async (url) => {
    // 6s budget (matches spectreMarketApi's for the same endpoint) - a cold
    // serverless instance holding the socket must not hang the price map
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  try {
    const tickers = parseTickers(await tryFetch(BINANCE_TICKER_URL))
    if (!spectreMapped) return tickers
    // Overlay ONLY the known-stale rows with the live ticker (price/change/
    // volume/high/low); the Spectre row keeps mcap, liquidity and the
    // multi-window changes the ticker doesn't carry. Fresh Spectre rows stay
    // untouched - Spectre remains the default source (cost war).
    const out = { ...spectreMapped }
    for (const sym of staleSymbols) {
      if (tickers[sym]) out[sym] = { ...out[sym], ...tickers[sym] }
      else out[sym] = { ...out[sym], stale: true }
    }
    return out
  } catch (err1) {
    // Ticker proxy down too: a stale Spectre price still beats nothing.
    return spectreMapped || {}
  }
}

/**
 * Fetch price, market_cap, total_volume from CoinGecko coins/markets (one request, all fields).
 * Same shape as getBinancePrices plus marketCap and liquidity (volume used as liquidity proxy).
 */
async function getCoinGeckoPrices(symbols) {
  if (!symbols || symbols.length === 0) return {}
  const ids = [...new Set(
    symbols
      .map((s) => (typeof s === 'string' ? s.toUpperCase() : s))
      .filter(Boolean)
      .map((s) => SYMBOL_TO_COINGECKO_ID[s])
      .filter(Boolean)
  )]
  if (ids.length === 0) {
    const out = {}
    symbols.forEach((sym) => {
      const S = typeof sym === 'string' ? sym.toUpperCase() : sym
      if (S === 'USDT' || S === 'USDC') out[S] = { price: 1, change: 0, volume: 0, marketCap: 0 }
    })
    return out
  }
  const url = `${COINGECKO_COINS_MARKETS}?vs_currency=usd&ids=${ids.join(',')}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d,30d,1y`

  const parseMarkets = (data) => {
    if (!Array.isArray(data)) return null
    const result = {}
    symbols.forEach((sym) => {
      const S = typeof sym === 'string' ? sym.toUpperCase() : sym
      if (S === 'USDT' || S === 'USDC') {
        result[S] = { price: 1, change: 0, change1h: 0, change7d: 0, change30d: 0, change1y: 0, volume: 0, marketCap: 0, liquidity: 0 }
        return
      }
      const id = SYMBOL_TO_COINGECKO_ID[S]
      if (!id) return
      const row = data.find((c) => (c.id || '').toLowerCase() === id.toLowerCase())
      if (!row || row.current_price == null) return
      const price = Number(row.current_price) || 0
      const marketCap = Number(row.market_cap) || 0
      const volume = Number(row.total_volume) || 0
      const change = row.price_change_percentage_24h_in_currency != null ? Number(row.price_change_percentage_24h_in_currency) : (row.price_change_percentage_24h != null ? Number(row.price_change_percentage_24h) : 0)
      const change1h = row.price_change_percentage_1h_in_currency != null ? Number(row.price_change_percentage_1h_in_currency) : 0
      const change7d = row.price_change_percentage_7d_in_currency != null ? Number(row.price_change_percentage_7d_in_currency) : 0
      const change30d = row.price_change_percentage_30d_in_currency != null ? Number(row.price_change_percentage_30d_in_currency) : 0
      const change1y = row.price_change_percentage_1y_in_currency != null ? Number(row.price_change_percentage_1y_in_currency) : (row.price_change_percentage_1y != null ? Number(row.price_change_percentage_1y) : 0)
      result[S] = {
        price,
        change,
        change1h,
        change7d,
        change30d,
        change1y,
        volume,
        marketCap,
        liquidity: volume,
      }
    })
    return result
  }

  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const result = parseMarkets(data)
    if (result && Object.keys(result).length > 0) return result
  } catch (err) {
    // silently handled
  }

  return {}
}

/**
 * Top coin prices: CoinGecko for rich metadata + Binance for real-time price.
 * Always try both so meme coins/watchlist tokens get prices even when CoinGecko is rate-limited.
 */
export async function getTopCoinPrices(symbols) {
  // Spectre-first, but known-stale rows (ingester stall - see
  // SPECTRE_PRICE_STALE_MS) get their live price re-sourced from the
  // CG+Binance leg below instead of being served as fresh.
  let spectreMapped = null
  const staleSymbols = []
  try {
    const spectre = await getSpectrePricesBySymbols(symbols)
    if (spectre && Object.keys(spectre).length > 0) {
      const mapped = Object.fromEntries(Object.entries(spectre).map(([symbol, row]) => [symbol, {
        price: row.price,
        change: row.change24h ?? row.change,
        change1h: row.change1h,
        change7d: row.change7d,
        change30d: row.change30d,
        change1y: row.change1y,
        volume: row.volume,
        marketCap: row.marketCap,
        liquidity: row.liquidity,
      }]))
      for (const [symbol, row] of Object.entries(spectre)) {
        if (isSpectreRowStale(row)) staleSymbols.push(symbol)
      }
      if (staleSymbols.length === 0) return mapped
      spectreMapped = mapped
    }
  } catch {
    // Fall back to legacy enrichers below.
  }

  // Fetch both in parallel
  const [fromCoinGecko, fromBinance] = await Promise.all([
    getCoinGeckoPrices(symbols).catch((err) => { logError('binanceApi:getCoinGeckoPrices', err); return {}; }),
    getBinancePrices(symbols).catch((err) => { logError('binanceApi:getBinancePrices', err); return {}; }),
  ])

  // Start with CoinGecko (richer data: marketCap, 7d change, sparklines, etc.)
  const merged = { ...fromCoinGecko }

  // Override price & 24h change with Binance real-time data (more up-to-date than CoinGecko free tier)
  // For missing CoinGecko symbols, use full Binance entry as fallback.
  // Skip rows getBinancePrices flagged stale (frozen Spectre row it could not
  // re-source from the ticker) - otherwise a frozen price clobbers the fresh
  // CG row here (observed live: SPECTRE stayed frozen despite CG being fresh).
  Object.entries(fromBinance).forEach(([symbol, data]) => {
    if (data?.price > 0 && !data.stale) {
      if (merged[symbol]) {
        merged[symbol] = { ...merged[symbol], price: data.price, change: data.change }
      } else {
        merged[symbol] = data
      }
    }
  })

  if (!spectreMapped) return merged

  // Stale-Spectre path: keep the Spectre rows (mcap/liquidity/multi-window
  // changes) but take the live price + 24h change for the stale symbols.
  // Rows with NO live source (no Binance pair, no CG-major mapping) keep the
  // frozen price but are flagged `stale: true` so callers (sharedBinancePrices
  // realtime store) can tell "re-sourced live" from "still frozen".
  const out = { ...spectreMapped }
  for (const sym of staleSymbols) {
    const live = merged[sym]
    if (live?.price > 0 && !live.stale) out[sym] = { ...out[sym], price: live.price, change: live.change }
    else out[sym] = { ...out[sym], stale: true }
  }
  return out
}

/** Map Codex resolution to Binance kline interval */
const RESOLUTION_TO_BINANCE_INTERVAL = {
  '1S': '1s',
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  '1D': '1d',
  '1W': '1w',
}

/**
 * Fetch OHLCV klines from Binance for candle/line charts.
 * Used when Codex returns no data (e.g. Research Zone with symbol-only BTC/ETH/SOL).
 * @param {string} symbol - e.g. 'BTC', 'ETH', 'SOL'
 * @param {string} resolution - Codex-style: '1','5','15','60','240','1D','1W'
 * @param {number} from - Unix seconds
 * @param {number} to - Unix seconds
 * @returns {Promise<{ getBars: Array<{ t: number, o: number, h: number, l: number, c: number, v: number }> }>}
 */
export async function getBinanceKlines(symbol, resolution = '60', from, to) {
  const pair = SYMBOL_TO_PAIR[symbol?.toUpperCase()] || `${(symbol || '').toUpperCase()}USDT`
  const interval = RESOLUTION_TO_BINANCE_INTERVAL[resolution] || '1h'
  const endMs = to * 1000
  const fromMs = (from || 0) * 1000
  const limit = 1000
  // Honor the requested `from` window when it fits in 1000 bars so each timeframe
  // fetches its OWN range. 7D/30D/90D all map to the 1h interval, so without
  // startTime Binance returns the most-recent 1000 bars (~41 days) for ALL of
  // them - collapsing 7D/30D/90D to one identical chart. For windows larger than
  // 1000 bars, drop startTime and take the most recent 1000 (Binance returns
  // oldest-first when startTime is set, which would cut off current data).
  const INTERVAL_MS = { '1s': 1e3, '1m': 6e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 }
  const barMs = INTERVAL_MS[interval] || 36e5
  const requestedBars = fromMs > 0 ? Math.ceil((endMs - fromMs) / barMs) : Infinity
  const url = requestedBars <= 1000
    ? `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&startTime=${fromMs}&endTime=${endMs}&limit=${limit}`
    : `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&endTime=${endMs}&limit=${limit}`

  try {
    // 3.5s hard timeout: this hits api.binance.com DIRECT from the browser.
    // On networks where Binance is slow/blocked (region blocks, some VPNs)
    // an untimed fetch hangs for the browser default (30s+) and every chart
    // history window waits on it before falling back to the server composite
    // - felt as multi-second stalls at the scroll-back wall. Fail fast; the
    // /api/bars cascade covers the token anyway.
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return { getBars: [] }
    }
    const getBars = rows.map((row) => ({
      t: Math.floor(row[0] / 1000),
      o: parseFloat(row[1]) || 0,
      h: parseFloat(row[2]) || 0,
      l: parseFloat(row[3]) || 0,
      c: parseFloat(row[4]) || 0,
      v: parseFloat(row[5]) || 0,
    }))
    return { getBars }
  } catch (err) {
    // silently handled
    return { getBars: [] }
  }
}
