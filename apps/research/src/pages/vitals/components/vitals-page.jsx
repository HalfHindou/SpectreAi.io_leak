/**
 * vitals-page.jsx — VITALS index: platform fundamentals.
 *
 * Compartmentalised, not a scroll. One segmented control switches between
 * Overview / Boards / Compare / Sectors / First-hand / Sources, so each view is
 * a screen rather than a stop on a five-thousand-pixel page.
 */

import { useMemo, useState } from 'react'
import { useVitals, useVitalsBoard } from './use-vitals'
import VtTide from './vt-tide'
import VtLadder from './vt-ladder'
import VtMovers from './vt-movers'
import VtCoins from './vt-coins'
import VtFloor from './vt-floor'
import VtCategories from './vt-categories'
import VtCompare from './vt-compare'
import VtSearch from './vt-search'
import VtSeg from './vt-seg'
import { usd, count, shortDate, daysAgo } from './vt-format'
import './vitals-page.css'
import './vitals-page.day-mode.css'
import './vitals-page.mobile.css'

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'boards', label: 'Boards' },
  { id: 'compare', label: 'Compare' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'firsthand', label: 'First-hand', dot: true },
  { id: 'sources', label: 'Sources' },
]

/**
 * The coverage caveat, rendered wherever a first-hand number is on screen.
 * It is not a footnote: a Hyperliquid-only trader count for a Solana-first app
 * is a fraction of the truth, and the reader has to be told at the number.
 */
function ScopeNote({ scope }) {
  if (!scope?.partial) return null
  // One line. The long-form explanation lives in Sources, not on top of the data.
  return (
    <div className="vt-scopewarn">
      <span className="vt-chip vt-chip--scope">partial</span>
      <span>Perps fills only — a spot-first app shows a slice here, not its total.</span>
    </div>
  )
}

