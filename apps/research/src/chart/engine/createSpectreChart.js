/**
 * Chart Factory
 * Creates and configures a TradingView Lightweight Chart instance.
 * Handles disposal, resize observation, and theme application.
 */
import { createChart } from 'lightweight-charts'
import { getTheme } from './spectreTheme'

/**
 * Creates a configured LWC chart instance attached to the given container.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {object} options
 * @param {boolean} options.isDayMode - light theme
 * @param {boolean} options.mini - minimal mode (no axes, no crosshair, no grid)
 * @param {number} options.height - explicit height in px (optional, defaults to container height)
 * @returns {{ chart, resizeObserver, dispose }}
 */
export function createSpectreChart(container, options = {}) {
  const { isDayMode = false, mini = false, height } = options

  const theme = getTheme(isDayMode)

  // Mini mode overrides - strip chrome for sparkline-like usage
  const miniOverrides = mini ? {
    crosshair: { mode: 0, vertLine: { visible: false }, horzLine: { visible: false } },
    rightPriceScale: { visible: false },
    timeScale: { visible: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    handleScroll: false,
    handleScale: false,
  } : {}

  const chartOptions = {
    ...theme,
    ...miniOverrides,
    width: container.clientWidth,
    height: height || container.clientHeight || 400,
    autoSize: false,
    localization: {
      priceFormatter: formatPrice,
    },
  }

  const chart = createChart(container, chartOptions)

  // ResizeObserver for responsive charts
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width: w } = entry.contentRect
      if (w > 0) {
        chart.resize(w, height || entry.contentRect.height || 400)
      }
    }
  })
  resizeObserver.observe(container)

  function dispose() {
    resizeObserver.disconnect()
    chart.remove()
  }

  return { chart, resizeObserver, dispose }
}

/**
 * Apply a new theme to an existing chart (for live day mode toggle).
 */
export function applyTheme(chart, isDayMode) {
  const theme = getTheme(isDayMode)
  chart.applyOptions(theme)
}

/**
 * Smart price formatter - auto-detects decimal places from value magnitude.
 */
function formatPrice(value) {
  if (value === undefined || value === null || isNaN(value)) return ''
  const abs = Math.abs(value)
  if (abs >= 10000) return value.toFixed(0)
  if (abs >= 100) return value.toFixed(2)
  if (abs >= 1) return value.toFixed(2)
  if (abs >= 0.01) return value.toFixed(4)
  if (abs >= 0.0001) return value.toFixed(6)
  // Sub-penny tokens - find first significant digit
  const str = abs.toFixed(12)
  const match = str.match(/0\.(0*)([1-9]\d{0,3})/)
  if (match) {
    const leadingZeros = match[1].length
    return value.toFixed(leadingZeros + 4)
  }
  return value.toFixed(8)
}

export { formatPrice }
