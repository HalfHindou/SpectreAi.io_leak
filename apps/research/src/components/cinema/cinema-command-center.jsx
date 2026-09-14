/**
 * CinemaCommandCenter - Full-width editorial intelligence grid
 *
 * Shows all 3 sections (News, Activity, Alpha) simultaneously
 * in a storybook-style 3-column layout with chapter headers.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER HEADER - Storybook-style section divider
// ═══════════════════════════════════════════════════════════════════════════════

const ChapterHeader = ({ label, title }) => (
  <div className="cc-chapter-header">
    <div className="cc-chapter-divider">
      <span className="cc-chapter-line" />
      <span className="cc-chapter-label">{label}</span>
      <span className="cc-chapter-line" />
    </div>
    <h3 className="cc-chapter-title">{title}</h3>
  </div>
)

// ═══════════════════════════════════════════════════════════════════════════════
// NEWS CARD
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaNewsCard = ({ title, source, time, category, index }) => {
  return (
    <div
      className="cc-news-card"
      style={{ '--card-index': index }}
    >
      <div className="cc-news-accent" />
      <div className="cc-news-content">
        {category && (
          <span className="cc-news-category">{category}</span>
        )}
        <h4 className="cc-news-title">{title}</h4>
        <div className="cc-news-meta">
          <span className="cc-news-source">{source}</span>
          <span className="cc-news-time">{time}</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY ITEM
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaActivityItem = ({ type, token, action, amount, time, index }) => {
  const typeColors = {
    whale: '139, 92, 246',
    volume: '59, 130, 246',
    liquidation: '239, 68, 68',
    listing: '34, 197, 94',
    breakout: '249, 115, 22',
  }
  const rgb = typeColors[type] || '139, 92, 246'

  return (
    <div
      className="cc-activity-item"
      style={{ '--brand-rgb': rgb, '--item-index': index }}
    >
      <div className="cc-activity-indicator" />
      <div className="cc-activity-content">
        <span className="cc-activity-token">{token}</span>
        <span className="cc-activity-action">{action}</span>
        {amount && <span className="cc-activity-amount">{amount}</span>}
      </div>
      <span className="cc-activity-time">{time}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALPHA CARD
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaAlphaCard = ({ type, headline, detail, severity, time, index }) => {
  const severityColors = {
    critical: '239, 68, 68',
    high: '249, 115, 22',
    medium: '234, 179, 8',
    low: '34, 197, 94',
  }
  const rgb = severityColors[severity] || '139, 92, 246'

  return (
    <div
      className="cc-alpha-card"
      style={{ '--brand-rgb': rgb, '--card-index': index }}
    >
      <div className="cc-alpha-accent" />
      <div className="cc-alpha-content">
        <span className="cc-alpha-type">{type?.toUpperCase()}</span>
        <h4 className="cc-alpha-headline">{headline}</h4>
        <p className="cc-alpha-detail">{detail}</p>
      </div>
      <span className="cc-alpha-time">{time}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaCommandCenter = ({
  dayMode,
  marketMode,
  marketAiTab,
  setMarketAiTab,
  newsItems,
  heatmapTokens,
  calendarEvents,
  liveActivity,
  alphaFeed,
  intel,
  selectToken,
  stockPrices,
  liveVix,
}) => {
  const { t } = useTranslation()
  const isStocks = marketMode === 'stocks'

  // Mock news - stock or crypto
  const news = (newsItems && newsItems.length > 0) ? newsItems : (isStocks ? [
    { title: 'S&P 500 tests key resistance ahead of Fed minutes', source: 'Bloomberg', time: '5m ago', category: 'Market' },
    { title: 'NVDA earnings beat expectations, guidance raised', source: 'CNBC', time: '12m ago', category: 'Earnings' },
    { title: 'Treasury yields steady as inflation data looms', source: 'Reuters', time: '28m ago', category: 'Macro' },
    { title: 'Tech sector rotation into value accelerates', source: 'WSJ', time: '45m ago', category: 'Sector' },
  ] : [
    { title: 'Bitcoin breaks key resistance level', source: 'CoinDesk', time: '5m ago', category: 'Market' },
    { title: 'Ethereum ETF approval expected soon', source: 'The Block', time: '12m ago', category: 'Regulation' },
    { title: 'Solana DeFi TVL hits new ATH', source: 'DeFi Llama', time: '28m ago', category: 'DeFi' },
    { title: 'Major exchange announces new listing', source: 'CryptoNews', time: '45m ago', category: 'Exchange' },
  ])

  // Mock activity - stock or crypto
  const activity = (liveActivity && liveActivity.length > 0) ? liveActivity : (isStocks ? [
    { type: 'whale', token: 'AAPL', action: 'Institutional buy', amount: '$45M', time: '2m' },
    { type: 'volume', token: 'NVDA', action: 'Volume surge', amount: '+280%', time: '5m' },
    { type: 'breakout', token: 'MSFT', action: 'New 52-week high', amount: '', time: '7m' },
    { type: 'volume', token: 'TSLA', action: 'Options activity', amount: '$12M', time: '12m' },
    { type: 'whale', token: 'SPY', action: 'Dark pool block', amount: '$180M', time: '20m' },
  ] : [
    { type: 'whale', token: 'ETH', action: 'Accumulated', amount: '$2.4M', time: '2m' },
    { type: 'volume', token: 'SOL', action: 'Volume spike', amount: '+340%', time: '5m' },
    { type: 'liquidation', token: 'BTC', action: 'Long liquidated', amount: '$4.8M', time: '7m' },
    { type: 'listing', token: 'JUP', action: 'Listed on Raydium', amount: '', time: '12m' },
    { type: 'breakout', token: 'FET', action: 'Breaking resistance', amount: '+18%', time: '20m' },
  ])

  // Mock alpha - stock or crypto
  const alpha = (alphaFeed && alphaFeed.length > 0) ? alphaFeed : (isStocks ? [
    { type: 'macro', headline: `VIX at ${liveVix?.price?.toFixed(1) || '17.8'}`, detail: `${liveVix?.label || 'Moderate volatility'} - options market pricing near-term stability`, severity: liveVix?.price >= 25 ? 'critical' : liveVix?.price >= 20 ? 'high' : 'medium', time: 'now' },
    { type: 'earnings', headline: 'Earnings season in focus', detail: 'Mega-cap tech reporting this week. Beat rate at 78%', severity: 'high', time: '1h' },
    { type: 'flow', headline: 'ETF inflows accelerating', detail: 'SPY and QQQ seeing sustained institutional buying', severity: 'low', time: '3h' },
  ] : [
    { type: 'liquidation', headline: '$1.36B Liquidated', detail: 'Cascade across BTC & ETH perpetuals', severity: 'critical', time: '2m' },
    { type: 'pump', headline: 'JELLY surged 1,325%', detail: 'Market cap: $52M to $420M', severity: 'high', time: '5m' },
    { type: 'macro', headline: 'Risk-off signals detected', detail: 'Traditional markets showing weakness', severity: 'high', time: '28m' },
  ])

  return (
    <div className="cinema-command-center">
      {/* Master header */}
      <div className="cc-master-header">
        <span className="cc-master-label">{t('commandCenter.title').toUpperCase()}</span>
        <h2 className="cc-master-title">{t('commandCenter.marketIntelligence')}</h2>
      </div>

      {/* 3-column editorial grid */}
      <div className="cc-grid">
        {/* NEWS COLUMN */}
        <div className="cc-section cc-section-news">
          <ChapterHeader label={t('commandCenter.briefing')} title={t('commandCenter.latestNews')} />
          <div className="cc-section-items">
            {news.slice(0, 4).map((item, idx) => (
              <CinemaNewsCard
                key={idx}
                title={item.title}
                source={item.source}
                time={item.time}
                category={item.category}
                index={idx}
              />
            ))}
          </div>
        </div>

        {/* ACTIVITY COLUMN */}
        <div className="cc-section cc-section-activity">
          <ChapterHeader label={t('commandCenter.liveFeed')} title={t('commandCenter.activity')} />
          <div className="cc-section-items">
            {activity.slice(0, 5).map((item, idx) => (
              <CinemaActivityItem
                key={idx}
                type={item.type}
                token={item.token}
                action={item.action}
                amount={item.amount}
                time={item.time}
                index={idx}
              />
            ))}
          </div>
        </div>

        {/* ALPHA COLUMN */}
        <div className="cc-section cc-section-alpha">
          <ChapterHeader label={t('commandCenter.signals')} title={t('commandCenter.alphaIntel')} />
          <div className="cc-section-items">
            {alpha.slice(0, 3).map((item, idx) => (
              <CinemaAlphaCard
                key={idx}
                type={item.type}
                headline={item.headline}
                detail={item.detail}
                severity={item.severity}
                time={item.time}
                index={idx}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CinemaCommandCenter
