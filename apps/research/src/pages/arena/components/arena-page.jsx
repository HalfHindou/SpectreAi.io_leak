/**
 * AGENT ARENA — the scoreboard turned to face the crowd.
 *
 * Twelve machine books trade the same tape under fixed rules. This page prints
 * all twelve, including the ones that lost and the one that was switched off,
 * and the loudest number on it is a drawdown. A strategy board that publishes
 * only its winners is a brochure; the deaths are the part that can be checked.
 *
 * DESIGN RULES THAT ARE LOAD-BEARING, not taste:
 *  · The board is ranked by return per unit of drawdown, never by equity — a
 *    $25,000 book and a $100 book sit on the same page.
 *  · A book under fifteen closed trades gets a row, a name, a spark and full
 *    type weight, and no rate. It is building a record, not failing.
 *  · Retired books are rendered at full weight under a factual heading. No
 *    opacity, no collapse — that is the whole argument.
 *  · Nothing reorders while it is being read. Ranks re-commit on a sort change,
 *    a manual refresh or a tab return, and show a delta chip in between.
 *
 * Prefix: arn-. Numbers ride .arn-num.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useArena, sortRows, SORTS } from './use-arena'
import { useRosterEquity } from './use-trader-equity'
import { groupFamilies, familyDelta } from './arn-lineage'
import { useInView } from './use-in-view'
import ArnRow from './arn-row'
import ArnLedger from './arn-ledger'
import ArnStage from './arn-stage'
import ArnTape from './arn-tape'
import ArnDeaths from './arn-deaths'
import ArnTakeover from './arn-takeover'
import { ArnAge } from './arn-ticker'
import { fmtMoney, fmtStamp, Words, words } from './arn-format'
import './arena-page.css'
import './arena-page.day-mode.css'
import './arena-page.mobile.css'

const SORT_KEY = 'spectre-arena-sort'

const readSort = () => {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return SORTS.some((s) => s.id === v) ? v : 'skill'
  } catch { return 'skill' }
}

/** The h1 is a computed FACT with a checkable source line under it, never a
 *  slogan. Four cases, in the order the data can support them. */
function headline(data, asOf) {
  if (!data) {
    return {
      text: 'The arena has not reported since',
      age: asOf,
      kind: 'down',
    }
  }
  const { totals } = data
  if (totals.underwater > 0) {
    return {
      text: `${Words(totals.underwater)} of ${words(totals.books)} books ${totals.underwater === 1 ? 'is' : 'are'} under water.`,
      kind: 'under',
    }
  }
  // "for the first time in N days" needs a history this page does not hold, so
  // the flat-out-good case falls to the specific book rather than inventing one.
  const w = totals.worstBook
  if (w) {
    return {
      text: `${w.name} is down to ${fmtMoney(w.equity)} of ${fmtMoney(w.starting)}.`,
      kind: 'book',
    }
  }
  return { text: 'Every book is above its starting line.', kind: 'up' }
}

function Band({ children, className = '', tag: Tag = 'section' }) {
  const { ref, inView } = useInView()
  return (
    <Tag ref={ref} className={`${className} arn-reveal`} data-in={inView ? 'true' : 'false'}>
      {children}
    </Tag>
  )
}

