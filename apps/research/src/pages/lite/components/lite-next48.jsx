/**
 * LITE "Next 48 hours" — what's coming that can move the tape, deterministic.
 *   - High-impact macro releases (NFP, CPI, FOMC…) from /api/calendar/economic
 *     (serverless-backed — see the /api/stocks/sectors warning in lite-stocks:
 *     Express-only routes die on prod, this one has a twin).
 *   - Curated earnings inside the window (stocks mode: all; crypto mode: the
 *     crypto-adjacent names whose prints move the coins).
 *   - Token unlocks (crypto mode) from the same calendar feed.
 * Zero LLM: the feed's own impact tier decides what qualifies. Empty window
 * says so honestly instead of padding with low-impact noise.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { getUpcomingEarnings } from '@/services/stockApi'


const WINDOW_H = 48
const CAL_TTL = 10 * 60 * 1000
let _cal = null // { ts, events }

const isoDay = (d) => d.toISOString().slice(0, 10)

async function loadCalendar() {
  if (_cal && Date.now() - _cal.ts < CAL_TTL) return _cal.events
  const now = new Date()
  const to = new Date(now.getTime() + 3 * 864e5)
  try {
    const res = await fetch(`/api/calendar/economic?from=${isoDay(now)}&to=${isoDay(to)}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return _cal?.events || null
    const payload = await res.json()
    const events = Array.isArray(payload?.events) ? payload.events : []
    if (events.length) _cal = { ts: Date.now(), events }
    return events
  } catch (_) {
    return _cal?.events || null
  }
}

// Crypto-adjacent tickers whose earnings the coins actually trade on.
const CRYPTO_EARNERS = new Set(['COIN', 'HOOD', 'MSTR', 'NVDA'])

// ── "On watch" — the undated catalysts people are actually waiting for
// (CLARITY Act, Fed cut odds…), read as live Polymarket odds instead of us
// asserting a narrative. Highest-volume markets from the serious categories;
// sports/culture never qualify. ──
const WATCH_CATS = { crypto: ['crypto', 'economy', 'politics', 'science'], stocks: ['economy', 'crypto', 'politics', 'science'] }
// Questions the tape actually trades on rank first, whatever their category.
const WATCH_BOOST = /fed\b|rate|tariff|inflation|shutdown|recession|ipo\b|etf|sec\b|acquisi|merger|stablecoin|clarity|\bact\b|\bbill\b|tax|openai|nvidia|apple|tesla|election|nominee|president/i
// Battle-map trackers are news, not market catalysts.
const WATCH_NOISE = /captur|seiz|missile|strike\b|offensive|frontline|ceasefire line/i
let _pred = null // { ts, rows }
async function loadWatch() {
  if (_pred && Date.now() - _pred.ts < CAL_TTL) return _pred.rows
  try {
    const { getPredictionMarkets } = await import('@/services/polymarketApi')
    const rows = await getPredictionMarkets('all', 60)
    if (Array.isArray(rows) && rows.length) _pred = { ts: Date.now(), rows }
    return Array.isArray(rows) ? rows : _pred?.rows || null
  } catch (_) {
    return _pred?.rows || null
  }
}

const fmtVal = (v, unit) => {
  if (v == null || !isFinite(Number(v))) return null
  const u = (unit || '').trim()
  // single-letter magnitudes and % hug the number: "80K", "4.2%"; longer
  // units keep their space: "24.3 B$"
  return `${Number(v)}${u.length <= 1 || u === '%' ? u : ` ${u}`}`
}

/** rows: macro + unlocks + earnings inside [now, now+48h], time-sorted. */
export function useNext48(mode) {
  const [cal, setCal] = useState(() => (_cal ? _cal.events : null))
  const [earn, setEarn] = useState(null)
  const [pred, setPred] = useState(() => (_pred ? _pred.rows : null))
  useEffect(() => {
    let cancelled = false
    loadCalendar().then((evs) => { if (!cancelled) setCal(evs) })
    getUpcomingEarnings().then((rows) => { if (!cancelled) setEarn(Array.isArray(rows) ? rows : []) }).catch(() => { if (!cancelled) setEarn([]) })
    loadWatch().then((rows) => { if (!cancelled) setPred(rows) })
    return () => { cancelled = true }
  }, [])

  return useMemo(() => {
    const now = Date.now()
    const end = now + WINDOW_H * 3600e3
    const rows = []
    for (const e of cal || []) {
      const ts = e?.dateTime ? Date.parse(e.dateTime) : NaN
      if (!isFinite(ts) || ts < now || ts > end) continue
      if (e.event_type === 'macro' && (e.impact === 'critical' || e.impact === 'high')) {
        const bits = []
        if (e.country) bits.push(e.country)
        const fc = fmtVal(e.forecast, e.unit); if (fc) bits.push(`fc ${fc}`)
        const pv = fmtVal(e.previous, e.unit); if (pv) bits.push(`prev ${pv}`)
        rows.push({ kind: 'macro', ts, name: e.nameShort || e.name, sub: bits.join(' · '), impact: e.impact, isFed: !!e.isFedEvent, id: e.id })
      } else if (mode === 'crypto' && e.event_type === 'unlock') {
        rows.push({ kind: 'unlock', ts, name: e.nameShort || e.name, sub: e.country && e.country !== 'US' ? e.country : '', impact: 'unlock', id: e.id })
      }
    }
    // one unlock is a signal, five is noise
    let unlocks = 0
    const filtered = rows.filter((r) => (r.kind !== 'unlock' ? true : (unlocks += 1) <= 2))

    let nextEarnings = null
    for (const e of earn || []) {
      const ts = e?.earningsDate ? Date.parse(e.earningsDate) : NaN
      if (!isFinite(ts) || ts < now) continue
      if (mode === 'crypto' && !CRYPTO_EARNERS.has(e.symbol)) continue
      const row = {
        kind: 'earnings', ts, name: e.name || e.symbol, symbol: e.symbol,
        sub: e.epsEstimate != null ? `est EPS $${Number(e.epsEstimate).toFixed(2)}` : '',
        impact: 'earnings', id: `earn-${e.symbol}`,
      }
      if (ts <= end) filtered.push(row)
      else if (!nextEarnings || ts < nextEarnings.ts) nextEarnings = row
    }

    filtered.sort((a, b) => a.ts - b.ts)
    const lead = filtered.find((r) => r.impact === 'critical' || r.isFed) || null

    const cats = WATCH_CATS[mode] || WATCH_CATS.crypto
    // "On watch" means genuinely contested and resolving soon-ish: coin-flip
    // territory (5-95%), settling inside ~7 months (drops 2028 election
    // longshots), one market per event (not three candidates of one primary).
    const seenEvent = new Set()
    const watch = (pred || [])
      .filter((p) => {
        if (!cats.includes(p.category) || !p.question || !Number.isFinite(p.yesPct)) return false
        if (p.yesPct < 5 || p.yesPct > 95) return false
        if (!(p.volume >= 50e3)) return false
        if (WATCH_NOISE.test(p.question)) return false
        const endTs = p.endDate && p.endDate !== '-' ? Date.parse(p.endDate) : NaN
        if (isFinite(endTs) && endTs - now > 210 * 864e5) return false
        return true
      })
      .sort((a, b) => (
        (WATCH_BOOST.test(a.question) ? 0 : 1) - (WATCH_BOOST.test(b.question) ? 0 : 1)
      ) || (cats.indexOf(a.category) - cats.indexOf(b.category)) || (b.volume - a.volume))
      .filter((p) => {
        const key = (p.title || p.question).slice(0, 40).toLowerCase()
        if (seenEvent.has(key)) return false
        seenEvent.add(key)
        return true
      })
      .slice(0, 3)

    return { rows: filtered.slice(0, 7), lead, nextEarnings, watch, loading: cal === null && earn === null }
  }, [cal, earn, pred, mode])
}

