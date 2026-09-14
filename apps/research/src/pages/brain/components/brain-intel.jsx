/**
 * Brain — Market Intel.
 *
 * The interpreted intel surface (aixbt-grade): the Brain's synthesized read of
 * what matters and why — a thesis briefing, the conviction plays where social +
 * capital + news align, labeled smart-money flows, the sectors heating with the
 * tokens driving them, froth collapsing, and the accounts pushing. This is the
 * "so what", not raw event data.
 */
import React from 'react'
import useBrainIntel from './use-brain-intel'
import BrainSectionHead from './brain-section-head'
import './brain-intel.css'

function human(v) {
  if (v == null) return null
  const x = Number(v)
  if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(2)}B`
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(1)}M`
  if (Math.abs(x) >= 1e3) return `$${(x / 1e3).toFixed(0)}K`
  return `$${x.toFixed(0)}`
}
/* bold $tickers, $amounts, %s, N× inside intel prose */
function bold(text) {
  if (!text) return null
  const parts = String(text).split(/(\$[A-Z]{2,10}\b|\$[\d,.]+[BMKT]?|[+-]?\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b)/g)
  return parts.map((p, i) =>
    /^(\$[A-Z]{2,10}|\$[\d,.]+[BMKT]?|[+-]?\d+(?:\.\d+)?%|\d+(?:\.\d+)?x)$/.test(p) ? <strong key={i}>{p}</strong> : p
  )
}

function Card({ title, count, hint, tone, children }) {
  return (
    <div className={`bi-card ${tone ? `bi-card--${tone}` : ''}`}>
      <div className="bi-card-head">
        <span className="bi-card-title">{title}</span>
        {count != null && <span className="bi-card-count">{count}</span>}
        {hint && <span className="bi-card-hint">{hint}</span>}
      </div>
      <div className="bi-card-body">{children}</div>
    </div>
  )
}

export default function BrainIntel() {
  const { data, loading, error } = useBrainIntel()

  if (loading && !data) {
    return (
      <section className="bi">
        <div className="bi-thesis bi-thesis--sk">
          <span className="sk bi-sk" style={{ width: '30%', height: 12 }} />
          <span className="sk bi-sk" style={{ width: '92%' }} />
          <span className="sk bi-sk" style={{ width: '80%' }} />
        </div>
      </section>
    )
  }
  if (!data) return null // intel unavailable → section hides; hero + board still stand

  const { marketThesis, convergence, smartMoney, sectors, blowups, bigAccounts } = data

  return (
    <section className="bi">
      <BrainSectionHead
        eyebrow="Market Intel"
        title="The So-What"
        sub="the interpreted read of the tape — conviction, flows, sectors, froth"
      />
      {marketThesis && (
        <div className="bi-thesis">
          <p className="bi-thesis-txt">{bold(marketThesis)}</p>
        </div>
      )}

      <div className="bi-grid">
        {convergence.length > 0 && (
          <Card title="Conviction Plays" count={convergence.length} hint="social + capital + news aligned" tone="bull">
            {convergence.map((c, i) => (
              <div className="bi-row" key={i}>
                <span className="bi-asset bi-asset--bull">${c.asset}</span>
                <span className="bi-row-txt">{bold(c.verdict || c.social || c.news || 'multi-source conviction')}</span>
              </div>
            ))}
          </Card>
        )}

        {smartMoney.length > 0 && (
          <Card title="Smart Money" count={smartMoney.length} hint="labeled wallet flows">
            {smartMoney.map((m, i) => {
              const inflow = String(m.action).toLowerCase() === 'receive'
              return (
                <div className="bi-row" key={i}>
                  <span className="bi-asset">${m.asset}</span>
                  <span className={`bi-flow ${inflow ? 'bi-flow--in' : 'bi-flow--out'}`}>
                    {inflow ? '▼ in' : '▲ out'} {human(m.amount_usd)}
                  </span>
                  <span className="bi-row-txt">{bold(m.read)}</span>
                </div>
              )
            })}
          </Card>
        )}

        {sectors.length > 0 && (
          <Card title="Sectors Heating" count={sectors.length} hint="attention heat + drivers">
            {sectors.map((s, i) => (
              <div className="bi-sector" key={i}>
                <div className="bi-sector-head">
                  <span className="bi-sector-name">{s.sector}</span>
                  {s.heat != null && <span className="bi-heat">{Number(s.heat).toFixed(1)}×</span>}
                </div>
                <div className="bi-sector-toks">
                  {(s.driving_tokens || []).slice(0, 4).map((t, j) => (
                    <span className="bi-tok" key={j} title={t.why || ''}>${t.symbol}</span>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}

        {blowups.length > 0 && (
          <Card title="Froth Watch" count={blowups.length} hint="collapsing / no capital" tone="bear">
            {blowups.map((b, i) => (
              <div className="bi-row" key={i}>
                <span className="bi-asset bi-asset--bear">${b.symbol}</span>
                <span className="bi-blow-status">{b.status}</span>
                {b.since_tracked_roi_pct != null && (
                  <span className="bi-blow-roi">{Number(b.since_tracked_roi_pct).toFixed(0)}%</span>
                )}
              </div>
            ))}
          </Card>
        )}

        {bigAccounts.length > 0 && (
          <Card title="Accounts to Watch" count={bigAccounts.length} hint="who's pushing what">
            {bigAccounts.map((a, i) => (
              <div className="bi-acct" key={i}>
                <div className="bi-acct-top">
                  <span className="bi-acct-handle">@{a.handle}</span>
                  {a.pushing?.length ? <span className="bi-acct-push">{a.pushing.map((p) => `$${p}`).join(' ')}</span> : null}
                </div>
                {a.gist && <span className="bi-acct-gist">{a.gist}</span>}
              </div>
            ))}
          </Card>
        )}
      </div>
    </section>
  )
}
