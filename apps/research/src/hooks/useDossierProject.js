/**
 * useDossierProject - Aggregated project dossier (Project Tab data source).
 *
 * Endpoint: GET /api/dossier-proxy?symbol={SYM}[&address=&cgId=&githubUrl=]
 *   - Server-side aggregator fans out to 5 spectre-data-api endpoints +
 *     CoinGecko, DeFiLlama, DexScreener, GitHub. Returns merged shape.
 *   - In dev, Vite proxies /api -> Express server (mirrored aggregator).
 *   - In prod, vercel.json rewrite -> /api/intel-api?fn=dossier-proxy.
 *
 * Hints (all optional but improve long-tail coverage):
 *   - address    enables DexScreener pair lookup
 *   - cgId       enables CoinGecko description / categories / repos enrichment
 *   - githubUrl  forces GitHub live stars/forks/last-commit fetch
 *
 * Returned shape (translated camelCase, see rz-project-cinema for consumers):
 *   { tagline, description, tags, team, partners, investors, roadmap,
 *     whitepaperUrl, audits, riskComposite, spectreTake, catalysts, tvl,
 *     dexPairs, socialLinks, github, tokenomics, sourcesUsed, trustScore, ... }
 *
 * Refresh: every 5 minutes while the tab is visible.
 */
import { useEffect, useState, useRef } from 'react'
import { getProjectOverrides } from '@/constants/projectOverrides'
import { isAppActive } from '@/lib/idleManager'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'

const REFRESH_MS = 5 * 60 * 1000
/** How long a fresh nav waits for cgId before giving up and fetching without it. */
const IDENTITY_GRACE_MS = 700

// Module cache + in-flight dedup keyed by the request URL. The dossier proxy
// is a 9-way server-side fan-out (1-3s cold) — without this, every Project
// tab re-open (and the dev StrictMode double-mount) re-paid the full fan-out.
// 60s TTL: well under the 5-min poll, just enough to absorb remounts.
const _cache = new Map()      // url -> { json, ts }
const _inflight = new Map()   // url -> Promise<json>
const CACHE_TTL = 60_000

async function fetchDossier(url) {
  const hit = _cache.get(url)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.json
  if (_inflight.has(url)) return _inflight.get(url)
  // 🪤 NOT `credentials: 'omit'`. /api/dossier-proxy sits behind the app's
  // edge auth gate, which reads a same-origin cookie — omitting credentials
  // made EVERY request 401 GATE_REQUIRED, so the Project tab dossier has been
  // empty on prod since this proxy shipped (measured 2026-09-01: omit -> 401,
  // default -> 200 with the full team/partners/roadmap payload).
  const p = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      _cache.set(url, { json, ts: Date.now() })
      if (_cache.size > 20) _cache.delete(_cache.keys().next().value)
      return json
    })
    .finally(() => _inflight.delete(url))
  _inflight.set(url, p)
  return p
}

// Merge manual seed into the API-returned dossier. API data wins per field;
// overrides only fill in when the live response has null/empty/missing.
function _mergeOverrides(apiData, overrides) {
  if (!overrides) return apiData
  const base = apiData || {}
  const merged = { ...base }
  for (const [k, v] of Object.entries(overrides)) {
    const cur = base[k]
    const empty = cur == null
      || (Array.isArray(cur) && cur.length === 0)
      || (typeof cur === 'object' && !Array.isArray(cur) && Object.keys(cur).length === 0)
    if (empty) merged[k] = v
    else if (k === 'socialLinks' && cur && v && typeof cur === 'object' && typeof v === 'object') {
      merged[k] = { ...v, ...cur }
    }
  }
  return merged
}

function buildUrl({ symbol, address, networkId, cgId, githubUrl }) {
  const params = new URLSearchParams()
  params.set('symbol', symbol)
  if (address) params.set('address', address)
  if (networkId) params.set('networkId', String(networkId))
  if (cgId) params.set('cgId', cgId)
  if (githubUrl) params.set('githubUrl', githubUrl)
  return `/api/dossier-proxy?${params.toString()}`
}

export default function useDossierProject({ symbol, address, networkId, cgId, githubUrl } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Address / networkId / githubUrl are read via refs so progressive identity
  // enrichment doesn't refetch the dossier 3-4× per token nav (and also
  // restart the polling timer each time, which was the more expensive bug).
  // Only `symbol` and `cgId` trigger a refetch — cgId because the dossier
  // proxy uses it as a cross-source key. The first fetch on a fresh nav uses
  // whatever enrichment is currently available; subsequent enrichment is
  // captured by the next polling tick.
  const enrichmentRef = useRef({ address, networkId, githubUrl })
  enrichmentRef.current = { address, networkId, githubUrl }

  // For the 38 majors the CoinGecko id is known SYNCHRONOUSLY, so waiting on
  // the async identity pipeline meant the first dossier call went out blind and
  // a second followed the moment the id landed — two full fetches on every load
  // of BTC, ETH, SOL and friends. Resolving it here makes the first call the
  // only call, and because the effect keys on the RESOLVED value, the later
  // arrival of the identical id cannot retrigger anything.
  const resolvedCgId = cgId || SYMBOL_TO_COINGECKO_ID[String(symbol || '').toUpperCase()] || null

  useEffect(() => {
    // Per-effect closure flag (NOT a hook-scope ref): the hook stays mounted
    // across token switches, so a shared ref reset to false by the next effect
    // run would let token A's slow dossier response paint onto token B.
    let cancelled = false
    setData(null)
    setError(null)

    if (!symbol) return

    let timer = null

    const fetchOnce = async () => {
      setLoading(true)
      try {
        const enr = enrichmentRef.current
        const json = await fetchDossier(
          buildUrl({ symbol, address: enr.address, networkId: enr.networkId, cgId: resolvedCgId, githubUrl: enr.githubUrl })
        )
        if (cancelled) return
        const overrides = getProjectOverrides(symbol)
        setData(_mergeOverrides(json?.data || null, overrides))
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setData(null)
          setError(e?.message || 'fetch failed')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    // IDENTITY GRACE. This effect keys on [symbol, cgId], and cgId resolves
    // asynchronously — so a fresh nav fired the dossier twice, once without a
    // cgId and again a moment later with it. Measured on /research-zone/bitcoin:
    // 3.6s for the first (wasted) call and 1.7s for the real one.
    //
    // Waiting a beat collapses that to one request. If cgId lands inside the
    // window the effect re-runs, this pending call is cleared by the cleanup
    // below, and the new run fires immediately WITH the id. If it never lands —
    // a token that genuinely has no CoinGecko identity — we fire anyway, so
    // nothing is gated on an id that is not coming.
    const firstDelay = resolvedCgId ? 0 : IDENTITY_GRACE_MS
    const firstCall = setTimeout(fetchOnce, firstDelay)
    timer = setInterval(() => {
      // Idle/visibility guard: skip when hidden OR user idle > IDLE_TIMEOUT.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      fetchOnce()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      clearTimeout(firstCall)
      if (timer) clearInterval(timer)
    }
  }, [symbol, resolvedCgId])

  return { data, loading, error }
}
