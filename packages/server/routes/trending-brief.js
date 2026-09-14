/**
 * Express route - per-token AI dossier for the Trending hub (v2: real research).
 *
 *   GET  /api/trending/brief    - single token (popover)
 *   POST /api/trending/briefs   - batch for the inline table column (<= 24)
 *
 * v3 pipeline per token: X Dash community tweets (REAL tweet texts + author
 * reach), DexScreener profile (website URL + twitter handle, one keyless batch
 * call for the whole board), the token's OWN X account timeline (Cloud Run
 * tweets backend - followers, account age, posting cadence, what the team is
 * shipping), X Community detection (x.com/i/communities links), RugCheck
 * safety flags (holder concentration / LP / authorities), a bounded website
 * scrape, a NAME-WAVE search (raw X search for the token NAME - the viral
 * tweet/event a meme was minted to ride, ranked by reach and timed against
 * launch), launch-date + notable-day context (a "250th" token minted on July
 * 4th 2026 IS the America-250 meme), plus the market stats the client already
 * holds. The LLM gateway
 * then writes an ALPHA-first read: who/what is driving attention right now -
 * NEVER website taglines, NEVER restating the numbers in adjacent columns,
 * never inventing events. A background warmer keeps the whole board's reads
 * pre-generated so the inline column is instant.
 *
 * Honesty contract: ground everything in gathered material; thin evidence is
 * said out loud and marked low-confidence. When no LLM provider is alive the
 * rules fallback serves identity material (site title / handle / mentions),
 * marked provider:'rules' and short-cached so a recovered LLM takes over.
 *
 * Cost guards: brief cache 15 min, profile cache 24 h, site cache 24 h,
 * in-flight dedup, 10 single/min + 4 batch/min per IP, <= 8 scrapes and one
 * LLM call per batch.
 */
const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { chat } = require('../lib/llm-gateway')
const { rugcheckBatch } = require('../lib/token-safety')

// AI Read provider order: GEMINI FIRST - the trading platform standardizes on
// Gemini for its AI surfaces (the token-page agent already runs gemini-3/2.5),
// and gemini-2.5-flash's free RPD was sized for hash-gated read volume, so
// this lane costs $0 within the free tier. The rest of the chain is the
// resilience ladder: free llama-70b lanes (cerebras/openrouter), then paid
// Groq/OpenAI as the safety net - it only pays when Gemini is down or its
// free tier 429s (the gateway breaker handles the hop automatically).
// Requires GEMINI_API_KEY in the server env (dev .env + the prod
// spectre-trending pm2 env); without it the gateway skips the lane.
// Override per-lane with LLM_CHAIN_BRIEFS (csv) without touching the global
// LLM_CHAIN that other consumers use.
const BRIEF_CHAIN = (process.env.LLM_CHAIN_BRIEFS || 'gemini,cerebras,openrouter,groq,openai,anthropic,ollama')
  .split(',').map((s) => s.trim()).filter(Boolean)

// AI Read runs the SAME model as the token-page agent (agent-core.js) so the
// two surfaces share one brain / voice. Scoped to the gemini lane only (the
// gateway leaves every other consumer + the non-gemini fallback links on
// their default 2.5-flash smart model). gemini-3-flash-preview is a markedly
// stronger writer for the meta/lore synthesis; thinkingLevel is pinned 'low'
// gateway-side so reasoning stays bounded inside maxTokens. Env-overridable.
const BRIEF_GEMINI_MODEL = process.env.BRIEF_GEMINI_MODEL || 'gemini-3-flash-preview'

const router = express.Router()

// X Dash auth - same chain as every other consumer (XDASH_API_TOKEN = current).
const X_DASH_BASE = (
  process.env.X_DASH_DIRECT_URL ||
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '')
const X_DASH_KEY =
  process.env.XDASH_API_TOKEN ||
  process.env.X_DASH_API_KEY ||
  process.env.DASHBOARD_API_KEY ||
  ''

// Raw X timelines for a token's OWN account - the Cloud Run tweets backend
// (same upstream the trading app's tweets-official serverless fn proxies).
const TWEETS_API_BASE = (process.env.TWEETS_API_BASE || 'https://backend-277369611639.us-central1.run.app').replace(/\/+$/, '')

const CACHE_TTL_MS = 15 * 60 * 1000
const RULES_TTL_MS = 3 * 60 * 1000
// A known read older than its TTL still paints INSTANTLY (stale-while-
// revalidate) while the queue rewrites it behind; past this it shimmers.
const STALE_SERVE_MS = 6 * 60 * 60 * 1000
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000
const SITE_TTL_MS = 24 * 60 * 60 * 1000
const ACCOUNT_TTL_MS = 3 * 60 * 60 * 1000    // own-account activity moves fast
const WAVE_TTL_MS = 6 * 60 * 60 * 1000       // name-wave: a token's origin story doesn't change fast

const cache = new Map()        // brief key -> { data, ts }
const inflight = new Map()     // brief key -> Promise
const profileCache = new Map() // ca(lower) -> { profile, ts }
const siteCache = new Map()    // url -> { site, ts }
const accountCache = new Map() // handle(lower) -> { account, ts }
const waveCache = new Map()    // name(lower) -> { wave, ts }

// Rolling record of the board rows real clients have asked briefs for. The
// warmer pre-generates THIS set so the inline AI Read column is a cache hit on
// every view. This is the ONLY warm source that works on the standalone prod
// box (`~/spectre-trending`), whose bare server does NOT mount
// `/api/tokens/trending` - so the warmer's engine-board fetch 404s there and,
// before this, nothing ever warmed -> every prod view paid a ~10s cold Codex+
// Gemini generation. Rows are stored in the exact `{ca,symbol,name,mcap,...}`
// shape POST /briefs receives (== what generateBriefs/buildBoardContext read).
const recentBoard = new Map()  // brief key -> { raw, ts }
const RECENT_BOARD_TTL = 25 * 60 * 1000
const RECENT_BOARD_MAX = 160
function recordBoard(rows) {
  const now = Date.now()
  for (const raw of rows) {
    if (!raw || !String(raw.symbol || '').trim()) continue
    recentBoard.set(keyFor(raw), { raw, ts: now })
  }
  // Evict expired, then oldest beyond the cap (insertion order = age order).
  for (const [k, v] of recentBoard) { if (now - v.ts > RECENT_BOARD_TTL) recentBoard.delete(k) }
  while (recentBoard.size > RECENT_BOARD_MAX) recentBoard.delete(recentBoard.keys().next().value)
}

function prune(map, max) { if (map.size > max) map.delete(map.keys().next().value) }

// ── Read persistence: the brief cache survives restarts ─────────────────────
// Boot hydration means the board paints from disk instantly after a restart
// instead of burning a 40-read LLM regen; entries carry the material hash so
// the hash-gate below keeps working across restarts too. Best-effort only.
const PERSIST_PATH = path.join(__dirname, '..', 'content', 'trending-briefs.json')
let _persistTimer = null
function schedulePersist() {
  if (_persistTimer) return
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    try {
      const now = Date.now()
      const entries = [...cache.entries()]
        .filter(([, v]) => v && v.data && now - v.ts < 24 * 60 * 60 * 1000)
        .slice(-400)
      const tmp = `${PERSIST_PATH}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(entries))
      fs.renameSync(tmp, PERSIST_PATH)
    } catch { /* best-effort */ }
  }, 5000)
  if (_persistTimer.unref) _persistTimer.unref()
}
try {
  const now = Date.now()
  for (const [k, v] of JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8'))) {
    if (v && v.data && now - v.ts < 24 * 60 * 60 * 1000) cache.set(k, v)
  }
  if (cache.size) console.log(`[trending-brief] hydrated ${cache.size} reads from disk`)
} catch { /* first boot / no file */ }

// ── Rate limits ──────────────────────────────────────────────────────────────
const ipHits = new Map()
const batchHits = new Map()
function limited(map, ip, perMin) {
  const now = Date.now()
  const arr = (map.get(ip) || []).filter((t) => now - t < 60_000)
  if (arr.length >= perMin) { map.set(ip, arr); return true }
  arr.push(now)
  map.set(ip, arr)
  prune(map, 500)
  return false
}

// ── Small helpers ────────────────────────────────────────────────────────────
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : null }
function fmtUsd(n) {
  if (n == null) return null
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}
function fmtFollowers(n) {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`
  return String(v)
}
function keyFor(t) {
  const networkId = String(t.networkId || '').replace(/[^0-9]/g, '')
  const ca = String(t.ca || t.address || '').trim().slice(0, 64)
  const symbol = String(t.symbol || '').trim().slice(0, 15)
  return `${networkId}:${(ca || symbol).toLowerCase()}`
}
const isRealCa = (a) => typeof a === 'string' && (/^0x[0-9a-fA-F]{40}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))

async function xdashJson(path, timeoutMs = 6500) {
  const res = await fetch(`${X_DASH_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${X_DASH_KEY}`,
      'x-api-key': X_DASH_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`X Dash ${res.status}`)
  return res.json()
}

// x.com path segments that are NOT usernames - /i/communities/... links were
// being parsed as the handle "@i" on the board.
const X_RESERVED = new Set(['i', 'intent', 'home', 'search', 'hashtag', 'share', 'explore', 'communities', 'status', 'compose', 'settings'])
function handleFromXUrl(url) {
  const m = String(url || '').match(/(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,20})/)
  if (!m) return null
  const h = m[1].replace(/^@/, '')
  return X_RESERVED.has(h.toLowerCase()) ? null : h
}
// Community links used to be DISCARDED by the reserved-word filter above; a
// token that organizes on an X Community instead of an account is a signal in
// itself, so capture the URL as its own field.
function communityFromXUrl(url) {
  const m = String(url || '').match(/(?:x|twitter)\.com\/i\/communities\/(\d{5,25})/i)
  return m ? `https://x.com/i/communities/${m[1]}` : null
}

// ── The token's OWN X account: profile + recent timeline ─────────────────────
// X Dash only tracks curated KOLs, so project accounts come from the Cloud Run
// tweets backend instead: followers, account age, bio, verification, and the
// last posts (what the team is actually shipping vs a dead account).
async function fetchOwnAccount(handle) {
  const h = String(handle || '').replace(/^@/, '').trim()
  if (!/^[A-Za-z0-9_]{1,20}$/.test(h)) return null
  const k = h.toLowerCase()
  const hit = accountCache.get(k)
  if (hit && Date.now() - hit.ts < ACCOUNT_TTL_MS) return hit.account
  try {
    const res = await fetch(`${TWEETS_API_BASE}/get_official_tweets?username=${encodeURIComponent(h)}&count=10`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6500),
    })
    if (!res.ok) throw new Error(`tweets ${res.status}`)
    const j = await res.json()
    const a = j && j.author
    if (!a || !a.screen_name) throw new Error('no author')
    const daysAgo = (iso) => { const t = Date.parse(iso); return isFinite(t) ? Math.max(0, (Date.now() - t) / 86400e3) : null }
    const posts = (Array.isArray(j.tweets) ? j.tweets : [])
      .map((t) => ({
        text: String(t.tweet_text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(),
        days: daysAgo(t.created_at || t.date),
        likes: Number(t.likes) || 0,
        views: Number(t.views) || 0,
      }))
      .filter((p) => p.text.length > 5)
      .slice(0, 10)
    const newestDays = posts.reduce((m, p) => (p.days != null && (m == null || p.days < m) ? p.days : m), null)
    const acctAge = daysAgo(a.created_at)
    const account = {
      handle: a.screen_name,
      followers: Number(a.counts && a.counts.followers_count) || 0,
      posts_total: Number(a.counts && a.counts.statuses_count) || null,
      verified: !!(a.account_state && a.account_state.is_blue_verified),
      bio: String(a.description || '').replace(/\s+/g, ' ').trim().slice(0, 220) || null,
      account_age_days: acctAge != null ? Math.round(acctAge) : null,
      last_post_days_ago: newestDays != null ? Math.round(newestDays * 10) / 10 : null,
      posts_last_7d: posts.filter((p) => p.days != null && p.days <= 7).length,
      recent_posts: posts.slice(0, 5).map((p) => `${p.days != null ? `${Math.round(p.days)}d ago` : ''} (${fmtFollowers(p.likes)} likes): ${p.text.slice(0, 160)}`),
    }
    accountCache.set(k, { account, ts: Date.now() })
    prune(accountCache, 600)
    return account
  } catch {
    // Negative-cache 20 min - a flaky upstream must not hammer per warm cycle.
    accountCache.set(k, { account: null, ts: Date.now() - ACCOUNT_TTL_MS + 20 * 60 * 1000 })
    return null
  }
}

