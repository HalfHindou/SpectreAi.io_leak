/**
 * EarningsTabPanel — Command Center "Earnings" tab (stocks mode only).
 *
 * Upcoming earnings for the curated index-moving mega-caps (NVDA, AAPL, MSFT,
 * AMZN, GOOGL, AVGO, META, TSLA, MU, AMD, INTC, SPCX), soonest-first, with a
 * live day-countdown + Street EPS/revenue estimates. Lazy-mounted, so the data
 * hook only runs when this tab is open (visibility-gated per api-patterns.md L).
 * Rows open the stock's Research Zone. Same Yahoo calendarEvents source as the
 * per-stock page, so nothing here disagrees with a stock's own earnings banner.
 *
 * Every field rendered here is real and sourced:
 *   symbol / name / earningsDate / epsEstimate / revenueEstimate
 *     → GET /api/stocks/earnings (Yahoo quoteSummary calendarEvents)
 *   price / change%                → GET /api/stocks/quotes  (Yahoo quote)
 *   ticker lookup suggestions      → GET /api/stocks/search   (Yahoo search)
 *   lookup earnings date+estimates → GET /api/stocks/earnings?symbols=SYM
 * Session (Before open / After close) is DERIVED from the scheduled timestamp's
 * New York hour — not invented. Nothing on this panel is estimated client-side:
 * a missing field renders as absent, never as a placeholder number.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  getUpcomingEarnings, getStockQuotes, searchStocks,
  getStockLogoUrl, getStockLogoFallback,
} from '@/services/stockApi'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { daysUntil } from '@/lib/earnings-countdown'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { spectreIcons } from '@/icons/spectreIcons'
import ChartWatermark from '@/components/chart-watermark'
import './cc-earnings-panel.css'

function fmtBigUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return null
  const v = Number(n); const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(0)}`
}

function fmtEps(n) {
  if (n == null || !Number.isFinite(Number(n))) return null
  return Number(n).toFixed(2)
}

function fmtPx(n) {
  if (n == null || !Number.isFinite(Number(n))) return null
  const v = Number(n)
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Session label derived from the scheduled print time in New York.
 * Yahoo's calendarEvents timestamp is a real wall-clock time (mega-caps almost
 * always land on 16:00 ET = after close, 08:30 ET = before open). Anything that
 * falls inside the session gets no label rather than a guess.
 */
function sessionOf(ms) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(ms))
    const h = Number(parts.find((p) => p.type === 'hour')?.value)
    const m = Number(parts.find((p) => p.type === 'minute')?.value)
    if (!Number.isFinite(h)) return null
    const mins = h * 60 + (Number.isFinite(m) ? m : 0)
    if (mins <= 9 * 60 + 30) return 'bmo'
    if (mins >= 16 * 60) return 'amc'
    return null
  } catch { return null }
}

/** Monday-anchored week offset from the current week (0 = this week, 1 = next). */
function weekOffset(ms) {
  const startOfWeek = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
    return x.getTime()
  }
  return Math.round((startOfWeek(new Date(ms)) - startOfWeek(new Date())) / (7 * 86_400_000))
}

function bucketOf(days, ms) {
  if (days < 0) return 'reported'
  const w = weekOffset(ms)
  if (w <= 0) return 'week'
  if (w === 1) return 'next'
  return 'later'
}

function EarnLogo({ sym }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="cce-logo"><span className="cce-logo-fallback">{sym[0]}</span></span>
  return (
    <span className="cce-logo">
      <img src={getStockLogoUrl(sym)} alt="" loading="lazy"
        onError={(e) => { const fb = getStockLogoFallback(sym); if (fb && e.currentTarget.src !== fb) e.currentTarget.src = fb; else setFailed(true) }} />
    </span>
  )
}

