/**
 * useSentimentEngine — the per-token sentiment data core for the RZ Sentiment tab.
 *
 * Pulls every social-intelligence surface the platform has for one token and
 * composes deterministic signals on top:
 *
 *   1. Mindshare v2 (data-api)     — LLM-classified, author-weighted crowd
 *      sentiment: current row + 5-min history (up to 30d). UPPER-symbol keyed.
 *      NOTE: /v2/:asset current row is NESTED (data.sentiment.score_24h,
 *      data.mindshare.pct_24h); /v2/history rows are FLAT.
 *   2. X-Bubbles detail (data-api) — categories, 7d hourly mention-volume
 *      history, tweet samples, mention metrics. NO market fields.
 *   3. /v1/prices (data-api)       — price / mcap / rank / change map.
 *   4. X Dash token + intel        — external mentions, quality forensics,
 *      via useXDashToken. `_source: fallback` payloads (upstream down) are
 *      treated as no-coverage, not zeros.
 *   5. Momentum origin (data-api)  — immutable since-tracked receipt,
 *      reconciled against the X Dash momentum_entry (earliest first-appearance
 *      wins) with ROI recomputed vs the live market cap — the raw ledger row
 *      can carry a re-entry as "first" and a frozen last/peak (ANSEM).
 *   6. Legacy sentiment (data-api) — LAZY fallback only when the v2 row is
 *      missing (the endpoint can take ~10s; it must never gate first paint).
 *   7. Crowd stance (/api/crowd-stance) — LLM classify of the live X tape,
 *      same lazy trigger; gives v2-uncovered on-chain runners a real crowd
 *      score, bull/bear split and an accumulating chart series.
 *
 * The caller's tokenData (page-resolved by cgId/contract) is the market
 * identity anchor: symbol-keyed /v1/prices rows that disagree with it by an
 * order of magnitude are DROPPED as ticker collisions, not blended.
 *
 * SPEED CONTRACT: every fetch lands independently (progressive setState), the
 * hero unblocks as soon as ANY of mindshare/prices/x-bubbles settles, and a
 * localStorage seed (10-min TTL) paints returning visits instantly before the
 * background refresh. X Dash forensics stream in when they arrive — they never
 * hold the page hostage (the dev upstream alone can take 10s+).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useXDashToken } from '@/hooks/useXDashToken'
import {
  getSpectreMindshareCurrent,
  getSpectreMindshareHistory,
  getSpectreTokenSentiment,
} from '@/services/spectreMarketApi'
import { searchCoinsForROI } from '@/services/coinGeckoApi'
import { overrideMomentumEntry } from '@/pages/x-dash/components/momentum-overrides'
import {
  fadeSignalFromXDash,
  attentionPhaseFromXDash,
  computeSignalScore,
  signalScoreFromXDash,
  computeAuthorClusters,
} from '@/lib/social-signals'

const FETCH_TIMEOUT = 12_000
const _cache = new Map()
const _inflight = new Map()

const SEED_PREFIX = 'spectre-senengine-v1:'
const SEED_TTL = 10 * 60_000

function cached(key, ttl, fetchFn) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data)
  if (_inflight.has(key)) return _inflight.get(key)
  const p = fetchFn()
    .then((data) => {
      _cache.set(key, { data, ts: Date.now() })
      _inflight.delete(key)
      return data
    })
    .catch((err) => {
      _inflight.delete(key)
      throw err
    })
  _inflight.set(key, p)
  return p
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

async function fetchJson(url) {
  // credentials: 'include' — keep the gate cookie attached on the iOS standalone
  // PWA (same-origin fetches drop it otherwise -> 401 -> empty Sentiment engine).
  const r = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r.json()
}

// Straight to the data-api route (vite proxies /data-api in dev; the
// extended-proxy `social/` allowlist covers it in prod).
function fetchXBubblesDetail(symbol) {
  const sym = String(symbol || '').toUpperCase()
  return cached(`xb:${sym}`, 60_000, () => fetchJson(`/data-api/v1/social/x-bubbles/${encodeURIComponent(sym)}`))
}

function fetchPricesRow(symbol) {
  const sym = String(symbol || '').toUpperCase()
  return cached(`px:${sym}`, 30_000, () =>
    fetchJson(`/data-api/v1/prices?symbols=${encodeURIComponent(sym)}`).then((j) => j?.data?.[sym] || null)
  )
}

// Real per-project FUNDAMENTALS (aixbt-style depth): token unlock schedule
// (supply overhang) + protocol TVL (adoption). Both degrade to null (memecoins
// have neither — itself a signal). Proxy allows v1/unlocks + v1/defi/.
function fetchUnlocks(symbol) {
  const s = String(symbol || '').toUpperCase()
  // 60s: the schedule is slow-moving but its USD overhang is spot-derived.
  return cached(`unlocks:${s}`, 60_000, () =>
    fetchJson(`/data-api/v1/unlocks/${encodeURIComponent(s)}`).then((j) => j?.data || null).catch(() => null)
  )
}
function fetchTvl(cgId) {
  const k = String(cgId || '').toLowerCase()
  if (!k) return Promise.resolve(null)
  return cached(`tvl:${k}`, 300_000, () =>
    fetchJson(`/data-api/v1/defi/protocol/${encodeURIComponent(k)}`).then((j) => (Array.isArray(j?.data) ? j.data : null)).catch(() => null)
  )
}

// Crowd-stance fallback — LLM-classified bull/bear split from the live X tape,
// for tokens the mindshare_v2 pipeline doesn't cover (majors that went quiet
// like $XLM, loud on-chain runners like $ANSEM). Server KV-caches the
// classification 10 min; fired only after the v2 row / history comes back
// empty, so richly-covered tokens (BTC) never pay it.
//
// NOTE: unlike the other feeds this MUST NOT cache a null. The first hit on a
// cold token runs the classify inline (~3-4s) and returns real data, but a
// concurrent hit while the server gen-lock is held returns {data:null} — and
// caching that null for minutes was leaving the crowd chart empty until the
// TTL expired. Cache only a successful non-null classification; retry the rest.
const _crowdCache = new Map()
const _crowdInflight = new Map()
const CROWD_TTL = 240_000
function fetchCrowdStance(sym, cgId) {
  const k = String(cgId).toLowerCase()
  const hit = _crowdCache.get(k)
  if (hit && Date.now() - hit.ts < CROWD_TTL) return Promise.resolve(hit.data)
  if (_crowdInflight.has(k)) return _crowdInflight.get(k)
  const p = fetchJson(`/api/crowd-stance?symbol=${encodeURIComponent(sym)}&cgId=${encodeURIComponent(k)}`)
    .then((j) => {
      _crowdInflight.delete(k)
      if (j?.data && num(j.data.score) != null) _crowdCache.set(k, { data: j, ts: Date.now() })
      return j
    })
    .catch((err) => { _crowdInflight.delete(k); throw err })
  _crowdInflight.set(k, p)
  return p
}

// One momentum-origin lookup for a single key. A `data:null` (degraded) body is
// a valid "no receipt under this key" answer, not an error — so we can fall
// through to the next candidate key.
function fetchOriginByKey(key) {
  const k = String(key).toLowerCase()
  return cached(`origin:${k}`, 300_000, () =>
    fetchJson(`/api/xdash/momentum-origin/${encodeURIComponent(k)}`)
  )
}

// Resolve a ticker to its canonical CoinGecko slug (best-ranked exact-symbol
// match — the search list is pre-sorted by market-cap rank, so MANIFEST →
// `manifesting`, not a lower-cap namesake). Session-cached; only hit when the
// direct keys miss.
const _slugCache = new Map()
async function resolveCgSlug(sym) {
  const key = String(sym || '').toUpperCase()
  if (!key) return null
  if (_slugCache.has(key)) return _slugCache.get(key)
  let slug = null
  try {
    const coins = await searchCoinsForROI(key)
    const exact = (coins || []).filter((c) => String(c.symbol || '').toUpperCase() === key && c.id)
    slug = (exact[0] || (coins || [])[0])?.id || null
  } catch { /* leave null */ }
  _slugCache.set(key, slug)
  return slug
}

