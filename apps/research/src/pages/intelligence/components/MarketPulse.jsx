/**
 * MarketPulse - Right column market data sidebar (~240px).
 * Price rows, Fear & Greed, S&P/NASDAQ, agent status, article count.
 * Props: prices (array), fearGreed ({ value, classification }), stats (object)
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatChange } from '../utils'
import { useCurrency } from '@/hooks/useCurrency'
import '../Intelligence.css'

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL']

function fearGreedColor(value) {
  if (value == null) return 'var(--text-muted)'
  if (value <= 25) return '#EF4444'
  if (value <= 45) return '#F59E0B'
  if (value <= 55) return 'var(--text-muted)'
  if (value <= 75) return '#10B981'
  return '#22C55E'
}

function MarketPulse({ prices = [], fearGreed, stats }) {
  const { fmtPrice: formatPrice } = useCurrency()
  const { t } = useTranslation()
  const cryptoPrices = CRYPTO_SYMBOLS
    .map(sym => prices.find(p => p.symbol === sym))
    .filter(Boolean)

  const todayCount = stats?.todayCount ?? stats?.totalArticles ?? 0

  return (
    <aside className="st-pulse" aria-label={t('intelligencePage.marketPulse', 'Market Pulse')}>
      {/* Header */}
      <div className="st-pulse__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span className="st-pulse__title">{t('intelligencePage.marketPulse', 'Market Pulse').toUpperCase()}</span>
      </div>

      {/* Crypto prices */}
      {cryptoPrices.length > 0 && (
        <div className="st-pulse__prices">
          {cryptoPrices.map(p => (
            <div className="st-pulse__price-row" key={p.symbol}>
              <span className="st-pulse__symbol">{p.symbol}</span>
              <span className="st-pulse__price">{formatPrice(p.price)}</span>
              <span
                className={`st-pulse__change ${
                  p.change > 0 ? 'st-pulse__change--up' : p.change < 0 ? 'st-pulse__change--down' : ''
                }`}
              >
                {formatChange(p.change)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="st-pulse__divider" aria-hidden="true" />

      {/* Fear & Greed */}
      {fearGreed && fearGreed.value != null && (
        <>
          <div className="st-pulse__fear-greed">
            <span className="st-pulse__fg-label">{t('intelligencePage.fearAndGreed', 'Fear & Greed')}</span>
            <div className="st-pulse__fg-display">
              <span
                className="st-pulse__fg-value"
                style={{ color: fearGreedColor(fearGreed.value) }}
              >
                {fearGreed.value}
              </span>
              <span
                className="st-pulse__fg-class"
                style={{ color: fearGreedColor(fearGreed.value) }}
              >
                {fearGreed.classification || ''}
              </span>
            </div>
          </div>
          <div className="st-pulse__divider" aria-hidden="true" />
        </>
      )}

      {/* Article count */}
      <div className="st-pulse__count">
        <span className="st-pulse__count-value">{todayCount}</span>
        <span className="st-pulse__count-label">{t('intelligencePage.storiesToday', 'stories today')}</span>
      </div>
    </aside>
  )
}

export default memo(MarketPulse)