export default function ArenaPage({ dayMode }) {
  const { data, loading, degraded, stale, error, asOf, refresh } = useArena()
  const [sort, setSort] = useState(readSort)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => new Set())
  const [phase, setPhase] = useState(() => (params.get('trader') ? 'trader' : 'board'))

  const openKey = params.get('trader')
  const scrollRef = useRef(0)

  /* ── roster ordering. Committed, not live. ─────────────────────────── */
  const live = data?.live || []
  const retired = data?.retired || []

  const groups = useMemo(() => groupFamilies(live), [live])
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const sortRef = useRef(sort)
  sortRef.current = sort

  const [order, setOrder] = useState([])
  const commit = useCallback(() => {
    const gs = groupsRef.current
    const heads = sortRows(gs.map((g) => g.head), sortRef.current)
    const rank = new Map(heads.map((h, i) => [h.name, i]))
    setOrder([...gs].sort((a, b) => (rank.get(a.head.name) ?? 1e9) - (rank.get(b.head.name) ?? 1e9)).map((g) => g.key))
  }, [])

  useEffect(() => { if (groups.length && !order.length) commit() }, [groups.length, order.length, commit])
  useEffect(() => { if (groups.length) commit() }, [sort]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onVis = () => { if (!document.hidden) commit() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [commit])

  const ordered = useMemo(() => {
    if (!groups.length) return []
    const byKey = new Map(groups.map((g) => [g.key, g]))
    const seen = new Set()
    const out = []
    for (const k of order) {
      const g = byKey.get(k)
      if (g) { out.push(g); seen.add(k) }
    }
    // A book that appeared since the last commit enters at the BOTTOM of the
    // live band rather than shoving the board around under the reader.
    for (const g of groups) if (!seen.has(g.key)) out.push(g)
    return out
  }, [groups, order])

  // What the order WOULD be if it re-committed right now. The difference is the
  // delta chip; the board itself does not move.
  const trueRank = useMemo(() => {
    // Ranked means: past the sample floor AND with enough drawdown on record for
    // the ratio to mean anything. Everything else keeps its row and loses its
    // number.
    const heads = sortRows(groups.map((g) => g.head).filter((h) => h.floorCleared && h.rdd != null), sort)
    return new Map(heads.map((h, i) => [h.name, i + 1]))
  }, [groups, sort])

  /* ── sparks. Only books with a published id have snapshots to ask for. ── */
  const ids = useMemo(
    () => [...live, ...retired].map((r) => r.id).filter(Boolean),
    [live, retired],
  )
  const { series } = useRosterEquity(ids)

  /* ── one shared scale for every R:DD micro-bar on the page ─────────── */
  const rddScale = useMemo(() => {
    const all = [...live, ...retired].map((r) => (r.rdd != null ? Math.abs(r.rdd) : 0))
    return Math.max(1, ...all)
  }, [live, retired])

  /* ── takeover ──────────────────────────────────────────────────────── */
  const openRow = useMemo(() => {
    if (!openKey || !data) return null
    return data.rows.find((r) => r.id === openKey) || data.rows.find((r) => r.name === openKey) || null
  }, [openKey, data])

  const openFamily = useMemo(() => {
    if (!openRow) return null
    const g = groupFamilies(data?.rows || []).find((x) => x.members.some((m) => m.name === openRow.name))
    if (!g || g.members.length < 2) return null
    // The config diff needs BOTH books' published doctrine, and the roster lane
    // carries none — so the takeover states the delta it can prove and no more.
    return g
  }, [openRow, data])

  const pushedRef = useRef(false)
  const openTrader = useCallback((row) => {
    scrollRef.current = window.scrollY || 0
    pushedRef.current = true
    setPhase('leaving')
    setParams({ trader: row.id || row.name }, { replace: false })
  }, [setParams])

  const closeTrader = useCallback(() => {
    // Close and Back have to mean the same thing. If this page pushed the entry,
    // pop it; on a cold deep link there is nothing of ours to pop, so replace.
    if (pushedRef.current) { pushedRef.current = false; navigate(-1) }
    else setParams({}, { replace: true })
  }, [navigate, setParams])

  useEffect(() => {
    if (openKey) {
      const t = setTimeout(() => {
        setPhase('trader')
        window.scrollTo({ top: 0, behavior: 'auto' })
      }, 150)
      return () => clearTimeout(t)
    }
    setPhase('board')
    // Restoring the exact offset is the difference between reading a board and
    // losing your place in one.
    const y = scrollRef.current
    const t = setTimeout(() => window.scrollTo({ top: y, behavior: 'auto' }), 0)
    return () => clearTimeout(t)
  }, [openKey])

  const head = headline(data, asOf)
  const totals = data?.totals

  const measuredWindow = useMemo(() => {
    const stamps = (data?.rows || []).map((r) => r.lastSeenAt).filter(Boolean).sort()
    return stamps.length ? stamps[stamps.length - 1] : null
  }, [data])

  const offBoard = totals?.offBoard || []
  const anyOpen = (data?.rows || []).some((r) => r.openPositions > 0)

  /* ── takeover view ─────────────────────────────────────────────────── */
  if (openRow && phase === 'trader') {
    return (
      <div className={`arn-root${dayMode ? ' day-mode' : ''}`}>
        <ArnTakeover row={openRow} family={openFamily} onClose={closeTrader} />
      </div>
    )
  }

  return (
    <div className={`arn-root${dayMode ? ' day-mode' : ''}`} data-leaving={phase === 'leaving' ? 'true' : 'false'}>
      {/* ── A · masthead ────────────────────────────────────────────── */}
      <header className="arn-head">
        <div className="arn-head__bar">
          <span className="arn-eyebrow">THE ARENA</span>
          <span className={`arn-live${stale ? ' is-stale' : ''}`}>
            <span className="arn-live__dot" aria-hidden="true" />
            {stale ? <>stale · last updated <ArnAge at={asOf} /></> : <>updated <ArnAge at={asOf} /></>}
          </span>
        </div>

        {data ? (
          <h1 className="arn-h1 arn-settle">{head.text}</h1>
        ) : error ? (
          <h1 className="arn-h1 arn-settle">
            The arena has not reported since <ArnAge at={asOf} />.
          </h1>
        ) : null}

        {totals ? (
          <p className="arn-source arn-meta">
            <span className="arn-num">{totals.books}</span> paper books
            <span className="arn-sep">·</span>
            <span className="arn-num">{totals.closed.toLocaleString('en-US')}</span> trades closed
            <span className="arn-sep">·</span>
            measured <ArnAge at={asOf} suffix=" ago" />
          </p>
        ) : null}

        <p className="arn-lede">
          {Words(totals?.books ?? 12)} machine books trade the same tape under fixed rules with no
          discretion. Every close is printed here, including the ones that ended the book.
        </p>

        {/* The stage IS the waterline now: the lit gate is the starting
            balance and a book under water stands short of it. ArnWaterline
            still exists and still renders — as the stage's reduced-motion and
            no-WebGL reading, inside ArnStage. */}
        <ArnStage rows={data?.rows} tape={data?.tape} headline={head.text} onOpen={openTrader} />
      </header>

      {/* ── B · the ledger ──────────────────────────────────────────── */}
      {totals ? (
        <>
          <ArnLedger totals={totals} />
          {totals.equityFallback ? (
            <p className="arn-ledger__note arn-meta">
              <span className="arn-dagger">†</span>{' '}
              {totals.offBoard.length || 1}{' '}
              {(totals.offBoard.length || 1) === 1 ? 'book publishes' : 'books publish'} no equity
              snapshot, so its cash balance stands in the total. Cash excludes open positions.
            </p>
          ) : null}
        </>
      ) : loading ? (
        <div className="arn-sk animate-shimmer arn-sk--ledger" aria-hidden="true" />
      ) : null}

      {error && !data ? (
        <div className="arn-notice">
          <p>Neither the roster nor the leaderboard answered.</p>
          <p className="arn-meta">Nothing is shown rather than a stale board presented as live.</p>
          <button type="button" className="arn-retry" onClick={refresh}>Try again</button>
        </div>
      ) : null}

      <div className="arn-cols">
        <div className="arn-main">
          {/* ── C · sort rail ─────────────────────────────────────── */}
          <div className="arn-rail" role="tablist" aria-label="Sort the board">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                className="arn-rail__btn"
                aria-selected={sort === s.id}
                aria-pressed={sort === s.id}
                onClick={() => {
                  setSort(s.id)
                  try { localStorage.setItem(SORT_KEY, s.id) } catch { /* private mode */ }
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* ── D · the live book ─────────────────────────────────── */}
          <Band className="arn-book">
            <header className="arn-sechead">
              <span className="arn-eyebrow">THE LIVE BOOK</span>
              {data ? <span className="arn-meta arn-num">{live.length} running</span> : null}
            </header>

            {loading && !data ? (
              <div className="arn-sk-list" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className={`arn-sk animate-shimmer arn-sk--row stagger-${i + 1}`} />
                ))}
              </div>
            ) : !live.length ? (
              <div className="arn-notice">
                <p>No books are running.</p>
                <p className="arn-meta">
                  Last seen {measuredWindow ? fmtStamp(measuredWindow) : 'never in this window'}.
                </p>
              </div>
            ) : (
              <div className="arn-rows" role="table" aria-label="Live books">
                {(() => {
                  let rank = 0
                  return ordered.map((g) => {
                    const isRanked = g.head.floorCleared && g.head.rdd != null
                    if (isRanked) rank += 1
                    const shown = rank
                    const t = trueRank.get(g.head.name)
                    const delta = isRanked && t ? shown - t : 0
                    const isOpen = expanded.has(g.key)
                    return (
                      <div className="arn-group" key={g.key}>
                        <ArnRow
                          row={g.head}
                          rank={isRanked ? shown : null}
                          rankDelta={delta}
                          scale={rddScale}
                          series={g.head.id ? series[g.head.id] : null}
                          degraded={degraded}
                          generations={g.generations}
                          expanded={isOpen}
                          onToggle={() => setExpanded((prev) => {
                            const next = new Set(prev)
                            if (next.has(g.key)) next.delete(g.key); else next.add(g.key)
                            return next
                          })}
                          onOpen={openTrader}
                        />
                        {isOpen && g.members.length > 1 ? (
                          <div className="arn-subs">
                            <p className="arn-subs__note arn-meta">{familyDelta(g.members)}</p>
                            {g.members.filter((m) => m.name !== g.head.name).map((m) => (
                              <ArnRow
                                key={m.name}
                                row={m}
                                sub
                                scale={rddScale}
                                series={m.id ? series[m.id] : null}
                                degraded={degraded}
                                onOpen={openTrader}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </Band>

          {/* ── E · the retired book ──────────────────────────────── */}
          {retired.length ? (
            <Band className="arn-book arn-book--retired">
              <header className="arn-sechead">
                <h2 className="arn-fact">
                  {Words(retired.length)} {retired.length === 1 ? 'book was' : 'books were'} switched off.
                </h2>
              </header>
              <div className="arn-rows" role="table" aria-label="Retired books">
                {retired.map((r) => (
                  <ArnRow
                    key={r.name}
                    row={r}
                    scale={rddScale}
                    series={r.id ? series[r.id] : null}
                    degraded={degraded}
                    onOpen={openTrader}
                  />
                ))}
              </div>
              <p className="arn-retired-note">
                {retired.map((r) => (
                  <span key={r.name}>
                    {r.name} stopped at <span className="arn-num">{fmtMoney(r.current)}</span> of{' '}
                    <span className="arn-num">{fmtMoney(r.starting)}</span> after{' '}
                    <span className="arn-num">{r.closed}</span> closed trades
                    {r.openPositions > 0 ? (
                      <>, and still shows <span className="arn-num">{r.openPositions}</span>{' '}
                        open {r.openPositions === 1 ? 'position' : 'positions'}</>
                    ) : null}.{' '}
                  </span>
                ))}
                No deactivation timestamp is published, so no date is shown. The book stays on the page.
              </p>
            </Band>
          ) : null}

        </div>

        {/* ── rail ────────────────────────────────────────────────── */}
        <aside className="arn-rail-col">
          {data ? (
            <>
              <ArnTape items={data.tape} />
              <ArnDeaths deaths={data.deaths} n={data.tapeWindow} />
            </>
          ) : null}
        </aside>
      </div>

      {/* ── F · method ────────────────────────────────────────────── */}
      <Band className="arn-method">
        <header className="arn-sechead">
          <span className="arn-eyebrow">METHOD</span>
          <span className="arn-meta">
            {measuredWindow ? <>as of {fmtStamp(measuredWindow)}</> : 'window not published'}
          </span>
        </header>

        <p className="arn-method__p">
          Rank is <span className="arn-strong">return divided by the deepest drawdown that book has
          recorded</span> — reward per unit of pain. Ranking by equity would put the largest
          starting balance on top and call it skill.
        </p>
        <p className="arn-method__p">
          Below fifteen closed trades a book has a record, not a rate. Those books keep their row
          and lose their numbers until the sample arrives.
        </p>
        <p className="arn-method__p">
          Equity is measured from five-minute snapshots the engine publishes; the store keeps a
          rolling five hundred of them, so a curve is a recent window and its axis says which.
          Returns and drawdowns are since each book started, not since the window opened.
        </p>

        {degraded || offBoard.length || anyOpen ? (
          <p className="arn-method__p arn-method__p--missing">
            <span className="arn-eyebrow">NOT PUBLISHED TODAY</span>{' '}
            {degraded ? (
              <>
                The <span className="arn-mono-inline">/v1/paper-trading/leaderboard</span> lane did not
                answer, so no book has a rank, a curve, or a daily and weekly change on this load.
                Every number on the board is derived from the roster lane alone.{' '}
              </>
            ) : offBoard.length ? (
              <>
                {offBoard.map((r) => r.name).join(', ')} {offBoard.length === 1 ? 'is' : 'are'} in the
                roster but not on the leaderboard, so {offBoard.length === 1 ? 'it has' : 'they have'} no
                equity snapshots and no rank. That is a missing curve, not a missing book.{' '}
              </>
            ) : null}
            {anyOpen ? (
              <>
                Open positions are counted on both lanes, but the book detail publishes no rows for
                them — so the takeover names the count and shows nothing else.
              </>
            ) : null}
          </p>
        ) : null}

        <p className="arn-method__foot">
          Paper positions on live prices. No capital is at risk and nothing here is advice.
        </p>
        <p className="arn-method__link">
          Every position above is closed against the same tape shown in{' '}
          <Link to="/cinema">Market Cinema</Link>.
        </p>
      </Band>
    </div>
  )
}
