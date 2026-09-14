/**
 * vt-movers.jsx — who is pulling ahead, on the Overview.
 *
 * The page opens on a chart of where fees LAND and a board of who earns the
 * most. Both are levels, and a level barely moves week to week, so the first
 * screen said the same thing on every visit. This is the derivative: the top of
 * the growth board, which the bundle already ships and which nothing on the
 * landing view was showing.
 *
 * THE PACE COLUMN, and why it is not just the two percentages side by side.
 * A month is +969% and a week is +887%; read as printed the week looks like the
 * smaller number and the platform looks like it is slowing down. It is not —
 * those are changes over windows of different LENGTH, and comparing them
 * directly is a category error. Both are converted to the same unit, the
 * implied change PER DAY ((1+chg)^(1/n)-1), and only then put on one axis:
 * Ramses is 8.2%/day across the month against 38.7%/day in the week, which is
 * an acceleration, and the naive reading had it backwards.
 *
 * The glyph plots those two rates on ONE scale shared by every row in the
 * block, so the rows are comparable to each other and not just to themselves.
 * It is a direction, not a measurement — the two percentages are printed beside
 * it for anyone who wants the figure.
 *
 * There is no falling half to this board. No server board ranks decliners, and
 * assembling one from the top-25-by-fees rows would put a different population
 * in the same strip under one heading.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { usd, pct } from './vt-format'

/** Enough to read a rotation, short enough to stay a summary. */
const TOP_N = 6

/** Glyph box, in px. Small multiple: every row draws on the same geometry. */
const G_W = 104
const G_H = 20

/**
 * A window's change expressed as its implied daily rate, in percent.
 * -100% or worse is a wipeout, not a rate; it has no geometric mean.
 */
function dailyRate(chgPct, days) {
  if (chgPct == null || !Number.isFinite(chgPct) || chgPct <= -100) return null
  return ((1 + chgPct / 100) ** (1 / days) - 1) * 100
}

export default function VtMovers({ board, loading, onSeeAll }) {
  const model = useMemo(() => {
    const rows = (board?.rows || []).slice(0, TOP_N).map((r) => ({
      ...r,
      month: dailyRate(r.feeChg30d, 30),
      week: dailyRate(r.feeChg7d, 7),
    }))
    if (!rows.length) return null

    // One scale for the whole block, padded, and always containing zero — the
    // zero line is the only reference the glyph has.
    const vals = rows.flatMap((r) => [r.month, r.week]).filter((v) => Number.isFinite(v))
    const lo = Math.min(0, ...vals)
    const hi = Math.max(0, ...vals)
    const pad = (hi - lo) * 0.08 || 1
    const min = lo - pad
    const max = hi + pad
    const x = (v) => ((v - min) / (max - min)) * G_W
    return { rows, x, zeroX: x(0) }
  }, [board])

  if (loading && !model) {
    return (
      <section className="vt-section vt-movers">
        <ul className="vt-rows vt-rows--skeleton" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => <li key={i} className="vt-row vt-row--skeleton" />)}
        </ul>
      </section>
    )
  }
  if (!model) return null

  return (
    <section className="vt-section vt-movers" id="movers">
      <header className="vt-section__head">
        <div>
          <span className="vt-eyebrow">Momentum</span>
          <h2>Who is pulling ahead</h2>
          <p className="vt-section__sub">
            Fees against the previous month. A platform has to have earned $100k in both windows
            to appear, so this ranks growth, not arithmetic on a small number. <strong>Pace</strong>{' '}
            puts the month and the week in the same unit — the change each implies per day — because
            a percentage over seven days and one over thirty are not comparable as printed.
          </p>
        </div>
      </header>

      <div className="vt-thead vt-thead--movers" aria-hidden="true">
        <span>#</span>
        <span>Platform</span>
        <span className="vt-gap" />
        <span>Growth, 30d</span>
        <span>7d</span>
        <span>Pace</span>
        <span>Fees, 30d</span>
      </div>

      <ol className="vt-rows vt-rows--movers">
        {model.rows.map((row, i) => {
          const rated = Number.isFinite(row.month) && Number.isFinite(row.week)
          // Falling beats faster: a week that is shrinking is the headline even
          // when its rate still sits above the month's on the axis.
          const state = !rated ? null
            : row.week < 0 ? 'falling'
              : row.week >= row.month ? 'faster' : 'slower'
          return (
            <li key={row.slug} className="vt-row">
              <Link to={`/vitals/${row.slug}`} className="vt-row__link">
                <span className="vt-row__rank">{i + 1}</span>
                <span className="vt-row__id">
                  <span className="vt-row__name">{row.name}</span>
                  <span className="vt-row__meta">{row.category}</span>
                </span>
                <span className="vt-gap" aria-hidden="true" />
                {/* Neutral ink, for the reason the ladder gives on its own growth
                    board: every row here is positive by construction, so tinting
                    them all green is a wall of colour that says nothing. */}
                <span className="vt-row__value">{pct(row.feeChg30d)}</span>
                <span className={`vt-row__delta vt-tone--${row.feeChg7d >= 0 ? 'up' : 'down'}`}>
                  {pct(row.feeChg7d)}
                </span>
                <span className={`vt-mv__pace${state ? ` is-${state}` : ''}`}>
                  {rated ? (
                    <svg className="vt-mv__glyph" width={G_W} height={G_H} viewBox={`0 0 ${G_W} ${G_H}`}
                      aria-hidden="true" focusable="false">
                      <line className="vt-mv__zero" x1={model.zeroX} x2={model.zeroX} y1={2} y2={G_H - 2} />
                      <line className="vt-mv__link" x1={model.x(row.month)} x2={model.x(row.week)}
                        y1={G_H / 2} y2={G_H / 2} />
                      {/* month is where it has been, week is where it is now —
                          hollow for the past, solid for the present */}
                      <circle className="vt-mv__from" cx={model.x(row.month)} cy={G_H / 2} r={3} />
                      <circle className="vt-mv__to" cx={model.x(row.week)} cy={G_H / 2} r={3.4} />
                    </svg>
                  ) : null}
                  <span className="vt-mv__word">{state || '—'}</span>
                </span>
                <span className="vt-row__sub">{usd(row.fees30d)}</span>
              </Link>
            </li>
          )
        })}
      </ol>

      <div className="vt-ladder__foot">
        <p className="vt-note vt-note--dim">
          {board.total?.toLocaleString('en-US')} platforms cleared the floor on this board. On the
          pace glyph the hollow dot is the month&rsquo;s average day, the solid dot the last week&rsquo;s,
          and the hairline is zero.
        </p>
        {onSeeAll ? (
          <button type="button" className="vt-pill vt-pill--sm" onClick={onSeeAll}>
            See the growth board
            <span aria-hidden="true">&rarr;</span>
          </button>
        ) : null}
      </div>
    </section>
  )
}
