// Why Mode (/why) — "what is moving the market right now, and who did it".
// Verdict-led like /alt-rotation: the divergence read IS the page's answer,
// the timeline below is the evidence, in the order it actually happened.
import React, { useMemo, useRef, useEffect, useState } from 'react'
import useWhy, { WINDOWS, LANES } from '../use-why'
import useUpcomingMacro from '@/hooks/useUpcomingMacro'
import useUsMarketStatus from '@/pages/home/components/use-us-market-status'
import useSettingsStore from '@/store/useSettingsStore'
import { localizeUtcStamps } from '@/lib/localize-utc'
import WhyTimelineGauge from '@/components/why-timeline-gauge'
import { exhaustionWatch, fromPublished } from '@/lib/exhaustion-watch'
import './why-page.css'
import './why-page.day-mode.css'
import './why-page.mobile.css'

// market-shock class — mirror of the box SHOCK_RX so culprit rows and the map
// agree with the state's overnight_driver selection
const SHOCK_RX = /crash(?:es|ed)?|halted|plunge[sd]?|circuit breaker|emergency (?:cut|meeting)|default(?:s|ed)?|devalu|contagion|bank run|halts? trading/i
// Scheduled top-tier macro results. NOT folded into SHOCK_RX: culprit styling
// (the amber ⚑ on the session map) means "this caused the move", which a
// calendar print has not earned merely by landing. This drives KEY emphasis
// only — the print is the most important LINE of the day either way.
const MACRO_DECISION_RX = /\b(fomc|fed (?:funds|interest|rate) decision|interest rate decision|rate decision|cpi|inflation rate|non.?farm|payrolls|unemployment rate|gdp growth)\b/i

// the divergence verdict — the anxious trader's answer in one word
// `day*` are not decoration. The verdict word is painted from an INLINE custom
// property, so no stylesheet can recolour it — and the dark palette below
// (bull #34D399, bear #F87171, warm-white #f5f5f7) sits between 1.2:1 and
// 2.6:1 on a white page, i.e. the headline of the page is unreadable in day
// mode. Same hue, same meaning, contrast that survives the light background.
//
// The dark values ARE the design-system bull/bear channel and the warm-white
// ramp — this page used to run a bespoke mint/coral/cool-white set of its own,
// which is how the verdict word and the timeline dots came out as two
// different greens on the same screen.
const BAND = {
  // session-scale verdicts: |24h move or drawdown| >= 3% overrides hour-scale
  // nuance box-side (the 2026-07-28 lesson — a -4% night must not render as
  // "on its own clock" because the current hour is calm)
  sold_off: { color: '#F87171', glow: 'rgba(248,113,113,0.16)', dayColor: '#c62a1d', dayGlow: 'rgba(198,42,29,0.10)', word: 'SELLING OFF', hint: 'session-scale move' },
  ripped: { color: '#34D399', glow: 'rgba(52,211,153,0.16)', dayColor: '#04785a', dayGlow: 'rgba(4,120,90,0.10)', word: 'RIPPING', hint: 'session-scale move' },
  tracking_tape: { color: '#f5f5f7', glow: 'rgba(255,255,255,0.07)', dayColor: '#0f172a', dayGlow: 'rgba(15,23,42,0.06)', word: 'MOVING WITH THE TAPE', hint: 'macro-driven' },
  decoupled_up: { color: '#34D399', glow: 'rgba(52,211,153,0.16)', dayColor: '#04785a', dayGlow: 'rgba(4,120,90,0.10)', word: 'CRYPTO-SPECIFIC STRENGTH', hint: 'decoupled, bid on its own' },
  decoupled_down: { color: '#F87171', glow: 'rgba(248,113,113,0.15)', dayColor: '#c62a1d', dayGlow: 'rgba(198,42,29,0.09)', word: 'CRYPTO-SPECIFIC WEAKNESS', hint: 'weak without a macro excuse' },
  quiet: { color: 'rgba(245,245,247,0.86)', glow: 'rgba(255,255,255,0.06)', dayColor: '#334155', dayGlow: 'rgba(51,65,85,0.06)', word: 'QUIET', hint: 'nothing to explain' },
  tape_closed: { color: 'rgba(245,245,247,0.86)', glow: 'rgba(255,255,255,0.06)', dayColor: '#334155', dayGlow: 'rgba(51,65,85,0.06)', word: 'ON ITS OWN CLOCK', hint: 'US cash session shut' },
  unknown: { color: 'rgba(245,245,247,0.6)', glow: 'rgba(255,255,255,0.05)', dayColor: '#64748b', dayGlow: 'rgba(100,116,139,0.06)', word: '—', hint: '' },
}

// Lane identity is TYPE, not color — colored category labels are the AI-slop
// tell (and purple in chrome is banned outright). Color appears only where it
// carries market meaning: the row dot tints by DIRECTION of the event.
const LANE_META = {
  price: { label: 'PRICE' },
  macro: { label: 'US TAPE' },
  flow: { label: 'FLOW' },
  news: { label: 'WIRE' },
}

