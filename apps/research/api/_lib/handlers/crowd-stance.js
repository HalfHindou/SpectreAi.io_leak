/**
 * Crowd Stance — bull/bear split from the live X tape (FREE lexicon, no LLM).
 *
 * GET /api/crowd-stance?symbol=ANSEM&cgId=the-black-bull
 *
 * WHY: the mindshare_v2 pipeline (data-api) only covers tokens its mention
 * ingestion tracks — a loud on-chain runner ($ANSEM: 893 mentions/24h, 598
 * voices) can have NO classified row, which blanked the RZ crowd gauge, the
 * bull/bear split and the Sentiment-vs-Price crowd series, and let the verdict
 * fall through to "Price-Led Move" against an obviously bullish tape. A 2026-07
 * audit found v2 barely produces 24h scores for ANY token, so this fallback
 * runs for ~75% of views — which is why it must be CHEAP.
 *
 * It pulls the token's recent X mentions (X Dash dashboard feed, covers every
 * tracked token by cg_id) and classifies each with a keyword lexicon (bull:
 * moon/lfg/pump…, bear: rug/dump/dead…), weighted by author quality +
 * engagement (same philosophy as the data-api mindshare rollup), returning a
 * -1..1 score + weighted bull/neutral/bear split. $0, instant, no LLM /
 * provider dependency — for an AGGREGATE gauge over 40 author-weighted posts a
 * lexicon reads the net lean well (crypto tweets are directional-keyword-heavy;
 * individual misreads wash out). Each pass appends to a KV history ring so the
 * crowd series accumulates for the chart.
 *
 * Caching: KV 20-min TTL per asset. Registered under intel-api tier3.
 */
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { rateLimit } from '../ratelimit.js'

const DASHBOARD_API_BASE = (process.env.DASHBOARD_API_BASE_URL || process.env.X_DASH_BASE || 'http://5.78.199.87:8092').replace(/\/+$/, '')
const DASHBOARD_API_KEY = process.env.XDASH_API_TOKEN || process.env.DASHBOARD_API_KEY || process.env.X_DASH_API_KEY || ''
const DASHBOARD_HEADERS = DASHBOARD_API_KEY
  ? { Accept: 'application/json', Authorization: `Bearer ${DASHBOARD_API_KEY}`, 'X-API-Key': DASHBOARD_API_KEY }
  : { Accept: 'application/json' }

const CACHE_TTL_S = 1200 // 20 min per asset — crowd lean doesn't shift faster
const HIST_TTL_S = 30 * 86_400
const HIST_MAX_POINTS = 600
const HIST_BUCKET_MS = 30 * 60_000
const MAX_TWEETS = 60
const MIN_TWEETS = 4

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

async function safeJson(url, headers, timeoutMs = 12_000) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

/* Author-quality x engagement weight — log-scaled so a 300K-follower KOL
   counts more than a 40-follower bot swarm, but can't single-handedly own the
   split. Mirrors the data-api rollup philosophy (author-weighted, not
   one-post-one-vote). */
function postWeight(author, tweet) {
  const followers = num(author?.followers_count) ?? 0
  const verified = !!(author?.is_blue_verified || author?.legacy_verified)
  const eng = (num(tweet?.favorite_count) ?? 0) + 2 * (num(tweet?.retweet_count) ?? 0) + (num(tweet?.reply_count) ?? 0)
  let w = Math.log10(followers + 10)
  if (verified) w *= 1.2
  w += Math.min(2, Math.log10(1 + eng))
  return Math.max(0.2, w)
}

