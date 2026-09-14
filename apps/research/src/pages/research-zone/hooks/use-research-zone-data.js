/**
 * useResearchZoneData - unified data hook for Research Zone
 *
 * Replaces ~400 lines of data fetching in research-zone-lite.jsx with a single
 * hook that owns token resolution, parallel data fetching, polling, and
 * a price priority chain (App Research -> Binance -> CoinGecko -> Codex) plus App Research
 * market data as the primary source for token market cards.
 *
 * Usage:
 *   const data = useResearchZoneData('BTC', { isStock: false, marketMode: 'crypto' })
 *   data.price.current   // single canonical price
 *   data.loading.token   // true while resolving token identity
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getBinancePrices } from '@/services/binanceApi'
import { getCoinMarketDataBySymbol, getCoinDetails, getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { getDetailedTokenInfo, searchTokens } from '@/services/codexApi'
import { getAppResearchTokenMarketDataByToken } from '@/services/appResearchApi'
import { getSpectreTokenResolve, contractFromPlatforms } from '@/services/spectreMarketApi'
import { getStockQuote, getStockQuotes, getCompanyProfile, getStockLogoUrl, FALLBACK_STOCK_DATA } from '@/services/stockApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import useAssetStream from '@/hooks/useAssetStream'
import { MAJOR_TOKEN_INFO, SYMBOL_TO_COINGECKO_ID, COINGECKO_LOGOS } from '@/constants/majorTokens'
import { hasBinancePair, binancePairFor } from '@/services/binanceCatalog'
import { getRzBootstrap } from '@/services/spectreDataApi'
import { snapPeek, snapPut } from '@/lib/snapshotCache'
import { curatedTokenFacts } from '@/constants/curated-token-facts'

// ---------------------------------------------------------------------------
// Module-level caches (session lifetime)
// ---------------------------------------------------------------------------

const _tokenCache = new Map()  // symbol -> { symbol, name, cgId, codexId, binancePair, address, networkId, logo, rank, categories }
const _cache = {}              // { [key]: { data, ts } }
const _inflight = {}           // { [key]: Promise }

/** Pre-seed the token cache from search context (avoids redundant /api/token/resolve call) */
export function seedTokenCache(tokenData) {
  if (!tokenData?.symbol) return
  const sym = tokenData.symbol.toUpperCase()
  const existing = _tokenCache.get(sym)
  const newAddress = tokenData.address || null
  const existingAddress = existing?.address || null
  // Different on-chain token under the same symbol (e.g. two distinct ASTEROID
  // tokens): explicit user click wins. Evict stale derived caches so fresh data
  // is fetched for the newly selected address.
  if (existing && newAddress && existingAddress && existingAddress.toLowerCase() !== newAddress.toLowerCase()) {
    delete _cache[`price:${sym}`]
    delete _cache[`meta:${sym}`]
    if (existing.cgId) delete _cache[`details:${existing.cgId}`]
    delete _cache[`details:${sym}`]
    delete _cache[`onchain:${existingAddress}:${existing.networkId || 1}`]
  } else if (existing && !newAddress) {
    // New seed has no address — don't clobber richer server-resolved data.
    return
  }
  _tokenCache.set(sym, {
    symbol: sym,
    name: tokenData.name || sym,
    cgId: tokenData.cgId || null,
    codexId: tokenData.codexId || tokenData.codex_id || tokenData.address || null,
    tokenId: tokenData.tokenId || tokenData.token_id || null,
    binancePair: null,
    address: newAddress,
    networkId: tokenData.networkId || null,
    logo: tokenData.logo || null,
    rank: null,
    categories: null,
  })
}

const TTL = {
  price: 10_000,       // 10s
  meta: 300_000,       // 5min (was 60s — CG burn defense; mcap/supply don't move that fast)
  details: 300_000,    // 5min
  profile: 300_000,    // 5min
  onchain: 300_000,    // 5min — aligned to the onchain poll interval (300s, see
                       // pollOnchain useAdaptivePolling below). When TTL < the poll
                       // interval the _deduped cache always expires before the next
                       // tick, so the dedup never spared a single poll fetch. Holders /
                       // liquidity / txn-count drift over minutes, so a 5min TTL is safe.
  trending: 300_000,   // 5min
}

// Cadence for the Codex read on DEX-primary tokens, where that read is the
// live price lane rather than a research-tier refresh (see pollOnchain).
const ONCHAIN_PRICE_TTL = 60_000

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) {
    delete _cache[key]
    return null
  }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

function _deduped(cacheKey, ttlMs, fetchFn) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]

  const promise = fetchFn()
    .then(data => {
      _setCached(cacheKey, data)
      delete _inflight[cacheKey]
      return data
    })
    .catch(err => {
      delete _inflight[cacheKey]
      console.error(`[RZ Hook] ${cacheKey} failed:`, err?.message || err)
      return null
    })

  _inflight[cacheKey] = promise
  return promise
}

// ---------------------------------------------------------------------------
// Stock trending symbols (same list as research-zone-lite.jsx)
// ---------------------------------------------------------------------------

const STOCK_TRENDING_SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  'JPM', 'V', 'AMD', 'NFLX', 'DIS', 'BA', 'GS', 'COST',
]

// ---------------------------------------------------------------------------
// Empty state defaults
// ---------------------------------------------------------------------------

const EMPTY_LOADING = { token: true, price: true, market: true, onchain: true, about: true }

// How long the chart may hold its shimmer waiting for an address (2026-08-26).
// `resolveToken` is a multi-hop chain (box resolve + a CG platform lookup ->
// /api/token/resolve, which itself fans out to CG /coins + CG /search +
// convert_ids + Codex -> Codex search), and the chart now BLOCKS on it
// (identityPending). Every rung is individually timed out, but the chain as a
// whole still has no ceiling — so give it one. Past the deadline the page
// renders a symbol-only identity honestly; a late address still lands and
// upgrades the chart when it arrives.
const IDENTITY_RESOLVE_DEADLINE_MS = 9000

// Codex sometimes returns change as a decimal ratio (0.17 = +17%) and sometimes
// as a percentage (17 = +17%). When |v| ≤ 1 and non-zero, treat it as a ratio.
// DexScreener / Binance always return percentages, so they're unaffected.
const normalizeChangePercent = (v) => {
  const n = parseFloat(v)
  if (!Number.isFinite(n) || n === 0) return null
  return Math.abs(n) <= 1 ? n * 100 : n
}

const EMPTY_PRICE = { current: null, change24h: null, high24h: null, low24h: null, volume24h: null, source: null }
const EMPTY_ALL_PRICES = { appresearch: null, binance: null, coingecko: null, codex: null }
const EMPTY_MARKET = {
  mcap: null, fdv: null, circulatingSupply: null, totalSupply: null, volMcapPct: null,
  volume24h: null,
  ath: null, athDate: null, athChangePct: null, atl: null, atlDate: null, atlChangePct: null,
  support: null, resistance: null, keyLevels: null,
}
const EMPTY_PERFORMANCE = { change1h: null, change7d: null, change30d: null, change1y: null, sparkline7d: null }

function mergeProfileMarket(profile, fallback = EMPTY_MARKET) {
  if (!profile) return fallback
  return {
    ...fallback,
    mcap: profile.mcap ?? profile.marketCap ?? fallback.mcap,
    fdv: profile.fdv ?? profile.fullyDilutedValuation ?? fallback.fdv,
    circulatingSupply: profile.circulatingSupply ?? profile.circulating ?? fallback.circulatingSupply,
    totalSupply: profile.totalSupply ?? profile.maxSupply ?? fallback.totalSupply,
    volMcapPct: profile.volMcapPct ?? fallback.volMcapPct,
    volume24h: profile.volume24h ?? profile.volume ?? fallback.volume24h,
    ath: profile.ath ?? fallback.ath,
    athDate: profile.athDate ?? fallback.athDate,
    athChangePct: profile.athChangePct ?? fallback.athChangePct,
    atl: profile.atl ?? fallback.atl,
    atlDate: profile.atlDate ?? fallback.atlDate,
    atlChangePct: profile.atlChangePct ?? fallback.atlChangePct,
    support: profile.support ?? profile.keyLevels?.support ?? fallback.support,
    resistance: profile.resistance ?? profile.keyLevels?.resistance ?? fallback.resistance,
    keyLevels: profile.keyLevels ?? fallback.keyLevels,
    source: 'appresearch',
  }
}

