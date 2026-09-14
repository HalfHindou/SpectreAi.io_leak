/**
 * vitals-platform.jsx — VITALS detail: one platform.
 *
 * Identity → the numbers → the chart → who its users are (first-hand) → how it
 * ranks against its own category → exactly how every figure was produced.
 */

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useVitalsPlatform } from './use-vitals'
import VtChartCard from './vt-chart-card'
import VtStackCard from './vt-stack-card'
import VtUsers from './vt-users'
import VtThirdParty from './vt-thirdparty'
import VtSearch from './vt-search'
import VtAnalysis from './vt-analysis'
import VtSeg from './vt-seg'
import VtLogo from './vt-logo'
import { usd, count, pct, ratio, toneOf, hueFor, shortDate, METRIC_TONE } from './vt-format'
import './vitals-page.css'
import './vitals-page.day-mode.css'
import './vitals-page.mobile.css'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'traders', label: 'Traders', dot: true },
  { id: 'composition', label: 'Composition' },
  { id: 'peers', label: 'Cohort' },
  { id: 'method', label: 'Methodology' },
]

/**
 * `lead` marks a tile in the opening row — the platform's headline economics.
 * They take the larger figure so eighteen equally-weighted tiles stop reading as
 * a wall. Which four are lead depends on what the platform actually reports, so
 * it is decided at the render site AFTER the empty tiles are filtered out.
 */
function Kpi({ label, value, note, tone, lead }) {
  return (
    <div className={`vt-kpi${lead ? ' vt-kpi--lead' : ''}`}>
      <dt>{label}</dt>
      <dd className={tone ? `vt-tone--${tone}` : undefined}>{value}</dd>
      {note ? <span className="vt-kpis__note">{note}</span> : null}
    </div>
  )
}

