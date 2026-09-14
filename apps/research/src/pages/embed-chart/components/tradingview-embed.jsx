/**
 * TradingViewEmbed — iframe wrapper around s.tradingview.com/widgetembed.
 * Props:
 *   binanceSymbol: string | null   (e.g. 'BTCUSDT'). If null, shows disabled msg.
 *   interval:      string          TV interval code: '60', '240', 'D', 'W'
 * Uses URL params supported by TV's widgetembed. Dark theme, hidden toolbar
 * side panel, allow drawing + studies.
 */
export default function TradingViewEmbed({ binanceSymbol, interval = '60' }) {
  if (!binanceSymbol) {
    return (
      <div className="embed-tv-unavailable">
        <p>TradingView view is not available for this token.</p>
        <p className="embed-tv-unavailable-hint">Use Line or Candle mode instead.</p>
      </div>
    )
  }

  const symbol = `BINANCE:${binanceSymbol}`
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: 'dark',
    style: '1',          // candles
    timezone: 'Etc/UTC',
    withdateranges: '1',
    hide_side_toolbar: '0',
    allow_symbol_change: '0',
    save_image: '0',
    studies: '[]',
    locale: 'en',
    utm_source: 'spectre-embed',
    utm_medium: 'widget',
  })
  const src = `https://s.tradingview.com/widgetembed/?${params.toString()}`

  return (
    <iframe
      title={`TradingView ${symbol}`}
      src={src}
      className="embed-tv-iframe"
      allowFullScreen
      allow="clipboard-write"
      frameBorder="0"
    />
  )
}

/** Map TV-native timeframe (matches TradingViewAdvanced's keys) → TV iframe interval. */
export function timeframeToTVInterval(tf) {
  switch (tf) {
    case '1M':  return '1'
    case '5M':  return '5'
    case '15M': return '15'
    case '1H':  return '60'
    case '4H':  return '240'
    case '1D':  return 'D'
    case '1W':  return 'W'
    // Backwards-compat with the old range-style keys
    case '7D':  return '60'
    case '3M':  return 'D'
    case '1Y':  return 'W'
    default:    return '60'
  }
}
