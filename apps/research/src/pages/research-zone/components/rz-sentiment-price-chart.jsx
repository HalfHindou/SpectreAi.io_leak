/**
 * RZ Sentiment x Price — two-mode terminal chart.
 *
 *   OVERLAY     price line/area (full height) + a crowd-sentiment HEAT RIBBON
 *               under it (green where the crowd leans bull, red where bear).
 *               Confirm/diverge at a glance: price up over a green ribbon =
 *               confirmed; up over red = the crowd isn't with it.
 *
 *   DIVERGENCE  one oscillator = where the crowd sits vs where PRICE sits in its
 *               range. Above 0 (green) = crowd more bullish than price action →
 *               attention leading (accumulation / front-run). Below 0 (red) =
 *               price ahead of the crowd → distribution / exit-liquidity. Price
 *               drawn faint for context.
 *
 * Data: mindshare v2 history (5-min LLM-classified snapshots) resampled to even
 * time buckets + light EMA; CoinGecko market_chart for price. Holes render as
 * quiet dotted bridges, never faked across.
 */
import React, { useState, useMemo, useRef, useCallback, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import SpectreLoader from '@/components/spectre-loader'
import { useCurrency } from '@/hooks/useCurrency'
import useSentimentPriceSeries from '../data/useSentimentPriceSeries'
import './rz-sentiment-engine.css'

const H = 360
const PAD = { top: 16, right: 48, bottom: 26, left: 56 }
const TF_MS = { '24h': 24 * 3600e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 }
const TFS = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
]
const MODES = [
  { key: 'overlay', label: 'Overlay' },
  { key: 'divergence', label: 'Divergence' },
]

/* Catmull-Rom -> cubic bezier path (house smoothing, matches xd-charts) */
function smoothPath(pts, tension = 0.32) {
  if (!pts.length) return ''
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
  }
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

function downsample(arr, max = 480) {
  if (arr.length <= max) return arr
  const stride = Math.ceil(arr.length / max)
  const out = []
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i])
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1])
  return out
}

function nearestIdx(arr, t, key = 't') {
  if (!arr.length) return -1
  let lo = 0
  let hi = arr.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (arr[mid][key] < t) lo = mid
    else hi = mid
  }
  return t - arr[lo][key] <= arr[hi][key] - t ? lo : hi
}

function fmtTick(t, tf) {
  const d = new Date(t)
  if (tf === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtAxisPrice(v, step = 0) {
  if (!Number.isFinite(v)) return ''
  if (v >= 1e9) return `${(v / 1e9).toFixed(step >= 1e9 ? 1 : 2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(step >= 1e6 ? 1 : 2)}M`
  if (v >= 1e3) {
    if (step >= 500) return `${(v / 1e3).toFixed(1)}K`
    return Math.round(v).toLocaleString('en-US')
  }
  if (step > 0) {
    const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step)) + 1))
    return v.toFixed(decimals)
  }
  if (v >= 100) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.01) return v.toFixed(4)
  return v.toPrecision(3)
}

/* Resample to even time buckets (mean per bucket) BEFORE smoothing. */
function resampleBuckets(pts, bucketMs) {
  if (pts.length < 3) return pts
  const buckets = new Map()
  for (const p of pts) {
    const key = Math.floor(p.t / bucketMs)
    let b = buckets.get(key)
    if (!b) { b = { t: key * bucketMs + bucketMs / 2, sum: 0, n: 0, bull: 0, bear: 0, nb: 0 }; buckets.set(key, b) }
    b.sum += p.v; b.n += 1
    if (Number.isFinite(p.bull)) { b.bull += p.bull; b.bear += p.bear || 0; b.nb += 1 }
  }
  return [...buckets.values()]
    .sort((a, b) => a.t - b.t)
    .map((b) => ({ t: b.t, v: b.sum / b.n, bull: b.nb ? b.bull / b.nb : null, bear: b.nb ? b.bear / b.nb : null }))
}

