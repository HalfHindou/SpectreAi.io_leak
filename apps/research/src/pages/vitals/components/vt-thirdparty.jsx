/**
 * vt-thirdparty.jsx — active addresses from growthepie.
 *
 * This sits deliberately apart from the first-hand block. Our own number comes
 * from reading raw fills and covers one venue; this one counts addresses across
 * Ethereum and its L2s and comes from somebody else. They are different
 * measurements of different things, and a reader who blends them gets a wrong
 * answer — so they never share a card, a total, or a board.
 *
 * The attribution line is not decoration: growthepie publishes under CC-BY-4.0,
 * and the credit is a condition of using the data at all.
 */

import { useEffect, useState } from 'react'
import VtChartCard from './vt-chart-card'
import { count, shortDate } from './vt-format'

/** growthepie's chain keys are snake_case ids, not display names. */
const CHAIN_LABEL = {
  polygon_pos: 'Polygon',
  zksync_era: 'zkSync Era',
  imx: 'Immutable X',
  pgn: 'PGN',
  rhino: 'Rhino',
  megaeth: 'MegaETH',
}
const chainName = (k) => CHAIN_LABEL[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * `seed` is whatever the platform payload happened to have warm. When it is
 * empty this component fetches the block ITSELF, because the source is rate
 * limited to ten calls a minute and making the whole page wait on it put six
 * seconds in front of every number (founder: "i click on a platform and i get
 * 10 second loading or nothing").
 */
export default function VtThirdParty({ data: seed, slug, platformName }) {
  const [data, setData] = useState(seed || null)

  useEffect(() => {
    setData(seed || null)
    if (seed || !slug) return undefined
    let cancelled = false
    fetch(`/api/vitals?fn=thirdparty&slug=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(45_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.thirdParty) setData(j.thirdParty) })
      .catch(() => { /* the page is complete without it */ })
    return () => { cancelled = true }
  }, [slug, seed])

  if (!data?.activeAddresses) return null
  const aa = data.activeAddresses
  if (aa.avg30d == null && aa.latest == null) return null

  const chains = Object.entries(aa.byChain || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const total = chains.reduce((s, [, v]) => s + v, 0) || 1

  return (
    <section className="vt-section vt-tp">
      <div className="vt-section__head">
        <div>
          <span className="vt-eyebrow">Active addresses · third party</span>
          <h2>Who is actually using {platformName}</h2>
          <p className="vt-section__sub">
            Distinct addresses interacting with {platformName}&rsquo;s contracts on Ethereum and its
            layer twos. This is a third-party count, not one we measure ourselves — and it does not
            include Solana or any chain outside that set.
          </p>
        </div>
        <div className="vt-tp__figure">
          <span>{aa.avg30d != null ? count(Math.round(aa.avg30d)) : count(aa.latest)}</span>
          <em>{aa.avg30d != null ? 'daily average, 30 days' : 'latest day'}</em>
        </div>
      </div>

      {chains.length ? (
        <ul className="vt-tp__chains">
          {chains.slice(0, 10).map(([k, v]) => (
            <li key={k}>
              <span className="vt-tp__chain">{chainName(k)}</span>
              <span className="vt-tp__bar" aria-hidden="true">
                <i style={{ width: `${Math.max(2, (v / total) * 100)}%` }} />
              </span>
              <span className="vt-tp__val">{count(v)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {data.series?.activeAddresses?.length > 2 ? (
        <VtChartCard
          title="Active addresses"
          subtitle="Daily, summed across the chains above"
          series={data.series.activeAddresses}
          kind="count"
          defaultRange="90d"
          defaultForm="area"
        />
      ) : null}

      <p className="vt-tp__credit">
        Source: <a href={data.source.url} target="_blank" rel="noopener noreferrer">growthepie</a>
        {' '}({data.source.licence})
        {data.updatedAt ? ` · updated ${shortDate(String(data.updatedAt).slice(0, 10))}` : null}
      </p>
    </section>
  )
}
