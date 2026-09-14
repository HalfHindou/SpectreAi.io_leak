/**
 * Research Zone PRO — Technicals Tab
 * Welcome-page visual language. Sections wrapped in SectionShell.
 * Sections: Technical Chart → Technical Indicators → TA AI Analysis
 * All indicators computed from real Codex/Binance OHLCV (useKlineIndicators).
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import TradingViewAdvanced from '@/components/TradingViewAdvanced'
import ChartIframeEmbed from '@/components/chart-iframe-embed'
import { SectionDivider } from './rz-pro-shared'
import IButton from '@/components/intelligence/IButton'
import SectionShell from './rz-pro-sections/section-shell'
import SpectreLoader from '@/components/spectre-loader'
import useKlineIndicators, { majorResolutionFor, refreshCadenceMs } from '../hooks/use-kline-indicators'
import useMtfThesis from '../hooks/use-mtf-thesis'
import useTokenSafety from '../hooks/use-token-safety'
import { classifyToken } from '@/lib/token-class'
import { calculatePivotPoints } from '../data/rz-constants'
import { TechnicalIcon, ChartIcon, BrainIcon } from '../data/rz-icons.jsx'
import { drawSRZonesOnTvChart, clearTvZoneEntities } from '@/lib/sr-levels-tv'
import { scoreRsi, scoreStoch, scoreMacd, scoreBb } from '@/lib/indicator-score'
import { getBrainLookup } from '@/services/spectreDataApi'
import MacroAnalysisSection from './rz-macro-analysis'
import EquityMacroSection from './rz-equity-macro'
import TradeThesisSection from './rz-trade-thesis'
import './rz-technicals-tab.css'


// ────────────────────────────────────────────────────────────────────────────────
// 0. TECHNICAL CHART — TradingView with studies, indicators, zones, fullscreen
// ────────────────────────────────────────────────────────────────────────────────

const CHART_TIMEFRAMES = [
  { id: '5M', label: '5m' },
  { id: '15M', label: '15m' },
  { id: '30M', label: '30m' },
  { id: '1H', label: '1H' },
  { id: '4H', label: '4H' },
  { id: '12H', label: '12H' },
  { id: '1D', label: '1D' },
  { id: '1W', label: '1W' },
]

// TV SeriesType: 1=Candles, 8=Heikin Ashi, 2=Line, 3=Area
const CHART_TYPES = [
  { id: 1, label: 'Candles' },
  { id: 8, label: 'HA' },
  { id: 2, label: 'Line' },
  { id: 3, label: 'Area' },
]

// Indicator definitions — each can be lazily created and toggled
const INDICATOR_DEFS = [
  { key: 'bb', label: 'BB', title: 'Bollinger Bands', defaultOn: true },
  { key: 'rsi', label: 'RSI', title: 'RSI (14)', defaultOn: true },
  { key: 'macd', label: 'MACD', title: 'MACD', defaultOn: false },
  { key: 'ema', label: 'EMA', title: 'EMA Ribbon', defaultOn: false },
  { key: 'vwap', label: 'VWAP', title: 'VWAP', defaultOn: false },
  { key: 'fib', label: 'Fib', title: 'Fib Retracement', defaultOn: false },
  { key: 'ath', label: 'ATH', title: 'All-Time High', defaultOn: false },
]

// Fullscreen expand icon
const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><line x1="21" y1="3" x2="14" y2="10" />
    <polyline points="9 21 3 21 3 15" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

const TechnicalChart = React.memo(({ sym, td, dayMode, activeTokenInfo, timeframe, onTimeframeChange, srZones, isFullscreen, onToggleFullscreen }) => {
  const { t } = useTranslation()
  const [chartType, setChartType] = useState(1)
  const [showZones, setShowZones] = useState(true)
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false)
  const [chartEpoch, setChartEpoch] = useState(0)  // bumps when TV (re)creates the chart
  // Self-hosted TradingView's UDF cascade has no OHLCV for many DEX-only tokens
  // → it fired "No data here" with no recourse, unlike the hero chart which
  // falls back to a free embed. Mirror that here so the Technicals chart never
  // dead-ends on a blank ghost. Reset on token/timeframe change so a real feed
  // always gets re-tried first.
  const [chartNoData, setChartNoData] = useState(false)
  useEffect(() => { setChartNoData(false) }, [sym, activeTokenInfo?.address, activeTokenInfo?.networkId, activeTokenInfo?.cgId, activeTokenInfo?.binancePair, timeframe])
  // SOFT no-data (empty first bars on a LIVE widget): only fall back for
  // DEX-only tokens, where the self-hosted TV UDF feed genuinely has no OHLCV.
  // For a CEX/Binance token a soft no-data is far more likely a transient
  // first-load error (timeout/5xx) — keep the live chart, which recovers on its
  // own 15s poll, rather than stranding it on an embed.
  const chartCanFallback = !!activeTokenInfo?.address && !activeTokenInfo?.binancePair
  // HARD failure (`info.hard`): the self-hosted widget never mounted / never
  // painted (library load fail, widget throw, or the 22s no-canvas fail-open).
  // There is NO live poll to recover on, so majors (BTC/ETH — no contract
  // address) used to dead-end permanently on "Chart couldn't load". On a hard
  // fail we ALWAYS fall back to the free TradingView embed (BINANCE:<sym>),
  // which carries its own data and doesn't depend on /api/bars.
  const onChartNoData = useCallback((info) => {
    if (info?.hard || chartCanFallback) setChartNoData(true)
  }, [chartCanFallback])
  const chartRef = useRef(null)       // TV chart instance
  const widgetRef = useRef(null)      // TV widget instance (for fullscreen)
  const zoneIdsRef = useRef([])       // Zone shape entity IDs
  const studyRegistry = useRef({})    // { key: { id, created } }
  const fibIdsRef = useRef([])        // Fib shape entity IDs
  const athIdRef = useRef(null)       // ATH line entity ID

  // Indicator toggle state — default from INDICATOR_DEFS
  const [indicators, setIndicators] = useState(() => {
    const init = {}
    for (const d of INDICATOR_DEFS) init[d.key] = d.defaultOn
    return init
  })

  // ── Create a study by key (lazy — only when first enabled) ──
  const createStudy = useCallback((chart, key, dm) => {
    if (studyRegistry.current[key]?.created || studyRegistry.current[key]?.failed) return
    try {
      let id
      switch (key) {
        case 'bb':
          id = chart.createStudy('Bollinger Bands', false, false, { length: 20, mult: 2 }, {
            'plot.color': dm ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.4)',
            'filledAreaBg1.color': dm ? 'rgba(59, 130, 246, 0.06)' : 'rgba(59, 130, 246, 0.04)',
            'filledAreaBg1.visible': true,
          })
          break
        case 'rsi':
          id = chart.createStudy('Relative Strength Index', false, false, { length: 14 }, {
            'plot.color': '#f59e0b',
            'hline_70.color': 'rgba(239, 68, 68, 0.3)',
            'hline_30.color': 'rgba(16, 185, 129, 0.3)',
          })
          break
        case 'macd':
          id = chart.createStudy('MACD', false, false, { in_0: 12, in_1: 26, in_2: 'close', in_3: 9 }, {
            'histogram.color': '#26a69a',
            'macd.color': dm ? '#2196F3' : '#3B82F6',
            'signal.color': '#FF6D00',
          })
          break
        case 'ema': {
          // EMA Ribbon — 4 EMAs as a group
          const emaConfigs = [
            { length: 8,   color: 'rgba(6, 182, 212, 0.7)',  width: 1 },
            { length: 21,  color: 'rgba(59, 130, 246, 0.7)', width: 1 },
            { length: 55,  color: 'rgba(245, 158, 11, 0.7)', width: 1 },
            { length: 200, color: 'rgba(239, 68, 68, 0.5)',  width: 2 },
          ]
          const emaIds = []
          for (const cfg of emaConfigs) {
            const eid = chart.createStudy('Moving Average Exponential', true, false,
              { length: cfg.length }, { 'plot.color': cfg.color, 'plot.linewidth': cfg.width })
            if (eid) emaIds.push(eid)
          }
          studyRegistry.current['ema'] = { id: emaIds, created: true }
          return // early — stored as array
        }
        case 'vwap':
          id = chart.createStudy('VWAP', true, false, {}, {
            'vwap.color': dm ? 'rgba(167, 139, 250, 0.6)' : 'rgba(167, 139, 250, 0.5)',
            'vwap.linewidth': 2,
          })
          break
        default:
          return
      }
      if (id) studyRegistry.current[key] = { id, created: true }
    } catch (e) {
      // silently handled
      studyRegistry.current[key] = { id: null, created: false, failed: true }
    }
  }, [])

  // ── Toggle study visibility ──
  const toggleStudyVisibility = useCallback((chart, key, visible) => {
    const entry = studyRegistry.current[key]
    if (!entry?.created) return
    try {
      const ids = Array.isArray(entry.id) ? entry.id : [entry.id]
      for (const sid of ids) {
        const study = chart.getStudyById(sid)
        if (study?.setVisible) study.setVisible(visible)
      }
    } catch (e) {
      // silently handled
    }
  }, [])

  // ── Draw Fibonacci retracement from swing high/low ──
  const drawFibRetracement = useCallback((chart, dm) => {
    // Remove existing fibs
    for (const id of fibIdsRef.current) {
      try { chart.removeEntity(id) } catch (_) { /* TV cleanup race */ }
    }
    fibIdsRef.current = []

    try {
      const range = chart.getVisibleRange()
      // Export bar data to find swing high/low
      chart.exportData({
        from: range.from,
        to: range.to,
        includeTime: true,
      }).then(data => {
        if (!data?.data?.length) return
        const bars = data.data
        let highestHigh = -Infinity, lowestLow = Infinity
        let hhTime = range.to, llTime = range.from
        for (const bar of bars) {
          if (!Array.isArray(bar) || bar.length < 5) continue
          const [time, o, h, l, c] = bar
          if (h > highestHigh) { highestHigh = h; hhTime = time }
          if (l < lowestLow) { lowestLow = l; llTime = time }
        }
        if (highestHigh === -Infinity || lowestLow === Infinity) return

        // Draw fib: from earlier point to later point
        const p1 = hhTime < llTime
          ? { time: hhTime, price: highestHigh }
          : { time: llTime, price: lowestLow }
        const p2 = hhTime < llTime
          ? { time: llTime, price: lowestLow }
          : { time: hhTime, price: highestHigh }

        const fibColor = dm ? 'rgba(167, 139, 250, 0.6)' : 'rgba(167, 139, 250, 0.45)'
        const id = chart.createMultipointShape([p1, p2], {
          shape: 'fib_retracement',
          lock: true,
          disableSelection: true,
          overrides: {
            'linecolor': fibColor,
            'linewidth': 1,
            'level1-color': fibColor, 'level2-color': fibColor, 'level3-color': fibColor,
            'level4-color': fibColor, 'level5-color': fibColor,
          },
        })
        if (id) fibIdsRef.current.push(id)
      }).catch(() => {})
    } catch (e) {
      // silently handled
    }
  }, [])

  // ── Draw ATH line ──
  const drawAthLine = useCallback((chart, dm) => {
    if (athIdRef.current) {
      try { chart.removeEntity(athIdRef.current) } catch (_) { /* TV cleanup race */ }
      athIdRef.current = null
    }
    if (!td.ath) return
    try {
      const athColor = dm ? 'rgba(245, 158, 11, 0.5)' : 'rgba(245, 158, 11, 0.35)'
      const id = chart.createShape(
        { price: td.ath },
        { shape: 'horizontal_line', overrides: { linecolor: athColor, linewidth: 1, linestyle: 1, showLabel: true, text: `ATH $${Number(td.ath).toLocaleString('en-US', { maximumFractionDigits: 2 })}` } }
      )
      if (id) athIdRef.current = id
    } catch (e) {
      // silently handled
    }
  }, [td.ath])

  // ── Chart ready — create default studies; zones drawn by the effect below ──
  const handleChartReady = useCallback((widget, chart) => {
    chartRef.current = chart
    widgetRef.current = widget
    studyRegistry.current = {}
    zoneIdsRef.current = []

    // Create initially-enabled studies
    for (const def of INDICATOR_DEFS) {
      if (def.defaultOn) createStudy(chart, def.key, dayMode)
    }

    setChartEpoch(e => e + 1)
  }, [dayMode, createStudy])

  // ── S/R zones — redraw whenever the data, timeframe, theme, or chart changes ──
  // srZones comes from the SAME bars the indicator panel uses, so the bands on
  // the chart always match the Supply/Demand + Major level numbers below.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    clearTvZoneEntities(chart, zoneIdsRef)
    if (!showZones || !srZones) return
    // Small delay: after a resolution switch TV is still loading bars; drawing
    // immediately can drop shapes. Data arrival + this debounce covers it.
    const tid = setTimeout(() => {
      drawSRZonesOnTvChart(chart, srZones, dayMode, zoneIdsRef)
    }, 350)
    return () => clearTimeout(tid)
  }, [srZones, showZones, dayMode, chartEpoch])

  // ── Toggle an indicator on/off ──
  const handleIndicatorToggle = useCallback((key) => {
    setIndicators(prev => {
      const next = { ...prev, [key]: !prev[key] }
      const chart = chartRef.current
      if (!chart) return next

      if (next[key]) {
        // Turn on — create if not yet created, then show
        if (key === 'fib') {
          drawFibRetracement(chart, dayMode)
        } else if (key === 'ath') {
          drawAthLine(chart, dayMode)
        } else {
          if (!studyRegistry.current[key]?.created) {
            createStudy(chart, key, dayMode)
          } else {
            toggleStudyVisibility(chart, key, true)
          }
        }
      } else {
        // Turn off — hide or remove
        if (key === 'fib') {
          for (const id of fibIdsRef.current) { try { chart.removeEntity(id) } catch (_) { /* TV cleanup race */ } }
          fibIdsRef.current = []
        } else if (key === 'ath') {
          if (athIdRef.current) { try { chart.removeEntity(athIdRef.current) } catch (_) { /* TV cleanup race */ } }
          athIdRef.current = null
        } else {
          toggleStudyVisibility(chart, key, false)
        }
      }
      return next
    })
  }, [dayMode, createStudy, toggleStudyVisibility, drawFibRetracement, drawAthLine])

  // ── Zone toggle — the draw effect above reacts to showZones ──
  const handleZonesToggle = useCallback(() => setShowZones(p => !p), [])

  // ── Chart type change ──
  const handleChartTypeChange = useCallback((typeId) => {
    setChartType(typeId)
    try { chartRef.current?.setChartType(typeId) } catch (_) { /* TV cleanup race */ }
  }, [])

  return (
    <div className="rz-te2-chart-section">
      {/* Top bar: title + controls */}
      <div className="rz-te2-chart-bar">
        <SectionDivider title={t('researchPro.technicals.technicalchart.title', "Technical Chart")} icon={<ChartIcon size={14} />} />
        <div className="rz-te2-chart-controls">
          {/* Timeframes — lifted: switching also recomputes the indicator panel */}
          <div className="rz-te2-chart-tfs">
            {CHART_TIMEFRAMES.map(tf => (
              <button
                key={tf.id}
                className={`rz-te2-chart-tf${timeframe === tf.id ? ' active' : ''}`}
                onClick={() => onTimeframeChange?.(tf.id)}
              >{tf.label}</button>
            ))}
          </div>

          {/* Chart type */}
          <div className="rz-te2-chart-tfs">
            {CHART_TYPES.map(ct => (
              <button
                key={ct.id}
                className={`rz-te2-chart-tf${chartType === ct.id ? ' active' : ''}`}
                onClick={() => handleChartTypeChange(ct.id)}
              >{ct.label}</button>
            ))}
          </div>

          {/* Zones toggle */}
          <button
            className={`rz-te2-chart-pill${showZones ? ' active' : ''}`}
            onClick={handleZonesToggle}
            title={t('researchPro.technicals.technicalchart.title2', "Toggle supply/demand zones")}
          >{t('researchPro.technicals.technicalchart.zones', "Zones")}</button>

          {/* Indicators toggle */}
          <button
            className={`rz-te2-chart-pill${showIndicatorPanel ? ' active' : ''}`}
            onClick={() => setShowIndicatorPanel(p => !p)}
            title={t('researchPro.technicals.technicalchart.title3', "Toggle indicator panel")}
          >{t('researchPro.technicals.technicalchart.indicators', "Indicators")}</button>

          {/* Fullscreen — expands the whole tab (chart + thesis fill the page) */}
          <button className="rz-te2-chart-pill rz-te2-fs-btn" onClick={onToggleFullscreen} title={t('researchPro.technicals.technicalchart.title4', "Fullscreen technicals")}>
            <ExpandIcon />
          </button>
        </div>
      </div>

      {/* Indicator toggle panel — expandable row */}
      {showIndicatorPanel && (
        <div className="rz-te2-ind-panel">
          {INDICATOR_DEFS.map(def => (
            <button
              key={def.key}
              className={`rz-te2-ind-pill${indicators[def.key] ? ' active' : ''}`}
              onClick={() => handleIndicatorToggle(def.key)}
              title={def.title}
            >
              <span className={`rz-te2-ind-check${indicators[def.key] ? ' on' : ''}`} />
              {def.label}
            </button>
          ))}
        </div>
      )}

      {/* Chart — falls back to a free embed when the self-hosted TV feed has no
          data for a DEX-only token, instead of a blank "No data here" ghost. */}
      <div className="rz-te2-chart">
        {chartNoData ? (
          <ChartIframeEmbed
            token={activeTokenInfo || undefined}
            timeframe={timeframe}
            dayMode={dayMode}
            height={isFullscreen ? 640 : 460}
          />
        ) : (
          <TradingViewAdvanced
            symbol={sym}
            timeframe={timeframe}
            dayMode={dayMode}
            height={isFullscreen ? 640 : 460}
            token={activeTokenInfo || undefined}
            onNoData={onChartNoData}
            onChartReady={handleChartReady}
          />
        )}
      </div>

      {/* Zone legend — real detected S/R, local (this TF) + major (higher TF) */}
      {showZones && srZones && (srZones.local.length > 0 || srZones.major.length > 0) && (
        <div className="rz-te2-zone-legend">
          <span className="rz-te2-zone-period">{timeframe} locals · {srZones.majorSourceLabel} majors</span>
          <div className="rz-te2-zone-legend-item">
            <span className="rz-te2-zone-band supply" />
            <span className="rz-te2-zone-label">Major Resistance ({srZones.major.filter(z => z.side === 'resistance').length})</span>
          </div>
          <div className="rz-te2-zone-legend-item">
            <span className="rz-te2-zone-band sell" />
            <span className="rz-te2-zone-label">Local Resistance ({srZones.local.filter(z => z.side === 'resistance').length})</span>
          </div>
          {srZones.pivot != null && (
            <div className="rz-te2-zone-legend-item">
              <span className="rz-te2-zone-dot pivot" />
              <span className="rz-te2-zone-label">Pivot ({srZones.pivotPeriod})</span>
            </div>
          )}
          <div className="rz-te2-zone-legend-item">
            <span className="rz-te2-zone-band buy" />
            <span className="rz-te2-zone-label">Local Support ({srZones.local.filter(z => z.side === 'support').length})</span>
          </div>
          <div className="rz-te2-zone-legend-item">
            <span className="rz-te2-zone-band demand" />
            <span className="rz-te2-zone-label">Major Support ({srZones.major.filter(z => z.side === 'support').length})</span>
          </div>
        </div>
      )}
    </div>
  )
})

