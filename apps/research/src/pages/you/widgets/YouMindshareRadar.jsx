/**
 * YouMindshareRadar — Asset mindshare snapshot.
 *
 * Reuses the existing useMindshareData hook (Cloud Run /narratives/mindshare
 * via /api/market/mindshare). Renders the top sectors as horizontal bars
 * showing share-of-mentions over the 24h window plus delta direction.
 *
 * Degrades gracefully: if the upstream returns an error or empty payload,
 * the widget shows a quiet "no data" message rather than crashing.
 */

import { useMemo } from 'react'
import useMindshareData from '@/hooks/useMindshareData'
import './YouMindshareRadar.css'

function shareValue(s) {
  return s?.mindshare_pct ?? s?.mindshare ?? s?.share ?? 0
}
function shareDelta(s) {
  return s?.mindshare_delta_pct ?? s?.delta_pct ?? s?.delta ?? 0
}

export default function YouMindshareRadar() {
  const { data, loading, error } = useMindshareData()

  const rows = useMemo(() => {
    if (!data) return []
    const sectors = Array.isArray(data?.sectors) ? data.sectors
      : Array.isArray(data?.matrix) ? data.matrix
      : []
    if (sectors.length === 0) return []
    const sorted = sectors
      .map((s) => ({
        id: s.id || s.slug || s.name,
        name: s.name || s.label || s.id || 'Unknown',
        share: Number(shareValue(s)) || 0,
        delta: Number(shareDelta(s)) || 0,
        stage: s.stage || s.lifecycle || null,
      }))
      .filter((s) => s.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, 7)

    const max = sorted.reduce((m, r) => Math.max(m, r.share), 0) || 1
    return sorted.map((r) => ({ ...r, _w: Math.max(8, (r.share / max) * 100) }))
  }, [data])

  if (loading && rows.length === 0) {
    return (
      <div className="you-ms">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="you-ms-row you-ms-row--skeleton">
            <div className="you-shimmer" style={{ width: '50%', height: 10, borderRadius: 4 }} />
            <div className="you-shimmer" style={{ width: '100%', height: 8, marginTop: 6, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    )
  }

  if (error || rows.length === 0) {
    return (
      <div className="you-ms-empty">
        <span className="you-ms-empty-text">Mindshare feed unavailable.</span>
      </div>
    )
  }

  return (
    <ul className="you-ms">
      {rows.map(r => {
        const tone = r.delta > 0.5 ? 'bull' : r.delta < -0.5 ? 'bear' : 'neutral'
        const sign = r.delta > 0 ? '+' : ''
        return (
          <li key={r.id} className="you-ms-row">
            <div className="you-ms-meta">
              <span className="you-ms-name">{r.name}</span>
              <span className={`you-ms-delta you-ms-delta--${tone} mono`}>
                {sign}{r.delta.toFixed(1)}%
              </span>
              <span className="you-ms-share mono">{r.share.toFixed(2)}%</span>
            </div>
            <div className="you-ms-bar">
              <span className={`you-ms-bar-fill you-ms-bar-fill--${tone}`} style={{ width: `${r._w}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
