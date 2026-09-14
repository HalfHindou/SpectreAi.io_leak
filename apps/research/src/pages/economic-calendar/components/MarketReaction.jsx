/**
 * MarketReaction Component
 * Inline market reaction snapshot shown when an economic event is released.
 *
 * 2026-06-11: REAL data only. The previous version fabricated before/after
 * prices from hardcoded base prices (BTC "97,420" while spot was ~62K) with
 * seeded pseudo-random moves. Now fetches /api/calendar/reaction, which
 * computes the actual first-15-min move from the Spectre candle store
 * (BTC/ETH 1m) and Yahoo intraday (SPX/NDX/DXY/GOLD/US10Y/WTI). Instruments
 * whose market was closed at release time are simply absent — never invented.
 */

import React, { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './MarketReaction.css'

function formatPrice(value, symbol) {
  if (value == null || !isFinite(value)) return '—'
  if (symbol === 'US10Y') return value.toFixed(2) + '%'
  if (symbol === 'DXY') return value.toFixed(2)
  if (value >= 10000) return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  if (value >= 100) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value.toFixed(2)
}

/** Map real BTC 1m closes onto the 120x32 sparkline viewBox. */
function seriesToPoints(series) {
  if (!Array.isArray(series) || series.length < 2) return ''
  const w = 120
  const h = 32
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w
      const y = (h - 2) - ((v - min) / span) * (h - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const MarketReaction = ({ event }) => {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  const eventDate = event?.dateTime || event?.date || null

  useEffect(() => {
    let cancelled = false
    setData(null)
    setFailed(false)
    if (!eventDate) {
      setFailed(true)
      return undefined
    }
    fetch(`/api/calendar/reaction?date=${encodeURIComponent(eventDate)}`, {
      signal: AbortSignal.timeout(15000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        if (j && Array.isArray(j.reactions) && j.reactions.length > 0) setData(j)
        else setFailed(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [eventDate])

  const btcReaction = data?.reactions?.find((r) => r.symbol === 'BTC') || null
  const sparklinePoints = useMemo(() => seriesToPoints(data?.btcSeries), [data?.btcSeries])

  // No real data for this release (or upstream down) -> render nothing.
  if (failed) return null

  // Loading shimmer matching the panel footprint.
  if (!data) {
    return (
      <div className="market-reaction">
        <div className="market-reaction__header">
          <span className="market-reaction__title">{t('economicCalendar.marketReaction.title', 'MARKET REACTION')}</span>
          <span className="market-reaction__subtitle">{t('economicCalendar.marketReaction.subtitle', '(first 15 min)')}</span>
        </div>
        <div className="market-reaction__grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="market-reaction__row">
              <span className="animate-shimmer" style={{ display: 'block', height: 14, borderRadius: 4, width: '100%', background: 'rgba(255,255,255,0.04)' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="market-reaction">
      <div className="market-reaction__header">
        <span className="market-reaction__title">{t('economicCalendar.marketReaction.title', 'MARKET REACTION')}</span>
        <span className="market-reaction__subtitle">{t('economicCalendar.marketReaction.subtitle', '(first 15 min)')}</span>
      </div>

      <div className="market-reaction__grid">
        {data.reactions.map((r) => {
          const direction = r.changePct >= 0 ? 'up' : 'down'
          return (
            <div key={r.symbol} className="market-reaction__row">
              <span className="market-reaction__symbol">{r.symbol}</span>
              <span className="market-reaction__prices">
                <span className="market-reaction__before">{formatPrice(r.before, r.symbol)}</span>
                <span className="market-reaction__arrow">→</span>
                <span className={`market-reaction__after market-reaction__after--${direction}`}>
                  {formatPrice(r.after, r.symbol)}
                </span>
              </span>
              <span className={`market-reaction__change market-reaction__change--${direction}`}>
                {direction === 'up' ? '▲' : '▼'} {r.changePct > 0 ? '+' : ''}{r.changePct}%
              </span>
            </div>
          )
        })}
      </div>

      {/* BTC sparkline from real 1m closes around the release */}
      {btcReaction && sparklinePoints && (
        <div className="market-reaction__sparkline">
          <span className="market-reaction__sparkline-label">{t('economicCalendar.marketReaction.btc15m', 'BTC 15m')}</span>
          <svg
            className="market-reaction__sparkline-svg"
            viewBox="0 0 120 32"
            preserveAspectRatio="xMidYMid meet"
            fill="none"
          >
            <polyline
              points={sparklinePoints}
              stroke={btcReaction.changePct >= 0 ? 'var(--bull)' : 'var(--bear)'}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </div>
      )}
    </div>
  )
}

export default MarketReaction
