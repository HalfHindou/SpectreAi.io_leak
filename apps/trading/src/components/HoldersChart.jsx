/**
 * HoldersChart Component
 * Line/area chart showing holder count over time using lightweight-charts.
 */
import React, { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, AreaSeries } from 'lightweight-charts'

const BUCKET_OPTIONS = [
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
]

const HoldersChart = ({ chartData, loading, bucket, onBucketChange }) => {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 200 })

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width } = entry.contentRect
        if (width > 0) setDimensions(prev => ({ ...prev, width }))
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Create chart
  useEffect(() => {
    const container = containerRef.current
    if (!container || dimensions.width <= 0) return

    const chart = createChart(container, {
      width: dimensions.width,
      height: 200,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(245, 245, 247, 0.5)',
        fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.15)', width: 1, style: 2, labelVisible: false },
        horzLine: { color: 'rgba(255,255,255,0.15)', width: 1, style: 2 },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: false },
      handleScale: false,
    })

    const series = chart.addSeries(AreaSeries, {
      lineColor: 'rgba(139, 92, 246, 0.9)',
      topColor: 'rgba(139, 92, 246, 0.3)',
      bottomColor: 'rgba(139, 92, 246, 0.02)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)) },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [dimensions.width])

  // Update data
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart || !chartData?.length) return

    const data = chartData
      .map(d => ({
        time: Math.floor(new Date(d.bucket).getTime() / 1000),
        value: parseInt(d.holders) || 0,
      }))
      .filter(d => d.time > 0 && d.value > 0)
      .sort((a, b) => a.time - b.time)

    if (data.length > 0) {
      series.setData(data)
      chart.timeScale().fitContent()
    }
  }, [chartData])

  // Resize chart
  useEffect(() => {
    if (chartRef.current && dimensions.width > 0) {
      chartRef.current.applyOptions({ width: dimensions.width })
    }
  }, [dimensions.width])

  // Compute summary from chart data
  const summary = React.useMemo(() => {
    if (!chartData || chartData.length < 2) return null
    const latest = parseInt(chartData[chartData.length - 1]?.holders) || 0
    const earliest = parseInt(chartData[0]?.holders) || 0
    const change = latest - earliest
    const changePct = earliest > 0 ? ((change / earliest) * 100) : 0
    // Find min/max
    let min = Infinity, max = -Infinity
    for (const d of chartData) {
      const h = parseInt(d.holders) || 0
      if (h < min) min = h
      if (h > max) max = h
    }
    return { latest, change, changePct, min, max }
  }, [chartData])

  return (
    <div className="holders-chart-section">
      <div className="holders-chart-header">
        <div className="holders-chart-title">
          <span>Holder Count</span>
          {summary && (
            <span className="holders-chart-summary">
              <span className="holders-current">{summary.latest.toLocaleString()}</span>
              <span className={`holders-change ${summary.change >= 0 ? 'up' : 'down'}`}>
                {summary.change >= 0 ? '+' : ''}{summary.change.toLocaleString()} ({summary.changePct.toFixed(1)}%)
              </span>
            </span>
          )}
        </div>
        <div className="holders-chart-buckets">
          {BUCKET_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`bucket-btn ${bucket === opt.value ? 'active' : ''}`}
              onClick={() => onBucketChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="holders-chart-container" ref={containerRef}>
        {loading && (
          <div className="holders-chart-loading">Loading chart...</div>
        )}
        {!loading && (!chartData || chartData.length === 0) && (
          <div className="holders-chart-empty">No holder history available</div>
        )}
      </div>
    </div>
  )
}

export default HoldersChart