function cleanText(t) {
  return String(t || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
}

/* Fetch recent mentions for one token from the X Dash dashboard (cg_id-keyed —
   this is the feed that covers on-chain runners the data-api misses). */
async function fetchMentions(cgId) {
  const j = await safeJson(`${DASHBOARD_API_BASE}/api/token/${encodeURIComponent(cgId)}?per_page=50`, DASHBOARD_HEADERS, 12_000)
  const rows = Array.isArray(j?.mentions) ? j.mentions : []
  const selfHandle = String(j?.token?.handle || '').toLowerCase()
  const seen = new Set()
  const out = []
  for (const m of rows) {
    const tw = m?.tweet
    const au = m?.author
    const id = tw?.tweet_id
    const text = cleanText(tw?.full_text)
    if (!id || seen.has(id) || text.length < 8) continue
    if (selfHandle && String(au?.screen_name || '').toLowerCase() === selfHandle) continue // team account isn't "the crowd"
    seen.add(id)
    out.push({
      id,
      text,
      at: tw?.created_at_utc ? new Date(tw.created_at_utc).getTime() : null,
      w: postWeight(au, tw),
    })
    if (out.length >= MAX_TWEETS) break
  }
  return out
}

/* ── FREE lexicon classifier (no LLM) ─────────────────────────────────────────
 * The mindshare_v2 pipeline barely produces 24h scores right now, so this
 * fallback covers ~75% of tokens — running an LLM classify per token-view was a
 * recurring cost for a signal that, in AGGREGATE, a keyword lexicon reads well:
 * crypto tweets are extremely directional-keyword-heavy ("bull/moon/lfg" vs
 * "rug/dump/dead"), individual misreads wash out across 40 author-weighted
 * posts, and the gauge only needs the net lean, not per-tweet nuance. $0, no
 * latency, no provider dependency. (If per-tweet accuracy ever matters again,
 * an LLM pass can be layered selectively for high-value tokens.) */
const BULL_RE = /\b(bull(ish)?|moon(ing|shot)?|pump(ing|ed)?|lfg|wagmi|long(s|ing)?|buy(s|ing)?|bought|accumulat(e|ing)|hodl|hold(ing)?|gem|breakout|ath|undervalued|rocket|ap(e|ing|ed)|bid(ding)?|load(ed|ing)|conviction|send(ing)?|higher|printing|generational|goat|king|based|floor|\d{2,}x|[2-9]x)\b/i
const BEAR_RE = /\b(bear(ish)?|dump(ing|ed)?|sell(s|ing)?|sold|short(s|ing)?|rug(ged|pull)?|scam|ponzi|dead|dying|exit|crash(ing)?|tank(ing)?|fade|avoid|careful|warning|honeypot|jeet(s|ed|ing)?|bleeding|lower|overvalued|ngmi|capitulat(e|ion)|worthless|toppy|top\s?signal|exit\s?liquidity)\b/i
const BULL_EMOJI = /[\u{1F680}\u{1F311}\u{1F4C8}\u{1F7E2}\u{1F48E}\u{1F525}\u{1F402}\u{1F911}\u{1F4B0}\u{1F64C}⬆\u{1FAE1}\u{1F4AA}\u{1F3C6}\u{1F451}]/u
const BEAR_EMOJI = /[\u{1F4C9}\u{1F534}\u{1F480}\u{1F43B}⬇\u{1F6AB}⚠\u{1FA78}\u{1F921}]/u

function scoreTweet(text) {
  const t = String(text || '')
  let bull = 0
  let bear = 0
  // count distinct-ish hits (cap so one spammy repeat can't dominate a tweet)
  for (const m of t.matchAll(new RegExp(BULL_RE.source, 'gi'))) { bull++; if (bull >= 4) break }
  for (const m of t.matchAll(new RegExp(BEAR_RE.source, 'gi'))) { bear++; if (bear >= 4) break }
  if (BULL_EMOJI.test(t)) bull++
  if (BEAR_EMOJI.test(t)) bear++
  if (bull > bear) return 'bull'
  if (bear > bull) return 'bear'
  return 'neut'
}

function classifyBatch(sym, tweets) {
  if (tweets.length < MIN_TWEETS) return null
  const map = new Map()
  for (let i = 0; i < tweets.length; i++) map.set(i, scoreTweet(tweets[i].text))
  return map
}

/* Weighted rollup of labeled tweets → score + split. */
function rollup(tweets, labels) {
  let bullW = 0
  let bearW = 0
  let neutW = 0
  for (let i = 0; i < tweets.length; i++) {
    const s = labels.get(i)
    if (!s) continue
    if (s === 'bull') bullW += tweets[i].w
    else if (s === 'bear') bearW += tweets[i].w
    else neutW += tweets[i].w
  }
  const total = bullW + bearW + neutW
  if (total <= 0) return null
  return {
    score: (bullW - bearW) / total, // -1..1, weighted
    bull_pct: (bullW / total) * 100,
    bear_pct: (bearW / total) * 100,
    neutral_pct: (neutW / total) * 100,
  }
}

/* Per-bucket retro series from the classified tweets themselves, so the chart
   has real crowd points the moment the first classification lands instead of
   waiting days for snapshots to accumulate. */
function retroHistory(tweets, labels) {
  const buckets = new Map()
  for (let i = 0; i < tweets.length; i++) {
    const s = labels.get(i)
    const t = tweets[i].at
    if (!s || !Number.isFinite(t)) continue
    const key = Math.floor(t / HIST_BUCKET_MS)
    let b = buckets.get(key)
    if (!b) { b = { bullW: 0, bearW: 0, neutW: 0 }; buckets.set(key, b) }
    if (s === 'bull') b.bullW += tweets[i].w
    else if (s === 'bear') b.bearW += tweets[i].w
    else b.neutW += tweets[i].w
  }
  const out = []
  for (const [key, b] of buckets) {
    const total = b.bullW + b.bearW + b.neutW
    if (total <= 0) continue
    out.push({
      t: key * HIST_BUCKET_MS + HIST_BUCKET_MS / 2,
      score: (b.bullW - b.bearW) / total,
      bull: (b.bullW / total) * 100,
      bear: (b.bearW / total) * 100,
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

async function mergeHistory(key, retro, current) {
  const histKey = `crowd-hist:v1:${key}`
  let stored = []
  try {
    const raw = await getJsonWithTTL(histKey)
    if (Array.isArray(raw)) stored = raw
  } catch { /* fresh ring */ }
  const byBucket = new Map()
  for (const p of stored) {
    if (Number.isFinite(p?.t)) byBucket.set(Math.floor(p.t / HIST_BUCKET_MS), p)
  }
  // retro points are recomputed from the actual posts — they win over old snapshots
  for (const p of retro) byBucket.set(Math.floor(p.t / HIST_BUCKET_MS), p)
  if (current) byBucket.set(Math.floor(current.t / HIST_BUCKET_MS), current)
  const cutoff = Date.now() - HIST_TTL_S * 1000
  const merged = [...byBucket.values()]
    .filter((p) => Number.isFinite(p.t) && p.t >= cutoff && Number.isFinite(p.score))
    .sort((a, b) => a.t - b.t)
    .slice(-HIST_MAX_POINTS)
  try { await setJsonWithTTL(histKey, merged, HIST_TTL_S) } catch { /* non-fatal */ }
  return merged
}

/**
 * Classify the live tape for one token. Returns
 * { score, bull_pct, bear_pct, neutral_pct, sample_size, source, classified_at, history }
 * or null when there is nothing to classify / the LLM failed. KV-cached — the
 * desk read (sentiment-read) and the /api/crowd-stance endpoint share one
 * classification per token per TTL.
 */
export async function classifyCrowdStance(symbol, cgId) {
  const sym = String(symbol || '').toUpperCase()
  if (!sym || !cgId) return null
  const key = String(cgId).toLowerCase()
  const cacheKey = `crowd-stance:v1:${key}`

  const cached = await getJsonWithTTL(cacheKey).catch(() => null)
  if (cached && num(cached.score) != null) return cached

  // No gen-lock: the classify is a free, instant lexicon pass now, so there's
  // no expensive work to serialize — a concurrent caller just classifies too
  // (mergeHistory dedupes by bucket). Removing it also kills the null-degrade
  // path the client had to defend against.
  const tweets = await fetchMentions(key)
  if (tweets.length < MIN_TWEETS) return null

  const labels = classifyBatch(sym, tweets)
  if (!labels) return null

  const roll = rollup(tweets, labels)
  if (!roll) return null

  const now = Date.now()
  const currentPoint = { t: now, score: roll.score, bull: roll.bull_pct, bear: roll.bear_pct }
  const history = await mergeHistory(key, retroHistory(tweets, labels), currentPoint)

  const out = {
    ...roll,
    sample_size: labels.size,
    source: 'xdash-llm',
    classified_at: new Date(now).toISOString(),
    history,
  }
  await setJsonWithTTL(cacheKey, out, CACHE_TTL_S).catch(() => {})
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const symbol = String(req.query.symbol || '').trim().toUpperCase()
  const cgId = String(req.query.cgId || '').trim() || null
  if (!symbol || !/^[A-Z0-9$._-]{1,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbol required' })
  }
  if (await rateLimit(req, res, { bucket: 'crowd-stance', max: 15, windowMs: 60_000 })) return

  try {
    const data = await classifyCrowdStance(symbol, cgId)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json({ data })
  } catch (err) {
    console.error('[crowd-stance] error:', err.message)
    return res.status(200).json({ data: null, error: 'unavailable' })
  }
}
