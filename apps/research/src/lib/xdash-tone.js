/**
 * xdash-tone.js — resolve a token's mention TONE ourselves (no data-lane wait).
 *
 * The X Dash board ranks by attention VOLUME, blind to whether the crowd is
 * bullish or FUD-ing a token. The collector emits no sentiment — but the
 * per-token detail (`/api/xdash/token/:id`, which the drawer already uses)
 * carries the raw tweet text. So we classify tone in-app with `chatter-tone`,
 * cache it, and let the board turn a "price down + buzz up" divergence into a
 * real verdict: negative chatter = FUD (avoid), bullish chatter = dip with
 * support (chance of return).
 *
 * Only the diverging tokens get resolved (a handful per board), so this is a few
 * cached detail fetches, not 50 — cheap, background, non-blocking.
 */
import { classifyChatter } from './chatter-tone'

const TONE_CACHE = new Map()    // cgId -> { tone, ts }
const TONE_INFLIGHT = new Map()
const TONE_TTL_MS = 20 * 60_000

function extractTexts(detail) {
  const out = []
  const mentions = detail?.top_mentions || detail?.mentions || []
  for (const m of mentions) {
    const t = m?.tweet?.full_text || m?.tweet?.text || m?.text || m?.content || ''
    if (t) out.push(t)
  }
  return out
}

/* ── Board-wide tone from the data-api box ────────────────────────────────
   The box now classifies mention sentiment for real (worker-mention-classifier:
   Groq-8b + lexicon → mention_sentiment) and serves it aggregated per symbol at
   /v1/social/tone. This is the primary, board-wide, high-quality source — one
   batched call for every visible symbol — superseding the per-token lexicon
   read below (which stays as a fallback for symbols the box hasn't classified).
   Box verdict thresholds match this lib's classifier, so the two agree. */
const BOARD_CACHE = new Map()  // SYMBOL -> { tone, ts }
const BOARD_TTL_MS = 5 * 60_000
let _boardInflight = null

/** Synchronous read of a symbol's board tone (undefined if not fetched). */
export function getBoardTone(symbol) {
  const c = BOARD_CACHE.get(String(symbol || '').toUpperCase())
  if (c && Date.now() - c.ts < BOARD_TTL_MS) return c.tone
  return undefined
}

/** Batch-fetch board tone for a set of symbols from the box; caches per symbol.
    Returns a Map(SYMBOL -> toneObj|null). */
export async function fetchBoardTone(symbols) {
  const want = [...new Set((symbols || [])
    .map((s) => String(s || '').trim().replace(/^\$/, '').toUpperCase())
    .filter(Boolean))]
  const now = Date.now()
  const out = new Map()
  const missing = []
  for (const s of want) {
    const c = BOARD_CACHE.get(s)
    if (c && now - c.ts < BOARD_TTL_MS) out.set(s, c.tone)
    else missing.push(s)
  }
  if (!missing.length) return out
  if (_boardInflight) { try { await _boardInflight } catch { /* fall through */ } }
  const url = `/data-api/v1/social/tone?symbols=${encodeURIComponent(missing.slice(0, 150).join(','))}`
  const p = fetch(url, { credentials: 'include', signal: AbortSignal.timeout(12000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const data = (j && j.data) || {}
      for (const s of missing) {
        const tone = data[s] || null
        BOARD_CACHE.set(s, { tone, ts: Date.now() })
        out.set(s, tone)
      }
      return out
    })
    .catch(() => {
      // short-cache the miss so a transient failure retries soon
      for (const s of missing) BOARD_CACHE.set(s, { tone: null, ts: Date.now() - (BOARD_TTL_MS - 60_000) })
      return out
    })
    .finally(() => { _boardInflight = null })
  _boardInflight = p
  return p
}

/** Synchronous read: the tone object, null (resolved, no read), or undefined
    (not fetched yet). */
export function getCachedTone(cgId) {
  const c = TONE_CACHE.get(cgId)
  if (c && Date.now() - c.ts < TONE_TTL_MS) return c.tone
  return undefined
}

/** Fetch + classify a token's mention tone (cached + inflight-deduped). */
export function fetchTokenTone(cgId) {
  if (!cgId) return Promise.resolve(null)
  const c = TONE_CACHE.get(cgId)
  if (c && Date.now() - c.ts < TONE_TTL_MS) return Promise.resolve(c.tone)
  if (TONE_INFLIGHT.has(cgId)) return TONE_INFLIGHT.get(cgId)
  const p = fetch(`/api/xdash/token/${encodeURIComponent(cgId)}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(12000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const texts = extractTexts(j)
      const tone = texts.length >= 4 ? classifyChatter(texts) : null
      TONE_CACHE.set(cgId, { tone, ts: Date.now() })
      return tone
    })
    .catch(() => {
      // short-cache failures so a transient miss retries instead of sticking
      TONE_CACHE.set(cgId, { tone: null, ts: Date.now() - (TONE_TTL_MS - 60_000) })
      return null
    })
    .finally(() => TONE_INFLIGHT.delete(cgId))
  TONE_INFLIGHT.set(cgId, p)
  return p
}
