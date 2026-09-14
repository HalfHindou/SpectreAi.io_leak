/**
 * LITE Compare - the /ai-charts compare + sector charts, zoomed out.
 * Crypto mode: overlay up to 4 coins OR sectors via /api/compare/chart
 * (server returns pct-normalized series - zero client math).
 * Stocks mode: overlay stocks from the universe via the Yahoo series,
 * normalized client-side. One deterministic read, no LLM.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getStockSeriesBars, searchStocks } from '@/services/stockApi'
import { getSpectreSearch } from '@/services/spectreMarketApi'
import { STOCK_UNIVERSE } from './lite-stocks'
import ChartWatermark from '@/components/chart-watermark'
import './lite-compare.css'
import { fngBand, fngLineColor, fngLineRgb, loadFngHistory, cachedFngRows } from '@/lib/fear-greed-scale'


// Distinct overlay colors - every one legible on Glass AND Paper (the old
// warm-white first line vanished on Paper's white cards).
const LINE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6']
const MAX_PICK = 6

const DAYS = [
  { id: '1W', days: 7 },
  { id: '1M', days: 30 },
  { id: '3M', days: 90 },
  { id: '6M', days: 180 },
  { id: '1Y', days: 365 },
]

const COIN_CHOICES = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'LINK', 'AVAX', 'TON']
const STOCK_CHOICES = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD']

// TTL'd: comparison lines drift all day - don't pin the first fetch.
const CMP_TTL = 10 * 60 * 1000
const _cmpCache = new Map()
const _cmpGet = (key) => {
  const e = _cmpCache.get(key)
  if (!e) return undefined
  if (Date.now() - e.ts > CMP_TTL) { _cmpCache.delete(key); return undefined }
  return e.data
}

async function loadCompare(entities, days) {
  const key = JSON.stringify([entities, days])
  const cached = _cmpGet(key)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(`/api/compare/chart?days=${days}&entities=${encodeURIComponent(JSON.stringify(entities))}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
    const payload = res.ok ? await res.json() : null
    const rows = (payload?.entities || [])
      .filter((e) => Array.isArray(e.data) && e.data.length > 1)
      .map((e) => ({ id: e.id, name: e.name || e.id, pts: e.data.map((p) => ({ t: p.ts, pct: Number(p.pct) || 0 })) }))
    if (rows.length === 0) return null
    _cmpCache.set(key, { ts: Date.now(), data: rows })
    return rows
  } catch (_) {
    return null
  }
}

const STOCK_RES = { 7: '60', 30: '1D', 90: '1D', 180: '1D', 365: '1D' }
const STOCK_SLICE = { 7: 33, 30: 21, 90: 63, 180: 126, 365: 252 }

async function loadStockCompare(syms, days) {
  const key = `stk:${syms.join(',')}:${days}`
  const cached = _cmpGet(key)
  if (cached !== undefined) return cached
  const results = await Promise.all(syms.map(async (sym) => {
    const res = await getStockSeriesBars(sym, STOCK_RES[days] || '1D').catch(() => null)
    const bars = (res?.bars || []).slice(-(STOCK_SLICE[days] || 30))
    if (bars.length < 2) return null
    const base = Number(bars[0].c)
    return {
      id: sym,
      name: sym,
      pts: bars.map((b) => ({ t: Number(b.t), pct: base > 0 ? ((Number(b.c) - base) / base) * 100 : 0 })),
    }
  }))
  const rows = results.filter(Boolean)
  if (rows.length === 0) return null
  _cmpCache.set(key, { ts: Date.now(), data: rows })
  return rows
}

const toMs = (t) => (Number(t) > 1e12 ? Number(t) : Number(t) * 1000)
function niceStep(span, target = 5) {
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(raw || 1))
  for (const m of [1, 2, 2.5, 5, 10]) { if (raw <= m * pow) return m * pow }
  return 10 * pow
}
const fmtPct = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`
function fmtTick(ms, spanDays, locale) {
  const d = new Date(ms)
  if (spanDays > 400) return d.toLocaleDateString(locale, { month: 'short', year: '2-digit' })
  if (spanDays > 3) return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}
function fmtTip(ms, spanDays, locale) {
  const d = new Date(ms)
  if (spanDays > 10) return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/* Real-pixel comparison chart: % grid + labels, date ticks, a tag on the right
   edge of every line (pushed apart when they would overlap), hover crosshair
   with every series' value at that time. Fear & Greed keeps its own 0-100
   scale across the full plot height, coloured by reading. */
