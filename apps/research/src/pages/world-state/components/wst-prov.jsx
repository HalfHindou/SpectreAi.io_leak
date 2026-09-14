/**
 * Band J — provenance. Permanent chrome, not a disclosure buried in a tooltip:
 * every section's as_of, the poll cadence, the edition, the unit, and — the
 * part that costs something to print — what is ABSENT from today's edition,
 * named rather than quietly skipped.
 *
 * One deviation from the packet's copy, and it is deliberate: the doc foot
 * reads "1,183 revisions on file" rather than "since 12 May". The payload
 * carries no genesis date, and a date we cannot source is exactly the kind of
 * confident detail this page exists to refuse.
 */
import React from 'react'
import { Link } from 'react-router-dom'
import { WstBand, WstHead } from './wst-band'
import { fmtLongDay, fmtUtc } from './wst-format'

const present = (v) => {
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

const SECTIONS = [
  ['net_liquidity', 'Net liquidity'],
  ['cot_btc', 'CME positioning'],
  ['rates', 'Rates'],
  ['politics', 'Politics'],
  ['markets', 'Tape'],
  ['stablecoins', 'Stablecoins'],
  ['regulatory_docket', 'Docket'],
]

const freshest = (arr, key = 'ts') => {
  if (!Array.isArray(arr) || !arr.length) return null
  const t = Math.max(...arr.map((x) => Date.parse(x?.[key]) || 0))
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null
}

export default function WstProv({ doc, version, ts, pollMinutes, endpoint }) {
  const stanceTs = freshest(doc?.politics?.figure_stances)
  const docketTs = freshest(doc?.regulatory_docket)

  const lines = [
    ['Net liquidity', 'Federal Reserve H.4.1, weekly', doc?.net_liquidity?.as_of],
    ['CME positioning', 'CFTC Commitments of Traders, weekly', doc?.cot_btc?.as_of],
    ['Rates and curve', doc?.rates?.curve_source ? `Treasury curve via ${doc.rates.curve_source}` : 'Treasury curve', ts],
    ['Odds', 'Prediction-market order books', ts],
    ['Stances', 'Public statements on the record', stanceTs],
    ['Docket', 'Regulatory filings', docketTs],
    ['Tape', 'Spot and FX', ts],
  ].filter((l) => l[2])

  const missing = SECTIONS.filter(([k]) => !present(doc?.[k])).map(([, label]) => label)

  return (
    <WstBand id="wst-prov" label="Provenance">
      <WstHead eyebrow="Provenance" sub="sources and lag" meta={version != null ? `v${version}` : null} />

      <dl className="wst-prov">
        {lines.map(([label, src, when]) => (
          <div className="wst-prov-row" key={label}>
            <dt className="wst-prov-k">{label}</dt>
            <dd className="wst-prov-v">
              <span className="wst-prov-src">{src}</span>
              <span className="wst-prov-as wst-num">as of {fmtLongDay(when)}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="wst-prov-note">
        {missing.length
          ? `Absent from this edition: ${missing.join(', ')}.`
          : 'No section is absent from this edition.'}
        {' '}All figures in USD. Polled every {pollMinutes} minutes while this tab is visible, from {endpoint}.
        {ts ? ` Edition ${version != null ? version.toLocaleString('en-US') : '—'} rebuilt ${fmtUtc(ts)} on ${fmtLongDay(ts)}.` : ''}
      </p>

      <p className="wst-prov-foot">
        This document rewrites itself when a source changes, not on a timer.
        {version != null ? ` ${version.toLocaleString('en-US')} revisions on file.` : ''}
      </p>
      <p className="wst-prov-foot">
        The desk&rsquo;s own record is on the <Link className="wst-link" to="/arena">Arena</Link>.
      </p>
    </WstBand>
  )
}