/** Live last price + day change for a symbol, when the quote batch carries it. */
function QuoteLine({ q }) {
  if (!q) return null
  const px = fmtPx(q.price)
  if (!px) return null
  const chg = Number.isFinite(Number(q.change)) ? Number(q.change) : null
  return (
    <span className="cce-quote">
      <b className="mono">{px}</b>
      {chg != null && (
        <em className={`mono cce-chg cce-chg--${chg >= 0 ? 'up' : 'down'}`}>
          {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
        </em>
      )}
    </span>
  )
}

export default function EarningsTabPanel({ t }) {
  const { t: tr } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [quotes, setQuotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  // Ticker lookup ("when does X report?") — reuses the app's stock search service.
  const [query, setQuery] = useState('')
  const [suggests, setSuggests] = useState([])
  const [sugOpen, setSugOpen] = useState(false)
  const [lookup, setLookup] = useState(null)
  const searchRef = useRef(null)

  const load = useCallback(() => {
    getUpcomingEarnings()
      .then((r) => {
        const list = Array.isArray(r) ? r : []
        setRows(list)
        const syms = list.map((e) => e.symbol).filter(Boolean)
        if (syms.length) {
          getStockQuotes(syms)
            .then((q) => setQuotes(q && typeof q === 'object' ? q : {}))
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  // Earnings dates barely move; a slow revalidate keeps it live without churn.
  useAdaptivePolling(load, { interval: 30 * 60_000 })

  // Debounced ticker suggestions.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) { setSuggests([]); return }
    let cancelled = false
    const id = setTimeout(() => {
      searchStocks(q)
        .then((list) => {
          if (cancelled) return
          setSuggests((Array.isArray(list) ? list : []).filter((s) => s?.symbol && s.type === 'EQUITY').slice(0, 6))
        })
        .catch(() => { if (!cancelled) setSuggests([]) })
    }, 250)
    return () => { cancelled = true; clearTimeout(id) }
  }, [query])

  // Close the suggestion list on an outside pointer.
  useEffect(() => {
    if (!sugOpen) return undefined
    const onDown = (e) => { if (!searchRef.current?.contains(e.target)) setSugOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [sugOpen])

  const pickSymbol = useCallback((s) => {
    if (!s?.symbol) return
    setSugOpen(false)
    setQuery('')
    setSuggests([])
    setLookup({ symbol: s.symbol, name: s.name || s.symbol, exchange: s.exchange || null, price: s.price ?? null, change: s.change ?? null, loading: true, earnings: null })
    getUpcomingEarnings([s.symbol])
      .then((list) => {
        const hit = (Array.isArray(list) ? list : []).find((r) => String(r.symbol).toUpperCase() === s.symbol.toUpperCase()) || null
        setLookup((prev) => (prev && prev.symbol === s.symbol ? { ...prev, loading: false, earnings: hit } : prev))
      })
      .catch(() => setLookup((prev) => (prev && prev.symbol === s.symbol ? { ...prev, loading: false, earnings: null } : prev)))
  }, [])

  const open = useCallback((sym, name) => {
    const loc = buildResearchZoneLocation({ symbol: sym, name }, true)
    navigate(loc.pathname + (loc.search || ''))
  }, [navigate])

  const tt = useCallback((key, fallback) => (typeof t === 'function' ? t(key, fallback) : fallback), [t])

  const model = useMemo(() => {
    const parsed = rows.map((e) => {
      const ms = new Date(e.earningsDate).getTime()
      if (!Number.isFinite(ms)) return null
      const days = daysUntil(e.earningsDate)
      if (days == null) return null
      return { ...e, ms, days, bucket: bucketOf(days, ms) }
    }).filter(Boolean)

    const upcoming = parsed.filter((p) => p.days >= 0).sort((a, b) => a.ms - b.ms)
    const reported = parsed.filter((p) => p.days < 0).sort((a, b) => b.ms - a.ms)
    const hero = upcoming[0] || null
    const rest = [...upcoming.slice(hero ? 1 : 0), ...reported]

    const counts = rest.reduce((acc, r) => { acc[r.bucket] = (acc[r.bucket] || 0) + 1; return acc }, {})
    return { total: parsed.length, hero, rest, counts }
  }, [rows])

  const pills = useMemo(() => ([
    { id: 'all', label: tt('commandCenter.earnAll', 'All'), n: model.rest.length },
    { id: 'week', label: tt('commandCenter.earnThisWeek', 'This week'), n: model.counts.week || 0 },
    { id: 'next', label: tt('commandCenter.earnNextWeek', 'Next week'), n: model.counts.next || 0 },
    { id: 'later', label: tt('commandCenter.earnLater', 'Later'), n: model.counts.later || 0 },
    { id: 'reported', label: tt('commandCenter.earnReported', 'Reported'), n: model.counts.reported || 0 },
  ].filter((p) => p.id === 'all' || p.n > 0)), [model, tt])

  // A filter whose bucket emptied out (dates roll forward) falls back to All.
  useEffect(() => {
    if (filter !== 'all' && !pills.some((p) => p.id === filter)) setFilter('all')
  }, [pills, filter])

  const visible = filter === 'all' ? model.rest : model.rest.filter((r) => r.bucket === filter)

  const dateStr = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const sessLabel = (ms) => {
    const s = sessionOf(ms)
    if (s === 'bmo') return tt('commandCenter.beforeOpen', 'Before open')
    if (s === 'amc') return tt('commandCenter.afterClose', 'After close')
    return null
  }
  const countLabel = (days) => {
    if (days < 0) return tt('commandCenter.reported', 'Reported')
    if (days === 0) return tt('commandCenter.today', 'Today')
    if (days === 1) return tt('commandCenter.tomorrow', 'Tomorrow')
    return `${days} ${tt('commandCenter.daysLeft', 'days')}`
  }

  if (loading && rows.length === 0) {
    return (
      <div className="cce-panel">
        <div className="cce-head">
          <div className="cce-skel cce-skel--lead animate-shimmer" />
          <div className="cce-skel cce-skel--search animate-shimmer" />
        </div>
        <div className="cce-skel cce-skel--hero animate-shimmer" />
        <div className="cce-skel cce-skel--rail animate-shimmer" />
        <div className="cce-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="cce-card cce-card--skel animate-shimmer" />)}
        </div>
      </div>
    )
  }

  const searchBox = (
    <div className={`cce-search${sugOpen && suggests.length ? ' cce-search--open' : ''}`} ref={searchRef}>
      <span className="cce-search-icon" aria-hidden="true">{spectreIcons.search}</span>
      <input
        className="cce-search-input"
        type="text"
        value={query}
        placeholder={tt('commandCenter.earnLookup', 'Any ticker — when does it report?')}
        aria-label={tt('commandCenter.earnLookup', 'Any ticker — when does it report?')}
        onChange={(e) => { setQuery(e.target.value); setSugOpen(true) }}
        onFocus={() => setSugOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggests[0]) { e.preventDefault(); pickSymbol(suggests[0]) }
          if (e.key === 'Escape') { setSugOpen(false); setQuery('') }
        }}
      />
      {sugOpen && suggests.length > 0 && (
        <div className="cce-sug" role="listbox">
          {suggests.map((s) => (
            <button key={s.symbol} type="button" className="cce-sug-item" role="option" aria-selected="false" onClick={() => pickSymbol(s)}>
              <em>{s.symbol}</em>
              <span>{s.name}</span>
              {s.exchange && <i>{s.exchange}</i>}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (rows.length === 0) {
    return (
      <div className="cce-panel">
        <div className="cce-head">
          <p className="cce-lead">{tt('commandCenter.earningsLead', 'Upcoming earnings for the index-moving mega-caps — the prints that swing the tape.')}</p>
          {searchBox}
        </div>
        {lookup && renderLookup()}
        <div className="cce-empty">{tt('commandCenter.earningsEmpty', 'No upcoming earnings for the tracked names.')}</div>
        <ChartWatermark className="cce-wm" padX={4} padY={6} />
      </div>
    )
  }

  function renderLookup() {
    const e = lookup.earnings
    const ms = e?.earningsDate ? new Date(e.earningsDate).getTime() : null
    const days = e?.earningsDate ? daysUntil(e.earningsDate) : null
    const eps = fmtEps(e?.epsEstimate)
    const rev = fmtBigUsd(e?.revenueEstimate)
    const sess = ms ? sessLabel(ms) : null
    return (
      <div className="cce-lookup">
        <button type="button" className="cce-lookup-main" onClick={() => open(lookup.symbol, lookup.name)}>
          <EarnLogo sym={lookup.symbol} />
          <span className="cce-lookup-id">
            <strong>{lookup.symbol}</strong>
            <em>{lookup.name}</em>
          </span>
          <span className="cce-lookup-body">
            {lookup.loading && <span className="cce-lookup-wait animate-shimmer" />}
            {!lookup.loading && ms != null && (
              <>
                <span className="cce-lookup-date">
                  <b>{dateStr(ms)}</b>
                  {sess && <i>{sess}</i>}
                </span>
                <span className="cce-lookup-count mono">{countLabel(days)}</span>
                {(eps || rev) && (
                  <span className="cce-lookup-ests">
                    {eps && <span className="cce-est"><i>{tr('homePage.ccEarningsPanel.earningstabpanel.epsEst', "EPS est")}</i> <b className="mono">{eps}</b></span>}
                    {rev && <span className="cce-est"><i>{tr('homePage.ccEarningsPanel.earningstabpanel.revEst', "Rev est")}</i> <b className="mono">{rev}</b></span>}
                  </span>
                )}
              </>
            )}
            {!lookup.loading && ms == null && (
              <span className="cce-lookup-none">{tt('commandCenter.earnNoDate', 'No earnings date published for this ticker yet.')}</span>
            )}
          </span>
          <QuoteLine q={{ price: lookup.price, change: lookup.change }} />
        </button>
        <button type="button" className="cce-lookup-clear" onClick={() => setLookup(null)} aria-label={tt('commandCenter.clear', 'Clear')}>×</button>
      </div>
    )
  }

  const hero = model.hero

  return (
    <div className="cce-panel">
      <div className="cce-head">
        <p className="cce-lead">{tt('commandCenter.earningsLead', 'Upcoming earnings for the index-moving mega-caps — the prints that swing the tape.')}</p>
        {searchBox}
      </div>

      {lookup && renderLookup()}

      {hero && (
        <button type="button" className="cce-hero" onClick={() => open(hero.symbol, hero.name)}>
          <span className="cce-hero-tag">{tt('commandCenter.earnNextUp', 'Next up')}</span>
          <span className="cce-hero-count">
            <b className="mono">{hero.days === 0 ? tt('commandCenter.today', 'Today') : hero.days === 1 ? tt('commandCenter.tomorrow', 'Tomorrow') : hero.days}</b>
            {hero.days > 1 && <i>{tt('commandCenter.daysLeft', 'days')}</i>}
          </span>
          <span className="cce-hero-id">
            <EarnLogo sym={hero.symbol} />
            <span>
              <strong>{hero.symbol}</strong>
              <em>{hero.name || hero.symbol}</em>
            </span>
          </span>
          <span className="cce-hero-when">
            <b>{dateStr(hero.ms)}</b>
            {sessLabel(hero.ms) && <i>{sessLabel(hero.ms)}</i>}
          </span>
          <span className="cce-hero-ests">
            {fmtEps(hero.epsEstimate) && <span className="cce-est"><i>{tr('homePage.ccEarningsPanel.earningstabpanel.epsEst', "EPS est")}</i> <b className="mono">{fmtEps(hero.epsEstimate)}</b></span>}
            {fmtBigUsd(hero.revenueEstimate) && <span className="cce-est"><i>{tr('homePage.ccEarningsPanel.earningstabpanel.revEst', "Rev est")}</i> <b className="mono">{fmtBigUsd(hero.revenueEstimate)}</b></span>}
          </span>
          <QuoteLine q={quotes[hero.symbol]} />
        </button>
      )}

      {pills.length > 1 && (
        <div className="cce-rail" role="tablist" aria-label={tt('commandCenter.earnFilter', 'Filter earnings by window')}>
          {pills.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={filter === p.id}
              className={`cce-pill${filter === p.id ? ' cce-pill--on' : ''}`}
              onClick={() => setFilter(p.id)}
            >
              {p.label}<span className="mono">{p.n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="cce-grid">
        {visible.map((e) => {
          const eps = fmtEps(e.epsEstimate)
          const rev = fmtBigUsd(e.revenueEstimate)
          const sess = sessLabel(e.ms)
          return (
            <button key={e.symbol} type="button" className={`cce-card cce-card--${e.bucket}`} onClick={() => open(e.symbol, e.name)}>
              <span className="cce-card-head">
                <EarnLogo sym={e.symbol} />
                <span className="cce-id">
                  <strong>{e.symbol}</strong>
                  <em>{e.name || e.symbol}</em>
                </span>
                <span className="cce-count">
                  <b className="mono">{e.days >= 0 ? e.days : '—'}</b>
                  {e.days >= 0 && <i>{e.days === 1 ? tt('commandCenter.dayLeft', 'day') : tt('commandCenter.daysLeft', 'days')}</i>}
                </span>
              </span>
              <span className="cce-when">
                <b>{dateStr(e.ms)}</b>
                {sess && <i>{sess}</i>}
                {e.days < 0 && <i className="cce-when-past">{tt('commandCenter.reported', 'Reported')}</i>}
              </span>
              {(eps || rev) && (
                <span className="cce-ests">
                  {eps && <span className="cce-est"><i>{tr('homePage.ccEarningsPanel.earningstabpanel.epsEst', "EPS est")}</i> <b className="mono">{eps}</b></span>}
                  {rev && <span className="cce-est"><i>{tr('homePage.ccEarningsPanel.earningstabpanel.revEst', "Rev est")}</i> <b className="mono">{rev}</b></span>}
                </span>
              )}
              <QuoteLine q={quotes[e.symbol]} />
            </button>
          )
        })}
      </div>

      <p className="cce-foot">
        {tt('commandCenter.earnSource', 'Street consensus (EPS / revenue) and scheduled dates from Yahoo calendarEvents')}
        <span> · {model.total} {tt('commandCenter.earnNames', 'names tracked')}</span>
      </p>

      {/* Shared screenshots of this tab land in Telegram/X uncredited. Same
          primitive the charts carry: faint centred logotype + corner lockup,
          pointer-events: none so cards keep their hover/click. */}
      <ChartWatermark className="cce-wm" padX={4} padY={6} />
    </div>
  )
}
