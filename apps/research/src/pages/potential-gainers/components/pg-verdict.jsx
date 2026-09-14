/*
 * PGVerdict - "The Record": one honest verdict, not a ten-cell stat grid.
 *
 * Replaces the old Signal Cockpit. The page does not need ten numbers
 * competing for attention - it needs one: does this work? The verdict is the
 * official win rate over every signal that has finished the full 72h proof
 * window, with the win-loss record stated plainly (losses in the headline,
 * never hidden) and a few supporting chips.
 *
 * Computed from /api/momentum/setups/performance, matured rows only
 * (maturity_status 'matured'), aged-signal-weighted so a heavy day counts
 * more than a one-signal day. Still-aging days are excluded from the record
 * entirely - they live on the win-rate chart as the dashed tail.
 */
import { useMemo } from 'react'
import { useMomentumPerformance } from '@/hooks/useMomentumData'
import { toNumber, formatPct, formatSignedPct, returnTone, maturityOf } from './pg-utils'

export default function PGVerdict({ timeframe = '7d', bucket = 'top10', enabled = true }) {
  const { data, loading, error } = useMomentumPerformance({ timeframe, days: 21, enabled })

  const v = useMemo(() => {
    const rows = (Array.isArray(data?.rows) ? data.rows : [])
      .filter((r) => r?.date && String(r?.bucket || '') === bucket && maturityOf(r) === 'matured')
    if (rows.length === 0) return null

    let wWins = 0
    let total = 0
    let retW = 0
    let h25 = 0
    let h50 = 0
    let bestDay = null
    rows.forEach((r) => {
      const aged = toNumber(r.aged_signals) ?? toNumber(r.signals) ?? 0
      const wr = toNumber(r.win_rate_pct)
      if (aged <= 0 || wr == null) return
      total += aged
      wWins += (wr / 100) * aged
      const avg = toNumber(r.average_return_pct)
      if (avg != null) retW += avg * aged
      const hh25 = toNumber(r.hit25_pct)
      if (hh25 != null) h25 += (hh25 / 100) * aged
      const hh50 = toNumber(r.hit50_pct)
      if (hh50 != null) h50 += (hh50 / 100) * aged
      if (bestDay == null || wr > bestDay) bestDay = wr
    })
    if (total <= 0) return null

    const wr = (wWins / total) * 100
    const wins = Math.round(wWins)
    return {
      wr,
      wins,
      losses: Math.max(0, Math.round(total) - wins),
      sample: Math.round(total),
      avgReturn: retW / total,
      hit25: (h25 / total) * 100,
      hit50: (h50 / total) * 100,
      bestDay,
    }
  }, [data, bucket])

  if (loading && !data) {
    return (
      <section className="pg-verdict pg-verdict--loading" data-tour="pg-record">
        <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
        <span className="pg-shimmer-bar pg-shimmer-bar--lg animate-shimmer" style={{ marginTop: 12, width: '46%' }} />
        <span className="pg-shimmer-bar animate-shimmer" style={{ marginTop: 18, height: 56, borderRadius: 10 }} />
      </section>
    )
  }

  if (error || !v) {
    return (
      <section className="pg-verdict pg-verdict--empty" data-tour="pg-record">
        <span className="pg-verdict__eyebrow">The Record</span>
        <p className="pg-verdict__empty-line">
          The verdict builds as Potential Gainers signals mature to a full 72h exit.
        </p>
      </section>
    )
  }

  const above = v.wr >= 50
  const barPct = Math.max(0, Math.min(100, v.wr))

  return (
    <section className="pg-verdict" data-tour="pg-record">
      <span className="pg-verdict__eyebrow">The Record</span>

      <div className="pg-verdict__body">
        <div className="pg-verdict__hero">
          <span className="pg-verdict__wr">{formatPct(v.wr, 0)}</span>
          <span className="pg-verdict__wr-label">
            raw signal win rate
            <span className={`pg-verdict__flip${above ? '' : ' pg-verdict__flip--down'}`}>
              {above
                ? `${Math.round(v.wr - 50)} points over a coin flip`
                : 'blind hold, no exit — the strategy above is the trade'}
            </span>
          </span>
        </div>

        <div className="pg-verdict__record">
          <div className="pg-verdict__wl">
            <span className="pg-verdict__w">{v.wins.toLocaleString('en-US')} W</span>
            <span className="pg-verdict__wl-dot" aria-hidden="true">&middot;</span>
            <span className="pg-verdict__l">{v.losses.toLocaleString('en-US')} L</span>
          </div>
          <div className="pg-verdict__bar" aria-hidden="true">
            <span className="pg-verdict__bar-fill" style={{ width: `${barPct}%` }} />
          </div>
          <span className="pg-verdict__wl-meta">
            across {v.sample.toLocaleString('en-US')} signals that completed the full 72h proof window
          </span>
        </div>
      </div>

      <div className="pg-verdict__chips">
        <div className="pg-verdict__chip">
          <span className={`pg-verdict__chip-val pg-tone--${returnTone(v.avgReturn)}`}>
            {formatSignedPct(v.avgReturn, 0)}
          </span>
          <span className="pg-verdict__chip-label">avg return / signal</span>
        </div>
        <div className="pg-verdict__chip">
          <span className="pg-verdict__chip-val">{formatPct(v.hit25, 0)}</span>
          <span className="pg-verdict__chip-label">hit +25%</span>
        </div>
        <div className="pg-verdict__chip">
          <span className="pg-verdict__chip-val">{formatPct(v.hit50, 0)}</span>
          <span className="pg-verdict__chip-label">hit +50%</span>
        </div>
        <div className="pg-verdict__chip">
          <span className="pg-verdict__chip-val">{formatPct(v.bestDay, 0)}</span>
          <span className="pg-verdict__chip-label">best tracked day</span>
        </div>
      </div>

      <p className="pg-verdict__foot">
        Win rate counts only signals past the 72h proof window &mdash; losers included, nothing
        filtered. Still-aging days are not in this record. The dollar return on an equal-weight
        book is shown above in The Edge.
      </p>
    </section>
  )
}