export default function VitalsPlatformPage() {
  const { slug } = useParams()
  const { data, loading, error } = useVitalsPlatform(slug)
  const [tab, setTab] = useState('overview')

  const p = data?.platform
  const firstHandFields = useMemo(
    () => Object.entries(p?.provenance || {}).filter(([, v]) => v === 'first_hand').map(([k]) => k),
    [p]
  )

  // The dot means "measured by us". A platform carrying only a third-party
  // count must not wear it, or the badge stops meaning anything. Declared AFTER
  // firstHandFields: a hook whose dep array reads a const above its own
  // declaration is a render-time TDZ crash, not a lint nit.
  const tabs = useMemo(
    () => TABS.map((t) => (t.id === 'traders' ? { ...t, dot: firstHandFields.length > 0 } : t)),
    [firstHandFields.length],
  )

  if (loading) {
    return (
      <div className="vt-page vt-page--detail">
        <div className="vt-detail__skeleton" aria-label="Loading platform" />
      </div>
    )
  }

  if (error || !p) {
    return (
      <div className="vt-page vt-page--detail">
        <div className="vt-error">
          <h1>No platform called &ldquo;{slug}&rdquo;</h1>
          <p>Try the search, or head back to the board.</p>
          <VtSearch />
          <Link to="/vitals" className="vt-pill">← All platforms</Link>
        </div>
      </div>
    )
  }

  const accent = hueFor(p.slug)
  const fh = data.firstHand
  // The exact share of this platform's revenue our collector can see — better
  // than the word "partial", because the reader can size the gap themselves.
  const cov = data.firstHandCoverage
  const scope = cov || fh?.scope || p.users?.scope
  const covPct = cov?.revenueSharePct == null ? null
    : cov.revenueSharePct < 0.1 ? '<0.1%'
      : cov.revenueSharePct < 10 ? `${cov.revenueSharePct.toFixed(1)}%`
        : `${Math.round(cov.revenueSharePct)}%`
  /**
   * A trader count we can only measure across a sliver of a platform does not
   * belong in the headline row, however carefully it is labelled — read at a
   * glance beside "revenue, 30d" it will be taken as the platform's user base,
   * and for a spot-first app it is ~2% of it. Above the threshold it is a fair
   * headline; below it, it lives in the Traders tab with its context.
   */
  const HEADLINE_COVERAGE_MIN = 25
  const traderHeadline = cov?.revenueSharePct == null || cov.revenueSharePct >= HEADLINE_COVERAGE_MIN

  // First-hand daily values reshaped into the [unixSeconds, value] pairs the
  // chart card takes, so our own metrics get the same controls as the rest.
  const fhSeries = {
    perpVolume: (fh?.series || []).map((d) => [Date.parse(`${d.day}T00:00:00Z`) / 1000, d.perpVolume]),
    traders: (fh?.series || []).map((d) => [Date.parse(`${d.day}T00:00:00Z`) / 1000, d.dau]),
    userPnl: (fh?.series || []).map((d) => [Date.parse(`${d.day}T00:00:00Z`) / 1000, d.userPnl]),
  }

  return (
    <div className="vt-page vt-page--detail" style={{ '--vt-accent': accent }}>
      {/* A crumb is not a back button on a phone: the tap target is a 12px word
          and the only real "back" used to sit at the very bottom of the page,
          past every chart. This is the same control at the top, thumb-sized. */}
      <nav className="vt-crumb">
        <Link to="/vitals" className="vt-crumb__back" aria-label="Back to all platforms">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Vitals</span>
        </Link>
        <span className="vt-crumb__sep" aria-hidden="true">/</span>
        <span className="vt-crumb__here">{p.name}</span>
      </nav>

      <header className="vt-detail__head">
        <div className="vt-detail__id">
          {/* One failed request used to leave a hole in the header: the handler
              hid the image and there was nothing behind it. */}
          <VtLogo className="vt-av vt-av--lg" logo={p.logo} slug={p.slug} llamaSlug={p.llamaSlug} name={p.name} />
          <div>
            <h1>{p.name}</h1>
            <p className="vt-detail__meta">
              <span>{p.category}</span>
              {p.chains?.length ? <span>{p.chains.slice(0, 4).join(' · ')}</span> : null}
              {p.tokenSymbol ? <span>${p.tokenSymbol}</span> : null}
              {data.peers.rank ? <span>#{data.peers.rank} of {data.peers.of} in {p.category}</span> : null}
            </p>
            <p className="vt-detail__tags">
              {firstHandFields.length ? (
                <span className="vt-chip vt-chip--own" title={`Measured by Spectre: ${firstHandFields.join(', ')}`}>
                  own data · {firstHandFields.join(', ')}
                </span>
              ) : null}
              <span className="vt-chip vt-chip--shadow">shadowed · fees, revenue, TVL</span>
              {scope?.partial ? (
                <span className="vt-chip vt-chip--scope" title={scope.note}>
                  {covPct ? `own data sees ${covPct} of revenue` : `${scope.label} only`}
                </span>
              ) : null}
              {/* Only registry-derived platforms can be auto-named — a shadow row
                  carries the protocol's own published name, which is not a guess. */}
              {p.builders?.length && !p.curated ? <span className="vt-chip vt-chip--warn">auto-named</span> : null}
              {p.doubleCounted ? <span className="vt-chip vt-chip--warn">double-counted</span> : null}
            </p>
          </div>
        </div>
        <div className="vt-detail__links">
          {p.website ? <a href={p.website} target="_blank" rel="noopener noreferrer" className="vt-pill">Website ↗</a> : null}
          {p.twitter ? <a href={`https://x.com/${p.twitter}`} target="_blank" rel="noopener noreferrer" className="vt-pill">X ↗</a> : null}
          <VtSearch />
        </div>
      </header>

      {p.description ? <p className="vt-detail__desc">{p.description}</p> : null}

      {!traderHeadline && covPct ? (
        <p className="vt-note vt-note--dim">
          Trader counts cover {covPct} of {p.name}&rsquo;s revenue, so they sit in the Traders tab
          rather than beside the totals.
        </p>
      ) : null}

      {/* Built as a list and filtered, so a metric we do not have leaves no gap.
          The grid was ending in four blank cells because null KPIs still
          rendered a "—" tile. */}
      <dl className="vt-kpis">
        {[
          { k: 'fa', label: 'Fees · ann.', value: usd(p.fees.ann), note: 'trailing 365 days' },
          { k: 'fr', label: 'Fees · run-rate', value: usd(p.fees.runRate30d), note: 'last 30d, annualised' },
          { k: 'ra', label: 'Revenue · ann.', value: usd(p.revenue.ann), note: 'trailing 365 days' },
          { k: 'rr', label: 'Revenue · run-rate', value: usd(p.revenue.runRate30d), note: 'last 30d, annualised' },
          { k: 'f30', label: 'Fees, 30d', value: usd(p.fees.d30), note: pct(p.fees.chg30d), tone: toneOf(p.fees.chg30d) },
          { k: 'r30', label: 'Revenue, 30d', value: usd(p.revenue.d30), note: pct(p.revenue.chg30d), tone: toneOf(p.revenue.chg30d) },
          { k: 'tr', label: 'Take rate', value: p.takeRate != null ? pct(p.takeRate, { sign: false }) : null, note: 'revenue ÷ fees' },
          { k: 'sv', label: 'Spot volume, 30d', value: usd(p.dexVolume.d30) },
          fh?.totals?.perpVolume
            ? { k: 'pv', label: `Perp volume, ${fh.totals.days}d`, value: usd(fh.totals.perpVolume), note: 'measured by us' }
            : null,
          // The platform's own published figure, attributed. It answers the
          // question our perps-only count cannot, without pretending to be ours.
          data.reported?.traders
            ? { k: 'rep', label: 'Traders', value: count(data.reported.traders),
                note: `${data.reported.basis} · reported by ${p.name}` }
            : null,
          p.users && traderHeadline ? { k: 'dau', label: 'Traders / day', value: count(p.users.dau), note: shortDate(p.users.day) } : null,
          fh?.windowUsers && traderHeadline ? { k: 'uu', label: `Unique traders, ${fh.totals.days}d`, value: count(fh.windowUsers), note: 'measured by us' } : null,
          p.tvl ? { k: 'tvl', label: 'TVL', value: usd(p.tvl.now), note: pct(p.tvl.chg7d), tone: toneOf(p.tvl.chg7d) } : null,
          { k: 'mc', label: 'Market cap', value: usd(p.mcap) },
          // FDV next to cap, because for a young platform most of the supply is
          // still unissued and the two numbers tell opposite stories.
          p.fdv && p.mcap && p.fdv > p.mcap * 1.05
            ? { k: 'fdv', label: 'Fully diluted', value: usd(p.fdv), note: `${(p.fdv / p.mcap).toFixed(1)}× the float` }
            : null,
          data.thirdParty?.activeAddresses?.avg30d
            ? { k: 'aa', label: 'Active addresses', value: count(Math.round(data.thirdParty.activeAddresses.avg30d)), note: 'daily avg, 30d · third party' }
            : null,
          { k: 'pf', label: 'P/F', value: ratio(p.pf), note: 'mcap ÷ ann. fees' },
          { k: 'ps', label: 'P/S', value: ratio(p.ps), note: 'mcap ÷ ann. revenue' },
        ]
          .filter((x) => x && x.value && x.value !== '—')
          .map((x, i) => <Kpi key={x.k} label={x.label} value={x.value} note={x.note} tone={x.tone} lead={i < 4} />)}
      </dl>

      <VtSeg items={tabs} value={tab} onChange={setTab} label="Platform view" />

      {tab === 'overview' ? (
        <>
          <VtAnalysis slug={p.slug} columns={[{ slug: p.slug, name: p.name }]} />
          <div className="vt-grid">
            {/* Fees and revenue are two different quantities — one is what a
                user paid, the other is the slice that stayed — so they are two
                colours, taken from the page's metric map rather than picked per
                card. Both cards ran the theme's warm white before this, which is
                what turned the top of every platform page greyscale. */}
            <VtChartCard title={`${p.name}: Fees`} subtitle="Paid by users" series={data.series.fees} tone={METRIC_TONE.fees} />
            <VtChartCard title={`${p.name}: Revenue`} subtitle="Kept by the protocol" series={data.series.revenue} tone={METRIC_TONE.revenue} />
          </div>
          {data.series.revenueByChain ? (
            <VtStackCard
              title={`${p.name}: revenue breakdown`}
              subtitle="Where the money comes from — pivot between chain and product"
              data={data.series.revenueByChain}
            />
          ) : null}
          {fh?.series?.length ? <VtUsers firstHand={fh} platformName={p.name} /> : null}
        </>
      ) : null}

      {tab === 'charts' ? (
        <div className="vt-grid">
          <VtChartCard title="Fees" subtitle="Total paid by users" series={data.series.fees} tone={METRIC_TONE.fees} />
          <VtChartCard title="Revenue" subtitle="The slice the protocol keeps" series={data.series.revenue} tone={METRIC_TONE.revenue} />
          <VtChartCard title="Spot volume" subtitle="Token swaps routed through the app" series={data.series.dexVolume} tone={METRIC_TONE.dexVolume} />
          {fhSeries.perpVolume.length ? (
            <VtChartCard title="Perp volume · measured by us" subtitle={`${scope?.label} — from raw fills`} series={fhSeries.perpVolume} tone={METRIC_TONE.perpVolume} defaultRange="30d" />
          ) : null}
          {fhSeries.traders.length ? (
            <VtChartCard title="Active traders · measured by us" subtitle={`${scope?.label} — distinct addresses per day`} series={fhSeries.traders} tone={METRIC_TONE.traders} defaultRange="30d" />
          ) : null}
          {data.series.feesByChain ? (
            <VtStackCard title="Fees breakdown" subtitle="By chain, or by product" data={data.series.feesByChain} />
          ) : null}
          {data.series.revenueByChain ? (
            <VtStackCard title="Revenue breakdown" subtitle="By chain, or by product" data={data.series.revenueByChain} />
          ) : null}
          {fhSeries.userPnl.length ? (
            <VtChartCard title="Trader PnL · measured by us" subtitle="Net realised, this platform's own users" series={fhSeries.userPnl} tone={METRIC_TONE.userPnl} defaultRange="30d" defaultForm="line" />
          ) : null}
        </div>
      ) : null}

      {tab === 'traders' ? (
        <>
          <VtThirdParty data={data.thirdParty} slug={p.slug} platformName={p.name} />
          {scope?.partial ? (
            <div className="vt-scopewarn">
              <span className="vt-chip vt-chip--scope">partial</span>
              <span>
                {covPct
                  ? <>Covers <strong>{covPct}</strong> of {p.name}&rsquo;s revenue. See Charts for the rest.</>
                  : scope.note}
              </span>
            </div>
          ) : null}
          {fh?.series?.length
            ? <VtUsers firstHand={fh} platformName={p.name} />
            : <p className="vt-empty">No first-hand trader coverage for this platform yet.</p>}
        </>
      ) : null}

      {tab === 'composition' ? (
        p.childProtocols?.length ? (
          <section className="vt-section vt-kids">
            <header className="vt-section__head">
              <div>
                <span className="vt-eyebrow">Composition</span>
                <h2>What {p.name} is made of</h2>
                <p className="vt-section__sub">The headline figures are the sum of these products.</p>
              </div>
            </header>
            <ul className="vt-kids__list">
              {p.childProtocols.map((c) => (
                <li key={c.name}>
                  <span className="vt-kids__name">{c.name}</span>
                  <span className="vt-kids__val">{c.fees30d != null ? usd(c.fees30d) : '—'}</span>
                  {c.methodology?.length ? (
                    <p className="vt-kids__meth">{c.methodology.map((m) => m.text).join(' ')}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : <p className="vt-empty">{p.name} ships as a single product — nothing to break down.</p>
      ) : null}

      {tab === 'peers' ? (
        data.peers?.rows?.length > 1 ? (
          <section className="vt-section vt-peers">
            <header className="vt-section__head">
              <div>
                <span className="vt-eyebrow">Cohort</span>
                <h2>Against the rest of {p.category}</h2>
              </div>
            </header>
            {/* the compact row's grid, so the three figures are named */}
            <div className="vt-thead vt-thead--compact" aria-hidden="true">
              <span>#</span>
              <span>Platform</span>
              <span>Fees, 30d</span>
              <span>Chg</span>
              <span className="vt-thead__sub">Traders</span>
            </div>
            <ol className="vt-rows vt-rows--compact">
              {data.peers.rows.map((row, i) => (
                <li key={row.slug} className={`vt-row${row.slug === p.slug ? ' is-self' : ''}`}>
                  <Link to={`/vitals/${row.slug}`} className="vt-row__link">
                    <span className="vt-row__rank">{i + 1}</span>
                    <span className="vt-row__id"><span className="vt-row__name">{row.name}</span></span>
                    <span className="vt-row__value">{usd(row.fees30d)}</span>
                    <span className={`vt-row__delta vt-tone--${toneOf(row.feeChg30d)}`}>{pct(row.feeChg30d)}</span>
                    <span className="vt-row__sub">{row.dau != null ? `${count(row.dau)} traders` : '—'}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ) : <p className="vt-empty">No cohort large enough to compare against.</p>
      ) : null}

      {tab === 'method' ? (
        <section className="vt-section vt-meth" id="methodology">
          <header className="vt-section__head">
            <div>
              <span className="vt-eyebrow">Methodology</span>
              <h2>How these numbers were produced</h2>
            </div>
          </header>
          <div className="vt-meth__grid">
            <div className="vt-meth__card">
              <span className="vt-chip vt-chip--own">own data</span>
              <h3>Measured by Spectre</h3>
              {p.builders?.length ? (
                <>
                  <p>
                    Every fill routed through this platform&rsquo;s builder code, read from
                    Hyperliquid&rsquo;s public archive and aggregated by us: perp volume, revenue,
                    active traders, new traders, trade count, revenue per trader and net trader PnL.
                  </p>
                  {scope?.partial ? (
                    <p className="vt-meth__fine">
                      <strong>Coverage:</strong> {scope.note}
                    </p>
                  ) : null}
                  <p className="vt-meth__addr">
                    {p.builders.map((b) => <code key={b}>{b}</code>)}
                  </p>
                </>
              ) : (
                <p>No first-hand collector covers this platform yet — every figure here is shadowed.</p>
              )}
            </div>
            <div className="vt-meth__card">
              <span className="vt-chip vt-chip--shadow">shadowed</span>
              <h3>Read from a public source</h3>
              {p.methodology?.length ? (
                <dl className="vt-meth__defs">
                  {p.methodology.map((m) => (
                    <div key={m.label || m.text}>
                      {m.label ? <dt>{m.label}</dt> : null}
                      <dd>{m.text}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>Fees and revenue as published by this protocol&rsquo;s public fee adapter.</p>
              )}
              <p className="vt-meth__fine">
                <strong>Annualised</strong> is the trailing-year figure (the convention aggregators print).
                {p.fees.runRate30d ? ` The 30-day run-rate is ${usd(p.fees.runRate30d)}/yr — a different question, shown separately and never in its place.` : ''}
                {' '}Take rate is revenue ÷ fees over 30 days.
              </p>
              {p.methodologyUrl ? (
                <a href={p.methodologyUrl} target="_blank" rel="noopener noreferrer" className="vt-linkbtn">Adapter source ↗</a>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <Link to="/vitals" className="vt-pill vt-back">← All platforms</Link>
    </div>
  )
}
