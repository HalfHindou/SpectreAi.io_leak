/**
 * PriceTickerStrip - Horizontal live price bar (CoinDesk-style).
 * Shows BTC, ETH, SOL with 24h price + change.
 */
export default function PriceTickerStrip({ prices }) {
  if (!prices || prices.length === 0) return null

  function fmtPrice(p) {
    if (p == null) return '-'
    if (p >= 1) return `$${Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    return `$${p.toFixed(4)}`
  }

  function fmtChange(c) {
    if (c == null) return ''
    const sign = c > 0 ? '+' : ''
    return `${sign}${c.toFixed(2)}%`
  }

  return (
    <div className="nr-ticker">
      {prices.map(p => (
        <div key={p.symbol} className="nr-ticker__item">
          <span className="nr-ticker__symbol">{p.symbol}</span>
          <span className="nr-ticker__price">{fmtPrice(p.price)}</span>
          <span className={`nr-ticker__change ${p.change >= 0 ? 'nr-ticker__change--bull' : 'nr-ticker__change--bear'}`}>
            {fmtChange(p.change)}
          </span>
        </div>
      ))}
    </div>
  )
}