// ── Zone drawing helpers — shared with the RZ hero chart ─────────────────────
// drawSRZonesOnTvChart / clearTvZoneEntities live in @/lib/sr-levels-tv so the
// hero chart (trading-chart.jsx TV mode) renders identical bands.

// ── Pivot period helpers ────────────────────────────────────────────────────────

/** Map chart timeframe → pivot calculation period */
function getPivotPeriod(timeframe) {
  switch (timeframe) {
    case '15M': case '1H': case '4H': return 'daily'
    case '1D': return 'weekly'
    case '1W': return 'monthly'
    default: return 'daily'
  }
}

/** Group OHLCV bars ({t,h,l,c}) by period, return previous completed period's H/L/C */
function getPreviousPeriodHLC(bars, period) {
  if (!bars?.length) return null

  const getPeriodKey = (ts) => {
    const d = new Date(ts * 1000)
    switch (period) {
      case 'daily':
        return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
      case 'weekly': {
        const day = d.getUTCDay() || 7
        const mon = new Date(d)
        mon.setUTCDate(d.getUTCDate() - day + 1)
        return `W-${mon.getUTCFullYear()}-${mon.getUTCMonth()}-${mon.getUTCDate()}`
      }
      case 'monthly':
        return `${d.getUTCFullYear()}-${d.getUTCMonth()}`
      default:
        return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
    }
  }

  const periods = new Map()
  for (const bar of bars) {
    if (!bar || !Number.isFinite(bar.c)) continue
    const key = getPeriodKey(bar.t)
    if (!periods.has(key)) {
      periods.set(key, { high: bar.h, low: bar.l, close: bar.c, lastTime: bar.t })
    } else {
      const p = periods.get(key)
      if (bar.h > p.high) p.high = bar.h
      if (bar.l < p.low) p.low = bar.l
      if (bar.t > p.lastTime) { p.close = bar.c; p.lastTime = bar.t }
    }
  }

  const sorted = [...periods.values()].sort((a, b) => a.lastTime - b.lastTime)
  // Use the second-to-last period (last is current/incomplete)
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2]
    return { high: prev.high, low: prev.low, close: prev.close }
  }
  return sorted.length === 1
    ? { high: sorted[0].high, low: sorted[0].low, close: sorted[0].close }
    : null
}


