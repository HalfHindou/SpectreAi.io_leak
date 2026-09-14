/**
 * Spectre Chart Themes
 * Dark + Day mode configs for TradingView Lightweight Charts v5.
 * All colors from CSS custom properties in src/index.css.
 */

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif'
const MONO_STACK = '"JetBrains Mono", "SF Mono", "Monaco", "Consolas", monospace'

export const darkTheme = {
  layout: {
    background: { color: 'transparent' },
    textColor: 'rgba(245, 245, 247, 0.6)',
    fontFamily: MONO_STACK,
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
    horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
  },
  crosshair: {
    mode: 0, // CrosshairMode.Normal
    vertLine: {
      color: 'rgba(245, 245, 247, 0.3)',
      width: 1,
      style: 2,
      labelBackgroundColor: 'rgba(9, 9, 11, 0.95)',
      labelVisible: true,
    },
    horzLine: {
      color: 'rgba(245, 245, 247, 0.3)',
      width: 1,
      style: 2,
      labelBackgroundColor: 'rgba(9, 9, 11, 0.95)',
      labelVisible: true,
    },
  },
  rightPriceScale: {
    borderColor: 'rgba(255, 255, 255, 0.04)',
    scaleMargins: { top: 0.08, bottom: 0.15 },
    textColor: 'rgba(245, 245, 247, 0.5)',
  },
  timeScale: {
    borderColor: 'rgba(255, 255, 255, 0.04)',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 5,
    barSpacing: 8,
    fixLeftEdge: false,
    fixRightEdge: false,
  },
}

export const dayTheme = {
  layout: {
    background: { color: 'transparent' },
    textColor: '#475569',
    fontFamily: MONO_STACK,
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(0, 0, 0, 0.04)' },
    horzLines: { color: 'rgba(0, 0, 0, 0.04)' },
  },
  crosshair: {
    mode: 0,
    vertLine: {
      color: 'rgba(15, 23, 42, 0.3)',
      width: 1,
      style: 2,
      labelBackgroundColor: 'rgba(255, 255, 255, 0.95)',
      labelVisible: true,
    },
    horzLine: {
      color: 'rgba(15, 23, 42, 0.3)',
      width: 1,
      style: 2,
      labelBackgroundColor: 'rgba(255, 255, 255, 0.95)',
      labelVisible: true,
    },
  },
  rightPriceScale: {
    borderColor: 'rgba(0, 0, 0, 0.06)',
    scaleMargins: { top: 0.08, bottom: 0.15 },
    textColor: '#475569',
  },
  timeScale: {
    borderColor: 'rgba(0, 0, 0, 0.06)',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 5,
    barSpacing: 8,
    fixLeftEdge: false,
    fixRightEdge: false,
  },
}

// Series-level color configs
export const candleColors = {
  dark: {
    upColor: '#10B981',
    downColor: '#EF4444',
    wickUpColor: '#10B981',
    wickDownColor: '#EF4444',
    borderUpColor: '#10B981',
    borderDownColor: '#EF4444',
  },
  day: {
    upColor: '#10B981',
    downColor: '#EF4444',
    wickUpColor: '#10B981',
    wickDownColor: '#EF4444',
    borderUpColor: '#10B981',
    borderDownColor: '#EF4444',
  },
}

export const lineColors = {
  dark: {
    color: '#f5f5f7',
    lineWidth: 2,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBackgroundColor: '#f5f5f7',
  },
  day: {
    color: '#0f172a',
    lineWidth: 2,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBackgroundColor: '#0f172a',
  },
}

export const areaColors = {
  dark: {
    lineColor: '#f5f5f7',
    topColor: 'rgba(245, 245, 247, 0.18)',
    bottomColor: 'rgba(245, 245, 247, 0.01)',
    lineWidth: 2,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBackgroundColor: '#f5f5f7',
  },
  day: {
    lineColor: '#0f172a',
    topColor: 'rgba(15, 23, 42, 0.12)',
    bottomColor: 'rgba(15, 23, 42, 0.01)',
    lineWidth: 2,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBackgroundColor: '#0f172a',
  },
}

export const volumeColors = {
  dark: {
    upColor: 'rgba(16, 185, 129, 0.25)',
    downColor: 'rgba(239, 68, 68, 0.25)',
  },
  day: {
    upColor: 'rgba(16, 185, 129, 0.2)',
    downColor: 'rgba(239, 68, 68, 0.2)',
  },
}

export function getTheme(isDayMode) {
  return isDayMode ? dayTheme : darkTheme
}

export function getSeriesColors(seriesType, isDayMode) {
  const mode = isDayMode ? 'day' : 'dark'
  switch (seriesType) {
    case 'candle': return candleColors[mode]
    case 'line': return lineColors[mode]
    case 'area': return areaColors[mode]
    default: return candleColors[mode]
  }
}

export function getVolumeColors(isDayMode) {
  return isDayMode ? volumeColors.day : volumeColors.dark
}