// ── Name wave: the viral tweets a meme was minted to ride ───────────────────
// Memecoins launch off a live X wave ("Happy 250th, America" from @solana on
// July 4th -> a "250th" token minutes later). X Dash only knows cashtag/token
// mentions, so search raw X for the token NAME: high-reach tweets containing
// the phrase around launch time ARE the lore. X search operators pass through
// the Cloud Run backend (min_faves verified live); some results are thread
// matches that don't contain the phrase, hence the contains-check.
async function searchTweets(query, count) {
  // One retry: the Cloud Run backend cold-starts / blips under warm bursts,
  // and a single failed search used to null the WHOLE wave (cashtag trail
  // included) into the negative cache - the read then said "no X trail" for
  // tokens with a live community. 800ms backoff is cheap inside the queue.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${TWEETS_API_BASE}/search_tweets?query=${encodeURIComponent(query)}&count=${count}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`search ${res.status}`)
      const j = await res.json()
      return Array.isArray(j) ? j : []
    } catch (e) {
      if (attempt >= 1) throw e
      await new Promise((r) => setTimeout(r, 800))
    }
  }
}
// tweet_id is a snowflake: ms since epoch = (id >> 22) + Twitter epoch.
function tweetTs(id) {
  try { const n = BigInt(String(id)); return n > 0n ? Number((n >> 22n) + 1288834974657n) : null } catch { return null }
}
const normText = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
// X phrase search treats "WorldCup" as one compound token and misses every
// "World Cup" tweet - split camelCase before querying (ALL-CAPS tickers pass
// through untouched). The compact contains-check matches either form.
const deCamel = (s) => String(s || '').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
// The searchable phrase: the name unless it's too short to mean anything,
// then the bare ticker. Null kills the search (single letters, pure emoji).
function wavePhrase(name, symbol) {
  const clean = deCamel(String(name || '').replace(/https?:\/\/\S+/g, ' ')).replace(/[^\p{L}\p{N}\s.,!'-]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (normText(clean).replace(/\s/g, '').length >= 3) return clean.slice(0, 60)
  const sym = deCamel(String(symbol || '').replace(/^\$/, '').trim())
  return normText(sym).replace(/\s/g, '').length >= 3 ? sym : null
}
async function fetchNameWave(name, symbol, ageH, ca) {
  const phrase = wavePhrase(name, symbol)
  // The ticker is often the sharper meme handle (name "Happy America" with
  // symbol "250th": the wave lives under "250th") - search it too when it
  // reads as its own phrase.
  const symRaw = deCamel(String(symbol || '').replace(/^\$/, '').trim())
  const symPhrase = normText(symRaw).replace(/\s/g, '').length >= 3 && normText(symRaw) !== normText(phrase || '')
    ? symRaw.slice(0, 32) : null
  // Cashtag + contract split TOKEN tweets (the launch/announcement trail -
  // "Every Bull Needs A Pen... 65% supply to the cult") from the background
  // NAME wave. Launch tweets are small-account by nature: no reach floor.
  const cashtag = /^[A-Za-z0-9_]{2,15}$/.test(String(symbol || '').replace(/^\$/, '').trim())
    ? String(symbol || '').replace(/^\$/, '').trim() : null
  const caStr = typeof ca === 'string' && ca.trim().length >= 25 ? ca.trim() : null
  if (!phrase && !cashtag) return null
  const k = `${(phrase || '').toLowerCase()}|${(symPhrase || '').toLowerCase()}|${(cashtag || '').toLowerCase()}|${(caStr || '').toLowerCase()}`
  const hit = waveCache.get(k)
  if (hit && Date.now() - hit.ts < WAVE_TTL_MS) return hit.wave
  try {
    const shape = (rows) => rows
      .filter((t) => t && !t.is_promoted)
      .map((t) => ({
        raw: String(t.tweet_text || ''),
        who: String(t.username || '').trim() || null,
        followers: Number(t.followers) || 0,
        views: Number(t.views) || 0,
        likes: Number(t.like_count) || 0,
        ts: tweetTs(t.tweet_id),
        text: String(t.tweet_text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((t) => t.who && t.text.length > 5)
    // Token tweet = tags the cashtag or pastes the contract. Checked on RAW
    // text - contracts often live inside pump.fun URLs the cleaner strips.
    const ctagRe = cashtag ? new RegExp(`\\$${cashtag}\\b`, 'i') : null
    const isTokenTweet = (t) => !!((ctagRe && ctagRe.test(t.raw)) || (caStr && t.raw.includes(caStr)))
    // Contains-check kills thread-noise the search returns; compare COMPACT
    // forms so compound names still match spaced text ("WorldCup" vs "World Cup").
    const matchesPhrase = (t, needle) => !!needle && normText(t.raw).replace(/\s/g, '').includes(needle.replace(/\s/g, ''))
    const waveCands = []
    const tokenCands = []
    const seen = new Set()
    const add = (list, needle, { floor = false } = {}) => {
      for (const t of list) {
        const id = t.who + t.text.slice(0, 40)
        if (seen.has(id)) continue
        if (isTokenTweet(t)) { seen.add(id); tokenCands.push(t); continue }
        if (!matchesPhrase(t, needle)) continue
        if (floor && !(t.followers >= 5000 || t.views >= 20000 || t.likes >= 100)) continue
        seen.add(id)
        waveCands.push(t)
      }
    }
    // High-engagement passes first (name, then ticker), then the cashtag
    // trail; a niche meme's origin can sit under the fave bar, so a loose
    // pass (reach-floored against generic-word noise) backfills when the
    // strict ones come up dry.
    // Each query is BEST-EFFORT: the backend intermittently errors on the
    // quoted min_faves: phrase operator while the plain cashtag query works
    // fine (verified live), and one thrown phrase search used to abort the
    // whole harvest - the read then said "no X trail" for a token whose
    // community trail was one query away. Only if EVERY query fails does the
    // wave count as errored (short negative-cache in the catch below).
    let okQueries = 0
    let failNote = ''
    const tryAdd = async (run, needle, opts) => {
      try { add(shape(await run()), needle, opts); okQueries++ } catch (e) { failNote = e.message }
    }
    if (phrase) await tryAdd(() => searchTweets(`"${phrase}" min_faves:200`, 20), normText(phrase))
    if (symPhrase) await tryAdd(() => searchTweets(`"${symPhrase}" min_faves:200`, 20), normText(symPhrase))
    if (cashtag && cashtag.length >= 3) await tryAdd(() => searchTweets(`$${cashtag}`, 20), null)
    if (phrase && waveCands.length + tokenCands.length < 2) {
      await tryAdd(() => searchTweets(`"${phrase}"`, 20), normText(phrase), { floor: true })
    }
    if (okQueries === 0) throw new Error(`all wave searches failed (${failNote})`)
    if (process.env.TREND_DEBUG === '1' || failNote) {
      console.log(`[trend-wave] ${symbol}: ok=${okQueries} wave=${waveCands.length} token=${tokenCands.length}${failNote ? ` lastFail=${failNote}` : ''}`)
    }
    const launchMs = Number.isFinite(ageH) ? Date.now() - ageH * 36e5 : null
    const when = (ts) => {
      if (!ts) return ''
      if (launchMs != null && Math.abs(ts - launchMs) <= 48 * 36e5) {
        const dh = (launchMs - ts) / 36e5
        const n = Math.max(1, Math.round(Math.abs(dh)))
        return dh >= 0 ? `, posted ~${n}h before token launch` : `, posted ~${n}h after token launch`
      }
      const ageMs = Date.now() - ts
      return ageMs < 48 * 36e5 ? `, ~${Math.max(1, Math.round(ageMs / 36e5))}h ago` : `, ~${Math.round(ageMs / 864e5)}d ago`
    }
    const score = (t) => t.views + t.likes * 40 + t.followers * 0.05
    const fmt = (t) => `@${t.who} (${fmtFollowers(t.followers)} followers${t.views ? `, ${fmtFollowers(t.views)} views` : ''}${when(t.ts)}): ${t.text.slice(0, 180)}`
    const topWave = waveCands.sort((a, b) => score(b) - score(a)).slice(0, 3)
    const topToken = tokenCands.sort((a, b) => score(b) - score(a)).slice(0, 3)
    const wave = (topWave.length || topToken.length) ? {
      count: waveCands.length,
      tweets: topWave.length ? topWave.map(fmt) : null,
      token_count: tokenCands.length,
      token_tweets: topToken.length ? topToken.map(fmt) : null,
    } : null
    waveCache.set(k, { wave, ts: Date.now() })
    prune(waveCache, 500)
    return wave
  } catch {
    // Negative-cache 5 min only: this is an ERROR path (a successful-but-empty
    // search caches above with the full TTL). 30 min here starved reads of
    // their cashtag/community trail for half an hour after one backend blip.
    waveCache.set(k, { wave: null, ts: Date.now() - WAVE_TTL_MS + 5 * 60 * 1000 })
    return null
  }
}

// ── Social: REAL community tweets from X Dash ────────────────────────────────
// /api/token/{id} carries `top_mentions` at the RESPONSE ROOT; each item is
// { match, token, tweet, author, derived } with the text at tweet.full_text.
// /api/search has NO tweet texts but returns token_id -> detail fetch has them.
function harvestDetail(data) {
  const out = { tweets: [], kols: [], mentions: null, authors: null, velocity: null, handle: null }
  if (!data || typeof data !== 'object') return null
  const m = data.metrics || (data.token && data.token.metrics) || {}
  out.mentions = num(m.external_mentions_24h ?? m.mentions_24h)
  out.authors = num(m.unique_external_authors_24h ?? m.unique_authors_24h)
  out.velocity = num(m.velocity_ratio)
  const tok = data.token || {}
  out.handle = handleFromXUrl(tok.twitter_url) || String(tok.handle || '').replace(/^@/, '') || null

  const mentions = Array.isArray(data.top_mentions) ? data.top_mentions
    : Array.isArray(tok.top_mentions) ? tok.top_mentions : []
  const clean = (t) => String(t || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  out.tweets = mentions
    .map((tm) => ({
      text: clean(tm.tweet?.full_text ?? tm.tweet?.text ?? tm.text),
      who: tm.author?.screen_name || tm.author?.name || null,
      followers: Number(tm.author?.followers_count) || 0,
      likes: Number(tm.tweet?.favorite_count) || 0,
    }))
    .filter((t) => t.text.length > 15)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 6)
    .map((t) => `@${t.who || 'anon'} (${fmtFollowers(t.followers)} followers): ${t.text.slice(0, 220)}`)

  const authors = Array.isArray(data.top_authors) ? data.top_authors
    : Array.isArray(tok.top_authors) ? tok.top_authors : []
  out.kols = authors.map((a) => a && (a.screen_name || a.name)).filter(Boolean).slice(0, 5)
  return (out.tweets.length > 0 || out.mentions != null) ? out : null
}

async function gatherSocial({ cgId, symbol }) {
  const empty = { tweets: [], kols: [], mentions: null, authors: null, velocity: null, handle: null, source: null }
  if (!X_DASH_KEY) return empty
  // Strong path: direct token detail by CoinGecko id (one retry - a transient
  // X Dash flake must not demote a heavily-mentioned token to "no X presence").
  if (cgId && /^[a-z0-9-]{1,60}$/.test(cgId)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const got = harvestDetail(await xdashJson(`/api/token/${encodeURIComponent(cgId)}`))
        if (got) return { ...got, source: 'xdash-token' }
        break
      } catch { /* retry once, then fall through */ }
    }
  }
  // Search path: resolve token_id by cashtag, then pull the detail for tweets.
  try {
    if (symbol && /^[A-Za-z0-9$_.-]{1,15}$/.test(symbol)) {
      const data = await xdashJson(`/api/search?q=${encodeURIComponent(symbol)}&timeframe=24h&ranking=mentions&per_page=3`)
      const rows = Array.isArray(data && data.tokens) ? data.tokens : []
      const want = symbol.toUpperCase().replace(/^\$/, '')
      const hit = rows.find((r) => {
        const t = r.token || r
        return String(t.cashtag || t.symbol || '').toUpperCase().replace(/^\$/, '') === want
      })
      if (hit) {
        const tokenId = String(hit.token?.token_id || hit.token?.cg_id || '').trim()
        if (tokenId && /^[a-zA-Z0-9-]{1,60}$/.test(tokenId)) {
          try {
            const got = harvestDetail(await xdashJson(`/api/token/${encodeURIComponent(tokenId.toLowerCase())}`))
            if (got) return { ...got, source: 'xdash-search+detail' }
          } catch { /* keep search metrics */ }
        }
        const got = harvestDetail({ token: hit.token, metrics: hit.metrics, top_authors: hit.top_authors })
        if (got) return { ...got, source: 'xdash-search' }
      }
    }
  } catch { /* social is optional */ }
  return empty
}

// ── Profile: website + twitter from DexScreener (keyless, batched) ──────────
async function fetchDexProfiles(cas) {
  const out = new Map() // ca(lower) -> { website, twitter, telegram }
  const misses = []
  for (const ca of cas) {
    const k = String(ca || '').toLowerCase()
    if (!k) continue
    const hit = profileCache.get(k)
    if (hit && Date.now() - hit.ts < PROFILE_TTL_MS) out.set(k, hit.profile)
    else if (isRealCa(ca)) misses.push(ca)
  }
  for (let i = 0; i < misses.length; i += 24) {
    const chunk = misses.slice(i, i + 24)
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.map(encodeURIComponent).join(',')}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(9000),
      })
      if (!res.ok) continue
      const json = await res.json().catch(() => null)
      const pairs = Array.isArray(json && json.pairs) ? json.pairs : []
      const best = new Map() // ca -> { liq, pair }
      for (const p of pairs) {
        const ca = String(p.baseToken?.address || '').toLowerCase()
        if (!ca) continue
        const liq = Number(p.liquidity?.usd) || 0
        const prev = best.get(ca)
        if (!prev || liq > prev.liq) best.set(ca, { liq, pair: p })
      }
      for (const ca of chunk) {
        const k = ca.toLowerCase()
        const info = best.get(k)?.pair?.info || null
        const socials = Array.isArray(info?.socials) ? info.socials : []
        const websites = Array.isArray(info?.websites) ? info.websites : []
        // An X Community link often sits IN the twitter social slot - scan
        // every url for one instead of losing it to the handle parser.
        const allUrls = [...socials, ...websites].map((s) => s && s.url).filter(Boolean)
        const profile = {
          website: (websites.find((w) => w && w.url) || {}).url || null,
          twitter: (socials.find((s) => s && s.type === 'twitter') || {}).url || null,
          community: allUrls.map(communityFromXUrl).find(Boolean) || null,
          telegram: !!socials.some((s) => s && s.type === 'telegram'),
        }
        profileCache.set(k, { profile, ts: Date.now() })
        out.set(k, profile)
      }
      prune(profileCache, 800)
    } catch { /* profile is optional */ }
  }
  return out
}

