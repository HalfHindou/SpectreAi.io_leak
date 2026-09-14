/**
 * W-042 · Watchlist Widget
 * Shows 8 major tokens with real-time prices from Binance.
 */
import { useBinanceTopCoinPrices } from '@/hooks/useCodexData'
import './Watchlist.css'

/* ---------- token config ---------- */

const WATCHLIST_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'AVAX', 'DOGE', 'ADA', 'XRP']

const TOKEN_META = {
  BTC: { name: 'Bitcoin', color: '#F7931A' },
  ETH: { name: 'Ethereum', color: '#627EEA' },
  SOL: { name: 'Solana', color: '#14F195' },
  BNB: { name: 'BNB', color: '#F0B90B' },
  AVAX: { name: 'Avalanche', color: '#E84142' },
  DOGE: { name: 'Dogecoin', color: '#C2A633' },
  ADA: { name: 'Cardano', color: '#0033AD' },
  XRP: { name: 'Ripple', color: '#8A8FA4' },
}

/* ---------- helpers ---------- */

function formatPrice(raw) {
  const price = Number(raw)
  if (!price || isNaN(price)) return '--'
  if (price >= 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (price >= 1) return `$${price.toFixed(2)}`
  if (price >= 0.01) return `$${price.toFixed(4)}`
  return `$${price.toFixed(6)}`
}

function formatVolume(raw) {
  const vol = Number(raw)
  if (!vol || isNaN(vol)) return '--'
  if (vol >= 1e9) return `$${(vol / 1e9).toFixed(1)}B`
  if (vol >= 1e6) return `$${(vol / 1e6).toFixed(0)}M`
  return `$${(vol / 1e3).toFixed(0)}K`
}

/* ---------- shimmer ---------- */

function ShimmerRow() {
  return (
    <div className="tcwl-skel-row">
      <div className="tcw-shimmer tcwl-skel-avatar" />
      <div className="tcwl-skel-lines">
        <div className="tcw-shimmer tcwl-skel-name" />
        <div className="tcw-shimmer tcwl-skel-sub" />
      </div>
      <div className="tcw-shimmer tcwl-skel-price" />
    </div>
  )
}

/* ---------- component ---------- */

export default function Watchlist() {
  const { prices, loading } = useBinanceTopCoinPrices(WATCHLIST_SYMBOLS, 10000)

  const hasPrices = Object.keys(prices).length > 0

  return (
    <div className="tcwl">
      {loading && !hasPrices ? (
        Array.from({ length: 8 }, (_, i) => <ShimmerRow key={i} />)
      ) : (
        WATCHLIST_SYMBOLS.map(symbol => {
          const meta = TOKEN_META[symbol] || { name: symbol, color: 'var(--text-muted)' }
          const coin = prices[symbol]
          const change = coin?.change
          const positive = change >= 0
          const avatarBg = meta.color
            ? `rgba(${parseInt(meta.color.slice(1, 3), 16)},${parseInt(meta.color.slice(3, 5), 16)},${parseInt(meta.color.slice(5, 7), 16)},0.15)`
            : 'rgba(255,255,255,0.06)'

          return (
            <div key={symbol} className="tcwl-row">
              {/* Token Avatar */}
              <div
                className="tcwl-avatar"
                style={{ background: avatarBg, color: meta.color }}
              >
                {symbol.slice(0, 3)}
              </div>

              {/* Name + Volume */}
              <div className="tcwl-info">
                <div className="tcwl-symbol">{symbol}</div>
                <div className="tcwl-vol">{formatVolume(coin?.volume)} vol</div>
              </div>

              {/* Price + Change */}
              <div className="tcwl-figures">
                <div className="tcwl-price">{formatPrice(coin?.price)}</div>
                {change != null && (
                  <div className={`tcwl-change ${positive ? 'tcwl-change--up' : 'tcwl-change--down'}`}>
                    {positive ? '▲' : '▼'} {Math.abs(Number(change) || 0).toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
          )
        })
      )}

      {/* Add Token row */}
      <div className="tcwl-add">+ Add Token or Stock</div>
    </div>
  )
}
