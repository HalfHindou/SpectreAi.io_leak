/**
 * AI Sentiment Read — per-token LLM synthesis for the RZ Sentiment tab.
 *
 * GET /api/sentiment-read?symbol=SPECTRE&cgId=spectre-ai
 *
 * House pattern (see market-snapshot.js header): every input is gathered
 * IN-PROCESS from real upstreams — X Dash dashboard API + Spectre Data API —
 * never by self-fetching our own /api routes (VERCEL_URL 302 / tier-gate 401
 * would feed the model "n/a" slop). Every fetcher degrades to null and the
 * prompt renders honest "n/a".
 *
 * Deterministic signals (fade / attention phase / signal score) are computed
 * server-side from the same engines the UI uses, then handed to the model as
 * ground truth — the LLM narrates and synthesizes, it does not re-score.
 *
 * Caching: KV (Upstash, in-memory fallback in dev) 20-min TTL per asset +
 * 60s generation lock against stampedes. Registered under intel-api (tier3,
 * gate-only) — fresh LLM burn is never reachable anonymously.
 */
import { chat } from '../llm-gateway.js'
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { rateLimit } from '../ratelimit.js'
import { crawlProject } from '../project-crawl.js'
import { fetchTeamTape } from '../team-tape.js'
import { classifyCrowdStance } from './crowd-stance.js'
import {
  fadeSignalFromXDash,
  attentionPhaseFromXDash,
  signalScoreFromXDash,
  computeAuthorClusters,
  CLUSTER_LABELS,
} from '../social-signals.js'

const DASHBOARD_API_BASE = (process.env.DASHBOARD_API_BASE_URL || process.env.X_DASH_BASE || 'http://5.78.199.87:8092').replace(/\/+$/, '')
const DASHBOARD_API_KEY = process.env.XDASH_API_TOKEN || process.env.DASHBOARD_API_KEY || process.env.X_DASH_API_KEY || ''
const DASHBOARD_HEADERS = DASHBOARD_API_KEY
  ? { Accept: 'application/json', Authorization: `Bearer ${DASHBOARD_API_KEY}`, 'X-API-Key': DASHBOARD_API_KEY }
  : { Accept: 'application/json' }

const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').trim().replace(/\/+$/, '')
const SPECTRE_HEADERS = {
  Accept: 'application/json',
  ...(process.env.SPECTRE_API_KEY ? { 'X-API-Key': process.env.SPECTRE_API_KEY.trim() } : {}),
}

const CACHE_TTL_S = 1200 // 20 min
const LOCK_TTL_S = 60

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const fmt = (v, digits = 1) => (v == null ? 'n/a' : Number(v).toFixed(digits))
const fmtUsd = (v) => {
  if (v == null) return 'n/a'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Number(v).toFixed(2)}`
}

async function safeJson(url, headers, timeoutMs = 10_000) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

/* Policy / macro-politics detector — headlines that move the whole tape
   (mirrors useNarrativeRadar on the client). */
const POLICY_RE = /\b(trump|tariff|white house|congress|senate|the sec|sec sues?|sec approv|sec chair|cftc|fed\b|fomc|rate (cut|hike|decision)|powell|treasury|sanction|election|regulat\w*|executive order|stablecoin (bill|act)|genius act|mica|lawsuit|etf (approval|inflow|outflow|launch)|spot etf|strategic reserve|debt ceiling|shutdown|inflation|cpi\b|nonfarm|geopolit)\b/i
const POLICY_CATEGORIES = new Set(['regulatory', 'regulation', 'policy', 'politics', 'government', 'macro', 'legal'])

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

const FILING_SPAM_RE = /\(filer\)\s*$|^(8-k|10-[kq]|s-\d|6-k|form\s)/i

function pickTape(newsRows, sym) {
  const tokenNews = []
  const policyNews = []
  const seen = new Set()
  for (const row of newsRows || []) {
    const title = decodeEntities(row?.title).trim()
    if (!title || seen.has(title)) continue
    seen.add(title)
    if (FILING_SPAM_RE.test(title) || /edgar/i.test(String(row.source || ''))) continue
    const assets = Array.isArray(row.relatedAssets) ? row.relatedAssets.map((a) => String(a).toUpperCase()) : []
    const category = String(row.category || '').toLowerCase()
    const entry = `${title}${row.source ? ` (${row.source}${category ? `, ${category}` : ''})` : ''}`
    if (assets.includes(sym) && tokenNews.length < 4) tokenNews.push(entry)
    else if ((POLICY_CATEGORIES.has(category) || POLICY_RE.test(title)) && policyNews.length < 4) policyNews.push(entry)
    if (tokenNews.length >= 4 && policyNews.length >= 4) break
  }
  return { tokenNews, policyNews }
}

function pickBrainForPrompt(state, sym) {
  if (!state) return null
  const touches = (assets) => Array.isArray(assets) && assets.some((a) => String(a).toUpperCase() === sym)
  const narratives = (Array.isArray(state.narratives) ? state.narratives : [])
    .filter((n) => touches(n.assets))
    .slice(0, 3)
    .map((n) => `${n.name} [${n.status}/${n.sentiment}]: ${n.summary || ''}`.trim())
  const conviction = state.conviction || {}
  const risks = (Array.isArray(conviction.risks) ? conviction.risks : [])
    .filter((r) => touches(r.assets))
    .slice(0, 3)
    .map((r) => `${r.title} [severity ${r.severity}, probability ${r.probability}]`)
  const catalysts = (Array.isArray(conviction.catalysts) ? conviction.catalysts : [])
    .filter((c) => touches(c.assets))
    .slice(0, 3)
    .map((c) => `${c.event} (${c.date || 'timing n/a'})`)
  if (!narratives.length && !risks.length && !catalysts.length) return null
  return { narratives, risks, catalysts }
}

function classify({ sym, rank, marketCap, categories }) {
  const cats = (categories || []).map((c) => String(c).toLowerCase())
  const isMeme = cats.some((c) => c.includes('meme'))
  if (sym === 'BTC') return { key: 'btc', isMeme }
  if (rank != null && rank <= 10) return { key: 'major', isMeme }
  if ((rank != null && rank <= 100) || (marketCap != null && marketCap >= 1e9)) return { key: 'large', isMeme }
  if (marketCap != null && marketCap >= 1e8) return { key: 'mid', isMeme }
  return { key: 'micro', isMeme }
}

// Resolve a ticker to its canonical CoinGecko slug (best-ranked exact-symbol
// match). Direct CoinGecko — never self-fetch our own /api (302/gate slop). Only
// hit when the direct keys miss. Cached per-process for the function lifetime.
const CG_API_BASE = (process.env.COINGECKO_API_KEY ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3')
const CG_HEADERS = process.env.COINGECKO_API_KEY ? { Accept: 'application/json', 'x-cg-pro-api-key': process.env.COINGECKO_API_KEY.trim() } : { Accept: 'application/json' }
const _slugCache = new Map()
async function resolveCgSlug(sym) {
  const key = String(sym || '').toUpperCase()
  if (!key) return null
  if (_slugCache.has(key)) return _slugCache.get(key)
  let slug = null
  const s = await safeJson(`${CG_API_BASE}/search?query=${encodeURIComponent(key)}`, CG_HEADERS, 8_000)
  const coins = Array.isArray(s?.coins) ? s.coins : []
  const exact = coins.filter((c) => String(c.symbol || '').toUpperCase() === key && c.id)
    .sort((a, b) => (Number.isFinite(a.market_cap_rank) ? a.market_cap_rank : Infinity) - (Number.isFinite(b.market_cap_rank) ? b.market_cap_rank : Infinity))
  slug = (exact[0] || coins[0])?.id || null
  _slugCache.set(key, slug)
  return slug
}

// Free project fundamentals from CoinGecko /coins/{id} — the investor spine the
// engine was missing. Sector, product links (site/docs/github), dev activity,
// community, ATH/ATL drawdown (asymmetry context), CG up-vote %. Direct CG,
// cached per-process. This is Phase 1 of the Sentiment Intelligence plan: read
// what a project publishes about itself before calling it bearish.
const _detailCache = new Map()
async function fetchCgDetail(cgId) {
  if (!cgId) return null
  if (_detailCache.has(cgId)) return _detailCache.get(cgId)
  const d = await safeJson(
    `${CG_API_BASE}/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sparkline=false`,
    CG_HEADERS, 10_000,
  )
  let project = null
  if (d && d.id) {
    const md = d.market_data || {}
    const dev = d.developer_data || {}
    const com = d.community_data || {}
    const links = d.links || {}
    const athUsd = num(md.ath?.usd)
    const priceUsd = num(md.current_price?.usd)
    const pctFromAth = num(md.ath_change_percentage?.usd)
    const desc = String(d.description?.en || '').replace(/\s+/g, ' ').trim().slice(0, 700)
    project = {
      name: d.name || null,
      categories: (Array.isArray(d.categories) ? d.categories : []).filter(Boolean).slice(0, 5),
      description: desc || null,
      website: (Array.isArray(links.homepage) ? links.homepage.find((u) => u) : null) || null,
      docs: links.whitepaper || null,
      github: (links.repos_url?.github || []).filter(Boolean)[0] || null,
      xHandle: links.twitter_screen_name || null,
      telegram: links.telegram_channel_identifier || null,
      // real-build signal — BUT all-zero from CG usually means CG isn't
      // indexing the repo (org-level link, private repos), NOT that nothing
      // ships. Seen live on $M87: CG served 0 commits/0 contributors for a
      // team posting product updates daily, and the read called it a vapor
      // flag. `tracked:false` = "unknown", never "zero".
      devActivity: (() => {
        const commits4w = num(dev.commit_count_4_weeks)
        const stars = num(dev.stars)
        const forks = num(dev.forks)
        const contributors = num(dev.pull_request_contributors)
        const tracked = [commits4w, stars, forks, contributors].some((v) => v != null && v > 0)
        return { tracked, commits4w, stars, forks, contributors }
      })(),
      community: {
        twitterFollowers: num(com.twitter_followers),
        telegramUsers: num(com.telegram_channel_user_count),
      },
      cgVotesUpPct: num(d.sentiment_votes_up_percentage),
      // asymmetry spine: a large drawdown from ATH is opportunity context for a
      // live project, NOT proof of death.
      athUsd, atlUsd: num(md.atl?.usd),
      pctFromAth,
      xFromAth: (athUsd && priceUsd && priceUsd > 0) ? +(athUsd / priceUsd).toFixed(1) : null,
      athDate: md.ath_date?.usd || null,
    }
  }
  _detailCache.set(cgId, project)
  return project
}

// Live market read by CONTRACT (DexScreener) — the identity-anchored check for
// on-chain tokens. /v1/prices is symbol-keyed and collides on shared tickers
// (seen live: $ANSEM returned "Ansem's minutes" $166K instead of The Black
// Bull $316M, and the desk read priced the wrong token). Highest-liquidity
// pair; prefer the larger plausible of marketCap/fdv (full-supply pump.fun
// tokens under-report circulating), reject glitched values via sanity ceiling.
const _dexCache = new Map()
const DEX_TTL_MS = 90 * 1000
async function fetchDexMarket(contract) {
  if (!contract) return null
  const key = String(contract).toLowerCase()
  const hit = _dexCache.get(key)
  if (hit && Date.now() - hit.ts < DEX_TTL_MS) return hit.data
  let out = null
  try {
    const j = await safeJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(contract)}`, { Accept: 'application/json' }, 8_000)
    const pairs = (j?.pairs || []).slice().sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0))
    const CEILING = 5e12
    for (const p of pairs) {
      const cand = [num(p.marketCap), num(p.fdv)].filter((v) => v != null && v > 0 && v < CEILING)
      if (!cand.length) continue
      out = {
        marketCap: Math.max(...cand),
        priceUsd: num(p.priceUsd),
        change24h: num(p.priceChange?.h24),
        change7d: null,
      }
      break
    }
  } catch { /* fall through null */ }
  _dexCache.set(key, { ts: Date.now(), data: out })
  return out
}

