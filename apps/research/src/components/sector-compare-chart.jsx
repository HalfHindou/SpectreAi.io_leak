/**
 * SectorCompareChart – Apple Cinematic multi-line sector performance chart
 * Full-width canvas, refined line colors, smooth animated transitions
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getSectorSnapshot, getCachedSectorSnapshot } from '@/services/sectorSnapshot'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import './sector-compare-chart.css'

/* ── Sector colors (refined, institutional palette) ── */
const SECTOR_COLORS = {
  MEME:    { color: '#f472b6', rgb: '244,114,182', dimmed: 'rgba(244,114,182,0.18)' },
  L1:      { color: '#22d3ee', rgb: '34,211,238',  dimmed: 'rgba(34,211,238,0.18)' },
  DEFI:    { color: '#a78bfa', rgb: '167,139,250', dimmed: 'rgba(167,139,250,0.18)' },
  L2:      { color: '#e879f9', rgb: '232,121,249', dimmed: 'rgba(232,121,249,0.18)' },
  GAMING:  { color: '#fbbf24', rgb: '251,191,36',  dimmed: 'rgba(251,191,36,0.18)' },
  AI:      { color: '#34d399', rgb: '52,211,153',  dimmed: 'rgba(52,211,153,0.18)' },
  PRIVACY: { color: '#fb923c', rgb: '251,146,60',  dimmed: 'rgba(251,146,60,0.18)' },
}

/* ── Sector icons (SVG paths) ── */
const SECTOR_ICONS = {
  MEME:    <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>,
  L1:      <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></>,
  DEFI:    <><circle cx="12" cy="12" r="10" /><path d="M12 6v12M6 12h12" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" /></>,
  L2:      <><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></>,
  GAMING:  <><rect x="2" y="6" width="20" height="12" rx="2" /><line x1="6" y1="12" x2="10" y2="12" /><line x1="8" y1="10" x2="8" y2="14" /><circle cx="15" cy="11" r="1" /><circle cx="18" cy="13" r="1" /></>,
  AI:      <><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" /><line x1="10" y1="21" x2="14" y2="21" /></>,
  PRIVACY: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
}

const SECTOR_ORDER = ['MEME', 'L1', 'DEFI', 'L2', 'GAMING', 'AI', 'PRIVACY']


/* ── Easing ── */
const easeOutCubic = t => 1 - Math.pow(1 - t, 3)

/* ── Deterministic CoinGecko fallback ──
 * When the server's /api/sector/lines is unavailable, we fetch the top coin's
 * 168-hour sparkline per CoinGecko category and shape it for aggregation.
 * Result is stable: same inputs → same curves across refreshes, and the
 * numbers match the Sectors panel's signal-breakdown cards.
 */
const CG_CATEGORY_BY_SECTOR = {
  MEME:    'meme-token',
  L1:      'layer-1',
  DEFI:    'decentralized-finance-defi',
  L2:      'layer-2',
  GAMING:  'gaming',
  AI:      'artificial-intelligence',
  PRIVACY: 'privacy-coins',
}

const WINDOW_HOURS = 168            // 7-day window — full CoinGecko sparkline
const OUTLIER_PCT = 120             // drop tokens whose window move > |120%| — shitcoin skew over 7d

const SECTOR_BY_CG_CATEGORY = Object.fromEntries(
  Object.entries(CG_CATEGORY_BY_SECTOR).map(([sec, slug]) => [slug, sec])
)

const SECTOR_SLUGS = Object.values(CG_CATEGORY_BY_SECTOR)

/* Snapshot payload → flat [ts, symbol, price, sector] rows. Pure, sync. */
function snapshotToRaw(snapshot) {
  const nowSec = Math.floor(Date.now() / 1000)
  const out = []
  for (const sectorEntry of snapshot?.sectors || []) {
    const sec = SECTOR_BY_CG_CATEGORY[sectorEntry.id]
    if (!sec) continue
    const shaped = (sectorEntry.tokens || [])
      .map(t => {
        const prices = Array.isArray(t.sparkline) ? t.sparkline.slice(-WINDOW_HOURS) : null
        if (!prices || prices.length < 2) return null
        return { symbol: t.symbol, prices }
      })
      .filter(Boolean)
    const clean = shaped.filter(t => {
      const base = t.prices[0]
      const last = t.prices[t.prices.length - 1]
      if (!base) return false
      return Math.abs(((last - base) / base) * 100) <= OUTLIER_PCT
    })
    const picked = clean.length >= 3 ? clean : shaped
    for (const t of picked) {
      const n = t.prices.length
      for (let i = 0; i < n; i++) {
        const ts = nowSec - (n - 1 - i) * 3600
        out.push([ts, t.symbol, t.prices[i], sec])
      }
    }
  }
  return out
}

