/**
 * LITE Research Zone - one coin, PRO-shaped sub-tabs kept simple:
 *   Overview   - daily chart (1W..ALL), performance, range, coin news
 *   Technicals - trend/RSI/volatility/levels computed from real closes
 *   Markets    - the numbers: cap, volume, supply, turnover, range
 *   Sentiment  - crowd tone from machine-read X mentions (risk-first)
 * Deliberately daily-only ("zoom out") - the intraday OHLCV lane is the
 * slow/cold path and LITE never makes the user wait on it.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react'
import { tl } from './lite-i18n'
import lazy from '@/lib/lazy-with-retry'
import useSettingsStore from '@/store/useSettingsStore'

// PRO's self-hosted charting library (UDF datafeed) - heavy, loads on demand.
const TradingViewAdvanced = lazy(() => import('@/components/TradingViewAdvanced'))
import { useTranslation } from 'react-i18next'
import { getSpectreTokenChart, getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { getBars } from '@/services/codexApi'
import { getCryptoNews } from '@/services/cryptoNewsApi'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { BINANCE_TV_SET, tvIdentityFor } from './lite-tv-identity'
import { getStockQuotes, getStockSeriesBars, getStockLogoUrl, getCompanyProfile, getMarketIndices, getMarketStatus, FALLBACK_STOCK_DATA } from '@/services/stockApi'
import { daysUntil } from '@/lib/earnings-countdown'
import { LITE_TOP_COINS, liteTimeAgo } from './use-lite-data'
import { CinemaButton } from './lite-cinema'
import ChartWatermark from '@/components/chart-watermark'

const TIMEFRAMES = [
  { id: '1D', limit: 2 },
  { id: '1W', limit: 7 },
  { id: '1M', limit: 30 },
  { id: '3M', limit: 90 },
  { id: '6M', limit: 180 },
  { id: '1Y', limit: 365 },
  { id: 'ALL', limit: 'max' },
]

// Module caches with TTLs: LITE users flip coins/TFs back and forth, but a
// long-lived tab must never serve morning data all day ("no stale please").
// Entries are { ts, data }; a stale hit refetches, negative results included.
const _ttlGet = (map, key, ttl) => {
  const e = map.get(key)
  if (!e) return undefined
  if (Date.now() - e.ts > ttl) { map.delete(key); return undefined }
  return e.data
}
const _ttlSet = (map, key, data) => { map.set(key, { ts: Date.now(), data }) }
const SERIES_TTL = 3 * 60 * 1000
const SOCIAL_TTL = 10 * 60 * 1000
const MARKETS_TTL = 15 * 60 * 1000
const FUNDAMENTALS_TTL = 60 * 60 * 1000
const QUOTE_TTL = 60 * 1000

const _chartCache = new Map()

// Manual-refresh hook: the topbar refresh button busts every research lane.
export function bustResearchCaches() {
  _chartCache.clear(); _stockChartCache.clear(); _ohlcCache.clear()
  _gtPoolCache.clear(); _gtOhlcCache.clear(); _mentionsCache.clear()
  _tickersCache.clear(); _toneCache.clear(); _cgQuoteCache.clear()
  _rzTradfi = null
}

// The Spectre daily lanes hold only ~30 days of history (measured 33 rows at
// limit=365). For longer windows on known coins, fall back to the CG
// market-chart proxy (same lane the Fear & Greed page uses for deep history).
// SYMBOL_TO_COINGECKO_ID holds ~45 majors, so the deep-history fallback below
// only ever fired for majors — which is why BTC/ETH/SOL charted and every
// watchlist coin did not. Measured on the box: the Spectre daily lane returns
// 2 rows for PALM, 9 for DSYNC, 30 for NEURAL, 35 for M87 (and only 48 for BTC
// on a 365 request), while CoinGecko has a FULL 366-row year for every one of
// them. Resolving the id by search unlocks that year for free.
//
// 🪤 Symbols collide — "palm" returns palm-ai AND palm-economy, both symbol
// PALM. Guessing would chart the wrong asset under this token's header (the
// $DOT/Polkadot class). So we disambiguate against what the box already told
// us about THIS token — its name, then its CoinGecko image id — and only fall
// back to cap rank when the box gave us neither. No match, no lane.
const _cgIdCache = new Map()

const cgImageId = (url) => (String(url || '').match(/\/coins\/images\/(\d+)\//) || [])[1] || null

// Loose-but-unique name form for the resolver's middle rung: lowercase, strip
// punctuation, drop a leading article. The box calls the Robinhood bullcoin
// "Bull" while CG lists "The Bull" (measured 2026-08-21) - an exact-name rule
// alone refused the match and the token lost every CG-keyed lane. The match is
// only trusted when exactly ONE candidate collapses to the same form, so the
// collision-safety the strict rule exists for is preserved.
const cgLooseName = (s) => String(s || '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/^(the|a|an) /, '')

async function resolveCgId(sym, hint) {
  // An explicit id (the clicked board row knew its coin) needs no resolving.
  if (hint?.cgId) return String(hint.cgId)
  const mapped = SYMBOL_TO_COINGECKO_ID[sym]
  if (mapped) return mapped
  const key = `${sym}:${hint?.name || ''}`
  const cached = _ttlGet(_cgIdCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(`/api/coingecko/search?query=${encodeURIComponent(sym)}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000),
    })
    // Transport failures (429/timeout/cold proxy) are NOT "this coin has no
    // id" - caching the null poisoned the whole identity chain for a full TTL
    // and the page sat on the empty state (FUZZY report, 2026-08-21). Only a
    // SUCCESSFUL search with no acceptable candidate is a cacheable negative.
    if (!res.ok) return null
    const coins = (await res.json())?.coins || []
    const sameSym = coins.filter((c) => String(c?.symbol || '').toUpperCase() === sym)
    const wantName = String(hint?.name || '').trim().toLowerCase()
    const wantImg = cgImageId(hint?.image)
    const looseMatches = wantName
      ? sameSym.filter((c) => cgLooseName(c.name) === cgLooseName(wantName))
      : []
    const pick =
      (wantName && sameSym.find((c) => String(c.name || '').trim().toLowerCase() === wantName)) ||
      (wantImg && sameSym.find((c) => cgImageId(c.thumb || c.large) === wantImg)) ||
      // Normalized-name rung ("Bull" vs "The Bull") - only on a UNIQUE match.
      (looseMatches.length === 1 ? looseMatches[0] : null) ||
      // No hint to check against: CG's own cap ranking is the least-bad tiebreak,
      // and with a single candidate there is nothing to get wrong.
      (sameSym.length === 1 ? sameSym[0] : null) ||
      (!wantName && !wantImg
        ? [...sameSym].sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0]
        : null)
    const id = pick?.id || null
    _ttlSet(_cgIdCache, key, id)
    return id
  } catch (_) {
    return null
  }
}

async function fetchDeepDaily(sym, days, hint) {
  const id = await resolveCgId(sym, hint)
  if (!id) return null
  try {
    const res = await fetch(
      `/api/coingecko/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) return null
    const payload = await res.json()
    const prices = Array.isArray(payload?.prices) ? payload.prices : []
    const rows = prices
      .map((p) => ({ time: Math.floor(Number(p?.[0]) / 1000), close: Number(p?.[1]) }))
      .filter((r) => r.time > 0 && r.close > 0)
    return rows.length >= 2 ? rows : null
  } catch (_) {
    return null
  }
}

// CoinGecko platform id -> our chain key (the GT_NET / CODEX_NETWORK_ID
// vocabulary). Only platforms both maps can route are listed.
const CG_PLATFORM_CHAIN = {
  ethereum: 'ethereum', 'binance-smart-chain': 'bsc', 'polygon-pos': 'polygon',
  'arbitrum-one': 'arbitrum', 'optimistic-ethereum': 'optimism', avalanche: 'avalanche',
  base: 'base', solana: 'solana', tron: 'tron', sui: 'sui', linea: 'linea',
  blast: 'blast', fantom: 'fantom', hyperevm: 'hyperliquid', robinhood: 'robinhood',
  'the-open-network': 'ton',
  // XRPL: CG's platform id is literally `xrp` (verified on fuzzybear
  // 2026-08-21), and its token id ("CURRENCYHEX.rIssuer") is the exact string
  // GT's xrpl network accepts. Codex has no XRPL, so like TON these tokens get
  // the GT candle lanes but no TradingView tab.
  xrp: 'xrpl',
}

const _cgPlatformCache = new Map()

// The box row for a fresh small cap often carries a contract with `chain: null`
// - or the WRONG contract outright. Measured 2026-08-21 on HMM (thinking-cat):
// the box said 0x0b4a...bbef with chain null (zero GT pools anywhere), while
// CoinGecko's own listing for the id the chart lane had ALREADY resolved
// carries 0x7fe9...d87f on `robinhood` with a $600k pool. Without a resolvable
// chain none of the contract lanes engage: no GT/Codex candles (the Candles
// pill silently drew the close-only CG line) and no TradingView tab at all.
// CG's coin record is the verified contract+chain for that same id - read it.
//
// Ratified before use (the §I8 lesson in charts-system.md: an unratified
// contract once promoted a dust pool over a working CG lane): the ref is only
// returned when GT actually holds a pool with real depth for it, so a bad or
// poolless platform row degrades to today's behavior instead of blanking the
// chart.
// A GT pool shallower than this is not a market - the CG lane stays in charge.
const MIN_PLATFORM_LIQUIDITY = 500

async function resolveCgPlatform(sym, hint) {
  const id = await resolveCgId(sym, hint)
  if (!id) return null
  const cached = _ttlGet(_cgPlatformCache, id, SERIES_TTL)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(
      `/api/coingecko/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) },
    )
    // Same rule as resolveCgId: a failed FETCH is not a failed LOOKUP - only
    // definite negatives (no mappable platform) are cached. A GT hiccup during
    // ratification returns null uncached so the next visit retries instead of
    // serving a poisoned "no identity" for the TTL.
    if (!res.ok) return null
    const d = await res.json()
    const platforms = d?.platforms || {}
    // Candidates in a deterministic order: the native platform first
    // (asset_platform_id), then every other mappable one.
    const cands = []
    for (const p of [String(d?.asset_platform_id || ''), ...Object.keys(platforms)]) {
      if (!CG_PLATFORM_CHAIN[p] || !platforms[p]) continue
      if (cands.some((c) => c.platform === p)) continue
      cands.push({ platform: p, chain: CG_PLATFORM_CHAIN[p], contract: String(platforms[p]) })
    }
    if (!cands.length) { _ttlSet(_cgPlatformCache, id, null); return null }

    // ONE deployment: nothing to compare, just the depth floor.
    if (cands.length === 1) {
      const pool = await loadGtPool(cands[0].contract, cands[0].chain).catch(() => null)
      const only = pool && (Number(pool.liquidity) || 0) >= MIN_PLATFORM_LIQUIDITY
        ? { contract: cands[0].contract, chain: cands[0].chain } : null
      if (only) _ttlSet(_cgPlatformCache, id, only)
      return only
    }

    // SEVERAL deployments, and taking the FIRST ratified one is not enough - the
    // depth floor is a floor, not a comparison. Measured 2026-08-21 on PORTAL
    // (portal-2 = ethereum + base + solana): CoinGecko quotes $0.01119 and Base's
    // $60k pool quotes $0.01118 with 500 5m bars, but `asset_platform_id` is
    // ethereum, whose $5.3k pool clears the floor and carries only 80 - so the
    // chart drew a sparse tape at every interval above 1m. Solana is worse still:
    // a $30k pool (deeper than Ethereum's!) quoting $0.02211, which nobody trades.
    //
    // So compare: the pool price must agree with CoinGecko's - the price-forming
    // venue does by definition, a thin bridge pool drifts - and among those the
    // deepest reserve wins. Depth alone would have picked Solana here.
    const ref = Number((await loadCgQuote(sym, hint).catch(() => null))?.price) || 0
    const probed = await Promise.all(cands.slice(0, 4).map(async (c) => {
      const pool = await loadGtPool(c.contract, c.chain).catch(() => null)
      const px = Number(pool?.price) || 0
      const depth = Number(pool?.liquidity) || 0
      const agrees = px > 0 && (!(ref > 0)
        || (px / ref <= GT_PRICE_TRUST_RATIO && ref / px <= GT_PRICE_TRUST_RATIO))
      return { c, depth, ok: agrees && depth >= MIN_PLATFORM_LIQUIDITY }
    }))
    const ranked = probed.filter((p) => p.ok).sort((a, b) => b.depth - a.depth)
    const out = ranked.length ? { contract: ranked[0].c.contract, chain: ranked[0].c.chain } : null
    if (out) _ttlSet(_cgPlatformCache, id, out)
    return out
  } catch (_) {
    return null
  }
}

// The box's /v1/prices row is the only source the price hero has, and on a
// fresh small cap it can come back with `price: 0` and every change null while
// looking perfectly healthy - `updated_at` is minutes old, so the ingester-
// stall guard in spectreMarketApi never fires, and the row carries no
// coingecko_id for its CG re-source lane either. Measured 2026-08-20 on
// BULLSHIT: price 0, market_cap 0, and a `contract` pointing at a DEAD
// same-ticker token ("SOME BULLSHIT WITH A GITHUB", no GT pools) - while the
// chart beside it drew the real 0.00072 -> 0.00376 tape, because the CHART
// lane resolves CoinGecko by symbol+hint and the hero does not. A zero
// rendered as "$0.00 / +0.00% today" is the worst outcome: it reads as a real
// quote rather than as missing data.
//
// So when the box has no price, ask the SAME CoinGecko id the chart already
// resolved (resolveCgId is cached, so this is usually free). Contract-keyed
// tokens are deliberately excluded by the caller - for those the GT pool is
// the higher-trust source and mergeGtStats already owns the hole-filling.
const _cgQuoteCache = new Map()

async function loadCgQuote(sym, hint) {
  const id = await resolveCgId(sym, hint)
  if (!id) return null
  const cached = _ttlGet(_cgQuoteCache, id, QUOTE_TTL)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(
      `/api/coingecko/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}&sparkline=false`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) },
    )
    if (!res.ok) { _ttlSet(_cgQuoteCache, id, null); return null }
    const row = (await res.json())?.[0]
    const price = Number(row?.current_price)
    const out = price > 0 ? {
      id,
      price,
      change24: Number(row.price_change_percentage_24h) || 0,
      marketCap: Number(row.market_cap) || 0,
      volume: Number(row.total_volume) || 0,
      high24h: Number(row.high_24h) || null,
      low24h: Number(row.low_24h) || null,
      ath: Number(row.ath) || null,
      rank: row.market_cap_rank ?? 0,
      name: row.name || null,
      image: row.image || null,
      circulatingSupply: Number(row.circulating_supply) || null,
      maxSupply: Number(row.max_supply) || null,
    } : null
    _ttlSet(_cgQuoteCache, id, out)
    return out
  } catch (_) {
    return null
  }
}

// Chain name -> Codex network id. codexApi.getNetworkId() is NOT usable here:
// it has no Solana entry and returns 1 (Ethereum) for anything unknown, so a
// Solana contract would be queried against the wrong chain and come back empty.
// Chain name -> Codex networkId. Ids read off Codex's own `getNetworks`
// (2026-08-20), not guessed. KEEP EVERY CHAIN IN `GT_NET` RESOLVABLE HERE: a
// chain GT knows but this map does not leaves `tvToken` null, which silently
// removes the whole TradingView tab for that token - sui / robinhood /
// hyperliquid were in exactly that state. TON and XRPL are the deliberate
// omissions: Codex has neither network, so those tokens keep the GT candle
// lanes only (and correctly get no TradingView tab).
const CODEX_NETWORK_ID = {
  solana: 1399811149, ethereum: 1, eth: 1, bsc: 56, binance: 56, base: 8453,
  arbitrum: 42161, polygon: 137, 'polygon_pos': 137, avalanche: 43114, avax: 43114,
  optimism: 10, tron: 728126428, fantom: 250, linea: 59144, blast: 81457,
  sui: 101, 'sui-network': 101, robinhood: 4663,
  hyperliquid: 999, hyperevm: 999,
}

const codexNetworkId = (ref) => (
  Number(ref?.networkId) || CODEX_NETWORK_ID[String(ref?.chain || '').toLowerCase()] || null
)

// LAST RESORT, and deliberately so: Codex is metered, so it only runs once the
// free lanes (Spectre, CoinGecko, GeckoTerminal) have all come back short.
const _codexCache = new Map()

// tf pill -> (Codex resolution, window). Mirrors GT_TF so the two contract-keyed
// lanes answer the same question at the same granularity - the Codex leg used to
// be daily-only, which made the 1D and 1W pills fall back to 1-2 bars.
const CODEX_TF = {
  '1D': { res: '15', days: 1 },
  '1W': { res: '60', days: 7 },
  '1M': { res: '240', days: 30 },
  '3M': { res: '1D', days: 90 },
  '6M': { res: '1D', days: 180 },
  '1Y': { res: '1D', days: 365 },
  'ALL': { res: '1D', days: 1825 },
}

async function loadCodexBars(ref, resolution, days) {
  const nid = codexNetworkId(ref)
  if (!ref?.contract || !nid) return null
  const span = days === 'max' ? 1825 : Math.max(Number(days) || 30, 1)
  const key = `${ref.contract}:${nid}:${resolution}:${span}`
  const cached = _ttlGet(_codexCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  try {
    const to = Math.floor(Date.now() / 1000)
    const res = await getBars(ref.contract, resolution, to - span * 86400, to, nid)
    const rows = (res?.getBars || [])
      .map((b) => ({
        // /api/bars speaks UNIX SECONDS; every consumer here expects seconds too.
        time: Number(b.time ?? b.t) || 0,
        o: Number(b.open ?? b.o), h: Number(b.high ?? b.h), l: Number(b.low ?? b.l),
        c: Number(b.close ?? b.c), close: Number(b.close ?? b.c) || 0,
      }))
      .filter((r) => r.time > 0 && r.close > 0)
      .sort((a, b) => a.time - b.time)
    const out = rows.length >= 2 ? rows : null
    _ttlSet(_codexCache, key, out)
    return out
  } catch (_) {
    return null
  }
}

const loadCodexDaily = (ref, days) => loadCodexBars(ref, '1D', days)

// Shared daily-series loader (chart, technicals, ROI all ride this + cache).
//
// Four lanes, cheapest first, longest series wins. Before this, a coin that
// wasn't one of the ~45 mapped majors had exactly ONE lane (the Spectre box)
// and no way to reach on-chain data at all, because ResearchView reduces
// watchlist entries to bare symbol strings — so tokens the box barely carries
// shimmered forever (founder 08-12, NOSIS).
//   1. Spectre box   — free, cached, thin on small caps
//   2. CoinGecko     — free, a full year for anything CG lists
//   3. GeckoTerminal — free, real DEX candles, needs a contract
//   4. Codex         — METERED, only when the three above came back short
/**
 * Is this an ON-CHAIN cap - a contract we can query directly, with no
 * CoinGecko listing behind the ticker? Those must NEVER be charted from a
 * symbol-keyed source. Mirrors `isOnchain` in the component.
 */
const isOnchainRef = (sym, ref) => !!ref?.contract && !SYMBOL_TO_COINGECKO_ID[sym]

/**
 * The ONLY series lane for an on-chain cap: keyed by CONTRACT, never by ticker.
 *
 * Why this exists (measured 2026-08-20 on THE DEALER,
 * `2YctT9F5...5wueeryppump`): the ticker `DEALER` is shared by at least six
 * Solana tokens. `/v1/prices/DEALER/ohlcv` answered with 13 daily rows, Aug 8-20,
 * peaking at **0.0038473** - and `meta.symbol` even read `"DEALER_DEALER"`. The
 * real contract has FOUR bars, all in July, around 2.2e-6 (GeckoTerminal and
 * Codex agree to the third digit). loadDailyWindow preferred the symbol lane and
 * then kept whichever series was LONGEST, so 13 wrong rows beat 4 right ones. The
 * page drew another token's month, appended this token's live 2.16e-6 at the right
 * edge, and produced a 1794x cliff - which is what "the charts are stretched"
 * looked like. The same rows also had `o == h == l == c`, so the Candles toggle
 * had no bodies to draw and silently rendered a line.
 *
 * Trust order, first answer wins - NOT longest wins. A short honest series beats
 * a long wrong one, and no data at all beats another asset's chart.
 */
async function loadOnchainWindow(ref, tfId) {
  if (!ref?.contract) return null
  const gt = await loadOnchainSeries(ref.contract, ref.chain, tfId).catch(() => null)
  if (gt && gt.length >= 2) return gt
  const spec = CODEX_TF[tfId] || CODEX_TF['1M']
  const cx = await loadCodexBars(ref, spec.res, spec.days).catch(() => null)
  return cx && cx.length >= 2 ? cx : null
}

// How far the newest bar of a series may sit from the live price before we stop
// believing the two describe the same asset. Generous on purpose - a degen can
// genuinely run 20x in a session; nothing legitimately runs 50x between its own
// last daily close and the current quote.
const SERIES_SCALE_TOLERANCE = 50

