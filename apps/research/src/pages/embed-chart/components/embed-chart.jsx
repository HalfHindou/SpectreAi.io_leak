/**
 * EmbedChart — orchestrates toolbar, chart body, and range slider.
 * Props:
 *   cgId: string (CoinGecko ID from the :cgId route param)
 *
 * State:
 *   chartType:     'line' | 'candle' | 'tv'
 *   rangeTimeframe: '1D' | '7D' | '1M' | '3M' | '1Y'  (data window for line/candle)
 *   tvTimeframe:   '15M' | '1H' | '4H' | '1D' | '1W'  (TV candle resolution)
 *   range:         { start, end } in [0,1]
 *
 * Range resets to { 0, 1 } whenever timeframe changes.
 * Range is hidden when chartType === 'tv' (TV handles its own time control).
 * Mouse wheel on chart body zooms `range` around cursor x.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import ChartToolbar from './chart-toolbar'
import ChartWatermark from '@/components/chart-watermark'
import LineChart from './line-chart'
import CandleChart from './candle-chart'
import TradingViewEmbed, { timeframeToTVInterval } from './tradingview-embed'
import RangeSlider from './range-slider'
import { useEmbedData } from './use-embed-data'
import { useTokenIds } from './use-token-ids'
import { getBinanceSymbol } from './cg-to-binance'
import './embed-chart.css'
import './embed-chart.mobile.css'

// Heavy (self-hosted charting_library, ~2MB) — only paid on first TV click.
const TradingViewAdvanced = lazy(() => import('@/components/TradingViewAdvanced'))

// Data-window options for line/candle (how much history to fetch).
const RANGE_TIMEFRAMES = ['1D', '7D', '1M', '3M', '1Y']

// TV candle-resolution options (matches TradingViewAdvanced's TIMEFRAME_TO_RESOLUTION keys).
const TV_TIMEFRAMES = ['15M', '1H', '4H', '1D', '1W']

function monthLabels(startMs, endMs, locale) {
  const out = []
  const d = new Date(startMs)
  d.setDate(1); d.setHours(0, 0, 0, 0)
  while (d.getTime() <= endMs) {
    const pos = (d.getTime() - startMs) / (endMs - startMs)
    if (pos >= 0 && pos <= 1) {
      out.push({ pos, text: d.toLocaleString(locale || undefined, { month: 'short' }) })
    }
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export default function EmbedChart({ cgId }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || undefined
  const [chartType, setChartType] = useState('line')
  const [rangeTimeframe, setRangeTimeframe] = useState('1D')
  const [tvTimeframe, setTvTimeframe] = useState('1H')
  const [range, setRange] = useState({ start: 0, end: 1 })

  const isTv = chartType === 'tv'
  const timeframe = isTv ? tvTimeframe : rangeTimeframe
  const setTimeframe = isTv ? setTvTimeframe : setRangeTimeframe
  const timeframes = isTv ? TV_TIMEFRAMES : RANGE_TIMEFRAMES

  const binanceSymbol = useMemo(() => getBinanceSymbol(cgId), [cgId])
  const { symbol: tokenSymbol, address: codexAddress, networkId: codexNetwork, advAvailable } = useTokenIds(cgId)

  const { lineSeries, candleSeries, loading, error, refetch } = useEmbedData(
    cgId, rangeTimeframe, chartType,
    { address: codexAddress, networkId: codexNetwork },
  )

  // `advancedNoData` flips to true when the Advanced datafeed says no bars for
  // this token. We then fall back to the iframe (if Binance has it) without
  // forcing the user to toggle manually.
  const [advancedNoData, setAdvancedNoData] = useState(false)
  useEffect(() => { setAdvancedNoData(false) }, [cgId, codexAddress])

  const advancedUsable = advAvailable && !advancedNoData
  const tvAvailable = advancedUsable || !!binanceSymbol

  // If TV becomes unavailable while selected, drop back to line
  useEffect(() => {
    if (chartType === 'tv' && !tvAvailable) setChartType('line')
  }, [chartType, tvAvailable])

  // Reset viewport on timeframe change
  useEffect(() => {
    setRange({ start: 0, end: 1 })
  }, [timeframe, chartType])

  // Wheel/pinch zoom on chart body → adjust range around cursor
  const bodyRef = useRef(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e) => {
      if (chartType === 'tv') return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const xFrac = (e.clientX - rect.left) / rect.width
      const center = range.start + xFrac * (range.end - range.start)
      const factor = Math.exp(e.deltaY * 0.0015) // up = zoom in
      let width = (range.end - range.start) * factor
      width = Math.min(1, Math.max(0.02, width))
      let start = center - xFrac * width
      let end = start + width
      if (start < 0) { start = 0; end = width }
      if (end > 1) { end = 1; start = 1 - width }
      setRange({ start, end })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [range, chartType])

  // Slider labels from the active series (line used as time axis when candles empty)
  const sliderLabels = useMemo(() => {
    const src = chartType === 'candle' ? candleSeries : lineSeries
    if (!src?.length) return []
    const t0 = src[0].t
    const t1 = src[src.length - 1].t
    if (!t0 || !t1 || t1 <= t0) return []
    return monthLabels(t0, t1, locale).slice(0, 5)
  }, [chartType, lineSeries, candleSeries, locale])

  const activeSeries = chartType === 'candle' ? candleSeries : lineSeries
  const hasData = (activeSeries?.length ?? 0) > 0

  return (
    <div className="embed-chart-root">
      <ChartToolbar
        chartType={chartType}
        onChartType={setChartType}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        timeframes={timeframes}
        tvAvailable={tvAvailable}
      />

      <div ref={bodyRef} className="embed-chart-body spectre-wm-host">
        {chartType !== 'tv' && hasData ? <ChartWatermark /> : null}

        {chartType === 'tv' ? (
          // TV mode has its own loading/data pipeline; don't block on CoinGecko state.
          advancedUsable ? (
            <Suspense fallback={<div className="embed-chart-skeleton animate-shimmer" aria-hidden />}>
              <TradingViewAdvanced
                symbol={tokenSymbol || cgId.toUpperCase()}
                timeframe={tvTimeframe}
                token={{ symbol: tokenSymbol, address: codexAddress, networkId: codexNetwork }}
                onNoData={() => setAdvancedNoData(true)}
              />
            </Suspense>
          ) : (
            <TradingViewEmbed binanceSymbol={binanceSymbol} interval={timeframeToTVInterval(tvTimeframe)} />
          )
        ) : error ? (
          <div className="embed-chart-error">
            <p>{t('embedChart.error.body', 'Unable to load chart data.')}</p>
            <button type="button" className="embed-retry-btn" onClick={refetch}>{t('embedChart.error.retry', 'Tap to retry')}</button>
          </div>
        ) : loading && !hasData ? (
          <div className="embed-chart-skeleton animate-shimmer" aria-hidden />
        ) : chartType === 'candle' ? (
          <CandleChart data={candleSeries} range={range} />
        ) : (
          <LineChart data={lineSeries} range={range} />
        )}

        <a
          className="embed-powered-by"
          href="https://spectreai.io/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('embedChart.poweredBy', 'Powered by')} <span className="embed-powered-by-brand">Spectre AI</span>
        </a>
      </div>

      {chartType !== 'tv' && hasData ? (
        <RangeSlider value={range} onChange={setRange} labels={sliderLabels} />
      ) : null}
    </div>
  )
}
