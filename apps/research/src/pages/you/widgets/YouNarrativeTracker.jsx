/**
 * YouNarrativeTracker — Sector lifecycle tracker.
 * Each row shows a sector name, horizontal lifecycle bar with stage marker, and stage label.
 * Stages: Early -> Mid -> Late -> Exhausted
 *
 * Real data: fetches sector data from /api/market/sectors (same as useSectorData hook).
 * Falls back to hardcoded narratives if API unavailable.
 * Auto-refreshes every 5 minutes.
 *
 * Remix modes: lifecycle (default), ranking, tags
 */
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getSpectreCategories } from '@/services/spectreMarketApi'

const STAGE_SEGMENTS = ['Early', 'Mid', 'Late', 'Exhausted']
const segmentColors = ['#34d399', '#facc15', '#fb923c', '#ef4444']
const segmentColorsInactive = [
  'rgba(52,211,153,0.12)',
  'rgba(250,204,21,0.12)',
  'rgba(251,146,60,0.12)',
  'rgba(239,68,68,0.12)',
]

const stagePosition = {
  'early': 0.10,
  'early-mid': 0.25,
  'mid': 0.42,
  'mid-late': 0.58,
  'late': 0.75,
  'exhausted': 0.92,
  'growth': 0.20,
  'established': 0.50,
  'mature': 0.72,
}

const REFRESH_INTERVAL = 5 * 60 * 1000
const REMIX_MODES = ['lifecycle', 'ranking', 'tags']
const STORAGE_KEY = 'spectre:you-remix-you-narrative-tracker'

function isLocalViteDev() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

// Map API performance to stage + color
function mapToStage(lifecycle, performance, change) {
  let stage = 'mid'
  let stageLabel = 'Mid'
  let color = '#facc15'

  if (lifecycle === 'growth') { stage = 'early'; stageLabel = 'Early'; color = '#34d399' }
  else if (lifecycle === 'established') { stage = 'mid'; stageLabel = 'Mid'; color = '#facc15' }
  else if (lifecycle === 'mature') { stage = 'late'; stageLabel = 'Late'; color = '#fb923c' }

  // Override color based on performance
  if (performance === 'very_strong' || performance === 'strong') color = '#34d399'
  else if (performance === 'weak') color = '#ef4444'
  else if (change < -5) color = '#ef4444'
  else if (change > 5) color = '#34d399'

  return { stage, stageLabel, color }
}

function stageSegmentIndex(stage) {
  const pos = stagePosition[stage] ?? 0.5
  if (pos < 0.25) return 0
  if (pos < 0.50) return 1
  if (pos < 0.75) return 2
  return 3
}

export default function YouNarrativeTracker() {
  const [narratives, setNarratives] = useState([])
  const [loading, setLoading] = useState(true)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'lifecycle' } catch { return 'lifecycle' }
  })

  const cycleRemix = () => {
    const next = REMIX_MODES[(REMIX_MODES.indexOf(remix) + 1) % REMIX_MODES.length]
    setRemix(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }

  const fetchSectors = useCallback(async () => {
    try {
      const spectreCategories = await getSpectreCategories({ limit: 15 }).catch(() => [])
      const marketReadyCategories = spectreCategories.filter(s => s && s.name && s._hasMarketMetrics)
      if (marketReadyCategories.length > 0) {
        const mapped = marketReadyCategories
          .slice(0, 15)
          .map(s => {
            const change = Number(s.market_cap_change_24h ?? 0)
            const { stage, stageLabel, color } = mapToStage(null, null, change)
            return {
              id: s.slug || s.id || s.name.toLowerCase().replace(/\s+/g, '-'),
              name: s.name,
              stage,
              stageLabel,
              color,
              change,
            }
          })
        if (mapped.length >= 3) {
          setNarratives(mapped)
          return
        }
      }

      if (isLocalViteDev()) return

      const res = await fetch('/api/market/sectors')
      if (!res.ok) return
      const data = await res.json()
      const sectors = data.sectors || data
      if (!Array.isArray(sectors) || sectors.length === 0) return

      const mapped = sectors
        .filter(s => s && (s.sector_name || s.name))
        .slice(0, 15)
        .map(s => {
          const name = s.sector_name || s.name
          const change = s.change_24h ?? s.avgChange ?? 0
          const { stage, stageLabel, color } = mapToStage(s.lifecycle, s.performance, change)
          return {
            id: s.sector_id || s.id || name.toLowerCase().replace(/\s+/g, '-'),
            name,
            stage,
            stageLabel,
            color,
            change,
          }
        })

      if (mapped.length >= 3) setNarratives(mapped)
    } catch {
      // keep empty list on error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSectors() }, [fetchSectors])

  useAdaptivePolling(fetchSectors, { interval: REFRESH_INTERVAL })

  if (loading && narratives.length === 0) {
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="you-shimmer" style={{ height: 18, borderRadius: 7 }} />
          ))}
        </div>
      </div>
    )
  }

  // ── Tags Mode ──
  if (remix === 'tags') {
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start' }}>
          {narratives.map(n => (
            <div key={n.id} style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 20,
              background: `${n.color}12`,
              border: `1px solid ${n.color}30`,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: n.color }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 500, color: 'var(--text-primary)' }}>
                {n.name}
              </span>
              {(n.change ?? 0) !== 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: (n.change ?? 0) >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                  {(n.change ?? 0) >= 0 ? '+' : ''}{(n.change ?? 0).toFixed(1)}%
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Ranking Mode ──
  if (remix === 'ranking') {
    const sorted = [...narratives].sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {sorted.map((n, i) => (
            <div key={n.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              borderRadius: 8,
              background: i === 0 ? 'rgba(52,211,153,0.06)' : 'transparent',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', width: 16, textAlign: 'right' }}>
                {i + 1}
              </span>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: n.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.name}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: (n.change ?? 0) >= 0 ? 'var(--bull)' : 'var(--bear)', flexShrink: 0 }}>
                {(n.change ?? 0) >= 0 ? '+' : ''}{(n.change ?? 0).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Lifecycle Mode (default) ──
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      height: '100%',
      padding: '2px 0',
      position: 'relative',
    }}>
      <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, flexShrink: 0, paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {STAGE_SEGMENTS.map((seg, i) => (
          <div key={seg} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: segmentColors[i] }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {seg}
            </span>
          </div>
        ))}
      </div>

      {/* Scrollable rows */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {narratives.map((n) => {
          const pos = stagePosition[n.stage] ?? 0.5
          const activeIdx = stageSegmentIndex(n.stage)
          return (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.name}
              </div>
              <div style={{ flex: 1, height: 14, display: 'flex', gap: 2, position: 'relative', borderRadius: 7, overflow: 'visible' }}>
                {STAGE_SEGMENTS.map((_, i) => (
                  <div key={i} style={{
                    flex: 1,
                    borderRadius: i === 0 ? '7px 0 0 7px' : i === 3 ? '0 7px 7px 0' : 0,
                    background: i === activeIdx ? segmentColors[i] + '30' : segmentColorsInactive[i],
                    transition: 'background 0.2s ease',
                  }} />
                ))}
                <div style={{
                  position: 'absolute',
                  left: `calc(${pos * 100}% - 5px)`,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: n.color,
                  boxShadow: `0 0 6px ${n.color}60`,
                  border: '2px solid rgba(0,0,0,0.5)',
                  zIndex: 1,
                }} />
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: n.color, width: 60, flexShrink: 0, textAlign: 'right', letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                {n.stageLabel}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