// How far apart the series and the quote are, as a ratio >= 1. Shared by the
// gate that refuses to draw and the empty state that has to explain why, so the
// two can never tell different stories.
function seriesDrift(rows, price) {
  const arr = Array.isArray(rows) ? rows : []
  if (!arr.length) return null
  const last = arr[arr.length - 1]
  const lc = Number(last?.close ?? last?.c)
  const px = Number(price)
  if (!(lc > 0) || !(px > 0)) return null
  return px > lc ? px / lc : lc / px
}

export async function loadDailyWindow(sym, days, opts = {}) {
  const { ref = null, hint = null, price = null } = opts
  // A CANDIDATE THAT CONTRADICTS THE QUOTE IS NOT A CANDIDATE. The symbol lanes
  // below pick the LONGEST answer, which quietly lets a wrong token win on
  // length alone: measured 2026-08-20 on GME, where the box's own daily series
  // is correct to the digit ($0.00038005 against a $0.000381 quote) and lost to
  // 365 CoinGecko rows belonging to one of the FIVE other coins trading as GME.
  // The final render gate then refused everything and the page drew nothing -
  // a correct series thrown away because a wrong one was longer.
  //
  // The gate is the same 50x used at render, so the two agree by construction.
  // With no price to check against it is inert, which is why `price` is part of
  // the cache key: the first call of a cold load often lands before the quote,
  // and its unvalidated answer must not be served back to the validated pass.
  const trusted = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return false
    return !((seriesDrift(arr, price) || 0) > SERIES_SCALE_TOLERANCE)
  }
  // The ref belongs in the cache key: the first call for a token often lands
  // before its contract has resolved, and without this the thin symbol-only
  // series would be cached and block the on-chain lanes for the whole TTL.
  const key = `${sym}:d${days}:${ref?.contract || '-'}:${Number(price) > 0 ? 'v' : '-'}`
  const cached = _ttlGet(_chartCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  const isAll = days === 'max'
  const want = isAll ? Infinity : Number(days) || 30

  // ON-CHAIN: contract-keyed only (see loadOnchainWindow). Every symbol lane
  // below can and does return a different token that happens to share the
  // ticker, and this function feeds the Technicals panel too - so a wrong
  // series here also printed somebody else's RSI.
  if (isOnchainRef(sym, ref)) {
    const oc = await loadOnchainWindow(ref, isAll ? 'ALL' : '1Y')
    if (oc) {
      const out = isAll ? oc : oc.slice(-days)
      _ttlSet(_chartCache, key, out)
      return out
    }
    // Dry contract lanes: fall to CG's close-only series ONLY when the ref was
    // recovered from CG itself (same asset by construction). See the chart
    // effect's twin comment - refs from the watchlist/box keep the hard stop.
    if (opts.cgDerived) {
      const deep = await fetchDeepDaily(sym, isAll ? 'max' : days, hint).catch(() => null)
      if (deep && trusted(deep)) {
        const out = isAll ? deep : deep.slice(-days)
        _ttlSet(_chartCache, key, out)
        return out
      }
    }
    return null
  }

  let series = []

  if (!isAll) {
    try {
      series = await getSpectreTokenChart(sym, { interval: '1d', limit: days })
    } catch (_) { /* fall through */ }
    if (!Array.isArray(series) || !trusted(series)) series = []
  }

  const short = () => isAll || series.length < want * 0.75

  if (short()) {
    const deep = await fetchDeepDaily(sym, isAll ? 'max' : days, hint)
    if (deep && trusted(deep) && deep.length > series.length) series = deep
  }
  if (short() && ref?.contract) {
    const gt = await loadOnchainSeries(ref.contract, ref.chain, isAll ? 'ALL' : '1Y').catch(() => null)
    if (gt && trusted(gt) && gt.length > series.length) series = gt
  }
  if (short() && ref?.contract) {
    const cx = await loadCodexDaily(ref, days).catch(() => null)
    if (cx && trusted(cx) && cx.length > series.length) series = cx
  }

  if (series.length === 0) return null
  const out = isAll ? series : series.slice(-days)
  _ttlSet(_chartCache, key, out)
  return out
}

// Stock daily/weekly closes via the Yahoo candles lane (2y of dailies,
// 5y of weeklies for ALL). Same {time, close} shape as the crypto loader.
const _stockChartCache = new Map()

async function loadStockDaily(sym, days) {
  const key = `stk:${sym}:${days}`
  const cached = _ttlGet(_stockChartCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  const isAll = days === 'max'
  const res = await getStockSeriesBars(sym, isAll ? '1W' : '1D')
  const bars = res?.bars || []
  const rows = bars
    .map((b) => ({ time: Number(b.t) || 0, close: Number(b.c) || 0 }))
    .filter((r) => r.time > 0 && r.close > 0)
  if (rows.length === 0) return null
  const out = isAll ? rows : rows.slice(-days)
  _ttlSet(_stockChartCache, key, out)
  return out
}

// OHLC series for the candle toggle. Crypto rides the UDF lane (Binance-clean
// for majors, Codex fallback upstream); small caps that come back empty fall
// to the daily line lanes below. Stocks reuse the Yahoo series (already OHLC).
const _ohlcCache = new Map()

const UDF_TF = {
  '1D': { res: '15', sec: 86400 },
  '1W': { res: '240', sec: 7 * 86400 },
  '1M': { res: '1D', sec: 30 * 86400 },
  '3M': { res: '1D', sec: 90 * 86400 },
  '6M': { res: '1D', sec: 180 * 86400 },
  '1Y': { res: '1D', sec: 365 * 86400 },
  'ALL': { res: '1W', sec: 5 * 365 * 86400 },
}

async function loadCryptoOhlc(sym, tfId) {
  const key = `udf:${sym}:${tfId}`
  const cached = _ttlGet(_ohlcCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  const spec = UDF_TF[tfId] || UDF_TF['1M']
  const to = Math.floor(Date.now() / 1000)
  try {
    const res = await fetch(`/api/tradingview/udf/history?symbol=${encodeURIComponent(sym)}&resolution=${spec.res}&from=${to - spec.sec}&to=${to}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    const d = res.ok ? await res.json() : null
    if (d?.s !== 'ok' || !Array.isArray(d.t) || d.t.length < 2) return null
    const rows = d.t.map((tt, i) => ({ time: tt, o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i], close: d.c[i] }))
      .filter((r) => r.close > 0)
    if (rows.length < 2) return null
    _ttlSet(_ohlcCache, key, rows)
    return rows
  } catch (_) {
    return null
  }
}

// Stock bars per timeframe - 15m for the day view, hourly for the week,
// dailies beyond, weeklies for ALL. Full OHLC kept so candles are free.
const STOCK_TF = {
  '1D': { res: '15', slice: 26 },
  '1W': { res: '60', slice: 33 },
  '1M': { res: '1D', slice: 21 },
  '3M': { res: '1D', slice: 63 },
  '6M': { res: '1D', slice: 126 },
  '1Y': { res: '1D', slice: 252 },
  'ALL': { res: '1W', slice: 0 },
}

async function loadStockSeries(sym, tfId) {
  const spec = STOCK_TF[tfId] || STOCK_TF['1M']
  const key = `stkohlc:${sym}:${tfId}`
  const cached = _ttlGet(_ohlcCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  const res = await getStockSeriesBars(sym, spec.res)
  const bars = res?.bars || []
  const rows = bars
    .map((b) => ({ time: Number(b.t) || 0, o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), close: Number(b.c) || 0 }))
    .filter((r) => r.time > 0 && r.close > 0)
  if (rows.length < 2) return null
  const out = spec.slice > 0 ? rows.slice(-spec.slice) : rows
  _ttlSet(_ohlcCache, key, out)
  return out
}

// On-chain small caps: GeckoTerminal by CONTRACT (CSP already allows it).
// Pools once per contract (best by reserve), then OHLC per timeframe. The
// pool attributes also patch price/change/volume/mcap holes the box leaves
// on barely-tracked tokens (BACKED showed +0.00% forever).
const GT_NET = {
  solana: 'solana', ethereum: 'eth', eth: 'eth', bsc: 'bsc', binance: 'bsc',
  base: 'base', arbitrum: 'arbitrum', polygon: 'polygon_pos', avalanche: 'avax',
  optimism: 'optimism', tron: 'tron', ton: 'ton', sui: 'sui-network',
  robinhood: 'robinhood', hyperliquid: 'hyperevm', linea: 'linea', blast: 'blast',
  xrpl: 'xrpl', xrp: 'xrpl',
}
const _gtPoolCache = new Map()
const _gtOhlcCache = new Map()
const _mentionsCache = new Map()

// GT network id -> our chain key (inverse of GT_NET; first writer wins so the
// canonical names map back: eth -> ethereum, polygon_pos -> polygon, ...).
const GT_NET_CHAIN = (() => {
  const m = {}
  for (const [chain, net] of Object.entries(GT_NET)) if (!m[net]) m[net] = chain
  return m
})()

// LAST identity rung — GeckoTerminal's OWN search. Fires only when CoinGecko
// could not name a deployment (resolveCgPlatform returned null: the token is
// CG-unlisted, or nothing ratified). GT indexes pools CG has never listed,
// which is exactly the class that otherwise falls to the symbol lanes and an
// honest empty chart. Discipline mirrors resolveCgId: a candidate is accepted
// on HINT evidence (exact name -> CG image id -> unique loose name -> single
// candidate), and pool depth alone only ever decides when the live quote
// corroborates the pool's price — several same-ticker tokens with no evidence
// is a refusal, because an honest empty beats a same-ticker twin. Dust pools
// never qualify (MIN_PLATFORM_LIQUIDITY — the §I8 lesson: an unratified
// contract once promoted a $0.0000000026 pool over a working CG lane).
const _gtSearchCache = new Map()

async function resolveGtSearch(sym, hint, quote) {
  const key = `${sym}:${hint?.name || ''}`
  const cached = _ttlGet(_gtSearchCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(sym)}&page=1&include=base_token`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) },
    )
    // Transport failure is NOT a failed lookup — never cache it (resolveCgId
    // rule: only a successful search may write a negative).
    if (!res.ok) return null
    const payload = await res.json()
    const tokens = new Map()
    for (const t of payload?.included || []) {
      if (t?.type === 'token' && t.id) tokens.set(String(t.id), t.attributes || {})
    }
    // One candidate per token: its deepest BASE-side pool. Search results
    // carry no network relationship — the net is the token id's prefix
    // (`{net}_{address}`), recovered via the included token's own address so
    // nets containing underscores (polygon_pos) parse correctly. Quote-side
    // hits are skipped: a pool where our symbol is the QUOTE prices somebody
    // else's tape (the CATE/lickingcat lesson in loadGtPool).
    const byToken = new Map()
    for (const p of payload?.data || []) {
      const id = String(p?.relationships?.base_token?.data?.id || '')
      const t = tokens.get(id)
      if (!t || String(t.symbol || '').toUpperCase() !== sym) continue
      const addr = String(t.address || '')
      if (!addr || id.length <= addr.length) continue
      const chain = GT_NET_CHAIN[id.slice(0, id.length - addr.length - 1)]
      if (!chain) continue
      const depth = Number(p?.attributes?.reserve_in_usd) || 0
      const prev = byToken.get(id)
      if (!prev || depth > prev.depth) {
        byToken.set(id, {
          contract: addr, chain, depth,
          price: Number(p?.attributes?.base_token_price_usd) || 0,
          name: String(t.name || ''), image: String(t.image_url || ''),
        })
      }
    }
    const cands = [...byToken.values()].filter((c) => c.depth >= MIN_PLATFORM_LIQUIDITY)
    if (!cands.length) { _ttlSet(_gtSearchCache, key, null); return null }
    const wantName = String(hint?.name || '').trim().toLowerCase()
    const wantImg = cgImageId(hint?.image)
    const loose = wantName ? cands.filter((c) => cgLooseName(c.name) === cgLooseName(wantName)) : []
    const q = Number(quote) || 0
    const agrees = (c) => q > 0 && c.price > 0 &&
      c.price / q <= GT_PRICE_TRUST_RATIO && q / c.price <= GT_PRICE_TRUST_RATIO
    // Within a set that passed the same evidence, rank instead of taking the
    // first hit — clone farms copy the NAME verbatim (measured: 11 exact
    // "world licking cat" candidates, one real solana pool + a robinhood
    // clone swarm), so "first name match" is iteration-order-dependent, the
    // same class as the first-mappable-platform bug resolveCgPlatform fixed.
    // Quote-agreeing candidates outrank the rest; depth breaks the tie.
    const best = (list) => {
      if (!list.length) return null
      const pref = list.filter(agrees)
      return [...(pref.length ? pref : list)].sort((a, b) => b.depth - a.depth)[0]
    }
    const pick =
      best(wantName ? cands.filter((c) => c.name.trim().toLowerCase() === wantName) : []) ||
      best(wantImg ? cands.filter((c) => cgImageId(c.image) === wantImg) : []) ||
      // Loose-name stays UNIQUE-only (the resolveCgId rule): it is weaker
      // evidence, so a multi-match there is a refusal, not a ranking.
      (loose.length === 1 ? loose[0] : null) ||
      (cands.length === 1 ? cands[0] : null) ||
      (q > 0 ? best(cands.filter(agrees)) : null) ||
      null
    const out = pick ? { contract: pick.contract, chain: pick.chain } : null
    _ttlSet(_gtSearchCache, key, out)
    return out
  } catch (_) {
    return null
  }
}

async function loadGtPool(contract, chain) {
  const net = GT_NET[String(chain || '').toLowerCase()]
  if (!net || !contract) return null
  const key = `${net}:${contract}`
  const cached = _ttlGet(_gtPoolCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${encodeURIComponent(contract)}/pools?page=1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    const payload = res.ok ? await res.json() : null
    const pools = payload?.data || []
    if (!pools.length) { _ttlSet(_gtPoolCache, key, null); return null }
    // WHICH SIDE OF THE POOL ARE WE? `base_token_price_usd` is the price of the
    // pool's BASE token, and the deepest pool for a token is not always one
    // where it IS the base - measured on lickingcat, whose pool list carries a
    // `CATE / lickingcat` pair. Reading base_token_price_usd there hands back
    // CATE's price under our ticker. Tag each pool with our own side and read
    // the matching price field.
    const want = String(contract).toLowerCase()
    const sideOf = (p) => {
      const b = String(p?.relationships?.base_token?.data?.id || '').toLowerCase()
      const q = String(p?.relationships?.quote_token?.data?.id || '').toLowerCase()
      if (b.endsWith(`_${want}`) || b === want) return 'base'
      if (q.endsWith(`_${want}`) || q === want) return 'quote'
      return null
    }
    const deepest = (list) => list.reduce((a, b) => ((Number(b?.attributes?.reserve_in_usd) || 0) > (Number(a?.attributes?.reserve_in_usd) || 0) ? b : a))
    // Base-side pools win outright: GT's pool OHLCV endpoint prices the BASE
    // token by default, so a base-side pool keeps price and candles on one
    // tape. A quote-side pool is only a last resort and carries its side so
    // the series call can ask for `token=quote`.
    const asBase = pools.filter((p) => sideOf(p) === 'base')
    const asQuote = pools.filter((p) => sideOf(p) === 'quote')
    // Fall back to the old all-pools pick only when GT gives us no relationship
    // data at all, so a shape change degrades instead of breaking.
    const best = asBase.length ? deepest(asBase) : (asQuote.length ? deepest(asQuote) : deepest(pools))
    const side = asBase.length ? 'base' : (asQuote.length ? 'quote' : 'base')
    const at = best?.attributes || {}
    const out = {
      net,
      side,
      address: at.address || String(best.id || '').replace(`${net}_`, ''),
      price: Number(side === 'quote' ? at.quote_token_price_usd : at.base_token_price_usd) || null,
      // The percentage is the pool's BASE-token move; on a quote-side pool it
      // is somebody else's number, so leave it blank rather than print a lie.
      change24: side === 'quote' ? NaN : Number(at.price_change_percentage?.h24),
      volume24: Number(at.volume_usd?.h24) || null,
      liquidity: Number(at.reserve_in_usd) || null,
      // Same caveat as change24: GT's pool-level cap/FDV describe the base token.
      marketCap: side === 'quote' ? null : (Number(at.market_cap_usd) || Number(at.fdv_usd) || null),
    }
    _ttlSet(_gtPoolCache, key, out)
    return out
  } catch (_) {
    return null
  }
}

const GT_TF = {
  '1D': { tf: 'hour', agg: 1, limit: 24 },
  '1W': { tf: 'hour', agg: 4, limit: 42 },
  '1M': { tf: 'day', agg: 1, limit: 30 },
  '3M': { tf: 'day', agg: 1, limit: 90 },
  '6M': { tf: 'day', agg: 1, limit: 180 },
  '1Y': { tf: 'day', agg: 1, limit: 365 },
  'ALL': { tf: 'day', agg: 1, limit: 1000 },
}

async function loadOnchainSeries(contract, chain, tfId) {
  const pool = await loadGtPool(contract, chain)
  if (!pool?.address) return null
  const spec = GT_TF[tfId] || GT_TF['1M']
  const key = `${pool.net}:${pool.address}:${tfId}`
  const cached = _ttlGet(_gtOhlcCache, key, SERIES_TTL)
  if (cached !== undefined) return cached
  try {
    // `token=quote` when our contract is the pool's quote side - without it GT
    // prices the base token and the chart draws the wrong asset.
    const tokenParam = pool.side === 'quote' ? '&token=quote' : ''
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${pool.net}/pools/${pool.address}/ohlcv/${spec.tf}?aggregate=${spec.agg}&limit=${spec.limit}${tokenParam}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    const payload = res.ok ? await res.json() : null
    const list = payload?.data?.attributes?.ohlcv_list || []
    const rows = list
      .map((r) => ({ time: Number(r[0]) || 0, o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), close: Number(r[4]) || 0 }))
      .filter((r) => r.time > 0 && r.close > 0)
      .sort((a, b) => a.time - b.time)
    if (rows.length < 2) return null
    _ttlSet(_gtOhlcCache, key, rows)
    return rows
  } catch (_) {
    return null
  }
}

// How far the box row's price may sit from the live pool price before we stop
// believing the box at all. Two sources quoting the SAME contract cannot
// legitimately disagree by half - a gap that wide means the box row is not this
// token's tape.
const GT_PRICE_TRUST_RATIO = 1.5

/**
 * Merge a GeckoTerminal pool reading into the Spectre-box stats row.
 *
 * The box's /v1/prices row is SYMBOL-keyed; GT is queried by CONTRACT. On
 * barely-tracked on-chain caps the box row is wrong, and not subtly:
 * measured 2026-08-20, LICKINGCAT (EjD5Y9...pump) came back at 2.0748e-5 with
 * mcap 0 while the deepest pool - same contract - traded at 3.10e-4, a 15x lie.
 * That is the number LITE printed in the price hero while the TradingView pane
 * beside it drew the real 3.1e-4 tape, which is what "the chart is broken"
 * looked like (the chart was right; the hero was not). A wrong hero price also
 * poisons the widget: it is handed down as `referencePrice`, which sets the
 * pricescale and feeds TVA's bad-data guard - past 100x off, that guard kills
 * the chart outright.
 *
 * So: a price disagreement is treated exactly like a contract mismatch - the
 * whole row is distrusted, not just the one field, because every market number
 * in it (cap, 24h high/low, ATH) was derived from that same bad price.
 */
function mergeGtStats(prev, meta, contract, chain, fallbackName) {
  if (!meta) return prev
  if (!prev) {
    return {
      name: fallbackName, price: meta.price, change24: meta.change24,
      marketCap: meta.marketCap || 0, volume: meta.volume24 || 0, liquidity: meta.liquidity,
      high24h: null, low24h: null, fdv: 0, rank: 0, circulatingSupply: null, maxSupply: null,
      contract, chain, _gt: contract,
    }
  }
  const gtPx = Number(meta.price)
  const boxPx = Number(prev.price)
  const scaleLie = gtPx > 0 && boxPx > 0
    && (gtPx / boxPx > GT_PRICE_TRUST_RATIO || boxPx / gtPx > GT_PRICE_TRUST_RATIO)
  const mismatch = (prev.contract && String(prev.contract).toLowerCase() !== String(contract).toLowerCase())
    || scaleLie
  return {
    ...prev,
    _gt: contract,
    contract,
    chain,
    // A distrusted row is a DIFFERENT token's row - its name and logo are as
    // wrong as its price (the "UP" chimera wore Superform's name over unitas's
    // numbers). fallbackName is the clicked row's own name when the caller has
    // one.
    name: mismatch ? (fallbackName || prev.name) : prev.name,
    image: mismatch ? null : prev.image,
    price: mismatch || !(prev.price > 0) ? (meta.price ?? prev.price) : prev.price,
    change24: (mismatch || !Number.isFinite(Number(prev.change24)) || Number(prev.change24) === 0) && Number.isFinite(meta.change24) ? meta.change24 : prev.change24,
    marketCap: mismatch || !(prev.marketCap > 0) ? (meta.marketCap ?? prev.marketCap) : prev.marketCap,
    volume: mismatch || !(prev.volume > 0) ? (meta.volume24 ?? prev.volume) : prev.volume,
    liquidity: prev.liquidity > 0 ? prev.liquidity : (meta.liquidity ?? prev.liquidity),
    high24h: mismatch ? null : prev.high24h,
    low24h: mismatch ? null : prev.low24h,
    ath: mismatch ? null : prev.ath,
    rank: mismatch ? 0 : prev.rank,
  }
}

