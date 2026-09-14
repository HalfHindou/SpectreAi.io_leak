/**
 * Minimal static Binance USDT-pair catalog (trading app).
 *
 * Purpose: decide whether a token symbol should be charted in TICKER form
 * (e.g. "BTC") so the server's Binance klines path serves clean OHLCV, vs
 * the on-chain `address:networkId` form (Codex DEX bars).
 *
 * Scope: this is intentionally a SMALL static seed of obvious majors only.
 * Long-tail listed tokens are covered server-side: the trading server's
 * /api/bars / UDF history reverse-maps an on-chain address back to its
 * Binance ticker when one exists. This client list only routes the obvious
 * majors to ticker-form requests so they never fall through to sparse DEX
 * bars. There is NO background refresh here - trading prod has no
 * /api/binance-usdt-pairs endpoint, so we do not attempt a dynamic fetch.
 *
 * Seed list mirrors the majors used by the server-side Binance fallback.
 */

// UPPERCASE symbols that have a Binance USDT spot pair.
const BINANCE_USDT_PAIRS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK',
  'MATIC', 'UNI', 'ATOM', 'LTC', 'ETC', 'FIL', 'ARB', 'OP', 'NEAR', 'APT',
  'SUI', 'INJ', 'TIA', 'SEI', 'AAVE', 'MKR', 'CRV', 'LDO', 'GRT', 'RENDER',
  'RNDR', 'FET', 'TAO', 'ONDO', 'JUP', 'PYTH', 'JTO', 'PEPE', 'SHIB', 'FLOKI',
  'WIF', 'BONK', 'PENDLE', 'SUSHI', 'TRX', 'ALGO', 'BCH', 'XLM', 'VET', 'EOS',
  'HBAR', 'ICP',
])

/**
 * @param {string} symbol token symbol (any case)
 * @returns {boolean} true when the UPPERCASED symbol has a Binance USDT pair
 */
export function hasBinancePair(symbol) {
  if (!symbol || typeof symbol !== 'string') return false
  return BINANCE_USDT_PAIRS.has(symbol.toUpperCase())
}
