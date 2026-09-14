/**
 * MarketPulse — the Market Summary tab surface (dense dashboard rework, 2026-07-09).
 *
 * Layout (top → bottom):
 *   1. Dated header + updated stamp.
 *   2. Full-width MARKETS STRIP — macro instruments (S&P 500, Nasdaq, Gold, Oil,
 *      VIX, DXY) + crypto majors (BTC/ETH/SOL) + Fear & Greed. Real numbers, mono.
 *   2b. The DESK BRIEF — the morning / week-ahead / big-picture note written on
 *      the box and pushed to Telegram, shown here as well as on the Intel Desk.
 *   3. Two-column split — LEFT: a diverse, category-tagged NEWS board (crypto +
 *      stocks + commodities + macro, ~20 items). RIGHT: the Market Thesis (macro
 *      LLM brief) + a "watching" line. Columns balance via the tall news list.
 *
 * Design: glassmorphism, warm-white on black, mono numbers, shimmer skeletons.
 * Category tags are subtle uppercase labels — NO left-edge color bars (AI slop).
 */
import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import DeskBriefCard from '@/pages/intelligence-feed/components/DeskBriefCard'
import useMarketPulse from './use-market-pulse'

function timeAgo(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fgToneClass(value) {
  if (value == null) return ''
  if (value >= 75) return 'mp-fg--greed'
  if (value >= 55) return 'mp-fg--warm'
  if (value >= 45) return 'mp-fg--neutral'
  if (value >= 25) return 'mp-fg--cool'
  return 'mp-fg--fear'
}

const CAT_LABEL = { crypto: 'Crypto', stocks: 'Stocks', commodities: 'Commodities', macro: 'Macro' }

/* ── Markets strip — macro instruments + crypto majors + Fear & Greed ── */
function MarketTile({ label, px, chg, fmtPrice, isCrypto }) {
  const cls = chg == null ? '' : chg >= 0 ? 'mp-pos' : 'mp-neg'
  return (
    <div className="mp-tile">
      <span className="mp-tile-label">{label}</span>
      <div className="mp-tile-row">
        <span className="mp-tile-px">{isCrypto ? fmtPrice(px) : px.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        {chg != null && (
          <span className={`mp-tile-chg ${cls}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
        )}
      </div>
    </div>
  )
}

function MarketsStrip({ markets, cryptoLevels, fearGreed, fmtPrice, loading }) {
  const hasAny = markets.length > 0 || cryptoLevels.length > 0 || fearGreed?.value != null

  if (loading && !hasAny) {
    return (
      <div className="mp-markets">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="mp-tile mp-tile--skel" style={{ '--stagger': i }}>
            <div className="mp-shimmer mp-tile-skel-label" />
            <div className="mp-shimmer mp-tile-skel-px" />
          </div>
        ))}
      </div>
    )
  }
  if (!hasAny) return null

  return (
    <div className="mp-markets" aria-label="Market snapshot">
      {markets.map((m) => (
        <MarketTile key={m.symbol} label={m.label} px={m.px} chg={m.chg24h} fmtPrice={fmtPrice} />
      ))}
      {cryptoLevels.map((l) => (
        <MarketTile key={l.symbol} label={l.symbol} px={l.px} chg={l.chg24h} fmtPrice={fmtPrice} isCrypto />
      ))}
      {fearGreed?.value != null && (
        <div className="mp-tile mp-tile--fg">
          <span className="mp-tile-label">Fear &amp; Greed</span>
          <div className="mp-tile-row">
            <span className={`mp-tile-px ${fgToneClass(fearGreed.value)}`}>{fearGreed.value}</span>
            {fearGreed.label && <span className="mp-tile-fg-label">{fearGreed.label}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Market thesis (the star) — macro LLM brief in Spectre's voice ── */
function ThesisCard({ outlook, loading }) {
  if (loading && !outlook) {
    return (
      <div className="mp-outlook mp-outlook--loading">
        <div className="mp-shimmer mp-shimmer-chip" />
        <div className="mp-shimmer mp-shimmer-title" />
        <div className="mp-shimmer mp-shimmer-line mp-shimmer-line-1" />
        <div className="mp-shimmer mp-shimmer-line mp-shimmer-line-2" />
        <div className="mp-shimmer mp-shimmer-line mp-shimmer-line-3" />
      </div>
    )
  }
  if (!outlook) return null

  const { title, regime, brief, watching } = outlook

  // Dedup: the title is often the same sentence as brief[0] (LLM echo).
  const norm = (s) => (s || '').toLowerCase().replace(/[\s.]+$/g, '').trim()
  const nt = norm(title)
  const bodyLines = (brief || []).filter((l) => {
    const nl = norm(l)
    return nl && nl !== nt && !(nt && (nl.startsWith(nt) || nt.startsWith(nl)))
  })

  return (
    <div className="mp-outlook">
      <div className="mp-outlook-head">
        <span className="mp-eyebrow">
          <span className="mp-live-dot" aria-hidden="true" />
          Market Thesis
        </span>
        {regime && <span className="mp-regime">{regime}</span>}
      </div>

      {title && <h2 className="mp-outlook-title">{title}</h2>}

      {bodyLines.length > 0 && (
        <div className="mp-outlook-body">
          {bodyLines.map((line, i) => (
            <p key={i} className="mp-outlook-line" style={{ '--stagger': i }}>
              {line}
            </p>
          ))}
        </div>
      )}

      {watching && (
        <div className="mp-watching">
          <p className="mp-watching-line">
            <span className="mp-watching-label">Watching</span>
            {watching}
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Latest news — diverse, category-tagged board ── */
function NewsList({ news, loading, navigate }) {
  const showSkeleton = loading && news.length === 0

  const openItem = (item) => {
    // Bare RSS headlines have no in-app body → open the source in a new tab where
    // the full article lives. (Items carrying real content would route to /news/:id.)
    if (item.url && item.url !== '#') {
      window.open(item.url, '_blank', 'noopener,noreferrer')
      return
    }
    navigate(`/news/${encodeURIComponent(item.id)}`, { state: { article: item.article } })
  }

  return (
    <div className="mp-news">
      <div className="mp-news-head">
        <h3 className="mp-news-title">Latest Market News</h3>
        <Link to="/news" className="mp-news-all">See all news →</Link>
      </div>

      <div className="mp-news-list">
        {showSkeleton ? (
          Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="mp-news-skel" style={{ '--stagger': i }}>
              <div className="mp-shimmer mp-news-skel-tag" />
              <div className="mp-shimmer mp-news-skel-line" />
            </div>
          ))
        ) : news.length === 0 ? (
          <Link to="/news" className="mp-news-empty">Open the News tab →</Link>
        ) : (
          news.map((item, i) => (
            <button
              key={item.id || i}
              type="button"
              className="mp-news-row"
              style={{ '--stagger': i }}
              onClick={() => openItem(item)}
            >
              <span className={`mp-news-tag mp-news-tag--${item.category}`}>
                {CAT_LABEL[item.category] || item.category}
              </span>
              <span className="mp-news-body">
                <span className="mp-news-headline">{item.title}</span>
                <span className="mp-news-meta">
                  {item.source}
                  {item.publishedAt ? ` · ${timeAgo(new Date(item.publishedAt).getTime())}` : ''}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

const MarketPulse = ({ fearGreed: fearGreedProp = null } = {}) => {
  const { fmtPrice } = useCurrency()
  const navigate = useNavigate()

  const {
    outlook,
    news,
    markets,
    fearGreed,
    outlookLoading,
    newsLoading,
    error,
    lastUpdated,
  } = useMarketPulse({ enabled: true, fearGreed: fearGreedProp })

  const showError = !outlook && !outlookLoading && error
  const cryptoLevels = outlook?.levels || []
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="warroom-container mp-container">
      <div className="mp-topbar">
        <span className="mp-date">{dateLabel}</span>
        {lastUpdated && <span className="mp-updated">Updated {timeAgo(lastUpdated)}</span>}
      </div>

      <MarketsStrip
        markets={markets}
        cryptoLevels={cryptoLevels}
        fearGreed={fearGreed}
        fmtPrice={fmtPrice}
        loading={outlookLoading && markets.length === 0}
      />

      {/* The desk brief leads the summary (founder call 2026-08-27): it is the
          written read the Telegram push already carries, and Market Summary is
          the second home for it alongside the Intel Desk. Hides itself when the
          engine has produced nothing, so the strip closes up on absence. */}
      <DeskBriefCard className="mp-dbrief" />

      <div className="mp-grid">
        <div className="mp-col mp-col-news">
          <NewsList news={news} loading={newsLoading} navigate={navigate} />
        </div>

        <div className="mp-col mp-col-side">
          <ThesisCard outlook={outlook} loading={outlookLoading} />
        </div>
      </div>

      {outlook?.caution && (
        <div className="mp-footnote">
          <span className="mp-caution">{outlook.caution}</span>
        </div>
      )}

      {showError && <div className="mp-error">{error}</div>}
    </div>
  )
}

export default MarketPulse