/* Fetch through the shared snapshot service (5min server cache + client dedup). */
async function fetchCgSectorFallback() {
  const snapshot = await getSectorSnapshot(SECTOR_SLUGS)
  return snapshotToRaw(snapshot)
}

/* ── Aggregate raw → sector % lines ── */
function aggregateSectorData(rawData) {
  const sectorTokens = {}
  rawData.forEach(([ts, sym, price, sector]) => {
    if (!sector || !price) return
    if (!sectorTokens[sector]) sectorTokens[sector] = {}
    if (!sectorTokens[sector][sym]) sectorTokens[sector][sym] = []
    sectorTokens[sector][sym].push({ ts, price })
  })
  const sectorLines = {}
  const allTs = new Set()
  Object.entries(sectorTokens).forEach(([sector, tokens]) => {
    const tokenPcts = {}
    Object.entries(tokens).forEach(([sym, series]) => {
      series.sort((a, b) => a.ts - b.ts)
      const base = series[0].price
      if (base <= 0) return
      tokenPcts[sym] = series.map(pt => ({ ts: pt.ts, pct: ((pt.price - base) / base) * 100 }))
      series.forEach(pt => allTs.add(pt.ts))
    })
    const timeMap = {}
    Object.values(tokenPcts).forEach(s => s.forEach(({ ts, pct }) => {
      if (!timeMap[ts]) timeMap[ts] = []
      timeMap[ts].push(pct)
    }))
    const sorted = Object.keys(timeMap).map(Number).sort((a, b) => a - b)
    sectorLines[sector] = sorted.map(ts => {
      const arr = timeMap[ts]
      const pct = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
      return { ts, pct }
    })
  })
  return { sectorLines, timestamps: [...allTs].sort((a, b) => a - b) }
}

