/**
 * tradingViewSymbols.js - Universal TradingView symbol resolution
 *
 * Resolves ANY crypto token, stock, index, or commodity to a valid
 * TradingView widget embed symbol. Covers every asset on the planet.
 *
 * Resolution order for crypto:
 *   1. Already contains ':' (pre-formatted) → use as-is
 *   2. Special symbols (indices, commodities) → hardcoded map
 *   3. CRYPTO_USD_PREFERRED → CRYPTO:XXXUSD (best TV data quality)
 *   4. BINANCE_CRYPTO → BINANCE:XXXUSDT (widest CEX coverage)
 *   5. Has on-chain address → needs async DEX resolution
 *   6. Universal: TradingView Symbol Search API (any token worldwide)
 *   7. Last-resort fallback → CRYPTO:XXXUSD
 *
 * Resolution order for stocks:
 *   1. Already contains ':' → use as-is
 *   2. STOCK_EXCHANGE_MAP (from FALLBACK_STOCK_DATA) → EXCHANGE:SYM
 *   3. Token has exchange field → EXCHANGE:SYM
 *   4. Universal: TradingView Symbol Search API (any stock worldwide)
 *   5. Last-resort fallback → NASDAQ:SYM
 */

import { FALLBACK_STOCK_DATA } from '@/services/stockApi'
import { hasBinancePair } from '@/services/binanceCatalog'

/* ═══════════════════════════════════════════
   SPECIAL SYMBOLS (indices, macro, commodities)
   ═══════════════════════════════════════════ */
const SPECIAL_SYMBOLS = {
  // Crypto market cap indices
  'TOTAL':    'CRYPTOCAP:TOTAL',
  'TOTAL2':   'CRYPTOCAP:TOTAL2',
  'TOTAL3':   'CRYPTOCAP:TOTAL3',
  'BTC.D':    'CRYPTOCAP:BTC.D',
  'ETH.D':    'CRYPTOCAP:ETH.D',
  'USDT.D':   'CRYPTOCAP:USDT.D',
  'OTHERS.D': 'CRYPTOCAP:OTHERS.D',
  // Macro indices
  'SPX':    'FOREXCOM:SPXUSD',
  'DXY':    'INDEX:DXY',
  'VIX':    'TVC:VIX',
  'TNX':    'TVC:TNX',
  // Commodities — spot/friendly aliases
  'GOLD':   'OANDA:XAUUSD',
  'XAU':    'OANDA:XAUUSD',
  'SILVER': 'OANDA:XAGUSD',
  'XAG':    'OANDA:XAGUSD',
  'OIL':    'NYMEX:CL1!',
  'CRUDE':  'NYMEX:CL1!',
  // Commodities — Yahoo futures → TradingView
  'GC=F':   'COMEX:GC1!',
  'SI=F':   'COMEX:SI1!',
  'CL=F':   'NYMEX:CL1!',
  'NG=F':   'NYMEX:NG1!',
  'HG=F':   'COMEX:HG1!',
  'PL=F':   'NYMEX:PL1!',
  'PA=F':   'NYMEX:PA1!',
  // CEX-native tokens not listed on Binance — pin to their home exchange so
  // resolver short-circuits with confident match instead of falling through
  // to CRYPTO:XXXUSD which TradingView does not have for these tickers.
  'LEO':    'BITFINEX:LEOUSD',
  'OKB':    'OKX:OKBUSDT',
  'KCS':    'KUCOIN:KCSUSDT',
  'BGB':    'BITGET:BGBUSDT',
  'GT':     'GATEIO:GTUSDT',
  'CRO':    'CRYPTO:CROUSD',
}

/* ═══════════════════════════════════════════
   CRYPTO - CRYPTO:XXXUSD preferred (top quality on TradingView)
   ═══════════════════════════════════════════ */
const CRYPTO_USD_PREFERRED = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK',
  'MATIC', 'POL', 'UNI', 'LTC', 'BCH', 'ETC', 'ATOM', 'FIL', 'NEAR', 'AAVE',
  'MKR', 'COMP', 'SNX', 'CRV', 'ALGO', 'XLM', 'TRX', 'XMR', 'EOS',
  'HBAR', 'ICP', 'VET', 'THETA', 'FTM',
])

/* ═══════════════════════════════════════════
   CRYPTO - BINANCE:XXXUSDT (widest CEX coverage, 600+ pairs)
   ═══════════════════════════════════════════ */
