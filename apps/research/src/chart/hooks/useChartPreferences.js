/**
 * Chart Preferences Hook
 * Reads timeframe and chart type from the Zustand settings store.
 * Maps store values to SpectreChart values (e.g. 'candles' -> 'candle').
 */
import useSettingsStore from '@/store/useSettingsStore'

// Store uses 'candles', SpectreChart uses 'candle'
const STORE_TO_CHART = { candles: 'candle', line: 'line', area: 'area' }
const CHART_TO_STORE = { candle: 'candles', line: 'line', area: 'area' }

const DEFAULT_TIMEFRAME = '1H'
const DEFAULT_CHART_TYPE = 'candle'

/**
 * Reads and writes chart preferences from the Zustand settings store.
 *
 * @returns {{ timeframe, chartType, setTimeframe, setChartType }}
 */
export function useChartPreferences() {
  const rawTimeframe = useSettingsStore((s) => s.chartTimeframe)
  const rawType = useSettingsStore((s) => s.chartType)
  const setStoreTimeframe = useSettingsStore((s) => s.setChartTimeframe)
  const setStoreType = useSettingsStore((s) => s.setChartType)

  const timeframe = rawTimeframe || DEFAULT_TIMEFRAME
  const chartType = STORE_TO_CHART[rawType] || DEFAULT_CHART_TYPE

  function setTimeframe(tf) {
    setStoreTimeframe(tf)
  }

  function setChartType(type) {
    setStoreType(CHART_TO_STORE[type] || type)
  }

  return { timeframe, chartType, setTimeframe, setChartType }
}

export { DEFAULT_TIMEFRAME, DEFAULT_CHART_TYPE }
