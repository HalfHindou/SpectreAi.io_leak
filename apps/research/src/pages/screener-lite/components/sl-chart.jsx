import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createSpectreChart } from '@/chart/engine/createSpectreChart'
import { createPriceSeries, createVolumeSeries, configureVolumeScale, formatBarsForSeries, formatVolumeData } from '@/chart/engine/seriesFactory'
import { getBars } from '@/services/codexApi'
import { getStockCandles } from '@/services/stockApi'

// Yahoo range per TV resolution for the STOCK lane - deeper than the default
// first-paint range because this chart has no history paging: what it fetches
// is all a scroll-left can ever show. Kept under Yahoo's per-interval ceiling
// (1m: 7d, 5m-30m: 60d, 1h: 730d).
const STOCK_DEEP_RANGE = { '1': '5d', '5': '1mo', '15': '1mo', '30': '1mo', '60': '6mo', '240': '1y', '720': '1y', '1D': '5y', '1W': 'max' }
import { num } from './sl-helpers'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import ChartWatermark from '@/components/chart-watermark'

// TradingView Lightweight Charts (TV's official library) via the app's shared
// chart engine — renders reliably, themes light/dark, and gives candle / line /
// area + volume. On-chain tokens chart by CONTRACT (fine-grained TFs); CG-listed
// majors chart by cgId (the CG-OHLC tier only carries 1H/1D, so intraday TFs
// honestly show an empty state for those).
const TF = [
  { id: '1m', res: '1', sec: 60 },
  { id: '5m', res: '5', sec: 300 },
  { id: '15m', res: '15', sec: 900 },
  { id: '1H', res: '60', sec: 3600 },
  { id: '4H', res: '240', sec: 14400 },
  { id: '1D', res: '1D', sec: 86400 },
]
const TYPES = [
  { id: 'candle', label: 'Candles' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
]
const TF_KEY = 'sl-chart-tf'
const TYPE_KEY = 'sl-chart-type'

function normalizeBars(raw) {
  if (!Array.isArray(raw)) return []
  const out = raw.map((b) => {
    let t = Number(b.t ?? b.time ?? b.timestamp)
    if (t > 1e12) t = Math.floor(t / 1000) // ms → s
    return { time: t, open: num(b.o ?? b.open), high: num(b.h ?? b.high), low: num(b.l ?? b.low), close: num(b.c ?? b.close), volume: num(b.v ?? b.volume) }
  }).filter((b) => b.time > 0 && b.close > 0)
  out.sort((a, b) => a.time - b.time)
  const seen = new Map()
  for (const b of out) seen.set(b.time, b)
  return [...seen.values()]
}

export default function SLChart({ token, isLight, height = 440, onMeta }) {
  const wrapRef = useRef(null)
  const chartRef = useRef(null)
  const priceRef = useRef(null)
  const volRef = useRef(null)
  const barsRef = useRef([])
  const [tf, setTf] = useState(() => { try { const s = localStorage.getItem(TF_KEY); return TF.find((x) => x.id === s) || TF[3] } catch { return TF[3] } })
  const [type, setType] = useState(() => { try { return TYPES.some((x) => x.id === localStorage.getItem(TYPE_KEY)) ? localStorage.getItem(TYPE_KEY) : 'candle' } catch { return 'candle' } })
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)


  const isStock = !!token?.isStock
  const cgId = token?.cgId || token?.cg_id || null
  // A BARE TICKER is only a safe key when something vouches for the identity:
  // a mapped major (clean Binance lane) or a known CG id (the `ticker-cg` tier
  // charts by ID). For anything else the ticker resolves to whichever twin the
  // upstream likes best - the EYE/DEALER/GME class - so we would rather draw
  // nothing than another asset's tape.
  const sym = String(token?.symbol || '').toUpperCase()
  const query = isStock
    ? token?.symbol
    : (token?.address || (cgId || SYMBOL_TO_COINGECKO_ID[sym] ? sym : null))

  // Which timeframes this token can ACTUALLY be served at. On-chain tokens
  // chart by contract and get everything; stocks get everything from Yahoo;
  // but a CG-listed coin with no contract rides the CG-OHLC tier, which only
  // carries hourly and daily - so 1m/5m/15m were guaranteed to render "No
  // chart data" forever. Worse, the chosen timeframe is remembered globally,
  // so one visit to an on-chain token at 5m left every major permanently
  // empty on open (founder 2026-08-12: "check cinema mode on other tokens").
  // Offer only what the lane can serve rather than showing a dead chart.
  const intradayOk = isStock || !!token?.address
  const tfOptions = useMemo(() => (intradayOk ? TF : TF.filter((f) => f.sec >= 3600)), [intradayOk])
  // Snap a remembered sub-hourly timeframe up to 1H when this token can't
  // serve it, instead of opening on a chart that can only ever be blank.
  useEffect(() => {
    if (tfOptions.some((f) => f.id === tf.id)) return
    setTf(tfOptions.find((f) => f.id === '1H') || tfOptions[0])
  }, [tfOptions, tf])

  // (Re)build chart + series on theme or chart-type change; re-apply last bars.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const { chart, dispose } = createSpectreChart(el, { isDayMode: isLight, height })
    const price = createPriceSeries(chart, type, isLight)
    const vol = createVolumeSeries(chart, isLight)
    configureVolumeScale(chart)
    chartRef.current = chart; priceRef.current = price; volRef.current = vol
    if (barsRef.current.length) {
      try {
        price.setData(formatBarsForSeries(barsRef.current, type))
        vol.setData(formatVolumeData(barsRef.current, isLight))
        chart.timeScale().fitContent()
      } catch (_) { /* ignore */ }
    }
    return () => { try { dispose() } catch (_) { /* */ } chartRef.current = null; priceRef.current = null; volRef.current = null }
  }, [isLight, type, height])

  // Fetch bars on token / timeframe change.
  useEffect(() => {
    if (!query) return undefined
    let cancelled = false
    setLoading(true)
    setEmpty(false)
    // CLEAR the previous token's candles/scale immediately — otherwise a token
    // whose intraday bars come back empty (common for CG-listed majors) keeps
    // showing the last token's price series (e.g. BNB under BTC's $65k axis).
    barsRef.current = []
    try { priceRef.current?.setData([]); volRef.current?.setData([]) } catch (_) { /* */ }
    const now = Math.floor(Date.now() / 1000)
    const from = now - tf.sec * 240
    ;(isStock ? getStockCandles(query, tf.res, from, now, { range: STOCK_DEEP_RANGE[tf.res] }) : getBars(query, tf.res, from, now, token?.networkId || 1, cgId))
      .then((res) => {
        if (cancelled) return
        const bars = normalizeBars(res?.getBars ?? res?.bars)
        barsRef.current = bars
        setEmpty(bars.length === 0)
        if (bars.length) {
          onMeta?.({ lastPrice: bars[bars.length - 1].close })
          if (priceRef.current) {
            try {
              priceRef.current.setData(formatBarsForSeries(bars, type))
              volRef.current?.setData(formatVolumeData(bars, isLight))
              // Open on the last ~240 candles; the deeper tape stays behind
              // for a scroll-left, instead of fitContent squeezing five days
              // of minute bars into one unreadable screen.
              if (bars.length > 300) chartRef.current?.timeScale().setVisibleLogicalRange({ from: bars.length - 240, to: bars.length + 6 })
              else chartRef.current?.timeScale().fitContent()
            } catch (_) { /* */ }
          }
        } else {
          try { priceRef.current?.setData([]); volRef.current?.setData([]) } catch (_) { /* */ }
        }
      })
      .catch(() => {
        if (!cancelled) {
          barsRef.current = []; setEmpty(true)
          try { priceRef.current?.setData([]); volRef.current?.setData([]) } catch (_) { /* */ }
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, token?.networkId, cgId, tf])

  const pickTf = (t) => { setTf(t); setEmpty(false); try { localStorage.setItem(TF_KEY, t.id) } catch { /* */ } }
  const pickType = (id) => { setType(id); try { localStorage.setItem(TYPE_KEY, id) } catch { /* */ } }

  return (
    <div className="sl-chartx-wrap">
      <div className="sl-chartx-bar">
        <div className="lite-look-toggle sl-chartx-tf" role="tablist" aria-label="Timeframe">
          {tfOptions.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={tf.id === f.id} className={`lite-look-btn${tf.id === f.id ? ' active' : ''}`} onClick={() => pickTf(f)}>{f.id}</button>
          ))}
        </div>
        <div className="lite-look-toggle sl-chartx-type" role="tablist" aria-label="Chart type">
          {TYPES.map((ty) => (
            <button key={ty.id} type="button" role="tab" aria-selected={type === ty.id} className={`lite-look-btn${type === ty.id ? ' active' : ''}`} onClick={() => pickType(ty.id)} title={ty.label}>
              {ty.id === 'candle'
                ? <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="8" width="3.5" height="8" rx="0.5" /><path d="M6.75 5v3M6.75 16v3" /><rect x="15" y="6" width="3.5" height="7" rx="0.5" /><path d="M16.75 4v2M16.75 13v3" /></svg>
                : ty.id === 'line'
                  ? <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15l5-6 4 4 7-8" /></svg>
                  : <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 15l5-6 4 4 7-8v9H4z" /></svg>}
            </button>
          ))}
        </div>
      </div>
      <div className="sl-chartx spectre-wm-host" style={{ height }} ref={wrapRef}>
        {!query && (
          <div className="sl-chartx-nodata">
            No chart for {sym || 'this token'} yet.
            <br />
            <span>We could not identify which coin this ticker is.</span>
          </div>
        )}
        {query && empty && !loading && (
          <div className="sl-chartx-nodata">
            No chart data at {tf.id}.
            <br />
            <span>{intradayOk ? 'Try 1H or 1D.' : 'This coin charts hourly and daily.'}</span>
          </div>
        )}
        {loading && <div className="sl-chartx-loading" />}
        <ChartWatermark />
      </div>
    </div>
  )
}
