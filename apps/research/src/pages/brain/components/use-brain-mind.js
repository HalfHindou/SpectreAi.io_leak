/**
 * useBrainMind — "The Read" data for the Eagle-Eye Brain terminal.
 *
 * One hook, three high-value backend feeds, normalized into the Brain's current
 * mind: its synthesized market view (state-of-mind), the regime + macro context
 * (dashboard), and — the differentiator aixbt has no answer to — its OWN proven
 * accuracy (grades-v2 scorecard). Visibility-gated 60s poll, per-endpoint
 * failure isolation (one dead feed never blanks the read).
 *
 * Reaches the data-api via Pattern A (/data-api/v1/brain/*) so multi-segment
 * paths pass through un-encoded (the /api/brain/* proxy percent-encodes slashes).
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const BASE = '/data-api/v1/brain'
const POLL_MS = 60_000

const STANCE_LABEL = {
  strong_bull: 'Strong Bull',
  lean_bull: 'Lean Bull',
  neutral: 'Neutral',
  lean_bear: 'Lean Bear',
  strong_bear: 'Strong Bear',
}
const STANCE_TONE = {
  strong_bull: 'bull',
  lean_bull: 'bull',
  neutral: 'neutral',
  lean_bear: 'bear',
  strong_bear: 'bear',
}
const CLOCKS = ['pulse', 'wave', 'tide', 'ocean']
const CLOCK_LABEL = { pulse: 'Pulse', wave: 'Wave', tide: 'Tide', ocean: 'Ocean' }
const CLOCK_HORIZON = { pulse: '5m', wave: '1h', tide: '6h', ocean: '24h' }

async function getJson(path, timeoutMs = 15000) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const j = await r.json()
    return j?.data ?? j
  } catch {
    return null
  }
}

function tierPayload(tier) {
  if (!tier || typeof tier !== 'object') return null
  return tier.payload && typeof tier.payload === 'object' ? tier.payload : tier
}
function tierStance(tier) {
  const p = tierPayload(tier)
  return p?.stance || null
}
function stanceArrow(s) {
  if (!s) return '·'
  if (s.includes('bull')) return '↑'
  if (s.includes('bear')) return '↓'
  return '→'
}
function firstSentences(text, n = 2) {
  if (typeof text !== 'string' || !text.trim()) return null
  const parts = text.trim().replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g)
  if (!parts) return text.trim().slice(0, 220)
  return parts.slice(0, n).join(' ').trim()
}
function extractFlip(verdict) {
  if (typeof verdict !== 'string') return null
  const m = verdict.match(/(?:we\s+)?(?:flip[s]?|turn[s]?|invalidat\w+)\b[^.]*\bif\b[^.]*[.]/i)
  return m ? m[0].trim() : null
}
// Coerce a possibly-structured field ({claim, evidence, ...}) to a string —
// several brain fields (thesis, highest_conviction_thesis) are objects.
function textOf(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') return v.claim || v.summary || v.headline || v.text || null
  return null
}

export default function useBrainMind() {
  const [state, setState] = useState({
    loading: true,
    error: false,
    read: null,
    clocks: [],
    coherent: null,
    hitRate: null,
    macroEvents: [],
    updatedAt: null,
    lastOkAt: null,
  })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    const [mind, dash, grades] = await Promise.all([
      getJson('/state-of-mind'),
      getJson('/dashboard'),
      getJson('/grades-v2/scorecard?days=30'),
    ])
    if (cancelled.current) return
    if (!mind && !dash) {
      // grades succeeding still proves the engine answered — record the evidence
      setState((s) => ({ ...s, loading: false, error: true, lastOkAt: grades ? Date.now() : s.lastOkAt }))
      return
    }

    const conv = mind?.latest_conviction || {}
    const synth = mind?.synthesis || {}
    const oceanP = tierPayload(synth.ocean) || {}
    const stance = conv.market_stance || tierStance(synth.ocean) || 'neutral'

    const clocks = CLOCKS.map((t) => {
      const st = tierStance(synth[t])
      return {
        tier: t,
        label: CLOCK_LABEL[t],
        horizon: CLOCK_HORIZON[t],
        stance: st,
        arrow: stanceArrow(st),
        tone: STANCE_TONE[st] || 'neutral',
      }
    })
    const known = clocks.filter((c) => c.stance)
    const coherent =
      mind?.stance_coherence?.coherent ??
      (known.length ? known.every((c) => c.tone === known[0].tone) : null)

    // The edge: proven accuracy. Prefer graded convictions, fall back to paper trades.
    let hitRate = null
    if (grades?.overall?.hit_rate_pct != null && grades.overall.n) {
      hitRate = { pct: Math.round(grades.overall.hit_rate_pct), n: grades.overall.n, source: 'graded calls', days: 30 }
    } else if (dash?.hit_rate?.hit_rate_pct != null) {
      hitRate = { pct: Math.round(dash.hit_rate.hit_rate_pct), n: dash.hit_rate.sample_size || dash.hit_rate.n, source: 'closed trades', days: 30 }
    }

    const read = {
      stance,
      stanceLabel: STANCE_LABEL[stance] || stance,
      tone: STANCE_TONE[stance] || 'neutral',
      regime: dash?.regime?.label || mind?.live_snapshot?.regime || null,
      conviction: conv.confidence != null ? Math.round(Number(conv.confidence)) : (oceanP.confidence != null ? Math.round(Number(oceanP.confidence)) : null),
      risk: conv.risk_level || null,
      thesis: textOf(conv.thesis) || oceanP.headline || textOf(oceanP.highest_conviction_thesis) || oceanP.summary_280 || firstSentences(conv.verdict, 2),
      flip: (typeof conv.what_would_falsify === 'string' ? conv.what_would_falsify : null)
        || (conv.thesis && typeof conv.thesis === 'object' ? conv.thesis.what_would_falsify : null)
        || (oceanP.highest_conviction_thesis && oceanP.highest_conviction_thesis.what_would_falsify)
        || (typeof oceanP.what_would_falsify === 'string' ? oceanP.what_would_falsify : null)
        || extractFlip(conv.verdict) || null,
      catalysts: Array.isArray(conv.catalysts) ? conv.catalysts.slice(0, 3) : [],
      calibrated: !!conv.calibration || !!oceanP._calibration,
    }

    setState({
      loading: false,
      error: false,
      read,
      clocks,
      coherent,
      hitRate,
      macroEvents: (dash?.macro_events_7d || []).slice(0, 4),
      // Data age comes from the payload's own timestamp or nowhere — a missing
      // generated_at must never be replaced with "now" (it renders as "just now"
      // over data of unknown age).
      updatedAt: mind?.generated_at || dash?.generated_at || null,
      lastOkAt: Date.now(),
    })
  }, [])

  useEffect(() => {
    cancelled.current = false
    load()
    const timer = setInterval(() => {
      if (!document.hidden) load()
    }, POLL_MS)
    const onVis = () => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled.current = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  return { ...state, refetch: load }
}
