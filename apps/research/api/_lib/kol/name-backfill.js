/**
 * KOL Radar — name-mention BACKFILL.
 *
 * X Dash only indexes cashtag mentions ($TICKER). When a KOL talks about a
 * project BY NAME ("Spectre is cooking", "loving what Messier is building") or
 * in a comment/reply with no $, it's invisible to the whole pipeline. This pulls
 * the KOL's recent tweets, has an LLM extract the projects they're talking about
 * by name, and resolves them to tokens (CoinGecko) — surfacing endorsements the
 * cashtag data misses.
 *
 * Tweet source is pluggable: `mock` (deterministic synthetic tweets for the demo)
 * or `twitterapiio` (real, dormant until TWITTERAPI_IO_KEY is set). Verified: the
 * Groq extraction reliably pulls Spectre/Messier/Ondo from name-only tweets.
 */
import { chat } from '../llm-gateway.js'

const PROVIDER = process.env.KOL_TIMELINE_PROVIDER || process.env.KOL_FOLLOW_PROVIDER || 'mock'
const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY || ''
const GROQ_KEY = process.env.GROQ_API_KEY || ''
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'openai/gpt-oss-120b'
const CG_BASE = 'https://pro-api.coingecko.com/api/v3'
const CG_KEY = process.env.COINGECKO_API_KEY || ''

const _resolve = new Map() // nameLower -> token|null
const _mentions = new Map() // handleLower -> { mentions, ts }
const TTL = 60 * 60 * 1000

// ── tweet timeline provider ─────────────────────────────────────────────────
// Real projects KOLs "talk about by name" (no cashtag) in the mock timeline.
const MOCK_POOL = [
  'Spectre', 'Messier', 'Plume', 'Ondo', 'Hyperliquid', 'Ethena', 'Pendle',
  'Jupiter', 'Monad', 'Berachain', 'Morpho', 'Eigenlayer', 'Celestia',
  'Pumpfun', 'Virtuals', 'Aerodrome',
]
const MOCK_TEMPLATES = [
  (p) => `${p} is quietly building something special, watching the team closely`,
  (p) => `loving what ${p} is shipping lately, underrated imo`,
  (p) => `not financial advice but ${p} looks like the play this cycle`,
  (p) => `${p} continues to execute while everyone's distracted`,
  (p) => `keeping a close eye on ${p}, the fundamentals are there`,
]
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
function mockTweets(handle) {
  const h = hashStr(String(handle).toLowerCase())
  const n = 2 + (h % 3) // 2-4 name-mentions
  const tweets = []
  for (let i = 0; i < n; i++) {
    const p = MOCK_POOL[(h + i * 7) % MOCK_POOL.length]
    const tmpl = MOCK_TEMPLATES[(h + i * 3) % MOCK_TEMPLATES.length]
    tweets.push({ text: tmpl(p), created_at: null })
  }
  // a couple of no-project tweets so the LLM has to discriminate
  tweets.push({ text: 'gm, market looking heavy today', created_at: null })
  return tweets
}
async function twitterapiioTweets(handle, limit) {
  if (!TWITTERAPI_KEY) return []
  try {
    const r = await fetch(
      `https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}`,
      { headers: { 'x-api-key': TWITTERAPI_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }
    )
    if (!r.ok) return []
    const d = await r.json()
    const arr = d.tweets || d.data || []
    return arr.slice(0, limit).map((t) => ({ text: t.text || t.full_text || '', created_at: t.created_at || null }))
  } catch {
    return []
  }
}
async function getRecentTweets(handle, { limit = 40 } = {}) {
  if (!handle) return []
  if (PROVIDER === 'twitterapiio') return twitterapiioTweets(handle, limit)
  return mockTweets(handle)
}

// ── LLM extraction ──────────────────────────────────────────────────────────
const SYS_PROMPT =
  'You extract crypto project/token names the author talks about positively or ' +
  'with genuine interest, mentioned BY NAME (a $ cashtag is NOT required). Return ' +
  'ONLY JSON {"projects":["Name", ...]}. Exclude generic words, exchanges, and ' +
  'pure price chatter. If none, return an empty array.'
async function llmExtract(texts) {
  if (!texts.length) return []
  try {
    // Resilient gateway, `fast` tier (cheap 8B) — this is tiny name-extraction,
    // not synthesis. `json: true` mirrors the old response_format. No key gate:
    // whichever provider is live serves it, [] only when all fail (never-dark).
    const r = await chat({
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: 'Tweets:\n' + texts.map((t, i) => `${i + 1}. ${t}`).join('\n') },
      ],
      tier: 'fast',
      maxTokens: 512,
      temperature: 0,
      timeoutMs: 15000,
      json: true,
    })
    if (!r.ok) return []
    const parsed = JSON.parse(r.text || '{}')
    return Array.isArray(parsed.projects) ? parsed.projects : []
  } catch {
    return []
  }
}

// ── name -> token (CoinGecko search) ────────────────────────────────────────
async function resolveName(name, universe) {
  const key = String(name).toLowerCase().trim()
  if (!key) return null
  if (_resolve.has(key)) return _resolve.get(key)
  // prefer the X Dash universe (clean logos/symbols), else CoinGecko search
  let token = null
  if (universe && universe.list) {
    const hit = universe.list.find(
      (p) => (p.name && p.name.toLowerCase() === key) || (p.symbol && p.symbol.toLowerCase() === key)
    )
    if (hit) token = { cg_id: hit.cg_id, symbol: hit.symbol, name: hit.name, image: hit.image }
  }
  if (!token && CG_KEY) {
    try {
      const r = await fetch(`${CG_BASE}/search?query=${encodeURIComponent(name)}`, {
        headers: { 'x-cg-pro-api-key': CG_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      const d = await r.json()
      const c = (d.coins || [])[0]
      if (c) token = { cg_id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name, image: c.thumb || c.large || null }
    } catch {
      /* graceful */
    }
  }
  _resolve.set(key, token)
  return token
}

// ── main: a KOL's name-mention endorsements (deduped vs their cashtag pushes) ─
async function getNameMentions(kol, pushes, universe) {
  const handle = String(kol.screen_name || '').replace(/^@/, '')
  if (!handle) return []
  const ck = handle.toLowerCase()
  const c = _mentions.get(ck)
  if (c && Date.now() - c.ts < TTL) return c.mentions

  const tweets = await getRecentTweets(handle)
  const names = await llmExtract(tweets.map((t) => t.text || t))
  const exclude = new Set((pushes || []).map((p) => p.cg_id))
  const out = []
  const seen = new Set()
  for (const name of names.slice(0, 12)) {
    const tok = await resolveName(name, universe)
    if (!tok || !tok.cg_id) continue
    if (exclude.has(tok.cg_id) || seen.has(tok.cg_id)) continue
    seen.add(tok.cg_id)
    const ev = tweets.find((t) => (t.text || '').toLowerCase().includes(String(name).toLowerCase()))
    out.push({
      cg_id: tok.cg_id,
      symbol: tok.symbol,
      name: tok.name,
      image: tok.image,
      source: 'name-mention',
      evidence: ev ? (ev.text || '').slice(0, 160) : null,
    })
  }
  _mentions.set(ck, { mentions: out, ts: Date.now() })
  return out
}

export { getNameMentions, getRecentTweets, llmExtract, resolveName, PROVIDER }
