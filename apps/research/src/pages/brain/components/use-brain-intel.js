/**
 * useBrainIntel — the INTERPRETED market intel (aixbt-grade), not raw signals.
 *
 * Source: /v1/social/thesis — the Brain's synthesized read of the tape:
 *   market_thesis  — the paragraph briefing (what matters + why)
 *   convergence    — conviction plays where social + capital + news align
 *   smart_money    — labeled institutional flows with a read
 *   sectors        — which sectors are heating + the tokens driving them
 *   blowups        — froth collapsing (roi since tracked)
 *   big_accounts   — who's pushing what
 * This is the "so what", not the "what happened". Polls slowly (thesis is
 * regenerated on a cadence), visibility-gated.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const BASE = '/data-api/v1'
const POLL_MS = 5 * 60_000

async function getJson(path, timeoutMs = 15000) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const j = await r.json()
    return { root: j?.data ?? j, meta: j?.meta || null }
  } catch {
    return null
  }
}
const arr = (v) => (Array.isArray(v) ? v : [])

export default function useBrainIntel() {
  const [state, setState] = useState({ loading: true, error: false, data: null, updatedAt: null, stale: false })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    const res = await getJson('/social/thesis?scope=combined')
    if (cancelled.current) return
    const t = res?.root
    if (!t || (!t.market_thesis && !arr(t.convergence).length && !arr(t.smart_money).length)) {
      setState((s) => ({ ...s, loading: false, error: !t }))
      return
    }
    setState({
      loading: false,
      error: false,
      stale: !!res?.meta?.stale,
      updatedAt: t.generated_at || null,
      data: {
        marketThesis: t.market_thesis || null,
        regime: t.regime || null,
        convergence: arr(t.convergence).filter((x) => x && x.asset).slice(0, 6),
        smartMoney: arr(t.smart_money).filter((x) => x && x.asset).slice(0, 6),
        sectors: arr(t.sectors).filter((x) => x && x.sector).slice(0, 5),
        bigAccounts: arr(t.big_accounts).filter((x) => x && x.handle).slice(0, 6),
        blowups: arr(t.blowups).filter((x) => x && x.symbol).slice(0, 6),
      },
    })
  }, [])

  useEffect(() => {
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
  }, [load])

  return { ...state, refetch: load }
}
