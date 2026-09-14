/**
 * FearGreedChart — Dual-axis chart with Bitcoin price overlay
 * Clean, minimal design — subtle zone hints, no visual clutter
 */
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { getEthPriceHistory, getOthersMarketCapHistory } from '@/services/fearGreedApi'
import { getSpectreOthers2History } from '@/services/spectreMarketApi'
import { useChartEvents } from './useChartEvents'
import ChartEventMarkers, { MarkerDefs } from './ChartEventMarkers'
import ChartEventTooltip from './ChartEventTooltip'
import ChartWatermark from '@/components/chart-watermark'

const TIMEFRAMES = [
  { id: '7D', label: '7d', days: 7 },
  { id: '30D', label: '30d', days: 30 },
  { id: '90D', label: '90d', days: 90 },
  { id: '1Y', label: '1y', days: 365 },
  { id: 'ALL', label: 'All', days: 9999 },
]

const DEFAULT_H = 380
const VOL_H = 24
const PAD = { top: 14, right: 68, bottom: 34, left: 44 }

// Right-axis zone labels (label resolved at render via i18n)
const ZONE_LABELS = [
  { y: 12.5, key: 'fearGreedPage.zoneCapitulation', color: 'rgba(239,68,68,0.7)' },
  { y: 35, key: 'fearGreedPage.zoneFear', color: 'rgba(234,88,12,0.7)' },
  { y: 50, key: 'fearGreedPage.zoneNeutral', color: 'rgba(234,179,8,0.7)' },
  { y: 65, key: 'fearGreedPage.zoneGreed', color: 'rgba(132,204,22,0.7)' },
  { y: 87.5, key: 'fearGreedPage.zoneEuphoria', color: 'rgba(16,185,129,0.7)' },
]

function fgColor(v) {
  if (v <= 25) return '#ef4444'
  if (v <= 45) return '#ea580c'
  if (v <= 55) return '#eab308'
  if (v <= 75) return '#84cc16'
  return '#22c55e'
}

function fmtBtc(p) {
  if (p >= 1000) return `${(p / 1000).toFixed(0)}K`
  return p.toFixed(0)
}

// Overlay assets the F&G line can be compared against (single-select).
const OVERLAYS = [
  { key: 'BTC', label: 'BTC' },
  { key: 'ETH', label: 'ETH' },
  { key: 'OTHERS', label: 'OTHERS' },
]
// Per-asset overlay line color [dark, day] — muted brand tints so the F&G line
// stays the hero. BTC slate, ETH periwinkle, OTHERS teal.
const OV_COLORS = {
  BTC: ['rgba(148,163,184,0.7)', 'rgba(71,85,105,0.55)'],
  ETH: ['rgba(129,140,248,0.82)', 'rgba(79,70,229,0.62)'],
  OTHERS: ['rgba(45,212,191,0.82)', 'rgba(13,148,136,0.62)'],
}

