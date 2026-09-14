/**
 * MindshareTabPanel - Narrative Lifecycle Intelligence for Command Center.
 *
 * Apple Cinematic design language - visual, information-dense, zero ornament.
 * Features a toggle between Sectors and Tokens views, rendered adoption curve
 * with positioned bubbles, spotlight cards, momentum matrix, and AI analysis.
 *
 * Sectors view: powered by /api/market/mindshare endpoint (real lifecycle stages,
 *   curve positions, momentum scores, risk scores, top movers with logos).
 * Tokens view: derived from topCoinPrices prop (client-side classification).
 *
 * Props:
 *   topCoinPrices - { BTC: { price, change, marketCap, ... }, ... }
 */
import { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import useMindshareData from '@/hooks/useMindshareData'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { isMajorToken } from '@/constants/majorTokens'
import { getPathForPageId } from '@/constants/pageRoutes'
import { TOKEN_LOGOS, TOP_COINS } from './welcome-page-constants'
import TokenImg from '@/lib/token-img'
import MindshareAttentionTreemap from './mindshare-attention-treemap'
import { relaxBubbles, labelChipHalfWidth, resolveLabelChips } from './bubble-collision'
import './mindshare-tab-panel.css'
import XDashUpdatingNotice from '@/components/xdash-updating-notice'

const STAGE_ORDER = ['Early', 'Early-Mid', 'Mid', 'Mid-Late', 'Late', 'Exhausted']

const STAGE_META = {
  Early:      { label: 'Early', shortLabel: 'E', color: 'green',  desc: 'Accumulation' },
  'Early-Mid':{ label: 'Early-Mid', shortLabel: 'EM', color: 'green',  desc: 'Building' },
  Mid:        { label: 'Mid', shortLabel: 'M', color: 'yellow', desc: 'Growth' },
  'Mid-Late': { label: 'Mid-Late', shortLabel: 'ML', color: 'yellow', desc: 'Maturation' },
  Late:       { label: 'Late', shortLabel: 'L', color: 'red',    desc: 'Distribution' },
  Exhausted:  { label: 'Exhausted', shortLabel: 'X', color: 'red',    desc: 'Decline' },
}

// Map API stage code → STAGE_ORDER label
const CODE_TO_LABEL = { E: 'Early', EM: 'Early-Mid', M: 'Mid', ML: 'Mid-Late', L: 'Late', X: 'Exhausted' }

// Map stage label → color
function stageColor(label) {
  return STAGE_META[label]?.color || 'yellow'
}

// Mega/large caps get shifted thresholds (they move less)
const LARGE_CAPS = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'USDT', 'USDC'])

function classifyToken(symbol, change) {
  const ch = change || 0
  const isLarge = LARGE_CAPS.has(symbol)
  const t = isLarge ? 0.6 : 1
  if (ch > 5 * t) return { stageLabel: 'Early', color: 'green' }
  if (ch > 2 * t) return { stageLabel: 'Early-Mid', color: 'green' }
  if (ch > 0) return { stageLabel: 'Mid', color: 'yellow' }
  if (ch > -2 * t) return { stageLabel: 'Mid-Late', color: 'yellow' }
  if (ch > -5 * t) return { stageLabel: 'Late', color: 'red' }
  return { stageLabel: 'Exhausted', color: 'red' }
}

function shortName(name) {
  if (!name || typeof name !== 'string') return ''
  if (name.includes('(') && name.includes(')')) {
    const m = name.match(/\(([^)]+)\)/)
    if (m) return m[1]
  }
  if (name.includes(' / ')) return name.split(' / ').map(p => p.trim().substring(0, 4)).join('/')
  if (name.length > 6) return name.substring(0, 5)
  return name
}

// Tight 2-4 char code centered inside the circle (never bleeds). Full name +
// delta ride the chip below + the hover tooltip.
function bubbleCode(name) {
  if (!name || typeof name !== 'string') return ''
  const paren = name.match(/\(([^)]+)\)/)
  const src = (paren ? paren[1] : name).trim()
  const words = src.split(/[\s/&-]+/).filter(Boolean)
  if (words.length >= 2) return words.slice(0, 4).map(w => w[0]).join('').toUpperCase()
  return src.slice(0, 4).toUpperCase()
}

// Bell curve Y for adoption curve - higher in the middle, lower at edges
function curveY(xPct) {
  const x = (xPct - 50) / 50
  return Math.exp(-2.5 * x * x)
}

