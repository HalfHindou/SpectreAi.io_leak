/**
 * DripPrice -- Price number with paint dripping off the bottom.
 * Street Art theme sticker, 320x140.
 */
import useLivePrices from '../../hooks/useLivePrices'

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function makeDrip(x, length, bulb, color) {
  // Bezier drip from (x,0) curving down, ending in a teardrop bulb
  const cp1x = x + (bulb > 3 ? 2 : -2)
  const cp1y = length * 0.4
  const cp2x = x - 1
  const cp2y = length * 0.7
  const endY = length
  return (
    `M ${x},0 ` +
    `C ${cp1x},${cp1y} ${cp2x},${cp2y} ${x},${endY} ` +
    `C ${x + bulb},${endY - bulb * 0.6} ${x + bulb},${endY + bulb * 0.6} ${x},${endY} ` +
    `C ${x - bulb},${endY + bulb * 0.6} ${x - bulb},${endY - bulb * 0.6} ${x},${endY} Z`
  )
}

export default function DripPrice({ sticker, themeObj }) {
  const { prices } = useLivePrices()
  const token = sticker.token || 'BTC'
  const data = prices[token]

  if (!data) return null

  const priceStr = Math.floor(data.price).toString()
  const hash = hashString(sticker.id)
  const colors = ['#F7C31A', '#FF9500']

  // Generate drips per digit
  const digitCount = priceStr.length
  const charWidth = 280 / digitCount
  const drips = []

  for (let d = 0; d < digitCount; d++) {
    const dripCount = 3 + (hashString(sticker.id + d) % 3) // 3-5 per digit
    for (let j = 0; j < dripCount; j++) {
      const seed = hashString(sticker.id + d + '-' + j)
      const xOffset = (seed % Math.floor(charWidth * 0.7)) - charWidth * 0.15
      const length = 20 + (seed % 41) // 20-60
      const bulb = 2 + (seed % 3) // 2-4
      const color = colors[(d + j) % 2]
      const baseX = 20 + d * charWidth + charWidth * 0.5 + xOffset
      drips.push({ x: baseX, length, bulb, color, key: `${d}-${j}` })
    }
  }

  return (
    <svg
      viewBox="0 0 320 140"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Price text */}
      <text
        x="160"
        y="72"
        textAnchor="middle"
        fontFamily="'Permanent Marker', cursive, 'Arial Black', sans-serif"
        fontSize="64"
        fontWeight="900"
        fill="#F7C31A"
        stroke="rgba(0,0,0,0.9)"
        strokeWidth="3"
        paintOrder="stroke"
      >
        {priceStr}
      </text>

      {/* Drips below text baseline */}
      <g transform="translate(0, 78)">
        {drips.map((drip) => (
          <path
            key={drip.key}
            d={makeDrip(drip.x, drip.length, drip.bulb, drip.color)}
            fill={drip.color}
            opacity="0.85"
          />
        ))}
      </g>
    </svg>
  )
}