// The "since first tracked" receipt is keyed by the CoinGecko slug, but callers
// resolve identity inconsistently — on-chain tokens surface late/absent cgIds,
// or a near-miss slug (`manifest` vs `manifesting`). A single-key lookup wrongly
// reported proven runners as "never tracked". Try every identity we hold —
// cgId, symbol, then the resolved canonical slug — first real receipt wins.
// (The data-api now also matches on symbol, so the symbol pass alone covers most
// misses; the slug resolve is the belt for a wrong cgId with no symbol row.)
async function fetchMomentumOrigin(cgId, sym) {
  const tried = new Set()
  const tryKey = async (key) => {
    if (!key) return null
    const k = String(key).toLowerCase()
    if (tried.has(k)) return null
    tried.add(k)
    try {
      const v = await fetchOriginByKey(k)
      return v?.data ? v : null
    } catch { return null }
  }
  return (
    (await tryKey(cgId)) ||
    (await tryKey(sym)) ||
    (await tryKey(await resolveCgSlug(sym))) ||
    null
  )
}

/* ── localStorage instant-paint seed ──────────────────────────────────────── */

function loadSeed(sym) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${SEED_PREFIX}${sym}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || Date.now() - parsed.ts > SEED_TTL) return null
    return parsed.slices || null
  } catch {
    return null
  }
}

function saveSeed(sym, slices) {
  if (typeof window === 'undefined') return
  try {
    const trimmedHistory = (slices.mindshareHistory || []).slice(-300)
    const xb = slices.xBubbles
      ? { ...slices.xBubbles, description: undefined, tweets: undefined, socials: undefined }
      : null
    window.localStorage.setItem(
      `${SEED_PREFIX}${sym}`,
      JSON.stringify({
        ts: Date.now(),
        slices: {
          mindshare: slices.mindshare,
          mindshareHistory: trimmedHistory,
          xBubbles: xb,
          prices: slices.prices,
          origin: slices.origin,
          crowdFx: slices.crowdFx,
        },
      })
    )
  } catch {
    // quota / private mode — non-fatal
  }
}

/* ── Engine verdict — deterministic priority rules over the signals ───────── */

