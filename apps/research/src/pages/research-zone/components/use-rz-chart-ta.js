/**
 * use-rz-chart-ta — the Research Zone chart's TA layer.
 *
 * Owns three things:
 *   • the armed tool (highlight / draw)
 *   • the drawings (user-drawn, pattern-matched, and agent-drawn)
 *   • turning a selection into a GROUNDED brief and handing it to the agent
 *
 * Drawings are anchored in data space and persisted per symbol, so they survive
 * a pan, a zoom, a timeframe switch and a page reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildChartTaBrief, normalizeBars } from '@/lib/chart-ta-brief'
import { stampRzWrite } from '@/services/rzLocalStorage'
import { fetchSeriesBars } from '../hooks/use-kline-indicators'

// Codex resolutions, in minutes. A read has to be taken at a resolution that
// actually covers the window being read.
const RES_LADDER = [1, 5, 15, 30, 60, 240, 720, 1440, 10080]
const TARGET_BARS = 300

/**
 * 🪤🪤 The bars API does NOT speak minutes end-to-end. Intraday resolutions are
 * minute strings ('1'…'720') but daily and weekly are TOKENS ('1D', '1W').
 * Passing '1440' / '10080' is not an error — it silently falls back to hourly,
 * while the label map still prints "1W". That is how a 20-hour window of hourly
 * candles came back labelled "1W · 500 bars". Minutes stay the internal unit;
 * this is the only place they cross into the API's vocabulary.
 */
const RES_TOKEN = { 1: '1', 5: '5', 15: '15', 30: '30', 60: '60', 240: '240', 720: '720', 1440: '1D', 10080: '1W' }
const resToken = (minutes) => RES_TOKEN[Number(minutes)] || '60'

/**
 * 🪤 The resolution CANNOT come from the chart's timeframe setting when the
 * window is chosen by the user. On TradingView the visible range is whatever
 * the user has scrolled to — ask for two years while fetching 400 bars at the
 * app's 1H setting and you silently read the last SIXTEEN DAYS, then draw its
 * levels across a two-year axis where they compress into an unreadable band.
 * Pick the resolution from the span instead, and never go finer than the chart
 * is already showing.
 */
function resolutionForSpan(spanMs, chartResMin) {
  const floor = Number(chartResMin) || 60
  if (!Number.isFinite(spanMs) || spanMs <= 0) return { resolution: String(floor), barCount: 400 }
  const spanMin = spanMs / 60_000
  const ideal = spanMin / TARGET_BARS
  let pick = RES_LADDER[RES_LADDER.length - 1]
  for (const r of RES_LADDER) { if (r >= ideal) { pick = r; break } }
  let res = Math.max(floor, pick)
  // …but never so coarse that the window collapses to a handful of bars. A
  // 5-bar read is not a read; step back down the ladder until the window holds
  // at least MIN_BARS, which is what makes zooming IN work.
  const MIN_BARS = 40
  while (spanMin / res < MIN_BARS) {
    const i = RES_LADDER.indexOf(res)
    if (i <= 0) break
    res = RES_LADDER[i - 1]
  }
  // Enough bars to cover the window, with headroom for the indicator warm-ups.
  const barCount = Math.min(1200, Math.max(120, Math.ceil(spanMin / res) + 60))
  return { resolution: String(res), barCount }
}

function fmtLevel(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return Math.round(v).toLocaleString('en-US')
  if (a >= 1) return v.toFixed(2)
  return v.toPrecision(3)
}

const lsKey = (sym) => `spectre-rz-ta-draw:v1:${String(sym || '').toUpperCase()}`
const MAX_DRAWINGS = 40

function loadDrawings(sym) {
  if (!sym) return []
  try {
    const raw = localStorage.getItem(lsKey(sym))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(0, MAX_DRAWINGS) : []
  } catch { return [] }
}

function saveDrawings(sym, list) {
  if (!sym) return
  try { localStorage.setItem(lsKey(sym), JSON.stringify(list.slice(0, MAX_DRAWINGS))) } catch { /* quota */ }
  stampRzWrite(`draw:${String(sym).toUpperCase()}`)
}

