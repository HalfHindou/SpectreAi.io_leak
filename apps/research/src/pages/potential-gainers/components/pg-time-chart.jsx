/*
 * PGTimeChart - shared lightweight-charts host for Potential Gainers.
 *
 * The repo has a chart engine at src/chart/engine, but that one is tuned for
 * OHLCV price charts (candles + volume, price-formatted axis, monospace
 * labels). PG's two charts are %-return time series - a cumulative equity
 * curve and a win-rate history - so this is a small purpose-built host.
 *
 * It owns the chart lifecycle only: create, Spectre theme, live day-mode
 * re-theme, dispose. The live chart instance is handed to the caller via
 * `onChart`; the caller adds its own series (Baseline / Line / Histogram)
 * and renders HTML overlays as siblings inside a position:relative parent.
 *
 * Sizing uses lightweight-charts' built-in `autoSize` - it observes the host
 * element itself, so the chart sizes correctly even when the container is
 * laid out (or resized) a frame after the chart is created. The host carries
 * an explicit pixel height; width tracks the parent.
 *
 * Static instrument, not a trading widget - scroll and scale are disabled.
 */
import { useEffect, useRef } from 'react'
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts'
import ChartWatermark from '@/components/chart-watermark'

/* Apple-cinematic system stack - never JetBrains Mono on a chart axis. */
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif'

/* Full chart options for a theme. Re-applied wholesale on a day-mode toggle
   (applyOptions is idempotent), so it stays a pure function. */
function buildOptions(dayMode) {
  const grid = dayMode ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.045)'
  const text = dayMode ? '#64748b' : 'rgba(245,245,247,0.5)'
  const border = dayMode ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.05)'
  const cross = dayMode ? 'rgba(15,23,42,0.32)' : 'rgba(245,245,247,0.3)'
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: text,
      fontFamily: FONT,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: grid },
    },
    rightPriceScale: {
      borderColor: border,
      borderVisible: false,
      scaleMargins: { top: 0.18, bottom: 0.12 },
      entireTextOnly: true,
      ticksVisible: false,
      minimumWidth: 52,
    },
    timeScale: {
      borderColor: border,
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
      ticksVisible: false,
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: cross, width: 1, style: 2, labelVisible: false },
      horzLine: { visible: false, labelVisible: false },
    },
    handleScroll: false,
    handleScale: false,
    kineticScroll: { mouse: false, touch: false },
  }
}

export default function PGTimeChart({ height = 240, dayMode = false, onChart, className }) {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const onChartRef = useRef(onChart)
  onChartRef.current = onChart

  /* create once - autoSize keeps it sized for the component's life */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const chart = createChart(host, buildOptions(dayMode))
    chartRef.current = chart
    if (typeof onChartRef.current === 'function') onChartRef.current(chart)
    return () => {
      chart.remove()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* live day-mode toggle - re-theme in place, no rebuild */
  useEffect(() => {
    if (chartRef.current) chartRef.current.applyOptions(buildOptions(dayMode))
  }, [dayMode])

  return (
    <div
      ref={hostRef}
      className={`pg-tchart spectre-wm-host${className ? ` ${className}` : ''}`}
      style={{ height }}
    >
      <ChartWatermark />
    </div>
  )
}
