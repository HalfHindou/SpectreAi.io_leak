/**
 * Sparkline - adapter that delegates to SpectreSparkline
 *
 * Maintains the old API ({ data, positive, width, height }) so all existing
 * consumers work unchanged, but rendering is handled by the shared
 * SpectreSparkline canvas component (DPR-aware, subsampled, performant).
 *
 * Used by: discovery-section, horizontal-welcome-bar, inline-horizontal-bar,
 *          mobile-token-list, mobile/token-row-full, mobile/token-row-compact,
 *          mobile/token-bottom-sheet, pulse-sidebar
 */
import React from 'react'
import SpectreSparkline from '@/chart/SpectreSparkline'

const Sparkline = React.memo(({ data, positive, width = 96, height = 36, strokeWidth }) => {
  if (!data || data.length < 2) return null
  const color = positive ? '#22D3A0' : '#FB6C6C'
  return (
    <SpectreSparkline
      data={data}
      width={width}
      height={height}
      color={color}
      filled
      className="mini-sparkline"
      strokeWidth={strokeWidth != null ? strokeWidth : 1.4}
    />
  )
}, (prev, next) => {
  return prev.positive === next.positive
    && prev.width === next.width
    && prev.height === next.height
    && prev.strokeWidth === next.strokeWidth
    && prev.data === next.data
})

export default Sparkline