function fmtVol(v) {
  if (!v || v === 0) return '$0'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v}`
}

function fmtPrice(p) {
  if (!p || p === 0) return '$0'
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (p >= 1) return `$${p.toFixed(2)}`
  return `$${p.toPrecision(4)}`
}

const MSH_STAGE_ORDER = { Early: 0, 'Early-Mid': 1, Mid: 2, 'Mid-Late': 3, Late: 4, Exhausted: 5 }

const MindshareTabPanel = ({ topCoinPrices, onOpenResearchZone, onOpenAIScreener, onPageChange }) => {
  const { t } = useTranslation()
  const { data: mindshareData, loading: mindshareLoading } = useMindshareData()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [mode, setMode] = useState('social')
  const [view, setView] = useState('sectors')
  const [matrixSortKey, setMatrixSortKey] = useState('momentum')
  const [matrixSortDir, setMatrixSortDir] = useState('desc')
  const [curveFilter, setCurveFilter] = useState(null)
  const [activeBubbleId, setActiveBubbleId] = useState(null)

  // Measure the desktop curve width so label-collision math uses real pixels.
  const curveRef = useRef(null)
  const [curveW, setCurveW] = useState(0)
  useEffect(() => {
    if (isMobile) return undefined
    const el = curveRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setCurveW(e.contentRect.width)
    })
    ro.observe(el)
    setCurveW(el.clientWidth)
    return () => ro.disconnect()
  }, [isMobile])

  // Sector pills in the adoption curve should navigate to the Categories
  // page, pre-selecting the tapped sector. We use sessionStorage instead of a
  // URL param because categories-page already drives its detail view from
  // internal state; the handshake key is read once on mount.
  const openCategoryPage = useCallback((bubble) => {
    if (!bubble) return
    const id = bubble.id || bubble.sector_id || null
    const name = bubble.name || null
    try {
      sessionStorage.setItem('spectre-category-target', JSON.stringify({ id, name, ts: Date.now() }))
    } catch (_) { /* storage can be disabled */ }
    if (onPageChange) onPageChange('categories')
    else navigate(getPathForPageId('categories'))
  }, [onPageChange, navigate])

  // Route a bubble to Research Zone (majors) or AI Screener (on-chain/small caps).
  const openBubbleTarget = useCallback((bubble, target) => {
    if (!bubble) return
    const sym = (bubble.symbol || bubble.topMover || '').toUpperCase()
    if (!sym) return
    const data = topCoinPrices?.[sym] || {}
    const tokenData = {
      symbol: sym,
      name: bubble.name || data.name || sym,
      price: bubble.price || data.price || 0,
      change: bubble.avgChange ?? bubble.topMoverChange ?? data.change ?? 0,
      logo: bubble.topMoverLogo || TOKEN_LOGOS[sym] || data.logo || null,
    }
    if (target === 'rz' && onOpenResearchZone) return onOpenResearchZone(tokenData)
    if (target === 'screener' && onOpenAIScreener) return onOpenAIScreener(tokenData)
    // Smart fallback: majors → RZ, small caps → Screener
    if (isMajorToken(sym)) {
      if (onOpenResearchZone) onOpenResearchZone(tokenData)
      else if (onOpenAIScreener) onOpenAIScreener(tokenData)
    } else {
      if (onOpenAIScreener) onOpenAIScreener(tokenData)
      else if (onOpenResearchZone) onOpenResearchZone(tokenData)
    }
  }, [onOpenResearchZone, onOpenAIScreener, topCoinPrices])

  const handleMatrixSort = (key) => {
    if (matrixSortKey === key) {
      setMatrixSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setMatrixSortKey(key)
      setMatrixSortDir('desc')
    }
  }

  // ── Sector items from API ──
  const sectorItems = useMemo(() => {
    if (!mindshareData?.sectors?.length) return []
    return mindshareData.sectors.map(s => {
      const stageLabel = s.stage?.label || CODE_TO_LABEL[s.stage?.code] || 'Mid'
      const color = stageColor(stageLabel)
      const tm = s.top_mover || {}
      return {
        id: s.sector_id,
        name: s.sector_name,
        avgChange: s.change_24h ?? 0,
        totalVolume: s.volume ?? 0,
        stageLabel,
        color,
        topMover: tm.ticker || null,
        topMoverLogo: tm.logo || null,
        topMoverChange: tm.change_24h ?? null,
        topMoverName: tm.name || null,
        topMoverId: tm.token_id || null,
        topMoverPrice: tm.price ?? null,
        momentumScore: s.momentum_score ?? 0,
        riskScore: s.risk_score ?? 0,
        performance: s.performance,
        lifecycle: s.lifecycle,
        xAttention: s.x?.attention_score ?? 0,
      }
    })
  }, [mindshareData])

  // ── Token items - derive from topCoinPrices ──
  const tokenItems = useMemo(() => {
    if (!topCoinPrices || Object.keys(topCoinPrices).length === 0) return []
    const stables = new Set(['USDT', 'USDC', 'DAI', 'BUSD'])
    return TOP_COINS
      .filter(c => !stables.has(c.symbol) && topCoinPrices[c.symbol])
      .map(c => {
        const data = topCoinPrices[c.symbol]
        const change = data.change != null ? Number(data.change) : 0
        const { stageLabel, color } = classifyToken(c.symbol, change)
        return {
          id: c.symbol.toLowerCase(),
          name: c.name,
          symbol: c.symbol,
          avgChange: change,
          totalVolume: data.volume24h || data.marketCap || 0,
          stageLabel,
          color,
          topMover: c.symbol,
          price: data.price || 0,
        }
      })
  }, [topCoinPrices])

  // ── Active items based on view ──
  const items = view === 'tokens' && tokenItems.length > 0 ? tokenItems : sectorItems
  const isTokenView = view === 'tokens' && tokenItems.length > 0
  const hasApiData = !isTokenView && mindshareData != null

  // Max values for relative sizing
  const maxAbsChange = useMemo(() => Math.max(...items.map(n => Math.abs(n.avgChange || 0)), 1), [items])

  // ── Cycle phase signal ──
  const cycleSignal = useMemo(() => {
    // Use API cycle data for sectors view
    if (hasApiData && mindshareData.cycle) {
      const c = mindshareData.cycle
      const score = c.phase_score ?? 0.5
      const phase = Math.round(score * 100)
      let bias = 'neutral'
      if (score < 0.35) bias = 'bullish'
      else if (score > 0.7) bias = 'bearish'
      return { label: c.phase_label || 'Unknown', bias, phase }
    }
    // Fallback: derive from items
    if (items.length === 0) return { label: 'Unknown', bias: 'neutral', phase: 0 }
    const early = items.filter(n => n.color === 'green').length
    const late = items.filter(n => n.color === 'red').length
    const total = items.length
    const earlyRatio = early / total
    const lateRatio = late / total
    if (earlyRatio >= 0.4) return { label: 'Early Cycle', bias: 'bullish', phase: 20 }
    if (earlyRatio >= 0.2 && lateRatio < 0.2) return { label: 'Growth Phase', bias: 'bullish', phase: 40 }
    if (lateRatio < 0.2) return { label: 'Mid Cycle', bias: 'neutral', phase: 55 }
    if (lateRatio >= 0.4) return { label: 'Late Cycle', bias: 'bearish', phase: 85 }
    return { label: 'Transition', bias: 'neutral', phase: 65 }
  }, [hasApiData, mindshareData, items])

  // ── Spotlight cards from API highlights ──
  const spotlights = useMemo(() => {
    if (hasApiData && mindshareData.highlights) {
      const h = mindshareData.highlights
      const cards = []
      if (h.top_momentum) {
        const tm = h.top_momentum
        const stageLabel = tm.stage?.label || 'Mid'
        cards.push({
          type: 'momentum', label: 'Top Momentum',
          name: tm.sector_name, id: tm.sector_id,
          avgChange: tm.change_24h ?? 0,
          totalVolume: tm.volume ?? 0,
          stageLabel, color: stageColor(stageLabel),
          momentumScore: tm.momentum_score ?? 0,
          topMoverLogo: tm.top_mover?.logo,
          topMover: tm.top_mover?.ticker,
        })
      }
      if (h.highest_risk) {
        const hr = h.highest_risk
        const stageLabel = hr.stage?.label || 'Mid'
        cards.push({
          type: 'risk', label: 'Highest Risk',
          name: hr.sector_name, id: hr.sector_id,
          avgChange: hr.change_24h ?? 0,
          totalVolume: hr.volume ?? 0,
          stageLabel, color: stageColor(stageLabel),
          riskScore: hr.risk_score ?? 0,
          topMoverLogo: hr.top_mover?.logo,
          topMover: hr.top_mover?.ticker,
        })
      }
      return cards
    }
    // Fallback: derive from items
    if (items.length === 0) return []
    const sorted = [...items].sort((a, b) => (b.avgChange || 0) - (a.avgChange || 0))
    const strongest = sorted[0]
    const risk = sorted[sorted.length - 1]
    const cards = []
    cards.push({ type: 'momentum', label: 'Top Momentum', ...strongest })
    if (risk && risk.id !== strongest.id) {
      cards.push({ type: 'risk', label: 'Highest Risk', ...risk })
    }
    return cards
  }, [hasApiData, mindshareData, items])

  // ── Bubbles from API curve data ──
  const bubbles = useMemo(() => {
    if (hasApiData && mindshareData.curve?.items?.length) {
      // Build lookup of sector data (change_24h, volume) by sector_id — curve items only have positions
      const sectorById = {}
      ;(mindshareData.sectors || []).forEach(s => { sectorById[s.sector_id] = s })

      let curveItems = mindshareData.curve.items
      // Mobile: keep only top 6 by bubble size to avoid overlap
      if (isMobile) {
        curveItems = [...curveItems]
          .sort((a, b) => (b.bubble_size || 0) - (a.bubble_size || 0))
          .slice(0, 6)
      }
      const maxBubble = Math.max(...curveItems.map(b => b.bubble_size || 0), 0.01)
      return curveItems.map(b => {
        const stageLabel = b.stage?.label || 'Mid'
        const xPct = Math.max(3, Math.min(97, (b.x ?? 0.5) * 100))
        const yBase = b.y ?? curveY(xPct)
        const sizeRatio = (b.bubble_size || 0) / maxBubble
        const size = isMobile ? 24 + sizeRatio * 16 : 28 + sizeRatio * 28
        const sec = sectorById[b.id] || {}
        return {
          id: b.id,
          name: b.label,
          stageLabel,
          color: stageColor(stageLabel),
          avgChange: sec.change_24h ?? 0,
          totalVolume: sec.volume ?? 0,
          xPct,
          yBase,
          size,
        }
      })
    }
    // Fallback: position items on curve by stage zone
    let baseItems = items
    if (isMobile) {
      baseItems = [...items].sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0)).slice(0, 6)
    }
    const zoneWidth = 100 / STAGE_ORDER.length
    const zonePad = 3
    const maxVol = Math.max(...baseItems.map(n => n.totalVolume || 0), 1)
    const groups = {}
    baseItems.forEach(n => {
      const stage = n.stageLabel || 'Mid'
      if (!groups[stage]) groups[stage] = []
      groups[stage].push(n)
    })
    const result = []
    STAGE_ORDER.forEach((stage, stageIdx) => {
      const group = groups[stage] || []
      const zoneStart = stageIdx * zoneWidth
      const usable = zoneWidth - zonePad * 2
      group.forEach((n, gi) => {
        const count = group.length
        let xPct = count === 1
          ? zoneStart + zoneWidth / 2
          : zoneStart + zonePad + (gi / (count - 1)) * usable
        xPct = Math.max(3, Math.min(97, xPct))
        const yBase = curveY(xPct)
        const yShift = count > 1 ? (gi % 2 === 0 ? 0 : -0.18) : 0
        const volRatio = (n.totalVolume || 0) / maxVol
        const size = isMobile ? 24 + volRatio * 16 : 28 + volRatio * 24
        result.push({ ...n, xPct, yBase: Math.max(0.05, yBase + yShift), size })
      })
    })
    return result
  }, [hasApiData, mindshareData, items, isMobile])

  // Stage distribution for zone labels
  const stageDistribution = useMemo(() => {
    const dist = {}
    STAGE_ORDER.forEach(s => { dist[s] = 0 })
    const source = hasApiData ? bubbles : items
    source.forEach(n => {
      const key = n.stageLabel || 'Mid'
      if (dist[key] !== undefined) dist[key]++
    })
    return dist
  }, [hasApiData, bubbles, items])

  // Measure the real curve box (mobile has no desktop curve; desktop height is
  // 270px via CSS, but measure to survive responsive changes).
  const [curveH, setCurveH] = useState(0)
  useEffect(() => {
    if (isMobile) return undefined
    const el = curveRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setCurveH(e.contentRect.height)
    })
    ro.observe(el)
    setCurveH(el.clientHeight)
    return () => ro.disconnect()
  }, [isMobile])

  // Resolve bubble overlaps with a real 2D force-relaxation (shared with the
  // Sector quadrant). The plot is short (~270px), so we CANNOT fit a tall
  // label-inclusive box for every bubble. Instead: the top-N bubbles by volume
  // keep an always-on name chip (and reserve the tall label-inclusive halfH); the
  // rest reveal their chip only on hover (and reserve just the circle radius + a
  // small pad as halfH). Most boxes are small → they pack cleanly to zero overlap,
  // and the ~8 notable ones get the vertical room their always-on chip needs.
  const placedBubbles = useMemo(() => {
    if (bubbles.length === 0) return bubbles
    if (isMobile) return bubbles // mobile uses the stage-grid, not the curve
    const W = Math.max(640, curveW || 1100)
    const H = Math.max(200, curveH || 270)

    // Pick which bubbles get an always-on label: the top-N by volume (the most
    // significant), responsive ~8 desktop / ~5 mobile. Ties broken by size.
    const labelN = isMobile ? 5 : 8
    const rankedIds = new Set(
      [...bubbles]
        .sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0) || (b.size || 0) - (a.size || 0))
        .slice(0, labelN)
        .map((b) => b.id)
    )

    const base = bubbles.map((b) => {
      const r = (b.size || 28) / 2
      const labeled = rankedIds.has(b.id)
      const x = (b.xPct / 100) * W
      // CSS anchored bottom: 12% + yBase*55% → top(px) = H*(1 - (0.12 + yBase*0.55)).
      const y = H * (1 - (0.12 + (b.yBase || 0) * 0.55))
      // Labeled bubbles reserve room for the chip below (halfW spans the chip);
      // hover-only bubbles reserve just the circle + a small pad.
      const halfW = labeled ? Math.max(r, labelChipHalfWidth(shortName(b.name))) : r + 3
      const halfH = labeled ? r + 20 : r + 4
      return { ...b, labeled, x, y, halfW, halfH }
    })

    const placed = relaxBubbles(base, { W, H, iters: 120, spring: 0.05, padding: 2 })
    // Guarantee no two always-on label chips overlap (demote clashers to hover).
    const resolved = resolveLabelChips(placed, { nameOf: (p) => shortName(p.name) })
    // Emit px positions the render consumes.
    return resolved.map((p) => ({ ...p, leftPx: p.x, topPx: p.y }))
  }, [bubbles, isMobile, curveW, curveH])

  // ── Matrix rows from API ──
  const matrixRows = useMemo(() => {
    if (isTokenView) return null // tokens use items-based rendering
    if (hasApiData && mindshareData.matrix?.rows?.length) {
      return mindshareData.matrix.rows.map(r => {
        const stageLabel = CODE_TO_LABEL[r.stage_code] || 'Mid'
        // Find matching sector for top mover logo
        const sec = mindshareData.sectors?.find(s => s.sector_id === r.sector_id)
        return {
          id: r.sector_id,
          name: r.sector_name,
          avgChange: r.change_24h ?? 0,
          totalVolume: r.volume ?? 0,
          stageLabel,
          color: stageColor(stageLabel),
          topMover: r.top_mover,
          topMoverLogo: sec?.top_mover?.logo || null,
          topMoverId: sec?.top_mover?.token_id || null,
          momentumScore: r.momentum_score ?? 0,
          riskScore: r.risk_score ?? 0,
          rank: r.rank,
        }
      })
    }
    return null // will use items fallback
  }, [isTokenView, hasApiData, mindshareData])

  // Items to render in matrix (API rows or fallback items)
  const matrixItems = matrixRows || items

  // Sort matrix
  const sortedMatrixItems = useMemo(() => {
    const dir = matrixSortDir === 'desc' ? -1 : 1
    return [...matrixItems].sort((a, b) => {
      if (matrixSortKey === 'momentum') return dir * ((a.momentumScore || 0) - (b.momentumScore || 0))
      if (matrixSortKey === 'change') return dir * ((a.avgChange || 0) - (b.avgChange || 0))
      if (matrixSortKey === 'vol') {
        const aVal = isTokenView ? (a.price || 0) : (a.totalVolume || 0)
        const bVal = isTokenView ? (b.price || 0) : (b.totalVolume || 0)
        return dir * (aVal - bVal)
      }
      if (matrixSortKey === 'risk') return dir * ((a.riskScore || 0) - (b.riskScore || 0))
      if (matrixSortKey === 'last') {
        if (isTokenView) return dir * ((MSH_STAGE_ORDER[a.stageLabel] ?? 2) - (MSH_STAGE_ORDER[b.stageLabel] ?? 2))
        return dir * ((a.topMover || '').localeCompare(b.topMover || ''))
      }
      return 0
    })
  }, [matrixItems, matrixSortKey, matrixSortDir, isTokenView])

  // AI Analysis
  const analysis = useMemo(() => {
    if (items.length === 0 && !hasApiData) return null
    const source = isTokenView ? items : sectorItems
    const early = source.filter(n => n.color === 'green')
    const late = source.filter(n => n.color === 'red')
    const mid = source.filter(n => n.color === 'yellow')
    const total = source.length
    const advancing = source.filter(n => (n.avgChange || 0) > 0)
    const sorted = [...source].sort((a, b) => (b.avgChange || 0) - (a.avgChange || 0))
    const top = sorted[0]
    const weakest = sorted[sorted.length - 1]
    const label = isTokenView ? 'tokens' : 'narratives'
    const nameOf = n => isTokenView ? (n.symbol || n.name) : n.name

    let cycleText = ''
    if (early.length >= 3) {
      cycleText = `Market shows strong early-cycle characteristics with ${early.length}/${total} ${label} in accumulation phase. ${early.slice(0, 3).map(nameOf).join(', ')} are building momentum before mainstream awareness - historically the highest-alpha window.`
    } else if (late.length >= 2) {
      cycleText = `Caution warranted - ${late.length}/${total} ${label} entering late-cycle distribution. ${late.slice(0, 3).map(nameOf).join(' and ')} showing signs of peak attention. Rotate exposure toward earlier-stage ${label} for better risk-reward.`
    } else if (early.length >= 1 && late.length >= 1) {
      cycleText = `Mixed lifecycle signals across ${label}. Early-stage opportunities in ${early.map(nameOf).join(', ')} coexist with mature positioning in ${late.map(nameOf).join(', ')}. Selective exposure with clear stage awareness is key.`
    } else {
      cycleText = `${mid.length}/${total} ${label} clustered in mid-cycle. Broad growth phase with no extreme positioning. Watch for breakout ${label} that separate from the pack.`
    }

    let momentumText = ''
    if (top && weakest && top !== weakest) {
      const rawSpread = Math.abs((top.avgChange || 0) - (weakest.avgChange || 0))
      // 2026-05-26 beta-quality fix: skip momentum narrative when spread is
      // effectively zero (single-row arrays or near-identical change values
      // produced "divergence of 0% signals conviction" nonsense copy).
      if (rawSpread >= 0.5) {
        const spread = rawSpread.toFixed(1)
        momentumText = `${nameOf(top)} leads with ${(top.avgChange || 0) >= 0 ? '+' : ''}${(top.avgChange || 0).toFixed(1)}% while ${nameOf(weakest)} trails at ${(weakest.avgChange || 0).toFixed(1)}%. ${isTokenView ? 'Token' : 'Narrative'} divergence of ${spread}% signals conviction-driven capital flows over broad market moves.`
      }
    }

    let opportunityText = ''
    if (early.length > 0) {
      const earlyAdv = early.filter(n => (n.avgChange || 0) > 0)
      if (earlyAdv.length > 0) {
        opportunityText = `Highest conviction: ${earlyAdv.slice(0, 3).map(nameOf).join(', ')} - early lifecycle with positive momentum. Volume confirmation needed but risk-reward is asymmetric. ${advancing.length}/${total} ${label} showing positive direction.`
      } else {
        opportunityText = `Early-stage ${label} present but lacking momentum. Wait for volume confirmation before allocating. ${advancing.length}/${total} ${label} currently advancing.`
      }
    } else {
      opportunityText = `No clear early-stage opportunities. ${advancing.length}/${total} ${label} positive. Focus on mid-cycle ${label} with strongest relative momentum.`
    }

    return { cycleText, momentumText, opportunityText }
  }, [items, sectorItems, isTokenView, hasApiData])

  const socialParams = useMemo(() => ({
    page: 1,
    perPage: 48,
    timeframe: '24h',
    ranking: 'mentions',
    segment: 'all',
    market: 'all',
    minKols: 1,
  }), [])
  const { data: socialData, loading: socialLoading, error: socialError, refetch: socialRefetch, health: socialHealth } = useXDashBootstrap(socialParams)
  const socialTokens = socialData?.tokens || []

  // Self-heal a cold/transient bootstrap failure so the Command Center social
  // map doesn't sit silently empty (mirrors the Discover-tab Social resilience).
  const socialRetryRef = useRef(0)
  useEffect(() => {
    if (!socialError || socialTokens.length) { socialRetryRef.current = 0; return undefined }
    if (socialRetryRef.current >= 4) return undefined
    const id = setTimeout(() => { socialRetryRef.current += 1; socialRefetch?.() }, 2500 + socialRetryRef.current * 2000)
    return () => clearTimeout(id)
  }, [socialError, socialTokens.length, socialRefetch])

  const openSocialToken = useCallback((cgId) => {
    if (!cgId) return
    navigate(`/x-dash/token/${encodeURIComponent(cgId)}`)
  }, [navigate])

  // Loading state
  if (mode === 'data' && mindshareLoading && sectorItems.length === 0 && view === 'sectors') {
    return (
      <div className="msh">
        <div className="msh-loading">
          <div className="msh-loading-bar animate-shimmer" style={{ height: 40, borderRadius: 8, marginBottom: 16 }} />
          <div className="msh-loading-bar animate-shimmer stagger-1" style={{ height: 160, borderRadius: 12, marginBottom: 16 }} />
          <div className="msh-loading-bar animate-shimmer stagger-2" style={{ height: 80, borderRadius: 8, marginBottom: 12 }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`msh-loading-bar animate-shimmer stagger-${(i % 5) + 1}`} style={{ height: 36, borderRadius: 6, marginBottom: 4 }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="msh">
      <div className="msh-mode-toggle-row">
        <div className="msh-mode-toggle">
          <button
            type="button"
            className={`msh-mode-btn ui-glass ${mode === 'social' ? 'active' : ''}`}
            onClick={() => setMode('social')}
          >
            {t('homePage.mindshareTabPanel.mindsharetabpanel.social', "Social")}
          </button>
          <button
            type="button"
            className={`msh-mode-btn ui-glass ${mode === 'data' ? 'active' : ''}`}
            onClick={() => setMode('data')}
          >
            {t('homePage.mindshareTabPanel.mindsharetabpanel.data', "Data")}
          </button>
        </div>
        {mode === 'social' && (
          <span className="msh-mode-hint">
            cell size = mention share · green = rank climbed · red = rank fell
          </span>
        )}
      </div>

      {mode === 'social' && (
        <div className="msh-social">
          <div className="msh-social-head">
            <span className="msh-landscape-title">{t('homePage.mindshareTabPanel.mindsharetabpanel.attentionMap', "Attention map")}</span>
            <span className="msh-landscape-count">{socialTokens.length} tokens · 24h</span>
          </div>
          {/* An empty treemap draws "No attention to map for this window",
              which on a market with 4,000 tracked tokens reads as a dead app
              rather than a feed rebuilding upstream. */}
          {socialTokens.length === 0 && !socialLoading && socialHealth?.state === 'updating' ? (
            <XDashUpdatingNotice
              health={socialHealth}
              onRetry={socialRefetch}
              onOpenLive={() => navigate('/x-dash')}
            />
          ) : (
            <MindshareAttentionTreemap
              tokens={socialTokens}
              loading={socialLoading && socialTokens.length === 0}
              onOpenToken={openSocialToken}
              height={isMobile ? 360 : 500}
            />
          )}
        </div>
      )}

      {mode === 'data' && (<>

      {/* Cycle Phase Signal */}
      <div className={`msh-signal bias-${cycleSignal.bias}`}>
        <div className="msh-signal-left">
          <span className="msh-signal-dot" />
          <span className="msh-signal-label">{isTokenView ? 'Token Lifecycle' : 'Narrative Lifecycle'}</span>
          <span className="msh-signal-sep" />
          <span className="msh-signal-regime">{cycleSignal.label}</span>
          {hasApiData && mindshareData.cycle?.dominant_stage && (
            <span className={`msh-signal-stage stage-${stageColor(mindshareData.cycle.dominant_stage.label)}`}>
              {mindshareData.cycle.dominant_stage.label}
            </span>
          )}
        </div>
        <div className="msh-signal-right">
          <span className="msh-signal-phase-label">{t('homePage.mindshareTabPanel.mindsharetabpanel.cycle', "Cycle")}</span>
          <div className="msh-signal-phase-track">
            <div className="msh-signal-phase-fill" style={{ width: `${cycleSignal.phase}%` }} />
            <div className="msh-signal-phase-marker" style={{ left: `${cycleSignal.phase}%` }} />
          </div>
        </div>
      </div>

      {/* Adoption Curve Landscape */}
      <div className="msh-landscape">
        <div className="msh-landscape-header">
          <span className="msh-landscape-title">{t('homePage.mindshareTabPanel.mindsharetabpanel.adoptionCurve', "Adoption Curve")}</span>
          {/* View toggle */}
          <div className="msh-view-toggle">
            <button
              className={`msh-view-btn ui-glass ${view === 'sectors' ? 'active' : ''}`}
              onClick={() => setView('sectors')}
            >
              {t('homePage.mindshareTabPanel.mindsharetabpanel.sectors', "Sectors")}
            </button>
            <button
              className={`msh-view-btn ui-glass ${view === 'tokens' ? 'active' : ''}`}
              onClick={() => setView('tokens')}
            >
              {t('homePage.mindshareTabPanel.mindsharetabpanel.tokens', "Tokens")}
            </button>
          </div>
        </div>

        {/* Mobile: stage-grouped bubble grid (no chart, no overlap) */}
        {isMobile && (
          <div className="msh-stages-grid">
            {STAGE_ORDER.map((stage) => {
              const meta = STAGE_META[stage]
              const stageItems = items
                .filter((n) => n.stageLabel === stage)
                .sort((a, b) => Math.abs(b.avgChange || 0) - Math.abs(a.avgChange || 0))
              if (stageItems.length === 0) return null
              const avgChange = stageItems.reduce((s, n) => s + (n.avgChange || 0), 0) / stageItems.length
              const filtered = curveFilter && curveFilter !== stage
              return (
                <div
                  key={stage}
                  className={`msh-stage-block stage-${meta.color}${filtered ? ' dimmed' : ''}`}
                  onClick={() => setCurveFilter((f) => (f === stage ? null : stage))}
                >
                  <div className="msh-stage-block-head">
                    <span className={`msh-stage-block-abbr stage-${meta.color}`}>{meta.shortLabel}</span>
                    <span className="msh-stage-block-name">{meta.label}</span>
                    <span className="msh-stage-block-desc">{meta.desc}</span>
                    <span className="msh-stage-block-count">{stageItems.length}</span>
                    <span className={`msh-stage-block-avg ${avgChange >= 0 ? 'pos' : 'neg'}`}>
                      {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(1)}%
                    </span>
                  </div>
                  <div className="msh-stage-block-bubbles">
                    {stageItems.map((n) => {
                      const ch = n.avgChange || 0
                      const sym = n.symbol || n.topMover
                      const hasLogo = isTokenView
                        ? (sym && TOKEN_LOGOS[sym])
                        : !!n.topMoverLogo
                      return (
                        <button
                          key={n.id}
                          type="button"
                          className={`msh-stage-bubble stage-${n.color}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            // Sectors view → drill into Categories page for this sector.
                            // Tokens view → open the detail modal so RZ/Screener buttons stay accessible.
                            if (!isTokenView) {
                              openCategoryPage(n)
                            } else {
                              setActiveBubbleId((prev) => (prev === n.id ? null : n.id))
                            }
                          }}
                        >
                          <div className={`msh-stage-bubble-circle stage-${n.color}`}>
                            {isTokenView && sym && TOKEN_LOGOS[sym] ? (
                              <TokenImg src={TOKEN_LOGOS[sym]} symbol={sym} alt="" />
                            ) : !isTokenView && n.topMoverLogo ? (
                              <img src={n.topMoverLogo} alt="" loading="lazy" decoding="async" width="24" height="24" />
                            ) : (
                              <span className="msh-stage-bubble-initial">
                                {(sym || shortName(n.name)).slice(0, 3).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <span className="msh-stage-bubble-name">{isTokenView ? (sym || shortName(n.name)) : shortName(n.name)}</span>
                          <span className={`msh-stage-bubble-change ${ch >= 0 ? 'pos' : 'neg'}`}>
                            {ch >= 0 ? '+' : ''}{ch.toFixed(1)}%
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Desktop: bell curve canvas with positioned bubbles */}
        {!isMobile && <div className="msh-curve" ref={curveRef}>
          {/* SVG bell curve background */}
          <svg className="msh-curve-svg" viewBox="0 0 400 120" preserveAspectRatio="none">
            <defs>
              <linearGradient id="mshCurveGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(48,209,88,0.12)" />
                <stop offset="35%" stopColor="rgba(255,214,10,0.10)" />
                <stop offset="65%" stopColor="rgba(255,214,10,0.10)" />
                <stop offset="100%" stopColor="rgba(255,69,58,0.12)" />
              </linearGradient>
              <linearGradient id="mshCurveStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(48,209,88,0.3)" />
                <stop offset="50%" stopColor="rgba(255,214,10,0.25)" />
                <stop offset="100%" stopColor="rgba(255,69,58,0.3)" />
              </linearGradient>
            </defs>
            {/* Filled area under curve */}
            <path
              d={(() => {
                const pts = []
                for (let i = 0; i <= 100; i += 2) {
                  const y = curveY(i)
                  pts.push(`${(i / 100) * 400},${110 - y * 80}`)
                }
                return `M0,110 L${pts.join(' L')} L400,110 Z`
              })()}
              fill="url(#mshCurveGrad)"
            />
            {/* Curve line */}
            <path
              d={(() => {
                const pts = []
                for (let i = 0; i <= 100; i += 2) {
                  const y = curveY(i)
                  pts.push(`${(i / 100) * 400},${110 - y * 80}`)
                }
                return `M${pts.join(' L')}`
              })()}
              fill="none"
              stroke="url(#mshCurveStroke)"
              strokeWidth="1.5"
            />
          </svg>

          {/* Stage zone labels along bottom */}
          <div className="msh-curve-stages">
            {STAGE_ORDER.map((stage) => {
              const meta = STAGE_META[stage]
              const count = stageDistribution[stage]
              return (
                <div key={stage} className={`msh-curve-zone ${count > 0 ? 'active' : ''}`}>
                  <span className={`msh-curve-zone-label stage-${meta.color}`}>{meta.shortLabel}</span>
                </div>
              )
            })}
          </div>

          {/* Bubbles */}
          <div className="msh-curve-bubbles">
            {placedBubbles.map((b) => {
              const isActive = activeBubbleId === b.id
              const dimmed = (curveFilter && curveFilter !== b.stageLabel) || (isMobile && activeBubbleId && !isActive)
              return (
                <div
                  key={b.id}
                  className={`msh-bubble stage-${b.color} ${isTokenView ? 'has-logo' : ''}${b.labeled ? ' labeled' : ''}${dimmed ? ' dimmed' : ''}${(curveFilter === b.stageLabel || isActive) ? ' highlighted' : ''}`}
                  style={{
                    left: `${b.leftPx}px`,
                    top: `${b.topPx}px`,
                    width: `${b.size}px`,
                    height: `${b.size}px`,
                    cursor: 'pointer',
                  }}
                  title={`${b.name}${b.symbol ? ` (${b.symbol})` : ''} - ${b.stageLabel} - ${(b.avgChange || 0) >= 0 ? '+' : ''}${(b.avgChange || 0).toFixed(1)}%`}
                  onClick={() => {
                    if (isMobile) {
                      // Mobile keeps the detail-card flow so users can pick
                      // their target (Categories vs Research Zone vs Screener)
                      // explicitly via the buttons inside the modal.
                      setActiveBubbleId(prev => prev === b.id ? null : b.id)
                    } else if (!isTokenView) {
                      openCategoryPage(b)
                    } else {
                      // Tokens view: route to Research Zone (or AI Screener for
                      // small caps) using the same smart-fallback used by the
                      // mobile detail buttons.
                      openBubbleTarget(b)
                    }
                  }}
                >
                  {isMobile ? (
                    <>
                      {isTokenView && b.symbol && TOKEN_LOGOS[b.symbol] ? (
                        <TokenImg src={TOKEN_LOGOS[b.symbol]} symbol={b.symbol} alt="" className="msh-bubble-logo" />
                      ) : (
                        <span className="msh-bubble-label">{shortName(b.name)}</span>
                      )}
                      <span className={`msh-bubble-caption ${(b.avgChange || 0) >= 0 ? 'pos' : 'neg'}`}>
                        {(b.avgChange || 0) >= 0 ? '+' : ''}{(b.avgChange || 0).toFixed(1)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <div className={`msh-bubble-core stage-${b.color}`}>
                        {isTokenView && b.symbol && TOKEN_LOGOS[b.symbol] ? (
                          <TokenImg src={TOKEN_LOGOS[b.symbol]} symbol={b.symbol} alt="" className="msh-bubble-logo" />
                        ) : (
                          <span className="msh-bubble-initial">{isTokenView ? (b.symbol || bubbleCode(b.name)) : bubbleCode(b.name)}</span>
                        )}
                      </div>
                      {/* Notable bubbles keep an always-on chip; the rest reveal on hover. */}
                      <span className={`msh-bubble-meta${b.labeled ? '' : ' msh-bubble-meta--hover'}`}>
                        <span className="msh-bubble-name">{shortName(b.name)}</span>
                        <span className={`msh-bubble-delta ${(b.avgChange || 0) >= 0 ? 'pos' : 'neg'}`}>
                          {(b.avgChange || 0) >= 0 ? '+' : ''}{(b.avgChange || 0).toFixed(1)}%
                        </span>
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>

        </div>}

        {/* Mobile detail modal (works for stage-grid bubbles too) */}
        {isMobile && activeBubbleId && (() => {
          const b = placedBubbles.find((x) => x.id === activeBubbleId)
            || items.find((x) => x.id === activeBubbleId)
          if (!b || typeof document === 'undefined') return null
          const ch = b.avgChange || 0
          return createPortal(
            <div className={`msh-bubble-detail${dayMode ? ' is-day' : ''}`} onClick={() => setActiveBubbleId(null)}>
              <div className="msh-bubble-detail-card" onClick={(e) => e.stopPropagation()}>
                <div className="msh-bubble-detail-row">
                  <span
                    className="msh-bubble-detail-name"
                    style={!isTokenView ? { cursor: 'pointer' } : undefined}
                    onClick={!isTokenView ? () => { setActiveBubbleId(null); openCategoryPage(b) } : undefined}
                  >{b.name}</span>
                  <button
                    type="button"
                    className="msh-bubble-detail-close"
                    onClick={() => setActiveBubbleId(null)}
                    aria-label={t('homePage.mindshareTabPanel.mindsharetabpanel.ariaClose', "Close")}
                  >×</button>
                </div>
                <div className="msh-bubble-detail-stats">
                  <div className="msh-bubble-detail-stat">
                    <span className="msh-bubble-detail-label">24h</span>
                    <span className={`msh-bubble-detail-value ${ch >= 0 ? 'pos' : 'neg'}`}>{ch >= 0 ? '+' : ''}{ch.toFixed(2)}%</span>
                  </div>
                  <div className="msh-bubble-detail-stat">
                    <span className="msh-bubble-detail-label">{t('homePage.mindshareTabPanel.mindsharetabpanel.volume', "Volume")}</span>
                    <span className="msh-bubble-detail-value">{fmtVol(b.totalVolume)}</span>
                  </div>
                  <div className="msh-bubble-detail-stat">
                    <span className="msh-bubble-detail-label">{t('homePage.mindshareTabPanel.mindsharetabpanel.stage', "Stage")}</span>
                    <span className={`msh-bubble-detail-value stage-${b.color}`}>{b.stageLabel}</span>
                  </div>
                  <div className="msh-bubble-detail-stat">
                    <span className="msh-bubble-detail-label">{t('homePage.mindshareTabPanel.mindsharetabpanel.phase', "Phase")}</span>
                    <span className="msh-bubble-detail-value">{STAGE_META[b.stageLabel]?.desc || '-'}</span>
                  </div>
                </div>
                {(onOpenResearchZone || onOpenAIScreener) && (b.symbol || b.topMover) && (
                  <div className="msh-bubble-detail-actions">
                    {onOpenResearchZone && (
                      <button
                        type="button"
                        className="msh-bubble-detail-btn"
                        onClick={() => { openBubbleTarget(b, 'rz'); setActiveBubbleId(null) }}
                      >
                        {t('homePage.mindshareTabPanel.mindsharetabpanel.researchZone', "Research Zone")}
                      </button>
                    )}
                    {onOpenAIScreener && (
                      <button
                        type="button"
                        className="msh-bubble-detail-btn msh-bubble-detail-btn--primary"
                        onClick={() => { openBubbleTarget(b, 'screener'); setActiveBubbleId(null) }}
                      >
                        {t('homePage.mindshareTabPanel.mindsharetabpanel.aiScreener', "AI Screener")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )
        })()}

        {/* Curve legend - desktop only (mobile stage-grid rows are self-labeling) */}
        {!isMobile && <div className="msh-curve-legend">
          <div
            className={`msh-curve-legend-item clickable${curveFilter === null ? ' active' : ''}`}
            onClick={() => setCurveFilter(null)}
          >
            <span>{t('homePage.mindshareTabPanel.mindsharetabpanel.all', "All")}</span>
          </div>
          {STAGE_ORDER.map((stage) => {
            const meta = STAGE_META[stage]
            return (
              <div
                key={stage}
                className={`msh-curve-legend-item clickable${curveFilter === stage ? ' active' : ''}`}
                onClick={() => setCurveFilter(f => f === stage ? null : stage)}
              >
                <span className={`msh-curve-legend-abbr stage-${meta.color}`}>{meta.shortLabel}</span>
                <span>{meta.label}</span>
              </div>
            )
          })}
          <div className="msh-curve-legend-sep" />
          <span className="msh-curve-legend-hint">{isTokenView ? 'Bubble size = market cap' : 'Bubble size = volume'}</span>
        </div>}
      </div>

      {/* Spotlight Cards */}
      {spotlights.length > 0 && (
        <div className="msh-spotlights">
          {spotlights.map((s) => (
            <div
              key={s.type}
              className={`msh-spotlight type-${s.type}`}
              style={{ cursor: 'pointer' }}
              onClick={() => (isTokenView ? openBubbleTarget(s) : openCategoryPage(s))}
            >
              <div className="msh-spotlight-glow" />

              {/* Top row: icon + name + badge */}
              <div className="msh-spotlight-head">
                <div className="msh-spotlight-identity">
                  {isTokenView ? (
                    TOKEN_LOGOS[s.symbol || s.topMover] && (
                      <TokenImg src={TOKEN_LOGOS[s.symbol || s.topMover]} symbol={s.symbol || s.topMover} alt="" className="msh-spotlight-logo" />
                    )
                  ) : (
                    s.topMoverLogo && (
                      <img src={s.topMoverLogo} alt="" loading="lazy" decoding="async" width="20" height="20" className="msh-spotlight-logo" />
                    )
                  )}
                  <span className="msh-spotlight-name">{s.name}</span>
                </div>
                <span className="msh-spotlight-badge">{s.label}</span>
              </div>

              {/* Metrics row */}
              <div className="msh-spotlight-metrics">
                <span className={`msh-spotlight-change ${(s.avgChange || 0) >= 0 ? 'pos' : 'neg'}`}>
                  {(s.avgChange || 0) >= 0 ? '+' : ''}{(s.avgChange || 0).toFixed(1)}%
                </span>
                <div className="msh-spotlight-meta">
                  <span className={`msh-spotlight-stage stage-${s.color}`}>{s.stageLabel}</span>
                  <span className="msh-spotlight-sep" />
                  <span className="msh-spotlight-vol">
                    {isTokenView && s.price ? fmtPrice(s.price) : fmtVol(s.totalVolume)}
                  </span>
                </div>
              </div>

              {/* Momentum / Risk bar */}
              <div className="msh-spotlight-bar-track">
                <div
                  className={`msh-spotlight-bar-fill ${s.type === 'risk' ? 'neg' : 'pos'}`}
                  style={{ width: `${Math.min(s.type === 'risk' ? (s.riskScore || 0) : (s.momentumScore || Math.abs(s.avgChange || 0) / maxAbsChange * 100), 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Movers — sector top mover tokens with logos */}
      {!isTokenView && sectorItems.some(s => s.topMoverLogo) && (
        <div className="msh-movers">
          <div className="msh-movers-title">{t('homePage.mindshareTabPanel.mindsharetabpanel.topMoversBySector', "Top Movers by Sector")}</div>
          <div className="msh-movers-grid">
            {sectorItems.filter(s => s.topMover && s.topMoverLogo).slice(0, 12).map((s) => {
              const mChange = s.topMoverChange ?? 0
              const mPositive = mChange >= 0
              const handleMoverClick = () => {
                const sym = (s.topMover || '').toUpperCase()
                const tokenData = {
                  symbol: sym,
                  name: s.topMoverName || sym,
                  price: s.topMoverPrice ?? 0,
                  change: mChange,
                  logo: s.topMoverLogo,
                  token_id: s.topMoverId || null,
                  cgId: s.topMoverId || null,
                }
                // CoinGecko-listed (has token_id) or hardcoded major → RZ,
                // pure on-chain → AI Screener.
                if ((s.topMoverId || isMajorToken(sym)) && onOpenResearchZone) {
                  onOpenResearchZone(tokenData)
                  return
                }
                if (onOpenAIScreener) { onOpenAIScreener(tokenData); return }
                if (onOpenResearchZone) onOpenResearchZone(tokenData)
              }
              return (
                <button
                  type="button"
                  key={s.id}
                  className="msh-mover-chip"
                  onClick={handleMoverClick}
                >
                  <img src={s.topMoverLogo} alt="" loading="lazy" decoding="async" width="18" height="18" className="msh-mover-logo" />
                  <div className="msh-mover-info">
                    <span className="msh-mover-symbol">{s.topMover}</span>
                    <span className="msh-mover-sector">{shortName(s.name)}</span>
                  </div>
                  <span className={`msh-mover-change ${mPositive ? 'pos' : 'neg'}`}>
                    {mPositive ? '+' : ''}{mChange.toFixed(1)}%
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Momentum Matrix */}
      <div className="msh-matrix">
        <div className="msh-matrix-header">
          <span className="msh-matrix-title">{t('homePage.mindshareTabPanel.mindsharetabpanel.momentumMatrix', "Momentum Matrix")}</span>
          <span className="msh-matrix-sub">Relative strength across {isTokenView ? 'tokens' : 'narratives'}</span>
        </div>
        <div className="msh-matrix-grid">
          <div className="msh-matrix-col-headers">
            <span>{isTokenView ? 'Token' : 'Sector'}</span>
            {!isTokenView && hasApiData ? (
              <>
                <span
                  className={`msh-matrix-sort${matrixSortKey === 'momentum' ? ' sort-active' : ''}`}
                  onClick={() => handleMatrixSort('momentum')}
                >
                  Momentum
                  {matrixSortKey === 'momentum' && <span className="msh-matrix-sort-arrow">{matrixSortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
                </span>
                <span
                  className={`msh-matrix-sort${matrixSortKey === 'change' ? ' sort-active' : ''}`}
                  onClick={() => handleMatrixSort('change')}
                >
                  24h
                  {matrixSortKey === 'change' && <span className="msh-matrix-sort-arrow">{matrixSortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
                </span>
                <span
                  className={`msh-matrix-sort${matrixSortKey === 'vol' ? ' sort-active' : ''}`}
                  onClick={() => handleMatrixSort('vol')}
                >
                  Vol
                  {matrixSortKey === 'vol' && <span className="msh-matrix-sort-arrow">{matrixSortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
                </span>
                <span
                  className={`msh-matrix-sort${matrixSortKey === 'risk' ? ' sort-active' : ''}`}
                  onClick={() => handleMatrixSort('risk')}
                >
                  Risk
                  {matrixSortKey === 'risk' && <span className="msh-matrix-sort-arrow">{matrixSortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
                </span>
              </>
            ) : (
              <>
                <span>{t('homePage.mindshareTabPanel.mindsharetabpanel.strength', "Strength")}</span>
                <span
                  className={`msh-matrix-sort${matrixSortKey === 'change' ? ' sort-active' : ''}`}
                  onClick={() => handleMatrixSort('change')}
                >
                  24h
                  {matrixSortKey === 'change' && <span className="msh-matrix-sort-arrow">{matrixSortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
                </span>
                <span
                  className={`msh-matrix-sort${matrixSortKey === 'vol' ? ' sort-active' : ''}`}
                  onClick={() => handleMatrixSort('vol')}
                >
                  {isTokenView ? 'Price' : 'Vol'}
                  {matrixSortKey === 'vol' && <span className="msh-matrix-sort-arrow">{matrixSortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
                </span>
                <span
                  className={`msh-matrix-sort${matrixSortKey === 'last' ? ' sort-active' : ''}`}
                  onClick={() => handleMatrixSort('last')}
                >
                  {isTokenView ? 'Stage' : 'Top'}
                  {matrixSortKey === 'last' && <span className="msh-matrix-sort-arrow">{matrixSortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>}
                </span>
              </>
            )}
          </div>
          {sortedMatrixItems.map((n) => {
            const isPos = (n.avgChange || 0) >= 0
            const sym = n.symbol || n.topMover

            // API sectors view with momentum/risk scores
            if (!isTokenView && hasApiData) {
              return (
                <div key={n.id} className="msh-matrix-row">
                  <div className="msh-matrix-name">
                    <span className={`msh-matrix-dot stage-${n.color}`} />
                    <span className="msh-matrix-label">{n.name}</span>
                  </div>
                  <div className="msh-matrix-bar-cell">
                    <div className="msh-matrix-bar-track">
                      <div className="msh-matrix-bar-fill pos" style={{ width: `${n.momentumScore || 0}%` }} />
                    </div>
                  </div>
                  <span className={`msh-matrix-change ${isPos ? 'pos' : 'neg'}`}>
                    {isPos ? '+' : ''}{(n.avgChange || 0).toFixed(1)}%
                  </span>
                  <span className="msh-matrix-vol">{fmtVol(n.totalVolume)}</span>
                  <div className="msh-matrix-risk-cell">
                    <div className="msh-matrix-risk-track">
                      <div className={`msh-matrix-risk-fill ${(n.riskScore || 0) > 70 ? 'high' : (n.riskScore || 0) > 40 ? 'med' : 'low'}`} style={{ width: `${n.riskScore || 0}%` }} />
                    </div>
                  </div>
                </div>
              )
            }

            // Token view or fallback sectors view
            const pct = Math.abs(n.avgChange || 0) / maxAbsChange * 100
            return (
              <div key={n.id} className="msh-matrix-row">
                <div className="msh-matrix-name">
                  {isTokenView && sym && TOKEN_LOGOS[sym] ? (
                    <TokenImg src={TOKEN_LOGOS[sym]} symbol={sym} alt="" className="msh-matrix-token-logo" />
                  ) : (
                    <span className={`msh-matrix-dot stage-${n.color}`} />
                  )}
                  <span className="msh-matrix-label">{isTokenView ? sym : n.name}</span>
                </div>
                <div className="msh-matrix-bar-cell">
                  <div className="msh-matrix-bar-track">
                    {isPos ? (
                      <div className="msh-matrix-bar-fill pos" style={{ width: `${pct}%`, left: '50%' }} />
                    ) : (
                      <div className="msh-matrix-bar-fill neg" style={{ width: `${pct}%`, right: '50%' }} />
                    )}
                    <div className="msh-matrix-bar-zero" />
                  </div>
                </div>
                <span className={`msh-matrix-change ${isPos ? 'pos' : 'neg'}`}>
                  {isPos ? '+' : ''}{(n.avgChange || 0).toFixed(1)}%
                </span>
                <span className="msh-matrix-vol">
                  {isTokenView && n.price ? fmtPrice(n.price) : fmtVol(n.totalVolume)}
                </span>
                {!isTokenView && (
                  <div className="msh-matrix-mover">
                    {n.topMover && TOKEN_LOGOS[n.topMover] && (
                      <TokenImg src={TOKEN_LOGOS[n.topMover]} symbol={n.topMover} alt="" className="msh-matrix-mover-logo" />
                    )}
                    <span className="msh-matrix-mover-sym">{n.topMover}</span>
                  </div>
                )}
                {isTokenView && (
                  <span className={`msh-matrix-stage-pill stage-${n.color}`}>{n.stageLabel}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* AI Analysis */}
      {analysis && (
        <div className={`msh-analysis bias-${cycleSignal.bias}`}>
          <div className="msh-analysis-glow" />
          <div className="msh-analysis-header">
            <div className="msh-analysis-header-left">
              <span className="msh-analysis-pulse" />
              <span className="msh-analysis-title">{t('homePage.mindshareTabPanel.mindsharetabpanel.aiAnalysis', "AI Analysis")}</span>
            </div>
            <span className="msh-analysis-badge">{t('homePage.mindshareTabPanel.mindsharetabpanel.spectreAi', "Spectre AI")}</span>
          </div>
          <p className="msh-analysis-text">{analysis.cycleText}</p>

          <div className="msh-analysis-cards">
            <div className="msh-analysis-card">
              <div className="msh-analysis-card-accent" />
              <div className="msh-analysis-card-content">
                <div className="msh-analysis-card-title">{isTokenView ? 'Token Momentum' : 'Narrative Momentum'}</div>
                <p className="msh-analysis-card-text">{analysis.momentumText}</p>
              </div>
            </div>

            <div className="msh-analysis-card">
              <div className="msh-analysis-card-accent" />
              <div className="msh-analysis-card-content">
                <div className="msh-analysis-card-title">{t('homePage.mindshareTabPanel.mindsharetabpanel.opportunityMap', "Opportunity Map")}</div>
                <p className="msh-analysis-card-text">{analysis.opportunityText}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      </>)}
    </div>
  )
}

export default memo(MindshareTabPanel)
