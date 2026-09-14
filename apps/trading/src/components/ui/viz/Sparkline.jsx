/**
 * Sparkline — single-line area/line spark via inline SVG.
 *
 * Used by the MCap hero (gradient lime area), the Holders Vitals tile,
 * and every row in Watchlist + TokenScreener. Subsumes the inline
 * WatchlistSparkline that was hand-rolled in LeftPanel.jsx.
 *
 * Perf: pure presentational. No state. Path math memoized on data length.
 */
import React, { useId, useMemo } from 'react'
import './Sparkline.css'

function Sparkline({
  data,
  width = 72,
  height = 24,
  stroke = 'currentColor',
  fill = 'gradient',     // 'gradient' | 'none'
  strokeWidth = 1.5,
  className = '',
  ...rest
}) {
  const gid = useId().replace(/:/g, '_')

  const { linePath, areaPath } = useMemo(() => {
    if (!data || data.length === 0) return { linePath: '', areaPath: '' }
    const n = data.length
    let mn = data[0]
    let mx = data[0]
    for (let i = 1; i < n; i++) {
      const v = data[i]
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    const range = mx - mn || 1
    const xs = (i) => (n === 1 ? width / 2 : (i / (n - 1)) * width)
    const ys = (v) => height - ((v - mn) / range) * height
    let line = `M ${xs(0).toFixed(2)} ${ys(data[0]).toFixed(2)}`
    for (let i = 1; i < n; i++) line += ` L ${xs(i).toFixed(2)} ${ys(data[i]).toFixed(2)}`
    const area = `${line} L ${width} ${height} L 0 ${height} Z`
    return { linePath: line, areaPath: area }
  }, [data, width, height])

  if (!linePath) {
    return (
      <svg
        className={['spark', className].filter(Boolean).join(' ')}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      />
    )
  }

  return (
    <svg
      className={['spark', className].filter(Boolean).join(' ')}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-hidden="true"
      {...rest}
    >
      {fill === 'gradient' && (
        <>
          <defs>
            <linearGradient id={`spark-grad-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#spark-grad-${gid})`} />
        </>
      )}
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default React.memo(Sparkline)
