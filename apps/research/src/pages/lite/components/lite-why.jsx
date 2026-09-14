/**
 * LITE Why — the day, in plain sentences.
 *
 * The anxious trader's view: is this my coin's problem, everyone's problem,
 * or nobody-knows? One verdict line, four honest tiles, then the story of the
 * day in order. Someone who checks once at lunch should understand the session
 * in fifteen seconds. Zero LLM — the verdict and every line come from the box
 * why-engine (market_events + market_state), which gates events server-side
 * (liquidation unit artifacts quarantined, self-describing headlines and
 * rhetoric rejected). A quiet day renders as "nothing happened", on purpose.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import useUpcomingMacro from '@/hooks/useUpcomingMacro'
import { getSpectreMarketState, getSpectreMarketTimeline, getSpectreOhlcv } from '@/services/spectreMarketApi'
import { exhaustionWatch, fromPublished } from '@/lib/exhaustion-watch'
import { localizeUtcStamps } from '@/lib/localize-utc'
import WhyTimelineGauge from '@/components/why-timeline-gauge'
import './lite-why.css'

const VERDICT = {
  sold_off: { word: 'Crypto sold off this session', tone: 'down' },
  ripped: { word: 'Crypto ripped this session', tone: 'up' },
  tracking_tape: { word: 'Moving with the US market', tone: 'neu' },
  decoupled_up: { word: 'Crypto is strong on its own', tone: 'up' },
  decoupled_down: { word: 'Crypto is weak on its own', tone: 'down' },
  quiet: { word: 'A quiet tape', tone: 'neu' },
  tape_closed: { word: 'US market closed — crypto on its own clock', tone: 'neu' },
  unknown: { word: 'Reading the tape…', tone: 'neu' },
}
const LANE_WORD = { price: 'Price', macro: 'US market', flow: 'Forced flow', news: 'Headline' }
// what the asset chip says — a liquidation line means nothing until you know
// WHOSE longs were liquidated, and "NDX" is jargon to the Lite reader
const ASSET_WORD = { SPX: 'S&P 500', NDX: 'Nasdaq', VIX: 'VIX', DXY: 'Dollar', US10Y: '10Y yield', GOLD: 'Gold', WTI: 'Oil' }
const ASSET_TITLE = {
  price: 'spot price', flow: 'perpetual futures', macro: 'US market index', news: 'headline subject',
}

// market-shock class — the same vocabulary the box uses to pick the session's
// driver, so the beat Lite marks KEY is the beat the verdict is talking about
const SHOCK_RX = /crash(?:es|ed)?|halted|plunge[sd]?|circuit breaker|emergency (?:cut|meeting)|default(?:s|ed)?|devalu|contagion|bank run|halts? trading/i
// Scheduled top-tier macro RESULTS. Separate from SHOCK_RX because these are not
// shocks — they are the calendar landing — but they are unambiguously the most
// important line of the day when they print. Without this a Fed decision renders
// as an ordinary grey row (caught 2026-07-29, hours before an FOMC print).
const MACRO_DECISION_RX = /\b(fomc|fed (?:funds|interest|rate) decision|interest rate decision|rate decision|cpi|inflation rate|non.?farm|payrolls|unemployment rate|gdp growth)\b/i

const pctTxt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`)
const cls = (v) => (v == null ? '' : v > 0.05 ? 'lw-up' : v < -0.05 ? 'lw-down' : '')
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// A 24h window crosses midnight, so a bare "21:05" above a "03:00" reads as
// broken ordering. Name the day instead of printing a date nobody parses.
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
function dayName(t) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(t)) / 86400e3)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

// What earns the KEY mark.
//
// 🪤 The wire scorer grades almost every headline 0.75-0.95, so a flat
// "importance >= 0.7" marked nearly the whole news lane and highlighted
// nothing. Headlines qualify only by being the session's named driver or by
// being shock-class; the graded threshold is left to the other lanes, where a
// 0.7 genuinely means a violent candle or a big forced-flow cascade.
function isKey(ev, driverText) {
  if (driverText && ev.text === driverText) return true
  if (ev.lane === 'news') return SHOCK_RX.test(String(ev.text)) || MACRO_DECISION_RX.test(String(ev.text))
  const imp = ev.importance
  if (imp == null) return false
  return imp <= 1 ? imp >= 0.7 : imp >= 85
}

let _cache = { state: null, events: null, ts: 0 }

export default function WhyView({ fmtPrice }) {
  const { t } = useTranslation()
  const [state, setState] = useState(_cache.state)
  const [events, setEvents] = useState(_cache.events || [])
  const [bars, setBars] = useState(_cache.bars || [])
  const [loading, setLoading] = useState(!_cache.state)

  const deadRef = useRef(false)
  useEffect(() => { deadRef.current = false; return () => { deadRef.current = true } }, [])

  const load = useCallback(async () => {
    const [s, ev, bs] = await Promise.all([
      getSpectreMarketState().catch(() => null),
      // limit sized to the window on purpose: the box caps the response, and an
      // under-asked window silently loses its old end (and, before 2026-08-03,
      // its NEW end — see the note in getSpectreMarketTimeline)
      getSpectreMarketTimeline({ hours: 48, limit: 800 }).catch(() => []),
      // same symbol/interval/range Pro asks for, so both surfaces share one
      // box-cache entry instead of each paying the cold path
      getSpectreOhlcv('BTC', '15m', '24h').catch(() => []),
    ])
    if (deadRef.current) return
    if (s) setState(s)
    setEvents(ev)
    if (bs.length) setBars(bs)
    setLoading(false)
    _cache = { state: s || _cache.state, events: ev, bars: bs.length ? bs : _cache.bars, ts: Date.now() }
  }, [])

  useEffect(() => {
    if (!_cache.ts || Date.now() - _cache.ts > 60_000) load()
    else setLoading(false)
  }, [load])

  // 90s, and visibility/idle guarded — a bare 60s setInterval sat exactly on the
  // 60s service cache TTL (so it missed every time) and kept firing on a hidden
  // tab. Same fix as the Pro /why hook.
  useAdaptivePolling(load, { interval: 90_000, respectIdle: true })

  const v = VERDICT[state?.divergence] || VERDICT.unknown
  const btc = state?.crypto?.BTC
  const spx = state?.tape?.SPX
  const vix = state?.tape?.VIX
  const pos = state?.positioning?.BTC
  // the headline the box named as the session's cause — always a KEY beat
  const driverText = state?.overnight_driver?.text || null
  // "Fed decision in 1h" — scheduled awareness, countdown only, never outcomes
  const { next: nextMacro } = useUpcomingMacro()

  // The freshest KEY headline of the last 2h, pinned above the story. The
  // timeline is newest-first, so minutes after a marquee print lands it is
  // already buried under routine tape rows — founder, ON Fed day, with the
  // FOMC rows sitting at positions 5-6: "still dont see headline".
  const justLanded = useMemo(() => {
    const now = Date.now()
    const cut = now - 2 * 3600e3
    const pool = events.filter((e) => e.lane === 'news' && !e.backfilled && e.at >= cut && e.at <= now && isKey(e, driverText))
    if (!pool.length) return null
    const score = (e) => (e.importance == null ? 0 : e.importance <= 1 ? e.importance * 100 : e.importance)
    return [...pool].sort((a, b) => score(b) - score(a) || b.at - a.at)[0]
  }, [events, driverText])

  // Same 48h window Pro uses, so the two surfaces cannot disagree about the
  // score on the same account.
  const exhaustion = useMemo(() => {
    const fromBox = fromPublished(state?.exhaustion)
    if (fromBox) return fromBox
    const cut = Date.now() - 48 * 3600e3
    return exhaustionWatch(bars.filter((b) => b.t >= cut), events)
  }, [state, bars, events])

  // The headline IS the thesis. "The day, in order" told the reader nothing;
  // the verdict word plus the one scheduled event everyone is waiting on is
  // the whole session in a sentence.
  const thesis = useMemo(() => {
    if (!nextMacro) return v.word
    if (nextMacro.phase === 'now') return `${v.word} — ${nextMacro.short} landing now`
    if (nextMacro.msTo <= 2 * 3600e3) return `${v.word} — ${nextMacro.short} in ${nextMacro.countdown}`
    return `${v.word}, waiting on the ${nextMacro.short}`
  }, [v, nextMacro])

  // the story: the strongest beats of the last 48 HOURS (same window as the
  // gauge below — one feature, one clock), importance-graded events win, ties
  // go to recency; backfilled history rows only fill in when the live window
  // is thin
  const dayEvents = useMemo(() => {
    const cut = Date.now() - 48 * 3600e3
    return events.filter((e) => e.at >= cut)
  }, [events])

  const beats = useMemo(() => {
    const live = dayEvents.filter((e) => !e.backfilled)
    const pool = live.length >= 5 ? live : dayEvents
    // lane-diverse selection: headlines grade 0.75-0.95 and would crowd out
    // every price/tape/flow beat on a newsy day — but the story of a session
    // IS the interleaving ("stocks rolled over, then crypto followed, then a
    // headline landed"). Take the strongest few per lane, then the strongest
    // remainder, and tell it in time order.
    const byImp = (a, b) => (b.importance ?? 0.4) - (a.importance ?? 0.4) || b.at - a.at
    const picked = []
    for (const lane of ['price', 'macro', 'flow']) {
      picked.push(...pool.filter((e) => e.lane === lane).sort(byImp).slice(0, 4))
    }
    // News is NOT a pure importance cut. The wire grader compresses everything
    // into ~83-97 and hands an Australian trade-balance beat a 96 — on NFP day
    // 2026-08-07 the -23K shock print (84) lost all four slots to routine
    // intl-macro rows while the liquidations it caused all rendered. A KEY row
    // outranks any grade, but capped at two slots (a marquee print arrives as
    // a dozen wire variants and must not take the whole lane); figure-bearing
    // KEY rows come first so a result beats its own preview, and a row
    // repeating an already-picked row's figures is the same fact reworded.
    const news = pool.filter((e) => e.lane === 'news').sort(byImp)
    const figs = (t) => (String(t).match(/\d+(?:\.\d+)?/g) || []).sort().join(',')
    const keyNews = []
    for (const e of news.filter((e) => isKey(e, driverText)).sort((a, b) => (figs(b.text) ? 1 : 0) - (figs(a.text) ? 1 : 0) || byImp(a, b))) {
      if (keyNews.length >= 2) break
      if (keyNews.some((k) => figs(k.text) && figs(k.text) === figs(e.text))) continue
      keyNews.push(e)
    }
    picked.push(...keyNews, ...news.filter((e) => !keyNews.includes(e)).slice(0, 4 - keyNews.length))
    const rest = pool.filter((e) => !picked.includes(e)).sort(byImp)
    const list = [...picked, ...rest].slice(0, 16)
    // the read names a driver — the story below has to contain it, or the page
    // asserts a cause it never shows. Trade the weakest pick for it.
    if (driverText && !list.some((e) => e.text === driverText)) {
      const d = pool.find((e) => e.text === driverText)
      if (d) { list.pop(); list.push(d) }
    }
    // NEWEST FIRST. This used to read forward ("the day, in order" — a story
    // reads forward), but Pro /why is newest-first, and one feature rendering
    // its timeline in two different directions is worse than either choice.
    // The gauge below still runs left-to-right: a time AXIS always does, and
    // that is a different idiom from a feed.
    return list.sort((a, b) => b.at - a.at)
  }, [dayEvents, driverText])

  // cut into days — newest day first, so Today sits above Yesterday
  const days = useMemo(() => {
    const out = []
    for (const ev of beats) {
      const key = startOfDay(ev.at)
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, label: dayName(ev.at), rows: [] })
      out[out.length - 1].rows.push(ev)
    }
    return out
  }, [beats])

  const price = (x) => (fmtPrice ? fmtPrice(x) : x == null ? '—' : `$${Math.round(x).toLocaleString('en-US')}`)

  return (
    <section className="lite-view lw-view">
      <p className="lite-eyebrow">Why · the last 48 hours, in order</p>
      <h2 className={`lite-view-title lw-thesis lw-thesis--${v.tone}`}>{thesis}.</h2>
      {nextMacro ? (
        <div className={`lw-fed${nextMacro.phase === 'now' ? ' lw-fed--now' : nextMacro.msTo <= 90 * 60e3 ? ' lw-fed--hot' : ''}`}>
          <i className="lw-fed-dot" />
          <span className="lw-fed-name">{nextMacro.short}</span>
          <span className="lw-fed-count">{nextMacro.phase === 'now' ? 'landing now' : `in ${nextMacro.countdown}`}</span>
          <span className="lw-fed-at">{hhmm(nextMacro.at)} your time</span>
        </div>
      ) : null}
      {justLanded ? (
        <div className="lw-landed">
          <span className="lw-landed-tag"><i className="lw-landed-dot" />Just landed · {hhmm(justLanded.at)}</span>
          <p className="lw-landed-text">{justLanded.text}</p>
        </div>
      ) : null}
      {/* Exhaustion watch — the same shared signal Pro renders, compacted.
          Lite gets the VERDICT and the receipt, not the five test rows: a phone
          reader wants "which side of the move is this", not a checklist.
          See lib/exhaustion-watch.js for why 5/5 is the bearish state. */}
      {exhaustion ? (
        <div className={`lw-exh lw-exh--${exhaustion.bias}`}>
          <span className="lw-exh-k">
            {exhaustion.bias === 'spent' ? 'Bounce spent' : exhaustion.bias === 'coiled' ? 'Flush still working' : 'Mid-flush'}
            {/* score and lean are ONE group: the header is space-between, so a
                third loose child would scatter the three across the row */}
            <span className="lw-exh-badge">
              <b>{exhaustion.score}/5</b>
              <span className="lw-exh-arrow" title={exhaustion.lean.title}>{exhaustion.lean.arrow} {exhaustion.lean.word}</span>
            </span>
          </span>
          <p className="lw-exh-v">{exhaustion.verdict}</p>
          {/* the five tests, compact. Originally omitted on the theory that a
              phone reader wants the verdict not a checklist — but the checklist
              is WHY the verdict is what it is, and without it the panel asks to
              be trusted instead of checked. One line each, dot + name + fact. */}
          <ul className="lw-exh-tests">
            {exhaustion.tests.map((t) => (
              <li key={t.name} className={t.ok ? 'is-ok' : ''}>
                <i />
                <span className="lw-exh-tn">{t.name}</span>
                <span className="lw-exh-td">{t.detail}</span>
              </li>
            ))}
          </ul>
          <span className="lw-exh-n">{exhaustion.evidence.label} {exhaustion.evidence.value} · {exhaustion.evidence.n} · directional, not proven</span>
        </div>
      ) : null}
      {state?.fragility?.why && (state.fragility.level === 'elevated' || state.fragility.level === 'watch') ? (
        <p className={`lw-frag lw-frag--${state.fragility.level}`}>{localizeUtcStamps(state.fragility.why)}</p>
      ) : null}
      {/* the box stamps its read in UTC; the story below is in local time —
          convert so one screen speaks one clock */}
      {/* The desk note REPLACES the deterministic read here rather than sitting
          under it. Both are built from the same gated facts, so on a phone they
          read as the same paragraph twice — and the note is the one that
          actually explains. The computed read stays as the fallback whenever the
          note is unavailable, and the verdict line above it is always
          deterministic either way. */}
      {state?.narrative ? (
        <div className="lw-note">
          {/* The resolved driver — the box's deterministic answer to "why",
              computed before the model wrote a word. One labeled line, so a
              phone reader gets the cause in one glance before the prose. */}
          {state.narrativeDriver?.story ? (
            <p className="lw-note-driver">
              <span className="lw-note-driver-k">{t('lite.whyview.driver', "Driver")}</span>
              <span className="lw-note-driver-t">{state.narrativeDriver.story}</span>
              {state.narrativeDriver.hours_standing != null ? (
                <span className="lw-note-driver-s">on the wire {state.narrativeDriver.hours_standing}h</span>
              ) : null}
            </p>
          ) : null}
          {String(state.narrative).split(/\n{2,}/).map((p, i) => (
            <p key={i} className="lw-note-p">{localizeUtcStamps(p.trim())}</p>
          ))}
          {/* honest freshness: when the note's own data is from, local clock */}
          {state.narrativeAt ? (
            <p className="lw-note-asof">Desk note · as of {hhmm(Date.parse(state.narrativeAt))}</p>
          ) : null}
        </div>
      ) : (
        <p className="lite-view-sub lw-read">{localizeUtcStamps(state?.read) || ''}</p>
      )}

      <div className="lw-tiles">
        <div className="lite-stat lw-tile"><span className="lw-k">{t('lite.whyview.bitcoin', "Bitcoin")}</span><strong className={cls(btc?.ch1h)}>{price(btc?.price)}</strong><span className="lw-s">{pctTxt(btc?.ch1h)} last hour</span></div>
        <div className="lite-stat lw-tile"><span className="lw-k">S&amp;P 500</span><strong className={cls(spx?.today)}>{pctTxt(spx?.today, 2)}</strong><span className="lw-s">{t('lite.whyview.today', "today")}</span></div>
        <div className="lite-stat lw-tile"><span className="lw-k">{t('lite.whyview.fearGauge', "Fear gauge")}</span><strong className={cls(vix?.today != null ? -vix.today : null)}>{pctTxt(vix?.today)}</strong><span className="lw-s">{t('lite.whyview.vixToday', "VIX today")}</span></div>
        <div className="lite-stat lw-tile"><span className="lw-k">{t('lite.whyview.theCrowd', "The crowd")}</span><strong>{pos ? `${pos.long_pct?.toFixed(0)}% long` : '—'}</strong><span className="lw-s">{t('lite.whyview.btcFutures', "BTC futures")}</span></div>
      </div>

      <WhyTimelineGauge events={events} isKey={(e) => isKey(e, driverText)} />

      {loading ? (
        <p className="lite-empty">Reading the tape…</p>
      ) : beats.length === 0 ? (
        <div className="lw-quiet">
          <strong>{t('lite.whyview.nothingHappenedToday', "Nothing happened today.")}</strong>
          <p>No real move, no forced selling, no headline that survived our filters. A quiet day is a real answer — not a missing one.</p>
        </div>
      ) : (
        <div className="lw-story">
          {days.map((d) => (
            <section key={d.key} className="lw-day">
              <h3 className="lw-day-label">{d.label}</h3>
              <ol className="lw-day-rows">
                {d.rows.map((ev, i) => {
                  const key = isKey(ev, driverText)
                  return (
                    <li key={`${ev.at}-${i}`} className={`lw-beat${key ? ' lw-beat--key' : ''}`}>
                      <span className="lw-beat-time">{hhmm(ev.at)}</span>
                      <span className="lw-beat-lane">{LANE_WORD[ev.lane] || ev.lane}</span>
                      <span className="lw-beat-text">
                        {key ? <span className="lw-beat-key">{t('lite.whyview.key', "Key")}</span> : null}
                        {ev.asset ? (
                          <span className="lw-beat-asset" title={ASSET_TITLE[ev.lane] || ''}>
                            {ASSET_WORD[ev.asset] || ev.asset}
                          </span>
                        ) : null}
                        {ev.text}
                        {ev.backfilled ? <em className="lw-beat-bf"> · earlier</em> : null}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      <p className="lw-foot">Every line above passed the desk's gates before it earned a place. Times are your local clock.</p>
    </section>
  )
}
