/**
 * MentionChart — where price meets the crowd.
 *
 * The token's price line over a window, annotated with the KOL mention flow:
 *   • Each tweet is placed on the price line at the moment it was posted.
 *   • Tweets that land close together in TIME collapse into ONE cluster
 *     marker (top voice's avatar + a "+N" badge) — no more vertical towers.
 *   • Marker ring color = the top voice's reach tier (gold 500k+ /
 *     violet 100k+ / blue 30k+), size scales with reach + cluster weight.
 *   • A mention-density lane under the price shows WHEN the crowd arrived;
 *     the peak bucket is called out in the header.
 *   • If Spectre's momentum ledger recorded an entry, a "Spotted $X" pin
 *     drops a vertical line at that moment — the receipt, on the chart.
 *
 * Pure SVG: cheap, crisp, pannable/zoomable in fullscreen.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import './mention-chart.css'

const RANGES = [
  { key: '24h', label: '24H', days: 1 },
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
]

/* Reach tiers — same language the bubbles legend speaks. */
const TIERS = [
  { min: 500_000, key: 'gold', color: '#fbbf24', glow: 'rgba(251,191,36,0.55)' },
  { min: 100_000, key: 'violet', color: '#a78bfa', glow: 'rgba(167,139,250,0.5)' },
  { min: 30_000, key: 'blue', color: '#60a5fa', glow: 'rgba(96,165,250,0.5)' },
  { min: 0, key: 'base', color: 'rgba(245,245,247,0.5)', glow: 'rgba(245,245,247,0.25)' },
]
function tierOf(followers) {
  const f = Number(followers) || 0
  return TIERS.find((t) => f >= t.min) || TIERS[TIERS.length - 1]
}

function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
function fmtDate(ts) { return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) }
function fmtPrice(p) {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1) return `$${p.toFixed(2)}`
  if (p >= 0.01) return `$${p.toFixed(4)}`
  return `$${p.toPrecision(3)}`
}
function fmtUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}
function fmtCompact(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return `${Math.round(v)}`
}
function timeAgo(ts) {
  if (!ts) return ''
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/* Nearest price sample to a timestamp, interpolated. */
function priceAt(prices, ts) {
  if (!prices || !prices.length) return null
  if (ts <= prices[0][0]) return prices[0][1]
  if (ts >= prices[prices.length - 1][0]) return prices[prices.length - 1][1]
  let lo = 0, hi = prices.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (prices[mid][0] < ts) lo = mid; else hi = mid
  }
  const [t0, p0] = prices[lo], [t1, p1] = prices[hi]
  return p0 + (p1 - p0) * ((ts - t0) / Math.max(1, t1 - t0))
}

