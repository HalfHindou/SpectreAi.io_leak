import useLivePrices from '../../hooks/useLivePrices'

/**
 * LineChart — SVG area chart showing 24h price history with gradient fill.
 * Uses all 50 data points with smooth bezier interpolation.
 * Designed for ~320x140 sticker area.
 */
export default function LineChart({ sticker, themeObj }) {
  const { history, getTokenColor } = useLivePrices()
  const token = sticker.token || 'BTC'
  const hist = history[token]

  if (!hist || hist.length < 2) return null

  const W = 320
  const H = 140
  const PAD_TOP = 15
  const PAD_BOTTOM = 15

  const lineColor = getTokenColor(token)
  const gradientId = `line-grad-${sticker.id}`

  // Map data to SVG coordinates
  const minVal = Math.min(...hist)
  const maxVal = Math.max(...hist)
  const range = maxVal - minVal || 1

  const points = hist.map((v, i) => ({
    x: (i / (hist.length - 1)) * W,
    y: PAD_TOP + (1 - (v - minVal) / range) * (H - PAD_TOP - PAD_BOTTOM),
  }))

  // Generate smooth bezier curve through all points
  function buildSmoothPath(pts) {
    if (pts.length < 2) return ''

    let d = `M ${pts[0].x},${pts[0].y}`

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]

      // Catmull-Rom to cubic bezier conversion
      const tension = 0.3
      const cp1x = p1.x + (p2.x - p0.x) * tension
      const cp1y = p1.y + (p2.y - p0.y) * tension
      const cp2x = p2.x - (p3.x - p1.x) * tension
      const cp2y = p2.y - (p3.y - p1.y) * tension

      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
    }

    return d
  }

  const linePath = buildSmoothPath(points)

  // Area fill path: same curve, close along bottom edge
  const areaPath = `${linePath} L ${points[points.length - 1].x},${H} L ${points[0].x},${H} Z`

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Label */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: themeObj.stickerText.tertiary,
          letterSpacing: '0.05em',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      >
        {token} &middot; 24h
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Gradient fill area */}
        <path
          d={areaPath}
          fill={`url(#${gradientId})`}
        />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
