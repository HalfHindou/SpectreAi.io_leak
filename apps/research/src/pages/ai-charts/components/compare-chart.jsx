/**
 * CompareChart - Compare Chains / Sectors / Tokens performance
 * Three-section multi-select on left (chains, sectors, tokens with checkboxes)
 * Canvas line chart on right - up to 5 entities compared at once
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { searchCoinsForROI, getCategories } from '@/services/coinGeckoApi'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import { fngBand, fngLineColor, fngLineRgb, loadFngHistory, cachedFngRows } from '@/lib/fear-greed-scale'
import analyseSentimentLead from '@/lib/sentiment-lead'
import './compare-chart.css'

/* ── Color palette - 5 distinct chart-friendly hues ── */
const COMPARE_COLORS = [
  { color: '#00f0ff', rgb: '0,240,255' },
  { color: '#ff6b9d', rgb: '255,107,157' },
  { color: '#34d399', rgb: '52,211,153' },
  { color: '#fbbf24', rgb: '251,191,36' },
  { color: '#a78bfa', rgb: '167,139,250' },
]

const MAX_SELECTIONS = 5
const COLLAPSED_COUNT = 8

/* ── Static chain list ── */
const CHAINS = [
  { id: 'ethereum', name: 'Ethereum' },
  { id: 'solana', name: 'Solana' },
  { id: 'bsc', name: 'BNB Chain' },
  { id: 'polygon', name: 'Polygon' },
  { id: 'arbitrum', name: 'Arbitrum' },
  { id: 'base', name: 'Base' },
  { id: 'avalanche', name: 'Avalanche' },
  { id: 'optimism', name: 'Optimism' },
  { id: 'fantom', name: 'Fantom' },
  { id: 'sui', name: 'Sui' },
  { id: 'aptos', name: 'Aptos' },
  { id: 'sei', name: 'Sei' },
  { id: 'injective', name: 'Injective' },
  { id: 'near', name: 'NEAR' },
  { id: 'mantle', name: 'Mantle' },
  { id: 'cronos', name: 'Cronos' },
  { id: 'ton', name: 'TON' },
  { id: 'berachain', name: 'Berachain' },
  { id: 'linea', name: 'Linea' },
  { id: 'zksync', name: 'zkSync' },
  { id: 'scroll', name: 'Scroll' },
  { id: 'blast', name: 'Blast' },
  { id: 'celo', name: 'Celo' },
  { id: 'tron', name: 'Tron' },
  { id: 'cosmos', name: 'Cosmos' },
]

/* ── Popular tokens shown by default in the Tokens section ── */
const POPULAR_TOKENS = [
  { id: 'bitcoin', name: 'Bitcoin (BTC)' },
  { id: 'ethereum', name: 'Ethereum (ETH)' },
  { id: 'solana', name: 'Solana (SOL)' },
  { id: 'binancecoin', name: 'BNB (BNB)' },
  { id: 'ripple', name: 'XRP (XRP)' },
  { id: 'cardano', name: 'Cardano (ADA)' },
  { id: 'dogecoin', name: 'Dogecoin (DOGE)' },
  { id: 'avalanche-2', name: 'Avalanche (AVAX)' },
]

/* ── Section icons (SVG paths) ── */
const SECTION_ICONS = {
  chain: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  sector: <><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>,
  token: <><circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10l4-4 4 4M8 14l4 4 4-4" /></>,
}

/* ── Timeframe options ── */
const TIMEFRAMES = [
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
]

/* CoinGecko names a few coins after their own ticker, so the "name (SYMBOL)"
   label degenerates to "BNB (BNB)" — fine in a chip, clumsy in a sentence. */
function shortName(name) {
  const m = /^(.+?)\s*\(([^)]+)\)$/.exec(String(name || ''))
  if (!m) return name
  return m[1].trim().toUpperCase() === m[2].trim().toUpperCase() ? m[1].trim() : name
}

/* ── Chart drawing helpers ── */
function formatDate(ts, locale) {
  const d = new Date(ts * 1000)
  try {
    return new Intl.DateTimeFormat(locale || undefined, { day: '2-digit', month: '2-digit' }).format(d)
  } catch {
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  }
}

function formatDateTime(ts, locale) {
  const d = new Date(ts * 1000)
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${m[d.getMonth()]} ${d.getDate()}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
}