function emaSeries(pts, period) {
  if (pts.length < 3 || period <= 1) return pts
  const k = 2 / (period + 1)
  let v = pts[0].v
  return pts.map((p) => {
    v = p.v * k + v * (1 - k)
    return { ...p, v }
  })
}

function segmentByGaps(pts, gapMs) {
  if (pts.length < 2) return [pts]
  const segments = []
  let cur = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > gapMs) {
      if (cur.length) segments.push(cur)
      cur = []
    }
    cur.push(pts[i])
  }
  if (cur.length) segments.push(cur)
  return segments
}

const TF_PARAMS = {
  '24h': { bucketMs: 15 * 60e3, emaPeriod: 4, gapMs: 60 * 60e3 },
  '7d': { bucketMs: 2 * 3600e3, emaPeriod: 4, gapMs: 7 * 3600e3 },
  '30d': { bucketMs: 6 * 3600e3, emaPeriod: 4, gapMs: 20 * 3600e3 },
}

/* Trailing-window divergence read (drives the header pill in both modes). */
function computeDivergence(pricePts, sentPts, tf) {
  if (pricePts.length < 8 || sentPts.length < 8) return null
  const tEnd = Math.max(pricePts[pricePts.length - 1].t, sentPts[sentPts.length - 1].t)
  const span = TF_MS[tf]
  const tStart = tEnd - span * 0.33
  const pWin = pricePts.filter((p) => p.t >= tStart)
  const sWin = sentPts.filter((p) => p.t >= tStart)
  if (pWin.length < 4 || sWin.length < 4) return null

  const pMove = ((pWin[pWin.length - 1].p - pWin[0].p) / pWin[0].p) * 100
  const sMove = sWin[sWin.length - 1].v - sWin[0].v
  const pThresh = { '24h': 2, '7d': 5, '30d': 10 }[tf]
  const sThresh = { '24h': 3, '7d': 5, '30d': 7 }[tf]
  const pUp = pMove >= pThresh
  const pDown = pMove <= -pThresh
  const sUp = sMove >= sThresh
  const sDown = sMove <= -sThresh

  let key = null
  if (sUp && !pUp && !pDown) key = 'attention-leads'
  else if (pUp && sDown) key = 'no-confirm'
  else if (pUp && sUp) key = 'confirmed-up'
  else if (pDown && sDown) key = 'capitulation'
  else if (pDown && sUp) key = 'dip-bid'
  if (!key) return { key: 'in-sync', label: 'In sync', tone: 'neutral', pMove, sMove }

  const META = {
    'attention-leads': { label: 'Crowd leading price', tone: 'info' },
    'no-confirm': { label: 'Price up, crowd not confirming', tone: 'warn' },
    'confirmed-up': { label: 'Move confirmed by crowd', tone: 'bull' },
    capitulation: { label: 'Crowd capitulating with price', tone: 'bear' },
    'dip-bid': { label: 'Crowd bidding the dip', tone: 'info' },
  }
  return { key, ...META[key], pMove, sMove }
}

