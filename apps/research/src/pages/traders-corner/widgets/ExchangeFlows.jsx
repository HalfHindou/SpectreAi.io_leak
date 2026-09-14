/**
 * W-020 · Exchange Flows Widget
 * Real-time exchange inflow/outflow with header stats from flowSummary,
 * and animated event rows from liveEvents.
 * Powered by useMarketIntel real-time data.
 */
import { useMarketIntel } from '@/hooks/useMarketIntel'
import './ExchangeFlows.css'

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

/* ---------- event type badge (dynamic colors — stay inline) ---------- */

function getEventBadge(type) {
  switch (type) {
    case 'breakout': return { label: 'BREAKOUT', color: 'var(--bull)', bg: 'var(--bull-muted)' }
    case 'liquidation': return { label: 'DUMP', color: 'var(--bear)', bg: 'var(--bear-muted)' }
    case 'whale': return { label: 'WHALE', color: 'var(--amber)', bg: 'rgba(245,158,11,0.12)' }
    case 'volume': return { label: 'VOL', color: 'var(--violet)', bg: 'rgba(167,139,250,0.12)' }
    case 'listing': return { label: 'TRACK', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.06)' }
    default: return { label: 'EVENT', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.06)' }
  }
}

/* ---------- component ---------- */

export default function ExchangeFlows() {
  const { flowSummary, liveEvents, loading } = useMarketIntel()

  // Convert from M (millions) to raw values for formatting
  const netFlow = (flowSummary.net || 0) * 1e6
  const totalIn = (flowSummary.inflow || 0) * 1e6
  const totalOut = (flowSummary.outflow || 0) * 1e6
  const netPositive = netFlow >= 0

  // Use liveEvents as the event feed — show breakout, liquidation, whale, volume events
  const events = liveEvents || []

  return (
    <div className="tcef">
      {/* Header stats row */}
      {loading ? (
        <div className="tcef-skeleton-head">
          <div className="tcw-shimmer" style={{ width: 90, height: 20 }} />
          <div className="tcw-shimmer" style={{ width: 70, height: 20 }} />
          <div className="tcw-shimmer" style={{ width: 70, height: 20 }} />
        </div>
      ) : (
        <div className="tcef-stats">
          <div className="tcef-stat">
            <span className="tcef-stat-label">Net Flow</span>
            <span className={`tcef-stat-value ${netPositive ? 'tcef-stat-value--bull' : 'tcef-stat-value--bear'}`}>
              {netPositive ? '+' : ''}{formatAbbrev(netFlow)}
            </span>
          </div>

          <div className="tcef-stat">
            <span className="tcef-stat-label">Total Out</span>
            <span className="tcef-stat-value tcef-stat-value--bear">{formatAbbrev(totalOut)}</span>
          </div>

          <div className="tcef-stat">
            <span className="tcef-stat-label">Total In</span>
            <span className="tcef-stat-value tcef-stat-value--bull">{formatAbbrev(totalIn)}</span>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="tcw-divider" />

      {/* Event feed from liveEvents */}
      <div className="tcef-feed">
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="tcw-shimmer tcef-skeleton-row" />
          ))
        ) : (
          events.slice(0, 7).map((ev, i) => {
            const badge = getEventBadge(ev.type)
            return (
              <div
                key={ev.id}
                className={`tcef-row${i === 0 && ev.isNew ? ' tcef-row--new' : ''}`}
              >
                <span className="tcef-token">{ev.token}</span>
                <span className="tcef-badge" style={{ background: badge.bg, color: badge.color }}>
                  {badge.label}
                </span>
                <span className="tcef-action">{ev.action}</span>
                <span className="tcef-time">{ev.time}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
