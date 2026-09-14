/**
 * X INTEL — the Signal Desk.
 *
 * X Dash is exploration (who's talking, what's moving). X Intel is action:
 * one page that answers "what do I act on right now, and why should I trust
 * it" — with receipts on every claim. Four surfaces:
 *
 *   SIGNALS  — the action feed (Early Runner lane + breakout radar)
 *   RUNNERS  — the attention board re-scored, receipts stamped on live rows
 *   RECEIPTS — the proof wall (win rates, best calls, honest misses)
 *   MAP      — attention condensation (breadth × velocity quadrant)
 *
 * Tabs are lazy; polling is gentle (120s), hidden/idle-guarded, and shared
 * through the X Dash surface caches.
 */
import { Suspense, useState, useEffect } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useEarlyRunners } from './use-x-intel-data'
import { fmtAgo, fmtPct, XiShimmer } from './xi-bits'
import './x-intel-page.css'
import './x-intel-page.day-mode.css'
import './x-intel-page.mobile.css'

const XiSignals = lazy(() => import('./xi-signals'))
const XiRunners = lazy(() => import('./xi-runners'))
const XiLifecycle = lazy(() => import('./xi-lifecycle'))
const XiReceipts = lazy(() => import('./xi-receipts'))
const XiMap = lazy(() => import('./xi-map'))

const TABS = [
  { key: 'signals', label: 'Signals', Component: XiSignals },
  { key: 'runners', label: 'Runners', Component: XiRunners },
  { key: 'lifecycle', label: 'Smart Money', Component: XiLifecycle }, // Nansen wallet lane
  { key: 'receipts', label: 'Receipts', Component: XiReceipts },
  { key: 'map', label: 'Map', Component: XiMap },
]

const DAY_MS = 24 * 60 * 60 * 1000

function DeskStrip() {
  const { confirmed, candidates, summary, generatedTs, loading } = useEarlyRunners()
  const liveCount = summary?.confirmed ?? (confirmed.length || null)
  const freshCount = confirmed.filter((r) => r.confirmedTs && Date.now() - r.confirmedTs < DAY_MS).length
  const g24 = summary?.grading?.h24

  if (loading && !summary) {
    return (
      <div className="xi-strip">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`xi-strip__tile xi-strip__tile--loading animate-shimmer stagger-${i + 1}`} />
        ))}
      </div>
    )
  }
  if (!summary && !confirmed.length) return null

  return (
    <div className="xi-strip">
      <div className="xi-strip__tile">
        <span className="xi-strip__num xi-num">{liveCount ?? '—'}</span>
        <span className="xi-strip__label">confirmed runners live</span>
      </div>
      <div className="xi-strip__tile">
        <span className="xi-strip__num xi-num">{freshCount}</span>
        <span className="xi-strip__label">confirmed in the last 24h</span>
      </div>
      <div className="xi-strip__tile">
        <span className="xi-strip__num xi-num">{summary?.candidates ?? candidates.length}</span>
        <span className="xi-strip__label">brewing on X</span>
      </div>
      <div className="xi-strip__tile">
        {g24?.graded ? (
          <>
            <span className="xi-strip__num xi-num">{g24.hit_rate}%</span>
            <span className="xi-strip__label">hit at +24h ({g24.hits}/{g24.graded}{g24.avg_return_pct != null ? ` · avg ${fmtPct(g24.avg_return_pct)}` : ''})</span>
          </>
        ) : (
          <>
            <span className="xi-strip__num xi-strip__num--muted">armed</span>
            <span className="xi-strip__label">self-grading at +24/48/72h</span>
          </>
        )}
      </div>
      {generatedTs ? <span className="xi-strip__stamp">{fmtAgo(generatedTs)}</span> : null}
    </div>
  )
}

export default function XIntelPage() {
  const [tab, setTab] = useState('signals')

  // Warm the Smart Money board while the user reads Signals — the box route
  // is seconds cold but ~0.3s behind its 60s server cache, so the tab click
  // lands warm. Fire-and-forget; params mirror useLifecycle exactly.
  useEffect(() => {
    const id = setTimeout(() => {
      fetch('/data-api/v1/intel/lifecycle?limit=60&source=trending').catch(() => {})
    }, 800)
    return () => clearTimeout(id)
  }, [])
  const active = TABS.find((t) => t.key === tab) || TABS[0]
  const ActiveComponent = active.Component

  return (
    <div className="xi-desk">
      <header className="xi-masthead">
        <div className="xi-masthead__row">
          <span className="xi-masthead__eyebrow">X Intel</span>
          <span className="xi-live">
            <span className="xi-live__dot" />
            live
          </span>
        </div>
        <h1 className="xi-masthead__title">The Signal Desk</h1>
        <p className="xi-masthead__sub">
          What to act on right now — and why you can trust it. Every claim on this page carries a receipt.
        </p>
      </header>

      <DeskStrip />

      <nav className="xi-tabs" role="tablist" aria-label="Signal desk views">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`xi-tab${tab === t.key ? ' xi-tab--on' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="xi-body">
        <Suspense fallback={<XiShimmer variant="card" count={6} />}>
          <ActiveComponent />
        </Suspense>
      </main>
    </div>
  )
}