// The "since first tracked" receipt is keyed by the CoinGecko slug, but on-chain
// tokens surface late/absent cgIds or a near-miss slug — a single-key lookup
// wrongly reported proven runners as "never tracked". Try cgId, then symbol
// (the data-api matches on either), then the resolved canonical slug; first real
// receipt wins.
async function fetchMomentumOriginResolved(cgId, sym) {
  const tried = new Set()
  const tryKey = async (key) => {
    if (!key) return null
    const k = String(key).toLowerCase()
    if (tried.has(k)) return null
    tried.add(k)
    const r = await safeJson(`${SPECTRE_API_BASE}/v1/social/momentum-origin/${encodeURIComponent(k)}`, SPECTRE_HEADERS)
    return r?.data ? r : null
  }
  return (
    (await tryKey(cgId)) ||
    (await tryKey(sym)) ||
    (await tryKey(await resolveCgSlug(sym))) ||
    null
  )
}

// Token UNLOCK schedule (data-api /v1/unlocks) — real supply-overhang signal the
// engine was missing. Upcoming unlocks = future sell pressure; a fully-unlocked
// token (no upcoming) has no cliff overhang. Absent for memecoins (no vesting) —
// itself a signal. Returns null when there's no schedule.
async function fetchUnlocks(sym) {
  const r = await safeJson(`${SPECTRE_API_BASE}/v1/unlocks/${encodeURIComponent(sym)}`, SPECTRE_HEADERS, 7_000)
  const d = r?.data
  if (!d || !d.summary) return null
  const s = d.summary
  const next = s.nextUnlock || (Array.isArray(d.unlocks) ? d.unlocks.find((u) => u && !u.isCompleted && num(u.pctOfSupply) != null) : null)
  const totalEvents = num(s.totalEvents) || 0
  const upcoming = num(s.upcomingEvents) || 0
  if (!totalEvents && !next) return null

  // The WHOLE remaining schedule, not just the next event. This handler used
  // to return `next` alone, so the Fundamentals card could only ever show one
  // row of a twelve-row vesting schedule — a beta user (2026-09-01) asked why
  // "there isn't much info to see", and he was right: the data was here and we
  // threw it away one layer before the UI.
  const shape = (u) => ({
    date: u.unlockDate ? String(u.unlockDate).slice(0, 10) : null,
    pctOfSupply: num(u.pctOfSupply),
    amountUsd: num(u.amountUsd),
    amountTokens: num(u.amountTokens),
    amountUsdEstimated: !!u.amountUsdEstimated,
    category: u.category || u.beneficiary || null,
    type: u.type || null,
  })
  const source = Array.isArray(d.upcoming) ? d.upcoming
    : (Array.isArray(d.unlocks) ? d.unlocks.filter((u) => u && !u.isCompleted) : [])
  const schedule = source.slice(0, 24).map(shape)

  return {
    upcomingEvents: upcoming,
    totalUpcomingUsd: num(s.totalUpcomingUsd),
    totalUpcomingUsdEstimated: !!s.totalUpcomingUsdEstimated,
    totalUpcomingTokens: num(s.totalUpcomingTokens),
    totalUpcomingPctOfSupply: num(s.totalUpcomingPctOfSupply),
    lastUnlockDate: s.lastUnlockDate ? String(s.lastUnlockDate).slice(0, 10) : null,
    spotPrice: num(s.spotPrice),
    fullyUnlocked: totalEvents > 0 && upcoming === 0,
    schedule,
    next: next ? shape(next) : null,
  }
}

// DeFiLlama TVL trend (data-api /v1/defi/protocol/:slug) — protocol
// health/adoption. cgId usually matches the DeFiLlama slug; a 404 means it's
// not a DeFi protocol (fine — no TVL). Returns { tvlUsd, change30dPct } or null.
async function fetchTvl(cgId) {
  if (!cgId) return null
  const r = await safeJson(`${SPECTRE_API_BASE}/v1/defi/protocol/${encodeURIComponent(cgId)}`, SPECTRE_HEADERS, 7_000)
  const rows = Array.isArray(r?.data) ? r.data.filter((x) => x && (x.chain === 'all' || x.chain == null)) : []
  const series = (rows.length ? rows : (Array.isArray(r?.data) ? r.data : [])).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0))
  if (series.length < 2) return null
  const now = num(series[series.length - 1].tvlUsd)
  if (now == null || now <= 0) return null
  const agoIdx = Math.max(0, series.length - 31)
  const ago = num(series[agoIdx].tvlUsd)
  return { tvlUsd: now, change30dPct: (ago && ago > 0) ? ((now - ago) / ago) * 100 : null }
}

// RECENT PRICE STRUCTURE — the tape people actually rebid. "-97% from ATH" is
// the OVERALL drawdown; traders also read the recent days/weeks: fresh 30d
// lows still bleeding vs basing above a reclaimed low vs already rebounding
// (Sunny 2026-07-13: "ppl also look to rebid lows — we need overall timeframe
// AND recent days/weeks vibe"). One cached CG market_chart call per token.
const _structCache = new Map()
async function fetchPriceStructure(cgId) {
  if (!cgId) return null
  if (_structCache.has(cgId)) return _structCache.get(cgId)
  const j = await safeJson(
    `${CG_API_BASE}/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=30&interval=daily`,
    CG_HEADERS, 8_000,
  )
  let out = null
  const pts = (Array.isArray(j?.prices) ? j.prices : [])
    .map(([t, p]) => ({ t: num(t), p: num(p) }))
    .filter((x) => x.t != null && x.p != null && x.p > 0)
  if (pts.length >= 8) {
    const now = pts[pts.length - 1]
    let lo = pts[0]
    let hi = pts[0]
    for (const x of pts) { if (x.p < lo.p) lo = x; if (x.p > hi.p) hi = x }
    const daysSinceLow = Math.max(0, Math.round((now.t - lo.t) / 86_400_000))
    const pctAboveLow = ((now.p - lo.p) / lo.p) * 100
    const pctBelowHigh = ((now.p - hi.p) / hi.p) * 100
    const shapeKey = (daysSinceLow <= 3 && pctAboveLow <= 3) ? 'fresh-lows'
      : pctAboveLow >= 25 ? 'rebounding'
        : pctAboveLow >= 8 ? 'basing'
          : 'at-lows'
    const shape = shapeKey === 'fresh-lows'
      ? 'FRESH LOWS — set the 30d low within the last 3 days and still sits on it (knife, no base yet)'
      : shapeKey === 'rebounding' ? `REBOUNDING — +${pctAboveLow.toFixed(0)}% off the 30d low set ${daysSinceLow}d ago`
        : shapeKey === 'basing' ? `BASING — holding +${pctAboveLow.toFixed(0)}% above the 30d low set ${daysSinceLow}d ago`
          : `AT THE LOWS — within ${Math.max(1, Math.round(pctAboveLow))}% of the 30d low set ${daysSinceLow}d ago (a rebid zone IF it holds, a breakdown if it does not)`
    out = { low30: lo.p, high30: hi.p, pctAboveLow30: pctAboveLow, pctBelowHigh30: pctBelowHigh, daysSinceLow30: daysSinceLow, shapeKey, shape }
  }
  _structCache.set(cgId, out)
  return out
}

// TEAM TAPE — the project's OWN X account posts (the same Cloud Run backend
// the RZ Tweets rail reads). This is the shipping/communication signal the
// engine was missing: X Dash counts EXTERNAL mentions only, so an active team
// on a quiet token read as "no activity" ($M87: 25 own posts, engine saw 1
// external mention). Dates arrive as relative strings ("4 hours ago").
// Team tape transport lives in the shared module (box x-timeline lane first,
// legacy Cloud Run fallback, { unavailable: true } when every transport is
// dead — the model must treat that as unknown, never as silence).
// see ../team-tape.js

// TELEGRAM TAPE — classified channel messages from the data-api mtproto
// pipeline (/v1/social/telegram, added 2026-07-13). Coverage is the tracked-
// channel universe; `covered:false` degrades to null (honest absence).
async function fetchTelegramTape(sym) {
  const r = await safeJson(`${SPECTRE_API_BASE}/v1/social/telegram/${encodeURIComponent(sym)}`, SPECTRE_HEADERS, 6_000)
  const d = r?.data
  if (!d || !d.covered) return null
  return {
    messages24h: num(d.totals?.messages_24h),
    messages7d: num(d.totals?.messages_7d),
    newestAt: d.totals?.newest_at || null,
    bySentiment: Array.isArray(d.by_sentiment) ? d.by_sentiment : [],
    latest: (Array.isArray(d.latest) ? d.latest : []).slice(0, 3).map((m) => ({
      at: m.posted_at ? String(m.posted_at).slice(0, 10) : null,
      channel: m.channel || null,
      sentiment: m.sentiment || null,
      summary: String(m.summary || '').slice(0, 160),
    })),
  }
}

