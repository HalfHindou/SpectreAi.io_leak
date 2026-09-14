/**
 * vt-coins.jsx — what the traders on these apps actually traded.
 *
 * Every first-hand row already carries the six biggest coins by volume for that
 * app on the day, read out of the same raw fills as its trader count. On the
 * platform page they are shown one app at a time; summed across the whole
 * first-hand set they answer a question no fee board can — not which app earns
 * the most, but what the money was pointed at.
 *
 * TWO READINGS, DELIBERATELY SEPARATE. Volume says how much; the app count says
 * how broad. A coin that is huge on one venue and a coin that every app on the
 * list touches are different facts, and blending them into one bar would hide
 * the interesting half — a rotation shows up as breadth before it shows up as
 * size.
 *
 * COVERAGE. This is a sum of each app's TOP SIX, not of everything it traded,
 * so it is a floor rather than a total. The share is therefore a share of the
 * volume we can put a name to, and the header prints how much of the measured
 * total that is, so the reader can size the gap instead of trusting the word
 * "top".
 */

import { useMemo } from 'react'
import { usd, shortDate } from './vt-format'

const TOP_N = 8

/**
 * Breadth as a strip rather than as "25 of 28".
 *
 * The count was the weakest thing on the row — a number you had to divide in
 * your head to feel. Twenty-eight marks, one per app we read, filled for the
 * ones that traded this coin: BTC's near-solid run and PUMP's short stub say
 * "everywhere" and "one corner" without being read at all.
 */
const DOT = 6
const DOT_R = 2.1

function Breadth({ on, of }) {
  return (
    <span className="vt-coin__apps">
      <svg className="vt-coin__dots" width={of * DOT - (DOT - DOT_R * 2)} height={DOT_R * 2}
        viewBox={`0 0 ${of * DOT} ${DOT_R * 2}`} aria-hidden="true" focusable="false">
        {Array.from({ length: of }, (_, i) => (
          <circle key={i} cx={i * DOT + DOT_R} cy={DOT_R} r={DOT_R}
            className={i < on ? 'is-on' : 'is-off'} />
        ))}
      </svg>
      <span className="vt-coin__appsn">{on}</span>
    </span>
  )
}

export default function VtCoins({ firstHand, totals }) {
  const model = useMemo(() => {
    const rows = firstHand?.rows || []
    if (!rows.length) return null

    const byCoin = new Map()
    for (const r of rows) {
      for (const t of r.topCoins || []) {
        if (!t?.coin || !Number.isFinite(t.volume)) continue
        const e = byCoin.get(t.coin) || { coin: t.coin, volume: 0, apps: 0 }
        e.volume += t.volume
        e.apps += 1
        byCoin.set(t.coin, e)
      }
    }
    if (!byCoin.size) return null

    const all = [...byCoin.values()].sort((a, b) => b.volume - a.volume)
    const named = all.reduce((s, c) => s + c.volume, 0)
    const top = all.slice(0, TOP_N)
    const shown = top.reduce((s, c) => s + c.volume, 0)
    return {
      // The concentration bar. One line that says the thing the eight rows
      // below only add up to: half of everything went into one coin. The tail
      // is kept as a segment rather than dropped, or the bar would claim the
      // eight rows are the whole tape.
      segments: [
        ...top.map((c, i) => ({ ...c, alpha: 0.9 - i * 0.085 })),
        ...(named - shown > 0
          ? [{ coin: 'rest', volume: named - shown, apps: 0, alpha: 0.1, rest: true }]
          : []),
      ],
      top,
      named,
      distinct: all.length,
      apps: rows.length,
      max: top[0]?.volume || 1,
      // What fraction of the volume we measured carries a coin name. Below 100%
      // because each app only reports its own top six.
      coverage: totals?.firstHandPerpVolume ? (named / totals.firstHandPerpVolume) * 100 : null,
    }
  }, [firstHand, totals])

  if (!model) return null

  return (
    <section className="vt-section vt-coins" id="coins">
      <header className="vt-section__head">
        <div>
          <span className="vt-eyebrow">The tape · first-hand</span>
          <h2>What their traders actually traded</h2>
          <p className="vt-section__sub">
            Summed across the {model.apps} apps we read directly on {shortDate(firstHand.day)}.
            Each one reports its six busiest coins, which is{' '}
            {model.coverage != null ? `${Math.round(model.coverage)}% of` : 'most of'} the volume we
            measured that day — so this is a floor, and the share is a share of the volume we can
            put a name to.
          </p>
        </div>
        <div className="vt-coins__tag">
          <span className="vt-chip vt-chip--own">own data</span>
          <span className="vt-chip vt-chip--scope">perps only</span>
        </div>
      </header>

      {/* Reads before the table does: BTC's segment is half the width of the
          strip, and no number in the rows below states that as directly. */}
      <div className="vt-coins__strip" aria-hidden="true">
        {model.segments.map((sgm) => (
          <span key={sgm.coin}
            className={`vt-coins__seg${sgm.rest ? ' is-rest' : ''}`}
            style={{
              width: `${(sgm.volume / model.named) * 100}%`,
              '--seg-a': sgm.alpha,
            }}
          >
            {/* A label only where it fits: below ~7% the ticker is wider than
                its own segment and would spill onto the neighbour's. */}
            {sgm.volume / model.named >= 0.07 ? (
              <span className="vt-coins__seglabel">{sgm.rest ? 'rest' : sgm.coin}</span>
            ) : null}
          </span>
        ))}
      </div>

      <div className="vt-thead vt-thead--coins" aria-hidden="true">
        <span>Coin</span>
        <span />
        <span className="vt-gap" />
        <span>Volume</span>
        <span>Share</span>
        <span>Apps</span>
      </div>

      <ul className="vt-coins__list">
        {model.top.map((c) => (
          <li key={c.coin} className="vt-coin">
            <span className="vt-coin__name">{c.coin}</span>
            <span className="vt-coin__track" aria-hidden="true">
              <span className="vt-coin__fill" style={{ width: `${Math.max(1.5, (c.volume / model.max) * 100)}%` }} />
            </span>
            <span className="vt-gap" aria-hidden="true" />
            <span className="vt-coin__val">{usd(c.volume)}</span>
            <span className="vt-coin__share">{((c.volume / model.named) * 100).toFixed(1)}%</span>
            {/* Breadth, not size: 25 of 28 apps means the whole floor touched it,
                6 of 28 means one corner of it did. */}
            <Breadth on={c.apps} of={model.apps} />
          </li>
        ))}
      </ul>

      <p className="vt-note vt-note--dim">
        {model.distinct} distinct coins across the set; the {TOP_N} above are{' '}
        {Math.round((model.top.reduce((s, c) => s + c.volume, 0) / model.named) * 100)}% of the named volume.
      </p>
    </section>
  )
}