const BINANCE_CRYPTO = new Set([
  // Layer 1s
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK',
  'MATIC', 'POL', 'NEAR', 'SUI', 'APT', 'SEI', 'INJ', 'TIA', 'ATOM', 'FTM',
  'ALGO', 'XLM', 'TRX', 'EOS', 'XTZ', 'HBAR', 'EGLD', 'FLOW', 'MINA', 'CELO',
  'ONE', 'ZIL', 'ROSE', 'KAVA', 'OSMO', 'TON', 'ICP', 'VET', 'NEO', 'WAVES',
  'STX', 'CFX', 'KAS', 'CKB', 'FIL',
  // DeFi
  'UNI', 'AAVE', 'CRV', 'LDO', 'COMP', 'SNX', 'SUSHI', 'BAL',
  '1INCH', 'DYDX', 'YFI', 'RPL', 'FXS', 'LQTY', 'PENDLE', 'RUNE',
  'GMX', 'JOE', 'CAKE', 'RDNT', 'SSV',
  // AI & DePIN
  'FET', 'TAO', 'RENDER', 'RNDR', 'GRT', 'OCEAN', 'AGIX', 'AKT', 'AR',
  'HNT', 'IOTX', 'DIMO', 'MOBILE', 'WLD',
  // Meme
  'PEPE', 'SHIB', 'WIF', 'BONK', 'FLOKI', 'MEME', 'TURBO', 'NEIRO',
  'BOME', 'BRETT', 'MEW', 'POPCAT', 'MYRO', 'TRUMP', 'PENGU', 'PNUT',
  'FARTCOIN', 'SPX', 'DEGEN', 'HIGHER',
  // Gaming & NFT
  'AXS', 'SAND', 'MANA', 'GALA', 'ENJ', 'IMX', 'CHZ', 'ILV', 'MAGIC',
  'YGG', 'PIXEL', 'PORTAL', 'SUPER', 'RONIN',
  // L2 & Infrastructure
  'ARB', 'OP', 'STRK', 'ZK', 'MANTA', 'METIS', 'BOBA',
  'LRC', 'MASK', 'ENS', 'PYTH', 'JTO', 'JUP', 'W',
  // Privacy & Store of Value
  'XMR', 'ZEC', 'DASH', 'LTC', 'BCH', 'ETC',
  // Misc
  'QNT', 'THETA', 'IOTA', 'GNO', 'ANKR', 'STORJ', 'BAND', 'COTI',
  'RLC', 'NMR', 'CTSI', 'CELR', 'AUDIO', 'DENT', 'HOT',
  'JASMY', 'ACH', 'LINA', 'REEF', 'SLP', 'TLM', 'CLV',
  'WOO', 'API3', 'PERP', 'LEVER', 'HIGH', 'EDU',
  'ORDI', 'SATS', '1000SATS', 'RATS',
  // Recent additions
  'ONDO', 'ENA', 'EIGEN', 'ETHFI', 'REZ', 'NOT', 'LISTA', 'ZRO',
  'IO', 'BB', 'AERO', 'VIRTUAL', 'AI16Z', 'GRASS', 'MOVE', 'ME',
  'USUAL', 'BIO', 'COOKIE', 'ANIME', 'TST', 'LAYER', 'KAITO',
  'IP', 'BERA', 'MBL', 'SIGN', 'INIT', 'PARTI',
  // Top-100 additions (rebrands, stablecoins, newer listings)
  'SKY', 'HYPE', 'MKR', 'APE', 'BLUR', 'DYM', 'TRB',
  'ORCA', 'RAY', 'MORPHO', 'PUMP', 'BGB', 'GT', 'KCS',
  'FLR', 'XDC', 'PAXG', 'ASTER', 'HASH',
])

/* ═══════════════════════════════════════════
   STOCKS - Build exchange map from FALLBACK_STOCK_DATA
   ═══════════════════════════════════════════ */
const STOCK_EXCHANGE_MAP = {}
if (FALLBACK_STOCK_DATA && typeof FALLBACK_STOCK_DATA === 'object') {
  Object.entries(FALLBACK_STOCK_DATA).forEach(([sym, data]) => {
    if (data?.exchange) {
      STOCK_EXCHANGE_MAP[sym.toUpperCase()] = data.exchange.toUpperCase()
    }
  })
}

/* TradingView exchange name normalization
   Maps various exchange codes from Yahoo Finance, data providers etc.
   to the correct TradingView exchange prefix.
   If an exchange is NOT in this map, we trigger TV search instead. */