// SPECTRE BRAIN per-asset dossier (/v1/brain/dossier/:asset/full) — the
// engine's own market brain: KOL mention flow, narratives, spectre score.
// brain_brief is already honesty-guarded server-side (null when it was
// generated with zero sources — it used to hallucinate).
async function fetchBrainDossier(sym) {
  const r = await safeJson(`${SPECTRE_API_BASE}/v1/brain/dossier/${encodeURIComponent(sym)}/full`, SPECTRE_HEADERS, 8_000)
  const d = r?.data
  if (!d) return null
  const brief = (d.brain_brief && num(d.brain_brief.source_count) > 0) ? d.brain_brief : null
  const narratives = (Array.isArray(d.narratives) ? d.narratives : []).slice(0, 3)
    .map((n) => (typeof n === 'string' ? n : `${n.name || n.title || ''}${n.summary ? `: ${n.summary}` : ''}`.trim()))
    .filter(Boolean)
  const out = {
    conviction: brief?.conviction || null,
    bull: brief?.bull_case || null,
    bear: brief?.bear_case || null,
    kolMentions24h: num(d.kol_mentions_24h),
    spectreScore: num(d.spectre_score?.score ?? d.spectre_score),
    narratives,
  }
  if (out.bull == null && out.bear == null && out.kolMentions24h == null && out.spectreScore == null && !narratives.length) return null
  return out
}

export async function gatherSentimentSnapshot(symbol, cgId) {
  const sym = String(symbol || '').toUpperCase()
  // Canonical CG id — on-chain tokens surface a null/near-miss cgId, but we can
  // still resolve the slug from the symbol to unlock the free fundamentals +
  // dashboard coverage. Falls back gracefully to the raw cgId.
  const canonicalCgId = cgId || (await resolveCgSlug(sym))

  const [xdashToken, xdashIntel, mindshare, mentions, origin, xbubbles, pricesRes, dominance, altSeason, fearGreed, project] = await Promise.all([
    canonicalCgId ? safeJson(`${DASHBOARD_API_BASE}/api/token/${encodeURIComponent(canonicalCgId)}?per_page=10`, DASHBOARD_HEADERS, 12_000) : null,
    canonicalCgId ? safeJson(`${DASHBOARD_API_BASE}/api/intel/token/${encodeURIComponent(canonicalCgId)}`, DASHBOARD_HEADERS) : null,
    safeJson(`${SPECTRE_API_BASE}/v1/social/mindshare/v2/${encodeURIComponent(sym)}`, SPECTRE_HEADERS),
    safeJson(`${SPECTRE_API_BASE}/v1/social/mentions/${encodeURIComponent(sym)}?since=1440&limit=3`, SPECTRE_HEADERS),
    fetchMomentumOriginResolved(canonicalCgId, sym),
    safeJson(`${SPECTRE_API_BASE}/v1/social/x-bubbles/${encodeURIComponent(sym)}`, SPECTRE_HEADERS),
    safeJson(`${SPECTRE_API_BASE}/v1/prices?symbols=${encodeURIComponent(sym)}`, SPECTRE_HEADERS),
    safeJson(`${SPECTRE_API_BASE}/v1/market/dominance`, SPECTRE_HEADERS),
    safeJson(`${SPECTRE_API_BASE}/v1/market/alt-season`, SPECTRE_HEADERS),
    safeJson(`${SPECTRE_API_BASE}/v1/market/fear-greed`, SPECTRE_HEADERS),
    fetchCgDetail(canonicalCgId),
  ])
  // The tape + Brain layer + the website/docs crawl — separate round so a slow
  // feed can't stall the market/social gather above. The crawl needs the CG
  // detail's site/docs links, so it runs here (24h-cached in KV, so only the
  // first read per token per day pays it).
  const [newsRes, brainRes, siteCrawl, unlocks, tvl, teamTape, tgTape, brainDossier] = await Promise.all([
    safeJson(`${SPECTRE_API_BASE}/v1/news?limit=40`, SPECTRE_HEADERS),
    safeJson(`${SPECTRE_API_BASE}/v1/brain`, SPECTRE_HEADERS, 8_000),
    (project && (project.website || project.docs))
      ? crawlProject({ cgId: canonicalCgId, website: project.website, docs: project.docs }).catch(() => null)
      : Promise.resolve(null),
    fetchUnlocks(sym).catch(() => null),
    fetchTvl(canonicalCgId).catch(() => null),
    fetchTeamTape(project?.xHandle).catch(() => null),
    fetchTelegramTape(sym).catch(() => null),
    fetchBrainDossier(sym).catch(() => null),
  ])
  const priceStructure = await fetchPriceStructure(canonicalCgId).catch(() => null)

  const xb = xbubbles?.data || xbubbles || null
  const ms = mindshare?.data || null
  const men = mentions?.data || mentions || null
  const org = origin?.data || null

  /* SYMBOL-COLLISION GUARD. /v1/prices is symbol-keyed; on shared tickers it
     can return a different token entirely (live case: $ANSEM → "Ansem's
     minutes" $166K instead of The Black Bull $316M — the desk read then
     framed a 55x runner as a $166K nano cap moving +285%). The X Dash catalog
     contract is the identity anchor: when the symbol row's contract is a
     different address, or its mcap is an order of magnitude off DexScreener's
     read of the REAL contract, drop the row and price from DexScreener. */
  const contract = xdashToken?.token?.contract_address || null
  const dex = contract ? await fetchDexMarket(contract) : null
  let px = pricesRes?.data?.[sym] || null
  if (px && contract && px.contract && String(px.contract).toLowerCase() !== String(contract).toLowerCase()) {
    px = null
  } else if (px && dex?.marketCap != null && num(px.market_cap) != null
    && (dex.marketCap / px.market_cap > 8 || px.market_cap / dex.marketCap > 8)) {
    px = null
  }

  const change24h = num(px?.change?.['24h']) ?? num(dex?.change24h)
  const marketCap = num(px?.market_cap) ?? num(dex?.marketCap) ?? num(ms?.market_cap_usd)
  const rank = num(px?.rank) ?? num(xb?.rank)
  const categories = (Array.isArray(xb?.categories) && xb.categories.length ? xb.categories : (project?.categories || []))

  const xdClusters = xdashToken ? computeAuthorClusters(xdashToken?.top_authors || xdashToken?.token?.top_authors) : null
  const fade = xdashToken ? fadeSignalFromXDash(xdashToken, change24h, xdClusters?.breadth ?? null) : null
  const phase = xdashToken ? attentionPhaseFromXDash(xdashToken, change24h) : null
  const quality = xdashToken ? signalScoreFromXDash(xdashToken) : null

  const cls = classify({ sym, rank, marketCap, categories })

  /* Crowd fallback — when mindshare_v2 has no classified row for the token
     (loud on-chain runners), classify the live X tape instead of handing the
     model "n/a — no classified-post coverage" for a token with 800+ daily
     mentions. KV-cached; shares one classification with /api/crowd-stance. */
  const crowdFx = (num(ms?.sentiment?.score_24h) == null && canonicalCgId)
    ? await classifyCrowdStance(sym, canonicalCgId).catch(() => null)
    : null

  // Notable external callers — the KOLs actually driving the chatter. This is
  // the signal a loud on-chain token DOES have when the classified crowd split
  // is empty, so the desk read can name who is behind the attention instead of
  // defaulting to "lacks data". Verified or >=50k-follower, non-self.
  const xTopAuthors = Array.isArray(xdashToken?.top_authors || xdashToken?.token?.top_authors)
    ? (xdashToken.top_authors || xdashToken.token.top_authors) : []
  // "Who is behind the attention" = the highest-REACH credible accounts, not the
  // highest raw engagement — sorting by engagement alone surfaces giveaway/spam
  // accounts (a 8k "@ansem" giveaway) and buries the mega-KOLs actually lending
  // credibility (CryptoGodJohn 901k, orangie 353k, Darky1k 463k). Blend reach x
  // engagement so a genuine large KOL who posted meaningfully ranks first.
  const kolScore = (a) => (num(a.followers_count) || 0) * (1 + Math.log10(1 + (num(a.total_weighted_engagement) || 0)))
  const kols = xTopAuthors
    .filter((a) => a && !a.is_self_author && (a.is_blue_verified || a.legacy_verified || num(a.followers_count) >= 50_000))
    .sort((a, b) => kolScore(b) - kolScore(a))
    .slice(0, 5)
    .map((a) => ({ handle: a.screen_name, followers: num(a.followers_count), verified: !!(a.is_blue_verified || a.legacy_verified) }))

  // Cross-cluster breadth (aixbt-inspired) — which community archetypes are
  // discussing this. Broad = organic conviction, single-cluster = echo pocket.
  const clusters = computeAuthorClusters(xTopAuthors)

  return {
    sym,
    cgId: canonicalCgId || null,
    cls,
    kols,
    clusters,
    project,
    siteCrawl,
    unlocks,
    tvl,
    teamTape,
    tgTape,
    brainDossier,
    priceStructure,
    market: {
      price: num(px?.price) ?? num(dex?.priceUsd),
      change24h,
      change7d: num(px?.change?.['7d']),
      marketCap,
      rank,
      categories: categories.slice(0, 4),
    },
    social: (() => {
      const m = xdashToken?.token?.metrics || xdashToken?.metrics || {}
      const q = xdashToken?.token?.quality || xdashToken?.quality || {}
      const xbm = xb?.metrics || {}
      return {
        mentions24h: num(m.external_mentions_24h ?? m.mentions_24h) ?? num(xbm.mentions_24h),
        prevDailyAvg: num(m.external_mentions_prev_daily_avg) ?? num(xbm.mentions_7d_avg),
        uniqueAuthors: num(m.unique_external_authors_24h ?? m.unique_authors) ?? num(ms?.unique_authors_24h),
        engagement: num(m.total_weighted_engagement),
        velocity: num(m.velocity_ratio) ?? (num(xbm.mentions_24h) != null && num(xbm.mentions_7d_avg) > 0 ? xbm.mentions_24h / xbm.mentions_7d_avg : null),
        novelty: num(m.novelty_ratio),
        cleanSignal: num(q.clean_signal_score_24h),
        promoShare: num(q.promo_share_24h),
        cashtagShare: num(q.cashtag_only_share_24h ?? q.cashtag_signal_share_24h),
        qualityStatus: q.quality_status || null,
        qualityReasons: Array.isArray(q.quality_reasons) ? q.quality_reasons : [],
      }
    })(),
    crowd: num(ms?.sentiment?.score_24h) != null ? {
      score: num(ms.sentiment?.score_24h),
      bullPct: num(ms.sentiment?.bull_pct),
      bearPct: num(ms.sentiment?.bear_pct),
      neutralPct: num(ms.sentiment?.neutral_pct),
      mindsharePct: num(ms.mindshare?.pct_24h),
      mindshareRank: num(ms.mindshare?.rank_24h),
    } : crowdFx ? {
      score: num(crowdFx.score),
      bullPct: num(crowdFx.bull_pct),
      bearPct: num(crowdFx.bear_pct),
      neutralPct: num(crowdFx.neutral_pct),
      mindsharePct: num(ms?.mindshare?.pct_24h),
      mindshareRank: num(ms?.mindshare?.rank_24h),
    } : null,
    mentionsBreakdown: men ? {
      bySentiment: men.by_sentiment || null,
      byRole: men.by_role || null,
      teamVoice: men.team_voice || null,
      totals: men.totals || null,
    } : null,
    /* Since-tracked receipt — earliest recorded first-appearance wins between
       the data-api ledger row and the X Dash momentum_entry (which carries
       corrected/reconstructed calls the ledger missed — ANSEM's real $5.85M
       first catch vs the ledger's $90.9M re-entry), and ROI is recomputed
       against the LIVE market cap, never the ledger's frozen snapshot
       (which printed "+0.0%" on a 55x runner). */
    origin: (() => {
      const xdEntry = xdashToken?.momentum_entry || xdashToken?.token?.momentum_entry || null
      const cands = []
      if (org && num(org.entry_market_cap) != null) {
        cands.push({ at: org.first_entered_at || null, mcap: num(org.entry_market_cap) })
      }
      if (xdEntry && num(xdEntry.entry_market_cap) != null) {
        cands.push({ at: xdEntry.entered_at || xdEntry.generated_at || null, mcap: num(xdEntry.entry_market_cap) })
      }
      cands.sort((a, b) => (a.at ? new Date(a.at).getTime() : Infinity) - (b.at ? new Date(b.at).getTime() : Infinity))
      const pick = cands[0]
      if (!pick) return null
      const lastKnown = marketCap ?? num(org?.last_market_cap)
      const peakMc = Math.max(num(org?.peak_market_cap) ?? 0, lastKnown ?? 0) || null
      return {
        firstSeen: pick.at,
        entryMcap: pick.mcap,
        roiPct: pick.mcap > 0 && lastKnown != null ? ((lastKnown - pick.mcap) / pick.mcap) * 100 : num(org?.roi_pct),
        peakRoiPct: pick.mcap > 0 && peakMc != null ? ((peakMc - pick.mcap) / pick.mcap) * 100 : num(org?.peak_roi_pct),
      }
    })(),
    signals: { fade, phase, quality },
    macro: {
      btcDominance: num(dominance?.data?.btc),
      altSeason: num(altSeason?.data?.index ?? altSeason?.data?.value),
      fearGreed: num(fearGreed?.data?.current?.value),
      fearGreedLabel: fearGreed?.data?.current?.classification || null,
    },
    tape: pickTape(Array.isArray(newsRes?.data) ? newsRes.data : [], sym),
    brain: pickBrainForPrompt(brainRes?.data?.state || brainRes?.state || null, sym),
    state: xdashIntel?.current_state || null,
  }
}

