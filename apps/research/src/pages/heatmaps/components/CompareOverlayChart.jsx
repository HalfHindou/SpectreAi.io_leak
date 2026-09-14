/**
 * CompareOverlayChart — Canvas-based multi-line % change comparison chart.
 * Each token is a colored line normalized to 0% at the start of the timeframe.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import './CompareOverlayChart.css'

const TIMEFRAMES = [
  { id: '1d', label: '24H', days: 1 },
  { id: '7d', label: '7D', days: 7 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
]

const FALLBACK_COLORS = [
  { color: '#06B6D4', rgb: '6,182,212' },
  { color: '#F59E0B', rgb: '245,158,11' },
  { color: '#EC4899', rgb: '236,72,153' },
  { color: '#8B5CF6', rgb: '139,92,246' },
  { color: '#10B981', rgb: '16,185,129' },
  { color: '#EF4444', rgb: '239,68,68' },
  { color: '#3B82F6', rgb: '59,130,246' },
  { color: '#F97316', rgb: '249,115,22' },
]

function getTokenColor(symbol, index) {
  const key = (symbol || '').toUpperCase()
  const row = TOKEN_ROW_COLORS[key]
  if (row?.bg) {
    // bg is "r, g, b" string
    const parts = row.bg.split(',').map(s => s.trim())
    if (parts.length === 3) {
      return { color: `rgb(${row.bg})`, rgb: row.bg }
    }
  }
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

const PAD = { top: 20, right: 72, bottom: 32, left: 12 }

export default function CompareOverlayChart({ tokens, dayMode }) {
  const { t: tr, i18n } = useTranslation()
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [timeframe, setTimeframe] = useState('7d')
  const [hoverX, setHoverX] = useState(null)
  const retryRef = useRef(0)
  const retryTimerRef = useRef(null)
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  // Clean up any pending retry timer on unmount to avoid setState on dead component.
  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
  }, [])

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fetch data — debounced to avoid CoinGecko rate limiting when tokens are added rapidly
  const fetchKey = useMemo(() => {
    const ids = tokens.map(tk => tk.id).filter(Boolean).sort().join(',')
    return ids ? `${ids}|${timeframe}` : ''
  }, [tokens, timeframe])

  const doFetch = useCallback(() => {
    // Clear any pending retry so rapid fetches don't pile up.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (!fetchKey || tokens.length === 0) { setChartData(null); return }
    setLoading(true)
    setFetchError(false)

    const controller = new AbortController()
    const entities = tokens.filter(tk => tk.id).map(tk => ({
      type: 'token', id: tk.id, name: tk.symbol,
    }))
    const tf = TIMEFRAMES.find(item => item.id === timeframe)
    const url = `/api/compare/chart?entities=${encodeURIComponent(JSON.stringify(entities))}&days=${tf?.days || 7}`

    fetch(url, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => {
        // Defensive: drop any point with non-finite pct before storing, so
        // downstream yMin/yMax math and path drawing can't break on NaN/null.
        if (data?.entities?.length) {
          data.entities = data.entities.map(ent => ({
            ...ent,
            data: Array.isArray(ent?.data)
              ? ent.data.filter(pt => Number.isFinite(pt?.pct))
              : [],
          }))
        }
        const hasData = data?.entities?.some(ent => ent.data?.length > 0)
        if (hasData) {
          setChartData(data)
          setLoading(false)
          retryRef.current = 0
        } else if (retryRef.current < 2) {
          // All entities returned empty — retry once after delay (rate limit recovery)
          retryRef.current++
          retryTimerRef.current = setTimeout(() => doFetch(), 1500)
        } else {
          setChartData(data)
          setLoading(false)
          setFetchError(true)
          retryRef.current = 0
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        // silently handled
        setChartData(null)
        setLoading(false)
        setFetchError(true)
      })

    return controller
  }, [fetchKey, tokens, timeframe])

  useEffect(() => {
    if (!fetchKey || tokens.length === 0) { setChartData(null); return }
    setLoading(true)
    retryRef.current = 0

    let controller = null
    const debounceTimer = setTimeout(() => {
      controller = doFetch()
    }, 600)

    return () => {
      clearTimeout(debounceTimer)
      controller?.abort()
    }
  }, [fetchKey, doFetch])

  // Hover
  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    if (x >= PAD.left && x <= dims.w - PAD.right) {
      setHoverX(x)
    } else {
      setHoverX(null)
    }
  }, [dims.w])

  const handleMouseLeave = useCallback(() => setHoverX(null), [])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || dims.w === 0 || dims.h === 0) return

    const ctx = canvas.getContext('2d')
    const { w, h } = dims
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const isDark = !dayMode
    const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'
    const textColor = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.3)'
    const zeroColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'

    const chart = {
      x: PAD.left,
      y: PAD.top,
      w: w - PAD.left - PAD.right,
      h: h - PAD.top - PAD.bottom,
    }

    if (!chartData?.entities?.length || chart.w < 10 || chart.h < 10) {
      // No "Loading..." text on canvas (design rule K: shimmer only).
      // The DOM shimmer overlay handles the loading state.
      if (!loading && tokens.length < 2) {
        ctx.fillStyle = textColor
        ctx.font = `500 13px -apple-system, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(tr('heatmaps.compareHint'), w / 2, h / 2)
      } else if (!loading && fetchError) {
        ctx.fillStyle = textColor
        ctx.font = `500 13px -apple-system, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(tr('heatmaps.chartLoadFailed'), w / 2, h / 2)
      }
      return
    }

    // Check if ALL entities have empty data (e.g. all failed due to rate limiting)
    const hasAnyData = chartData.entities.some(ent => ent.data?.length > 0)
    if (!hasAnyData) {
      ctx.fillStyle = textColor
      ctx.font = `500 13px -apple-system, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(tr('heatmaps.noChartData'), w / 2, h / 2)
      return
    }

    // Compute Y range across all entities (% change)
    let yMin = 0, yMax = 0
    const allTimestamps = new Set()
    chartData.entities.forEach(ent => {
      if (!ent.data?.length) return
      ent.data.forEach(pt => {
        if (!Number.isFinite(pt?.pct)) return
        if (pt.pct < yMin) yMin = pt.pct
        if (pt.pct > yMax) yMax = pt.pct
        allTimestamps.add(pt.ts)
      })
    })
    const yPad = Math.max(1, (yMax - yMin) * 0.12)
    yMin -= yPad
    yMax += yPad

    const xTs = Array.from(allTimestamps).sort((a, b) => a - b)
    if (xTs.length < 2) return

    const xFirst = xTs[0], xLast = xTs[xTs.length - 1]
    const mapX = ts => chart.x + ((ts - xFirst) / (xLast - xFirst || 1)) * chart.w
    const mapY = pct => chart.y + chart.h - ((pct - yMin) / (yMax - yMin || 1)) * chart.h

    // Grid lines with Y labels
    const steps = 6
    const yStep = (yMax - yMin) / steps
    ctx.font = `500 10px var(--font-mono)`
    for (let i = 0; i <= steps; i++) {
      const val = yMin + yStep * i
      const y = mapY(val)
      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(chart.x, y); ctx.lineTo(chart.x + chart.w, y); ctx.stroke()
    }

    // Zero baseline
    if (yMin < 0 && yMax > 0) {
      const zy = mapY(0)
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = zeroColor
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(chart.x, zy); ctx.lineTo(chart.x + chart.w, zy); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = textColor
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText('0%', chart.x - 4, zy)
    }

    // X-axis time labels
    const xLabelCount = Math.max(2, Math.floor(chart.w / 80))
    ctx.fillStyle = textColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = `500 10px var(--font-mono)`
    const locale = (i18n?.language) || undefined
    for (let i = 0; i <= xLabelCount; i++) {
      const frac = i / xLabelCount
      const ts = xFirst + frac * (xLast - xFirst)
      const date = new Date(ts * 1000)
      const tf = TIMEFRAMES.find(item => item.id === timeframe)
      let label
      if (tf && tf.days <= 1) {
        label = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      } else if (tf && tf.days <= 7) {
        label = date.toLocaleDateString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      } else {
        label = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
      }
      ctx.fillText(label, mapX(ts), chart.y + chart.h + 8)
    }

    // Draw lines — clip to chart area
    ctx.save()
    ctx.beginPath()
    ctx.rect(chart.x, chart.y, chart.w, chart.h)
    ctx.clip()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    chartData.entities.forEach((ent, idx) => {
      if (!ent.data?.length) return
      const tokenSym = tokens[idx]?.symbol || ent.name
      const sc = getTokenColor(tokenSym, idx)

      // Glow — skip non-finite points so a single bad value can't poison the path.
      ctx.beginPath()
      let started = false
      for (const pt of ent.data) {
        if (!Number.isFinite(pt?.pct)) continue
        const x = mapX(pt.ts), y = mapY(pt.pct)
        if (!started) { ctx.moveTo(x, y); started = true } else { ctx.lineTo(x, y) }
      }
      ctx.strokeStyle = `rgba(${sc.rgb}, 0.2)`
      ctx.lineWidth = 5
      ctx.stroke()

      // Main line
      ctx.beginPath()
      started = false
      for (const pt of ent.data) {
        if (!Number.isFinite(pt?.pct)) continue
        const x = mapX(pt.ts), y = mapY(pt.pct)
        if (!started) { ctx.moveTo(x, y); started = true } else { ctx.lineTo(x, y) }
      }
      ctx.strokeStyle = sc.color
      ctx.lineWidth = 2
      ctx.stroke()

      // End dot
      const last = ent.data[ent.data.length - 1]
      if (last) {
        const ex = mapX(last.ts), ey = mapY(last.pct)
        ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${sc.rgb}, 0.2)`; ctx.fill()
        ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2)
        ctx.fillStyle = sc.color; ctx.fill()
      }
    })

    ctx.restore()

    // End labels on right side
    const usedYPositions = []
    chartData.entities.forEach((ent, idx) => {
      if (!ent.data?.length) return
      const tokenSym = tokens[idx]?.symbol || ent.name
      const sc = getTokenColor(tokenSym, idx)
      const last = ent.data[ent.data.length - 1]
      if (!last) return

      const rawY = mapY(last.pct)
      let labelY = rawY
      for (const used of usedYPositions) {
        if (Math.abs(labelY - used) < 16) {
          labelY = used + (labelY > used ? 16 : -16)
        }
      }
      labelY = Math.max(chart.y + 8, Math.min(chart.y + chart.h - 8, labelY))
      usedYPositions.push(labelY)

      const pctText = `${last.pct >= 0 ? '+' : ''}${last.pct.toFixed(1)}%`
      ctx.font = `700 10px var(--font-mono)`
      const tw = ctx.measureText(pctText).width
      const lblW = tw + 10, lblH = 17
      const bx = chart.x + chart.w + 6, by = labelY - lblH / 2, br = 4

      // Badge bg
      ctx.beginPath()
      ctx.moveTo(bx + br, by); ctx.lineTo(bx + lblW - br, by)
      ctx.quadraticCurveTo(bx + lblW, by, bx + lblW, by + br)
      ctx.lineTo(bx + lblW, by + lblH - br)
      ctx.quadraticCurveTo(bx + lblW, by + lblH, bx + lblW - br, by + lblH)
      ctx.lineTo(bx + br, by + lblH)
      ctx.quadraticCurveTo(bx, by + lblH, bx, by + lblH - br)
      ctx.lineTo(bx, by + br)
      ctx.quadraticCurveTo(bx, by, bx + br, by)
      ctx.closePath()
      ctx.fillStyle = `rgba(${sc.rgb}, 0.18)`; ctx.fill()
      ctx.strokeStyle = `rgba(${sc.rgb}, 0.4)`; ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle = sc.color
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(pctText, bx + lblW / 2, labelY)
    })

    // Hover crosshair
    if (hoverX != null && chartData?.entities?.length) {
      const frac = (hoverX - chart.x) / chart.w
      const hoverTs = xFirst + frac * (xLast - xFirst)

      // Vertical crosshair line
      ctx.save()
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(hoverX, chart.y); ctx.lineTo(hoverX, chart.y + chart.h); ctx.stroke()
      ctx.restore()

      // Tooltip
      const tooltipData = []
      chartData.entities.forEach((ent, idx) => {
        if (!ent.data?.length) return
        // Find closest point
        let closest = ent.data[0]
        let minDist = Math.abs(closest.ts - hoverTs)
        for (const pt of ent.data) {
          const d = Math.abs(pt.ts - hoverTs)
          if (d < minDist) { minDist = d; closest = pt }
        }
        const tokenSym = tokens[idx]?.symbol || ent.name
        const sc = getTokenColor(tokenSym, idx)
        tooltipData.push({ symbol: tokenSym, pct: closest.pct, color: sc.color, rgb: sc.rgb, y: mapY(closest.pct) })

        // Hover dot
        const hx = mapX(closest.ts), hy = mapY(closest.pct)
        ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2)
        ctx.fillStyle = sc.color; ctx.fill()
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${sc.rgb}, 0.4)`; ctx.lineWidth = 1.5; ctx.stroke()
      })

      // Draw tooltip box
      if (tooltipData.length) {
        const ttW = 120, lineH = 18
        const ttH = tooltipData.length * lineH + 12
        let ttX = hoverX + 14
        let ttY = chart.y + 10
        if (ttX + ttW > chart.x + chart.w) ttX = hoverX - ttW - 14

        ctx.fillStyle = isDark ? 'rgba(12, 12, 14, 0.92)' : 'rgba(255, 255, 255, 0.95)'
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
        ctx.lineWidth = 1

        // Rounded rect
        const r = 6
        ctx.beginPath()
        ctx.moveTo(ttX + r, ttY); ctx.lineTo(ttX + ttW - r, ttY)
        ctx.quadraticCurveTo(ttX + ttW, ttY, ttX + ttW, ttY + r)
        ctx.lineTo(ttX + ttW, ttY + ttH - r)
        ctx.quadraticCurveTo(ttX + ttW, ttY + ttH, ttX + ttW - r, ttY + ttH)
        ctx.lineTo(ttX + r, ttY + ttH)
        ctx.quadraticCurveTo(ttX, ttY + ttH, ttX, ttY + ttH - r)
        ctx.lineTo(ttX, ttY + r)
        ctx.quadraticCurveTo(ttX, ttY, ttX + r, ttY)
        ctx.closePath()
        ctx.fill(); ctx.stroke()

        tooltipData.forEach((td, i) => {
          const rowY = ttY + 10 + i * lineH
          // Color dot
          ctx.beginPath(); ctx.arc(ttX + 12, rowY + 4, 4, 0, Math.PI * 2)
          ctx.fillStyle = td.color; ctx.fill()
          // Symbol
          ctx.font = `600 11px -apple-system, sans-serif`
          ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)'
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
          ctx.fillText(td.symbol, ttX + 22, rowY + 4)
          // Pct
          ctx.font = `700 11px var(--font-mono)`
          ctx.fillStyle = td.pct >= 0 ? '#10B981' : '#EF4444'
          ctx.textAlign = 'right'
          ctx.fillText(`${td.pct >= 0 ? '+' : ''}${td.pct.toFixed(2)}%`, ttX + ttW - 10, rowY + 4)
        })
      }
    }
  }, [dims, chartData, dayMode, hoverX, loading, fetchError, tokens, timeframe, dpr, tr, i18n?.language])

  return (
    <div className={`compare-overlay${dayMode ? ' day-mode' : ''}`} ref={containerRef}>
      <div className="compare-overlay-tf">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.id}
            className={`compare-overlay-tf-btn${timeframe === tf.id ? ' active' : ''}`}
            onClick={() => setTimeframe(tf.id)}
          >
            {tf.label}
          </button>
        ))}
      </div>
      <div className="compare-overlay-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="compare-overlay-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {loading && (
          <div className="compare-overlay-loading">
            <div className="compare-overlay-shimmer" />
          </div>
        )}
        {!loading && tokens.length < 2 && (
          <div className="compare-overlay-hint">
            {tr('heatmaps.compareMinHint')}
          </div>
        )}
        {!loading && fetchError && tokens.length >= 2 && (
          <div className="compare-overlay-hint">
            <button
              className="compare-overlay-retry"
              onClick={() => { retryRef.current = 0; doFetch() }}
            >
              {tr('heatmaps.retry')}
            </button>
          </div>
        )}
      </div>
      {/* Legend */}
      {chartData?.entities?.length > 0 && (
        <div className="compare-overlay-legend">
          {chartData.entities.map((ent, idx) => {
            const sym = tokens[idx]?.symbol || ent.name
            const sc = getTokenColor(sym, idx)
            const last = ent.data?.[ent.data.length - 1]
            return (
              <div key={ent.id || idx} className="compare-overlay-legend-item">
                <span className="compare-overlay-legend-dot" style={{ background: sc.color }} />
                <span className="compare-overlay-legend-sym">{sym}</span>
                {last && (
                  <span className={`compare-overlay-legend-pct ${last.pct >= 0 ? 'positive' : 'negative'}`}>
                    {last.pct >= 0 ? '+' : ''}{last.pct.toFixed(2)}%
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
