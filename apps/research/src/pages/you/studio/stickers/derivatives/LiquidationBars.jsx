import { useState, useEffect, useRef } from 'react'
import useLivePrices from '../../hooks/useLivePrices'

/**
 * LiquidationBars -- Bi-directional horizontal bar chart showing long/short
 * liquidation clusters at 6 price levels around current BTC price.
 * Designed for ~300x180 sticker area.
 */

function generateLevels(basePrice) {
  const offsets = [-0.05, -0.03, -0.015, 0.015, 0.03, 0.05]
  return offsets.map((off) => {
    const price = basePrice * (1 + off)
    return {
      price,
      longs: Math.floor(Math.random() * 80) + 10,
      shorts: Math.floor(Math.random() * 80) + 10,
    }
  })
}

export default function LiquidationBars({ sticker, themeObj }) {
  const { prices, formatPrice } = useLivePrices()
  const btcPrice = prices.BTC?.price || 97000

  const levelsRef = useRef(generateLevels(btcPrice))
  const [levels, setLevels] = useState(levelsRef.current)

  useEffect(() => {
    const interval = setInterval(() => {
      const currentPrice = prices.BTC?.price || 97000
      levelsRef.current = generateLevels(currentPrice)
      setLevels([...levelsRef.current])
    }, 6000)
    return () => clearInterval(interval)
  }, [prices])

  const W = 300
  const H = 180
  const TITLE_H = 20
  const ROW_H = (H - TITLE_H) / levels.length
  const CENTER_X = W / 2
  const MAX_BAR_W = CENTER_X - 40

  const maxVal = Math.max(...levels.flatMap((l) => [l.longs, l.shorts]), 1)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Title */}
        <text
          x={W / 2}
          y={12}
          textAnchor="middle"
          fill={themeObj.stickerText.tertiary}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          LIQUIDATION CLUSTERS
        </text>

        {levels.map((level, i) => {
          const y = TITLE_H + i * ROW_H
          const barY = y + ROW_H * 0.25
          const barH = ROW_H * 0.5
          const longW = (level.longs / maxVal) * MAX_BAR_W
          const shortW = (level.shorts / maxVal) * MAX_BAR_W

          return (
            <g key={i}>
              {/* Long bar (green, extends left from center) */}
              <rect
                x={CENTER_X - longW}
                y={barY}
                width={longW}
                height={barH}
                rx={2}
                fill="#10B981"
                fillOpacity={0.8}
              >
                <animate
                  attributeName="width"
                  from={longW * 0.8}
                  to={longW}
                  dur="0.6s"
                  fill="freeze"
                />
              </rect>

              {/* Short bar (red, extends right from center) */}
              <rect
                x={CENTER_X}
                y={barY}
                width={shortW}
                height={barH}
                rx={2}
                fill="#EF4444"
                fillOpacity={0.8}
              >
                <animate
                  attributeName="width"
                  from={shortW * 0.8}
                  to={shortW}
                  dur="0.6s"
                  fill="freeze"
                />
              </rect>

              {/* Price label at center */}
              <text
                x={CENTER_X}
                y={y + ROW_H * 0.9}
                textAnchor="middle"
                fill={themeObj.stickerText.secondary}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
              >
                {formatPrice(level.price)}
              </text>
            </g>
          )
        })}

        {/* Center divider line */}
        <line
          x1={CENTER_X}
          y1={TITLE_H}
          x2={CENTER_X}
          y2={H}
          stroke={themeObj.stickerText.tertiary}
          strokeOpacity={0.12}
          strokeWidth={1}
        />
      </svg>
    </div>
  )
}
