/**
 * PredictionDetail - Detail view for a single Polymarket event.
 * Shows market header, probability chart, outcome table, and trade sidebar.
 */
import { useState, useEffect, useRef, useCallback, useMemo, memo, Suspense } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useCurrency } from '@/hooks/useCurrency'
import { getPriceHistory, getMarketAnalysis, getPredictionEventBundle } from '@/services/polymarketApi'
import { getCryptoNews } from '@/services/cryptoNewsApi'
import { CHART_INTERVALS, formatVolume } from './predictions-constants'
import PredictionWhale from './prediction-whale'
import PredictionSignal from './prediction-signal'
import { usePredictionXDash } from './use-prediction-xdash'
import { usePredictionsSocial, engagementOf, influenceOf } from './use-predictions-social'
import { computeVerdict } from './compute-verdict'
import { outcomeName as shortOutcomeName, isPlaceholderName } from './pm-outcome-label'
import {
  getMentionText,
  getMentionUrl,
  getFollowerTier,
  relativeTime,
} from '@/pages/x-dash/components/x-dash-utils'
// Heavy d3-force graphs — lazy-load. The Constellation supersedes the bubble
// map as the page's lower-half centerpiece; the bubble map stays as the
// graceful fallback when there's no social/token layer to orbit.
const PredictionSocialGraph = lazy(() => import('./prediction-social-graph'))
const PredictionBubbleMap = lazy(() => import('./prediction-bubble-map'))
import './prediction-detail.css'
import './prediction-detail.mobile.css'

/* ── Countdown hook ──────────────────────────────────────────── */

function useCountdown(endDate, t) {
  const [text, setText] = useState('')

  useEffect(() => {
    if (!endDate) {
      setText('')
      return
    }

    function update() {
      const now = Date.now()
      const end = new Date(endDate).getTime()
      const diff = end - now

      if (diff <= 0) {
        setText(t ? t('predictionsPage.detail.ended') : 'Ended')
        return
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24)
      const minutes = Math.floor((diff / (1000 * 60)) % 60)
      const seconds = Math.floor((diff / 1000) % 60)

      const pad = (n) => String(n).padStart(2, '0')
      setText(`${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`)
    }

    update()
    // 1s countdown — skip ticks while tab hidden (catches up on visibility).
    const interval = setInterval(() => { if (!document.hidden) update() }, 1000)
    const onVis = () => { if (!document.hidden) update() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [endDate, t])

  return text
}

// Leaf so the 1s countdown tick re-renders ONLY this span - not the whole
// PredictionDetail, which otherwise re-ran the primaryMarket filter/reduce +
// outcomesBlock's per-market JSON.parse (x100 on multi-outcome events) every second.
const CountdownText = memo(function CountdownText({ endDate, t }) {
  const countdown = useCountdown(endDate, t)
  if (!countdown) return null
  return <span className="pd-countdown mono">{countdown}</span>
})

// Latch-once in-view gate (callback ref attaches the observer when the target
// mounts). Used to defer the below-fold Constellation/bubble-map + its fetch +
// d3 sim until the user scrolls near it.
function useInView(rootMargin = '300px') {
  const [inView, setInView] = useState(false)
  const ioRef = useRef(null)
  const ref = useCallback((el) => {
    if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null }
    if (!el) return
    if (typeof IntersectionObserver !== 'function') { setInView(true); return }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); io.disconnect() }
    }, { rootMargin })
    io.observe(el)
    ioRef.current = io
  }, [rootMargin])
  return [ref, inView]
}

/* ── Custom Canvas Probability Chart ─────────────────────────── */

const DPR = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1

function formatChartDate(ts, lang = 'en') {
  const d = new Date(ts * 1000)
  const mon = d.toLocaleString(lang, { month: 'short' })
  return `${mon} ${d.getDate()}`
}

function formatChartTime(ts, lang = 'en') {
  const d = new Date(ts * 1000)
  return d.toLocaleString(lang, { hour: 'numeric', minute: '2-digit', hour12: true })
}

function volumeForSocial(market) {
  return parseFloat(market?.volume || market?.volumeNum || 0) || 0
}

/* Build a time-bucketed social-velocity series aligned to the chart window.
 * Buckets tweets/mentions by hour, weights by engagement, normalizes 0-1
 * across the visible window. Returns [] when there's no chatter (ribbon
 * skipped). `getTime` extracts a unix-seconds timestamp from each item;
 * `getWeight` the engagement weight. */
function buildVelocitySeries(items, getTime, getWeight, windowStartSec, windowEndSec) {
  if (!items || !items.length) return []
  const buckets = new Map()
  for (const it of items) {
    const ts = getTime(it)
    if (!Number.isFinite(ts)) continue
    if (windowStartSec && ts < windowStartSec) continue
    if (windowEndSec && ts > windowEndSec) continue
    const hour = Math.floor(ts / 3600) * 3600
    buckets.set(hour, (buckets.get(hour) || 0) + (getWeight(it) || 1))
  }
  if (!buckets.size) return []
  const max = Math.max(...buckets.values())
  if (max <= 0) return []
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, w]) => ({ t, v: w / max }))
}

