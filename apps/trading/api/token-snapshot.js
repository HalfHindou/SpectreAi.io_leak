/**
 * Vercel Serverless Function — aggregate token snapshot.
 *
 * Phase D parity for the Express /api/token/snapshot route. Returns
 * { details, bars, trades, color, ts } in one response so the client
 * cold-load path drops from 4 round-trips to 1 (~300-500ms instead
 * of 1.5-3s).
 *
 * Self-fetches sibling Vercel functions (details / bars / trades /
 * token-color) in parallel. On Vercel, function-to-function calls
 * over the same deployment URL hit the in-region edge (a few ms
 * each) so the loopback overhead is negligible vs the upstream
 * Codex round-trip.
 *
 * PR-S-A: all four members start at t=0 (color overlaps trades - it
 * awaits only details' logo, not the whole assembly). `?phase=fast`
 * responds the moment details+bars settle, racing trades (900ms) and
 * color (300ms); late members are named in `pending[]` and the full
 * assembly keeps running (via waitUntil) to patch the cache for the
 * next reader. No `phase` = await the full assembly (byte-identical
 * legacy behaviour).
 *
 * PR-S-B: a cross-instance KV aggregate snapshot (`codex:v1:tsnap:...`)
 * fronts the assembly so a warm hit on ANY lambda serves ~100-250ms
 * (per-instance Maps die on rotation). age<60s serves as-is; 60-300s
 * serves stale + background re-assembles via waitUntil.
 *
 * Mirrors `apps/trading/api/bars.js` for auth gate, CORS, rate-limit
 * patterns.
 */

import { rateLimit } from './_lib/ratelimit.js'
import { isAuthGateValid, isDemoSession } from './auth-gate.js'
import { getCodexCache, setCodexCache } from './_lib/kv.js'

// waitUntil keeps the full assembly + cache patch alive after a fast response
// is flushed, so trades/color land for the next reader on this warm instance
// AND the cross-instance KV tsnap gets written. Guarded: if @vercel/functions
// isn't available the background promise still runs but the lambda may freeze it.
let _waitUntil = null
try {
  const mod = await import('@vercel/functions')
  if (mod && typeof mod.waitUntil === 'function') _waitUntil = mod.waitUntil
} catch { /* @vercel/functions unavailable - fall back to bare promise continuation */ }

// Per-Lambda-instance cache + dedup (warm starts share, cold starts get a fresh
// map). 60s so a warm instance serves without re-reading KV within the tsnap
// fresh window (matches s-maxage=60).
const _snapshotCache = new Map()
const _snapshotInflight = new Map()
const SNAPSHOT_CACHE_TTL = 60_000
const _snapSleep = (ms) => new Promise((r) => setTimeout(r, ms))

// PR-S-B cross-instance warm path: `codex:v1:tsnap:<addr>:<net>:<res>` KV.
// KV TTL 300s (entries older than that auto-evict -> treated as a miss); on read
// age<60s serves as-is (~100-250ms), 60-300s serves stale + bg re-assemble.
const TSNAP_TTL_SEC = 300
const TSNAP_FRESH_MS = 60_000
// An assembly is only worth caching or serving if it actually carries data.
// `details` and `bars` are the two members the client is gated on (the chart
// awaits a pending snapshot for its bars); trades/color are enrichment.
const _snapshotHasPayload = (s) => !!(s && (s.details || (Array.isArray(s.bars) ? s.bars.length : s.bars)))
const _tsnapKey = (address, netId, snapRes) => `${address.toLowerCase()}:${netId}:${snapRes}`

// Member timeouts: 4000ms on the three sibling fetches (was 8000). Color keeps
// its own 5000ms ceiling - the fast gate races it at 300ms and the client's
// accent pipeline covers a null, so this ceiling only bounds the legacy await.
const _SNAP_MEMBER_TIMEOUT = 4000
const _SNAP_COLOR_TIMEOUT = 5000