// ── Profile fallback: Codex token details (description + socialLinks) ───────
// DexScreener's public API only carries websites/socials for tokens that paid
// for Enhanced Info - most fresh tokens return empty arrays. The server's own
// /api/token/details route is the ONLY Codex query selecting socialLinks +
// info.description; self-call it (server-side cached) for misses. Dev-first:
// in prod this route family needs its own serverless mirror anyway.
const SELF_BASE = `http://127.0.0.1:${process.env.PORT || 3001}`
// The Codex key enforces an origin allowlist; server-to-server calls carry no
// Origin ("unauthorized origin: undefined") so send the allowed one explicitly
// (same pattern as packages/server/index.js CODEX_ORIGIN).
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'
// Direct Codex GraphQL - the path that works EVERYWHERE. The standalone prod
// box mounts only /api/trending, so the /api/token/details self-call 404s
// there and used to negative-cache a null profile: the token's X/community
// link (visible in the app via Codex) never reached the read -> "no X trail"
// briefs for tokens that DO have a community. Needs CODEX_API_KEY in the env.
async function fetchCodexSocialsDirect(ca, networkId) {
  if (!process.env.CODEX_API_KEY) return null
  const res = await fetch('https://graph.codex.io/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: process.env.CODEX_API_KEY, Origin: CODEX_ORIGIN },
    body: JSON.stringify({
      query: 'query($a:String!,$n:Int!){ token(input:{address:$a,networkId:$n}){ socialLinks{twitter telegram website discord} info{description} } }',
      variables: { a: ca, n: Number(networkId) || 1399811149 },
    }),
    signal: AbortSignal.timeout(6500),
  })
  if (!res.ok) throw new Error(`codex ${res.status}`)
  const j = await res.json()
  const t = j && j.data && j.data.token
  if (!t) return null
  const links = t.socialLinks || {}
  // A community link often sits IN the twitter slot - scan every url.
  const urls = [links.twitter, links.website, links.telegram, links.discord].filter(Boolean)
  return {
    website: links.website || null,
    twitter: links.twitter || null,
    community: urls.map(communityFromXUrl).find(Boolean) || null,
    description: (t.info && typeof t.info.description === 'string' && t.info.description.trim()) ? t.info.description.trim().slice(0, 400) : null,
  }
}
async function fetchCodexProfile(ca, networkId) {
  const k = `cx:${String(ca).toLowerCase()}`
  const hit = profileCache.get(k)
  if (hit && Date.now() - hit.ts < PROFILE_TTL_MS) return hit.profile
  // 1. Self-call (dev: rides the server's Codex cache). 2. Direct GraphQL
  // (the only working path on the standalone box).
  let profile = null
  try {
    const res = await fetch(`${SELF_BASE}/api/token/details?address=${encodeURIComponent(ca)}&networkId=${encodeURIComponent(networkId)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6500),
    })
    if (!res.ok) throw new Error(`details ${res.status}`)
    const j = await res.json()
    profile = {
      website: (j && j.socials && j.socials.website) || null,
      twitter: (j && j.socials && j.socials.twitter) || null,
      community: communityFromXUrl(j && j.socials && j.socials.twitter) || null,
      description: (j && typeof j.description === 'string' && j.description.trim()) ? j.description.trim().slice(0, 400) : null,
    }
  } catch {
    try { profile = await fetchCodexSocialsDirect(ca, networkId) } catch { profile = null }
  }
  if (profile) {
    profileCache.set(k, { profile, ts: Date.now() })
    prune(profileCache, 800)
    return profile
  }
  profileCache.set(k, { profile: null, ts: Date.now() - PROFILE_TTL_MS + 10 * 60 * 1000 })
  return null
}

// ── Website scrape: title + meta/og description + body snippet ──────────────
function privateHost(host) {
  if (!host || !host.includes('.')) return true
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  return false
}
async function scrapeSite(url) {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) return null
    const k = u.origin + u.pathname
    const hit = siteCache.get(k)
    if (hit && Date.now() - hit.ts < SITE_TTL_MS) return hit.site
    const res = await fetch(u.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Accept: 'text/html' },
      signal: AbortSignal.timeout(3500),
      redirect: 'follow',
    })
    if (!res.ok) { siteCache.set(k, { site: null, ts: Date.now() }); return null }
    const html = (await res.text()).slice(0, 50000)
    const pick = (re) => { const m = html.match(re); return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 200) : null }
    const site = {
      title: pick(/<title[^>]*>([^<]{2,300})<\/title>/i),
      description:
        pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{5,400})["']/i) ||
        pick(/<meta[^>]+content=["']([^"']{5,400})["'][^>]+name=["']description["']/i) ||
        pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{5,400})["']/i) ||
        pick(/<meta[^>]+content=["']([^"']{5,400})["'][^>]+property=["']og:description["']/i),
      snippet: (() => {
        const body = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z#0-9]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        return body.length > 40 ? body.slice(0, 400) : null
      })(),
      community: communityFromXUrl(html),
      twitter: (() => {
        // Many sites only link X in the footer - a handle DexScreener/Codex
        // missed is still a handle we can analyze.
        const m = html.match(/(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,20})/g) || []
        for (const link of m) { const h = handleFromXUrl(link); if (h) return h }
        return null
      })(),
    }
    const any = site.title || site.description || site.snippet ? site : null
    siteCache.set(k, { site: any, ts: Date.now() })
    prune(siteCache, 500)
    return any
  } catch { return null }
}

// ── Context + prompt (shared by single + batch) ──────────────────────────────
function statsOf(src) {
  return {
    symbol: String(src.symbol || '').trim().slice(0, 15),
    name: String(src.name || '').slice(0, 60) || null,
    chain: String(src.chain || '').slice(0, 12) || null,
    market_cap: fmtUsd(num(src.mcap)),
    volume_24h: fmtUsd(num(src.vol24)),
    liquidity: fmtUsd(num(src.liq)),
    change_24h_pct: num(src.change24),
    change_1h_pct: num(src.change1h),
    pair_age_hours: num(src.ageH),
  }
}
function handleOf(social, profile, site) {
  return social.handle || (profile ? handleFromXUrl(profile.twitter) : null) || (site && site.twitter) || null
}

// Meme tokens are minted off same-day events; give the LLM real dates plus a
// small notable-day table so name-date lore ("250th" minted on July 4th 2026)
// connects deterministically instead of hoping a 7B knows the calendar.
const NOTABLE_DAYS = {
  '01-01': "New Year's Day",
  '02-14': "Valentine's Day",
  '04-01': "April Fools' Day",
  '07-04': 'US Independence Day',
  '10-31': 'Halloween',
  '12-24': 'Christmas Eve',
  '12-25': 'Christmas Day',
  '12-31': "New Year's Eve",
}
const NOTABLE_SPECIAL = {
  '2026-07-04': "US Independence Day - America's 250th birthday (semiquincentennial)",
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function dayNote(iso) { return NOTABLE_SPECIAL[iso] || NOTABLE_DAYS[iso.slice(5)] || null }
function dateLine(ms) {
  const d = new Date(ms)
  if (!isFinite(d.getTime())) return null
  const iso = d.toISOString().slice(0, 10)
  return `${iso} (${WEEKDAYS[d.getUTCDay()]})`
}
// The holiday note enters the context ONLY when the token's name/ticker
// actually shares a word with it - an ungated note is parrot fuel: a 7B wrote
// "celebrates America's 250th" for EVERY token launched on July 4th, BONK
// included. Same philosophy as detectDerivative: the server proves the
// connection, the LLM only phrases it.
function launchNoteFor(name, symbol, ms) {
  const d = new Date(ms)
  if (!isFinite(d.getTime())) return null
  const note = dayNote(d.toISOString().slice(0, 10))
  if (!note) return null
  const blob = normText(`${name || ''} ${symbol || ''}`)
  const compact = blob.replace(/\s/g, '')
  const noteText = normText(note)
  const hit = noteText.split(' ').some((w) => w.length >= 3 && compact.includes(w))
    || blob.split(' ').some((w) => w.length >= 3 && noteText.includes(w))
  return hit ? note : null
}

function contextOf(stats, social, profile, site, account, safety, wave) {
  const community = (profile && profile.community) || (site && site.community) || null
  // `launched` replaces raw pair_age_hours in the LLM material: a 7B read
  // "15985 hours" as a fresh pair; "(~666d ago)" it gets right.
  const { pair_age_hours: ageH, ...restStats } = stats
  const launchMs = ageH != null ? Date.now() - ageH * 36e5 : null
  const launchNote = launchMs != null ? launchNoteFor(stats.name, stats.symbol, launchMs) : null
  return {
    ...restStats,
    // Real dates: memecoins are minted off same-day events, and the name only
    // decodes against the calendar ("250th" + July 4th 2026). The notable-day
    // note is attached only when the name matches it (launchNoteFor).
    today: dateLine(Date.now()),
    launched: launchMs != null
      ? `${dateLine(launchMs)} (~${ageH >= 48 ? `${Math.round(ageH / 24)}d` : `${Math.round(ageH)}h`} ago)${launchNote ? ` - ${launchNote}, and the token name matches it` : ''}`
      : null,
    project_description: (profile && profile.description) || null,
    website: site
      ? { url: (profile && profile.website) || null, title: site.title, description: site.description, body_snippet: site.snippet }
      : ((profile && profile.website) ? { url: profile.website } : null),
    twitter_handle: handleOf(social, profile, site),
    // The token's OWN X account (fetchOwnAccount) - team alive vs dead is alpha.
    x_account: account || null,
    // Token organizes on an X Community (community-led flag).
    x_community_url: community,
    // RugCheck danger names (holder concentration / LP / authorities).
    safety_flags: (safety && Array.isArray(safety.dangers) && safety.dangers.length) ? safety.dangers.slice(0, 4) : null,
    mentions_24h: social.mentions,
    unique_authors_24h: social.authors,
    attention_velocity: social.velocity,
    top_kols: social.kols,
    community_tweets: social.tweets,
    // Tweets tagging the cashtag / pasting the contract - the launch trail.
    x_token_tweets: (wave && wave.token_tweets) || null,
    // High-reach tweets containing the token NAME around launch (raw X search)
    // - the wave a meme was minted to ride, NOT necessarily tweets about it.
    x_name_wave: (wave && wave.tweets) || null,
  }
}

// Prompt shape proven on small local models (llama3.2:3b): explicit output
// template with placeholders, a hard never-echo rule, and the user message
// framed as MATERIAL. Long analyst-prose prompts made 3B echo the input.
const PROMPT_RULES = [
  "You are the desk analyst inside Spectre AI's trading terminal. The user gives you research MATERIAL about a trending token; you write a NEW short read - never repeat, quote, or echo the input JSON.",
  'Voice: terse, sharp, zero hype, zero financial advice, no emojis. You flag a setup to a trader; you never write website copy.',
  'Use ONLY facts from the MATERIAL plus common cultural knowledge about what a name references. Never invent partnerships, listings, exchange events, or price causes.',
  'ABSOLUTE BAN: never write any market number - no percentages, no dollar figures, no multiples like "3x". The board shows them in adjacent columns. Writing "up 300%" or "$2M mcap" is a FAILURE.',
  'The number ban covers MARKET metrics only. Numbers that are part of the token\'s name or ticker, a quoted tweet phrase, follower reach, or a date are not market numbers - write them exactly; never drop or censor digits that belong to a name.',
  'ABSOLUTE BAN: never describe the price move in words - the trader is looking at the chart. Naming the driver is your whole job.',
  '"why" = the ALPHA in 2-3 tight sentences that answer three things: (1) the strongest LIVE driver - named KOLs with their reach AND WHAT they are actually saying (quote or paraphrase the claim, never just "KOLs are pushing it"), the team shipping (what exactly), a community or wave organizing (around what); (2) the meta - when board_meta, x_token_tweets or x_name_wave show a family, cult, event or wave, say which one and how this token fits it; (3) why NOW - what changed today (launch timing, an event, an account waking up, a parent token running). A single generic sentence is a FAILURE. What the project claims to BE gets at most one short trailing clause. Opening with website-tagline language ("a platform/protocol/layer/ecosystem for...") is a FAILURE.',
  '"why" is NEVER null or empty. When no live signal exists in the material, decode the name/ticker reference and say the flow is unexplained - "Unexplained on-chain flow; name reads as <decode>; no site, no X trail" is a valid why.',
  'x_account is the project\'s OWN X account. Read it: recent_posts show what the team ships and how the crowd responds; last_post_days_ago over 7 with attention spiking now means third-party flow, say so; account_age_days under 30 on a hyped token is a flag; missing x_account plus no site means unverified identity. Judge, do not inventory.',
  'x_community_url means the token organizes through an X Community instead of a normal account - a community-led token; say it when true. When it is set, the x_token_tweets ARE that community\'s members posting: read the community\'s identity and story from them (what they rally around, the spirit they claim, who they name-drop) and tell it - never say "no X trail" while community posts exist.',
  'When community_tweets exist, judge them: genuine discussion vs engagement-farming (giveaway bait, identical phrasing, reply-farm patterns) - name which pattern you see. They come from symbol search and can merely CONTAIN the name text: a tweet that only shares the phrase is wave evidence, not an endorsement - never present its author as a KOL pushing the token.',
  'x_token_tweets = tweets that tag the token\'s ticker as a cashtag or paste its contract address - the launch/announcement trail. They usually EXPLAIN why the token exists (who is behind it, what cult or meta it belongs to, the supply story) and OUTRANK x_name_wave and any mainstream chatter for the "why". Quote their claim; never invent beyond it.',
  'board_meta = other tokens trending on this SAME board right now whose names share this token\'s theme - a live meta family the token belongs to. Say it plainly ("part of the <theme> meta trending alongside <member>").',
  'x_name_wave = high-reach tweets containing the token NAME around launch, found by raw X search - usually NOT about the token itself. Several of them echoing the SAME phrase, event, or meme = the wave the token was minted to ride: say what the wave is and name the biggest account posting it. A mixed bag of unrelated posts sharing one word is NOT a wave - never claim a wave tweet drives the token unless the tweets cohere; ignore incoherent ones. A name that is also everyday vocabulary (sports, news, slang) always has mainstream chatter; that chatter is NEVER the driver when x_token_tweets or board_meta explain the name - read the name through them instead.',
  '"launched" and "today" are real dates. When "launched" carries an event note, the server has verified the token name matches that event - that connection IS the lore, state it plainly. Without such a note, launching on some date proves NOTHING about the token: never claim a holiday or event connection the material does not show.',
  'CERTAINTY RULE: name a specific film, book, show, or person ONLY when the reference is unmistakable from the token name itself (ELON -> Elon Musk, HAL-9000 -> the AI from 2001: A Space Odyssey). When not certain, stay generic - "a bull-market meme", "a sci-fi AI reference" - inventing a title, year, or author is a FAILURE.',
  '"lore" = the cultural story in 1-2 sentences: decode the name and reference - WHO or WHAT it points at (the person, cult figure, meme, event), and why the crowd cares right now. Append "(inferred)" when decoded from the name alone. Null is a last resort reserved for names that decode to nothing AND tweets that show nothing - a trending memecoin almost always has lore.',
  '"risk" = the sharpest concrete caution in the material, priority order: safety_flags (state them plainly - holder concentration, LP, mint authority), pair age if fresh, liquidity thin against mcap, single-KOL dependence, dead or brand-new team account, engagement-farmed hype, derivative of a parent that can fade.',
  'NEVER waste the read on observations like "has a website but no community" - when material is thin, decode the name, say chatter is thin, and flag identity as unverified.',
  'Vague filler is a FAILURE: never write "community organizing", "attention spiking", or "gaining traction" without naming the specific meme, phrase, event, account, or community behind it.',
  'confidence = high only when several real tweets, a name-matching wave, an active own account, or a live community back the read.',
]
const PROMPT_SINGLE = PROMPT_RULES.concat(
  'Output STRICT JSON only, nothing else: {"why": "<2-3 sentences>", "lore": "<1-2 sentences or null>", "risk": "<1 short sentence>", "confidence": "high|medium|low"}.'
).join(' ')
// Bust cached reads whenever the prompt contract changes - the material hash
// mixes this in, so every read regenerates once under the new prompt.
const PROMPT_V = 'p4'
const PROMPT_BATCH = PROMPT_SINGLE
// Appended ONLY when the server has PROVEN a parent token - small models
// parrot any vocabulary they see, so the base prompt never mentions it.
const DERIV_ADDON = ' MATERIAL contains "derivative_of" naming the parent token: open your "why" with "Beta play on <parent symbol>" and state the name echo in plain words.'
// Appended ONLY when the server has PROVEN a board family - a 7B otherwise
// keeps reading "bullpen" as baseball even with the Ansem cult trail in hand.
const metaAddon = (bm) => ` MATERIAL contains "board_meta": this token belongs to the live "${bm.theme}" family trending on this same board (${bm.tokens.slice(0, 3).join(', ')}). Read the name through that family - its everyday meaning (sports, news, slang) is a decoy here. Open your "why" with the family connection, then use x_token_tweets (the launch trail) for who or what is behind it.`
const promptFor = (base, ctx) =>
  base + (ctx && ctx.derivative_of ? DERIV_ADDON : '') + (ctx && ctx.board_meta ? metaAddon(ctx.board_meta) : '')

// ── Rules fallback v3: live signals first, identity last ────────────────────
function composeRulesBrief(ctx, social, raw) {
  const bits = []
  if (ctx.board_meta && Array.isArray(ctx.board_meta.tokens) && ctx.board_meta.tokens.length) {
    bits.push(`part of the "${ctx.board_meta.theme}" meta trending now (${ctx.board_meta.tokens.slice(0, 2).join(', ')})`)
  }
  const tokenTw = Array.isArray(ctx.x_token_tweets) ? ctx.x_token_tweets : []
  if (tokenTw.length) {
    const who = tokenTw.map((s) => (String(s).match(/^@[A-Za-z0-9_]+/) || [])[0]).filter(Boolean).slice(0, 2)
    bits.push(`ticker tagged on X${who.length ? ` by ${who.join(', ')}` : ''}`)
  }
  const wave = Array.isArray(ctx.x_name_wave) ? ctx.x_name_wave : []
  if (wave.length) {
    const who = wave.map((s) => (String(s).match(/^@[A-Za-z0-9_]+/) || [])[0]).filter(Boolean).slice(0, 2)
    bits.push(`name matches a viral phrase big accounts are posting${who.length ? ` (${who.join(', ')})` : ''}`)
  }
  if (social.mentions > 0) {
    const kols = Array.isArray(social.kols) ? social.kols : []
    bits.push(`${social.mentions} X mentions in 24h${kols.length ? ` (top: ${kols.slice(0, 2).join(', ')})` : ''}`)
  }
  const acct = ctx.x_account
  if (acct) {
    const act = acct.last_post_days_ago == null ? 'activity unknown'
      : acct.last_post_days_ago <= 2 ? 'posting daily'
      : acct.last_post_days_ago <= 7 ? `last post ${Math.round(acct.last_post_days_ago)}d ago`
      : `silent ${Math.round(acct.last_post_days_ago)}d`
    bits.push(`@${acct.handle} (${fmtFollowers(acct.followers)} followers) ${act}`)
  } else if (ctx.twitter_handle) {
    bits.push(`@${ctx.twitter_handle}`)
  }
  if (ctx.x_community_url) bits.push('organizes via an X Community')
  const ageHours = num(raw.ageH)
  if (ageHours != null) {
    const note = launchNoteFor(raw.name, raw.symbol, Date.now() - ageHours * 36e5)
    if (note) bits.push(`name matches its launch day: ${note}`)
  }
  const idText = (ctx.website && (ctx.website.description || ctx.website.title)) || ctx.project_description || null
  if (idText) bits.push(`"${String(idText).slice(0, 90)}"`)
  const why = bits.length
    ? bits.join(' · ') + '.'
    : 'No site, no X presence found - pure on-chain flow; identity unverified.'
  const liqN = num(raw.liq)
  const mcapN = num(raw.mcap)
  const ageH = num(raw.ageH)
  let risk = 'Momentum at this size fades fast.'
  if (Array.isArray(ctx.safety_flags) && ctx.safety_flags.length) risk = `RugCheck flags: ${ctx.safety_flags.slice(0, 2).join('; ')}.`
  else if (ageH != null && ageH <= 48) risk = `Pair is ${ageH}h old - fresh launches carry real rug risk.`
  else if (liqN != null && mcapN > 0 && liqN / mcapN < 0.15) risk = `Liquidity ${fmtUsd(liqN)} vs ${fmtUsd(mcapN)} mcap - exits get expensive.`
  return { why, lore: null, risk, confidence: 'low' }
}

// Mechanical enforcement of the numbers ban: small models still slip "up
// 337%" into prose. Sentences containing % / multiples (and $-figures in
// why/lore) are dropped outright; an emptied "why" falls back to rules.
const PCT_LEAK = /[+-]?\d[\d.,]*\s*%|\b\d+(?:\.\d+)?x\b/i
const USD_LEAK = /\$\s?\d/
function scrubNumbers(text, { allowUsd = false, allowPct = false } = {}) {
  if (typeof text !== 'string' || !text) return text
  const leaky = (t) => (!allowPct && PCT_LEAK.test(t)) || (!allowUsd && USD_LEAK.test(t))
  if (!leaky(text)) return text
  const kept = text.split(/(?<=[.!?])\s+/).filter((sent) => !leaky(sent))
  return kept.join(' ').trim() || null
}

// Price-action-in-words leak ("24-hour price surge", "rallying today"): a
// movement verb NEAR a price/timeframe word carries zero alpha - the columns
// already show the move. Sentences naming a driver survive ("KOLs coordinating
// a pump" has no price/timeframe word). Backstops the prompt ban mechanically.
const MOVE_WORDS = /\b(surg\w*|rall\w*|spik\w*|soar\w*|skyrocket\w*|explod\w*|parabolic|mooning|pump\w*|jump\w*|climb\w*)\b/i
const PRICE_CTX = /\b(price|priced|chart|market ?cap|mcap|value|valuation|24[- ]?h(?:our)?s?|intraday|overnight|today|session|daily|weekly)\b/i
function scrubPriceTalk(text) {
  if (typeof text !== 'string' || !text) return text
  const leaky = (t) => MOVE_WORDS.test(t) && PRICE_CTX.test(t)
  if (!leaky(text)) return text
  const kept = text.split(/(?<=[.!?])\s+/).filter((sent) => !leaky(sent))
  return kept.join(' ').trim() || null
}

// When the server proved NO parent token, any "beta play"/"derivative"
// sentence the model wrote is vocabulary parroting - drop those sentences.
const DERIV_LEAK = /beta play|derivative/i
function stripDerivativeClaims(brief) {
  const clean = (t) => {
    if (typeof t !== 'string' || !DERIV_LEAK.test(t)) return t
    const kept = t.split(/(?<=[.!?])\s+/).filter((sent) => !DERIV_LEAK.test(sent))
    return kept.join(' ').trim() || null
  }
  return { ...brief, why: clean(brief.why), lore: clean(brief.lore) }
}

// Board context for derivative/beta-play detection ("The Black Calf" next to
// "The Black Bull"). Set by each batch call; reused by the single route.
let _lastBoardContext = []
let _lastBoardRows = []
function buildBoardContext(list) {
  const all = list.filter((t) => t && t.symbol)
  // Only a REAL board refreshes the stashes - warmer slices (6 rows) and
  // scroll batches must reuse the last full board, or derivative/meta
  // detection would compare against a sliver.
  if (all.length >= 30) {
    _lastBoardRows = all.slice(0, 120).map((t) => ({ symbol: String(t.symbol).slice(0, 15), name: String(t.name || '').slice(0, 40) }))
    _lastBoardContext = [...all]
      .sort((a, b) => (num(b.mcap) || 0) - (num(a.mcap) || 0))
      .slice(0, 10)
      .map((t) => ({ symbol: String(t.symbol).slice(0, 15), name: String(t.name || '').slice(0, 40), mcap: fmtUsd(num(t.mcap)), _mcapRaw: num(t.mcap) || 0 }))
  }
  return _lastBoardContext
}

// Deterministic derivative/beta-play detection - the LLM only PHRASES what
// this proves, it never judges. A derivative is a SMALLER token whose
// symbol contains a bigger board token's symbol (BABYANSEM > ANSEM) or whose
// name shares a distinctive word with a bigger board token's name
// ("The Black Calf" / "The Black Bull").
const GENERIC_WORDS = new Set(['TOKEN', 'OFFICIAL', 'SOLANA', 'NETWORK', 'PROTOCOL', 'FINANCE', 'CRYPTO', 'WORLD', 'MONEY', 'SYSTEM'])
function sigWords(name) {
  return String(name || '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 5 && !GENERIC_WORDS.has(w))
}
function detectDerivative(symbol, name, mcap, boardCtx) {
  const S = String(symbol || '').toUpperCase()
  const own = num(mcap) || 0
  for (const r of boardCtx) {
    const rs = String(r.symbol || '').toUpperCase()
    if (!rs || rs === S) continue
    if ((r._mcapRaw || 0) < Math.max(own * 3, 1_000_000)) continue // parent must be meaningfully bigger
    if (S.includes(rs) && rs.length >= 3) return { symbol: r.symbol, name: r.name, mcap: r.mcap }
    const shared = sigWords(name).filter((w) => sigWords(r.name).includes(w))
    if (shared.length >= 1) return { symbol: r.symbol, name: r.name, mcap: r.mcap }
  }
  return null
}

// ── Ghost-volume gate: big flow + zero token-specific social = manufactured ──
// The IRAN case (2ti884..., 2026-07-04): $11.4M volume and 37K txns in 9
// hours, LP 100% unlocked, missing metadata - and not ONE cashtag tweet,
// X-Dash mention, KOL or community anywhere. A real trending meme always has
// a crowd; volume without one is wash. The warmer researches every board
// token, so this flags ghosts within one cycle; the engine sweep and
// /api/trending/safety consume the flags. Redemption path: any later research
// pass that finds real social clears the flag immediately.
const GHOST_TTL_MS = 2 * 60 * 60 * 1000
const ghostMints = new Map() // mint -> { ts, reason }
function isGhostMint(ca) {
  const g = ghostMints.get(ca)
  if (!g) return false
  if (Date.now() - g.ts > GHOST_TTL_MS) { ghostMints.delete(ca); return false }
  return true
}
function evalGhost(raw, ctx, safety) {
  const ca = String(raw.ca || raw.address || '')
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) return
  const hasSocial = (Number(ctx.mentions_24h) > 0)
    || (Array.isArray(ctx.community_tweets) && ctx.community_tweets.length > 0)
    || (Array.isArray(ctx.top_kols) && ctx.top_kols.length > 0)
    || (Array.isArray(ctx.x_token_tweets) && ctx.x_token_tweets.length > 0)
    || !!ctx.x_community_url
  if (hasSocial) { ghostMints.delete(ca); return }
  // Prior-evidence guard: if ANY earlier read of this token found real social,
  // a zero-social pass is more likely an X-Dash flake than a ghost - skip.
  const prevG = (cache.get(keyFor(raw)) || {}).data && cache.get(keyFor(raw)).data.grounding
  if (prevG && ((prevG.tweets > 0) || (prevG.mentions_24h > 0) || (prevG.kols > 0) || (prevG.token_tweets > 0) || prevG.community)) return
  const ageH = num(raw.ageH)
  const vol = num(raw.vol24)
  const sym = String(raw.symbol || '').trim()
  if (ageH == null || ageH > 48) return                    // fresh tokens only
  if (vol == null || vol < 2_000_000) return               // big claimed flow only
  if (!/^[A-Za-z][A-Za-z0-9_]{2,14}$/.test(sym)) return    // cashtag must be checkable ($250th is not)
  if (!safety || !safety.checked) return                   // RugCheck must have answered (fail-open)
  const lpUnlocked = safety.lpLocked != null && safety.lpLocked < 10
  if (!(lpUnlocked || safety.noMeta)) return
  const reason = `$${Math.round(vol / 1e6)}M volume at ${Math.round(ageH)}h with zero social footprint${lpUnlocked ? ', LP unlocked' : ''}${safety.noMeta ? ', no metadata' : ''}`
  ghostMints.set(ca, { ts: Date.now(), reason })
  prune(ghostMints, 300)
  console.log(`[trend-ghost] ${sym} ${ca.slice(0, 8)}… flagged - ${reason}`)
}

// Meta/family detection - the derivative rule needs a 3x-BIGGER parent, but
// cult families trend as a same-sized swarm ("bullpen" next to ANSEM "The
// Black Bull", ANSUM, Bullcoin - none 3x anything). A token whose name shares
// a distinctive word (prefix-tolerant: BULLPEN~BULL) with >= 2 OTHER board
// rows is part of a live meta, and that board context IS the name's real
// meaning - it beats any mainstream reading ("bullpen" = baseball).
const META_GENERIC = new Set([...GENERIC_WORDS, 'COIN', 'MEME', 'BABY', 'MOON', 'PUMP', 'CASH'])
function metaWords(s) {
  return normText(s).toUpperCase().split(' ').filter((w) => w.length >= 4 && !META_GENERIC.has(w))
}
function detectBoardMeta(symbol, name, rows) {
  const S = String(symbol || '').toUpperCase()
  const own = metaWords(`${name || ''} ${symbol || ''}`)
  if (!own.length) return null
  const groups = new Map()
  for (const r of rows) {
    if (!r || String(r.symbol || '').toUpperCase() === S) continue
    let theme = null
    for (const w of metaWords(`${r.name || ''} ${r.symbol || ''}`)) {
      for (const o of own) {
        if (w === o || w.startsWith(o) || o.startsWith(w)) { theme = w.length <= o.length ? w : o; break }
      }
      if (theme) break
    }
    if (!theme) continue
    const g = groups.get(theme) || []
    if (!g.some((x) => x.symbol === r.symbol)) g.push(r)
    groups.set(theme, g)
  }
  let best = null
  for (const [theme, members] of groups) {
    if (members.length >= 2 && (!best || members.length > best.members.length)) best = { theme, members }
  }
  if (!best) return null
  return {
    theme: best.theme.toLowerCase(),
    tokens: best.members.slice(0, 4).map((r) => `${r.symbol} (${String(r.name || '').slice(0, 30)})`),
  }
}

// Parse the model's JSON read - STRICT first, then a field-rescue pass for
// truncated output. gemini-3's thinking counts against maxOutputTokens, and a
// long read can clip the closing brace: the text is a near-complete JSON
// fragment whose "why" is fully written. Discarding it cost real gemini reads
// (they fell to rules with "[trending-briefs] unparseable LLM text"). The
// rescue regex captures each string field up to the next unescaped quote OR
// end-of-fragment, so a mid-string clip still yields the written part.
function parseBriefLoose(text) {
  const t = String(text || '')
  try {
    const m = t.match(/\{[\s\S]*\}/)
    const o = JSON.parse(m ? m[0] : t)
    if (o && typeof o === 'object') return o
  } catch { /* fall through to rescue */ }
  const grab = (k) => {
    const m = t.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))
    if (!m) return null
    const v = m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
    return v || null
  }
  const why = grab('why')
  if (!why) return null
  return { why, lore: grab('lore'), risk: grab('risk'), confidence: grab('confidence') || 'medium', symbol: grab('symbol') }
}

function packageData(brief, social, site, provider, extras) {
  // Small models write the LITERAL strings "None"/"null"/"N/A" for empty fields.
  const trim = (v, max) => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    if (!t || /^(none|null|n\/a|na|unknown)\.?$/i.test(t)) return null
    return t.slice(0, max)
  }
  // Mechanical risk backstop: a model that dropped the risk line never gets
  // to hide RugCheck danger flags - state them verbatim.
  const flags = extras && extras.safety && Array.isArray(extras.safety.dangers) ? extras.safety.dangers : []
  // Holder-concentration percentages are legitimate risk content (the ban
  // targets price moves), so risk alone also allows %.
  const risk = trim(scrubNumbers(brief.risk, { allowUsd: true, allowPct: true }), 200)
    || (flags.length ? `RugCheck flags: ${flags.slice(0, 2).join('; ')}.` : null)
  return {
    brief: {
      why: trim(scrubPriceTalk(scrubNumbers(brief.why)), 460),
      lore: trim(scrubPriceTalk(scrubNumbers(brief.lore)), 280),
      risk,
      confidence: ['high', 'medium', 'low'].includes(brief.confidence) ? brief.confidence : 'low',
    },
    grounding: {
      tweets: (social.tweets || []).length,
      kols: (social.kols || []).length,
      mentions_24h: social.mentions ?? null,
      site: !!site,
      handle: social.handle || null,
      account: !!(extras && extras.account),
      community: !!(extras && extras.community),
      safety: (extras && extras.safety && extras.safety.dangers && extras.safety.dangers.length) || 0,
      name_wave: (extras && extras.wave && extras.wave.count) || 0,
      token_tweets: (extras && extras.wave && extras.wave.token_count) || 0,
      meta: (extras && extras.meta) || null,
      source: social.source || null,
    },
    provider,
    model: (extras && extras.model) || null,
  }
}
function cacheSet(key, data, provider, mhash) {
  cache.set(key, { data, ts: provider === 'rules' ? Date.now() - CACHE_TTL_MS + RULES_TTL_MS : Date.now(), mhash: mhash || null })
  prune(cache, 400)
  schedulePersist()
}

// ── Material hash: only re-write a read when its STORY changed ──────────────
// Hashes the read-relevant material and strips everything that churns every
// poll (market numbers, "~2h ago" relative ages, reach counts) - a stable
// token re-hashes identical all day and costs ~one LLM call per day (the
// `today` date is in the hash), not one per 15-minute expiry.
function materialHash(ctx) {
  const stripParens = (s) => String(s || '').replace(/\([^)]*\)/g, '').trim()
  const acct = ctx.x_account
  const stable = {
    pv: PROMPT_V,
    // The read is keyed to the model that writes it - a model switch (e.g.
    // 2.5-flash -> gemini-3-flash-preview) invalidates the hash so the board
    // regenerates on the SAME brain instead of serving stale cross-model reads.
    mdl: BRIEF_GEMINI_MODEL,
    s: ctx.symbol,
    n: ctx.name,
    d: String(ctx.today || '').slice(0, 10),
    ln: String(ctx.launched || '').replace(/\s*\(~[^)]*\)/g, ''),
    m: ctx.mentions_24h != null ? Math.round(Math.log2(Number(ctx.mentions_24h) + 1)) : null,
    k: ctx.top_kols || null,
    ct: (ctx.community_tweets || []).map(stripParens),
    tt: (ctx.x_token_tweets || []).map(stripParens),
    w: (ctx.x_name_wave || []).map(stripParens),
    a: acct ? {
      h: acct.handle,
      alive: acct.last_post_days_ago == null ? 'na' : acct.last_post_days_ago <= 2 ? 'daily' : acct.last_post_days_ago <= 7 ? 'weekly' : 'silent',
      p: (acct.recent_posts || []).slice(0, 2).map((p) => String(p).split(': ').slice(1).join(': ')),
    } : null,
    site: ctx.website ? [ctx.website.title, ctx.website.description] : null,
    cu: ctx.x_community_url || null,
    sf: ctx.safety_flags || null,
    dv: ctx.derivative_of ? ctx.derivative_of.symbol : null,
    bm: ctx.board_meta ? [ctx.board_meta.theme, ...(ctx.board_meta.tokens || [])] : null,
  }
  return crypto.createHash('md5').update(JSON.stringify(stable)).digest('hex').slice(0, 16)
}

// ── GET /api/trending/brief - single token (popover) ────────────────────────
router.get('/brief', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().slice(0, 15)
  if (!symbol) return res.status(400).json({ error: 'symbol required' })
  const key = keyFor(req.query)
  // Register demand so the (now demand-gated) board warmer re-arms even for a
  // client that only ever opens single-token dossiers.
  recordBoard([{ ...req.query }])

  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true })
  }
  // Stale-while-revalidate: serve the known read instantly, refresh behind.
  if (cached && cached.data && Date.now() - cached.ts < STALE_SERVE_MS) {
    queueBackgroundGeneration([{ ...req.query }])
    return res.json({ ...cached.data, cached: true, stale: true })
  }
  if (inflight.has(key)) {
    try { return res.json(await inflight.get(key)) } catch { /* fall through */ }
  }
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  if (limited(ipHits, ip, 10)) return res.status(429).json({ error: 'Slow down - 10 briefs/min' })

  const p = (async () => {
    const stats = statsOf(req.query)
    const ca = String(req.query.ca || '').trim()
    const [social, profiles, wave] = await Promise.all([
      gatherSocial({ cgId: String(req.query.cgId || '').trim().toLowerCase(), symbol }),
      isRealCa(ca) ? fetchDexProfiles([ca]) : Promise.resolve(new Map()),
      fetchNameWave(req.query.name, symbol, num(req.query.ageH), ca),
    ])
    let profile = profiles.get(ca.toLowerCase()) || null
    if (isRealCa(ca) && !(profile && (profile.website || profile.twitter))) {
      const cx = await fetchCodexProfile(ca, String(req.query.networkId || ''))
      if (cx) profile = { ...(profile || {}), website: profile?.website || cx.website, twitter: profile?.twitter || cx.twitter, community: profile?.community || cx.community, description: cx.description }
    }
    const site = profile && profile.website ? await scrapeSite(profile.website) : null
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)
    const [account, safetyMap] = await Promise.all([
      (async () => { const h = handleOf(social, profile, site); return h ? fetchOwnAccount(h) : null })(),
      isSol ? rugcheckBatch([ca], { budgetMs: 3500 }).catch(() => new Map()) : Promise.resolve(new Map()),
    ])
    const safety = safetyMap.get(ca) || null
    const context = contextOf(stats, social, profile, site, account, safety, wave)
    context.derivative_of = detectDerivative(symbol, req.query.name, req.query.mcap, _lastBoardContext)
    context.board_meta = detectBoardMeta(symbol, req.query.name, _lastBoardRows)
    evalGhost(req.query, context, safety)

    // Hash-gate: unchanged material -> reuse the last LLM read, skip the call.
    // Ollama-era reads self-upgrade once a real provider is configured.
    const mhash = materialHash(context)
    const prev = cache.get(key)
    if (prev && prev.mhash && prev.mhash === mhash && prev.data && prev.data.provider && prev.data.provider !== 'rules'
      && !(prev.data.provider === 'ollama' && process.env.GEMINI_API_KEY)) {
      cacheSet(key, prev.data, prev.data.provider, mhash)
      return { ...prev.data, cached: true }
    }

    const r = await chat({
      messages: [
        { role: 'system', content: promptFor(PROMPT_SINGLE, context) },
        { role: 'user', content: 'MATERIAL: ' + JSON.stringify(context) },
      ],
      // 'smart' tier: the read IS the product - groq/cerebras=llama-70b,
      // anthropic=sonnet, gemini=flash. Hash-gating keeps volume low enough
      // to afford it; free-first BRIEF_CHAIN keeps it near $0 once free keys
      // exist; local Ollama maps both tiers to the same model (no dev change).
      tier: 'smart',
      chain: BRIEF_CHAIN,
      geminiModel: BRIEF_GEMINI_MODEL,
      // think:true buys gemini-2.5 a 512-token reasoning budget (inside
      // maxTokens); gemini-3 gets thinkingLevel:'low' gateway-side. Either way
      // the meta/lore synthesis is where the thinking earns its keep.
      think: true,
      maxTokens: 2048, // gemini-3 thinking counts against output - headroom so the JSON never clips
      temperature: 0.4,
      json: true,
      timeoutMs: 45000, // local CPU inference needs headroom
    })

    let brief = null
    let provider = r.provider || null
    let model = r.model || null
    if (r.ok) {
      brief = parseBriefLoose(r.text)
      if (brief && !context.derivative_of) brief = stripDerivativeClaims(brief)
      if (!brief || typeof brief !== 'object' || !brief.why) {
        brief = { why: String(r.text || '').slice(0, 300), lore: null, risk: null, confidence: 'low' }
      }
    } else {
      console.warn('[trending-brief] LLM offline, rules-composing read:', r.error)
      provider = 'rules'
      model = null
      brief = composeRulesBrief(context, social, req.query)
    }
    const data = packageData(brief, social, site, provider, { account, community: context.x_community_url, safety, wave, meta: context.board_meta && context.board_meta.theme, model })
    cacheSet(key, data, provider, mhash)
    return data
  })()

  inflight.set(key, p)
  try {
    res.json(await p)
  } catch (err) {
    console.error('[trending-brief] error:', err.message)
    res.status(502).json({ error: 'brief unavailable', message: err.message })
  } finally {
    inflight.delete(key)
  }
})

// ── Batch generation core - shared by POST /briefs and the board warmer ─────
async function generateBriefs(listRaw, { cap = 40 } = {}) {
  const list = listRaw.slice(0, cap)
  const briefs = {}
  let generated = 0
  let rulesCount = 0
  let reused = 0
  const misses = []
  for (const raw of list) {
    const symbol = String((raw && raw.symbol) || '').trim().slice(0, 15)
    if (!symbol) continue
    const key = keyFor(raw)
    const hit = cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) { briefs[key] = { ...hit.data, cached: true }; continue }
    if (!misses.some((m) => m.key === key)) misses.push({ raw, key, symbol })
  }

  if (misses.length) {
      // 1. Profiles: ONE DexScreener batch call covers every missing CA.
      const profileMap = await fetchDexProfiles(misses.map((m) => String(m.raw.ca || '')).filter(isRealCa))

      // 2. Social: X Dash tweets for misses without a client-passed signal.
      const socialByKey = new Map()
      const targets = misses.filter((m) => !(num(m.raw.mentions) > 0)).slice(0, 14)
      let ti = 0
      const sWorker = async () => {
        while (ti < targets.length) {
          const m = targets[ti++]
          try {
            socialByKey.set(m.key, await gatherSocial({
              cgId: String(m.raw.cgId || '').trim().toLowerCase(),
              symbol: m.symbol,
            }))
          } catch { /* optional */ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, sWorker))

      const socialOf = (m) => socialByKey.get(m.key) || {
        tweets: [],
        kols: Array.isArray(m.raw.kols) ? m.raw.kols.filter(Boolean).slice(0, 5) : [],
        mentions: num(m.raw.mentions),
        authors: num(m.raw.authors),
        velocity: num(m.raw.velocity),
        handle: null,
        source: num(m.raw.mentions) > 0 ? 'client' : null,
      }

      // 2b. Codex details fallback for misses still lacking identity
      // (DexScreener only carries socials for paid Enhanced Info tokens).
      const cxTargets = misses
        .filter((m) => {
          const ca = String(m.raw.ca || '')
          if (!isRealCa(ca)) return false
          const pr = profileMap.get(ca.toLowerCase())
          return !(pr && (pr.website || pr.twitter))
        })
        .slice(0, 10)
      let ci = 0
      const cWorker = async () => {
        while (ci < cxTargets.length) {
          const m = cxTargets[ci++]
          const ca = String(m.raw.ca || '')
          const cx = await fetchCodexProfile(ca, String(m.raw.networkId || ''))
          if (cx) {
            const k = ca.toLowerCase()
            const prev = profileMap.get(k) || {}
            profileMap.set(k, { ...prev, website: prev.website || cx.website, twitter: prev.twitter || cx.twitter, community: prev.community || cx.community, description: cx.description })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, cxTargets.length) }, cWorker))

      // 2c. Name wave: raw X search for each token NAME - the viral phrase or
      // event a fresh meme was minted to ride (6h cached per name, fail-open).
      const waveByKey = new Map()
      let oi = 0
      const oWorker = async () => {
        while (oi < misses.length) {
          const m = misses[oi++]
          const w = await fetchNameWave(m.raw.name, m.symbol, num(m.raw.ageH), String(m.raw.ca || ''))
          if (w) waveByKey.set(m.key, w)
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, misses.length) }, oWorker))

      // 3. Sites: scrape project websites, concurrency 4 (24h cached).
      const siteByKey = new Map()
      const siteTargets = misses
        .map((m) => ({ m, url: (profileMap.get(String(m.raw.ca || '').toLowerCase()) || {}).website }))
        .filter((x) => !!x.url)
        .slice(0, 12)
      let si = 0
      const wWorker = async () => {
        while (si < siteTargets.length) {
          const x = siteTargets[si++]
          const site = await scrapeSite(x.url)
          if (site) siteByKey.set(x.m.key, site)
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, siteTargets.length) }, wWorker))

      // 3b. The token's OWN X account - who runs it, is it alive, what ships.
      const accountByKey = new Map()
      const acctTargets = misses
        .map((m) => {
          const profile = profileMap.get(String(m.raw.ca || '').toLowerCase()) || null
          const h = handleOf(socialOf(m), profile, siteByKey.get(m.key) || null)
          return h ? { m, h } : null
        })
        .filter(Boolean)
        .slice(0, 12)
      let ai = 0
      const aWorker = async () => {
        while (ai < acctTargets.length) {
          const x = acctTargets[ai++]
          const acct = await fetchOwnAccount(x.h)
          if (acct) accountByKey.set(x.m.key, acct)
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, acctTargets.length) }, aWorker))

      // 3c. RugCheck safety flags for Solana mints (lib caches 30 min, fail-open).
      const safetyByKey = new Map()
      const solTargets = misses.filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(m.raw.ca || '')))
      if (solTargets.length) {
        try {
          const verdicts = await rugcheckBatch(solTargets.map((m) => String(m.raw.ca)), { budgetMs: 5000 })
          for (const m of solTargets) {
            const v = verdicts.get(String(m.raw.ca))
            if (v && v.checked) safetyByKey.set(m.key, v)
          }
        } catch { /* fail-open */ }
      }

      const boardCtx = buildBoardContext(list)
      const contexts = misses.map((m) => {
        const ctx = contextOf(
          statsOf(m.raw),
          socialOf(m),
          profileMap.get(String(m.raw.ca || '').toLowerCase()) || null,
          siteByKey.get(m.key) || null,
          accountByKey.get(m.key) || null,
          safetyByKey.get(m.key) || null,
          waveByKey.get(m.key) || null,
        )
        ctx.derivative_of = detectDerivative(m.symbol, m.raw.name, m.raw.mcap, boardCtx)
        ctx.board_meta = detectBoardMeta(m.symbol, m.raw.name, _lastBoardRows)
        evalGhost(m.raw, ctx, safetyByKey.get(m.key) || null)
        return ctx
      })

      // 3d. Hash-gate: when a token's material hashes identical to its last
      // LLM read (any age the persistence window holds), reuse that read and
      // just refresh its clock - the LLM only writes CHANGED stories. Local-
      // Ollama-era reads are NOT reused while a real provider (Gemini) is
      // configured: each one regenerates once at its next expiry, so the
      // board self-upgrades to the smarter model within a few warm cycles.
      const mhashes = misses.map((_, i) => materialHash(contexts[i]))
      const reusedKeys = new Set()
      misses.forEach((m, i) => {
        const prev = cache.get(m.key)
        if (prev && prev.data && prev.data.provider === 'ollama' && process.env.GEMINI_API_KEY) return
        if (prev && prev.mhash && prev.mhash === mhashes[i] && prev.data && prev.data.provider && prev.data.provider !== 'rules') {
          cacheSet(m.key, prev.data, prev.data.provider, mhashes[i])
          briefs[m.key] = { ...prev.data, cached: true }
          reusedKeys.add(m.key)
          reused++
        }
      })

      // 4. LLM calls in chunks of 4 tokens (fits every provider's output cap,
      // incl. the spectre brain's ~1KB answers), concurrency 3.
      let provider = null
      let model = null
      const bySym = new Map()
      const CHUNK = 1
      const genContexts = contexts.filter((_, i) => !reusedKeys.has(misses[i].key))
      const chunks = []
      for (let c = 0; c < genContexts.length; c += CHUNK) chunks.push(genContexts.slice(c, c + CHUNK))
      let chIdx = 0
      const llmWorker = async () => {
        while (chIdx < chunks.length) {
          const chunk = chunks[chIdx++]
          const r = await chat({
            messages: [
              { role: 'system', content: promptFor(PROMPT_BATCH, chunk[0]) },
              { role: 'user', content: 'MATERIAL: ' + JSON.stringify(chunk[0]) },
            ],
            // 'smart' tier + thinking + gemini-3 (same brain as the agent) +
            // free-first chain: see the single route.
            tier: 'smart',
            chain: BRIEF_CHAIN,
            geminiModel: BRIEF_GEMINI_MODEL,
            think: true,
            maxTokens: 2048,
            temperature: 0.4,
            json: true,
            timeoutMs: 60000, // local CPU inference needs headroom
          })
          if (!r.ok) { console.warn('[trending-briefs] LLM chunk failed:', r.error); continue }
          provider = provider || r.provider
          model = model || r.model
          // One token per call -> a single JSON object is the primary shape.
          let obj = parseBriefLoose(r.text)
          const parsed = !!obj
          if (Array.isArray(obj)) obj = obj[0]
          if (obj && typeof obj === 'object' && obj.why) {
            const sym = String(obj.symbol || (chunk[0] && chunk[0].symbol) || '').toUpperCase()
            if (sym) bySym.set(sym, obj)
          } else if (!parsed) {
            console.warn('[trending-briefs] unparseable LLM text:', String(r.text || '').slice(0, 200))
          }
          // Parsed-but-null-why falls through to the rules brief silently.
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, llmWorker))

      misses.forEach((m, i) => {
        if (reusedKeys.has(m.key)) return
        const s = socialOf(m)
        const site = siteByKey.get(m.key) || null
        let b = bySym.get(m.symbol.toUpperCase()) || null
        let prov = provider
        if (b && !contexts[i].derivative_of) b = stripDerivativeClaims(b)
        if (!b || !b.why || !scrubPriceTalk(scrubNumbers(b.why))) { b = composeRulesBrief(contexts[i], s, m.raw); prov = 'rules' }
        const data = packageData(b, s, site, prov, { account: accountByKey.get(m.key) || null, community: contexts[i].x_community_url, safety: safetyByKey.get(m.key) || null, wave: waveByKey.get(m.key) || null, meta: contexts[i].board_meta && contexts[i].board_meta.theme, model: prov === 'rules' ? null : model })
        cacheSet(m.key, data, prov, mhashes[i])
        briefs[m.key] = data
        generated++
        if (prov === 'rules') rulesCount++
      })
  }
  return { briefs, requested: list.length, generated, rulesCount, reused }
}

// Global generation mutex WITH PRIORITY: concurrent generateBriefs runs
// (warmer cycle + client batches + retries) stack multiplicative LLM workers
// onto one local Ollama and starve it into gateway timeouts - so exactly one
// generation runs at a time. User-facing jobs (scroll batches, popover) jump
// ahead of warmer slices in the queue, so a cold board backfill never holds
// a visible shimmer hostage for minutes. Queued callers re-check the cache
// on entry, so waiting behind a run that covered their keys costs ~0.
const _genQueue = []
let _genBusy = false
async function _drainGen() {
  if (_genBusy) return
  _genBusy = true
  try {
    while (_genQueue.length) {
      const i = _genQueue.findIndex((j) => j.priority > 0)
      const job = i >= 0 ? _genQueue.splice(i, 1)[0] : _genQueue.shift()
      try { job.resolve(await generateBriefs(job.listRaw, job.opts)) } catch (e) { job.reject(e) }
    }
  } finally {
    _genBusy = false
  }
}
function generateBriefsQueued(listRaw, opts = {}) {
  return new Promise((resolve, reject) => {
    _genQueue.push({ listRaw, opts, resolve, reject, priority: opts.priority || 0 })
    _drainGen()
  })
}

// Background generation with per-key dedup: repeated client polls for the
// same pending rows must not stack duplicate work onto the queue.
const _queuedKeys = new Set()
function queueBackgroundGeneration(rows) {
  const fresh = rows.filter((raw) => {
    const k = keyFor(raw)
    if (_queuedKeys.has(k)) return false
    _queuedKeys.add(k)
    return true
  })
  if (!fresh.length) return
  generateBriefsQueued(fresh, { priority: 1 })
    .catch((e) => console.warn('[trending-briefs] background generation failed:', e.message))
    .finally(() => { for (const raw of fresh) _queuedKeys.delete(keyFor(raw)) })
}

// ── POST /api/trending/briefs - batch for the inline column ─────────────────
// ALWAYS answers immediately: cached reads + a `pending` key list for rows the
// LLM is still writing (generation continues in the background; the client
// re-polls pending rows until they land). One uncached row must never hold 39
// cached reads hostage behind the generation mutex.
router.post('/briefs', express.json({ limit: '64kb' }), async (req, res) => {
  const listRaw = Array.isArray(req.body && req.body.tokens) ? req.body.tokens : null
  if (!listRaw || !listRaw.length) return res.status(400).json({ error: 'tokens required' })
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  if (limited(batchHits, ip, 30)) return res.status(429).json({ error: 'Slow down - 30 batches/min' })
  try {
    // Feed the warmer the board this client is actually viewing (cached rows
    // included - they must stay in the warm set so their reads never go stale
    // and drop back to a cold regen). Cheap, synchronous.
    recordBoard(listRaw.slice(0, 40))
    const briefs = {}
    const pending = []
    const missRows = []
    for (const raw of listRaw.slice(0, 40)) {
      if (!String((raw && raw.symbol) || '').trim()) continue
      const key = keyFor(raw)
      if (briefs[key] || pending.includes(key)) continue
      const hit = cache.get(key)
      if (hit && Date.now() - hit.ts < CACHE_TTL_MS) { briefs[key] = { ...hit.data, cached: true }; continue }
      // Stale-while-revalidate: a known read paints INSTANTLY (no shimmer)
      // while the background queue rewrites it - hash-gated, so an unchanged
      // story never even reaches the LLM.
      if (hit && hit.data && Date.now() - hit.ts < STALE_SERVE_MS) {
        briefs[key] = { ...hit.data, cached: true, stale: true }
        missRows.push(raw)
        continue
      }
      pending.push(key)
      missRows.push(raw)
    }
    if (missRows.length) queueBackgroundGeneration(missRows)
    res.json({ briefs, pending })
  } catch (err) {
    console.error('[trending-briefs] error:', err.message)
    res.status(502).json({ error: 'briefs unavailable', message: err.message })
  }
})

// ── Board warmer - the inline AI Read column must be INSTANT ─────────────────
// The hub renders the same engine board /api/tokens/trending serves, so
// pre-generating reads for it turns every client batch into a cache hit.
// Backs off 15 min when a cycle comes back all-rules (LLM down) so a dead
// provider doesn't churn the cache with low-value briefs.
const WARM_EVERY_MS = 5 * 60 * 1000
// Warm the FULL board the client can render (DenseTable caps at 100), not
// just the top 40 - rows 41+ were the "shimmers for 10s+" complaint. The
// hash-gate makes steady-state cycles nearly free; only new entrants cost.
const WARM_LIMIT = 100
// Warmer generates in small slices so queued USER batches (priority 1) jump
// in between - a cold backfill never blocks a visible shimmer for minutes.
const WARM_SLICE = 6
let warmBusy = false
let warmBackoffUntil = 0
// Live demand = has any client asked this service for a brief inside the
// recent-board TTL. `recentBoard` is written by POST /briefs and GET /brief.
function hasLiveDemand() {
  const now = Date.now()
  for (const v of recentBoard.values()) if (now - v.ts <= RECENT_BOARD_TTL) return true
  return false
}

async function warmBoardBriefs() {
  if (warmBusy || Date.now() < warmBackoffUntil) return
  // DEMAND-GATED (2026-09-01). This loop used to pre-generate reads for the
  // full 100-row engine board every 5 minutes forever, with no client attached:
  // a permanent LLM bill for a column nobody had opened. Now that the AI Read
  // column is opt-in, warming ahead of a viewer who may never arrive is pure
  // burn. So the cycle only runs while someone is ACTUALLY reading briefs -
  // one request re-arms it for RECENT_BOARD_TTL (25 min), which is long enough
  // that a live session still sees a hot cache and rows 41+ stay instant.
  // Set TREND_BRIEF_WARM=always to restore unconditional warming.
  if (process.env.TREND_BRIEF_WARM !== 'always' && !hasLiveDemand()) return
  warmBusy = true
  const t0 = Date.now()
  try {
    // Source 1 - the engine trending board (present in dev / any host that
    // mounts the full server). ABSENT on the standalone prod box, which only
    // mounts this router: the fetch 404s there, so it must NOT abort the
    // cycle - we fall through to the client-recorded board below.
    let rows = []
    // Demand gate (2026-09-11): the engine fetch below is NOT free - on a cold
    // cache /api/tokens/trending shards 3 rank passes over 6 networks = 18
    // Codex filterTokens, and the default network set is a cache key no client
    // ever requests, so every 5-min cycle was cold. Measured on an idle dev
    // server: ~1.9K FilterTokens/day with nobody looking at the board. Only
    // pull the engine board while a client has asked for briefs within
    // RECENT_BOARD_TTL; with no viewer the loop stays idle (and Source 2
    // below is empty anyway).
    const now0 = Date.now()
    let hasViewer = false
    for (const [k, v] of recentBoard) {
      if (now0 - v.ts > RECENT_BOARD_TTL) { recentBoard.delete(k); continue }
      hasViewer = true
      break
    }
    if (!hasViewer) return
    try {
      const res = await fetch(`${SELF_BASE}/api/tokens/trending?limit=${WARM_LIMIT}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(90000), // cold engine compute takes a while
      })
      if (res.ok) {
        const j = await res.json()
        rows = (Array.isArray(j && j.results) ? j.results : [])
          .map((r) => {
            const t = r.token || {}
            let created = Number(r.createdAt || t.createdAt) || null
            if (created && created < 1e12) created *= 1000
            return {
              symbol: t.symbol,
              name: t.name,
              ca: t.address,
              networkId: t.networkId,
              cgId: r.cgId || t.cgId || '',
              mcap: r.marketCap,
              vol24: r.volume24,
              liq: r.liquidity,
              change24: r.change24,
              ageH: created ? Math.max(0, Math.round((Date.now() - created) / 36e5)) : '',
            }
          })
          .filter((r) => r.symbol)
      }
    } catch { /* box: /api/tokens/trending not mounted - use the client board */ }
    // Source 2 (the prod-box path) - the union of rows real clients have asked
    // briefs for recently. Merge in anything the engine board didn't already
    // cover, so the warmer keeps EXACTLY what users are looking at hot with no
    // dependency on an endpoint the standalone service doesn't host.
    const now = Date.now()
    const seen = new Set(rows.map((r) => keyFor(r)))
    for (const [k, v] of recentBoard) {
      if (now - v.ts > RECENT_BOARD_TTL) { recentBoard.delete(k); continue }
      if (seen.has(k)) continue
      seen.add(k)
      rows.push(v.raw)
    }
    if (!rows.length) return
    // Seed derivative/meta detection with the FULL board before slicing -
    // a 6-row slice must not shrink the board context.
    buildBoardContext(rows)
    let generated = 0
    let rulesCount = 0
    let reused = 0
    for (let i = 0; i < rows.length; i += WARM_SLICE) {
      const r = await generateBriefsQueued(rows.slice(i, i + WARM_SLICE), { priority: 0 })
      generated += r.generated
      rulesCount += r.rulesCount
      reused += r.reused || 0
    }
    if (generated >= 3 && rulesCount >= generated) warmBackoffUntil = Date.now() + 15 * 60 * 1000
    if (generated > 0 || reused > 0 || process.env.TREND_DEBUG === '1') {
      console.log(`[trend-warm] board ${rows.length} rows: ${generated} reads generated (${rulesCount} rules, ${reused} reused) in ${Math.round((Date.now() - t0) / 1000)}s${warmBackoffUntil > Date.now() ? ' - LLM down, backing off 15m' : ''}`)
    }
  } catch (err) {
    console.warn('[trend-warm] cycle failed:', err.message)
  } finally {
    warmBusy = false
  }
}
// SPECTRE_DEV_LITE: this warmer generates LLM briefs for up to 100 board rows
// every 5 minutes - exactly the "hammers AI on loops" class dev-lite exists for.
// Reads still generate on demand per user batch; only the pre-warm goes quiet.
if (process.env.TREND_BRIEF_WARM !== '0' && process.env.SPECTRE_DEV_LITE !== '1') {
  const boot = setTimeout(warmBoardBriefs, 45 * 1000)
  if (boot.unref) boot.unref()
  const loop = setInterval(warmBoardBriefs, WARM_EVERY_MS)
  if (loop.unref) loop.unref()
}

