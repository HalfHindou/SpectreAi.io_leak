/**
 * W-004 · Fear & Greed Gauge Widget
 * Semi-circular SVG arc gauge with needle. Fetches from CMC via server proxy.
 */
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getFearGreedCurrent, getFearGreedHistory } from '@/services/fearGreedApi'
import './FearGreedGauge.css'

const LABELS = {
  'Extreme Fear': { color: '#EF4444' },
  'Fear': { color: '#F59E0B' },
  'Neutral': { color: '#FBB924' },
  'Greed': { color: '#84CC16' },
  'Extreme Greed': { color: '#10B981' },
}

function getLabel(value) {
  if (value <= 20) return 'Extreme Fear'
  if (value <= 40) return 'Fear'
  if (value <= 60) return 'Neutral'
  if (value <= 80) return 'Greed'
  return 'Extreme Greed'
}

export default function FearGreedGauge() {
  const [data, setData] = useState(null)

  const fetchFNG = useCallback(async () => {
    try {
      const [current, hist] = await Promise.all([
        getFearGreedCurrent(),
        getFearGreedHistory(8),
      ])
      const histData = hist?.data || []

      if (current?.value != null) {
        setData({
          value: current.value,
          label: current.classification || getLabel(current.value),
          yesterday: histData[1]?.value ?? null,
          lastWeek: histData[7]?.value ?? null,
        })
      }
    } catch (_) { console.error(_) }
  }, [])

  useEffect(() => { fetchFNG() }, [fetchFNG])

  useAdaptivePolling(fetchFNG, { interval: 300000 })

  const value = data?.value ?? 50
  const rawLabel = data?.label || getLabel(value)
  // Normalize CMC classification (e.g. "Extreme fear") to title case ("Extreme Fear")
  const label = rawLabel.replace(/\b\w/g, c => c.toUpperCase())
  const labelStyle = LABELS[label] || LABELS['Neutral']

  // Arc geometry
  const cx = 80
  const cy = 75
  const r = 60
  const startAngle = Math.PI // 180 degrees (left)
  const endAngle = 0 // 0 degrees (right)
  const needleAngle = Math.PI - (value / 100) * Math.PI

  // Arc path
  const arcStart = { x: cx + r * Math.cos(Math.PI), y: cy + r * Math.sin(Math.PI) }
  const arcEnd = { x: cx + r * Math.cos(0), y: cy + r * Math.sin(0) }

  // Needle endpoint
  const needleX = cx + (r - 8) * Math.cos(needleAngle)
  const needleY = cy - (r - 8) * Math.sin(needleAngle)

  return (
    <div className="tcfg">
      <svg width="160" height="90" viewBox="0 0 160 90">
        <defs>
          <linearGradient id="fg-arc-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#EF4444" />
            <stop offset="30%" stopColor="#F59E0B" />
            <stop offset="60%" stopColor="#84CC16" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
        {/* Background track */}
        <path
          d={`M ${arcStart.x},${arcStart.y} A ${r},${r} 0 0,1 ${arcEnd.x},${arcEnd.y}`}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Colored arc */}
        <path
          d={`M ${arcStart.x},${arcStart.y} A ${r},${r} 0 0,1 ${arcEnd.x},${arcEnd.y}`}
          fill="none"
          stroke="url(#fg-arc-grad)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="rgba(255,255,255,0.8)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Center pivot */}
        <circle cx={cx} cy={cy} r="4" fill="var(--bg-overlay)" stroke="var(--border-strong)" strokeWidth="1.5" />
      </svg>

      <div className="tcfg-value">{value}</div>

      <div className="tcfg-label" style={{ color: labelStyle.color }}>
        {label}
      </div>

      <div className="tcfg-history">
        <span>Yesterday: {data?.yesterday ?? '—'}</span>
        <span>Last Week: {data?.lastWeek ?? '—'}</span>
      </div>
    </div>
  )
}