const fmtVol = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`)

function fmtWhen(ts, lang, t) {
  const mins = Math.max(0, Math.round((ts - Date.now()) / 60000))
  const d = new Date(ts)
  const abs = `${d.toLocaleDateString(lang, { weekday: 'short' })} ${d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`
  if (mins < 60) return { rel: t('lite.msg.in_m', 'in {{m}}m', { m: mins }), abs }
  if (mins < 12 * 60) {
    const h = Math.floor(mins / 60), m = mins % 60
    return { rel: m ? t('lite.msg.in_hm', 'in {{h}}h {{m}}m', { h, m }) : t('lite.msg.in_h', 'in {{h}}h', { h }), abs }
  }
  return { rel: abs, abs: '' }
}

const TAG_LABEL = { critical: 'Critical', high: 'High', earnings: 'Earnings', unlock: 'Unlock' }

export default function LiteNext48({ mode = 'crypto', onPickResearch, span = 12 }) {
  const { t, i18n } = useTranslation()
  const { rows: allRows, lead, nextEarnings, watch, loading } = useNext48(mode)
  const tight = span <= 6
  // Paired with the brief (tight), the card must hold the ROW's height —
  // everything past the first releases folds behind More so the two boxes
  // stay edge-aligned instead of one towering over raw wallpaper.
  const [open, setOpen] = useState(false)
  const COLLAPSED_ROWS = 4
  const collapsed = tight && !open
  const rows = collapsed ? allRows.slice(0, COLLAPSED_ROWS) : allRows
  const hiddenCount = collapsed
    ? Math.max(0, allRows.length - COLLAPSED_ROWS) + (watch?.length || 0)
    : 0
  const showWatch = !collapsed && watch && watch.length > 0
  const showDeck = !collapsed && mode === 'stocks' && nextEarnings && !allRows.some((r) => r.kind === 'earnings')
  // relative labels stay honest on a long-lived tab
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setTick((x) => x + 1) }, 60000)
    return () => clearInterval(id)
  }, [])

  if (loading) return null
  return (
    <section className={`lite-panel lite-span-${span} lite-n48${tight ? ' lite-n48--tight' : ''}`}>
      <p className="lite-eyebrow">{tl(t, 'The next 48 hours', 'lbl')}</p>
      {lead ? (
        <p className="lite-n48-lead">
          {t('lite.msg.n48_lead', '{{name}} lands {{when}}.', { name: lead.name, when: fmtWhen(lead.ts, i18n.language, t).rel })}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="lite-empty">{tl(t, 'A quiet 48 hours ahead - no high-impact releases on the calendar.', 'msg')}</p>
      ) : (
        <ul className="lite-n48-list">
          {rows.map((r) => {
            const w = fmtWhen(r.ts, i18n.language, t)
            const clickable = r.kind === 'earnings' && onPickResearch
            return (
              <li
                key={r.id}
                className={`lite-n48-row${clickable ? ' lite-n48-row--link' : ''}`}
                {...(clickable ? {
                  role: 'button', tabIndex: 0,
                  onClick: () => onPickResearch(r.symbol, { stock: true }),
                  onKeyDown: (e) => { if (e.key === 'Enter') onPickResearch(r.symbol, { stock: true }) },
                } : {})}
              >
                <span className="lite-n48-when">
                  <strong>{w.rel}</strong>
                  {w.abs ? <em>{w.abs}</em> : null}
                </span>
                <span className="lite-n48-main">
                  <strong>{r.kind === 'earnings' ? t('lite.msg.n48_reports', '{{name}} reports', { name: r.name }) : r.name}</strong>
                  {r.sub ? <em>{r.sub}</em> : null}
                </span>
                {r.isFed ? <span className="lite-n48-tag lite-n48-tag--fed">Fed</span> : null}
                <span className={`lite-n48-tag lite-n48-tag--${r.impact}`}>{tl(t, TAG_LABEL[r.impact] || r.impact, 'lbl')}</span>
              </li>
            )
          })}
        </ul>
      )}
      {showDeck ? (
        <p className="lite-n48-deck">
          {t('lite.msg.n48_ondeck', 'Next on deck: {{name}} reports {{date}}.', {
            name: nextEarnings.name,
            date: new Date(nextEarnings.ts).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }),
          })}
        </p>
      ) : null}
      {showWatch ? (
        <>
          <p className="lite-n48-subhead">{tl(t, 'On watch', 'lbl')}</p>
          <ul className="lite-n48-list lite-n48-watch">
            {watch.map((p) => (
              <li key={p.id} className="lite-n48-row">
                <span className="lite-n48-odds">{p.yesPct}%</span>
                <span className="lite-n48-main">
                  <strong>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer">{p.question}</a>
                    ) : p.question}
                  </strong>
                  <em>{[tl(t, p.category, 'lbl'), p.volume > 0 ? t('lite.msg.n48_vol', '{{v}} traded', { v: fmtVol(p.volume) }) : null].filter(Boolean).join(' · ')}</em>
                </span>
              </li>
            ))}
          </ul>
          <p className="lite-n48-deck">{tl(t, 'Live odds from prediction markets - what money, not pundits, expects.', 'msg')}</p>
        </>
      ) : null}
      {tight && (hiddenCount > 0 || open) ? (
        <button type="button" className={`lite-n48-more${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? t('lite.msg.n48_less', 'Less') : t('lite.msg.n48_more', 'More ({{n}})', { n: hiddenCount })}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </button>
      ) : null}
    </section>
  )
}
