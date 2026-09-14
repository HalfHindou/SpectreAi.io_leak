export const EXCHANGE_DOMAINS = {
  'Binance': 'binance.com', 'OKX': 'okx.com', 'Bybit': 'bybit.com',
  'Coinbase': 'coinbase.com', 'Kraken': 'kraken.com', 'KuCoin': 'kucoin.com',
  'Bitfinex': 'bitfinex.com', 'Bitstamp': 'bitstamp.com', 'Gate.io': 'gate.io',
  'HTX': 'htx.com', 'MEXC': 'mexc.com', 'Bitget': 'bitget.com',
  'Crypto.com': 'crypto.com', 'Upbit': 'upbit.com', 'Deribit': 'deribit.com',
  'dYdX': 'dydx.exchange', 'dYdX Chain': 'dydx.exchange', 'Hyperliquid': 'hyperliquid.xyz',
  'Jupiter': 'jup.ag', 'Raydium': 'raydium.io', 'Uniswap': 'uniswap.org',
  'PancakeSwap': 'pancakeswap.finance', 'GMX': 'gmx.io', 'Vertex': 'vertexprotocol.com',
  'Drift': 'drift.trade', 'Phemex': 'phemex.com', 'BingX': 'bingx.com',
  'CoinW': 'coinw.com', 'BTSE': 'btse.com', 'Bitmart': 'bitmart.com',
  'Bitmart Futures': 'bitmart.com', 'Toobit Futures': 'toobit.com',
  'XT.COM': 'xt.com', 'LBank': 'lbank.com', 'CoinEx': 'coinex.com',
  'WhiteBIT': 'whitebit.com', 'AscendEX  (BitMax)': 'ascendex.com',
  'AscendEX': 'ascendex.com', 'BVOX': 'bvox.com', 'Ourbit': 'ourbit.com',
  'WEEX': 'weex.com', 'Toobit': 'toobit.com', 'Backpack': 'backpack.exchange',
  'Aevo': 'aevo.xyz', 'Paradex': 'paradex.trade', 'Bluefin': 'bluefin.io',
  'Azbit': 'azbit.com', 'BTCC': 'btcc.com', 'Pionex': 'pionex.com',
  'BitMEX': 'bitmex.com', 'Poloniex': 'poloniex.com', 'WOO X': 'woo.org',
  'Hotcoin': 'hotcoin.com', 'BigONE': 'big.one', 'DigiFinex': 'digifinex.com',
  'Bitrue': 'bitrue.com', 'CoinDCX': 'coindcx.com', 'Zaif': 'zaif.jp',
  'Bitbank': 'bitbank.cc', 'bitFlyer': 'bitflyer.com', 'Binance US': 'binance.us',
  'SushiSwap': 'sushi.com', 'Curve': 'curve.fi', 'Balancer': 'balancer.fi',
  'Orca': 'orca.so', 'QuickSwap': 'quickswap.exchange', 'Trader Joe': 'traderjoexyz.com',
  'Camelot': 'camelot.exchange', 'Velodrome': 'velodrome.finance',
  'Aerodrome': 'aerodrome.finance', 'Osmosis': 'osmosis.zone', '1inch': '1inch.io',
  'ParaSwap': 'paraswap.io', 'KyberSwap': 'kyberswap.com',
}

export const isPairAddress = (s) =>
  /^0x[a-fA-F0-9]{10,}/i.test(s) ||
  (/^[a-zA-Z0-9]{20,}$/.test(s) && !/^[A-Z0-9]{2,10}$/.test(s))

export const truncPairAddress = (s) => {
  if (!s || s.length <= 10) return s
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

export function formatPairDisplay(pair) {
  if (!pair) return { display: '—', hasAddr: false, full: pair }
  const parts = String(pair).split('/')
  const hasAddr = parts.some(p => isPairAddress(p))
  const display = parts.map(p => (isPairAddress(p) ? truncPairAddress(p) : p)).join('/')
  return { display, hasAddr, full: pair }
}

export function resolveExchangeDomain(name) {
  if (!name) return null
  let domain = EXCHANGE_DOMAINS[name]
  if (!domain) {
    const clean = name
      .replace(/ Futures$/, '')
      .replace(/ Perpetual$/, '')
      .replace(/ \(Futures\)$/, '')
      .replace(/ \(Perpetual\)$/, '')
      .trim()
    domain = EXCHANGE_DOMAINS[clean]
  }
  if (!domain) {
    const lower = name.toLowerCase()
    for (const [k, v] of Object.entries(EXCHANGE_DOMAINS)) {
      if (lower.includes(k.toLowerCase())) { domain = v; break }
    }
  }
  return domain || null
}

export function getExchangeIcon(name) {
  const domain = resolveExchangeDomain(name)
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null
}

export function getExchangeHomeUrl(name) {
  const domain = resolveExchangeDomain(name)
  return domain ? `https://${domain}` : null
}
