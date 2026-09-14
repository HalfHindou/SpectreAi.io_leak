/**
 * Spectre Data helper — triple-tier market-data lookup for the Lever 3 PR.
 *
 * Purpose: stop selecting volume24/liquidity/marketCap/change4/change12/
 * holders/txnCount24 inside Codex filterTokens queries (each of those fields
 * triggers a billable listPairsWithMetadataForToken lockstep op). Instead,
 * after the Codex query returns, backfill those fields from cheaper sources.
 *
 * Lookup order per token:
 *   Tier 1 — Vercel KV `cg:snap:<cgId>`         sub-ms, top-500 by mcap
 *   Tier 2 — Hetzner GET /v1/coins/markets?ids= ~100-200ms, any cgId
 *   Tier 3 — Hetzner GET /v1/scanner/token/...  ~150-400ms, address+chain
 *
 * Fields populated (per address.toLowerCase()):
 *   { volume24, liquidity, marketCap, change4, change12, holders, txnCount24 }
 *
 * Anything we cannot recover -> null (never zero / undefined / thrown).
 * UI consumers already tolerate null/0 via `parseFloat(x) || 0`.
 *
 * Env vars:
 *   SPECTRE_API_BASE        defaults to http://204.168.244.18:3850
 *                           (do NOT default to https://api.spectreai.io —
 *                            Cloudflare WAF blocks Vercel->origin calls)
 *   SPECTRE_DATA_API_KEY    falls back to SPECTRE_API_KEY
 *
 * Risk mitigations (per spec section I):
 *   R2 — every outbound fetch is wrapped in AbortSignal.timeout(2500ms),
 *        Promise.allSettled across the batch, retry-once on network error,
 *        max 10 concurrent for Tier 3.
 *   R5 — KV-eviction safe: KV miss falls through to Hetzner. We never WRITE
 *        new KV entries here, only READ existing cg:snap:* keys.
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

let _kvGetJson = null
let _kvSetJson = null
try {
  ;({ getJsonWithTTL: _kvGetJson, setJsonWithTTL: _kvSetJson } = require('./kv.js'))
} catch (_) { /* KV unavailable in this env — Tier 1 skipped, Tier 2/3 still run */ }

// Token registry — used to reverse-resolve (address+networkId) -> cgId so
// Tier 1 can hit cg:snap. KNOWN_TOKEN_ADDRESSES + SYMBOL_TO_COINGECKO_ID is
// the static portion (~25 majors); long-tail tokens just skip Tier 1 and
// land on Tier 2/3 with a cgId passed in by the caller.
let KNOWN_TOKEN_ADDRESSES = null
let SYMBOL_TO_COINGECKO_ID = null
try {
  const reg = require('../../../../packages/server/lib/token-registry')
  KNOWN_TOKEN_ADDRESSES = reg.KNOWN_TOKEN_ADDRESSES || null
  SYMBOL_TO_COINGECKO_ID = reg.SYMBOL_TO_COINGECKO_ID || null
} catch (_) { /* registry unavailable — Tier 1 reverse-lookup degrades */ }

// Static reverse map: "addr.toLowerCase():networkId" -> cgId.
// Built once at module load. Tier 2 + Tier 3 still work without it.
const _addrNetToCgId = (() => {
  const m = new Map()
  if (!KNOWN_TOKEN_ADDRESSES || !SYMBOL_TO_COINGECKO_ID) return m
  for (const [sym, info] of Object.entries(KNOWN_TOKEN_ADDRESSES)) {
    const cgId = SYMBOL_TO_COINGECKO_ID[sym]
    if (!info?.address || info?.networkId == null || !cgId) continue
    const key = info.address.startsWith('0x')
      ? `${info.address.toLowerCase()}:${info.networkId}`
      : `${info.address}:${info.networkId}`
    m.set(key, cgId)
  }
  return m
})()

const SPECTRE_API_BASE = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
const SPECTRE_DATA_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || ''
const FETCH_TIMEOUT_MS = 2500
const TIER3_CONCURRENCY = 10

