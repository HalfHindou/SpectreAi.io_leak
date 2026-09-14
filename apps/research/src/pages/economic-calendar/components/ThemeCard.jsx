/**
 * ThemeCard Component
 * Individual theme narrative card for Market Context layer.
 * Two variants:
 *   - 'major': Full card with headline, body, catalysts list, and affected tickers.
 *   - 'focus': Compact alert card with amber left border accent and KEY FOCUS prefix.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import TickerBubble from './TickerBubble'
import './ThemeCard.css'

const ThemeCard = ({ theme, variant = 'major' }) => {
  const { t } = useTranslation()
  if (!theme) return null

  const isFocus = variant === 'focus'

  return (
    <div className={`theme-card theme-card--${variant}`}>
      {/* Headline */}
      <div className="theme-card__headline">
        {isFocus && (
          <span className="theme-card__focus-prefix">{t('economicCalendar.keyFocus', 'KEY FOCUS:')} </span>
        )}
        {theme.headline}
      </div>

      {/* Body */}
      {theme.body && (
        <p className="theme-card__body">{theme.body}</p>
      )}

      {/* Catalysts - major variant only */}
      {!isFocus && theme.catalysts && theme.catalysts.length > 0 && (
        <div className="theme-card__catalysts">
          <div className="theme-card__catalysts-label">{t('economicCalendar.keyCatalysts', 'Key Catalysts')}</div>
          <div className="theme-card__catalysts-list">
            {theme.catalysts.map((catalyst, i) => (
              <div key={i} className="theme-card__catalyst-item">
                <span className="theme-card__catalyst-dot">&middot;</span>
                {catalyst}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Affected tickers */}
      {theme.affectedTickers && theme.affectedTickers.length > 0 && (
        <div className="theme-card__tickers">
          {theme.affectedTickers.map((ticker, i) => (
            <TickerBubble
              key={`${ticker.symbol}-${i}`}
              symbol={ticker.symbol}
              assetClass={ticker.assetClass}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default ThemeCard
