/**
 * Spectre Chart System - Public API
 *
 * Import from '@/chart' for all chart needs:
 *   import SpectreChart from '@/chart'
 *   import { SpectreSparkline, useChartData, useChartPreferences } from '@/chart'
 */

// Components
export { default as default } from './SpectreChart'
export { default as SpectreChart } from './SpectreChart'
export { default as SpectreSparkline } from './SpectreSparkline'

// Controls (standalone toolbar pieces)
export { default as TimeframeBar } from './controls/TimeframeBar'
export { default as ChartTypeToggle } from './controls/ChartTypeToggle'
export { default as ChartToolbar } from './controls/ChartToolbar'

// Hooks
export { useChartData, getBinanceSymbol, BINANCE_PAIRS } from './hooks/useChartData'
export { useChartPreferences } from './hooks/useChartPreferences'

// Engine (for advanced usage / custom charts)
export { createSpectreChart, applyTheme, formatPrice } from './engine/createSpectreChart'
export { getTheme, getSeriesColors, getVolumeColors } from './engine/spectreTheme'
export {
  createPriceSeries,
  createVolumeSeries,
  configureVolumeScale,
  formatBarsForSeries,
  formatVolumeData,
} from './engine/seriesFactory'

// Overlays
export { addATHMarker, findATH } from './overlays/athMarker'
export { setTradeMarkers } from './overlays/tradeMarkers'

// Adapters (for direct data access)
export { fetchBinanceBars, fetchBinanceLatestBar } from './adapters/binanceAdapter'
export { fetchSpectreBars, filterOutliers } from './adapters/codexAdapter'