// networkId -> chain slug for /v1/scanner/token/{address}?chain={chain}.
// Canonical full names per the data-api scanner CHAIN_MAP (the 2026-07
// scanner rewrite rejects short slugs; the API keeps eth/arb/poly/sol as
// aliases for older deploys, but new code should send canonical).
function chainSlugFromNetworkId(networkId) {
  const nid = Number(networkId)
  if (nid === 1) return 'ethereum'
  if (nid === 8453) return 'base'
  if (nid === 42161) return 'arbitrum'
  if (nid === 137) return 'polygon'
  if (nid === 56) return 'bsc'
  if (nid === 1399811149) return 'solana'
  return null
}

function _addressLookupKey(address, networkId) {
  if (!address) return null
  return address.startsWith('0x')
    ? `${address.toLowerCase()}:${networkId}`
    : `${address}:${networkId}`
}

function _reverseCgId(address, networkId) {
  const key = _addressLookupKey(address, networkId)
  if (!key) return null
  return _addrNetToCgId.get(key) || null
}

// Empty backfill — every field null. Callers merge with `??` so null lets
// the existing parseFloat(value) || 0 path produce 0 in the UI.
const EMPTY_BACKFILL = Object.freeze({
  volume24: null,
  liquidity: null,
  marketCap: null,
  change4: null,
  change12: null,
  holders: null,
  txnCount24: null,
})

// ---------------------------------------------------------------------------
// Per-address cache for the two BILLED tiers (3 and 4).
//
// Tier 3 hits the box's /v1/scanner/token/{address}, and the box resolves that
// live through Codex (filterTokens + listPairsWithMetadataForToken) on the
// spectre-prod-ingestion key. Tiers 1 and 2 structurally cannot return
// liquidity/holders/txnCount24 — they hardcode those to null — so the tier-3
// skip condition below can never be satisfied by a cheap hit. Every address in
// every batch reached the scanner, uncached, and the same token re-billed once
// per search, per surface, per user. That is what spiked Codex on 2026-08-12,
// once PR #1421 un-broke prod search and the path started completing at volume.
//
// These fields move on a minutes scale, so a short shared cache costs nothing
// in accuracy and collapses the fan-out platform-wide: one upstream call per
// token per TTL instead of one per request. Misses are cached too — an address
// the box does not index would otherwise re-probe on every single keystroke.
const SCANNER_TTL_SEC = 120
const SCANNER_MISS_TTL_SEC = 300
const MEMO_MAX = 2000

const _memo = new Map()      // warm-instance cache, survives across invocations
const _inflight = new Map()  // collapses concurrent identical lookups

const _MISS = Object.freeze({ _miss: 1 })

function _memoGet(key) {
  const e = _memo.get(key)
  if (!e) return undefined
  if (e.exp < Date.now()) { _memo.delete(key); return undefined }
  return e.v
}

function _memoSet(key, v, ttlSec) {
  if (_memo.size >= MEMO_MAX) {
    // Cheap FIFO trim — these entries are all equally disposable.
    for (const k of _memo.keys()) { _memo.delete(k); if (_memo.size < MEMO_MAX * 0.9) break }
  }
  _memo.set(key, { v, exp: Date.now() + ttlSec * 1000 })
}

/**
 * A cache entry must look like a backfill row (or the miss sentinel) before we
 * trust it. Anything else - a JSON string that never got parsed, an empty
 * object, a stray value under a colliding key - is treated as a cache miss and
 * re-fetched. Spreading garbage here would silently zero a token's liquidity,
 * and in search that means qualityScore -1000 and the row vanishing from the
 * results with nothing in the logs to say why.
 */
const _BACKFILL_KEYS = ['volume24', 'liquidity', 'marketCap', 'change4', 'change12', 'holders', 'txnCount24']
function _isCacheable(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  if (v._miss) return true
  return _BACKFILL_KEYS.some((k) => k in v)
}

/**
 * Cache-aside wrapper around one billed upstream probe.
 * Returns the probe's value, or null (both "no data" and "cached miss").
 */