// Fill-only counterpart to mergeGtStats: the CG quote never overwrites a
// number the box actually had, it only covers the holes an all-zero row left.
function mergeCgQuote(prev, q, sym) {
  if (!q) return prev
  const keep = (a, b) => (Number(a) > 0 ? a : b)
  if (!prev) {
    return {
      name: q.name || sym, image: q.image, price: q.price, change24: q.change24,
      marketCap: q.marketCap, volume: q.volume, high24h: q.high24h, low24h: q.low24h,
      ath: q.ath, rank: q.rank, circulatingSupply: q.circulatingSupply,
      maxSupply: q.maxSupply, fdv: 0, _cg: q.id,
    }
  }
  return {
    ...prev,
    _cg: q.id,
    price: keep(prev.price, q.price),
    // A row with no price has no honest 24h change either - the box sends null
    // there, which normalizes to 0 and prints as a flat "+0.00% today".
    change24: Number(prev.price) > 0 ? prev.change24 : q.change24,
    marketCap: keep(prev.marketCap, q.marketCap),
    volume: keep(prev.volume, q.volume),
    high24h: keep(prev.high24h, q.high24h),
    low24h: keep(prev.low24h, q.low24h),
    rank: keep(prev.rank, q.rank),
    // The box falls back to the bare ticker when it has no name of its own.
    name: prev.name && prev.name !== sym ? prev.name : (q.name || prev.name),
    image: prev.image || q.image,
    circulatingSupply: keep(prev.circulatingSupply, q.circulatingSupply),
    maxSupply: keep(prev.maxSupply, q.maxSupply),
    ath: prev.ath || q.ath,
  }
}

// A tweet arrives as raw collector text, and it needs three passes before it
// can be read in a 400px rail.
//
// 1. MOJIBAKE. The collector stores SOME rows double-encoded - utf-8 bytes read
//    back through cp1252 - so the same tweet lands twice, once as "don't" and
//    once as "donâ€™t" (measured 2026-08-20: 3 of 6 rows on
//    /v1/social/mentions/BULLSHIT). Repair per RUN, not per string, so a row
//    that mixes clean text with one broken sequence keeps the rest untouched.
//    A run carrying U+FFFD lost a byte upstream and is unrecoverable - drop it.
// 2. t.co links. Opaque, and the card already links to the post.
// 3. Contract addresses. A 44-char base58 blob is one unbreakable word; middle
//    -ellipsis keeps the shape without eating the whole preview.
const CP1252_HIGH = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A,
  '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C,
  'ž': 0x9E, 'Ÿ': 0x9F,
}
const MOJI_CONT = '[\\u0080-\\u00BF\\uFFFD\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178]'
const MOJI_RUN = new RegExp(
  `(?:[\\u00C2-\\u00DF]${MOJI_CONT}|[\\u00E0-\\u00EF]${MOJI_CONT}{2}|[\\u00F0-\\u00F4]${MOJI_CONT}{3})+`,
  'g',
)

function repairMojibake(s) {
  if (!s || !/[Â-ô]/.test(s)) return s
  return s.replace(MOJI_RUN, (run) => {
    if (run.includes('�')) return ''
    const bytes = new Uint8Array(run.length)
    for (let i = 0; i < run.length; i += 1) {
      const code = run.charCodeAt(i)
      const b = code < 0x100 ? code : CP1252_HIGH[run[i]]
      if (b === undefined) return run
      bytes[i] = b
    }
    try {
      const out = new TextDecoder('utf-8').decode(bytes)
      return out.includes('�') ? run : out
    } catch (_) {
      return run
    }
  })
}

function cleanMentionText(raw) {
  return repairMojibake(String(raw || ''))
    .replace(/https?:\/\/t\.co\/\S+/g, '')
    .replace(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`)
    .replace(/\s+/g, ' ')
    .trim()
}

// Tracked X chatter for small caps (news lanes only cover the big names).
async function loadMentions(sym) {
  const cached = _ttlGet(_mentionsCache, sym, SOCIAL_TTL)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(`/data-api/v1/social/mentions/${encodeURIComponent(sym)}?limit=6`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    const payload = res.ok ? await res.json() : null
    const rows = (payload?.data?.recent || [])
      .map((r, i) => ({
        id: r.id || String(i),
        text: cleanMentionText(r.text).slice(0, 220),
        handle: r.author_handle || '',
        url: r.url || null,
        ts: r.posted_at ? Math.floor(new Date(r.posted_at).getTime() / 1000) : 0,
      }))
      .filter((r) => r.text)
    _ttlSet(_mentionsCache, sym, rows)
    return rows
  } catch (_) {
    return []
  }
}

// Company profile + analyst consensus (Perplexity-Finance-style cards).
const _profileCache = new Map()
const _analystCache = new Map()

async function loadStockProfile(sym) {
  const cached = _ttlGet(_profileCache, sym, FUNDAMENTALS_TTL)
  if (cached !== undefined) return cached
  const prof = await getCompanyProfile(sym).catch(() => null)
  _ttlSet(_profileCache, sym, prof || null)
  return prof
}

async function loadAnalysts(sym) {
  const cached = _ttlGet(_analystCache, sym, FUNDAMENTALS_TTL)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(`/api/stocks/analysts/${encodeURIComponent(sym)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    const data = res.ok ? await res.json() : null
    const out = data?.consensus?.total > 0 ? data : null
    _ttlSet(_analystCache, sym, out)
    return out
  } catch (_) {
    return null
  }
}

// BINANCE_TV_SET + the widget identity rule live in lite-tv-identity.js
// (pure, unit-tested; shared with screener-lite's cinema chart).

// Static big-name chips for stocks mode (mcap order shifts; identity doesn't).
const STOCK_CHIPS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'BRK-B', 'SPCX']

function fmtAxisDate(ts, tfId, locale) {
  const d = new Date(ts * 1000)
  if (tfId === '1D') return d.toLocaleTimeString(locale || undefined, { hour: '2-digit', minute: '2-digit' })
  // 'numeric', not '2-digit': "Aug 25" on an axis whose other ranges print
  // "Aug 25" as a DAY is unreadable - a reader cannot tell the year from the date.
  if (tfId === '1Y' || tfId === 'ALL' || tfId === '6M') return d.toLocaleDateString(locale || undefined, { month: 'short', year: 'numeric' })
  return d.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' })
}

// Local mini-skeleton (lite-page's SkeletonRows isn't imported here - this
// file is imported BY lite-page; keep the dependency one-directional).
function SkelRows({ n = 4 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </ul>
  )
}

// Downsampling candles must MERGE buckets (o=first, c=last, h=max, l=min) -
// dropping every Nth candle leaves gaps and lies about wicks.
function aggregateCandles(rows, target) {
  if (rows.length <= target) return rows
  const bucket = Math.ceil(rows.length / target)
  const out = []
  for (let i = 0; i < rows.length; i += bucket) {
    const chunk = rows.slice(i, i + bucket)
    out.push({
      time: chunk[0].time,
      o: Number(chunk[0].o),
      c: Number(chunk[chunk.length - 1].c),
      h: Math.max(...chunk.map((r) => Number(r.h))),
      l: Math.min(...chunk.map((r) => Number(r.l))),
      close: Number(chunk[chunk.length - 1].c),
    })
  }
  return out
}

// Odometer price: every digit is a column of 0-9 that slides to the value, so
// a scrub across the chart rolls the number instead of flashing it (the same
// mechanic as the prediction page's pd-chart-value-main). Digits are keyed by
// position, so a change in length (9,999 -> 10,000) simply remounts.
const ROLL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
function RollingNumber({ text }) {
  const str = String(text ?? '')
  return (
    <span className="lite-roll" aria-label={str}>
      {str.split('').map((ch, i) => (/\d/.test(ch) ? (
        <span key={`d${i}`} className="lite-roll-wrap" aria-hidden>
          <span className="lite-roll-col" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
            {ROLL_DIGITS.map((d) => <span key={d} className="lite-roll-num">{d}</span>)}
          </span>
        </span>
      ) : (
        <span key={`c${i}`} className="lite-roll-ch" aria-hidden>{ch}</span>
      )))}
    </span>
  )
}

// "Nice" price levels for the y grid (1-2-5 steps), so the axis reads
// $70,000 / $75,000 / $80,000 rather than four arbitrary quartiles.
function niceStep(range, target) {
  const rough = range / Math.max(1, target)
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const m = rough / pow
  const nice = m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1
  return nice * pow
}

