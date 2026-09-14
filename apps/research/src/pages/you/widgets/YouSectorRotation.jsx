/**
 * YouSectorRotation — crypto sectors with 24h change leaderboard.
 * Reuses the existing useSectorData hook (already plumbed for the home page
 * Sectors tab). Renders top movers + worst movers as two-column bars.
 */
import { useMemo } from 'react'
import useSectorData from '@/hooks/useSectorData'
import './YouSectorRotation.css'

export default function YouSectorRotation() {
  const { data, loading, error } = useSectorData()

  const rows = useMemo(() => {
    const sectors = Array.isArray(data?.sectors) ? data.sectors
      : Array.isArray(data?.categories) ? data.categories
      : Array.isArray(data) ? data : []
    return sectors
      .map(s => ({
        id: s.id || s.slug || s.name,
        name: s.name || s.label || s.id || 'Unknown',
        change_24h: Number(s.change_24h ?? s.change_1d ?? s.market_cap_change_24h ?? 0),
      }))
      .filter(s => Number.isFinite(s.change_24h))
      .sort((a, b) => b.change_24h - a.change_24h)
  }, [data])

  if (loading && rows.length === 0) {
    return <div className="you-sr">{[0,1,2,3,4].map(i => <div key={i} className="you-shimmer" style={{ height: 12, marginBottom: 8, borderRadius: 4 }} />)}</div>
  }
  if (error || rows.length === 0) return <div className="you-sr-empty">Sector data unavailable.</div>

  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.change_24h)), 0) || 1
  const top = rows.slice(0, 5)
  const bottom = rows.slice(-5).reverse()

  const Bar = ({ s, tone }) => {
    const w = Math.max(4, (Math.abs(s.change_24h) / max) * 100)
    return (
      <li className="you-sr-row">
        <span className="you-sr-name">{s.name}</span>
        <div className={`you-sr-bar you-sr-bar--${tone}`}>
          <span className="you-sr-bar-fill" style={{ width: `${w}%` }} />
        </div>
        <span className={`you-sr-ch you-sr-ch--${tone} mono`}>
          {s.change_24h >= 0 ? '+' : ''}{s.change_24h.toFixed(1)}%
        </span>
      </li>
    )
  }

  return (
    <div className="you-sr">
      <h4 className="you-sr-label">Leaders</h4>
      <ul>{top.map(s => <Bar key={s.id} s={s} tone="bull" />)}</ul>
      <h4 className="you-sr-label">Laggards</h4>
      <ul>{bottom.map(s => <Bar key={s.id} s={s} tone="bear" />)}</ul>
    </div>
  )
}
