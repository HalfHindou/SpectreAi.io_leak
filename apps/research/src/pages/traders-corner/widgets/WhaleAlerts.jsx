/**
 * W-022 · Whale Alerts Widget
 * Shows whale flow direction (inflow/outflow/neutral) prominently,
 * whale-specific events from liveEvents, and volume-based whale
 * activity from top gainers/losers.
 * Powered by useMarketIntel real-time data.
 */
import { useMemo } from 'react'
import { useMarketIntel } from '@/hooks/useMarketIntel'
import './WhaleAlerts.css'

/* ---------- helpers ---------- */

function formatAbbrev(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '$0'
  const abs = Math.abs(num)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

/* ---------- direction config (dynamic — stays inline) ---------- */

function getDirectionConfig(direction) {
  switch (direction) {
    case 'inflow': return { label: 'NET INFLOW', color: 'var(--bull)', icon: '↗', bg: 'var(--bull-muted)' }
    case 'outflow': return { label: 'NET OUTFLOW', color: 'var(--bear)', icon: '↙', bg: 'var(--bear-muted)' }
    default: return { label: 'NEUTRAL', color: 'var(--amber)', icon: '↔', bg: 'rgba(245,158,11,0.08)' }
  }
}

/* ---------- pulse dot colors (dynamic — stays inline) ---------- */

function getPulseColor(type) {
  if (type === 'whale') return 'var(--amber)'
  if (type === 'breakout') return 'var(--bull)'
  if (type === 'liquidation') return 'var(--bear)'
  if (type === 'volume') return 'var(--violet)'
  return 'var(--text-muted)'
}

/* ---------- component ---------- */

export default function WhaleAlerts() {
  const { whaleFlows, liveEvents, tickers, loading } = useMarketIntel()

  const dirConfig = getDirectionConfig(whaleFlows.direction)

  // Build whale event list:
  // 1) Whale-type events from liveEvents
  // 2) Supplement with high-volume gainers/losers for whale activity signals
  const whaleEventList = useMemo(() => {
    const events = []

    // Whale-specific liveEvents first
    const whaleEvents = (liveEvents || []).filter(ev => ev.type === 'whale')
    whaleEvents.forEach(ev => {
      events.push({
        id: ev.id,
        token: ev.token,
        type: ev.type,
        action: ev.action,
        amount: ev.amount,
        time: ev.time,
        isNew: ev.isNew,
      })
    })

    // Add other notable events (breakouts, dumps) as whale-adjacent activity
    const otherEvents = (liveEvents || []).filter(ev => ev.type !== 'whale')
    otherEvents.forEach(ev => {
      events.push({
        id: ev.id,
        token: ev.token,
        type: ev.type,
        action: ev.action,
        amount: ev.amount,
        time: ev.time,
        isNew: ev.isNew,
      })
    })

    // If we still have room, add top volume movers from tickers
    const gainers = tickers?.topGainers || []
    const losers = tickers?.topLosers || []
    const bigMovers = [...gainers, ...losers]
      .filter(t => t.volume > 50000000) // >$50M volume
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 3)

    bigMovers.forEach((t, idx) => {
      const exists = events.some(e => e.token === t.symbol)
      if (!exists) {
        events.push({
          id: `vol-mover-${t.symbol}-${idx}`,
          token: t.symbol,
          type: 'volume',
          action: `${Number(t.change) >= 0 ? '+' : ''}${Number(t.change || 0).toFixed(1)}% | ${formatAbbrev(t.volume)} vol`,
          amount: formatAbbrev(t.volume),
          time: 'live',
          isNew: false,
        })
      }
    })

    return events.slice(0, 6)
  }, [liveEvents, tickers])

  return (
    <div className="tcwa">
      {/* Whale flow direction header */}
      {loading ? (
        <div className="tcw-shimmer tcwa-skeleton-head" />
      ) : (
        <div className="tcwa-dir" style={{ background: dirConfig.bg }}>
          <span className="tcwa-dir-icon">{dirConfig.icon}</span>
          <div className="tcwa-dir-body">
            <div className="tcwa-dir-label" style={{ color: dirConfig.color }}>{dirConfig.label}</div>
            <div className="tcwa-dir-value" style={{ color: dirConfig.color }}>
              {whaleFlows.net >= 0 ? '+' : ''}{whaleFlows.net}{whaleFlows.unit}
            </div>
          </div>
        </div>
      )}

      {/* Event rows */}
      <div className="tcwa-feed">
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="tcw-shimmer tcwa-skeleton-row" />
          ))
        ) : (
          whaleEventList.map((ev, i) => (
            <div
              key={ev.id}
              className={`tcwa-row${i === 0 && ev.isNew ? ' tcwa-row--new' : ''}`}
            >
              <div className="tcwa-dot" style={{ background: getPulseColor(ev.type) }} />
              <span className="tcwa-type">{ev.type.toUpperCase().slice(0, 5)}</span>
              <span className="tcwa-token">{ev.token}</span>
              <span className="tcwa-action">{ev.action}</span>
              <span className="tcwa-time">{ev.time}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
