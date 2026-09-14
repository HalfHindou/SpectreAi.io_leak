/**
 * FreshnessTag — inline "Live · 12s ago" pill that shows how fresh the data
 * is on a given surface. Drop this next to any section header to give users
 * a visible trust signal that the data is real-time.
 *
 * Tier-aware thresholds — cheap to render (no fetching, just a ts prop) but
 * always-realtime in appearance because warm/cold tiers get longer green
 * windows that match their natural refresh cadence.
 *
 *   HOT  (prices, X-Dash, momentum, F&G)        green <2m  amber 2-5m  red >5m
 *   WARM (breakdowns, news, ventures scores)    green <10m amber 10-30m red >30m
 *   COLD (AI articles, TVL history, aggregates) green <2h  amber 2-8h  red >8h
 *
 * Refreshes its age display every 30s without re-rendering parents.
 *
 * Usage:
 *   <FreshnessTag timestamp={data.generated_at} tier="warm" />
 *   <FreshnessTag timestamp={1779100000000} tier="hot" label="X-Dash" />
 */
import React, { memo, useEffect, useState } from 'react'
import './freshness-tag.css'

// Tier thresholds aligned to actual upstream refresh cadences:
//   HOT  prices / X-Dash board / momentum — Hetzner workers tick every 5-10m,
//        SWR amplifies up to 60s. Green 5m, amber 15m, red beyond.
//   WARM RWA breakdowns / news / scores — 60s server cache + ~5min cadence
//        on most upstreams. Green 15m, amber 60m, red beyond.
//   COLD AI editorial / TVL history / aggregates — Spectre Analyst agent
//        refreshes 1 topic per ~3.5h cycle (7 topics → ~24h round trip).
//        Green 12h, amber 36h, red beyond. Reflects design, not laziness.
const THRESHOLDS = {
  hot:  { green: 5 * 60_000,     amber: 15 * 60_000 },
  warm: { green: 15 * 60_000,    amber: 60 * 60_000 },
  cold: { green: 12 * 3600_000,  amber: 36 * 3600_000 },
}

function toMs(ts) {
  if (ts == null) return null
  if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000
  const n = Date.parse(ts)
  return Number.isFinite(n) ? n : null
}

function fmtAge(ms) {
  if (ms == null || ms < 0) return '—'
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function statusFor(ageMs, tier) {
  const t = THRESHOLDS[tier] || THRESHOLDS.warm
  if (ageMs == null) return 'unknown'
  if (ageMs <= t.green) return 'live'
  if (ageMs <= t.amber) return 'aging'
  return 'stale'
}

const FreshnessTag = memo(function FreshnessTag({
  timestamp,
  tier = 'warm',
  label = null,
  showAge = true,
  className = '',
}) {
  // Tick every 30s so the age display stays current without forcing parent re-renders.
  // Skip the setState while the tab is hidden: FreshnessTag is rendered on many
  // cards at once, so an unguarded tick re-renders dozens of them every 30s on a
  // backgrounded tab. On return, the next tick (≤30s) refreshes the age.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      setNowMs(Date.now())
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const tsMs = toMs(timestamp)
  const ageMs = tsMs ? Math.max(0, nowMs - tsMs) : null
  const status = statusFor(ageMs, tier)

  return (
    <span
      className={`fresh-tag fresh-tag--${status} ${className}`.trim()}
      title={tsMs ? new Date(tsMs).toLocaleString() : 'No timestamp'}
    >
      <span className="fresh-tag__dot" aria-hidden />
      <span className="fresh-tag__label">
        {label || (status === 'live' ? 'Live' : status === 'aging' ? 'Aging' : status === 'stale' ? 'Stale' : 'No data')}
      </span>
      {showAge && ageMs != null && (
        <span className="fresh-tag__age">· {fmtAge(ageMs)}</span>
      )}
    </span>
  )
})

export default FreshnessTag
