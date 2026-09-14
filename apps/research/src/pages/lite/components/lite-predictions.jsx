/**
 * lite-predictions.jsx - the Predictions view of LITE (prediction-markets reflection).
 *
 * One Polymarket read (getPredictionEventCards: every event with its
 * sub-markets), then everything else is client-side: category chips, a lead
 * card (the event with the most money moving today), event cards with up to
 * four outcomes as bars, and a rail of what is hot in the last 24h and what
 * resolves within 30 days. The old view listed eight flat sub-markets, five of
 * them the same nomination race.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { track, Events } from '@/services/analytics'
import './lite-predictions.css'

const CATS = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'politics', label: 'Politics' },
  { id: 'economy', label: 'Economy' },
  { id: 'sports', label: 'Sports' },
  { id: 'culture', label: 'Culture' },
  { id: 'science', label: 'Science' },
]
const TTL = 10 * 60 * 1000
const SOON_DAYS = 30
let _cache = null

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)
const OutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17L17 7M9 7h8v8" /></svg>
)

function Skel({ n = 6 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />)}
    </ul>
  )
}

function rawEnd(ev) {
  const raw = ev.outcomes?.find((o) => o.endDate)?.endDate
  const t = raw ? new Date(raw).getTime() : NaN
  return Number.isFinite(t) ? t : null
}

function daysLeft(ts) {
  if (!ts) return null
  return Math.ceil((ts - Date.now()) / 86_400_000)
}

// "Will JD Vance win the 2028 US Presidential Election?" -> "JD Vance". A
// yes/no market with one outcome is just "Yes".
const VERB_RX = /\s+(win|wins|be|become|get|gets|capture|agree|reach|hit|close|announce|launch|resign|leave|remain|stay|lose|sign|pass|drop|rise|fall|exceed|top|beat|out\b|pardon|invade|normalize|declare)\b.*$/i
function shortLabel(o, count) {
  if (count <= 1) return 'Yes'
  let l = String(o.label || o.question || '').trim()
  if (!l) return 'Yes'
  l = l.replace(/^will\s+/i, '').replace(VERB_RX, '').replace(/\?+$/, '').trim()
  return l.length > 34 ? `${l.slice(0, 32).trim()}…` : l || 'Yes'
}

function Art({ ev }) {
  const [ok, setOk] = useState(Boolean(ev.icon || ev.image))
  useEffect(() => { setOk(Boolean(ev.icon || ev.image)) }, [ev.icon, ev.image])
  return (
    <span className="lite-pm-art">
      {ok ? <img src={ev.icon || ev.image} alt="" loading="lazy" onError={() => setOk(false)} /> : <b>{(ev.title || '?')[0]}</b>}
    </span>
  )
}

// Outcomes as bars. A single yes/no market shows one bar with "yes"; a
// multi-outcome race shows each candidate.
function Outcomes({ ev, max = 4, compact = false }) {
  const rows = (ev.outcomes || []).slice(0, max)
  return (
    <ul className={`lite-pm-outs${compact ? ' lite-pm-outs--compact' : ''}`}>
      {rows.map((o) => (
        <li key={o.id}>
          <span className="lite-pm-out-lbl">{shortLabel(o, ev.outcomes?.length || 1)}</span>
          <span className="lite-pm-out-bar" aria-hidden><i style={{ width: `${Math.min(100, Math.max(1, o.yesPct))}%` }} /></span>
          <strong className="lite-pm-out-pct">{o.yesPct}%</strong>
        </li>
      ))}
    </ul>
  )
}

function Meta({ ev, fmtLargeShort, t }) {
  const end = rawEnd(ev)
  const d = daysLeft(end)
  return (
    <span className="lite-pm-meta">
      {ev.totalVolume > 0 && <span>{fmtLargeShort(ev.totalVolume)} {tl(t, 'traded', 'msg')}</span>}
      {ev.volume24h > 0 && <span className="lite-pm-meta-hot">{fmtLargeShort(ev.volume24h)} {tl(t, 'today', 'msg')}</span>}
      {d != null && <span>{d <= 0 ? tl(t, 'resolving', 'msg') : d === 1 ? tl(t, 'ends tomorrow', 'msg') : d <= 60 ? `${tl(t, 'ends in', 'msg')} ${d} ${tl(t, 'days', 'msg')}` : `${tl(t, 'ends', 'msg')} ${ev.endDate}`}</span>}
    </span>
  )
}

export default function PredictionsView({ fmtLargeShort, onOpenPath }) {
  const { t } = useTranslation()
  const [events, setEvents] = useState(() => (_cache && Date.now() - _cache.ts < TTL ? _cache.data : null))
  const [cat, setCat] = useState('all')

  useEffect(() => {
    if (_cache && Date.now() - _cache.ts < TTL) return undefined
    let cancelled = false
    import('@/services/polymarketApi')
      .then(({ getPredictionEventCards }) => getPredictionEventCards('all', 80))
      .then((rows) => {
        if (cancelled) return
        const list = Array.isArray(rows) ? rows.filter((e) => e.title && e.outcomes?.length) : []
        if (list.length) _cache = { ts: Date.now(), data: list }
        setEvents(list)
      })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [])

  const catsPresent = useMemo(() => CATS.filter((c) => c.id === 'all' || events?.some((e) => e.category === c.id)), [events])
  const shown = useMemo(() => (events ? events.filter((e) => cat === 'all' || e.category === cat) : null), [events, cat])
  const lead = useMemo(() => {
    if (!shown?.length) return null
    return [...shown].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0]
  }, [shown])
  const cards = useMemo(() => (shown ? shown.filter((e) => e.id !== lead?.id).slice(0, 20) : []), [shown, lead])

  const rail = useMemo(() => {
    if (!events) return { hot: [], soon: [] }
    const hot = [...events].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).slice(0, 5)
    const now = Date.now()
    const soon = events
      .map((e) => ({ e, end: rawEnd(e) }))
      .filter(({ end }) => end && end > now && end - now < SOON_DAYS * 86_400_000)
      .sort((a, b) => a.end - b.end)
      .slice(0, 5)
      .map(({ e }) => e)
    return { hot, soon }
  }, [events])

  const openPro = () => { track(Events.LITE_PRO_DOOR, { path: '/predictions' }); onOpenPath?.('/predictions') }
  const catLabel = (id) => tl(t, CATS.find((c) => c.id === id)?.label || id, 'opt')

  return (
    <div className="lite-view lite-pm">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Predictions', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'What the betting markets actually believe, in real money.', 'sub')}</p>
      </header>

      {catsPresent.length > 2 && (
        <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.predictionsview.ariaCategory', "Category")}>
          {catsPresent.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={`lite-tf-btn${cat === c.id ? ' active' : ''}`} onClick={() => setCat(c.id)}>{tl(t, c.label, 'opt')}</button>
          ))}
        </div>
      )}

      <div className="lite-pm-grid lite-rise-1">
        <div className="lite-pm-main">
          {!shown ? (
            <section className="lite-panel"><Skel n={8} /></section>
          ) : shown.length === 0 ? (
            <section className="lite-panel"><p className="lite-empty">{tl(t, 'No active markets in this category right now.', 'msg')}</p></section>
          ) : (
            <>
              {lead && (
                <a href={lead.url} target="_blank" rel="noopener noreferrer" className="lite-panel lite-pm-lead">
                  <div className="lite-pm-lead-head">
                    <Art ev={lead} />
                    <div className="lite-pm-lead-text">
                      <span className="lite-pm-kind"><i>{tl(t, 'Most money today', 'lbl')}</i><em>{catLabel(lead.category)}</em></span>
                      <strong className="lite-pm-lead-title">{lead.title}</strong>
                      <Meta ev={lead} fmtLargeShort={fmtLargeShort} t={t} />
                    </div>
                    <OutIcon />
                  </div>
                  <Outcomes ev={lead} max={4} />
                </a>
              )}
              <ul className="lite-pm-cards">
                {cards.map((ev) => (
                  <li key={ev.id}>
                    <a href={ev.url} target="_blank" rel="noopener noreferrer" className="lite-panel lite-pm-card">
                      <div className="lite-pm-card-head">
                        <Art ev={ev} />
                        <div className="lite-pm-card-text">
                          <em className="lite-pm-cat">{catLabel(ev.category)}</em>
                          <strong className="lite-pm-card-title">{ev.title}</strong>
                        </div>
                      </div>
                      <Outcomes ev={ev} max={3} compact />
                      <Meta ev={ev} fmtLargeShort={fmtLargeShort} t={t} />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="lite-social-note">{tl(t, 'Live odds from Polymarket. A 70% means people risking real money put the chance at 70%.', 'msg')}</p>
        </div>

        <aside className="lite-pm-rail">
          <section className="lite-panel lite-pm-rail-panel">
            <p className="lite-eyebrow">{tl(t, 'Hot today', 'lbl')} <span className="lite-pm-eyebrow-note">24h</span></p>
            {!events ? <Skel n={5} /> : rail.hot.length === 0 ? <p className="lite-empty">{tl(t, 'Quiet tape.', 'msg')}</p> : (
              <ul className="lite-pm-list">
                {rail.hot.map((ev) => (
                  <li key={ev.id}>
                    <a href={ev.url} target="_blank" rel="noopener noreferrer">
                      <strong>{ev.title}</strong>
                      <span><b>{fmtLargeShort(ev.volume24h)}</b> {tl(t, 'today', 'msg')} · {`${shortLabel(ev.outcomes[0], ev.outcomes.length)} ${ev.outcomes[0]?.yesPct}%`}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="lite-panel lite-pm-rail-panel">
            <p className="lite-eyebrow">{tl(t, 'Closing soon', 'lbl')} <span className="lite-pm-eyebrow-note">30d</span></p>
            {!events ? <Skel n={5} /> : rail.soon.length === 0 ? <p className="lite-empty">{tl(t, 'Nothing resolves in the next month.', 'msg')}</p> : (
              <ul className="lite-pm-list">
                {rail.soon.map((ev) => {
                  const d = daysLeft(rawEnd(ev))
                  return (
                    <li key={ev.id}>
                      <a href={ev.url} target="_blank" rel="noopener noreferrer">
                        <strong>{ev.title}</strong>
                        <span><b>{d <= 1 ? tl(t, 'tomorrow', 'msg') : `${d} ${tl(t, 'days', 'msg')}`}</b> · {`${shortLabel(ev.outcomes[0], ev.outcomes.length)} ${ev.outcomes[0]?.yesPct}%`}</span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={openPro}>
          {tl(t, 'All prediction markets in PRO', 'msg')}<ArrowIcon />
        </button>
      )}
    </div>
  )
}