export default function useRzChartTa({ symbol, chartRef, price, onAskAgent }) {
  const [taMode, setTaMode] = useState('off')
  const [selection, setSelection] = useState(null)
  const [userDrawings, setUserDrawings] = useState([])
  // Pattern-matched + agent-drawn lines. Kept apart from the user's own so
  // "Clear AI lines" never deletes something the user drew by hand.
  const [autoDrawings, setAutoDrawings] = useState([])
  const [revealKey, setRevealKey] = useState(0)
  const [analysis, setAnalysis] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const onAskAgentRef = useRef(onAskAgent)
  onAskAgentRef.current = onAskAgent
  // 🪤 `price` is the LIVE price — it ticks. Reading it through a ref keeps
  // analyze() (and therefore onTaSelectionChange) referentially stable; when
  // it was a dependency, every tick produced a new callback, which tore down
  // and re-armed TradingView's drawing tool mid-drag and made the highlight
  // gesture impossible to complete.
  const priceRef = useRef(price)
  priceRef.current = price
  const askTimerRef = useRef(null)
  useEffect(() => () => { if (askTimerRef.current) clearTimeout(askTimerRef.current) }, [])

  // Per-symbol load. Everything token-scoped resets together — carrying a
  // previous token's trendlines onto a new chart is the frankenrow class.
  useEffect(() => {
    setUserDrawings(loadDrawings(symbol))
    setAutoDrawings([])
    setSelection(null)
    setAnalysis(null)
    setAnalysisError(null)
    setTaMode('off')
  }, [symbol])

  const persist = useCallback((next) => {
    setUserDrawings(next)
    saveDrawings(symbol, next)
  }, [symbol])

  const drawings = useMemo(
    () => [...autoDrawings, ...userDrawings],
    [autoDrawings, userDrawings],
  )

  const [analyzing, setAnalyzing] = useState(false)

  /**
   * Build the brief for a window and hand it to the agent.
   *
   * Async because the TradingView engine does not populate the parent's bars
   * (it runs its own datafeed), so a TA read there has to pull the series
   * itself — through the SAME module-cached fetcher the Technicals tab uses,
   * which means it is usually already warm and never double-pays.
   */
  const analyze = useCallback(async (region) => {
    const ctx = chartRef?.current?.getTaContext?.()
    const span = (Number.isFinite(region?.fromTs) && Number.isFinite(region?.toTs))
      ? region.toTs - region.fromTs
      : null
    const { resolution, barCount } = resolutionForSpan(span, ctx?.resolution)
    // Re-fetch when the parent has no bars (TradingView runs its own datafeed)
    // OR when the window needs a coarser resolution than the bars we hold.
    let bars = normalizeBars(ctx?.bars)
    const needCoarser = span != null && Number(resolution) > (Number(ctx?.resolution) || 60)
    if ((bars.length < 8 || needCoarser) && ctx?.fetchParams?.symbol) {
      setAnalyzing(true)
      try {
        const fetched = await fetchSeriesBars({ ...ctx.fetchParams, resolution: resToken(resolution), barCount })
        const norm = normalizeBars(fetched)
        if (norm.length >= 8) bars = norm
      } catch { /* fall through to whatever we already had */ }
      setAnalyzing(false)
    }
    if (bars.length < 8) {
      setAnalysisError('Not enough bars to read this chart yet. Give it a moment, or pick a longer timeframe.')
      return null
    }
    const brief = buildChartTaBrief(bars, region, {
      symbol,
      resolution,
      price: priceRef.current,
    })
    if (!brief.ok) {
      setAnalysisError(brief.reason === 'window_too_small'
        ? 'That selection covers fewer than 3 candles — drag a wider window.'
        : 'Not enough bars in this window to analyse honestly.')
      return null
    }
    setAnalysisError(null)
    setAnalysis(brief)
    // The matched geometry is drawn immediately — the agent's own lines land
    // later, when its ```draw block finishes streaming.
    setAutoDrawings(brief.drawings)
    setRevealKey(k => k + 1)
    // Draw first, then speak. Firing both at once meant the chat started
    // typing while the lines were still sweeping in, and the two competed —
    // the sequence should read measure → draw → read.
    const t = setTimeout(() => onAskAgentRef.current?.(brief.prompt, brief), 620)
    askTimerRef.current = t
    return brief
  }, [chartRef, symbol])

  /** Analyse everything currently on screen (the "or all" path). */
  const analyzeVisible = useCallback(() => {
    const ctx = chartRef?.current?.getTaContext?.()
    // TradingView frames its own window, so it reports the range directly;
    // the canvas chart hands back the bars it actually painted.
    let region = ctx?.visibleRange || null
    if (!region) {
      const visible = normalizeBars(ctx?.visible)
      region = visible.length >= 3
        ? { fromTs: visible[0].t, toTs: visible[visible.length - 1].t }
        : {}
    }
    setSelection(null)
    setTaMode('off')
    return analyze(region)
  }, [chartRef, analyze])

  /** Chart callback: null clears, 'analyze' commits and runs. */
  const onTaSelectionChange = useCallback((region, action) => {
    if (!region) { setSelection(null); return }
    setSelection(region)
    if (action === 'analyze') {
      setTaMode('off')
      analyze(region)
    }
  }, [analyze])

  const onTaDrawingAdd = useCallback((d) => {
    if (!d) return
    persist([...userDrawings, d].slice(-MAX_DRAWINGS))
  }, [persist, userDrawings])

  /**
   * Merge the agent's own ```draw block onto the chart.
   *
   * The agent is fed the matcher's levels, so it quotes them back — which
   * drew every line twice at the same price. A repeat is not noise, it is the
   * agent CONFIRMING a measured level, so we collapse the pair into one line
   * rendered at full strength and let the agent's wording name it. Only levels
   * the agent found on its own get a new line.
   */
  const setAgentDrawings = useCallback((aiList) => {
    if (!Array.isArray(aiList) || !aiList.length) return
    // 0.3% — the agent re-quotes a level after its own rounding, and a
    // neckline it reads off the chart lands a few dollars from the measured
    // one. Anything closer than this is the same line to a human eye.
    const SAME = 0.003
    // A pattern neckline is stored as a (near-horizontal) trendline, so an
    // hline-vs-hline comparison alone missed it and drew the level twice.
    const levelOf = (d) => {
      if (d.tool === 'hline') return Number.isFinite(d.price) ? d.price : null
      const a = d.a?.price, b = d.b?.price
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null
      const flat = Math.abs(a - b) / Math.max(1e-9, Math.abs(a)) < 0.005
      return flat ? (a + b) / 2 : null
    }
    setAutoDrawings(prev => {
      const merged = prev.filter(d => d.source === 'pattern').map(p => ({ ...p }))
      const fresh = []
      const claimed = []
      for (const ai of aiList.slice(0, 6)) {
        const lvl = levelOf(ai)
        if (lvl == null) { fresh.push(ai); continue }
        const near = (v) => v != null && Math.abs(v - lvl) / Math.max(1e-9, Math.abs(lvl)) < SAME
        if (claimed.some(near)) continue // the agent listed the same level twice
        claimed.push(lvl)
        const hit = merged.find(p => near(levelOf(p)))
        if (hit) {
          hit.confirmed = true
          if (ai.label) hit.label = ai.label
          continue
        }
        fresh.push(ai)
      }
      return [...merged, ...fresh]
    })
    setRevealKey(k => k + 1)
  }, [])

  // ── Play mode ────────────────────────────────────────────────────────────
  // The agent takes the wheel: zoom to the pattern it found, then walk the
  // levels one at a time. This is the feature for someone who cannot read a
  // chart yet — it does not describe the structure, it SHOWS it.
  const [play, setPlay] = useState(null)   // { beats, i } | null
  const playTimerRef = useRef(null)

  const buildBeats = useCallback((brief) => {
    if (!brief?.ok) return []
    const beats = []
    const { stats, patterns = [], supports = [], resistances = [] } = brief
    const span = stats.toTs - stats.fromTs

    beats.push({
      title: `${stats.tfLabel} · ${stats.durationLabel}`,
      body: `${stats.bars} bars, ${stats.changePct >= 0 ? 'up' : 'down'} ${Math.abs(stats.changePct).toFixed(1)}% across the window.`,
      range: { fromTs: stats.fromTs, toTs: stats.toTs },
    })

    for (const p of patterns.slice(0, 2)) {
      if (!Number.isFinite(p.startTs) || !Number.isFinite(p.endTs)) continue
      beats.push({
        title: p.name,
        body: p.note || p.definition,
        // Zoom to the pattern itself, with context either side.
        range: { fromTs: p.startTs - span * 0.08, toTs: p.endTs + span * 0.08 },
      })
      if (Number.isFinite(p.target)) {
        beats.push({
          title: 'If it confirms',
          body: `${p.confirmation} Measured target ${fmtLevel(p.target)}.`,
          range: { fromTs: p.startTs - span * 0.05, toTs: stats.toTs },
        })
      }
      if (Number.isFinite(p.invalidation)) {
        beats.push({
          title: 'What would make it wrong',
          body: p.invalidation != null ? `${p.invalidationNote || 'Invalidated at'} ${fmtLevel(p.invalidation)} — above that, the read is off.` : p.invalidation,
          range: { fromTs: stats.fromTs, toTs: stats.toTs },
        })
      }
    }

    const nearR = resistances[0]
    const nearS = supports[0]
    if (nearR || nearS) {
      beats.push({
        title: 'The levels that matter',
        body: [
          nearR ? `Resistance ${fmtLevel(nearR.low)}–${fmtLevel(nearR.high)} (${nearR.touches} touch${nearR.touches === 1 ? '' : 'es'})` : null,
          nearS ? `Support ${fmtLevel(nearS.low)}–${fmtLevel(nearS.high)} (${nearS.touches} touch${nearS.touches === 1 ? '' : 'es'})` : null,
        ].filter(Boolean).join(' · '),
        range: { fromTs: stats.fromTs, toTs: stats.toTs },
      })
    }
    return beats
  }, [])

  const stopPlay = useCallback(() => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current)
    playTimerRef.current = null
    setPlay(null)
  }, [])

  const goToBeat = useCallback((beats, i) => {
    if (i < 0 || i >= beats.length) { stopPlay(); return }
    setPlay({ beats, i })
    const b = beats[i]
    if (b?.range) chartRef?.current?.focusRange?.(b.range)
    if (playTimerRef.current) clearTimeout(playTimerRef.current)
    // Long enough to read the caption, short enough to keep momentum.
    playTimerRef.current = setTimeout(() => goToBeat(beats, i + 1), 4200)
  }, [chartRef, stopPlay])

  const startPlay = useCallback(() => {
    const beats = buildBeats(analysis)
    if (!beats.length) return
    goToBeat(beats, 0)
  }, [analysis, buildBeats, goToBeat])

  const nextBeat = useCallback(() => { if (play) goToBeat(play.beats, play.i + 1) }, [play, goToBeat])
  const prevBeat = useCallback(() => { if (play) goToBeat(play.beats, play.i - 1) }, [play, goToBeat])

  useEffect(() => () => { if (playTimerRef.current) clearTimeout(playTimerRef.current) }, [])

  const clearDrawings = useCallback((scope = 'all') => {
    if (scope === 'user' || scope === 'all') persist([])
    if (scope === 'auto' || scope === 'all') setAutoDrawings([])
    if (scope === 'all') { setSelection(null); setAnalysis(null); setAnalysisError(null); stopPlay() }
    // On TradingView the lines are TV shapes, not our canvas — emptying the
    // arrays is not enough, they have to be removed from the widget too.
    chartRef?.current?.clearTaShapes?.()
  }, [persist, chartRef, stopPlay])

  const undoDrawing = useCallback(() => {
    if (!userDrawings.length) return
    persist(userDrawings.slice(0, -1))
  }, [persist, userDrawings])

  // Toggle semantics: tapping the armed tool disarms it. Leaving select mode
  // drops the marquee, because a selection with no way to act on it is litter.
  const setTool = useCallback((mode) => {
    setTaMode(prev => {
      const next = prev === mode ? 'off' : mode
      if (next !== 'select') queueMicrotask(() => setSelection(null))
      return next
    })
  }, [])

  return {
    taMode,
    setTool,
    selection,
    drawings,
    userDrawings,
    autoDrawings,
    revealKey,
    analysis,
    analysisError,
    onTaSelectionChange,
    onTaDrawingAdd,
    setAgentDrawings,
    clearDrawings,
    undoDrawing,
    analyzeVisible,
    analyzing,
    play, startPlay, stopPlay, nextBeat, prevBeat,
    canPlay: !!analysis?.ok,
    hasDrawings: drawings.length > 0,
  }
}
