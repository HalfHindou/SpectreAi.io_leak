/**
 * lite-insights.jsx - the Insights view of LITE (Intelligence reflection).
 *
 * The desk's own long-form: daily market briefs, RWA research, token and stock
 * analyses. Reads /api/intelligence/<type> per type (the undifferentiated list
 * is sorted by recency across every type, so the wire and calendar payloads
 * crowd the writing out of any sane page size - 2026-07-29 prod left LITE with
 * two JSON blobs). Every article ships a summary, tickers and a data snapshot
 * (the brief: BTC/ETH/SOL + Fear & Greed; an analysis: price, change, mcap) -
 * this view shows them instead of a bare title.
 *
 * 🪤 A daily brief's `headline` is its first section heading ("Market
 * Overview"), the same on every day. The brief's real name is in `title`.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { track, Events } from '@/services/analytics'
import { liteTimeAgo } from './use-lite-data'
import './lite-insights.css'

const changeCls = (v) => (Number(v) >= 0 ? 'up' : 'down')
const fmtChange = (v) => { const n = Number(v) || 0; return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

const INSIGHT_TYPES = ['daily', 'research', 'crypto', 'stocks']
const TYPE_LABEL = { daily: 'Daily brief', research: 'Research', crypto: 'Token analysis', stocks: 'Stock analysis' }
const TAB_LABEL = { daily: 'Daily briefs', research: 'Research', crypto: 'Token analyses', stocks: 'Stock analyses' }
let _cache = null

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)

const cleanTitle = (s) => String(s || '').replace(/\s*\|\s*Spectre.*$/i, '').trim()

// Summaries open with the article's first section heading ("Overview",
// "Company Overview", "Market Overview") on its own line - drop it, it is not
// a sentence.
function cleanSummary(s) {
  const lines = String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length > 1 && lines[0].split(/\s+/).length <= 4 && !/[.!?:]$/.test(lines[0])) lines.shift()
  const text = lines.join(' ').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim()
  // The API clips summaries mid-word ("...The toke"). End on the last full
  // sentence when one sits past the halfway mark; otherwise leave it clipped.
  if (/[.!?]$/.test(text)) return text
  const cut = Math.max(text.lastIndexOf('. '), text.lastIndexOf('! '), text.lastIndexOf('? '))
  return cut > text.length * 0.5 ? text.slice(0, cut + 1) : text
}

// Only real desk writing (80+ words) makes the LITE cut, and never a machine
// payload (`calendar` entries store JSON in `content`).
function toRows(articles, fallbackType) {
  return (Array.isArray(articles) ? articles : [])
    .map((a) => ({ ...a, type: a.type || fallbackType || 'analysis' }))
    .filter((a) => a.slug && a.title && a.type !== 'calendar' && (Number(a.wordCount) || 0) >= 80)
    .map((a) => ({
      slug: a.slug,
      type: a.type,
      title: cleanTitle(a.type === 'daily' ? a.title : (a.headline || a.title)),
      summary: cleanSummary(a.summary),
      publishedAt: a.publishedAt,
      words: Number(a.wordCount) || 0,
      sources: Number(a.sourceCount) || 0,
      tickers: Array.isArray(a.tickers) ? a.tickers.map((x) => String(x).toUpperCase()).slice(0, 4) : [],
      snap: a.dataSnapshot && typeof a.dataSnapshot === 'object' ? a.dataSnapshot : null,
    }))
}

const fetchJson = (url) => fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  .then((res) => (res.ok ? res.json() : null))

function Skel({ n = 6 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />)}
    </ul>
  )
}

function Logo({ sym, imgBySym }) {
  const src = imgBySym?.[sym]
  return src
    ? <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
    : <b>{(sym || '?')[0]}</b>
}

// The numbers the article was written against - a brief carries the majors,
// an analysis carries its own token.
function DataStrip({ row, fmtPrice, fmtLargeShort, imgBySym, t }) {
  const s = row.snap
  if (row.type === 'daily' && s) {
    const majors = [['BTC', s.btcPrice, s.btcChange], ['ETH', s.ethPrice, s.ethChange], ['SOL', s.solPrice, s.solChange]]
      .filter(([, p]) => Number(p) > 0)
    if (!majors.length && !s.fearGreed) return null
    return (
      <div className="lite-ins-strip">
        {majors.map(([sym, p, c]) => (
          <div key={sym} className="lite-ins-stat">
            <span className="lite-ins-stat-id"><Logo sym={sym} imgBySym={imgBySym} />{sym}</span>
            <strong>{fmtPrice(Number(p))}</strong>
            {Number.isFinite(Number(c)) && <em className={changeCls(c)}>{fmtChange(c)}</em>}
          </div>
        ))}
        {s.fearGreed && (
          <div className="lite-ins-stat">
            <span className="lite-ins-stat-id">{tl(t, 'Fear & Greed', 'lbl')}</span>
            <strong>{String(s.fearGreed).replace(/\s*\(.*\)$/, '')}</strong>
            <em className="flat">{(String(s.fearGreed).match(/\((.*)\)/) || [])[1] || ''}</em>
          </div>
        )}
      </div>
    )
  }
  if ((row.type === 'crypto' || row.type === 'stocks') && s && Number(s.price) > 0) {
    const sym = row.tickers[0]
    return (
      <div className="lite-ins-strip">
        <div className="lite-ins-stat">
          <span className="lite-ins-stat-id">{sym && <Logo sym={sym} imgBySym={imgBySym} />}{sym || tl(t, 'Price', 'lbl')}</span>
          <strong>{fmtPrice(Number(s.price))}</strong>
          {Number.isFinite(Number(s.change)) && <em className={changeCls(s.change)}>{fmtChange(s.change)}</em>}
        </div>
        {Number(s.marketCap) > 0 && (
          <div className="lite-ins-stat"><span className="lite-ins-stat-id">{tl(t, 'Market cap', 'lbl')}</span><strong>{fmtLargeShort(Number(s.marketCap))}</strong>{s.rank ? <em className="flat">#{s.rank}</em> : null}</div>
        )}
        {Number(s.volume) > 0 && (
          <div className="lite-ins-stat"><span className="lite-ins-stat-id">{tl(t, 'Volume', 'lbl')}</span><strong>{fmtLargeShort(Number(s.volume))}</strong><em className="flat">24h</em></div>
        )}
        {Number(s.pe) > 0 && (
          <div className="lite-ins-stat"><span className="lite-ins-stat-id">P/E</span><strong>{Number(s.pe).toFixed(1)}</strong></div>
        )}
      </div>
    )
  }
  return null
}

// A card's foot: tickers with logos, plus the one-line change when the
// snapshot names it.
function Tickers({ row, imgBySym }) {
  const s = row.snap
  if (row.type === 'daily' && s) {
    const majors = [['BTC', s.btcChange], ['ETH', s.ethChange], ['SOL', s.solChange]].filter(([, c]) => Number.isFinite(Number(c)))
    if (!majors.length) return null
    return (
      <span className="lite-ins-tickers">
        {majors.map(([sym, c]) => <em key={sym}><Logo sym={sym} imgBySym={imgBySym} />{sym}<i className={changeCls(c)}>{fmtChange(c)}</i></em>)}
      </span>
    )
  }
  if (!row.tickers.length) return null
  return (
    <span className="lite-ins-tickers">
      {row.tickers.map((sym, i) => (
        <em key={sym}>
          <Logo sym={sym} imgBySym={imgBySym} />{sym}
          {i === 0 && s && Number.isFinite(Number(s.change)) && <i className={changeCls(s.change)}>{fmtChange(s.change)}</i>}
        </em>
      ))}
    </span>
  )
}

const readMins = (words) => Math.max(1, Math.round(words / 200))

export default function InsightsView({ onOpenPath, market, fmtPrice, fmtLargeShort, imgBySym }) {
  const { t } = useTranslation()
  const [items, setItems] = useState(_cache)
  const [tab, setTab] = useState('all')

  useEffect(() => {
    if (_cache) return undefined
    let cancelled = false
    Promise.allSettled(INSIGHT_TYPES.map((type) => (
      fetchJson(`/api/intelligence/${type}?limit=12`).then((payload) => toRows(payload?.articles, type))
    )))
      .then(async (results) => {
        let rows = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        // Fallback: if the per-type reads come back empty (a type missing from
        // the deployed content bundle, or a cold serverless miss), fall back to
        // the undifferentiated list rather than showing an empty desk.
        if (!rows.length) {
          const payload = await fetchJson('/api/intelligence?limit=60').catch(() => null)
          rows = toRows(payload?.articles)
        }
        if (cancelled) return
        rows = rows.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
        // Never cache an empty result - a cold serverless miss shouldn't wipe
        // the view for the rest of the session. Still commit it so the empty
        // state renders instead of skeletons forever.
        if (rows.length) _cache = rows
        setItems(rows)
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [])

  // Stocks mode reads the stock analyses (and the brief, which covers both
  // tapes); crypto keeps everything else.
  const pool = useMemo(() => {
    if (!items) return null
    return items.filter((a) => (market === 'stocks' ? a.type === 'stocks' || a.type === 'daily' : a.type !== 'stocks'))
  }, [items, market])
  const typesPresent = useMemo(() => INSIGHT_TYPES.filter((ty) => pool?.some((a) => a.type === ty)), [pool])
  const shown = useMemo(() => (pool ? pool.filter((a) => tab === 'all' || a.type === tab) : null), [pool, tab])
  const hero = shown?.[0] || null
  const rest = shown?.slice(1, 25) || []
  const latest = pool?.[0]?.publishedAt

  const open = (a) => onOpenPath?.(`/intelligence/${a.type}/${a.slug}`)
  const openPro = () => { track(Events.LITE_PRO_DOOR, { path: '/intelligence' }); onOpenPath?.('/intelligence') }
  const meta = (a) => [
    a.publishedAt ? liteTimeAgo(Math.floor(new Date(a.publishedAt).getTime() / 1000), t) : null,
    a.words > 0 ? t('lite.msg.min_read', '{{n}} min read', { n: readMins(a.words) }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="lite-view lite-ins">
      <header className="lite-view-head lite-ins-head lite-rise">
        <div>
          <h1 className="lite-view-title">{tl(t, 'Insights', 'ttl')}</h1>
          <p className="lite-view-sub">{tl(t, 'Written by the Spectre desk - grounded analyses, not hot takes.', 'sub')}</p>
        </div>
        {pool && pool.length > 0 && (
          <div className="lite-ins-stats">
            <span className="lite-ins-chip"><b>{pool.length}</b>{tl(t, 'pieces', 'msg')}</span>
            {latest && <span className="lite-ins-chip"><b>{liteTimeAgo(Math.floor(new Date(latest).getTime() / 1000), t)}</b>{tl(t, 'last published', 'msg')}</span>}
          </div>
        )}
      </header>

      {typesPresent.length > 1 && (
        <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.insightsview.ariaType', "Type")}>
          <button type="button" role="tab" aria-selected={tab === 'all'} className={`lite-tf-btn${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>{tl(t, 'All', 'opt')}</button>
          {typesPresent.map((ty) => (
            <button key={ty} type="button" role="tab" aria-selected={tab === ty} className={`lite-tf-btn${tab === ty ? ' active' : ''}`} onClick={() => setTab(ty)}>{tl(t, TAB_LABEL[ty], 'opt')}</button>
          ))}
        </div>
      )}

      {!shown ? (
        <section className="lite-panel lite-rise-1"><Skel n={8} /></section>
      ) : shown.length === 0 ? (
        <section className="lite-panel lite-rise-1"><p className="lite-empty">{tl(t, "The desk hasn't published today yet.", 'msg')}</p></section>
      ) : (
        <>
          {hero && (
            <section className="lite-panel lite-ins-hero lite-rise-1">
              <button type="button" className="lite-ins-hero-btn" onClick={() => open(hero)}>
                <span className="lite-ins-kind lite-ins-kind--hero">{tl(t, TYPE_LABEL[hero.type] || hero.type, 'opt')}</span>
                <h2 className="lite-ins-hero-title">{hero.title}</h2>
                {hero.summary && <p className="lite-ins-hero-sum">{hero.summary}</p>}
                <span className="lite-ins-meta">
                  {meta(hero)}
                  {hero.sources > 0 ? ` · ${hero.sources} ${tl(t, hero.sources === 1 ? 'source' : 'sources', 'msg')}` : ''}
                </span>
              </button>
              <DataStrip row={hero} fmtPrice={fmtPrice} fmtLargeShort={fmtLargeShort} imgBySym={imgBySym} t={t} />
            </section>
          )}

          {rest.length > 0 && (
            <ul className="lite-ins-grid lite-rise-2">
              {rest.map((a) => (
                <li key={`${a.type}-${a.slug}`}>
                  <button type="button" className="lite-panel lite-ins-card" onClick={() => open(a)}>
                    <span className="lite-ins-kind">{tl(t, TYPE_LABEL[a.type] || a.type, 'opt')}</span>
                    <strong className="lite-ins-card-title">{a.title}</strong>
                    {a.summary && <span className="lite-ins-card-sum">{a.summary}</span>}
                    <span className="lite-ins-card-foot">
                      <Tickers row={a} imgBySym={imgBySym} />
                      <span className="lite-ins-meta">{meta(a)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={openPro}>
          {tl(t, 'Full intelligence hub in PRO', 'msg')}<ArrowIcon />
        </button>
      )}
    </div>
  )
}
