/**
 * useDossier — shared cached fetch for the /api/dossier payload.
 *
 * Both AIIntelligenceCard and VitalsBento consume the dossier data. To
 * avoid a duplicate 30s poll per consumer, this hook maintains a single
 * module-level cache keyed by `{chain}:{ca}` and shares the in-flight
 * promise across mounts.
 *
 * Until the §II.9 backend addition lands, `data.holders?.history14d`
 * and `data.holders?.top10Pct` will be undefined — both components
 * gracefully degrade.
 */

import { useEffect, useState } from 'react'
import { isAppActive } from '../lib/idleManager'

// 2026-06-03 COST WAR HARD-DISABLE. 2026-06-08 REVIVED: per-token dossier relocated
// from moneth2 (full disk) to monsol -> srv.spectreai.io. Background workers OFF
// (structurally no startWorkers), on-demand enrich-once, 7-day TTL = no Codex bleed.
// Requires Vercel env VITE_DOSSIER_API=https://srv.spectreai.io.
const KILL_OVH_DOSSIER = false
const API = (KILL_OVH_DOSSIER ? '' : (import.meta.env.VITE_DOSSIER_API || '')) + '/api/dossier'
const TTL = 30_000

const _cache = new Map()        // { 'chain:ca' → { data, ts } }
const _inflight = new Map()     // { 'chain:ca' → Promise }
const _subscribers = new Map()  // { 'chain:ca' → Set<setData> }

function chainOf(networkId) {
  const nid = Number(networkId)
  if (nid === 1) return 'eth'
  if (nid === 8453) return 'base'
  if (nid === 42161) return 'arb'
  if (nid === 137) return 'poly'
  if (nid === 56) return 'bsc'
  if (nid === 1399811149) return 'sol'
  // Robinhood Chain (4663) deliberately returns null: the dossier upstream
  // does not index it. Probed 2026-07-23 - base/arb/poly/bsc/sol all 200,
  // while `robinhood` (and `hood`) answer 400 "invalid chain or ca". It was
  // opened up optimistically on the assumption the upstream would follow, so
  // every Robinhood token page fired two failing requests per mount and the
  // panel showed an error instead of the honest empty state. Re-enable the
  // moment srv.spectreai.io indexes the chain - nothing else needs changing.
  return null
}

function notify(key, data) {
  const subs = _subscribers.get(key)
  if (!subs) return
  for (const setter of subs) setter(data)
}

async function fetchDossier(chain, ca) {
  const key = `${chain}:${ca}`
  const existing = _inflight.get(key)
  if (existing) return existing
  const promise = (async () => {
    if (KILL_OVH_DOSSIER || !import.meta.env.VITE_DOSSIER_API) return null
    try {
      const r = await fetch(`${API}/${chain}/${ca}?stream=true`)
      if (!r.ok) return null
      const j = await r.json()
      _cache.set(key, { data: j, ts: Date.now() })
      notify(key, j)
      // Fire-and-forget lore generation when the response is sparse
      if (
        !j?.lore?.communityNarrative &&
        (j?.socials?.twitter || j?.socials?.website || j?.identity?.symbol)
      ) {
        fetch(`${API}/${chain}/${ca}/lore/generate?force=true`, { method: 'POST' }).catch(() => {})
      }
      return j
    } catch {
      return null
    } finally {
      _inflight.delete(key)
    }
  })()
  _inflight.set(key, promise)
  return promise
}

export default function useDossier(token) {
  const chain = chainOf(token?.networkId)
  const ca = token?.address
  const [data, setData] = useState(() => {
    if (!chain || !ca) return null
    const cached = _cache.get(`${chain}:${ca}`)
    return cached?.data || null
  })
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    if (!chain || !ca) { setData(null); return }
    const key = `${chain}:${ca}`

    // Subscribe to cache updates pushed by other consumers
    let subs = _subscribers.get(key)
    if (!subs) {
      subs = new Set()
      _subscribers.set(key, subs)
    }
    subs.add(setData)

    // Seed from cache instantly
    const cached = _cache.get(key)
    if (cached?.data) {
      setData(cached.data)
      setUpdatedAt(cached.ts)
    }

    let cancelled = false
    const refresh = async () => {
      // Idle/visibility guard: skip when tab is hidden OR user has been idle
      // for the idleManager IDLE_TIMEOUT (5min). Stops the "treadmill" of
      // a forgotten tab burning dossier-proxy calls overnight.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      const fresh = await fetchDossier(chain, ca)
      if (!cancelled && fresh) setUpdatedAt(Date.now())
    }
    // Initial fetch (skip if cache is fresh)
    if (!cached || Date.now() - cached.ts > TTL) refresh()

    const iv = setInterval(refresh, TTL)
    return () => {
      cancelled = true
      clearInterval(iv)
      subs.delete(setData)
      if (subs.size === 0) _subscribers.delete(key)
    }
  }, [chain, ca])

  return { data, updatedAt, chain }
}
