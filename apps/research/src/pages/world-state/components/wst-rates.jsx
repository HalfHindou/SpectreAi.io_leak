/**
 * Band D — rates. Two columns: the calendar and the curve on the left, the
 * money's opinion on the right.
 *
 * The countdown runs through the module-ticker (one interval, textContent
 * writes, zero renders). fed_chair markets are a labelled sub-section of the
 * same ladder rather than a second widget — same instrument, different
 * subject.
 */
import React from 'react'
import { WstBand, WstHead, WstNone } from './wst-band'
import WstOdds from './wst-odds'
import { Countdown } from './wst-tick'
import { fmtPct, fmtBp, fmtLongDay, isNum } from './wst-format'

function Stat({ label, value, sub }) {
  return (
    <div className="wst-stat">
      <span className="wst-stat-k">{label}</span>
      <span className="wst-stat-v wst-num">{value ?? '—'}</span>
      {sub && <span className="wst-stat-s">{sub}</span>}
    </div>
  )
}

export default function WstRates({ rates, changed, now }) {
  const odds = Array.isArray(rates?.odds) ? rates.odds : []
  const chair = Array.isArray(rates?.fed_chair) ? rates.fed_chair : []
  const fomc = rates?.next_fomc
  const hasCurve = isNum(rates?.fed_funds_pct) || isNum(rates?.yield_30y) || isNum(rates?.yield_2s10s)

  return (
    <WstBand id="wst-rates" label="Rates" changed={changed}>
      <WstHead
        eyebrow="Rates"
        sub={odds.length ? 'sorted by open interest' : null}
        meta={odds.length ? `n=${odds.length + chair.length}` : null}
        changed={changed}
      />

      <div className="wst-rates">
        <div className="wst-rates-l">
          {fomc ? (
            <div className="wst-fomc">
              <span className="wst-stat-k">Next FOMC</span>
              <Countdown to={fomc} className="wst-fig wst-fig--sm" />
              <span className="wst-stat-s wst-num">{fmtLongDay(fomc)}</span>
            </div>
          ) : (
            <WstNone>No meeting on the calendar.</WstNone>
          )}

          {hasCurve ? (
            <div className="wst-stats">
              <Stat label="Fed funds" value={fmtPct(rates?.fed_funds_pct)} />
              <Stat label="30-year" value={fmtPct(rates?.yield_30y)} />
              <Stat label="2s10s" value={fmtBp(rates?.yield_2s10s)} sub={rates?.curve_source ? `via ${rates.curve_source}` : null} />
            </div>
          ) : (
            <WstNone>No curve on file.</WstNone>
          )}
        </div>

        <div className="wst-rates-r">
          <WstOdds rows={odds} now={now} emptyNote="No rate markets priced." />
          {chair.length > 0 && (
            <div className="wst-sub">
              <span className="wst-eyebrow wst-eyebrow--sm">Fed chair</span>
              <WstOdds rows={chair} now={now} emptyNote="No chair markets priced." foot={false} />
            </div>
          )}
        </div>
      </div>
    </WstBand>
  )
}