// ── GET /api/trending/safety - rug screen for client-side screener rows ─────
// The trending ENGINE sweeps its own rows server-side (lib/token-safety in
// computeTrendingTokens); this endpoint gives the hub's raw-screener filler
// the same RugCheck screen. Fail-open, 30-min cached per mint.
router.get('/safety', async (req, res) => {
  try {
    const mints = String(req.query.mints || '').split(',').map((m) => m.trim()).filter(Boolean).slice(0, 40)
    if (!mints.length) return res.status(400).json({ error: 'mints required' })
    const verdicts = await rugcheckBatch(mints, { budgetMs: 6000 })
    const out = {}
    for (const [mint, v] of verdicts) out[mint] = { drop: !!v.drop, dangers: v.dangers, checked: v.checked }
    // Ghost-volume flags ride along: fake flow reads as clean to RugCheck.
    for (const mint of mints) {
      if (isGhostMint(mint) && !(out[mint] && out[mint].drop)) {
        out[mint] = { drop: true, dangers: ['Ghost volume - big flow, zero social footprint'], checked: true }
      }
    }
    res.json({ verdicts: out })
  } catch (err) {
    res.status(200).json({ verdicts: {} }) // fail-open
  }
})

module.exports = router
// Ghost-volume flags for the trending engine's safety sweep (index.js).
module.exports.isGhostMint = isGhostMint
