import { useMemo } from 'react'
import useLivePrices from '../../hooks/useLivePrices'

/**
 * GhostHeatmap -- Mini liquidation density heatmap.
 * 10 columns x 16 rows = 160 cells colored by density.
 * Cell values are seeded from sticker.id for stability (no flickering).
 * Designed for ~200x240 sticker area.
 */

const COLS = 10
const ROWS = 16
const CELL_W = 16
const CELL_H = 12
const GAP = 2

// Simple seeded PRNG (mulberry32) for stable cell values per sticker instance
function mulberry32(seed) {
  let t = seed
  return function () {
    t = (t + 0x6D2B79F5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function getDensityColor(density) {
  // density 0..1
  // transparent -> yellow -> orange -> red
  if (density < 0.15) return 'transparent'
  if (density < 0.35) return `rgba(245, 158, 11, ${0.2 + density * 0.4})`  // yellow
  if (density < 0.6)  return `rgba(249, 115, 22, ${0.3 + density * 0.5})`  // orange
  return `rgba(239, 68, 68, ${0.5 + density * 0.4})`                       // red
}

export default function GhostHeatmap({ sticker, themeObj }) {
  const { prices, formatPrice } = useLivePrices()
  const btcPrice = prices.BTC?.price || 97000

  // Generate stable cell values based on sticker.id
  const cells = useMemo(() => {
    const seed = hashString(sticker.id || 'default')
    const rng = mulberry32(seed)
    const grid = []

    // Create a "hotspot" pattern: higher density around rows 8-12 (below current price)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        let base = rng()
        // Boost density near hotspot rows (around 60% from top)
        const distFromHotspot = Math.abs(row - 10) / ROWS
        const hotspotBoost = Math.max(0, 1 - distFromHotspot * 2.5) * 0.4
        // Also boost columns 3-7 (center mass)
        const colBoost = (col >= 3 && col <= 7) ? 0.15 : 0
        base = Math.min(1, base * 0.7 + hotspotBoost + colBoost)
        grid.push(base)
      }
    }
    return grid
  }, [sticker.id])

  const W = 200
  const H = 240
  const TITLE_H = 16
  const GRID_X = 36 // left margin for price labels
  const GRID_Y = TITLE_H + 4
  const GRID_W = COLS * (CELL_W + GAP) - GAP
  const GRID_H = ROWS * (CELL_H + GAP) - GAP

  // Current price line position (~60% from top)
  const priceLineY = GRID_Y + GRID_H * 0.6

  // Price axis: 5 evenly spaced labels
  const priceRange = btcPrice * 0.10 // 10% total range
  const topPrice = btcPrice + priceRange * 0.4
  const priceLabelCount = 5
  const priceLabels = Array.from({ length: priceLabelCount }, (_, i) => {
    const t = i / (priceLabelCount - 1)
    const price = topPrice - t * priceRange
    const y = GRID_Y + t * GRID_H
    return { price, y }
  })

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
          y={11}
          textAnchor="middle"
          fill={themeObj.stickerText.tertiary}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          LIQUIDATION DENSITY
        </text>

        {/* Price axis labels */}
        {priceLabels.map((pl, i) => (
          <text
            key={`price-${i}`}
            x={GRID_X - 4}
            y={pl.y + 4}
            textAnchor="end"
            fill={themeObj.stickerText.tertiary}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 8 }}
          >
            {formatPrice(pl.price)}
          </text>
        ))}

        {/* Heatmap cells */}
        {cells.map((density, idx) => {
          const row = Math.floor(idx / COLS)
          const col = idx % COLS
          const x = GRID_X + col * (CELL_W + GAP)
          const y = GRID_Y + row * (CELL_H + GAP)
          const color = getDensityColor(density)

          return (
            <rect
              key={idx}
              x={x}
              y={y}
              width={CELL_W}
              height={CELL_H}
              rx={1}
              fill={color}
            />
          )
        })}

        {/* Current price dashed line */}
        <line
          x1={GRID_X}
          y1={priceLineY}
          x2={GRID_X + GRID_W}
          y2={priceLineY}
          stroke={themeObj.accentColor}
          strokeWidth={1}
          strokeDasharray="4 3"
          strokeOpacity={0.8}
        />

        {/* Price label on the dashed line */}
        <text
          x={GRID_X + GRID_W + 2}
          y={priceLineY + 3}
          fill={themeObj.accentColor}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 7 }}
        >
          now
        </text>
      </svg>
    </div>
  )
}
