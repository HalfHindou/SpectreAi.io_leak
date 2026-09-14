export function computePricescaleFromPrice(price) {
  if (!(price > 0 && price < 1e12 && Number.isFinite(price))) return null
  if (price >= 10000) return 100
  if (price >= 100) return 10000
  if (price >= 1) return 10000
  if (price >= 0.01) return 1000000
  if (price >= 0.0001) return 100000000
  return 10000000000
}

// A resolved on-chain token already supplies identity and price precision.
// Restrict this shortcut to the symbol that owns the widget: a later symbol
// search must not inherit the parent token's metadata or price scale.
export function knownCryptoSymbolInfo({ symbolName, chartSymbol, token, pricescale }) {
  if (token?.isStock || typeof token?.address !== 'string' || !token.address.trim()) return null
  if (!Number.isInteger(Number(token.networkId)) || Number(token.networkId) <= 0) return null
  if (!symbolName || !chartSymbol || String(symbolName).toUpperCase() !== String(chartSymbol).toUpperCase()) return null
  if (!Number.isInteger(pricescale) || pricescale <= 0) return null

  return {
    name: symbolName,
    full_name: `CRYPTO:${symbolName}USD`,
    description: `${symbolName}/USD`,
    type: 'crypto',
    session: '24x7',
    exchange: 'CRYPTO',
    listed_exchange: 'CRYPTO',
    timezone: 'Etc/UTC',
    has_intraday: true,
    has_seconds: true,
    seconds_multipliers: ['1'],
    has_daily: true,
    has_weekly_and_monthly: true,
    supported_resolutions: ['1S', '1', '5', '15', '30', '60', '240', '720', '1D', '1W'],
    pricescale,
    minmov: 1,
    currency_code: 'USD',
    data_status: 'streaming',
    volume_precision: 2,
  }
}