// Monotone cubic (Fritsch-Carlson): a smooth line that never overshoots a
// data point, so a spike still peaks at the printed high.
function monotonePath(pts) {
  const n = pts.length
  if (n < 3) return `M${pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')}`
  const dx = [], m = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6
    m[i] = (pts[i + 1].y - pts[i].y) / dx[i]
  }
  const t = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b
    if (h > 9) { const tau = 3 / Math.sqrt(h); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i] }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3, c1y = pts[i].y + (t[i] * dx[i]) / 3
    const c2x = pts[i + 1].x - dx[i] / 3, c2y = pts[i + 1].y - (t[i + 1] * dx[i]) / 3
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`
  }
  return d
}

function LiteChart({ rows, tfId, fmtPrice, locale, mode = 'line', onScrub, live, emptyLabel = 'No price history available for this token yet.' }) {
  const [cross, setCross] = useState(null)
  const wrapRef = React.useRef(null)
  const roRef = React.useRef(null)
  // Drawn in real pixels. The previous chart was an 800x260 viewBox with
  // preserveAspectRatio="none", stretched to whatever height the stage gave
  // it - every angle in the line was distorted and text could not live in
  // the SVG at all. Measuring the host lets the geometry, the grid labels
  // and the crosshair share one coordinate space.
  const [size, setSize] = useState({ w: 0, h: 0 })
  const stageRef = React.useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    wrapRef.current = el
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((prev) => (Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1) ? prev : { w: r.width, h: r.height })
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      roRef.current = new ResizeObserver(measure)
      roRef.current.observe(el)
    }
  }, [])

  const chart = useMemo(() => {
    if (!Array.isArray(rows) || rows.length < 2) return null
    // Carrying o/h/l/c FIELDS is not the same as carrying OHLC DATA: the box's
    // `price_history_daily` lane replicates each daily close into all four
    // (measured 2026-08-21 on FUZZY - 35/35 rows o==h==l==c), which drew a
    // month of zero-height dashes under the Candles pill. A series is
    // candle-capable only if some bar actually has a range. The LAST row is
    // excluded from the check - the live-price anchor in chartRows widens its
    // h/l, so on a fake-flat series it is the one bar with a synthetic body.
    const hasOhlc = rows[0]?.o != null && rows[0]?.h != null
      && rows.slice(0, -1).some((r) => Number(r.h) > Number(r.l))
    const candleMode = mode === 'candles' && hasOhlc
    const W = size.w || 800
    const H = size.h || 320
    // Candles aggregate into buckets sized to the plot (bodies stay chunky);
    // the line path subsamples to about two points per pixel.
    const plotWGuess = W - 84
    const src = candleMode
      ? aggregateCandles(rows, Math.max(20, Math.min(160, Math.floor(plotWGuess / 7))))
      : rows.length > plotWGuess * 2 ? rows.filter((_, i) => i % Math.ceil(rows.length / (plotWGuess * 2)) === 0 || i === rows.length - 1) : rows
    const closes = src.map((r) => Number(r.close ?? r.c) || 0)
    const dMin = candleMode ? Math.min(...src.map((r) => Number(r.l) || Infinity)) : Math.min(...closes)
    const dMax = candleMode ? Math.max(...src.map((r) => Number(r.h) || 0)) : Math.max(...closes)
    const dSpan = dMax - dMin || dMax || 1
    // A little air above and below so the line never kisses the frame.
    const lo = dMin - dSpan * 0.06
    const hi = dMax + dSpan * 0.06
    const span = hi - lo || 1
    const padL = 6, padR = 76, padT = 12, padB = 26
    const plotW = Math.max(40, W - padL - padR)
    const plotH = Math.max(40, H - padT - padB)
    const n = closes.length
    const x = (i) => padL + (i * plotW) / (n - 1)
    const y = (v) => padT + plotH * (1 - (v - lo) / span)
    const pts = closes.map((v, i) => ({ x: x(i), y: y(v) }))
    const smooth = !candleMode && n <= 400
    const line = smooth ? monotonePath(pts) : `M${pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')}`
    const floor = padT + plotH
    const area = `${line} L${x(n - 1).toFixed(1)},${floor} L${padL},${floor} Z`
    const up = closes[n - 1] >= closes[0]
    // Y grid on nice levels, clipped to the plot.
    const step = niceStep(dSpan, 4)
    const ticks = []
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const yy = y(v)
      if (yy >= padT + 6 && yy <= floor - 6) ticks.push({ v, y: yy })
    }
    // X labels: first and last anchored to the edges, the rest evenly spaced.
    const xCount = Math.max(2, Math.min(7, Math.floor(plotW / 130)))
    const xt = []
    for (let k = 0; k < xCount; k++) {
      const i = Math.round((k * (n - 1)) / (xCount - 1))
      const r = src[i]
      xt.push({ i, x: x(i), ts: r.time ?? r.t, anchor: k === 0 ? 'start' : k === xCount - 1 ? 'end' : 'middle' })
    }
    // Baseline view (CMC-style): green above the period open, red below.
    const base = mode === 'baseline' ? closes[0] : null
    const yBase = base != null ? y(base) : null
    const areaBase = base != null
      ? `${line} L${x(n - 1).toFixed(1)},${yBase.toFixed(1)} L${padL},${yBase.toFixed(1)} Z`
      : null
    const candles = candleMode ? src.map((r, i) => {
      const cx = x(i)
      const bw = Math.max(1.6, Math.min(14, (plotW / n) * 0.64))
      const yO = y(Number(r.o))
      const yC = y(Number(r.c))
      return {
        k: i,
        up: Number(r.c) >= Number(r.o),
        cx,
        bw,
        yH: y(Number(r.h)),
        yL: y(Number(r.l)),
        yTop: Math.min(yO, yC),
        bh: Math.max(1, Math.abs(yO - yC)),
      }
    }) : null
    const last = closes[n - 1]
    return {
      line, area, up, min: dMin, max: dMax, first: src[0], last: src[n - 1],
      W, H, padL, padR, padT, plotW, plotH, floor, candles, src, ticks, xt,
      base, yBase, areaBase, x, y, lastX: x(n - 1), lastY: y(last), lastClose: last,
    }
  }, [rows, mode, size.w, size.h])

  // null/undefined = the lanes are still running. An ARRAY that can't be
  // charted = every lane answered and none of them had history, which is a
  // result, not a loading state. Shimmering forever on a token nothing carries
  // is the "why aren't tokens loading" report (founder 08-12) - the page looked
  // broken when it was simply out of data.
  if (!chart) {
    return (
      <div className="lite-chart-empty">
        {Array.isArray(rows)
          ? <p className="lite-empty">{emptyLabel}</p>
          : <SkelRows n={5} />}
      </div>
    )
  }

  const onMove = (e) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = e.clientX - rect.left
    const frac = Math.min(1, Math.max(0, (px - chart.padL) / chart.plotW))
    const idx = Math.min(chart.src.length - 1, Math.max(0, Math.round(frac * (chart.src.length - 1))))
    const r = chart.src[idx]
    const price = Number(r.close ?? r.c)
    setCross({ x: chart.x(idx), y: chart.y(price), price, time: r.time ?? r.t })
    // Perplexity-style scrub: the header price/change follows the cursor.
    onScrub?.({ price, time: r.time ?? r.t })
  }
  const measured = size.w > 0
  const tagY = Math.min(chart.floor - 9, Math.max(chart.padT + 9, chart.lastY))
  const rightEdge = chart.padL + chart.plotW

  return (
    <div className={`lite-chart lite-chart--px ${chart.up ? 'up' : 'down'}`}>
      <div
        ref={stageRef}
        className="lite-chart-stage spectre-wm-host"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => { setCross(null); onScrub?.(null) }}
      >
      {measured && (
      <svg viewBox={`0 0 ${chart.W} ${chart.H}`} width={chart.W} height={chart.H} aria-hidden>
        <defs>
          <linearGradient id="liteChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
            <stop offset="70%" stopColor="currentColor" stopOpacity="0.04" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <clipPath id="litePlot"><rect x="0" y="0" width={rightEdge + 1} height={chart.H} /></clipPath>
        </defs>
        {/* Grid: nice price levels, and the plot floor */}
        {chart.ticks.map((tk, i) => (
          <line key={i} x1={chart.padL} x2={rightEdge} y1={tk.y} y2={tk.y} className="lite-chart-grid" />
        ))}
        <line x1={chart.padL} x2={rightEdge} y1={chart.floor} y2={chart.floor} className="lite-chart-floor" />
        {chart.candles ? (
          chart.candles.map((cd) => (
            <g key={cd.k} className={`lite-candle ${cd.up ? 'lite-candle--up' : 'lite-candle--down'}`}>
              <line x1={cd.cx} x2={cd.cx} y1={cd.yH} y2={cd.yL} strokeWidth="1" />
              <rect x={cd.cx - cd.bw / 2} y={cd.yTop} width={cd.bw} height={cd.bh} rx="0.5" />
            </g>
          ))
        ) : chart.yBase != null ? (
          <>
            <defs>
              <clipPath id="liteBaseUp"><rect x="0" y="0" width={chart.W} height={Math.max(0, chart.yBase)} /></clipPath>
              <clipPath id="liteBaseDn"><rect x="0" y={chart.yBase} width={chart.W} height={Math.max(0, chart.H - chart.yBase)} /></clipPath>
            </defs>
            <g clipPath="url(#liteBaseUp)" className="lite-base lite-base--up">
              <path d={chart.areaBase} stroke="none" />
              <path d={chart.line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
            <g clipPath="url(#liteBaseDn)" className="lite-base lite-base--down">
              <path d={chart.areaBase} stroke="none" />
              <path d={chart.line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
            <line x1={chart.padL} x2={rightEdge} y1={chart.yBase} y2={chart.yBase} className="lite-base-ref" />
          </>
        ) : (
          <g clipPath="url(#litePlot)">
            <path d={chart.area} fill="url(#liteChartFill)" stroke="none" />
            <path d={chart.line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        )}
        {/* Last price: dashed level across the plot, tagged in the gutter */}
        {!chart.candles && (
          <line x1={chart.padL} x2={rightEdge} y1={chart.lastY} y2={chart.lastY} className="lite-chart-last" />
        )}
        {/* Y labels in the gutter; the one under the last-price tag steps aside */}
        {chart.ticks
          .filter((tk) => chart.candles || Math.abs(tk.y - tagY) > 11)
          .filter((tk) => chart.base == null || Math.abs(tk.y - chart.yBase) > 14)
          .map((tk, i) => (
            <text key={i} x={rightEdge + 10} y={tk.y} className="lite-chart-ylab" dominantBaseline="middle">{fmtPrice(tk.v)}</text>
          ))}
        {chart.base != null && (
          <text x={rightEdge + 10} y={chart.yBase} className="lite-chart-ylab lite-chart-ylab--base" dominantBaseline="middle">{fmtPrice(chart.base)}</text>
        )}
        {!chart.candles && (
          <g className="lite-chart-lasttag" transform={`translate(${rightEdge + 6}, ${tagY})`}>
            <rect x="0" y="-9" width={chart.padR - 8} height="18" rx="4" />
            <text x={(chart.padR - 8) / 2} y="0" textAnchor="middle" dominantBaseline="middle">{fmtPrice(chart.lastClose)}</text>
          </g>
        )}
        {/* X labels */}
        {chart.xt.map((tk) => (
          <text key={tk.i} x={tk.x} y={chart.H - 8} textAnchor={tk.anchor} className="lite-chart-xlab">{fmtAxisDate(tk.ts, tfId, locale)}</text>
        ))}
        {cross && (
          <g className="lite-chart-cross-svg">
            <line x1={cross.x} x2={cross.x} y1={chart.padT} y2={chart.floor} className="lite-chart-cross-line" />
            <line x1={chart.padL} x2={rightEdge} y1={cross.y} y2={cross.y} className="lite-chart-cross-line lite-chart-cross-h" />
            <circle cx={cross.x} cy={cross.y} r="4.5" className="lite-chart-cross-pt" />
          </g>
        )}
      </svg>
      )}
      {measured && live && !chart.candles && (
        <span className="lite-chart-livedot" style={{ left: chart.lastX, top: chart.lastY }} aria-hidden />
      )}
      {cross && (
        <div className="lite-chart-cross" aria-hidden>
          <span
            className="lite-chart-cross-tip lite-chart-cross-tip--anchored"
            style={{
              left: cross.x,
              top: cross.y,
              // Above the point, centred; flips below near the top edge and
              // slides sideways near either side so it never leaves the plot.
              transform: `translate(${cross.x < chart.padL + 70 ? '-12px' : cross.x > rightEdge - 70 ? 'calc(-100% + 12px)' : '-50%'}, ${cross.y < chart.padT + 64 ? '16px' : 'calc(-100% - 16px)'})`,
            }}
          >
            <strong>{fmtPrice(cross.price)}</strong>
            <em>{fmtAxisDate(cross.time, tfId === '1D' ? '1D' : '1M', locale)}</em>
          </span>
        </div>
      )}
      {/* Bottom-left: the y-axis labels own the right edge, and the lowest
          one used to print straight through the corner lockup. */}
      <ChartWatermark corner="bl" padY={30} />
      </div>
    </div>
  )
}

const PERF_WINDOWS = [
  { key: 'change1h', label: '1H' },
  { key: 'change24', label: '24H' },
  { key: 'change7d', label: '7D' },
  { key: 'change30d', label: '30D' },
  { key: 'change1y', label: '1Y' },
]

function fmtSupply(v, sym) {
  const n = Number(v)
  if (!(n > 0)) return null
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T ${sym}`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B ${sym}`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M ${sym}`
  return `${Math.round(n).toLocaleString()} ${sym}`
}

// Plain-math technicals from ~1Y of daily closes. Deterministic, no LLM,
// honest nulls when history is short.
function computeTechnicals(rows, t) {
  if (!Array.isArray(rows) || rows.length < 30) return null
  const closes = rows.map((r) => Number(r.close ?? r.c) || 0).filter((v) => v > 0)
  if (closes.length < 30) return null
  const last = closes[closes.length - 1]
  const ma = (n) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null)
  // Wilder RSI(14)
  let gain = 0
  let loss = 0
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d; else loss -= d
  }
  let avgG = gain / 14
  let avgL = loss / 14
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgG = (avgG * 13 + Math.max(0, d)) / 14
    avgL = (avgL * 13 + Math.max(0, -d)) / 14
  }
  const rsi = avgL === 0 ? 100 : Math.round(100 - 100 / (1 + avgG / avgL))
  const ma50 = ma(50)
  const ma200 = ma(200)
  const above50 = ma50 != null ? last >= ma50 : null
  // 30d realized volatility, annualized
  const rets = []
  const win30 = closes.slice(-31)
  for (let i = 1; i < win30.length; i++) rets.push(Math.log(win30[i] / win30[i - 1]))
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1)
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1)
  const vol30 = Math.sqrt(variance) * Math.sqrt(365) * 100
  // Levels: 30d swing low/high, 90d range position
  const w30 = closes.slice(-30)
  const lo30 = Math.min(...w30)
  const hi30 = Math.max(...w30)
  const w90 = closes.slice(-90)
  const hi90 = Math.max(...w90)
  const lo90 = Math.min(...w90)
  const rangePos = hi90 > lo90 ? Math.round(((last - lo90) / (hi90 - lo90)) * 100) : 50
  const offHigh = hi90 > 0 ? ((hi90 - last) / hi90) * 100 : 0
  const trm = (key, dflt, vars) => (typeof t === 'function' ? t(`lite.msg.${key}`, dflt, vars) : dflt)
  const rsiLabelRaw = rsi >= 70 ? 'overheated' : rsi >= 55 ? 'strong' : rsi > 45 ? 'neutral' : rsi > 30 ? 'soft' : 'washed out'
  const rsiLabel = typeof t === 'function' ? tl(t, rsiLabelRaw) : rsiLabelRaw
  const read = [
    above50 == null ? null : above50 ? trm('uptrend_50', 'Uptrend - price is above its 50-day average.') : trm('downtrend_50', 'Downtrend - price is below its 50-day average.'),
    ma200 != null ? (last >= ma200 ? trm('long_trend_intact', 'The long-term 200-day trend is intact.') : trm('long_trend_against', 'Price sits below its 200-day average - the long trend is against it.')) : null,
    trm('momentum_reads', 'Momentum reads {{label}} (RSI {{rsi}}).', { label: rsiLabel, rsi }),
    offHigh < 3 ? trm('at_90d_high', 'Sitting at its 90-day high.') : trm('below_90d_high', 'Trading {{pct}}% below its 90-day high.', { pct: offHigh.toFixed(0) }),
  ].filter(Boolean).join(' ')
  return { rsi, rsiLabel, above50, ma50, ma200, last, vol30, lo30, hi30, lo90, hi90, rangePos, read }
}

// Exchange listings ("where to buy") via CG tickers. Our CG proxy tier
// returns trust_score null and identical spreads for every venue, and raw
// volume order puts wash-traded exchanges above Binance - so ranking is a
// curated major-exchange allowlist first, unranked venues only as fallback.
const MAJOR_EXCHANGES = new Set([
  'Binance', 'Coinbase Exchange', 'Kraken', 'OKX', 'Bybit', 'Upbit',
  'KuCoin', 'Bitget', 'Gate', 'Gate.io', 'HTX', 'Crypto.com Exchange',
  'Bitfinex', 'Bitstamp', 'Gemini', 'Binance US', 'MEXC',
])

const _tickersCache = new Map()

// Exchange logos. The tickers payload only carries market.identifier, so the
// logo comes from the /exchanges directory (top 250 by volume covers every
// venue we would ever list). One fetch per session; a miss just leaves the
// letter fallback in place.
let _exchangeLogos = null
function loadExchangeLogos() {
  if (_exchangeLogos) return _exchangeLogos
  _exchangeLogos = fetch('/api/coingecko/exchanges?per_page=250', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    .then((res) => (res.ok ? res.json() : []))
    .then((list) => {
      const map = new Map()
      for (const ex of Array.isArray(list) ? list : []) {
        if (ex?.id && typeof ex.image === 'string') map.set(ex.id, ex.image)
      }
      if (map.size === 0) _exchangeLogos = null
      return map
    })
    .catch(() => { _exchangeLogos = null; return new Map() })
  return _exchangeLogos
}

async function loadTickers(sym) {
  const cached = _ttlGet(_tickersCache, sym, MARKETS_TTL)
  if (cached !== undefined) return cached
  const id = SYMBOL_TO_COINGECKO_ID[sym]
  if (!id) { _ttlSet(_tickersCache, sym, []); return [] }
  try {
    const [res, logos] = await Promise.all([
      fetch(`/api/coingecko/coins/${encodeURIComponent(id)}/tickers?order=volume_desc&per_page=100`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }),
      loadExchangeLogos(),
    ])
    if (!res.ok) throw new Error('tickers')
    const payload = await res.json()
    const raw = Array.isArray(payload?.tickers) ? payload.tickers : []
    const byEx = new Map()
    for (const t of raw) {
      if (t?.is_anomaly || t?.is_stale) continue
      const name = t?.market?.name
      const vol = Number(t?.converted_volume?.usd) || 0
      if (!name || vol <= 0) continue
      const prev = byEx.get(name)
      if (!prev || vol > prev.vol) {
        byEx.set(name, {
          ex: name,
          pair: `${t.base}/${t.target}`.slice(0, 14),
          price: Number(t?.converted_last?.usd) || null,
          vol,
          url: t.trade_url || null,
          logo: logos.get(t?.market?.identifier) || null,
          major: MAJOR_EXCHANGES.has(name),
        })
      }
    }
    const all = [...byEx.values()].sort((a, b) => b.vol - a.vol)
    const majors = all.filter((r) => r.major)
    const rows = (majors.length >= 3 ? majors : [...majors, ...all.filter((r) => !r.major)]).slice(0, 8)
    _ttlSet(_tickersCache, sym, rows)
    return rows
  } catch (_) {
    return null
  }
}

// Per-coin crowd tone (Groq-classified X mentions via /v1/social/tone).
const _toneCache = new Map()

// TradFi headline pool for the stock news panel - TTL'd so a day-long tab
// doesn't show the morning wire; filtered per symbol client-side.
let _rzTradfi = null // { ts, data }
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function filterStockNews(rows, sym, name) {
  const clean = String(name || '').replace(/\b(inc|corp|corporation|co|company|platforms|holdings|aerospace)\.?$/i, '').trim()
  const nameRe = clean.length >= 4 ? new RegExp(escRe(clean), 'i') : null
  // word-boundary on the ticker only when it's distinctive (>=3 chars) -
  // substring matching is how base ended up inside CoinBASE
  const symRe = sym.length >= 3 ? new RegExp(`\\b${escRe(sym)}\\b`, 'i') : null
  const hits = rows.filter((r) => {
    const hay = `${r.title} ${r.context || ''}`
    return (nameRe && nameRe.test(hay)) || (symRe && symRe.test(r.title))
  })
  return hits.length > 0
    ? { items: hits.slice(0, 4), matched: true }
    : { items: rows.slice(0, 4), matched: false }
}

function toneRead(tone, change24, t) {
  if (!tone) return null
  const trm = (key, dflt) => (typeof t === 'function' ? t(`lite.msg.${key}`, dflt) : dflt)
  const bull = tone.bull_share > 0.2 && tone.bull > tone.bear * 2
  const bear = tone.bear_share > 0.15 && tone.bear > tone.bull
  const bleeding = Number(change24) < -3
  // Risk-first: bullish chatter on a falling price is often bags talking.
  if (bull && bleeding) return { cls: 'warn', text: trm('crowd_bull_bleeding', 'The crowd still talks bullish while price bleeds - be careful, that can be holders talking their bags.') }
  if (bull) return { cls: 'up', text: trm('crowd_bull_holding', 'The crowd leans bullish and price is holding - talk and tape agree.') }
  if (bear && bleeding) return { cls: 'down', text: trm('crowd_bear_bleeding', 'The crowd is bearish and price agrees - no fight to pick here.') }
  if (bear) return { cls: 'warn', text: trm('crowd_bear_holding', 'The crowd leans bearish while price holds up - someone is wrong.') }
  return { cls: '', text: trm('crowd_split', 'The crowd is split - no strong lean either way.') }
}

// Same slug-key helper as lite-page (kept local - this file is imported BY
// lite-page, dependency stays one-directional).
// Chart-type glyphs - mobile shows these instead of the wordy labels
// ("Baseline"/"TradingView" pills ate half the phone's chart width).
function CtIcon({ id }) {
  if (id === 'candles') {
    return (
      <svg className="lite-ct-ico" viewBox="0 0 14 14" aria-hidden>
        <line x1="3.5" y1="1" x2="3.5" y2="13" stroke="currentColor" strokeWidth="1.1" />
        <rect x="1.8" y="4" width="3.4" height="5.4" rx="0.8" fill="currentColor" />
        <line x1="10" y1="1" x2="10" y2="13" stroke="currentColor" strokeWidth="1.1" />
        <rect x="8.3" y="2.6" width="3.4" height="5.4" rx="0.8" fill="currentColor" />
      </svg>
    )
  }
  if (id === 'baseline') {
    return (
      <svg className="lite-ct-ico" viewBox="0 0 14 14" aria-hidden>
        {/* FILLED above the baseline, hollow below - at 13px two bare
            polylines were indistinguishable from the line icon next to it. */}
        <path d="M1 7 L1 10.5 L5 5 L8.5 8 L13 2.5 L13 7 Z" fill="currentColor" opacity="0.34" />
        <polyline points="1 10.5 5 5 8.5 8 13 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.75" />
      </svg>
    )
  }
  if (id === 'tv') {
    return (
      <svg className="lite-ct-ico" viewBox="0 0 14 14" aria-hidden>
        <rect x="1" y="2.2" width="12" height="8.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.85" />
        {/* a chart INSIDE the screen - "the other chart", not "a monitor" */}
        <polyline points="3.4 8.2 5.8 5.6 7.8 7.2 10.6 4.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="4.6" y1="12.8" x2="9.4" y2="12.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="lite-ct-ico" viewBox="0 0 14 14" aria-hidden>
      <polyline points="1 11 5.5 5.5 9 8.5 13 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}


function RzStar({ wl, sym, name, stock, contract, chain }) {
  if (!wl?.has) return null
  const starred = wl.has(sym)
  return (
    <button
      type="button"
      className={`lite-star lite-star--rz${starred ? ' on' : ''}`}
      aria-label={starred ? `Remove ${sym} from watchlist` : `Add ${sym} to watchlist`}
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
      onClick={(e) => { e.stopPropagation(); starred ? wl.remove(sym) : wl.add(stock ? { symbol: sym, name: name || sym, isStock: true, assetClass: 'stock' } : { symbol: sym, name: name || sym, ...(contract ? { address: contract, chain } : {}) }) }}
    >
      <svg viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3z" />
      </svg>
    </button>
  )
}

const RZ_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'technicals', label: 'Technicals' },
  { id: 'markets', label: 'Markets' },
  { id: 'sentiment', label: 'Sentiment' },
]

// Market indices researchable from the stocks stat band. Charts ride the
// UDF/Yahoo lane with the raw ^-symbols (the TV widgetembed paywalls SPX).
const INDEX_META = {
  '^GSPC': { name: 'S&P 500', short: 'SPX' },
  '^DJI': { name: 'Dow Jones', short: 'DJI' },
  '^IXIC': { name: 'Nasdaq Composite', short: 'IXIC' },
  '^RUT': { name: 'Russell 2000', short: 'RUT' },
  '^VIX': { name: 'VIX', short: 'VIX' },
}

// ── LITE timeframe pills -> TradingView resolution + visible window ─────────
//
// The pills are RANGES ("show me a month"); TradingViewAdvanced's `timeframe`
// prop is a RESOLUTION (candle size). The old map covered three of the seven
// pills, so 1M/3M/6M/1Y all fell through to the '1D' default and drew the SAME
// chart - and nothing ever set the visible window, so "1D" rendered whatever
// bar count TV felt like (measured: ~2 days of 30m candles under a 1D label).
//
// On a fresh on-chain cap the fallthrough was worse than confusing. Daily
// candles on a 13-day-old pump token are 13 bars, and ALL -> '1W' is 3
// (measured on lickingcat 2026-08-20; MADE/eJungle return ONE daily bar) - an
// empty-looking pane that reads as "no data for this token".
//
// So: pick the candle size from the window we actually intend to show, clamp
// that window to the history the token HAS, and hand the widget both.
/**
 * Percent for the headline. `toFixed(2)` on a scrub across a 37,000x series
 * printed "+3775562.39%" - unreadable, and 13 characters of width swinging
 * around under the cursor. Big moves lose their decimals, then their digits.
 */
function fmtPctCompact(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.00'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`
  if (a >= 1e3) return String(Math.round(n))
  return n.toFixed(2)
}

const TF_SPAN_SEC = {
  '1D': 86400, '1W': 604800, '1M': 2592000, '3M': 7776000, '6M': 15552000, '1Y': 31536000,
  // ALL is deliberately absent - it means "the token's whole life".
}
// TVA label -> seconds. Labels only ('1M' means one MINUTE there, one MONTH
// here - never pass a raw LITE pill id through).
//
// 🪤 NO 12H. `/api/tradingview/udf/symbols` answers majors with
// `supported_resolutions: ["1S","1","5","15","30","60","240","D","W"]` - no
// `720` - and resolveSymbol passes that list straight to the widget. Asking for
// an unsupported resolution does not fail loudly: measured on BTC 2026-08-20,
// setResolution('720') left `chart.resolution()` reading **'1S'** and the chart
// showing 30 minutes of one-second candles under a "3M" pill. Dropping the rung
// costs 3M a little detail (90 daily bars instead of 180 half-daily) and buys
// one ladder that is valid for every symbol this component can open - stocks
// included, whose Yahoo lane never carried 720 either.
const TV_RES_LADDER = [
  ['5M', 300], ['15M', 900], ['30M', 1800], ['1H', 3600],
  ['4H', 14400], ['1D', 86400], ['1W', 604800],
]
const TV_TARGET_BARS = 150

/**
 * @param {string} tfId    LITE pill id ('1D'..'1Y' | 'ALL')
 * @param {number|null} historySec  how far back this asset has bars, if known
 * @returns {{ res: string, spanSec: number }}
 */
function tvWindowFor(tfId, historySec) {
  const hist = Number(historySec) > 0 ? Number(historySec) : null
  const wanted = TF_SPAN_SEC[tfId] || null
  // A window wider than the token's life is whitespace: a 3-day-old token under
  // "1Y" gets 3 days, and says so by only drawing what exists.
  let span = wanted == null ? (hist || TF_SPAN_SEC['1M']) : (hist ? Math.min(wanted, hist) : wanted)
  span = Math.max(span, 3600)
  const ladder = TV_RES_LADDER
  // Closest bar count to the target on a LOG scale, not a linear one: 365 daily
  // bars for a year beats 52 weeklies even though 52 is nearer 150 in absolute
  // terms, and the ratio is what reads right on a chart.
  //
  // Walk fine -> coarse and only step coarser on a CLEAR win. Two rungs are
  // exactly tied whenever the span sits on their geometric midpoint (a token
  // ~12.5 days old ties 1H against 4H), and a nearest-match rule then flips
  // between them on a minute of drift - the same pill answering differently on
  // consecutive clicks. The margin makes the pick deterministic and breaks ties
  // toward detail, which the user can always zoom out of.
  let best = ladder[0]
  let bestErr = Math.abs(Math.log((span / best[1]) / TV_TARGET_BARS))
  for (let i = 1; i < ladder.length; i += 1) {
    const err = Math.abs(Math.log((span / ladder[i][1]) / TV_TARGET_BARS))
    if (err < bestErr - 0.1) { bestErr = err; best = ladder[i] }
  }
  return { res: best[0], spanSec: span }
}

// TRADINGVIEW MODE: THE PILLS ARE CANDLE SIZES, NOT RANGES. Line/Baseline/
// Candles are our own charts and their pills mean a RANGE ("1M" = the last 30
// days). The TradingView widget speaks intervals, and a "1M" pill above a chart
// whose every label reads "4h" is a contradiction no wording survives (founder,
// three times, 2026-08-20). So in TV mode the row switches vocabulary to match
// the widget: 1m / 5m / 15m / 1h / 4h / 1D / 1W.
//
// `id` is what the user reads, `tva` is TradingViewAdvanced's key for it (where
// '1M' means one MINUTE - never pass a LITE pill id through), `sec` is one bar.
// NO 12H rung: `720` is missing from every symbol's `supported_resolutions` and
// silently lands on 1-second bars (measured, see the ladder note below).
const TV_INTERVALS = [
  { id: '1m', tva: '1M', sec: 60 },
  { id: '5m', tva: '5M', sec: 300 },
  { id: '15m', tva: '15M', sec: 900 },
  { id: '1h', tva: '1H', sec: 3600 },
  { id: '4h', tva: '4H', sec: 14400 },
  { id: '1D', tva: '1D', sec: 86400 },
  { id: '1W', tva: '1W', sec: 604800 },
]
const TV_INTERVAL_BY_ID = Object.fromEntries(TV_INTERVALS.map((i) => [i.id, i]))
const TVA_TO_INTERVAL_ID = Object.fromEntries(TV_INTERVALS.map((i) => [i.tva, i.id]))
// How many bars a fresh interval frames. The window is no longer a promise the
// pill makes - the pill names the candle now - so this only has to be a
// readable amount of chart.
const TV_WINDOW_BARS = 150

// TradingView reports its interval in ITS OWN units ('15', '60', 'D'), so the
// row can follow the widget if the interval is ever changed anywhere else.
function intervalIdFromRes(raw) {
  const v = String(raw || '').toUpperCase()
  if (!v) return null
  if (/^\d+$/.test(v)) return ({ 1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h' })[Number(v)] || null
  if (v === 'D' || v === '1D') return '1D'
  if (v === 'W' || v === '1W') return '1W'
  return null
}

// The window a TradingView interval frames, in words - the small line under the
// pills. The pill states the candle, this states how much tape that adds up to.
function tvSpanLabel(spanSec) {
  const h = Number(spanSec) / 3600
  if (!(h > 0)) return ''
  if (h < 48) return `${Math.round(h)}h`
  const d = h / 24
  return d < 365 ? `${Math.round(d)}d` : `${(d / 365).toFixed(1)}y`
}

// ── Verdict gauges (Technicals) - deterministic speedometer, -1..+1 ──
function gaugeVerdict(score, t) {
  const trl = (x) => t(`lite.lbl.${x.toLowerCase().replace(/ /g, '_')}`, x)
  if (score <= -0.6) return { label: trl('Strong sell'), cls: 'down' }
  if (score <= -0.2) return { label: trl('Sell'), cls: 'down' }
  if (score < 0.2) return { label: trl('Neutral'), cls: '' }
  if (score < 0.6) return { label: trl('Buy'), cls: 'up' }
  return { label: trl('Strong buy'), cls: 'up' }
}

function techGaugeScore(ta) {
  if (!ta) return null
  let s = 0
  let n = 0
  s += ta.above50 ? 1 : -1; n += 1
  if (ta.ma200 != null) { s += ta.last >= ta.ma200 ? 1 : -1; n += 1 }
  s += Math.max(-1, Math.min(1, (ta.rsi - 50) / 25)); n += 1
  return n ? s / n : null
}

function VerdictGauge({ score, title, verdict, cls, note }) {
  const clamped = Math.max(-1, Math.min(1, Number(score) || 0))
  const ang = clamped * 90
  const cx = 100
  const cy = 100
  const r = 80
  const pt = (a, rr = r) => [cx + rr * Math.sin((a * Math.PI) / 180), cy - rr * Math.cos((a * Math.PI) / 180)]
  const arc = (a0, a1, rr = r) => {
    const [x0, y0] = pt(a0, rr)
    const [x1, y1] = pt(a1, rr)
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rr} ${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  // 0-100 reads better than a -1..1 score under a word like "Strong buy".
  const pct = Math.round((clamped + 1) * 50)
  const gid = `lvg-${title ? String(title).replace(/[^a-z0-9]/gi, '').toLowerCase() : 'g'}`
  const [mx, my] = pt(ang)
  return (
    <div className={`lite-vgauge ${cls || 'flat'}`}>
      <svg viewBox="0 0 200 118" aria-hidden>
        <defs>
          {/* Left to right is sell to buy on a half-circle, so a plain
              horizontal gradient reads correctly along the arc. */}
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="42%" stopColor="#9ca3af" />
            <stop offset="58%" stopColor="#9ca3af" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path d={arc(-90, 90)} className="lite-vgauge-track" strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d={arc(-90, 90)} stroke={`url(#${gid})`} className="lite-vgauge-band" strokeWidth="10" fill="none" strokeLinecap="round" />
        {/* Zone notches at the five verdict boundaries */}
        {[-54, -18, 18, 54].map((a) => {
          const [x0, y0] = pt(a, r - 9)
          const [x1, y1] = pt(a, r - 13)
          return <line key={a} x1={x0} y1={y0} x2={x1} y2={y1} className="lite-vgauge-notch" strokeWidth="1.5" strokeLinecap="round" />
        })}
        {/* Marker: a ringed dot that slides along the arc */}
        <g className="lite-vgauge-marker" style={{ transform: `rotate(${ang}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy - r} r="9" className="lite-vgauge-marker-glow" />
          <circle cx={cx} cy={cy - r} r="6.5" className="lite-vgauge-marker-dot" />
          <circle cx={cx} cy={cy - r} r="2.4" className="lite-vgauge-marker-core" />
        </g>
        <text x={cx} y={cy - 8} textAnchor="middle" className="lite-vgauge-score">{pct}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" className="lite-vgauge-scale">/ 100</text>
        <text x={pt(-90)[0]} y={cy + 16} textAnchor="middle" className="lite-vgauge-end">{'▼'}</text>
        <text x={pt(90)[0]} y={cy + 16} textAnchor="middle" className="lite-vgauge-end">{'▲'}</text>
      </svg>
      <strong className={`lite-vgauge-verdict ${cls}`}>{verdict}</strong>
      <em className="lite-vgauge-title">{title}</em>
      {note && <span className="lite-vgauge-note">{note}</span>}
    </div>
  )
}

// ── Shared with the Cinema detail (screener-lite/sl-*) ──────────────────────
// Cinema charts the SAME tokens through the SAME identity and bars lanes, so it
// consumes these rather than growing a second copy - the "three resolvers, one
// bug fixed three times" disease this file's history is full of.
export {
  resolveCgId, loadCgQuote, resolveCgPlatform, resolveGtSearch, loadGtPool,
  CODEX_NETWORK_ID, codexNetworkId, loadOnchainWindow,
  BINANCE_TV_SET, TV_INTERVALS, TV_INTERVAL_BY_ID, TVA_TO_INTERVAL_ID,
  TV_WINDOW_BARS, intervalIdFromRes, tvWindowFor,
}

export default function ResearchView({ data, fmtPrice, fmtLargeShort, onOpenResearch, onOpenPath, sym: symProp, setSym: setSymProp, wl, isStock, market, onCinema, onBack, backLabel, pick }) {
  const { t: tr } = useTranslation()
  const { t, i18n } = useTranslation()
  const liteLook = useSettingsStore((s) => s.liteLook)
  const { watchlistEntries, watchlistPrices, marketRows } = data
  // The rail follows the OPEN asset, not only the sidebar market toggle: a
  // stock reached from the Stocks view (or search) while the toggle still
  // says Crypto drew MSFT next to nine coins (founder report 2026-09-04).
  const stockRail = market === 'stocks' || !!isStock
  const symbols = useMemo(() => {
    if (stockRail) {
      const wlStocks = watchlistEntries
        .filter((tk) => tk?.isStock === true || tk?.assetClass === 'stock')
        .map((tk) => (tk.symbol || '').toUpperCase())
      const base = [...new Set([...STOCK_CHIPS, ...wlStocks])].slice(0, 10)
      if (symProp && !base.includes(symProp)) base.unshift(symProp)
      return base.slice(0, 11)
    }
    const wl = watchlistEntries
      .filter((tk) => !(tk?.isStock === true || tk?.assetClass === 'stock'))
      .map((tk) => (tk.symbol || '').toUpperCase())
    const base = [...new Set([...LITE_TOP_COINS, ...wl])].slice(0, 10)
    // A searched coin outside the chip set still gets a chip while selected.
    if (symProp && !base.includes(symProp)) base.unshift(symProp)
    return base.slice(0, 11)
  }, [watchlistEntries, symProp, stockRail])

  // Chip logos ride the data the shell already fetched (top-40 board + wl prices).
  const chipImg = useMemo(() => {
    const m = {}
    for (const r of marketRows || []) { if (r.symbol && r.image && !m[r.symbol]) m[r.symbol] = r.image }
    for (const [s, p] of Object.entries(watchlistPrices || {})) { if (p?.image && !m[s]) m[s] = p.image }
    if (stockRail) for (const cs of STOCK_CHIPS) { if (!m[cs]) m[cs] = getStockLogoUrl(cs) }
    if (isStock && symProp && !m[symProp]) m[symProp] = getStockLogoUrl(symProp)
    return m
  }, [marketRows, watchlistPrices, isStock, symProp, stockRail])

  // 24h move per chip, from the same rows the logos ride - no extra fetch.
  const chipChg = useMemo(() => {
    const m = {}
    for (const r of marketRows || []) {
      const v = Number(r.change)
      if (r.symbol && Number.isFinite(v) && m[r.symbol] == null) m[r.symbol] = v
    }
    for (const [s, p] of Object.entries(watchlistPrices || {})) {
      const v = Number(p?.change)
      if (Number.isFinite(v) && m[s] == null) m[s] = v
    }
    return m
  }, [marketRows, watchlistPrices])

  // Controlled from the shell when provided (search picks a coin), local otherwise.
  const [symLocal, setSymLocal] = useState('BTC')
  const sym = symProp || symLocal
  const setSym = setSymProp || setSymLocal
  const [tab, setTab] = useState('overview')
  const [tf, setTf] = useState('1M')
  const [ctype, setCtype] = useState('line')
  // TradingView embed only where TV actually carries the symbol. A CG id is
  // NOT enough (SPECTRE has one but no Binance pair -> "symbol doesn't
  // exist" screen) - crypto gates on a curated Binance spot set.
  // The advanced chart rides OUR UDF lane, so symbols are plain tickers:
  // stocks/indices to Yahoo (BRK-B -> BRK.B; ^GSPC passes through), crypto
  // majors to the bars lane. Unlisted on-chain caps skip it. (SPCX was
  // excluded here while SpaceX was private - it lists on NASDAQ since
  // 2026-06-12 and the UDF stock set carries it, founder report 2026-08-01.)
  const isIndex = isStock && sym.startsWith('^')
  const dispSym = isIndex ? (INDEX_META[sym]?.short || sym.slice(1)) : sym
  const [rows, setRows] = useState(null)
  const [taRows, setTaRows] = useState(null)
  const [stats, setStats] = useState(null)
  // Last GeckoTerminal pool reading for the current contract. The box-price
  // loader below lands independently of the GT loader, so it re-applies this
  // instead of overwriting the row wholesale (see mergeGtStats).
  const gtMetaRef = React.useRef(null)
  const [coinNews, setCoinNews] = useState([])
  const [tone, setTone] = useState(null)
  const [tickers, setTickers] = useState(null)
  const [profile, setProfile] = useState(null)
  const [analysts, setAnalysts] = useState(null)

  useEffect(() => {
    if (!isStock || isIndex) { setProfile(null); setAnalysts(null); return undefined }
    let cancelled = false
    setProfile(_ttlGet(_profileCache, sym, FUNDAMENTALS_TTL) ?? null)
    setAnalysts(_ttlGet(_analystCache, sym, FUNDAMENTALS_TTL) ?? null)
    loadStockProfile(sym).then((pr) => { if (!cancelled) setProfile(pr) })
    loadAnalysts(sym).then((an) => { if (!cancelled) setAnalysts(an) })
    return () => { cancelled = true }
  }, [sym, isStock])

  const wlEntry = useMemo(() => (
    (watchlistEntries || []).find((e) => (e.symbol || '').toUpperCase() === sym && !(e.isStock || e.assetClass === 'stock'))
  ), [watchlistEntries, sym])
  // EVERY chip's on-chain identity, not just the selected one. Cinema flips
  // through the whole chip set, so handing it symbols alone meant an on-chain
  // coin arrived at the chart as a bare ticker and /api/bars answered no_data —
  // "palm is dead in cinema mode" (founder 2026-08-12). Same root cause the
  // Research view itself was fixed for; the hand-off was simply never updated.
  const idBySym = useMemo(() => {
    const m = {}
    for (const e of watchlistEntries || []) {
      const s = (e.symbol || '').toUpperCase()
      if (!s || e.isStock || e.assetClass === 'stock') continue
      const address = e.address || e.contract || null
      if (!address) continue
      const chain = e.chain || e.chainId || e.network || null
      m[s] = {
        address,
        chain,
        networkId: Number(e.networkId) || CODEX_NETWORK_ID[String(chain || '').toLowerCase()] || undefined,
      }
    }
    return m
  }, [watchlistEntries])
  // Primitives first so the ref object is IDENTITY-STABLE - an object memo
  // keyed on `stats` loops forever once the GT patch below replaces stats.
  const localContract = isStock ? null : (wlEntry?.address || wlEntry?.contract || stats?.contract || null)
  const localChain = isStock ? null : (wlEntry?.chain || wlEntry?.chainId || wlEntry?.network || stats?.chain || null)
  // networkId is carried separately because the two on-chain lanes want
  // different keys: GeckoTerminal needs the chain NAME, Codex needs the numeric
  // id. Requiring both would have kept the ref null for every entry that only
  // ever stored one of them.
  const localNetworkId = isStock ? null : (Number(wlEntry?.networkId) || Number(stats?.networkId) || null)
  const localComplete = !!(localContract && (localChain || localNetworkId))
  // CG-recovered identity (see resolveCgPlatform): consulted ONLY when the
  // local sources can't name a chain for the token. The two sources are never
  // field-mixed - a box contract under a CG chain would point the pool lanes
  // at the wrong asset (the box contract is exactly what CG corrected). The
  // state is keyed by symbol and checked at render, not reset in an effect -
  // an effect-reset leaves the previous token's ref live for one commit after
  // a symbol switch, and the chart effect of that commit would fetch under it.
  const [cgRefState, setCgRefState] = useState(null)
  // Is the recovery below still in flight for THIS symbol? Only the TradingView
  // mount reads it — see the `tvIdentitySettled` gate at the embed.
  const [cgRefPending, setCgRefPending] = useState(null)
  const cgRef = cgRefState && cgRefState.sym === sym ? cgRefState.ref : null
  const onchainContract = cgRef ? cgRef.contract : localContract
  const onchainChain = cgRef ? cgRef.chain : localChain
  const onchainNetworkId = cgRef ? null : localNetworkId
  const onchainRef = useMemo(() => (
    onchainContract && (onchainChain || onchainNetworkId)
      ? { contract: onchainContract, chain: onchainChain, networkId: onchainNetworkId }
      : null
  ), [onchainContract, onchainChain, onchainNetworkId])
  // Identity carried by the click that opened this token (Gainers rows know
  // their cg_id). Guarded on the CURRENT symbol so a chip switch can't apply a
  // stale hint to a different coin. This outranks the box row: measured
  // 2026-08-21 on "UP", where the clicked row was `unitas` while the box's
  // symbol-keyed /v1/prices row was a Superform-named chimera - name-hinting
  // off the box locked the whole page onto the wrong project.
  const pickHint = pick && String(pick.sym || '').toUpperCase() === sym ? pick : null
  const pickCgId = pickHint?.cgId || null
  // What the CoinGecko id resolver checks a search hit against, so a symbol
  // collision (palm-ai vs palm-economy) can't chart the wrong asset.
  const cgHintName = (isStock ? null : (pickHint?.name || stats?.name || wlEntry?.name)) || null
  const cgHintImage = (isStock ? null : (pickHint?.image || stats?.image || wlEntry?.logo)) || null
  const cgHint = useMemo(() => ({ name: cgHintName, image: cgHintImage, cgId: pickCgId }), [cgHintName, cgHintImage, pickCgId])
  const isOnchain = !isStock && !SYMBOL_TO_COINGECKO_ID[sym] && !!onchainRef
  // The TradingView widget is keyed by `onchainContract`, so mounting it before
  // recovery settles builds it twice. Settled = no recovery in flight for THIS
  // symbol. Tokens that never enter the lane (majors, stocks, healthy local
  // refs) are settled from the first render and mount immediately, as before.
  const tvIdentitySettled = cgRefPending !== sym
  // Recover the on-chain identity from CoinGecko when neither the watchlist
  // entry nor the box row can name a chain (the §15 data-lane class: contract
  // with `chain: null`, or no contract at all). resolveCgPlatform ratifies the
  // contract against a real GT pool before it is believed, and `localComplete`
  // gates the fetch so healthy entries never pay the extra request. Waits for
  // the stats row (cgHintName) so the id resolver has a name to disambiguate
  // ticker collisions with.
  useEffect(() => {
    if (isStock || isIndex || SYMBOL_TO_COINGECKO_ID[sym]) return undefined
    // A "complete" local ref normally wins - but an EXPLICIT cg_id from the
    // click outranks it: the box's symbol-keyed row can be a whole different
    // token (the UP/unitas-vs-superform chimera), completeness and all.
    if (localComplete && !pickCgId) return undefined
    let cancelled = false
    setCgRefPending(sym)
    resolveCgPlatform(sym, cgHint).then(async (r) => {
      if (cancelled) return
      if (r) { setCgRefState({ sym, ref: r }); setCgRefPending(null); return }
      // CG named no deployment (unlisted token, or nothing ratified) — last
      // rung: GeckoTerminal's own search, hint-disciplined and quote-checked
      // (see resolveGtSearch). Closes the CG-unlisted class that otherwise
      // falls to the symbol lanes and an honest empty chart. Pending is held
      // through this rung too — the TV widget's identity-settled gate must
      // not mount on a contract this rung is about to replace.
      const g = await resolveGtSearch(sym, cgHint, statsPriceRef.current)
      if (cancelled) return
      if (g) setCgRefState({ sym, ref: g })
      setCgRefPending(null)
    }).catch(() => { if (!cancelled) setCgRefPending(null) })
    return () => { cancelled = true }
  }, [sym, isStock, isIndex, localComplete, pickCgId, cgHintName, cgHintImage])
  // A price of exactly 0 is NOT a price - the box sends it for symbols it
  // carries but does not track, alongside null changes and a fresh timestamp.
  const hasPrice = Number(stats?.price) > 0
  // Read at CALL time by the series loader, not passed as a dep: the quote
  // ticks constantly and depending on it would refetch every series on every
  // tick. The loader's effect re-runs once when `stats` lands (via cgHintName),
  // which is the moment that matters - before that there is nothing to check
  // a candidate against.
  const statsPriceRef = useRef(0)
  statsPriceRef.current = Number(stats?.price) || 0
  const boxHasNoPrice = !!stats && !hasPrice
  // On-chain caps DO get the TV tab now — as long as we can hand the widget a
  // contract. The old rule ("TV can't chart by contract") was true of the
  // HOSTED tradingview.com widget, which resolves a ticker and would happily
  // chart the Binance "PEPE" under a DEX PEPE twin. Our self-hosted widget is
  // the opposite: TradingViewAdvanced is ADDRESS-FIRST — given `token.address`
  // + `token.networkId` it rewrites the bars request to `address:networkId`,
  // which is the unambiguous identity. Measured through our own UDF:
  // BONK by ticker = 90 bars, BONK by address = 90 bars (identical), so the
  // ticker stays as the DISPLAY name while the data comes from the contract.
  //
  // The same address-first rule now covers CG-listed coins WITHOUT a Binance
  // pair (SPECTRE, PALM, MATIC, USDT, USDC): they are not "on-chain" here
  // because they carry a CG id, so they used to reach the widget as a bare
  // ticker - which /api/bars answers with [] (dev and prod, 2026-09-04) while
  // the registry contract gets 300 bars from the same server. The full
  // decision is tvIdentityFor (lite-tv-identity.js).
  const tvNetworkId = codexNetworkId(onchainRef)
  const tvIdentity = useMemo(
    () => tvIdentityFor({ sym, isStock, isOnchain, onchainContract, networkId: tvNetworkId }),
    [sym, isStock, isOnchain, onchainContract, tvNetworkId],
  )
  const tvToken = tvIdentity.token
  const tvSymbol = tvIdentity.symbol
  // PRO hands TradingViewAdvanced an onNoData so it can drop back to its own
  // chart when the TV widget can't come up. LITE never did, so the same failure
  // left the pane shimmering "LOADING TRADINGVIEW" indefinitely with no way out
  // (founder report 2026-07-29) - even though the Line/Baseline/Candles chart
  // right beside it was already drawing this token's data.
  const [tvDead, setTvDead] = useState(() => new Set())
  const handleTvNoData = useCallback((info) => {
    setCtype((c) => (c === 'tv' ? 'candles' : c))
    // Only a HARD failure (library never loaded, or nothing painted in 22s)
    // retires the tab. A soft empty-bars answer can be transient, so the tab
    // stays and the user can try again.
    if (info?.hard) setTvDead((prev) => (prev.has(sym) ? prev : new Set(prev).add(sym)))
  }, [sym])
  const tvUsable = !!tvSymbol && !tvDead.has(sym)
  // How much history this token actually has, from series we already loaded
  // (`taRows` is the ~1Y daily walk, `rows` the current pill's series) - no
  // extra request. Oldest bar across both wins, since either can be the
  // shallower view (1D's pill series is 24 hourly bars).
  const seriesEdges = useMemo(() => {
    const edge = (arr, pick) => (Array.isArray(arr) && arr.length ? Number(arr[pick === 'first' ? 0 : arr.length - 1]?.time) || 0 : 0)
    const oldest = [edge(taRows, 'first'), edge(rows, 'first')].filter((x) => x > 0)
    const newest = [edge(taRows, 'last'), edge(rows, 'last')].filter((x) => x > 0)
    const now = Math.floor(Date.now() / 1000)
    const last = newest.length ? Math.max(...newest) : 0
    const span = oldest.length ? (last || now) - Math.min(...oldest) : 0
    return {
      // Span of the data we HAVE, not "how long ago it started" - on a token
      // whose last trade was weeks ago those differ by weeks.
      historySec: span > 0 ? span : null,
      // Only worth overriding the window's right edge once the tape is
      // meaningfully stale; a live token should stay anchored to now so the
      // newest candle keeps arriving at the edge.
      endSec: last > 0 && now - last > 6 * 3600 ? last : null,
    }
  }, [taRows, rows])
  const historySec = seriesEdges.historySec
  const tvWindow = useMemo(() => tvWindowFor(tf, historySec), [tf, historySec])
  // The interval the TradingView pane is on. Seeded from the range pill the
  // user was already looking at, so switching to the TV tab keeps roughly the
  // same picture instead of jumping to an arbitrary default; after that the
  // interval pills own it. `null` means "not seeded yet".
  const [tvIntervalId, setTvIntervalId] = useState(null)
  useEffect(() => { setTvIntervalId(null) }, [sym])
  useEffect(() => {
    if (ctype !== 'tv') return
    setTvIntervalId((prev) => prev || TVA_TO_INTERVAL_ID[tvWindow.res] || '1h')
  }, [ctype, tvWindow.res])
  const tvInterval = TV_INTERVAL_BY_ID[tvIntervalId] || TV_INTERVAL_BY_ID['1h']
  // TV_WINDOW_BARS candles of the chosen interval, but never wider than the tape
  // that exists. Without the clamp the line under the pills over-promised on
  // every young token - measured on CASHCAT, whose "1D" pill drew its whole
  // 52-day life while the line claimed 150 days, and "1W" drew 98 days against a
  // claimed 2.9 years. TradingView clamps the window either way; this stops us
  // ASKING for tape that is not there, and keeps the label honest.
  const tvSpanSec = useMemo(() => {
    const want = tvInterval.sec * TV_WINDOW_BARS
    if (!(historySec > 0)) return want
    return Math.max(tvInterval.sec * 3, Math.min(want, historySec))
  }, [tvInterval.sec, historySec])
  // Follow the widget if its interval moves for any other reason - keeps the lit
  // pill honest without a second source of truth.
  const onTvIntervalChange = useCallback((raw) => {
    const id = intervalIdFromRes(raw)
    if (id) setTvIntervalId(id)
  }, [])
  // Sparse-cadence auto-step. TVA reports the tape's real bar cadence when it
  // is far coarser than the requested interval (GME-eth: "1m" tape with an
  // 18-minute median gap drew 12 days of clumps under an "about 3h" label).
  // Step the pill UP to the first rung the tape can fill - visibly, the pill
  // moves and the span line recomputes, so nothing is silent. Once per
  // sym+resolution: a user who re-picks the fine rung afterwards gets the raw
  // sparse truth instead of a fight with the pills.
  const sparseSteppedRef = useRef(new Set())
  // Returns true when it stepped: the datafeed then halts TV's auto-paging on
  // the retired rung (the step cannot apply before onChartReady, and
  // onChartReady waits on that paging - measured 30+ serial windows on a 1m
  // SPECTRE tape, 2026-09-05).
  const onTvSparse = useCallback(({ resolution, medianGapSec }) => {
    const key = `${sym}:${resolution}`
    if (sparseSteppedRef.current.has(key)) return false
    sparseSteppedRef.current.add(key)
    const target = TV_INTERVALS.find((r) => r.sec >= medianGapSec) || TV_INTERVALS[TV_INTERVALS.length - 1]
    const curSec = TV_INTERVAL_BY_ID[intervalIdFromRes(resolution)]?.sec || 0
    if (target.sec > curSec) { setTvIntervalId(target.id); return true }
    return false
  }, [sym])
  const [tweets, setTweets] = useState(null)

  // GT meta patches the holes (or the whole row, when the box row is a
  // different token than the watchlisted contract, or prices it wrong).
  // Kept in a ref as well as in `stats` because the two loaders race: whoever
  // lands last used to win, and the box setter below is an unconditional
  // overwrite - so a GT patch that arrived first was silently thrown away.
  useEffect(() => {
    gtMetaRef.current = null
    if (!isOnchain) return undefined
    let cancelled = false
    loadGtPool(onchainContract, onchainChain).then((meta) => {
      if (cancelled || !meta) return
      gtMetaRef.current = { meta, contract: onchainContract, chain: onchainChain }
      setStats((prev) => mergeGtStats(prev, meta, onchainContract, onchainChain, pickHint?.name || wlEntry?.name || sym))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isOnchain, onchainContract, onchainChain, sym, wlEntry?.name, pickHint?.name])

  // Box row with no price at all -> borrow the CoinGecko quote the chart lane
  // already resolved (see loadCgQuote). Runs at most once per symbol: the merge
  // sets price > 0, which flips `boxHasNoPrice` false and the next pass returns
  // immediately - so there is no setStats/effect loop.
  useEffect(() => {
    if (isStock || isIndex || isOnchain || !boxHasNoPrice) return undefined
    let cancelled = false
    loadCgQuote(sym, { name: cgHintName, image: cgHintImage }).then((q) => {
      if (cancelled || !q) return
      setStats((prev) => mergeCgQuote(prev, q, sym))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [sym, isStock, isIndex, isOnchain, boxHasNoPrice, cgHintName, cgHintImage])

  // Small caps have no press coverage - show the tracked X chatter instead.
  useEffect(() => {
    if (isStock) { setTweets(null); return undefined }
    if (SYMBOL_TO_COINGECKO_ID[sym]) { setTweets(null); return undefined }
    let cancelled = false
    setTweets(_ttlGet(_mentionsCache, sym, SOCIAL_TTL) ?? null)
    loadMentions(sym).then((rows) => { if (!cancelled) setTweets(rows) })
    return () => { cancelled = true }
  }, [sym, isStock])


  useEffect(() => {
    let cancelled = false
    setRows(null)
    const run = async () => {
      if (isStock) {
        const r = await loadStockSeries(sym, tf)
        if (!cancelled && r) setRows(r)
        return
      }
      // ON-CHAIN CAPS: contract only. The UDF lane below takes a BARE TICKER,
      // and on-chain tickers collide constantly (six Solana tokens answer to
      // "DEALER"), so asking it first is asking for another asset's chart.
      // GeckoTerminal then Codex, both keyed by the contract, both with real
      // OHLC so the Candles toggle has bodies to draw.
      if (isOnchain) {
        const oc = await loadOnchainWindow(onchainRef, tf)
        if (!cancelled && oc) { setRows(oc); return }
        if (cancelled) return
        // Contract lanes came back dry (a transient GT/Codex miss, or a pool
        // GT charts at a coarser tf than asked). When the identity was
        // recovered from CoinGecko ITSELF (cgRef), CG's close-only series is
        // the SAME asset by construction - a line beats an empty pane (FUZZY
        // 2026-08-21: live hourly candles existed, one hiccup blanked the
        // chart). A watchlist/box ref without CG backing keeps the honest
        // empty state - for those, symbol lanes are collision roulette.
        if (cgRef) {
          const limit = TIMEFRAMES.find((x) => x.id === tf)?.limit || 30
          const fb = await fetchDeepDaily(sym, tf === 'ALL' ? 'max' : limit, cgHint).catch(() => null)
          if (!cancelled) setRows(fb || [])
          return
        }
        if (!cancelled) setRows([])
        return
      }
      // The UDF lane takes a BARE TICKER, and the warning two comments up
      // applies to it just as much off-chain: measured 2026-08-20 on GME, where
      // it answered with one of the five OTHER coins trading as GME while the
      // box's own daily series was correct to the digit. It returned first and
      // returned early, so the good series was never even asked for and the
      // render gate blanked the chart. Same rule as inside loadDailyWindow: a
      // series that contradicts the live quote is not this token's, so fall
      // through instead of trusting it. Inert until the quote lands - this
      // effect re-runs once it does (cgHintName).
      const r = await loadCryptoOhlc(sym, tf)
      const udfTrusted = r && !((seriesDrift(r, statsPriceRef.current) || 0) > SERIES_SCALE_TOLERANCE)
      if (!cancelled && udfTrusted) { setRows(r); return }
      const limit = TIMEFRAMES.find((x) => x.id === tf)?.limit || 30
      const fb = await loadDailyWindow(sym, tf === 'ALL' ? 'max' : limit, { ref: onchainRef, hint: cgHint, price: statsPriceRef.current, cgDerived: !!cgRef })
      if (!cancelled) setRows(fb || [])
    }
    run().catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [sym, tf, isStock, isOnchain, onchainRef, onchainContract, onchainChain, onchainNetworkId, cgRef, cgHintName, cgHintImage])

  // Technicals always compute over ~1Y regardless of the chart TF.
  useEffect(() => {
    let cancelled = false
    setTaRows(null)
    const run = async () => {
      const series = await (isStock
        ? loadStockDaily(sym, 365)
        : loadDailyWindow(sym, 365, { ref: onchainRef, hint: cgHint, price: statsPriceRef.current, cgDerived: !!cgRef })
      ).catch(() => null)
      // loadDailyWindow already walks CoinGecko -> GeckoTerminal -> Codex, so
      // there is nothing left to try behind it.
      if (!cancelled) setTaRows(series || [])
    }
    run()
    return () => { cancelled = true }
  }, [sym, isStock, onchainContract, onchainChain, onchainNetworkId, cgRef, cgHintName, cgHintImage])

  useEffect(() => {
    let cancelled = false
    setStats(null)
    setCoinNews([])
    if (isIndex) {
      getMarketIndices()
        .then((arr) => {
          const list = Array.isArray(arr) ? arr : Object.values(arr || {})
          const ix = list.find((r) => r.symbol === sym)
          if (cancelled || !ix || !(ix.price > 0)) return
          setStats({
            name: INDEX_META[sym]?.name || ix.name || sym,
            price: ix.price,
            change24: Number(ix.change) || 0,
            marketCap: 0,
            volume: 0,
            prevClose: ix.previousClose || null,
            high24h: null,
            low24h: null,
            fdv: 0,
            rank: 0,
            circulatingSupply: null,
            maxSupply: null,
          })
        })
        .catch(() => {})
      return () => { cancelled = true }
    }
    if (isStock) {
      getStockQuotes([sym])
        .then((map) => {
          const q = map?.[sym]
          if (cancelled || !q || !(q.price > 0)) return
          const meta = FALLBACK_STOCK_DATA[sym]
          setStats({
            name: q.name || meta?.name || sym,
            price: q.price,
            change24: Number(q.change) || 0,
            marketCap: q.marketCap || 0,
            // Yahoo volume is share count - convert to dollars for the panels.
            volume: (q.volume || 0) * (q.price || 0),
            prevClose: q.previousClose || null,
            high24h: null,
            low24h: null,
            fdv: 0,
            rank: 0,
            circulatingSupply: null,
            maxSupply: null,
          })
        })
        .catch(() => {})
      return () => { cancelled = true }
    }
    getSpectrePricesBySymbols([sym])
      .then((map) => {
        if (cancelled || !map?.[sym]) return
        // Re-apply the GT reading if it already landed - the box row is the
        // LOWER-trust source for an on-chain cap, so it must not clobber it.
        // No contract check here on purpose: a box row whose contract DIFFERS
        // from the one we are charting is exactly the case mergeGtStats exists
        // to override. The ref is reset per symbol/contract, so anything in it
        // belongs to the token on screen.
        const gt = gtMetaRef.current
        setStats(gt
          ? mergeGtStats(map[sym], gt.meta, gt.contract, gt.chain, map[sym].name || sym)
          : map[sym])
      })
      .catch(() => {})
    if (!SYMBOL_TO_COINGECKO_ID[sym]) return () => { cancelled = true }
    getCryptoNews(sym, 6)
      .then((raw) => {
        if (cancelled || !Array.isArray(raw)) return
        setCoinNews(raw.slice(0, 3).map((item) => ({
          id: String(item.id ?? Math.random()),
          title: item.title || '',
          url: item.url || '#',
          source: item.source || 'Crypto',
          publishedOn: item.publishedOn ?? item.published_on ?? 0,
        })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sym, isStock])

  useEffect(() => {
    let cancelled = false
    if (isStock) { setTickers([]); return undefined }
    setTickers(_ttlGet(_tickersCache, sym, MARKETS_TTL) ?? null)
    loadTickers(sym).then((rows) => { if (!cancelled) setTickers(rows ?? []) }).catch(() => {})
    return () => { cancelled = true }
  }, [sym, isStock])

  useEffect(() => {
    let cancelled = false
    if (isStock) { setTone(null); return undefined }
    const cachedTone = _ttlGet(_toneCache, sym, SOCIAL_TTL)
    if (cachedTone !== undefined) { setTone(cachedTone); return undefined }
    setTone(null)
    fetch(`/data-api/v1/social/tone?symbols=${encodeURIComponent(sym)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return
        const t = payload?.data?.[sym]
        if (t && t.sample > 0) { _ttlSet(_toneCache, sym, t); setTone(t) }
        else _ttlSet(_toneCache, sym, null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sym])

  // Stock news: tradfi headlines matched to the company, general wire fallback.
  const [stkNews, setStkNews] = useState(null)
  useEffect(() => {
    if (!isStock) { setStkNews(null); return undefined }
    const name = stats?.name || FALLBACK_STOCK_DATA[sym]?.name || INDEX_META[sym]?.name || ''
    const matchSym = sym.replace(/^\^/, '')
    const freshWire = _rzTradfi && Date.now() - _rzTradfi.ts < SOCIAL_TTL ? _rzTradfi.data : null
    if (freshWire) { setStkNews(filterStockNews(freshWire, matchSym, name)); return undefined }
    let cancelled = false
    setStkNews(null)
    fetch('/data-api/v1/news/tradfi?hours=168&limit=40', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return
        const rows = (payload?.data || [])
          .map((r, i) => ({
            id: r.event_key || String(i),
            title: r.headline || '',
            context: r.context || '',
            category: r.category || '',
            ts: r.ts ? Math.floor(new Date(r.ts).getTime() / 1000) : 0,
          }))
          .filter((r) => r.title)
        _rzTradfi = { ts: Date.now(), data: rows }
        setStkNews(filterStockNews(rows, matchSym, name))
      })
      .catch(() => { if (!cancelled) setStkNews({ items: [], matched: false }) })
    return () => { cancelled = true }
  }, [sym, isStock, stats?.name])

  const change = Number(stats?.change24 ?? stats?.change) || 0
  // Stocks: the quote lane has no day high/low - the fundamentals payload does.
  const rangeLow = Number(stats?.low24h ?? (isStock ? profile?.low : NaN))
  const rangeHigh = Number(stats?.high24h ?? (isStock ? profile?.high : NaN))
  const rangePct = rangeHigh > rangeLow && stats?.price != null
    ? Math.min(100, Math.max(0, ((Number(stats.price) - rangeLow) / (rangeHigh - rangeLow)) * 100))
    : null
  const circSupply = fmtSupply(stats?.circulatingSupply, sym)
  const ta = useMemo(() => computeTechnicals(taRows, t), [taRows, t])
  const stockMeta = isStock ? FALLBACK_STOCK_DATA[sym] : null
  const wk52 = useMemo(() => {
    if (!isStock || !Array.isArray(taRows) || taRows.length < 30) return null
    const closes = taRows.map((r) => Number(r.close ?? r.c)).filter((v) => v > 0).slice(-252)
    if (closes.length < 30) return null
    const hi = Math.max(...closes)
    const lo = Math.min(...closes)
    const last = Number(stats?.price) || closes[closes.length - 1]
    return { hi, lo, pos: hi > lo ? Math.min(100, Math.max(0, ((last - lo) / (hi - lo)) * 100)) : 50 }
  }, [isStock, taRows, stats])
  // Stocks only get a day change from the quote - derive the longer windows
  // from the daily closes we already loaded for technicals (trading days).
  const perfStats = useMemo(() => {
    if (!isStock || !stats) return stats
    const closes = Array.isArray(taRows) ? taRows.map((r) => Number(r.close ?? r.c)).filter((v) => v > 0) : []
    const last = Number(stats.price)
    const at = (n) => (closes.length > n && closes[closes.length - 1 - n] > 0
      ? ((last - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100
      : null)
    return { ...stats, change7d: at(5), change30d: at(21), change1y: at(252) }
  }, [isStock, stats, taRows])
  const turnover = stats?.volume > 0 && stats?.marketCap > 0 ? (stats.volume / stats.marketCap) * 100 : null

  // Chart scrub (Perplexity-style): hovering the chart drives the header
  // readout - price at the cursor + change vs the window open + the date.
  const [scrub, setScrub] = useState(null)
  useEffect(() => { setScrub(null) }, [sym, tf, ctype])
  const marketLive = !isStock || getMarketStatus().isOpen
  // Congruence: the chart series (daily-chart lane) can lag the live quote -
  // anchor the last bar to stats.price so the chart's endpoint, the live dot
  // and the headline all read one number.
  const chartRows = useMemo(() => {
    if (!Array.isArray(rows) || rows.length === 0 || !(Number(stats?.price) > 0)) return rows
    const last = rows[rows.length - 1]
    const lc = Number(last.close ?? last.c)
    if (!(lc > 0)) return rows
    const px = Number(stats.price)
    // SCALE-AGREEMENT GATE. Anchoring the newest bar to the live price is right
    // when both describe the same asset - and catastrophic when they do not.
    // Measured 2026-08-20 on BULL: the box's own `/v1/prices/BULL/ohlcv` returned
    // two rows at ~1.4e-7 while its `/v1/prices` said 0.00530103 for the SAME
    // symbol - 6000x apart. Patching the endpoint to the live price turned that
    // into a 37,855x diagonal from corner to corner, and every derived number
    // (the y-axis, the min-max caption, the scrub percentage) came from it. A
    // newest close orders of magnitude from the live price is not a price move,
    // it is a different tape: refuse to draw it rather than draw a lie. The
    // honest empty state is already wired ("No price history for X ...").
    if (seriesDrift(rows, px) > SERIES_SCALE_TOLERANCE) return []
    if (Math.abs(px - lc) / lc < 0.0005) return rows
    const patched = { ...last }
    if (patched.close != null) patched.close = px
    if (patched.c != null) patched.c = px
    if (patched.close == null && patched.c == null) patched.close = px
    if (patched.high != null) patched.high = Math.max(Number(patched.high), px)
    if (patched.h != null) patched.h = Math.max(Number(patched.h), px)
    if (patched.low != null) patched.low = Math.min(Number(patched.low), px)
    if (patched.l != null) patched.l = Math.min(Number(patched.l), px)
    return [...rows.slice(0, -1), patched]
  }, [rows, stats?.price])
  // An empty chart has two very different causes and the user deserves the
  // right one. "No price history yet" is simply FALSE for a token whose price,
  // 24h range and four change windows are printed right above the blank space -
  // our sources DID return a series, we refused it because it is a different
  // token's tape (measured on the Gainers board 2026-08-20: BULL off by 5,936x,
  // DEALER by 369x, both from the box's symbol-keyed OHLCV lane).
  const seriesRefused = useMemo(
    () => (seriesDrift(rows, stats?.price) || 0) > SERIES_SCALE_TOLERANCE,
    [rows, stats?.price],
  )
  const windowFirst = useMemo(() => {
    const arr = Array.isArray(chartRows) ? chartRows : []
    for (const r of arr) { const v = Number(r.close ?? r.c); if (v > 0) return v }
    return null
  }, [chartRows])
  const scrubChg = scrub && windowFirst ? ((scrub.price - windowFirst) / windowFirst) * 100 : null
  // Next earnings inside 45 days -> countdown strip (profile.earningsDate ISO)
  const earnDays = useMemo(() => {
    if (!isStock || !profile?.earningsDate) return null
    const d = daysUntil(profile.earningsDate)
    return d != null && d >= 0 && d <= 45 ? d : null
  }, [isStock, profile?.earningsDate])
  const targetUpside = isStock && Number(profile?.targetMeanPrice) > 0 && Number(stats?.price) > 0
    ? ((profile.targetMeanPrice - stats.price) / stats.price) * 100
    : null

  // The debate - a deterministic bull/bear case. Every bullet requires its
  // datum (analyst counts, earnings surprises, moving averages, 52w position,
  // valuation); nothing is composed from vibes. Perplexity-style two columns.
  const debate = useMemo(() => {
    if (!isStock || isIndex || !stats) return null
    const bull = []
    const bear = []
    const c = analysts?.consensus
    const total = c?.total || 0
    if (total >= 5) {
      const buyPct = Math.round(((c.strongBuy + c.buy) / total) * 100)
      const sellPct = Math.round(((c.sell + c.strongSell) / total) * 100)
      const holdPct = Math.round((c.hold / total) * 100)
      if (buyPct >= 60) bull.push(t('lite.msg.db_analysts_buy', 'Wall Street leans buy - {{pct}}% of {{n}} analysts rate it a buy.', { pct: buyPct, n: total }))
      if (sellPct >= 15) bear.push(t('lite.msg.db_analysts_sell', '{{pct}}% of analysts say sell - unusual caution for a big name.', { pct: sellPct }))
      else if (holdPct >= 50) bear.push(t('lite.msg.db_analysts_hold', 'Half of Wall Street sits on hold - conviction is thin.'))
    }
    const earn = Array.isArray(analysts?.earnings) ? analysts.earnings : []
    let streak = 0
    for (const e of earn) { if (Number(e.surprisePercent) >= 0) streak += 1; else break }
    if (streak >= 2) bull.push(t('lite.msg.db_beat_streak', 'It has beaten profit estimates {{n}} quarters in a row.', { n: streak }))
    if (earn.length > 0 && Number(earn[0].surprisePercent) < 0) bear.push(t('lite.msg.db_missed', 'It missed profit estimates last quarter ({{pct}}%).', { pct: Number(earn[0].surprisePercent).toFixed(1) }))
    if (ta) {
      if (ta.ma200 != null && ta.last >= ta.ma200) bull.push(t('lite.msg.db_trend_intact', 'The long-term trend is intact - price holds above its 200-day average.'))
      if (ta.ma200 != null && ta.last < ta.ma200) bear.push(t('lite.msg.db_trend_broken', 'The long-term trend is broken - price sits below its 200-day average.'))
      if (!ta.above50) bear.push(t('lite.msg.db_below50', 'Near-term momentum is against it - price is below its 50-day average.'))
      if (ta.rsi >= 70) bear.push(t('lite.msg.db_overbought', 'Overbought (RSI {{rsi}}) - extended runs often cool off.', { rsi: ta.rsi }))
      if (ta.rsi <= 30) bull.push(t('lite.msg.db_washed_out', 'Washed out (RSI {{rsi}}) - sellers may be getting exhausted.', { rsi: ta.rsi }))
      if (ta.vol30 >= 60) bear.push(t('lite.msg.db_high_vol', 'A fast mover - {{v}}% annualized volatility cuts both ways.', { v: ta.vol30.toFixed(0) }))
    }
    const y1 = Number(perfStats?.change1y)
    if (Number.isFinite(y1) && y1 >= 20) bull.push(t('lite.msg.db_up_year', 'Up {{pct}}% over the past year.', { pct: y1.toFixed(0) }))
    if (Number.isFinite(y1) && y1 <= -15) bear.push(t('lite.msg.db_down_year', 'Down {{pct}}% over the past year - falling knives deserve respect.', { pct: Math.abs(y1).toFixed(0) }))
    if (wk52) {
      if (wk52.pos >= 85 && ta?.above50) bull.push(t('lite.msg.db_near_highs', 'Trading near its 52-week high with the trend behind it.'))
      if (wk52.pos <= 20) bear.push(t('lite.msg.db_near_lows', 'Sitting near its 52-week lows.'))
    }
    const pe = Number(profile?.pe)
    const fpe = Number(profile?.forwardPe)
    if (pe > 0 && fpe > 0 && fpe < pe * 0.85) bull.push(t('lite.msg.db_growing_in', 'Earnings are growing into the price - forward P/E {{f}} vs {{p}} trailing.', { f: fpe.toFixed(0), p: pe.toFixed(0) }))
    if (pe >= 40) bear.push(t('lite.msg.db_expensive', 'Priced for perfection at {{pe}}x trailing earnings - any stumble costs.', { pe: pe.toFixed(0) }))
    const dy = Number(profile?.dividendYield)
    if (dy >= 2) bull.push(t('lite.msg.db_dividend', 'Pays a {{y}}% dividend while you wait.', { y: dy.toFixed(1) }))
    const tgt = Number(profile?.targetMeanPrice)
    const px = Number(stats?.price)
    if (tgt > 0 && px > 0) {
      const up = ((tgt - px) / px) * 100
      if (up >= 15) bull.push(t('lite.msg.db_target_above', 'The average analyst target sits {{pct}}% above the price.', { pct: up.toFixed(0) }))
      if (up <= -5) bear.push(t('lite.msg.db_target_below', 'The average analyst target sits {{pct}}% BELOW the price - Wall Street sees it ahead of itself.', { pct: Math.abs(up).toFixed(0) }))
    }
    if (!bull.length && !bear.length) return null
    return { bull: bull.slice(0, 4), bear: bear.slice(0, 4) }
  }, [isStock, isIndex, stats, analysts, ta, perfStats, wk52, profile, t])

  // Key numbers and Today's trading render in two places - the Markets tab
  // as a pair, and the Overview where they sit in the right column and beside
  // the exchange table - so they are built once here.
  const keyNumbersPanel = (cls) => (
    <section className={cls}>
      <p className="lite-eyebrow">{tl(t, 'Key numbers', 'ttl')}</p>
      {!stats ? <SkelRows n={5} /> : (
        <ul className="lite-stat-list">
          {stats.marketCap > 0 && <li><span>{tl(t, 'Market cap', 'lbl')}</span><strong>{fmtLargeShort(stats.marketCap)}</strong></li>}
          {stats.fdv > 0 && stats.fdv !== stats.marketCap && <li><span>{tl(t, 'Fully diluted', 'lbl')}</span><strong>{fmtLargeShort(stats.fdv)}</strong></li>}
          {stats.volume > 0 && <li><span>{tl(t, 'Volume 24h', 'lbl')}</span><strong>{fmtLargeShort(stats.volume)}</strong></li>}
          {turnover != null && <li><span>{tl(t, 'Turnover', 'lbl')}</span><strong>{turnover.toFixed(1)}%</strong></li>}
          {circSupply && <li><span>{tl(t, 'Circulating', 'lbl')}</span><strong>{circSupply}</strong></li>}
          {fmtSupply(stats.maxSupply, sym) && <li><span>{tl(t, 'Max supply', 'lbl')}</span><strong>{fmtSupply(stats.maxSupply, sym)}</strong></li>}
          {stats.rank > 0 && <li><span>{tl(t, 'Rank', 'lbl')}</span><strong>#{stats.rank}</strong></li>}
          {!isStock && stats.ath?.price > 0 && <li><span>{tl(t, 'All-time high', 'lbl')}</span><strong>{fmtPrice(stats.ath.price)}</strong></li>}
          {!isStock && Number(stats.ath?.change_pct) < -1 && <li><span>{tl(t, 'From the high', 'lbl')}</span><strong className="down">{Number(stats.ath.change_pct).toFixed(0)}%</strong></li>}
          {!isStock && stats.ath?.price > 0 && Number(stats.ath?.change_pct) >= -1 && <li><span>{tl(t, 'From the high', 'lbl')}</span><strong className="up">{tl(t, 'at its all-time high', 'msg')}</strong></li>}
          {isStock && stockMeta?.exchange && <li><span>{tl(t, 'Exchange', 'lbl')}</span><strong>{stockMeta.exchange}</strong></li>}
          {isStock && stockMeta?.sector && <li><span>{tl(t, 'Sector', 'lbl')}</span><strong>{tl(t, stockMeta.sector)}</strong></li>}
          {isStock && (Number(profile?.pe) > 0 || stockMeta?.pe > 0) && <li><span>{tl(t, 'P/E ratio', 'lbl')}</span><strong>{Number(profile?.pe || stockMeta.pe).toFixed(1)}</strong></li>}
          {isStock && Number(profile?.forwardPe) > 0 && <li><span>{tl(t, 'Forward P/E', 'lbl')}</span><strong>{Number(profile.forwardPe).toFixed(1)}</strong></li>}
          {isStock && Number(profile?.eps) > 0 && <li><span>{tl(t, 'Earnings per share', 'lbl')}</span><strong>{fmtPrice(Number(profile.eps))}</strong></li>}
          {isStock && Number(profile?.dividendYield) > 0 && <li><span>{tl(t, 'Dividend yield', 'lbl')}</span><strong>{Number(profile.dividendYield).toFixed(2)}%</strong></li>}
          {isStock && Number(profile?.beta) > 0 && <li><span>{tl(t, 'Beta', 'lbl')}</span><strong>{Number(profile.beta).toFixed(2)}</strong></li>}
        </ul>
      )}
    </section>
  )

  const tradingPanel = (cls) => (
    <section className={cls}>
      <p className="lite-eyebrow">{tl(t, "Today's trading", 'ttl')}</p>
      {!stats ? <SkelRows n={4} /> : (
        <>
          <ul className="lite-stat-list">
            {stats.high24h > 0 && <li><span>{tl(t, '24h high', 'lbl')}</span><strong>{fmtPrice(stats.high24h)}</strong></li>}
            {stats.low24h > 0 && <li><span>{tl(t, '24h low', 'lbl')}</span><strong>{fmtPrice(stats.low24h)}</strong></li>}
            {isStock && stats.prevClose > 0 && <li><span>{tl(t, 'Previous close', 'lbl')}</span><strong>{fmtPrice(stats.prevClose)}</strong></li>}
        {isStock && Number(profile?.open) > 0 && <li><span>{tl(t, 'Open', 'lbl')}</span><strong>{fmtPrice(profile.open)}</strong></li>}
            {stats.price != null && <li><span>{tl(t, 'Now', 'lbl')}</span><strong>{fmtPrice(stats.price)}</strong></li>}
          </ul>
          {rangePct != null && (
            <div className="lite-range">
              <div className="lite-range-labels">
                <span>{fmtPrice(rangeLow)}</span>
                <span className="lite-range-title">{tl(t, 'position in range', 'lbl')}</span>
                <span>{fmtPrice(rangeHigh)}</span>
              </div>
              <div className="lite-range-track" aria-hidden>
                <span className="lite-range-dot" style={{ left: `${rangePct}%` }} />
              </div>
            </div>
          )}
          {isStock && wk52 && (
          <div className="lite-range">
            <div className="lite-range-labels">
              <span>{fmtPrice(wk52.lo)}</span>
              <span className="lite-range-title">{tl(t, '52-week range', 'lbl')}</span>
              <span>{fmtPrice(wk52.hi)}</span>
            </div>
            <div className="lite-range-track" aria-hidden>
              <span className="lite-range-dot" style={{ left: `${wk52.pos}%` }} />
            </div>
          </div>
        )}
        <p className="lite-social-note">{tl(t, 'Turnover = daily volume as a share of market cap - how much of the coin actually changes hands.', 'msg')}</p>
        </>
      )}
    </section>
  )

  const venuePanel = (cls) => (
    <>
      {isStock ? (
        <section className={cls}>
          <p className="lite-eyebrow">{tl(t, 'Where it trades', 'ttl')}</p>
          <p className="lite-tech-read" style={{ margin: 0 }}>{t('lite.msg.stock_trades_on', '{{name}} trades on {{exchange}} - you buy it through a broker, not a crypto exchange.', { name: stats?.name || sym, exchange: stockMeta?.exchange || 'a regulated exchange' })}</p>
        </section>
      ) : (
      <section className={cls}>
        <p className="lite-eyebrow">{t('lite.ttl.where_to_buy', 'Where to buy {{sym}}', { sym })}</p>
        {tickers === null ? (
          <SkelRows n={5} />
        ) : tickers.length === 0 ? (
          <p className="lite-empty">{t('lite.msg.no_exchange_listings', 'No trusted exchange listings found for {{sym}}.', { sym })}</p>
        ) : (
          <>
            <ul className="lite-tlist">
              {tickers.map((tk) => (
                <li key={tk.ex} className={`lite-trow${tk.url ? ' lite-trow--link' : ''}`} onClick={tk.url ? () => window.open(tk.url, '_blank', 'noopener') : undefined} role={tk.url ? 'button' : undefined} tabIndex={tk.url ? 0 : undefined}>
                  <span className="lite-trow-logo">
                    {tk.logo ? <img src={tk.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
                    <span className="lite-trow-fallback" style={tk.logo ? { display: 'none' } : undefined}>{tk.ex[0]}</span>
                  </span>
                  <span className="lite-trow-id">
                    <strong>{tk.ex}</strong>
                    <em>{tk.pair}</em>
                  </span>
                  <span className={`lite-exchange-trust lite-exchange-trust--${tk.major ? 'green' : 'gray'}`}>{tl(t, tk.major ? 'major' : 'unranked')}</span>
                  <span className="lite-trow-mcap">{fmtLargeShort(tk.vol)} {tl(t, 'vol', 'lbl')}</span>
                  {tk.price != null && <span className="lite-trow-price">{fmtPrice(tk.price)}</span>}
                </li>
              ))}
            </ul>
            <p className="lite-social-note">{tl(t, "Major exchanges first - reported volume on smaller venues is often inflated, so they only appear when a coin isn't listed on a major. Tap a row to open the exchange.", 'msg')}</p>
        </>
        )}
      </section>
      )}
    </>
  )

  const sentimentPanel = (cls) => (
    <section className={`lite-tone ${cls}`}>
      <p className="lite-eyebrow">{tl(t, 'Crowd sentiment', 'ttl')}</p>
      {isStock ? (
        <p className="lite-empty">{tl(t, 'No crowd read for stocks yet - the machine-read X feed covers crypto only. Stock sentiment lands here when a real feed exists.', 'msg')}</p>
      ) : !tone ? (
        _toneCache.has(sym) ? (
          <p className="lite-empty">{t('lite.msg.not_enough_chatter', 'Not enough recent X chatter about {{sym}} to read the crowd honestly.', { sym })}</p>
        ) : <SkelRows n={4} />
      ) : (() => {
        const read = toneRead(tone, change, t)
        const bullPct = Math.round((tone.bull_share || 0) * 100)
        const bearPct = Math.round((tone.bear_share || 0) * 100)
        const neutralPct = Math.max(0, 100 - bullPct - bearPct)
        return (
          <>
            {read && <p className={`lite-tech-read lite-tone-read--${read.cls}`}>{read.text}</p>}
            <div className="lite-tone-bar" aria-hidden>
              <span className="lite-tone-bull" style={{ width: `${bullPct}%` }} />
              <span className="lite-tone-neutral" style={{ width: `${neutralPct}%` }} />
              <span className="lite-tone-bear" style={{ width: `${bearPct}%` }} />
            </div>
            <div className="lite-tone-legend">
              <span className="up">{bullPct}% {tl(t, 'bullish')}</span>
              <span>{neutralPct}% {tl(t, 'neutral')}</span>
              <span className="down">{bearPct}% {tl(t, 'bearish')}</span>
            </div>
            <div className="lite-tech-grid" style={{ marginTop: 18 }}>
              <div className="lite-tech-item"><em>{tl(t, 'Sample', 'lbl')}</em><strong>{Number(tone.sample).toLocaleString()}</strong><span>{tl(t, 'recent X mentions', 'lbl')}</span></div>
              <div className="lite-tech-item"><em>{tl(t, 'Bullish voices', 'lbl')}</em><strong className="up">{Number(tone.bull).toLocaleString()}</strong><span>{tl(t, 'machine-read as positive', 'lbl')}</span></div>
              <div className="lite-tech-item"><em>{tl(t, 'Bearish voices', 'lbl')}</em><strong className="down">{Number(tone.bear).toLocaleString()}</strong><span>{tl(t, 'machine-read as negative', 'lbl')}</span></div>
            </div>
            <p className="lite-social-note">{tl(t, 'Tone is machine-read from tracked crypto X accounts. Remember: bullish talk on a falling price is often holders talking their bags. The full sentiment desk lives in PRO.', 'msg')}</p>
          </>
        )
      })()}
    </section>
  )

  // The technicals block: full on its own tab, compact (2 x 3 cells, no
  // range bar or footnote) as one cell of the Overview surface.
  const techBlock = (cls, compact) => (
    <section className={`lite-tech${compact ? ' lite-tech--compact' : ''} ${cls}`}>
            <p className="lite-eyebrow">{compact ? tl(t, 'Technicals', 'lbl') : tl(t, 'Technicals · computed from a year of daily closes', 'ttl')}</p>
            {!ta ? (
              taRows === null ? <SkelRows n={5} /> : <p className="lite-empty">{t('lite.msg.not_enough_history', 'Not enough history to compute honest technicals for {{sym}}.', { sym })}</p>
            ) : (
              <>
                <div className="lite-tech-top">
                  {(() => {
                    const ts = techGaugeScore(ta)
                    const c = analysts?.consensus
                    const total = c?.total || 0
                    const streetScore = isStock && total >= 5 ? (c.strongBuy + c.buy - c.sell - c.strongSell) / total : null
                    if (ts == null && streetScore == null) return null
                    return (
                      <div className="lite-vgauges">
                        {ts != null && (() => {
                          const v = gaugeVerdict(ts, t)
                          return <VerdictGauge score={ts} title={tl(t, 'Technicals', 'lbl')} verdict={v.label} cls={v.cls} note={tl(t, 'trend + momentum, daily closes', 'msg')} />
                        })()}
                        {streetScore != null && (() => {
                          const v = gaugeVerdict(streetScore, t)
                          return <VerdictGauge score={streetScore} title={tl(t, 'Wall Street', 'lbl')} verdict={v.label} cls={v.cls} note={t('lite.msg.n_analysts', '{{n}} analysts', { n: total })} />
                        })()}
                      </div>
                    )
                  })()}
                  <div className="lite-tech-main">
                    <p className="lite-tech-read">{ta.read}</p>
                    <div className="lite-tech-grid lite-tech-grid--six">
                  <div className="lite-tech-item">
                    <em>{tl(t, 'Trend', 'lbl')}</em>
                    <strong className={ta.above50 ? 'up' : 'down'}>{tl(t, ta.above50 ? 'Up' : 'Down')}</strong>
                    <span>{tl(t, 'vs 50-day average', 'lbl')}{ta.ma50 != null ? ` (${fmtPrice(ta.ma50)})` : ''}</span>
                  </div>
                  <div className="lite-tech-item">
                    <em>{tl(t, 'Long trend', 'lbl')}</em>
                    {ta.ma200 != null ? (
                      <>
                        <strong className={ta.last >= ta.ma200 ? 'up' : 'down'}>{tl(t, ta.last >= ta.ma200 ? 'Intact' : 'Broken')}</strong>
                        <span>{tl(t, 'vs 200-day average', 'lbl')} ({fmtPrice(ta.ma200)})</span>
                      </>
                    ) : (<><strong>—</strong><span>{tl(t, 'needs 200 days of history', 'msg')}</span></>)}
                  </div>
                  <div className="lite-tech-item">
                    <em>{tl(t, 'Momentum', 'lbl')}</em>
                    <strong className={ta.rsi >= 70 ? 'down' : ta.rsi <= 30 ? 'up' : ''}>{ta.rsi}</strong>
                    <span>RSI · {ta.rsiLabel}</span>
                  </div>
                  <div className="lite-tech-item">
                    <em>{tl(t, 'Volatility', 'lbl')}</em>
                    <strong>{ta.vol30.toFixed(0)}%</strong>
                    <span>{tl(t, '30-day, annualized', 'lbl')}</span>
                  </div>
                  <div className="lite-tech-item">
                    <em>{tl(t, 'Support zone', 'lbl')}</em>
                    <strong>{fmtPrice(ta.lo30)}</strong>
                    <span>{tl(t, '30-day low', 'lbl')}</span>
                  </div>
                  <div className="lite-tech-item">
                    <em>{tl(t, 'Resistance zone', 'lbl')}</em>
                    <strong>{fmtPrice(ta.hi30)}</strong>
                    <span>{tl(t, '30-day high', 'lbl')}</span>
                  </div>
                    </div>
                  </div>
                </div>
                <div className="lite-range lite-tech-rangeblock">
                  <div className="lite-range-labels">
                    <span>{fmtPrice(ta.lo90)}</span>
                    <span className="lite-range-title">{tl(t, '90-day range', 'lbl')}</span>
                    <span>{fmtPrice(ta.hi90)}</span>
                  </div>
                  <div className="lite-range-track" aria-hidden>
                    <span className="lite-range-dot" style={{ left: `${ta.rangePos}%` }} />
                  </div>
                </div>
                <p className="lite-social-note">{tl(t, 'Simple by design - moving averages, Wilder RSI and realized volatility from real closes. The full indicator suite lives in PRO.', 'msg')}</p>
              </>
            )}
    </section>
  )

  const aboutBlock = (cls) => (
    <section className={cls}>
              <p className="lite-eyebrow">{t('lite.ttl.about_name', 'About {{name}}', { name: stats?.name || sym })}</p>
              <p className="lite-tech-read" style={{ marginBottom: 12 }}>{String(profile.description).length > 460 ? `${String(profile.description).slice(0, 460)}…` : profile.description}</p>
              <div className="lite-tech-grid">
                {profile.ceo && <div className="lite-tech-item"><em>{tl(t, 'CEO', 'lbl')}</em><strong style={{ fontSize: '0.95rem' }}>{profile.ceo.replace(/^(Mr|Ms|Mrs|Dr)\.\s*/i, '')}</strong><span /></div>}
                {Number(profile.employees) > 0 && <div className="lite-tech-item"><em>{tl(t, 'Employees', 'lbl')}</em><strong>{Number(profile.employees).toLocaleString()}</strong><span /></div>}
                {profile.ipo && <div className="lite-tech-item"><em>{tl(t, 'Public since', 'lbl')}</em><strong>{String(profile.ipo).slice(0, 4)}</strong><span /></div>}
                {profile.industry && <div className="lite-tech-item"><em>{tl(t, 'Industry', 'lbl')}</em><strong style={{ fontSize: '0.95rem' }}>{profile.industry}</strong><span /></div>}
              </div>
    </section>
  )

  const ctaBlock = (cls) => (
    <section className={`lite-research-cta ${cls}`}>
              <p className="lite-eyebrow">{tl(t, 'Go deeper', 'ttl')}</p>
              <p className="lite-empty">{isStock
                ? tl(t, 'Indicators, fundamentals, analyst context and stock heatmaps live in PRO.', 'msg')
                : tl(t, 'Charts with indicators, sentiment, on-chain flows and the full desk read live in PRO.', 'msg')}</p>
              <button type="button" className="lite-pro-btn" onClick={() => (isStock ? onOpenPath?.('/heatmaps') : onOpenResearch?.(sym))}>
                {isStock ? tl(t, 'The stock desk in PRO', 'msg') : t('lite.msg.open_sym_in_pro', 'Open {{sym}} in PRO', { sym })}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
    </section>
  )

  return (
    <div className="lite-view lite-view--wide lite-rz-view">
      <header className="lite-view-head lite-view-head--rz lite-rise">
        {onBack && (
          <button type="button" className="lite-back lite-back--inline" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            <span className="lite-back-lbl">{backLabel}</span>
          </button>
        )}
        <div className="lite-rz-headline">
          <h1 className="lite-view-title">{tl(t, 'Research', 'ttl')}</h1>
          <p className="lite-view-sub">{tl(t, 'One coin at a time, zoomed out.', 'sub')}</p>
        </div>
        {onCinema && symbols.length > 1 && (
          <CinemaButton
            label={tl(t, 'Cinema', 'lbl')}
            onClick={() => onCinema(
              tl(t, 'Research', 'ttl'),
              symbols.map((s) => {
                const oc = (s === sym && onchainRef)
                  ? {
                      address: onchainRef.contract,
                      chain: onchainRef.chain,
                      networkId: onchainRef.networkId
                        || CODEX_NETWORK_ID[String(onchainRef.chain || '').toLowerCase()]
                        || undefined,
                    }
                  : idBySym[s]
                // Hand over what we KNOW and nothing we don't. Passing the
                // TICKER as `name` (what this did) is worse than passing none:
                // resolveCgId compares it against CoinGecko's coin NAME, and a
                // ticker that fails to match retires the search instead of
                // letting the logo / unique-name / rank rungs decide.
                const knownCg = s === sym ? (pickCgId || stats?._cg || null) : null
                const knownName = s === sym ? (stats?.name || null) : null
                return {
                  symbol: s,
                  name: isStock ? (INDEX_META[s]?.short || s) : knownName,
                  logo: chipImg[s] || null,
                  cgId: isStock ? null : (SYMBOL_TO_COINGECKO_ID[s] || knownCg),
                  isStock,
                  ...(oc || {}),
                }
              }),
              Math.max(0, symbols.indexOf(sym)),
            )}
          />
        )}
      </header>

      <div className="lite-chips lite-chips--rail lite-rise">
        {symbols.map((s) => {
          // Crypto only: the stock rail has no price lane loaded here, so a
          // figure on the selected chip alone would read as nine broken ones.
          const raw = isStock ? null : (s === sym && hasPrice ? change : chipChg[s])
          const chg = Number.isFinite(raw) ? Math.round(raw * 10) / 10 : null
          return (
            <button key={s} type="button" className={`lite-chip lite-chip--rail${s === sym ? ' active' : ''}`} onClick={() => setSym(s)}>
              {chipImg[s] && <img className="lite-chip-logo" src={chipImg[s]} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
              <span className="lite-chip-sym">{s.startsWith('^') ? (INDEX_META[s]?.short || s.slice(1)) : s}</span>
              {chg != null && chg !== 0 && (
                <span className={`lite-chip-chg ${chg > 0 ? 'up' : 'down'}`}>{chg > 0 ? '+' : ''}{chg.toFixed(1)}%</span>
              )}
            </button>
          )
        })}
      </div>

      {/* The stage. No card around the chart: the price sits on the wallpaper
          in display type and the series paints edge to edge beneath it. The
          boxed version - price header, chart, stats, all in one glass tile -
          read as a dashboard widget rather than the point of the page. */}
      <section className="lite-rz-stage lite-rise">
        <div className="lite-rz-stage-head">
          <div className="lite-rz-stage-id">
            {(pickHint?.image || chipImg[sym] || stats?.image) && (
              <img className="lite-rz-stage-logo" src={pickHint?.image || chipImg[sym] || stats?.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            )}
            <span className="lite-rz-stage-name">{pickHint?.name || stats?.name || dispSym}</span>
            {!isIndex && (!isStock || market === 'stocks') && <RzStar wl={wl} sym={sym} name={pickHint?.name || stats?.name} stock={isStock} contract={stats?.contract} chain={stats?.chain} />}
            <span className="lite-rz-stage-sym">
              {dispSym}
              {!isStock && stats?.rank > 0 && <span className="lite-rz-stage-rank">#{stats.rank}</span>}
              {isStock && stockMeta?.exchange && <span className="lite-rz-stage-rank">{stockMeta.exchange}</span>}
            </span>
          </div>
          {stats && (
            <div className="lite-rz-stage-meta">
              {stats.marketCap > 0 && <span><em>{tl(t, 'Market cap', 'lbl')}</em>{fmtLargeShort(stats.marketCap)}</span>}
              {stats.volume > 0 && <span><em>{tl(t, '24h volume', 'lbl')}</em>{fmtLargeShort(stats.volume)}</span>}
              {!isStock && turnover != null && <span><em>{tl(t, 'Turnover', 'lbl')}</em>{turnover.toFixed(1)}%</span>}
              {isStock && Number(profile?.pe) > 0 && <span><em>{tl(t, 'P/E ratio', 'lbl')}</em>{Number(profile.pe).toFixed(1)}</span>}
              {isStock && Number(profile?.dividendYield) > 0 && <span><em>{tl(t, 'Dividend yield', 'lbl')}</em>{Number(profile.dividendYield).toFixed(2)}%</span>}
            </div>
          )}
        </div>
        <p className="lite-rz-stage-price"><RollingNumber text={scrub ? fmtPrice(scrub.price) : hasPrice ? fmtPrice(stats.price) : '—'} /></p>
        {scrub && scrubChg != null ? (
          <p className={`lite-rz-stage-change ${scrubChg >= 0 ? 'up' : 'down'}`}>
            {`${scrubChg >= 0 ? '+' : ''}${fmtPctCompact(scrubChg)}%`}
            <span className="lite-research-scrubdate"> · {fmtAxisDate(scrub.time, tf === '1D' ? '1D' : '1M', i18n.language)}</span>
          </p>
        ) : (
          <p className={`lite-rz-stage-change ${change >= 0 ? 'up' : 'down'}`}>
            {hasPrice ? t('lite.msg.pct_today', '{{pct}}% today', { pct: `${change >= 0 ? '+' : ''}${change.toFixed(2)}` }) : ''}
          </p>
        )}
        <div className="lite-rz-stage-chart">
            {ctype === 'tv' && tvUsable ? (
              <div className="lite-tv-embed">
                {/* 🪤 Do NOT mount the widget until the identity that KEYS it has
                    settled. `onchainContract` can arrive late — resolveCgPlatform
                    is two network hops and deliberately waits for the stats row
                    before it can disambiguate a ticker — and it is part of the key
                    below, so mounting early meant TradingView was built, torn down
                    and built again for exactly the tokens the recovery lane exists
                    for (the §15 class: 13 of 19 gainers rows carry `chain: null`).
                    On a phone that is a 4.4MB widget rebuilding mid-view, which is
                    the "charts flicker hard, at times" report — "at times" being
                    the tokens that need recovering.

                    Waiting also closes a correctness window: until recovery lands
                    the widget would be charting the UNrecovered identity, which on
                    a colliding ticker is a different token's tape (§I10). The key
                    stays exactly as it was — it is what keeps a twin's series from
                    sitting under this header — we simply stop racing it. */}
                {!tvIdentitySettled ? (
                  <div className="lite-chart-empty"><SkelRows n={5} /></div>
                ) : (
                <Suspense fallback={<div className="lite-chart-empty"><SkelRows n={5} /></div>}>
                  <TradingViewAdvanced
                    // The contract is part of the key: two tokens can share a
                    // ticker, and remounting on the symbol alone would leave
                    // the previous twin's series under the new header.
                    key={`${tvSymbol}:${onchainContract || '-'}`}
                    symbol={tvSymbol}
                    timeframe={tvInterval.tva}
                    // The opening window: TV_WINDOW_BARS candles of the chosen
                    // interval, instead of whatever bar count the widget picks
                    // for itself. The pill names the CANDLE now, so this is a
                    // readable starting view, not a promise - the user is free
                    // to zoom out of it and nothing re-asserts it afterwards.
                    // CRYPTO ONLY - equities have session gaps (nights, weekends,
                    // holidays) that nothing in this stack models yet, so a
                    // wall-clock window on a Monday morning would frame the
                    // weekend. Stocks keep TV's own fit until sessions are handled.
                    visibleRangeSec={isStock ? undefined : tvSpanSec}
                    visibleRangeEndSec={isStock ? undefined : (seriesEdges.endSec || undefined)}
                    onSparseInterval={isStock ? undefined : onTvSparse}
                    dayMode={liteLook === 'paper'}
                    height={430}
                    token={tvToken}
                    // Saves the datafeed a cold /api/bars probe fired purely to
                    // derive the price decimals — we already know the price.
                    //
                    // ONLY when we trust it. TVA uses this as ground truth in its
                    // bad-data guard and KILLS the chart when the bars' median is
                    // >100x away from it. On an on-chain cap the hero price comes
                    // from the box's symbol-keyed row, which is measurably wrong
                    // (see mergeGtStats) - a decimals-class error there would have
                    // nuked a perfectly good series and printed "no data". `_gt` is
                    // set only once a contract-keyed GeckoTerminal reading has been
                    // merged, so before that we hand over nothing and let the
                    // datafeed derive the scale from the bars themselves.
                    referencePrice={(isOnchain && !stats?._gt) ? undefined : (Number(stats?.price) || undefined)}
                    onNoData={handleTvNoData}
                    onIntervalChange={onTvIntervalChange}
                    // One timeframe control on this card, and it is the pill row.
                    hideIntervalPicker
                  />
                </Suspense>
                )}
              </div>
            ) : (
              <LiteChart
                rows={chartRows}
                tfId={tf}
                fmtPrice={fmtPrice}
                locale={i18n.language}
                mode={ctype === 'tv' ? 'line' : ctype}
                onScrub={setScrub}
                live={marketLive}
                // Three empty states, each true by construction: a series we
                // hold and refused, no series under a live quote, or no data of
                // any kind. "No price history yet" under a printed price and
                // four change windows was simply false.
                emptyLabel={seriesRefused
                  ? t('lite.msg.series_mismatch', "Chart hidden - the price history our sources return for {{sym}} is a different token's. The price and moves above are live.", { sym })
                  : hasPrice
                    ? t('lite.msg.series_unmatched', 'No chart for {{sym}} yet - our sources return no history we can match to its price. The price and moves above are live.', { sym })
                    : t('lite.msg.no_price_history', 'No price history for {{sym}} on any of our sources yet.', { sym })}
              />
            )}
        </div>
        <div className="lite-rz-stage-tools">
              <div className="lite-research-toggles">
                <div className="lite-tf-toggle" role="tablist" aria-label={tr('lite.researchview.ariaChartType', "Chart type")}>
                  {[{ id: 'line', label: 'Line' }, { id: 'baseline', label: 'Baseline' }, { id: 'candles', label: 'Candles' }, ...(tvUsable ? [{ id: 'tv', label: 'TradingView' }] : [])].map((ct) => (
                    <button key={ct.id} type="button" role="tab" aria-selected={ctype === ct.id} aria-label={ct.label} className={`lite-tf-btn lite-tf-btn--ct${ctype === ct.id ? ' active' : ''}`} onClick={() => setCtype(ct.id)}><CtIcon id={ct.id} /><span className="lite-ct-lbl">{ct.id === 'tv' ? 'TradingView' : tl(t, ct.label)}</span></button>
                  ))}
                </div>
                {ctype === 'tv' && tvUsable ? (
                  <div className="lite-tf-toggle" role="tablist" aria-label={tr('lite.researchview.ariaCandleSize', "Candle size")}>
                    {TV_INTERVALS.map((iv) => (
                      <button key={iv.id} type="button" role="tab" aria-selected={tvInterval.id === iv.id} className={`lite-tf-btn${tvInterval.id === iv.id ? ' active' : ''}`} onClick={() => setTvIntervalId(iv.id)}>{iv.id}</button>
                    ))}
                  </div>
                ) : (
                  <div className="lite-tf-toggle" role="tablist" aria-label={tr('lite.researchview.ariaTimeframe', "Timeframe")}>
                    {TIMEFRAMES.map((tp) => (
                      <button key={tp.id} type="button" role="tab" aria-selected={tf === tp.id} className={`lite-tf-btn${tf === tp.id ? ' active' : ''}`} onClick={() => setTf(tp.id)}>{tp.id}</button>
                    ))}
                  </div>
                )}
              </div>
              {ctype === 'tv' && tvUsable && !isStock && (
                <p className="lite-tf-hint">
                  {t('lite.msg.tf_span', 'about {{window}} shown', { window: tvSpanLabel(tvSpanSec) })}
                </p>
              )}
        </div>
            {stats && (
              <div className="lite-perf">
                {PERF_WINDOWS.map(({ key, label }) => {
                  const v = Number((perfStats || stats)[key])
                  if (!Number.isFinite(v) || v === 0) return null
                  return (
                    <span key={key} className={`lite-perf-chip ${v >= 0 ? 'up' : 'down'}`}>
                      <em>{label}</em>{v >= 0 ? '+' : ''}{v.toFixed(1)}%
                    </span>
                  )
                })}
              </div>
            )}
      </section>

      <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={tr('lite.researchview.ariaResearchSection', "Research section")}>
        {RZ_TABS.map((tb) => (
          <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} className={`lite-tf-btn${tab === tb.id ? ' active' : ''}`} onClick={() => setTab(tb.id)}>{tl(t, tb.label)}</button>
        ))}
      </div>

      {/* One surface. Sections are separated by hairlines, not boxed into
          separate glass panels - the page was a stack of cards before and the
          founder asked for something that does not read as the same page. */}
      <section className="lite-panel lite-rz-surface lite-rise-1">
        {tab === 'overview' && (
          <>
            <div className="lite-rz-row lite-rz-row--3">
              {keyNumbersPanel('lite-rz-cell')}
              <div className="lite-rz-cell lite-rz-cell--stack">
            {isStock && earnDays != null && (
              <section className="lite-rz-sub lite-earn">
                <p className="lite-eyebrow">{earnDays === 0 ? tl(t, 'Earnings today', 'ttl') : earnDays === 1 ? tl(t, 'Earnings tomorrow', 'ttl') : t('lite.ttl.earnings_in_days', 'Earnings in {{n}} days', { n: earnDays })}</p>
                <p className="lite-earn-line">
                  {new Date(profile.earningsDate).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })}
                  {Number(profile.earningsAvg) > 0 ? ` · ${t('lite.msg.est_eps', 'est EPS ${{v}}', { v: Number(profile.earningsAvg).toFixed(2) })}` : ''}
                  {Number(profile.revenueAvg) > 0 ? ` · ${t('lite.msg.est_rev', 'est revenue {{v}}', { v: fmtLargeShort(profile.revenueAvg) })}` : ''}
                </p>
                <p className="lite-social-note">{tl(t, 'Prints can gap a stock either way - factor it into position size.', 'msg')}</p>
              </section>
            )}
            {isStock && (stkNews === null || stkNews.items.length > 0) && (
              <section className="lite-rz-sub">
                <p className="lite-eyebrow">
                  {stkNews?.matched
                    ? t('lite.ttl.sym_in_news', '{{sym}} in the news', { sym: dispSym })
                    : t('lite.tab.news', 'News')}
                </p>
                {stkNews === null ? <SkelRows n={3} /> : (
                  <ul className="lite-news-list lite-news-list--stack">
                    {stkNews.items.map((n) => (
                      <li key={n.id}>
                        <div className="lite-news-link">
                          <span className="lite-news-title">{n.title}</span>
                          <span className="lite-news-meta">{[n.category ? tl(t, n.category) : null, n.ts ? liteTimeAgo(n.ts, t) : null].filter(Boolean).join(' · ')}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {tweets !== null && !SYMBOL_TO_COINGECKO_ID[sym] && !isStock ? (
              <section className="lite-rz-sub">
                <p className="lite-eyebrow">{t('lite.ttl.sym_on_x', '{{sym}} on X', { sym })}</p>
                {tweets.length === 0 ? (
                  <p className="lite-empty">{t('lite.msg.not_enough_chatter', 'Not enough recent X chatter about {{sym}} to read the crowd honestly.', { sym })}</p>
                ) : (
                  <ul className="lite-tweet-list">
                    {tweets.map((tw) => {
                      const head = (
                        <span className="lite-tweet-head">
                          {tw.handle ? <span className="lite-tweet-handle">@{tw.handle}</span> : null}
                          {tw.handle && tw.ts ? <span className="lite-tweet-dot" aria-hidden>·</span> : null}
                          {tw.ts ? <span className="lite-tweet-time">{liteTimeAgo(tw.ts, t)}</span> : null}
                        </span>
                      )
                      const body = <span className="lite-tweet-text">{tw.text}</span>
                      return (
                        <li key={tw.id}>
                          {tw.url ? (
                            <a href={tw.url} target="_blank" rel="noopener noreferrer" className="lite-tweet">{head}{body}</a>
                          ) : (
                            <div className="lite-tweet">{head}{body}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            ) : coinNews.length > 0 && (
              <section className="lite-rz-sub">
                <p className="lite-eyebrow">{t('lite.ttl.sym_in_news', '{{sym}} in the news', { sym })}</p>
                <ul className="lite-news-list lite-news-list--stack">
                  {coinNews.map((item) => (
                    <li key={item.id}>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="lite-news-link">
                        <span className="lite-news-title">{item.title}</span>
                        <span className="lite-news-meta">{[item.source, liteTimeAgo(item.publishedOn, t)].filter(Boolean).join(' · ')}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

              </div>
              <div className="lite-rz-cell lite-rz-cell--stack">
            {isStock && analysts?.consensus && (() => {
              const c = analysts.consensus
              const total = c.total || 1
              const buyPct = Math.round(((c.strongBuy + c.buy) / total) * 100)
              const sellPct = Math.round(((c.sell + c.strongSell) / total) * 100)
              const holdPct = Math.max(0, 100 - buyPct - sellPct)
              const latest = (analysts.earnings || [])[0]
              return (
                <section className="lite-rz-sub">
                  <p className="lite-eyebrow">{tl(t, 'What Wall Street thinks', 'ttl')}</p>
                  <p className="lite-research-price" style={{ fontSize: '1.5rem', margin: '0 0 2px' }}>{tl(t, analysts.rating || 'Hold')}</p>
                  <p className="lite-social-note" style={{ marginTop: 0 }}>{t('lite.msg.n_analysts_covering', '{{n}} analysts covering', { n: c.total })}</p>
                  <div className="lite-tone-bar" aria-hidden>
                    <span className="lite-tone-bull" style={{ width: `${buyPct}%` }} />
                    <span className="lite-tone-neutral" style={{ width: `${holdPct}%` }} />
                    <span className="lite-tone-bear" style={{ width: `${sellPct}%` }} />
                  </div>
                  <div className="lite-tone-legend">
                    <span className="up">{buyPct}% {tl(t, 'buy')}</span>
                    <span>{holdPct}% {tl(t, 'hold')}</span>
                    <span className="down">{sellPct}% {tl(t, 'sell')}</span>
                  </div>
                  {latest && Number.isFinite(Number(latest.surprisePercent)) && (
                    <p className="lite-tech-read" style={{ margin: '12px 0 0', fontSize: '0.92rem' }}>
                      {Number(latest.surprisePercent) >= 0
                        ? t('lite.msg.earnings_beat', 'Last quarter it beat profit estimates by {{pct}}%.', { pct: Math.abs(Number(latest.surprisePercent)).toFixed(1) })
                        : t('lite.msg.earnings_miss', 'Last quarter it missed profit estimates by {{pct}}%.', { pct: Math.abs(Number(latest.surprisePercent)).toFixed(1) })}
                    </p>
                  )}
                  {targetUpside != null && (
                    <p className="lite-tech-read" style={{ margin: '10px 0 0', fontSize: '0.92rem' }}>
                      {targetUpside >= 0
                        ? t('lite.msg.target_above', 'Average 12-month target {{price}} - {{pct}}% above the current price.', { price: fmtPrice(profile.targetMeanPrice), pct: targetUpside.toFixed(1) })
                        : t('lite.msg.target_below', 'Average 12-month target {{price}} - {{pct}}% below the current price.', { price: fmtPrice(profile.targetMeanPrice), pct: Math.abs(targetUpside).toFixed(1) })}
                      {Number(profile?.targetLowPrice) > 0 && Number(profile?.targetHighPrice) > 0
                        ? ` (${fmtPrice(profile.targetLowPrice)} – ${fmtPrice(profile.targetHighPrice)})`
                        : ''}
                    </p>
                  )}
                  <p className="lite-social-note">{tl(t, 'Consensus of tracked sell-side analysts - opinions, not guarantees.', 'msg')}</p>
                </section>
              )
            })()}
                {techBlock('lite-rz-sub', true)}
              </div>
            </div>
            {debate && (
              <div className="lite-rz-row">
            <section className="lite-rz-cell lite-debate">
              <p className="lite-eyebrow">{tl(t, 'The debate', 'ttl')}</p>
              <div className="lite-debate-grid">
                <div className="lite-debate-col">
                  <span className="lite-debate-tag lite-debate-tag--bull">{tl(t, 'Bull case', 'lbl')}</span>
                  {debate.bull.length > 0 ? (
                    <ul>{debate.bull.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  ) : (
                    <p className="lite-empty">{tl(t, "The data doesn't make much of a bull case right now.", 'msg')}</p>
                  )}
                </div>
                <div className="lite-debate-col">
                  <span className="lite-debate-tag lite-debate-tag--bear">{tl(t, 'Bear case', 'lbl')}</span>
                  {debate.bear.length > 0 ? (
                    <ul>{debate.bear.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  ) : (
                    <p className="lite-empty">{tl(t, "The data doesn't make much of a bear case right now.", 'msg')}</p>
                  )}
                </div>
              </div>
              <p className="lite-social-note">{tl(t, 'Composed from analyst counts, earnings history and price action - facts, not advice.', 'msg')}</p>
            </section>
              </div>
            )}
            {isStock && profile?.description && <div className="lite-rz-row">{aboutBlock('lite-rz-cell')}</div>}
            <div className="lite-rz-row">{venuePanel('lite-rz-cell')}</div>
            <div className="lite-rz-row lite-rz-row--2">
              {tradingPanel('lite-rz-cell')}
              {sentimentPanel('lite-rz-cell')}
            </div>
            <div className="lite-rz-row">{ctaBlock('lite-rz-cell lite-rz-cta')}</div>
          </>
        )}
        {tab === 'technicals' && <div className="lite-rz-row">{techBlock('lite-rz-cell', false)}</div>}
        {tab === 'markets' && (
          <>
            <div className="lite-rz-row lite-rz-row--2">
              {keyNumbersPanel('lite-rz-cell')}
              {tradingPanel('lite-rz-cell')}
            </div>
            {isStock && profile?.description && <div className="lite-rz-row">{aboutBlock('lite-rz-cell')}</div>}
            <div className="lite-rz-row">{venuePanel('lite-rz-cell')}</div>
          </>
        )}
        {tab === 'sentiment' && <div className="lite-rz-row">{sentimentPanel('lite-rz-cell')}</div>}
      </section>
    </div>
  )
}