const CLASS_FRAME = {
  btc: 'BTC is the macro anchor: frame the read against risk appetite (Fear & Greed, dominance as capital flow), not against alt behavior.',
  major: 'A top-10 major: trades as high-beta BTC. Frame against BTC dominance rotation and whether alt breadth supports it.',
  large: 'A large cap alt: needs the alt tide. Frame against alt-season breadth and dominance trend as headwind/tailwind.',
  mid: 'A mid cap alt: needs the alt tide plus its own catalyst. Frame against breadth and attention quality.',
  micro: 'A microcap: liquidity reaches it LAST, after BTC/majors/mids have run. Attention flow leads price here more than macro; the OTHERS market share and alt breadth are its tide. Treat spikes with extra skepticism.',
}

const SYSTEM_PROMPT = `You are the senior analyst at Spectre's research desk — you read like a sharp crypto INVESTOR, not a momentum bot. You are given a verified data sheet for ONE token: PROJECT FUNDAMENTALS (what it builds, product stage, dev activity, links, community), crowd sentiment (LLM-classified, author-weighted), X/social telemetry, chatter-quality forensics, deterministic signal engines, the since-tracked receipt, ATH/asymmetry context, and macro. Write the read an investor deciding whether this is worth a closer look would want.

HARD RULES:
- Sentence 1 of "thesis" IS the standalone takeaway. Max 220 characters. The UI renders it as a pull quote.
- Use ONLY the numbers/facts on the sheet. "n/a" means unavailable — say so or skip it. NEVER invent a number, price level, partnership, backer, or event.
- FUNDAMENTALS GROUND THE READ. Weigh WHAT THE PROJECT IS — sector, product stage, dev activity, community, traction — BEFORE any momentum call. A token is NOT bearish merely because it is small or down. A live product with real activity (commits, docs, a growing community) in a drawdown is an ACCUMULATION setup; a no-product token pumping on promo is DISTRIBUTION. Judge the project first, then the tape.
- ASYMMETRY IS TWO TIMEFRAMES: the drawdown from ATH is the OVERALL story (opportunity context, not proof of death); the RECENT PRICE STRUCTURE (30d range, distance off the recent low, fresh-lows vs basing vs rebounding) is the TIMING story — people rebid lows, so say where price sits in the recent range and whether the low is holding. Never quote only the ATH drawdown when the recent structure is on the sheet.
- LISTINGS ARE NOT BACKING. A CEX listing (Bitget, MEXC, Binance, etc.) or a data-aggregator presence (CoinGecko, CMC) is a LIQUIDITY / legitimacy signal, never a backer, investor, endorsement, or partnership — every token is listed and aggregated somewhere. Do not present a listing as investment backing or as bullish validation.
- NO PUBLIC GITHUB IS NOT NO DEVELOPMENT. GitHub stats marked "not indexed" or "unknown" are MISSING DATA — never evidence of inactivity, and never a vapor flag; many live teams ship closed-source. An idle PUBLIC repo is the same class: it tells you about that one repo, never about the team. Only call a project inactive when its TEAM TAPE (own posts), site crawl AND community are ALL silent or stale. An active team tape (regular product posts, listings, recaps) IS shipping evidence — weigh it like dev activity.
- ABSENCE OF DATA IS NEVER A FINDING. A metric the sheet marks n/a, unknown, not tracked, or unavailable may only be described as "not tracked"/"unknown" — or skipped. NEVER render missing data as a negative fact: no "unknown team", no "no public X following", no "no community", no "minimal development activity", no "anonymous". Those claims require POSITIVE evidence of absence (a tape that exists and is silent), not a gap in the sheet.
- NEVER say the token "lacks data" or has "no read" when crowd sentiment is n/a. Read the room from the FUNDAMENTALS, X telemetry, chatter forensics, NOTABLE CALLERS and the SINCE FIRST TRACKED receipt. Only call coverage genuinely absent when fundamentals AND mentions AND callers AND receipt are ALL n/a.
- ASSOCIATED FIGURE (memecoins live and die by this): if the token is named after, created by, endorsed by, or actively led by a specific known public figure or crypto KOL — check the token NAME/SYMBOL against the NOTABLE CALLERS and the project's own account — NAME that person explicitly and make their involvement central to the read. Who is behind it, are they actively promoting it right now (are they in the callers?), what is their track record and reputation, do they hold/control supply, have they delivered or extracted before. A token named after a prominent trader who is personally leading its promotion is a fundamentally different bet than an anon memecoin — say who it is and weigh them. Do NOT refer to them generically as "the founder"/"an insider" when the data lets you name them, and do NOT invent an association the callers/name don't support.
- SUPPLY & PROTOCOL FUNDAMENTALS: when a SUPPLY & PROTOCOL line is present, weigh it in the investor take. An imminent large token unlock (a big % of supply) is concrete future SELL PRESSURE — name the date and size and treat it as overhang; a FULLY-UNLOCKED fair-supply token has removed that bear thesis (a structural positive). Rising protocol TVL is real adoption/usage (a fundamental bull point beyond price); falling TVL is capital leaving. These are hard facts — surface them over vibes. For a pure memecoin they are absent, which itself confirms "pure supply/attention play, no protocol or vesting to anchor value".
- NUMBER DISCIPLINE: two /100 metrics differ — CROWD SENTIMENT (how bullish the crowd is) vs CHATTER QUALITY (how organic the chatter is). Name which you cite, always as N/100.
- DISTRESS IS NOT BULLISH: loud attention on a dumping/quarantined/promo token is exit flow, not surging interest.
- The deterministic signals (fade, attention phase, quality score) are ground truth — narrate and connect them, do not re-score.
- Crowd euphoria is a RISK, not a buy. Extreme fear can precede reversals but needs price confirmation — say what confirmation looks like.
- No price predictions. Frame in probabilities, catalysts and invalidations ("what would change this read").
- Policy/macro tape + Spectre Brain are context, not token facts; weigh by class — drives BTC/majors, background for microcaps unless a headline names the token.
- Voice: dry, precise, investor-to-investor. BANNED: "buckle up", "moon", "explosive", "massive", "game-changer", "revolutionary", exclamation marks, emojis, hedging filler ("it's important to note").

Respond with STRICT JSON, no markdown fences:
{
  "thesis": "string, 1-2 sentences, sentence 1 <= 220 chars — the investor takeaway, grounded in the fundamentals first",
  "project_read": "string, 2-3 sentences: what the project actually is, its product stage, and whether it is shipping (dev activity, community). The fundamental spine. Use n/a ONLY if there is truly no project data.",
  "crowd_read": "string, 2-3 sentences on what the crowd is doing and how positioned it is",
  "quality_read": "string, 1-2 sentences: organic vs manufactured, citing the forensics numbers",
  "divergence_read": "string, 1-2 sentences: is sentiment confirming price or diverging, and which usually leads for this class",
  "investor_take": "string, 2-3 sentences: the bull case vs the bear case and the ASYMMETRY (distance from ATH, catch-up vs fade). The 'would I look closer' verdict.",
  "macro_read": "string, 1-2 sentences applying the class frame to the macro numbers",
  "risk_flags": ["max 4 short strings, each a concrete risk grounded in the sheet"],
  "watch_for": ["max 3 short strings, each a concrete observable catalyst/trigger that would change the read"],
  "stance": "bullish" | "bearish" | "neutral" | "cautious",
  "conviction": 0-100
}`

