import React, { useId, useMemo } from 'react'

/**
 * Premium SVG chart matching Figma spec exactly.
 * Specs from SpectPulse Figma (node 311-14):
 *   Line: white 82% opacity, 1.6px, round caps, bezier curves
 *   Fill: 4-stop gradient (4.5% → 1.5% → 1% → 0% white)
 *   Grid: horizontal 0.5px white 2.5%, vertical 0.5px white 1.8%
 *   Dot: radial glow (white 25% → 0%) + 2.5px white 95%
 */
export default function SparkChart({
  data,
  type = 'line',
  color = 'rgba(255,255,255,0.82)',
  width = 400,
  height = 120,
  showGrid = false,
  showDot = true,
  className = '',
}) {
  const uid = useId().replace(/:/g, '')
  const gradId = `psc-fill-${uid}`
  const glowId = `psc-glow-${uid}`
  const dotGlowId = `psc-dot-${uid}`
  const ambientId = `psc-amb-${uid}`

  // No smoothing - real price charts have sharp edges
  const smoothed = useMemo(() => data || [], [data])

  // Build bezier path from data points
  const { linePath, areaPath, lastPt, gridH, gridV } = useMemo(() => {
    if (!smoothed.length) return { linePath: '', areaPath: '', lastPt: null, gridH: [], gridV: [] }

    const max = Math.max(...smoothed)
    const min = Math.min(...smoothed)
    const range = max - min || 1
    const padX = 0
    const padY = 4
    const chartW = width - padX * 2
    const chartH = height - padY * 2

    const pts = smoothed.map((v, i) => ({
      x: padX + (i / (smoothed.length - 1)) * chartW,
      y: padY + (1 - (v - min) / range) * chartH,
    }))

    // Straight line segments (L commands) - matches Figma SVG exactly
    // Real price charts use connected line segments, NOT bezier curves
    const last = pts[pts.length - 1]
    let line = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
    for (let i = 1; i < pts.length; i++) {
      line += `L${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`
    }

    // Area: close path to bottom
    const area = line + ` L${width},${height} L0,${height} Z`

    // Grid lines
    const hLines = showGrid ? [0.25, 0.5, 0.75].map(f => padY + f * chartH) : []
    const vLines = showGrid
      ? Array.from({ length: 5 }, (_, i) => padX + ((i + 1) / 6) * chartW)
      : []

    return { linePath: line, areaPath: area, lastPt: last, gridH: hLines, gridV: vLines }
  }, [smoothed, width, height, showGrid])

  if (!data?.length) return null

  // Bar chart type
  if (type === 'bar') {
    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min || 1
    const barW = width / data.length - 1.5
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={className}
        style={{ display: 'block', width: '100%', height: `${height}px` }}
      >
        {data.map((v, i) => {
          const barH = ((v - min) / range) * (height - 8) * 0.85
          return (
            <rect
              key={i}
              x={i * (barW + 1.5)}
              y={height - barH}
              width={barW}
              height={barH}
              rx={1.5}
              fill={color}
              opacity={0.3 + ((v - min) / range) * 0.5}
            />
          )
        })}
      </svg>
    )
  }

  // Determine stroke color - use provided color or default white
  const strokeColor = color.startsWith('rgba') || color.startsWith('#')
    ? color
    : 'rgba(255,255,255,0.82)'

  // Parse color for gradient stops
  let fillR = 255, fillG = 255, fillB = 255
  if (color.startsWith('#') && color.length >= 7) {
    fillR = parseInt(color.slice(1, 3), 16)
    fillG = parseInt(color.slice(3, 5), 16)
    fillB = parseInt(color.slice(5, 7), 16)
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ display: 'block', width: '100%', height: `${height}px` }}
    >
      <defs>
        {/* Area fill gradient - Figma spec: 4-stop white opacity */}
        <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={`rgb(${fillR},${fillG},${fillB})`} stopOpacity="0.045" />
          <stop offset="35%" stopColor={`rgb(${fillR},${fillG},${fillB})`} stopOpacity="0.015" />
          <stop offset="70%" stopColor={`rgb(${fillR},${fillG},${fillB})`} stopOpacity="0.01" />
          <stop offset="100%" stopColor={`rgb(${fillR},${fillG},${fillB})`} stopOpacity="0" />
        </linearGradient>

        {/* End dot radial glow */}
        <radialGradient id={dotGlowId}>
          <stop offset="0%" stopColor="white" stopOpacity="0.25" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>

        {/* Dot shadow filter */}
        <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" />
          <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0" />
          <feBlend in="SourceGraphic" />
        </filter>

        {/* Ambient top glow */}
        {showGrid && (
          <radialGradient id={ambientId} cx="50%" cy="0%" rx="45%" ry="40%">
            <stop offset="0%" stopColor="#3D3D4D" stopOpacity="0.4" />
            <stop offset="40%" stopColor="#292933" stopOpacity="0.15" />
            <stop offset="80%" stopColor="#14141A" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#0F0F14" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {/* Ambient top glow */}
      {showGrid && (
        <ellipse cx={width / 2} cy={0} rx={width * 0.45} ry={height * 0.5} fill={`url(#${ambientId})`} />
      )}

      {/* Grid lines - Figma spec */}
      {gridH.map((y, i) => (
        <line key={`h${i}`} x1="0" y1={y} x2={width} y2={y}
          stroke="white" strokeOpacity="0.025" strokeWidth="0.5" />
      ))}
      {gridV.map((x, i) => (
        <line key={`v${i}`} x1={x} y1={4} x2={x} y2={height}
          stroke="white" strokeOpacity="0.018" strokeWidth="0.5" />
      ))}

      {/* Area fill */}
      {(type === 'area' || type === 'line') && (
        <path d={areaPath} fill={`url(#${gradId})`} />
      )}

      {/* Line - Figma spec: 1.6px, round caps, 82% white */}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End dot with glow */}
      {showDot && lastPt && (
        <>
          <circle cx={lastPt.x} cy={lastPt.y} r={8} fill={`url(#${dotGlowId})`} />
          <circle cx={lastPt.x} cy={lastPt.y} r={2.5}
            fill="white" fillOpacity="0.95" filter={`url(#${glowId})`} />
        </>
      )}
    </svg>
  )
}