// market direction of an event → the only color on the row
function toneOf(ev) {
  const t = String(ev.text)
  if (ev.kind === 'impulse_down') return 'bear'
  if (ev.kind === 'impulse_up') return 'bull'
  if (ev.kind === 'liquidation_flush') return /of shorts/.test(t) ? 'bull' : 'bear'
  if (ev.kind === 'tape_move') {
    if (/vix/i.test(t)) return /bid/i.test(t) ? 'bear' : 'bull'
    return /sold off|fell/i.test(t) ? 'bear' : /rallied|rose/i.test(t) ? 'bull' : 'neu'
  }
  return 'neu'
}

// timeline rows painted per page — see the backdrop-filter note at the call site
const PAGE_ROWS = 300

const pctTxt = (v, d = 2) => (v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`)
const pctClass = (v) => (v == null ? 'neu' : v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'neu')
const px = (v) => (v == null || !isFinite(v) ? '—' : v >= 1000 ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${v.toFixed(2)}`)
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const ago = (ms) => {
  if (ms == null || !isFinite(ms)) return '—'
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}
// Minutes out of the shared market-status countdown ("Opens in 1h 23m",
// "Closes in 3h 4m", "Monday 9:30 AM ET" forms). PARSED rather than recomputed
// on purpose: `use-us-market-status` is the app's one ET clock (header, RZ
// equity macro, app-shell all read it), and a second timezone implementation
// here would eventually disagree with the header on the same screen.
const countdownMins = (s) => {
  const t = String(s || '')
  if (!/\d/.test(t)) return null
  const part = (rx) => Number((t.match(rx) || [0, 0])[1]) || 0
  const total = part(/(\d+)\s*d/) * 1440 + part(/(\d+)\s*h/) * 60 + part(/(\d+)\s*m/)
  return total || null
}
const RTH_MINS = 6.5 * 60 // 09:30 → 16:00 ET
const hhmmFromMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
const dayLabel = (t) => {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(t)) / 86400e3)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function TapeChip({ label, value, sub, cls }) {
  return (
    <div className="wy-chip">
      <span className="wy-chip-k">{label}</span>
      <span className={`wy-chip-v ${cls || ''}`}>{value}</span>
      {sub ? <span className="wy-chip-s">{sub}</span> : null}
    </div>
  )
}

