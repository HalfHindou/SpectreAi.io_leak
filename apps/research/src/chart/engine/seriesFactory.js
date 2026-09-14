/**
 * Series Factory
 * Creates candlestick, line, area, and volume series on a chart.
 * Uses LWC v5 addSeries API with named series types.
 */
import {
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
} from 'lightweight-charts'
import { getSeriesColors, getVolumeColors } from './spectreTheme'

/**
 * Creates the primary price series (candle, line, or area).
 *
 * @param {IChartApi} chart
 * @param {'candle'|'line'|'area'} type
 * @param {boolean} isDayMode
 * @returns {ISeriesApi}
 */
export function createPriceSeries(chart, type, isDayMode) {
  const colors = getSeriesColors(type, isDayMode)

  switch (type) {
    case 'candle':
      return chart.addSeries(CandlestickSeries, {
        ...colors,
        priceLineVisible: true,
        lastValueVisible: true,
      })

    case 'line':
      return chart.addSeries(LineSeries, {
        ...colors,
        priceLineVisible: true,
        lastValueVisible: true,
      })

    case 'area':
      return chart.addSeries(AreaSeries, {
        ...colors,
        priceLineVisible: true,
        lastValueVisible: true,
      })

    default:
      return chart.addSeries(CandlestickSeries, {
        ...colors,
        priceLineVisible: true,
        lastValueVisible: true,
      })
  }
}

/**
 * Creates a volume histogram series at the bottom of the chart.
 *
 * @param {IChartApi} chart
 * @param {boolean} isDayMode
 * @returns {ISeriesApi}
 */
export function createVolumeSeries(chart, isDayMode) {
  const colors = getVolumeColors(isDayMode)

  return chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    color: colors.upColor,
    lastValueVisible: false,
    priceLineVisible: false,
  })
}

/**
 * Configure the volume price scale (bottom 20% of chart).
 * Call after creating the volume series.
 */
export function configureVolumeScale(chart) {
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
    drawTicks: false,
    borderVisible: false,
  })
}

/**
 * Formats OHLCV data for a specific series type.
 * Candle: { time, open, high, low, close }
 * Line: { time, value }
 * Area: { time, value }
 *
 * @param {Array<{time, open, high, low, close, volume?}>} bars
 * @param {'candle'|'line'|'area'} type
 * @returns {Array}
 */
export function formatBarsForSeries(bars, type) {
  if (!bars || bars.length === 0) return []

  if (type === 'candle') {
    return bars.map(b => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
  }

  // Line and area use { time, value }
  return bars.map(b => ({
    time: b.time,
    value: b.close,
  }))
}

/**
 * Formats volume data with per-bar coloring (green up, red down).
 *
 * @param {Array<{time, open, close, volume}>} bars
 * @param {boolean} isDayMode
 * @returns {Array<{time, value, color}>}
 */
export function formatVolumeData(bars, isDayMode) {
  if (!bars || bars.length === 0) return []
  const colors = getVolumeColors(isDayMode)

  return bars
    .filter(b => b.volume != null && b.volume > 0)
    .map(b => ({
      time: b.time,
      value: b.volume,
      color: b.close >= b.open ? colors.upColor : colors.downColor,
    }))
}