function composeVerdict({ crowdScore, quality, fade, phase, change24h, mentions }) {
  if (mentions != null && mentions < 5) {
    /* A big price move on a quiet tape is a PRICE story, not a neutral one.
       Seen live on $M87 (−17.7% 24h): first paint (no mentions yet) correctly
       read "Price-Led Selloff", then mentions=1 landed and the quiet branch
       overwrote it with a neutral "Quiet" — on an −18% day. Quiet must not
       bury the move; it becomes context inside the price-led read. */
    if (change24h != null && Math.abs(change24h) >= 8) {
      return {
        key: 'price-led', label: change24h > 0 ? 'Price-Led Move' : 'Price-Led Selloff', tone: change24h > 0 ? 'bull' : 'bear',
        line: `Price moved ${change24h > 0 ? '+' : ''}${change24h.toFixed(1)}% with almost no chatter (${mentions} mention${mentions === 1 ? '' : 's'} 24h) — the tape is the only signal, and it is doing all the talking.`,
      }
    }
    return { key: 'quiet', label: 'Quiet', tone: 'neutral', line: 'Too little chatter for a crowd read — price action is the only signal here.' }
  }
  if (fade?.tag === 'bearish' && fade.tier !== 'low') {
    return { key: 'distribution', label: 'Distribution Risk', tone: 'bear', line: fade.thesis }
  }
  if (phase?.phase === 'exhaustion' && phase.tier !== 'low') {
    return { key: 'exhaustion', label: 'Attention Exhausting', tone: 'warn', line: phase.thesis }
  }
  if (fade?.tag === 'hype') {
    return { key: 'hype', label: 'Manufactured Hype', tone: 'warn', line: fade.thesis }
  }
  if (phase?.phase === 'ignition') {
    return { key: 'ignition', label: 'Organic Ignition', tone: 'bull', line: phase.thesis }
  }
  if (phase?.phase === 'coiling') {
    return { key: 'coiling', label: 'Attention Leading Price', tone: 'info', line: phase.thesis }
  }
  if (crowdScore != null && crowdScore >= 65 && quality != null && quality < 35) {
    return { key: 'lowq-bull', label: 'Bullish, Low-Quality Tape', tone: 'warn', line: 'The crowd leans bullish but the chatter quality is thin — treat the optimism with caution.' }
  }
  if (crowdScore != null) {
    if (crowdScore >= 75) return { key: 'ext-bull', label: 'Extreme Bullish Crowd', tone: 'bull', line: 'The crowd is heavily positioned bullish. Crowded optimism cuts both ways — strong tape, thin margin for disappointment.' }
    if (crowdScore >= 60) return { key: 'bull', label: 'Bullish Crowd', tone: 'bull', line: 'Net-bullish crowd read with room before euphoria.' }
    if (crowdScore <= 25) return { key: 'ext-bear', label: 'Extreme Bearish Crowd', tone: 'bear', line: 'The crowd has capitulated on this name. Max pessimism is where reversals start, but catching it needs price confirmation.' }
    if (crowdScore <= 40) return { key: 'bear', label: 'Bearish Crowd', tone: 'bear', line: 'Net-bearish crowd read — sellers own the narrative for now.' }
  }
  if (change24h != null && Math.abs(change24h) >= 8) {
    return {
      key: 'price-led', label: change24h > 0 ? 'Price-Led Move' : 'Price-Led Selloff', tone: change24h > 0 ? 'bull' : 'bear',
      line: `Price moved ${change24h > 0 ? '+' : ''}${change24h.toFixed(1)}% without a matching crowd shift — the move is ahead of the narrative.`,
    }
  }
  return { key: 'neutral', label: 'Neutral', tone: 'neutral', line: 'Sentiment and price are both range-bound — no edge from the crowd right now.' }
}

const EMPTY_SLICES = {
  mindshare: null,
  mindshareHistory: [],
  xBubbles: null,
  prices: null,
  origin: null,
  legacy: null,
  crowdFx: null,
  unlocks: null,
  tvl: null,
}

/* ── The hook ─────────────────────────────────────────────────────────────── */