// ── The session, annotated — BTC as the market's spine with the night's
//    culprits pinned to it. This is the "explain it to people" layer: a price
//    line anyone can read, with the driver (⚑), forced-selling clusters (▼),
//    the squeeze (▲) and the extremes labeled where they happened. ──────────
function SessionMap({ bars, events, driver, hours }) {
  const canvasRef = useRef(null)
  // measured on a padding-free inner box: sizing the canvas off the padded
  // .wy-map made it ~36px wider than its own content box, which is what pushed
  // the whole page sideways on a phone
  const [width, setWidth] = React.useState(0)
  // a CALLBACK ref, not useRef+useEffect: this component returns null until
  // enough bars land, so an effect with [] deps would run once while the node
  // did not exist yet and never measure anything. The callback fires exactly
  // when the node attaches.
  const roRef = useRef(null)
  const wrapRef = React.useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect?.(); roRef.current = null }
    if (!node) return
    setWidth(node.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(node.clientWidth))
    ro.observe(node)
    roRef.current = ro
  }, [])
  useEffect(() => () => roRef.current?.disconnect?.(), [])

  const windowed = useMemo(() => {
    const cut = Date.now() - Math.min(hours, 48) * 3600e3
    return bars.filter((b) => b.t >= cut)
  }, [bars, hours])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || windowed.length < 8) return
    const W = width, H = 190
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr; canvas.height = H * dpr
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)

    // the right gutter holds the live-price label; on a phone a fixed 56px
    // gutter eats a sixth of the plot, so it scales down with the canvas
    const narrow = W < 460
    const mL = 8, mR = narrow ? 44 : 56, mT = 26, mB = 30, pw = W - mL - mR, ph = H - mT - mB
    const t0 = windowed[0].t, t1 = windowed[windowed.length - 1].t
    const lows = windowed.map((b) => b.l), highs = windowed.map((b) => b.h)
    let lo = Math.min(...lows), hi = Math.max(...highs)
    const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad
    const X = (t) => mL + ((t - t0) / (t1 - t0 || 1)) * pw
    const Y = (v) => mT + (1 - (v - lo) / (hi - lo)) * ph
    const FONT = '-apple-system, BlinkMacSystemFont, Inter, sans-serif'

    // price area + line, colored by the window's direction
    const down = windowed[windowed.length - 1].c < windowed[0].c
    const cMain = down ? '#F87171' : '#34D399'
    const g = ctx.createLinearGradient(0, mT, 0, mT + ph)
    g.addColorStop(0, down ? 'rgba(248,113,113,0.22)' : 'rgba(52,211,153,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath(); ctx.moveTo(X(windowed[0].t), Y(windowed[0].c))
    for (const b of windowed) ctx.lineTo(X(b.t), Y(b.c))
    ctx.lineTo(X(t1), mT + ph); ctx.lineTo(X(t0), mT + ph); ctx.closePath(); ctx.fillStyle = g; ctx.fill()
    ctx.beginPath(); ctx.moveTo(X(windowed[0].t), Y(windowed[0].c))
    for (const b of windowed) ctx.lineTo(X(b.t), Y(b.c))
    ctx.strokeStyle = cMain; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()

    // extremes, labeled where they printed
    const hiBar = windowed.reduce((m, b) => (b.h > m.h ? b : m), windowed[0])
    const loBar = windowed.reduce((m, b) => (b.l < m.l ? b : m), windowed[0])
    ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(245,245,247,0.72)'
    ctx.fillText(`${Math.round(hiBar.h).toLocaleString('en-US')}`, Math.min(Math.max(X(hiBar.t), 26), W - 60), Y(hiBar.h) - 6)
    ctx.fillStyle = down ? '#FCA5A5' : 'rgba(245,245,247,0.72)'
    ctx.fillText(`${Math.round(loBar.l).toLocaleString('en-US')} · ${hhmm(loBar.t)}`, Math.min(Math.max(X(loBar.t), 44), W - 70), Math.min(Y(loBar.l) + 14, H - mB + 12))

    // right-edge last price
    // right-aligned to the canvas edge, not left-aligned into the gutter — a
    // 6-digit price at a 44px phone gutter clipped its last character
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(245,245,247,0.85)'; ctx.font = `700 ${narrow ? 10 : 11}px ${FONT}`
    ctx.fillText(`$${Math.round(windowed[windowed.length - 1].c).toLocaleString('en-US')}`, W - 2, Y(windowed[windowed.length - 1].c) + 4)

    const winEv = events.filter((e) => e.at >= t0 && e.at <= t1)

    // forced-flow clusters on the bottom rail: ▼ red = longs, ▲ green = shorts
    ctx.font = `700 9px ${FONT}`; ctx.textAlign = 'center'
    for (const e of winEv.filter((x) => x.kind === 'liquidation_flush')) {
      const isShorts = /of shorts/.test(e.text)
      const x = X(e.at)
      ctx.fillStyle = isShorts ? '#34D399' : '#F87171'
      ctx.beginPath()
      if (isShorts) { ctx.moveTo(x, H - mB + 8); ctx.lineTo(x - 4, H - mB + 16); ctx.lineTo(x + 4, H - mB + 16) }
      else { ctx.moveTo(x, H - mB + 16); ctx.lineTo(x - 4, H - mB + 8); ctx.lineTo(x + 4, H - mB + 8) }
      ctx.closePath(); ctx.fill()
    }

    // the culprit flags: shock-class headlines pinned to the price at their time
    const culprits = winEv.filter((x) => x.lane === 'news' && SHOCK_RX.test(x.text))
    for (const e of culprits) {
      const x = Math.min(Math.max(X(e.at), 14), W - mR - 8)
      const nearBar = windowed.reduce((m, b) => (Math.abs(b.t - e.at) < Math.abs(m.t - e.at) ? b : m), windowed[0])
      const y = Y(nearBar.c)
      ctx.strokeStyle = 'rgba(245,158,11,0.55)'; ctx.lineWidth = 1
      ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, mT - 4); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = '#F59E0B'
      ctx.beginPath(); ctx.moveTo(x, mT - 16); ctx.lineTo(x + 9, mT - 12); ctx.lineTo(x, mT - 8); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill()
    }
  }, [windowed, events, driver, width])

  if (windowed.length < 8) return null
  return (
    <div className="wy-map">
      <div className="wy-map-head">
        <span className="wy-map-title">The session, annotated</span>
        {/* each key is its own nowrap unit, so a narrow screen wraps between
            them instead of orphaning a separator on its own line */}
        <span className="wy-map-legend">
          <span><i className="lg-flag" /> culprit headline</span>
          <span><i className="lg-long" /> longs flushed</span>
          <span><i className="lg-short" /> shorts squeezed</span>
        </span>
      </div>
      <div className="wy-map-canvas" ref={wrapRef}><canvas ref={canvasRef} /></div>
    </div>
  )
}

// ── Reversal Watch — "is this a flush or a repricing, and is it turning?" ────
// The same falsifiable checklist the desk runs by hand after every crash, made
// live. Five deterministic tests over exchange bars + gated events; each shows
// its evidence, none is a prediction. A flush (mechanical, one-sided forced
// selling around an external shock) retraces once the selling exhausts; a
// repricing keeps falling. The tests tell those apart in real time.