/* ═══ COMPONENT ═══ */
function CompareChart({ dayMode = false, compact = false }) {
  const { t, i18n } = useTranslation()
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const rootRef = useRef(null)
  const animFrameRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  /* Selections: ordered array of { type, id, name }. Order determines line color. */
  const [selections, setSelections] = useState([])
  const [searches, setSearches] = useState({ chain: '', sector: '', token: '' })
  const [expanded, setExpanded] = useState({ chain: false, sector: false, token: false })
  const [categories, setCategories] = useState([])
  const [tokenResults, setTokenResults] = useState([])
  const [tokenLoading, setTokenLoading] = useState(false)

  const [timeframe, setTimeframe] = useState(30)
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [hoverInfo, setHoverInfo] = useState(null)
  const [dimensions, setDimensions] = useState({ w: 0, h: 500 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [chartHeight, setChartHeight] = useState(compact ? 420 : 500)

  /* Fear & Greed overlay */
  const [fngOn, setFngOn] = useState(false)
  const [fngRows, setFngRows] = useState(cachedFngRows)
  const [fngError, setFngError] = useState(false)

  const yRangeAnimRef = useRef(null)
  /* Per-entity entrance animation: Map<entityKey, { opacity, yOffset }> */
  const entityAnimRef = useRef(new Map())

  /* ── Fetch categories on mount ── */
  useEffect(() => {
    getCategories().then(cats => {
      if (Array.isArray(cats)) {
        setCategories(cats.map(c => ({ id: c.id, name: c.name })))
      }
    }).catch(() => {})
  }, [])

  /* ── Fear & Greed history - fetched the first time the overlay is turned on ── */
  useEffect(() => {
    if (!fngOn || fngRows) return undefined
    let cancelled = false
    setFngError(false)
    loadFngHistory()
      .then(rows => { if (!cancelled) setFngRows(rows) })
      .catch(() => { if (!cancelled) setFngError(true) })
    return () => { cancelled = true }
  }, [fngOn, fngRows])

  /* ── Resize ── */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) {
        let h
        if (isFullscreen) h = window.innerHeight - 140
        else if (compact) h = Math.max(220, el.clientHeight || 320)
        else h = chartHeight
        setDimensions({ w, h })
      }
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [isFullscreen, chartHeight, compact])

  /* ── Resize drag handle ── */
  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = chartHeight
    const onMove = (ev) => {
      const delta = ev.clientY - startY
      setChartHeight(Math.max(300, Math.min(startH + delta, 900)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [chartHeight])

  /* ── Fullscreen ── */
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {})
    else document.exitFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /* ── Selection helpers ── */
  const isSelected = useCallback((type, id) =>
    selections.some(s => s.type === type && s.id === id), [selections])

  const indexOfSelection = useCallback((type, id) =>
    selections.findIndex(s => s.type === type && s.id === id), [selections])

  const toggleItem = useCallback((type, item) => {
    setSelections(prev => {
      const idx = prev.findIndex(s => s.type === type && s.id === item.id)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      if (prev.length >= MAX_SELECTIONS) return prev
      return [...prev, { type, id: item.id, name: item.name }]
    })
  }, [])

  const removeSelection = useCallback((type, id) => {
    setSelections(prev => prev.filter(s => !(s.type === type && s.id === id)))
  }, [])

  const clearAll = useCallback(() => setSelections([]), [])

  /* ── Search per section ── */
  const handleSearchChange = useCallback((type, value) => {
    setSearches(prev => ({ ...prev, [type]: value }))

    if (type !== 'token') return

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    const q = value.trim()
    if (!q) {
      setTokenResults([])
      setTokenLoading(false)
      return
    }
    setTokenLoading(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchCoinsForROI(q)
        setTokenResults(results.map(c => ({ id: c.id, name: `${c.name} (${c.symbol})` })))
      } catch {
        setTokenResults([])
      } finally {
        setTokenLoading(false)
      }
    }, 250)
  }, [])

  /* ── Filtered items per section ── */
  const filteredChains = useMemo(() => {
    const q = searches.chain.trim().toLowerCase()
    if (!q) return CHAINS
    return CHAINS.filter(c => c.name.toLowerCase().includes(q) || c.id.includes(q))
  }, [searches.chain])

  const filteredSectors = useMemo(() => {
    const q = searches.sector.trim().toLowerCase()
    if (!q) return categories
    return categories.filter(c => c.name.toLowerCase().includes(q))
  }, [searches.sector, categories])

  const tokenItems = useMemo(() => {
    return searches.token.trim() ? tokenResults : POPULAR_TOKENS
  }, [searches.token, tokenResults])

  /* ── Fetch chart data when selections change ── */
  const fetchKey = useMemo(() => {
    if (!selections.length) return ''
    return selections.map(s => `${s.type}:${s.id}`).join('|') + '|' + timeframe
  }, [selections, timeframe])

  useEffect(() => {
    if (!fetchKey) {
      setChartData(null)
      return
    }

    let cancelled = false
    let controller = null
    let loaded = false

    const run = () => {
      // Skip while backgrounded - re-fires on visibilitychange below
      if (typeof document !== 'undefined' && document.hidden) return
      controller = new AbortController()
      setLoading(true)
      const url = `/api/compare/chart?entities=${encodeURIComponent(JSON.stringify(selections))}&days=${timeframe}`
      fetch(url, { signal: controller.signal })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then(data => {
          if (cancelled) return
          // Seed entrance animation for any newly-arrived entity
          if (data?.entities?.length) {
            const seenKeys = new Set()
            data.entities.forEach(ent => {
              const key = `${ent.type}:${ent.id}`
              seenKeys.add(key)
              if (!entityAnimRef.current.has(key)) {
                entityAnimRef.current.set(key, { opacity: 0, yOffset: -60 })
              }
            })
            // Drop animation state for entities that left the chart
            for (const key of entityAnimRef.current.keys()) {
              if (!seenKeys.has(key)) entityAnimRef.current.delete(key)
            }
          } else {
            entityAnimRef.current.clear()
          }
          loaded = true
          setChartData(data)
          setLoading(false)
        })
        .catch((err) => {
          if (cancelled || err?.name === 'AbortError') return
          setChartData(null)
          setLoading(false)
        })
    }

    const onVisibility = () => {
      if (document.hidden) {
        // Abort the in-flight request when the tab is hidden
        if (controller) controller.abort()
      } else if (!loaded) {
        // Tab is back and this fetchKey never loaded (skipped or aborted) - run now
        run()
      }
    }

    run()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (controller) controller.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Chart layout ── */
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
  const PAD = useMemo(() => ({ top: 16, right: 80, bottom: 36, left: fngOn ? 42 : 16 }), [fngOn])
  const chart = useMemo(() => ({
    x: PAD.left, y: PAD.top,
    w: dimensions.w - PAD.left - PAD.right,
    h: dimensions.h - PAD.top - PAD.bottom,
  }), [dimensions, PAD])

  /* ── Y range ── */
  const targetYRange = useMemo(() => {
    if (!chartData?.entities) return { min: -5, max: 5 }
    let lo = Infinity, hi = -Infinity
    chartData.entities.forEach(ent => {
      if (!ent.data?.length) return
      ent.data.forEach(p => { if (p.pct < lo) lo = p.pct; if (p.pct > hi) hi = p.pct })
    })
    if (!isFinite(lo)) return { min: -5, max: 5 }
    const range = hi - lo || 4
    return { min: lo - range * 0.1, max: hi + range * 0.1 }
  }, [chartData])

  /* ── Timestamps ── */
  const xTs = useMemo(() => {
    if (!chartData?.entities) return []
    const all = new Set()
    chartData.entities.forEach(ent => ent.data?.forEach(p => all.add(p.ts)))
    return [...all].sort((a, b) => a - b)
  }, [chartData])

  /* F&G points trimmed to the window the lines cover (+1 day of slack so the
     series still reaches both edges of the plot). */
  const fngPoints = useMemo(() => {
    if (!fngOn || !fngRows?.length || xTs.length < 2) return []
    const first = xTs[0] - 86400, last = xTs[xTs.length - 1] + 86400
    return fngRows.filter(p => p.t >= first && p.t <= last)
  }, [fngOn, fngRows, xTs])

  const fngLatest = fngPoints.length ? fngPoints[fngPoints.length - 1] : null

  const fngInsight = useMemo(() => {
    if (!fngOn || !fngPoints.length || !chartData?.entities?.length) return null
    return analyseSentimentLead({
      fngPoints,
      entities: chartData.entities,
      colors: COMPARE_COLORS.map((c) => c.color),
    })
  }, [fngOn, fngPoints, chartData])

  const mapX = useCallback(ts => {
    if (xTs.length < 2) return chart.x
    const f = xTs[0], l = xTs[xTs.length - 1]
    return chart.x + ((ts - f) / (l - f || 1)) * chart.w
  }, [xTs, chart])

  /* ── Draw frame ── */
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || dimensions.w === 0) return

    const ctx = canvas.getContext('2d')
    const { w, h } = dimensions

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const isDark = !dayMode
    const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'
    const textColor = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.3)'
    const zeroColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'

    if (!yRangeAnimRef.current) {
      yRangeAnimRef.current = { min: targetYRange.min, max: targetYRange.max }
    }
    const yr = yRangeAnimRef.current
    let needsAnim = false
    const LERP = 0.08
    const dyMin = targetYRange.min - yr.min
    const dyMax = targetYRange.max - yr.max
    if (Math.abs(dyMin) > 0.01 || Math.abs(dyMax) > 0.01) {
      yr.min += dyMin * LERP
      yr.max += dyMax * LERP
      needsAnim = true
    } else {
      yr.min = targetYRange.min
      yr.max = targetYRange.max
    }

    const mapY = pct => chart.y + chart.h - ((pct - yr.min) / (yr.max - yr.min)) * chart.h

    if (!chartData?.entities?.length || !xTs.length) {
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'
      ctx.font = "14px -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(t('aiChartsChrome.compare.selectItems', 'Select items to compare'), w / 2, h / 2)
      return
    }

    // Grid
    const steps = 8
    const yStep = (yr.max - yr.min) / steps
    ctx.font = `500 11px var(--font-mono)`
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
      ctx.fillText(`${val >= 0 ? '+' : ''}${val.toFixed(0)}%`, chart.x + chart.w + 10, y)
    }

    // Zero line
    const zy = mapY(0)
    if (zy >= chart.y && zy <= chart.y + chart.h) {
      ctx.strokeStyle = zeroColor
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.moveTo(chart.x, zy); ctx.lineTo(chart.x + chart.w, zy); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'
      ctx.font = `700 11px var(--font-mono)`
      ctx.textAlign = 'left'
      ctx.fillText('0%', chart.x + chart.w + 10, zy)
    }

    // X-axis
    if (xTs.length > 0) {
      const count = Math.min(14, Math.floor(chart.w / 80))
      const step = Math.max(1, Math.floor(xTs.length / count))
      ctx.fillStyle = textColor
      ctx.font = `500 10px var(--font-mono)`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let i = 0; i < xTs.length; i += step) {
        const x = mapX(xTs[i])
        ctx.strokeStyle = gridColor
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, chart.y + chart.h); ctx.lineTo(x, chart.y + chart.h + 6); ctx.stroke()
        ctx.fillText(formatDate(xTs[i], i18n.language), x, chart.y + chart.h + 10)
      }
    }

    // Clip
    ctx.save()
    ctx.beginPath()
    ctx.rect(chart.x, chart.y, chart.w, chart.h)
    ctx.clip()

    /* ── Fear & Greed, drawn the way the /fear-greed chart draws it ──
       One amber gradient for the fill and a SOLID line segment-coloured by
       value. Earlier versions painted the fill with the sentiment ramp too:
       at low alpha over black the fear end came out orange rather than red and
       the greed end went olive, and a dashed track on top of that read as
       noise. Colour belongs on the line only - it is the same instrument as
       the Fear & Greed page, so it should look like it. */
    const fngY = v => chart.y + chart.h - (Math.max(0, Math.min(100, v)) / 100) * chart.h
    if (fngPoints.length > 1) {
      ctx.save()
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.setLineDash([])

      const fill = ctx.createLinearGradient(0, chart.y, 0, chart.y + chart.h)
      fill.addColorStop(0, isDark ? 'rgba(234,179,8,0.13)' : 'rgba(202,138,4,0.11)')
      fill.addColorStop(0.4, isDark ? 'rgba(234,179,8,0.045)' : 'rgba(202,138,4,0.04)')
      fill.addColorStop(1, 'rgba(234,179,8,0)')
      ctx.beginPath()
      ctx.moveTo(mapX(fngPoints[0].t), chart.y + chart.h)
      fngPoints.forEach(p => ctx.lineTo(mapX(p.t), fngY(p.v)))
      ctx.lineTo(mapX(fngPoints[fngPoints.length - 1].t), chart.y + chart.h)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()

      ctx.lineWidth = 1.5
      for (let i = 1; i < fngPoints.length; i++) {
        const a = fngPoints[i - 1], b = fngPoints[i]
        ctx.beginPath()
        ctx.moveTo(mapX(a.t), fngY(a.v))
        ctx.lineTo(mapX(b.t), fngY(b.v))
        ctx.strokeStyle = fngLineColor((a.v + b.v) / 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash([])

    // Lerp per-entity entrance animations (opacity 0→1, yOffset -60→0)
    const ENTRY_LERP = 0.1
    chartData.entities.forEach(ent => {
      const key = `${ent.type}:${ent.id}`
      const a = entityAnimRef.current.get(key)
      if (!a) return
      const dOp = 1 - a.opacity
      const dY = 0 - a.yOffset
      if (Math.abs(dOp) > 0.005 || Math.abs(dY) > 0.3) {
        a.opacity += dOp * ENTRY_LERP
        a.yOffset += dY * ENTRY_LERP
        needsAnim = true
      } else {
        a.opacity = 1
        a.yOffset = 0
      }
    })

    chartData.entities.forEach((ent, idx) => {
      if (!ent.data?.length) return
      const sc = COMPARE_COLORS[idx % COMPARE_COLORS.length]
      const anim = entityAnimRef.current.get(`${ent.type}:${ent.id}`) || { opacity: 1, yOffset: 0 }

      ctx.save()
      ctx.globalAlpha = anim.opacity
      const yShift = anim.yOffset

      ctx.beginPath()
      ent.data.forEach((pt, i) => {
        const x = mapX(pt.ts), y = mapY(pt.pct) + yShift
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.strokeStyle = `rgba(${sc.rgb}, 0.2)`
      ctx.lineWidth = 3
      ctx.stroke()

      ctx.beginPath()
      ent.data.forEach((pt, i) => {
        const x = mapX(pt.ts), y = mapY(pt.pct) + yShift
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.strokeStyle = sc.color
      ctx.lineWidth = 1.4
      ctx.stroke()

      const last = ent.data[ent.data.length - 1]
      const ex = mapX(last.ts), ey = mapY(last.pct) + yShift
      ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${sc.rgb}, 0.2)`; ctx.fill()
      ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2)
      ctx.fillStyle = sc.color; ctx.fill()

      ctx.restore()
    })

    ctx.restore()

    // Fear & Greed left axis - only drawn while the overlay is on
    if (fngOn && PAD.left > 20) {
      ctx.save()
      ctx.font = `500 9px var(--font-mono)`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const fngY2 = v => chart.y + chart.h - (v / 100) * chart.h
      ;[0, 25, 50, 75, 100].forEach(v => {
        ctx.fillStyle = isDark ? 'rgba(234,179,8,0.42)' : 'rgba(161,98,7,0.5)'
        ctx.fillText(String(v), chart.x - 8, fngY2(v))
      })
      ctx.textBaseline = 'alphabetic'
      ctx.font = `700 8px var(--font-mono)`
      ctx.fillStyle = isDark ? 'rgba(234,179,8,0.55)' : 'rgba(161,98,7,0.6)'
      ctx.fillText('F&G', chart.x - 8, chart.y - 5)
      ctx.restore()
    }

    // End-of-line labels. Two series that finish within a percent of each other
    // used to stack their chips on the same pixel row; lay them out first and
    // nudge collisions apart so every reading stays legible.
    const LBL_H = 18
    const endLabels = []
    chartData.entities.forEach((ent, idx) => {
      if (!ent.data?.length) return
      const anim = entityAnimRef.current.get(`${ent.type}:${ent.id}`) || { opacity: 1, yOffset: 0 }
      const last = ent.data[ent.data.length - 1]
      const ey = mapY(last.pct) + anim.yOffset
      endLabels.push({
        idx, anim, last, ey,
        labelY: Math.max(chart.y + LBL_H / 2, Math.min(ey, chart.y + chart.h - LBL_H / 2)),
      })
    })
    endLabels.sort((a, b) => a.labelY - b.labelY)
    for (let i = 1; i < endLabels.length; i++) {
      const gap = endLabels[i].labelY - endLabels[i - 1].labelY
      if (gap < LBL_H + 2) endLabels[i].labelY = endLabels[i - 1].labelY + LBL_H + 2
    }
    // If pushing down ran the stack off the bottom, walk it back up.
    const overshoot = endLabels.length
      ? endLabels[endLabels.length - 1].labelY - (chart.y + chart.h - LBL_H / 2)
      : 0
    if (overshoot > 0) endLabels.forEach(l => { l.labelY -= overshoot })

    endLabels.forEach(({ idx, anim, last, ey, labelY }) => {
      const sc = COMPARE_COLORS[idx % COMPARE_COLORS.length]
      const labelX = chart.x + chart.w + 6
      const pctText = `${last.pct >= 0 ? '+' : ''}${last.pct.toFixed(1)}%`

      ctx.save()
      ctx.globalAlpha = anim.opacity
      ctx.font = `700 10px var(--font-mono)`
      const tw = ctx.measureText(pctText).width
      const lblW = tw + 10
      const lblH = LBL_H

      ctx.beginPath()
      const bx = labelX, by = labelY - lblH / 2
      const br = 4
      ctx.moveTo(bx + br, by)
      ctx.lineTo(bx + lblW - br, by)
      ctx.quadraticCurveTo(bx + lblW, by, bx + lblW, by + br)
      ctx.lineTo(bx + lblW, by + lblH - br)
      ctx.quadraticCurveTo(bx + lblW, by + lblH, bx + lblW - br, by + lblH)
      ctx.lineTo(bx + br, by + lblH)
      ctx.quadraticCurveTo(bx, by + lblH, bx, by + lblH - br)
      ctx.lineTo(bx, by + br)
      ctx.quadraticCurveTo(bx, by, bx + br, by)
      ctx.closePath()
      ctx.fillStyle = `rgba(${sc.rgb}, 0.18)`
      ctx.fill()
      ctx.strokeStyle = `rgba(${sc.rgb}, 0.4)`
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = sc.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(pctText, bx + lblW / 2, labelY)

      ctx.save()
      ctx.setLineDash([2, 2])
      ctx.strokeStyle = `rgba(${sc.rgb}, 0.3)`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(chart.x + chart.w, ey)
      ctx.lineTo(labelX, labelY)
      ctx.stroke()
      ctx.restore()

      ctx.restore()
    })

    // Hover crosshair
    if (hoverInfo?.ts != null) {
      const hx = mapX(hoverInfo.ts)
      const isDarkMode = !dayMode
      const vGrad = ctx.createLinearGradient(0, chart.y, 0, chart.y + chart.h)
      vGrad.addColorStop(0, isDarkMode ? 'rgba(139,92,246,0)' : 'rgba(139,92,246,0)')
      vGrad.addColorStop(0.3, isDarkMode ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.2)')
      vGrad.addColorStop(0.7, isDarkMode ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.2)')
      vGrad.addColorStop(1, isDarkMode ? 'rgba(139,92,246,0)' : 'rgba(139,92,246,0)')
      ctx.strokeStyle = vGrad
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(hx, chart.y); ctx.lineTo(hx, chart.y + chart.h); ctx.stroke()

      chartData.entities.forEach((ent, idx) => {
        if (!ent.data?.length) return
        const sc = COMPARE_COLORS[idx % COMPARE_COLORS.length]
        let closest = ent.data[0], minD = Infinity
        ent.data.forEach(pt => { const d = Math.abs(pt.ts - hoverInfo.ts); if (d < minD) { minD = d; closest = pt } })
        const dx = mapX(closest.ts), dy = mapY(closest.pct)
        ctx.beginPath(); ctx.arc(dx, dy, 6, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${sc.rgb}, 0.35)`; ctx.fill()
        ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2)
        ctx.fillStyle = sc.color; ctx.fill()
        ctx.beginPath(); ctx.arc(dx, dy, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'; ctx.fill()
      })

      if (fngPoints.length > 1) {
        let cf = fngPoints[0], mf = Infinity
        fngPoints.forEach(p => { const d = Math.abs(p.t - hoverInfo.ts); if (d < mf) { mf = d; cf = p } })
        const fx = mapX(cf.t), fyv = chart.y + chart.h - (Math.max(0, Math.min(100, cf.v)) / 100) * chart.h
        ctx.beginPath(); ctx.arc(fx, fyv, 5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(250,204,21,0.3)'; ctx.fill()
        ctx.beginPath(); ctx.arc(fx, fyv, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = fngLineColor(cf.v); ctx.fill()
      }
    }

    // Watermark - the shared Spectre mark (ghost logotype + corner lockup),
    // anchored to the plot box so it sits inside the axes like the sector chart.
    drawSpectreWatermark(ctx, { w, h, dark: isDark, plot: chart })

    if (needsAnim) {
      animFrameRef.current = requestAnimationFrame(drawFrame)
    }
  }, [chartData, dimensions, dpr, dayMode, hoverInfo, chart, mapX, targetYRange, xTs, t, i18n.language, fngOn, fngPoints, PAD.left])

  useEffect(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    animFrameRef.current = requestAnimationFrame(drawFrame)
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
  }, [drawFrame])

  /* ── Mouse hover ── */
  const handleMouseMove = useCallback(e => {
    const canvas = canvasRef.current
    if (!canvas || !xTs.length) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    if (mx < chart.x || mx > chart.x + chart.w || my < chart.y || my > chart.y + chart.h) { setHoverInfo(null); return }
    const f = xTs[0], l = xTs[xTs.length - 1]
    const ts = f + ((mx - chart.x) / chart.w) * (l - f || 1)
    const values = {}
    chartData?.entities?.forEach((ent, idx) => {
      if (!ent.data?.length) return
      let cl = ent.data[0], md = Infinity
      ent.data.forEach(pt => { const d = Math.abs(pt.ts - ts); if (d < md) { md = d; cl = pt } })
      values[idx] = { name: ent.name, pct: cl.pct, color: COMPARE_COLORS[idx % COMPARE_COLORS.length].color }
    })
    let fng = null
    if (fngPoints.length) {
      let cf = fngPoints[0], mf = Infinity
      fngPoints.forEach(p => { const d = Math.abs(p.t - ts); if (d < mf) { mf = d; cf = p } })
      fng = { value: cf.v, label: fngBand(cf.v).label, color: fngLineColor(cf.v) }
    }
    setHoverInfo({ ts, x: mx, y: my, values, fng })
  }, [xTs, chart, chartData, fngPoints])

  const handleMouseLeave = useCallback(() => setHoverInfo(null), [])

  /* ── Section renderer ── */
  const renderSection = (type, label, items) => {
    const isExp = expanded[type]
    /* Anything already picked stays pinned at the top of its own section, even
       when the search box no longer matches it. Without this the only way to
       drop a searched-for token was to retype the query that surfaced it. */
    const picked = selections.filter(s => s.type === type)
    const pickedIds = new Set(picked.map(p => p.id))
    const rest = items.filter(i => !pickedIds.has(i.id))
    const visibleRest = isExp ? rest : rest.slice(0, Math.max(1, COLLAPSED_COUNT - picked.length))
    const visible = [...picked.map(p => ({ id: p.id, name: p.name })), ...visibleRest]
    const hasMore = rest.length > visibleRest.length
    const sectionCount = picked.length
    const canAdd = selections.length < MAX_SELECTIONS
    const showTokenLoading = type === 'token' && tokenLoading && searches.token

    const searchPlaceholder = {
      chain: t('aiChartsChrome.compare.searchChains', 'Search chains…'),
      sector: t('aiChartsChrome.compare.searchSectors', 'Search sectors…'),
      token: t('aiChartsChrome.compare.searchTokens', 'Search tokens…'),
    }[type] || `Search ${label.toLowerCase()}…`

    return (
      <div className="compare-section" data-type={type}>
        <div className="compare-section-header">
          <span className="compare-section-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {SECTION_ICONS[type]}
            </svg>
          </span>
          <span className="compare-section-label">{label}</span>
          {sectionCount > 0 && <span className="compare-section-counter">{sectionCount}</span>}
        </div>

        <div className="compare-section-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searches[type]}
            onChange={e => handleSearchChange(type, e.target.value)}
          />
        </div>

        <div className="compare-section-list">
          {showTokenLoading && <div className="compare-section-hint">{t('aiChartsChrome.compare.searching', 'Searching…')}</div>}
          {!showTokenLoading && visible.length === 0 && (
            <div className="compare-section-hint">
              {type === 'token' && !searches.token
                ? t('aiChartsChrome.compare.typeToSearchTokens', 'Type to search tokens')
                : t('aiChartsChrome.compare.noResults', 'No results')}
            </div>
          )}
          {visible.map(item => {
            const selected = isSelected(type, item.id)
            const colorIdx = indexOfSelection(type, item.id)
            const color = colorIdx >= 0 ? COMPARE_COLORS[colorIdx] : null
            const disabled = !selected && !canAdd
            return (
              <button
                key={item.id}
                type="button"
                className={`compare-item ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                onClick={() => !disabled && toggleItem(type, item)}
                disabled={disabled}
                title={disabled ? t('aiChartsChrome.compare.maxSelections', { max: MAX_SELECTIONS, defaultValue: `Max ${MAX_SELECTIONS} selections` }) : item.name}
              >
                <span
                  className="compare-item-check"
                  style={selected && color ? { background: color.color, borderColor: color.color } : undefined}
                >
                  {selected && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#0a0a0c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className="compare-item-name">{item.name}</span>
                {selected && color && (
                  <>
                    <span className="compare-item-dot" style={{ background: color.color, boxShadow: `0 0 8px rgba(${color.rgb}, 0.5)` }} />
                    <span className="compare-item-x" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>

        {(hasMore || isExp) && (
          <button
            type="button"
            className="compare-section-more"
            onClick={() => setExpanded(p => ({ ...p, [type]: !p[type] }))}
          >
            {isExp ? t('aiChartsChrome.compare.showLess', 'Show less') : t('aiChartsChrome.compare.showAll', { count: items.length, defaultValue: `Show all (${items.length})` })}
          </button>
        )}
      </div>
    )
  }

  /* ── Render ── */
  return (
    <div
      className={`compare-chart ${dayMode ? 'day-mode' : ''} ${isFullscreen ? 'fullscreen' : ''} ${compact ? 'compact' : ''}`}
      ref={rootRef}
      style={fngOn && fngLatest ? { '--fng-rgb': fngLineRgb(fngLatest.v), '--fng': fngLineColor(fngLatest.v) } : undefined}
    >
      <div className="compare-header">
        <div className="compare-header-left">
          <span className="compare-dot" />
          <div className="compare-titles">
            <h2 className="compare-title">{t('aiChartsChrome.compare.title', 'Compare')}</h2>
            <p className="compare-subtitle">{t('aiChartsChrome.compare.subtitle', { max: MAX_SELECTIONS, defaultValue: `Select up to ${MAX_SELECTIONS} chains, sectors, or tokens to compare performance` })}</p>
          </div>
        </div>
        <div className="compare-header-right">
          <div className="compare-timeframes">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.days}
                className={`compare-tf-btn ${timeframe === tf.days ? 'active' : ''}`}
                onClick={() => setTimeframe(tf.days)}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`compare-fng-btn${fngOn ? ' active' : ''}${fngError ? ' is-error' : ''}`}
            onClick={() => setFngOn(v => !v)}
            aria-pressed={fngOn}
            title={fngError
              ? t('aiChartsChrome.compare.fngUnavailable', 'Fear & Greed history unavailable')
              : t('aiChartsChrome.compare.fngToggle', 'Overlay the Fear & Greed index')}
          >
            <span className="compare-fng-swatch" />
            <span className="compare-fng-label">{t('aiChartsChrome.compare.fng', 'F&G')}</span>
            {fngOn && fngLatest && <span className="compare-fng-value">{Math.round(fngLatest.v)}</span>}
          </button>
          <button className="compare-fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? t('aiChartsChrome.compare.exitFullscreen', 'Exit fullscreen') : t('aiChartsChrome.compare.fullscreen', 'Fullscreen')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {isFullscreen ? (
                <><polyline points="4 14 8 14 8 18" /><polyline points="20 10 16 10 16 6" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
              ) : (
                <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
              )}
            </svg>
          </button>
        </div>
      </div>

      <div className="compare-body">
        {/* Left - Three multi-select sections */}
        <div className="compare-form">
          <div className="compare-form-scroll">
            {renderSection('chain', t('aiChartsChrome.compare.chains', 'Chains'), filteredChains)}
            {renderSection('sector', t('aiChartsChrome.compare.sectors', 'Sectors'), filteredSectors)}
            {renderSection('token', t('aiChartsChrome.compare.tokens', 'Tokens'), tokenItems)}
          </div>
          <div className="compare-form-footer">
            <span className="compare-form-counter">
              {t('aiChartsChrome.compare.selected', { count: selections.length, max: MAX_SELECTIONS, defaultValue: `${selections.length}/${MAX_SELECTIONS} selected` })}
            </span>
            {selections.length > 0 && (
              <button type="button" className="compare-form-clear" onClick={clearAll}>
                {t('aiChartsChrome.compare.clearAll', 'Clear all')}
              </button>
            )}
          </div>
        </div>

        {/* Right - Chart */}
        <div className="compare-chart-area">
          {(selections.length > 0 || fngOn) && (
            <div className="compare-legend">
              {selections.map((sel, idx) => {
                const sc = COMPARE_COLORS[idx % COMPARE_COLORS.length]
                const ent = chartData?.entities?.[idx]
                const failed = !!ent && !ent.data?.length
                return (
                  <span
                    key={`${sel.type}:${sel.id}`}
                    className={`compare-chip${failed ? ' is-failed' : ''}`}
                    style={{ '--chip': sc.color, '--chip-rgb': sc.rgb }}
                  >
                    <span className="compare-chip-dot" />
                    <span className="compare-chip-name" title={sel.name}>{sel.name}</span>
                    {failed && <span className="compare-chip-warn" title={t('aiChartsChrome.compare.noData', 'No data for this range')}>!</span>}
                    <button
                      type="button"
                      className="compare-chip-x"
                      onClick={() => removeSelection(sel.type, sel.id)}
                      aria-label={t('aiChartsChrome.compare.remove', { name: sel.name, defaultValue: `Remove ${sel.name}` })}
                      title={t('aiChartsChrome.compare.remove', { name: sel.name, defaultValue: `Remove ${sel.name}` })}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </span>
                )
              })}

              {fngOn && (
                <span className="compare-chip compare-chip--fng">
                  <span className="compare-chip-dot" />
                  <span className="compare-chip-name">
                    {t('aiChartsChrome.compare.fearGreed', 'Fear & Greed')}
                    {fngLatest ? (
                      <em className="compare-chip-read">
                        {Math.round(fngLatest.v)} {fngBand(fngLatest.v).label}
                      </em>
                    ) : (
                      <em className="compare-chip-read">{fngError ? '—' : '…'}</em>
                    )}
                  </span>
                  <button
                    type="button"
                    className="compare-chip-x"
                    onClick={() => setFngOn(false)}
                    aria-label={t('aiChartsChrome.compare.removeFng', 'Remove Fear & Greed overlay')}
                    title={t('aiChartsChrome.compare.removeFng', 'Remove Fear & Greed overlay')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </span>
              )}
            </div>
          )}

          <div
            className="compare-canvas-container"
            ref={containerRef}
            style={compact ? undefined : { height: `${chartHeight}px` }}
          >
            {loading && (
              <div className="compare-loading-overlay">
                <div className="compare-loading-ring" />
              </div>
            )}
            <canvas
              ref={canvasRef}
              className="compare-canvas"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />

            {hoverInfo && Object.keys(hoverInfo.values).length > 0 && (
              <div
                className="compare-tooltip"
                style={{
                  left: Math.min(
                    Math.max(8, hoverInfo.x > dimensions.w * 0.6 ? hoverInfo.x - 190 : hoverInfo.x + 16),
                    dimensions.w - 200
                  ),
                  top: Math.min(Math.max(hoverInfo.y - 20, 8), dimensions.h - 100),
                }}
              >
                <div className="compare-tooltip-header">{formatDateTime(hoverInfo.ts, i18n.language)}</div>
                <div className="compare-tooltip-sep" />
                {Object.entries(hoverInfo.values)
                  .sort((a, b) => b[1].pct - a[1].pct)
                  .map(([key, val]) => (
                    <div key={key} className="compare-tooltip-row">
                      <span className="compare-tooltip-color" style={{ background: val.color }} />
                      <span className="compare-tooltip-name">{val.name}</span>
                      <span className={`compare-tooltip-val ${val.pct >= 0 ? 'up' : 'dn'}`}>
                        {val.pct >= 0 ? '+' : ''}{val.pct.toFixed(2)}%
                      </span>
                    </div>
                  ))
                }
                {hoverInfo.fng && (
                  <>
                    <div className="compare-tooltip-sep" />
                    <div className="compare-tooltip-row">
                      <span className="compare-tooltip-color" style={{ background: hoverInfo.fng.color }} />
                      <span className="compare-tooltip-name">{t('aiChartsChrome.compare.fearGreed', 'Fear & Greed')}</span>
                      <span className="compare-tooltip-val" style={{ color: hoverInfo.fng.color }}>
                        {Math.round(hoverInfo.fng.value)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="compare-chart-label">
            <span className="compare-chart-label-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
            {t('aiChartsChrome.compare.performance', { tf: TIMEFRAMES.find(tf => tf.days === timeframe)?.label || '1M', defaultValue: `Performance (${TIMEFRAMES.find(tf => tf.days === timeframe)?.label || '1M'})` })}
          </div>

          {fngInsight && (() => {
            const lead = { ...fngInsight.rows[0], name: shortName(fngInsight.rows[0].name) }
            const fmtPct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`
            const fmtDay = (ts) => {
              try {
                return new Intl.DateTimeFormat(i18n.language || undefined, { day: 'numeric', month: 'short' }).format(new Date(ts * 1000))
              } catch { return '' }
            }
            const order = !lead.beatsChance
              ? 'unclear'
              : lead.ledCount > lead.sameDayCount && lead.ledCount >= 2
                ? 'sentiment'
                : lead.sameDayCount >= lead.ledCount
                  ? 'together'
                  : 'unclear'

            return (
              <div className="compare-insight">
                <div className="compare-insight-head">
                  <span className="compare-insight-title">
                    {t('aiChartsChrome.compare.insightTitle', 'Sentiment vs price')}
                  </span>
                  <span className="compare-insight-now" style={{ color: fngLineColor(fngInsight.now) }}>
                    {Math.round(fngInsight.now)} {fngBand(fngInsight.now).label}
                    <em>
                      {fngInsight.now >= fngInsight.avg ? '+' : '−'}{Math.abs(Math.round(fngInsight.now - fngInsight.avg))}
                      {' '}{t('aiChartsChrome.compare.vsWindowAvg', 'vs window avg')}
                      {Math.abs(fngInsight.drift) >= 5 && (
                        <>{' · '}{fngInsight.drift >= 0 ? '+' : '−'}{Math.abs(Math.round(fngInsight.drift))} {t('aiChartsChrome.compare.inDays', { days: fngInsight.driftDays, defaultValue: `in ${fngInsight.driftDays}d` })}</>
                      )}
                    </em>
                  </span>
                </div>

                {/* ── the standout episode, told as a sentence ── */}
                <p className="compare-insight-lede">
                  {(() => {
                    const top = lead.episodes[0]
                    if (!top) return null
                    const dir = top.ret >= 0
                      ? t('aiChartsChrome.compare.rise', 'rise')
                      : t('aiChartsChrome.compare.drop', 'drop')
                    if (top.lead == null) {
                      return t('aiChartsChrome.compare.ledeNoShock', {
                        name: lead.name, dir, pct: fmtPct(top.ret), days: top.horizon, day: fmtDay(top.moveTs),
                        defaultValue: `${lead.name}'s sharpest ${dir} in this window — ${fmtPct(top.ret)} over ${top.horizon} days from ${fmtDay(top.moveTs)} — arrived with no sentiment shock in front of it at all.`,
                      })
                    }
                    return top.lead === 0
                      ? t('aiChartsChrome.compare.ledeSameDay', {
                        name: lead.name, dir, pct: fmtPct(top.ret), days: top.horizon,
                        d: `${top.fngDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(top.fngDelta))}`, band: fngBand(top.fngTo).label,
                        defaultValue: `${lead.name}'s sharpest ${dir} in this window — ${fmtPct(top.ret)} over ${top.horizon} days — broke the same day Fear & Greed moved ${top.fngDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(top.fngDelta))} into ${fngBand(top.fngTo).label}.`,
                      })
                      : t('aiChartsChrome.compare.ledeShock', {
                        name: lead.name, dir, pct: fmtPct(top.ret), days: top.horizon, lead: top.lead,
                        d: `${top.fngDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(top.fngDelta))}`, band: fngBand(top.fngTo).label, day: fmtDay(top.fngTs),
                        defaultValue: `${lead.name}'s sharpest ${dir} in this window — ${fmtPct(top.ret)} over ${top.horizon} days — began ${top.lead} day${top.lead === 1 ? '' : 's'} after Fear & Greed moved ${top.fngDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(top.fngDelta))} into ${fngBand(top.fngTo).label} on ${fmtDay(top.fngTs)}.`,
                      })
                  })()}
                </p>

                {/* ── was that a pattern, or a one-off? ── */}
                <p className="compare-insight-verdict">
                  {order === 'sentiment' && (
                    <>
                      <b>{t('aiChartsChrome.compare.sentimentFirst', 'Sentiment led.')}</b>{' '}
                      {t('aiChartsChrome.compare.sentimentFirstBody', {
                        led: lead.ledCount, total: lead.total, name: lead.name, days: lead.medianLead, control: lead.controlCount,
                        defaultValue: `It turned ahead of ${lead.ledCount} of ${lead.name}'s ${lead.total} biggest moves by a median ${lead.medianLead} day${lead.medianLead === 1 ? '' : 's'}, against ${lead.controlCount} that had a shock pointing the wrong way. Worth watching for early warning on this pair.`,
                      })}
                    </>
                  )}
                  {order === 'together' && (
                    <>
                      <b>{t('aiChartsChrome.compare.movedTogetherHead', 'They turn together.')}</b>{' '}
                      {t('aiChartsChrome.compare.movedTogetherBody', {
                        n: lead.sameDayCount, total: lead.total, name: lead.name,
                        defaultValue: `Fear & Greed shifted the same day as ${lead.name} in ${lead.sameDayCount} of its ${lead.total} biggest moves. Read it as how stretched a move already is, not as a trigger.`,
                      })}
                    </>
                  )}
                  {order === 'unclear' && (
                    <>
                      <b>{t('aiChartsChrome.compare.noOrderHead', 'But not a pattern.')}</b>{' '}
                      {t('aiChartsChrome.compare.noOrderBody', {
                        matched: lead.matched, total: lead.total, name: lead.name,
                        control: lead.controlCount, max: lead.maxLead, followed: lead.followedCount,
                        defaultValue: `Of ${lead.name}'s ${lead.total} biggest moves, ${lead.matched} had a sentiment shock at or before the move and ${lead.followedCount} had one only afterwards — with ${lead.controlCount} pointing the wrong way entirely. Fear & Greed reacts here more than it warns.`,
                      })}
                    </>
                  )}
                </p>

                {/* ── the episodes, dated ── */}
                <div className="compare-insight-eps">
                  <div className="compare-insight-eps-head">
                    <span className="compare-insight-dot" style={{ background: lead.color }} />
                    {t('aiChartsChrome.compare.biggestMoves', { name: lead.name, days: lead.horizon, defaultValue: `${lead.name} — biggest ${lead.horizon}-day moves` })}
                  </div>
                  {lead.episodes.slice(0, 4).map((ep) => (
                    <div key={ep.moveTs} className="compare-insight-ep">
                      <span className={`compare-insight-ep-arrow ${ep.ret >= 0 ? 'up' : 'dn'}`}>{ep.ret >= 0 ? '↑' : '↓'}</span>
                      {ep.lead == null ? (
                        <span className="compare-insight-ep-body">
                          <em>{fmtDay(ep.moveTs)}</em>
                          <b className={ep.ret >= 0 ? 'up' : 'dn'}>{lead.name} {fmtPct(ep.ret)}</b>
                          <i>{t('aiChartsChrome.compare.overDays', { days: ep.horizon, defaultValue: `over ${ep.horizon}d` })}</i>
                          {ep.after ? (
                            <span className="compare-insight-ep-after">
                              {t('aiChartsChrome.compare.epFollowed', {
                                lag: ep.after.lag,
                                d: `${ep.after.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(ep.after.delta))}`,
                                defaultValue: `F&G followed ${ep.after.lag}d later (${ep.after.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(ep.after.delta))})`,
                              })}
                            </span>
                          ) : (
                            <span className="compare-insight-ep-none">{t('aiChartsChrome.compare.epNoShock', 'no sentiment shock either side')}</span>
                          )}
                        </span>
                      ) : (
                        <span className="compare-insight-ep-body">
                          <em>{fmtDay(ep.fngTs)}</em>
                          <b style={{ color: fngLineColor(ep.fngTo) }}>
                            F&amp;G {ep.fngDelta >= 0 ? '+' : '−'}{Math.abs(Math.round(ep.fngDelta))} → {Math.round(ep.fngTo)} {fngBand(ep.fngTo).label}
                          </b>
                          <span className="compare-insight-ep-gap">
                            {ep.lead === 0
                              ? t('aiChartsChrome.compare.sameDayShort', 'same day')
                              : t('aiChartsChrome.compare.thenOn', { day: fmtDay(ep.moveTs), lead: ep.lead, defaultValue: `${ep.lead}d later, ${fmtDay(ep.moveTs)}` })}
                          </span>
                          <b className={ep.ret >= 0 ? 'up' : 'dn'}>{lead.name} {fmtPct(ep.ret)}</b>
                          <i>{t('aiChartsChrome.compare.overDays', { days: ep.horizon, defaultValue: `over ${ep.horizon}d` })}</i>
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {fngInsight.rows.length > 1 && (
                  <div className="compare-insight-others">
                    {fngInsight.rows.slice(1).map((row) => {
                      const beat = row.beatsChance && row.ledCount > row.sameDayCount && row.ledCount >= 2
                      return (
                        <div key={row.key} className="compare-insight-other">
                          <span className="compare-insight-dot" style={{ background: row.color }} />
                          <span className="compare-insight-other-name">{shortName(row.name)}</span>
                          <span className="compare-insight-other-read">
                            {beat
                              ? t('aiChartsChrome.compare.otherLed', { led: row.ledCount, total: row.total, days: row.medianLead, defaultValue: `sentiment led ${row.led}/${row.total} of its big moves, median ${row.medianLead}d` })
                              : t('aiChartsChrome.compare.otherNoLead', { m: row.matched, total: row.total, c: row.controlCount, defaultValue: `${row.matched}/${row.total} with a shock in front, ${row.controlCount} against — no lead here either` })}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── what it means right now ── */}
                {!lead.echo && lead.extreme && (
                  <p className="compare-insight-now-read">
                    <strong>{t('aiChartsChrome.compare.rightNow', 'Right now.')}</strong>{' '}
                    {t('aiChartsChrome.compare.noPrecedent', {
                      now: Math.round(fngInsight.now), name: lead.name,
                      dir: lead.extreme === 'high'
                        ? t('aiChartsChrome.compare.thisHigh', 'this high')
                        : t('aiChartsChrome.compare.thisLow', 'this low'),
                      defaultValue: `Fear & Greed has not been ${lead.extreme === 'high' ? 'this high' : 'this low'} anywhere else in this window, so there is nothing here to compare the next move against.`,
                    })}
                  </p>
                )}

                {lead.echo && (
                  <p className="compare-insight-now-read">
                    <strong>{t('aiChartsChrome.compare.rightNow', 'Right now.')}</strong>{' '}
                    {t('aiChartsChrome.compare.echoBody', {
                      n: lead.echo.n, name: lead.name, fwd: lead.echo.fwd,
                      med: `${lead.echo.med >= 0 ? '+' : '−'}${Math.abs(lead.echo.med).toFixed(1)}%`,
                      up: lead.echo.up,
                      defaultValue: `Fear & Greed has sat this close to ${Math.round(fngInsight.now)} on ${lead.echo.n} other days in this window. ${lead.name}'s next ${lead.echo.fwd} days ran a median ${lead.echo.med >= 0 ? '+' : '−'}${Math.abs(lead.echo.med).toFixed(1)}%, higher ${lead.echo.up} of ${lead.echo.n} times.`,
                    })}
                  </p>
                )}

                <p className="compare-insight-note">
                  {t('aiChartsChrome.compare.insightNote', 'Fear & Greed is built partly from price, so some of this overlap is arithmetic rather than warning. One window, not a rule.')}
                </p>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Drag-to-resize only makes sense when the height is this card's to own.
          Compact takes the height its Command Center slot gives it. */}
      {!compact && (
        <div className="compare-resize-handle" onMouseDown={handleResizeStart}>
          <div className="compare-resize-grip" />
        </div>
      )}
    </div>
  )
}

// memo: parent re-renders on every search keystroke / filter / fav; this heavy
// component's only prop (dayMode) rarely changes.
export default React.memo(CompareChart)
