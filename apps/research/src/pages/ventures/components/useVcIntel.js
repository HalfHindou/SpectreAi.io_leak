/**
 * useVcIntel — fetches the AI Analyst thesis + the fund's live X posts for a VC
 * from /api/ventures/intel (Groq, fed by portfolio + their tweets). Module-cached
 * per fund so re-selecting is instant; the server caches the thesis 6h.
 */
import { useState, useEffect, useRef } from 'react'
import { analyzeVc } from './smu-vc-analyst'
import { handleForVc } from './vc-handles'

const _cache = new Map() // vcId -> { thesis, tweets, handle, model }
const _inflight = new Map()

function buildPayload(entity, priceMap) {
  const a = analyzeVc(entity, priceMap)
  return {
    vc: entity.id,
    name: entity.name,
    type: entity.type,
    aum: entity.aum_estimate || null,
    sectors: a?.mix?.map((m) => m.label) || [],
    tokens: (entity.known_portfolio_tokens || []).slice(0, 12),
    companies: (entity.known_portfolio_companies || []).slice(0, 12),
    focus: entity.recent_focus_2026 || [],
    handle: handleForVc(entity.id),
    momentum: a?.momentum ?? null,
  }
}

export default function useVcIntel(entity, priceMap, ready = true) {
  const [state, setState] = useState(() => (entity && _cache.has(entity.id)
    ? { ..._cache.get(entity.id), loading: false, error: null }
    : { thesis: '', tweets: [], handle: null, model: null, loading: !!entity, error: null }))

  // Keep a ref to the latest priceMap so we build the payload with fresh prices
  // without re-firing the request on every 30s tick.
  const priceRef = useRef(priceMap)
  priceRef.current = priceMap

  const vcId = entity?.id || null

  useEffect(() => {
    if (!vcId || !entity) return undefined
    // Wait for live prices before generating - an early request fingerprints
    // as momentum:na and the server caches that weak thesis for 6h.
    if (!ready) return undefined
    if (_cache.has(vcId)) {
      setState({ ..._cache.get(vcId), loading: false, error: null })
      return undefined
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null, thesis: '', tweets: [] }))

    const run = _inflight.get(vcId) || (async () => {
      try {
        const res = await fetch('/api/ventures/intel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload(entity, priceRef.current)),
        })
        if (!res.ok) throw new Error(`intel ${res.status}`)
        const json = await res.json()
        const data = { thesis: json.thesis || '', tweets: json.tweets || [], handle: json.handle || null, model: json.model || null }
        if (data.thesis || data.tweets.length) _cache.set(vcId, data)
        return data
      } finally {
        _inflight.delete(vcId)
      }
    })()
    _inflight.set(vcId, run)

    run.then((data) => { if (!cancelled) setState({ ...data, loading: false, error: null }) })
      .catch((e) => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.message })) })

    return () => { cancelled = true }
  }, [vcId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}
