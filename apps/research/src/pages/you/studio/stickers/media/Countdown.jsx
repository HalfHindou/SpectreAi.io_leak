import { useState, useEffect, useRef } from 'react'

/**
 * Countdown -- Event countdown timer with impact level indicator.
 * Ticks every second. Target date computed from daysAhead at mount time.
 * Designed for ~260x70 sticker area.
 */

const EVENTS = [
  { name: 'FOMC RATE DECISION', daysAhead: 12, impact: 'high' },
  { name: 'BTC HALVING',        daysAhead: 45, impact: 'high' },
  { name: 'ETH UPGRADE',        daysAhead: 8,  impact: 'medium' },
  { name: 'CPI DATA RELEASE',   daysAhead: 3,  impact: 'high' },
  { name: 'JOBS REPORT',        daysAhead: 6,  impact: 'medium' },
]

const IMPACT_COLORS = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#10B981',
}

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function formatCountdown(ms) {
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0 }
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return { d, h, m, s }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export default function Countdown({ sticker, themeObj }) {
  const event = EVENTS[hashString(sticker.id) % EVENTS.length]
  const targetRef = useRef(Date.now() + event.daysAhead * 86400 * 1000)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const remaining = targetRef.current - now
  const { d, h, m, s } = formatCountdown(remaining)
  const impactColor = IMPACT_COLORS[event.impact] || IMPACT_COLORS.low
  const impactLabel = event.impact === 'high' ? 'HIGH IMPACT' : event.impact === 'medium' ? 'MEDIUM IMPACT' : 'LOW IMPACT'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '8px 14px',
        boxSizing: 'border-box',
        gap: 6,
      }}
    >
      {/* Event name */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 600,
          color: themeObj.stickerText.primary,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {event.name}
      </div>

      {/* Countdown numbers */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          fontWeight: 700,
          color: themeObj.stickerText.primary,
          lineHeight: 1,
          letterSpacing: '0.02em',
        }}
      >
        {d}d {pad(h)}h {pad(m)}m {pad(s)}s
      </div>

      {/* Impact indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: impactColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            fontWeight: 500,
            color: impactColor,
            letterSpacing: '0.04em',
            lineHeight: 1,
          }}
        >
          {impactLabel}
        </span>
      </div>
    </div>
  )
}
