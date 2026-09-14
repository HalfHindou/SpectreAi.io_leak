import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export default function RzTokenPopup({
  tokenCardPopup,
  expandedCard,
  setExpandedCard,
  onClose,
  onTokenSelect,
  dayMode,
  fmtPrice,
  formatChange,
}) {
  const { t } = useTranslation()

  if (!tokenCardPopup || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`token-card-popup-overlay ${dayMode ? 'token-card-popup-day-mode' : ''}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-card-popup-title-rz"
    >
      <div className="token-card-popup" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="token-card-popup-close"
          onClick={onClose}
          aria-label={t('researchPro.tokenPopup.rztokenpopup.ariaClose', "Close")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <h2 id="token-card-popup-title-rz" className="token-card-popup-title">{tokenCardPopup.name} - Past, Present, Future</h2>
        <div className="token-card-popup-grid">
          <div
            className={`token-card token-card-history${expandedCard === 'history' ? ' token-card-expanded' : ''}`}
            onClick={(e) => { e.stopPropagation(); setExpandedCard((prev) => prev === 'history' ? null : 'history') }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedCard((prev) => prev === 'history' ? null : 'history') } }}
            aria-pressed={expandedCard === 'history'}
          >
            <div className="token-card-head">
              <span className="token-card-dot token-card-dot-green" />
              <span className="token-card-label">{t('researchLite.history')}</span>
            </div>
            <div className="token-card-body">
              <div className="token-card-chart">
                {(() => {
                  const points = Array.isArray(tokenCardPopup.sparkline_7d) ? tokenCardPopup.sparkline_7d : []
                  if (!points.length) return <div className="token-card-chart-placeholder">{t('researchLite.noChartData')}</div>
                  const w = 200
                  const h = 80
                  const min = Math.min(...points)
                  const max = Math.max(...points)
                  const range = max - min || 1
                  const d = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - ((v - min) / range) * (h - 8)}`).join(' ')
                  const isUp = tokenCardPopup.change != null ? Number(tokenCardPopup.change) >= 0 : points[points.length - 1] >= points[0]
                  return (
                    <svg viewBox={`0 0 ${w} ${h}`} className={`token-card-sparkline ${isUp ? 'up' : 'down'}`}>
                      <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={d} />
                    </svg>
                  )
                })()}
              </div>
              {(() => {
                const points = Array.isArray(tokenCardPopup.sparkline_7d) ? tokenCardPopup.sparkline_7d : []
                if (points.length < 2) return null
                const high = Math.max(...points)
                const low = Math.min(...points)
                return (
                  <div className="token-card-stats">
                    <span>7d High {fmtPrice(high)}</span>
                    <span>7d Low {fmtPrice(low)}</span>
                  </div>
                )
              })()}
            </div>
            <div className="token-card-footer">
              <span className="token-card-footer-label">{t('researchLite.chartShowsYou')}</span>
              <span className="token-card-footer-highlight">{t('researchLite.thePast')}</span>
            </div>
          </div>

          <div
            className={`token-card token-card-live${expandedCard === 'live' ? ' token-card-expanded' : ''}`}
            onClick={(e) => { e.stopPropagation(); setExpandedCard((prev) => prev === 'live' ? null : 'live') }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedCard((prev) => prev === 'live' ? null : 'live') } }}
            aria-pressed={expandedCard === 'live'}
          >
            <div className="token-card-head">
              <span className="token-card-dot token-card-dot-green" />
              <span className="token-card-label">{t('researchLite.live')}</span>
            </div>
            <div className="token-card-body">
              <div className="token-card-live-token">
                <div className="token-card-live-avatar">
                  {tokenCardPopup.logo ? <img src={tokenCardPopup.logo} alt="" loading="lazy" decoding="async" width="40" height="40" /> : <span>{tokenCardPopup.symbol?.[0]}</span>}
                </div>
                <div>
                  <div className="token-card-live-name">{tokenCardPopup.name}</div>
                  <div className="token-card-live-symbol">{tokenCardPopup.symbol}</div>
                </div>
              </div>
              <div className="token-card-live-price">{fmtPrice(tokenCardPopup.price)}</div>
              {tokenCardPopup.change != null && (
                <div className={`token-card-live-change ${tokenCardPopup.change >= 0 ? 'positive' : 'negative'}`}>
                  {formatChange(tokenCardPopup.change)} 24h
                </div>
              )}
            </div>
            <div className="token-card-footer">
              <span className="token-card-footer-label">{t('researchLite.priceShowsYou')}</span>
              <span className="token-card-footer-highlight">{t('researchLite.thePresent')}</span>
            </div>
          </div>

          <div
            className={`token-card token-card-predictions${expandedCard === 'predictions' ? ' token-card-expanded' : ''}`}
            onClick={(e) => { e.stopPropagation(); setExpandedCard((prev) => prev === 'predictions' ? null : 'predictions') }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedCard((prev) => prev === 'predictions' ? null : 'predictions') } }}
            aria-pressed={expandedCard === 'predictions'}
          >
            <div className="token-card-head">
              <span className="token-card-dot token-card-dot-purple" />
              <span className="token-card-label">{t('researchLite.predictions')}</span>
            </div>
            <div className="token-card-body">
              <div className="token-card-prediction">
                <span className="token-card-pred-text" style={{ opacity: 0.5 }}>{t('researchPro.tokenPopup.rztokenpopup.noPredictionDataAvailable', "No prediction data available")}</span>
              </div>
            </div>
            <div className="token-card-footer">
              <span className="token-card-footer-label">{t('researchLite.marketsShowYou')}</span>
              <span className="token-card-footer-highlight">{t('researchLite.theFuture')}</span>
            </div>
          </div>
        </div>
        <div className="token-card-popup-actions">
          <button
            type="button"
            className="token-card-popup-view-details"
            onClick={() => {
              onClose()
              if (onTokenSelect) onTokenSelect({ symbol: tokenCardPopup.symbol, name: tokenCardPopup.name, price: tokenCardPopup.price, change: tokenCardPopup.change, logo: tokenCardPopup.logo })
            }}
          >
            {t('researchLite.viewFullDetails')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
