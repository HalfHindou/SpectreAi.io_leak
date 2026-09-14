/**
 * Brain — Eagle Eye.
 *
 * The redesigned Spectre Brain page: a single command deck, not a toggle between
 * two half-products. The hero pairs the living Eye with THE READ — the Brain's
 * synthesized market view (regime, stance, thesis, what flips it, its 4-clock
 * coherence). A credibility strip under it states the thing a pure social
 * terminal like aixbt cannot: its OWN proven hit-rate. Below sit Convergence,
 * the Board, Market Intel, and the omni-domain awareness grid.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import useBrainMind from './use-brain-mind'
import useBrainDesk from './use-brain-desk'
import { useBrainAwareness } from './use-brain-awareness'
import BrainAwarenessGrid from './brain-awareness-grid'
import BrainEye from './brain-eye'
import BrainConvergence from './brain-convergence'
import BrainIntel from './brain-intel'
import BrainBoard from './brain-board'
import BrainHunterRail from './brain-hunter-rail'
import BrainProofStrip from './brain-proof-strip'
import BrainBottomLine from './brain-bottom-line'
import BrainWeekAhead from './brain-week-ahead'
import BrainWorld from './brain-world'
import BrainPatterns from './brain-patterns'
import BrainSituations from './brain-situations'
import BrainSetups from './brain-setups'
import BrainIdeaBook from './brain-idea-book'
import BrainPaperBook from './brain-paper-book'
import { useBrainAsk, BrainAskInput, BrainAskPanel } from './brain-ask'
import lazyWithRetry from '@/lib/lazy-with-retry'
import './brain-eagle.css'

/* The Observatory — lazy (retry-hardened against stale-SW chunk failures)
   so the canvas engine stays off the desk-tab path. */
const BrainMindMap = lazyWithRetry(() => import('./brain-mind-map'))
const BrainCortex = lazyWithRetry(() => import('./brain-cortex'))

/* Feature-level boundary: a Mind failure must never blank the page silently. */
class MindBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return (
        <div className="be-mind-fail">
          The Mind view hit a stale bundle. <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

function ago(ts) {
  if (!ts) return null
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

/* ── Header health: LIVE is a claim, so it needs evidence ─────────────────────
   Two independent facts decide the pill (the Traders Corner doctrine — only a
   real HTTP response is evidence, and data age comes from the payload's own
   timestamps, never from receive time):
   - reachable: a poll actually got a 2xx recently (lastOkAt from the hooks)
   - fresh: the newest ENGINE timestamp (mind/desk generated_at) is inside the
     desk's own cadence tolerance
   Dead network → "offline". Answering network serving an old read → "stale".
   Anything else must not wear a green dot. */
const REACHABLE_MS = 8 * 60_000
const DATA_STALE_MS = 35 * 60_000

function toMs(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

function computeHealth({ mind, deskUpdatedAt, deskOkAt, awareness }) {
  const now = Date.now()
  const mindTs = toMs(mind.updatedAt)
  const deskTs = toMs(deskUpdatedAt)
  const primary = Math.max(mindTs, deskTs)
  const lastOk = Math.max(mind.lastOkAt || 0, deskOkAt || 0, awareness.lastUpdated || 0)
  if (!lastOk && !primary) return { status: null }
  const detail = [
    mindTs ? `read ${ago(mindTs)}` : 'read: no timestamp',
    deskTs ? `desk ${ago(deskTs)}` : 'desk: no timestamp',
    awareness.generatedAt ? `awareness ${ago(awareness.generatedAt)}` : null,
    lastOk ? `last response ${ago(lastOk)}` : 'no successful response yet',
  ].filter(Boolean).join(' · ')
  if (!lastOk || now - lastOk > REACHABLE_MS) {
    return { status: 'offline', detail, updatedTs: primary || null }
  }
  if (!primary || now - primary > DATA_STALE_MS) {
    return { status: 'stale', detail, updatedTs: primary || null, age: primary ? ago(primary) : null }
  }
  return { status: 'live', detail, updatedTs: primary }
}

/* ── Read-band middle: live market density (majors + pulse + top stacks) ──── */
const MAJORS = ['BTC', 'ETH', 'SOL']

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const a = Math.abs(n)
  const dp = a >= 1000 ? 0 : a >= 1 ? 2 : 4
  return n.toLocaleString('en-US', { maximumFractionDigits: dp })
}
function fmtPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}
function toneOf(dir) {
  if (dir === 'bull' || dir > 0.05) return 'be-bull'
  if (dir === 'bear' || dir < -0.05) return 'be-bear'
  return 'be-neutral'
}
function dirArrow(d) { return d === 'bull' ? '▲' : d === 'bear' ? '▼' : '→' }
function assetTicker(a) {
  const raw = String(a || '').trim().replace(/^\$/, '')
  if (!raw) return ''
  const isTicker = raw.length <= 6 && raw === raw.toUpperCase() && /^[A-Z0-9]+$/.test(raw)
  return isTicker ? `$${raw}` : raw
}

/* BTC/ETH/SOL price + 24h change, null cells dropped. */
function majorCells(marketPulse, chartReads) {
  return MAJORS.map((sym) => {
    const mp = marketPulse && typeof marketPulse[sym] === 'object' ? marketPulse[sym] : null
    const cr = chartReads && typeof chartReads[sym] === 'object' ? chartReads[sym] : null
    const px = fmtNum(mp?.px ?? cr?.px)
    if (!px) return null
    const chgRaw = mp?.chg_24h_pct
    return { sym, px, chg: fmtPct(chgRaw), tone: toneOf(Number(chgRaw)) }
  }).filter(Boolean)
}

/* "BTC EVENT: … LIKELY DRIVERS: \"headline\"" → { head, driver }. */
function parseEvent(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const s = raw.trim().replace(/\s+/g, ' ')
  const idx = s.search(/LIKELY DRIVERS/i)
  const head = (idx >= 0 ? s.slice(0, idx) : s)
    .replace(/\bEVENT:\s*/i, '')
    .replace(/[\s—–-]+$/, '')
    .trim()
  if (!head) return null
  let driver = null
  if (idx >= 0) {
    const m = s.slice(idx).match(/"([^"]+)"/)
    if (m) driver = m[1].trim()
  }
  return { head, driver }
}
function pulseEvents(marketPulse) {
  if (!marketPulse) return []
  const raw = Array.isArray(marketPulse.events)
    ? marketPulse.events
    : MAJORS.map((s) => (marketPulse[s] && typeof marketPulse[s] === 'object' ? marketPulse[s].event : null))
  return raw.map(parseEvent).filter(Boolean).slice(0, 2)
}