function CompareChart({ series, fngRows, locale = 'en' }) {
  const [w, setW] = useState(0)
  const roRef = useRef(null)
  const hostRef = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el) return
    const measure = () => { const width = el.getBoundingClientRect().width; setW((p) => (Math.abs(p - width) < 1 ? p : width)) }
    measure()
    if (typeof ResizeObserver !== 'undefined') { roRef.current = new ResizeObserver(measure); roRef.current.observe(el) }
  }, [])
  const [hover, setHover] = useState(null)
  const H = 320

  const chart = useMemo(() => {
    if (!series || series.length === 0 || !w) return null
    const W = w
    const padL = 48, padR = 118, padT = 14, padB = 28
    const plotW = Math.max(60, W - padL - padR)
    const plotH = H - padT - padB
    let min = Infinity, max = -Infinity, t0 = Infinity, t1 = -Infinity
    const norm = series.map((s, i) => {
      const pts = s.pts.map((p) => ({ t: toMs(p.t), v: Number(p.pct) || 0 }))
      for (const p of pts) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t }
      return { id: s.id, name: s.name, color: LINE_COLORS[i % LINE_COLORS.length], pts }
    })
    if (!(max > min)) max = min + 1
    const step = niceStep(max - min, 5)
    const gMin = Math.floor(min / step) * step
    const gMax = Math.ceil(max / step) * step
    const span = gMax - gMin || 1
    const tSpan = t1 - t0 || 1
    const x = (t) => padL + ((t - t0) / tSpan) * plotW
    const y = (v) => padT + (1 - (v - gMin) / span) * plotH
    const grid = []
    for (let v = gMin; v <= gMax + 1e-9; v += step) grid.push({ v, y: y(v) })
    const lines = norm.map((s) => {
      const pts = s.pts.length > plotW * 2 ? s.pts.filter((_, j) => j % Math.ceil(s.pts.length / (plotW * 2)) === 0 || j === s.pts.length - 1) : s.pts
      const last = s.pts[s.pts.length - 1]
      return { ...s, d: pts.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(''), endX: x(last.t), endY: y(last.v), last: last.v }
    })
    // End tags: sort by y and push apart so none overlap (18px per tag).
    const tags = lines.map((l) => ({ id: l.id, name: l.name, color: l.color, last: l.last, y: l.endY, x: l.endX })).sort((a, b) => a.y - b.y)
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 18) tags[i].y = tags[i - 1].y + 18
    for (let i = tags.length - 1; i >= 0; i--) {
      const cap = padT + plotH - 2 - (tags.length - 1 - i) * 18
      if (tags[i].y > cap) tags[i].y = cap
    }
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 18) tags[i].y = tags[i - 1].y + 18
    const spanDays = tSpan / 86_400_000
    const tickCount = W < 480 ? 3 : W < 760 ? 4 : 6
    const ticks = []
    for (let k = 0; k < tickCount; k++) {
      const tt = t0 + (tSpan * k) / (tickCount - 1)
      ticks.push({ x: x(tt), label: fmtTick(tt, spanDays, locale), anchor: k === 0 ? 'start' : k === tickCount - 1 ? 'end' : 'middle' })
    }
    let fng = null
    if (fngRows?.length > 1) {
      const rows = fngRows.filter((r) => toMs(r.t) >= t0 - 86_400_000 && toMs(r.t) <= t1 + 86_400_000)
      if (rows.length > 1) {
        const fy = (v) => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH
        const fx = (tt) => padL + Math.max(0, Math.min(1, (toMs(tt) - t0) / tSpan)) * plotW
        const pts = rows.length > 220 ? rows.filter((_, j) => j % Math.ceil(rows.length / 220) === 0 || j === rows.length - 1) : rows
        const d = pts.map((p, j) => `${j ? 'L' : 'M'}${fx(p.t).toFixed(1)},${fy(p.v).toFixed(1)}`).join('')
        const area = `${d}L${fx(pts[pts.length - 1].t).toFixed(1)},${(padT + plotH).toFixed(1)}L${fx(pts[0].t).toFixed(1)},${(padT + plotH).toFixed(1)}Z`
        const segs = []
        for (let j = 1; j < pts.length; j++) {
          const a = pts[j - 1], b = pts[j]
          segs.push({ d: `M${fx(a.t).toFixed(1)},${fy(a.v).toFixed(1)}L${fx(b.t).toFixed(1)},${fy(b.v).toFixed(1)}`, c: fngLineColor((a.v + b.v) / 2) })
        }
        fng = { area, segs }
      }
    }
    return { W, H, padL, padR, padT, padB, plotW, plotH, x, y, grid, lines, tags, ticks, t0, t1, tSpan, spanDays, norm, fng }
  }, [series, fngRows, w, locale])

  const onMove = (e) => {
    if (!chart) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const f = Math.max(0, Math.min(1, (px - chart.padL) / chart.plotW))
    const tt = chart.t0 + f * chart.tSpan
    // nearest point per series by time
    const vals = chart.norm.map((s) => {
      let lo = 0, hi = s.pts.length - 1
      while (lo < hi) { const mid = (lo + hi) >> 1; if (s.pts[mid].t < tt) lo = mid + 1; else hi = mid }
      const cand = [s.pts[lo], s.pts[lo - 1]].filter(Boolean)
      const p = cand.reduce((a, b) => (Math.abs(b.t - tt) < Math.abs(a.t - tt) ? b : a))
      return { id: s.id, name: s.name, color: s.color, v: p.v, x: chart.x(p.t), y: chart.y(p.v) }
    }).sort((a, b) => b.v - a.v)
    setHover({ t: tt, x: chart.x(tt), vals })
  }

  if (!series || series.length === 0) return null
  return (
    <div className="lite-cmp-stage spectre-wm-host" ref={hostRef} style={{ height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {chart && (
        <svg width={chart.W} height={chart.H} viewBox={`0 0 ${chart.W} ${chart.H}`} aria-hidden>
          <defs>
            <linearGradient id="lite-fng-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(234,179,8,0.13)" />
              <stop offset="40%" stopColor="rgba(234,179,8,0.045)" />
              <stop offset="100%" stopColor="rgba(234,179,8,0)" />
            </linearGradient>
          </defs>
          {chart.grid.map((g) => (
            <g key={g.v}>
              <line className={`lite-cmp-grid${Math.abs(g.v) < 1e-9 ? ' lite-cmp-grid--zero' : ''}`} x1={chart.padL} x2={chart.padL + chart.plotW} y1={g.y} y2={g.y} />
              <text className={`lite-cmp-ylab${Math.abs(g.v) < 1e-9 ? ' lite-cmp-ylab--zero' : ''}`} x={chart.padL - 8} y={g.y + 3.5} textAnchor="end">{fmtPct(g.v, Math.abs(g.v) < 10 && g.v % 1 !== 0 ? 1 : 0)}</text>
            </g>
          ))}
          {chart.ticks.map((tk, i) => <text key={i} className="lite-cmp-xlab" x={tk.x} y={chart.H - 8} textAnchor={tk.anchor}>{tk.label}</text>)}
          {fngRows?.length > 1 && chart.fng && (
            <>
              <path d={chart.fng.area} fill="url(#lite-fng-fill)" stroke="none" />
              {chart.fng.segs.map((sg, i) => <path key={i} d={sg.d} fill="none" stroke={sg.c} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />)}
            </>
          )}
          {chart.lines.map((l) => (
            <g key={l.id} className={`lite-cmp-line${hover ? ' is-live' : ''}`}>
              <path d={l.d} fill="none" stroke={l.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={l.endX} cy={l.endY} r={3.5} fill={l.color} className="lite-cmp-end" />
            </g>
          ))}
          {chart.tags.map((tg) => (
            <g key={tg.id} className="lite-cmp-tag" transform={`translate(${chart.padL + chart.plotW + 8}, ${tg.y})`}>
              <rect x={0} y={-9} rx={6} ry={6} width={chart.padR - 12} height={18} fill={tg.color} />
              <text x={7} y={3.5}>{tg.name} {fmtPct(tg.last)}</text>
            </g>
          ))}
          {hover && (
            <>
              <line className="lite-cmp-cross" x1={hover.x} x2={hover.x} y1={chart.padT} y2={chart.padT + chart.plotH} />
              {hover.vals.map((v) => <circle key={v.id} cx={v.x} cy={v.y} r={4} fill={v.color} className="lite-cmp-hdot" />)}
            </>
          )}
        </svg>
      )}
      {hover && chart && (
        <div className="lite-cmp-tip" data-side={hover.x > chart.W * 0.6 ? 'left' : 'right'} style={{ left: hover.x }}>
          <span className="lite-cmp-tip-date">{fmtTip(hover.t, chart.spanDays, locale)}</span>
          {hover.vals.map((v) => (
            <span key={v.id} className="lite-cmp-tip-row"><i style={{ background: v.color }} />{v.name}<strong className={v.v >= 0 ? 'up' : 'down'}>{fmtPct(v.v)}</strong></span>
          ))}
        </div>
      )}
      <ChartWatermark corner="bl" padX={58} padY={34} />
    </div>
  )
}

export default function CompareView({ data, onOpenPath, market }) {
  const { t, i18n } = useTranslation()
  const isStocks = market === 'stocks'
  const [kind, setKind] = useState('coins') // coins | sectors (crypto only)
  const [days, setDays] = useState(30)
  const [picked, setPicked] = useState(isStocks ? ['AAPL', 'NVDA'] : ['BTC', 'ETH'])
  const [series, setSeries] = useState(null)
  // Search-added entries beyond the preset chips (PRO-style entity search).
  const [extra, setExtra] = useState([])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [fngOn, setFngOn] = useState(false)
  const [fngRows, setFngRows] = useState(cachedFngRows)

  const sectorChoices = useMemo(() => (
    (data?.sectors || []).filter((s) => s.slug || s.cgId).slice(0, 10)
  ), [data?.sectors])

  const baseChoices = isStocks
    ? STOCK_CHOICES.map((s) => ({ id: s, label: s }))
    : kind === 'sectors'
      ? sectorChoices.map((s) => ({ id: s.slug || s.cgId, label: s.name }))
      : COIN_CHOICES.map((s) => ({ id: s, label: s }))
  const choices = [...baseChoices, ...extra.filter((e) => !baseChoices.some((b) => b.id === e.id))]

  useEffect(() => {
    // Mode/kind switches reset defaults - sectors compare EVERYTHING at once.
    setExtra([]); setQ(''); setHits(null)
    if (isStocks) setPicked(['AAPL', 'NVDA'])
    else if (kind === 'sectors') setPicked(sectorChoices.slice(0, MAX_PICK).map((s) => s.slug || s.cgId))
    else setPicked(['BTC', 'ETH'])
  }, [isStocks, kind, sectorChoices.length])

  const toggle = (id) => {
    setPicked((prev) => (prev.includes(id)
      ? (prev.length > 1 ? prev.filter((x) => x !== id) : prev)
      : prev.length >= MAX_PICK ? prev : [...prev, id]))
  }

  // Dropping a line from the legend is the same act as unpicking its chip -
  // one list, so the chip un-highlights the moment the line goes.
  const remove = (id) => setPicked((prev) => (prev.length > 1 ? prev.filter((x) => x !== id) : prev))

  useEffect(() => {
    if (!fngOn || fngRows) return undefined
    let cancelled = false
    loadFngHistory().then((rows) => { if (!cancelled) setFngRows(rows) }).catch(() => {})
    return () => { cancelled = true }
  }, [fngOn, fngRows])

  // PRO-style search: any coin (spectre search carries the cg id the compare
  // lane needs) or any stock ticker.
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2 || kind === 'sectors') { setHits(null); return undefined }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        if (isStocks) {
          const res = await searchStocks(query)
          if (!cancelled) setHits((Array.isArray(res) ? res : []).filter((r) => r?.symbol).slice(0, 6).map((r) => ({ id: String(r.symbol).toUpperCase(), label: String(r.symbol).toUpperCase(), name: r.name || r.shortname || '' })))
        } else {
          const res = await getSpectreSearch(query, 12)
          if (!cancelled) setHits((res?.coins || []).filter((c) => c.coingecko_id).slice(0, 6).map((c) => ({ id: String(c.symbol || '').toUpperCase(), label: String(c.symbol || '').toUpperCase(), name: c.name || '', cgId: c.coingecko_id })))
        }
      } catch (_) { if (!cancelled) setHits([]) }
    }, 280)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, isStocks, kind])

  const addFromSearch = (hit) => {
    setExtra((prev) => (prev.some((e) => e.id === hit.id) ? prev : [...prev, hit]))
    setPicked((prev) => (prev.includes(hit.id) || prev.length >= MAX_PICK ? prev : [...prev, hit.id]))
    setQ(''); setHits(null)
  }

  useEffect(() => {
    let cancelled = false
    setSeries(null)
    const run = async () => {
      if (picked.length === 0) return
      if (isStocks) {
        const rows = await loadStockCompare(picked, days)
        if (!cancelled && rows) setSeries(rows)
        return
      }
      const entities = kind === 'sectors'
        ? picked.map((id) => ({ type: 'sector', id, name: sectorChoices.find((s) => (s.slug || s.cgId) === id)?.name || id }))
        : picked.map((sym) => ({ type: 'token', id: SYMBOL_TO_COINGECKO_ID[sym] || extra.find((e) => e.id === sym)?.cgId, name: sym })).filter((e) => e.id)
      if (entities.length === 0) return
      const rows = await loadCompare(entities, days)
      if (!cancelled && rows) setSeries(rows)
    }
    run().catch(() => {})
    return () => { cancelled = true }
  }, [picked, days, kind, isStocks, extra])

  const legend = useMemo(() => {
    if (!series) return []
    return series.map((s, i) => ({
      id: s.id,
      name: s.name,
      color: LINE_COLORS[i % LINE_COLORS.length],
      last: s.pts[s.pts.length - 1]?.pct ?? 0,
    })).sort((a, b) => b.last - a.last)
  }, [series])

  const fngLatest = fngOn && fngRows?.length ? fngRows[fngRows.length - 1].v : null

  const read = legend.length >= 2
    ? t('lite.msg.compare_read', '{{a}} leads this window at {{ap}}%, while {{b}} trails at {{bp}}%.', {
      a: legend[0].name,
      ap: `${legend[0].last >= 0 ? '+' : ''}${legend[0].last.toFixed(1)}`,
      b: legend[legend.length - 1].name,
      bp: `${legend[legend.length - 1].last >= 0 ? '+' : ''}${legend[legend.length - 1].last.toFixed(1)}`,
    })
    : null

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Compare', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Put performance side by side - who actually won the window.', 'sub')}</p>
      </header>

      <div className="lite-toolrow lite-rise">
        {!isStocks && (
          <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.compareview.ariaCompareKind', "Compare kind")}>
            {[{ id: 'coins', label: 'Coins' }, { id: 'sectors', label: 'Sectors' }].map((k) => (
              <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} className={`lite-tf-btn${kind === k.id ? ' active' : ''}`} onClick={() => setKind(k.id)}>{tl(t, k.label)}</button>
            ))}
          </div>
        )}
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.compareview.ariaWindow', "Window")}>
          {DAYS.map((d) => (
            <button key={d.id} type="button" role="tab" aria-selected={days === d.days} className={`lite-tf-btn${days === d.days ? ' active' : ''}`} onClick={() => setDays(d.days)}>{d.id}</button>
          ))}
        </div>
        <div className="lite-tf-toggle">
          <button
            type="button"
            aria-pressed={fngOn}
            className={`lite-tf-btn lite-fng-btn${fngOn ? ' active' : ''}`}
            onClick={() => setFngOn((v) => !v)}
            title={tl(t, 'Overlay the Fear & Greed index', 'lbl')}
            style={fngOn && fngLatest != null ? { '--fng-rgb': fngLineRgb(fngLatest), '--fng': fngLineColor(fngLatest) } : undefined}
          >
            <span className="lite-fng-swatch" />
            {tl(t, 'F&G', 'lbl')}
            {fngOn && fngLatest != null && <strong>{Math.round(fngLatest)}</strong>}
          </button>
        </div>
      </div>

      {kind !== 'sectors' && (
        <div className="lite-rise lite-search-wrap">
          <div className="lite-search">
            <svg className="lite-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input
              type="text"
              className="lite-search-input"
              value={q}
              placeholder={tl(t, 'Add anything to the chart', 'lbl')}
              onChange={(e) => setQ(e.target.value)}
            />
            {hits && hits.length > 0 && (
              <div className="lite-search-drop">
                {hits.map((h) => (
                  <div key={h.id} className="lite-search-row" role="button" tabIndex={0}
                    onMouseDown={(e) => { e.preventDefault(); addFromSearch(h) }}>
                    <span className="lite-trow-id"><strong>{h.name || h.label}</strong><em>{h.label}</em></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="lite-chips lite-rise" aria-label={t('lite.compareview.ariaPickEntities', "Pick entities")}>
        {choices.map((c) => (
          <button key={c.id} type="button" className={`lite-chip${picked.includes(c.id) ? ' active' : ''}`} onClick={() => toggle(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <section className="lite-panel lite-rise-1">
        {series === null ? (
          <ul className="lite-skel" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </ul>
        ) : (
          <>
            <div className="lite-cmp-legend">
              {legend.map((l) => (
                <span key={l.id} className="lite-cmp-key">
                  <span className="lite-cmp-dot" style={{ background: l.color, color: l.color }} />
                  {l.name}
                  <strong className={l.last >= 0 ? 'up' : 'down'}>{l.last >= 0 ? '+' : ''}{l.last.toFixed(1)}%</strong>
                  {picked.length > 1 && (
                    <button
                      type="button"
                      className="lite-cmp-x"
                      onClick={() => remove(l.id)}
                      aria-label={`Remove ${l.name}`}
                      title={`Remove ${l.name}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </span>
              ))}
              {fngOn && (
                <span className="lite-cmp-key lite-cmp-key--fng">
                  <span className="lite-cmp-dot lite-cmp-dot--ramp" />
                  {tl(t, 'Fear & Greed', 'lbl')}
                  {fngLatest != null && (
                    <strong style={{ color: fngLineColor(fngLatest) }}>{Math.round(fngLatest)} {tl(t, fngBand(fngLatest).label, 'lbl')}</strong>
                  )}
                  <button
                    type="button"
                    className="lite-cmp-x"
                    onClick={() => setFngOn(false)}
                    aria-label={t('lite.compareview.ariaRemoveFearGreedOverlay', "Remove Fear & Greed overlay")}
                    title={t('lite.compareview.title', "Remove Fear & Greed overlay")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </span>
              )}
            </div>
            <CompareChart series={series} fngRows={fngOn ? fngRows : null} locale={i18n.language || 'en'} />
            {read && <p className="lite-tech-read" style={{ marginTop: 14, marginBottom: 0 }}>{read}</p>}
          </>
        )}
        <p className="lite-social-note">{tl(t, 'Every line starts at zero - the chart shows pure performance over the window, not price levels.', 'msg')}</p>
      </section>
    </div>
  )
}