const RzSentimentPriceChart = React.memo(function RzSentimentPriceChart({ sym, cgId, engine, dayMode }) {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  const uid = useId().replace(/[:]/g, '')
  const wrapRef = useRef(null)
  const tooltipRef = useRef(null)
  const [width, setWidth] = useState(860)
  const [tf, setTf] = useState('7d')
  const [mode, setMode] = useState('overlay')
  const [hover, setHover] = useState(null)
  const hoverRaf = useRef(null)

  const { loading: priceLoading, points: priceRaw } = useSentimentPriceSeries(cgId, tf)
  // Crowd fallback state — the engine classifies the live tape for tokens the
  // mindshare pipeline doesn't cover ($XLM/$ANSEM). While that's in flight the
  // empty states read "reading the crowd" instead of a false "no history".
  const crowdPending = !!engine.crowd?.pending
  const crowdResolvedEmpty = !!engine.crowd?.resolvedEmpty

  useEffect(() => {
    if (tf === '30d') engine.requestRange(720)
  }, [tf, engine])

  const roRef = useRef(null)
  const stageRef = useCallback((node) => {
    wrapRef.current = node
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!node || typeof ResizeObserver === 'undefined') return
    setWidth((w) => (Math.abs(node.clientWidth - w) > 2 && node.clientWidth > 0 ? node.clientWidth : w))
    roRef.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w) setWidth((prev) => (Math.abs(w - prev) > 2 ? w : prev))
    })
    roRef.current.observe(node)
  }, [])
  useEffect(() => () => { if (roRef.current) roRef.current.disconnect() }, [])

  const compact = width < 560
  const pad = compact ? { top: 14, right: 40, bottom: 24, left: 44 } : PAD
  const chartH = compact ? 300 : H

  const model = useMemo(() => {
    const tEnd = Date.now()
    let tStart = tEnd - TF_MS[tf]
    const { bucketMs, emaPeriod, gapMs } = TF_PARAMS[tf]

    // HEAD-TO-HEAD alignment: the crowd series is the limiting one for a young /
    // newly-tracked token (its history only goes back to when Spectre started
    // classifying it), so on a wider window price spans the full range while the
    // crowd sits as a lonely sliver on the right. Clip the window to where the
    // crowd actually begins so price and crowd cover the SAME span and read
    // head-to-head — as long as that still leaves a meaningful stretch. The
    // window naturally re-widens to the full timeframe as crowd history fills in.
    const crowdTs = (engine.series || []).filter((r) => Number.isFinite(r.score)).map((r) => r.t)
    const crowdStart = crowdTs.length ? Math.min(...crowdTs) : null
    let clippedToCrowd = false
    if (crowdStart != null && crowdStart > tStart && (tEnd - crowdStart) >= 6 * 3600e3) {
      tStart = crowdStart
      clippedToCrowd = true
    }

    const price = downsample(priceRaw.filter((p) => p.t >= tStart))
    const sentRaw = (engine.series || [])
      .filter((r) => r.t >= tStart && Number.isFinite(r.score))
      .map((r) => ({ t: r.t, v: 50 + 50 * Math.max(-1, Math.min(1, r.score)), bull: r.bullPct, bear: r.bearPct }))
    const sent = emaSeries(resampleBuckets(sentRaw, bucketMs), emaPeriod)
    if (!price.length && !sent.length) return null

    const innerW = Math.max(80, width - pad.left - pad.right)
    const innerH = chartH - pad.top - pad.bottom
    const x = (t) => pad.left + ((t - tStart) / (tEnd - tStart)) * innerW
    const top = pad.top

    // price scale
    let pMin = Infinity
    let pMax = -Infinity
    for (const p of price) { if (p.p < pMin) pMin = p.p; if (p.p > pMax) pMax = p.p }
    if (price.length) {
      const padP = (pMax - pMin || pMax * 0.02 || 1) * 0.08
      pMin -= padP; pMax += padP
    }
    const priceRange = pMax - pMin || 1
    const hasPrice = price.length >= 2
    const hasSent = sent.length >= 2

    const ticksX = []
    for (let i = 0; i <= 4; i++) {
      const t = tStart + ((tEnd - tStart) * i) / 4
      ticksX.push({ x: x(t), label: fmtTick(t, tf) })
    }

    const divergence = computeDivergence(price, sent, tf)

    /* ── OVERLAY geometry ── */
    // price uses full panel; ribbon is a thin band pinned to the bottom.
    const ribbonH = Math.min(26, Math.max(16, innerH * 0.09))
    const priceH = innerH - ribbonH - 8
    const yPrice = (v) => top + (1 - (v - pMin) / priceRange) * priceH
    const pricePts = price.map((p) => ({ x: x(p.t), y: yPrice(p.p), t: p.t, p: p.p }))
    const ribbonTop = top + priceH + 8
    // ribbon cells: one rect per sent bucket (colored by lean), width to next.
    const ribbonCells = sent.map((s, i) => {
      const x0 = x(s.t)
      const x1 = i < sent.length - 1 ? x(sent[i + 1].t) : pad.left + innerW
      const dev = Math.max(-1, Math.min(1, (s.v - 50) / 40))
      return { x: x0, w: Math.max(0.5, x1 - x0), dev, v: s.v, t: s.t }
    })
    const priceStep = priceRange / 3
    const ticksPrice = hasPrice
      ? [0, 1, 2, 3].map((i) => {
        const v = pMin + (priceRange * i) / 3
        return { y: yPrice(v), label: fmtAxisPrice(v, priceStep) }
      })
      : []

    /* ── DIVERGENCE geometry ── */
    // div(t) = crowd(0-100) - price-position-in-range(0-100). +ve = crowd ahead
    // of price (attention leading), -ve = price ahead of crowd (distribution).
    const divRaw = hasSent && hasPrice
      ? sent.map((s) => {
        const pi = nearestIdx(price, s.t)
        const pPos = pi >= 0 ? ((price[pi].p - (pMin)) / priceRange) * 100 : 50
        return { t: s.t, div: Math.max(-100, Math.min(100, s.v - pPos)), v: s.v, bull: s.bull, bear: s.bear, price: pi >= 0 ? price[pi].p : null }
      })
      : []
    let devMax = 12
    for (const d of divRaw) devMax = Math.max(devMax, Math.abs(d.div))
    devMax = Math.min(100, devMax * 1.12)
    const divMid = top + innerH / 2
    const yDiv = (d) => divMid - (d / devMax) * (innerH / 2) * 0.9
    const divSegRaw = segmentByGaps(divRaw, gapMs)
    const divRuns = divSegRaw.filter((seg) => seg.length >= 2)
    const divPtsFor = (seg) => seg.map((d) => ({ x: x(d.t), y: yDiv(d.div), ...d }))
    const divAreas = divRuns.map((seg) => {
      const p = divPtsFor(seg)
      return `${smoothPath(p)} L ${p[p.length - 1].x.toFixed(2)} ${divMid.toFixed(2)} L ${p[0].x.toFixed(2)} ${divMid.toFixed(2)} Z`
    })
    const divLines = divRuns.map((seg) => smoothPath(divPtsFor(seg)))
    const divBridges = []
    for (let i = 0; i < divSegRaw.length - 1; i++) {
      const a = divSegRaw[i][divSegRaw[i].length - 1]
      const b = divSegRaw[i + 1][0]
      if (a && b) divBridges.push({ x1: x(a.t), y1: yDiv(a.div), x2: x(b.t), y2: yDiv(b.div) })
    }
    // faint price context line inside the divergence panel (own compressed scale)
    const divPricePts = hasPrice ? price.map((p) => ({ x: x(p.t), y: top + (1 - (p.p - pMin) / priceRange) * innerH })) : []
    const allDivPts = divRuns.flatMap(divPtsFor)
    const lastDivPt = allDivPts.length ? allDivPts[allDivPts.length - 1] : null

    return {
      tf, tStart, tEnd, x, innerW, innerH, pad, chartH, top, gapMs,
      hasPrice, hasSent, clippedToCrowd, crowdStart,
      // overlay
      pricePts, priceH, ribbonTop, ribbonH, ribbonCells, ticksPrice, priceStep, pMin, pMax, priceRange,
      lastPricePt: pricePts[pricePts.length - 1] || null,
      // divergence
      divRaw, divAreas, divLines, divBridges, divMid, devMax, yDiv, divPricePts, lastDivPt,
      ticksX,
    }
  }, [priceRaw, engine.series, tf, width, pad.left, pad.right, pad.top, pad.bottom, chartH])

  /* Crosshair */
  const handleMove = useCallback((e) => {
    if (!model) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    if (hoverRaf.current) return
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = null
      const frac = (mx - model.pad.left) / (model.innerW || 1)
      const t = model.tStart + Math.max(0, Math.min(1, frac)) * (model.tEnd - model.tStart)
      const pi = nearestIdx(model.pricePts, t)
      const di = nearestIdx(model.divRaw, t)
      const divPt = di >= 0 && Math.abs(model.divRaw[di].t - t) <= model.gapMs ? model.divRaw[di] : null
      setHover({
        x: Math.max(model.pad.left, Math.min(model.pad.left + model.innerW, mx)),
        t,
        price: pi >= 0 ? model.pricePts[pi] : null,
        div: divPt,
      })
    })
  }, [model])

  const handleLeave = useCallback(() => {
    if (hoverRaf.current) { cancelAnimationFrame(hoverRaf.current); hoverRaf.current = null }
    setHover(null)
  }, [])
  useEffect(() => () => { if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current) }, [])

  useEffect(() => {
    const tip = tooltipRef.current
    if (!tip) return
    if (!hover) { tip.style.opacity = '0'; return }
    tip.style.opacity = '1'
    const w = tip.offsetWidth
    const left = hover.x + 14 + w > width ? hover.x - w - 14 : hover.x + 14
    tip.style.left = `${Math.max(4, left)}px`
  }, [hover, width])

  const isLoading = (priceLoading && !priceRaw.length) || (engine.loading && !(engine.series || []).length)

  const priceColor = 'rgb(var(--rz-token-rgb, 59, 130, 246))'
  const gridColor = dayMode ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.045)'
  const axisColor = dayMode ? 'rgba(15, 23, 42, 0.58)' : 'rgba(245, 245, 247, 0.55)'
  const midColor = dayMode ? 'rgba(15, 23, 42, 0.28)' : 'rgba(245, 245, 247, 0.26)'

  const trail = model ? computeDivergence(model.pricePts.map((p) => ({ t: p.t, p: p.p })), model.divRaw.map((d) => ({ t: d.t, v: d.v })), tf) : null

  return (
    <div className={`rz-sen-chart ${dayMode ? 'rz-sen--day' : ''}`}>
      <div className="rz-sen-chart-bar">
        <div className="rz-sen-chart-controls">
          <div className="rz-sen-tf" role="tablist" aria-label={t('researchPro.sentimentPriceChart.rzsentimentpricechart.ariaMode', "Mode")}>
            {MODES.map((m) => (
              <button key={m.key} type="button" className={mode === m.key ? 'active' : ''} onClick={() => setMode(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="rz-sen-tf" role="tablist" aria-label={t('researchPro.sentimentPriceChart.rzsentimentpricechart.ariaTimeframe', "Timeframe")}>
            {TFS.map((t) => (
              <button key={t.key} type="button" className={tf === t.key ? 'active' : ''} onClick={() => setTf(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {trail && trail.key !== 'in-sync' ? (
          <span
            className={`rz-sen-pill rz-sen-pill--${trail.tone === 'bull' ? 'bull' : trail.tone === 'bear' ? 'bear' : trail.tone === 'warn' ? 'warn' : 'info'}`}
            title={`Trailing window: price ${trail.pMove >= 0 ? '+' : ''}${trail.pMove.toFixed(1)}%, crowd ${trail.sMove >= 0 ? '+' : ''}${trail.sMove.toFixed(0)}pts`}
          >
            <span className="rz-sen-dot" />{trail.label}
          </span>
        ) : trail ? (
          <span className="rz-sen-chart-note">{t('researchPro.sentimentPriceChart.rzsentimentpricechart.crowdAndPriceInSync', "Crowd and price in sync")}</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="rz-sen-chart-shimmer">
          <SpectreLoader variant="logo" size="md" label={t('researchPro.sentimentPriceChart.rzsentimentpricechart.label', "Charting crowd vs price")} />
        </div>
      ) : !model ? (
        <div className="rz-sen-chart-empty">
          <span>No sentiment telemetry for ${sym} in this window yet.</span>
        </div>
      ) : (
        <div className="rz-sen-chart-stage" ref={stageRef}>
          <svg
            viewBox={`0 0 ${width} ${model.chartH}`}
            height={model.chartH}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            onTouchStart={(e) => e.touches[0] && handleMove(e.touches[0])}
            onTouchMove={(e) => e.touches[0] && handleMove(e.touches[0])}
            onTouchEnd={handleLeave}
          >
            <defs>
              <linearGradient id={`sen-price-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={priceColor} stopOpacity="0.16" />
                <stop offset="100%" stopColor={priceColor} stopOpacity="0" />
              </linearGradient>
              <clipPath id={`sen-div-above-${uid}`}>
                <rect x={model.pad.left} y={model.top} width={model.innerW} height={model.divMid - model.top} />
              </clipPath>
              <clipPath id={`sen-div-below-${uid}`}>
                <rect x={model.pad.left} y={model.divMid} width={model.innerW} height={model.top + model.innerH - model.divMid} />
              </clipPath>
            </defs>

            {/* horizontal grid */}
            {[0, 1, 2, 3].map((i) => {
              const y = model.top + (model.innerH * i) / 3
              return <line key={i} x1={model.pad.left} x2={model.pad.left + model.innerW} y1={y} y2={y} stroke={gridColor} strokeWidth="1" />
            })}

            {mode === 'overlay' ? (
              <>
                {/* ── PRICE ── */}
                {model.hasPrice && (
                  <>
                    <path
                      d={`${smoothPath(model.pricePts)} L ${model.pricePts[model.pricePts.length - 1].x.toFixed(2)} ${(model.top + model.priceH).toFixed(2)} L ${model.pricePts[0].x.toFixed(2)} ${(model.top + model.priceH).toFixed(2)} Z`}
                      fill={`url(#sen-price-fill-${uid})`}
                    />
                    <path d={smoothPath(model.pricePts)} fill="none" style={{ stroke: priceColor }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  </>
                )}
                {/* ── CROWD HEAT RIBBON ── */}
                {model.hasSent && (
                  <>
                    <text x={model.pad.left} y={model.ribbonTop - 5} fontSize="9.5" fontWeight="650" fill={axisColor} letterSpacing="1" fontFamily="var(--font-display)">
                      {t('researchPro.sentimentPriceChart.rzsentimentpricechart.crowdMood', "CROWD MOOD")}
                    </text>
                    {model.ribbonCells.map((c, i) => {
                      const bull = c.dev >= 0
                      const color = bull ? '16, 185, 129' : '239, 68, 68'
                      const op = 0.14 + Math.abs(c.dev) * 0.66
                      return <rect key={`rb${i}`} x={c.x} y={model.ribbonTop} width={c.w + 0.6} height={model.ribbonH} fill={`rgba(${color}, ${op})`} />
                    })}
                    <rect x={model.pad.left} y={model.ribbonTop} width={model.innerW} height={model.ribbonH} fill="none" stroke={gridColor} strokeWidth="1" rx="2" />
                  </>
                )}
                {/* price axis */}
                {model.ticksPrice.map((t, i) => (
                  <text key={`p${i}`} x={model.pad.left - 8} y={t.y + 3} fontSize="11" fill={axisColor} textAnchor="end" fontFamily="var(--font-mono)">{t.label}</text>
                ))}
                {model.lastPricePt && (
                  <g pointerEvents="none">
                    <rect x={2} y={Math.max(model.top, Math.min(model.top + model.priceH - 16, model.lastPricePt.y - 8))} width={model.pad.left - 6} height={16} rx={4} style={{ fill: priceColor }} opacity="0.92" />
                    <text x={model.pad.left / 2 - 1} y={Math.max(model.top, Math.min(model.top + model.priceH - 16, model.lastPricePt.y - 8)) + 11.5} fontSize="10" fontWeight="700" fill="#09090b" textAnchor="middle" fontFamily="var(--font-mono)">
                      {fmtAxisPrice(model.lastPricePt.p, model.priceStep)}
                    </text>
                  </g>
                )}
              </>
            ) : (
              <>
                {/* ── DIVERGENCE OSCILLATOR ── */}
                {/* faint price context line */}
                {model.hasPrice && (
                  <path d={smoothPath(model.divPricePts)} fill="none" style={{ stroke: priceColor }} strokeWidth="1.4" strokeOpacity="0.32" strokeLinejoin="round" strokeLinecap="round" />
                )}
                {model.hasSent && model.hasPrice ? (
                  <>
                    {model.divAreas.map((d, i) => (
                      <g key={`da${i}`}>
                        <path d={d} fill="#10B981" opacity="0.24" clipPath={`url(#sen-div-above-${uid})`} />
                        <path d={d} fill="#EF4444" opacity="0.24" clipPath={`url(#sen-div-below-${uid})`} />
                      </g>
                    ))}
                    {model.divLines.map((d, i) => (
                      <g key={`dl${i}`}>
                        <path d={d} fill="none" stroke="#34D399" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#sen-div-above-${uid})`} />
                        <path d={d} fill="none" stroke="#F87171" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#sen-div-below-${uid})`} />
                      </g>
                    ))}
                    {model.divBridges.map((b, i) => (
                      <line key={`db${i}`} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke={midColor} strokeWidth="1.2" strokeDasharray="2 5" strokeLinecap="round" />
                    ))}
                    {/* zero line */}
                    <line x1={model.pad.left} x2={model.pad.left + model.innerW} y1={model.divMid} y2={model.divMid} stroke={midColor} strokeWidth="1.2" />
                    {/* zone labels */}
                    <text x={model.pad.left + model.innerW - 4} y={model.top + 13} fontSize="9.5" fontWeight="650" fill="#34D399" opacity="0.75" textAnchor="end" letterSpacing="0.5" fontFamily="var(--font-display)">{t('researchPro.sentimentPriceChart.rzsentimentpricechart.attentionLeading', "ATTENTION LEADING")}</text>
                    <text x={model.pad.left + model.innerW - 4} y={model.top + model.innerH - 6} fontSize="9.5" fontWeight="650" fill="#F87171" opacity="0.75" textAnchor="end" letterSpacing="0.5" fontFamily="var(--font-display)">{t('researchPro.sentimentPriceChart.rzsentimentpricechart.priceAheadOfCrowd', "PRICE AHEAD OF CROWD")}</text>
                    <text x={model.pad.left + model.innerW + 8} y={model.divMid + 3.5} fontSize="10" fill={axisColor} fontFamily="var(--font-mono)">0</text>
                    {model.lastDivPt && (
                      <g pointerEvents="none">
                        <rect x={model.pad.left + model.innerW + 3} y={Math.max(model.top, Math.min(model.top + model.innerH - 16, model.lastDivPt.y - 8))} width={model.pad.right - 6} height={16} rx={4} fill={model.lastDivPt.div >= 0 ? '#10B981' : '#EF4444'} opacity="0.92" />
                        <text x={model.pad.left + model.innerW + 3 + (model.pad.right - 6) / 2} y={Math.max(model.top, Math.min(model.top + model.innerH - 16, model.lastDivPt.y - 8)) + 11.5} fontSize="10" fontWeight="700" fill="#09090b" textAnchor="middle" fontFamily="var(--font-mono)">
                          {model.lastDivPt.div >= 0 ? '+' : ''}{Math.round(model.lastDivPt.div)}
                        </text>
                      </g>
                    )}
                  </>
                ) : (
                  <text x={model.pad.left + model.innerW / 2} y={model.divMid} fontSize="12" fill={axisColor} textAnchor="middle" fontFamily="var(--font-display)">
                    {crowdPending
                      ? 'Reading the crowd from the live tape…'
                      : crowdResolvedEmpty
                        ? `$${sym} is socially quiet right now — no crowd read`
                        : 'Need both price and crowd history for a divergence read'}
                  </text>
                )}
              </>
            )}

            {/* x axis */}
            {model.ticksX.map((t, i) => (
              <text key={`x${i}`} x={t.x} y={model.chartH - 8} fontSize="11" fill={axisColor} textAnchor="middle" fontFamily="var(--font-mono)">{t.label}</text>
            ))}

            {/* crosshair */}
            {hover && (
              <g pointerEvents="none">
                <line x1={hover.x} x2={hover.x} y1={model.top} y2={model.top + model.innerH} stroke={dayMode ? 'rgba(15,23,42,0.2)' : 'rgba(245,245,247,0.18)'} strokeWidth="1" strokeDasharray="4 4" />
                {mode === 'overlay' && hover.price && (
                  <circle cx={hover.price.x} cy={hover.price.y} r="3.5" style={{ fill: priceColor }} stroke={dayMode ? '#fff' : '#09090b'} strokeWidth="1.5" />
                )}
                {mode === 'divergence' && hover.div && Number.isFinite(model.yDiv(hover.div.div)) && (
                  <circle cx={model.x(hover.div.t)} cy={model.yDiv(hover.div.div)} r="3.5" fill={hover.div.div >= 0 ? '#34D399' : '#F87171'} stroke={dayMode ? '#fff' : '#09090b'} strokeWidth="1.5" />
                )}
              </g>
            )}
          </svg>

          <div ref={tooltipRef} className="rz-sen-chart-tooltip">
            {hover && (
              <>
                <span className="tt-time">
                  {new Date(hover.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                  {new Date(hover.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
                {hover.price && (
                  <span className="tt-row">
                    <span className="tt-key"><i className="swatch" style={{ background: priceColor }} />{t('researchPro.sentimentPriceChart.rzsentimentpricechart.price', "Price")}</span>
                    <span className="tt-val">{fmtPrice(hover.price.p)}</span>
                  </span>
                )}
                {hover.div && (
                  <span className="tt-row">
                    <span className="tt-key"><i className="swatch" style={{ background: hover.div.v >= 50 ? '#34D399' : '#F87171' }} />{t('researchPro.sentimentPriceChart.rzsentimentpricechart.crowd', "Crowd")}</span>
                    <span className="tt-val">{Math.round(hover.div.v)}/100</span>
                  </span>
                )}
                {mode === 'divergence' && hover.div && (
                  <span className="tt-row">
                    <span className="tt-key">{t('researchPro.sentimentPriceChart.rzsentimentpricechart.divergence', "Divergence")}</span>
                    <span className="tt-val">{hover.div.div >= 0 ? '+' : ''}{Math.round(hover.div.div)}</span>
                  </span>
                )}
                {hover.div && Number.isFinite(hover.div.bull) && (
                  <span className="tt-row">
                    <span className="tt-key">{t('researchPro.sentimentPriceChart.rzsentimentpricechart.bullBear', "Bull / Bear")}</span>
                    <span className="tt-val">{Math.round(hover.div.bull)}% / {Math.round(hover.div.bear ?? 0)}%</span>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {model && !model.hasSent && (
        <span className="rz-sen-chart-note">
          {crowdPending
            ? `Reading $${sym}'s crowd from the live X tape — the sentiment overlay fills in a moment.`
            : crowdResolvedEmpty
              ? `$${sym} is socially quiet right now — no crowd chatter to overlay, price only.`
              : `Crowd-sentiment history for $${sym} hasn't accumulated in this window yet — price only.`}
        </span>
      )}
      {model && model.hasSent && model.clippedToCrowd && model.crowdStart && (
        <span className="rz-sen-chart-note">
          Aligned to the shared window — crowd tracked since {new Date(model.crowdStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, so price and crowd read head-to-head. Widens to full {model.tf.toUpperCase()} as crowd history fills in.
        </span>
      )}
      {model && !model.hasPrice && cgId == null && (
        <span className="rz-sen-chart-note">No CoinGecko listing — showing crowd sentiment only.</span>
      )}
    </div>
  )
})

export default RzSentimentPriceChart
