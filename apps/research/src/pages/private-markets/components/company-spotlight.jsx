/**
 * CompanySpotlight — the full page for one pre-IPO company.
 *
 * Serves two callers with one implementation: the Private Markets spotlight tab
 * (which passes the SPOTLIGHT company) and the `/private-markets/:companySlug`
 * route the roster cards link to. A second copy of a 400-line profile is how the
 * two drift, so there is one.
 *
 * The SpaceX hero next door is a LISTING treatment — ticker, exchange, a live
 * TradingView chart — because SpaceX trades. A private company has none of that.
 * What it does have is a priced round ladder, the investors who set those
 * prices, and the public record around them, so that is what this page is built
 * from. Every number comes from the roster entry or a live lane; nothing on this
 * page is asserted by the page itself.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import CompanyLogo from './company-logo'
import TweetCard from './tweet-card'
import NewsPanel from './news-panel'
import ValuationHistoryChart from './valuation-history-chart'
import PreIpoCompare from './preipo-compare'
import HowToBuy from './how-to-buy'
import {
  getValuationHistory, getCompanyNews, getOfficialTweets, searchTweets, getPredictions, getPreIPO,
} from './private-markets-api'
import { mergeTweets } from './use-preipo'
import { formatAmount, formatRelativeDate } from './private-markets-constants'
import { preipoMeta, formatMultiple, IPO_STATUS, TIER_LABEL, companyFromSlug } from './preipo-constants'
// This page renders the pi-* panel / logo / link primitives, so it owns their
// stylesheet too. The tab path never mounts pre-ipo-tab, which is what used to
// import them — the page rendered unstyled there and correctly on the route.
import './pre-ipo.css'
import './pre-ipo.day-mode.css'
import './company-spotlight.css'
import './company-spotlight.day-mode.css'

const ExternalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <path d="M15 3h6v6" /><path d="M10 14L21 3" />
  </svg>
)
const BackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** "22 days ago" for a rail whose freshness the reader has to be able to judge. */
function ageLabel(iso) {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return null
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return months <= 1 ? 'a month ago' : `${months} months ago`
}