// ────────────────────────────────────────────────────────────────────────────────
// 3b. TECHNICAL INDICATORS LIST — real values + bull/bear/neutral signal pills
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Compute bull/bear/neutral signal for each indicator.
 * Returns 'bull' | 'bear' | 'neutral' | null (null = not enough data).
 */
function computeSignals(indicators) {
  if (!indicators) return {}
  const price = Number(indicators.price) || 0

  // EMA200 — price above = bull, below = bear
  const ema200 = indicators.ema200
  const emaSig = (ema200 == null || price === 0)
    ? null
    : (price > ema200 ? 'bull' : 'bear')

  // RSI + Stoch — SHARED scorer (lib/indicator-score), now REGIME-AWARE: the
  // hook's detectRegime read rides on `indicators.regime` (null on the stocks
  // path, which keeps the pre-regime midline semantics). In an uptrend /
  // price discovery an overbought oscillator is trend strength, not a fade;
  // in a range it fades. Same scorer feeds the MTF matrix and the thesis
  // cases, so the gauge can never contradict them again.
  const regime = indicators.regime || null
  const rsiSig = scoreRsi(indicators.rsi, regime).sig
  const stochSig = scoreStoch(indicators.stochRsi?.k, regime).sig

  // ATR — non-directional volatility, always neutral when present
  const atrSig = indicators.atr == null ? null : 'neutral'

  // MACD family — shared scorer (line sign / cross / histogram)
  const { lineSig: macdLineSig, crossSig: macdCrossSig, histSig } = scoreMacd(indicators.macd)

  // BB — regime-aware: riding the upper band in an uptrend is a band-walk
  // (trend strength); only a stretch fade in a range / no-regime read.
  const bbSig = scoreBb(price, indicators.bb, regime).sig

  // Supply/Demand zones — proximity-based signals (within 1.5% of the band)
  const near = (edge) => price > 0 && Math.abs(price - edge) / price <= 0.015
  const supply = indicators.supply
  const supplySig = (supply == null || price === 0) ? null : (
    price >= supply.low || near(supply.low) ? 'bear' : 'neutral'
  )
  const demand = indicators.demand
  const demandSig = (demand == null || price === 0) ? null : (
    price <= demand.high || near(demand.high) ? 'bull' : 'neutral'
  )

  // Major levels — same proximity logic on the higher-timeframe zones
  const majR = indicators.majorResistance
  const majRSig = (majR == null || price === 0) ? null : (
    price >= majR.low || near(majR.low) ? 'bear' : 'neutral'
  )
  const majS = indicators.majorSupport
  const majSSig = (majS == null || price === 0) ? null : (
    price <= majS.high || near(majS.high) ? 'bull' : 'neutral'
  )

  return {
    'EMA200': emaSig,
    'RSI': rsiSig,
    'Stochastic RSI': stochSig,
    'ATR': atrSig,
    'Supply Zone': supplySig,
    'Demand Zone': demandSig,
    'Major Resistance': majRSig,
    'Major Support': majSSig,
    'MACD Line': macdLineSig,
    'MACD Signal': macdCrossSig,
    'MACD Histogram': histSig,
    'BB Upper': bbSig,
    'BB Middle': bbSig,
    'BB Lower': bbSig,
    'Volume 1h': indicators.volume1hUsd == null ? null : 'neutral',
  }
}

function summarizeSignals(signalMap) {
  // Collapse near-duplicates (MACD Line + MACD Signal track the same fact, all 3 BB bands track BB position)
  const dedupe = ['EMA200', 'RSI', 'Stochastic RSI', 'MACD Line', 'MACD Histogram', 'BB Middle', 'Supply Zone', 'Demand Zone']
  let bull = 0, bear = 0, neutral = 0
  for (const k of dedupe) {
    const s = signalMap[k]
    if (s === 'bull') bull++
    else if (s === 'bear') bear++
    else if (s === 'neutral') neutral++
  }
  const total = bull + bear + neutral
  let state = 'NEUTRAL'
  if (total > 0) {
    const ratio = (bull - bear) / total
    if (ratio >= 0.3) state = 'BULLISH'
    else if (ratio <= -0.3) state = 'BEARISH'
    else if (Math.abs(ratio) < 0.15 && bull > 0 && bear > 0) state = 'MIXED'
    else state = 'NEUTRAL'
  }
  return { bull, bear, neutral, total, state }
}