export default function MentionChart({
  cgId, mentions = [], onSelectMention, onHoverMention, onPriceData,
  projectName, projectAvatar, fullScreen = false, defaultHeight = 220,
}) {
  const [range, setRange] = useState('7d')
  const [data, setData] = useState({ prices: null, loading: true, error: null })
  const [spotted, setSpotted] = useState(null)
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)
  const [hoveredCluster, setHoveredCluster] = useState(null)
  const [width, setWidth] = useState(fullScreen ? 1100 : 380)
  const [viewport, setViewport] = useState(null)
  const dragRef = useRef(null)

  /* Width observer */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w && Math.abs(w - width) > 2) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Price series */
  useEffect(() => {
    if (!cgId) return undefined
    let cancelled = false
    setData((d) => ({ ...d, loading: true, error: null }))
    const days = RANGES.find((r) => r.key === range)?.days || 7
    fetch(`/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => { if (!cancelled) setData({ prices: json?.prices || null, loading: false, error: null }) })
      .catch((err) => { if (!cancelled) setData({ prices: null, loading: false, error: err.message }) })
    return () => { cancelled = true }
  }, [cgId, range])

  /* Spotted receipt — best-effort; renders nothing when the token was never spotted. */
  useEffect(() => {
    if (!cgId) { setSpotted(null); return undefined }
    let cancelled = false
    setSpotted(null)
    fetch(`/api/xdash/momentum-origin/${encodeURIComponent(cgId)}`, { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return
        const d = json?.data
        if (d?.first_entered_at && Number(d.entry_market_cap) > 0) setSpotted(d)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [cgId])

  /* Geometry */
  const height = fullScreen ? Math.max(520, Math.floor(window.innerHeight * 0.66)) : defaultHeight
  const padL = fullScreen ? 14 : 6
  const padR = fullScreen ? 54 : 44
  const padT = fullScreen ? 18 : 12
  const laneH = fullScreen ? 22 : 14        // mention density lane
  const laneGap = 16
  const xAxisH = 20
  const padB = laneH + laneGap + xAxisH
  const innerW = Math.max(40, width - padL - padR)
  const innerH = Math.max(60, height - padT - padB)
  const markerR = fullScreen ? 15 : 10

  useEffect(() => { setViewport(null) }, [data.prices, range, cgId])

  const geom = useMemo(() => {
    const prices = data.prices
    if (!prices || prices.length < 2) return null
    const dataMin = prices[0][0], dataMax = prices[prices.length - 1][0]
    const tMin = viewport ? Math.max(dataMin, viewport[0]) : dataMin
    const tMax = viewport ? Math.min(dataMax, viewport[1]) : dataMax
    let pMin = Infinity, pMax = -Infinity
    for (const [t, p] of prices) {
      if (t < tMin || t > tMax) continue
      if (p < pMin) pMin = p
      if (p > pMax) pMax = p
    }
    if (!Number.isFinite(pMin) || !Number.isFinite(pMax)) { pMin = prices[0][1]; pMax = prices[prices.length - 1][1] }
    if (pMin === pMax) { pMin -= 1; pMax += 1 }
    // headroom so the top of the move isn't flush with the chart ceiling
    const span = pMax - pMin
    pMax += span * 0.08
    pMin -= span * 0.04
    const tToX = (t) => padL + ((t - tMin) / (tMax - tMin)) * innerW
    const pToY = (p) => padT + innerH - ((p - pMin) / (pMax - pMin)) * innerH

    let line = '', area = '', first = true
    for (let i = 0; i < prices.length; i++) {
      const [t, p] = prices[i]
      if (t < tMin || t > tMax) continue
      const x = tToX(t).toFixed(2), y = pToY(p).toFixed(2)
      if (first) { line += `M ${x} ${y} `; area += `M ${x} ${(padT + innerH).toFixed(1)} L ${x} ${y}`; first = false }
      else { line += `L ${x} ${y} `; area += ` L ${x} ${y}` }
    }
    if (!first) area += ` L ${tToX(tMax).toFixed(2)} ${(padT + innerH).toFixed(1)} Z`

    const yTicks = []
    for (let i = 0; i < 4; i++) { const v = pMin + ((pMax - pMin) * i) / 3; yTicks.push({ y: pToY(v), v }) }
    const xTicks = []
    for (let i = 0; i < 5; i++) { const t = tMin + ((tMax - tMin) * i) / 4; xTicks.push({ x: tToX(t), t }) }

    // High / low pins across the visible window
    let hiT = tMin, loT = tMin
    for (const [t, p] of prices) {
      if (t < tMin || t > tMax) continue
      if (p >= pMax - span * 0.081) { hiT = t }
    }
    return { tToX, pToY, tMin, tMax, pMin, pMax, line, area, yTicks, xTicks, hiT, loT }
  }, [data.prices, width, innerW, innerH, viewport, padT, padL])

  /* Cluster mentions by proximity in X. This is the fix for the tower:
   * neighbors within clusterGap collapse into one marker. */
  const clusters = useMemo(() => {
    if (!geom || !mentions?.length) return []
    const placed = []
    for (const m of mentions) {
      if (!m?.createdAt) continue
      const ts = new Date(m.createdAt).getTime()
      if (!Number.isFinite(ts) || ts < geom.tMin || ts > geom.tMax) continue
      const price = priceAt(data.prices, ts)
      if (price == null) continue
      const eng = (Number(m.likes) || 0) + (Number(m.retweets) || 0) * 2 + (Number(m.replies) || 0)
      placed.push({ ...m, ts, price, eng, x: geom.tToX(ts), y: geom.pToY(price) })
    }
    placed.sort((a, b) => a.x - b.x)
    const gap = markerR * 2.6
    const groups = []
    for (const p of placed) {
      const last = groups[groups.length - 1]
      if (last && p.x - last.cx < gap) {
        last.members.push(p)
        last.sumX += p.x; last.sumY += p.y
        last.cx = last.sumX / last.members.length
        last.cy = last.sumY / last.members.length
      } else {
        groups.push({ members: [p], sumX: p.x, sumY: p.y, cx: p.x, cy: p.y })
      }
    }
    return groups.map((g, i) => {
      // Representative = highest follower, tiebreak engagement
      const top = g.members.reduce((a, b) => {
        const fa = Number(a.author?.followers) || 0, fb = Number(b.author?.followers) || 0
        if (fb !== fa) return fb > fa ? b : a
        return b.eng > a.eng ? b : a
      })
      const maxFollowers = Math.max(...g.members.map((m) => Number(m.author?.followers) || 0))
      const tier = tierOf(maxFollowers)
      // size: base + cluster weight (count) + reach nudge
      const sizeBoost = Math.min(1, (g.members.length - 1) * 0.12 + (maxFollowers >= 100_000 ? 0.18 : 0))
      const r = markerR * (1 + sizeBoost)
      return {
        id: top.id || `cl-${i}`,
        x: g.cx,
        y: g.cy,
        r,
        tier,
        count: g.members.length,
        top,
        members: g.members,
        maxFollowers,
      }
    })
  }, [geom, mentions, data.prices, markerR])

  /* Mention density lane — bin visible-window mentions into buckets. */
  const density = useMemo(() => {
    if (!geom) return { bars: [], peak: null }
    const N = fullScreen ? 56 : 30
    const buckets = new Array(N).fill(0)
    const span = geom.tMax - geom.tMin || 1
    let total = 0
    for (const m of mentions) {
      if (!m?.createdAt) continue
      const ts = new Date(m.createdAt).getTime()
      if (!Number.isFinite(ts) || ts < geom.tMin || ts > geom.tMax) continue
      const bi = Math.min(N - 1, Math.floor(((ts - geom.tMin) / span) * N))
      buckets[bi] += 1; total += 1
    }
    const max = Math.max(1, ...buckets)
    let peakIdx = -1
    buckets.forEach((v, i) => { if (v === max && max > 0) peakIdx = i })
    const laneTop = padT + innerH + laneGap
    const bw = innerW / N
    const bars = buckets.map((v, i) => ({
      x: padL + i * bw + bw * 0.28,
      w: Math.max(1.5, bw * 0.44),
      h: v > 0 ? Math.max(2, (v / max) * laneH) : 0,
      v,
      isPeak: i === peakIdx && v > 1,
    }))
    const peakT = peakIdx >= 0 ? geom.tMin + ((peakIdx + 0.5) / N) * span : null
    return { bars, laneTop, peakT, total }
  }, [geom, mentions, innerW, innerH, padT, padL, laneH, laneGap, fullScreen])

  /* Spotted marker geometry */
  const spottedX = useMemo(() => {
    if (!spotted?.first_entered_at || !geom) return null
    const ts = new Date(spotted.first_entered_at).getTime()
    if (!Number.isFinite(ts)) return null
    // clamp into the visible window so the pin stays on-screen
    const clamped = Math.min(Math.max(ts, geom.tMin), geom.tMax)
    return { x: geom.tToX(clamped), off: ts < geom.tMin }
  }, [spotted, geom])

  /* Interaction: crosshair + pan */
  const onMove = (e) => {
    if (!geom) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (dragRef.current) {
      const dx = px - dragRef.current.startX
      const shift = -dx * (dragRef.current.startSpan / innerW)
      const newStart = dragRef.current.startTMin + shift
      const span = dragRef.current.startSpan
      const dataMin = data.prices[0][0], dataMax = data.prices[data.prices.length - 1][0]
      let s = Math.max(dataMin, newStart), en = s + span
      if (en > dataMax) { en = dataMax; s = en - span }
      setViewport([s, en]); return
    }
    if (px < padL || px > padL + innerW) { setHover(null); return }
    const t = geom.tMin + ((px - padL) / innerW) * (geom.tMax - geom.tMin)
    const p = priceAt(data.prices, t)
    setHover({ x: px, y: geom.pToY(p), t, p })
  }
  const onLeave = () => { setHover(null); dragRef.current = null }
  const onMouseDown = (e) => {
    if (!geom || !fullScreen) return
    dragRef.current = {
      startX: e.clientX - e.currentTarget.getBoundingClientRect().left,
      startTMin: geom.tMin, startSpan: geom.tMax - geom.tMin,
    }
  }
  const onMouseUp = () => { dragRef.current = null }
  const onWheel = (e) => {
    if (!geom || !fullScreen) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (px < padL || px > padL + innerW) return
    const tCursor = geom.tMin + ((px - padL) / innerW) * (geom.tMax - geom.tMin)
    const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18
    const dataMin = data.prices[0][0], dataMax = data.prices[data.prices.length - 1][0]
    let newSpan = Math.max(10 * 60 * 1000, Math.min(dataMax - dataMin, (geom.tMax - geom.tMin) * factor))
    const leftFrac = (tCursor - geom.tMin) / (geom.tMax - geom.tMin)
    let s = tCursor - newSpan * leftFrac, en = s + newSpan
    if (s < dataMin) { s = dataMin; en = s + newSpan }
    if (en > dataMax) { en = dataMax; s = en - newSpan }
    setViewport([s, en])
  }

  const isZoomed = viewport && (
    viewport[0] > (data.prices?.[0]?.[0] || 0) + 1 ||
    viewport[1] < (data.prices?.[data.prices.length - 1]?.[0] || Infinity) - 1
  )

  const currentPrice = data.prices?.length ? data.prices[data.prices.length - 1][1] : null
  const firstPrice = data.prices?.length ? data.prices[0][1] : null
  const pct = (currentPrice != null && firstPrice) ? ((currentPrice - firstPrice) / firstPrice) * 100 : null
  const pctUp = (pct ?? 0) >= 0
  const up = pctUp
  const lineFrom = up ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)'
  const lineTo = up ? 'rgba(52,211,153,1)' : 'rgba(248,113,113,1)'

  /* Window high/low from the full series */
  const winStat = useMemo(() => {
    if (!Array.isArray(data.prices) || !data.prices.length) return null
    let hi = -Infinity, lo = Infinity
    for (const [, p] of data.prices) { if (p > hi) hi = p; if (p < lo) lo = p }
    return { hi: Number.isFinite(hi) ? hi : null, lo: Number.isFinite(lo) ? lo : null }
  }, [data.prices])

  /* Surface price context to parent sidebar */
  useEffect(() => {
    if (!onPriceData) return
    if (currentPrice == null) { onPriceData(null); return }
    onPriceData({
      price: currentPrice, pct, range,
      high: winStat?.hi ?? null, low: winStat?.lo ?? null,
      windowStart: data.prices?.[0]?.[0] || null,
      windowEnd: data.prices?.[data.prices?.length - 1]?.[0] || null,
      mentionCount: clusters.reduce((s, c) => s + c.count, 0),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrice, pct, range, data.prices, clusters.length, winStat])

  const totalInWindow = clusters.reduce((s, c) => s + c.count, 0)

  return (
    <div className={`mch${fullScreen ? ' mch--full' : ''}`} ref={wrapRef}>
      {/* Header */}
      <div className="mch__head">
        <div className="mch__head-l">
          <div className="mch__title">
            {projectAvatar && <img className="mch__title-logo" src={projectAvatar} alt="" />}
            <span>{projectName || 'Price'} · <span className="mch__title-sub">KOL flow</span></span>
          </div>
          <div className="mch__stats">
            {currentPrice != null && <span className="mch__price mono">{fmtPrice(currentPrice)}</span>}
            {pct != null && <span className={`mch__delta mono ${pctUp ? 'up' : 'dn'}`}>{pctUp ? '+' : ''}{pct.toFixed(1)}%</span>}
            {winStat?.hi != null && <span className="mch__stat mono">H {fmtPrice(winStat.hi)}</span>}
            {winStat?.lo != null && <span className="mch__stat mono">L {fmtPrice(winStat.lo)}</span>}
            <span className="mch__stat mch__stat-buzz mono">{totalInWindow} mentions</span>
            {density.peakT && totalInWindow > 2 && (
              <span className="mch__peak">peak {range === '24h' ? fmtTime(density.peakT) : fmtDate(density.peakT)}</span>
            )}
          </div>
        </div>
        <div className="mch__ranges">
          {RANGES.map(({ key, label }) => (
            <button key={key} type="button" className={`mch__range${range === key ? ' is-on' : ''}`} onClick={() => setRange(key)}>{label}</button>
          ))}
          {fullScreen && isZoomed && (
            <button type="button" className="mch__range mch__reset" onClick={() => setViewport(null)} title="Reset zoom">Reset</button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="mch__canvas" style={{ height }}>
        {data.loading && <div className="mch__loading"><span className="mch__shimmer" /></div>}
        {!data.loading && data.error && <div className="mch__empty">Price feed unavailable for this token</div>}

        {geom && (
          <svg
            width={width} height={height} viewBox={`0 0 ${width} ${height}`}
            onMouseMove={onMove} onMouseLeave={onLeave} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onWheel={onWheel}
            style={{ cursor: fullScreen ? (dragRef.current ? 'grabbing' : 'crosshair') : 'default', touchAction: fullScreen ? 'none' : 'auto' }}
          >
            <defs>
              <linearGradient id="mch-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={up ? '#10b981' : '#ef4444'} stopOpacity="0.32" />
                <stop offset="55%" stopColor={up ? '#10b981' : '#ef4444'} stopOpacity="0.08" />
                <stop offset="100%" stopColor={up ? '#10b981' : '#ef4444'} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="mch-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={lineFrom} />
                <stop offset="100%" stopColor={lineTo} />
              </linearGradient>
              <filter id="mch-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Y gridlines */}
            {geom.yTicks.map((tk, i) => (
              <line key={`y-${i}`} x1={padL} x2={padL + innerW} y1={tk.y} y2={tk.y} stroke="rgba(255,255,255,0.038)" strokeWidth="1" strokeDasharray="2 5" />
            ))}

            {/* Spotted receipt pin — behind the price line */}
            {spottedX && (
              <g className="mch__spotted">
                <line x1={spottedX.x} x2={spottedX.x} y1={padT} y2={padT + innerH} stroke="rgba(245,245,247,0.28)" strokeWidth="1" strokeDasharray="3 3" />
                <g transform={`translate(${spottedX.x}, ${padT + 2})`}>
                  <circle cx="0" cy="0" r="3" fill="#f5f5f7" />
                  <rect x="6" y="-9" width={fullScreen ? 108 : 78} height="17" rx="8.5" fill="rgba(17,17,19,0.92)" stroke="rgba(255,255,255,0.14)" />
                  <text x="13" y="3" fontSize={fullScreen ? '10.5' : '9'} fontWeight="600" fill="#f5f5f7" fontFamily="var(--font-mono)">
                    Spotted {fmtUsd(spotted?.entry_market_cap)}
                  </text>
                </g>
              </g>
            )}

            {/* Area + line (line carries a soft under-glow for depth) */}
            <path d={geom.area} fill="url(#mch-fill)" />
            <path d={geom.line} fill="none" stroke="url(#mch-stroke)" strokeWidth={fullScreen ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 5px ${up ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'})` }} />

            {/* Y price labels */}
            {geom.yTicks.map((tk, i) => (
              <text key={`yl-${i}`} x={padL + innerW + 6} y={tk.y + 3} textAnchor="start" fontSize="9.5" fill="rgba(245,245,247,0.4)" fontFamily="var(--font-mono)" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(tk.v)}</text>
            ))}

            {/* Mention-flow lane — bars grow DOWN from a hairline baseline, so
                they read as a density strip, not floating blocks. No label
                (it collided with the date axis). */}
            <g className="mch__lane">
              <line x1={padL} x2={padL + innerW} y1={density.laneTop} y2={density.laneTop} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              {density.bars.map((b, i) => b.h > 0 && (
                <rect key={`d-${i}`} x={b.x} y={density.laneTop} width={b.w} height={b.h} rx="1.5"
                  fill={b.isPeak ? (up ? 'rgba(52,211,153,0.72)' : 'rgba(248,113,113,0.72)') : 'rgba(245,245,247,0.16)'} />
              ))}
            </g>

            {/* X time labels */}
            {geom.xTicks.map((tk, i) => (
              <text key={`xl-${i}`} x={tk.x} y={height - 6} textAnchor={i === 0 ? 'start' : i === geom.xTicks.length - 1 ? 'end' : 'middle'} fontSize="9.5" fill="rgba(245,245,247,0.4)" fontFamily="var(--font-mono)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {range === '24h' ? fmtTime(tk.t) : fmtDate(tk.t)}
              </text>
            ))}

            {/* Crosshair */}
            {hover && (
              <>
                <line x1={hover.x} x2={hover.x} y1={padT} y2={padT + innerH} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 3" />
                <circle cx={hover.x} cy={hover.y} r="3.5" fill="#f5f5f7" />
              </>
            )}

            {/* Cluster markers */}
            {clusters.map((c) => {
              const isHov = hoveredCluster?.id === c.id
              // Avatar sits JUST off the price line (short 5px gap) — not on a
              // long dangling string. Flips below when the point sits high.
              const placeBelow = c.y < padT + innerH * 0.42
              const dir = placeBelow ? 1 : -1
              const avatarCy = c.y + dir * (c.r + 5)
              const gold = c.tier.key === 'gold'
              return (
                <g key={c.id} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => { setHoveredCluster(c); onHoverMention?.(c.top) }}
                  onMouseLeave={() => { setHoveredCluster((p) => (p?.id === c.id ? null : p)); onHoverMention?.(null) }}
                  onClick={() => { if (c.top.url) window.open(c.top.url, '_blank', 'noopener,noreferrer'); onSelectMention?.(c.top) }}
                >
                  {/* stem */}
                  <line x1={c.x} y1={c.y} x2={c.x} y2={avatarCy} stroke={isHov ? c.tier.color : 'rgba(245,245,247,0.3)'} strokeWidth="1.2" />
                  {/* anchor dot on the price line */}
                  <circle cx={c.x} cy={c.y} r={fullScreen ? 3.5 : 2.5} fill="#f5f5f7" />
                  {/* avatar */}
                  <g transform={`translate(${c.x}, ${avatarCy})`} filter={gold ? 'url(#mch-glow)' : undefined}>
                    <circle cx="0" cy="0" r={c.r + 1.5} fill={c.tier.color} opacity={isHov ? 0.9 : 0.65} />
                    <circle cx="0" cy="0" r={c.r} fill="rgba(16,18,26,1)" />
                    <clipPath id={`mch-clip-${c.id}`}><circle cx="0" cy="0" r={c.r - 1.5} /></clipPath>
                    {c.top.author?.avatar
                      ? <image href={c.top.author.avatar} x={-(c.r - 1.5)} y={-(c.r - 1.5)} width={(c.r - 1.5) * 2} height={(c.r - 1.5) * 2} clipPath={`url(#mch-clip-${c.id})`} preserveAspectRatio="xMidYMid slice" />
                      : <text x="0" y="4" textAnchor="middle" fontSize={c.r * 0.9} fontWeight="600" fill="rgba(245,245,247,0.7)">{(c.top.author?.handle || '?').slice(0, 1).toUpperCase()}</text>}
                    {/* +N badge */}
                    {c.count > 1 && (
                      <g transform={`translate(${c.r * 0.72}, ${c.r * 0.72})`}>
                        <circle cx="0" cy="0" r={fullScreen ? 8 : 6} fill="rgba(16,18,26,1)" stroke={c.tier.color} strokeWidth="1.2" />
                        <text x="0" y={fullScreen ? 3 : 2.5} textAnchor="middle" fontSize={fullScreen ? '9' : '7.5'} fontWeight="700" fill="#f5f5f7">+{c.count - 1}</text>
                      </g>
                    )}
                  </g>
                </g>
              )
            })}
          </svg>
        )}

        {/* Cursor price readout */}
        {hover && (
          <div className="mch__cursor" style={{ left: Math.min(hover.x, width - 90) }}>
            <span className="mch__cursor-p mono">{fmtPrice(hover.p)}</span>
            <span className="mch__cursor-t mono">{range === '24h' ? fmtTime(hover.t) : fmtDate(hover.t)}</span>
          </div>
        )}

        {/* Hovered cluster tweet card */}
        {hoveredCluster && (() => {
          const c = hoveredCluster
          const tipW = 268, tipH = 150
          const ax = c.x, ay = c.y
          const placeBelow = ay < height / 2
          const top = placeBelow ? Math.min(height - tipH - 8, ay + 40) : Math.max(8, ay - tipH - 20)
          const fitsRight = ax + tipW + 20 < width
          const left = fitsRight ? Math.min(width - tipW - 8, ax + 24) : Math.max(8, Math.min(width - tipW - 8, ax - tipW - 24))
          const m = c.top
          return (
            <div className="mch__tip" style={{ left, top, width: tipW }}>
              <div className="mch__tip-head">
                {m.author?.avatar && <img src={m.author.avatar} alt="" className="mch__tip-avatar" style={{ borderColor: c.tier.color }} />}
                <div className="mch__tip-id">
                  <div className="mch__tip-name">{m.author?.name || '—'}{m.author?.verified && <span className="mch__tip-check">✓</span>}</div>
                  <div className="mch__tip-meta">@{m.author?.handle} · {fmtCompact(m.author?.followers)} followers · {timeAgo(m.createdAt)}</div>
                </div>
              </div>
              <div className="mch__tip-text">{(m.text || '').slice(0, 180)}{(m.text || '').length > 180 ? '…' : ''}</div>
              <div className="mch__tip-foot mono">
                <span>{fmtPrice(c.top.price)}</span>
                <span>{fmtCompact(m.likes)} ♥</span>
                <span>{fmtCompact(m.retweets)} ⟲</span>
                <span>{fmtCompact(m.views)} views</span>
              </div>
              {c.count > 1 && <div className="mch__tip-more">+{c.count - 1} more {c.count === 2 ? 'voice' : 'voices'} in this window · click to open</div>}
            </div>
          )
        })()}
      </div>

      <div className="mch__foot">
        <span className="mch__legend"><i className="mch__dot mch__dot-gold" />500k+ <i className="mch__dot mch__dot-violet" />100k+ <i className="mch__dot mch__dot-blue" />30k+</span>
        <span className="mch__foot-hint">size = cluster · ring = reach · click any to open the tweet</span>
      </div>
    </div>
  )
}