function ReversalWatch({ bars, events, hours, published }) {
  // The box publishes this signal on /v1/market/state and the TG DM alert reads
  // the same field. Prefer it, so the panel, the alert and Lite can never
  // disagree about the score on one account; compute locally only when the
  // payload is missing (older box, or state fetch failed).
  const data = useMemo(() => {
    const fromBox = fromPublished(published)
    if (fromBox) return fromBox
    const cut = Date.now() - Math.min(hours, 48) * 3600e3
    return exhaustionWatch(bars.filter((b) => b.t >= cut), events)
  }, [published, bars, events, hours])
  if (!data) return null
  return (
    <div className="wy-rev">
      <div className="wy-rev-head">
        <span className="wy-map-title">Exhaustion watch</span>
        {/* the score chip is no longer "5 = good". It tints by the BIAS the
            backtest measured: spent = give-back, coiled = retrace still ahead. */}
        <span className={`wy-rev-score ${data.bias === 'coiled' ? 'up' : data.bias === 'spent' ? 'down' : 'mid'}`}>
          {data.score}/5 · {data.bias === 'spent' ? 'SPENT' : data.bias === 'coiled' ? 'COILED' : 'MID'}
          <span className="wy-rev-arrow" title={data.lean.title} aria-label={data.lean.word}>{data.lean.arrow}</span>
        </span>
      </div>
      <p className="wy-rev-verdict">{data.verdict}</p>
      <div className="wy-rev-ev">
        <span className="wy-rev-ev-k">{data.evidence.label}</span>
        <span className="wy-rev-ev-v">{data.lean.arrow} {data.evidence.value}</span>
        <span className="wy-rev-ev-n">vs {data.evidence.base} · {data.evidence.n} · BTC 15m, 38d · directional, not proven</span>
      </div>
      <div className="wy-rev-tests">
        {data.tests.map((t) => (
          <div key={t.name} className={`wy-rev-test ${t.ok ? 'ok' : ''}`}>
            <i />
            <div>
              <div className="wy-rev-name">{t.name}</div>
              <div className="wy-rev-detail">{t.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// deterministic chapters: the session compressed to its turning points
function buildChapters(events, bars) {
  if (!bars.length) return []
  const fmt = hhmm
  const loBar = bars.reduce((m, b) => (b.l < m.l ? b : m), bars[0])
  // the story is the move that ENDS at the low — anchor at the swing high that
  // preceded it, or chapters open with yesterday's unrelated fade ("12:15Z
  // selling starts" on a crash that began at 22:00)
  const before = bars.filter((b) => b.t <= loBar.t)
  const hiBar = (before.length ? before : bars).reduce((m, b) => (b.h > m.h ? b : m), bars[0])
  const t0 = hiBar.t
  const win = events.filter((e) => e.at >= t0)
  const out = []
  const firstDown = win.find((e) => e.kind === 'impulse_down' && e.at < loBar.t)
  if (firstDown) out.push({ t: firstDown.at, text: `${fmt(firstDown.at)} selling starts` })
  const longFlushes = win.filter((e) => e.kind === 'liquidation_flush' && /of longs/.test(e.text) && e.at <= loBar.t + 30 * 60e3)
  if (longFlushes.length) {
    const total = longFlushes.reduce((a, e) => a + (parseFloat(String(e.text).replace(/^\$/, '')) || 0), 0)
    out.push({ t: longFlushes[0].at, text: `${fmt(longFlushes[0].at)} longs flushed${total ? ` (~$${total.toFixed(0)}M)` : ''}` })
  }
  const culprit = win.filter((e) => e.lane === 'news' && SHOCK_RX.test(e.text)).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))[0]
  if (culprit) out.push({ t: culprit.at, text: `${fmt(culprit.at)} ${culprit.text.length > 46 ? culprit.text.slice(0, 44) + '…' : culprit.text}`, hot: true })
  out.push({ t: loBar.t, text: `${fmt(loBar.t)} low $${Math.round(loBar.l).toLocaleString('en-US')}` })
  const squeeze = win.find((e) => e.kind === 'liquidation_flush' && /of shorts/.test(e.text) && e.at > loBar.t)
  if (squeeze) out.push({ t: squeeze.at, text: `${fmt(squeeze.at)} shorts squeezed` })
  return out.sort((a, b) => a.t - b.t)
}

function EventRow({ ev }) {
  const meta = LANE_META[ev.lane] || { label: ev.lane }
  const tone = toneOf(ev)
  const culprit = ev.lane === 'news' && SHOCK_RX.test(ev.text)
  // the graded importance is 0-1; wire rows carry their upstream 0-100 score
  // in the same slot and ungraded rows coerce to 0 — show the chip only for a
  // real grade, and normalize the emphasis threshold across both scales
  const rawImp = ev.importance
  const imp = rawImp != null && rawImp > 0 && rawImp <= 1 ? rawImp : null
  const macroDecision = ev.lane === 'news' && MACRO_DECISION_RX.test(String(ev.text))
  const hot = macroDecision || (imp != null && imp >= 0.7) || (rawImp != null && rawImp > 1 && rawImp >= 85)
  return (
    <div className={`wy-ev ${hot ? 'wy-ev--hot' : ''}${culprit ? ' wy-ev--culprit' : ''}`}>
      <div className="wy-ev-time">{hhmm(ev.at)}</div>
      <div className="wy-ev-rail"><i className={`wy-dot wy-dot--${culprit ? 'culprit' : tone}${hot ? ' wy-dot--hot' : ''}`} /></div>
      <div className="wy-ev-body">
        <div className="wy-ev-tags">
          <span className="wy-ev-lane">{meta.label}</span>
          {ev.asset ? <span className="wy-ev-asset">{ev.asset}</span> : null}
          {imp != null ? <span className="wy-ev-imp" title="graded importance">{imp.toFixed(2)}</span> : null}
          {culprit ? <span className="wy-ev-culprit-chip">CULPRIT</span> : null}
          {ev.backfilled ? <span className="wy-ev-bf" title="reconstructed from history, not captured live">history</span> : null}
        </div>
        <div className="wy-ev-text">{ev.text}</div>
      </div>
    </div>
  )
}

// One calendar day: what price did, and the handful of things that defined it.
//
// The lower half is deliberately NOT an EventRow list. A row is built for "what
// just happened" — a clock, a lane chip, a dot. A day card is read days later,
// when the time of a headline matters far less than WHO said it and whether
// anyone else carried it. So the emphasis moves to the source.
// The receipt line under a fact (and under the day's headline, which is just
// the promoted top fact). Shared so the two can never drift into disagreeing
// about what evidence a claim carries.
function FactMeta({ ev }) {
  return (
    <div className="wy-dc-fact-meta">
      <span className="wy-dc-lane">{(LANE_META[ev.lane] || { label: ev.lane }).label}</span>
      {/* 🪤 A source badge renders ONLY when we actually hold one. `macro_news`
          has no source column at all (checked the schema, not assumed), so
          inventing a byline here would be a fabricated citation — strictly
          worse than showing none. */}
      {ev.source ? <span className="wy-dc-src">{ev.source}</span> : null}
      {ev.confirmations >= 2 ? (
        <span className="wy-dc-corrob" title="carried by more than one outlet">
          {ev.confirmations} sources
        </span>
      ) : null}
      {ev.assets.map((a) => <span key={a} className="wy-dc-asset">{a}</span>)}
      {ev.backfilled ? (
        <span className="wy-dc-bf" title="reconstructed from history, not captured live">history</span>
      ) : null}
      {ev.url ? (
        <a className="wy-dc-link" href={ev.url} target="_blank" rel="noopener noreferrer">open ↗</a>
      ) : null}
    </div>
  )
}

function DayCard({ day }) {
  const price = day.price
  const up = price?.changePct != null && price.changePct >= 0
  const d = new Date(`${day.date}T12:00:00Z`)
  return (
    <article className="wy-daycard">
      <header className="wy-dc-head">
        <div className="wy-dc-when">
          <span className="wy-dc-date">
            {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          {price ? (
            <span className={`wy-dc-move ${up ? 'up' : 'down'}`}>
              <b>${Math.round(price.close).toLocaleString('en-US')}</b>
              {price.changePct != null ? (
                <i>{up ? '+' : '−'}{Math.abs(price.changePct).toFixed(2)}%</i>
              ) : null}
            </span>
          ) : (
            // No close for this day is a data gap, not a flat tape — say which.
            <span className="wy-dc-move wy-dc-move--none" title="no daily candle for this date">
              price unavailable
            </span>
          )}
        </div>
        <span className="wy-dc-count">
          {day.carried} of {day.total.toLocaleString()} events
        </span>
      </header>

      {day.headline ? (
        <>
          <h3 className="wy-dc-headline">{day.headline.text}</h3>
          {/* The headline is promoted OUT of the fact list (see the route), so
              it has to carry its own receipt — a titled claim with no source is
              exactly the thing this page exists not to do. */}
          <FactMeta ev={day.headline} />
        </>
      ) : null}

      <ul className="wy-dc-facts">
        {day.events.map((ev, i) => (
          <li key={`${ev.at}-${i}`} className={`wy-dc-fact wy-dc-fact--${ev.lane}`}>
            <div className="wy-dc-fact-text">{ev.text}</div>
            {ev.context ? <div className="wy-dc-fact-why">{ev.context}</div> : null}
            <FactMeta ev={ev} />
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function WhyPage() {
  const { state, events, allEvents, allCount, bars, hours, setHours, lane, setLane, loading, updatedAt,
    newestAt, staleBy, stale, truncated, retryBars, daysMode, dayCards, daysLoading } = useWhy()
  // scheduled awareness — countdown only, never outcomes (the FOMC lesson)
  const { next: nextMacro } = useUpcomingMacro()
  // 🪤 Read dayMode from the store, not from a CSS class on the shell — a theme
  // (PRO Glass/Paper) can force day mode without the user's own toggle moving,
  // and the verdict colour below is inline, so CSS can't rescue it either way.
  // the US clock, from the app's single source (see countdownMins)
  const { isOpen: usOpen, countdown: usCountdown } = useUsMarketStatus()
  const usMins = countdownMins(usCountdown)
  // an open inside the next 2h is imminent enough to be the headline fact
  const preOpenSoon = !usOpen && usMins != null && usMins <= 120
  // first 60 minutes of RTH — the countdown is time-to-CLOSE while open
  const firstHour = usOpen && usMins != null && RTH_MINS - usMins <= 60

  const dayMode = useSettingsStore((s) => s.dayMode)
  const raw = BAND[state?.divergence] || BAND.unknown
  const band = dayMode ? { ...raw, color: raw.dayColor, glow: raw.dayGlow } : raw
  const btc = state?.crypto?.BTC
  const eth = state?.crypto?.ETH
  const spx = state?.tape?.SPX
  const ndx = state?.tape?.NDX
  const vix = state?.tape?.VIX
  const posBtc = state?.positioning?.BTC

  // newest first for a live tracker; grouped by day when the window spans days
  const sorted = useMemo(() => [...events].sort((a, b) => b.at - a.at), [events])
  // 🪤 Every row is a glass card carrying its own backdrop-filter, and the
  // repo's own measurements say per-panel backdrop-filter is the jank engine
  // (pro-themes handoff T4). A full 7D window is ~1,100 rows, so paint it in
  // pages. Newest-first ordering means the cap only ever hides OLD history —
  // the present is always in the first page.
  const [shown, setShown] = useState(PAGE_ROWS)
  useEffect(() => { setShown(PAGE_ROWS) }, [hours, lane])

  // 🪤 The session map, the reversal watch and the chapters strip are about the
  // LIVE session — they are not scoped to the timeline window, they just borrow
  // it as a lookback. In day mode `hours` is null, and `Math.min(null, 48)` is
  // ZERO, which cuts every candle and makes all three render nothing. That is
  // the exact silent-vanish failure this file already carries a paragraph about
  // ("where is the 5 point reversal guage? it was great??"). Give them a real
  // lookback instead of the sentinel.
  const liveHours = hours ?? 24

  const groups = useMemo(() => {
    const out = []
    for (const ev of sorted.slice(0, shown)) {
      const day = dayLabel(ev.at)
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, rows: [] })
      out[out.length - 1].rows.push(ev)
    }
    return out
  }, [sorted, shown])

  return (
    <div className="wy-page">
      {/* Masthead in the app's page pattern (kicker → display title → lead),
          the same shape /vitals and the rest of the research surfaces use. The
          words are unchanged — "Why" is the kicker because it names the page,
          and the subject of the page is the sentence under it. */}
      <header className="wy-head">
        <div className="wy-head-lead">
          <span className="wy-kicker">Why</span>
          <h1 className="wy-title">The day, in order</h1>
          <p className="wy-sub">What is moving the market right now — and who did it. Every event is gated before it earns a line; a quiet timeline is a real answer.</p>
        </div>
        {/* 🪤 This badge used to key off `updatedAt` — the moment we last
            POLLED — so it read LIVE the whole time the timeline underneath it
            was three days behind. It now keys off the newest event, which is
            the only clock the reader actually cares about. */}
        <div className={`wy-live ${loading || stale ? 'warm' : ''}`}>
          <i />
          {loading ? 'READING THE TAPE'
            : stale ? `LAST EVENT ${ago(staleBy)} AGO`
              : `LIVE · ${updatedAt ? hhmm(updatedAt) : ''}`}
        </div>
      </header>

      <section className="wy-hero" style={{ '--band': band.color, '--glow': band.glow }}>
        <div className="wy-hero-main">
          <div className="wy-eyebrow">Crypto right now {band.hint ? `· ${band.hint}` : ''}</div>
          <div className="wy-verdict-word">{band.word}</div>
          <p className="wy-verdict-sub">{localizeUtcStamps(state?.read) || 'Reading the tape…'}</p>
          {/* 🪤 This was a bare open/closed binary, so at 09:07 ET on a Monday
              it read "US cash session closed" — technically true, materially
              wrong: the open was 23 minutes away, and the first minutes of the
              US session routinely set the day's range. "Closed" and "opens in
              23m" are different pieces of information and the page has to say
              which one it means. The box already knows (`session.phase: 'pre'`)
              — the UI was throwing that away. */}
          <div className="wy-session">
            <span className={`wy-session-dot ${usOpen ? 'open' : preOpenSoon ? 'soon' : ''}`} />
            {usOpen
              ? `US cash session open${firstHour ? ' · first hour' : state?.session?.phase ? ` · ${state.session.phase.replace('-', ' ')}` : ''}`
              : preOpenSoon
                ? `US cash session opens in ${hhmmFromMins(usMins)}`
                : 'US cash session closed'}
            {state?.generatedAt ? <span className="wy-session-ts"> · brain snapshot {hhmm(Date.parse(state.generatedAt))}</span> : null}
          </div>
          {/* the one scheduled event the tape is waiting on — a countdown, and
              deliberately nothing else: outcomes belong to the wire, after
              they exist */}
          {nextMacro ? (
            <div className={`wy-fed${nextMacro.phase === 'now' ? ' wy-fed--now' : nextMacro.msTo <= 90 * 60e3 ? ' wy-fed--hot' : ''}`}>
              <i className="wy-fed-dot" />
              <span className="wy-fed-name">{nextMacro.short}</span>
              <span className="wy-fed-count">{nextMacro.phase === 'now' ? 'landing now' : `in ${nextMacro.countdown}`}</span>
              <span className="wy-fed-at">{hhmm(nextMacro.at)} local</span>
            </div>
          ) : null}
        </div>
        <div className="wy-hero-chips">
          <TapeChip label="BTC" value={px(btc?.price)} sub={`1h ${pctTxt(btc?.ch1h, 2)} · ${btc?.state || '—'}`} cls={pctClass(btc?.ch1h)} />
          <TapeChip label="ETH" value={px(eth?.price)} sub={`1h ${pctTxt(eth?.ch1h, 2)} · ${eth?.state || '—'}`} cls={pctClass(eth?.ch1h)} />
          <TapeChip label="S&P 500" value={pctTxt(spx?.today, 2)} sub={`30m ${pctTxt(spx?.last30, 2)}`} cls={pctClass(spx?.today)} />
          <TapeChip label="Nasdaq" value={pctTxt(ndx?.today, 2)} sub={`30m ${pctTxt(ndx?.last30, 2)}`} cls={pctClass(ndx?.today)} />
          <TapeChip label="VIX" value={pctTxt(vix?.today, 1)} sub={`30m ${pctTxt(vix?.last30, 1)}`} cls={pctClass(vix?.today != null ? -vix.today : null)} />
          <TapeChip label="Crowd" value={posBtc ? `${posBtc.long_pct?.toFixed(0)}% long` : '—'} sub={posBtc ? `BTC L/S ${posBtc.long_short?.toFixed(2)}` : ''} cls="neu" />
        </div>
      </section>

      {/* The freshest KEY headline of the last 2h, pinned — the newest-first
          timeline buries a marquee print under routine tape rows within
          minutes of it landing. */}
      {(() => {
        const now = Date.now()
        const pool = allEvents.filter((e) => e.lane === 'news' && !e.backfilled && e.at >= now - 2 * 3600e3 && e.at <= now
          && (SHOCK_RX.test(String(e.text)) || MACRO_DECISION_RX.test(String(e.text))))
        if (!pool.length) return null
        const score = (e) => (e.importance == null ? 0 : e.importance <= 1 ? e.importance * 100 : e.importance)
        const top = [...pool].sort((a, b) => score(b) - score(a) || b.at - a.at)[0]
        return (
          <section className="wy-landed">
            <span className="wy-landed-tag"><i />JUST LANDED · {hhmm(top.at)}</span>
            <p className="wy-landed-text">{top.text}</p>
          </section>
        )
      })()}

      {/* The desk note. Deliberately BELOW the deterministic verdict + read:
          those are computed and safe to quote, this is the interpretation. It
          is grounded strictly in the same gated context, but it is written by a
          model, and the labelling says so. */}
      {state?.narrative ? (
        <section className="wy-note">
          <div className="wy-note-head">
            <span className="wy-map-title">The desk note</span>
            <span className="wy-note-tag" title={state.narrativeModel || ''}>
              written from the gated data
              {state.narrativeAt ? ` · as of ${hhmm(Date.parse(state.narrativeAt))}` : ''}
            </span>
          </div>
          {/* The RESOLVED driver — computed deterministically on the box
              BEFORE the model wrote a word (materiality ladder), so this
              label and the prose below can never disagree. When the box
              found nothing that clears the bar, say that plainly: an honest
              "no driver" is a real answer, not a missing one. */}
          {state.narrativeDriver?.story ? (
            <div className="wy-note-driver">
              <span className="wy-note-driver-k">Driver</span>
              <span className="wy-note-driver-t">{state.narrativeDriver.story}</span>
              {state.narrativeDriver.hours_standing != null ? (
                <span className="wy-note-driver-s">
                  on the wire {state.narrativeDriver.hours_standing}h
                  {state.narrativeDriver.corroborated ? ' · corroborated' : ''}
                </span>
              ) : null}
            </div>
          ) : state.narrativeNoCatalyst ? (
            <div className="wy-note-driver wy-note-driver--none">
              <span className="wy-note-driver-k">Driver</span>
              <span className="wy-note-driver-t">Nothing on our wires clears the bar to be called the cause — the note reads the positioning instead.</span>
            </div>
          ) : null}
          {String(state.narrative).split(/\n{2,}/).map((p, i) => (
            <p key={i} className="wy-note-p">{localizeUtcStamps(p.trim())}</p>
          ))}
        </section>
      ) : null}

      {(() => {
        const ch = buildChapters(allEvents, bars.filter((b) => b.t >= Date.now() - Math.min(liveHours, 48) * 3600e3))
        return ch.length >= 3 ? (
          <div className="wy-chapters">
            {ch.map((c, i) => (
              <React.Fragment key={c.t + c.text}>
                {i > 0 ? <span className="wy-ch-arrow">→</span> : null}
                <span className={`wy-ch${c.hot ? ' wy-ch--hot' : ''}`}>{c.text}</span>
              </React.Fragment>
            ))}
          </div>
        ) : null
      })()}

      {/* Below the fold the page splits: the event stream is the main
          column, the session evidence (48h gauge, annotated map, exhaustion
          watch) is the rail. The rail is NOT sticky — on a live session it
          runs taller than the viewport, and a sticky box taller than the
          screen pins its own bottom out of reach. Under 1080px the grid
          collapses and CSS lifts the rail back above the stream, which is
          the reading order the single-column page always had. */}
      <div className="wy-grid">
        <div className="wy-main">
        <div className="wy-controls">
          {/* Lane filtering belongs to the event stream. The day view already
              balances its lanes server-side (round-robin, so a loud wire day
              still shows the price impulse), and letting a stale 'news' filter
              silently empty every card would look like a broken feed. */}
          <div className="wy-lanes">
            {LANES.map((l) => (
              <button
                key={l.key}
                className={`wy-pill ${lane === l.key ? 'on' : ''}`}
                onClick={() => setLane(l.key)}
                disabled={daysMode}
                title={daysMode ? 'Lane filters apply to the live timeline' : undefined}
              >{l.label}</button>
            ))}
          </div>
          <div className="wy-windows">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                className={`wy-pill ${(w.mode === 'days' ? daysMode : hours === w.hours) ? 'on' : ''}`}
                onClick={() => setHours(w.mode === 'days' ? null : w.hours)}
              >{w.label}</button>
            ))}
          </div>
        </div>

        {daysMode ? (
          !dayCards ? (
            daysLoading ? <div className="wy-daycards-load animate-shimmer" /> : null
          ) : dayCards.days.length === 0 ? (
            <div className="wy-quiet">
              <div className="wy-quiet-word">No days on record.</div>
              <p>The recorder has written nothing in this window.</p>
            </div>
          ) : (
            <>
              <section className="wy-daycards">
                {dayCards.days.map((d) => <DayCard key={d.date} day={d} />)}
              </section>
              {/* The recorder started 2026-07-27 and backfilled a week behind it,
                  so a 30-day request is NOT 30 days of coverage. Name where the
                  record begins — otherwise the absence of older cards reads as a
                  month of quiet markets. */}
              {dayCards.oldest ? (
                <div className="wy-more-note">
                  The record begins {new Date(`${dayCards.oldest}T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.
                  Earlier days aren’t quiet — they’re before the recorder.
                </div>
              ) : null}
            </>
          )
        ) : !loading && allCount === 0 ? (
          <div className="wy-quiet">
            <div className="wy-quiet-word">Nothing happened.</div>
            <p>No gated event in this window — no impulse, no tape turn, no forced flow, no headline that survived the filters. That is a real answer, not a missing one.</p>
          </div>
        ) : (
          <>
            {/* The tape has produced nothing for a while. Say it out loud at the
                top of the list — a timeline whose first row is hours old looks
                exactly like a live one, and that is how this page spent three
                days showing 31 Jul on 3 Aug. No claim about the CAUSE: a dead
                weekend tape and a stalled feed are indistinguishable from here. */}
            {stale && newestAt ? (
              <div className="wy-stale">
                <span className="wy-stale-dot" />
                <span>
                  <b>No new event for {ago(staleBy)}.</b> The newest thing on this
                  timeline landed at {hhmm(newestAt)} — either the tape is genuinely
                  quiet or the feed has stalled. Nothing below is happening now.
                </span>
              </div>
            ) : null}

            <section className="wy-timeline">
              {groups.map((g) => (
                <div key={g.day} className="wy-day">
                  <div className="wy-day-label">{g.day}</div>
                  {g.rows.map((ev, i) => <EventRow key={`${ev.at}-${i}`} ev={ev} />)}
                </div>
              ))}
            </section>

            {sorted.length > shown ? (
              <button className="wy-more" onClick={() => setShown((n) => n + PAGE_ROWS)}>
                Show earlier · {sorted.length - shown} more in this window
              </button>
            ) : truncated ? (
              <div className="wy-more-note">
                Showing the most recent {allCount.toLocaleString()} events in this
                window — older ones are trimmed, never newer.
              </div>
            ) : null}
          </>
        )}
        </div>

        <aside className="wy-rail">
          <div className="wy-panel">
            <WhyTimelineGauge
              events={allEvents}
              isKey={(e) => e.lane === 'news' && (SHOCK_RX.test(String(e.text)) || MACRO_DECISION_RX.test(String(e.text)))}
            />
          </div>
        {/* 🪤 The session map, the reversal watch AND the chapters strip all
            render from `bars`, and all three return null when it is empty — so a
            single failed /ohlcv call made three of the page's best panels
            SILENTLY VANISH, which reads as "you deleted my feature" rather than
            "a fetch failed" (founder, 2026-08-03: "where is the 5 point reversal
            guage? it was great?? dont remove it").
            That endpoint is uncached on the box and measures ~16s cold (0.1s
            warm), so it is genuinely fragile: one slow spell past the 30s ceiling
            trips the service-layer failure cooldown, and on a COLD session there
            is no stale payload to fall back on.
            Say so instead of disappearing. Deliberately NOT painting from a
            persisted seed: this panel carries a live price label, and a stale
            chart wearing a live label is the exact dishonesty the rest of this
            page exists to avoid. */}
        {!loading && !bars.length ? (
          <div className="wy-nobars">
            <div className="wy-nobars-head">Session tape unavailable</div>
            <p>
              The exchange candle feed didn’t answer, so the annotated session map
              and the 5-point reversal watch can’t be drawn — they need real
              candles, and this page will not draw them from anything else.
            </p>
            <button className="wy-nobars-retry" onClick={retryBars}>Try again</button>
          </div>
        ) : (
          <>
            <SessionMap bars={bars} events={allEvents} driver={state?.overnight_driver} hours={liveHours} />
            <ReversalWatch bars={bars} events={allEvents} hours={liveHours} published={state?.exhaustion} />
          </>
        )}
        </aside>
      </div>

      <footer className="wy-foot">
        ⌁ Spectre Intelligence · every event is gated (unit artifacts quarantined, self-describing headlines and rhetoric rejected) · all times are your local clock · “history” rows were reconstructed, not captured live
      </footer>
    </div>
  )
}
