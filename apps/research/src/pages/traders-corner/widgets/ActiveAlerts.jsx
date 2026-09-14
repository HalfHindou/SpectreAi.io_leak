/**
 * W-043 · Active Alerts Widget
 * Live market signal alerts with pulse dots for status.
 * Powered by useMarketIntel real-time anomaly events (breakouts, dumps,
 * funding extremes, volume surges, whale flow).
 */
import { useMemo } from 'react'
import { useMarketIntel } from '@/hooks/useMarketIntel'
import './ActiveAlerts.css'

// Liquidation/dump events have already fired → triggered. Everything else is
// an active condition we're watching.
const STATUS_BY_TYPE = {
  liquidation: 'triggered',
  breakout: 'watching',
  volume: 'watching',
  whale: 'watching',
  listing: 'resolved',
}

const STATUS_LABEL = {
  watching: 'WATCHING',
  triggered: 'TRIGGERED',
  resolved: 'RESOLVED',
}

export default function ActiveAlerts() {
  const { liveEvents, loading } = useMarketIntel()

  const alerts = useMemo(() => {
    return (liveEvents || []).slice(0, 4).map((ev, i) => ({
      id: ev.id || `alert-${i}`,
      token: ev.token,
      description: ev.amount ? `${ev.action} · ${ev.amount}` : ev.action,
      status: STATUS_BY_TYPE[ev.type] || 'watching',
    }))
  }, [liveEvents])

  const showSkeleton = loading && alerts.length === 0

  return (
    <div className="tcw" style={{ paddingTop: 2 }}>
      <div className="tca-list">
        {showSkeleton ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="tcw-shimmer tca-skeleton" />
          ))
        ) : alerts.length === 0 ? (
          <div className="tcw-empty">No active signals</div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className="tca-row">
              <span className={`tca-dot tca-dot--${alert.status}`} />
              <span className="tca-token">{alert.token}</span>
              <span className="tca-desc">{alert.description}</span>
              <span className={`tca-status tca-status--${alert.status}`}>
                {STATUS_LABEL[alert.status]}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
