/**
 * CandleChart — native 2D canvas OHLC candles for the embed.
 * Props:
 *   data:  Array<{ t, o, h, l, c, v? }>
 *   range: { start: number, end: number }  - normalized [0,1] viewport
 *
 * Modern exchange look: solid filled bodies (no hollow), volume pane in bottom
 * 22%, subtle horizontal grid, crosshair with price/time axis pills, sticky
 * last-price tag on the right edge.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'

const PAD_RIGHT = 64
const PAD_BOTTOM = 22
const PAD_TOP = 10
const PAD_LEFT = 8
const VOLUME_PANE_RATIO = 0.22
const PANE_GAP = 6

function formatVolume(v) {
  if (!Number.isFinite(v) || v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(0)
}

function formatTime(ms, locale) {
  const d = new Date(ms)
  return d.toLocaleString(locale || undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatAxisTime(ms, spanMs, locale) {
  const d = new Date(ms)
  if (spanMs <= 24 * 3600 * 1000) {
    return d.toLocaleTimeString(locale || undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (spanMs <= 7 * 24 * 3600 * 1000) {
    return d.toLocaleDateString(locale || undefined, { weekday: 'short', day: 'numeric' })
  }
  if (spanMs <= 120 * 24 * 3600 * 1000) {
    return d.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' })
  }
  return d.toLocaleDateString(locale || undefined, { month: 'short', year: '2-digit' })
}

function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min]
  const range = max - min
  const roughStep = range / (count - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const norm = roughStep / mag
  let step
  if (norm < 1.5)      step = 1 * mag
  else if (norm < 3)   step = 2 * mag
  else if (norm < 7)   step = 5 * mag
  else                 step = 10 * mag
  const first = Math.ceil(min / step) * step
  const ticks = []
  for (let v = first; v <= max + step * 0.5; v += step) ticks.push(v)
  return ticks
}

export default function CandleChart({ data, range = { start: 0, end: 1 } }) {
  const { i18n } = useTranslation()
  const { fmtPrice } = useCurrency()
  const locale = i18n.language || undefined
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)
  const [overlay, setOverlay] = useState(null) // { w, h, plot, volPane, lastPrice, lastY, isBull, vMin, vMax, slot }

  const sliced = useMemo(() => {
    if (!data?.length) return []
    const i0 = Math.max(0, Math.floor(range.start * (data.length - 1)))
    const i1 = Math.min(data.length - 1, Math.ceil(range.end * (data.length - 1)))
    return data.slice(i0, i1 + 1)
  }, [data, range.start, range.end])

  const hasVolume = useMemo(
    () => sliced.some(b => Number.isFinite(b.v) && b.v > 0),
    [sliced],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const w = rect.width, h = rect.height
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)

      if (sliced.length < 1) return

      const totalPlotH = Math.max(0, h - PAD_TOP - PAD_BOTTOM)
      const volH = hasVolume ? Math.max(28, totalPlotH * VOLUME_PANE_RATIO) : 0
      const priceH = Math.max(0, totalPlotH - volH - (hasVolume ? PANE_GAP : 0))

      const plot = {
        x: PAD_LEFT,
        y: PAD_TOP,
        w: Math.max(0, w - PAD_LEFT - PAD_RIGHT),
        h: priceH,
      }
      const volPane = hasVolume
        ? { x: plot.x, y: plot.y + plot.h + PANE_GAP, w: plot.w, h: volH }
        : null

      let min = Infinity, max = -Infinity
      for (const c of sliced) { if (c.l < min) min = c.l; if (c.h > max) max = c.h }
      if (min === max) { min -= 1; max += 1 }
      const pad = (max - min) * 0.06
      const vMin = min - pad
      const vMax = max + pad
      const yAt = (v) => plot.y + plot.h - ((v - vMin) / (vMax - vMin)) * plot.h

      const n = sliced.length
      const slot = plot.w / Math.max(1, n)
      const cw = Math.max(1, Math.min(14, slot * 0.72))

      const rootStyles = getComputedStyle(document.documentElement)
      const bullColor = rootStyles.getPropertyValue('--bull').trim() || '#10B981'
      const bearColor = rootStyles.getPropertyValue('--bear').trim() || '#EF4444'

      // ── Grid: horizontal price lines only, very subtle ──
      const ticks = niceTicks(vMin, vMax, 5)
      const useCompact = vMax >= 10_000
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const t of ticks) {
        const y = Math.round(yAt(t)) + 0.5
        if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue
        ctx.moveTo(plot.x, y)
        ctx.lineTo(plot.x + plot.w, y)
      }
      ctx.stroke()
      ctx.restore()

      // ── Y-axis labels (right, outside plot) ──
      ctx.save()
      ctx.font = '10.5px "JetBrains Mono", "SF Mono", Monaco, monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(245,245,247,0.38)'
      for (const t of ticks) {
        const y = yAt(t)
        if (y < plot.y || y > plot.y + plot.h) continue
        ctx.fillText(fmtPrice(t), plot.x + plot.w + 8, y)
      }
      ctx.restore()

      // ── X-axis time labels ──
      const xTickCount = Math.max(3, Math.min(6, Math.floor(plot.w / 110)))
      const t0 = sliced[0].t
      const t1 = sliced[sliced.length - 1].t
      const spanMs = t1 - t0
      ctx.save()
      ctx.font = '10.5px "JetBrains Mono", "SF Mono", Monaco, monospace'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(245,245,247,0.38)'
      const axisY = (volPane ? volPane.y + volPane.h : plot.y + plot.h) + 6
      for (let k = 0; k < xTickCount; k++) {
        const frac = xTickCount === 1 ? 0.5 : k / (xTickCount - 1)
        const tx = plot.x + frac * plot.w
        const ts = t0 + frac * spanMs
        const label = formatAxisTime(ts, spanMs, locale)
        ctx.textAlign = k === 0 ? 'left' : k === xTickCount - 1 ? 'right' : 'center'
        ctx.fillText(label, tx, axisY)
      }
      ctx.restore()

      // ── Candles: solid filled bodies, crisp wicks ──
      for (let i = 0; i < n; i++) {
        const c = sliced[i]
        const cx = plot.x + i * slot + slot / 2
        const isUp = c.c >= c.o
        const color = isUp ? bullColor : bearColor
        // Wick
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(Math.round(cx) + 0.5, yAt(c.h))
        ctx.lineTo(Math.round(cx) + 0.5, yAt(c.l))
        ctx.stroke()
        // Body (solid)
        const yo = yAt(c.o), yc = yAt(c.c)
        const top = Math.min(yo, yc)
        const height = Math.max(1, Math.abs(yo - yc))
        ctx.fillStyle = color
        ctx.fillRect(Math.round(cx - cw / 2), Math.round(top), Math.max(1, Math.round(cw)), Math.max(1, Math.round(height)))
      }

      // ── Volume pane ──
      let volMax = 0
      if (volPane) {
        for (const c of sliced) if (c.v > volMax) volMax = c.v
        if (volMax > 0) {
          const volYAt = (v) => volPane.y + volPane.h - (v / volMax) * (volPane.h - 2)
          // baseline
          ctx.save()
          ctx.strokeStyle = 'rgba(255,255,255,0.04)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(volPane.x, volPane.y + volPane.h + 0.5)
          ctx.lineTo(volPane.x + volPane.w, volPane.y + volPane.h + 0.5)
          ctx.stroke()
          ctx.restore()

          for (let i = 0; i < n; i++) {
            const c = sliced[i]
            if (!Number.isFinite(c.v) || c.v <= 0) continue
            const cx = plot.x + i * slot + slot / 2
            const isUp = c.c >= c.o
            ctx.fillStyle = isUp
              ? 'rgba(16, 185, 129, 0.35)'
              : 'rgba(239, 68, 68, 0.35)'
            const y = volYAt(c.v)
            const barTop = Math.round(y)
            const barH = Math.max(1, Math.round(volPane.y + volPane.h - y))
            ctx.fillRect(Math.round(cx - cw / 2), barTop, Math.max(1, Math.round(cw)), barH)
          }

          // Volume label (top-left, inside pane)
          ctx.save()
          ctx.font = '10px "JetBrains Mono", "SF Mono", Monaco, monospace'
          ctx.fillStyle = 'rgba(245,245,247,0.35)'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText('VOL', volPane.x + 2, volPane.y + 2)
          ctx.textAlign = 'left'
          ctx.fillStyle = 'rgba(245,245,247,0.45)'
          ctx.fillText(formatVolume(volMax), volPane.x + volPane.w + 8, volPane.y + 2)
          ctx.restore()
        }
      }

      // ── Sticky last-price guide line + axis tag ──
      const last = sliced[sliced.length - 1]
      if (last) {
        const isUp = last.c >= last.o
        const lastY = yAt(last.c)
        ctx.save()
        ctx.strokeStyle = isUp
          ? 'rgba(16, 185, 129, 0.35)'
          : 'rgba(239, 68, 68, 0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(plot.x, Math.round(lastY) + 0.5)
        ctx.lineTo(plot.x + plot.w, Math.round(lastY) + 0.5)
        ctx.stroke()
        ctx.restore()
      }

      // ── Crosshair ──
      if (hover?.point && hover.x >= plot.x && hover.x <= plot.x + plot.w) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        const xLineBottom = volPane ? volPane.y + volPane.h : plot.y + plot.h
        ctx.beginPath(); ctx.moveTo(hover.x, plot.y); ctx.lineTo(hover.x, xLineBottom); ctx.stroke()
        if (hover.mouseY != null && hover.mouseY >= plot.y && hover.mouseY <= plot.y + plot.h) {
          ctx.beginPath(); ctx.moveTo(plot.x, hover.mouseY); ctx.lineTo(plot.x + plot.w, hover.mouseY); ctx.stroke()
        }
        ctx.restore()
      }

      // Stash plot for hover + overlay
      canvas._embedPlot = plot
      const lastPoint = sliced[sliced.length - 1]
      const lastIsUp = lastPoint ? lastPoint.c >= lastPoint.o : false
      setOverlay({
        w, h,
        plot,
        volPane,
        lastPrice: lastPoint?.c,
        lastY: lastPoint ? yAt(lastPoint.c) : null,
        lastIsUp,
        useCompact,
        vMin, vMax,
      })
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [sliced, hover, hasVolume, fmtPrice, locale])

  const onMove = (e) => {
    const canvas = canvasRef.current
    if (!canvas || sliced.length < 1) return
    const rect = canvas.getBoundingClientRect()
    const plot = canvas._embedPlot
    if (!plot) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < plot.x || x > plot.x + plot.w) { setHover(null); return }
    const slot = plot.w / sliced.length
    const i = Math.max(0, Math.min(sliced.length - 1, Math.floor((x - plot.x) / slot)))
    const p = sliced[i]
    const cx = plot.x + i * slot + slot / 2
    // Convert mouseY inside price pane into a price value for the y-axis tag
    let hoverPrice = null
    if (overlay && y >= plot.y && y <= plot.y + plot.h) {
      const { vMin, vMax } = overlay
      hoverPrice = vMax - ((y - plot.y) / plot.h) * (vMax - vMin)
    }
    setHover({ x: cx, y, mouseY: y, point: p, wrapW: rect.width, wrapH: rect.height, hoverPrice })
  }
  const onLeave = () => setHover(null)

  const tooltipStyle = hover?.point ? (() => {
    const flipX = hover.x > hover.wrapW - 200
    const flipY = hover.y < 130
    return {
      left: hover.x,
      top: hover.y,
      transform: `translate(${flipX ? 'calc(-100% - 14px)' : '14px'}, ${flipY ? '14px' : 'calc(-100% - 14px)'})`,
    }
  })() : null

  const isUp = hover?.point ? hover.point.c >= hover.point.o : false
  const changePct = hover?.point
    ? ((hover.point.c - hover.point.o) / hover.point.o) * 100
    : null

  // Sticky last-price pill + y-axis crosshair pill
  const lastPillStyle = overlay?.lastY != null ? {
    top: overlay.lastY,
    right: 4,
  } : null

  const yPillStyle = hover?.point && overlay ? {
    top: hover.mouseY,
    right: 4,
  } : null

  const xPillStyle = hover?.point && overlay?.volPane ? {
    left: hover.x,
    top: overlay.volPane.y + overlay.volPane.h + 4,
  } : hover?.point && overlay ? {
    left: hover.x,
    top: overlay.plot.y + overlay.plot.h + 4,
  } : null

  return (
    <div ref={wrapRef} className="embed-candle-wrap" onMouseMove={onMove} onMouseLeave={onLeave}>
      <canvas ref={canvasRef} className="embed-candle-canvas" />

      {overlay?.lastPrice != null ? (
        <div
          className={`embed-candle-last-tag ${overlay.lastIsUp ? 'is-bull' : 'is-bear'}`}
          style={lastPillStyle}
        >
          {fmtPrice(overlay.lastPrice)}
        </div>
      ) : null}

      {hover?.hoverPrice != null ? (
        <div className="embed-candle-axis-pill embed-candle-axis-pill--y" style={yPillStyle}>
          {fmtPrice(hover.hoverPrice)}
        </div>
      ) : null}

      {hover?.point ? (
        <div className="embed-candle-axis-pill embed-candle-axis-pill--x" style={xPillStyle}>
          {formatTime(hover.point.t, locale)}
        </div>
      ) : null}

      {hover?.point ? (
        <div className="embed-tooltip embed-tooltip--candle" style={tooltipStyle}>
          <div className="embed-tooltip-time mono">{formatTime(hover.point.t, locale)}</div>
          <div className="embed-tooltip-ohlc">
            <div><span className="embed-tooltip-label">O</span><span className="mono">{fmtPrice(hover.point.o)}</span></div>
            <div><span className="embed-tooltip-label">H</span><span className="mono">{fmtPrice(hover.point.h)}</span></div>
            <div><span className="embed-tooltip-label">L</span><span className="mono">{fmtPrice(hover.point.l)}</span></div>
            <div><span className="embed-tooltip-label">C</span><span className={`mono ${isUp ? 'embed-tooltip-bull' : 'embed-tooltip-bear'}`}>{fmtPrice(hover.point.c)}</span></div>
            {Number.isFinite(hover.point.v) && hover.point.v > 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <span className="embed-tooltip-label">V</span>
                <span className="mono">{formatVolume(hover.point.v)}</span>
              </div>
            ) : null}
            {changePct != null ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <span className="embed-tooltip-label">Δ</span>
                <span className={`mono ${isUp ? 'embed-tooltip-bull' : 'embed-tooltip-bear'}`}>
                  {`${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
