/**
 * Band A — the masthead. A heartbeat, not a title.
 *
 * The loudest piece of chrome on this page is the VERSION NUMBER. The eight
 * macro figures below are available anywhere; what is not available anywhere
 * is that this is edition 1,183 and that we can say what made it 1,183. So
 * the version sits in the right rail in mono at h1-adjacent size, the h1
 * itself is a computed fact with its source line underneath, and the regime
 * chip is simply ABSENT when the document has no regime — never a neutral
 * default standing in for a reading we do not have.
 *
 * The microcopy line only claims what we can prove. "previous 1,182 at 13:55"
 * appears when this tab actually held 1,182; there is no server-side revision
 * history to reconstruct it from, so on a fresh load the line stops after the
 * rebuild stamp rather than inventing a predecessor.
 */
import React from 'react'
import { fmtUtc, fmtLongDay } from './wst-format'
import { Ago } from './wst-tick'

const REGIME_TONE = {
  'risk-on': 'bull', bull: 'bull', expansion: 'bull', trending: 'bull',
  'risk-off': 'bear', bear: 'bear', stress: 'bear', contraction: 'bear',
}

export default function WstMasthead({ fact, version, ts, prevVersion, editions, stale, lastOkAt, regime, flash }) {
  const prev = prevVersion != null
    ? (editions || []).find((e) => e.version === prevVersion)
    : null

  const micro = [
    // The version is an identifier, not a quantity — no thousands separator.
    version != null ? `Version ${version}` : null,
    ts ? `rebuilt ${fmtUtc(ts)}` : null,
    prev ? `previous ${prevVersion} at ${fmtUtc(prev.ts) ?? fmtUtc(new Date(prev.seenAt).toISOString())}` : null,
  ].filter(Boolean).join(' · ')

  const tone = regime ? REGIME_TONE[String(regime).toLowerCase()] : null

  return (
    <header className="wst-mast">
      <div className="wst-mast-l">
        <span className="wst-eyebrow">World State</span>
        <h1 className="wst-h1">{fact?.text}</h1>
        {fact?.source && <p className="wst-src wst-num">{fact.source}</p>}
        {micro && <p className="wst-micro">{micro}</p>}
      </div>

      <div className="wst-mast-r">
        <div className="wst-ver-row">
          {version != null ? (
            /* Identifier, not a quantity: no thousands separator here. The
               prose line above spells it with one — that contrast is the
               point. */
            <span className={`wst-ver wst-num${flash ? ' is-flash' : ''}`} key={version}>v{version}</span>
          ) : (
            <span className="wst-ver wst-ver--none wst-num">v—</span>
          )}
          {stale && (
            <span className="wst-stale">
              stale · last updated <Ago from={lastOkAt} />
            </span>
          )}
        </div>
        {ts && (
          <span className="wst-stamp wst-num">
            {fmtUtc(ts)} <span className="wst-stamp-d">{fmtLongDay(ts)}</span>
          </span>
        )}
        {/* Absent, not neutral, when the document has no regime. */}
        {regime && <span className={`wst-regime${tone ? ` wst-regime--${tone}` : ''}`}>{regime}</span>}
      </div>
    </header>
  )
}
