/**
 * EtfFlowChart — daily spot-ETF net-flow bars (green inflow up / red outflow
 * down from a zero baseline) with a gold spot-price line on a secondary axis.
 * Responsive SVG: the viewBox tracks the measured pixel width (1:1) so axis
 * text never distorts on narrow phones. Hover crosshair reads out the day's
 * flow + price. Original Spectre design — mirrors the Telegram ETF chart.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import ChartWatermark from '@/components/chart-watermark'
import './etf-flows.css'

function fUsd(n, signed) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '-' : signed && n > 0 ? '+' : ''
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${Math.round(a)}`
}
function fPrice(n) {
  if (n == null || !isFinite(n)) return ''
  if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K'
  return '$' + n.toFixed(n >= 1 ? 0 : 2)
}
function fDate(d, withYear) {
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: withYear ? '2-digit' : undefined,
      timeZone: 'UTC',
    })
  } catch {
    return d
  }
}

export default function EtfFlowChart({ series = [], height = 340, asset }) {
  const [hover, setHover] = useState(null)
  const [vw, setVw] = useState(720)
  const wrapRef = useRef(null)
  const svgRef = useRef(null)

  // Track the container width so the viewBox stays 1:1 with pixels — otherwise
  // preserveAspectRatio="none" would squish the axis labels on a phone.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w && Math.abs(w - vw) > 2) setVw(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [vw])

  const narrow = vw < 480
  const M = { l: narrow ? 46 : 60, r: narrow ? 44 : 58, t: 14, b: 26 }

  const geom = useMemo(() => {
    const n = series.length
    if (!n) return null
    const VH = height
    const pw = vw - M.l - M.r
    const ph = VH - M.t - M.b
    if (pw <= 0 || ph <= 0) return null
    const flows = series.map((d) => Number(d.flowUsd) || 0)
    const prices = series.map((d) => (d.price != null ? Number(d.price) : null))

    const maxPos = Math.max(1, ...flows.filter((f) => f > 0), 0)
    const maxNeg = Math.max(1, ...flows.filter((f) => f < 0).map((f) => -f), 0)
    const total = maxPos + maxNeg
    const yZero = M.t + ph * (maxPos / total)
    const yFlow = (f) =>
      f >= 0 ? yZero - (f / maxPos) * (yZero - M.t) : yZero + (-f / maxNeg) * (M.t + ph - yZero)

    const pv = prices.filter((p) => p != null)
    const minP = pv.length ? Math.min(...pv) : 0
    const maxP = pv.length ? Math.max(...pv) : 1
    const padP = (maxP - minP) * 0.14 || 1
    const lo = minP - padP
    const hi = maxP + padP
    const yPrice = (p) => M.t + ph * (1 - (p - lo) / (hi - lo))

    const slot = pw / n
    const barW = Math.max(1.5, Math.min(18, slot * 0.62))
    const bars = series.map((d, i) => {
      const f = flows[i]
      const x = M.l + i * slot + (slot - barW) / 2
      const y = yFlow(f)
      return { x, y, w: barW, h: Math.max(1, Math.abs(y - yZero)), up: f >= 0, top: f >= 0 ? y : yZero }
    })
    const pts = series
      .map((d, i) => (d.price != null ? { x: M.l + i * slot + slot / 2, y: yPrice(Number(d.price)), i } : null))
      .filter(Boolean)
    const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    const areaPath = pts.length
      ? `M${pts[0].x.toFixed(1)} ${(M.t + ph).toFixed(1)} ${pts
          .map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' ')} L${pts[pts.length - 1].x.toFixed(1)} ${(M.t + ph).toFixed(1)} Z`
      : ''

    const flowTicks = narrow ? [maxPos, 0, -maxNeg] : [maxPos, maxPos / 2, 0, -maxNeg / 2, -maxNeg]
    const priceTicks = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((t) => lo + (hi - lo) * t)

    return { n, VH, pw, ph, slot, yZero, yFlow, yPrice, bars, linePath, areaPath, flowTicks, priceTicks, lastPt: pts[pts.length - 1] }
  }, [series, vw, height, narrow, M.l, M.r, M.t, M.b])

  const onMove = (e) => {
    const svg = svgRef.current
    if (!svg || !geom) return
    const rect = svg.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const x = ((clientX - rect.left) / rect.width) * vw
    const idx = Math.max(0, Math.min(geom.n - 1, Math.floor((x - M.l) / geom.slot)))
    setHover(idx)
  }

  if (!series.length) return <div className="etf-chart-wrap" style={{ height }} ref={wrapRef}><div className="etf-chart-empty">{asset ? `No ${asset} flow history loaded yet — retrying in the background.` : 'Flow history warming up…'}</div></div>

  const step = Math.max(1, Math.ceil(geom ? geom.n / (narrow ? 5 : 8) : 8))
  const hv = hover != null ? series[hover] : null
  const hoverX = hover != null && geom ? M.l + hover * geom.slot + geom.slot / 2 : 0
  const fs = narrow ? 10 : 11

  return (
    <div className="etf-chart-wrap spectre-wm-host" style={{ height }} ref={wrapRef}>
      {geom && (
        <svg
          ref={svgRef}
          className="etf-chart-svg"
          viewBox={`0 0 ${vw} ${geom.VH}`}
          preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onTouchStart={onMove}
          onTouchMove={onMove}
          onTouchEnd={() => setHover(null)}
        >
          <defs>
            {/* Design-system bull/bear (--bull-bright -> --bull, --bear-bright
                -> --bear) and one gold for the price series. The old ramps
                were bespoke (#34e39a/#12b56e, #b3313a/#ff5f6a, #f2a24a), so
                the same "up" read as two different greens between this chart
                and the numbers beside it. */}
            <linearGradient id="etfUp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#34D399" />
              <stop offset="1" stopColor="#10B981" />
            </linearGradient>
            <linearGradient id="etfDown" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#DC2626" />
              <stop offset="1" stopColor="#F87171" />
            </linearGradient>
            <linearGradient id="etfArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(245,158,11,0.16)" />
              <stop offset="1" stopColor="rgba(245,158,11,0)" />
            </linearGradient>
          </defs>

          {geom.flowTicks.map((t, i) => {
            const y = geom.yFlow(t)
            return (
              <g key={`ft${i}`}>
                <line className={t === 0 ? 'etf-grid etf-grid--zero' : 'etf-grid'} x1={M.l} y1={y} x2={M.l + geom.pw} y2={y} />
                <text className="etf-axis" x={M.l - 7} y={y + 4} textAnchor="end" style={{ fontSize: fs }}>
                  {fUsd(t, true)}
                </text>
              </g>
            )
          })}
          {geom.priceTicks.map((p, i) => (
            <text key={`pt${i}`} className="etf-axis etf-axis--price" x={M.l + geom.pw + 7} y={geom.yPrice(p) + 4} textAnchor="start" style={{ fontSize: fs }}>
              {fPrice(p)}
            </text>
          ))}

          {geom.bars.map((b, i) => (
            <rect
              key={`b${i}`}
              x={b.x}
              y={b.top}
              width={b.w}
              height={b.h}
              rx={Math.min(2.5, b.w / 2)}
              fill={b.up ? 'url(#etfUp)' : 'url(#etfDown)'}
              opacity={hover == null || hover === i ? 1 : 0.55}
            />
          ))}

          {geom.areaPath && <path d={geom.areaPath} fill="url(#etfArea)" />}
          <path d={geom.linePath} className="etf-priceline" fill="none" />
          {geom.lastPt && <circle cx={geom.lastPt.x} cy={geom.lastPt.y} r="3.5" className="etf-pricedot" />}

          {series.map((d, i) => (i % step === 0 ? (
            <text key={`x${i}`} className="etf-axis" x={M.l + i * geom.slot + geom.slot / 2} y={geom.VH - 8} textAnchor="middle" style={{ fontSize: fs }}>
              {fDate(d.date)}
            </text>
          ) : null))}

          {hover != null && <line className="etf-crosshair" x1={hoverX} y1={M.t} x2={hoverX} y2={M.t + geom.ph} />}
        </svg>
      )}

      {/* Beta report (ChainROI, 08-19): an ETF flow picture is easy to crop and
          then it belongs to nobody. The chart carries the mark itself. */}
      {geom && <ChartWatermark padX={M.r + 6} padY={M.b + 4} />}

      {hv && (
        <div className="etf-tip" style={{ left: `${(hoverX / vw) * 100}%` }}>
          <div className="etf-tip-date">{fDate(hv.date, true)}</div>
          <div className={`etf-tip-flow ${Number(hv.flowUsd) >= 0 ? 'up' : 'down'}`}>
            {Number(hv.flowUsd) >= 0 ? 'Inflow ' : 'Outflow '}
            <b>{fUsd(hv.flowUsd, true)}</b>
          </div>
          {hv.price != null && <div className="etf-tip-price">{fPrice(Number(hv.price))}</div>}
        </div>
      )}
    </div>
  )
}