function mergeProfilePerformance(profile, fallback = EMPTY_PERFORMANCE) {
  if (!profile) return fallback
  return {
    ...fallback,
    change1h: profile.change1h ?? fallback.change1h,
    change7d: profile.change7d ?? fallback.change7d,
    change30d: profile.change30d ?? fallback.change30d,
    source: 'appresearch',
  }
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

async function resolveToken(symbol) {
  if (!symbol) return null
  const sym = symbol.toUpperCase()

  // Check module cache first. ONE RULE (2026-08-24, ZIG): only a CHART-READY
  // identity (address or real Binance pair) short-circuits the resolve. A
  // chartless entry — seeded from a snapshot, a nav click without an address,
  // or a previous failed resolve — is a paint hint, not an answer: returning
  // it here is what latched ZIG address-less for a whole browser profile
  // (bare-ticker bars → no_data → line-only, Candles + TV disabled, and the
  // snapshot writer re-persisted the broken identity on every visit). It now
  // falls through as the resolve's starting candidate instead, keeping its
  // name/logo/cgId hints while the chain finds the address.
  const cachedIdentity = _tokenCache.get(sym)
  if (isChartReadyIdentity(cachedIdentity)) return cachedIdentity

  // Hardcoded majors (BTC, ETH, SOL, SPECTRE, …) have everything we need
  // already. Skip the network round-trip — this single change shaves
  // 1-3s off Research Zone first-paint for the most-trafficked tokens.
  // Async resolution can still enrich later if needed.
  const majorInfo = MAJOR_TOKEN_INFO[sym]
  if (majorInfo) {
    const identity = {
      symbol: sym,
      name: majorInfo.name || sym,
      cgId: SYMBOL_TO_COINGECKO_ID[sym] || null,
      codexId: majorInfo.address || null,
      tokenId: null,
      binancePair: binancePairFor(sym),
      address: majorInfo.address || null,
      networkId: majorInfo.networkId ?? null,
      logo: COINGECKO_LOGOS[sym] || null,
      rank: null,
      categories: null,
    }
    _tokenCache.set(sym, identity)
    return identity
  }

  // Prefer the cached Spectre data bridge. The old /api/token/resolve path is
  // still valid in production, but local Vite dev proxies generic /api to the
  // legacy app server and produces false 500s for common symbols.
  //
  // CHART-READY RULE (audit 2026-06-10): an identity is only final when it
  // can actually drive a chart — it has an address (DEX tiers: candle store,
  // GT, Codex) or a real Binance pair (CEX tier). A symbol-only identity
  // previously short-circuited here for EVERY non-major token, so the
  // address-bearing fallbacks below never ran and charts degraded to the
  // plain-symbol bars path. Symbol-only results are now kept as a candidate
  // and enriched by the later resolvers.
  let candidate = cachedIdentity || null
  try {
    const data = await getSpectreTokenResolve(symbol)
    if (data?.symbol) {
      const identity = {
        symbol: (data.symbol || sym).toUpperCase(),
        name: data.name || sym,
        cgId: data.cgId || data.coingeckoId || null,
        codexId: data.codexId || data.codex_id || data.address || null,
        tokenId: data.tokenId || data.token_id || data.codexId || null,
        // Resolve endpoints fabricate `${symbol}USDT` for EVERY token —
        // validate against the real Binance catalog or the chart routes
        // non-CEX tokens to the DexScreener iframe (audit 2026-06-10).
        binancePair: data.binancePair ? binancePairFor((data.symbol || sym).toUpperCase()) : null,
        address: data.address || null,
        networkId: data.networkId || null,
        logo: data.logo || null,
        rank: data.rank || null,
        categories: data.categories || null,
      }
      if (identity.address || identity.binancePair) {
        _tokenCache.set(sym, identity)
        if (symbol !== sym) _tokenCache.set(symbol, identity)
        if (identity.symbol !== sym) _tokenCache.set(identity.symbol, identity)
        return identity
      }
      candidate = identity
    }
  } catch (err) {
    // Keep falling through to production/local legacy resolution.
  }

  // DEV/PROD PARITY (2026-08-24): this rung used to be skipped on localhost
  // ("local Vite dev proxies generic /api to the legacy app server and
  // produces false 500s"). That is stale — Express serves /api/token/resolve
  // itself now and answers correctly for both tickers and CG slugs (verified
  // on 'zig' and 'zignaly'). Skipping it left DEV with only two rungs, so a
  // slug whose upstream resolver hiccuped fell straight to the Codex ticker
  // search and charted a pump.fun clone. Failures still fall through to the
  // rungs below, so re-enabling it can only add a correct answer.
  // Send original case so the server can detect CoinGecko slugs.
  try {
    {
      // Bounded like every other rung (2026-08-26): this route now fans out
      // to CG /coins + CG /search + convert_ids + Codex behind one request, so
      // a slow upstream can hold it for tens of seconds — and the chart waits
      // on this chain. The hook's own deadline releases the UI either way;
      // this keeps the promise itself from leaking.
      const res = await fetch(`/api/token/resolve?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json()
        if (data && data.symbol) {
          const identity = {
            symbol: (data.symbol || sym).toUpperCase(),
            name: data.name || sym,
            cgId: data.cgId || data.coingeckoId || null,
            codexId: data.codexId || data.codex_id || data.address || null,
            tokenId: data.tokenId || data.token_id || data.codexId || null,
            // Same catalog validation as the Spectre-resolve path above —
            // /api/token/resolve fabricates `${symbol}USDT` for every token.
            binancePair: data.binancePair ? binancePairFor((data.symbol || sym).toUpperCase()) : null,
            address: data.address || null,
            networkId: data.networkId || null,
            logo: data.logo || null,
            rank: data.rank || null,
            categories: data.categories || null,
          }
          // WRONG-TOKEN GUARD (2026-08-25, the "M" repro): when the chain
          // already holds a CG-BACKED candidate (cgId) and this rung's answer
          // is NOT CG-backed, its address came from a ticker-keyed match —
          // the clone class (dev resolve returned a Monad-testnet "M" clone
          // for MemeCore). A wrong token is worse than a chartless one: keep
          // the CG candidate; the CG-platforms fallback in
          // getSpectreTokenResolve finds the ratified contract instead.
          const clashesWithCgCandidate = !!(candidate?.cgId && !identity.cgId)
          if ((identity.address || identity.binancePair) && !clashesWithCgCandidate) {
            _tokenCache.set(sym, identity)
            // Also cache by original input (e.g. 'world-liberty-financial') and resolved symbol
            if (symbol !== sym) _tokenCache.set(symbol, identity)
            if (identity.symbol !== sym) _tokenCache.set(identity.symbol, identity)
            return identity
          }
          if (!candidate) candidate = identity
        }
      }
    }
  } catch (err) {
    console.error('[RZ Hook] Token resolve failed:', err?.message || err)
  }

  // Fallback: search via Codex — the address authority of last resort.
  // Merged with the symbol-only candidate (CG identity: name/logo/cgId/rank)
  // so we keep the richer metadata AND gain the chart-ready address.
  //
  // TICKER-SHAPED QUERIES ONLY (2026-08-24, the /research-zone/zignaly repro).
  // Codex indexes on-chain tokens BY TICKER; a Research Zone URL slug is a
  // CoinGecko id ('zignaly', 'pax-gold', 'world-liberty-financial'), which is
  // not a ticker. Searching Codex for one matches on NAME, and pump.fun clone
  // farms mint exactly those names: 'ZIGNALY' returned four Solana clones,
  // the first ("Zignaly AI", F4Rthvcn…pump, $0.00000556) was taken as ZIG's
  // address and cached — the page then showed the clone's price and routed
  // the chart to the clone's DexScreener pair. A slug that reaches this rung
  // means the CG-backed resolvers above failed, and a wrong token is worse
  // than a chartless one: keep the symbol-only candidate instead. Same rule
  // the prewarm effect below already uses to tell tickers from slugs.
  const tickerShaped = /^[A-Z0-9]{1,6}$/.test(sym)
  try {
    // CG-BACKED candidates never take an address from a ticker search: Codex
    // matches by ticker/name and clone farms mint exactly those (same rule as
    // the slug gate above, extended 2026-08-25 after "M" charted a testnet
    // clone). For CG-listed tokens the contract comes from CG's own platform
    // record via getSpectreTokenResolve; staying chartless beats a twin.
    const result = (tickerShaped && !candidate?.cgId) ? await searchTokens(sym) : null
    const tokens = result?.filterTokens?.results || []
    const match = tokens.find(r => (r.token?.symbol || '').toUpperCase() === sym) || tokens[0]
    if (match?.token) {
      const identity = {
        symbol: sym,
        name: candidate?.name || match.token.name || sym,
        cgId: candidate?.cgId || null,
        codexId: match.token.address || null,
        tokenId: null,
        binancePair: candidate?.binancePair || null,
        address: match.token.address || null,
        networkId: match.token.networkId || null,
        logo: candidate?.logo || match.token.imageLargeUrl || match.token.imageSmallUrl || null,
        rank: candidate?.rank || null,
        categories: candidate?.categories || null,
      }
      _tokenCache.set(sym, identity)
      return identity
    }
  } catch (_) { /* fall through */ }

  // Symbol-only candidate (if any) beats a bare minimal identity. Caching it
  // is safe for paint continuity — it is NOT chart-ready, so the next
  // resolveToken call falls through the cache check above and retries the
  // full chain instead of latching the failure (2026-08-24 ZIG).
  const fallback = candidate || { symbol: sym, name: sym, cgId: null, codexId: null, tokenId: null, binancePair: null, address: null, networkId: null, logo: null, rank: null, categories: null }
  _tokenCache.set(sym, fallback)
  return fallback
}

// An identity can drive a chart only via address (DEX tiers) or a real Binance
// pair (CEX tier) — the file's own CHART-READY RULE. Only such identities may
// short-circuit resolveToken; anything else is a paint hint / resolve candidate.
function isChartReadyIdentity(identity) {
  return !!(identity && (identity.address || identity.binancePair))
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

// PR-4 (perf): read the persisted snapshot of this hook's own mapped state
// (written by the effect below after each successful merge). Restoring state
// we wrote ourselves means zero shape-coupling to any upstream API. Returns
// null when absent/stale/invalid.
// IDENTITY VERSION GATE (2026-08-25). Chart-ready snapshot identities written
// by the PRE-FIX resolve chain can carry a WRONG address (ticker-clone class:
// "M" latched a Monad-testnet token, HYPE latched a dead identity) — and a
// chart-ready identity SHORT-CIRCUITS resolveToken, so the poison latches
// forever in that browser. Bump this when the resolve chain's identity
// contract changes: un-versioned identities are demoted to PAINT HINTS
// (name/logo/cgId keep the hero instant), the resolve chain re-runs once,
// and its result re-persists stamped with the current version. Self-heals
// every poisoned browser without hand-clearing localStorage.
const RZ_IDENTITY_V = 2

function peekRzStateSnapshot(sym, isStock) {
  if (isStock || !sym) return null
  const snap = snapPeek(`rz-state:${sym}`)
  const data = snap?.data
  if (!data || !(data.price?.current > 0)) return null
  const id = data.identity
  if (id && id.v !== RZ_IDENTITY_V) {
    return {
      ...data,
      identity: { ...id, address: null, networkId: null, codexId: null, tokenId: null, binancePair: null },
    }
  }
  return data
}

export default function useResearchZoneData(symbol, options = {}) {
  const { isStock = false, marketMode = 'crypto', initialToken = null } = options
  const sym = (symbol || '').toUpperCase()

  // Skip the resolve waterfall when the caller already knows the identity.
  // For non-major tokens, resolveToken() is a sequential 3-hop fallback
  // (CG /search -> Spectre /token/resolve -> Codex filterTokens) that BLOCKS
  // effect 2's parallel data fetch — the dominant cold first-paint cost. The
  // nav click (watchlist / welcome / URL deep-link) usually already carries
  // cgId and/or address, so when initialToken matches this symbol we seed the
  // module cache HERE, during render, before effect 1 runs. resolveToken then
  // short-circuits on its `_tokenCache.has(sym)` check (no network hops).
  //
  // Relied-on initialToken fields (all validated upstream in
  // research-zone-routing.js readResearchZoneTokenFromSearch): symbol (gate),
  // cgId, address, networkId, codexId, tokenId, name. A cgId-only seed is
  // enough to skip the waterfall; the address-keyed chart/onchain tiers still
  // backfill lazily via the CG-platforms enrichment in effect 2 (chart-ready
  // invariant preserved). Address-bearing seeds unlock those tiers immediately.
  //
  // The component (research-zone-lite.jsx) also calls seedTokenCache(initialToken)
  // directly; doing it inside the hook too makes the skip robust if the module
  // cache was evicted (e.g. an intervening different-address seed) and removes
  // the hidden coupling to the caller remembering to seed. seedTokenCache is
  // idempotent and carries the same-symbol/different-address eviction logic, so
  // a redundant call is a no-op.
  if (!isStock && initialToken?.symbol && initialToken.symbol.toUpperCase() === sym
      && (initialToken.cgId || initialToken.address)) {
    seedTokenCache(initialToken)
  }

  // PR-4 (perf): stale-while-revalidate hydration. On mount, restore the last
  // good price/market/performance/identity for this symbol from localStorage
  // so the hero renders real numbers at the FIRST React commit (CMC-style),
  // while effects 1/1.5/2 run unchanged and silently refresh in place.
  // Mount-only: token switches go through the set-during-render reset below.
  const mountSnapRef = useRef(undefined)
  if (mountSnapRef.current === undefined) {
    mountSnapRef.current = peekRzStateSnapshot(sym, isStock)
    // Seed the resolve cache so effect 1 short-circuits the multi-hop resolve
    // chain - but never clobber a richer identity (e.g. URL-seeded) already
    // there. Safe to seed a chartless snapshot identity: resolveToken only
    // short-circuits on CHART-READY entries and uses the rest as candidates.
    const snapIdentity = mountSnapRef.current?.identity
    if (snapIdentity?.symbol && !_tokenCache.has(sym)) {
      _tokenCache.set(sym, snapIdentity)
    }
  }
  const mountSnap = mountSnapRef.current

  // Core state
  const [tokenIdentity, setTokenIdentity] = useState(mountSnap?.identity || null)
  const [priceData, setPriceData] = useState(mountSnap?.price || EMPTY_PRICE)
  const [marketData, setMarketData] = useState(mountSnap?.market || EMPTY_MARKET)
  const [performanceData, setPerformanceData] = useState(mountSnap?.performance || EMPTY_PERFORMANCE)
  const [onchainData, setOnchainData] = useState(null)
  const [aboutData, setAboutData] = useState(null)
  const [trendingData, setTrendingData] = useState([])
  const [stockQuoteData, setStockQuoteData] = useState(null)
  const [allPricesData, setAllPricesData] = useState(EMPTY_ALL_PRICES)
  const [loading, setLoading] = useState(mountSnap
    ? { token: !mountSnap.identity, price: false, market: false, onchain: true, about: true }
    : EMPTY_LOADING)
  // IS THE RESOLVE ACTUALLY IN FLIGHT? (2026-08-26)
  // `loading.token` cannot answer this: it goes false the moment ANY cached
  // identity exists — including a chartless one (a snapshot seed, a nav click
  // without an address, a version-demoted identity). The chart's shimmer gate
  // needs the real thing, or it stays off for exactly the tokens it was built
  // for and the false "Chart unavailable" flashes anyway. Stocks never resolve.
  const [identityResolving, setIdentityResolving] = useState(!isStock)

  // Ref to track the current symbol to prevent stale updates
  const activeSymRef = useRef(sym)

  // Set-during-render reset: when `symbol` changes, wipe the previous token's
  // price / market / performance / etc. SYNCHRONOUSLY before this render
  // commits — otherwise the consumer would render the previous token's data
  // for one frame while our effect waits to run. Identity is set from cache
  // when available so name/logo don't flash.
  const [prevSym, setPrevSym] = useState(sym)
  if (sym !== prevSym) {
    setPrevSym(sym)
    // PR-4 (perf): on token switch, restore the new symbol's snapshot instead
    // of wiping to skeletons - same stale-while-revalidate as the mount path.
    const switchSnap = peekRzStateSnapshot(sym, isStock)
    setPriceData(switchSnap?.price || EMPTY_PRICE)
    setMarketData(switchSnap?.market || EMPTY_MARKET)
    setPerformanceData(switchSnap?.performance || EMPTY_PERFORMANCE)
    setOnchainData(null)
    setAboutData(null)
    setStockQuoteData(null)
    setAllPricesData(EMPTY_ALL_PRICES)
    const snapIdentity = switchSnap?.identity
    if (snapIdentity?.symbol && sym && !_tokenCache.has(sym)) {
      _tokenCache.set(sym, snapIdentity)
    }
    // The resolve effect re-runs for the new symbol; mark it in flight NOW so
    // the chart's shimmer gate holds through the commit before the effect.
    setIdentityResolving(!isStock)
    const cachedIdentity = sym ? _tokenCache.get(sym) : null
    if (cachedIdentity) {
      setTokenIdentity(cachedIdentity)
      setLoading({
        token: false,
        price: !switchSnap,
        market: !switchSnap,
        onchain: true,
        about: true,
      })
    } else {
      setTokenIdentity(null)
      setLoading(switchSnap
        ? { token: true, price: false, market: false, onchain: true, about: true }
        : EMPTY_LOADING)
    }
  }

  // -----------------------------------------------------------------------
  // 1. RESOLVE TOKEN on symbol change
  // -----------------------------------------------------------------------

  useEffect(() => {
    activeSymRef.current = sym
    if (!sym) return

    // Note: the set-during-render block above (sym !== prevSym branch) already
    // wipes priceData/marketData/etc. synchronously BEFORE this effect runs.
    // Repeating the resets here was causing a second render after commit.
    //
    // DO NOT delete _cache entries here: the parallel-fetch effect below
    // re-runs whenever tokenIdentity is enriched (logo/rank/cgId backfill),
    // and an unconditional cache wipe defeats the _deduped TTL — every
    // enrichment caused a second round-trip for every source (~9x CG, 2-3x
    // data-api dupes in the wild). Cache keys already namespace by symbol,
    // so cross-token contamination is impossible.

    if (isStock) {
      // Stocks skip token resolution - use symbol directly
      const stockIdentity = {
        symbol: sym,
        name: FALLBACK_STOCK_DATA[sym]?.name || sym,
        cgId: null,
        codexId: null,
        binancePair: null,
        address: null,
        networkId: null,
        logo: getStockLogoUrl(sym),
        rank: null,
        categories: null,
      }
      setTokenIdentity(stockIdentity)
      setLoading(prev => ({ ...prev, token: false }))
      setIdentityResolving(false)
      return
    }

    let cancelled = false
    let released = false
    // ONE release path for all three endings — resolved, threw, or ran past
    // the deadline. The chart holds a shimmer while `identityResolving` is
    // true, so every ending MUST clear it: a flag that never clears is a
    // permanently blank chart, which is worse than the bare-ticker chart this
    // gate exists to prevent.
    const release = () => {
      if (released || cancelled || activeSymRef.current !== sym) return
      released = true
      setLoading(prev => (prev.token ? { ...prev, token: false } : prev))
      setIdentityResolving(false)
      // Deadline path: nothing set an identity, so give the page a symbol-only
      // one instead of leaving consumers with `null` (the chart would fall
      // back to its own default symbol). A late resolve still upgrades it.
      setTokenIdentity(prev => prev || {
        symbol: sym, name: sym, cgId: null, codexId: null, tokenId: null,
        binancePair: null, address: null, networkId: null, logo: null,
        rank: null, categories: null,
      })
    }
    const deadline = setTimeout(release, IDENTITY_RESOLVE_DEADLINE_MS)

    resolveToken(sym).then(identity => {
      if (cancelled || activeSymRef.current !== sym) return
      // Applied even if the deadline already fired — a late address is still
      // an upgrade over the symbol-only placeholder.
      setTokenIdentity(identity)
      release()
    }).catch(() => {
      // resolveToken try/catches every rung and always returns a fallback, so
      // this should be unreachable — but release() must not depend on that.
      release()
    })

    return () => { cancelled = true; clearTimeout(deadline) }
  }, [sym, isStock])

  // -----------------------------------------------------------------------
  // 1.5 PREWARM symbol-keyed sources in parallel with the resolve
  // -----------------------------------------------------------------------
  // resolveToken is a multi-hop chain for non-major tokens (spectre resolve
  // -> /api/token/resolve -> Codex), and effect 2 only starts once it
  // settles - so first visits paid resolve + data SERIALLY. These three
  // sources need nothing from the resolve, and they use the SAME _deduped
  // keys effect 2 uses: by the time it fires, its calls join the in-flight
  // promise or hit the warm cache. Zero duplicate upstream calls, pure
  // overlap. Address-keyed work (onchain, chart tiers) still waits for the
  // resolved identity - the chart-ready invariant from #830 is untouched.
  // Slug-style symbols (e.g. 'pax-gold'): effect 2 keys by the RESOLVED
  // ticker, so a slug-keyed prewarm alone would miss the cache. PR-3: fire
  // the bootstrap anyway (the bridge matches cgId slugs) and ALIAS the
  // result into the resolved-ticker key the moment the response names the
  // ticker - slug deep links then get the same resolve/data overlap that
  // ticker links have, still with zero duplicate upstream calls.
  useEffect(() => {
    if (!sym || isStock) return
    const upper = String(sym).toUpperCase()
    if (!/^[A-Z0-9]{1,12}$/.test(upper)) {
      _deduped(`rz-bootstrap:${upper}`, TTL.price, () => getRzBootstrap(upper))
        .then((bs) => {
          const ticker = String(bs?.identity?.symbol || bs?.symbol || '').toUpperCase()
          if (ticker && ticker !== upper && /^[A-Z0-9]{1,12}$/.test(ticker)) {
            _setCached(`rz-bootstrap:${ticker}`, bs)
          }
        })
        .catch(() => {})
      return
    }
    _deduped(`rz-bootstrap:${upper}`, TTL.price, () => getRzBootstrap(upper)).catch(() => {})
    _deduped(`price:${upper}`, TTL.price, () => getBinancePrices([upper])).catch(() => {})
    _deduped(`meta:${upper}`, TTL.meta, () => getCoinMarketDataBySymbol(upper)).catch(() => {})
  }, [sym, isStock])

  // -----------------------------------------------------------------------
  // 1.6 PERSIST the mapped state snapshot (stale-while-revalidate writer)
  // -----------------------------------------------------------------------
  // Once real data has settled, persist OUR OWN state shapes so the next
  // visit (even after a full reload) hydrates them at first commit. Writing
  // the mapped state - not raw API payloads - means upstream shape drift
  // can never poison hydration. snapPut is idle-scheduled, refuses empty
  // payloads, and the loading guards mean a gated/failed session (which
  // leaves loading flags true / price null) never overwrites a good snapshot.
  useEffect(() => {
    if (isStock || !sym) return
    if (loading.price || loading.market) return
    if (!(priceData?.current > 0)) return
    snapPut(`rz-state:${sym}`, {
      price: priceData,
      market: marketData,
      performance: performanceData,
      // Stamped with the identity version — see RZ_IDENTITY_V above.
      identity: tokenIdentity ? { ...tokenIdentity, v: RZ_IDENTITY_V } : null,
    })
  }, [sym, isStock, loading.price, loading.market, priceData, marketData, performanceData, tokenIdentity])

  // -----------------------------------------------------------------------
  // 2. PARALLEL INITIAL FETCH after token resolved
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!tokenIdentity || !sym) return
    if (activeSymRef.current !== sym) return
    let cancelled = false

    if (isStock) {
      // Stock mode: parallel fetch stock data
      const fetchStockData = async () => {
        const [quoteResult, profileResult, trendingResult] = await Promise.allSettled([
          getStockQuote(sym),
          getCompanyProfile(sym),
          getStockQuotes(STOCK_TRENDING_SYMBOLS.filter(s => s !== sym)),
        ])

        if (cancelled || activeSymRef.current !== sym) return

        // Price from stock quote
        const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null
        if (quote) {
          setPriceData({
            current: quote.price ?? null,
            change24h: quote.change ?? null,
            high24h: quote.high ?? quote.week52High ?? null,
            low24h: quote.low ?? quote.week52Low ?? null,
            volume24h: quote.volume ?? null,
            source: 'stock',
          })
          setStockQuoteData(quote)
          setLoading(prev => ({ ...prev, price: false }))

          // Market data from stock quote
          setMarketData({
            mcap: quote.marketCap ?? null,
            fdv: null,
            circulatingSupply: quote.sharesOutstanding ?? null,
            totalSupply: null,
            volMcapPct: (quote.marketCap && quote.volume) ? ((quote.volume / quote.marketCap) * 100).toFixed(1) : null,
            volume24h: quote.volume ?? null,
            ath: quote.week52High ?? null, athDate: null, athChangePct: null,
            atl: quote.week52Low ?? null, atlDate: null, atlChangePct: null,
          })
          setLoading(prev => ({ ...prev, market: false }))
        } else {
          setLoading(prev => ({ ...prev, price: false, market: false }))
        }

        // About from company profile
        const profile = profileResult.status === 'fulfilled' ? profileResult.value : null
        if (profile) {
          setAboutData({
            description: profile.description || `${profile.name || sym} trades on the ${profile.exchange || 'US'} exchange in the ${profile.sector || 'N/A'} sector.`,
            links: { homepage: profile.website || null },
            categories: profile.sector ? [profile.sector] : [],
          })
          // Update stock quote data with richer profile fields
          setStockQuoteData(prev => prev ? { ...prev, ...profile } : profile)
        }
        setLoading(prev => ({ ...prev, about: false, onchain: false }))

        // Trending stocks
        const trendingQuotes = trendingResult.status === 'fulfilled' ? trendingResult.value : {}
        const trendingItems = STOCK_TRENDING_SYMBOLS
          .filter(s => s !== sym)
          .map(s => {
            const q = trendingQuotes[s]
            if (!q) return null
            return {
              id: s,
              symbol: s,
              name: q.name,
              image: getStockLogoUrl(s),
              current_price: q.price,
              price_change_percentage_24h: q.change,
              isStock: true,
            }
          })
          .filter(Boolean)
        setTrendingData(trendingItems)
      }

      fetchStockData()
      return () => { cancelled = true }
    }

    // Crypto mode: parallel fetch
    const fetchCryptoData = async () => {
      const { address, networkId, cgId, codexId, tokenId } = tokenIdentity
      // Use resolved symbol for API lookups (e.g. 'PAXG' not 'PAX-GOLD' from URL slug)
      const resolvedSym = tokenIdentity.symbol || sym
      const marketDataCacheKey = `market-data:${cgId || codexId || address || tokenId || resolvedSym}`

      // Trending is fetched lazily (see effect below) — only when consumer
      // actually mounts something that needs it. Avoids a CG call per token nav.
      // RZ Bootstrap (Spectre Data API composite) is fetched in parallel with
      // the legacy fan-out: when it returns data, it's the highest-priority
      // source; when it's missing/null, the legacy chain still completes the
      // picture. Keeps the migration safe while the backend rolls out.
      // Per-source streaming: fire each fetch as an independent promise so the
      // fastest source paints the UI immediately. The slowest source no longer
      // gates first paint. After all settle, the comprehensive merge below
      // re-resolves cross-source priorities (idempotent).
      const isFresh = () => !cancelled && activeSymRef.current === sym
      // Key bootstrap by the RAW sym (the same key effect 1.5 prewarms under),
      // not the resolved ticker. For a slug deep link ('pax-gold') the prewarm
      // fired `rz-bootstrap:PAX-GOLD`; if resolve finished first (warm
      // _tokenCache / initialToken seed) effect 2 used to fire a SECOND upstream
      // under `rz-bootstrap:PAXG` before the alias landed. Same raw key = effect
      // 2 always joins the in-flight prewarm promise (the bridge matches slugs).
      // For a clean ticker link, sym.toUpperCase() === resolvedSym, so unchanged.
      const bootstrapPromise = _deduped(`rz-bootstrap:${String(sym).toUpperCase()}`, TTL.price, () => getRzBootstrap(resolvedSym))
      const binancePromise = _deduped(`price:${resolvedSym}`, TTL.price, () => getBinancePrices([resolvedSym]))
      const cgMarketPromise = _deduped(`meta:${resolvedSym}`, TTL.meta, () => getCoinMarketDataBySymbol(resolvedSym))
      const cgDetailsPromise = _deduped(`details:${cgId || resolvedSym}`, TTL.details, () => getCoinDetails(resolvedSym, cgId))
      const codexPromise = address ? _deduped(`onchain:${address}:${networkId}`, TTL.onchain, () => getDetailedTokenInfo(address, networkId || 1)) : Promise.resolve(null)
      const marketDataPromise = _deduped(marketDataCacheKey, TTL.profile, () => getAppResearchTokenMarketDataByToken({
        symbol: resolvedSym,
        cgId,
        codexId,
        tokenId,
        address,
      }))

      // Identity address-backfill (audit 2026-06-10): when every resolver
      // missed the contract (search coverage hole, resolve 404), the CG
      // details fetch this page ALREADY makes carries `platforms`. Use it as
      // the address authority of last resort — enriching tokenIdentity
      // re-runs this effect (dedup makes that cheap, see comment above) and
      // unlocks the address-keyed chart tiers + onchain fetch.
      if (!address && !tokenIdentity.binancePair) {
        cgDetailsPromise.then((details) => {
          if (!isFresh()) return
          const contract = contractFromPlatforms(details)
          if (!contract) return
          const enriched = {
            ...tokenIdentity,
            address: contract.address,
            networkId: contract.networkId,
            codexId: tokenIdentity.codexId || contract.address,
          }
          _tokenCache.set(sym, enriched)
          if (enriched.symbol && enriched.symbol !== sym) _tokenCache.set(enriched.symbol, enriched)
          setTokenIdentity(enriched)
        }).catch(() => {})
      }

      // Early-paint: stream price from whichever of bootstrap/binance lands first.
      // The comprehensive merge below still runs once everything settles and may
      // overlay richer market_data — those updates are setState() no-ops when values match.
      let earlyPriceSet = false
      bootstrapPromise.then((bs) => {
        if (!isFresh() || earlyPriceSet) return
        if (bs?.price?.current > 0) {
          setPriceData({
            current: bs.price.current,
            change24h: bs.price.change24h ?? null,
            high24h: bs.price.high24h ?? null,
            low24h: bs.price.low24h ?? null,
            volume24h: bs.price.volume24h ?? null,
            source: 'spectre',
          })
          setLoading(prev => ({ ...prev, price: false }))
          earlyPriceSet = true
        }
      }).catch(() => {})

      // Early-paint MARKET + PERFORMANCE from the SAME bootstrap response,
      // BEFORE the Promise.allSettled await below. mcap / FDV / multi-window %
      // changes used to wait for the SLOWEST of the 6 sources (CG /coins/{id},
      // Codex) before the token panel showed a single number — even though the
      // one bootstrap call already carries them. The comprehensive merge below
      // still runs after every source settles and overlays the fuller picture
      // (circulating / total supply / ATL / socials); these fills only bridge
      // the skeleton gap and never clobber a value already present (?? prev).
      let earlyMarketSet = false
      bootstrapPromise.then((bs) => {
        if (!isFresh() || earlyMarketSet) return
        const bm = bs?.price || {}
        const bMcap = bm.marketCap ?? bs?.profile?.marketCap ?? null
        const hasMarket = bMcap > 0 || bm.fdv > 0 || bm.volume24h > 0
        if (!hasMarket) return
        setMarketData(prev => ({
          ...prev,
          mcap: prev.mcap ?? bMcap,
          fdv: prev.fdv ?? bm.fdv ?? null,
          volume24h: prev.volume24h ?? bm.volume24h ?? null,
          ath: prev.ath ?? bm.ath ?? null,
        }))
        setPerformanceData(prev => ({
          ...prev,
          change1h: prev.change1h ?? bm.change1h ?? null,
          change7d: prev.change7d ?? bm.change7d ?? null,
          change30d: prev.change30d ?? bm.change30d ?? null,
          sparkline7d: prev.sparkline7d ?? bm.sparkline7d ?? null,
        }))
        // Enrich identity (logo / name / cgId / categories) from bootstrap so a
        // direct URL nav to a non-major shows the real logo + name instead of
        // the letter-avatar while the slow fan-out (CG / Codex / appMarket)
        // backfills. Fill-only + change-guard so it never loops or clobbers a
        // richer identity already present.
        const bi = bs?.identity || {}
        if (bi.logo_url || bi.name || bi.coingecko_id || bi.categories?.length) {
          setTokenIdentity(prev => {
            if (!prev || prev.symbol !== resolvedSym) return prev
            const nextLogo = prev.logo || bi.logo_url || null
            const nextName = (!prev.name || prev.name === prev.symbol) && bi.name ? bi.name : prev.name
            const nextCgId = prev.cgId || bi.coingecko_id || null
            const nextCats = prev.categories?.length ? prev.categories : (bi.categories?.length ? bi.categories : prev.categories)
            // Rank rides the bootstrap too (price.marketCapRank) — without this
            // the hero badge waited on the CG-details lane, which is exactly
            // what stalls when the box is cold (founder 08-07: no #1868 badge).
            const nextRank = prev.rank ?? bs?.price?.marketCapRank ?? null
            if (nextLogo === prev.logo && nextName === prev.name && nextCgId === prev.cgId && nextCats === prev.categories && nextRank === prev.rank) return prev
            return { ...prev, logo: nextLogo, name: nextName, cgId: nextCgId, categories: nextCats, rank: nextRank }
          })
        }
        setLoading(prev => ({ ...prev, market: false }))
        earlyMarketSet = true
      }).catch(() => {})

      binancePromise.then((bd) => {
        if (!isFresh() || earlyPriceSet) return
        const row = bd?.[resolvedSym]
        if (row?.price > 0) {
          setPriceData({
            current: row.price,
            change24h: row.change ?? null,
            high24h: row.highPrice ?? null,
            low24h: row.lowPrice ?? null,
            volume24h: row.volume ?? null,
            source: 'binance',
          })
          setLoading(prev => ({ ...prev, price: false }))
          earlyPriceSet = true
        }
      }).catch(() => {})

      // Early-paint about/links from cgDetails — independent of price merge.
      // The final post-await block re-runs this with merged Codex socials.
      cgDetailsPromise.then((dd) => {
        if (!isFresh() || !dd) return
        if (dd.description || dd.links || dd.categories) {
          setAboutData(prev => prev || {
            description: dd.description ?? null,
            links: dd.links ?? null,
            categories: dd.categories ?? null,
          })
        }
      }).catch(() => {})

      // Early-paint on-chain holders/liquidity from Codex.
      codexPromise.then((cd) => {
        if (!isFresh() || !cd || !address) return
        setOnchainData(prev => prev || ({
          holders: cd.holders ?? null,
          liquidity: cd.liquidity ?? null,
          txnCount24: cd.txnCount24 ?? cd.transactions24 ?? null,
          age: cd.pairCreatedAt ?? cd.createdAt ?? null,
        }))
        // Backfill logo + name from Codex on direct URL nav for DEX-only
        // microcaps. The token resolver runs symbol-first (Spectre /v1/token/
        // resolve, /api/token/resolve, then Codex search by symbol) and
        // returns logo:null for tokens not in the major-token table or CG's
        // listed universe. But getDetailedTokenInfo (address-keyed Codex
        // query) does have info.imageLargeUrl. Plumb it through so the header
        // renders the Codex CDN logo instead of the generated letter avatar.
        if (cd.logo || cd.name) {
          setTokenIdentity(prev => {
            if (!prev) return prev
            const next = { ...prev }
            if (!prev.logo && cd.logo) next.logo = cd.logo
            if ((!prev.name || prev.name === prev.symbol) && cd.name) next.name = cd.name
            return next.logo === prev.logo && next.name === prev.name ? prev : next
          })
        }
      }).catch(() => {})

      const [bootstrapResult, binanceResult, cgMarketResult, cgDetailsResult, codexResult, marketDataResult] = await Promise.allSettled([
        bootstrapPromise,
        binancePromise,
        cgMarketPromise,
        cgDetailsPromise,
        codexPromise,
        marketDataPromise,
      ])

      if (cancelled || activeSymRef.current !== sym) return

      // --- Extract all results ---
      const bootstrap = bootstrapResult.status === 'fulfilled' ? bootstrapResult.value : null
      const binData = binanceResult.status === 'fulfilled' ? binanceResult.value : null
      const binRow = binData?.[resolvedSym]
      const cgMarket = cgMarketResult.status === 'fulfilled' ? cgMarketResult.value : null
      const detailsData = cgDetailsResult.status === 'fulfilled' ? cgDetailsResult.value : null
      const codexData = codexResult.status === 'fulfilled' ? codexResult.value : null
      const appMarketData = marketDataResult.status === 'fulfilled' ? marketDataResult.value : null

      // --- Per-source prices (for chart-price matching) ---

      const perSource = { spectre: null, appresearch: null, binance: null, coingecko: null, codex: null }

      if (bootstrap?.price?.current > 0) {
        perSource.spectre = {
          current: bootstrap.price.current,
          change24h: bootstrap.price.change24h ?? null,
          high24h: bootstrap.price.high24h ?? null,
          low24h: bootstrap.price.low24h ?? null,
          volume24h: bootstrap.price.volume24h ?? null,
          source: 'spectre',
        }
      }

      if (appMarketData?.price > 0) {
        perSource.appresearch = {
          current: appMarketData.price,
          change24h: appMarketData.change24h ?? null,
          high24h: appMarketData.high24h ?? null,
          low24h: appMarketData.low24h ?? null,
          volume24h: appMarketData.volume24h ?? null,
          source: 'appresearch',
        }
      }
      if (binRow && binRow.price > 0) {
        perSource.binance = {
          current: binRow.price,
          change24h: binRow.change ?? null,
          high24h: binRow.highPrice ?? null,
          low24h: binRow.lowPrice ?? null,
          volume24h: binRow.volume ?? null,
          source: 'binance',
        }
      }
      if (cgMarket && cgMarket.price > 0) {
        perSource.coingecko = {
          current: cgMarket.price,
          change24h: cgMarket.change24h ?? null,
          high24h: cgMarket.high24h ?? null,
          low24h: cgMarket.low24h ?? null,
          volume24h: cgMarket.volume24h ?? null,
          source: 'coingecko',
        }
      }
      if (codexData?.price) {
        perSource.codex = {
          current: codexData.price,
          change24h: normalizeChangePercent(codexData.change24 ?? codexData.change24h),
          high24h: null,
          low24h: null,
          volume24h: codexData.volume24 ?? codexData.volume ?? null,
          source: 'codex',
        }
      }
      setAllPricesData(perSource)

      // --- Best price (Binance-listed: live ticker first; else spectre canonical) ---

      // Binance-listed tokens take the LIVE Binance ticker over our bootstrap
      // block. The spectre block rides bootstrap caches (30s + 120s stale-serve)
      // and its ingestion can lag under box load — BTC painted $61,145 while
      // Binance printed $62,570 (Sunny 2026-06-10): the header AND the live
      // last candle both took the stale value and drew a fake dump. Long-tail
      // tokens keep the canonical spectre-first order (no Binance feed exists
      // for them anyway).
      const binanceListed = hasBinancePair(String(resolvedSym || '').toUpperCase())
      let resolvedPrice = (binanceListed && perSource.binance)
        || perSource.spectre || perSource.appresearch || perSource.binance
        || perSource.coingecko || perSource.codex || EMPTY_PRICE

      // For DEX-primary tokens (no Binance spot pair) Codex IS the live
      // truth. CoinGecko aggregates with multi-hour delay and frequently
      // reports the 24h LOW as "current price" — that's why SPECTRE's
      // chart said $0.3920 while the right rail price/low/high were
      // pinned to $0.32-$0.35 from a stale CG snapshot. Override the
      // chosen source with Codex when CG was picked for a non-CEX token.
      // 2026-08-12: `'spectre'` added to the override list. The bootstrap block
      // rides the SAME /v1/prices ingester that periodically freezes, so a
      // DEX-primary token kept a frozen box price AND its frozen 24h change
      // forever — PALM's header read -1.20% while the on-chain tape (and CG,
      // and CMC) read green. The comment above already said "Codex IS the live
      // truth" for these tokens; the condition just never included the source
      // that actually wins the ordering on line 931.
      const isDexPrimary = !binanceListed
      if (perSource.codex?.current && isDexPrimary && (resolvedPrice.source === 'coingecko' || resolvedPrice.source === 'appresearch' || resolvedPrice.source === 'spectre')) {
        resolvedPrice = {
          ...resolvedPrice,
          current: perSource.codex.current,
          change24h: perSource.codex.change24h ?? resolvedPrice.change24h,
          source: perSource.codex.source,
        }
      }

      // CoinGecko's 24h for low-rank tokens lags the on-chain feed by hours.
      // When we're on the CG path and Codex reports a meaningfully larger
      // magnitude move, trust Codex so the % matches the chart (e.g. SPECTRE
      // showing +0.16% on CG while the DEX pair is actually +17%).
      if (resolvedPrice !== EMPTY_PRICE && resolvedPrice.source !== 'binance' && perSource.codex?.change24h != null) {
        const currentAbs = Math.abs(Number(resolvedPrice.change24h) || 0)
        const codexAbs = Math.abs(perSource.codex.change24h)
        if (codexAbs >= Math.max(1, currentAbs * 2)) {
          resolvedPrice = { ...resolvedPrice, change24h: perSource.codex.change24h }
        }
      }

      // PR-4 (perf): when EVERY source failed (offline, gated session, upstream
      // blip) resolvedPrice is EMPTY_PRICE - don't wipe a real price the user
      // is already seeing (snapshot hydration or the previous poll's value).
      // Stale-but-real beats blank; the next successful poll refreshes it.
      if (resolvedPrice !== EMPTY_PRICE) {
        setPriceData(resolvedPrice)
      } else {
        setPriceData(prev => (prev?.current > 0 ? prev : resolvedPrice))
      }
      setLoading(prev => ({ ...prev, price: false }))

      // --- Market data (fallback sources, then App Research market-data overlay) ---
      if (cgMarket) {
        setMarketData({
          mcap: cgMarket.mcap ?? null,
          fdv: cgMarket.fdv ?? null,
          circulatingSupply: cgMarket.circulating ?? null,
          totalSupply: cgMarket.maxSupply ?? null,
          volMcapPct: cgMarket.volMcapPct ?? null,
          volume24h: cgMarket.volume24h ?? null,
          ath: cgMarket.ath ?? null,
          athDate: cgMarket.athDate ?? null,
          athChangePct: cgMarket.athChangePct ?? null,
          atl: cgMarket.atl ?? null,
          atlDate: cgMarket.atlDate ?? null,
          atlChangePct: cgMarket.atlChangePct ?? null,
        })

        // Performance from CoinGecko
        setPerformanceData({
          change1h: cgMarket.change1h ?? null,
          change7d: cgMarket.change7d ?? null,
          change30d: cgMarket.change30d ?? null,
          change1y: null,
          sparkline7d: cgMarket.sparkline7d ?? null,
        })

        // Enrich tokenIdentity with CoinGecko display fields if available
        // Only update if there's actually new data to add (prevents render loop)
        if (cgMarket._image || cgMarket._name || cgMarket._coingeckoId || cgMarket.rank != null) {
          setTokenIdentity(prev => {
            if (!prev || prev.symbol !== resolvedSym) return prev
            const newLogo = prev.logo || cgMarket._image || null
            const newName = cgMarket._name || prev.name
            const newCgId = prev.cgId || cgMarket._coingeckoId || null
            const newRank = cgMarket.rank ?? prev.rank
            // Skip update if nothing actually changed
            if (newLogo === prev.logo && newName === prev.name && newCgId === prev.cgId && newRank === prev.rank) return prev
            return { ...prev, logo: newLogo, name: newName, cgId: newCgId, rank: newRank }
          })
        }
      } else if (detailsData?.marketData?.price > 0) {
        // Token not in top 1000 but CoinGecko /coins/{id} has full market data
        const dm = detailsData.marketData
        setMarketData({
          mcap: dm.mcap ?? null,
          fdv: dm.fdv ?? (dm.price && dm.totalSupply ? dm.price * dm.totalSupply : null),
          circulatingSupply: dm.circulatingSupply ?? null,
          totalSupply: dm.totalSupply ?? null,
          volMcapPct: (dm.volume24h && dm.mcap) ? ((dm.volume24h / dm.mcap) * 100).toFixed(1) : null,
          volume24h: dm.volume24h ?? null,
          ath: dm.ath ?? null,
          athDate: dm.athDate ?? null,
          athChangePct: dm.athChangePct ?? null,
          atl: dm.atl ?? null,
          atlDate: dm.atlDate ?? null,
          atlChangePct: dm.atlChangePct ?? null,
        })
        setPerformanceData({
          change1h: dm.change1h ?? null,
          change7d: dm.change7d ?? null,
          change30d: dm.change30d ?? null,
          change1y: null,
          sparkline7d: null,
        })
        // Also fill price from details if we still have no price
        if (!resolvedPrice.current && dm.price > 0) {
          resolvedPrice = {
            current: dm.price,
            change24h: dm.change24h ?? null,
            high24h: dm.high24h ?? null,
            low24h: dm.low24h ?? null,
            volume24h: dm.volume24h ?? null,
            source: 'coingecko',
          }
          setPriceData(resolvedPrice)
        }
        // Enrich price with 24h high/low if missing from Binance
        if (resolvedPrice.current && !resolvedPrice.high24h && dm.high24h) {
          setPriceData(prev => ({ ...prev, high24h: dm.high24h, low24h: dm.low24h }))
        }
        // Enrich token identity - only if values actually change (prevents render loop)
        if (detailsData.image || detailsData.marketCapRank) {
          setTokenIdentity(prev => {
            if (!prev || prev.symbol !== resolvedSym) return prev
            const newLogo = prev.logo || detailsData.image || null
            const newRank = detailsData.marketCapRank ?? prev.rank
            if (newLogo === prev.logo && newRank === prev.rank) return prev
            return { ...prev, logo: newLogo, rank: newRank }
          })
        }
      } else if (codexData) {
        // Last resort: Codex on-chain data only
        const codexMcap = codexData.marketCap ?? codexData.mcap ?? null
        const codexVolume = codexData.volume24 ?? codexData.volume ?? null
        const codexTotal = codexData.totalSupply ?? codexData.maxSupply ?? null
        setMarketData({
          mcap: codexMcap,
          fdv: codexData.fdv ?? codexData.fullyDilutedValuation ?? (resolvedPrice.current && codexTotal ? resolvedPrice.current * codexTotal : null),
          circulatingSupply: codexData.circulatingSupply ?? null,
          totalSupply: codexTotal,
          volMcapPct: (codexVolume && codexMcap) ? ((codexVolume / codexMcap) * 100).toFixed(1) : null,
          volume24h: codexVolume,
          ath: null, athDate: null, athChangePct: null,
          atl: null, atlDate: null, atlChangePct: null,
        })
        // Performance from Codex change fields
        setPerformanceData({
          change1h: codexData.change1h ?? null,
          change7d: codexData.change7d ?? null,
          change30d: codexData.change30d ?? null,
          change1y: null,
          sparkline7d: null,
        })
      }
      setLoading(prev => ({ ...prev, market: false }))

      // App Research market data is the primary market source for RZ cards.
      // It overrides overlapping fields while preserving fallback-only values.
      if (appMarketData) {
        setMarketData(prev => mergeProfileMarket(appMarketData, prev))
        setPerformanceData(prev => mergeProfilePerformance(appMarketData, prev))
        setPriceData(prev => ({
          ...prev,
          current: appMarketData.price > 0 ? appMarketData.price : prev.current,
          change24h: appMarketData.change24h ?? prev.change24h,
          high24h: appMarketData.high24h ?? prev.high24h,
          low24h: appMarketData.low24h ?? prev.low24h,
          volume24h: appMarketData.volume24h ?? prev.volume24h,
          source: appMarketData.price > 0 ? 'appresearch' : prev.source,
        }))
        setTokenIdentity(prev => {
          if (!prev || prev.symbol !== resolvedSym) return prev
          const nextLogo = appMarketData.logo || appMarketData.image || prev.logo
          const next = {
            ...prev,
            logo: nextLogo,
            cgId: appMarketData.cgId || appMarketData.coingeckoId || prev.cgId,
            codexId: appMarketData.codexId || prev.codexId,
            categories: appMarketData.categories?.length ? appMarketData.categories : prev.categories,
          }
          if (
            next.logo === prev.logo &&
            next.cgId === prev.cgId &&
            next.codexId === prev.codexId &&
            next.categories === prev.categories
          ) return prev
          return next
        })
      }

      // --- On-chain data ---
      if (codexData && address) {
        setOnchainData({
          holders: codexData.holders ?? null,
          liquidity: codexData.liquidity ?? null,
          txnCount24: codexData.txnCount24 ?? codexData.transactions24 ?? null,
          age: codexData.pairCreatedAt ?? codexData.createdAt ?? null,
        })
      }
      if (appMarketData) {
        setOnchainData(prev => ({
          ...(prev || {}),
          holders: appMarketData.holders ?? prev?.holders ?? null,
          liquidity: appMarketData.liquidity ?? prev?.liquidity ?? null,
          source: 'appresearch',
        }))
      }
      setLoading(prev => ({ ...prev, onchain: false }))

      // --- About (CoinGecko coin details + Codex socials) ---
      // Merge Codex socials into the links bag — Codex covers most on-chain
      // tokens (e.g. SPECTRE) that CoinGecko doesn't index. Keep CG values
      // when both sources have them. The consumer (rz-hero-banner) reads
      // both `homepage`/`twitter`/`telegram`/`discord` keys.
      const codexSocials = codexData?.socials || {}
      const cgLinks = detailsData?.links || null
      const mergedLinks = (cgLinks || codexSocials.twitter || codexSocials.website || codexSocials.telegram || codexSocials.discord)
        ? {
            ...(cgLinks || {}),
            homepage: cgLinks?.homepage || (codexSocials.website ? [codexSocials.website] : undefined),
            twitter: cgLinks?.twitter || cgLinks?.twitter_screen_name || codexSocials.twitter,
            telegram: cgLinks?.telegram || cgLinks?.telegram_channel_identifier || codexSocials.telegram,
            discord: cgLinks?.discord || codexSocials.discord,
          }
        : null
      if (detailsData || mergedLinks) {
        setAboutData({
          description: detailsData?.description ?? null,
          links: mergedLinks,
          categories: detailsData?.categories ?? null,
          platforms: (detailsData?.platforms && typeof detailsData.platforms === 'object') ? detailsData.platforms : null,
        })

        // Enrich tokenIdentity.address from CG platforms when address is missing
        // This enables Codex chart data for tokens the registry doesn't cover.
        // Uses the ONE shared platform map (@/lib/cg-platforms) — the local
        // copy that lived here was missing HyperEVM/Sui/Sonic/avalanche and
        // left those tokens chartless (2026-08-25).
        if (!address && detailsData?.platforms && typeof detailsData.platforms === 'object') {
          const enriched = contractFromPlatforms({ platforms: detailsData.platforms })
          if (enriched) {
            setTokenIdentity(prev => {
              if (!prev || prev.symbol !== resolvedSym || prev.address) return prev
              return { ...prev, address: enriched.address, networkId: enriched.networkId }
            })
          }
        }
      }
      if (appMarketData) {
        setAboutData(prev => ({
          ...(prev || {}),
          categories: appMarketData.categories?.length ? appMarketData.categories : prev?.categories || null,
          source: 'appresearch',
        }))
      }
      setLoading(prev => ({ ...prev, about: false }))

    }

    fetchCryptoData()
    return () => { cancelled = true }
  }, [tokenIdentity, sym, isStock])

  // Trending — opt-in: only fetch when consumer enables it via options.fetchTrending.
  // Module-level _deduped cache survives across renders so this is at most one
  // CG call per 5 minutes, not per token nav.
  useEffect(() => {
    if (!options.fetchTrending || isStock || !sym) return
    let cancelled = false
    _deduped(`trending:20`, TTL.trending, () => getTopCoinsMarketsPage(1, 20))
      .then(coins => {
        if (cancelled || !Array.isArray(coins)) return
        setTrendingData(
          coins
            .filter(c => (c.symbol || '').toUpperCase() !== sym)
            .map(c => ({
              id: c.id || '',
              symbol: (c.symbol || '').toUpperCase(),
              image: c.image || null,
              current_price: c.current_price ?? 0,
              price_change_percentage_24h: c.price_change_percentage_24h ?? 0,
            }))
        )
      })
    return () => { cancelled = true }
  }, [options.fetchTrending, sym, isStock])

  // -----------------------------------------------------------------------
  // 3. POLLING
  // -----------------------------------------------------------------------

  // Refs let pollPrice read fresh tokenIdentity/marketData without listing
  // them in deps — including them recreated the callback on every enrichment
  // and useAdaptivePolling reinstalled its interval each time, so the live
  // refresh cadence was effectively random.
  const identityRef = useRef(tokenIdentity)
  identityRef.current = tokenIdentity
  const marketSourceRef = useRef(marketData.source)
  marketSourceRef.current = marketData.source
  // The price currently on screen, readable from a poll callback without
  // becoming one of its deps (same reason as the two refs above).
  const priceRef = useRef(priceData.current)
  priceRef.current = priceData.current

  // ── SSE-vs-poll deconfliction state ───────────────────────────────────────
  // The SSE asset stream (useAssetStream below) and the 15s Binance price poll
  // both write `priceData.current` — redundant when SSE is healthy. We DON'T
  // disable the poll (SSE can silently stall: connection stays "subscribed" but
  // ticks stop). Instead we WIDEN the poll to a 60s heartbeat while SSE is
  // proven-live, and snap it back to 15s the moment SSE goes quiet. A watchdog
  // (not the per-tick path) drives the boolean so the poll interval doesn't
  // thrash/reinstall on every tick.
  const SSE_FRESH_WINDOW = 25_000   // a tick within 25s == SSE is delivering
  const lastSseTickRef = useRef(0)
  const [ssePriceHealthy, setSsePriceHealthy] = useState(false)
  // Reset freshness on symbol change: the new token must re-prove SSE liveness
  // before we widen its poll, so a switch never inherits the old token's health.
  useEffect(() => {
    lastSseTickRef.current = 0
    setSsePriceHealthy(false)
  }, [sym])

  // Price polling - Binance 15s (crypto), stock quote 30s (stock)
  const pollPrice = useCallback(async () => {
    const identity = identityRef.current
    if (!sym || !identity) return

    if (isStock) {
      try {
        const quote = await getStockQuote(sym)
        if (quote?.price != null && activeSymRef.current === sym) {
          setPriceData(prev => ({
            ...prev,
            current: quote.price,
            change24h: quote.change ?? prev.change24h,
            volume24h: quote.volume ?? prev.volume24h,
            source: 'stock',
          }))
          setStockQuoteData(prev => prev ? { ...prev, ...quote } : quote)
        }
      } catch (_) { /* ignore */ }
      return
    }

    // A DEX-primary token with a contract has NO Binance row, so this leg only
    // ever returns the /v1/prices box value — which would overwrite the fresher
    // Codex price pollOnchain just wrote, every 15s, producing a header that
    // flip-flops between two numbers. Those tokens are owned by the SSE stream
    // (2s) with Codex as the floor (60s); skipping here is also one fewer
    // request per token per 15s.
    if (!identity.binancePair && identity.address) return

    const pollSym = identity.symbol || sym
    try {
      const data = await getBinancePrices([pollSym])
      const row = data?.[pollSym]
      if (row?.price > 0 && activeSymRef.current === sym) {
        const binPrice = {
          current: row.price,
          change24h: row.change ?? null,
          high24h: row.highPrice ?? null,
          low24h: row.lowPrice ?? null,
          volume24h: row.volume ?? null,
          source: 'binance',
        }
        setAllPricesData(prev => ({ ...prev, binance: binPrice }))
        const keepMarketStats = marketSourceRef.current === 'appresearch'
        setPriceData(prev => ({
          ...prev,
          current: prev.source === 'appresearch' && prev.current ? prev.current : row.price,
          change24h: keepMarketStats ? prev.change24h : row.change ?? prev.change24h,
          high24h: keepMarketStats ? prev.high24h : row.highPrice ?? prev.high24h,
          low24h: keepMarketStats ? prev.low24h : row.lowPrice ?? prev.low24h,
          volume24h: keepMarketStats ? prev.volume24h : row.volume ?? prev.volume24h,
          source: prev.source === 'appresearch' && prev.current ? 'appresearch' : 'binance',
        }))
      }
    } catch (_) { /* ignore */ }
  }, [sym, isStock])

  // BROWSER-VERIFY (RISKY — SSE/poll deconfliction):
  //   1. SSE ON: open an RZ token whose SSE stream is live (e.g. BTC). Confirm
  //      the hero price keeps ticking. In the Network tab the Binance price
  //      poll should slow to ~60s (was 15s) — SSE carries the live updates.
  //   2. SSE OFF / silent: block /data-api/v1/stream/* (DevTools request-block)
  //      or pick a token with no SSE feed. The price must STILL update — within
  //      ~25s the watchdog flips ssePriceHealthy=false and the poll snaps back
  //      to 15s. Confirm the hero never goes stale.
  //   3. SSE dies mid-session: with SSE live, kill the stream. Price must resume
  //      updating on the 15s poll within ~25s (no permanent freeze).
  // The poll is NEVER disabled — only widened — so it is always the safety net.
  useAdaptivePolling(pollPrice, {
    interval: isStock ? 30_000 : (ssePriceHealthy ? 60_000 : 15_000),
    enabled: !!sym && !!tokenIdentity,
  })

  // ── SSE live stream from Spectre Data API ─────────────────────────────
  // Pushes price + derivatives + liquidations as soon as upstream workers
  // publish. Runs ALONGSIDE the Binance/Codex polls — when the stream
  // reaches us first (which it usually does), we update state immediately;
  // the polls then fill in any gaps. Stocks have no SSE upstream yet.
  const stream = useAssetStream(sym, { enabled: !!sym && !!tokenIdentity && !isStock })

  useEffect(() => {
    if (!stream.price) return
    if (activeSymRef.current !== sym) return
    const p = stream.price
    // SSE event:price has shape { asset, price, pct_change_24h, pct_change_1h, volume_24h, ts }
    const tickPrice = Number(p.price ?? p.current)
    if (!Number.isFinite(tickPrice) || tickPrice <= 0) return
    // Mark SSE as delivering — even if the price is unchanged, a tick proves the
    // stream is alive. The watchdog effect (below) reads this ref to widen the
    // Binance poll. Ref-only here so the tick path stays a pure ref write (no
    // state read → no extra dep, no re-render churn on the hot SSE path).
    lastSseTickRef.current = Date.now()
    setPriceData((prev) => {
      // Don't override appresearch source mid-page (it carries richer market_data) —
      // just refresh the live `current` and `change24h` from the stream.
      const next = {
        ...prev,
        current: tickPrice,
        change24h: p.pct_change_24h ?? prev.change24h,
        volume24h: p.volume_24h ?? prev.volume24h,
        source: prev.source === 'appresearch' ? 'appresearch' : 'spectre-stream',
      }
      // Skip the setState if nothing actually moved — saves a render
      if (prev.current === next.current && prev.change24h === next.change24h) return prev
      return next
    })
    setAllPricesData((prev) => ({
      ...prev,
      spectre: {
        current: tickPrice,
        change24h: p.pct_change_24h ?? null,
        change1h: p.pct_change_1h ?? null,
        volume24h: p.volume_24h ?? null,
        source: 'spectre-stream',
      },
    }))
  }, [stream.price, sym])

  // ── SSE health watchdog ───────────────────────────────────────────────────
  // Drives the ssePriceHealthy boolean that widens/narrows the Binance poll.
  // Runs every 10s (slow — independent of the per-tick path) so the poll
  // interval flips at most once per 10s, never thrashing on tick rate.
  // Healthy == stream connected AND a tick landed within SSE_FRESH_WINDOW.
  // The moment ticks stop (SSE silently stalls) or the connection drops, this
  // flips false within ≤10s and the poll snaps back to 15s — the fallback.
  // No document.hidden guard needed: this does zero network I/O (pure boolean
  // re-evaluation). The actual price poll it gates is already visibility-aware
  // via useAdaptivePolling.
  useEffect(() => {
    if (isStock || !sym) return
    const evaluate = () => {
      const fresh = lastSseTickRef.current > 0
        && (Date.now() - lastSseTickRef.current) < SSE_FRESH_WINDOW
      const healthy = !!stream.connected && fresh
      setSsePriceHealthy(prev => (prev === healthy ? prev : healthy))
    }
    evaluate()
    const id = setInterval(evaluate, 10_000)
    return () => clearInterval(id)
  }, [stream.connected, sym, isStock])

  // (CoinGecko 60s market polling removed — Binance polling already updates
  // price every 15s, and App Research is the primary market-data source. The
  // initial CG fetch on token load fills mcap/supply/ATH; refreshing those
  // every minute is wasted budget against CG free-tier rate limits.)

  // Codex on-chain polling - 60s (crypto only, when address available)
  // Reads identityRef so logo/rank enrichment doesn't restart the interval.
  const pollOnchain = useCallback(async () => {
    const identity = identityRef.current
    if (!identity?.address || isStock) return

    // DEX-primary = no Binance spot pair. These tokens have NO live lane other
    // than Codex: the Binance poll finds nothing, and the SSE stream rides the
    // same box ingester that periodically freezes. That is why the header price
    // sat still while the chart kept moving (founder 2026-08-12). Majors keep
    // the 300s cost-defended cadence — they have Binance AND a working stream.
    const dexPrimary = !identity.binancePair
    try {
      // Route through _deduped so the poll shares the same onchain:<addr>:<net>
      // cache the initial fetch (effect 2) writes. With TTL.onchain now aligned
      // to the 300s poll interval, a fresh-enough initial fetch (or a parallel
      // consumer) spares the poll a Codex round-trip instead of always missing.
      const info = await _deduped(
        `onchain:${identity.address}:${identity.networkId || 1}`,
        dexPrimary ? ONCHAIN_PRICE_TTL : TTL.onchain,
        () => getDetailedTokenInfo(identity.address, identity.networkId || 1),
      )
      if (!info || activeSymRef.current !== sym) return

      // Codex IS the tape for these tokens, so it also carries the header
      // price — unless the SSE stream is proven-live, which is both fresher
      // (2s) and free. Same precedence as the initial resolve above.
      // ...or unless the two have visibly diverged. A stream that keeps
      // emitting the SAME frozen number still looks "live" to the watchdog, so
      // liveness alone isn't enough: when the box and the tape disagree by more
      // than 1% on a DEX token, the tape is the one the chart is drawing.
      const sseLive = Date.now() - lastSseTickRef.current < SSE_FRESH_WINDOW
      const codexPrice = Number(info.price)
      const shown = Number(priceRef.current)
      const diverged = Number.isFinite(shown) && shown > 0 && Number.isFinite(codexPrice)
        && Math.abs(codexPrice - shown) / shown > 0.01
      if (dexPrimary && (!sseLive || diverged) && Number.isFinite(codexPrice) && codexPrice > 0) {
        const codexChange = normalizeChangePercent(info.change24 ?? info.change24h)
        setAllPricesData(prev => ({
          ...prev,
          codex: {
            current: codexPrice,
            change24h: codexChange,
            high24h: null,
            low24h: null,
            volume24h: info.volume24 ?? info.volume ?? null,
            source: 'codex',
          },
        }))
        setPriceData(prev => {
          const nextChange = codexChange ?? prev.change24h
          if (prev.current === codexPrice && prev.change24h === nextChange) return prev
          return { ...prev, current: codexPrice, change24h: nextChange, source: 'codex' }
        })
      }

      setOnchainData(prev => {
        if (prev?.source === 'appresearch') {
          return {
            ...prev,
            txnCount24: prev.txnCount24 ?? info.txnCount24 ?? info.transactions24 ?? null,
            age: prev.age ?? info.pairCreatedAt ?? info.createdAt ?? null,
          }
        }
        return {
          holders: info.holders ?? null,
          liquidity: info.liquidity ?? null,
          txnCount24: info.txnCount24 ?? info.transactions24 ?? null,
          age: info.pairCreatedAt ?? info.createdAt ?? null,
        }
      })
    } catch (_) { /* ignore */ }
  }, [sym, isStock])

  useAdaptivePolling(pollOnchain, {
    // 2026-05-08 Codex cost defense: 30s -> 60s.
    // 2026-06-02 Phase K3: 60s -> 300s. On-chain stats (holders / txn count /
    // pair liquidity) drift over minutes, not seconds. Live price comes from
    // the SSE onPricesUpdated stream; this poll is for the slow-moving
    // research-tier fields only. Combined with the Phase K snapshot read
    // path (snapshot covers top-500 instantly, near-zero cost), this cuts
    // RZ getDetailedTokenInfo ops 5x with zero perceivable UX change.
    // 2026-08-12: DEX-primary tokens (no Binance pair) go back to 60s — for
    // them this poll is not "slow-moving research fields", it IS the price
    // lane, and 5 minutes of a frozen header next to a moving chart is the
    // bug. Majors are untouched, so the 5x saving stands where it was won.
    interval: tokenIdentity?.address && !tokenIdentity?.binancePair ? ONCHAIN_PRICE_TTL : 300_000,
    enabled: !!tokenIdentity?.address && !isStock,
  })

  // -----------------------------------------------------------------------
  // 4. MEMOIZED RETURN VALUES
  // -----------------------------------------------------------------------

  const token = useMemo(() => {
    if (!tokenIdentity) return null
    return {
      symbol: tokenIdentity.symbol,
      name: tokenIdentity.name,
      cgId: tokenIdentity.cgId,
      codexId: tokenIdentity.codexId,
      tokenId: tokenIdentity.tokenId,
      binancePair: tokenIdentity.binancePair,
      address: tokenIdentity.address,
      networkId: tokenIdentity.networkId,
      logo: tokenIdentity.logo,
      rank: tokenIdentity.rank,
      categories: tokenIdentity.categories,
    }
  }, [tokenIdentity])

  const chartToken = useMemo(() => {
    if (!tokenIdentity) return null
    return {
      symbol: tokenIdentity.symbol,
      address: tokenIdentity.address,
      networkId: tokenIdentity.networkId,
      cgId: tokenIdentity.cgId,
      codexId: tokenIdentity.codexId,
      tokenId: tokenIdentity.tokenId,
      binancePair: tokenIdentity.binancePair,
      isStock,
    }
  }, [tokenIdentity, isStock])

  // Memoize the return so the object identity is stable across renders that
  // don't change any field. Without this, every render produced a fresh literal
  // — harmless on desktop (lite reads fields individually) but the WHOLE object
  // is passed to <ResearchZoneMobile data={data}/>, so a fresh identity
  // re-rendered the entire mobile subtree on every price tick / parent render.
  // Now it only changes when one of these (already-stable useState/useMemo)
  // sources actually changes.
  return useMemo(() => {
    // Curated overlay — corrects upstream records that are verifiably wrong
    // (e.g. CoinGecko's ATH/description for our own token). Applied at the
    // single choke point so every source path and every RZ variant gets it.
    const curated = curatedTokenFacts(token?.cgId)
    let market = marketData
    let about = aboutData
    if (curated?.ath != null && market) {
      const live = Number(priceData?.current)
      market = {
        ...market,
        ath: curated.ath,
        athDate: curated.athDate ?? market.athDate,
        athChangePct: live > 0 ? ((live - curated.ath) / curated.ath) * 100 : null,
      }
    }
    if (curated?.description) {
      about = { ...(about || {}), description: curated.description }
    }
    return {
      token,
      price: priceData,
      allPrices: allPricesData,
      market,
      performance: performanceData,
      onchain: onchainData,
      about,
      chartToken,
      trending: trendingData,
      loading,
      // True only while the multi-hop resolve is genuinely in flight — the
      // chart's shimmer gate. NOT the same as `loading.token`, which goes
      // false the moment any cached (possibly chartless) identity exists.
      identityResolving,
      stockData: stockQuoteData,
      // Live SSE channel — null/empty until first event fires. Consumers can
      // use these in addition to (or instead of) the polled equivalents.
      streamDerivatives: stream.derivatives,
      streamLiquidations: stream.liquidations,
      streamConnected: stream.connected,
    }
  }, [
    token, priceData, allPricesData, marketData, performanceData,
    onchainData, aboutData, chartToken, trendingData, loading, identityResolving, stockQuoteData,
    stream.derivatives, stream.liquidations, stream.connected,
  ])
}
