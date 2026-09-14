/**
 * useBrainDesk — the market-consciousness intel (lens-agent narratives).
 *
 * Reads the desk output: a regime line, a synthesized brief, and the intel
 * table where every row is interpreted through an investor lens
 * (Onchain / Institutional / Leverage / Degen / Macro) with a bias + category.
 *
 * Source order (freshest wins):
 *  1. /data-api/v1/brain/desk — the ENGINE brain: the `brain-desk-generator`
 *     pm2 worker on the data-api box, regenerating every 10 min 24/7 with the
 *     graded outcome ledger (`brain_desk_calls`) fed back into its context.
 *  2. /api/brain-desk — serverless fallback generation (same desk-core).
 *  3. /brain-desk.json — static dev-loop snapshot.
 * Visibility-gated poll.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const POLL_MS = 5 * 60_000
const ENGINE_FRESH_MS = 45 * 60_000

async function getJson(url, ms = 15000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export default function useBrainDesk({ enabled = true } = {}) {
  const [state, setState] = useState({ loading: true, error: false, regime: null, simple: null, brief: [], intel: [], convergence: [], ideas: [], lensScoreboard: [], context: null, watching: [], scorecard: null, dataHealth: null, marketPulse: null, chartReads: null, updatedAt: null, source: null, lastOkAt: null })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    // 1. engine brain (data-api worker) — accept only if fresh
    let d = null
    let src = null
    let okAt = null
    const eng = await getJson('/data-api/v1/brain/desk')
    if (eng) okAt = Date.now()
    const engData = eng?.data || eng
    const engTs = Date.parse(engData?.generatedAt || engData?.generated_at || 0)
    if (engData?.regime && engTs && Date.now() - engTs < ENGINE_FRESH_MS) { d = engData; src = 'engine' }
    // 2/3. serverless generation, then the static dev snapshot. The static file
    // is served from OUR OWN bundle — fetching it proves nothing about the
    // engine, so it never counts as connection evidence and it carries an
    // explicit provenance so the header can say "cached snapshot".
    if (!d) {
      const sv = await getJson('/api/brain-desk')
      if (sv) { okAt = Date.now(); d = sv; src = 'serverless' }
    }
    if (!d || (!d.intel?.length && !d.convergence?.length)) {
      const st = await getJson('/brain-desk.json')
      if (st) { d = st; src = 'static' }
    }
    if (cancelled.current) return
    if (!d || !Array.isArray(d.intel)) {
      setState((s) => ({ ...s, loading: false, error: true, lastOkAt: okAt || s.lastOkAt }))
      return
    }
    setState((s) => ({
      loading: false,
      error: false,
      regime: d.regime || null,
      simple: d.simple && typeof d.simple === 'object' ? d.simple : null,
      brief: Array.isArray(d.brief) ? d.brief : [],
      intel: d.intel,
      convergence: Array.isArray(d.convergence) ? d.convergence : [],
      ideas: Array.isArray(d.ideas) ? d.ideas : [],
      lensScoreboard: Array.isArray(d.lens_scoreboard) ? d.lens_scoreboard : [],
      context: d.context || null,
      watching: Array.isArray(d.watching) ? d.watching : [],
      scorecard: d.scorecard || null,
      dataHealth: d.data_health || null,
      marketPulse: d.market_pulse && typeof d.market_pulse === 'object' ? d.market_pulse : null,
      chartReads: d.chart_reads && typeof d.chart_reads === 'object' ? d.chart_reads : null,
      updatedAt: d.generatedAt || d.generated_at || null,
      source: src,
      lastOkAt: okAt || s.lastOkAt,
    }))
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    cancelled.current = false
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled.current = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, enabled])

  return { ...state, refetch: load }
}
