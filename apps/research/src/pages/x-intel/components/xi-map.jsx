/**
 * MAP — attention condensation. Every token on the live board plotted by the
 * two factors the backtest proved matter: author breadth (x) × mention
 * velocity (y). Size = weighted engagement, brightness = clean-signal share,
 * amber ring = promo-heavy. The IGNITION corner (broad AND accelerating) is
 * where runners are born — the quadrant thresholds are the proven ones
 * (breadth ≥ 8 authors, velocity ≥ 2× baseline), not decoration.
 *
 * Plain canvas, draw-on-change only (no rAF loop), DPR capped at 1.5.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import { computeRunnerScore } from '@/lib/runner-signal'
import { fmtUsdShort, fmtCount, ChainChip, XiShimmer, XiEmpty, XiError } from './xi-bits'

const BOOTSTRAP_PARAMS = {
  page: 1,
  perPage: 50,
  timeframe: '24h',
  ranking: 'momentum',
  segment: 'all',
  market: 'all',
  minKols: 1,
}

// Proven thresholds from the alpha backtest: breadth ≥5-8 distinct authors in
// the first hours, velocity ≥2× the token's own baseline.
const BREADTH_SPLIT = 8
const VELOCITY_SPLIT = 2

const PAD = { top: 28, right: 24, bottom: 40, left: 52 }

const log10 = (v) => Math.log10(Math.max(v, 0.01))

function buildPoints(rows) {
  return rows
    .map((row) => {
      const authors = Number(row.unique_external_authors_24h ?? row.author_count) || 0
      const velocity = Number(row.velocity_ratio) || 0
      if (authors <= 0 || velocity <= 0) return null
      const engagement = Number(row.external_weighted_engagement_24h ?? row.total_weighted_engagement) || 0
      const clean = Number(row.quality?.clean_signal_score_24h ?? row.clean_signal_score_24h) || 0
      const promo = Number(row.quality?.promo_share_24h) || 0
      const { score, tier } = computeRunnerScore(row)
      return {
        symbol: row.symbol,
        chain: row.chain,
        mcap: Number(row.market_cap) || null,
        authors,
        velocity,
        engagement,
        clean,
        promo,
        score,
        tier,
      }
    })
    .filter(Boolean)
}

export default function XiMap() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const { data, loading, error, refetch } = useXDashBootstrap(BOOTSTRAP_PARAMS, { refreshIntervalMs: 120_000 })
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const layoutRef = useRef([]) // [{px, py, r, point}] in CSS pixels, for hit-testing
  const [hover, setHover] = useState(null)

  const points = useMemo(() => buildPoints(data?.tokens || []), [data])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !points.length) return
    const cssW = wrap.clientWidth
    const cssH = Math.max(Math.min(Math.round(cssW * 0.56), 560), 320)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.height = `${cssH}px`
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const ink = dayMode ? '15, 23, 42' : '245, 245, 247'
    const plotW = cssW - PAD.left - PAD.right
    const plotH = cssH - PAD.top - PAD.bottom

    // 1.6× headroom keeps the largest dot inside the plot instead of clipping
    // at the right/top edge (log scale, so this is a modest visual margin).
    const xMax = Math.max(...points.map((p) => p.authors), BREADTH_SPLIT * 4) * 1.6
    const yMax = Math.max(...points.map((p) => p.velocity), VELOCITY_SPLIT * 4) * 1.6
    const xMin = 1
    const yMin = 0.2
    const xTo = (v) => PAD.left + ((log10(v) - log10(xMin)) / (log10(xMax) - log10(xMin))) * plotW
    const yTo = (v) => PAD.top + plotH - ((log10(v) - log10(yMin)) / (log10(yMax) - log10(yMin))) * plotH

    const splitX = xTo(BREADTH_SPLIT)
    const splitY = yTo(VELOCITY_SPLIT)

    // Ignition corner wash — a soft radial glow, not a neon block.
    const glow = ctx.createRadialGradient(cssW - PAD.right, PAD.top, 0, cssW - PAD.right, PAD.top, Math.max(plotW, plotH) * 0.55)
    glow.addColorStop(0, `rgba(${ink}, ${dayMode ? 0.07 : 0.055})`)
    glow.addColorStop(1, `rgba(${ink}, 0)`)
    ctx.fillStyle = glow
    ctx.fillRect(PAD.left, PAD.top, plotW, plotH)

    // Threshold lines (near-invisible, per the border discipline).
    ctx.strokeStyle = `rgba(${ink}, ${dayMode ? 0.14 : 0.1})`
    ctx.lineWidth = 1
    ctx.setLineDash([4, 5])
    ctx.beginPath()
    ctx.moveTo(splitX, PAD.top)
    ctx.lineTo(splitX, PAD.top + plotH)
    ctx.moveTo(PAD.left, splitY)
    ctx.lineTo(PAD.left + plotW, splitY)
    ctx.stroke()
    ctx.setLineDash([])

    // Quadrant labels.
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillStyle = `rgba(${ink}, ${dayMode ? 0.45 : 0.35})`
    ctx.textAlign = 'right'
    ctx.fillText('IGNITION — broad + accelerating', cssW - PAD.right, PAD.top - 8)
    ctx.textAlign = 'left'
    ctx.fillText('ECHO — fast, narrow crowd', PAD.left, PAD.top - 8)
    ctx.fillText('QUIET', PAD.left, PAD.top + plotH + 16)
    ctx.textAlign = 'right'
    ctx.fillText('CROWDED — broad, cooling', cssW - PAD.right, PAD.top + plotH + 16)

    // Axis captions.
    ctx.fillStyle = `rgba(${ink}, ${dayMode ? 0.55 : 0.45})`
    ctx.textAlign = 'center'
    ctx.fillText(`author breadth →   (split at ${BREADTH_SPLIT})`, PAD.left + plotW / 2, cssH - 8)
    ctx.save()
    ctx.translate(14, PAD.top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(`velocity vs own baseline →   (split at ${VELOCITY_SPLIT}×)`, 0, 0)
    ctx.restore()

    // Dots — engagement sizes, clean-signal brightens, promo gets an amber ring.
    const eMax = Math.max(...points.map((p) => p.engagement), 1)
    const layout = []
    for (const p of points) {
      const px = xTo(p.authors)
      const py = yTo(p.velocity)
      const r = 3 + Math.sqrt(p.engagement / eMax) * 13
      const ignition = p.authors >= BREADTH_SPLIT && p.velocity >= VELOCITY_SPLIT
      const alpha = (0.3 + p.clean * 0.55) * (ignition ? 1.15 : 1)
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${ink}, ${Math.min(alpha, 0.92)})`
      ctx.fill()
      if (ignition) {
        ctx.beginPath()
        ctx.arc(px, py, r + 2.5, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${ink}, 0.35)`
        ctx.lineWidth = 1
        ctx.stroke()
      }
      if (p.promo >= 0.2) {
        ctx.beginPath()
        ctx.arc(px, py, r + (ignition ? 5 : 2.5), 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      layout.push({ px, py, r, point: p })
    }

    // Labels for the strongest setups, decluttered greedily.
    const labeled = []
    const top = [...layout].sort((a, b) => b.point.score - a.point.score).slice(0, 8)
    ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'left'
    for (const item of top) {
      const lx = item.px + item.r + 5
      const ly = item.py + 3.5
      if (labeled.some((l) => Math.abs(l.lx - lx) < 64 && Math.abs(l.ly - ly) < 13)) continue
      ctx.fillStyle = `rgba(${ink}, ${dayMode ? 0.8 : 0.75})`
      ctx.fillText(`$${item.point.symbol}`, lx, ly)
      labeled.push({ lx, ly })
    }

    layoutRef.current = layout
  }, [points, dayMode])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const onMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let best = null
    let bestDist = Infinity
    for (const item of layoutRef.current) {
      const d = Math.hypot(item.px - mx, item.py - my)
      if (d < Math.max(item.r + 6, 12) && d < bestDist) {
        best = item
        bestDist = d
      }
    }
    // Only re-render when the hovered token actually changes.
    setHover((prev) => {
      if (best == null) return prev == null ? prev : null
      if (prev && prev.point.symbol === best.point.symbol) return prev
      return best
    })
  }, [])

  if (loading && !data) return <XiShimmer variant="card" count={1} />
  if (error && !data) return <XiError message={String(error)} onRetry={refetch} />
  if (!points.length) {
    return <XiEmpty title="No board data to map" detail="The attention board is empty for this window." />
  }

  return (
    <div className="xi-map">
      <div className="xi-map__wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="xi-map__canvas"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
        {hover ? (
          <div
            className="xi-map__tip"
            style={{
              left: Math.min(hover.px + 14, (wrapRef.current?.clientWidth || 600) - 190),
              top: Math.max(hover.py - 12, 8),
            }}
          >
            <div className="xi-map__tip-head">
              <b>${hover.point.symbol}</b>
              <ChainChip chain={hover.point.chain} />
            </div>
            <div className="xi-map__tip-line"><span>authors</span><b className="xi-num">{fmtCount(hover.point.authors)}</b></div>
            <div className="xi-map__tip-line"><span>velocity</span><b className="xi-num">{hover.point.velocity.toFixed(1)}×</b></div>
            {hover.point.mcap ? <div className="xi-map__tip-line"><span>mcap</span><b className="xi-num">{fmtUsdShort(hover.point.mcap)}</b></div> : null}
            <div className="xi-map__tip-line"><span>clean signal</span><b className="xi-num">{Math.round(hover.point.clean * 100)}%</b></div>
            <div className="xi-map__tip-line"><span>runner score</span><b className="xi-num">{hover.point.score}</b></div>
          </div>
        ) : null}
      </div>
      <div className="xi-map__legend">
        <span><span className="xi-legend-dot xi-legend-dot--big" /> size = engagement</span>
        <span><span className="xi-legend-dot xi-legend-dot--bright" /> brightness = clean signal</span>
        <span><span className="xi-legend-dot xi-legend-dot--promo" /> amber ring = promo-heavy</span>
        <span className="xi-map__legend-note">splits are the backtested thresholds, not decoration</span>
      </div>
    </div>
  )
}