// The ALIAS the request actually arrived on wins over VERCEL_URL.
//
// VERCEL_URL is the per-deployment URL, and a lambda self-fetch to it does not
// resolve the way a public request does - every member came back null, so the
// snapshot answered 200 with the right shape and `details: null, bars: null`
// for every token. Measured on prod 2026-08-04: a 163-byte empty snapshot on
// every call, which made the whole GP6 boot accelerator inert AND cost the
// chart ~1.1s per token open (TradingViewAdvanced's datafeed awaits a pending
// snapshot before falling through to its own /api/bars - so it waited on a
// payload that never carried bars, then fetched them anyway).
//
// This is the same defect PR #1284 fixed for the engineInternal short-circuit
// below; that fix never reached the main browser path, which is the one every
// user hits. Keep the two in sync.
function getSelfBase(req) {
  const host = req.headers?.host
  if (host) return `https://${host}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

// Build all four member promises at t=0. Color overlaps trades: it awaits ONLY
// details' logo (not the whole assembly), so it no longer runs as a sequential
// phase-2 after everything else settled. `fullP` is the byte-identical legacy
// payload (NO pending field) - what gets cached + what the no-phase gate awaits.
function _buildAssembly({ base, address, netId, snapRes, forwardHeaders }) {
  const now = Math.floor(Date.now() / 1000)
  // 300 bars at the chart's BOOT resolution = its first-paint window (was a
  // hardcoded 1H that mismatched any non-1H saved timeframe -> cold full fetch).
  const _SNAP_BUCKET = { '1':60,'5':300,'15':900,'30':1800,'60':3600,'240':14400,'720':43200,'1D':86400,'1W':604800 }
  const from = now - 300 * (_SNAP_BUCKET[snapRes] || 3600)

  // Codex action=details is the prod GraphQL passthrough action shape
  // (see apps/trading/api/codex.js). On Vercel the dev route
  // /api/token/details doesn't exist as a separate function — we go
  // through /api/codex?action=details.
  const detailsUrl = `${base}/api/codex?action=details&address=${encodeURIComponent(address)}&networkId=${netId}`
  // src=codex keeps the snapshot's bars on the SAME Codex-only tier the trading
  // chart uses (the token-page price chart is Codex-only per Gleb) AND shares
  // the wide-KV bucket with any direct chart fetch. Contract-shaped addresses
  // only - CoinGecko-slug majors (e.g. 'ripple') can't resolve on the codex
  // tier and must keep the full tier cascade.
  const isContractAddr = /^0x[0-9a-fA-F]{40}$/.test(address) ||
    (address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address))
  const barsSrc = isContractAddr ? '&src=codex' : ''
  const barsUrl = `${base}/api/bars?symbol=${encodeURIComponent(address)}&from=${from}&to=${now}&resolution=${snapRes}&networkId=${netId}${barsSrc}`
  const tradesUrl = `${base}/api/codex?action=trades&address=${encodeURIComponent(address)}&networkId=${netId}&limit=50`

  const detailsP = fetch(detailsUrl, { headers: forwardHeaders, signal: AbortSignal.timeout(_SNAP_MEMBER_TIMEOUT) }).then(r => r.ok ? r.json() : null).catch(() => null)
  const barsP = fetch(barsUrl, { headers: forwardHeaders, signal: AbortSignal.timeout(_SNAP_MEMBER_TIMEOUT) }).then(r => r.ok ? r.json() : null).catch(() => null)
  const tradesP = fetch(tradesUrl, { headers: forwardHeaders, signal: AbortSignal.timeout(_SNAP_MEMBER_TIMEOUT) }).then(r => r.ok ? r.json() : null).catch(() => null)
  const colorP = detailsP.then((d) => {
    const logoUrl = d?.logo || null
    if (!logoUrl) return null
    return fetch(`${base}/api/token-color?url=${encodeURIComponent(logoUrl)}`, {
      headers: forwardHeaders,
      signal: AbortSignal.timeout(_SNAP_COLOR_TIMEOUT),
    }).then(r => r.ok ? r.json() : null).then(j => j?.color || null).catch(() => null)
  }).catch(() => null)

  const fullP = (async () => {
    const [details, bars, trades, color] = await Promise.all([detailsP, barsP, tradesP, colorP])
    return {
      address: address.toLowerCase(),
      networkId: netId,
      details: details || null,
      bars: bars || null,
      barsResolution: snapRes,
      trades: trades?.trades || [],
      color: color || null,
      ts: Date.now(),
    }
  })()

  return { detailsP, barsP, tradesP, colorP, fullP }
}

// Fast gate: resolve once details+bars settle; trades races a 900ms ceiling,
// color a 300ms ceiling (run concurrently). Members that lose their race are
// returned empty/null and named in `pending` (the client fills them via its
// trades-phase follow-up + its own accent pipeline).
async function _fastResponse(bundle, { address, netId, snapRes }) {
  const { detailsP, barsP, tradesP, colorP } = bundle
  const [details, bars] = await Promise.all([detailsP, barsP])
  const [tradesRaced, colorRaced] = await Promise.all([
    Promise.race([tradesP, _snapSleep(900).then(() => undefined)]),
    Promise.race([colorP, _snapSleep(300).then(() => undefined)]),
  ])
  const pending = []
  let trades = []
  if (tradesRaced === undefined) pending.push('trades')
  else trades = tradesRaced?.trades || []
  let color = null
  if (colorRaced === undefined) pending.push('color')
  else color = colorRaced || null
  return {
    address: address.toLowerCase(),
    networkId: netId,
    details: details || null,
    bars: bars || null,
    barsResolution: snapRes,
    trades,
    color,
    ts: Date.now(),
    pending,
  }
}

// Create-or-join the shared assembly for a cacheKey. On creation, the finalize
// tail writes BOTH the per-instance in-memory cache AND the cross-instance KV
// tsnap when the full assembly (incl. late trades/color) lands, and is handed to
// waitUntil so it survives a flushed fast response. Concurrent callers (fresh
// miss + inflight join + stale re-assemble) all funnel through here so exactly
// one assembly runs per cacheKey.
function _getOrStartAssembly({ base, address, netId, snapRes, forwardHeaders, cacheKey }) {
  const existing = _snapshotInflight.get(cacheKey)
  if (existing) return existing

  const bundle = _buildAssembly({ base, address, netId, snapRes, forwardHeaders })
  _snapshotInflight.set(cacheKey, bundle)
  const finalize = bundle.fullP
    .then((full) => {
      // NEVER persist an assembly that carries nothing. Every member resolves
      // to null on failure, so a transient outage (or a self-fetch that cannot
      // reach its siblings) produces a perfectly-shaped EMPTY snapshot - and
      // writing that to KV poisons the token for the whole TTL, for everyone.
      // Measured on prod 2026-08-04: /api/token-snapshot answered 163 bytes
      // with details:null, bars:null on every token, served straight out of
      // this cache, which made the boot accelerator inert and cost the chart
      // ~1.1s per open (its datafeed awaits a pending snapshot before falling
      // back to its own /api/bars).
      if (!_snapshotHasPayload(full)) return
      _snapshotCache.set(cacheKey, { data: full, ts: Date.now() })
      // Own catch so a KV outage never rejects finalize (which waitUntil awaits).
      return setCodexCache('tsnap', _tsnapKey(address, netId, snapRes), full, TSNAP_TTL_SEC).catch(() => {})
    })
    .catch(() => { /* assembly failed - nothing to cache */ })
    .finally(() => { if (_snapshotInflight.get(cacheKey) === bundle) _snapshotInflight.delete(cacheKey) })
  if (_waitUntil) { try { _waitUntil(finalize) } catch { /* ignore */ } }
  return bundle
}

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : ''
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // The order engine (server-to-server, no user session) authenticates price
  // reads with the internal key - same bypass swap.js grants it. Price data
  // is not sensitive, and the dev Express snapshot route is ungated, so this
  // is the parity fix that lets the prod engine reconcile ANY token's price
  // (without it the engine 401s here and can only price SSE-streamed tokens,
  // leaving conditional orders on smaller tokens permanently unfired).
  let engineInternal = false
  const _ik = process.env.ORDER_ENGINE_INTERNAL_KEY
  const _ih = req.headers['x-spectre-internal']
  if (_ik && _ih) {
    const { timingSafeEqual } = await import('crypto')
    const a = Buffer.from(String(_ih))
    const b = Buffer.from(String(_ik))
    engineInternal = a.length === b.length && timingSafeEqual(a, b)
  }
  if (!engineInternal && !isAuthGateValid(req) && !isDemoSession(req)) {
    // no-store: the inline boot script (index.html) makes this the FIRST
    // request of pre-gate visitors - a CDN-cached 401 must never be served
    // to a subsequently-authed session.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  if (await rateLimit(req, res, { bucket: 'snapshot', max: 120, windowMs: 60_000 })) return

  const { address, networkId = 1 } = req.query
  if (!address) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(400).json({ error: 'Address is required' })
  }

  const isSolAddr = !address.startsWith('0x') && address.length >= 32 && address.length <= 44
  const netId = (isSolAddr && parseInt(networkId) === 1) ? 1399811149 : parseInt(networkId)

  // The order engine (engineInternal) needs only price/supply/liquidity - serve
  // a DIRECT codex details read and skip the 4-member assembly + tsnap cache
  // entirely. Two reasons the assembly path fails it: (1) the assembly's 4s
  // per-member timeout kills the cold codex details fetch for UNTRACKED tokens
  // (KV-snap miss -> Hetzner miss -> Codex filterTokens is ~2-5s -> null), and
  // (2) the tsnap cache served a poisoned null-details entry whose Vercel bg
  // re-assemble never refreshed. 9s budget, no cache, no assembly. The engine's
  // adoptSnapshot reads snap.details.{price,circulatingSupply,liquidity}, which
  // the codex details shape carries at top level.
  if (engineInternal) {
    // Use the request HOST (the public alias the engine called), NOT
    // getSelfBase's VERCEL_URL deployment URL - a lambda self-fetch to its own
    // VERCEL_URL was returning null here while the same call to the alias works.
    const selfBase = req.headers?.host ? `https://${req.headers.host}` : getSelfBase(req)
    let details = null
    const _dbg = { base: selfBase, status: null, err: null }
    try {
      const r = await fetch(`${selfBase}/api/codex?action=details&address=${encodeURIComponent(address)}&networkId=${netId}`, {
        headers: { 'x-spectre-internal': String(_ih) },
        signal: AbortSignal.timeout(9000),
      })
      _dbg.status = r.status
      details = r.ok ? await r.json() : null
    } catch (e) { _dbg.err = String(e?.message || e) }
    res.setHeader('Cache-Control', 'no-store')
    // _dbg is returned ONLY to the engineInternal caller (never a public
    // response) so we can see the exact codex status/error if it still fails.
    return res.json({ address: String(address).toLowerCase(), networkId: netId, details, bars: null, barsResolution: '60', trades: [], color: null, ts: Date.now(), _dbg })
  }
  // Bars resolution = the chart's boot timeframe (boot script passes it); default
  // 1H. Part of the cache key so 12H and 1H snapshots don't collide. Phase is NOT
  // in the key: one assembly, two gates (fast vs full).
  const snapRes = String(req.query.resolution || '60')
  const cacheKey = `${address.toLowerCase()}:${netId}:${snapRes}`
  const isFast = req.query.phase === 'fast'

  const setSnapHeaders = () => {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')
  }

  const cached = _snapshotCache.get(cacheKey)
  if (cached && (Date.now() - cached.ts) < SNAPSHOT_CACHE_TTL) {
    setSnapHeaders()
    return res.json(cached.data)
  }

  // Forward the auth gate cookie + bearer to the sibling functions
  // so they don't reject our self-calls.
  const forwardHeaders = {}
  if (req.headers?.cookie) forwardHeaders.cookie = req.headers.cookie
  if (req.headers?.authorization) forwardHeaders.authorization = req.headers.authorization
  if (req.headers?.['x-spectre-gate']) forwardHeaders['x-spectre-gate'] = req.headers['x-spectre-gate']
  // The order engine reaches us with ONLY the internal key (no user session) -
  // forward it to the Codex/bars self-fetches so they honor the same bypass.
  // Without this the details self-fetch 401s and the engine gets a null price,
  // leaving conditional orders on untracked tokens permanently unfired.
  if (engineInternal && _ih) forwardHeaders['x-spectre-internal'] = String(_ih)

  const base = getSelfBase(req)

  // PR-S-B cross-instance warm path. A fresh (<60s) tsnap serves the full,
  // complete assembly on any lambda; a stale (60-300s) tsnap serves immediately
  // while a single background re-assemble refreshes it. Best-effort - any KV
  // error returns null and we fall through to a live assembly.
  let tsnap = null
  try {
    tsnap = await getCodexCache('tsnap', _tsnapKey(address, netId, snapRes))
  } catch { /* KV read failed - live assembly below */ }
  // Ignore an empty cached assembly instead of serving it. Entries written
  // before the guard above exist in KV with a multi-minute TTL, so without
  // this read-side check every token stays poisoned until it expires - and
  // the stale-path background re-assemble would keep rewriting it. Treating
  // it as a miss makes each token self-heal on its next request.
  if (tsnap && !_snapshotHasPayload(tsnap)) tsnap = null
  if (tsnap && typeof tsnap.ts === 'number') {
    const age = Date.now() - tsnap.ts
    if (age < TSNAP_FRESH_MS) {
      // Fresh: seed the per-instance cache (inherit the tsnap age so the 60s
      // in-memory TTL expires in step with the tsnap's own freshness window).
      _snapshotCache.set(cacheKey, { data: tsnap, ts: tsnap.ts })
      setSnapHeaders()
      return res.json(tsnap)
    }
    // Stale (60-300s): kick a single background re-assemble (dedup'd + kept alive
    // via waitUntil inside the helper), serve the stale payload now. Not seeded
    // into the in-memory cache so the next request re-checks the refreshed tsnap.
    _getOrStartAssembly({ base, address, netId, snapRes, forwardHeaders, cacheKey })
    setSnapHeaders()
    return res.json(tsnap)
  }

  // Miss: assemble live (creating or joining the shared per-cacheKey assembly).
  const bundle = _getOrStartAssembly({ base, address, netId, snapRes, forwardHeaders, cacheKey })
  try {
    const data = isFast
      ? await _fastResponse(bundle, { address, netId, snapRes })
      : await bundle.fullP
    setSnapHeaders()
    return res.json(data)
  } catch (err) {
    console.error('[snapshot] error:', err?.message || err)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: err?.message || 'snapshot failed' })
  }
}