async function _cachedProbe(key, fn) {
  const hit = _memoGet(key)
  if (hit !== undefined) return hit === _MISS ? null : hit
  const pending = _inflight.get(key)
  if (pending) return await pending

  const run = (async () => {
    if (typeof _kvGetJson === 'function') {
      try {
        const kvHit = await _kvGetJson(key)
        if (kvHit && _isCacheable(kvHit)) {
          const v = kvHit._miss ? _MISS : kvHit
          _memoSet(key, v, v === _MISS ? SCANNER_MISS_TTL_SEC : SCANNER_TTL_SEC)
          return v === _MISS ? null : v
        }
      } catch (_) { /* KV blip — fall through to the upstream call */ }
    }
    const value = await fn()
    // undefined = TRANSIENT (timeout, budget exhausted, network blip). Caching
    // that as a miss would blank a live token's liquidity/holders for the whole
    // negative TTL, which is worse than paying for one more probe later.
    if (value === undefined) return null
    const ttl = value ? SCANNER_TTL_SEC : SCANNER_MISS_TTL_SEC
    _memoSet(key, value || _MISS, ttl)
    if (typeof _kvSetJson === 'function') {
      try { await _kvSetJson(key, value || { _miss: 1 }, ttl) } catch (_) { /* fail-soft */ }
    }
    return value
  })()

  _inflight.set(key, run)
  try { return await run } finally { _inflight.delete(key) }
}

// `deadline` is an absolute epoch-ms budget shared by a whole batch. Past it we
// stop ISSUING calls rather than merely stop awaiting them — the previous
// Promise.race at the search call site capped latency but not spend, because
// the requests had already left for the box and the box had already paid Codex.
function _budgetLeft(deadline) {
  if (!deadline) return FETCH_TIMEOUT_MS
  return deadline - Date.now()
}

async function _fetchWithRetry(url, opts, label, deadline) {
  const tryOnce = async () => {
    const budget = Math.min(FETCH_TIMEOUT_MS, _budgetLeft(deadline))
    if (budget <= 0) return null
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(budget) })
  }
  try {
    return await tryOnce()
  } catch (err) {
    const code = err?.name || ''
    if (code === 'AbortError' || code === 'TypeError' || code === 'FetchError') {
      // Only retry if the batch budget still has room — retrying past the
      // deadline doubles the upstream spend for a result nobody will wait for.
      if (_budgetLeft(deadline) <= 0) return null
      try { return await tryOnce() } catch (e2) {
        console.warn(`[spectre-data] ${label} retry failed:`, e2?.message)
        return null
      }
    }
    console.warn(`[spectre-data] ${label} fetch error:`, err?.message)
    return null
  }
}

// Tier 1 — KV cg:snap:<cgId>.
async function _tier1Kv(cgId) {
  if (!cgId || typeof _kvGetJson !== 'function') return null
  try {
    const snap = await _kvGetJson(`cg:snap:${cgId.toLowerCase()}`)
    if (!snap || typeof snap !== 'object') return null
    if (snap.price == null) return null
    return {
      volume24: snap.volume24 ?? null,
      liquidity: null,
      marketCap: snap.marketCap ?? null,
      change4: null,
      change12: null,
      holders: null,
      txnCount24: null,
    }
  } catch (_) {
    return null
  }
}

// Tier 2 — bulk Hetzner /v1/coins/markets?ids=<csv>.
async function _tier2BulkMarkets(cgIds, deadline) {
  if (!cgIds.length) return new Map()
  try {
    const ids = cgIds.join(',')
    const url = `${SPECTRE_API_BASE}/v1/coins/markets?ids=${encodeURIComponent(ids)}&vs_currency=usd&per_page=${cgIds.length}`
    const resp = await _fetchWithRetry(url, {
      headers: {
        'X-API-Key': SPECTRE_DATA_KEY,
        Accept: 'application/json',
      },
    }, 'tier2 /v1/coins/markets', deadline)
    if (!resp || !resp.ok) return new Map()
    const rows = await resp.json().catch(() => null)
    if (!Array.isArray(rows)) return new Map()
    const byCgId = new Map()
    for (const r of rows) {
      if (!r?.id) continue
      byCgId.set(String(r.id).toLowerCase(), {
        volume24: r.total_volume ?? null,
        liquidity: null,
        marketCap: r.market_cap ?? null,
        change4: null,
        change12: null,
        holders: null,
        txnCount24: null,
      })
    }
    return byCgId
  } catch (err) {
    console.warn('[spectre-data] tier2 unexpected:', err?.message)
    return new Map()
  }
}

