/**
 * YouRwaOverview — Real-world asset (RWA) protocol overview.
 *
 * Pulls /api/rwa/overview which surfaces total RWA TVL, top protocols by
 * TVL, asset-class breakdown, and chain coverage. Sister endpoint
 * /api/rwa/movers is fetched in parallel for 24h/7d standouts.
 *
 * Refresh every 5 min — RWA TVL is a slow-moving signal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouRwaOverview.css'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return ''
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`
}

export default function YouRwaOverview() {
  const [overview, setOverview] = useState(null)
  const [movers, setMovers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const [oRes, mRes] = await Promise.allSettled([
        fetch('/api/rwa/overview', { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null),
        fetch('/api/rwa/movers?limit=4', { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null),
      ])
      if (oRes.status === 'fulfilled') setOverview(oRes.value || null)
      if (mRes.status === 'fulfilled') setMovers(mRes.value || null)
      setError(null)
    } catch (err) {
      setError(err?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, REFRESH_INTERVAL_MS)

  const protocols = useMemo(
    () => (Array.isArray(overview?.topProtocols) ? overview.topProtocols.slice(0, 5) : []),
    [overview],
  )

  const moverRows = useMemo(() => {
    if (!movers) return []
    const arr = Array.isArray(movers.gainers) ? movers.gainers
      : Array.isArray(movers.movers) ? movers.movers
      : Array.isArray(movers) ? movers : []
    return arr.slice(0, 4)
  }, [movers])

  if (loading && !overview) {
    return (
      <div className="you-rwa">
        <div className="you-shimmer" style={{ width: '50%', height: 14, marginBottom: 8, borderRadius: 4 }} />
        <div className="you-shimmer" style={{ width: '80%', height: 24, marginBottom: 16, borderRadius: 4 }} />
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="you-shimmer" style={{ width: '100%', height: 14, marginBottom: 6, borderRadius: 4 }} />
        ))}
      </div>
    )
  }

  if (error || (!overview && !movers)) {
    return (
      <div className="you-rwa-empty">
        <span className="you-rwa-empty-text">RWA feed unavailable.</span>
      </div>
    )
  }

  return (
    <div className="you-rwa">
      {overview && (
        <header className="you-rwa-summary">
          <div className="you-rwa-summary-stat">
            <span className="you-rwa-summary-label">Total RWA TVL</span>
            <span className="you-rwa-summary-value mono">{fmtUsd(overview.totalTvl)}</span>
          </div>
          <div className="you-rwa-summary-stat">
            <span className="you-rwa-summary-label">Protocols</span>
            <span className="you-rwa-summary-value mono">{overview.totalProtocols ?? '—'}</span>
          </div>
          <div className="you-rwa-summary-stat">
            <span className="you-rwa-summary-label">Chains</span>
            <span className="you-rwa-summary-value mono">{overview.totalChains ?? '—'}</span>
          </div>
        </header>
      )}

      {protocols.length > 0 && (
        <section className="you-rwa-section">
          <h4 className="you-rwa-section-label">Top protocols by TVL</h4>
          <ul className="you-rwa-list">
            {protocols.map((p) => {
              const change = p.change_1d ?? p.change_7d
              const tone = change > 0 ? 'bull' : change < 0 ? 'bear' : 'neutral'
              return (
                <li key={p.slug || p.name} className="you-rwa-row">
                  {p.logo ? (
                    <img className="you-rwa-logo" src={p.logo} alt="" loading="lazy"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                  ) : (
                    <span className="you-rwa-logo you-rwa-logo--placeholder">•</span>
                  )}
                  <div className="you-rwa-row-meta">
                    <span className="you-rwa-row-name">{p.name}</span>
                    <span className="you-rwa-row-tag mono">{p.asset_class || (p.tags?.[0]) || 'rwa'}</span>
                  </div>
                  <span className="you-rwa-row-tvl mono">{fmtUsd(p.tvl)}</span>
                  {change != null && (
                    <span className={`you-rwa-row-change you-rwa-row-change--${tone} mono`}>
                      {fmtPct(change)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {moverRows.length > 0 && (
        <section className="you-rwa-section">
          <h4 className="you-rwa-section-label">24h movers</h4>
          <ul className="you-rwa-list">
            {moverRows.map((m, idx) => {
              const change = m.change_1d ?? m.change_24h ?? 0
              const tone = change > 0 ? 'bull' : change < 0 ? 'bear' : 'neutral'
              return (
                <li key={(m.slug || m.name) + idx} className="you-rwa-row you-rwa-row--mover">
                  <span className="you-rwa-row-name">{m.name || m.symbol || '—'}</span>
                  <span className={`you-rwa-row-change you-rwa-row-change--${tone} mono`}>{fmtPct(change)}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