// Pre-interpret the -1..+1 crowd score. Without this the model routinely
// misreads the sign (called +0.27 "bearish" in testing) — the label is handed
// to it as ground truth.
function crowdLabel(score) {
  if (score >= 0.4) return 'clearly bullish'
  if (score >= 0.15) return 'mildly bullish'
  if (score > -0.15) return 'neutral'
  if (score > -0.4) return 'mildly bearish'
  return 'clearly bearish'
}

function buildUserContent(s) {
  const soc = s.social
  const cr = s.crowd
  const sig = s.signals
  const lines = [
    `TOKEN: $${s.sym}${s.cgId ? ` (${s.cgId})` : ''} — class: ${s.cls.key}${s.cls.isMeme ? ' / memecoin' : ''}`,
    `CLASS FRAME: ${CLASS_FRAME[s.cls.key] || CLASS_FRAME.mid}`,
    '',
    'MARKET:',
    `  price ${s.market.price != null ? fmtUsd(s.market.price) : 'n/a'} · 24h ${fmt(s.market.change24h)}% · 7d ${fmt(s.market.change7d)}% · mcap ${fmtUsd(s.market.marketCap)} · rank ${s.market.rank ?? 'n/a'}`,
    s.market.categories.length ? `  categories: ${s.market.categories.join(', ')}` : null,
    '',
    (() => {
      const p = s.project
      if (!p) return null
      const links = [p.website && 'website', p.docs && 'docs', p.github && 'github'].filter(Boolean)
      const dev = p.devActivity || {}
      const com = p.community || {}
      return [
        'PROJECT FUNDAMENTALS (what it IS — weigh this BEFORE the tape):',
        `  ${p.name || s.sym}${p.categories?.length ? ` · sector: ${p.categories.join(', ')}` : ''}`,
        p.description ? `  what it does: ${p.description}` : null,
        `  presence: ${links.length ? links.join(' + ') : 'no public site/docs/repo'}${p.xHandle ? ` · @${p.xHandle}` : ''}`,
        dev.tracked
          ? `  build signal (GitHub, CG-indexed): ${dev.commits4w ?? 0} commits/4wk · ${dev.stars ?? 0} stars · ${dev.contributors ?? 0} contributors`
          : p.github
            ? '  build signal: GitHub stats NOT INDEXED by CoinGecko (org-level link) — UNKNOWN, not zero. NEVER cite "0 commits/0 contributors" or call this a vapor/inactivity flag; judge shipping from the site crawl and the TEAM TAPE below.'
            : '  build signal: no public repo linked — closed-source is common and is NOT an inactivity flag; judge shipping from the site/docs and the TEAM TAPE below.',
        `  community: ${com.twitterFollowers != null ? `${Math.round(com.twitterFollowers / 1000)}K X followers` : 'X followers NOT TRACKED by CG (unknown, NOT zero — never write "no X following")'}${com.telegramUsers != null ? ` · ${com.telegramUsers} TG` : ''}${p.cgVotesUpPct != null ? ` · CG community ${Math.round(p.cgVotesUpPct)}% up-voted` : ''}`,
      ].filter(Boolean).join('\n')
    })(),
    (() => {
      const c = s.siteCrawl
      if (!c) return null
      return [
        "CRAWLED FROM THE PROJECT'S OWN SITE + DOCS (primary source — trust over the CG blurb; still skeptical of marketing):",
        c.whatItDoes ? `  what it does: ${c.whatItDoes}` : null,
        `  product stage: ${c.productStage} · shipping evidence: ${c.evidenceOfShipping || 'unclear'} · team: ${
          c.team === 'unknown' ? 'not stated on the site (common — NOT an anon/unknown-team flag; never write "unknown team" from this)' : c.team
        }`,
        c.differentiator ? `  edge/moat: ${c.differentiator}` : null,
        c.backers.length ? `  named backers/investors: ${c.backers.join(', ')}` : null,
        c.exchanges?.length ? `  listed on: ${c.exchanges.join(', ')} (CEX listing = liquidity/vetting signal, NOT a backer or endorsement)` : null,
        c.traction.length ? `  stated traction: ${c.traction.join(' · ')}` : null,
        c.roadmapNext ? `  next milestone: ${c.roadmapNext}` : null,
        c.build
          ? c.build.active
            ? `  REAL BUILD SIGNAL (public GitHub ${c.build.repo}): last push ${c.build.lastPushDays != null ? c.build.lastPushDays + 'd ago' : 'n/a'} · ${c.build.stars} stars · ACTIVELY developed — this OVERRIDES the CG dev-activity above (CG showed 0 only for lack of the repo link)`
            : `  public GitHub (${c.build.repo}): newest PUBLIC push ${c.build.lastPushDays != null ? c.build.lastPushDays + 'd ago' : 'n/a'} · ${c.build.stars} stars — an idle PUBLIC repo is NOT team inactivity (many teams ship in private repos or off-GitHub). NEVER cite this number as "minimal development" or "inactive for ${c.build.lastPushDays != null ? c.build.lastPushDays + ' days' : 'N days'}"; judge shipping from the TEAM TAPE and site crawl. If the TEAM TAPE shows regular posting, the team is demonstrably active.`
          : null,
      ].filter(Boolean).join('\n')
    })(),
    (() => {
      const tt = s.teamTape
      if (!tt) return null
      if (tt.unavailable) {
        return `TEAM TAPE: the feed for @${tt.handle} is UNAVAILABLE right now (source down) — the team's X activity is UNKNOWN, not absent. NEVER describe the team as silent, unknown, or inactive from this; do not mention X activity at all unless another line carries it.`
      }
      const cadence = tt.posts24h >= 1 ? 'posting DAILY' : tt.posts7d >= 3 ? 'posting regularly this week' : tt.posts7d >= 1 ? 'posting occasionally' : 'quiet for over a week'
      return [
        `TEAM TAPE (the project's OWN X account @${tt.handle} — this is the shipping/communication signal; weigh it like dev activity):`,
        `  ${tt.posts24h} posts 24h · ${tt.posts7d} posts 7d · newest ${tt.newestAgeHours != null ? `${Math.round(tt.newestAgeHours * 10) / 10}h ago` : 'n/a'} — team is ${cadence}`,
        ...tt.sample.map((t) => `  - [${t.age || 'recent'}] ${t.text}`),
      ].join('\n')
    })(),
    (() => {
      const p = s.project
      if (!p || (p.pctFromAth == null && p.xFromAth == null)) return null
      return `ASYMMETRY (since ATH — the OVERALL timeframe): ${p.pctFromAth != null ? `${Math.round(p.pctFromAth)}% from ATH` : ''}${p.xFromAth != null ? ` — trading at ~1/${p.xFromAth} of the ATH` : ''}${p.athDate ? ` (ATH ${p.athDate.slice(0, 10)})` : ''}. A deep drawdown on a SHIPPING project is catch-up room; on a dead one it is a value trap — decide which from the fundamentals above, not the drawdown alone.`
    })(),
    (() => {
      const ps = s.priceStructure
      if (!ps) return null
      return [
        'RECENT PRICE STRUCTURE (days/weeks — the tape people actually rebid; read WITH the overall drawdown above, never instead of it):',
        `  30d range ${fmtUsd(ps.low30)}–${fmtUsd(ps.high30)} · now +${fmt(ps.pctAboveLow30, 1)}% above the 30d low (set ${ps.daysSinceLow30}d ago) · ${fmt(ps.pctBelowHigh30, 1)}% below the 30d high`,
        `  changes: 24h ${fmt(s.market.change24h)}% · 7d ${fmt(s.market.change7d)}%`,
        `  shape: ${ps.shape}`,
        '  Frame the entry/timing question around this shape in divergence_read and investor_take: an overall -90%+ drawdown reads completely differently on FRESH LOWS (still bleeding, no base) vs BASING (low holding, rebid forming) vs REBOUNDING (the rebid already happened). Name where price sits in the recent range.',
      ].join('\n')
    })(),
    '',
    'CROWD SENTIMENT (per-post LLM classification, author-quality weighted):',
    cr
      ? `  crowd score ${cr.score != null ? `${Math.round(50 + 50 * Math.max(-1, Math.min(1, cr.score)))}/100 = ${crowdLabel(cr.score)} (this is THE crowd sentiment number the UI shows — cite it exactly as N/100, never any other scale, and the label is AUTHORITATIVE)` : 'n/a'} · bull ${fmt(cr.bullPct, 0)}% / neutral ${fmt(cr.neutralPct, 0)}% / bear ${fmt(cr.bearPct, 0)}% · mindshare ${cr.mindsharePct != null ? fmt(cr.mindsharePct, 2) + '%' : 'n/a'}${cr.mindshareRank != null ? ` (#${Math.round(cr.mindshareRank)} by attention)` : ''}`
      : '  n/a — no classified-post coverage for this token',
    '',
    'X TELEMETRY (24h):',
    `  mentions ${soc.mentions24h ?? 'n/a'} (baseline ${soc.prevDailyAvg != null ? Math.round(soc.prevDailyAvg) : 'n/a'}/day, velocity ${fmt(soc.velocity)}x) · unique voices ${soc.uniqueAuthors ?? 'n/a'} · weighted engagement ${soc.engagement != null ? Math.round(soc.engagement) : 'n/a'} · novelty ${fmt(soc.novelty)}x`,
    'CHATTER FORENSICS:',
    `  clean signal ${soc.cleanSignal != null ? Math.round(soc.cleanSignal * 100) + '%' : 'n/a'} · promo share ${soc.promoShare != null ? Math.round(soc.promoShare * 100) + '%' : 'n/a'} · cashtag-only ${soc.cashtagShare != null ? Math.round(soc.cashtagShare * 100) + '%' : 'n/a'} · status ${soc.qualityStatus || 'clean'}${soc.qualityReasons.length ? ` · flags: ${soc.qualityReasons.join(', ')}` : ''}`,
    s.kols?.length
      ? `NOTABLE CALLERS (real KOL accounts driving the chatter — gauge WHO is behind the attention and how credible; a KOL mention is attention, NOT a buy signal):\n${s.kols.map((k) => `  - @${k.handle}${k.followers != null ? ` (${Math.round(k.followers / 1000)}K followers)` : ''}${k.verified ? ' [verified]' : ''}`).join('\n')}`
      : null,
    s.clusters?.breadth
      ? `CROSS-CLUSTER BREADTH (which community archetypes are discussing it — the organic-vs-echo tell): ${s.clusters.breadth}/7 clusters — ${s.clusters.present.map((k) => CLUSTER_LABELS[k] || k).join(', ')}. ${s.clusters.breadth >= 4 ? 'BROAD interest across distinct communities — organic conviction, not a single echo chamber.' : s.clusters.breadth >= 2 ? 'Moderate spread.' : 'NARROW — attention sits in one cluster' + (s.clusters.present[0] === 'trencher' || s.clusters.present[0] === 'kol' ? ' (trencher/influencer echo — a loud hype pocket, weigh with skepticism).' : '.')} Weigh WHO is picking it up: broad VC/dev/researcher/trader interest is a stronger, more durable signal than a trencher-only pump.`
      : null,
    '',
    'DETERMINISTIC SIGNALS (ground truth — narrate, do not re-score):',
    `  fade: ${sig.fade?.tag ? `${sig.fade.tag} ${sig.fade.score}/100 (${sig.fade.tier}) — ${sig.fade.thesis}` : 'none'}`,
    `  attention phase: ${sig.phase?.phase ? `${sig.phase.phase} ${sig.phase.score}/100 (${sig.phase.tier}) — ${sig.phase.thesis}` : 'none'}`,
    `  CHATTER QUALITY: ${sig.quality ? `${sig.quality.score}/100 (${sig.quality.tier})` : 'n/a'}`,
    '',
    s.mentionsBreakdown?.bySentiment
      ? `CROSS-PLATFORM MENTIONS (24h, all platforms): ${JSON.stringify(s.mentionsBreakdown.bySentiment)}${s.mentionsBreakdown.teamVoice ? ` · team voice: ${JSON.stringify(s.mentionsBreakdown.teamVoice)}` : ''}`
      : null,
    (() => {
      const tg = s.tgTape
      if (!tg) return null
      const split = tg.bySentiment.map((r) => `${r.sentiment} ${r.count}`).join(' / ')
      return [
        `TELEGRAM TAPE (classified messages from the token's tracked TG channels):`,
        `  ${tg.messages24h ?? 0} messages 24h · ${tg.messages7d ?? 0} messages 7d${split ? ` · 7d sentiment split: ${split}` : ''}`,
        ...tg.latest.map((m) => `  - [${m.at || 'recent'}${m.channel ? ` · ${m.channel}` : ''}${m.sentiment ? ` · ${m.sentiment}` : ''}] ${m.summary}`),
      ].join('\n')
    })(),
    s.origin
      ? `SINCE FIRST TRACKED: entered radar ${s.origin.firstSeen ? s.origin.firstSeen.slice(0, 10) : 'n/a'} at ${fmtUsd(s.origin.entryMcap)} mcap · ROI since ${fmt(s.origin.roiPct)}% · peak ${fmt(s.origin.peakRoiPct)}%`
      : 'SINCE FIRST TRACKED: never crossed the momentum radar entry bar',
    (() => {
      const u = s.unlocks, t = s.tvl
      const parts = []
      if (u) {
        if (u.next && u.next.pctOfSupply != null) {
          parts.push(`next token unlock ${u.next.date || 'upcoming'}: ${fmt(u.next.pctOfSupply, 2)}% of supply${u.next.amountUsd ? ` (${fmtUsd(u.next.amountUsd)})` : ''}${u.next.category ? ` — ${u.next.category}` : ''}${u.upcomingEvents > 1 ? ` · ${u.upcomingEvents} upcoming events through ${u.lastUnlockDate || 'later'}${u.totalUpcomingPctOfSupply != null ? `, ${fmt(u.totalUpcomingPctOfSupply, 2)}% of supply` : ''}${u.totalUpcomingUsd ? ` (${fmtUsd(u.totalUpcomingUsd)}${u.totalUpcomingUsdEstimated ? ' at spot' : ''})` : ''} total overhang` : ''}`)
        } else if (u.fullyUnlocked) {
          parts.push('token is FULLY UNLOCKED — no vesting cliff / unlock overhang ahead (structurally clean supply)')
        }
      }
      if (t && t.tvlUsd != null) parts.push(`protocol TVL ${fmtUsd(t.tvlUsd)}${t.change30dPct != null ? ` (${fmt(t.change30dPct)}% / 30d — ${t.change30dPct >= 5 ? 'growing adoption' : t.change30dPct <= -10 ? 'outflows, shrinking' : 'stable'})` : ''}`)
      return parts.length
        ? `SUPPLY & PROTOCOL (fundamentals — weigh HEAVILY vs the tape): ${parts.join(' · ')}. An imminent large unlock is real sell-pressure overhang; rising TVL is genuine adoption; a fully-unlocked fair-supply token removes a common bear thesis. For a memecoin these are absent — pure supply, no protocol, no vesting.`
        : null
    })(),
    '',
    'MACRO:',
    `  BTC dominance ${fmt(s.macro.btcDominance)}% · alt-season index ${s.macro.altSeason != null ? Math.round(s.macro.altSeason) : 'n/a'}/100 · Fear & Greed ${s.macro.fearGreed != null ? Math.round(s.macro.fearGreed) : 'n/a'} (${s.macro.fearGreedLabel || 'n/a'})`,
    '',
    s.tape?.tokenNews?.length
      ? `$${s.sym} HEADLINES:\n${s.tape.tokenNews.map((h) => `  - ${h}`).join('\n')}`
      : null,
    s.tape?.policyNews?.length
      ? `POLICY & MACRO TAPE (politics, Fed, regulation — weigh HEAVILY for BTC/majors, mostly IGNORE for microcaps unless token-specific):\n${s.tape.policyNews.map((h) => `  - ${h}`).join('\n')}`
      : null,
    s.brain
      ? `SPECTRE BRAIN (autonomous market engine, asset-tagged reads):\n${[
        s.brain.narratives.length ? `  narratives: ${s.brain.narratives.join(' | ')}` : null,
        s.brain.risks.length ? `  risks: ${s.brain.risks.join(' | ')}` : null,
        s.brain.catalysts.length ? `  catalysts: ${s.brain.catalysts.join(' | ')}` : null,
      ].filter(Boolean).join('\n')}`
      : null,
    (() => {
      const bd = s.brainDossier
      if (!bd) return null
      return `SPECTRE BRAIN DOSSIER ($${s.sym} — the engine's own per-asset read):\n${[
        bd.spectreScore != null ? `  spectre score ${bd.spectreScore}` : null,
        bd.kolMentions24h != null ? `  KOL mentions 24h: ${bd.kolMentions24h}` : null,
        bd.conviction ? `  brain conviction: ${bd.conviction}` : null,
        bd.bull ? `  brain bull case: ${bd.bull}` : null,
        bd.bear ? `  brain bear case: ${bd.bear}` : null,
        bd.narratives.length ? `  narratives: ${bd.narratives.join(' | ')}` : null,
      ].filter(Boolean).join('\n')}`
    })(),
  ]
  return lines.filter((l) => l !== null).join('\n')
}

const STANCES = new Set(['bullish', 'bearish', 'neutral', 'cautious'])

function sanitizeRead(raw) {
  if (!raw || typeof raw !== 'object') return null
  const str = (v, max = 700) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const arr = (v, maxItems, maxLen = 160) => (Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [])
  const thesis = str(raw.thesis, 500)
  if (!thesis) return null
  const conviction = num(raw.conviction)
  return {
    thesis,
    project_read: str(raw.project_read),
    crowd_read: str(raw.crowd_read),
    quality_read: str(raw.quality_read),
    divergence_read: str(raw.divergence_read),
    investor_take: str(raw.investor_take),
    macro_read: str(raw.macro_read),
    risk_flags: arr(raw.risk_flags, 4),
    watch_for: arr(raw.watch_for, 3),
    stance: STANCES.has(raw.stance) ? raw.stance : 'neutral',
    conviction: conviction != null ? Math.max(0, Math.min(100, Math.round(conviction))) : null,
  }
}

export async function generateSentimentRead(symbol, cgId) {
  const snapshot = await gatherSentimentSnapshot(symbol, cgId)
  const r = await chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(snapshot) },
    ],
    tier: 'smart',
    json: true,
    maxTokens: 900,
    temperature: 0.35,
    timeoutMs: 25_000,
  })
  if (!r.ok || !r.text) return null
  let parsed = null
  try {
    parsed = JSON.parse(r.text)
  } catch {
    const m = r.text.match(/\{[\s\S]*\}/)
    if (m) {
      try { parsed = JSON.parse(m[0]) } catch { parsed = null }
    }
  }
  const read = sanitizeRead(parsed)
  if (!read) return null
  return {
    ...read,
    symbol: snapshot.sym,
    tokenClass: snapshot.cls.key,
    // Deterministic receipts the card renders as a visible timeframe strip —
    // overall (ATH) vs the recent tape. Numbers, not LLM prose.
    inputs: {
      change24h: snapshot.market.change24h,
      change7d: snapshot.market.change7d,
      pctFromAth: snapshot.project?.pctFromAth ?? null,
      athDate: snapshot.project?.athDate || null,
      structure: snapshot.priceStructure || null,
    },
    provider: r.provider,
    generatedAt: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUITY DESK READ — stocks (assetClass=stock). Phase 2 Tier 1 of
// stocks-ta-sentiment-plan.md: fundamentals-grounded, NO crowd feed yet (the
// StockTwits/Reddit leg is Tier 2) — so the read is grounded in what IS real:
// Yahoo fundamentals + analyst consensus + earnings calendar + live headlines.
// Same house pattern: every input gathered in-process from the real upstream,
// degrades to null, the model narrates only what's on the sheet.
// ═══════════════════════════════════════════════════════════════════════════

const UA_EQ = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
let _eqYahooSession = { cookie: null, crumb: null, expires: 0 }
async function getEqYahooSession() {
  if (_eqYahooSession.cookie && _eqYahooSession.crumb && Date.now() < _eqYahooSession.expires) return _eqYahooSession
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA_EQ }, redirect: 'manual', signal: AbortSignal.timeout(5000) })
    const setCookie = cookieRes.headers.get('set-cookie') || ''
    const cookies = setCookie.split(',').map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
    if (!cookies) throw new Error('no cookies')
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA_EQ, Cookie: cookies }, signal: AbortSignal.timeout(5000) })
    if (!crumbRes.ok) throw new Error(`crumb ${crumbRes.status}`)
    const crumb = await crumbRes.text()
    if (!crumb || crumb.length < 5) throw new Error('bad crumb')
    _eqYahooSession = { cookie: cookies, crumb, expires: Date.now() + 30 * 60 * 1000 }
    return _eqYahooSession
  } catch (err) {
    return { cookie: null, crumb: null, expires: 0 }
  }
}