function ProbabilityChart({ data, dayMode, onHoverValue, langTag = 'en', socialSeries = null, showSocial = true }) {
  const canvasRef = useRef(null)
  const tooltipRef = useRef(null)
  const containerRef = useRef(null)
  const rafRef = useRef(null)

  // Bucket the social-velocity series onto the chart's time axis: for each
  // chart point, find the nearest social bucket and read its normalized
  // velocity (0-1). Returns null when no social data so the ribbon is skipped.
  const socialAt = useCallback((time) => {
    if (!socialSeries || !socialSeries.length) return 0
    let best = 0
    let bestDist = Infinity
    for (const b of socialSeries) {
      const d = Math.abs(b.t - time)
      if (d < bestDist) { bestDist = d; best = b.v }
    }
    return best
  }, [socialSeries])

  const drawChart = useCallback((hoverIdx = -1) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !data || data.length === 0) return

    const rect = container.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    canvas.width = w * DPR
    canvas.height = h * DPR
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'

    const ctx = canvas.getContext('2d')
    ctx.scale(DPR, DPR)

    // Layout constants
    const padLeft = 0
    const padRight = 52
    const padTop = 12
    const padBottom = 28
    const chartW = w - padLeft - padRight
    const chartH = h - padTop - padBottom

    // Data range - probability 0-1, display 0-100%
    const values = data.map(d => d.value * 100)
    const minVal = Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - 5)
    const maxVal = Math.min(100, Math.ceil(Math.max(...values) / 5) * 5 + 5)
    const range = maxVal - minVal || 10

    // Trend colors
    const firstVal = values[0]
    const lastVal = values[values.length - 1]
    const isUp = lastVal >= firstVal
    const lineColor = isUp ? '#10B981' : '#EF4444'
    const fillTop = isUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'
    const fillBot = 'transparent'

    // Grid colors
    const gridColor = dayMode ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)'
    const textColor = dayMode ? '#94a3b8' : 'rgba(245, 245, 247, 0.4)'

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Convert data point to pixel
    const xOf = (i) => padLeft + (i / (data.length - 1)) * chartW
    const yOf = (v) => padTop + (1 - (v - minVal) / range) * chartH

    // Horizontal grid lines + Y labels
    ctx.font = `11px var(--font-mono)`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'

    const gridSteps = 5
    for (let i = 0; i <= gridSteps; i++) {
      const val = minVal + (range / gridSteps) * i
      const y = yOf(val)

      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padLeft, y)
      ctx.lineTo(padLeft + chartW, y)
      ctx.stroke()

      ctx.fillStyle = textColor
      ctx.fillText(`${val.toFixed(0)}%`, w - 4, y)
    }

    // X-axis labels — span-aware so an intraday window (1H/6H/1D) shows TIMES
    // instead of the same date repeated six times. <36h span -> time labels.
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const spanSec = (data[data.length - 1]?.time || 0) - (data[0]?.time || 0)
    const intraday = spanSec > 0 && spanSec <= 36 * 3600
    const labelCount = Math.min(6, data.length)
    const step = Math.max(1, Math.floor(data.length / labelCount))
    let lastLabel = null
    for (let i = 0; i < data.length; i += step) {
      const x = xOf(i)
      const label = intraday
        ? formatChartTime(data[i].time, langTag)
        : formatChartDate(data[i].time, langTag)
      if (label === lastLabel) continue // no duplicate adjacent ticks
      lastLabel = label
      ctx.fillStyle = textColor
      ctx.fillText(label, x, h - padBottom + 10)
    }

    // Area fill gradient
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH)
    grad.addColorStop(0, fillTop)
    grad.addColorStop(1, fillBot)

    ctx.beginPath()
    ctx.moveTo(xOf(0), yOf(values[0]))
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(xOf(i), yOf(values[i]))
    }
    ctx.lineTo(xOf(data.length - 1), padTop + chartH)
    ctx.lineTo(xOf(0), padTop + chartH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.moveTo(xOf(0), yOf(values[0]))
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(xOf(i), yOf(values[i]))
    }
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    // ── Social chatter ribbon (bottom 18px) — a warm-white "soundwave" of
    // X chatter velocity under the probability line. Quiet by default; never
    // competes with the line (which owns the green/red). Markers ring the
    // probability line where a chatter spike LED a probability move.
    if (showSocial && socialSeries && socialSeries.length) {
      const ribbonH = 18
      const ribbonTop = padTop + chartH - ribbonH
      const barW = Math.max(1.5, chartW / data.length - 1)
      for (let i = 0; i < data.length; i++) {
        const vRaw = socialAt(data[i].time)
        const v = Math.max(0, Math.min(1, vRaw))
        if (v <= 0.01) continue
        const bh = v * ribbonH
        ctx.fillStyle = `rgba(${dayMode ? '15,23,42' : '245,245,247'}, ${0.06 + v * 0.12})`
        ctx.fillRect(xOf(i) - barW / 2, ribbonTop + (ribbonH - bh), barW, bh)
      }
      // momentum markers: chatter top-decile bucket followed by a >=2pt move
      // within 2 buckets -> hollow ring on the line (chatter led the move).
      for (let i = 0; i < data.length - 2; i++) {
        const v = socialAt(data[i].time)
        if (v < 0.78) continue
        const move = Math.abs(values[Math.min(i + 2, data.length - 1)] - values[i])
        if (move < 2) continue
        const mx = xOf(i)
        const my = yOf(values[i])
        ctx.beginPath()
        ctx.arc(mx, my, 4, 0, Math.PI * 2)
        ctx.strokeStyle = dayMode ? 'rgba(15,23,42,0.6)' : 'rgba(245,245,247,0.6)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    // Current price label (right edge)
    const currentY = yOf(lastVal)
    const labelW = 48
    const labelH = 20
    ctx.fillStyle = lineColor
    ctx.beginPath()
    const lx = padLeft + chartW + 4
    const ly = currentY - labelH / 2
    ctx.roundRect(lx, ly, labelW, labelH, 4)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 11px var(--font-mono)`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${lastVal.toFixed(1)}%`, lx + labelW / 2, currentY)

    // Dashed line from last point to label
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(xOf(data.length - 1), currentY)
    ctx.lineTo(lx, currentY)
    ctx.stroke()
    ctx.setLineDash([])

    // Crosshair on hover
    if (hoverIdx >= 0 && hoverIdx < data.length) {
      const hx = xOf(hoverIdx)
      const hy = yOf(values[hoverIdx])

      // Vertical line
      ctx.strokeStyle = dayMode ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(hx, padTop)
      ctx.lineTo(hx, padTop + chartH)
      ctx.stroke()
      ctx.setLineDash([])

      // Dot
      ctx.beginPath()
      ctx.arc(hx, hy, 5, 0, Math.PI * 2)
      ctx.fillStyle = lineColor
      ctx.fill()
      ctx.strokeStyle = dayMode ? '#ffffff' : '#09090b'
      ctx.lineWidth = 2
      ctx.stroke()

      // Update tooltip — uses textContent + element properties (no innerHTML
      // assembly) so a future change that pipes attacker-influenced data
      // into `val` / `time` / `lineColor` can't render markup.
      const tooltip = tooltipRef.current
      if (tooltip) {
        const val = values[hoverIdx]
        const time = data[hoverIdx].time
        const pct = document.createElement('span')
        pct.style.color = lineColor
        pct.style.fontWeight = '600'
        pct.textContent = val.toFixed(1) + '%'
        const date = document.createElement('span')
        date.style.opacity = '0.6'
        date.textContent = formatChartDate(time, langTag) + ' ' + formatChartTime(time, langTag)
        tooltip.replaceChildren(pct, document.createElement('br'), date)
        tooltip.style.opacity = '1'
        const tx = hx < w / 2 ? hx + 12 : hx - tooltip.offsetWidth - 12
        const ty = Math.max(padTop, Math.min(hy - 20, h - 50))
        tooltip.style.left = tx + 'px'
        tooltip.style.top = ty + 'px'
      }
    } else {
      const tooltip = tooltipRef.current
      if (tooltip) tooltip.style.opacity = '0'
    }
  }, [data, dayMode, langTag, socialSeries, showSocial, socialAt])

  // Initial draw + resize
  useEffect(() => {
    drawChart(-1)
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => drawChart(-1))
    observer.observe(container)
    return () => observer.disconnect()
  }, [drawChart])

  // Mouse interaction
  const handleMouseMove = useCallback((e) => {
    if (!data || data.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const w = rect.width
    const padRight = 52
    const chartW = w - padRight
    const ratio = mx / chartW
    const idx = Math.round(ratio * (data.length - 1))
    const clamped = Math.max(0, Math.min(data.length - 1, idx))

    if (onHoverValue) onHoverValue({ value: data[clamped].value * 100, time: data[clamped].time })

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => drawChart(clamped))
  }, [data, drawChart, onHoverValue])

  const handleMouseLeave = useCallback(() => {
    if (onHoverValue) onHoverValue(null)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => drawChart(-1))
  }, [drawChart, onHoverValue])

  // Touch interaction - enables drag-to-scrub on mobile
  const handleTouchMove = useCallback((e) => {
    if (!data || data.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const touch = e.touches[0]
    const rect = canvas.getBoundingClientRect()
    const mx = touch.clientX - rect.left
    const w = rect.width
    const padRight = 52
    const chartW = w - padRight
    const ratio = mx / chartW
    const idx = Math.round(ratio * (data.length - 1))
    const clamped = Math.max(0, Math.min(data.length - 1, idx))

    if (onHoverValue) onHoverValue({ value: data[clamped].value * 100, time: data[clamped].time })

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => drawChart(clamped))
  }, [data, drawChart, onHoverValue])

  const handleTouchEnd = useCallback(() => {
    if (onHoverValue) onHoverValue(null)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => drawChart(-1))
  }, [drawChart, onHoverValue])

  return (
    <div ref={containerRef} className="pd-chart-container" style={{ position: 'relative', touchAction: 'pan-y' }}>
      <canvas
        ref={canvasRef}
        className="pd-chart-canvas"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchMove}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      <div ref={tooltipRef} className="pd-chart-tooltip mono" />
    </div>
  )
}

