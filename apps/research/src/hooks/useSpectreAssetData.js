/**
 * useSpectreAssetData — Pulls asset-level data from the Spectre Data API
 * (the production "data-bridge" backend at 204.168.244.18:3850).
 *
 * Hits four endpoints in parallel via the /data-api/* Vite proxy:
 *   /v1/asset/:symbol/profile      → spectreScore + signals + community + profile
 *   /v1/sentiment/:symbol          → sentiment + funding + L/S + liquidations
 *   /v1/fundraising/rounds/:symbol → fundraising rounds with investors
 *   /v1/unlocks/:symbol            → token unlock / vesting schedule
 *
 * The proxy injects X-API-Key (vite.config.js, env: SPECTRE_DATA_BRIDGE_KEY).
 * The data-bridge endpoints are symbol-keyed (uppercased) — coverage is best
 * for top assets; small-cap memecoins return `null` / 404.
 *
 * Cached 60s in-memory across components. Auto-refresh every 5 min.
 */

import { useEffect, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'
import { getSpectreTokenSentiment } from '@/services/spectreMarketApi'

const REFRESH_MS = 5 * 60 * 1000
const CACHE_TTL_MS = 60_000
const CACHE = new Map()

function cacheGet(key) {
  const e = CACHE.get(key)
  if (!e) return null
  if (Date.now() - e.ts > CACHE_TTL_MS) { CACHE.delete(key); return null }
  return e.data
}
function cacheSet(key, data) { CACHE.set(key, { data, ts: Date.now() }) }

async function fetchJsonOrNull(path) {
  try {
    const res = await fetch(path, { credentials: 'omit', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    // The data-bridge wraps payloads in { data, meta }. Unwrap when present.
    if (json && typeof json === 'object' && 'data' in json) return json.data
    return json
  } catch {
    return null
  }
}

// In-flight dedup: concurrent mounts (e.g. the dev StrictMode double-mount,
// or two panels sharing the hook) collapse onto one 5-endpoint fan-out.
const INFLIGHT = new Map()

async function fetchAll(symbol) {
  const sym = String(symbol || '').toUpperCase()
  if (!sym) return null
  const cached = cacheGet(sym)
  if (cached) return cached
  if (INFLIGHT.has(sym)) return INFLIGHT.get(sym)
  const p = _fetchAllImpl(sym).finally(() => INFLIGHT.delete(sym))
  INFLIGHT.set(sym, p)
  return p
}

async function _fetchAllImpl(sym) {
  const [profile, sentiment, fundraisingRaw, unlocks, derivatives] = await Promise.all([
    fetchJsonOrNull(`/data-api/v1/asset/${encodeURIComponent(sym)}/profile`),
    // Shared with getSpectreTokenSentiment rather than fetched again: both
    // lanes want the same unwrapped `.data` (fetchJsonOrNull unwraps it too),
    // and hitting the URL directly meant /v1/sentiment/:sym went out TWICE on
    // every Research Zone load at ~2s each. Going through the service collapses
    // them onto one CACHE + INFLIGHT entry, and it fails the same way this
    // helper does — null, never a throw — plus it keeps the legacy bridge
    // fallback for when the v1 route is down.
    getSpectreTokenSentiment(sym),
    fetchJsonOrNull(`/data-api/v1/fundraising/rounds/${encodeURIComponent(sym)}`),
    fetchJsonOrNull(`/data-api/v1/unlocks/${encodeURIComponent(sym)}`),
    fetchJsonOrNull(`/data-api/v1/derivatives/composite/dashboard/${encodeURIComponent(sym)}`),
  ])

  // Strip pipeline-marker rows from fundraising. The Spectre API ingestion layer
  // emits placeholder rows with round_type like `defillama_listing` / `messari_listing`
  // when it first records an asset on those providers — they aren't actual VC
  // rounds, they have no amount and no investors. Showing them as "Funding history"
  // is wrong AND leaks the upstream data source name. Drop them client-side.
  const fundraising = (() => {
    if (fundraisingRaw == null) return fundraisingRaw
    const rawArr = Array.isArray(fundraisingRaw) ? fundraisingRaw : (fundraisingRaw.rounds || fundraisingRaw.items || fundraisingRaw.data)
    if (!Array.isArray(rawArr)) return fundraisingRaw
    const cleaned = rawArr.filter((r) => {
      const rt = String(r?.round_type || '').toLowerCase()
      if (/_listing$|^listing$|^source_marker$/.test(rt)) return false
      // Drop rows with no amount AND no investors AND no round name — they're
      // placeholders, not data.
      const hasAmount = Number(r?.amount_raised_usd) > 0
      const hasInvestors = (Array.isArray(r?.all_investors) && r.all_investors.length)
        || (Array.isArray(r?.lead_investors) && r.lead_investors.length)
      const hasRound = !!(r?.round || r?.round_type)
      if (!hasAmount && !hasInvestors && !hasRound) return false
      // Final guard: if round_type still mentions an upstream provider name we
      // never want surfaced (defillama, messari, coingecko, cmc, etc.), strip.
      if (/defillama|messari|coingecko|coinmarketcap|cmc|nansen|arkham/i.test(rt)) return false
      return true
    })
    if (Array.isArray(fundraisingRaw)) return cleaned
    return { ...fundraisingRaw, ...(fundraisingRaw.rounds ? { rounds: cleaned } : {}), ...(fundraisingRaw.items ? { items: cleaned } : {}), ...(fundraisingRaw.data && !fundraisingRaw.rounds && !fundraisingRaw.items ? { data: cleaned } : {}) }
  })()

  const out = { profile, sentiment, fundraising, unlocks, derivatives, symbol: sym }
  cacheSet(sym, out)
  return out
}

export default function useSpectreAssetData(symbol) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Per-effect closure flag (NOT a hook-scope ref): the hook stays mounted
    // across token switches, so a shared ref reset to false by the next effect
    // run would let token A's slow (3-15s cold) response setData onto token B.
    let cancelled = false
    setData(null)
    if (!symbol) return undefined

    let timer = null

    const tick = async () => {
      setLoading(true)
      const result = await fetchAll(symbol)
      if (!cancelled) {
        setData(result)
        setLoading(false)
      }
    }

    tick()
    timer = setInterval(() => {
      if ((typeof document !== 'undefined' && document.hidden) || !isAppActive()) return
      tick()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [symbol])

  return { data, loading }
}
