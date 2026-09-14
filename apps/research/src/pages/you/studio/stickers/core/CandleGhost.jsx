import useLivePrices from '../../hooks/useLivePrices'

/**
 * CandleGhost — Floating SVG candlestick chart with no background.
 * Generates 14 candles from 50-point history data by grouping
 * every ~3 points into OHLC candles.
 * Designed for ~300x160 sticker area.
 */
export default function CandleGhost({ sticker, themeObj }) {
  const { history } = useLivePrices()
  const token = sticker.token || 'BTC'
  const hist = history[token]

  if (!hist || hist.length < 14) return null

  const W = 300
  const H = 160
  const PAD = 10
  const CANDLE_COUNT = 14
  const CANDLE_WIDTH = 12
  const BULL = '#10B981'
  const BEAR = '#EF4444'

  // Group history into 14 candles. We have 50 points, ~3.5 per candle.
  // Use the last 42 points (14 * 3) for clean grouping.
  const usable = hist.slice(-CANDLE_COUNT * 3)
  const candles = []

  for (let i = 0; i < CANDLE_COUNT; i++) {
    const group = usable.slice(i * 3, i * 3 + 3)
    if (group.length === 0) continue
    candles.push({
      open: group[0],
      close: group[group.length - 1],
      high: Math.max(...group),
      low: Math.min(...group),
    })
  }

  if (candles.length === 0) return null

  // Price range for Y mapping
  const allHighs = candles.map(c => c.high)
  const allLows = candles.map(c => c.low)
  const minPrice = Math.min(...allLows)
  const maxPrice = Math.max(...allHighs)
  const priceRange = maxPrice - minPrice || 1

  function priceToY(price) {
    return PAD + (1 - (price - minPrice) / priceRange) * (H - PAD * 2)
  }

  // Distribute candles evenly across the SVG width
  const totalSpacing = W / CANDLE_COUNT

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      {candles.map((candle, i) => {
        const isBull = candle.close >= candle.open
        const color = isBull ? BULL : BEAR
        const bodyTop = priceToY(Math.max(candle.open, candle.close))
        const bodyBottom = priceToY(Math.min(candle.open, candle.close))
        const bodyHeight = Math.max(1, bodyBottom - bodyTop)
        const wickTop = priceToY(candle.high)
        const wickBottom = priceToY(candle.low)
        const cx = totalSpacing * i + totalSpacing / 2

        return (
          <g key={i}>
            {/* Wick */}
            <line
              x1={cx}
              y1={wickTop}
              x2={cx}
              y2={wickBottom}
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            {/* Body */}
            <rect
              x={cx - CANDLE_WIDTH / 2}
              y={bodyTop}
              width={CANDLE_WIDTH}
              height={bodyHeight}
              fill={color}
              rx={1}
            />
          </g>
        )
      })}
    </svg>
  )
}