/* ── Main Component ──────────────────────────────────────────── */

function PredictionDetail({ dayMode }) {
  const { eventSlug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const { fmtPrice, fmtLargeShort } = useCurrency()
  const fmtVol = (n) => formatVolume(n, fmtLargeShort)
  const langTag = i18n.language || 'en'
  const fromWelcome = location.state?.fromWelcome === true
  const handleBack = useCallback(() => {
    if (fromWelcome && window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/predictions')
    }
  }, [fromWelcome, navigate])
  const isMobile = useIsMobile()

  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [chartInterval, setChartInterval] = useState('1w')
  const [chartData, setChartData] = useState([])
  const [chartLoading, setChartLoading] = useState(false)
  const [news, setNews] = useState([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [analysis, setAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  // Social-momentum chatter ribbon toggle on the chart. Default on; auto-hides
  // when there's no chatter for the window.
  const [showSocialRibbon, setShowSocialRibbon] = useState(true)
  // Bumped by the "Try again" button on the failure state so a transient
  // upstream blip (Gamma/CLOB 502) can be retried without leaving the page.
  const [reloadKey, setReloadKey] = useState(0)

  // Tracks whether the bundle endpoint has already supplied the initial
  // chart data for this token+interval combo, so the interval-change effect
  // can skip the redundant fetch on first paint.
  const initialBundleKey = useRef(null)

  // Refs for CSS flip ticker (zero React re-renders during hover)
  const chartValueRef = useRef(null)
  const chartChangeRef = useRef(null)
  const chartLabelRef = useRef(null)

  // Fetch event + initial chart data in one round trip.
  // The bundle endpoint resolves clobTokenIds server-side and fans out the
  // CLOB prices fetch in parallel, so we skip the client-side waterfall of
  // "fetch event → parse token id → fetch prices".
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setChartLoading(true)

    async function load() {
      try {
        const iv = '1w'
        const ivConfig = CHART_INTERVALS.find((c) => c.id === iv)
        const fidelity = ivConfig?.fidelity || 200
        const { event: ev, history } = await getPredictionEventBundle(eventSlug, iv, fidelity)
        if (cancelled) return

        setEvent(ev)
        const transformed = (history || []).map((d) => ({ time: d.t, value: d.p }))
        setChartData(transformed)

        // Record which (tokenId, interval) the bundle already loaded so the
        // chart-interval effect below doesn't refetch on mount.
        try {
          const ids = JSON.parse(ev?.markets?.[0]?.clobTokenIds || '[]')
          const tokenId = ids[0]
          if (tokenId) initialBundleKey.current = `${tokenId}|${iv}`
        } catch (_) {}
      } catch (err) {
        console.error('[PredictionDetail] Failed to fetch event bundle:', err)
        if (!cancelled) {
          setEvent(null)
          setChartData([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setChartLoading(false)
        }
      }
    }

    if (eventSlug) load()
    return () => { cancelled = true }
  }, [eventSlug, reloadKey])

  // Pick the PRIMARY market to feature in the header + chart.
  // For a multi-outcome event (e.g. "Democratic Nominee 2028" with 128
  // candidates) markets[0] is an arbitrary candidate, so the old code showed a
  // random 1% outcome as "the" chance. Feature the FRONT-RUNNER (highest Yes
  // probability among real candidates) so the headline tracks the favorite.
  // Exclude Polymarket's "Person P/Q / field / someone else" placeholder
  // markets, which sit near 50% and would otherwise hijack the headline.
  const outcomeYes = (m) => {
    try {
      const p = JSON.parse(m?.outcomePrices || '["0.5","0.5"]')
      const v = parseFloat(p[0])
      return Number.isFinite(v) ? v : 0
    } catch (_) { return 0 }
  }
  // Sibling questions share a long prefix on date ladders ("...by September
  // 30" / "...by December 31") - the shared helper keeps only the tail.
  const siblingQuestions = (event?.markets || []).map((m) => m?.question || '')
  const outcomeName = (m) => shortOutcomeName(m?.question || '', { siblings: siblingQuestions, title: event?.title || '' })
  const isPlaceholderOutcome = (m) => isPlaceholderName(outcomeName(m))
  // An untraded market defaults to 0.50/0.50 with ~no volume, so highest-Yes
  // would crown a 50% ghost. Require real activity (volume or liquidity).
  const isTraded = (m) =>
    parseFloat(m?.volume || m?.volumeNum || 0) > 0 || parseFloat(m?.liquidity || m?.liquidityNum || 0) > 0
  const allMarkets = event?.markets || []
  const isMultiOutcome = allMarkets.filter((m) => !m.closed).length > 1
  const primaryMarket = (() => {
    if (!allMarkets.length) return null
    if (!isMultiOutcome) return allMarkets[0]
    const open = allMarkets.filter((m) => !m.closed)
    const real = open.filter((m) => !isPlaceholderOutcome(m) && isTraded(m))
    const pool = real.length ? real : (open.filter((m) => !isPlaceholderOutcome(m)).length ? open.filter((m) => !isPlaceholderOutcome(m)) : open)
    return pool.reduce((best, m) => (outcomeYes(m) > outcomeYes(best) ? m : best), pool[0]) || allMarkets[0]
  })()
  // Short label for the featured outcome ("Will X win ..." -> "X").
  const primaryLabel = isMultiOutcome && primaryMarket ? outcomeName(primaryMarket) : null
  let yesPct = 50
  let noPct = 50
  let yesPrice = 0.5
  let noPrice = 0.5
  let yesTokenId = null

  if (primaryMarket) {
    try {
      const prices = JSON.parse(primaryMarket.outcomePrices || '["0.5","0.5"]')
      yesPrice = parseFloat(prices[0]) || 0.5
      noPrice = parseFloat(prices[1]) || 0.5
      yesPct = Math.round(yesPrice * 100)
      noPct = Math.round(noPrice * 100)
    } catch (_) { console.error(_) }

    try {
      const tokenIds = JSON.parse(primaryMarket.clobTokenIds || '[]')
      yesTokenId = tokenIds[0] || null
    } catch (_) { console.error(_) }
  }

  // Fetch chart data
  const marketStartTs = primaryMarket?.startDate
    ? Math.floor(new Date(primaryMarket.startDate).getTime() / 1000)
    : primaryMarket?.createdAt
      ? Math.floor(new Date(primaryMarket.createdAt).getTime() / 1000)
      : null

  useEffect(() => {
    let cancelled = false
    if (!yesTokenId) return

    // Skip the redundant fetch when the bundle already loaded this combo.
    const bundleKey = `${yesTokenId}|${chartInterval}`
    if (initialBundleKey.current === bundleKey) {
      initialBundleKey.current = null
      return
    }

    setChartLoading(true)

    async function loadChart() {
      try {
        const ivConfig = CHART_INTERVALS.find(iv => iv.id === chartInterval)
        const fidelity = ivConfig?.fidelity || 200
        const raw = await getPriceHistory(yesTokenId, chartInterval, fidelity, marketStartTs)
        const transformed = (raw || []).map(d => ({ time: d.t, value: d.p }))
        if (!cancelled) setChartData(transformed)
      } catch (err) {
        console.error('[PredictionDetail] Failed to fetch price history:', err)
        if (!cancelled) setChartData([])
      } finally {
        if (!cancelled) setChartLoading(false)
      }
    }

    loadChart()
    return () => { cancelled = true }
  }, [yesTokenId, chartInterval, marketStartTs])

  // Fetch related news
  useEffect(() => {
    if (!event?.title) return
    let cancelled = false
    async function loadNews() {
      setNewsLoading(true)
      try {
        const stopWords = new Set(['will', 'the', 'be', 'by', 'end', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'what', 'when', 'how', 'who', 'a', 'an'])
        const keywords = event.title
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
          .slice(0, 3)
          .join(' ')
        const allNews = await getCryptoNews(keywords, 10)
        if (!cancelled) setNews(allNews?.slice(0, 6) || [])
      } catch { /* silent */ }
      finally { if (!cancelled) setNewsLoading(false) }
    }
    loadNews()
    return () => { cancelled = true }
  }, [event?.title])

  // Fetch AI analysis
  useEffect(() => {
    if (!eventSlug) return
    let cancelled = false
    async function loadAnalysis() {
      setAnalysisLoading(true)
      try {
        const data = await getMarketAnalysis(eventSlug)
        if (!cancelled) setAnalysis(data)
      } catch { /* silent */ }
      finally { if (!cancelled) setAnalysisLoading(false) }
    }
    loadAnalysis()
    return () => { cancelled = true }
  }, [eventSlug])

  // Parse tags
  const tags = (event?.tags || []).map((t) => t.label || t.slug || '').filter(Boolean)
  const category = event?.category || null

  // ── Per-prediction X-Dash social intel (crypto markets) ──────────
  // Maps the market -> a token cgId; non-crypto markets return isCrypto:false
  // and we fall back to the keyword tweet-search panel below.
  const xdash = usePredictionXDash(event, category)
  const isCrypto = xdash.isCrypto

  // Non-crypto fallback: tweet-search over JUST this market's topic. Gated to
  // non-crypto so we don't double-fetch when X-Dash is live.
  const eventList = useMemo(
    () => (event && !isCrypto ? [{ ...event, slug: event.slug, title: event.title, totalVolume: volumeForSocial(primaryMarket) }] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event?.slug, isCrypto],
  )
  const tweetSocial = usePredictionsSocial(eventList, !!event && !isCrypto)

  // Countdown (rendered via the <CountdownText/> leaf so its 1s tick doesn't
  // re-render this whole component).
  const endDate = primaryMarket?.endDate || event?.endDate || ''

  // Defer the below-fold Constellation (fetch + d3 sim) until scrolled near.
  const [galaxyRef, galaxyInView] = useInView('300px')

  // Volume/liquidity
  const volume = parseFloat(primaryMarket?.volume || primaryMarket?.volumeNum || 0)
  const liquidity = parseFloat(primaryMarket?.liquidity || primaryMarket?.liquidityNum || 0)

  // Market stats derived from data.
  // Spread = best ask - best bid (the real order-book spread), NOT |yes-no|
  // which the old code used (that's the consensus gap, mislabeled as "spread"
  // and always huge on a lopsided market). Fall back to |yes-no| only if the
  // book isn't quoted.
  const pmBestBid = parseFloat(primaryMarket?.bestBid || 0)
  const pmBestAsk = parseFloat(primaryMarket?.bestAsk || 0)
  const spread = (pmBestBid > 0 && pmBestAsk > 0 && pmBestAsk >= pmBestBid)
    ? (pmBestAsk - pmBestBid).toFixed(3)
    : Math.abs(yesPrice - noPrice).toFixed(2)
  const marketCreated = primaryMarket?.createdAt
    ? new Date(primaryMarket.createdAt).toLocaleDateString(langTag, { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const marketAge = primaryMarket?.createdAt
    ? Math.floor((Date.now() - new Date(primaryMarket.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : null
  const endDateFormatted = endDate
    ? new Date(endDate).toLocaleDateString(langTag, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  // 24h high/low from chart data
  let highLow = null
  if (chartData.length > 0) {
    const dayAgoTs = (Date.now() / 1000) - 86400
    const recentData = chartData.filter(d => d.time >= dayAgoTs)
    const dataSlice = recentData.length > 0 ? recentData : chartData.slice(-24)
    const vals = dataSlice.map(d => d.value * 100)
    highLow = { high: Math.max(...vals).toFixed(1), low: Math.min(...vals).toFixed(1) }
  }

  // Chart display values (initial render only - hover updates via refs)
  const chartFirstVal = chartData.length > 0 ? chartData[0].value * 100 : null
  const chartLastVal = chartData.length > 0 ? chartData[chartData.length - 1].value * 100 : yesPct
  const initialChange = chartFirstVal != null ? chartLastVal - chartFirstVal : 0

  // ── Social-momentum velocity series for the chart ribbon ─────────
  // Crypto: bucket X-Dash mentions by hour. Non-crypto: bucket the topic
  // tweet-search feed. Both aligned to the visible chart window.
  const winStart = chartData.length ? chartData[0].time : 0
  const winEnd = chartData.length ? chartData[chartData.length - 1].time : 0
  const socialSeries = useMemo(() => {
    if (isCrypto && xdash.mentions.length) {
      return buildVelocitySeries(
        xdash.mentions,
        (m) => Math.floor(new Date(m?.tweet?.created_at_utc || 0).getTime() / 1000),
        (m) => Number(m?.derived?.weighted_engagement || 0) + 1,
        winStart, winEnd,
      )
    }
    if (!isCrypto && tweetSocial.feed?.length) {
      return buildVelocitySeries(
        tweetSocial.feed,
        (tw) => Math.floor(new Date(tw.created_at || tw.timestamp || 0).getTime() / 1000),
        (tw) => engagementOf(tw) + 1,
        winStart, winEnd,
      )
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrypto, xdash.mentions, tweetSocial.feed, winStart, winEnd])
  const hasChatter = socialSeries.length > 1

  // ── Carriers + proof tweets for "Who's carrying it" ──────────────
  const carriers = isCrypto ? xdash.carriers : []
  // Non-crypto carriers come from tweet-search voices.
  const tweetVoices = !isCrypto ? (tweetSocial.voices || []) : []
  const proofMentions = useMemo(() => {
    if (isCrypto) {
      return [...xdash.mentions]
        .sort((a, b) => Number(b?.derived?.weighted_engagement || 0) - Number(a?.derived?.weighted_engagement || 0))
        .slice(0, 4)
    }
    return [...(tweetSocial.feed || [])].sort((a, b) => influenceOf(b) - influenceOf(a)).slice(0, 4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrypto, xdash.mentions, tweetSocial.feed])
  const hasCarryData = isCrypto
    ? (carriers.length > 0 || proofMentions.length > 0)
    : (tweetVoices.length > 0 || proofMentions.length > 0)
  const socialLoading = isCrypto ? xdash.loading : tweetSocial.loading

  // ── THE READ — the verdict synthesis ─────────────────────────────
  const change1dFrac = parseFloat(primaryMarket?.oneDayPriceChange || 0)
  const verdictDelta = chartFirstVal != null && Math.abs(initialChange) >= 0.1
    ? initialChange
    : change1dFrac * 100
  const volVelocity = volume > 0
    ? parseFloat(primaryMarket?.volume24hr || 0) / volume
    : null
  const verdict = useMemo(() => {
    // social descriptor: present + buzz + KOL count. "agree" = chatter
    // directionally matches the lean (heuristic: leaning side + positive 24h
    // move, or social present at all aligning with a strong lean).
    const present = isCrypto ? xdash.hasSocial : (tweetSocial.feed?.length > 0)
    const kolCount = isCrypto ? xdash.kolCount : tweetVoices.filter((v) => (v.followers || 0) >= 100000).length
    const buzzHigh = isCrypto
      ? (xdash.velocity != null ? xdash.velocity >= 1 : xdash.mentions.length >= 8)
      : (tweetSocial.feed?.length || 0) >= 10
    // Heuristic agreement: a moving market with present chatter is "agreeing".
    const agree = present && (Math.abs(verdictDelta) >= 1 ? (verdictDelta > 0) === (yesPct >= 50) : yesPct >= 55 || yesPct <= 45)
    return computeVerdict({
      yesPct,
      delta: verdictDelta,
      social: { present, agree, buzzHigh, kolCount, velocity: xdash.velocity },
      whale: analysis?.whaleActivity || {},
      volVelocity,
      leadLabel: primaryLabel,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrypto, xdash.hasSocial, xdash.kolCount, xdash.velocity, xdash.mentions.length, tweetSocial.feed, tweetVoices, yesPct, verdictDelta, analysis, volVelocity, primaryLabel])

  // Token nodes for the Constellation (crypto: the mapped token).
  const galaxyTokens = useMemo(() => {
    if (!isCrypto || !xdash.cgId) return []
    return [{ symbol: xdash.symbol, cgId: xdash.cgId, image: xdash.tokenInfo?.image_small || xdash.tokenInfo?.image_url || '' }]
  }, [isCrypto, xdash.cgId, xdash.symbol, xdash.tokenInfo])

  // Set initial digit positions without transition on mount/data change
  useEffect(() => {
    const el = chartValueRef.current
    if (!el) return
    const safeVal = Number.isFinite(chartLastVal) ? chartLastVal : yesPct
    const rounded = Math.min(100, Math.max(0, Math.round(safeVal)))
    const str = rounded.toString().padStart(3, ' ')
    const cols = el.querySelectorAll('.pd-digit-col')
    cols.forEach((col, i) => {
      const ch = str[i]
      const wrap = col.parentElement
      if (ch === ' ') {
        wrap.style.width = '0'
        wrap.style.opacity = '0'
      } else {
        wrap.style.width = ''
        wrap.style.opacity = ''
        col.style.transition = 'none'
        col.style.transform = `translateY(-${parseInt(ch) * 10}%)`
        void col.offsetWidth
        col.style.transition = ''
      }
    })
    // `loading` is a dep so the effect re-runs once the odometer actually mounts
    // (during loading the ref is null and we bail). Without it, a market whose
    // post-load value equals the pre-load default never re-fires → stuck "000".
  }, [chartLastVal, loading])

  // Hover handler - slides digit columns via CSS transform transition
  const handleChartHover = useCallback((info) => {
    const firstVal = chartData.length > 0 ? chartData[0].value * 100 : null
    const lastVal = chartData.length > 0 ? chartData[chartData.length - 1].value * 100 : yesPct
    const val = info ? info.value : lastVal
    const change = firstVal != null ? val - firstVal : 0
    const safeVal = Number.isFinite(val) ? val : yesPct
    const rounded = Math.min(100, Math.max(0, Math.round(safeVal)))
    const str = rounded.toString().padStart(3, ' ')

    // Slide digit columns
    const valEl = chartValueRef.current
    if (valEl) {
      const cols = valEl.querySelectorAll('.pd-digit-col')
      cols.forEach((col, i) => {
        const ch = str[i]
        const wrap = col.parentElement
        if (ch === ' ') {
          wrap.style.width = '0'
          wrap.style.opacity = '0'
        } else {
          wrap.style.width = ''
          wrap.style.opacity = ''
          col.style.transform = `translateY(-${parseInt(ch) * 10}%)`
        }
      })
    }

    // Update change badge
    const badgeEl = chartChangeRef.current
    if (badgeEl) {
      if (Math.abs(change) >= 0.1) {
        badgeEl.textContent = `${change > 0 ? '\u25B2' : '\u25BC'} ${Math.abs(change).toFixed(1)}%`
        badgeEl.className = `pd-chart-change-badge mono${change > 0 ? ' pd-chart-change-badge--up' : ' pd-chart-change-badge--down'}`
        badgeEl.style.display = ''
      } else {
        badgeEl.style.display = 'none'
      }
    }

    // Swap label: "chance" <-> hover date
    const labelEl = chartLabelRef.current
    if (labelEl) {
      labelEl.textContent = info
        ? `${formatChartDate(info.time, langTag)}, ${formatChartTime(info.time, langTag)}`
        : t('predictionsPage.chart.chance')
    }
  }, [chartData, yesPct, t, langTag])

  if (loading) {
    return (
      <div className="pd-page">
        <div className="pd-layout">
          <div className="pd-main">
            <div className="pd-skeleton-header">
              <div className="pd-skeleton-img animate-shimmer" />
              <div className="pd-skeleton-title-group">
                <div className="pd-skeleton-title animate-shimmer" />
                <div className="pd-skeleton-subtitle animate-shimmer" />
              </div>
            </div>
            <div className="pd-skeleton-chart animate-shimmer" />
            <div className="pd-skeleton-table animate-shimmer" />
          </div>
          <div className="pd-sidebar">
            <div className="pd-skeleton-trade-card animate-shimmer" />
          </div>
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="pd-page">
        <div className="pd-empty">
          <p className="pd-empty-text">{t('predictionsPage.empty.marketNotFound')}</p>
          <div className="pd-empty-actions">
            <button
              type="button"
              className="pd-back-btn pd-back-btn--primary"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              {t('predictionsPage.empty.tryAgain')}
            </button>
            <button
              type="button"
              className="pd-back-btn"
              onClick={handleBack}
            >
              {t('predictionsPage.empty.backToPredictions')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── Reusable JSX blocks ─────────────────────────────────── */

  const tradeBlock = (
    <div className="pd-trade-card">
      <h3 className="pd-trade-title">{t('predictionsPage.trade.title')}</h3>
      <div className="pd-trade-prices">
        <div className="pd-trade-price pd-trade-price--yes">
          <span className="pd-trade-price-label">{t('predictionsPage.outcome.yes')}</span>
          <span className="pd-trade-price-value mono pm-bull">
            {fmtPrice(yesPrice)}
          </span>
        </div>
        <div className="pd-trade-price pd-trade-price--no">
          <span className="pd-trade-price-label">{t('predictionsPage.outcome.no')}</span>
          <span className="pd-trade-price-value mono pm-bear">
            {fmtPrice(noPrice)}
          </span>
        </div>
      </div>
      <a
        href={event.slug ? `https://polymarket.com/event/${event.slug}` : 'https://polymarket.com'}
        target="_blank"
        rel="noopener noreferrer"
        className="pd-trade-btn"
      >
        {t('predictionsPage.trade.button')}
      </a>
      <div className="pd-trade-meta">
        <div className="pd-trade-stat">
          <span className="pd-trade-stat-label">{t('predictionsPage.trade.volume')}</span>
          <span className="pd-trade-stat-value mono">{fmtVol(volume)}</span>
        </div>
        <div className="pd-trade-stat">
          <span className="pd-trade-stat-label">{t('predictionsPage.trade.liquidity')}</span>
          <span className="pd-trade-stat-value mono">{fmtVol(liquidity)}</span>
        </div>
      </div>
      {!isMobile && <span className="pd-trade-footer">{t('predictionsPage.trade.footer')}</span>}
    </div>
  )

  const marketInfoBlock = (event.description || marketCreated || endDateFormatted) ? (
    <div className="pd-info-card">
      <h3 className="pd-info-title">{t('predictionsPage.info.title')}</h3>
      {event.description && (
        <p className="pd-info-desc">{event.description}</p>
      )}
      <div className="pd-info-rows">
        {marketCreated && (
          <div className="pd-info-row">
            <span className="pd-info-label">{t('predictionsPage.info.created')}</span>
            <span className="pd-info-value">{marketCreated}</span>
          </div>
        )}
        {endDateFormatted && (
          <div className="pd-info-row">
            <span className="pd-info-label">{t('predictionsPage.info.closes')}</span>
            <span className="pd-info-value">{endDateFormatted}</span>
          </div>
        )}
        {marketAge != null && (
          <div className="pd-info-row">
            <span className="pd-info-label">{t('predictionsPage.info.age')}</span>
            <span className="pd-info-value mono">{t('predictionsPage.info.ageDays', { count: marketAge })}</span>
          </div>
        )}
        <div className="pd-info-row">
          <span className="pd-info-label">{t('predictionsPage.info.spread')}</span>
          <span className="pd-info-value mono">{fmtPrice(parseFloat(spread))}</span>
        </div>
        {highLow && (
          <>
            <div className="pd-info-row">
              <span className="pd-info-label">{t('predictionsPage.info.high24')}</span>
              <span className="pd-info-value mono pm-bull">{highLow.high}%</span>
            </div>
            <div className="pd-info-row">
              <span className="pd-info-label">{t('predictionsPage.info.low24')}</span>
              <span className="pd-info-value mono pm-bear">{highLow.low}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null

  const outcomesBlock = (
    <div className="pd-outcomes-card">
      <h2 className="pd-section-title">{t('predictionsPage.outcomes.title')}</h2>
      {(event.markets || []).filter((m) => {
        const vol = parseFloat(m.volume || m.volumeNum || 0)
        const liq = parseFloat(m.liquidity || m.liquidityNum || 0)
        return !m.closed && (vol > 0 || liq > 0)
      }).map((m) => {
        let mYes = 50
        let mYesRaw = 0.5
        try {
          const p = JSON.parse(m.outcomePrices || '["0.5","0.5"]')
          mYesRaw = parseFloat(p[0]) || 0.5
          mYes = Math.round(mYesRaw * 100)
        } catch (_) { console.error(_) }
        const mNo = 100 - mYes
        const slug = event.slug || ''
        const polyUrl = slug
          ? `https://polymarket.com/event/${slug}`
          : 'https://polymarket.com'

        const mVol = parseFloat(m.volume || m.volumeNum || 0)
        const mLiq = parseFloat(m.liquidity || m.liquidityNum || 0)
        const mVol24h = parseFloat(m.volume24hr || 0)
        const mVol1w = parseFloat(m.volume1wk || 0)
        const bestBid = parseFloat(m.bestBid || 0)
        const bestAsk = parseFloat(m.bestAsk || 0)
        const mSpread = bestBid && bestAsk ? (bestAsk - bestBid).toFixed(3) : null
        const lastPrice = parseFloat(m.lastTradePrice || 0)
        const change1d = parseFloat(m.oneDayPriceChange || 0)
        const change1w = parseFloat(m.oneWeekPriceChange || 0)

        return (
          <div key={m.id || m.question} className="pd-outcome-block">
            <div className="pd-outcome-top">
              <div className="pd-outcome-left">
                <span className="pd-outcome-question">{m.question || event.title}</span>
                <div className="pd-outcome-prob-bar">
                  <div className="pd-prob-fill pd-prob-fill--yes" style={{ width: `${mYes}%` }} />
                  <div className="pd-prob-fill pd-prob-fill--no" style={{ width: `${mNo}%` }} />
                </div>
              </div>
              <div className="pd-outcome-right">
                <div className="pd-outcome-pcts">
                  <span className="mono pm-bull">{mYes}%</span>
                  <span className="pd-outcome-slash">/</span>
                  <span className="mono pm-bear">{mNo}%</span>
                </div>
                <div className="pd-outcome-actions">
                  <a href={polyUrl} target="_blank" rel="noopener noreferrer" className="pd-buy-btn pd-buy-btn--yes">{t('predictionsPage.outcomes.buyYes')}</a>
                  <a href={polyUrl} target="_blank" rel="noopener noreferrer" className="pd-buy-btn pd-buy-btn--no">{t('predictionsPage.outcomes.buyNo')}</a>
                </div>
              </div>
            </div>
            {(mVol > 0 || mLiq > 0) && (
            <div className="pd-outcome-stats">
              {mVol24h > 0 && (
                <div className="pd-outcome-stat">
                  <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.vol24h')}</span>
                  <span className="pd-outcome-stat-value mono">{fmtVol(mVol24h)}</span>
                </div>
              )}
              {mVol1w > 0 && (
                <div className="pd-outcome-stat">
                  <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.vol7d')}</span>
                  <span className="pd-outcome-stat-value mono">{fmtVol(mVol1w)}</span>
                </div>
              )}
              {mVol > 0 && (
              <div className="pd-outcome-stat">
                <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.totalVol')}</span>
                <span className="pd-outcome-stat-value mono">{fmtVol(mVol)}</span>
              </div>
              )}
              {mLiq > 0 && (
              <div className="pd-outcome-stat">
                <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.liquidity')}</span>
                <span className="pd-outcome-stat-value mono">{fmtVol(mLiq)}</span>
              </div>
              )}
              {bestBid > 0 && bestAsk > 0 && (
                <div className="pd-outcome-stat">
                  <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.bidAsk')}</span>
                  <span className="pd-outcome-stat-value mono">
                    <span className="pm-bull">{fmtPrice(bestBid)}</span>
                    {' / '}
                    <span className="pm-bear">{fmtPrice(bestAsk)}</span>
                  </span>
                </div>
              )}
              {mSpread && (
                <div className="pd-outcome-stat">
                  <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.spread')}</span>
                  <span className="pd-outcome-stat-value mono">{fmtPrice(parseFloat(mSpread))}</span>
                </div>
              )}
              {lastPrice > 0 && (
                <div className="pd-outcome-stat">
                  <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.lastTrade')}</span>
                  <span className="pd-outcome-stat-value mono">{fmtPrice(lastPrice)}</span>
                </div>
              )}
              {change1d !== 0 && (
                <div className="pd-outcome-stat">
                  <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.change24')}</span>
                  <span className={`pd-outcome-stat-value mono${change1d > 0 ? ' pm-bull' : ' pm-bear'}`}>
                    {change1d > 0 ? '+' : ''}{(change1d * 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {change1w !== 0 && (
                <div className="pd-outcome-stat">
                  <span className="pd-outcome-stat-label">{t('predictionsPage.outcomes.change7d')}</span>
                  <span className={`pd-outcome-stat-value mono${change1w > 0 ? ' pm-bull' : ' pm-bear'}`}>
                    {change1w > 0 ? '+' : ''}{(change1w * 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
            )}
          </div>
        )
      })}
    </div>
  )

  // Hide the Related News section entirely when we have nothing to show.
  // Keep it visible during the initial fetch so users see skeletons, not a
  // missing block that pops in later.
  const showNewsBlock = newsLoading || news.length > 0
  const newsBlock = showNewsBlock ? (
    <div className="pd-news-section">
      <h2 className="pd-section-title">{t('predictionsPage.relatedNews.title')}</h2>
      <div className={`pd-news-scroll${isMobile ? ' pd-news-scroll--mobile' : ''}`}>
        {newsLoading
          ? Array.from({ length: isMobile ? 2 : 3 }).map((_, i) => (
              <div key={i} className="pd-news-card pd-news-card--skeleton">
                <div className="pd-news-skel-title animate-shimmer" />
                <div className="pd-news-skel-meta animate-shimmer" />
              </div>
            ))
          : news.map(n => (
              <a
                key={n.id || n.url}
                className="pd-news-card"
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {n.imageUrl && <img className="pd-news-img" src={n.imageUrl} alt="" onError={(e) => { e.target.style.display = 'none' }} />}
                <div className="pd-news-body">
                  <div className="pd-news-title">{n.title}</div>
                  <div className="pd-news-meta">
                    <span className="pd-news-source">{n.source}</span>
                    {n.publishedOn && (
                      <span className="pd-news-time">
                        {new Date(n.publishedOn * 1000).toLocaleDateString(langTag, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))
        }
      </div>
    </div>
  ) : null

  const whaleBlock = analysis
    ? <PredictionWhale analysis={analysis} question={event.title} dayMode={dayMode} />
    : null

  // THE READ — folds the old AI-analysis paragraph into the verdict body. One
  // synthesis, not a verdict card + a separate AI paragraph.
  const readBlock = (
    <PredictionSignal
      verdict={verdict}
      analysis={analysis}
      leadLabel={primaryLabel}
      yesPct={yesPct}
      dayMode={dayMode}
    />
  )

  // "Who's carrying it" — social proof AFTER the data (evidence-row
  // discipline). Carrier strip + the top proof tweets.
  const carryBlock = (hasCarryData || socialLoading) ? (
    <div className="pd-carry-section">
      <h2 className="pd-section-title">{t('predictionsPage.carry.title', { defaultValue: "Who's carrying it" })}</h2>
      {socialLoading && !hasCarryData ? (
        <div className="pd-carry-skel">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="pd-carry-skel-row animate-shimmer" />
          ))}
        </div>
      ) : (
        <>
          {/* Carrier strip */}
          <div className="pd-carry-strip">
            {isCrypto
              ? carriers.slice(0, 8).map((c, i) => {
                  const handle = String(c.screen_name || c.handle || '').replace(/^@/, '')
                  if (!handle) return null
                  const followers = Number(c.followers_count || c.followers || 0)
                  const tier = getFollowerTier(followers)
                  const avatar = c.profile_image_url || c.avatar || ''
                  return (
                    <a
                      key={handle + i}
                      className="pd-carry-chip"
                      href={`https://x.com/${handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        className="pd-carry-avatar"
                        src={avatar}
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(handle)}` }}
                      />
                      <span className="pd-carry-meta">
                        <span className="pd-carry-handle">@{handle}</span>
                        <span className={`pd-carry-tier ${tier.cls}`}>{t(tier.key, { defaultValue: tier.text })}</span>
                      </span>
                    </a>
                  )
                })
              : tweetVoices.slice(0, 8).map((v, i) => {
                  const handle = String(v.handle || '').replace(/^@/, '')
                  if (!handle) return null
                  const tier = getFollowerTier(v.followers || 0)
                  return (
                    <a
                      key={handle + i}
                      className="pd-carry-chip"
                      href={`https://x.com/${handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        className="pd-carry-avatar"
                        src={v.avatar}
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(handle)}` }}
                      />
                      <span className="pd-carry-meta">
                        <span className="pd-carry-handle">@{handle}</span>
                        <span className={`pd-carry-tier ${tier.cls}`}>{t(tier.key, { defaultValue: tier.text })}</span>
                      </span>
                    </a>
                  )
                })}
          </div>

          {/* Top proof tweets */}
          {proofMentions.length > 0 && (
            <div className="pd-carry-tweets">
              {proofMentions.map((m, i) => {
                if (isCrypto) {
                  const text = getMentionText(m)
                  const url = getMentionUrl(m)
                  const a = m.author || {}
                  const handle = String(a.screen_name || '').replace(/^@/, '')
                  const followers = Number(a.followers_count || 0)
                  const tier = getFollowerTier(followers)
                  return (
                    <a key={(m.tweet?.tweet_id || i)} className="pd-tweet-card" href={url || `https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">
                      <div className="pd-tweet-head">
                        <img className="pd-tweet-avatar" src={a.profile_image_url || ''} alt="" loading="lazy" onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(handle)}` }} />
                        <div className="pd-tweet-id">
                          <span className="pd-tweet-name">{a.name || handle}</span>
                          <span className="pd-tweet-handle">@{handle}</span>
                        </div>
                        <span className={`pd-carry-tier ${tier.cls}`}>{t(tier.key, { defaultValue: tier.text })}</span>
                      </div>
                      <p className="pd-tweet-body">{text}</p>
                      <div className="pd-tweet-foot">
                        <span className="pd-tweet-eng mono">{fmtVol(Number(m?.derived?.weighted_engagement || 0)).replace(/^[^\d]*/, '')} {t('predictionsPage.carry.weighted', { defaultValue: 'engagement' })}</span>
                        {m?.tweet?.created_at_utc && <span className="pd-tweet-time">{relativeTime(m.tweet.created_at_utc, t)}</span>}
                      </div>
                    </a>
                  )
                }
                // non-crypto tweet (tweet-search shape)
                const handle = String(m.handle || '').replace(/^@/, '')
                const tier = getFollowerTier(m.followers || 0)
                return (
                  <a key={m.id || i} className="pd-tweet-card" href={m.url || `https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">
                    <div className="pd-tweet-head">
                      <img className="pd-tweet-avatar" src={m.avatar} alt="" loading="lazy" onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(handle)}` }} />
                      <div className="pd-tweet-id">
                        <span className="pd-tweet-name">{m.name || handle}</span>
                        <span className="pd-tweet-handle">@{handle}</span>
                      </div>
                      <span className={`pd-carry-tier ${tier.cls}`}>{t(tier.key, { defaultValue: tier.text })}</span>
                    </div>
                    <p className="pd-tweet-body">{m.text}</p>
                    <div className="pd-tweet-foot">
                      <span className="pd-tweet-eng mono">{fmtVol(engagementOf(m)).replace(/^[^\d]*/, '')} {t('predictionsPage.carry.weighted', { defaultValue: 'engagement' })}</span>
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  ) : null

  // The Constellation — full-width force graph band. Falls back to the bubble
  // map when there's no social/token layer to orbit.
  const galaxyBlock = (
    <Suspense fallback={<div className="pd-bubble-card pd-bubble-card--loading" aria-hidden="true" />}>
      {(isCrypto && (carriers.length > 0 || galaxyTokens.length > 0)) || (!isCrypto && tweetVoices.length > 0) ? (
        <PredictionSocialGraph
          currentSlug={eventSlug}
          currentTitle={event.title}
          currentYesPct={yesPct}
          category={category}
          tokens={galaxyTokens}
          carriers={isCrypto ? xdash.signalCarriers : tweetVoices.map((v) => ({ screen_name: v.handle, name: v.name, profile_image_url: v.avatar, followers_count: v.followers }))}
          isMobile={isMobile}
          dayMode={dayMode}
        />
      ) : (
        <PredictionBubbleMap currentSlug={eventSlug} dayMode={dayMode} />
      )}
    </Suspense>
  )

  const chartSection = (
    <div className="pd-chart-card">
      <div className="pd-chart-header">
        <div className="pd-chart-value-group">
          <span ref={chartValueRef} className="pd-chart-value-main mono">
            {[0, 1, 2].map(slot => (
              <span key={slot} className="pd-digit-wrap">
                <span className="pd-digit-col">
                  {[0,1,2,3,4,5,6,7,8,9].map(n => (
                    <span key={n} className="pd-digit-num">{n}</span>
                  ))}
                </span>
              </span>
            ))}
            <span className="pd-chart-pct">%</span>
          </span>
          <span ref={chartLabelRef} className="pd-chart-value-label">{t('predictionsPage.chart.chance')}</span>
          <span
            ref={chartChangeRef}
            className={`pd-chart-change-badge mono${initialChange > 0 ? ' pd-chart-change-badge--up' : ' pd-chart-change-badge--down'}`}
            style={{ display: chartData.length > 0 && Math.abs(initialChange) >= 0.1 ? '' : 'none' }}
          >
            {initialChange > 0 ? '\u25B2' : '\u25BC'} {Math.abs(initialChange).toFixed(1)}%
          </span>
        </div>
        <div className="pd-chart-controls">
          {CHART_INTERVALS.map((iv) => (
            <button
              key={iv.id}
              type="button"
              className={`pd-interval-btn mono${chartInterval === iv.id ? ' pd-interval-btn--active' : ''}`}
              onClick={() => setChartInterval(iv.id)}
            >
              {t(iv.labelKey)}
            </button>
          ))}
          {/* Social ribbon toggle — only shown when there's chatter for the
              window. Fades the warm-white chatter soundwave in/out. */}
          {hasChatter && (
            <button
              type="button"
              className={`pd-interval-btn pd-social-toggle${showSocialRibbon ? ' pd-interval-btn--active' : ''}`}
              onClick={() => setShowSocialRibbon((s) => !s)}
              aria-pressed={showSocialRibbon}
            >
              {t('predictionsPage.chart.social', { defaultValue: 'Social' })}
            </button>
          )}
        </div>
      </div>
      {chartLoading ? (
        <div className="pd-chart-skeleton animate-shimmer" />
      ) : chartData.length > 0 ? (
        <>
          <ProbabilityChart data={chartData} dayMode={dayMode} onHoverValue={handleChartHover} langTag={langTag} socialSeries={socialSeries} showSocial={showSocialRibbon && hasChatter} />
          {hasChatter && showSocialRibbon && (
            <div className="pd-momentum__legend">
              <span className="pd-momentum__swatch" />
              <span>{t('predictionsPage.chart.chatterVelocity', { defaultValue: 'Chatter velocity' })}</span>
            </div>
          )}
        </>
      ) : (
        <div className="pd-chart-empty">
          <span className="pd-chart-empty-text">{t('predictionsPage.empty.noChartData')}</span>
        </div>
      )}
    </div>
  )

  const statsBar = (
    <div className="pd-stats-bar">
      <div className="pd-stat-item">
        <span className="pd-stat-label">{t('predictionsPage.statsBar.spread')}</span>
        <span className="pd-stat-val mono">{fmtPrice(parseFloat(spread))}</span>
      </div>
      {highLow && (
        <>
          <div className="pd-stat-item">
            <span className="pd-stat-label">{t('predictionsPage.statsBar.high24')}</span>
            <span className="pd-stat-val mono pm-bull">{highLow.high}%</span>
          </div>
          <div className="pd-stat-item">
            <span className="pd-stat-label">{t('predictionsPage.statsBar.low24')}</span>
            <span className="pd-stat-val mono pm-bear">{highLow.low}%</span>
          </div>
        </>
      )}
      {marketAge != null && (
        <div className="pd-stat-item">
          <span className="pd-stat-label">{t('predictionsPage.statsBar.marketAge')}</span>
          <span className="pd-stat-val mono">{t('predictionsPage.statsBar.marketAgeValue', { count: marketAge })}</span>
        </div>
      )}
      {endDateFormatted && (
        <div className="pd-stat-item">
          <span className="pd-stat-label">{t('predictionsPage.statsBar.ends')}</span>
          <span className="pd-stat-val">{endDateFormatted}</span>
        </div>
      )}
      <div className="pd-stat-item">
        <span className="pd-stat-label">{t('predictionsPage.statsBar.markets')}</span>
        <span className="pd-stat-val mono">{event.markets?.length || 1}</span>
      </div>
    </div>
  )

  return (
    <div className={`pd-page${isMobile ? ' pd-page--mobile' : ''}`}>
      <div className="pd-layout">
        <div className="pd-main">
          {/* Mobile back button — returns to Welcome if arrived from there,
              otherwise to the predictions list. */}
          {isMobile && (
            <button
              type="button"
              className="pd-mobile-back"
              onClick={handleBack}
              aria-label={fromWelcome ? t('predictionsPage.detail.back') : t('predictionsPage.empty.backToPredictions')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>{fromWelcome ? t('predictionsPage.detail.back') : t('predictionsPage.detail.predictions')}</span>
            </button>
          )}

          {/* Desktop back button — was missing entirely; clicking a market
              left no way back to the list without the browser button. */}
          {!isMobile && (
            <button
              type="button"
              className="pd-desktop-back"
              onClick={handleBack}
              aria-label={fromWelcome ? t('predictionsPage.detail.back') : t('predictionsPage.empty.backToPredictions')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>{fromWelcome ? t('predictionsPage.detail.back') : t('predictionsPage.detail.predictions')}</span>
            </button>
          )}

          {/* Market Header */}
          <div className="pd-header-card">
            <div className="pd-header-top">
              {event.image && (
                <img
                  src={event.image}
                  alt=""
                  className="pd-header-image"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}
              <div className="pd-header-info">
                <div className="pd-live-badge">
                  <span className="pd-live-dot" />
                  {t('predictionsPage.detail.live')}
                </div>
                <h1 className="pd-title">{event.title}</h1>
                {primaryLabel && (
                  <div className="pd-leading" title={primaryMarket?.question || ''}>
                    <span className="pd-leading-label">{t('predictionsPage.detail.leading')}</span>
                    <span className="pd-leading-name">{primaryLabel}</span>
                    <span className="pd-leading-pct mono pm-bull">{yesPct}%</span>
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="pd-tags">
                    {tags.map((tag) => (
                      <span key={tag} className="pd-tag">{tag}</span>
                    ))}
                  </div>
                )}
                <div className="pd-header-meta">
                  <CountdownText endDate={endDate} t={t} />
                  <span className="pd-volume mono">{t('predictionsPage.detail.volumeSuffix', { amount: fmtVol(volume) })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile: THE READ comes right after the header — it's the thesis,
              read before the chart even loads. */}
          {isMobile && readBlock}

          {chartSection}
          {statsBar}

          {/* On mobile: trade card right after stats, before outcomes */}
          {isMobile && tradeBlock}

          {outcomesBlock}

          {/* Social proof AFTER the data (evidence-row discipline). */}
          {carryBlock}

          {/* The Constellation — full-width climax band, below the fold.
              Was a cramped rail item; a force graph needs width.
              IO-gated: mount (fetch + d3 sim) waits until scrolled near. */}
          <div ref={galaxyRef}>
            {galaxyInView
              ? galaxyBlock
              : <div className="pd-bubble-card pd-bubble-card--loading" aria-hidden="true" />}
          </div>

          {/* On mobile everything stacks in one column. */}
          {isMobile && whaleBlock}
          {isMobile && marketInfoBlock}
          {isMobile && newsBlock}
        </div>

        {/* ── Right rail - desktop only ───────────────────── */}
        {!isMobile && (
          <div className="pd-sidebar">
            {/* THE READ — the thesis, at the TOP of the rail, before trade. */}
            {readBlock}
            {tradeBlock}
            {marketInfoBlock}
            {/* Whale + News fill the rail beside the outcomes list. */}
            {whaleBlock}
            {newsBlock}
          </div>
        )}
      </div>
    </div>
  )
}

export default PredictionDetail
