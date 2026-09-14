import { MAJOR_TOKEN_INFO, SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'

// Binance USDT spot pairs TradingView definitely carries - the gate for the
// crypto TV embed (curated; extend when a chip coin gains a Binance listing).
export const BINANCE_TV_SET = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT',
  'LTC', 'BCH', 'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'TRX', 'TON',
  'SUI', 'PEPE', 'SHIB', 'POL', 'FIL', 'ICP', 'ETC', 'XLM', 'HBAR', 'INJ',
  'RENDER', 'TIA', 'SEI', 'AAVE', 'MKR', 'CRV', 'LDO', 'JUP', 'WIF', 'BONK',
  'FET', 'ENA', 'TAO', 'PYTH', 'WLD', 'AR', 'ALGO', 'VET', 'EGLD', 'RUNE',
  'SAND', 'MANA', 'GALA', 'APE', 'IMX', 'FLOW', 'QNT', 'GRT', 'SNX', 'COMP',
])

/**
 * What LITE hands TradingViewAdvanced for a coin: `{ symbol, token }`.
 * `symbol` null = no TradingView tab for this coin.
 *
 * The widget is ADDRESS-FIRST. Given `token.address` + `token.networkId` it
 * asks /api/bars for `address:networkId`, which the server can always place
 * (registry reverse-map to Binance klines where a CEX pair exists, else the
 * GeckoTerminal pool). Given nothing it asks for the BARE TICKER, which the
 * server answers only for CEX-listed names. That is the SPECTRE bug
 * (2026-09-04): CG-listed, no Binance pair, so `/api/bars?symbol=SPECTRE`
 * came back `[]` on dev AND prod and the pane sat empty - while the same
 * server returned 300 bars for `0x9cf0...dad6:1`. Same class: PALM, MATIC,
 * USDT, USDC (all measured 0 bars bare, 300 by contract).
 *
 * Order: stocks -> resolved on-chain contract -> Binance ticker -> registry
 * contract -> bare ticker for anything else the registry only knows by CG id
 * (RNDR: bare works today, keep it) -> no tab.
 */
export function tvIdentityFor({ sym, isStock, isOnchain, onchainContract, networkId }) {
  if (isStock) return { symbol: sym.replace('-', '.'), token: { isStock: true } }
  if (isOnchain) {
    // barsSrc:'gt' pins /api/bars to the GeckoTerminal tier (fail-soft on the
    // server) so the TV tab reads the SAME pool series the Line/Candles lanes
    // draw for an on-chain cap - the cascade's answering tier is otherwise
    // environment-dependent and the three chart modes could disagree. Without
    // a resolvable contract we refuse the tab rather than let a bare ticker
    // resolve to whatever else trades under that name.
    if (onchainContract && networkId) return { symbol: sym, token: { address: onchainContract, networkId, barsSrc: 'gt' } }
    return { symbol: null, token: undefined }
  }
  if (BINANCE_TV_SET.has(sym)) return { symbol: sym, token: undefined }
  const info = MAJOR_TOKEN_INFO[sym]
  // NOT pinned to GT: the server's registry reverse-map routes address-form
  // majors to Binance klines where a pair exists (USDT/USDC measured
  // venue:binance by contract) and only DEX-only names fall to the pool.
  if (info?.address && info?.networkId) return { symbol: sym, token: { address: info.address, networkId: info.networkId } }
  if (SYMBOL_TO_COINGECKO_ID[sym]) return { symbol: sym, token: undefined }
  return { symbol: null, token: undefined }
}
