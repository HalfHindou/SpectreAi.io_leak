/**
 * VCUniverseMap — "Token Consensus" view.
 *
 * Inverts the smart-money holdings graph: every token the tracked funds hold,
 * ranked by conviction (how many funds back it), with the backer stack ordered
 * by AUM, a live 24h tape, and a Pool AUM · backers · MCAP readout. A summary
 * strip up top reports the live state of the whole universe. All figures are
 * computed from the live price feed — nothing is hardcoded.
 */
import React, { useMemo } from 'react'
import {
  buildConsensus, buildSectors, parseUsdAum,
  fmtUsdCompact, fmtPct, classOfPct,
} from './smu-shared'
import { TokenLogo, BackerStack } from './smu-bits'
import './vc-universe-map.css'

function StatTile({ label, value, sub, cls }) {
  return (
    <div className="smu-stat">
      <div className="smu-stat-label">{label}</div>
      <div className={`smu-stat-value ${cls || ''}`}>{value}</div>
      {sub && <div className="smu-stat-sub">{sub}</div>}
    </div>
  )
}

export default function VCUniverseMap({ entities, priceMap, onSelectEntity, onOpenToken }) {
  const allRows = useMemo(() => buildConsensus(entities, priceMap), [entities, priceMap])
  // "Consensus" = real smart-money overlap: only tokens backed by 2+ funds.
  const rows = useMemo(() => allRows.filter((r) => r.backerCount >= 2), [allRows])

  const stats = useMemo(() => {
    const combinedAum = entities.reduce((s, e) => s + (parseUsdAum(e.aum_estimate) || 0), 0)
    const uniqueTokens = new Set()
    for (const e of entities) for (const t of e.known_portfolio_tokens || []) uniqueTokens.add(String(t).toUpperCase())

    const priced = rows.filter((r) => Number.isFinite(r.change24h))
    const avg24h = priced.length ? priced.reduce((s, r) => s + r.change24h, 0) / priced.length : null

    const sectors = buildSectors(entities, priceMap, '24h')
    const top = sectors[0] || null

    return {
      funds: entities.length,
      combinedAum,
      uniqueTokens: uniqueTokens.size,
      avg24h,
      topSector: top,
    }
  }, [entities, priceMap, rows])

  // Tape length scales with conviction (backer count) relative to the leader.
  const maxBackers = rows.reduce((m, r) => Math.max(m, r.backerCount), 1)

  return (
    <div className="smu-consensus">
      {/* Universe summary strip */}
      <div className="smu-summary">
        <StatTile label="FUNDS" value={stats.funds} />
        <StatTile label="COMBINED AUM" value={fmtUsdCompact(stats.combinedAum)} />
        <StatTile label="UNIQUE TOKENS" value={stats.uniqueTokens} />
        <StatTile
          label="TOP SECTOR"
          value={stats.topSector?.label || '—'}
          sub={stats.topSector ? `${stats.topSector.fundCount} funds` : null}
        />
        <StatTile
          label="AVG 24H · BACKED"
          value={fmtPct(stats.avg24h)}
          cls={classOfPct(stats.avg24h)}
        />
        <div className="smu-stat smu-stat--live">
          <span className="smu-live-dot" aria-hidden />
          <div>
            <div className="smu-stat-value smu-stat-value--live">LIVE</div>
            <div className="smu-stat-sub">30s pulse</div>
          </div>
        </div>
      </div>

      {/* Consensus table */}
      <div className="smu-cons-head">
        <span className="smu-cons-title">Token Consensus</span>
        <span className="smu-cons-desc">Smart-money overlap · backers ordered by AUM · live 24H tape</span>
      </div>

      <div className="smu-cons-colhead">
        <span className="smu-col-token">TOKEN</span>
        <span className="smu-col-backers">BACKERS · ORDERED BY AUM</span>
        <span className="smu-col-stats">POOL AUM · 24H · MCAP</span>
      </div>

      <div className="smu-cons-list">
        {rows.map((r) => {
          const tapePct = Math.max(0.12, r.backerCount / maxBackers)
          const sign = Number.isFinite(r.change24h) ? (r.change24h >= 0 ? 'bull' : 'bear') : 'flat'
          return (
            <button
              key={r.symbol}
              type="button"
              className="smu-cons-row"
              onClick={() => onOpenToken?.(r.symbol)}
              title={`See every fund backing $${r.symbol}`}
            >
              <span className="smu-col-token">
                <TokenLogo symbol={r.symbol} image={r.image} size={30} />
                <span className="smu-token-id">
                  <span className="smu-token-sym">${r.symbol}</span>
                  <span className={`smu-token-chg ${classOfPct(r.change24h)}`}>{fmtPct(r.change24h)}</span>
                </span>
              </span>

              <span className="smu-col-backers">
                <BackerStack entities={r.backers} max={8} size={30} onSelect={onSelectEntity} />
                <span className={`smu-tape smu-tape--${sign}`} aria-hidden>
                  <span className="smu-tape-fill" style={{ width: `${(tapePct * 100).toFixed(0)}%` }} />
                </span>
              </span>

              <span className="smu-col-stats">
                <span className="smu-stat-pool">{fmtUsdCompact(r.poolAum)}</span>
                <span className="smu-stat-backers">{r.backerCount}×</span>
                <span className="smu-stat-mcap">{r.marketCap != null ? fmtUsdCompact(r.marketCap) : '—'}</span>
                <svg className="smu-cons-go" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="9 18 15 12 9 6" /></svg>
              </span>
            </button>
          )
        })}
        {rows.length === 0 && <div className="smu-cons-empty">Streaming live consensus…</div>}
      </div>
    </div>
  )
}
