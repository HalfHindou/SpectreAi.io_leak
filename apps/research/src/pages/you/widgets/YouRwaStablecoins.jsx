/**
 * YouRwaStablecoins — Tokenized stablecoins breakdown.
 * Pulls /api/rwa/stablecoins (Spectre RWA aggregator).
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouRwaStablecoins.css'

function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${Math.round(v)}`
}

export default function YouRwaStablecoins() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/rwa/stablecoins', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 5 * 60 * 1000)

  if (loading && !data) return <div className="you-rs">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 28, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || !data) return <div className="you-rs-empty">RWA stablecoins unavailable.</div>

  const total = data.totalMcap ?? data.totalSupply ?? data.total ?? 0
  const items = (Array.isArray(data.stablecoins) ? data.stablecoins
    : Array.isArray(data.protocols) ? data.protocols
    : Array.isArray(data) ? data : []).slice(0, 8)

  return (
    <div className="you-rs">
      <div className="you-rs-summary">
        <span className="you-rs-summary-label">Stablecoins TVL</span>
        <span className="you-rs-summary-value mono">{fmtUsd(total)}</span>
      </div>
      <ul className="you-rs-list">
        {items.map((s, i) => {
          const ch = s.change_1d ?? s.change_24h ?? 0
          const tone = ch > 0 ? 'bull' : ch < 0 ? 'bear' : 'neutral'
          return (
            <li key={s.slug || s.symbol || i} className="you-rs-row">
              {s.logo && <img className="you-rs-logo" src={s.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
              <div className="you-rs-name">
                <span>{s.name || s.symbol || 'Unknown'}</span>
                {s.symbol && s.symbol !== s.name && <span className="you-rs-sym mono">{s.symbol}</span>}
              </div>
              <span className="you-rs-tvl mono">{fmtUsd(s.mcap || s.tvl || s.supply)}</span>
              {ch !== 0 && (
                <span className={`you-rs-ch you-rs-ch--${tone} mono`}>{ch >= 0 ? '+' : ''}{Number(ch).toFixed(1)}%</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
