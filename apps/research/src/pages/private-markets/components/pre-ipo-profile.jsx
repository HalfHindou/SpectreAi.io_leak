/**
 * PreIpoProfile — detail panel for a single pre-IPO company.
 *
 * Header identity, key valuation stats, the valuation-history chart (reused
 * from the deal feed), the round ladder, investors, and a linked-tweet rail
 * pulled live from X Dash (official handle + name search). Glass-card per
 * design-system.md. Opens as a right sidebar (desktop) / bottom sheet (mobile),
 * matching the deal-feed CompanyProfilePrivate behaviour.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import CompanyLogo from './company-logo'
import TweetCard from './tweet-card'
import ValuationHistoryChart from './valuation-history-chart'
import PreIpoChart from './pre-ipo-chart'
import NewsPanel from './news-panel'
import useCompanyQuote from './use-company-quote'
import { getValuationHistory, searchTweets, getOfficialTweets, getCompanyNews } from './private-markets-api'
import { mergeTweets } from './use-preipo'
import { formatAmount, formatRelativeDate } from './private-markets-constants'
import { preipoMeta, twitterHandle, formatMultiple, IPO_STATUS, TIER_LABEL } from './preipo-constants'

const fmtUsd = (n) =>
  Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const ExternalLink = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </svg>
)

export default function PreIpoProfile({ entry, onClose }) {
  const { t, i18n } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)

  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [tweets, setTweets] = useState({ list: [], loading: true })
  const [news, setNews] = useState({ list: [], loading: true })

  // Editorial meta + (when public) the live-traded ticker, computed null-safe so
  // the hooks below run unconditionally before the `!entry` early return.
  const meta = entry ? preipoMeta(entry.company) || {} : {}
  const ticker = meta.ticker ? String(meta.ticker).replace(/^\$/, '') : null
  const { quote } = useCompanyQuote(ticker)

  // Instant chart from the roster's embedded series; replaced by the richer
  // /valuation-history payload (adds lead investors) when it lands.
  const seedHistory = useMemo(() => {
    if (!entry?.valuationSeries?.length) return null
    return {
      company: entry.company,
      rounds: entry.valuationSeries.map((r) => ({
        date: r.date,
        roundType: r.roundType,
        amountUsd: r.amountUsd,
        valuationUsd: r.valuationUsd,
        leadInvestor: null,
      })),
      latestValuation: entry.currentValuation,
      totalRaised: entry.totalRaised,
    }
  }, [entry])

  useEffect(() => {
    let cancelled = false
    if (!entry?.company) return undefined
    setHistory(null)
    setHistoryLoading(true)
    getValuationHistory(entry.company).then((data) => {
      if (cancelled) return
      setHistory(data?.rounds?.length ? data : null)
      setHistoryLoading(false)
    })
    return () => { cancelled = true }
  }, [entry?.company])

  useEffect(() => {
    let cancelled = false
    if (!entry?.company) return undefined
    setTweets({ list: [], loading: true })
    const handle = twitterHandle(entry.company)
    Promise.all([
      searchTweets(entry.company, { limit: 16 }),
      handle ? getOfficialTweets(handle, { limit: 6 }) : Promise.resolve({ tweets: [] }),
    ]).then(([searched, official]) => {
      if (cancelled) return
      const merged = mergeTweets([...(official.tweets || []), ...searched]).slice(0, 12)
      setTweets({ list: merged, loading: false })
    })
    return () => { cancelled = true }
  }, [entry?.company])

  useEffect(() => {
    let cancelled = false
    if (!entry?.company) return undefined
    setNews({ list: [], loading: true })
    getCompanyNews(entry.company, ticker).then((list) => {
      if (cancelled) return
      setNews({ list, loading: false })
    })
    return () => { cancelled = true }
  }, [entry?.company])

  if (!entry) return null

  const multiple = formatMultiple(entry.valuationMultiple)
  const statusKey = meta.status || 'private'
  const statusLabel = IPO_STATUS[statusKey] || IPO_STATUS.private
  const isLive = statusKey === 'ipo'
  const tierLabel = entry.tier ? TIER_LABEL[entry.tier] : null
  const chartHistory = history || seedHistory
  const handle = twitterHandle(entry.company)
  const quoteUp = quote ? quote.change >= 0 : true

  return (
    <div className="pi-profile glass-card">
      <div className="pm-profile-handle" aria-hidden="true" />
      <button type="button" className="pm-profile-close btn-ghost" onClick={onClose} aria-label={t('common.close')}>
        <CloseIcon />
      </button>

      {/* Identity */}
      <div className="pi-profile-identity">
        <CompanyLogo company={entry.company} logoUrl={entry.logoUrl} domain={entry.domain} className="pi-logo-lg" />
        <div className="pi-profile-titles">
          <h2 className="display-md pi-profile-name">{entry.company}</h2>
          <div className="pi-profile-meta">
            <span className="caption">{entry.sector}</span>
            {meta.hq && (<><span className="pm-dot" /><span className="caption">{meta.hq}</span></>)}
            {meta.founded && (<><span className="pm-dot" /><span className="caption">{t('privateMarkets.profile.founded', { year: meta.founded })}</span></>)}
          </div>
        </div>
        <span className={`pi-status-pill${isLive ? ' pi-status-live' : ''}`}>
          {isLive && <span className="pi-status-dot" aria-hidden="true" />}
          {statusLabel}
        </span>
      </div>

      {/* Key stats */}
      <div className="pi-profile-stats">
        <div className="pi-profile-stat">
          <div className="caption">{t('privateMarkets.preIpo.hero.lastValuation')}</div>
          <div className="pi-profile-stat-value mono">{fmtMoney(entry.currentValuation)}</div>
        </div>
        {multiple && (
          <div className="pi-profile-stat">
            <div className="caption" title={t('privateMarkets.preIpo.card.multipleTitle')}>
              {t('privateMarkets.preIpo.profile.privateReturn')}
            </div>
            <div className="pi-profile-stat-value mono">{multiple}</div>
          </div>
        )}
        {entry.totalRaised > 0 && (
          <div className="pi-profile-stat">
            <div className="caption">{t('privateMarkets.preIpo.hero.totalRaised')}</div>
            <div className="pi-profile-stat-value mono">{fmtMoney(entry.totalRaised)}</div>
          </div>
        )}
        {entry.lastRound && (
          <div className="pi-profile-stat">
            <div className="caption">{t('privateMarkets.preIpo.profile.lastRound')}</div>
            <div className="pi-profile-stat-value pi-profile-stat-round">{entry.lastRound}</div>
          </div>
        )}
        {tierLabel && (
          <div className="pi-profile-stat">
            <div className="caption">{t('privateMarkets.preIpo.profile.class')}</div>
            <div className="pi-profile-stat-value pi-profile-stat-round">{tierLabel}</div>
          </div>
        )}
      </div>

      {/* Live quote + chart (public/IPO'd companies only) */}
      {ticker && quote && (
        <div className="pi-profile-quote">
          <div className="pi-profile-quote-price mono">{fmtUsd(quote.price)}</div>
          <span className={`pi-profile-quote-chg mono${quoteUp ? ' pi-pos' : ' pi-neg'}`}>
            {quoteUp ? '+' : ''}{quote.change.toFixed(2)}%
          </span>
          <span className="pi-profile-quote-meta caption">
            {meta.ticker} · {quote.exchange || t('privateMarkets.preIpo.hero.nowTrading')}
          </span>
        </div>
      )}
      {ticker && (
        <section className="pm-profile-section">
          <PreIpoChart symbol={`NASDAQ:${ticker}`} label={meta.ticker} />
        </section>
      )}

      {/* Description */}
      {entry.description && (
        <section className="pm-profile-section">
          <div className="subheading pm-profile-section-title">{t('privateMarkets.profile.signal')}</div>
          <p className="body pm-profile-description">{entry.description}</p>
        </section>
      )}

      {/* Valuation history */}
      <section className="pm-profile-section">
        <div className="pm-profile-chart-header">
          <div className="subheading pm-profile-section-title">{t('privateMarkets.profile.chart.title')}</div>
          {chartHistory?.latestValuation && (
            <div className="pm-profile-chart-latest mono">
              {t('privateMarkets.profile.chart.latest')}{' '}
              <span className="pm-profile-chart-latest-val">{fmtMoney(chartHistory.latestValuation)}</span>
            </div>
          )}
        </div>
        <ValuationHistoryChart history={chartHistory} loading={historyLoading && !seedHistory} />
        {chartHistory?.rounds?.length > 1 && (
          <div className="pm-profile-rounds-list">
            {chartHistory.rounds.slice().reverse().slice(0, 6).map((r, i) => (
              <div key={`${r.date}-${i}`} className="pm-profile-round-row">
                <span className="caption pm-profile-round-date">
                  {new Date(r.date).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' })}
                </span>
                <span className="pm-profile-round-type">{r.roundType || '—'}</span>
                <span className="mono pm-profile-round-amt">{fmtMoney(r.amountUsd)}</span>
                <span className="mono pm-profile-round-val">{r.valuationUsd ? `@ ${fmtMoney(r.valuationUsd)}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Investors */}
      {entry.investors?.length > 0 && (
        <section className="pm-profile-section">
          <div className="subheading pm-profile-section-title">{t('privateMarkets.profile.investors')}</div>
          <div className="pm-profile-chips">
            {entry.investors.map((inv) => (
              <span key={inv} className="pm-profile-chip">{inv}</span>
            ))}
          </div>
        </section>
      )}

      {/* News coverage */}
      {(news.loading || news.list.length > 0) && (
        <section className="pm-profile-section pi-profile-news">
          <NewsPanel news={news} title={t('privateMarkets.preIpo.coverage.marketSummary')} />
        </section>
      )}

      {/* Linked tweets */}
      <section className="pm-profile-section">
        <div className="subheading pm-profile-section-title">{t('privateMarkets.preIpo.profile.onX')}</div>
        <div className="pi-profile-tweets">
          {tweets.loading && tweets.list.length === 0 && (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="pi-skel animate-shimmer" style={{ height: 88, borderRadius: 14 }} />
            ))
          )}
          {!tweets.loading && tweets.list.length === 0 && (
            <div className="pi-hero-feed-empty caption">{t('privateMarkets.preIpo.profile.noTweets')}</div>
          )}
          {tweets.list.map((tw) => (
            <TweetCard key={tw.id} tweet={tw} compact />
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="pm-profile-footer">
        <div className="pm-profile-source">{t('privateMarkets.preIpo.profile.spectreCurated')}</div>
        {handle && (
          <a
            href={`https://x.com/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary pm-profile-source-link"
          >
            @{handle}
            <ExternalLink />
          </a>
        )}
      </footer>
    </div>
  )
}
