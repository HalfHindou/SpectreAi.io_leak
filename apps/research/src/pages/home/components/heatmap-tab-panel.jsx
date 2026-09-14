/**
 * HeatmapTabPanel - Crypto heatmap tile grid extracted from WelcomePage.
 * Hero tiles (larger) for top 2 coins, color-coded by 24h change,
 * with fullscreen mode via portal to document.body.
 */
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'

const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'USDD', 'GUSD',
  'FRAX', 'LUSD', 'CRVUSD', 'PYUSD', 'FDUSD', 'USDE', 'USDS', 'USD0', 'USD1',
])

function HeatmapTabPanel({
  heatmapTokens,
  topCoinsTokens,
  topCoinPrices,
  heatmapFullscreen,
  setHeatmapFullscreen,
  fmtPrice,
  openTokenCardPopup,
  formatChange,
  isStocks,
}) {
  const { t } = useTranslation()
  const heatmapSource = heatmapTokens.length > 0 ? heatmapTokens : topCoinsTokens
  const heatmapData = heatmapSource
    .filter(t => isStocks || !STABLECOINS.has((t.symbol || '').toUpperCase()))
    .slice(0, 24)

  const renderHeatmapGrid = (isFullscreenView) => (
    <div className="welcome-heatmap-grid">
      {heatmapData.map((token, idx) => {
        const liveData = topCoinPrices?.[token.symbol] || topCoinPrices?.[token.symbol?.toUpperCase?.()] || {}
        const livePrice = liveData.price > 0 ? liveData.price : token.price
        const liveChange = liveData.change != null ? liveData.change : token.change
        const change = Number(liveChange) || 0
        const absChange = Math.abs(change)
        const isPositive = change >= 0
        const intensity = Math.min(1, absChange / 8)
        const bgColor = isPositive
          ? `rgba(16, 185, 129, ${0.12 + intensity * 0.3})`
          : `rgba(239, 68, 68, ${0.12 + intensity * 0.3})`
        const borderColor = isPositive
          ? `rgba(16, 185, 129, ${0.15 + intensity * 0.25})`
          : `rgba(239, 68, 68, ${0.15 + intensity * 0.25})`
        const rowColors = TOKEN_ROW_COLORS[(token.symbol || '').toUpperCase()]
        const brandRgb = rowColors?.bg || '255, 255, 255'
        const gridArea = idx === 0 ? 'hero1' : idx === 1 ? 'hero2' : `t${idx}`
        const isHero = idx < 2
        return (
          <div
            key={token.symbol || idx}
            className={`welcome-heatmap-tile ${isHero ? 'welcome-heatmap-tile--hero' : ''} ${isPositive ? 'is-positive' : 'is-negative'}`}
            style={{
              gridArea,
              '--tile-bg': bgColor,
              '--tile-border': borderColor,
              '--tile-brand-rgb': brandRgb,
              '--tile-brand-gradient': rowColors?.gradient || 'none',
            }}
            onClick={() => openTokenCardPopup && openTokenCardPopup(token.symbol)}
          >
            <div className="welcome-heatmap-tile-top">
              <div className="welcome-heatmap-tile-logo">
                {token.logo ? (
                  <img src={token.logo} alt={token.symbol} loading="lazy" decoding="async" width="32" height="32" />
                ) : (
                  <span>{token.symbol?.[0] || '?'}</span>
                )}
              </div>
              <span className="welcome-heatmap-tile-symbol">{token.symbol}</span>
            </div>
            {(isHero || isFullscreenView) && (
              <div className="welcome-heatmap-tile-name">{token.name}</div>
            )}
            <div className="welcome-heatmap-tile-bottom">
              <span className="welcome-heatmap-tile-price">
                {livePrice ? fmtPrice(livePrice) : '-'}
              </span>
              <span className={`welcome-heatmap-tile-change ${isPositive ? 'positive' : 'negative'}`}>
                {isPositive ? '+' : ''}{formatChange(change)}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )

  const fullscreenBtn = (
    <button
      className="welcome-heatmap-fullscreen-btn"
      onClick={() => setHeatmapFullscreen(f => !f)}
      title={heatmapFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    >
      {heatmapFullscreen ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      )}
    </button>
  )

  return (
    <>
      <div className="welcome-heatmap-container">
        <div className="welcome-heatmap-toolbar">
          <span className="welcome-heatmap-toolbar-title">{t('homePage.heatmapTabPanel.heatmaptabpanel.spectreCryptoHeatmap', "Spectre Crypto Heatmap")}</span>
          {fullscreenBtn}
        </div>
        {renderHeatmapGrid(false)}
      </div>
      {heatmapFullscreen && createPortal(
        <div className="welcome-heatmap-container welcome-heatmap-fullscreen">
          <div className="welcome-heatmap-fullscreen-overlay" onClick={() => setHeatmapFullscreen(false)} />
          <div className="welcome-heatmap-toolbar">
            <span className="welcome-heatmap-toolbar-title">{t('homePage.heatmapTabPanel.heatmaptabpanel.spectreCryptoHeatmap', "Spectre Crypto Heatmap")}</span>
            {fullscreenBtn}
          </div>
          {renderHeatmapGrid(true)}
        </div>,
        document.body
      )}
    </>
  )
}

export default memo(HeatmapTabPanel)