export default function VitalsPage() {
  const { bundle, loading, error, refreshing, reload } = useVitals()
  const [view, setView] = useState('overview')
  const [category, setCategory] = useState(null)
  // Held here, not inside VtLadder, so the metric survives the Overview -> Boards
  // hand-off (they are two instances of the same component).
  const [metric, setMetric] = useState('fees')

  const { board: catBoard, loading: catLoading } = useVitalsBoard({
    metric: 'fees', category, enabled: !!category, limit: 25,
  })

  const ladders = useMemo(() => {
    if (!category) return bundle?.ladders
    return { ...(bundle?.ladders || {}), fees: catBoard || bundle?.ladders?.fees }
  }, [bundle, category, catBoard])

  const scope = bundle?.firstHandScope
  const fhAge = daysAgo(bundle?.totals?.firstHandDay)

  return (
    <div className="vt-page">
      <header className="vt-masthead">
        <div className="vt-masthead__lead">
          <span className="vt-eyebrow">Vitals</span>
          <h1>Platform fundamentals</h1>
          <p>
            Revenue, users, volume and TVL for every platform we can measure — plus the metrics
            no data vendor sells: who actually traded, and whether they made money.
          </p>
        </div>
        <VtSearch />
      </header>

      <VtSeg items={VIEWS} value={view} onChange={setView} label="Vitals view" />

      {error && !bundle ? (
        <div className="vt-error">
          <p>Vitals could not reach its sources.</p>
          <button type="button" className="vt-pill" onClick={reload}>Try again</button>
        </div>
      ) : null}

      {/* Levels, then the derivative, then the thing no fee board can answer.
          The first screen used to be one chart and one board, both of them
          levels — and a level barely moves week to week, so a returning reader
          saw the same page every time. */}
      {view === 'overview' ? (
        <>
          <VtTide
            tide={bundle?.hero?.tide}
            stacks={bundle?.hero?.stacks}
            totals={bundle?.totals}
            /* not totals.tracked: that counts platforms we follow, this counts
               the ones that actually reported a fee in the window */
            boardTotal={bundle?.ladders?.fees?.total}
            loading={loading}
          />
          <VtLadder ladders={ladders} loading={loading} compact
            metric={metric} onMetric={setMetric} onSeeAll={() => setView('boards')} />
          <VtMovers board={bundle?.ladders?.growth} loading={loading}
            onSeeAll={() => { setMetric('growth'); setView('boards') }} />
          <VtCoins firstHand={bundle?.firstHand} totals={bundle?.totals} />
        </>
      ) : null}

      {view === 'boards' ? (
        <div className="vt-split">
          <aside className="vt-rail" aria-label="Categories">
            <span className="vt-eyebrow">Sectors</span>
            <button type="button"
              className={`vt-rail__btn${!category ? ' is-active' : ''}`}
              onClick={() => setCategory(null)}>
              <span>All platforms</span>
              <span className="vt-rail__n">{bundle?.totals?.tracked?.toLocaleString('en-US') || '—'}</span>
            </button>
            {/* Not capped. The rail scrolls inside its own sticky box, and a cap
                at 18 quietly hid sectors the Sectors tab was listing anyway. */}
            {(bundle?.categories || []).map((c) => (
              <button key={c.key} type="button"
                className={`vt-rail__btn${category === c.key ? ' is-active' : ''}`}
                onClick={() => setCategory(c.key)}>
                <span>{c.key}</span>
                <span className="vt-rail__n">{c.count}</span>
              </button>
            ))}
          </aside>
          <div className="vt-split__main">
            {category ? (
              <p className="vt-note vt-note--filter">
                Fee board scoped to <strong>{category}</strong>
                {catLoading ? ' — ranking…' : ''}
                <button type="button" className="vt-linkbtn" onClick={() => setCategory(null)}>clear</button>
              </p>
            ) : null}
            <VtLadder ladders={ladders} loading={loading || (!!category && catLoading)}
              metric={metric} onMetric={setMetric} />
          </div>
        </div>
      ) : null}

      {view === 'compare' ? <VtCompare /> : null}

      {view === 'sectors' ? (
        <VtCategories
          categories={bundle?.categories}
          onPick={(c) => { setCategory(c); if (c) setView('boards') }}
          active={category}
        />
      ) : null}

      {view === 'firsthand' ? (
        <>
          {bundle?.totals?.firstHand ? (
            <section className="vt-firstband" aria-label="First-hand coverage">
              <div className="vt-firstband__tag">
                <span className="vt-chip vt-chip--own">own data</span>
                <span className="vt-chip vt-chip--scope">{scope?.label}</span>
                <span>
                  {bundle.totals.firstHand} platforms measured from raw fills
                  {bundle.totals.firstHandDay ? ` · ${shortDate(bundle.totals.firstHandDay)}` : ''}
                  {fhAge != null && fhAge > 1 ? ` (${fhAge}d ago — the archive publishes a day behind)` : ''}
                </span>
              </div>
              <dl className="vt-firstband__stats">
                <div><dt>Traders</dt><dd>{count(bundle.totals.firstHandDau)}</dd></div>
                <div><dt>Volume</dt><dd>{usd(bundle.totals.firstHandPerpVolume)}</dd></div>
                <div><dt>Revenue</dt><dd>{usd(bundle.totals.firstHandRevenue)}</dd></div>
                <div>
                  <dt>Trader PnL</dt>
                  <dd className={(bundle.totals.firstHandUserPnl || 0) >= 0 ? 'vt-tone--up' : 'vt-tone--down'}>
                    {usd(bundle.totals.firstHandUserPnl)}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
          <ScopeNote scope={scope} />
          <VtFloor firstHand={bundle?.firstHand} />
        </>
      ) : null}

      {view === 'sources' ? (
        <section className="vt-section vt-prov" id="sources">
          <header className="vt-section__head">
            <div>
              <span className="vt-eyebrow">Provenance</span>
              <h2>Where each number comes from</h2>
              <p className="vt-section__sub">
                Two lanes. We say which one every figure came from, and what each lane cannot see.
              </p>
            </div>
          </header>
          <ul className="vt-prov__list">
            {(bundle?.sources || []).map((s) => (
              <li key={s.name} className={`vt-prov__item vt-prov__item--${s.lane}`}>
                <span className={`vt-chip ${s.lane === 'first_hand' ? 'vt-chip--own' : 'vt-chip--shadow'}`}>
                  {s.lane === 'first_hand' ? 'own data' : 'shadowed'}
                </span>
                <strong>{s.name}</strong>
                <p>{s.detail}</p>
              </li>
            ))}
          </ul>

          <div className="vt-meth__grid" style={{ marginTop: 'var(--sp-5)' }}>
            <div className="vt-meth__card">
              <h3>What &ldquo;annualised&rdquo; means here</h3>
              <p>
                There are two conventions in common use and they disagree, so we show both rather
                than pick a side. <strong>Trailing year</strong> is the last 365 days of fees.{' '}
                <strong>30-day run-rate</strong> is the last 30 days &times; 365/30. For a
                fast-growing platform these differ by multiples and neither is wrong — only an
                unlabelled one is.
              </p>
            </div>
            <div className="vt-meth__card">
              <h3>Ranking rules</h3>
              <p>
                Growth boards need a real base in both windows, so a platform going from nothing to
                something cannot top a table on a percentage. A take rate above 100% means two
                adapters disagree, so the row is dropped rather than printed. Perp volume is never
                added to spot volume. Level and momentum are separate boards and are never blended
                into a score.
              </p>
            </div>
          </div>

          <p className="vt-note vt-note--dim">
            {bundle?.generatedAt ? `Built ${new Date(bundle.generatedAt).toLocaleString()}.` : ''}
            {refreshing ? ' Refreshing…' : ''}
          </p>
        </section>
      ) : null}
    </div>
  )
}
