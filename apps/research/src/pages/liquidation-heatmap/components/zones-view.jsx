import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  generateZonesData,
  drawZonesChart,
  handleZonesMouseMove,
  handleZonesMouseLeave,
} from './zones-view-chart'

export default function ZonesView({ liqHeatmapData, candleBars, dayMode, fmtPrice, symbol, action = null }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [tooltip, setTooltip] = useState({ visible: false })
  const [mounted, setMounted] = useState(false)

  // Generate zone data
  const data = useMemo(
    () => generateZonesData(liqHeatmapData, candleBars),
    [liqHeatmapData, candleBars],
  )

  // Trigger mount animation for risk bar
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Draw chart + ResizeObserver
  useEffect(() => {
    if (!data) return
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const draw = () => drawZonesChart(canvas, container, data, dayMode)
    draw()

    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [data, dayMode])

  const onMouseMove = useCallback((e) => handleZonesMouseMove(e, setTooltip), [])
  const onMouseLeave = useCallback(() => handleZonesMouseLeave(setTooltip), [])

  const onTouchMove = useCallback((e) => {
    const touch = e.touches[0]
    if (!touch) return
    const canvas = canvasRef.current
    if (!canvas) return
    handleZonesMouseMove({ target: canvas, clientX: touch.clientX, clientY: touch.clientY }, setTooltip)
  }, [])

  const onTouchStart = useCallback((e) => { onTouchMove(e) }, [onTouchMove])
  const onTouchEnd = useCallback(() => { handleZonesMouseLeave(setTooltip) }, [])

  if (!data) {
    return (
      <div className="liqp-zones-view">
        <div className="liqp-zones-empty">
          Waiting for heatmap data...
        </div>
      </div>
    )
  }

  const { riskScore, riskLabel, signals } = data

  // Risk bar color class
  let riskColorClass = 'low'
  if (riskScore >= 80) riskColorClass = 'extreme'
  else if (riskScore >= 60) riskColorClass = 'high'
  else if (riskScore >= 40) riskColorClass = 'moderate-high'
  else if (riskScore >= 20) riskColorClass = 'moderate'

  return (
    <div className="liqp-zones-view">
      {/* Risk Meter */}
      <div className="liqp-zones-risk-meter">
        <div className="liqp-zones-risk-label">Risk Level</div>
        <div className="liqp-zones-risk-bar-bg">
          <div
            className={`liqp-zones-risk-bar-fill ${riskColorClass}`}
            style={{ width: mounted ? `${riskScore}%` : '0%' }}
          />
        </div>
        <div className="liqp-zones-risk-value">
          <span className="liqp-zones-risk-number" style={{
            color: riskScore >= 70 ? '#EF4444' : riskScore >= 40 ? '#F59E0B' : '#10B981'
          }}>{riskScore}</span>
          <span className="liqp-zones-risk-max">/100</span>
          <span className={`liqp-zones-risk-text ${riskColorClass}`}>{riskLabel}</span>
        </div>
        {/* Optional host-supplied control (the page's fullscreen toggle). */}
        {action ? <span className="liqp-zones-risk-actions">{action}</span> : null}
      </div>

      {/* Canvas */}
      <div className="liqp-zones-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="liqp-zones-canvas"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          style={{ cursor: 'crosshair', touchAction: 'none' }}
        />

        {/* Crosshair */}
        {tooltip.visible && tooltip.dims && (
          <>
            {/* Vertical line */}
            <div
              className="liqp-zones-crosshair-v"
              style={{
                left: tooltip.snappedX,
                top: tooltip.dims.cT,
                height: tooltip.dims.cB - tooltip.dims.cT,
              }}
            />
            {/* Horizontal line */}
            <div
              className="liqp-zones-crosshair-h"
              style={{
                top: tooltip.snappedY,
                left: tooltip.dims.cL,
                width: tooltip.dims.cR - tooltip.dims.cL,
              }}
            />
          </>
        )}

        {/* Tooltip */}
        {tooltip.visible && (
          <div
            className="liqp-zones-tooltip"
            style={{
              left: tooltip.x + (tooltip.x > (containerRef.current?.offsetWidth || 0) / 2 ? -160 : 16),
              top: Math.min(tooltip.y, (containerRef.current?.offsetHeight || 300) - 120),
            }}
          >
            <div className="liqp-zones-tt-price">{fmtPrice(tooltip.price)}</div>
            {tooltip.time && (
              <div className="liqp-zones-tt-time">
                {new Date(tooltip.time * 1000).toLocaleString('en', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            )}
            {tooltip.zone && (
              <div className={`liqp-zones-tt-zone ${tooltip.zone.side}`}>
                <span className="liqp-zones-tt-zone-dot" />
                <span>{tooltip.zone.label}</span>
                <span className="liqp-zones-tt-zone-density">
                  {Math.round(tooltip.zone.avgDensity * 100)}%
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signal Bullets */}
      {signals.length > 0 && (
        <div className="liqp-zones-signals">
          {signals.map((sig, i) => (
            <div key={i} className={`liqp-zones-signal ${sig.side}`}>
              <span className="liqp-zones-signal-dot" />
              <span className="liqp-zones-signal-text">{sig.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Risk Explanation */}
      <div className="liqp-zones-explanation">
        {riskScore >= 70
          ? 'High liquidation risk detected. Large clusters near current price could trigger cascading liquidations. Reduce leverage or tighten stops.'
          : riskScore >= 40
          ? 'Moderate liquidation activity. Notable clusters exist but price has room to move. Monitor positions if using leverage above 10x.'
          : 'Low liquidation risk. Clusters are sparse or far from current price. Normal trading conditions.'
        }
      </div>
    </div>
  )
}