function fmtCap(v) {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${Math.round(v)}`
}
// Left-axis formatter: BTC/ETH are prices ("61K"), OTHERS is a market cap ("$54B").
function fmtOverlayAxis(v, kind) { return kind === 'cap' ? fmtCap(v) : fmtBtc(v) }

// Pearson correlation — how sentiment and the overlay co-move over the shown window.
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return 0
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < n; i++) { const x = xs[i], y = ys[i]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y }
  const cov = sxy - (sx * sy) / n
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n
  const d = Math.sqrt(vx * vy)
  return d > 0 ? Math.max(-1, Math.min(1, cov / d)) : 0
}

function FearGreedChart({ history, current, btcHistory, dayMode }) {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  /* Day-mode aware SVG colors. Inline `stroke`/`fill` attributes win over
     stylesheet rules, so day-mode must be switched here. Light values mirror
     the dark warm-white at equivalent alpha against a near-white page. */
  const gridStroke = dayMode ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.035)'
  const volFill = dayMode ? 'rgba(15,23,42,0.08)' : 'rgba(148,163,184,0.07)'
  const btcLineStroke = dayMode ? 'rgba(71,85,105,0.45)' : 'rgba(148,163,184,0.6)'
  const crosshairStroke = dayMode ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.1)'
  const hoverPointStroke = dayMode ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.8)'
  const hoverBtcStroke = dayMode ? 'rgba(15,23,42,0.45)' : 'rgba(255,255,255,0.6)'
  const dimFill = dayMode ? 'rgba(15,23,42,0.18)' : 'rgba(0,0,0,0.35)'
  const selRectFill = dayMode ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.02)'
  const selEdgeStroke = dayMode ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.3)'
  const skelGridStroke = dayMode ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.03)'
  const skelAxisFill = dayMode ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.04)'
  const skelZoneFill = dayMode ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.03)'
  const skelBtcStroke = dayMode ? 'rgba(71,85,105,0.18)' : 'rgba(148,163,184,0.06)'
  const skelVolFill = dayMode ? 'rgba(15,23,42,0.06)' : 'rgba(148,163,184,0.04)'

  const [timeframe, setTimeframe] = useState('1Y')
  const [overlayAsset, setOverlayAsset] = useState('BTC') // 'BTC' | 'ETH' | 'OTHERS' | null
  const [overlayExtra, setOverlayExtra] = useState({}) // lazy cache: { ETH:{prices,total_volumes}, OTHERS:{prices} }
  const [showVol, setShowVol] = useState(true)
  const [hover, setHover] = useState(null)
  const [showEvents, setShowEvents] = useState(true)
  const [activeEvent, setActiveEvent] = useState(null)
  const [hoveringMarker, setHoveringMarker] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [zoomRange, setZoomRange] = useState(null)
  const [dragSel, setDragSel] = useState(null)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const displayFgRef = useRef([])
  const iwRef = useRef(0)
  const wRef = useRef(0)
  const cardRef = useRef(null)
  const wrapRef = useRef(null)
  const [dims, setDims] = useState({ w: 680 + PAD.left + PAD.right, h: DEFAULT_H })

  const toggleFullscreen = useCallback(() => {
    setFullscreen(prev => !prev)
  }, [])

  // Lock body scroll + close on Escape
  useEffect(() => {
    if (!fullscreen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [fullscreen])

  // Re-attach ResizeObserver when fullscreen changes (element moves in/out of portal)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) {
        setDims({ w: Math.round(width), h: Math.round(height) })
      }
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Delay initial measure slightly to let portal layout settle
    requestAnimationFrame(measure)
    return () => ro.disconnect()
  }, [fullscreen])

  const W = dims.w
  const CHART_H = dims.h
  const IW = Math.max(100, W - PAD.left - PAD.right)
  const IH = CHART_H - PAD.top - PAD.bottom - VOL_H
  iwRef.current = IW
  wRef.current = W

  // ── F&G data (append current value if newer than last history point) ──
  // Re-key on `current`'s SCALAR fields (value/timestamp/classification) rather
  // than its object identity. The 120s poll can hand back a fresh `current`
  // object with unchanged numbers; keying on scalars keeps this geometry chain
  // (fgData -> fgPts -> fgSegs/fgArea, all the SVG path strings) stable until
  // the reading actually moves, while still rebuilding the moment it does.
  const curVal = current?.value
  const curTs = current?.timestamp
  const curClass = current?.classification
  const fgData = useMemo(() => {
    if (!history?.length) return []
    const days = TIMEFRAMES.find(t => t.id === timeframe)?.days ?? 365
    let data = days >= 9999 ? [...history] : history.filter(h => h.timestamp && parseInt(h.timestamp, 10) >= (Date.now() / 1000) - days * 86400)
    // Append current value so the chart always shows the latest reading
    if (current?.value != null && current?.timestamp) {
      const curTs = parseInt(current.timestamp, 10)
      const lastTs = data.length ? parseInt(data[data.length - 1].timestamp, 10) : 0
      if (curTs > lastTs) {
        data = [...data, { value: current.value, classification: current.classification, timestamp: current.timestamp }]
      } else if (curTs === lastTs && data.length) {
        // Same timestamp but different value — update last entry
        data = [...data.slice(0, -1), { ...data[data.length - 1], value: current.value, classification: current.classification }]
      }
    } else if (current?.value != null && data.length) {
      // No timestamp on current — use "now" and append if different from last
      const nowTs = Math.floor(Date.now() / 1000)
      const lastVal = data[data.length - 1].value
      if (current.value !== lastVal) {
        data = [...data, { value: current.value, classification: current.classification || '', timestamp: String(nowTs) }]
      }
    }
    return data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, curVal, curTs, curClass, timeframe])

  // ── Overlay series (BTC default, or ETH / OTHERS) ──
  // Dez asked to plot F&G vs bitcoin / eth / others. Single-select: the chosen
  // asset's price (BTC/ETH) — or OTHERS' total market cap — rides the left axis.
  // BTC comes from the `btcHistory` prop (already fetched by the hook); ETH/OTHERS
  // lazy-fetch on first select and cache in `overlayExtra`.
  const showOverlay = !!overlayAsset
  const ovKind = overlayAsset === 'OTHERS' ? 'cap' : 'price'
  const ovLabel = overlayAsset || 'BTC'
  const ovColorOf = (k) => (OV_COLORS[k] || OV_COLORS.BTC)[dayMode ? 1 : 0]
  const ovColor = ovColorOf(overlayAsset || 'BTC')
  const overlayHistory = overlayAsset === 'BTC' ? btcHistory : (overlayAsset ? overlayExtra[overlayAsset] : null)

  useEffect(() => {
    if (!overlayAsset || overlayAsset === 'BTC' || overlayExtra[overlayAsset]) return
    let cancelled = false
    const load = overlayAsset === 'ETH'
      ? getEthPriceHistory(365)
      : getSpectreOthers2History(365)
          .then(({ history }) => {
            // normalize OTHERS2 {ts(sec),o(cap)} → the {prices:[[tsMs,val]]} overlay shape
            const prices = (history || []).map((h) => [h.ts > 1e12 ? h.ts : h.ts * 1000, h.o])
            if (prices.length >= 8) return { prices }
            throw new Error('empty others2') // → CG-derived fallback (dev / cold box)
          })
          .catch(() => getOthersMarketCapHistory(365)) // altcoin mcap (total − BTC), dev+prod safe
    Promise.resolve(load)
      .then((d) => { if (!cancelled && d?.prices?.length) setOverlayExtra((prev) => ({ ...prev, [overlayAsset]: d })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [overlayAsset, overlayExtra])

  // Overlay price/cap data. Names kept `btc*` for diff stability; they now hold the
  // SELECTED overlay (BTC/ETH price, or OTHERS cap).
  const btcData = useMemo(() => {
    if (!overlayHistory?.prices?.length) return []
    const days = TIMEFRAMES.find(t => t.id === timeframe)?.days ?? 365
    const cutoff = days >= 9999 ? 0 : Date.now() - days * 86400 * 1000
    return overlayHistory.prices.filter(([ts]) => ts >= cutoff).map(([ts, p]) => ({ ts: Math.floor(ts / 1000), price: p }))
  }, [overlayHistory, timeframe])

  // ── Overlay volume (BTC/ETH only; OTHERS has none → bars simply hide) ──
  const volData = useMemo(() => {
    if (!overlayHistory?.total_volumes?.length) return []
    const days = TIMEFRAMES.find(t => t.id === timeframe)?.days ?? 365
    const cutoff = days >= 9999 ? 0 : Date.now() - days * 86400 * 1000
    return overlayHistory.total_volumes.filter(([ts]) => ts >= cutoff).map(([ts, v]) => ({ ts: Math.floor(ts / 1000), vol: v }))
  }, [overlayHistory, timeframe])

  // ── Reset zoom when timeframe changes ──
  useEffect(() => { setZoomRange(null); setDragSel(null) }, [timeframe])

  // ── Zoomed display data ──
  const displayFg = useMemo(() => {
    if (!zoomRange) return fgData
    return fgData.filter(h => {
      const ts = parseInt(h.timestamp, 10)
      return ts >= zoomRange.startTs && ts <= zoomRange.endTs
    })
  }, [fgData, zoomRange])

  const displayBtc = useMemo(() => {
    if (!zoomRange) return btcData
    return btcData.filter(b => b.ts >= zoomRange.startTs && b.ts <= zoomRange.endTs)
  }, [btcData, zoomRange])

  const displayVol = useMemo(() => {
    if (!zoomRange) return volData
    return volData.filter(v => v.ts >= zoomRange.startTs && v.ts <= zoomRange.endTs)
  }, [volData, zoomRange])

  // Keep refs in sync for drag mouseup handler
  displayFgRef.current = displayFg

  // ── BTC range ──
  const btcRange = useMemo(() => {
    if (!displayBtc.length) return { min: 0, max: 100000 }
    let mn = Infinity, mx = -Infinity
    for (const b of displayBtc) {
      if (b.price < mn) mn = b.price
      if (b.price > mx) mx = b.price
    }
    if (!isFinite(mn)) mn = 0
    if (!isFinite(mx)) mx = 0
    const pad = (mx - mn) * 0.1
    return { min: Math.max(0, mn - pad), max: mx + pad }
  }, [displayBtc])

  const volMax = useMemo(() => displayVol.length ? displayVol.reduce((m, v) => v.vol > m ? v.vol : m, 0) || 1 : 1, [displayVol])

  // ── F&G points ──
  const fgPts = useMemo(() => {
    if (!displayFg.length) return []
    return displayFg.map((h, i) => {
      const x = PAD.left + (i / Math.max(1, displayFg.length - 1)) * IW
      const v = Math.min(100, Math.max(0, h.value))
      const y = PAD.top + IH - (v / 100) * IH
      return { x, y, ...h }
    })
  }, [displayFg, IW, IH])

  // ── Event markers ──
  const { clusters: eventClusters } = useChartEvents(displayFg, timeframe, IW, IH, showEvents)

  // ── BTC points ──
  const btcPts = useMemo(() => {
    if (!displayBtc.length) return []
    const { min, max } = btcRange
    const range = max - min || 1
    return displayBtc.map((b, i) => {
      const x = PAD.left + (i / Math.max(1, displayBtc.length - 1)) * IW
      const y = PAD.top + IH - ((b.price - min) / range) * IH
      return { x, y, ...b }
    })
  }, [displayBtc, btcRange, IW, IH])

  // ── F&G colored segments ──
  const fgSegs = useMemo(() => {
    if (fgPts.length < 2) return []
    const s = []
    for (let i = 1; i < fgPts.length; i++) {
      const a = fgPts[i - 1], b = fgPts[i]
      s.push({ d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`, c: fgColor((a.value + b.value) / 2) })
    }
    return s
  }, [fgPts])

  // ── F&G area fill path ──
  const fgArea = useMemo(() => {
    if (fgPts.length < 2) return ''
    const bottom = PAD.top + IH
    const line = fgPts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    return `${line} L${fgPts[fgPts.length - 1].x.toFixed(1)},${bottom} L${fgPts[0].x.toFixed(1)},${bottom} Z`
  }, [fgPts, IH])

  // ── BTC path ──
  const btcPath = useMemo(() => {
    if (btcPts.length < 2) return ''
    return btcPts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  }, [btcPts])

  // ── Volume bars ──
  const volBars = useMemo(() => {
    if (!displayVol.length) return []
    const top = PAD.top + IH + 4
    const bw = Math.max(0.8, IW / displayVol.length * 0.8)
    return displayVol.map((v, i) => {
      const x = PAD.left + (i / Math.max(1, displayVol.length - 1)) * IW - bw / 2
      const h = Math.max(0.5, (v.vol / volMax) * VOL_H)
      return { x, y: top + VOL_H - h, w: bw, h }
    })
  }, [displayVol, volMax, IW, IH])

  // ── Left Y-axis (overlay price / cap) ──
  const leftLabels = useMemo(() => {
    const { min, max } = btcRange
    const r = max - min
    return [0, 0.25, 0.5, 0.75, 1].map(f => ({
      y: PAD.top + IH - f * IH,
      label: fmtOverlayAxis(min + f * r, ovKind),
    }))
  }, [btcRange, IH, ovKind])

  // ── X-axis labels ──
  const xLabels = useMemo(() => {
    const src = displayFg.length ? displayFg : displayBtc
    if (!src.length) return []
    const n = src.length
    const useShortFmt = zoomRange ? (n <= 90) : (timeframe === '7D' || timeframe === '30D')
    const count = n <= 7 ? Math.min(4, n) : n <= 30 ? 5 : n <= 90 ? 6 : 7
    const step = Math.max(1, Math.floor((n - 1) / (count - 1)))
    const labels = []
    for (let i = 0; i < n; i += step) {
      const item = src[i]
      const ts = item.timestamp ? parseInt(item.timestamp, 10) * 1000 : item.ts * 1000
      const d = new Date(ts)
      const x = PAD.left + (i / Math.max(1, n - 1)) * IW
      const fmt = useShortFmt
        ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      labels.push({ x, label: fmt })
    }
    return labels
  }, [displayFg, displayBtc, timeframe, zoomRange, IW])

  const hasData = fgPts.length >= 2 || btcPts.length >= 2

  // ── Insight: how sentiment and the overlay co-moved over the shown window ──
  // Aligns each F&G point to the nearest overlay point (both time-ordered), then
  // reports the correlation + each side's net move — grounded, no new data.
  const insight = useMemo(() => {
    if (!overlayAsset || displayFg.length < 8 || displayBtc.length < 8) return null
    const pairs = []
    let j = 0
    for (const f of displayFg) {
      const ft = parseInt(f.timestamp, 10)
      while (j < displayBtc.length - 1 && Math.abs(displayBtc[j + 1].ts - ft) <= Math.abs(displayBtc[j].ts - ft)) j++
      const o = displayBtc[j]
      if (o && Math.abs(o.ts - ft) < 3 * 86400) pairs.push([f.value, o.price])
    }
    if (pairs.length < 8) return null
    const r = pearson(pairs.map(p => p[0]), pairs.map(p => p[1]))
    const fgDelta = Math.round(displayFg[displayFg.length - 1].value - displayFg[0].value)
    const ovFrom = displayBtc[0].price
    const ovPct = ovFrom ? ((displayBtc[displayBtc.length - 1].price - ovFrom) / ovFrom) * 100 : 0
    const tfLabel = (TIMEFRAMES.find(t => t.id === timeframe)?.label) || ''
    let rel, tone
    if (r >= 0.45) { rel = `tracking ${ovLabel}`; tone = 'together' }
    else if (r <= -0.3) { rel = `diverging from ${ovLabel}`; tone = 'diverge' }
    else { rel = `loosely tied to ${ovLabel}`; tone = 'loose' }
    return { r, rel, tone, fgDelta, ovPct, tfLabel }
  }, [overlayAsset, ovLabel, displayFg, displayBtc, timeframe])

  // ── Drag-to-zoom handlers ──
  const onChartMouseDown = useCallback((e) => {
    if (e.button !== 0 || !hasData) return
    if (e.target.closest('.fg-event-marker, .fg-chart-timeframes, .fg-legend-toggle, .fg-fullscreen-btn, .fg-zoom-reset-btn')) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    if (svgX < PAD.left || svgX > PAD.left + IW) return
    isDraggingRef.current = true
    dragStartXRef.current = svgX
    setDragSel({ x1: svgX, x2: svgX })
    setHover(null)
    setActiveEvent(null)
  }, [W, IW, hasData])

  // Window mouseup listener for drag end
  useEffect(() => {
    const handleMouseUp = (e) => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false

      const wrap = wrapRef.current
      const dfg = displayFgRef.current
      const iw = iwRef.current
      const w = wRef.current
      if (!wrap || !dfg.length) { setDragSel(null); return }

      const rect = wrap.getBoundingClientRect()
      const svgX = Math.max(PAD.left, Math.min(PAD.left + iw, ((e.clientX - rect.left) / rect.width) * w))
      const x1 = Math.min(dragStartXRef.current, svgX)
      const x2 = Math.max(dragStartXRef.current, svgX)

      setDragSel(null)

      // Minimum 10px SVG drag distance
      if (x2 - x1 < 10 || dfg.length < 2) return

      const startIdx = Math.max(0, Math.round(((x1 - PAD.left) / iw) * (dfg.length - 1)))
      const endIdx = Math.min(dfg.length - 1, Math.round(((x2 - PAD.left) / iw) * (dfg.length - 1)))

      if (endIdx > startIdx) {
        const startTs = parseInt(dfg[startIdx].timestamp, 10)
        const endTs = parseInt(dfg[endIdx].timestamp, 10)
        setZoomRange({ startTs, endTs })
      }
    }

    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const resetZoom = useCallback(() => setZoomRange(null), [])

  // ── Hover ──
  const onMove = useCallback((e) => {
    if (!fgPts.length && !btcPts.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W

    // During drag, update selection rect instead of hover
    if (isDraggingRef.current) {
      const clampedX = Math.max(PAD.left, Math.min(PAD.left + IW, px))
      setDragSel({ x1: dragStartXRef.current, x2: clampedX })
      return
    }

    let fi = -1, fd = Infinity
    fgPts.forEach((p, i) => { const d = Math.abs(p.x - px); if (d < fd) { fd = d; fi = i } })

    let bi = -1, bd = Infinity
    btcPts.forEach((p, i) => { const d = Math.abs(p.x - px); if (d < bd) { bd = d; bi = i } })

    const fp = fi >= 0 ? fgPts[fi] : null
    const bp = bi >= 0 ? btcPts[bi] : null
    const ax = fp?.x ?? bp?.x ?? 0

    setHover({
      px: (ax / W) * rect.width,
      sx: ax,
      fg: fp ? { value: fp.value, cls: fp.classification, y: fp.y, ts: fp.timestamp } : null,
      btc: bp ? { price: bp.price, y: bp.y, ts: bp.ts } : null,
    })
  }, [fgPts, btcPts, W, IW])

  const onTouch = useCallback((e) => {
    if (!fgPts.length && !btcPts.length) return
    e.preventDefault()
    const touch = e.touches[0]
    if (!touch) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((touch.clientX - rect.left) / rect.width) * W

    let fi = -1, fd = Infinity
    fgPts.forEach((p, i) => { const d = Math.abs(p.x - px); if (d < fd) { fd = d; fi = i } })

    let bi = -1, bd = Infinity
    btcPts.forEach((p, i) => { const d = Math.abs(p.x - px); if (d < bd) { bd = d; bi = i } })

    const fp = fi >= 0 ? fgPts[fi] : null
    const bp = bi >= 0 ? btcPts[bi] : null
    const ax = fp?.x ?? bp?.x ?? 0

    setHover({
      px: (ax / W) * rect.width,
      sx: ax,
      fg: fp ? { value: fp.value, cls: fp.classification, y: fp.y, ts: fp.timestamp } : null,
      btc: bp ? { price: bp.price, y: bp.y, ts: bp.ts } : null,
    })
  }, [fgPts, btcPts, W])

  const chartContent = (
    <>
      <div className="fg-chart-head">
        <div className="fg-chart-title-group">
          <span className="fg-chart-title">{t('fearGreedPage.fgIndex')}</span>
          <div className="fg-chart-legend">
            <span className="fg-legend-item"><span className="fg-legend-line fg-legend-line--fg" />{t('fearGreedPage.legendCryptoFg')}</span>
            <span className="fg-legend-item fg-overlay-pick">
              <span className="fg-legend-line fg-legend-line--btc" style={{ background: ovColor }} />
              {OVERLAYS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`fg-overlay-chip ${overlayAsset === o.key ? 'fg-overlay-chip--on' : ''}`}
                  style={overlayAsset === o.key ? { borderColor: ovColorOf(o.key), color: '#fff' } : undefined}
                  onClick={() => setOverlayAsset((cur) => (cur === o.key ? null : o.key))}
                  aria-pressed={overlayAsset === o.key}
                >{o.label}</button>
              ))}
            </span>
            {displayVol.length > 0 && (
              <button
                type="button"
                className={`fg-legend-item fg-legend-toggle ${showVol ? '' : 'fg-legend-toggle--off'}`}
                onClick={() => setShowVol(v => !v)}
                aria-pressed={showVol}
              >
                <span className="fg-legend-bar" />{t('fearGreedPage.legendVolume')}
              </button>
            )}
            <button
              type="button"
              className={`fg-legend-item fg-legend-toggle ${showEvents ? '' : 'fg-legend-toggle--off'}`}
              onClick={() => { setShowEvents(v => !v); setActiveEvent(null) }}
              aria-pressed={showEvents}
            >
              <span className="fg-legend-dot fg-legend-dot--events" />{t('fearGreedPage.legendEvents')}
            </button>
          </div>
        </div>
        <div className="fg-chart-actions">
          {zoomRange && (
            <button
              type="button"
              className="fg-zoom-reset-btn"
              onClick={resetZoom}
              title={t('fearGreedPage.resetZoom')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
                <path d="M8 11h6" />
              </svg>
              {t('fearGreedPage.resetZoom')}
            </button>
          )}
          <button
            type="button"
            className="fg-fullscreen-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('fearGreedPage.exitFullscreen') : t('fearGreedPage.fullscreen')}
            title={fullscreen ? t('fearGreedPage.exitFullscreenEsc') : t('fearGreedPage.fullscreen')}
          >
            {fullscreen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            )}
          </button>
          <div className="fg-chart-timeframes">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.id}
                type="button"
                className={`fg-tf-btn ${timeframe === tf.id ? 'active' : ''}`}
                onClick={() => { setTimeframe(tf.id); setActiveEvent(null) }}
                aria-pressed={timeframe === tf.id}
              >{tf.label}</button>
            ))}
          </div>
        </div>
      </div>

      {insight && (
        <div className={`fg-chart-insight fg-chart-insight--${insight.tone}`}>
          <span className="fg-insight-corr" title="Correlation of Fear &amp; Greed with the overlay over the shown window">r {insight.r >= 0 ? '+' : ''}{insight.r.toFixed(2)}</span>
          <span className="fg-insight-text">Sentiment is <strong>{insight.rel}</strong> — over {insight.tfLabel}, F&amp;G {insight.fgDelta >= 0 ? '+' : ''}{insight.fgDelta} pts · {ovLabel} {insight.ovPct >= 0 ? '+' : ''}{insight.ovPct.toFixed(1)}%</span>
        </div>
      )}

      <div ref={wrapRef} className={`fg-chart-wrap spectre-wm-host${hasData ? ' fg-chart-wrap--zoomable' : ''}${dragSel ? ' fg-chart-wrap--dragging' : ''}`} onMouseDown={hasData ? onChartMouseDown : undefined} onMouseMove={hasData ? onMove : undefined} onMouseLeave={hasData ? () => { if (!isDraggingRef.current) setHover(null) } : undefined} onTouchMove={hasData ? onTouch : undefined} onTouchEnd={hasData ? () => setHover(null) : undefined} onDoubleClick={zoomRange ? resetZoom : undefined} onClick={(e) => { if (activeEvent && !e.target.closest('.fg-event-marker')) setActiveEvent(null) }}>
        {!hasData ? (
          <svg className="fg-chart-skeleton-svg" viewBox="0 0 400 200" preserveAspectRatio="none">
            <defs>
              <linearGradient id="fg-skel-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(234,179,8,0.06)" />
                <stop offset="100%" stopColor="rgba(234,179,8,0)" />
              </linearGradient>
            </defs>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <line key={`skel-grid-${f}`} x1="28" y1={10 + f * 150} x2="380" y2={10 + f * 150} stroke={skelGridStroke} strokeWidth="0.5" strokeDasharray="2,3" />
            ))}
            {/* Left axis ticks */}
            {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
              <rect key={`t${i}`} x="4" y={7 + f * 150} rx="2" width="18" height="7" fill={skelAxisFill} />
            ))}
            {/* Right axis zone labels */}
            {[0.12, 0.35, 0.5, 0.65, 0.87].map((f, i) => (
              <rect key={`z${i}`} x="382" y={7 + (1 - f) * 150} rx="2" width="16" height="6" fill={skelZoneFill} />
            ))}
            {/* F&G line skeleton */}
            <path d="M28,120 C55,115 80,90 120,100 C160,110 185,70 220,80 C260,90 290,55 330,70 C350,78 370,60 380,65" fill="none" stroke="rgba(234,179,8,0.1)" strokeWidth="1.5" className="fg-skeleton-wave" />
            {/* Area fill */}
            <path d="M28,120 C55,115 80,90 120,100 C160,110 185,70 220,80 C260,90 290,55 330,70 C350,78 370,60 380,65 L380,160 L28,160 Z" fill="url(#fg-skel-area)" className="fg-skeleton-wave" />
            {/* BTC line skeleton */}
            <path d="M28,90 C60,85 90,70 130,75 C170,80 200,50 240,55 C280,60 310,40 350,48 C365,52 375,45 380,42" fill="none" stroke={skelBtcStroke} strokeWidth="0.8" className="fg-skeleton-wave" />
            {/* Volume bars */}
            {Array.from({ length: 20 }, (_, i) => {
              const x = 28 + (i / 19) * 352
              const h = Math.max(1, 4 + Math.sin(i * 0.7 + 1) * 8 + Math.random() * 4)
              return <rect key={`v${i}`} x={x - 6} y={170 - h} width={12} height={h} fill={skelVolFill} rx="1" />
            })}
            {/* X-axis label placeholders */}
            {[0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map((f, i) => (
              <rect key={`x${i}`} x={28 + f * 352 - 16} y="178" rx="2" width="32" height="7" fill={skelAxisFill} />
            ))}
          </svg>
        ) : (
          <>
            <ChartWatermark padX={74} padY={62} />
            <svg viewBox={`0 0 ${W} ${CHART_H}`} className="fg-chart-svg">
              <defs>
                <linearGradient id="fg-area-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(234,179,8,0.12)" />
                  <stop offset="40%" stopColor="rgba(234,179,8,0.04)" />
                  <stop offset="100%" stopColor="rgba(234,179,8,0)" />
                </linearGradient>
              </defs>
              {showEvents && <MarkerDefs />}

              {/* Very subtle zone tints */}
              {[
                { y1: 75, y2: 100, c: 'rgba(239,68,68,0.02)' },
                { y1: 55, y2: 75, c: 'rgba(234,88,12,0.015)' },
                { y1: 45, y2: 55, c: 'rgba(234,179,8,0.012)' },
                { y1: 25, y2: 45, c: 'rgba(132,204,22,0.015)' },
                { y1: 0, y2: 25, c: 'rgba(16,185,129,0.02)' },
              ].map((z) => (
                <rect key={`zone-${z.y1}-${z.y2}`} x={PAD.left} y={PAD.top + IH * (1 - z.y2 / 100)} width={IW} height={IH * (z.y2 - z.y1) / 100} fill={z.c} />
              ))}

              {/* Horizontal grid — dotted, barely visible */}
              {[0, 25, 50, 75, 100].map(v => {
                const y = PAD.top + IH - (v / 100) * IH
                return <line key={v} x1={PAD.left} y1={y} x2={PAD.left + IW} y2={y} stroke={gridStroke} strokeWidth="0.5" strokeDasharray="2,3" />
              })}

              {/* Left Y — overlay price/cap. Gate strictly: without real spread between
                  min/max, the formatter collapses all 5 ticks to the same value. */}
              {showOverlay && btcPts.length >= 2
                && Number.isFinite(btcRange.min) && Number.isFinite(btcRange.max)
                && btcRange.max > btcRange.min
                && leftLabels.map((l) => (
                <text key={`btc-label-${l.label}`} x={PAD.left - 6} y={l.y + 3} textAnchor="end" className="fg-chart-tick fg-chart-tick--btc">{l.label}</text>
              ))}

              {/* Right Y — zone labels */}
              {ZONE_LABELS.map((z) => {
                const y = PAD.top + IH - (z.y / 100) * IH
                return <text key={`zone-${z.key}`} x={PAD.left + IW + 8} y={y + 3} textAnchor="start" className="fg-chart-zone-label" fill={z.color}>{t(z.key)}</text>
              })}

              {/* X labels */}
              {xLabels.map((xl) => (
                <text key={`xl-${xl.x.toFixed(0)}-${xl.label}`} x={xl.x} y={PAD.top + IH + VOL_H + 16} textAnchor="middle" className="fg-chart-xlabel">{xl.label}</text>
              ))}

              {/* Volume bars — extremely subtle */}
              {showVol && volBars.map((b, i) => (
                <rect key={`vol-${i}-${b.x.toFixed(0)}`} x={b.x} y={b.y} width={Math.max(0.4, b.w)} height={b.h} fill={volFill} />
              ))}

              {/* Overlay line — thin, per-asset tint (BTC slate / ETH periwinkle / OTHERS teal) */}
              {showOverlay && btcPath && <path d={btcPath} fill="none" stroke={ovColor} strokeWidth="1.2" strokeLinejoin="round" />}

              {/* F&G area fill — soft gradient under the line */}
              {fgArea && <path d={fgArea} fill="url(#fg-area-fill)" />}

              {/* F&G colored line — thicker, prominent */}
              {fgSegs.map((s, i) => (
                <path key={`seg-${i}`} d={s.d} fill="none" stroke={s.c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              ))}

              {/* Event markers */}
              {showEvents && eventClusters.length > 0 && (
                <ChartEventMarkers
                  clusters={eventClusters}
                  onMarkerClick={(cluster) => { setActiveEvent(prev => prev?.id === cluster.id ? null : cluster); setHover(null) }}
                  onMarkerHover={(over) => { setHoveringMarker(over); if (over) setHover(null) }}
                  activeClusterId={activeEvent?.id}
                />
              )}

              {/* End badge — sits just inside the plot's right edge so it never
                  collides with the right-gutter zone labels (CAPITULATION/FEAR/…). */}
              {fgPts.length > 0 && (() => {
                const last = fgPts[fgPts.length - 1]
                const c = fgColor(last.value)
                const bx = last.x - 14
                return (
                  <g>
                    <rect x={bx - 12} y={last.y - 8} width={24} height={16} rx={4} fill={c} opacity="0.9" />
                    <text x={bx} y={last.y + 4} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)">{last.value}</text>
                  </g>
                )
              })()}

              {/* Drag selection overlay */}
              {dragSel && (() => {
                const sx1 = Math.min(dragSel.x1, dragSel.x2)
                const sx2 = Math.max(dragSel.x1, dragSel.x2)
                const chartTop = PAD.top
                const chartH = IH + VOL_H
                return (
                  <>
                    {/* Dim left */}
                    <rect x={PAD.left} y={chartTop} width={Math.max(0, sx1 - PAD.left)} height={chartH} fill={dimFill} className="fg-sel-dim" />
                    {/* Dim right */}
                    <rect x={sx2} y={chartTop} width={Math.max(0, PAD.left + IW - sx2)} height={chartH} fill={dimFill} className="fg-sel-dim" />
                    {/* Selection border */}
                    <rect x={sx1} y={chartTop} width={sx2 - sx1} height={chartH} fill={selRectFill} stroke={selEdgeStroke} strokeWidth="0.5" rx="2" className="fg-sel-rect" />
                    {/* Edge lines */}
                    <line x1={sx1} y1={chartTop} x2={sx1} y2={chartTop + chartH} stroke={selEdgeStroke} strokeWidth="0.5" />
                    <line x1={sx2} y1={chartTop} x2={sx2} y2={chartTop + chartH} stroke={selEdgeStroke} strokeWidth="0.5" />
                  </>
                )
              })()}

              {/* Hover crosshair */}
              {hover && !hoveringMarker && !activeEvent && !dragSel && (
                <>
                  <line x1={hover.sx} y1={PAD.top} x2={hover.sx} y2={PAD.top + IH + VOL_H} stroke={crosshairStroke} strokeWidth="0.5" strokeDasharray="2,2" />
                  {hover.fg && <circle cx={hover.sx} cy={hover.fg.y} r="4" fill={fgColor(hover.fg.value)} stroke={hoverPointStroke} strokeWidth="1.5" />}
                  {showOverlay && hover.btc && <circle cx={hover.sx} cy={hover.btc.y} r="3.5" fill={ovColor} stroke={hoverBtcStroke} strokeWidth="1" />}
                </>
              )}
            </svg>

            {/* Tooltip — hidden when interacting with event markers or dragging */}
            {hover && !hoveringMarker && !activeEvent && !dragSel && (hover.fg || hover.btc) && (
              <div className="fg-chart-tooltip" style={{ left: hover.px > 250 ? hover.px - 160 : hover.px + 14, top: 8 }}>
                {(hover.btc || hover.fg) && (
                  <span className="fg-tooltip-date">
                    {new Date(((hover.btc?.ts) || parseInt(hover.fg?.ts, 10)) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
                {hover.fg && (
                  <div className="fg-tooltip-row">
                    <span className="fg-tooltip-dot" style={{ background: fgColor(hover.fg.value) }} />
                    <span className="fg-tooltip-label">F&G</span>
                    <span className="fg-tooltip-val">{hover.fg.value}</span>
                    <span className="fg-tooltip-class" data-sentiment={hover.fg.value >= 56 ? 'greed' : hover.fg.value <= 45 ? 'fear' : 'neutral'}>{hover.fg.cls}</span>
                  </div>
                )}
                {showOverlay && hover.btc && (
                  <div className="fg-tooltip-row">
                    <span className="fg-tooltip-dot fg-tooltip-dot--btc" style={{ background: ovColor }} />
                    <span className="fg-tooltip-label">{ovLabel}</span>
                    <span className="fg-tooltip-val">{ovKind === 'cap' ? fmtCap(hover.btc.price) : fmtPrice(hover.btc.price)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Event tooltip */}
            {activeEvent && (
              <ChartEventTooltip
                cluster={activeEvent}
                W={W}
                chartWidth={dims.w}
                onClose={() => setActiveEvent(null)}
              />
            )}
          </>
        )}
      </div>
    </>
  )

  if (fullscreen) {
    return (
      <>
        {/* Inline placeholder so the page layout doesn't collapse */}
        <div className="fg-chart-card fg-card" style={{ minHeight: 300 }} />
        {/* Portal overlay — renders at body level, above sidebar/header */}
        {createPortal(
          <div className={`fg-fs-overlay ${dayMode ? 'day-mode' : ''}`}>
            <div className="fg-fs-backdrop" onClick={toggleFullscreen} />
            <div className="fg-fs-panel">
              <button type="button" className="fg-fs-close" onClick={toggleFullscreen} aria-label={t('fearGreedPage.close')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              {chartContent}
            </div>
          </div>,
          document.body
        )}
      </>
    )
  }

  return (
    <div ref={cardRef} className="fg-chart-card fg-card">
      {chartContent}
    </div>
  )
}

export default React.memo(FearGreedChart)
