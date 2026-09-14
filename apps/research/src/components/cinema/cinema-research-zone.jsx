/**
 * CinemaResearchZone - Immersive cinema mode for Research Zone
 * Command center + editorial storybook: hero bar, chart, metrics,
 * full-width news/tweets editorial, markets, about
 */
import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import SpectreChart from '@/chart/SpectreChart'
import './cinema-research-zone.css'

const formatChange = (v) => {
  if (v == null || !Number.isFinite(v)) return '0.00'
  return Math.abs(v).toFixed(2)
}

// ═══════════════════════════════════════════════════════════════════════════════
// CINEMA RESEARCH ZONE - Main Component
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaResearchZone = ({
  symbol,
  tokenName,
  tokenData,
  tokenLogos,
  chartToken,
  liveTickerPrice,
  dayMode,
  // Feeds
  newsItems,
  agentSignals,
  tweets,
  rightFeedTab,
  setRightFeedTab,
  fetchNews,
  newsSource,
  lastNewsUpdate,
  formatNewsTime,
  // Markets
  markets,
  marketFilter,
  setMarketFilter,
  marketFilters,
  marketsSectionTab,
  setMarketsSectionTab,
  predictionMarkets = [],
  mockPredictionMarkets = [],
  // About
  aboutDetails,
  categories,
  // Token switching
  symbolOptions,
  onSymbolChange,
  // Trending
  trendingTokens,
  // Mock data for display
  mockTokenData,
}) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const brandRgb = TOKEN_ROW_COLORS[symbol]?.bg || '139, 92, 246'
  const isPositive = tokenData?.change24h >= 0

  // ── Mood wall: derive sentiment from token's 24h change ──
  const sentimentVars = useMemo(() => {
    const ch = tokenData?.change24h ?? 0
    // Map change to mood: > +0.5% bullish, < -0.5% bearish, else neutral
    if (ch >= 0.5) {
      return {
        '--sentiment-primary': '16, 120, 75',
        '--sentiment-secondary': '20, 160, 100',
        '--sentiment-glow': '0.18',
      }
    } else if (ch <= -0.5) {
      return {
        '--sentiment-primary': '153, 27, 27',
        '--sentiment-secondary': '185, 28, 28',
        '--sentiment-glow': '0.18',
      }
    }
    return {
      '--sentiment-primary': '89, 86, 213',
      '--sentiment-secondary': '59, 130, 246',
      '--sentiment-glow': '0.12',
    }
  }, [tokenData?.change24h])

  const sentimentClass = useMemo(() => {
    const ch = tokenData?.change24h ?? 0
    if (ch >= 0.5) return 'crz-mood-bull'
    if (ch <= -0.5) return 'crz-mood-bear'
    return 'crz-mood-neutral'
  }, [tokenData?.change24h])

  // Intelligence feed tab (separate from main feed tabs)
  const [intelTab, setIntelTab] = useState('signals')

  return (
    <div
      className={`crz ${sentimentClass} ${dayMode ? 'crz-day' : ''}`}
      style={{ '--brand-rgb': brandRgb, ...sentimentVars }}
    >
      {/* Living mood wall */}
      <div className="crz-sentiment-wall" />
      <div className="crz-sentiment-wall-secondary" />

      {/* ═══ Hero Token Bar (sticky) ═══ */}
      <div className="crz-hero-bar">
        <div className="crz-hero-bar-inner">
          {/* Token identity */}
          <div className="crz-hero-identity">
            <div className="crz-hero-logo-wrap">
              <div className="crz-hero-logo-glow" />
              {tokenLogos[symbol] ? (
                <img src={tokenLogos[symbol]} alt="" className="crz-hero-logo" />
              ) : (
                <span className="crz-hero-logo-fallback">{symbol.charAt(0)}</span>
              )}
            </div>
            <div className="crz-hero-text">
              <span className="crz-hero-name">{tokenName}</span>
              <span className="crz-hero-ticker">{symbol}</span>
            </div>
          </div>

          {/* Price block */}
          <div className="crz-hero-price-block">
            <span className="crz-hero-price">{fmtPrice(tokenData.price)}</span>
            <span className={`crz-hero-change ${isPositive ? 'up' : 'down'}`}>
              {isPositive ? '+' : ''}{formatChange(tokenData.change24h)}%
            </span>
          </div>

          {/* Quick stats */}
          <div className="crz-hero-stats">
            <div className="crz-hero-stat">
              <span className="crz-hero-stat-label">{t('common.marketCap')}</span>
              <span className="crz-hero-stat-value">{fmtLarge(tokenData.mcap)}</span>
            </div>
            <div className="crz-hero-stat">
              <span className="crz-hero-stat-label">{t('common.volume24h')}</span>
              <span className="crz-hero-stat-value">{fmtLarge(tokenData.volume24h)}</span>
            </div>
            <div className="crz-hero-stat">
              <span className="crz-hero-stat-label">{t('common.rank')}</span>
              <span className="crz-hero-stat-value">#{tokenData.rank}</span>
            </div>
          </div>

          {/* Token switcher pills */}
          <div className="crz-hero-switcher">
            {symbolOptions.map((s) => (
              <button
                key={s}
                type="button"
                className={`crz-hero-pill ${symbol === s ? 'active' : ''}`}
                onClick={() => onSymbolChange(s)}
              >
                {tokenLogos[s] && <img src={tokenLogos[s]} alt="" className="crz-hero-pill-logo" />}
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Chart Section (immersive) ═══ */}
      <section className="crz-chart-section">
        <div className="crz-chart-container">
          <SpectreChart
            token={chartToken}
            height={500}
            dayMode={dayMode}
          />
        </div>
      </section>

      {/* ═══ Metrics Row ═══ */}
      <section className="crz-metrics-row">
        {[
          { label: t('cinemaResearch.marketCapLabel'), value: fmtLarge(tokenData.mcap) },
          { label: t('cinemaResearch.volume24hLabel'), value: fmtLarge(tokenData.volume24h) },
          { label: t('cinemaResearch.fdvLabel'), value: fmtLarge(tokenData.fdv) },
          { label: t('cinemaResearch.circSupplyLabel'), value: tokenData.circulating != null ? `${(tokenData.circulating / 1e6).toFixed(2)}M` : '\-' },
          { label: t('cinemaResearch.volMcapLabel'), value: `${tokenData.volMcapPct || 0}%` },
          { label: t('cinemaResearch.scoreLabel'), value: tokenData.score != null ? `${tokenData.score}/10` : '\-' },
        ].map((m) => (
          <div key={m.label} className="crz-metric-card">
            <span className="crz-metric-accent" />
            <span className="crz-metric-label">{m.label}</span>
            <span className="crz-metric-value">{m.value}</span>
          </div>
        ))}
      </section>

      {/* ═══ EDITORIAL: News + Tweets (Full-width storybook) ═══ */}
      <section className="crz-editorial">
        <div className="crz-editorial-header">
          <h2 className="crz-section-title">{t('cinemaResearch.theFeed')}</h2>
          <div className="crz-section-tabs">
            <button
              type="button"
              className={`crz-tab ${rightFeedTab === 'news' ? 'active' : ''}`}
              onClick={() => setRightFeedTab('news')}
            >
              {t('cinemaResearch.headlines')}
            </button>
            <button
              type="button"
              className={`crz-tab ${rightFeedTab === 'tweets' ? 'active' : ''}`}
              onClick={() => setRightFeedTab('tweets')}
            >
              {t('cinemaResearch.cryptoTwitter')}
            </button>
          </div>
        </div>

        {/* News - Magazine / storybook cards */}
        {rightFeedTab === 'news' && (
          <div className="crz-story-grid">
            {newsItems.length === 0 ? (
              <p className="crz-feed-empty">{t('cinemaResearch.loadingHeadlines')}</p>
            ) : (
              newsItems.slice(0, 8).map((item, idx) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`crz-story-card ${idx === 0 ? 'crz-story-featured' : ''}`}
                >
                  {item.imageUrl && (
                    <div className="crz-story-img-wrap">
                      <img src={item.imageUrl} alt="" className="crz-story-img" loading="lazy" />
                      <div className="crz-story-img-overlay" />
                    </div>
                  )}
                  <div className="crz-story-body">
                    <span className="crz-story-source">{item.source}</span>
                    <span className="crz-story-title">{item.title}</span>
                    <span className="crz-story-time">{formatNewsTime ? formatNewsTime(item.publishedOn) : ''}</span>
                  </div>
                </a>
              ))
            )}
          </div>
        )}

        {/* Tweets - editorial social cards */}
        {rightFeedTab === 'tweets' && (
          <div className="crz-tweets-grid">
            {tweets.map((tweet) => (
              <div key={tweet.id} className="crz-tweet-card">
                <div className="crz-tweet-card-header">
                  <img src={tweet.avatar} alt="" className="crz-tweet-card-avatar" />
                  <div className="crz-tweet-card-identity">
                    <span className="crz-tweet-card-name">{tweet.name}</span>
                    <span className="crz-tweet-card-handle">{tweet.handle}</span>
                  </div>
                  <span className="crz-tweet-card-time">{tweet.time}</span>
                </div>
                <p className="crz-tweet-card-text">{tweet.content}</p>
                <div className="crz-tweet-card-stats">
                  <span className="crz-tweet-card-stat">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                    {tweet.likes}
                  </span>
                  <span className="crz-tweet-card-stat">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                    {tweet.retweets}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══ Two-Column: Markets + Agent Intelligence ═══ */}
      <section className="crz-two-col">
        {/* Left: Markets */}
        <div className="crz-col crz-col-markets">
          <div className="crz-section-header">
            <h2 className="crz-section-title">{t('cinemaResearch.markets')}</h2>
            <div className="crz-section-tabs">
              <button
                type="button"
                className={`crz-tab ${marketsSectionTab === 'markets' ? 'active' : ''}`}
                onClick={() => setMarketsSectionTab('markets')}
              >
                {t('analytics.exchanges')}
              </button>
              <button
                type="button"
                className={`crz-tab ${marketsSectionTab === 'predictions' ? 'active' : ''}`}
                onClick={() => setMarketsSectionTab('predictions')}
              >
                {t('cinemaResearch.predictions')}
              </button>
            </div>
          </div>

          {marketsSectionTab === 'markets' && (
            <>
              <div className="crz-market-filters">
                {marketFilters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`crz-filter-pill ${marketFilter === f.id ? 'active' : ''}`}
                    onClick={() => setMarketFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="crz-table-wrap">
                <table className="crz-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('cinemaResearch.exchange')}</th>
                      <th>{t('common.pair')}</th>
                      <th>{t('common.price')}</th>
                      <th>{t('common.volume24h')}</th>
                      <th>{t('cinemaResearch.volumePct')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {markets.map((row, i) => (
                      <tr key={`${row.exchange}-${row.pair}`}>
                        <td>{i + 1}</td>
                        <td>{row.exchange}</td>
                        <td className="crz-table-pair">{row.pair}</td>
                        <td>{fmtPrice(row.price)}</td>
                        <td>{fmtLarge(row.volume24h)}</td>
                        <td>{row.volumePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {marketsSectionTab === 'predictions' && (
            <div className="crz-table-wrap">
              <table className="crz-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('cinemaResearch.question')}</th>
                    <th>{t('cinemaResearch.yesPct')}</th>
                    <th>{t('common.volume')}</th>
                    <th>{t('cinemaResearch.platform')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(predictionMarkets.length > 0 ? predictionMarkets : mockPredictionMarkets).map((row, i) => (
                    <tr key={row.id}>
                      <td>{i + 1}</td>
                      <td className="crz-table-question">{row.question}</td>
                      <td>
                        <span className={`crz-yes-badge ${row.yesPct >= 50 ? 'up' : 'down'}`}>
                          {row.yesPct}%
                        </span>
                      </td>
                      <td>{row.volumeFormatted}</td>
                      <td>
                        <a href={row.url} target="_blank" rel="noopener noreferrer" className="crz-platform-link">
                          {row.platform}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Agent Intelligence */}
        <div className="crz-col crz-col-intel">
          <div className="crz-section-header">
            <h2 className="crz-section-title">{t('cinemaResearch.agentIntel')}</h2>
          </div>
          <div className="crz-intel-feed">
            {agentSignals.map((signal) => (
              <div key={signal.id} className="crz-intel-card">
                <div className="crz-intel-badge">{signal.agent}</div>
                <p className="crz-intel-message">{signal.message}</p>
                <span className="crz-intel-time">{signal.time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ About Section ═══ */}
      {aboutDetails && (
        <section className="crz-about">
          <h2 className="crz-section-title">{t('cinemaResearch.about', { name: tokenName })}</h2>
          {aboutDetails.description && (
            <p className="crz-about-desc">{aboutDetails.description}</p>
          )}
          <div className="crz-about-meta">
            {categories && categories.map((cat) => (
              <span key={cat} className="crz-category-pill">{cat}</span>
            ))}
            {aboutDetails.links?.homepage && (
              <a href={aboutDetails.links.homepage} target="_blank" rel="noopener noreferrer" className="crz-link-pill">{t('research.website')}</a>
            )}
            {aboutDetails.links?.twitter && (
              <a href={aboutDetails.links.twitter} target="_blank" rel="noopener noreferrer" className="crz-link-pill">{t('research.twitter')}</a>
            )}
            {aboutDetails.links?.reddit && (
              <a href={aboutDetails.links.reddit} target="_blank" rel="noopener noreferrer" className="crz-link-pill">{t('research.reddit')}</a>
            )}
            {aboutDetails.links?.explorer && (
              <a href={aboutDetails.links.explorer} target="_blank" rel="noopener noreferrer" className="crz-link-pill">{t('research.explorer')}</a>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export default CinemaResearchZone