const TV_EXCHANGE_NORMALIZE = {
  'NASDAQ': 'NASDAQ',
  'NYSE':   'NYSE',
  'AMEX':   'AMEX',
  'ARCA':   'AMEX',   // NYSE Arca ETFs → AMEX on TradingView
  'BATS':   'AMEX',
  'NYQ':    'NYSE',   // Yahoo Finance uses NYQ
  'NMS':    'NASDAQ', // Yahoo Finance uses NMS
  'NGM':    'NASDAQ', // NASDAQ Global Market
  'NGS':    'NASDAQ', // NASDAQ Global Select
  'NCM':    'NASDAQ', // NASDAQ Capital Market
  'PCX':    'AMEX',   // NYSE Arca (PCX) ETFs → AMEX on TradingView
  'CBO':    'AMEX',   // Cboe → AMEX
  'CBOE':   'AMEX',
  'OTC':    'OTC',    // OTC Markets
  'OTCBB':  'OTC',
  'PINK':   'OTC',    // Pink Sheets → OTC
  'LSE':    'LSE',    // London
  'TSE':    'TSE',    // Tokyo
  'TSX':    'TSX',    // Toronto
  'XETR':   'XETR',  // Frankfurt/Xetra
  'ASX':    'ASX',    // Australia
  'HKEX':   'HKEX',  // Hong Kong
  'NSE':    'NSE',    // India National
  'BSE':    'BSE',    // India Bombay
  // Commodity exchanges
  'COMEX':  'COMEX',  // Gold, silver, copper futures
  'NYMEX':  'NYMEX',  // Oil, gas, platinum, palladium futures
  'CBOT':   'CBOT',   // Agricultural futures
  'CME':    'CME',    // CME Group futures
}

/* ═══════════════════════════════════════════
   CLIENT-SIDE CACHE for async resolutions
   ═══════════════════════════════════════════ */
const _tvSearchCache = new Map()
const TV_CLIENT_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

/* ═══════════════════════════════════════════
   MAIN RESOLVER (synchronous - instant)
   ═══════════════════════════════════════════ */

/**
 * Resolve a TradingView symbol for any asset type (synchronous).
 *
 * For known symbols (hardcoded lists), returns immediately with confident: true.
 * For unknown symbols, returns source: 'needs-tv-search' so the caller
 * can trigger async resolution via searchTradingViewSymbol().
 *
 * @param {Object|string} tokenOrSymbol - Token object or raw symbol string
 * @param {string} [marketMode='crypto'] - 'crypto' or 'stocks'
 * @returns {{ symbol: string|null, confident: boolean, source: string }}
 */
/** Normalize a raw exchange code (Yahoo NMS/NYQ/PCX, etc.) to a TradingView
 * prefix. Returns null for unknown codes so callers can fall back safely —
 * passing a Yahoo code straight into a TV symbol yields "NMS:AAPL" and the
 * widget's "This symbol doesn't exist" screen. */
export function tvExchangeFor(code) {
  return TV_EXCHANGE_NORMALIZE[String(code || '').toUpperCase().trim()] || null
}

export function resolveTradingViewSymbol(tokenOrSymbol, marketMode = 'crypto') {
  // Normalize input: accept string or object
  const token = typeof tokenOrSymbol === 'string'
    ? { symbol: tokenOrSymbol }
    : (tokenOrSymbol || {})

  const raw = (token.symbol || '').trim()

  // 1. Already a formatted TradingView symbol? (contains ':')
  if (raw.includes(':')) {
    return { symbol: raw, confident: true, source: 'prefixed' }
  }

  const sym = raw.toUpperCase()
  if (!sym) return { symbol: null, confident: false, source: 'empty' }

  // 2. Special symbols (macro indices, commodities, crypto caps)
  if (SPECIAL_SYMBOLS[sym]) {
    return { symbol: SPECIAL_SYMBOLS[sym], confident: true, source: 'special' }
  }

  // 3. Stock mode
  if (marketMode === 'stocks' || token.isStock) {
    return resolveStockSymbol(sym, token)
  }

  // 4. Crypto: CRYPTO:XXXUSD preferred (best TradingView data for top tokens)
  if (CRYPTO_USD_PREFERRED.has(sym)) {
    return { symbol: `CRYPTO:${sym}USD`, confident: true, source: 'crypto-preferred' }
  }

  // 5. Crypto: BINANCE:XXXUSDT — ONLY when the live Binance catalog confirms
  // the pair (2026-06-10: ANYONE rendered a fabricated BINANCE:ANYONEUSDT →
  // "This symbol doesn't exist" pane). The static set is a hint, not proof;
  // the catalog is majors-seeded synchronously + refreshed from
  // /api/binance-usdt-pairs.
  if (BINANCE_CRYPTO.has(sym) && hasBinancePair(sym)) {
    return { symbol: `BINANCE:${sym}USDT`, confident: true, source: 'binance' }
  }

  // 5b. Check client-side cache from previous TV search. Never trust a
  // cached BINANCE: pair the catalog can't confirm (same fabrication class).
  const cached = _tvSearchCache.get(`${sym}:crypto`)
  if (cached && Date.now() - cached.ts < TV_CLIENT_CACHE_TTL) {
    const cachedSym = String(cached.symbol || '')
    if (!cachedSym.startsWith('BINANCE:') || hasBinancePair(sym)) {
      return { symbol: cached.symbol, confident: true, source: 'tv-search-cached' }
    }
  }

  // 6. Has on-chain address → needs async DEX resolution first, then TV search
  if (token.address) {
    return { symbol: null, confident: false, source: 'needs-dex-resolution' }
  }

  // 7. Unknown token → needs async TradingView search
  //    Return a tentative fallback symbol but mark it as needing TV search
  return { symbol: `CRYPTO:${sym}USD`, confident: false, source: 'needs-tv-search' }
}

