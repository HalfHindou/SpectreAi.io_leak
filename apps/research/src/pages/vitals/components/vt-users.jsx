/**
 * vt-users.jsx — the first-hand users panel.
 *
 * Everything here is computed by us from raw fills: daily actives split into
 * new and returning, D7 retention by cohort, revenue per trader, and the net
 * realised PnL of the platform's own users. None of it is purchasable.
 *
 * Honesty rules baked into the copy: "new" means first seen inside the loaded
 * window, not first ever; retention only reports cohorts with a full 7-day
 * runway and at least 10 users.
 */

import { useMemo, useState } from 'react'
import { usd, count, pct, shortDate } from './vt-format'

function Bars({ series }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...series.map((d) => d.dau || 0), 1)

  return (
    <div className="vt-users__chart">
      <div className="vt-users__bars" onMouseLeave={() => setHover(null)}>
        {series.map((d, i) => {
          const total = d.dau || 0
          const fresh = d.newUsers || 0
          const returning = Math.max(0, total - fresh)
          return (
            <button
              key={d.day}
              type="button"
              className={`vt-users__bar${hover === i ? ' is-on' : ''}`}
              style={{ height: `${Math.max(2, (total / max) * 100)}%` }}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${shortDate(d.day)}: ${total} traders, ${fresh} new`}
            >
              <span className="vt-users__seg vt-users__seg--ret"
                style={{ height: `${total ? (returning / total) * 100 : 0}%` }} />
              <span className="vt-users__seg vt-users__seg--new"
                style={{ height: `${total ? (fresh / total) * 100 : 0}%` }} />
            </button>
          )
        })}
      </div>
      <div className="vt-users__axis">
        <span>{shortDate(series[0]?.day)}</span>
        <span>{shortDate(series[series.length - 1]?.day)}</span>
      </div>
      {hover != null && series[hover] ? (
        <div className="vt-users__readout">
          <strong>{shortDate(series[hover].day)}</strong>
          <span>{count(series[hover].dau)} traders</span>
          <span className="vt-tone--up">{count(series[hover].newUsers)} new</span>
          <span>{usd(series[hover].revenue)} revenue</span>
          <span className={series[hover].userPnl >= 0 ? 'vt-tone--up' : 'vt-tone--down'}>
            {usd(series[hover].userPnl)} trader PnL
          </span>
        </div>
      ) : null}
    </div>
  )
}

export default function VtUsers({ firstHand, platformName }) {
  const series = firstHand?.series || []

  const summary = useMemo(() => {
    if (!series.length) return null
    const latest = series[series.length - 1]
    const totalRevenue = series.reduce((a, d) => a + (d.revenue || 0), 0)
    const totalPnl = series.reduce((a, d) => a + (d.userPnl || 0), 0)
    const totalTrades = series.reduce((a, d) => a + (d.trades || 0), 0)
    const totalVolume = series.reduce((a, d) => a + (d.perpVolume || 0), 0)
    const avgDau = series.reduce((a, d) => a + (d.dau || 0), 0) / series.length
    const newShare = latest.dau ? (latest.newUsers / latest.dau) * 100 : null
    return { latest, totalRevenue, totalPnl, totalTrades, totalVolume, avgDau, newShare }
  }, [series])

  if (!firstHand || !series.length) return null

  const win = firstHand.windowDays
  const cohorts = firstHand.cohorts || []

  return (
    <section className="vt-section vt-users" id="users">
      <header className="vt-section__head">
        <div>
          <span className="vt-eyebrow">Users · first-hand</span>
          <h2>Who trades on {platformName}</h2>
          <p className="vt-section__sub">
            Counted by Spectre from every fill routed through this platform over the last {win} days.
            Not reported, not estimated, not bought.
          </p>
        </div>
      </header>

      <dl className="vt-kpis vt-kpis--users">
        <div>
          <dt>Traders, latest day</dt>
          <dd>{count(summary.latest.dau)}</dd>
          <span className="vt-kpis__note">{shortDate(summary.latest.day)}</span>
        </div>
        <div>
          <dt>New that day</dt>
          <dd>{count(summary.latest.newUsers)}</dd>
          <span className="vt-kpis__note">{summary.newShare != null ? `${pct(summary.newShare, { sign: false })} of actives` : ''}</span>
        </div>
        <div>
          <dt>Unique in {win}d</dt>
          <dd>{count(firstHand.windowUsers)}</dd>
          <span className="vt-kpis__note">avg {count(Math.round(summary.avgDau))}/day</span>
        </div>
        <div>
          <dt>D7 retention</dt>
          <dd>{firstHand.retentionD7 != null ? pct(firstHand.retentionD7, { sign: false }) : '—'}</dd>
          <span className="vt-kpis__note">{cohorts.length ? `${cohorts.length} cohorts` : 'needs a longer window'}</span>
        </div>
        <div>
          <dt>Revenue / trader</dt>
          <dd>{usd(summary.latest.arpu)}</dd>
          <span className="vt-kpis__note">{usd(summary.totalRevenue)} over {win}d</span>
        </div>
        <div>
          <dt>Trader PnL, {win}d</dt>
          <dd className={summary.totalPnl >= 0 ? 'vt-tone--up' : 'vt-tone--down'}>{usd(summary.totalPnl)}</dd>
          <span className="vt-kpis__note">net realised, all users</span>
        </div>
      </dl>

      <Bars series={series} />

      <ul className="vt-users__legend">
        <li><i className="vt-dot vt-dot--new" aria-hidden="true" /> first seen in this window</li>
        <li><i className="vt-dot vt-dot--ret" aria-hidden="true" /> returning</li>
      </ul>

      {summary.latest.topCoins?.length ? (
        <div className="vt-users__coins">
          <span className="vt-users__coins-label">What they traded on {shortDate(summary.latest.day)}</span>
          <ul>
            {summary.latest.topCoins.map((c) => (
              <li key={c.coin}>
                <strong>{c.coin.replace(/^xyz:/, '')}</strong>
                <span>{usd(c.volume)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="vt-note vt-note--dim">
        &ldquo;New&rdquo; means first seen inside this {win}-day window, so a returning user who was
        last active before it counts as new. Retention reports cohorts with a full 7-day runway and
        at least 10 traders.
        {firstHand.coverage?.truncated ? ' Some days in the window timed out and are absent from the chart.' : ''}
      </p>
    </section>
  )
}