export default function CompanySpotlight({ company, entry, eventTag, twitter, searchQueries, relevance, predictionQuery, showBack = false }) {
  const { t, i18n } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)

  const meta = preipoMeta(company) || {}
  const handle = twitter || meta.twitter || null

  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [news, setNews] = useState({ list: [], loading: true })
  const [tweets, setTweets] = useState({ list: [], loading: true, newest: null })
  const [markets, setMarkets] = useState({ list: [], loading: true })

  // The round ladder. This is the page's spine, so it loads on its own rather
  // than behind the rails.
  useEffect(() => {
    if (!company) return undefined
    let cancelled = false
    setHistoryLoading(true)
    getValuationHistory(company)
      .then((h) => { if (!cancelled) { setHistory(h); setHistoryLoading(false) } })
      .catch(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [company])

  useEffect(() => {
    if (!company) return undefined
    let cancelled = false
    setNews({ list: [], loading: true })
    getCompanyNews(company, null)
      .then((list) => { if (!cancelled) setNews({ list: Array.isArray(list) ? list.slice(0, 12) : [], loading: false }) })
      .catch(() => { if (!cancelled) setNews({ list: [], loading: false }) })
    return () => { cancelled = true }
  }, [company])

  // Official timeline + the broader search, merged and de-duplicated the same
  // way the hero rail does it.
  useEffect(() => {
    if (!company) return undefined
    let cancelled = false
    setTweets({ list: [], loading: true, newest: null })
    const queries = (searchQueries && searchQueries.length ? searchQueries : [company]).slice(0, 3)
    Promise.all([
      handle ? getOfficialTweets(handle, { limit: 14 }).catch(() => null) : Promise.resolve(null),
      ...queries.map((q) => searchTweets(q, { limit: 14 }).catch(() => [])),
    ])
      .then(([official, ...found]) => {
        if (cancelled) return
        const officialList = Array.isArray(official?.tweets) ? official.tweets : []
        // Normalized tweets carry `.text` and `.date`; mergeTweets wants ONE flat
        // list, not a list of lists — nesting them silently drops everything.
        const searched = found.flat().filter((x) => !relevance || relevance.test(x?.text || ''))
        const merged = mergeTweets([...officialList, ...searched]).slice(0, 8)
        const stamps = merged.map((x) => x?.date).filter(Boolean)
        setTweets({ list: merged, loading: false, newest: stamps.length ? stamps.sort().at(-1) : null })
      })
      .catch(() => { if (!cancelled) setTweets({ list: [], loading: false, newest: null }) })
    return () => { cancelled = true }
  }, [company, handle, searchQueries, relevance])

  // Prediction markets, if any carry real volume. An untraded market is not a
  // signal and must not be rendered as one.
  useEffect(() => {
    const q = predictionQuery || company
    if (!q) return undefined
    let cancelled = false
    setMarkets({ list: [], loading: true })
    getPredictions(q)
      .then((res) => {
        if (cancelled) return
        const all = [...(res?.polymarket || []), ...(res?.kalshi || [])]
        setMarkets({ list: all.filter((m) => Number(m?.volume) > 0), loading: false })
      })
      .catch(() => { if (!cancelled) setMarkets({ list: [], loading: false }) })
    return () => { cancelled = true }
  }, [company, predictionQuery])

  const rounds = useMemo(() => {
    const list = Array.isArray(history?.rounds) ? history.rounds : []
    return [...list].sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0))
  }, [history])

  const investors = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const name of entry?.investors || []) {
      const key = String(name).trim()
      if (!key || seen.has(key.toLowerCase())) continue
      seen.add(key.toLowerCase())
      out.push(key)
    }
    return out
  }, [entry])

  if (!entry) {
    return (
      <div className="cs-page">
        <div className="cs-missing glass-card">
          <h2>{company ? t('privateMarkets.spotlight.missingTitleNamed', { company }) : t('privateMarkets.spotlight.missingTitle', 'Company not found')}</h2>
          <p className="caption">{t('privateMarkets.spotlight.missingBody')}</p>
          <Link to="/private-markets" className="cs-link">{t('privateMarkets.spotlight.backLink', '← Private Markets')}</Link>
        </div>
      </div>
    )
  }

  const statusLabel = IPO_STATUS[meta.status] || IPO_STATUS.private
  const multiple = formatMultiple(entry.valuationMultiple)
  const tweetAge = ageLabel(tweets.newest)

  // A panel earns its column by having something in it — or by still loading,
  // so the layout does not jump once the lane answers.
  const showTweets = tweets.loading || tweets.list.length > 0
  const showMarkets = markets.loading || markets.list.length > 0

  return (
    <div className="cs-page">
      {showBack && (
        <nav className="cs-crumb">
          <Link to="/private-markets" className="cs-crumb-back">
            <BackIcon /><span>{t('privateMarkets.spotlight.crumbBack', 'Private Markets')}</span>
          </Link>
          <span className="cs-crumb-sep" aria-hidden="true">/</span>
          <span className="cs-crumb-here">{entry.company}</span>
        </nav>
      )}

      {/* ── identity ───────────────────────────────────────────────────── */}
      <header className="cs-head glass-card">
        <div className="cs-head-main">
          <span className="cs-eventtag">
            <span className="cs-dot" aria-hidden="true" />
            {eventTag || t('privateMarkets.spotlight.ipoWatch', 'IPO WATCH')}
            <span className="cs-eventtag-sep" aria-hidden="true">·</span>
            {statusLabel}
          </span>

          <div className="cs-brand">
            <CompanyLogo company={entry.company} logoUrl={entry.logoUrl} domain={entry.domain} className="pi-logo-hero" />
            <div>
              <h1 className="cs-name">{entry.company}</h1>
              <p className="cs-meta">
                {[entry.sector, meta.hq, meta.founded ? t('privateMarkets.spotlight.founded', { year: meta.founded }) : null, TIER_LABEL[entry.tier] || entry.tier]
                  .filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          {entry.description && <p className="cs-blurb">{meta.blurb || entry.description}</p>}

          {/* The headline row: what it is worth, what that cost, and how far it
              has travelled — the three numbers a private company actually has. */}
          <dl className="cs-stats">
            <div>
              <dt>{t('privateMarkets.spotlight.lastValuation', 'Last private valuation')}</dt>
              <dd className="mono">{fmtMoney(entry.currentValuation)}</dd>
              <span className="cs-stat-note">{entry.lastRound}{entry.lastRoundDate ? ` · ${formatRelativeDate(entry.lastRoundDate, t, i18n.language)}` : ''}</span>
            </div>
            <div>
              <dt>{t('privateMarkets.spotlight.totalRaised', 'Total raised')}</dt>
              <dd className="mono">{fmtMoney(entry.totalRaised)}</dd>
              <span className="cs-stat-note">{t('privateMarkets.spotlight.pricedRounds', { count: entry.roundCount })}</span>
            </div>
            <div>
              <dt>{t('privateMarkets.spotlight.sinceFirstRound', 'Since first round')}</dt>
              <dd className="mono">{multiple || '—'}</dd>
              <span className="cs-stat-note">{t('privateMarkets.spotlight.fromValuation', { value: fmtMoney(entry.firstValuation) })}</span>
            </div>
            <div>
              <dt>{t('privateMarkets.spotlight.lastRoundSize', 'Last round size')}</dt>
              <dd className="mono">{fmtMoney(entry.lastRoundAmount)}</dd>
              <span className="cs-stat-note">{entry.leadInvestor ? t('privateMarkets.spotlight.ledBy', { investor: entry.leadInvestor }) : t('privateMarkets.spotlight.leadUndisclosed', 'lead undisclosed')}</span>
            </div>
          </dl>

          <div className="cs-links">
            {entry.domain && (
              <a className="cs-link" href={`https://${entry.domain}`} target="_blank" rel="noopener noreferrer">
                {entry.domain} <ExternalIcon />
              </a>
            )}
            {handle && (
              <a className="cs-link" href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">
                @{handle} <ExternalIcon />
              </a>
            )}
            {meta.timing && <span className="cs-timing">{meta.timing}</span>}
          </div>
        </div>
      </header>

      {/* ── the ladder ─────────────────────────────────────────────────── */}
      <section className="cs-section glass-card">
        <div className="cs-section-head">
          <div>
            <span className="cs-section-eyebrow">{t('privateMarkets.spotlight.ladderEyebrow', 'The ladder')}</span>
            <h2>{t('privateMarkets.spotlight.ladderTitle', 'What each round priced it at')}</h2>
          </div>
          <span className="cs-section-note">{t('privateMarkets.spotlight.ladderNote')}</span>
        </div>
        <ValuationHistoryChart history={history} loading={historyLoading} />

        {rounds.length > 0 && (
          <div className="cs-rounds-wrap">
            <table className="cs-rounds">
              <thead>
                <tr>
                  <th>{t('privateMarkets.spotlight.colDate', 'Date')}</th><th>{t('privateMarkets.spotlight.colRound', 'Round')}</th><th className="cs-num">{t('privateMarkets.spotlight.colRaised', 'Raised')}</th>
                  <th className="cs-num">{t('privateMarkets.spotlight.colValuation', 'Valuation')}</th><th>{t('privateMarkets.spotlight.colLead', 'Lead')}</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={`${r.date}-${r.roundType}`}>
                    <td className="mono cs-dim">{r.date ? new Date(r.date).toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' }) : '—'}</td>
                    <td>{r.roundType || '—'}</td>
                    <td className="mono cs-num">{r.amountUsd ? fmtMoney(r.amountUsd) : '—'}</td>
                    <td className="mono cs-num cs-strong">{r.valuationUsd ? fmtMoney(r.valuationUsd) : '—'}</td>
                    <td className="cs-dim">{r.leadInvestor || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── investors ──────────────────────────────────────────────────── */}
      {investors.length > 0 && (
        <section className="cs-section glass-card">
          <div className="cs-section-head">
            <div>
              <span className="cs-section-eyebrow">{t('privateMarkets.spotlight.capTableEyebrow', 'The cap table')}</span>
              <h2>{t('privateMarkets.spotlight.capTableTitle', 'Who set those prices')}</h2>
            </div>
            <span className="cs-section-note">{t('privateMarkets.spotlight.disclosed', { count: investors.length })}</span>
          </div>
          <ul className="cs-investors">
            {investors.map((name) => (
              <li key={name} className={name === entry.leadInvestor ? 'is-lead' : undefined}>
                {name}
                {name === entry.leadInvestor && <span className="cs-lead-tag">{t('privateMarkets.spotlight.lastLead', 'last lead')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── the public record ───────────────────────────────────────────
          The rails COLLAPSE to what actually has something in them. This was a
          fixed three-column grid, so a company with no linked posts and no
          traded listing market rendered two empty boxes and a field of
          wallpaper next to one real column — the page read as broken rather
          than as quiet. A panel still renders while it is loading, and still
          renders its honest empty state once it has been asked for and answered
          for a company where the absence is itself information. */}
      <div className={`cs-rails cs-rails--${1 + (showTweets ? 1 : 0) + (showMarkets ? 1 : 0)}`}>
        <NewsPanel news={news} title={t('privateMarkets.spotlight.coverage', 'Coverage')} />

        {showTweets && <div className="pi-panel glass-card">
          <div className="pi-panel-head">
            <span className="pi-panel-title">{t('privateMarkets.spotlight.onX', 'On X')}</span>
            <span className="pi-panel-tag">{handle ? `@${handle}` : t('privateMarkets.spotlight.searchTag', 'Search')}</span>
          </div>
          <div className="pi-panel-body">
            {tweets.loading && tweets.list.length === 0 &&
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="pi-skel animate-shimmer" style={{ height: 88, borderRadius: 12 }} />
              ))}
            {!tweets.loading && tweets.list.length === 0 && (
              <div className="pi-panel-empty caption">{t('privateMarkets.spotlight.noPosts', 'No linked posts in this window.')}</div>
            )}
            {tweets.list.map((tw) => <TweetCard key={tw.id} tweet={tw} compact />)}
            {/* The X lane serves from an archive; a rail that is three weeks old
                must say so rather than sit under a live-looking header. */}
            {!tweets.loading && tweetAge && (
              <p className="cs-rail-age caption">{t('privateMarkets.spotlight.newestPost', { age: tweetAge })}</p>
            )}
          </div>
        </div>}

        {showMarkets && <div className="pi-panel glass-card">
          <div className="pi-panel-head">
            <span className="pi-panel-title">{t('privateMarkets.spotlight.listingOdds', 'Listing odds')}</span>
            <span className="pi-panel-tag">{t('privateMarkets.predictionPanel.tag', 'Predictions')}</span>
          </div>
          <div className="pi-panel-body">
            {markets.loading && (
              <div className="pi-skel animate-shimmer" style={{ height: 64, borderRadius: 10 }} />
            )}
            {!markets.loading && markets.list.length === 0 && (
              <p className="pi-panel-empty caption">
                {t('privateMarkets.spotlight.noMarket', { company: entry.company })}
              </p>
            )}
            {markets.list.map((m) => (
              <a key={m.id} className="cs-market" href={m.url} target="_blank" rel="noopener noreferrer">
                <span className="cs-market-q">{m.question}</span>
                <span className="cs-market-outcomes">
                  {(m.outcomes || []).slice(0, 3).map((o) => (
                    <span key={o.label} className="cs-market-o">
                      {/* `prob` is already a percentage in the normalized market
                          shape (see private-markets-api.js + prediction-panel.jsx);
                          multiplying it again printed "10000%". */}
                      <b className="mono">{Math.round(o.prob || 0)}%</b> {o.label}
                    </span>
                  ))}
                </span>
              </a>
            ))}
          </div>
        </div>}
      </div>

      {/* The ladder above answers "what did each round price it at". This answers
          the question people ask straight after: "compared to what?" */}
      <PreIpoCompare seed={[company]} embedded />

      {/* Understand it, compare it, then act on it. A page that shows a $183B
          valuation and no way in is a museum exhibit. */}
      <HowToBuy company={company} entry={entry} status={meta?.status} />

      <p className="cs-provenance caption">
        {t('privateMarkets.spotlight.footnote')}
      </p>
    </div>
  )
}


/**
 * Resolve a roster entry by company name or URL slug, then render the page.
 *
 * Both callers need the same lookup — the tab knows the name, the route knows
 * the slug — so it lives here once. The roster fetch is the same deduped call
 * the Pre-IPO tab makes, so opening the spotlight from the roster costs nothing.
 */
export function CompanySpotlightByName({ company, slug, ...rest }) {
  const [roster, setRoster] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPreIPO()
      .then((res) => { if (!cancelled) setRoster(res?.roster || []) })
      .catch(() => { if (!cancelled) setRoster([]) })
    return () => { cancelled = true }
  }, [])

  const name = useMemo(() => {
    if (company) return company
    if (!slug) return null
    // Before the roster lands, the editorial map can still name the company, so
    // the header paints immediately instead of flashing a not-found state.
    return companyFromSlug(slug, roster || [])
  }, [company, slug, roster])

  const entry = useMemo(
    () => (roster || []).find((r) => r.company === name) || null,
    [roster, name],
  )

  // Still loading: hold the shape rather than assert "not found".
  if (roster === null) {
    return (
      <div className="cs-page">
        <div className="cs-head glass-card pi-skel animate-shimmer" style={{ height: 320 }} />
        <div className="cs-section glass-card pi-skel animate-shimmer" style={{ height: 280 }} />
      </div>
    )
  }

  return <CompanySpotlight company={name} entry={entry} {...rest} />
}
