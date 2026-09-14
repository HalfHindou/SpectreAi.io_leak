/**
 * Cold-load skeleton — SIX shimmer elements, no more.
 *
 * The geometry matches what replaces it (h1 84 · diff 56 · tide 142 · stats
 * 128 · two odds rows 44), so nothing jumps when data lands. Everything that
 * is knowable before the fetch — the eyebrow, the version rail, the section
 * heads — paints immediately as real text, because those are facts about the
 * page rather than facts from the document.
 *
 * Below the second odds row: nothing. A skeleton of a band we may not be able
 * to fill is a promise we have not checked.
 */
import React from 'react'

const Bar = ({ kind }) => <div className={`wst-sk wst-sk--${kind} animate-shimmer`} aria-hidden="true" />

export default function WstSkeleton() {
  return (
    <div className="wst-skel" role="status" aria-label="Loading the world state document">
      <header className="wst-mast">
        <div className="wst-mast-l">
          <span className="wst-eyebrow">World State</span>
          <Bar kind="h1" />
        </div>
        <div className="wst-mast-r">
          <span className="wst-ver wst-ver--none wst-num">v—</span>
        </div>
      </header>

      <Bar kind="diff" />

      <section className="wst-band is-in">
        <header className="wst-hd">
          <div className="wst-hd-l"><div className="wst-hd-eb"><span className="wst-eyebrow">Net liquidity</span></div></div>
        </header>
        <Bar kind="tide" />
      </section>

      <section className="wst-band is-in">
        <header className="wst-hd">
          <div className="wst-hd-l"><div className="wst-hd-eb"><span className="wst-eyebrow">Rates</span></div></div>
        </header>
        <Bar kind="stats" />
        <Bar kind="odds" />
        <Bar kind="odds" />
      </section>
    </div>
  )
}