// Tier 4 — DexScreener public API. Free, no-auth fallback for DEX-only tokens
// (e.g. SPECTRE) where Hetzner scanner returns null liquidity/holders.
// Picks the highest-liquidity pair across all chains for the given address.
// Rate limit ~300 req/min/IP shared across Vercel — well below our needs.
async function _tier4DexScreener(address, deadline) {
  if (!address) return null
  return await _cachedProbe(`sd:ds:v1:${address.toLowerCase()}`, () =>
    _tier4DexScreenerUncached(address, deadline))
}

async function _tier4DexScreenerUncached(address, deadline) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`
    const resp = await _fetchWithRetry(url, {
      headers: { Accept: 'application/json' },
    }, `tier4 dexscreener/${address.slice(0, 8)}`, deadline)
    if (!resp) return undefined
    // Same rule as tier 3: only a 4xx is a cacheable "no such token".
    if (!resp.ok) return (resp.status === 400 || resp.status === 404) ? null : undefined
    const body = await resp.json().catch(() => null)
    const pairs = Array.isArray(body?.pairs) ? body.pairs : []
    if (!pairs.length) return null
    // Highest-liquidity pair wins (DexScreener already returns them sorted by
    // liquidity desc but we sort defensively in case that ever changes).
    const best = pairs.reduce((acc, p) => {
      const liq = Number(p?.liquidity?.usd) || 0
      return liq > (acc?._liq || 0) ? { ...p, _liq: liq } : acc
    }, null)
    if (!best) return null
    const txnsTotal = (Number(best?.txns?.h24?.buys) || 0) + (Number(best?.txns?.h24?.sells) || 0)
    return {
      volume24: Number(best?.volume?.h24) || null,
      liquidity: Number(best?.liquidity?.usd) || null,
      marketCap: Number(best?.marketCap) || Number(best?.fdv) || null,
      change4: null,
      change12: null,
      holders: null,
      txnCount24: txnsTotal || null,
    }
  } catch (_) {
    return undefined  // unexpected throw is transient too — never cache it
  }
}

// Tier 3 — per-token Hetzner /v1/scanner/token/{address}?chain={chain}.
async function _tier3Scanner(address, networkId, deadline) {
  const chain = chainSlugFromNetworkId(networkId)
  if (!address || !chain) return null
  // Cache key is address+chain: this is THE billed call in the whole helper.
  return await _cachedProbe(`sd:scan:v1:${chain}:${address.toLowerCase()}`, () =>
    _tier3ScannerUncached(address, chain, deadline))
}

async function _tier3ScannerUncached(address, chain, deadline) {
  try {
    const url = `${SPECTRE_API_BASE}/v1/scanner/token/${encodeURIComponent(address)}?chain=${chain}`
    const resp = await _fetchWithRetry(url, {
      headers: {
        'X-API-Key': SPECTRE_DATA_KEY,
        Accept: 'application/json',
      },
    }, `tier3 /v1/scanner/token/${address.slice(0, 8)}`, deadline)
    if (!resp) return undefined   // transient — do not cache as "no such token"
    // Only a client-side 4xx means "the box has no row for this address" and is
    // safe to remember. 5xx / 429 / 401 are the box having a moment (its
    // ingester stalls and bootstraps have gone 13s), and caching those as a miss
    // would blank a LIVE token's liquidity and holders platform-wide for the
    // whole negative TTL — strictly worse than paying for another probe.
    if (!resp.ok) return (resp.status === 400 || resp.status === 404) ? null : undefined
    const body = await resp.json().catch(() => null)
    const market = body?.data?.market || body?.market || {}
    const holders = body?.data?.holders ?? body?.holders ?? null
    const txnsTotal = (
      market.txns_24h_total
        ?? ((Number(market.txns_buys_24h) || 0) + (Number(market.txns_sells_24h) || 0))
    )
    return {
      volume24: market.volume_24h_usd ?? market.volume_24h ?? null,
      liquidity: market.liquidity_usd ?? market.liquidity ?? null,
      marketCap: market.market_cap_usd ?? market.market_cap ?? null,
      change4: null,
      change12: null,
      holders: typeof holders === 'number' ? holders : null,
      txnCount24: txnsTotal || null,
    }
  } catch (err) {
    return undefined  // unexpected throw is transient too — never cache it
  }
}

async function _allSettledBounded(items, fn, concurrency) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (err) {
        out[i] = { status: 'rejected', reason: err }
      }
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Bulk market-data backfill.
 *
 * @param {Array<{ address: string, networkId: number, cgId?: string }>} items
 * @param {{ budgetMs?: number, maxLookups?: number }} [options]
 *        budgetMs   wall-clock ceiling for the whole batch. Past it the billed
 *                   tiers stop issuing calls (not just stop being awaited).
 *        maxLookups hard cap on how many addresses may reach the billed tiers.
 *                   Items are consumed in input order, so callers that already
 *                   rank by liquidity spend the budget on their best rows.
 * @returns {Promise<Map<string, { volume24, liquidity, marketCap, change4, change12, holders, txnCount24 }>>}
 *          Keys are address.toLowerCase().
 */
export async function getMarketDataForAddresses(items, options = {}) {
  const result = new Map()
  if (!Array.isArray(items) || !items.length) return result

  const budgetMs = Number(options.budgetMs) > 0 ? Number(options.budgetMs) : 0
  const deadline = budgetMs ? Date.now() + budgetMs : 0
  const maxLookups = Number(options.maxLookups) > 0 ? Number(options.maxLookups) : 0

  const seen = new Map()
  for (const it of items) {
    if (!it?.address) continue
    const key = it.address.toLowerCase()
    if (!seen.has(key)) seen.set(key, it)
  }
  const dedup = Array.from(seen.values())

  const resolved = dedup.map((it) => {
    const cgId = it.cgId || _reverseCgId(it.address, it.networkId)
    return { ...it, cgId: cgId ? String(cgId).toLowerCase() : null }
  })

  const tier1Tasks = await Promise.allSettled(
    resolved.map(async (it) => {
      if (!it.cgId) return null
      return await _tier1Kv(it.cgId)
    })
  )

  const stillNeed = []
  for (let i = 0; i < resolved.length; i++) {
    const it = resolved[i]
    const t1 = tier1Tasks[i].status === 'fulfilled' ? tier1Tasks[i].value : null
    if (t1) {
      result.set(it.address.toLowerCase(), { ...EMPTY_BACKFILL, ...t1 })
      stillNeed.push({ ...it, _partial: true })
    } else {
      stillNeed.push(it)
    }
  }

  const tier2Wanted = stillNeed.filter((it) => it.cgId && !result.has(it.address.toLowerCase()))
  const tier2Map = tier2Wanted.length
    ? await _tier2BulkMarkets(Array.from(new Set(tier2Wanted.map((it) => it.cgId))), deadline)
    : new Map()
  for (const it of tier2Wanted) {
    const row = tier2Map.get(it.cgId)
    if (row) {
      result.set(it.address.toLowerCase(), { ...EMPTY_BACKFILL, ...row })
    }
  }

  // NOTE: tiers 1 and 2 always leave liquidity/holders/txnCount24 null, so this
  // condition is effectively "everything stillNeed" — a cheap hit above does NOT
  // spare the scanner call. That is intentional (those three fields exist only
  // on the scanner tier and callers do read them: calculateQualityScore
  // disqualifies rows under $1k liquidity, which is our anti-clone filter). The
  // cost is contained by the per-address cache in _cachedProbe plus maxLookups,
  // NOT by pretending a KV hit answered the question.
  const tier3Wanted = stillNeed.filter((it) => {
    const existing = result.get(it.address.toLowerCase())
    if (!existing) return true
    return existing.liquidity == null || existing.holders == null || existing.txnCount24 == null
  })
  const tier3Batch = maxLookups ? tier3Wanted.slice(0, maxLookups) : tier3Wanted
  if (tier3Batch.length < tier3Wanted.length) {
    console.warn(`[spectre-data] tier3 capped: ${tier3Batch.length}/${tier3Wanted.length} (maxLookups=${maxLookups})`)
  }
  let tier3Timeouts = 0
  if (tier3Batch.length) {
    const settled = await _allSettledBounded(
      tier3Batch,
      async (it) => await _tier3Scanner(it.address, it.networkId, deadline),
      TIER3_CONCURRENCY,
    )
    for (let i = 0; i < tier3Batch.length; i++) {
      const it = tier3Batch[i]
      const s = settled[i]
      if (s?.status !== 'fulfilled' || !s.value) {
        if (s?.status === 'rejected' && (s.reason?.name === 'AbortError' || s.reason?.name === 'TimeoutError')) {
          tier3Timeouts += 1
        }
        if (!result.has(it.address.toLowerCase())) {
          result.set(it.address.toLowerCase(), { ...EMPTY_BACKFILL })
        }
        continue
      }
      const t3 = s.value
      const prev = result.get(it.address.toLowerCase()) || { ...EMPTY_BACKFILL }
      result.set(it.address.toLowerCase(), {
        volume24: prev.volume24 ?? t3.volume24,
        liquidity: prev.liquidity ?? t3.liquidity,
        marketCap: prev.marketCap ?? t3.marketCap,
        change4: prev.change4 ?? t3.change4,
        change12: prev.change12 ?? t3.change12,
        holders: prev.holders ?? t3.holders,
        txnCount24: prev.txnCount24 ?? t3.txnCount24,
      })
    }
  }

  // Tier 4 — DexScreener for items where liquidity is still null after Tier 3.
  // Targets DEX-only tokens (SPECTRE etc.) whose CG row lacks liquidity and
  // whose Hetzner scanner row 400s or comes back partial.
  const tier4Wanted = dedup.filter((it) => {
    const existing = result.get(it.address.toLowerCase())
    if (!existing) return true
    return existing.liquidity == null
  })
  const tier4Batch = maxLookups ? tier4Wanted.slice(0, maxLookups) : tier4Wanted
  if (tier4Batch.length) {
    const settled = await _allSettledBounded(
      tier4Batch,
      async (it) => await _tier4DexScreener(it.address, deadline),
      TIER3_CONCURRENCY,
    )
    for (let i = 0; i < tier4Batch.length; i++) {
      const it = tier4Batch[i]
      const s = settled[i]
      if (s?.status !== 'fulfilled' || !s.value) continue
      const t4 = s.value
      const prev = result.get(it.address.toLowerCase()) || { ...EMPTY_BACKFILL }
      result.set(it.address.toLowerCase(), {
        volume24: prev.volume24 ?? t4.volume24,
        liquidity: prev.liquidity ?? t4.liquidity,
        marketCap: prev.marketCap ?? t4.marketCap,
        change4: prev.change4 ?? t4.change4,
        change12: prev.change12 ?? t4.change12,
        holders: prev.holders ?? t4.holders,
        txnCount24: prev.txnCount24 ?? t4.txnCount24,
      })
    }
  }

  for (const it of dedup) {
    if (!result.has(it.address.toLowerCase())) {
      result.set(it.address.toLowerCase(), { ...EMPTY_BACKFILL })
    }
  }

  if (tier3Timeouts > 0) {
    console.warn(`[spectre-data] tier3 timeouts: ${tier3Timeouts}/${tier3Batch.length}`)
  }

  return result
}

/**
 * Single-token convenience wrapper.
 */
export async function getMarketDataForAddress(address, networkId, cgId, options) {
  if (!address) return { ...EMPTY_BACKFILL }
  const map = await getMarketDataForAddresses([{ address, networkId, cgId }], options)
  return map.get(address.toLowerCase()) || { ...EMPTY_BACKFILL }
}

/**
 * Holder count probe for a single address. Returns null when not indexed.
 */
export async function getHoldersForAddress(address, chainOrNetworkId) {
  if (!address) return null
  let chain = null
  if (typeof chainOrNetworkId === 'string' && isNaN(Number(chainOrNetworkId))) {
    chain = chainOrNetworkId
  } else {
    chain = chainSlugFromNetworkId(chainOrNetworkId)
  }
  if (!chain) return null
  try {
    const url = `${SPECTRE_API_BASE}/v1/token/holders/${chain}/${encodeURIComponent(address)}`
    const resp = await _fetchWithRetry(url, {
      headers: {
        'X-API-Key': SPECTRE_DATA_KEY,
        Accept: 'application/json',
      },
    }, 'getHoldersForAddress')
    if (!resp || !resp.ok) return null
    const body = await resp.json().catch(() => null)
    if (body?.status === 'not_indexed') return null
    const count = body?.data?.count ?? body?.count ?? null
    return typeof count === 'number' ? count : null
  } catch (_) {
    return null
  }
}

export default {
  getMarketDataForAddresses,
  getMarketDataForAddress,
  getHoldersForAddress,
}
