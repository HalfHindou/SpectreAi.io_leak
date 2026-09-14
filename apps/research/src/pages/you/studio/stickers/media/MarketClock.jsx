import { useState, useEffect } from 'react'

/**
 * MarketClock -- 4-timezone clock display, ticking live.
 * Shows NYC, London, Tokyo, Sydney with market open/closed status.
 * Designed for ~320x70 sticker area.
 */

const MARKETS = [
  { city: 'NYC',    tz: 'America/New_York',  openH: 9, openM: 30, closeH: 16, closeM: 0 },
  { city: 'LDN',    tz: 'Europe/London',     openH: 8, openM: 0,  closeH: 16, closeM: 30 },
  { city: 'TYO',    tz: 'Asia/Tokyo',        openH: 9, openM: 0,  closeH: 15, closeM: 0 },
  { city: 'SYD',    tz: 'Australia/Sydney',   openH: 10, openM: 0, closeH: 16, closeM: 0 },
]

function getTimeInZone(tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
}

function isMarketOpen(market) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: market.tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now)

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  const weekday = parts.find(p => p.type === 'weekday')?.value || ''

  // Closed on weekends
  if (weekday === 'Sat' || weekday === 'Sun') return false

  const timeInMinutes = hour * 60 + minute
  const openTime = market.openH * 60 + market.openM
  const closeTime = market.closeH * 60 + market.closeM

  return timeInMinutes >= openTime && timeInMinutes < closeTime
}

export default function MarketClock({ sticker, themeObj }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-evenly',
        padding: '6px 8px',
        boxSizing: 'border-box',
      }}
    >
      {MARKETS.map(market => {
        const time = getTimeInZone(market.tz)
        const open = isMarketOpen(market)
        const statusColor = open ? '#10B981' : '#EF4444'

        return (
          <div
            key={market.city}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
            }}
          >
            {/* City name */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 500,
                color: themeObj.stickerText.tertiary,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              {market.city}
            </div>

            {/* Time */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 15,
                fontWeight: 700,
                color: themeObj.stickerText.primary,
                lineHeight: 1,
                letterSpacing: '0.02em',
              }}
            >
              {time}
            </div>

            {/* Market status */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: statusColor,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 8,
                  fontWeight: 500,
                  color: statusColor,
                  letterSpacing: '0.04em',
                  lineHeight: 1,
                }}
              >
                {open ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