async function fetchEquitySheet(symbol) {
  const session = await getEqYahooSession()
  if (!session.cookie || !session.crumb) return null
  try {
    const modules = 'price,summaryDetail,defaultKeyStatistics,assetProfile,financialData,recommendationTrend,calendarEvents'
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(session.crumb)}`
    const r = await fetch(url, { headers: { 'User-Agent': UA_EQ, Cookie: session.cookie }, signal: AbortSignal.timeout(8000) })
    if (r.status === 401) { _eqYahooSession.expires = 0; return null }
    if (!r.ok) return null
    const d = (await r.json())?.quoteSummary?.result?.[0]
    if (!d) return null
    const raw = (v) => (v && typeof v === 'object' ? v.raw : v) ?? null
    const price = d.price || {}
    const detail = d.summaryDetail || {}
    const stats = d.defaultKeyStatistics || {}
    const prof = d.assetProfile || {}
    const fin = d.financialData || {}
    const rt = d.recommendationTrend?.trend?.[0] || null
    const cal = d.calendarEvents?.earnings || {}
    return {
      name: raw(price.longName) || raw(price.shortName) || symbol,
      priceNow: raw(price.regularMarketPrice),
      changeDayPct: raw(price.regularMarketChangePercent) != null ? raw(price.regularMarketChangePercent) * 100 : null,
      marketCap: raw(price.marketCap),
      sector: prof.sector || null,
      industry: prof.industry || null,
      description: typeof prof.longBusinessSummary === 'string' ? prof.longBusinessSummary.slice(0, 700) : null,
      pe: raw(detail.trailingPE),
      forwardPe: raw(detail.forwardPE) ?? raw(stats.forwardPE),
      eps: raw(stats.trailingEps),
      beta: raw(stats.beta),
      dividendYieldPct: raw(detail.dividendYield) != null ? raw(detail.dividendYield) * 100 : null,
      week52High: raw(detail.fiftyTwoWeekHigh),
      week52Low: raw(detail.fiftyTwoWeekLow),
      shortPctFloat: raw(stats.shortPercentOfFloat) != null ? raw(stats.shortPercentOfFloat) * 100 : null,
      targetMean: raw(fin.targetMeanPrice),
      targetHigh: raw(fin.targetHighPrice),
      targetLow: raw(fin.targetLowPrice),
      recommendationKey: fin.recommendationKey || null,
      analystCount: raw(fin.numberOfAnalystOpinions),
      recTrend: rt ? { strongBuy: rt.strongBuy || 0, buy: rt.buy || 0, hold: rt.hold || 0, sell: rt.sell || 0, strongSell: rt.strongSell || 0 } : null,
      revenueGrowthPct: raw(fin.revenueGrowth) != null ? raw(fin.revenueGrowth) * 100 : null,
      profitMarginPct: raw(fin.profitMargins) != null ? raw(fin.profitMargins) * 100 : null,
      earningsTs: cal.earningsDate?.[0]?.raw || null,
      earningsAvg: raw(cal.earningsAverage),
      revenueAvg: raw(cal.revenueAverage),
    }
  } catch (err) {
    return null
  }
}

// Live headlines — Google News RSS (keyless), tagged for STRUCTURAL CATALYSTS.
// This regex MIRRORS src/pages/research-zone/components/rz-catalysts.js
// HIGH_IMPACT_RE (the Agent RSS catalyst layer) — keep the two in sync. It is
// what makes "SpaceX joins the Nasdaq-100 Tuesday" LEAD the read instead of
// drowning under listicle fluff (Sunny 07-06: "it's joining Nasdaq 100 —
// each project must be covered well").
const EQ_HIGH_IMPACT_RE = /\b(nasdaq[- ]?100|s&p ?500|dow jones|russell ?[12]000|index (?:inclusion|add\w*|entry|rebalanc\w*)|joins? the (?:nasdaq|s&p|dow)|ipo|initial public offering|earnings|acquisition|acquires?|merger|buyout|takeover|bankruptcy|delist\w*|stock split|dividend|guidance|lock-?up|buyback|sec (?:approval|charges|lawsuit)|fda (?:approval|clearance)|forced buying|short squeeze|activist)\b/i
const EQ_CATALYST_WINDOW_H = 72

async function fetchCompanyHeadlines(name, symbol) {
  try {
    const q = encodeURIComponent(`"${name || symbol}" OR "${symbol} stock"`)
    const r = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { 'User-Agent': UA_EQ }, signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) return []
    const xml = await r.text()
    const items = []
    const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g
    let m
    while ((m = re.exec(xml)) && items.length < 10) {
      const title = m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
      const ageH = Math.max(0, Math.round((Date.now() - new Date(m[2]).getTime()) / 3600_000))
      if (title) {
        items.push({
          title: title.slice(0, 160),
          ageH,
          catalyst: EQ_HIGH_IMPACT_RE.test(title) && ageH <= EQ_CATALYST_WINDOW_H,
        })
      }
    }
    // Catalysts float to the top of the sheet regardless of feed order
    return items.sort((a, b) => (b.catalyst ? 1 : 0) - (a.catalyst ? 1 : 0) || a.ageH - b.ageH)
  } catch (err) {
    return []
  }
}

const EQUITY_SYSTEM_PROMPT = `You are the senior equity analyst at Spectre's research desk. You are given a verified data sheet for ONE US-listed stock: company profile, valuation, growth/margins, analyst consensus (targets + ratings distribution), the next earnings print with Street estimates, 52-week positioning, and recent headlines. Write the read an investor deciding whether this deserves a closer look would want.

HARD RULES:
- Sentence 1 of "thesis" IS the standalone takeaway. Max 220 characters. The UI renders it as a pull quote.
- Use ONLY the numbers/facts on the sheet. "n/a" means unavailable — say so or skip it. NEVER invent a number, price level, product, guidance, or event.
- NO crowd/social data exists on this sheet — do not speculate about retail sentiment or social chatter. The crowd feed for equities is not wired yet.
- HEADLINES ARE HEADLINES: cite them as reported news ("headlines flag ..."), never as verified facts, and never invent detail beyond the title.
- VALUATION IN CONTEXT: a high P/E is a growth expectation, not automatically a sell; a low P/E can be value or a melting business — use growth/margins to say which way it leans.
- THE STREET IS AN INPUT, NOT THE VERDICT: price far above the mean target means momentum is carrying more than the fundamental case; price far below with intact fundamentals is where value cases start. Say which applies.
- CATALYSTS LEAD THE READ: the sheet marks structural events [CATALYST] — index inclusion (forced passive buying at the rebalance, then the flow fades), lockup expiry (supply overhang), M&A, splits, buybacks, regulatory decisions. When a live catalyst exists, the THESIS must name it and the read is organized around it — a valuation observation while an index-inclusion trade is on is missing the story.
- EARNINGS ARE THE BINARY EVENT: if the print is within ~2 weeks, it dominates the near-term setup — levels and momentum reads don't survive a gap.
- 52-WEEK POSITION FRAMES RISK: at highs there is no overhead supply (trailing-risk regime); near lows, distinguish falling knife from basing using growth/margins/Street.
- No price predictions. Frame in probabilities, catalysts and invalidations ("what would change this read").
- Voice: dry, precise, investor-to-investor. BANNED: "buckle up", "moon", "explosive", "massive", "game-changer", "revolutionary", exclamation marks, emojis, hedging filler.

Respond with STRICT JSON, no markdown fences:
{
  "thesis": "string, 1-2 sentences, sentence 1 <= 220 chars — the investor takeaway; MUST name the live catalyst when one is marked",
  "catalyst_read": "string, 2-3 sentences on the marked [CATALYST] event(s): what the event mechanically does to the stock (flows, supply, ownership) and how it usually resolves. 'n/a' when no catalyst is marked.",
  "company_read": "string, 2-3 sentences: what the company is, its sector position, and what valuation + growth/margins say about how the market prices it",
  "street_read": "string, 2-3 sentences: the analyst consensus — ratings split, mean/high/low targets vs price, and what the gap implies",
  "earnings_read": "string, 1-2 sentences on the next print: date, Street estimates, and what it means for the setup. 'n/a' if no date on the sheet.",
  "investor_take": "string, 2-3 sentences: bull case vs bear case and the asymmetry. The 'would I look closer' verdict.",
  "macro_read": "string, 1-2 sentences: how this name trades relative to the index tape (beta, sector character)",
  "risk_flags": ["max 4 short strings, each a concrete risk grounded in the sheet"],
  "watch_for": ["max 3 short strings, each a concrete observable catalyst/trigger"],
  "stance": "bullish" | "bearish" | "neutral" | "cautious",
  "conviction": 0-100
}`

function buildEquityContent(sh, headlines, symbol) {
  const pctFromHigh = (sh.priceNow && sh.week52High) ? ((sh.priceNow - sh.week52High) / sh.week52High) * 100 : null
  const rangePos = (sh.priceNow && sh.week52High && sh.week52Low && sh.week52High > sh.week52Low)
    ? ((sh.priceNow - sh.week52Low) / (sh.week52High - sh.week52Low)) * 100 : null
  const upside = (sh.priceNow && sh.targetMean) ? ((sh.targetMean - sh.priceNow) / sh.priceNow) * 100 : null
  const rt = sh.recTrend
  const earnDays = sh.earningsTs ? Math.ceil((sh.earningsTs * 1000 - Date.now()) / 86_400_000) : null
  return [
    `STOCK: ${symbol} — ${sh.name}${sh.sector ? ` · ${sh.sector}` : ''}${sh.industry ? ` / ${sh.industry}` : ''}`,
    sh.description ? `COMPANY: ${sh.description}` : 'COMPANY: n/a',
    `TAPE: price ${fmtUsd(sh.priceNow)} (${fmt(sh.changeDayPct, 2)}% today) · mcap ${fmtUsd(sh.marketCap)} · 52w range ${fmtUsd(sh.week52Low)}–${fmtUsd(sh.week52High)} (${fmt(rangePos, 0)}% through, ${fmt(pctFromHigh, 1)}% from high)`,
    `VALUATION: P/E ${fmt(sh.pe)} · fwd P/E ${fmt(sh.forwardPe)} · EPS ${fmt(sh.eps, 2)} · div yield ${fmt(sh.dividendYieldPct, 2)}% · beta ${fmt(sh.beta, 2)}`,
    `GROWTH/MARGINS: revenue growth ${fmt(sh.revenueGrowthPct, 1)}% · profit margin ${fmt(sh.profitMarginPct, 1)}%${sh.shortPctFloat != null ? ` · short interest ${fmt(sh.shortPctFloat, 1)}% of float` : ''}`,
    `STREET: consensus ${sh.recommendationKey ? sh.recommendationKey.replace(/_/g, ' ').toUpperCase() : 'n/a'}${sh.analystCount ? ` (${sh.analystCount} analysts)` : ''}${rt ? ` · ratings ${rt.strongBuy} strong-buy / ${rt.buy} buy / ${rt.hold} hold / ${rt.sell} sell / ${rt.strongSell} strong-sell` : ''} · targets low ${fmtUsd(sh.targetLow)} / mean ${fmtUsd(sh.targetMean)} / high ${fmtUsd(sh.targetHigh)}${upside != null ? ` · mean is ${fmt(upside, 1)}% vs price` : ''}`,
    earnDays != null
      ? `NEXT EARNINGS: in ${earnDays} day(s)${sh.earningsAvg != null ? ` · Street est EPS ${fmt(sh.earningsAvg, 2)}` : ''}${sh.revenueAvg != null ? ` · est revenue ${fmtUsd(sh.revenueAvg)}` : ''}`
      : 'NEXT EARNINGS: n/a',
    headlines.length
      ? `HEADLINES (recent, titles only — [CATALYST] marks structural, price-moving events):\n${headlines.map((h) => `- ${h.catalyst ? '[CATALYST] ' : ''}[${h.ageH}h ago] ${h.title}`).join('\n')}`
      : 'HEADLINES: n/a',
    'CROWD/SOCIAL: not wired for equities yet — do not speculate about it.',
  ].join('\n')
}

function sanitizeEquityRead(raw) {
  if (!raw || typeof raw !== 'object') return null
  const str = (v, max = 700) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const arr = (v, maxItems, maxLen = 160) => (Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [])
  const thesis = str(raw.thesis, 500)
  if (!thesis) return null
  const conviction = num(raw.conviction)
  return {
    thesis,
    catalyst_read: str(raw.catalyst_read),
    company_read: str(raw.company_read),
    street_read: str(raw.street_read),
    earnings_read: str(raw.earnings_read),
    investor_take: str(raw.investor_take),
    macro_read: str(raw.macro_read),
    risk_flags: arr(raw.risk_flags, 4),
    watch_for: arr(raw.watch_for, 3),
    stance: STANCES.has(raw.stance) ? raw.stance : 'neutral',
    conviction: conviction != null ? Math.max(0, Math.min(100, Math.round(conviction))) : null,
  }
}

export async function generateEquityRead(symbol) {
  const sheet = await fetchEquitySheet(symbol)
  if (!sheet) return null
  const headlines = await fetchCompanyHeadlines(sheet.name, symbol)
  const r = await chat({
    messages: [
      { role: 'system', content: EQUITY_SYSTEM_PROMPT },
      { role: 'user', content: buildEquityContent(sheet, headlines, symbol) },
    ],
    tier: 'smart',
    json: true,
    maxTokens: 900,
    temperature: 0.35,
    timeoutMs: 25_000,
  })
  if (!r.ok || !r.text) return null
  let parsed = null
  try {
    parsed = JSON.parse(r.text)
  } catch {
    const m = r.text.match(/\{[\s\S]*\}/)
    if (m) { try { parsed = JSON.parse(m[0]) } catch { parsed = null } }
  }
  const read = sanitizeEquityRead(parsed)
  if (!read) return null
  return {
    ...read,
    symbol,
    assetClass: 'stock',
    // Inputs the card renders as receipts next to the prose
    inputs: {
      price: sheet.priceNow,
      targetMean: sheet.targetMean,
      recommendationKey: sheet.recommendationKey,
      analystCount: sheet.analystCount,
      earningsTs: sheet.earningsTs,
      headlineCount: headlines.length,
      catalystCount: headlines.filter((h) => h.catalyst).length,
      catalysts: headlines.filter((h) => h.catalyst).slice(0, 3).map((h) => h.title),
    },
    provider: r.provider,
    generatedAt: new Date().toISOString(),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const symbol = String(req.query.symbol || '').trim().toUpperCase()
  const cgId = String(req.query.cgId || '').trim() || null
  const isEquity = String(req.query.assetClass || '').trim() === 'stock'
  if (!symbol || !/^[A-Z0-9$._-]{1,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbol required' })
  }
  if (await rateLimit(req, res, { bucket: 'sentiment-read', max: 12, windowMs: 60_000 })) return

  if (isEquity) {
    // Equity lane — own cache namespace, same cache/lock/last-good discipline.
    const key = `sentiment-read-eq:v2:${symbol.toLowerCase()}`
    const lockKey = `${key}:gen`
    const lastKey = `sentiment-read-eq:last:${symbol.toLowerCase()}`
    try {
      const cached = await getJsonWithTTL(key)
      if (cached?.thesis) return res.status(200).json({ read: cached, cached: true })
      const lock = await getJsonWithTTL(lockKey)
      if (lock) {
        const last = await getJsonWithTTL(lastKey).catch(() => null)
        if (last?.thesis) return res.status(200).json({ read: last, cached: true, stale: true })
        return res.status(200).json({ read: null, pending: true })
      }
      await setJsonWithTTL(lockKey, { ts: Date.now() }, LOCK_TTL_S)
      const read = await generateEquityRead(symbol)
      if (!read) {
        const last = await getJsonWithTTL(lastKey).catch(() => null)
        if (last?.thesis) return res.status(200).json({ read: last, cached: true, stale: true })
        return res.status(200).json({ read: null, error: 'unavailable' })
      }
      await setJsonWithTTL(key, read, CACHE_TTL_S)
      await setJsonWithTTL(lastKey, read, 24 * 3600).catch(() => {})
      return res.status(200).json({ read, cached: false })
    } catch (err) {
      console.error('[sentiment-read:eq] error:', err.message)
      const last = await getJsonWithTTL(lastKey).catch(() => null)
      if (last?.thesis) return res.status(200).json({ read: last, cached: true, stale: true })
      return res.status(200).json({ read: null, error: 'unavailable' })
    }
  }

  // v11: + inputs receipts (visible timeframe strip). last:v2 kept — prior
  // reads are sound, so they serve instantly as stale while the regen runs.
  const key = `sentiment-read:v12:${(cgId || symbol).toLowerCase()}`
  const lockKey = `${key}:gen`
  // A long-lived "last-good" copy so a transient LLM hiccup (the tier:smart
  // model rate-limiting / timing out at 25s) serves the previous read instead
  // of blanking the panel to "unavailable" — the read barely changes hour to
  // hour, so a slightly stale one beats none. This is why $ANSEM read
  // "isn't available right now" despite generating fine seconds earlier.
  // last:v3 — versioned with the v12 honesty fix (team tape transport + the
  // absence-is-never-a-finding rules) so the stale-while-revalidate path can
  // never flash a read that calls a team "unknown"/"inactive" off missing data
  // (the SPECTRE "549 days / no X following" incident, 2026-08-25).
  const lastKey = `sentiment-read:last:v3:${(cgId || symbol).toLowerCase()}`
  const LAST_TTL_S = 24 * 3600

  // ?fresh=1 = the client's background revalidation call — it skips the
  // stale-serving fast path below and pays the full generation.
  const wantFresh = String(req.query.fresh || '') === '1'

  try {
    const cached = await getJsonWithTTL(key)
    if (cached?.thesis && !wantFresh) {
      return res.status(200).json({ read: cached, cached: true })
    }

    const lock = await getJsonWithTTL(lockKey)
    if (lock) {
      // another instance is generating — serve last-good if we have one, else pending
      const last = await getJsonWithTTL(lastKey).catch(() => null)
      if (last?.thesis) return res.status(200).json({ read: last, cached: true, stale: true })
      return res.status(200).json({ read: null, pending: true })
    }

    // STALE-WHILE-REVALIDATE (2026-07-13, the "15s load" fix): a fresh-cache
    // miss used to generate synchronously — 11 upstream fetches + site crawl +
    // a 25s LLM call, so the panel sat on a loader for 15-30s. Serve the
    // last-good read INSTANTLY and let the client fire a background ?fresh=1
    // to regenerate; only a token with no prior read ever pays the wait.
    if (!wantFresh) {
      const last = await getJsonWithTTL(lastKey).catch(() => null)
      if (last?.thesis) return res.status(200).json({ read: last, cached: true, stale: true, refresh: true })
    }

    await setJsonWithTTL(lockKey, { ts: Date.now() }, LOCK_TTL_S)

    const read = await generateSentimentRead(symbol, cgId)
    if (!read) {
      // generation failed this round — serve the last good read, not "unavailable"
      const last = await getJsonWithTTL(lastKey).catch(() => null)
      if (last?.thesis) return res.status(200).json({ read: last, cached: true, stale: true })
      return res.status(200).json({ read: null, error: 'unavailable' })
    }
    await setJsonWithTTL(key, read, CACHE_TTL_S)
    await setJsonWithTTL(lastKey, read, LAST_TTL_S).catch(() => {})
    return res.status(200).json({ read, cached: false })
  } catch (err) {
    console.error('[sentiment-read] error:', err.message)
    const last = await getJsonWithTTL(lastKey).catch(() => null)
    if (last?.thesis) return res.status(200).json({ read: last, cached: true, stale: true })
    return res.status(200).json({ read: null, error: 'unavailable' })
  }
}
