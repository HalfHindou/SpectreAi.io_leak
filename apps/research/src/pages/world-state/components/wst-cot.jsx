/**
 * Band E — CME Bitcoin positioning. The ONLY mirrored form on the page: a
 * diverging two-sided bar off one continuous zero rule, leveraged funds above
 * and asset managers below.
 *
 * Scaled against open interest, so a bar's length reads directly as "this
 * share of the whole book", and the axis ends print that number. The ghost
 * tick on each bar is last week's position — the movement is the story, and
 * showing it as a mark rather than a second bar keeps the mirrored form clean.
 *
 * The unit (contracts) is stated once, in the band head, and never repeated
 * on a value.
 */
import React from 'react'
import { WstBand, WstHead, WstNone, WstFoot } from './wst-band'
import useInView from './use-in-view'
import { fmtSignedInt, fmtInt, fmtLongDay, toNum } from './wst-format'

function Leg({ label, net, wow, oi, phase }) {
  const v = toNum(net)
  const w = toNum(wow)
  const prior = v != null && w != null ? v - w : null
  const frac = (n) => (n == null || !oi ? 0 : Math.min(Math.abs(n) / oi, 1))

  return (
    <div className="wst-cot-row">
      <span className="wst-cot-k">{label}</span>
      <span className="wst-cot-track">
        <span className="wst-cot-zero" aria-hidden="true" />
        {v != null && (
          <span
            /* --a / --b are the two halves of the pull: the same slow ±3.5%
               breath in opposite phase, so the legs read as leaning against
               each other. It starts only after the entrance has drawn the bar
               to its true length, and the exact figure is printed beside it. */
            className={`wst-cot-bar wst-cot-bar--${phase}${v < 0 ? ' is-bear' : ' is-bull'}${v < 0 ? ' is-left' : ' is-right'}`}
            style={{ '--mag': frac(v) }}
            aria-hidden="true"
          />
        )}
        {prior != null && (
          <span
            className={`wst-cot-ghost${prior < 0 ? ' is-left' : ' is-right'}`}
            style={{ '--mag': frac(prior) }}
            title={`last week ${fmtSignedInt(prior)}`}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="wst-cot-v">
        <span className={`wst-num${v < 0 ? ' is-bear' : ' is-bull'}`}>{fmtSignedInt(v) ?? '—'}</span>
        {w != null && <span className="wst-cot-wow wst-num">{fmtSignedInt(w)} w/w</span>}
      </span>
    </div>
  )
}

export default function WstCot({ cot, changed }) {
  const oi = toNum(cot?.open_interest)
  const lev = toNum(cot?.leveraged_funds_net)
  const am = toNum(cot?.asset_managers_net)
  const asOf = fmtLongDay(cot?.as_of)
  const has = oi != null && (lev != null || am != null)

  return (
    <WstBand id="wst-cot" label="CME Bitcoin positioning" changed={changed}>
      <WstHead
        eyebrow="CME positioning"
        sub={oi != null ? `contracts · open interest ${fmtInt(oi)}` : 'contracts'}
        meta={asOf ? `as of ${asOf}` : null}
        changed={changed}
      />

      {!has ? (
        <WstNone>
          No CFTC report on file.{asOf ? ` The last one covered ${asOf}.` : ''}
        </WstNone>
      ) : (
        <CotPlot lev={lev} am={am} cot={cot} oi={oi} />
      )}

      {cot?.note && <p className="wst-note">{cot.note}</p>}
      <WstFoot>
        CFTC Commitments of Traders, CME Bitcoin futures. Reported Friday for the
        prior Tuesday — this is a five-day-old picture.
      </WstFoot>
    </WstBand>
  )
}

function CotPlot({ lev, am, cot, oi }) {
  const { ref, inView } = useInView()
  return (
    <div className={`wst-cot${inView ? ' is-in' : ''}`} ref={ref}>
      <Leg label="Leveraged funds" net={lev} wow={cot?.leveraged_funds_net_wow} oi={oi} phase="a" />
      <Leg label="Asset managers" net={am} wow={cot?.asset_managers_net_wow} oi={oi} phase="b" />
      <div className="wst-cot-axis wst-num" aria-hidden="true">
        <span>{`−${fmtInt(oi)}`}</span>
        <span>0</span>
        <span>{`+${fmtInt(oi)}`}</span>
      </div>
      <p className="wst-cot-legend">Tick marks last week's position.</p>
    </div>
  )
}