function formatDate(ts) {
  const d = new Date(ts * 1000)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatDateTime(ts, locale = 'en') {
  const d = new Date(ts * 1000)
  const monthDay = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${monthDay}, ${hh}:${mm}`
}

/* ═══ COMPONENT ═══ */
const SectorCompareChart = ({ dayMode = false, compact = false }) => {
  const { t, i18n } = useTranslation()
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const rootRef = useRef(null)
  const animFrameRef = useRef(null)
  // Hydrate synchronously from the shared snapshot cache so a second visit
  // to the Sectors tab (within 5min TTL) paints fully on the first frame
  // instead of flashing the loading shimmer.
  const [sectorData, setSectorData] = useState(() => {
    const cached = getCachedSectorSnapshot(SECTOR_SLUGS)
    if (!cached) return null
    const raw = snapshotToRaw(cached)
    return raw.length ? aggregateSectorData(raw) : null
  })
  const [loading, setLoading] = useState(() => !getCachedSectorSnapshot(SECTOR_SLUGS))
  const [enabledSectors, setEnabledSectors] = useState(() => {
    const m = {}; SECTOR_ORDER.forEach(s => { m[s] = true }); return m
  })
  const [hoverInfo, setHoverInfo] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [dimensions, setDimensions] = useState({ w: 0, h: 500 })

  const sectorOpacityRef = useRef({})
  const sectorTargetRef = useRef({})
  const yRangeAnimRef = useRef(null)
  const isAnimatingRef = useRef(false)
  const hasInitializedYRange = useRef(false)

  useEffect(() => {
    SECTOR_ORDER.forEach(s => {
      if (sectorOpacityRef.current[s] === undefined) {
        sectorOpacityRef.current[s] = 1
        sectorTargetRef.current[s] = 1
      }
    })
  }, [])

  /* ── Fetch ──
   * Tries the server /api/sector/lines first. If that's down, falls back to
   * deterministic CoinGecko category sparklines so the chart numbers stay
   * stable across refreshes AND match the Sectors signal-breakdown cards.
   */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // SECTOR_API is null (no sector backend), so the series is always built
      // deterministically from CoinGecko. (Was wrapped in a dead try/`if(!SECTOR_API)
      // throw`/fetch block that never ran - collapsed to the fallback directly.)
      const fallback = await fetchCgSectorFallback().catch(() => [])
      if (!cancelled) {
        setSectorData(aggregateSectorData(fallback.length ? fallback : []))
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* ── Fullscreen ── */
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      // Silent: user may reject fullscreen permission - not a real error
      el.requestFullscreen?.().catch(() => {})
    } else {
      // Silent: exitFullscreen may throw if not in fullscreen - not a real error
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /* ── Resize ── */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) {
        let h
        if (isFullscreen) {
          h = window.innerHeight - 140
        } else if (compact) {
          h = w <= 768 ? Math.min(w * 0.85, 380) : 320
        } else {
          h = w <= 768 ? 340 : 500
        }
        setDimensions({ w, h })
      }
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [isFullscreen, compact, loading])

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
  const PAD = useMemo(() => ({
    top: 20, right: dimensions.w <= 768 ? 44 : 64, bottom: 36, left: dimensions.w <= 768 ? 8 : 16
  }), [dimensions.w])
  const chart = useMemo(() => ({
    x: PAD.left, y: PAD.top,
    w: dimensions.w - PAD.left - PAD.right,
    h: dimensions.h - PAD.top - PAD.bottom,
  }), [dimensions, PAD])

  const allLines = useMemo(() => {
    if (!sectorData) return {}
    const r = {}
    SECTOR_ORDER.forEach(s => { if (sectorData.sectorLines[s]) r[s] = sectorData.sectorLines[s] })
    return r
  }, [sectorData])

  const targetYRange = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    SECTOR_ORDER.forEach(s => {
      if (!enabledSectors[s] || !allLines[s]) return
      allLines[s].forEach(p => {
        if (p.pct < lo) lo = p.pct
        if (p.pct > hi) hi = p.pct
      })
    })
    if (!isFinite(lo)) return { min: -5, max: 5 }
    const range = hi - lo || 4
    return { min: lo - range * 0.1, max: hi + range * 0.1 }
  }, [allLines, enabledSectors])

  const xTs = useMemo(() => sectorData?.timestamps || [], [sectorData])

  const mapX = useCallback(ts => {
    if (xTs.length < 2) return chart.x
    const f = xTs[0], l = xTs[xTs.length - 1]
    return chart.x + ((ts - f) / (l - f || 1)) * chart.w
  }, [xTs, chart])

  /* ── Animated draw loop ── */
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !sectorData || dimensions.w === 0) return

    let needsAnim = false
    const LERP_SPEED = 0.08
    SECTOR_ORDER.forEach(s => {
      const target = sectorTargetRef.current[s] ?? 1
      const current = sectorOpacityRef.current[s] ?? 1
      if (Math.abs(target - current) > 0.005) {
        sectorOpacityRef.current[s] = current + (target - current) * LERP_SPEED
        needsAnim = true
      } else {
        sectorOpacityRef.current[s] = target
      }
    })

    if (!yRangeAnimRef.current || !hasInitializedYRange.current) {
      yRangeAnimRef.current = { min: targetYRange.min, max: targetYRange.max }
      hasInitializedYRange.current = true
    }
    const yr = yRangeAnimRef.current
    const dyMin = targetYRange.min - yr.min
    const dyMax = targetYRange.max - yr.max
    if (Math.abs(dyMin) > 0.01 || Math.abs(dyMax) > 0.01) {
      yr.min += dyMin * LERP_SPEED
      yr.max += dyMax * LERP_SPEED
      needsAnim = true
    } else {
      yr.min = targetYRange.min
      yr.max = targetYRange.max
    }

    const mapY = pct => chart.y + chart.h - ((pct - yr.min) / (yr.max - yr.min)) * chart.h

    const ctx = canvas.getContext('2d')
    const { w, h } = dimensions

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const isDark = !dayMode
    const gridColor = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)'
    const textColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.25)'
    const zeroColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'

    // ── Grid lines ──
    const steps = 8
    const yStep = (yr.max - yr.min) / steps
    const labelFont = w <= 768 ? '500 9px' : '500 10px'
    const labelOffset = w <= 768 ? 6 : 10
    ctx.font = `${labelFont} -apple-system, BlinkMacSystemFont, var(--font-mono), var(--font-mono)`
    for (let i = 0; i <= steps; i++) {
      const val = yr.min + yStep * i
      const y = mapY(val)
      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(chart.x, y); ctx.lineTo(chart.x + chart.w, y); ctx.stroke()
      ctx.fillStyle = textColor
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${val >= 0 ? '+' : ''}${val.toFixed(0)}%`, chart.x + chart.w + labelOffset, y)
    }

    // ── Zero line ──
    const zy = mapY(0)
    if (zy >= chart.y && zy <= chart.y + chart.h) {
      ctx.strokeStyle = zeroColor
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.moveTo(chart.x, zy); ctx.lineTo(chart.x + chart.w, zy); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'
      ctx.font = `600 ${w <= 768 ? '9px' : '10px'} -apple-system, BlinkMacSystemFont, var(--font-mono), var(--font-mono)`
      ctx.textAlign = 'left'
      ctx.fillText('0%', chart.x + chart.w + labelOffset, zy)
    }

    // ── X-axis labels ──
    if (xTs.length > 0) {
      const count = Math.min(12, Math.floor(chart.w / 90))
      const step = Math.max(1, Math.floor(xTs.length / count))
      ctx.fillStyle = textColor
      ctx.font = `500 9px -apple-system, BlinkMacSystemFont, var(--font-mono), var(--font-mono)`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let i = 0; i < xTs.length; i += step) {
        const x = mapX(xTs[i])
        ctx.strokeStyle = gridColor
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, chart.y + chart.h); ctx.lineTo(x, chart.y + chart.h + 5); ctx.stroke()
        ctx.fillText(formatDate(xTs[i]), x, chart.y + chart.h + 9)
      }
    }

    // ── Clip to chart area ──
    ctx.save()
    ctx.beginPath()
    ctx.rect(chart.x, chart.y, chart.w, chart.h)
    ctx.clip()

    // ── Sector lines ──
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash([])

    SECTOR_ORDER.forEach(sector => {
      const line = allLines[sector]
      if (!line || line.length < 2) return
      const sc = SECTOR_COLORS[sector]
      if (!sc) return
      const opacity = sectorOpacityRef.current[sector] ?? 0
      if (opacity < 0.005) return

      ctx.save()
      ctx.globalAlpha = opacity

      // Soft glow (subtle, not neon)
      ctx.beginPath()
      line.forEach((pt, i) => { const x = mapX(pt.ts), y = mapY(pt.pct); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.strokeStyle = `rgba(${sc.rgb}, 0.15)`
      ctx.lineWidth = 4
      ctx.stroke()

      // Main line
      ctx.beginPath()
      line.forEach((pt, i) => { const x = mapX(pt.ts), y = mapY(pt.pct); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.strokeStyle = sc.color
      ctx.lineWidth = 1.8
      ctx.stroke()

      // End dot — clean, no outer glow ring
      const last = line[line.length - 1]
      const ex = mapX(last.ts), ey = mapY(last.pct)
      ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = sc.color; ctx.fill()
      ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, Math.PI * 2)
      ctx.fillStyle = isDark ? '#fff' : '#000'; ctx.fill()

      ctx.restore()
    })

    ctx.restore()

    // ── Hover crosshair (white gradient, no purple) ──
    if (hoverInfo?.ts != null) {
      const hx = mapX(hoverInfo.ts)
      const vGrad = ctx.createLinearGradient(0, chart.y, 0, chart.y + chart.h)
      const crossColor = isDark ? '245,245,247' : '15,23,42'
      vGrad.addColorStop(0, `rgba(${crossColor},0)`)
      vGrad.addColorStop(0.3, `rgba(${crossColor},0.15)`)
      vGrad.addColorStop(0.7, `rgba(${crossColor},0.15)`)
      vGrad.addColorStop(1, `rgba(${crossColor},0)`)
      ctx.strokeStyle = vGrad
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(hx, chart.y); ctx.lineTo(hx, chart.y + chart.h); ctx.stroke()

      SECTOR_ORDER.forEach(sector => {
        const line = allLines[sector]
        if (!line) return
        const opacity = sectorOpacityRef.current[sector] ?? 0
        if (opacity < 0.1) return
        const sc = SECTOR_COLORS[sector]
        if (!sc) return
        let closest = line[0], minD = Infinity
        line.forEach(pt => { const d = Math.abs(pt.ts - hoverInfo.ts); if (d < minD) { minD = d; closest = pt } })
        const dx = mapX(closest.ts), dy = mapY(closest.pct)
        ctx.save()
        ctx.globalAlpha = opacity
        ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${sc.rgb}, 0.2)`; ctx.fill()
        ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2)
        ctx.fillStyle = sc.color; ctx.fill()
        ctx.beginPath(); ctx.arc(dx, dy, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = isDark ? '#fff' : '#000'; ctx.fill()
        ctx.restore()
      })
    }

    // ── Watermark ──
    drawSpectreWatermark(ctx, { w, h, dark: isDark })

    isAnimatingRef.current = needsAnim
    if (needsAnim) {
      animFrameRef.current = requestAnimationFrame(drawFrame)
    }
  }, [sectorData, allLines, dimensions, dpr, dayMode, hoverInfo, chart, mapX, targetYRange, xTs])

  useEffect(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    animFrameRef.current = requestAnimationFrame(drawFrame)
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
  }, [drawFrame])

  /* ── Pointer helpers ── */
  const updateHover = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas || !xTs.length) return
    const rect = canvas.getBoundingClientRect()
    const mx = clientX - rect.left, my = clientY - rect.top
    if (mx < chart.x || mx > chart.x + chart.w || my < chart.y || my > chart.y + chart.h) { setHoverInfo(null); return }
    const f = xTs[0], l = xTs[xTs.length - 1]
    const ts = f + ((mx - chart.x) / chart.w) * (l - f || 1)
    const values = {}
    SECTOR_ORDER.forEach(sec => {
      const line = allLines[sec]
      if (!line || (sectorOpacityRef.current[sec] ?? 0) < 0.1) return
      let cl = line[0], md = Infinity
      line.forEach(pt => { const d = Math.abs(pt.ts - ts); if (d < md) { md = d; cl = pt } })
      values[sec] = cl.pct
    })
    setHoverInfo({ ts, x: mx, y: my, values })
  }, [xTs, chart, allLines])

  const handleMouseMove = useCallback(e => updateHover(e.clientX, e.clientY), [updateHover])
  const handleMouseLeave = useCallback(() => setHoverInfo(null), [])

  /* ── Touch (mobile drag-to-inspect) ── */
  const touchActiveRef = useRef(false)
  const updateHoverRef = useRef(updateHover)
  updateHoverRef.current = updateHover

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onTouchStart = e => {
      const t = e.touches[0]
      if (!t) return
      touchActiveRef.current = true
      updateHoverRef.current(t.clientX, t.clientY)
    }
    const onTouchMove = e => {
      if (!touchActiveRef.current) return
      e.preventDefault()
      const t = e.touches[0]
      if (t) updateHoverRef.current(t.clientX, t.clientY)
    }
    const onTouchEnd = () => {
      touchActiveRef.current = false
      setHoverInfo(null)
    }
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [loading])

  const toggleSector = useCallback(sec => {
    setEnabledSectors(prev => {
      const next = { ...prev, [sec]: !prev[sec] }
      if (!Object.values(next).some(Boolean)) return prev
      SECTOR_ORDER.forEach(s => {
        sectorTargetRef.current[s] = next[s] ? 1 : 0
      })
      if (!isAnimatingRef.current) {
        isAnimatingRef.current = true
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = requestAnimationFrame(drawFrame)
      }
      return next
    })
  }, [drawFrame])

  // Pill order — best performing first, worst last. Falls back to the
  // canonical SECTOR_ORDER while data is loading so the row stays stable.
  const pillOrder = useMemo(() => {
    if (!sectorData) return SECTOR_ORDER
    return SECTOR_ORDER.slice().sort((a, b) => {
      const la = allLines[a]?.[allLines[a]?.length - 1]?.pct
      const lb = allLines[b]?.[allLines[b]?.length - 1]?.pct
      return (lb ?? -Infinity) - (la ?? -Infinity)
    })
  }, [sectorData, allLines])

  /* ── Render ── */
  return (
    <div className={`sector-compare-root ${dayMode ? 'day-mode' : ''} ${isFullscreen ? 'fullscreen' : ''} ${compact ? 'compact' : ''}`} ref={rootRef}>
      {/* Header */}
      <div className="sector-compare-header">
        <div className="sector-compare-header-left">
          <div className="sector-compare-titles">
            <h2 className="sector-compare-title">{t('aiChartsChrome.sectorCompare.title', 'Sector Performance')}</h2>
            <p className="sector-compare-subtitle">{t('aiChartsChrome.sectorCompare.subtitle', 'Relative % change across 7 crypto sectors · averaged per token')}</p>
          </div>
        </div>
        <div className="sector-compare-header-right">
          <span className="sector-compare-live-dot" />
          <span className="sector-compare-live-text">{t('aiChartsChrome.sectorCompare.live', 'LIVE')}</span>
          {!compact && (
            <button className="sector-compare-fullscreen-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? t('aiChartsChrome.sectorCompare.exitFullscreen', 'Exit fullscreen') : t('aiChartsChrome.sectorCompare.fullscreen', 'Fullscreen')}>
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 8 14 8 18" />
                  <polyline points="20 10 16 10 16 6" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Sector pills — sorted best→worst */}
      <div className="sector-compare-pills">
        {pillOrder.map(sec => {
          const sc = SECTOR_COLORS[sec]
          const on = enabledSectors[sec]
          // Window is 24H, so the last cumulative % from t-0 IS the 24h change.
          const last = allLines[sec]?.[allLines[sec]?.length - 1]?.pct
          return (
            <button
              key={sec}
              className={`sc-pill ${on ? 'on' : ''}`}
              onClick={() => toggleSector(sec)}
              style={{ '--sc': sc.color, '--scr': sc.rgb }}
            >
              <span className="sc-pill-accent" />
              <span className="sc-pill-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {SECTOR_ICONS[sec]}
                </svg>
              </span>
              <span className="sc-pill-name">{sec}</span>
              {on && last != null && (
                <span className={`sc-pill-pct ${last >= 0 ? 'up' : 'dn'}`}>
                  {last >= 0 ? '+' : ''}{last.toFixed(1)}%
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Canvas */}
      <div className="sector-compare-canvas-container" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="sector-compare-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ touchAction: 'none' }}
        />

        {loading && (
          <div className="sector-compare-canvas-shimmer" aria-hidden="true">
            <div className="sc-shimmer-bar" />
            <div className="sc-shimmer-bar" />
            <div className="sc-shimmer-bar" />
          </div>
        )}

        {/* Tooltip */}
        {hoverInfo && (
          <div
            className="sc-tooltip"
            style={{
              left: hoverInfo.x > dimensions.w * 0.65 ? hoverInfo.x - 180 : hoverInfo.x + 16,
              top: Math.min(Math.max(hoverInfo.y - 20, 8), dimensions.h - (Object.keys(hoverInfo.values).length * 22 + 50)),
            }}
          >
            <div className="sc-tooltip-header">{formatDateTime(hoverInfo.ts, i18n.language)}</div>
            <div className="sc-tooltip-sep" />
            {Object.entries(hoverInfo.values)
              .sort((a, b) => b[1] - a[1])
              .map(([sec, pct]) => (
                <div key={sec} className="sc-tooltip-row">
                  <span className="sc-tooltip-color" style={{ background: SECTOR_COLORS[sec]?.color }} />
                  <span className="sc-tooltip-name">{sec}</span>
                  <span className={`sc-tooltip-val ${pct >= 0 ? 'up' : 'dn'}`}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </span>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  )
}

// memo: parent re-renders on every search keystroke / category toggle / fav change;
// this heavy canvas component's only prop (dayMode) rarely changes.
export default React.memo(SectorCompareChart)