const TechnicalIndicatorsList = React.memo(({ indicators, loading, fmtPrice, resolution }) => {
  const { t } = useTranslation()
  const signals = useMemo(() => computeSignals(indicators), [indicators])

  const rows = useMemo(() => {
    if (!indicators) return []
    const fmtVolume = (v) => {
      if (!v || !Number.isFinite(v)) return '—'
      if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
      if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
      if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
      return `$${Math.round(v)}`
    }
    const safe = (v, fn) => (v == null || !Number.isFinite(v)) ? '—' : fn(v)
    const zoneVal = (z) => z ? `${fmtPrice(z.low)}–${fmtPrice(z.high)}${z.touches ? ` ·×${z.touches}` : ''}${z.untested ? ' ·untested' : ''}` : '—'

    // Volume row shows the REAL volume regime (RVOL level + participation
    // direction), not a hard-coded neutral — "surge · expanding" is the read
    // that separates a runner from a low-volume drift. `~est` marks series
    // whose source didn't declare its volume unit.
    const vr = indicators.volumeRegime
    const volValue = [
      `${fmtVolume(indicators.volume1hUsd)}${indicators.volume1hEstimated ? ' ~est' : ''}`,
      vr ? `${vr.level} · ${vr.trend}` : null,
    ].filter(Boolean).join(' · ')

    return [
      { name: 'EMA200',         value: safe(indicators.ema200, fmtPrice) },
      { name: 'RSI',            value: safe(indicators.rsi, v => v.toFixed(2)) },
      { name: 'Stochastic RSI', value: safe(indicators.stochRsi?.k, v => v.toFixed(2)) },
      { name: 'ATR',            value: indicators.atr == null ? '—' : `${fmtPrice(indicators.atr)} (${indicators.atrPct?.toFixed(2) ?? '—'}%)` },
      { name: 'Supply Zone',    value: zoneVal(indicators.supply) },
      { name: 'Demand Zone',    value: zoneVal(indicators.demand) },
      { name: 'Major Resistance', value: zoneVal(indicators.majorResistance) },
      { name: 'Major Support',  value: zoneVal(indicators.majorSupport) },
      { name: 'MACD Line',      value: safe(indicators.macd?.line, v => v.toFixed(4)) },
      { name: 'MACD Signal',    value: safe(indicators.macd?.signal, v => v.toFixed(4)) },
      { name: 'MACD Histogram', value: safe(indicators.macd?.histogram, v => v.toFixed(4)) },
      { name: 'BB Upper',       value: safe(indicators.bb?.upper, fmtPrice) },
      { name: 'BB Middle',      value: safe(indicators.bb?.middle, fmtPrice) },
      { name: 'BB Lower',       value: safe(indicators.bb?.lower, fmtPrice) },
      { name: 'Volume 1h',      value: volValue },
    ]
  }, [indicators, fmtPrice])

  if (loading && !indicators) {
    return (
      <div className="rz-te2-ind-items">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rz-te2-ind-item">
            <span className="rz-te2-ind-num">{i + 1}.</span>
            <span className="rz-te2-ind-name animate-shimmer" style={{ width: 90, height: 12, borderRadius: 4 }} />
            <span className="rz-te2-ind-val animate-shimmer" style={{ width: 80, height: 12, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    )
  }

  if (!indicators) {
    return <div className="rz-te2-ind-items rz-te2-ind-empty">{t('researchPro.technicals.technicalindicatorslist.noOhlcvDataAvailable', "No OHLCV data available.")}</div>
  }

  return (
    <div className="rz-te2-ind-items">
      {rows.map((ind, i) => {
        const sig = signals[ind.name]
        return (
          <div key={ind.name} className="rz-te2-ind-item">
            <span className="rz-te2-ind-num">{i + 1}.</span>
            <span className="rz-te2-ind-name">{ind.name}</span>
            {sig && (
              <span className={`rz-te2-sig rz-te2-sig--${sig}`}>
                {sig === 'bull' ? 'BULL' : sig === 'bear' ? 'BEAR' : 'NEUT'}
              </span>
            )}
            <span className="rz-te2-ind-val mono">{ind.value}</span>
          </div>
        )
      })}
    </div>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// SIGNAL SUMMARY — top hero showing bull/bear/neutral counts + overall state
// ────────────────────────────────────────────────────────────────────────────────

const SignalSummary = React.memo(({ indicators, loading, tfLabel = '4H', compact = false, freshness = null }) => {
  const { t } = useTranslation()
  const signals = useMemo(() => computeSignals(indicators), [indicators])
  const { bull, bear, neutral, total, state } = useMemo(() => summarizeSignals(signals), [signals])
  // Honest freshness: green pulse ONLY when the bars behind these signals
  // resolved from the network within 2× the refresh cadence; a seed-painted
  // or aged read shows amber with its "as of" time instead of faking live.
  const isStale = !!freshness && !freshness.live

  if (loading && !indicators) {
    return (
      <div className="rz-te2-summary rz-te2-summary--loading">
        <SpectreLoader variant="logo" size="sm" label={`Reading ${tfLabel}`} />
      </div>
    )
  }
  if (!total) return null

  // Donut math
  const r = 36
  const c = 2 * Math.PI * r
  const bullArc = (bull / total) * c
  const bearArc = (bear / total) * c
  const neutralArc = (neutral / total) * c
  const bullOffset = c / 4
  const bearOffset = bullOffset - bullArc - 2
  const neutralOffset = bearOffset - bearArc - 2

  const stateMap = {
    BULLISH: { cls: 'bull', label: 'Bullish' },
    BEARISH: { cls: 'bear', label: 'Bearish' },
    MIXED:   { cls: 'mixed', label: 'Mixed' },
    NEUTRAL: { cls: 'neutral', label: 'Neutral' },
  }
  const st = stateMap[state] || stateMap.NEUTRAL

  return (
    <div className={`rz-te2-summary rz-te2-summary--${st.cls}${compact ? ' rz-te2-summary--compact' : ''}`}>
      <div className="rz-te2-summary-glow" aria-hidden="true" />

      <div className="rz-te2-summary-donut" aria-hidden="true">
        <svg viewBox="0 0 96 96" width="96" height="96">
          <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="10" />
          {bull > 0 && (
            <circle
              cx="48" cy="48" r={r}
              fill="none"
              stroke="var(--bull, #10B981)"
              strokeWidth="10"
              strokeDasharray={`${bullArc} ${c - bullArc}`}
              strokeDashoffset={bullOffset}
              strokeLinecap="butt"
              transform="rotate(-90 48 48)"
            />
          )}
          {bear > 0 && (
            <circle
              cx="48" cy="48" r={r}
              fill="none"
              stroke="var(--bear, #EF4444)"
              strokeWidth="10"
              strokeDasharray={`${bearArc} ${c - bearArc}`}
              strokeDashoffset={bearOffset}
              strokeLinecap="butt"
              transform="rotate(-90 48 48)"
            />
          )}
          {neutral > 0 && (
            <circle
              cx="48" cy="48" r={r}
              fill="none"
              stroke="var(--amber, #F59E0B)"
              strokeWidth="10"
              strokeDasharray={`${neutralArc} ${c - neutralArc}`}
              strokeDashoffset={neutralOffset}
              strokeLinecap="butt"
              transform="rotate(-90 48 48)"
            />
          )}
        </svg>
        <div className="rz-te2-summary-donut-center">
          <span className="rz-te2-summary-donut-num mono">{total}</span>
        </div>
      </div>

      <div className="rz-te2-summary-text">
        <div className="rz-te2-summary-label">
          <span className={`rz-te2-live${isStale ? ' rz-te2-live--stale' : ''}`}>
            <span className="rz-te2-live-dot" />
          </span>
          Technical Signals · {tfLabel}
          {isStale && freshness.asOfLabel && (
            <span className="rz-te2-asof mono"> · as of {freshness.asOfLabel}</span>
          )}
        </div>
        <div className={`rz-te2-summary-state rz-te2-summary-state--${st.cls}`}>{st.label}</div>
        <div className="rz-te2-summary-counts">
          <span className="rz-te2-summary-count rz-te2-summary-count--bull">
            <span className="rz-te2-summary-dot" />
            <span className="mono">{bull}</span> {t('researchPro.technicals.signalsummary.bullish', "Bullish")}
          </span>
          <span className="rz-te2-summary-count rz-te2-summary-count--neutral">
            <span className="rz-te2-summary-dot" />
            <span className="mono">{neutral}</span> {t('researchPro.technicals.signalsummary.neutral', "Neutral")}
          </span>
          <span className="rz-te2-summary-count rz-te2-summary-count--bear">
            <span className="rz-te2-summary-dot" />
            <span className="mono">{bear}</span> {t('researchPro.technicals.signalsummary.bearish', "Bearish")}
          </span>
        </div>
      </div>
    </div>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 3c. TA AI PER-INDICATOR — Expandable cards with AI explanations
// ────────────────────────────────────────────────────────────────────────────────

const InfoIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

// Indicator icons - inline SVGs matching each metric type
const indicatorIcons = {
  ema: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" />
    </svg>
  ),
  rsi: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
    </svg>
  ),
  stochastic: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  atr: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20l4-4 4 4 4-8 4 4 4-8" />
    </svg>
  ),
  supply: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  demand: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  ),
  macd: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="12" width="4" height="8" rx="1" /><rect x="10" y="8" width="4" height="12" rx="1" /><rect x="17" y="4" width="4" height="16" rx="1" />
    </svg>
  ),
  signal: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h.01" /><path d="M7 20v-4" /><path d="M12 20v-8" /><path d="M17 20V8" /><path d="M22 4v16" />
    </svg>
  ),
}

// Timeframe-explicit verdict strip. Sunny 2026-07-02: "u write bearish here…
// its all subjective so u need to be very clear and specific." Every line
// names its timeframe; short-term and trend get separate verdicts; a conflict
// between them is called out instead of averaged away. Composed from the SAME
// engine as the panel rows, so it can never contradict them (the old upstream
// sentence was computed on daily bars and shown unlabeled next to 4H values).
const TF_LT_SOURCE = { '15M': '1D', '1H': '1D', '4H': '1D', '1D': '1W', '1W': '1W' }

function buildTfVerdict(indicators, timeframe) {
  if (!indicators) return null
  const signals = computeSignals(indicators)
  const { bull, total, state } = summarizeSignals(signals)
  const stMap = {
    BULLISH: { label: 'Bullish', cls: 'bull' },
    BEARISH: { label: 'Bearish', cls: 'bear' },
    MIXED:   { label: 'Mixed', cls: 'neutral' },
    NEUTRAL: { label: 'Neutral', cls: 'neutral' },
  }
  const st = stMap[state] || stMap.NEUTRAL

  const drivers = []
  if (signals['MACD Signal'] === 'bull') drivers.push('MACD cross up')
  else if (signals['MACD Signal'] === 'bear') drivers.push('MACD cross down')
  if (indicators.rsi != null) drivers.push(`RSI ${indicators.rsi.toFixed(0)}`)
  if (signals['EMA200'] === 'bull') drivers.push('above 200 EMA')
  else if (signals['EMA200'] === 'bear') drivers.push('below 200 EMA')

  const lt = indicators.longTerm
  const ltLabel = TF_LT_SOURCE[timeframe] || '1D'
  let trend = null
  if (lt?.aboveEma200 != null) {
    const bits = [`price ${lt.aboveEma200 ? 'above' : 'below'} the ${ltLabel} 200 EMA`]
    if (lt.macdCross) bits.push(`MACD ${lt.macdCross}`)
    if (lt.change30 != null) bits.push(`${lt.change30 >= 0 ? '+' : ''}${lt.change30.toFixed(1)}% / 30${ltLabel === '1W' ? 'wk' : 'd'}`)
    const ltBull = (lt.aboveEma200 ? 1 : 0) + (lt.macdCross === 'bullish' ? 1 : 0) + (lt.change30 > 0 ? 1 : 0)
    const ltBear = (lt.aboveEma200 ? 0 : 1) + (lt.macdCross === 'bearish' ? 1 : 0) + (lt.change30 < 0 ? 1 : 0)
    trend = {
      state: ltBull > ltBear ? stMap.BULLISH : ltBear > ltBull ? stMap.BEARISH : stMap.MIXED,
      text: bits.join(' · '),
    }
  }

  // LONG-TERM OUTLOOK row (weekly bars) — the zoom-out. Panic candles and
  // fear prints live inside multi-month structure; this row says whether the
  // cycle structure is intact regardless of what the short clock is doing.
  const ol = indicators.outlook
  let outlook = null
  if (ol) {
    const bits = []
    if (ol.fromCycleHighPct != null && ol.fromCycleHighPct < -1) bits.push(`${ol.fromCycleHighPct.toFixed(0)}% from cycle high`)
    if (ol.aboveEma200w != null) bits.push(`${ol.aboveEma200w ? 'above' : 'below'} the 200-week EMA`)
    else if (ol.aboveEma50w != null) bits.push(`${ol.aboveEma50w ? 'above' : 'below'} the 50-week EMA`)
    if (ol.change90d != null) bits.push(`${ol.change90d >= 0 ? '+' : ''}${ol.change90d.toFixed(1)}% / 90d`)
    const structural = ol.aboveEma200w ?? ol.aboveEma50w
    const olBull = (structural ? 1 : 0) + (ol.macdCrossW === 'bullish' ? 1 : 0) + (ol.change90d > 0 ? 1 : 0)
    const olBear = (structural === false ? 1 : 0) + (ol.macdCrossW === 'bearish' ? 1 : 0) + (ol.change90d < 0 ? 1 : 0)
    outlook = {
      tf: '1W',
      state: olBull > olBear ? stMap.BULLISH : olBear > olBull ? stMap.BEARISH : stMap.MIXED,
      text: bits.join(' · ') || `${ol.weeks} weeks of history`,
    }
  }

  // Conflict line — the disagreement traders actually need spelled out
  let conflict = null
  if (trend) {
    if (st.cls === 'bull' && trend.state.cls === 'bear') {
      conflict = `Timeframes disagree: ${timeframe} momentum is bullish but the ${ltLabel} trend is down — upside is counter-trend until the ${ltLabel} 200 EMA is reclaimed.`
    } else if (st.cls === 'bear' && trend.state.cls === 'bull') {
      conflict = `Timeframes disagree: ${timeframe} momentum is bearish inside an intact ${ltLabel} uptrend — reads as a pullback unless major support fails.`
    }
  }
  // Cycle-context note: deep drawdown + intact weekly structure is where
  // fear readings historically resolve as accumulation, not exits.
  if (!conflict && outlook && outlook.state.cls === 'bull' && st.cls === 'bear') {
    conflict = `Zoom out: ${timeframe} weakness sits inside an intact weekly structure — position traders treat these windows as accumulation while the 1W trend holds.`
  }

  return {
    shortTerm: {
      tf: timeframe,
      state: st,
      text: `${bull} of ${total} signals bullish${drivers.length ? ` (${drivers.slice(0, 3).join(', ')})` : ''}`,
    },
    trend: trend ? { tf: ltLabel, ...trend } : null,
    outlook,
    conflict,
  }
}

const TAPerIndicatorSection = React.memo(({ indicators, loading, fmtPrice, timeframe = '4H' }) => {
  const { t } = useTranslation()
  const [activeTooltip, setActiveTooltip] = useState(null)
  const tooltipTimeoutRef = useRef(null)
  const verdict = useMemo(() => buildTfVerdict(indicators, timeframe), [indicators, timeframe])

  const showTooltip = useCallback((idx) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current)
    setActiveTooltip(idx)
  }, [])

  const hideTooltip = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => setActiveTooltip(null), 200)
  }, [])

  const rows = useMemo(() => {
    if (!indicators) return []
    const price = indicators.price || 0
    const fmt = (v) => (v == null || !Number.isFinite(v)) ? '—' : fmtPrice(v)

    // Regime read (from the hook, null on stocks) so the per-indicator copy
    // reframes "overbought" as trend strength in an uptrend — consistent with
    // the gauge, the MTF matrix and the thesis cases.
    const regime = indicators.regime || null
    const trendUp = !!regime && (regime.trend === 'up' || regime.priceDiscovery)
    const stripRsi = (n) => {
      const s = (n || '').replace(/^RSI\s+-?\d+\s+—\s+/, '')
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
    }

    const ema200 = indicators.ema200
    const aboveEma = ema200 != null ? price >= ema200 : null

    const rsi = indicators.rsi
    const rsiZone = rsi == null ? null
      : rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral'

    const stoch = indicators.stochRsi?.k
    const stochZone = stoch == null ? null
      : stoch >= 80 ? 'overbought' : stoch <= 20 ? 'oversold' : 'neutral'

    const atrPct = indicators.atrPct

    const macdLine = indicators.macd?.line
    const macdSignal = indicators.macd?.signal
    const macdCross = (macdLine != null && macdSignal != null)
      ? (macdLine > macdSignal ? 'bullish' : 'bearish')
      : null

    const bb = indicators.bb
    const bbPos = (bb && price)
      ? (price > bb.upper ? 'above-upper'
         : price < bb.lower ? 'below-lower'
         : 'inside')
      : null

    // Zone copy: describe what the level is made of, not just the range —
    // and be honest about what it is NOT. An untested zone (single touch, or
    // a broken level not yet defended from the other side) must not promise
    // buying/selling interest; a zone >15% away is structure, not a trigger.
    const zoneDesc = (z) => z?.touches
      ? `tested ×${z.touches}${z.kind === 'major' ? ', higher-timeframe level' : z.kind === 'local' ? ', local swing level' : ''}`
      : null
    const zoneFar = (z) => z?.proximityPct != null && z.proximityPct > 15
      ? ` It sits ~${z.proximityPct.toFixed(0)}% from price — structural context, not a near-term trigger.`
      : ''

    const majR = indicators.majorResistance
    const majS = indicators.majorSupport

    const explain = {
      ema: ema200 == null
        ? `Only ${indicators.barCount ?? '<200'} bars of history at this timeframe — EMA200 needs 200. Try a lower timeframe.`
        : `EMA200 is ${fmt(ema200)}. Price is ${aboveEma ? 'above' : 'below'} the 200-period EMA → long-term trend is ${aboveEma ? 'up' : 'down'}.`,
      rsi: rsi == null
        ? 'RSI not available.'
        : regime
          ? `RSI is ${rsi.toFixed(2)}. ${stripRsi(scoreRsi(rsi, regime).note)}. Read in a ${regime.priceDiscovery ? 'price-discovery' : regime.trend === 'range' ? 'range' : `${regime.trend}trend`} regime.`
          : `RSI is ${rsi.toFixed(2)}. ${rsiZone === 'overbought' ? 'Overbought (>70) — momentum is strong but stretched; in a trend this reads as strength, with elevated chase risk.' : rsiZone === 'oversold' ? 'Oversold (<30) — momentum washed out; downside stretched, snap-back risk for late shorts.' : rsi >= 55 ? 'Above the 55 midline — momentum leans bullish, not yet overbought.' : rsi <= 45 ? 'Below the 45 midline — momentum leans bearish, not yet oversold.' : 'In the neutral zone — no strong momentum signal.'}`,
      stochastic: stoch == null
        ? 'Stochastic RSI not available.'
        : `Stochastic RSI is ${stoch.toFixed(2)}. ${regime
            ? (stochZone === 'overbought' ? (trendUp ? 'Above 80, band-walking with the uptrend — extension, not an automatic fade.' : 'Above 80 — momentum extended, mean-reversion risk.') : stochZone === 'oversold' ? (regime.trend === 'down' ? 'Below 20 in a downtrend — washed, but can stay washed.' : 'Below 20 — momentum washed out, watch for the snap-back.') : 'Mid-range — no acceleration signal.')
            : (stochZone === 'overbought' ? 'Above 80 — momentum is extended.' : stochZone === 'oversold' ? 'Below 20 — momentum is washed out.' : 'Mid-range — no acceleration signal.')}`,
      atr: indicators.atr == null
        ? 'ATR not available.'
        : `ATR is ${fmt(indicators.atr)} (${atrPct?.toFixed(2) ?? '—'}% of price). ${atrPct > 5 ? 'Volatility is high — expect wide swings.' : atrPct > 2 ? 'Volatility is moderate.' : 'Volatility is low — tight range.'}`,
      supply: indicators.supply
        ? indicators.supply.untested
          ? `Nearest overhead zone is ${fmt(indicators.supply.low)}–${fmt(indicators.supply.high)} — ${indicators.supply.touches === 1 ? 'a single-touch level' : 'broken support'}, untested as resistance. Treat it as a marker, not a wall, until price rejects from it.${zoneFar(indicators.supply)}`
          : `Nearest resistance is ${fmt(indicators.supply.low)}–${fmt(indicators.supply.high)}${zoneDesc(indicators.supply) ? ` (${zoneDesc(indicators.supply)})` : ''}. Expect selling pressure as price approaches this band.${zoneFar(indicators.supply)}`
        : 'No resistance zone detected above price in the loaded history.',
      demand: indicators.demand
        ? indicators.demand.untested
          ? `Nearest zone below is ${fmt(indicators.demand.low)}–${fmt(indicators.demand.high)} — ${indicators.demand.touches === 1 ? 'a single-touch level' : 'broken resistance'}, untested as support. Don't lean on it until it's defended from above.${zoneFar(indicators.demand)}`
          : `Nearest support is ${fmt(indicators.demand.low)}–${fmt(indicators.demand.high)}${zoneDesc(indicators.demand) ? ` (${zoneDesc(indicators.demand)})` : ''}. Expect buying interest as price tests this band.${zoneFar(indicators.demand)}`
        : 'No support zone detected below price in the loaded history.',
      majors: (majR || majS)
        ? [
            majR ? `Major resistance ${fmt(majR.low)}–${fmt(majR.high)} (×${majR.touches} on the higher timeframe${majR.untested ? ', untested' : ''})` : null,
            majS ? `major support ${fmt(majS.low)}–${fmt(majS.high)} (×${majS.touches}${majS.untested ? ', untested' : ''})` : null,
          ].filter(Boolean).join('; ') + '. These are the levels swing traders anchor to.'
        : 'No major higher-timeframe levels detected near price.',
      macd: macdLine == null
        ? 'MACD not available.'
        : `MACD is ${macdLine.toFixed(4)}. ${macdLine >= 0 ? 'Positive — short-term momentum is bullish.' : 'Negative — short-term momentum is bearish.'}`,
      signal: macdSignal == null
        ? 'MACD signal line not available.'
        : `Signal line at ${macdSignal.toFixed(4)}. ${macdCross === 'bullish' ? 'MACD above signal — bullish crossover in place.' : 'MACD below signal — bearish crossover in place.'}`,
      bb: !bb ? 'Bollinger Bands not available.'
        : `BB(20,2) is ${fmt(bb.lower)} / ${fmt(bb.middle)} / ${fmt(bb.upper)}. ${regime
            ? (bbPos === 'above-upper' ? (trendUp ? 'Price is riding the upper band — a band-walk, i.e. trend strength, not an automatic fade.' : 'Price is above the upper band — statistically stretched, mean-reversion risk.') : bbPos === 'below-lower' ? (regime.trend === 'down' ? 'Price is losing the lower band — trend weakness, not just oversold.' : 'Price is below the lower band — oversold within the band envelope.') : 'Price is inside the band — mean-reverting range.')
            : (bbPos === 'above-upper' ? 'Price is above the upper band — squeeze or breakout territory.' : bbPos === 'below-lower' ? 'Price is below the lower band — oversold within the band envelope.' : 'Price is inside the band — mean-reverting range.')}`,
    }

    return [
      { name: 'EMA200',         subtitle: 'Exponential Moving Average (200)', icon: 'ema',        explanation: explain.ema },
      { name: 'RSI',            subtitle: 'Relative Strength Index',          icon: 'rsi',        explanation: explain.rsi },
      { name: 'Stochastic RSI', subtitle: 'Stochastic Relative Strength',     icon: 'stochastic', explanation: explain.stochastic },
      { name: 'ATR',            subtitle: 'Average True Range',               icon: 'atr',        explanation: explain.atr },
      { name: 'Supply Zone',    subtitle: 'Nearest resistance',               icon: 'supply',     explanation: explain.supply },
      { name: 'Demand Zone',    subtitle: 'Nearest support',                  icon: 'demand',     explanation: explain.demand },
      { name: 'Major Levels',   subtitle: 'Higher-timeframe S/R',             icon: 'signal',     explanation: explain.majors },
      { name: 'MACD',           subtitle: 'Moving Average Convergence Divergence', icon: 'macd', explanation: explain.macd },
      { name: 'MACD Signal',    subtitle: 'Signal Line',                      icon: 'signal',     explanation: explain.signal },
      { name: 'Bollinger Bands',subtitle: 'BB(20, 2)',                         icon: 'ema',        explanation: explain.bb },
    ]
  }, [indicators, fmtPrice])

  if (loading && !indicators) {
    return (
      <div className="rz-te2-ai-ind">
        <div className="rz-te2-ai-ind-list">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rz-te2-ai-ind-row">
              <div className="rz-te2-ai-ind-header">
                <span className="animate-shimmer" style={{ width: 24, height: 24, borderRadius: 6 }} />
                <span className="animate-shimmer" style={{ width: 160, height: 14, borderRadius: 4 }} />
              </div>
              <p className="animate-shimmer" style={{ width: '100%', height: 38, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rz-te2-ai-ind">
      {verdict && (
        <div className="rz-te2-ai-verdict">
          <div className="rz-te2-ai-verdict-row">
            <span className="rz-te2-ai-verdict-tf mono">{verdict.shortTerm.tf}</span>
            <span className="rz-te2-ai-verdict-scope">{t('researchPro.technicals.taperindicator.shortTerm', "Short-term")}</span>
            <span className={`rz-te2-ai-verdict-pill rz-te2-ai-verdict-pill--${verdict.shortTerm.state.cls}`}>{verdict.shortTerm.state.label}</span>
            <span className="rz-te2-ai-verdict-text">{verdict.shortTerm.text}</span>
          </div>
          {verdict.trend && (
            <div className="rz-te2-ai-verdict-row">
              <span className="rz-te2-ai-verdict-tf mono">{verdict.trend.tf}</span>
              <span className="rz-te2-ai-verdict-scope">{t('researchPro.technicals.taperindicator.trend', "Trend")}</span>
              <span className={`rz-te2-ai-verdict-pill rz-te2-ai-verdict-pill--${verdict.trend.state.cls}`}>{verdict.trend.state.label}</span>
              <span className="rz-te2-ai-verdict-text">{verdict.trend.text}</span>
            </div>
          )}
          {verdict.outlook && (
            <div className="rz-te2-ai-verdict-row">
              <span className="rz-te2-ai-verdict-tf mono">{verdict.outlook.tf}</span>
              <span className="rz-te2-ai-verdict-scope">{t('researchPro.technicals.taperindicator.outlook', "Outlook")}</span>
              <span className={`rz-te2-ai-verdict-pill rz-te2-ai-verdict-pill--${verdict.outlook.state.cls}`}>{verdict.outlook.state.label}</span>
              <span className="rz-te2-ai-verdict-text">{verdict.outlook.text}</span>
            </div>
          )}
          {verdict.conflict && (
            <div className="rz-te2-ai-verdict-conflict">{verdict.conflict}</div>
          )}
        </div>
      )}
      <div className="rz-te2-ai-ind-list">
        {rows.map((ind, i) => (
          <div key={ind.name} className="rz-te2-ai-ind-row">
            <div className="rz-te2-ai-ind-header">
              <span className="rz-te2-ai-ind-badge">{indicatorIcons[ind.icon] || indicatorIcons.ema}</span>
              <span className="rz-te2-ai-ind-name">
                {ind.name}
                <span className="rz-te2-ai-ind-sub"> ({ind.subtitle})</span>
              </span>
              <div
                className="rz-te2-ai-ind-icon-wrap"
                onMouseEnter={() => showTooltip(i)}
                onMouseLeave={hideTooltip}
                onClick={() => setActiveTooltip(activeTooltip === i ? null : i)}
              >
                <InfoIcon size={16} />
                {activeTooltip === i && (
                  <div className="rz-te2-ai-ind-tooltip">
                    <p>{ind.explanation}</p>
                  </div>
                )}
              </div>
            </div>
            <p className="rz-te2-ai-ind-text">{ind.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// CATALYSTS — brain intel ledger context for the TA read (best-effort)
// ────────────────────────────────────────────────────────────────────────────────

// Compact relative-time without the i18n dep (this block is best-effort chrome).
function relTime(ts) {
  const ms = typeof ts === 'number' ? (ts < 2e12 ? ts * (ts < 2e10 ? 1000 : 1) : ts) : Date.parse(ts)
  if (!Number.isFinite(ms)) return null
  const diff = Date.now() - ms
  if (diff < 0) return null
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * News-impact context next to the chart read: up to 3 intel items from the
 * brain ledger (GET /v1/brain/lookup?key=SYM via spectreDataApi). STRICTLY
 * best-effort — any error / 404 / empty payload renders NOTHING.
 */
const TechnicalsCatalysts = React.memo(({ sym }) => {
  const { t } = useTranslation()
  const [items, setItems] = useState([])

  useEffect(() => {
    let cancelled = false
    setItems([])
    if (!sym) return undefined
    getBrainLookup(sym)
      .then((data) => {
        if (cancelled || !data) return
        const raw = Array.isArray(data) ? data
          : Array.isArray(data.items) ? data.items
          : Array.isArray(data.intel) ? data.intel
          : Array.isArray(data.data) ? data.data
          : []
        const cleaned = raw
          .map((it) => ({
            headline: it?.headline || it?.title || it?.summary || null,
            category: it?.category || it?.cat || null,
            obs: Number(it?.observation_count ?? it?.obs_count ?? it?.observations) || null,
            firstSeen: it?.first_detected ?? it?.first_seen ?? it?.created_at ?? null,
          }))
          .filter((it) => it.headline)
          .slice(0, 3)
        if (cleaned.length) setItems(cleaned)
      })
      .catch(() => { /* best-effort: render nothing */ })
    return () => { cancelled = true }
  }, [sym])

  if (!items.length) return null

  return (
    <SectionShell
      id="ta-catalysts"
      label={t('researchPro.technicals.technicalscatalysts.label', "TECHNICALS · CATALYSTS")}
      title={t('researchPro.technicals.technicalscatalysts.title', "Catalysts")}
      subtitle={t('researchPro.technicals.technicalscatalysts.subtitle', "News-impact context from the intel ledger — read the tape with its headlines")}
      collapsible
    >
      <div className="rz-te2-catalysts">
        {items.map((it, i) => (
          <div key={i} className="rz-te2-catalyst-row">
            {it.category && <span className="rz-te2-catalyst-cat">{String(it.category).replace(/_/g, ' ')}</span>}
            <span className="rz-te2-catalyst-headline">{it.headline}</span>
            <span className="rz-te2-catalyst-meta mono">
              {it.obs != null ? `×${it.obs} obs` : ''}
              {it.obs != null && relTime(it.firstSeen) ? ' · ' : ''}
              {relTime(it.firstSeen) || ''}
            </span>
          </div>
        ))}
      </div>
    </SectionShell>
  )
})

// ────────────────────────────────────────────────────────────────────────────────
// TECHNICALS TAB — Main export
// ────────────────────────────────────────────────────────────────────────────────

// Map chart timeframe id → Codex getBars resolution string
const CHART_TF_TO_RESOLUTION = {
  '5M':  '5',
  '15M': '15',
  '30M': '30',
  '1H':  '60',
  '4H':  '240',
  '12H': '720',
  '1D':  '1D',
  '1W':  '1W',
}

// Default chart + indicator timeframe (balances noise vs. freshness).
const DEFAULT_TF_ID = '4H'

function TechnicalsTab({
  sym, td, tokenColor,
  fmtPrice, dayMode,
  fundingRates, longShortRatio, openInterest,
  activeTokenInfo,
  tokenProfile = null,
  fundamentalsGrades = null,
  assetClass = null,
}) {
  const { t } = useTranslation()
  const isStock = assetClass === 'stock'
  // Timeframe is LIFTED: the chart, its S/R zones, and the indicator panel all
  // follow the same selection, so every number below matches what's drawn.
  const [timeframe, setTimeframe] = useState(DEFAULT_TF_ID)

  // Fullscreen is on the WHOLE tab (not just the chart) so the expand button
  // shows the chart AND the thesis / indicators / AI below it — was "50% of the
  // page" because it only fullscreened the 800px chart with dead space beneath.
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef(null)
  const handleToggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])
  useEffect(() => {
    const onFSChange = () => { if (!document.fullscreenElement) setIsFullscreen(false) }
    document.addEventListener('fullscreenchange', onFSChange)
    return () => document.removeEventListener('fullscreenchange', onFSChange)
  }, [])

  // Real indicators from Codex/Binance OHLCV. NOTE: tokenProfile.ai_insight
  // (the upstream daily-model sentence) is intentionally NOT shown here — it
  // carried no timeframe label and contradicted the 4H panel. The verdict
  // strip in TAPerIndicatorSection replaces it, computed from these values.
  const keyLevels = tokenProfile?.token_details?.key_levels || null

  const { indicators, bars, loading: indicatorsLoading, asOf, isSeed } = useKlineIndicators({
    symbol: activeTokenInfo?.symbol || sym,
    address: activeTokenInfo?.address || null,
    networkId: activeTokenInfo?.networkId || 1,
    cgId: activeTokenInfo?.cgId || null,
    binancePair: activeTokenInfo?.binancePair || null,
    resolution: CHART_TF_TO_RESOLUTION[timeframe] || '240',
    keyLevels,
    assetClass,
  })

  // Honest freshness for the live dots: green ONLY when the panel's bars
  // resolved from the network within 2× the per-resolution refresh cadence;
  // seed-painted or aged data shows amber + "as of HH:MM". A light 30s tick
  // re-evaluates so a stalled feed ages out visibly without a re-fetch.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setNowTick(Date.now()) }, 30_000)
    return () => clearInterval(t)
  }, [])
  const freshness = useMemo(() => {
    const cadence = refreshCadenceMs(CHART_TF_TO_RESOLUTION[timeframe] || '240')
    const live = !isSeed && asOf != null && (nowTick - asOf) <= cadence * 2
    const asOfLabel = asOf != null
      ? new Date(asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null
    return { live, asOfLabel }
  }, [asOf, isSeed, timeframe, nowTick])

  // Multi-timeframe read (15m → 1W) for the Trade Thesis matrix + confluence.
  // Reuses the same deduped/cached bar fetcher, so this is mostly warm.
  const { mtf } = useMtfThesis({
    symbol: activeTokenInfo?.symbol || sym,
    networkId: activeTokenInfo?.networkId || 1,
    cgId: activeTokenInfo?.cgId || null,
    binancePair: activeTokenInfo?.binancePair || null,
    assetClass,
  })

  // Buy/sell tax + honeypot (on-chain tokens only) — best-effort from the dossier.
  const safety = useTokenSafety({
    address: activeTokenInfo?.address || null,
    networkId: activeTokenInfo?.networkId || null,
  })

  // Chart identity — for stocks, stamp isStock + exchange onto the token so
  // the TradingViewAdvanced datafeed takes its Yahoo branch (activeTokenInfo
  // from the data hook is the bare stock identity without those flags).
  const chartTokenInfo = useMemo(() => {
    if (!isStock) return activeTokenInfo
    return {
      ...(activeTokenInfo || {}),
      symbol: activeTokenInfo?.symbol || sym,
      name: td?.name || sym,
      isStock: true,
      exchange: td?.exchange || null,
    }
  }, [isStock, activeTokenInfo, sym, td?.name, td?.exchange])

  // Zones payload for the chart: detected local + major S/R from the SAME
  // series the panel uses, plus the classic period pivot as reference.
  const srZones = useMemo(() => {
    if (!indicators?.sr || !bars?.length) return null
    const pivotPeriod = getPivotPeriod(timeframe)
    const hlc = getPreviousPeriodHLC(bars, pivotPeriod)
    const pivots = hlc ? calculatePivotPoints(hlc.high, hlc.low, hlc.close) : null
    const first = bars[0].t
    const last = bars[bars.length - 1].t
    const majorRes = majorResolutionFor(CHART_TF_TO_RESOLUTION[timeframe])
    return {
      local: indicators.sr.local,
      major: indicators.sr.major,
      pivot: pivots?.pivot ?? null,
      pivotPeriod,
      majorSourceLabel: majorRes === '1W' ? '1W' : majorRes === '1D' ? '1D' : timeframe,
      range: { from: first, to: last + Math.max(1, last - first) * 0.35 },
    }
  }, [indicators?.sr, bars, timeframe])

  // TA-reliability caveat: on-chain tokens — and especially sub-$50M caps —
  // trade on flows, wallets and liquidity events far more than on chart
  // structure. Levels/indicators still render, but the read gets a health
  // warning instead of implying CEX-major reliability.
  const mcap = Number(td?.marketCap ?? td?.mcap) || null
  // Real market-class read (mcap/rank/venue via classifyToken), not a symbol
  // lookup — so a clone ticker that collides with the MAJOR_SYMBOLS routing
  // list (a Base "DOT", a scam "SUI") is still treated as the on-chain
  // microcap it is, and gets the reliability caveat instead of the majors
  // read. isMajorToken stays in use elsewhere for DATA-SOURCE ROUTING only.
  const tokenClass = useMemo(() => (isStock ? null : classifyToken({
    sym,
    address: activeTokenInfo?.address,
    binancePair: activeTokenInfo?.binancePair,
    rank: td?.rank ?? td?.market_cap_rank ?? activeTokenInfo?.rank ?? null,
    marketCap: mcap,
    categories: td?.categories,
    primaryCategory: td?.category ?? td?.primaryCategory,
  })), [isStock, sym, activeTokenInfo?.address, activeTokenInfo?.binancePair, activeTokenInfo?.rank, td?.rank, td?.market_cap_rank, mcap, td?.categories, td?.category, td?.primaryCategory])
  const isOnchainToken = !isStock && !!activeTokenInfo?.address && !(tokenClass?.isMacro)
  const isSmallCap = !isStock && ((mcap != null && mcap > 0 && mcap < 50_000_000) || tokenClass?.isSmallCap === true)
  const isSmallCapStock = isStock && mcap != null && mcap > 0 && mcap < 300_000_000
  const showTaCaveat = isSmallCap || isOnchainToken || isSmallCapStock
  const mcapLabel = mcap != null
    ? (mcap >= 1e9 ? `$${(mcap / 1e9).toFixed(1)}B` : `$${(mcap / 1e6).toFixed(1)}M`)
    : null

  // Market structure fed to the thesis. Crypto: the ".36–.38 is a thin band,
  // 5% tax" intelligence (liquidity / holders / tax / honeypot). Stocks: the
  // equity-native facts (beta / 52-week range / avg $ turnover / earnings
  // date) that buildEquityStructure renders in the same slot — no crypto
  // vocabulary crosses the assetClass line in either direction.
  const price = Number(td?.price) || null
  const ath = Number(td?.ath) || null
  // Quantize price + mcap for the thesis memo (4 sig-figs, ~0.1%). Both tick on
  // every price update; without quantizing, marketStructure got a fresh identity
  // each tick and rebuilt the whole qualitative trade thesis (buildCases /
  // buildLenses / buildRebound). 0.1% is invisible in the prose but stops the churn.
  const priceQ = price != null ? Number(price.toPrecision(4)) : null
  const mcapQ = mcap != null ? Number(mcap.toPrecision(4)) : null
  const marketStructure = useMemo(() => ({
    assetClass,
    mcap: mcapQ, mcapLabel, isSmallCap, isOnchain: isOnchainToken,
    tokenClass, classLabel: tokenClass?.label ?? null,
    price: priceQ,
    liquidity: isStock ? null : (Number(td?.liquidity) || null),
    holders: isStock ? null : (Number(td?.holders) || null),
    buyTax: isStock ? null : (safety?.buyTax ?? td?.buyTax ?? td?.safety?.buyTax ?? null),
    sellTax: isStock ? null : (safety?.sellTax ?? td?.sellTax ?? td?.safety?.sellTax ?? null),
    isHoneypot: isStock ? false : (safety?.isHoneypot ?? td?.isHoneypot ?? td?.safety?.isHoneypot ?? false),
    fromAthPct: (ath && priceQ && ath > 0) ? ((priceQ - ath) / ath) * 100 : null,
    // Equity fields (null for crypto)
    beta: isStock ? (Number(td?.beta) || null) : null,
    week52High: isStock ? (Number(td?.week52High) || null) : null,
    week52Low: isStock ? (Number(td?.week52Low) || null) : null,
    avgVolumeShares: isStock ? (Number(td?.avgVolume) || null) : null,
    earningsDate: isStock ? (td?.earningsDate || null) : null,
    targetMeanPrice: isStock ? (Number(td?.targetMeanPrice) || null) : null,
    recommendationKey: isStock ? (td?.recommendationKey || null) : null,
    analystCount: isStock ? (Number(td?.analystCount) || null) : null,
  }), [assetClass, isStock, mcapQ, mcapLabel, isSmallCap, isOnchainToken, tokenClass, td?.liquidity, td?.holders, td?.buyTax, td?.sellTax, td?.isHoneypot, td?.safety, td?.beta, td?.week52High, td?.week52Low, td?.avgVolume, td?.earningsDate, td?.targetMeanPrice, td?.recommendationKey, td?.analystCount, safety, ath, priceQ])

  // Project vitality — is the team still shipping? Feeds the rebound fusion so a
  // deep-drawdown chart that's turning up can read as accumulation, not dead-cat.
  const vitality = useMemo(() => {
    const g = fundamentalsGrades
    if (!g) return null
    const score = typeof g.overallScore === 'number' ? g.overallScore : null
    const catalysts = Array.isArray(g.catalysts) ? g.catalysts.length : 0
    let level = 'flat'
    if (score != null) level = score >= 65 ? 'up' : score <= 40 ? 'down' : 'flat'
    else if (typeof g.overall === 'string') {
      const first = g.overall[0]?.toUpperCase()
      level = (first === 'A' || first === 'B') ? 'up' : (first === 'D' || first === 'F') ? 'down' : 'flat'
    }
    if (catalysts >= 2 && level === 'flat') level = 'up'
    return { level, catalysts }
  }, [fundamentalsGrades])

  return (
    <div
      className={`rz-te2-container${isFullscreen ? ' rz-te2-container--fs' : ''}`}
      ref={containerRef}
    >

      {/* Technical Chart — NOT collapsible. The chart is the flagship element of
          this tab; the old `collapsible` made the whole header row a click target
          that wrote a GLOBAL, per-section localStorage flag (rz-collapsed-sections
          ['ta-chart']), so a single accidental click collapsed the chart for every
          token + every reload — read as "the chart auto-closes". Always-open. */}
      <SectionShell
        id="ta-chart"
        label={t('researchPro.technicals.technicalstab.label', "TECHNICALS · CHART")}
        title={t('researchPro.technicals.technicalstab.title', "Technical Chart")}
        subtitle={`${isStock
          ? 'TradingView · Yahoo bars · S/R zones + indicators'
          : 'TradingView · Binance / Codex bars · S/R zones + indicators'}${!freshness.live && freshness.asOfLabel ? ` · as of ${freshness.asOfLabel}` : ''}`}
        liveBadge={freshness.live}
      >
        {/* ONE chart for both classes — the self-hosted TV with our S/R zone
            drawing + indicator studies. Stocks get the same overlays as
            crypto (Sunny 07-06: "where is the ta chart with support and
            overlays emas"); the datafeed's isStock branch serves Yahoo bars. */}
        <TechnicalChart
          sym={sym}
          td={td}
          dayMode={dayMode}
          activeTokenInfo={chartTokenInfo}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          srZones={srZones}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        />
      </SectionShell>

      {/* Reliability caveat — on-chain / small-cap tokens */}
      {showTaCaveat && (
        <div className="rz-te2-ta-caveat" role="note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            {isSmallCapStock
              ? `Small-cap stock${mcapLabel ? ` (${mcapLabel} market cap)` : ''}: wider spreads, thinner books and news gaps make intraday levels less reliable at this size — treat zones as context and expect gap-throughs on headlines.`
              : isSmallCap
              ? `Small-cap token${mcapLabel ? ` (${mcapLabel} market cap)` : ''}: technical analysis is significantly less reliable at this size — thin liquidity means a single wallet, LP move or listing can invalidate any level or indicator in one candle. Weight holder distribution, liquidity depth and flows over TA.`
              : 'On-chain token: DEX price action respects chart structure less cleanly than deep CEX order books — treat these indicators and zones as context, not triggers.'}
          </span>
        </div>
      )}

      {/* Catalysts — best-effort intel-ledger context; renders nothing on miss */}
      <TechnicalsCatalysts sym={activeTokenInfo?.symbol || sym} />

      {/* Trade Thesis — multi-timeframe confluence + bull/bear + microcap + rebound */}
      <TradeThesisSection
        indicators={indicators}
        mtf={mtf}
        marketStructure={marketStructure}
        vitality={vitality}
        loading={indicatorsLoading}
        timeframe={timeframe}
        fmtPrice={fmtPrice}
      />

      {/* Two-column: Indicators List + TA AI Analysis */}
      <div className="rz-te2-two-col">
        <div className="rz-te2-two-col-left">
          {/* Compact signal count — lives with the indicators it summarizes
              (was a full-width hero right under the chart; too big, too high) */}
          <SignalSummary indicators={indicators} loading={indicatorsLoading} tfLabel={timeframe} compact freshness={freshness} />
          <SectionShell
            id="ta-indicators"
            label={`TECHNICALS · INDICATORS (${timeframe})`}
            title={t('researchPro.technicals.technicalstab.title2', "Technical Indicators")}
            subtitle={`Computed on ${timeframe} bars`}
            collapsible
          >
            <TechnicalIndicatorsList
              indicators={indicators}
              loading={indicatorsLoading}
              fmtPrice={fmtPrice}
              resolution={timeframe}
            />
          </SectionShell>
        </div>
        <div className="rz-te2-two-col-right">
          <SectionShell
            id="ta-ai"
            label={t('researchPro.technicals.technicalstab.label2', "TECHNICALS · AI ANALYSIS")}
            title={t('researchPro.technicals.technicalstab.title3', "TA AI Analysis")}
            subtitle={t('researchPro.technicals.technicalstab.subtitle', "Per-indicator interpretation on real values")}
            aiBadge
            collapsible
          >
            <TAPerIndicatorSection
              indicators={indicators}
              loading={indicatorsLoading}
              fmtPrice={fmtPrice}
              timeframe={timeframe}
            />
          </SectionShell>
        </div>
      </div>

      {/* Macro context — equities read the index tape (SPY/QQQ/VIX/session);
          crypto majors read the crypto tape (BTC trend/dominance/funding) */}
      {isStock ? (
        <EquityMacroSection sym={sym} td={td} />
      ) : (
        <MacroAnalysisSection
          sym={sym}
          td={td}
          activeTokenInfo={activeTokenInfo}
          fundingRates={fundingRates}
          openInterest={openInterest}
          longShortRatio={longShortRatio}
          fmtPrice={fmtPrice}
        />
      )}

      {/* Standing disclaimer */}
      <p className="rz-te2-ta-disclaimer">
        Automated technical read computed from live market data — not financial advice.
        Indicators and levels describe the current tape, not future outcomes; setups vary
        by entry, size, horizon and liquidity. Do your own research and manage risk.
      </p>
    </div>
  )
}

// Compare only the fields TechnicalsTab actually consumes — stops re-renders
// caused by parent passing fresh object identities for td/activeTokenInfo.
function areTechnicalsEqual(prev, next) {
  if (prev.sym !== next.sym) return false
  if (prev.dayMode !== next.dayMode) return false
  if (prev.fmtPrice !== next.fmtPrice) return false
  const a = prev.td || {}
  const b = next.td || {}
  if (a.price !== b.price) return false
  if (a.high24h !== b.high24h) return false
  if (a.low24h !== b.low24h) return false
  if (a.ath !== b.ath) return false
  const ai = prev.activeTokenInfo || {}
  const bi = next.activeTokenInfo || {}
  if (ai.symbol !== bi.symbol) return false
  if (ai.address !== bi.address) return false
  if (ai.networkId !== bi.networkId) return false
  if (ai.cgId !== bi.cgId) return false
  if (ai.binancePair !== bi.binancePair) return false
  if (prev.tokenProfile !== next.tokenProfile) return false
  if (prev.fundamentalsGrades !== next.fundamentalsGrades) return false
  // Micro-structure inputs the thesis reads off `td` (drift slowly; price ticks
  // already force a refresh, this catches liquidity/holders/safety updates too).
  if (a.liquidity !== b.liquidity) return false
  if (a.holders !== b.holders) return false
  // classifyToken inputs (market-class read for caveat + thesis class label)
  if (a.marketCap !== b.marketCap) return false
  if (a.rank !== b.rank) return false
  // Equity inputs (assetClass + the fields buildEquityStructure reads)
  if (prev.assetClass !== next.assetClass) return false
  if (a.beta !== b.beta) return false
  if (a.week52High !== b.week52High) return false
  if (a.week52Low !== b.week52Low) return false
  if (a.avgVolume !== b.avgVolume) return false
  if (a.earningsDate !== b.earningsDate) return false
  if (a.exchange !== b.exchange) return false
  if (a.targetMeanPrice !== b.targetMeanPrice) return false
  if (a.recommendationKey !== b.recommendationKey) return false
  // Intel deriv-bundle props: they now load ON tab open (mode:'deriv' fetch
  // starts when the tab enables intel), so the first payload lands AFTER
  // mount — without these identity checks the memo held the DEFAULTS
  // (Long/Short 1.00, funding 0) until the next unrelated td price tick.
  if (prev.fundingRates !== next.fundingRates) return false
  if (prev.longShortRatio !== next.longShortRatio) return false
  if (prev.openInterest !== next.openInterest) return false
  return true
}

export default React.memo(TechnicalsTab, areTechnicalsEqual)