/**
 * Resolve stock to TradingView symbol with exchange prefix.
 * @private
 */
function resolveStockSymbol(sym, token) {
  // Prefer live exchange data (from API) over static fallback map — APIs return
  // the real exchange (e.g. NMS for NASDAQ) whereas fallback data can be stale
  if (token.exchange) {
    const rawExchange = token.exchange.toUpperCase()
    const tvExchange = TV_EXCHANGE_NORMALIZE[rawExchange]
    if (tvExchange) {
      return { symbol: `${tvExchange}:${sym}`, confident: true, source: 'stock-exchange' }
    }
    // Unknown exchange format → fall through to static map
  }

  // Check FALLBACK_STOCK_DATA exchange map (165+ stocks)
  const mappedExchange = STOCK_EXCHANGE_MAP[sym]
  if (mappedExchange) {
    const tvExchange = TV_EXCHANGE_NORMALIZE[mappedExchange]
    if (tvExchange) {
      return { symbol: `${tvExchange}:${sym}`, confident: true, source: 'stock-map' }
    }
    // Exchange not in normalization map - fall through to TV search
  }

  // Check client-side cache from previous TV search
  const cached = _tvSearchCache.get(`${sym}:stock`)
  if (cached && Date.now() - cached.ts < TV_CLIENT_CACHE_TTL) {
    return { symbol: cached.symbol, confident: true, source: 'tv-search-cached' }
  }

  // Unknown stock → needs async TradingView search
  return { symbol: `NASDAQ:${sym}`, confident: false, source: 'needs-tv-search' }
}

/* ═══════════════════════════════════════════
   UNIVERSAL ASYNC RESOLVER - TradingView Search API
   Resolves ANY symbol via TradingView's own database
   ═══════════════════════════════════════════ */

/**
 * Search TradingView's symbol database for any asset.
 * This is the universal fallback that covers every token and stock on the planet.
 *
 * Call this when resolveTradingViewSymbol returns source === 'needs-tv-search'.
 * Results are cached client-side for 10 minutes.
 *
 * @param {string} query - Ticker symbol or search query (e.g., 'TRUMP', 'HIMS', 'KASPA')
 * @param {string} [type=''] - Asset type: 'stock', 'crypto', or '' for all
 * @returns {Promise<{ found: boolean, symbol: string|null, exchange?: string, description?: string }>}
 */
export async function searchTradingViewSymbol(query, type = '') {
  if (!query) return { found: false, symbol: null }

  const sym = query.toUpperCase()
  const cacheKey = `${sym}:${type}`

  // Check client cache first
  const cached = _tvSearchCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < TV_CLIENT_CACHE_TTL) {
    return { found: true, symbol: cached.symbol, exchange: cached.exchange, source: 'client-cache' }
  }

  // Local Vite does not serve the TradingView search serverless route. Unknown
  // crypto symbols already have canvas/CoinGecko fallbacks, so avoid noisy 500s.
  if (import.meta.env.DEV && type === 'crypto') {
    return { found: false, symbol: null, source: 'local-dev-disabled' }
  }

  try {
    const params = new URLSearchParams({ query: sym, type })
    const res = await fetch(`/api/tradingview/search?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    if (data.found && data.symbol) {
      // Cache the successful result
      _tvSearchCache.set(cacheKey, {
        ts: Date.now(),
        symbol: data.symbol,
        exchange: data.exchange,
      })
      return data
    }

    return { found: false, symbol: null }
  } catch {
    return { found: false, symbol: null }
  }
}

/* ═══════════════════════════════════════════
   ASYNC DEX RESOLUTION (for on-chain tokens with addresses)
   ═══════════════════════════════════════════ */

/**
 * Resolve TradingView symbol for DEX tokens via backend Codex API.
 * Call this when resolveTradingViewSymbol returns source === 'needs-dex-resolution'.
 *
 * @param {string} address - Token contract address
 * @param {number} [networkId=1] - Chain network ID
 * @param {string} [symbol=''] - Token ticker symbol (used as fallback label)
 * @returns {Promise<{ symbol: string|null, supported: boolean, dex?: string, pair?: string }>}
 */
export async function resolveDexTradingViewSymbol(address, networkId = 1, symbol = '') {
  try {
    const params = new URLSearchParams({
      address,
      networkId: String(networkId),
      symbol,
    })
    const res = await fetch(`/api/tradingview/symbol?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { symbol: null, supported: false }
  }
}
