import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './rz-compare-view.css'

const PERIOD_LABELS = { 7: '7d', 30: '30d', 90: '90d' }

function fmtPct(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function pctClass(v) {
  if (!Number.isFinite(v)) return ''
  return v >= 0 ? 'rz-cv-up' : 'rz-cv-down'
}

function fmtDateShort(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Full-area Compare chart that replaces the regular canvas when Compare mode is active.
 * Draws two normalized % return lines + axes + crosshair.
 */
function RzCompareView({
  baseSymbol,
  compareSym,
  baseSeries,    // [[ts, pct], ...]
  compareSeries,
  baseColor,
  compareColor,
  baseReturns,
  compareReturns,
  periods = [7, 30, 90],
  loading,
  error,
  dayMode,
  onClear,
  onChangeCompare,
}) {
  const { t } = useTranslation()
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null) // { x, y, ts, baseY, cmpY, baseVal, cmpVal }
  const [resizeTick, setResizeTick] = useState(0)
  const layoutRef = useRef(null)
  const resizeRafRef = useRef(null)
  const hoverRafRef = useRef(null)
  const hoverPosRef = useRef(null)

  // Redraw when the wrapper resizes (fullscreen toggle, window resize, panel collapse).
  // rAF-throttle so a resize storm coalesces to one setState per frame.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (resizeRafRef.current != null) return
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null
        if (document.hidden) return
        setResizeTick(t => t + 1)
      })
    })
    ro.observe(wrap)
    return () => {
      ro.disconnect()
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
    }
  }, [])

  // Compute layout + draw
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const cssW = wrap.clientWidth
    const cssH = wrap.clientHeight
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const padTop = 24, padBottom = 36, padLeft = 14, padRight = 76
    const w = cssW - padLeft - padRight
    const h = cssH - padTop - padBottom

    const series = []
    if (Array.isArray(baseSeries) && baseSeries.length > 0) series.push({ pts: baseSeries, color: baseColor })
    if (Array.isArray(compareSeries) && compareSeries.length > 0) series.push({ pts: compareSeries, color: compareColor })

    if (series.length === 0) {
      layoutRef.current = null
      return
    }

    let minY = Infinity, maxY = -Infinity
    let minX = Infinity, maxX = -Infinity
    for (const s of series) {
      for (const [x, y] of s.pts) {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
    }
    if (!Number.isFinite(minY) || minX === maxX) {
      layoutRef.current = null
      return
    }
    if (minY === maxY) { minY -= 1; maxY += 1 }
    // Pad y range a touch
    const yPad = (maxY - minY) * 0.08
    minY -= yPad
    maxY += yPad

    const xScale = (x) => padLeft + ((x - minX) / (maxX - minX)) * w
    const yScale = (y) => padTop + (1 - (y - minY) / (maxY - minY)) * h

    layoutRef.current = { padTop, padBottom, padLeft, padRight, w, h, cssW, cssH, minX, maxX, minY, maxY, xScale, yScale }

    const gridColor = dayMode ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.05)'
    const labelColor = dayMode ? 'rgba(15, 23, 42, 0.55)' : 'rgba(245, 245, 247, 0.45)'

    // Horizontal grid + Y axis labels (5 lines)
    ctx.font = "11px 'JetBrains Mono', monospace"
    ctx.fillStyle = labelColor
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const yTicks = 5
    for (let i = 0; i <= yTicks; i++) {
      const yVal = minY + (maxY - minY) * (1 - i / yTicks)
      const py = padTop + (h * i) / yTicks
      ctx.beginPath()
      ctx.strokeStyle = Math.abs(yVal) < 0.001 ? (dayMode ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.16)') : gridColor
      ctx.lineWidth = Math.abs(yVal) < 0.001 ? 1 : 1
      if (Math.abs(yVal) < 0.001) ctx.setLineDash([4, 4])
      ctx.moveTo(padLeft, py)
      ctx.lineTo(cssW - padRight, py)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillText(`${yVal >= 0 ? '+' : ''}${yVal.toFixed(1)}%`, cssW - padRight + 6, py)
    }

    // X axis date labels (5 ticks)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const xTicks = 5
    for (let i = 0; i <= xTicks; i++) {
      const xVal = minX + ((maxX - minX) * i) / xTicks
      const px = padLeft + (w * i) / xTicks
      ctx.fillStyle = labelColor
      ctx.fillText(fmtDateShort(xVal), px, padTop + h + 8)
    }

    // Series with subtle area fill below (only for first series for visual hierarchy)
    series.forEach((s, idx) => {
      if (s.pts.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = s.color
      ctx.lineWidth = idx === 0 ? 1.8 : 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      let started = false
      for (const [x, y] of s.pts) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        const px = xScale(x), py = yScale(y)
        if (!started) { ctx.moveTo(px, py); started = true }
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    })

    // Last-point dots
    series.forEach(s => {
      if (s.pts.length < 1) return
      const last = s.pts[s.pts.length - 1]
      if (!Number.isFinite(last[0]) || !Number.isFinite(last[1])) return
      const px = xScale(last[0]), py = yScale(last[1])
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(px, py, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = dayMode ? '#ffffff' : '#0b0b0e'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })
  }, [baseSeries, compareSeries, baseColor, compareColor, dayMode, resizeTick])

  // Hover crosshair — rAF-throttled so mousemove coalesces to ≤1 setState/frame.
  const computeHover = (clientX, clientY) => {
    const wrap = wrapRef.current
    const layout = layoutRef.current
    if (!wrap || !layout) return
    const rect = wrap.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (x < layout.padLeft || x > layout.padLeft + layout.w || y < layout.padTop || y > layout.padTop + layout.h) {
      setHover(null)
      return
    }
    // Find closest x on base series
    const ts = layout.minX + ((x - layout.padLeft) / layout.w) * (layout.maxX - layout.minX)
    const findClosest = (pts) => {
      if (!Array.isArray(pts) || pts.length === 0) return null
      let best = pts[0]
      let bestDiff = Math.abs(pts[0][0] - ts)
      for (let i = 1; i < pts.length; i++) {
        const d = Math.abs(pts[i][0] - ts)
        if (d < bestDiff) { best = pts[i]; bestDiff = d }
      }
      return best
    }
    const baseHit = findClosest(baseSeries)
    const cmpHit = findClosest(compareSeries)
    setHover({
      x,
      ts: baseHit?.[0] ?? cmpHit?.[0] ?? null,
      baseVal: baseHit?.[1] ?? null,
      cmpVal: cmpHit?.[1] ?? null,
      baseY: baseHit ? layout.yScale(baseHit[1]) : null,
      cmpY: cmpHit ? layout.yScale(cmpHit[1]) : null,
    })
  }

  const handleMouseMove = (e) => {
    hoverPosRef.current = { x: e.clientX, y: e.clientY }
    if (hoverRafRef.current != null) return
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null
      if (document.hidden) return
      const pos = hoverPosRef.current
      if (pos) computeHover(pos.x, pos.y)
    })
  }

  const handleMouseLeave = () => {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current)
      hoverRafRef.current = null
    }
    setHover(null)
  }

  // Cancel any pending hover frame on unmount.
  useEffect(() => () => {
    if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current)
  }, [])

  const hasAnyData = (Array.isArray(baseSeries) && baseSeries.length > 0)
    || (Array.isArray(compareSeries) && compareSeries.length > 0)
  const showLoading = loading && !hasAnyData
  const showProgress = loading && hasAnyData

  return (
    <div className="rz-cv" ref={wrapRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <canvas ref={canvasRef} className="rz-cv-canvas" />

      {showProgress && <div className="rz-cv-progress" aria-hidden />}

      {/* Top bar: legend + actions */}
      <div className="rz-cv-topbar">
        <div className="rz-cv-legend">
          <span className="rz-cv-legend-item">
            <span className="rz-cv-swatch" style={{ background: baseColor }} />
            <span className="rz-cv-legend-sym">{baseSymbol}</span>
            {Number.isFinite(baseReturns?.[periods[periods.length - 1]]) && (
              <span className={`rz-cv-legend-pct mono ${pctClass(baseReturns?.[periods[periods.length - 1]])}`}>
                {fmtPct(baseReturns?.[periods[periods.length - 1]])}
              </span>
            )}
          </span>
          <span className="rz-cv-legend-vs">{t('researchPro.compareView.rzcompareview.vs', "vs")}</span>
          <span className="rz-cv-legend-item">
            <span className="rz-cv-swatch" style={{ background: compareColor }} />
            <span className="rz-cv-legend-sym">{compareSym}</span>
            {Number.isFinite(compareReturns?.[periods[periods.length - 1]]) && (
              <span className={`rz-cv-legend-pct mono ${pctClass(compareReturns?.[periods[periods.length - 1]])}`}>
                {fmtPct(compareReturns?.[periods[periods.length - 1]])}
              </span>
            )}
          </span>
        </div>
        <div className="rz-cv-actions">
          {onChangeCompare && (
            <button type="button" className="rz-cv-btn" onClick={onChangeCompare} title={t('researchPro.compareView.rzcompareview.title', "Change comparison token")}>
              Change…
            </button>
          )}
          {onClear && (
            <button type="button" className="rz-cv-btn rz-cv-btn--icon" onClick={onClear} title={t('researchPro.compareView.rzcompareview.title2', "Exit compare mode")} aria-label={t('researchPro.compareView.rzcompareview.ariaExit', "Exit")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Period stat strip */}
      <div className="rz-cv-stats">
        {periods.map(p => (
          <div key={p} className="rz-cv-stat">
            <span className="rz-cv-stat-label">{PERIOD_LABELS[p] || `${p}d`}</span>
            <div className="rz-cv-stat-pair">
              <span className={`rz-cv-stat-val mono ${pctClass(baseReturns?.[p])}`}>{fmtPct(baseReturns?.[p])}</span>
              <span className="rz-cv-stat-divider">·</span>
              <span className={`rz-cv-stat-val mono ${pctClass(compareReturns?.[p])}`}>{fmtPct(compareReturns?.[p])}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Crosshair + tooltip */}
      {hover && (
        <>
          <div className="rz-cv-cross-x" style={{ left: hover.x }} />
          {Number.isFinite(hover.baseY) && (
            <div className="rz-cv-dot" style={{ left: hover.x, top: hover.baseY, background: baseColor }} />
          )}
          {Number.isFinite(hover.cmpY) && (
            <div className="rz-cv-dot" style={{ left: hover.x, top: hover.cmpY, background: compareColor }} />
          )}
          <div
            className="rz-cv-tooltip"
            style={{
              left: hover.x + (hover.x > (wrapRef.current?.clientWidth || 0) - 180 ? -160 : 12),
              top: 56,
            }}
          >
            <div className="rz-cv-tooltip-date mono">{hover.ts ? new Date(hover.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</div>
            <div className="rz-cv-tooltip-row">
              <span className="rz-cv-swatch" style={{ background: baseColor }} />
              <span className="rz-cv-tooltip-sym">{baseSymbol}</span>
              <span className={`rz-cv-tooltip-val mono ${pctClass(hover.baseVal)}`}>{fmtPct(hover.baseVal)}</span>
            </div>
            <div className="rz-cv-tooltip-row">
              <span className="rz-cv-swatch" style={{ background: compareColor }} />
              <span className="rz-cv-tooltip-sym">{compareSym}</span>
              <span className={`rz-cv-tooltip-val mono ${pctClass(hover.cmpVal)}`}>{fmtPct(hover.cmpVal)}</span>
            </div>
          </div>
        </>
      )}

      {showLoading && (
        <div className="rz-cv-overlay">
          <span className="rz-cv-shimmer" />
        </div>
      )}

      {error && !loading && (
        <div className="rz-cv-overlay rz-cv-overlay--error">
          {t('researchPro.compareView.rzcompareview.couldnTLoadComparisonData', "Couldn’t load comparison data.")}
        </div>
      )}
    </div>
  )
}

// React.memo: only mounts in Compare mode but still received parent price ticks
// while open - memo holds it stable so it redraws only on actual series/prop change.
export default React.memo(RzCompareView)
