import React, { useMemo } from 'react'
import './creative-base.css'
import './LiveFlowTicker.css'

/* ── Formatters ── */
function fmtUsd(v) {
  if (v == null || !isFinite(v)) return '--'
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  if (abs > 0) return `${sign}<$1K`
  return '$0'
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '--'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

/* Map noisy DeFi Llama asset_class strings to short display labels */
function classLabel(p) {
  const cls = (p.asset_class || '').toLowerCase()
  if (cls === 'treasuries') return 'Treasuries'
  if (cls === 'credit') return 'Credit'
  if (cls === 'commodities') return 'Commodities'
  if (cls === 'stocks' || cls === 'equity') return 'Equities'
  const tags = p.tags || []
  if (tags.some(t => /treasury/i.test(t))) return 'Treasuries'
  if (tags.some(t => /commodit/i.test(t))) return 'Commodities'
  if (tags.some(t => /credit/i.test(t))) return 'Credit'
  return p.category || 'RWA'
}

/* Same-sign single-day spike detector.
   DeFiLlama occasionally emits duplicate/backfill points that blow up change_7d.
   If |change_1d| > |change_7d| AND both share sign, the week's move is dominated by
   one day — likely an anomaly, not a real flow. Drop it so we don't surface bad data
   (e.g. Aave Horizon RWA during the Apr-2026 Aave incident: +25.9% 1d / +14.9% 7d). */
function isSingleDaySpike(p) {
  const c1 = p.change_1d, c7 = p.change_7d
  if (c1 == null || c7 == null) return false
  if (Math.abs(c7) < 0.5) return false
  const sameSign = (c1 > 0) === (c7 > 0)
  if (!sameSign) return false
  return Math.abs(c1) > Math.abs(c7) * 1.1
}

/* Build ranked rows with computed 7D flow (TVL × change%).
   Filters out tiny TVL (<$2M: noisy %), missing changes, wrong direction for the
   bucket, and same-day spikes where the 7d number is unreliable. */
function buildRows(list, sign) {
  return (list || [])
    .filter(p => !isSingleDaySpike(p))
    .map(p => {
      const change = p.change_7d ?? p.change_1d ?? 0
      const tvl = p.tvl || 0
      const flow = tvl * (change / 100)
      return {
        slug: p.slug,
        name: p.name,
        logo: p.logo,
        tvl,
        change,
        flow,
        cls: classLabel(p),
      }
    })
    .filter(r => r.tvl >= 2e6 && r.change != null && (sign > 0 ? r.change > 0 : r.change < 0))
    .sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow))
    .slice(0, 4)
}

function FlowRow({ r, dir, maxAbsFlow }) {
  const magnitude = maxAbsFlow > 0 ? Math.max(0.06, Math.abs(r.flow) / maxAbsFlow) : 0
  return (
    <a
      className={`tfb__row tfb__row--${dir}`}
      href={`https://defillama.com/protocol/${r.slug}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="tfb__bar" style={{ '--mag': magnitude }} aria-hidden />
      <div className="tfb__row-inner">
        <div className="tfb__id">
          {r.logo ? (
            <img
              className="tfb__logo"
              src={r.logo}
              alt=""
              loading="lazy"
              onError={e => {
                e.currentTarget.style.display = 'none'
                const fb = e.currentTarget.nextSibling
                if (fb) fb.style.display = 'inline-flex'
              }}
            />
          ) : null}
          <span className="tfb__logo-fb" style={{ display: r.logo ? 'none' : 'inline-flex' }}>
            {(r.name || '?')[0]}
          </span>
          <div className="tfb__id-text">
            <span className="tfb__name">{r.name}</span>
            <span className="tfb__cls">{r.cls}</span>
          </div>
        </div>
        <div className="tfb__vals">
          <span className={`tfb__amt mono tfb__amt--${dir}`}>
            {dir === 'in' ? '+' : ''}{fmtUsd(r.flow)}
          </span>
          <span className="tfb__base mono">{fmtUsd(r.tvl)} AUM · {fmtPct(r.change)}</span>
        </div>
      </div>
    </a>
  )
}

export default function LiveFlowTicker({ movers, loading }) {
  const inflows = useMemo(() => buildRows(movers?.gainers, +1), [movers])
  const outflows = useMemo(() => buildRows(movers?.losers, -1), [movers])

  const totalIn = useMemo(() => inflows.reduce((s, r) => s + r.flow, 0), [inflows])
  const totalOut = useMemo(() => outflows.reduce((s, r) => s + r.flow, 0), [outflows])
  const maxAbs = useMemo(
    () => Math.max(
      ...inflows.map(r => Math.abs(r.flow)),
      ...outflows.map(r => Math.abs(r.flow)),
      1,
    ),
    [inflows, outflows]
  )

  const empty = !loading && inflows.length === 0 && outflows.length === 0

  return (
    <div className="ta-creative tfb">
      <div className="ta-creative__head tfb__head">
        <div className="tfb__title-block">
          <span className="tfb__title">7D Flow Board</span>
          <span className="tfb__subtitle mono">AUM × 7D change · top movers</span>
        </div>
        <div className="tfb__net">
          <span className="tfb__net-stat">
            <span className="tfb__net-label">Net In</span>
            <span className="tfb__net-val tfb__net-val--in mono">{fmtUsd(totalIn)}</span>
          </span>
          <span className="tfb__net-div" />
          <span className="tfb__net-stat">
            <span className="tfb__net-label">Net Out</span>
            <span className="tfb__net-val tfb__net-val--out mono">{fmtUsd(totalOut)}</span>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="tfb__skel">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`tfb__skel-row animate-shimmer stagger-${(i % 5) + 1}`} />
          ))}
        </div>
      ) : empty ? (
        <div className="tfb__empty">No flow movers in the last 7 days.</div>
      ) : (
        <div className="tfb__grid">
          <section className="tfb__col">
            <header className="tfb__col-head">
              <span className="tfb__col-dot tfb__col-dot--in" />
              <span className="tfb__col-label">Inflows</span>
              <span className="tfb__col-count mono">{inflows.length}</span>
            </header>
            <div className="tfb__list">
              {inflows.length === 0 ? (
                <div className="tfb__col-empty">—</div>
              ) : (
                inflows.map(r => (
                  <FlowRow key={r.slug || r.name} r={r} dir="in" maxAbsFlow={maxAbs} />
                ))
              )}
            </div>
          </section>
          <section className="tfb__col">
            <header className="tfb__col-head">
              <span className="tfb__col-dot tfb__col-dot--out" />
              <span className="tfb__col-label">Outflows</span>
              <span className="tfb__col-count mono">{outflows.length}</span>
            </header>
            <div className="tfb__list">
              {outflows.length === 0 ? (
                <div className="tfb__col-empty">—</div>
              ) : (
                outflows.map(r => (
                  <FlowRow key={r.slug || r.name} r={r} dir="out" maxAbsFlow={maxAbs} />
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
