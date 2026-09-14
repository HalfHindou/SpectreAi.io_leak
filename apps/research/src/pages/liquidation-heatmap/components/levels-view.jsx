import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  generateLevelsData, drawLevelsChart,
  handleLevelsMouseMove, handleLevelsMouseLeave,
  LEVERAGE_TIERS,
} from './levels-view-chart'

/**
 * LevelsView — Line-based liquidation levels chart.
 * Renders candlestick price action with overlaid liquidation level lines,
 * showing where long/short positions would get liquidated at various leverage tiers.
 * Requires both candleBars (OHLCV) and liqHeatmapData (liquidation density).
 */
export default function LevelsView({ candleBars, liqHeatmapData, dayMode, fmtPrice, symbol, action = null }) {
  const [filter, setFilter] = useState('both')
  const [tooltip, setTooltip] = useState({ visible: false })
  const [visibleCount, setVisibleCount] = useState(null)

  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  // Memoize generated levels data from both candle bars and heatmap data
  const levelsData = useMemo(() => {
    if (!candleBars || candleBars.length < 5 || !liqHeatmapData) return null
    return generateLevelsData(candleBars, liqHeatmapData)
  }, [candleBars, liqHeatmapData])

  // Total counts per side (independent of visibility clipping)
  const levelCounts = useMemo(() => {
    if (!levelsData) return { long: 0, short: 0 }
    let long = 0, short = 0
    for (const lvl of levelsData.levels) {
      if (lvl.side === 'long') long++
      else short++
    }
    return { long, short }
  }, [levelsData])

  // Draw chart + ResizeObserver
  useEffect(() => {
    if (!levelsData) return
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const draw = () => {
      const result = drawLevelsChart(canvas, container, levelsData, filter, dayMode)
      if (result) setVisibleCount(result.visibleLevelCount)
    }
    draw()

    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [levelsData, filter, dayMode])

  const onMouseMove = useCallback((e) => {
    handleLevelsMouseMove(e, setTooltip)
  }, [])

  const onMouseLeave = useCallback(() => {
    handleLevelsMouseLeave(setTooltip)
  }, [])

  // Touch: synthesize a mouse-like event so the tooltip tracks finger drag.
  const onTouchMove = useCallback((e) => {
    const touch = e.touches[0]
    if (!touch) return
    const canvas = canvasRef.current
    if (!canvas) return
    handleLevelsMouseMove({ target: canvas, clientX: touch.clientX, clientY: touch.clientY }, setTooltip)
  }, [])

  const onTouchStart = useCallback((e) => {
    onTouchMove(e)
  }, [onTouchMove])

  const onTouchEnd = useCallback(() => {
    handleLevelsMouseLeave(setTooltip)
  }, [])

  // Tooltip flip: if mouse past 50% of container width, show on left side
  const containerWidth = containerRef.current?.offsetWidth || 0
  const containerHeight = containerRef.current?.offsetHeight || 0
  const tooltipFlip = tooltip.visible && tooltip.x > containerWidth / 2

  // Guard: need both data sources with minimum candle count
  if (!candleBars || candleBars.length < 5 || !liqHeatmapData) {
    return (
      <div className="liqp-levels-view">
        <div className="liqp-levels-canvas-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <span style={{ color: 'rgba(245,245,247,0.35)', fontSize: 13, fontWeight: 450 }}>
            Waiting for data...
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="liqp-levels-view">
      {/* Toolbar */}
      <div className="liqp-levels-toolbar">
        <div className="liqp-levels-filters">
          <button
            className={`liqp-filter-btn${filter === 'both' ? ' active' : ''}`}
            onClick={() => setFilter('both')}
          >
            Both
          </button>
          <button
            className={`liqp-filter-btn${filter === 'long' ? ' active long' : ''}`}
            onClick={() => setFilter('long')}
          >
            Long
          </button>
          <button
            className={`liqp-filter-btn${filter === 'short' ? ' active short' : ''}`}
            onClick={() => setFilter('short')}
          >
            Short
          </button>
        </div>
        <div className="liqp-levels-toolbar-right">
        <div className="liqp-levels-legend">
          <span className="liqp-legend-item">
            <span className="liqp-legend-line" style={{ background: '#EF4444' }} />
            Long Liquidations
          </span>
          <span className="liqp-legend-item">
            <span className="liqp-legend-line" style={{ background: '#10B981' }} />
            Short Liquidations
          </span>
          <span className="liqp-legend-divider" />
          <span className="liqp-legend-item">
            <span
              className="liqp-legend-swatch"
              style={{ background: 'rgba(255,255,255,0.5)', width: 8, height: 8, borderRadius: '50%' }}
            />
            Grabbed
          </span>
        </div>
        {/* Optional host-supplied control (the page's fullscreen toggle). Kept
            OUTSIDE the legend — the legend is display:none on phone widths. */}
        {action}
        </div>
      </div>

      {/* Canvas */}
      <div className="liqp-levels-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="liqp-levels-canvas"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          style={{ cursor: 'crosshair', touchAction: 'none' }}
        />

        {/* Empty state for filter with no visible levels */}
        {visibleCount === 0 && (
          <div className="liqp-levels-empty">
            <div className="liqp-levels-empty-title">
              No {filter === 'long' ? 'long' : 'short'} liquidations in view
            </div>
            <div className="liqp-levels-empty-sub">
              {filter === 'short' && levelCounts.long > 0 && (
                <>
                  {levelCounts.long} long level{levelCounts.long === 1 ? '' : 's'} below price.{' '}
                  <button className="liqp-levels-empty-link" onClick={() => setFilter('long')}>
                    Show longs
                  </button>
                </>
              )}
              {filter === 'long' && levelCounts.short > 0 && (
                <>
                  {levelCounts.short} short level{levelCounts.short === 1 ? '' : 's'} above price.{' '}
                  <button className="liqp-levels-empty-link" onClick={() => setFilter('short')}>
                    Show shorts
                  </button>
                </>
              )}
              {((filter === 'short' && levelCounts.long === 0) ||
                (filter === 'long' && levelCounts.short === 0)) && (
                <button className="liqp-levels-empty-link" onClick={() => setFilter('both')}>
                  Reset filter
                </button>
              )}
            </div>
          </div>
        )}

        {/* Crosshair vertical line */}
        {tooltip.visible && tooltip.dims && (
          <div
            className="liqp-map-crosshair"
            style={{
              left: tooltip.snappedX,
              top: tooltip.dims.cT,
              height: tooltip.dims.cB - tooltip.dims.cT,
            }}
          />
        )}

        {/* Tooltip */}
        {tooltip.visible && (
          <div
            className="liqp-map-tooltip"
            style={{
              left: tooltipFlip ? tooltip.x - 200 : tooltip.x + 16,
              top: Math.min(tooltip.y, containerHeight - 180),
            }}
          >
            <div className="liqp-map-tt-header">
              <span className="liqp-map-tt-price">{fmtPrice(tooltip.price)}</span>
              {tooltip.time && (
                <span style={{ fontSize: 11, color: 'rgba(245,245,247,0.4)' }}>
                  {new Date(tooltip.time * 1000).toLocaleString('en', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
            {tooltip.nearestLevel && (
              <>
                <div className="liqp-map-tt-dist">
                  Nearest: {tooltip.nearestLevel.side === 'long' ? 'Long' : 'Short'} liq at{' '}
                  {fmtPrice(tooltip.nearestLevel.price)}
                </div>
                <div className="liqp-map-tt-tiers">
                  <div className="liqp-map-tt-row">
                    <span
                      className="liqp-map-tt-dot"
                      style={{ background: tooltip.nearestLevel.side === 'long' ? '#EF4444' : '#10B981' }}
                    />
                    <span className="liqp-map-tt-label">Est. Amount</span>
                    <span className="liqp-map-tt-val">
                      ~${tooltip.nearestLevel.estAmount.toFixed(1)}M
                    </span>
                  </div>
                  <div className="liqp-map-tt-row">
                    <span className="liqp-map-tt-label">Intensity</span>
                    <span className="liqp-map-tt-val">
                      {Math.round(tooltip.nearestLevel.intensity * 100)}%
                    </span>
                  </div>
                  {tooltip.nearestLevel.grabbed && (
                    <div className="liqp-map-tt-row">
                      <span className="liqp-map-tt-dot" style={{ background: 'rgba(255,255,255,0.5)' }} />
                      <span className="liqp-map-tt-label" style={{ color: 'rgba(245,245,247,0.6)' }}>
                        Grabbed
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
