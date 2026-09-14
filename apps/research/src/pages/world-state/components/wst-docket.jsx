/**
 * Band I — the regulatory docket. A dated single-column list, measure capped
 * at 68 characters.
 *
 * This band deliberately does NOT inherit the stance treatment. Filings are
 * records, not speech: no serif, no quotation marks, no stance colour. The
 * only ornament is the OFFICIAL chip, and an unofficial row simply does not
 * get one — there is no "unofficial" badge, because the absence is the
 * statement.
 *
 * `p` arrives as a short classification ("market", "trust"), not prose, so it
 * renders as a tag. `n_obs` is printed as a plain n — the number of times the
 * collector saw the item — rather than dressed up as a count of anything else.
 */
import React, { useState } from 'react'
import { WstBand, WstHead, WstNone } from './wst-band'
import { fmtLongDay, fmtUtc, trimDangling, toNum } from './wst-format'

const SHOWN = 6

function Row({ r }) {
  const h = trimDangling(r.h)
  const day = fmtLongDay(r.ts)
  const n = toNum(r.n_obs)
  return (
    <li className="wst-dk-row">
      <p className="wst-dk-h">{h}</p>
      <p className="wst-dk-meta wst-num">
        {day && <span>{day}</span>}
        {day && r.ts && <span className="wst-dot-sep">·</span>}
        {r.ts && <span>{fmtUtc(r.ts)}</span>}
        {r.p && <span className="wst-tag">{r.p}</span>}
        {r.official && <span className="wst-chip">Official</span>}
        {n != null && n > 0 && <span className="wst-dk-n">n={n}</span>}
      </p>
    </li>
  )
}

export default function WstDocket({ docket, changed }) {
  const [all, setAll] = useState(false)
  const rows = (Array.isArray(docket) ? docket : []).filter((r) => r?.h)
  const sorted = [...rows].sort((a, b) => (Date.parse(b?.ts) || 0) - (Date.parse(a?.ts) || 0))
  const shown = all ? sorted : sorted.slice(0, SHOWN)
  const rest = sorted.length - shown.length

  return (
    <WstBand id="wst-docket" label="Regulatory docket" changed={changed}>
      <WstHead
        eyebrow="Docket"
        sub="newest first"
        meta={sorted.length ? `n=${sorted.length}` : null}
        changed={changed}
      />

      {!sorted.length ? (
        <WstNone>Nothing filed in this window.</WstNone>
      ) : (
        <>
          <ul className="wst-dk">
            {shown.map((r, i) => <Row key={`${r.ts}-${i}`} r={r} />)}
          </ul>
          {rest > 0 && (
            <button type="button" className="wst-more" onClick={() => setAll(true)}>
              {`${rest} more ${rest === 1 ? 'filing' : 'filings'}`}
            </button>
          )}
        </>
      )}
    </WstBand>
  )
}
