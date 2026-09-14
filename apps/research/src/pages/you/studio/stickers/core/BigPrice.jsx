import { useState, useEffect, useRef } from 'react'
import useLivePrices from '../../hooks/useLivePrices'

/**
 * BigPrice — Large live price display with sparkline and change indicator.
 * Designed for ~240x100 sticker area. Flashes green/red on price changes.
 */
export default function BigPrice({ sticker, themeObj }) {
  const { prices, history, getTokenColor, formatPrice } = useLivePrices()
  const token = sticker.token || 'BTC'
  const data = prices[token]
  const hist = history[token]

  // Track previous price for flash direction
  const prevPriceRef = useRef(data?.price)
  const [flashColor, setFlashColor] = useState(null)

  useEffect(() => {
    if (!data) return
    const prev = prevPriceRef.current
    if (prev != null && prev !== data.price) {
      setFlashColor(data.price > prev ? '#10B981' : '#EF4444')
      const timer = setTimeout(() => setFlashColor(null), 300)
      prevPriceRef.current = data.price
      return () => clearTimeout(timer)
    }
    prevPriceRef.current = data.price
  }, [data?.price])

  if (!data || !hist) return null

  const change = data.change24h
  const isUp = change >= 0
  const arrow = isUp ? '\u25B2' : '\u25BC'
  const changeColor = isUp ? '#10B981' : '#EF4444'

  // Sparkline: last 20 points
  const sparkData = hist.slice(-20)
  const minVal = Math.min(...sparkData)
  const maxVal = Math.max(...sparkData)
  const range = maxVal - minVal || 1
  const sparkPoints = sparkData
    .map((v, i) => {
      const x = (i / (sparkData.length - 1)) * 60
      const y = 24 - ((v - minVal) / range) * 20
      return `${x},${y}`
    })
    .join(' ')

  const priceColor = flashColor || themeObj.stickerText.primary

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8 }}>
      {/* Top row: token label + sparkline */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: themeObj.stickerText.tertiary,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {token}
        </span>
        <svg
          width={60}
          height={24}
          viewBox="0 0 60 24"
          style={{ display: 'block', flexShrink: 0 }}
        >
          <polyline
            points={sparkPoints}
            fill="none"
            stroke={getTokenColor(token)}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Price */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 42,
          fontWeight: 700,
          color: priceColor,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          transition: 'color 0.3s ease',
        }}
      >
        {formatPrice(data.price)}
      </div>

      {/* Change */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          color: changeColor,
          lineHeight: 1,
        }}
      >
        {arrow} {Math.abs(change).toFixed(2)}%
      </div>
    </div>
  )
}