export default function useSentimentEngine(symbol, cgId, { enabled = true, tokenData = null } = {}) {
  const sym = String(symbol || '').toUpperCase()
  const [slices, setSlices] = useState(EMPTY_SLICES)
  // core settles when any of the fast primary feeds lands (or all fail)
  const [coreSettled, setCoreSettled] = useState(false)
  // crowdFx classify state: 'idle' | 'pending' | 'done' — lets the chart show
  // a "reading the crowd" state instead of a false "no history" during the
  // ~3-4s live-tape classify on a cold token.
  const [crowdFxState, setCrowdFxState] = useState('idle')
  const [historyHours, setHistoryHours] = useState(168)
  const loadedHoursRef = useRef(0)
  const runRef = useRef(0)
  // Once-per-token guard so the two independent triggers (null v2 score AND
  // empty v2 history) never double-fire the classify for the same token.
  const crowdFiredRef = useRef(null)

  // X Dash forensics — streams in whenever it arrives; NEVER gates first paint.
  // A cgId not yet in the X Dash collector universe returns a `_source: fallback`
  // payload (empty forensics). `force=1` asks the collector to build that token
  // on demand — we flip it ON only after a cold fallback comes back, so tracked
  // majors never pay the warm cost but small/newly-listed names (SPECTRE et al.)
  // stop rendering an empty X Dash panel.
  const [xdashForce, setXdashForce] = useState(false)
  // Request shape matches useKolBubbles' call EXACTLY ({includeIntel, '24h',
  // 'all', 50}) so the two hooks share one CLIENT_CACHE/INFLIGHT entry on the
  // Sentiment tab — previously the differing perPage/scope keyed two separate
  // /api/xdash/token + /api/xdash/intel/token pulls (4 requests) per token.
  const { data: xdash, loading: xdashLoading } = useXDashToken(enabled ? (cgId || null) : null, {
    includeIntel: true,
    timeframe: '24h',
    authorScope: 'all',
    perPage: 50,
    force: xdashForce,
  })
  useEffect(() => { setXdashForce(false) }, [cgId])
  useEffect(() => {
    if (!xdash || xdashForce) return
    if (String(xdash._source || '').includes('fallback')) setXdashForce(true)
  }, [xdash, xdashForce])

  // Tracks the symbol of the previous core-effect run so we carry the in-flight
  // mindshareHistory forward ONLY across a cgId-resolve (same sym), never across
  // a real token switch — carrying it there plotted the previous token's crowd
  // line under the new token AND saveSeed persisted it into the new token's seed.
  const prevSymRef = useRef(null)

  // Core load — each slice lands independently (progressive paint).
  useEffect(() => {
    if (!enabled || !sym) return undefined
    const run = ++runRef.current
    const alive = () => runRef.current === run

    // Same sym (cgId resolved a beat after mount) -> keep the history the
    // history effect already loaded. Real switch -> start clean so a token with
    // no history rows can't inherit the previous token's crowd line.
    const sameSym = prevSymRef.current === sym
    prevSymRef.current = sym
    const carryHistory = (s) => (sameSym ? s.mindshareHistory : [])

    const seed = loadSeed(sym)
    if (seed) {
      setSlices((s) => ({ ...EMPTY_SLICES, mindshareHistory: carryHistory(s), ...seed }))
      setCoreSettled(true)
    } else {
      setSlices((s) => ({ ...EMPTY_SLICES, mindshareHistory: carryHistory(s) }))
      setCoreSettled(false)
    }

    const merge = (patch) => {
      if (!alive()) return
      setSlices((s) => ({ ...s, ...patch }))
    }
    const settle = () => { if (alive()) setCoreSettled(true) }

    // reset crowd-classify state for the new token
    crowdFiredRef.current = null
    setCrowdFxState('idle')
    // Fire the live-tape crowd classify at most once per token — the guard ref
    // keeps the mindshare-null and mindshare-failed triggers below from double-
    // firing it. Drives both the crowd gauge and the chart's crowd series.
    const fireCrowd = () => {
      if (!alive() || !cgId) return
      if (crowdFiredRef.current === cgId) return
      crowdFiredRef.current = cgId
      setCrowdFxState('pending')
      fetchCrowdStance(sym, cgId)
        .then((v) => { merge({ crowdFx: v?.data || null }); if (alive()) setCrowdFxState('done') })
        .catch(() => { if (alive()) setCrowdFxState('done') })
    }

    // Fast primaries — first one to land unblocks the hero.
    const pMindshare = getSpectreMindshareCurrent(sym)
      .then((v) => { merge({ mindshare: v }); settle(); return v })
      .catch(() => null)
    const pPrices = fetchPricesRow(sym)
      .then((v) => { merge({ prices: v }); settle(); return v })
      .catch(() => null)
    const pXb = fetchXBubblesDetail(sym)
      .then((v) => { merge({ xBubbles: v?.data || v || null }); settle(); return v })
      .catch(() => null)

    fetchMomentumOrigin(cgId, sym)
      .then((v) => merge({ origin: v?.data || null }))
      .catch(() => {})

    // Fundamentals — unlocks (all tokens) + TVL (DeFi only). Off the critical
    // path; each degrades to null (memecoins have neither).
    fetchUnlocks(sym).then((v) => merge({ unlocks: v })).catch(() => {})
    if (cgId) fetchTvl(cgId).then((v) => merge({ tvl: v })).catch(() => {})

    // Legacy sentiment is a ~10s endpoint — fetch it ONLY if the v2 row came
    // back empty (fallback scoring), never on the critical path. The crowd-
    // stance classify (LLM over the live X tape) fires on the same trigger:
    // it is what gives a loud on-chain runner a real bull/bear read when the
    // mindshare_v2 pipeline has no row for it at all ($ANSEM et al.).
    // Fire the live-tape crowd classify when mindshare_v2 has no usable 24h
    // score for this token — covers both a quiet major ($XLM: 1 mention/7d in
    // the v2 pipeline, but 40+ real tweets on the X Dash tape) and a loud
    // on-chain runner v2 never ingested ($ANSEM). Covered tokens (BTC) keep
    // their v2 score and never pay the classify.
    pMindshare.then((ms) => {
      if (!alive()) return
      if (ms && num(ms?.sentiment?.score_24h) != null) { setCrowdFxState('done'); return }
      getSpectreTokenSentiment(sym)
        .then((v) => merge({ legacy: v }))
        .catch(() => {})
      fireCrowd()
    })
    // If the mindshare fetch itself failed we still can't rely on v2 — try the
    // tape so a network blip on the v2 endpoint doesn't blank the crowd read.
    pMindshare.then((ms) => { if (alive() && ms == null) fireCrowd() })

    // Belt-and-suspenders: if every primary failed, still settle so the empty
    // states render instead of an eternal skeleton.
    Promise.allSettled([pMindshare, pPrices, pXb]).then(settle)

    return undefined
  }, [enabled, sym, cgId])

  // Sentiment history — separate effect with its OWN cancellation so the core
  // effect re-running (cgId resolving a beat after mount bumps runRef) can't
  // invalidate an in-flight history fetch. That race blanked the chart once.
  useEffect(() => {
    if (!enabled || !sym) return undefined
    let cancelled = false
    getSpectreMindshareHistory(sym, historyHours)
      .then((rows) => {
        if (cancelled || !rows.length) return
        loadedHoursRef.current = historyHours
        setSlices((s) => ({ ...s, mindshareHistory: rows }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [enabled, sym, historyHours])

  // Persist the seed whenever the fast slices are all present.
  useEffect(() => {
    if (!sym || !coreSettled) return
    if (!slices.mindshare && !slices.prices && !slices.xBubbles) return
    saveSeed(sym, slices)
  }, [sym, coreSettled, slices])

  // Chart calls this when the user opens a longer range (30D -> 720h)
  const requestRange = useCallback((hours) => {
    const h = Math.min(Math.max(Number(hours) || 168, 24), 720)
    setHistoryHours((prev) => (h > prev ? h : prev))
  }, [])

  return useMemo(() => {
    const { mindshare, mindshareHistory, xBubbles, prices, origin, legacy, crowdFx } = slices

    /* Market row. The page's own tokenData is the identity anchor (resolved by
       cgId/contract) and always wins. The /v1/prices row is SYMBOL-keyed and
       collides on shared tickers — seen live on $ANSEM, where the symbol row
       returned "Ansem's minutes" ($166K, +285%) instead of The Black Bull
       ($316M, +82%) and the whole tab read the wrong token. When the two
       market caps disagree by close to an order of magnitude, the symbol row
       IS another token: drop it entirely rather than blend two identities. */
    const tdMcap = num(tokenData?.marketCap) ?? num(tokenData?.mcap)
    const pxMcap = num(prices?.market_cap)
    const pxTrusted = !(tdMcap != null && pxMcap != null && (tdMcap / pxMcap > 8 || pxMcap / tdMcap > 8))
    const px = pxTrusted ? prices : null
    const circMcap = tdMcap ?? num(px?.market_cap) ?? num(mindshare?.market_cap_usd)
    const mktPrice = num(tokenData?.price) ?? num(px?.price)
    const mktRank = num(tokenData?.rank) ?? num(px?.rank) ?? num(xBubbles?.rank)

    /* FULL-SUPPLY (FDV) market cap for on-chain fixed-supply memecoins.
       The entire on-chain market — DexScreener, the price chart, pump.fun, AND
       the momentum-origin ENTRY this tab computes ROI against — quotes
       full-supply mcap (price x total supply), because a memecoin's
       "non-circulating" supply is founder-held-but-liquid, not vesting-locked.
       CoinGecko's circulating figure undercounts it: $ANSEM shows 415.68M circ
       of 999.95M total -> $146M, while the market (and DexScreener) quote
       ~$341M. That mismatch understated the since-tracked ROI (full-supply
       entry vs a circulating "now" is apples-to-oranges: +2399% instead of the
       real ~+5900%) and misclassed the token as a nano cap. Switch to
       full-supply ONLY when the token is on-chain, reads as a memecoin/degen
       (or is a pump.fun contract), and circulating MATERIALLY undercounts total
       — never for CEX majors or fully-circulating tokens. */
    const totalSupply = num(tokenData?.totalSupply) ?? num(tokenData?.maxSupply)
    const fullSupplyMcap = (mktPrice != null && totalSupply != null)
      ? mktPrice * totalSupply
      : num(tokenData?.fdv)
    const contract = xdash?.token?.contract_address || tokenData?.contract || tokenData?.address || null
    const catText = [
      ...(Array.isArray(xdash?.token?.category) ? xdash.token.category : []),
      ...(Array.isArray(xdash?.token?.tags) ? xdash.token.tags : []),
      xdash?.token?.primary_category,
      ...(Array.isArray(tokenData?.categories) ? tokenData.categories : []),
    ].filter(Boolean).join(' ').toLowerCase()
    const looksMeme = /meme|pump\.?fun|degen/.test(catText) || /pump$/i.test(String(contract || ''))
    const materialGap = fullSupplyMcap != null && circMcap != null && fullSupplyMcap > circMcap * 1.3
    const useFullSupply = !!contract && materialGap && (looksMeme || mktRank == null || mktRank > 500)
    const effectiveMcap = useFullSupply ? fullSupplyMcap : circMcap

    const market = (tokenData || px || xBubbles || mindshare) ? {
      price: mktPrice,
      change24h: num(tokenData?.change24h) ?? num(px?.change?.['24h']),
      change7d: num(tokenData?.change7d) ?? num(px?.change?.['7d']),
      marketCap: effectiveMcap,
      // which basis the mcap is on, so the UI can label it honestly
      mcapBasis: useFullSupply ? 'fdv' : 'circulating',
      circMarketCap: circMcap,
      rank: mktRank,
      categories: Array.isArray(xBubbles?.categories) ? xBubbles.categories : [],
      primaryCategory: xBubbles?.primary_category || null,
    } : null

    /* Social metrics — X Dash first (richer), x-bubbles/mindshare fallback.
       A `_source: fallback` payload (upstream down / dev without the token)
       carries zeroed metrics — treat it as no-coverage rather than letting
       zeros masquerade as real forensics. */
    const xdashReal = xdash && !String(xdash._source || '').includes('fallback')
    const xm = (xdashReal && (xdash?.metrics || xdash?.token?.metrics)) || {}
    const xq = (xdashReal && (xdash?.quality || xdash?.token?.quality)) || {}
    const xbm = xBubbles?.metrics || {}
    // Notable external callers — the KOLs actually driving the chatter. For
    // on-chain tokens the classified bull/bear split is empty (mindshare_v2 is
    // symbol-keyed), so this is what we CAN honestly derive from the tweets:
    // who is talking, not a fabricated stance %. Verified or ≥50k-follower,
    // non-self. Ranked by REACH x engagement (not raw engagement, which buries
    // the big KOLs under giveaway/spam accounts) so the credible influencers
    // driving the attention surface first.
    const xTopAuthors = (xdashReal && Array.isArray(xdash?.top_authors || xdash?.token?.top_authors))
      ? (xdash.top_authors || xdash.token.top_authors) : []
    const kolReach = (a) => (num(a.followers_count) || 0) * (1 + Math.log10(1 + (num(a.total_weighted_engagement) || 0)))
    const notableAuthors = xTopAuthors
      .filter((a) => a && !a.is_self_author && (a.is_blue_verified || a.legacy_verified || num(a.followers_count) >= 50_000))
      .sort((a, b) => kolReach(b) - kolReach(a))
      .slice(0, 4)
      .map((a) => ({ handle: a.screen_name, name: a.name, followers: num(a.followers_count), verified: !!(a.is_blue_verified || a.legacy_verified) }))
    // Cross-cluster breadth (aixbt-inspired): which community archetypes are
    // actually discussing this — broad = organic conviction, single-cluster =
    // echo chamber. Classified free from author bios.
    const clusters = computeAuthorClusters(xTopAuthors)
    const xbVelocity = num(xbm.mentions_24h) != null && num(xbm.mentions_7d_avg) > 0
      ? xbm.mentions_24h / xbm.mentions_7d_avg
      : null
    const social = {
      mentions24h: num(xm.external_mentions_24h ?? xm.mentions_24h) ?? num(xbm.mentions_24h),
      prevDailyAvg: num(xm.external_mentions_prev_daily_avg) ?? num(xbm.mentions_7d_avg),
      uniqueAuthors: num(xm.unique_external_authors_24h ?? xm.unique_authors_24h ?? xm.unique_authors) ?? num(mindshare?.unique_authors_24h),
      engagement: num(xm.total_weighted_engagement ?? xm.external_weighted_engagement) ?? num(mindshare?.mindshare?.weighted_mentions_24h),
      velocity: num(xm.velocity_ratio) ?? xbVelocity,
      novelty: num(xm.novelty_ratio),
      growthPct: num(xbm.growth_pct),
      cleanSignal: num(xq.clean_signal_score_24h),
      promoShare: num(xq.promo_share_24h),
      cashtagShare: num(xq.cashtag_only_share_24h ?? xq.cashtag_signal_share_24h),
      qualityStatus: xq.quality_status || null,
      qualityReasons: Array.isArray(xq.quality_reasons) ? xq.quality_reasons : [],
      kolCount: num(xm.kol_count),
      notableAuthors,
      clusters,
      mindsharePct: num(mindshare?.mindshare?.pct_24h),
      mindshareRank: num(mindshare?.mindshare?.rank_24h),
      hasXDash: !!(xdashReal && (xdash?.metrics || xdash?.token?.metrics)),
      // xdash requested but not (yet) usable — copy should say "unavailable",
      // never "not tracked" (X Dash tracks every major).
      xdashDegraded: !!(cgId && !xdashReal),
      // a cold token we asked the collector to build on demand (force=1) —
      // "warming" reads honestly vs the generic "unavailable".
      xdashWarming: !!(cgId && !xdashReal && xdashForce),
      // X Dash forensics still in flight (the dashboard token fetch is ~6s
      // cold). Consumers use this to hold a loading state instead of flashing a
      // false "no coverage" before the real forensics land.
      xdashPending: !!(cgId && xdashLoading && !xdashReal),
    }

    // 🪤 A LIVE row whose 24h telemetry is entirely zero is a dead feed, not
    // silence. X Dash serves one window and zeroes every *_24h metric outside
    // it, and /v1/social/mentions has been answering `mentions: 0, platforms: 0`
    // for every asset — which is how $BTC renders as "Mentions 24h 0 · Quiet ·
    // too little chatter", stating an outage as a fact about Bitcoin. Null the
    // telemetry so every consumer prints "—" and the verdict takes its
    // no-coverage branch instead of asserting quiet.
    const socialTelemetryDead =
      !(num(social.mentions24h) > 0)
      && !(num(social.uniqueAuthors) > 0)
      && !(num(social.engagement) > 0)
    if (socialTelemetryDead) {
      social.mentions24h = null
      social.uniqueAuthors = null
      social.engagement = null
      social.prevDailyAvg = null
      social.velocity = null
      social.novelty = null
      social.cleanSignal = null
      social.promoShare = null
      social.cashtagShare = null
      social.kolCount = null
      // fade/phase/signalScore all derive from the same zeroed row - drop the
      // X Dash claim so they resolve to null rather than a fabricated "quiet".
      social.hasXDash = false
      social.xdashDegraded = !!cgId
    }
    // Mindshare rides its own feed; a bare 0% with no rank is the same outage.
    if (!(num(social.mindsharePct) > 0) && num(social.mindshareRank) == null) {
      social.mindsharePct = null
    }

    /* Crowd sentiment — mindshare v2 (-1..1 -> 0..100) first; then the live-
       tape LLM classify (crowd-stance, same -1..1 scale + weighted split) for
       tokens v2 doesn't cover; then legacy 0-100/0-10. */
    const msSent = mindshare?.sentiment || null
    const v2Score = num(msSent?.score_24h)
    const fxScore = num(crowdFx?.score)
    const legacyScore = num(legacy?.score)
    // legacy /v1/sentiment scores are 0-100 (BTC prints 64); only the ancient
    // bridge shape used 0-10 — detect by magnitude, and always clamp.
    const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)))
    const crowdScore = v2Score != null
      ? clamp100(50 + 50 * Math.max(-1, Math.min(1, v2Score)))
      : fxScore != null
        ? clamp100(50 + 50 * Math.max(-1, Math.min(1, fxScore)))
        : legacyScore != null
          ? clamp100(legacyScore > 10 ? legacyScore : legacyScore * 10)
          : num(xbm.sentiment) != null
            ? clamp100(num(xbm.sentiment) * 10)
            : null
    const stance = {
      bullPct: num(msSent?.bull_pct) ?? num(crowdFx?.bull_pct) ?? num(legacy?.bullishPct),
      bearPct: num(msSent?.bear_pct) ?? num(crowdFx?.bear_pct) ?? num(legacy?.bearishPct),
      neutralPct: num(msSent?.neutral_pct) ?? num(crowdFx?.neutral_pct),
    }
    const crowdSource = v2Score != null ? 'mindshare-v2' : fxScore != null ? 'xdash-llm' : legacyScore != null ? 'legacy' : num(xbm.sentiment) != null ? 'x-bubbles' : null

    /* Signals */
    const change24h = market?.change24h ?? null
    const fade = social.hasXDash ? fadeSignalFromXDash(xdash, change24h, clusters?.breadth ?? null) : null
    const phase = social.hasXDash ? attentionPhaseFromXDash(xdash, change24h) : null
    // Signal score: full-fidelity from X Dash; renormalized degraded read from
    // the fallback feeds when the forensics pipe is down.
    const signalScore = social.hasXDash
      ? signalScoreFromXDash(xdash)
      : (social.mentions24h != null || social.uniqueAuthors != null)
        ? { ...computeSignalScore({
            mentions24h: social.mentions24h,
            uniqueAuthors24h: social.uniqueAuthors,
            velocityRatio: social.velocity,
            weightedEngagement: social.engagement,
          }), degraded: true }
        : null

    const verdict = composeVerdict({
      crowdScore,
      quality: signalScore?.score ?? null,
      fade,
      phase,
      change24h,
      mentions: social.mentions24h,
    })

    /* Momentum origin — since-tracked receipt.
       The data-api ledger row breaks in two ways we've verified live (ANSEM):
       a board RE-entry captured as "first" (entry $90.9M instead of the real
       $5.85M first catch), and last/peak frozen at entry because the upstream
       catalog mcap froze — which rendered "+0.0% · Now $166K" on a 55x runner.
       So: the ENTRY is the earliest recorded first-appearance across the
       ledger row and the X Dash momentum_entry (which carries corrected /
       reconstructed calls; client override map is authoritative on top), and
       ROI/peak are recomputed against the live market cap, never trusted from
       the ledger's frozen snapshot. */
    const xdEntryRaw = xdashReal ? (xdash?.momentum_entry || xdash?.token?.momentum_entry || null) : null
    const xdEntry = overrideMomentumEntry(cgId, xdEntryRaw)
    const entryCands = []
    if (origin && num(origin.entry_market_cap) != null) {
      entryCands.push({ at: origin.first_entered_at || null, mcap: num(origin.entry_market_cap), rank: num(origin.entry_rank) })
    }
    if (xdEntry && num(xdEntry.entry_market_cap) != null) {
      entryCands.push({ at: xdEntry.entered_at || xdEntry.generated_at || null, mcap: num(xdEntry.entry_market_cap), rank: num(xdEntry.entry_rank) })
    }
    entryCands.sort((a, b) =>
      (a.at ? new Date(a.at).getTime() : Infinity) - (b.at ? new Date(b.at).getTime() : Infinity))
    const entryPick = entryCands[0] || null
    let originOut = null
    if (entryPick) {
      const liveNow = num(market?.marketCap)
      const lastKnown = liveNow ?? num(origin?.last_market_cap)
      const peakMcap = Math.max(num(origin?.peak_market_cap) ?? 0, lastKnown ?? 0) || null
      const roiPct = entryPick.mcap > 0 && lastKnown != null
        ? ((lastKnown - entryPick.mcap) / entryPick.mcap) * 100
        : num(origin?.roi_pct)
      const peakRoiPct = entryPick.mcap > 0 && peakMcap != null
        ? ((peakMcap - entryPick.mcap) / entryPick.mcap) * 100
        : num(origin?.peak_roi_pct)
      originOut = {
        firstSeen: entryPick.at,
        entryMcap: entryPick.mcap,
        entryRank: entryPick.rank,
        peakMcap,
        peakAt: origin?.peak_at || null,
        lastMcap: lastKnown,
        roiPct,
        peakRoiPct,
      }
    }

    /* Sentiment time series for the chart (normalized). When the v2 history
       is empty, the crowd-stance classify's accumulated ring (retro-bucketed
       from real classified posts + one point per classification) feeds the
       chart instead — so a v2-uncovered runner still gets a crowd line. */
    const v2Series = (mindshareHistory || [])
      .map((r) => ({
        t: new Date(r.time).getTime(),
        score: num(r.sentiment_score_24h),
        bullPct: num(r.bull_pct),
        bearPct: num(r.bear_pct),
        weightedMentions: num(r.weighted_mentions_24h),
        mindshare: num(r.mindshare_pct_24h),
      }))
      .filter((r) => Number.isFinite(r.t))
    const series = v2Series.length
      ? v2Series
      : (Array.isArray(crowdFx?.history) ? crowdFx.history : [])
        .map((h) => ({
          t: num(h.t),
          score: num(h.score),
          bullPct: num(h.bull),
          bearPct: num(h.bear),
          weightedMentions: null,
          mindshare: null,
        }))
        .filter((r) => Number.isFinite(r.t) && r.score != null)

    /* Mention volume flow — x-bubbles 7d hourly history */
    const mentionFlow = Array.isArray(xBubbles?.history)
      ? xBubbles.history
        .map((h) => ({ t: new Date(h.time).getTime(), volume: num(h.volume) ?? 0 }))
        .filter((h) => Number.isFinite(h.t))
      : []

    /* Fundamentals — token unlock overhang + protocol TVL. Absent for
       memecoins (no vesting/protocol), which the card reads honestly. */
    const unlocksRaw = slices.unlocks
    let unlocks = null
    if (unlocksRaw?.summary) {
      const su = unlocksRaw.summary
      const next = su.nextUnlock || (Array.isArray(unlocksRaw.unlocks) ? unlocksRaw.unlocks.find((u) => u && !u.isCompleted && num(u.pctOfSupply) != null) : null)
      const totalEvents = num(su.totalEvents) || 0
      const upcoming = num(su.upcomingEvents) || 0
      if (totalEvents || next) {
        // The WHOLE remaining schedule, not just the next event. This shaped
        // only `next`, so the Fundamentals card could show one row of a
        // twelve-row vesting plan — the data was already in this payload and
        // we dropped it here (a beta user asked why there was so little to see
        // on 2026-09-01, and he was reading a card built from this object).
        const shape = (u) => ({
          date: u.unlockDate ? String(u.unlockDate).slice(0, 10) : null,
          pctOfSupply: num(u.pctOfSupply),
          amountUsd: num(u.amountUsd),
          amountTokens: num(u.amountTokens),
          amountUsdEstimated: !!u.amountUsdEstimated,
          category: u.category || u.beneficiary || null,
          type: u.type || null,
        })
        const source = Array.isArray(unlocksRaw.upcoming) ? unlocksRaw.upcoming
          : (Array.isArray(unlocksRaw.unlocks) ? unlocksRaw.unlocks.filter((u) => u && !u.isCompleted) : [])
        unlocks = {
          upcomingEvents: upcoming,
          totalUpcomingUsd: num(su.totalUpcomingUsd),
          totalUpcomingUsdEstimated: !!su.totalUpcomingUsdEstimated,
          totalUpcomingTokens: num(su.totalUpcomingTokens),
          totalUpcomingPctOfSupply: num(su.totalUpcomingPctOfSupply),
          lastUnlockDate: su.lastUnlockDate ? String(su.lastUnlockDate).slice(0, 10) : null,
          fullyUnlocked: totalEvents > 0 && upcoming === 0,
          schedule: source.slice(0, 24).map(shape),
          next: next ? shape(next) : null,
        }
      }
    }
    let tvl = null
    if (Array.isArray(slices.tvl) && slices.tvl.length >= 2) {
      const rowsAll = slices.tvl.filter((x) => x && (x.chain === 'all' || x.chain == null))
      const series = (rowsAll.length ? rowsAll : slices.tvl).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0))
      const nowT = num(series[series.length - 1]?.tvlUsd)
      if (nowT != null && nowT > 0) {
        const agoT = num(series[Math.max(0, series.length - 31)]?.tvlUsd)
        tvl = { tvlUsd: nowT, change30dPct: (agoT && agoT > 0) ? ((nowT - agoT) / agoT) * 100 : null }
      }
    }
    const fundamentals = (unlocks || tvl) ? { unlocks, tvl } : null

    return {
      loading: !coreSettled,
      market,
      social,
      crowd: {
        score: crowdScore,
        source: crowdSource,
        stance,
        label: legacy?.label || null,
        confidence: num(legacy?.confidence),
        // chart/gauge loading UX: the live-tape classify is in flight (cold
        // token, ~3-4s) — show "reading the crowd", not a false "no data".
        pending: crowdFxState === 'pending' && crowdScore == null,
        // the classify has settled with genuinely nothing to read (token is
        // socially quiet) — the empty state should say so, not "hasn't
        // accumulated yet".
        resolvedEmpty: crowdFxState === 'done' && crowdSource == null && !(mindshareHistory || []).length,
      },
      signals: { fade, phase, signalScore },
      verdict,
      origin: originOut,
      fundamentals,
      series,
      seriesHours: loadedHoursRef.current || historyHours,
      mentionFlow,
      tweets: Array.isArray(xBubbles?.tweets) ? xBubbles.tweets : [],
      requestRange,
    }
  }, [slices, xdash, xdashForce, xdashLoading, coreSettled, cgId, tokenData, crowdFxState, historyHours, requestRange])
}