function MajorsStrip({ cells }) {
  return (
    <div className="be-majors" role="group" aria-label="majors">
      {cells.map((c) => (
        <div key={c.sym} className="be-major">
          <span className="be-major-sym">{c.sym}</span>
          <span className="be-major-px">{c.px}</span>
          {c.chg && <span className={`be-major-chg ${c.tone}`}>{c.chg}</span>}
        </div>
      ))}
    </div>
  )
}

function PulseLines({ events }) {
  return (
    <div className="be-pulses">
      {events.map((e, i) => (
        <div key={i} className="be-pulse-line">
          <div className="be-pulse-head">
            <span className="be-pulse-tag">Event</span>
            <span className="be-pulse-text">{e.head}</span>
          </div>
          {e.driver && <span className="be-pulse-driver">&ldquo;{e.driver}&rdquo;</span>}
        </div>
      ))}
    </div>
  )
}

function fmtCap(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${Math.round(n / 1e3)}K`
}

function TopStacks({ rows }) {
  return (
    <div className="be-stacks">
      {rows.map((r, i) => {
        const lvl = fmtNum(r.key_level)
        const conv = Number(r.conviction)
        // altitude context: a non-major always states its size so a $2M
        // attention token never reads like a peer of ETH.
        const cap = r.altitude && r.altitude !== 'major' ? fmtCap(r.market_cap) : null
        const micro = r.altitude === 'micro' || r.altitude === 'small'
        return (
          <div key={r.asset ? `${r.asset}-${i}` : i} className="be-stack">
            <span className="be-stack-asset">{assetTicker(r.asset)}</span>
            <span className={`be-stack-arrow ${toneOf(r.direction)}`}>{dirArrow(r.direction)}</span>
            {Number.isFinite(conv) && <span className="be-stack-conv">{Math.round(conv)}</span>}
            {(cap || micro) && (
              <span className={`be-stack-cap${micro ? ' be-stack-cap--micro' : ''}`}>
                {cap || 'attention lane'}{micro && cap ? ' play' : ''}
              </span>
            )}
            {lvl && (
              <>
                <span className="be-stack-dot">·</span>
                <span className="be-stack-lvl"><span className="be-stack-lbl">key level</span> {lvl}</span>
              </>
            )}
            {r.horizon && (
              <>
                <span className="be-stack-dot">·</span>
                <span className="be-stack-hz">{r.horizon}</span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* The dense live middle — flows after the thesis, foot stays pinned below it. */
function ReadMiddle({ marketPulse, chartReads, convergence }) {
  const cells = majorCells(marketPulse, chartReads)
  const events = pulseEvents(marketPulse)
  const stacks = (Array.isArray(convergence) ? convergence : []).slice(0, 3)
  if (!cells.length && !events.length && !stacks.length) return null
  return (
    <div className="be-mid">
      {cells.length > 0 && <MajorsStrip cells={cells} />}
      {events.length > 0 && <PulseLines events={events} />}
      {stacks.length > 0 && <TopStacks rows={stacks} />}
    </div>
  )
}

/* pulse → wave → tide → ocean, with an honest coherence read. */
function ClockStrip({ clocks, coherent }) {
  if (!clocks?.length) return null
  const known = clocks.filter((c) => c.stance)
  return (
    <div className="be-clocks" role="group" aria-label="multi-timeframe stance">
      <span className="be-clocks-label">4 clocks</span>
      <div className="be-clocks-row">
        {clocks.map((c) => (
          <span key={c.tier} className={`be-clock be-${c.tone}`} title={`${c.label} (${c.horizon}) — ${c.stance || 'no read'}`}>
            <span className="be-clock-name">{c.label}</span>
            <span className="be-clock-arrow">{c.arrow}</span>
          </span>
        ))}
      </div>
      {known.length >= 2 && (
        <span className={`be-coherence ${coherent ? 'be-coherence--yes' : 'be-coherence--no'}`}>
          {coherent ? 'coherent' : 'split'}
        </span>
      )}
    </div>
  )
}

/* Pulse a cell once when its value changes on a data refresh. */
function usePulse(value) {
  const [pulse, setPulse] = useState(false)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current !== undefined && prev.current !== value) {
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 900)
      prev.current = value
      return () => clearTimeout(t)
    }
    prev.current = value
  }, [value])
  return pulse
}

function ConvictionDial({ value, tone }) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
  const pulse = usePulse(pct)
  return (
    <div className="be-dial">
      <span className="be-dial-label">Conviction</span>
      <div className="be-dial-bar">
        <i className={`be-${tone}`} style={{ width: pct == null ? '0%' : `${pct}%` }} />
      </div>
      <span className={`be-dial-val${pulse ? ' be-pulse' : ''}`}>{pct == null ? '—' : pct}</span>
    </div>
  )
}

/* THE READ — the Brain's synthesized view, rendered beside the Eye. */
function ReadBand({ mind, marketPulse, chartReads, convergence }) {
  const { loading, read, clocks, coherent, updatedAt } = mind
  const stancePulse = usePulse(read?.stanceLabel)
  if (loading && !read) {
    return (
      <aside className="be-read be-read--loading">
        <div className="sk be-sk" style={{ width: '38%', height: 12 }} />
        <div className="sk be-sk" style={{ width: '70%', height: 26 }} />
        <div className="sk be-sk" style={{ width: '92%' }} />
        <div className="sk be-sk" style={{ width: '64%' }} />
      </aside>
    )
  }
  if (!read) {
    return (
      <aside className="be-read be-read--empty">
        The Brain's read is warming up. The omni-domain awareness below stands on its own.
      </aside>
    )
  }
  return (
    <aside className={`be-read be-${read.tone}`}>
      <div className="be-read-top">
        {read.regime && <span className="be-regime">{read.regime}</span>}
        {updatedAt && <span className="be-read-ts">{ago(updatedAt)}</span>}
      </div>
      <span className={`be-stance${stancePulse ? ' be-pulse' : ''}`}>{read.stanceLabel}</span>
      {read.thesis && <p className="be-thesis">{read.thesis}</p>}
      {read.flip && (
        <p className="be-flip"><span className="be-flip-tag">flips if</span> {read.flip}</p>
      )}
      <ReadMiddle marketPulse={marketPulse} chartReads={chartReads} convergence={convergence} />
      <div className="be-read-foot">
        <ClockStrip clocks={clocks} coherent={coherent} />
        <ConvictionDial value={read.conviction} tone={read.tone} />
      </div>
    </aside>
  )
}

/* Reveal-on-scroll — fadeInUp once, IntersectionObserver. */
function Reveal({ children, className = '' }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect() }
    }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return (
    <div ref={ref} className={`be-reveal${seen ? ' be-reveal--in' : ''} ${className}`}>
      {children}
    </div>
  )
}

export default function BrainEagle({ dayMode }) {
  const mind = useBrainMind()
  const awareness = useBrainAwareness()
  const ask = useBrainAsk()
  const desk = useBrainDesk()
  const { dataHealth, marketPulse, chartReads, convergence, updatedAt: deskUpdatedAt, lastOkAt: deskOkAt, source: deskSource } = desk
  const [tab, setTab] = useState(() => {
    try {
      const t = sessionStorage.getItem('spectre-brain-tab')
      return t === 'mind' || t === 'cortex' ? t : 'desk'
    } catch { return 'desk' }
  })
  const switchTab = (t) => {
    setTab(t)
    try { sessionStorage.setItem('spectre-brain-tab', t) } catch { /* private mode */ }
  }
  const health = useMemo(
    () => computeHealth({ mind, deskUpdatedAt, deskOkAt, awareness }),
    [mind, deskUpdatedAt, deskOkAt, awareness],
  )
  const updated = useMemo(() => ago(health.updatedTs), [health.updatedTs])
  const degraded = dataHealth?.status === 'degraded'
  const healthTitle = degraded
    ? (dataHealth.issues || []).map((i) => `${i.source}${i.asset ? ` ${i.asset}` : ''}: ${i.status}${i.drift_pct != null ? ` ${i.drift_pct}%` : ''}${i.note ? ` — ${i.note}` : ''}`).join('\n')
    : ''

  return (
    <div className={`be-page${tab === 'mind' || tab === 'cortex' ? ' be-page--mind' : ''} ${dayMode ? 'app-day-mode-scope' : ''}`}>
      <header className="be-head">
        <div className="be-head-brand">
          <img src="/round-logo.png" alt="" className="be-mark-logo" aria-hidden />
          <span className="be-title">Spectre Brain</span>
        </div>
        <div className="be-tabs" role="tablist" aria-label="brain views">
          <button type="button" role="tab" aria-selected={tab === 'desk'} className={`be-tab${tab === 'desk' ? ' be-tab--on' : ''}`} onClick={() => switchTab('desk')}>Desk</button>
          <button type="button" role="tab" aria-selected={tab === 'mind'} className={`be-tab${tab === 'mind' ? ' be-tab--on' : ''}`} onClick={() => switchTab('mind')}>Mind</button>
          <button type="button" role="tab" aria-selected={tab === 'cortex'} className={`be-tab${tab === 'cortex' ? ' be-tab--on' : ''}`} onClick={() => switchTab('cortex')}>Cortex</button>
        </div>
        <BrainAskInput ask={ask} />
        <div className="be-head-meta">
          {health.status === 'live' && (
            <span className="be-live" title={health.detail}><span className="be-live-dot" />live</span>
          )}
          {health.status === 'stale' && (
            <span className="be-live be-live--stale" title={health.detail}>
              <span className="be-live-dot" />stale{health.age ? ` · ${health.age}` : ''}
            </span>
          )}
          {health.status === 'offline' && (
            <span className="be-live be-live--offline" title={health.detail}>
              <span className="be-live-dot" />offline — showing last data
            </span>
          )}
          {deskSource === 'static' && (
            <span className="be-live be-live--stale" title="The desk feed fell back to a bundled snapshot; its numbers are not live.">
              cached snapshot
            </span>
          )}
          {degraded && (
            <span className="be-datahealth" title={healthTitle}>
              <span className="be-datahealth-dot" />degraded feed — compensating
            </span>
          )}
          {updated && <span className="be-updated">updated {updated}</span>}
          <button type="button" className="be-refresh" onClick={() => { mind.refetch(); awareness.refresh?.() }}>Refresh</button>
        </div>
      </header>

      <BrainAskPanel ask={ask} />

      {tab === 'cortex' ? (
        <MindBoundary>
          <React.Suspense fallback={<div className="be-mind-sk" />}>
            <BrainCortex
              onDive={(id) => {
                // hand the focus to the sky: the Mind map reads this once on
                // mount, selects the node and flies to it
                try { sessionStorage.setItem('spectre-brain-focus', id) } catch { /* no-op */ }
                switchTab('mind')
              }}
            />
          </React.Suspense>
        </MindBoundary>
      ) : tab === 'mind' ? (
        <MindBoundary>
          <React.Suspense fallback={<div className="be-mind-sk" />}>
            <BrainMindMap dayMode={dayMode} />
          </React.Suspense>
        </MindBoundary>
      ) : (
        <>
          <div className="be-hero">
            <BrainEye mind={mind} awareness={awareness.data} desk={desk} health={health} />
            <ReadBand mind={mind} marketPulse={marketPulse} chartReads={chartReads} convergence={convergence} />
          </div>

          <BrainBottomLine />

          <BrainWeekAhead />

          <BrainWorld />

          <BrainProofStrip hitRate={mind.hitRate} />

          <BrainPatterns />

          <Reveal><BrainSetups /></Reveal>

          <Reveal><BrainIdeaBook /></Reveal>

          <Reveal><BrainPaperBook /></Reveal>

          <Reveal><BrainConvergence /></Reveal>

          {/* Board + the Hunter rail. DOM order rail→board so below 1200 the rail is a
              strip between Convergence and Board; ≥1200 the grid seats it right of Board. */}
          <Reveal className="be-board-grid">
            <BrainHunterRail />
            <BrainBoard />
          </Reveal>

          <Reveal><BrainSituations /></Reveal>

          <Reveal><BrainIntel /></Reveal>

          <BrainAwarenessGrid data={awareness.data} loading={awareness.loading} lastUpdated={awareness.lastUpdated} />
        </>
      )}

      <div className="be-disclaimer">For informational purposes only. Not financial advice. Do your own research.</div>
    </div>
  )
}
