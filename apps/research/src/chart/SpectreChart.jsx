/**
 * SpectreChart - Universal Chart Component
 *
 * THE chart component for Spectre. Every chart surface uses this.
 * Powered by TradingView Lightweight Charts v5.
 *
 * Usage:
 *   <SpectreChart token={{ symbol: 'BTC' }} />
 *   <SpectreChart token={{ symbol: 'SOL' }} chartType="area" timeframe="4H" />
 *   <SpectreChart token={{ address: '0x...', networkId: 1, symbol: 'UNI' }} />
 */
import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { createSpectreChart, applyTheme } from './engine/createSpectreChart'
import {
  createPriceSeries,
  createVolumeSeries,
  configureVolumeScale,
  formatBarsForSeries,
  formatVolumeData,
} from './engine/seriesFactory'
import { getSeriesColors, getVolumeColors } from './engine/spectreTheme'
import { useChartData } from './hooks/useChartData'
import { addATHMarker, findATH } from './overlays/athMarker'
import './SpectreChart.css'

// Timeframe options
const TIMEFRAMES = ['1M', '5M', '15M', '30M', '1H', '4H', '12H', '1D', '1W']

// Chart type icons (inline SVG - chart module is self-contained)
const ChartIcons = {
  candle: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="2" x2="4" y2="14" />
      <rect x="2" y="5" width="4" height="5" rx="0.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="3" x2="12" y2="13" />
      <rect x="10" y="6" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,12 5,7 9,9 15,3" />
    </svg>
  ),
  area: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1,12 L5,7 L9,9 L15,3 L15,14 L1,14 Z" fill="currentColor" opacity="0.2" />
      <polyline points="1,12 5,7 9,9 15,3" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  ),
}

function SpectreChart({
  token,
  chartType: externalChartType,
  timeframe: externalTimeframe,
  height = 400,
  showToolbar = true,
  showVolume = true,
  showATH = false,
  mini = false,
  dayMode = false,
  onTimeframeChange,
  onChartTypeChange,
  onNoData,
}) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const priceSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const disposeRef = useRef(null)

  // Internal state (when not controlled externally)
  const [internalTimeframe, setInternalTimeframe] = useState(externalTimeframe || '1H')
  const [internalChartType, setInternalChartType] = useState(externalChartType || 'candle')

  const timeframe = externalTimeframe || internalTimeframe
  const chartType = externalChartType || internalChartType

  // Fetch data
  const { bars, loading, error, source } = useChartData({
    token,
    timeframe,
    enabled: !!token?.symbol,
  })

  // Create chart on mount
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const { chart, dispose } = createSpectreChart(el, {
      isDayMode: dayMode,
      mini,
      height,
    })

    chartRef.current = chart
    disposeRef.current = dispose

    return () => {
      disposeRef.current?.()
      chartRef.current = null
      priceSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, []) // Mount once - don't recreate on prop changes

  // Apply theme changes (day mode toggle)
  useEffect(() => {
    if (!chartRef.current) return
    applyTheme(chartRef.current, dayMode)

    // Update series colors
    if (priceSeriesRef.current) {
      const colors = getSeriesColors(chartType, dayMode)
      priceSeriesRef.current.applyOptions(colors)
    }
    if (volumeSeriesRef.current) {
      // Re-color volume bars
      const vColors = getVolumeColors(dayMode)
      volumeSeriesRef.current.applyOptions({ color: vColors.upColor })
    }
  }, [dayMode, chartType])

  // Update height
  useEffect(() => {
    if (!chartRef.current || !containerRef.current) return
    chartRef.current.resize(containerRef.current.clientWidth, height)
  }, [height])

  // Rebuild series when chart type changes
  // Skipped on the very first render while bars are still loading - creating
  // empty series only to immediately swap them when the user-typed default
  // arrives was a measurable jank source on mount.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (bars.length === 0 && !priceSeriesRef.current) return

    // Remove existing series
    if (priceSeriesRef.current) {
      try { chart.removeSeries(priceSeriesRef.current) } catch (e) { /* already removed */ }
      priceSeriesRef.current = null
    }
    if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current) } catch (e) { /* already removed */ }
      volumeSeriesRef.current = null
    }

    // Create new series
    priceSeriesRef.current = createPriceSeries(chart, chartType, dayMode)

    if (showVolume && !mini) {
      volumeSeriesRef.current = createVolumeSeries(chart, dayMode)
      configureVolumeScale(chart)
    }

    // Set data if we already have it
    if (bars.length > 0) {
      priceSeriesRef.current.setData(formatBarsForSeries(bars, chartType))
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(formatVolumeData(bars, dayMode))
      }
      chart.timeScale().fitContent()
    }
  }, [chartType, showVolume, mini, bars.length === 0])

  // Update data when bars change
  useEffect(() => {
    if (!priceSeriesRef.current || bars.length === 0) return

    const priceData = formatBarsForSeries(bars, chartType)
    priceSeriesRef.current.setData(priceData)

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(formatVolumeData(bars, dayMode))
    }

    chartRef.current?.timeScale().fitContent()
  }, [bars, chartType, dayMode])

  // ATH marker
  useEffect(() => {
    if (!showATH || !priceSeriesRef.current || bars.length === 0) return
    const athPrice = findATH(bars)
    if (!athPrice) return
    const { remove } = addATHMarker(priceSeriesRef.current, athPrice, dayMode)
    return remove
  }, [showATH, bars, dayMode])

  // No data callback
  useEffect(() => {
    if (!loading && bars.length === 0 && error && onNoData) {
      onNoData(error)
    }
  }, [loading, bars.length, error, onNoData])

  const handleTimeframeChange = useCallback((tf) => {
    setInternalTimeframe(tf)
    onTimeframeChange?.(tf)
  }, [onTimeframeChange])

  const handleChartTypeChange = useCallback((type) => {
    setInternalChartType(type)
    onChartTypeChange?.(type)
  }, [onChartTypeChange])

  return (
    <div className={`sc-container${dayMode ? ' sc-container--day' : ''}`}>
      {/* Toolbar */}
      {showToolbar && !mini && (
        <div className="sc-toolbar">
          <div className="sc-timeframes">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                className={`sc-tf-btn${timeframe === tf ? ' sc-tf-btn--active' : ''}`}
                onClick={() => handleTimeframeChange(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
          <div className="sc-types">
            {['candle', 'line', 'area'].map(type => (
              <button
                key={type}
                className={`sc-type-btn${chartType === type ? ' sc-type-btn--active' : ''}`}
                onClick={() => handleChartTypeChange(type)}
                aria-label={type}
              >
                {ChartIcons[type]}
              </button>
            ))}
          </div>
          {source && (
            <span className="sc-source">{source}</span>
          )}
        </div>
      )}

      {/* Chart container */}
      <div className="sc-chart-wrap" style={{ height: `${height}px` }}>
        {/* Shimmer loading */}
        {loading && (
          <div className="sc-shimmer-wrap">
            <div className="sc-shimmer" />
          </div>
        )}

        {/* Error state */}
        {!loading && error && bars.length === 0 && (
          <div className="sc-error">
            <span className="sc-error-text">No data for this timeframe</span>
          </div>
        )}

        {/* LWC renders here */}
        <div ref={containerRef} className="sc-chart" />
      </div>
    </div>
  )
}

export default memo(SpectreChart)
