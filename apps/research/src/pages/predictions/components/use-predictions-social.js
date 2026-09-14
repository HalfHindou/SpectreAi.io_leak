/**
 * usePredictionsSocial — social-intelligence layer for the Predictions page.
 *
 * Takes the live prediction events, derives a search topic per event, pulls
 * tweets for each topic (the same tweet backend X Dash uses), and aggregates
 * them into three views that mirror X Dash:
 *   - topics:  the hottest prediction topics ranked by social buzz
 *   - voices:  the biggest accounts driving the conversation (KOLs)
 *   - feed:    the highest-signal tweets across all topics, tagged to a market
 *
 * The tweet endpoint is keyword-search (not token-filtered), so it works for
 * politics / sports / geopolitics topics, not just crypto. Results are noisy
 * (reply spam), so everything is ranked by influence = followers x engagement
 * and low-signal accounts are filtered out.
 */
import { useState, useEffect, useRef } from 'react'
import { normalizeTweet } from '@/services/spectreApi'

const SEARCH_TTL = 5 * 60 * 1000 // 5 min — matches the server-side tweet cache
const _searchCache = {}

// Keyword search against the tweet backend. Dev hits the vite /tweets-api
// proxy; prod hits the gated /api/tweets/search serverless function. Same
// fallback order the token-tweet path uses. Never throws — returns [].
async function searchTopicTweets(query) {
  const key = (query || '').toLowerCase().trim()
  if (!key) return []
  const cached = _searchCache[key]
  if (cached && Date.now() - cached.ts < SEARCH_TTL) return cached.data

  const enc = encodeURIComponent(query)
  // `/api/tweets/search` is the canonical path with full dev (Express) AND
  // prod (gated serverless) parity, so try it first everywhere. `/tweets-api`
  // is a dev-only vite proxy fallback (it 404s in prod — no rewrite), kept
  // only as a backstop when the Express route is down.
  const urls = import.meta.env.DEV
    ? [`/api/tweets/search?query=${enc}`, `/tweets-api/api/tweets/search?query=${enc}`]
    : [`/api/tweets/search?query=${enc}`]

  for (const url of urls) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null)
    if (!res?.ok) continue
    const data = await res.json().catch(() => null)
    if (!data) continue
    const arr = Array.isArray(data) ? data : data.tweets || data.data || data.results || []
    const tweets = arr
      .map((t, i) => normalizeTweet(t, i))
      // Drop retweets and empty bodies — they read as noise in a feed.
      .filter((t) => t.text && !/^RT\s+@/i.test(t.text))
    _searchCache[key] = { data: tweets, ts: Date.now() }
    return tweets
  }
  _searchCache[key] = { data: [], ts: Date.now() }
  return []
}

// Run async tasks with a bounded concurrency so we don't fire 10 tweet
// searches at once (each is a 1-3s upstream call).
async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { out[idx] = await fn(items[idx], idx) } catch { out[idx] = null }
    }
  })
  await Promise.all(workers)
  return out
}

// Engagement weight (replies > reposts > likes, views are cheap signal).
function engagementOf(t) {
  return (t.likes || 0) + 2 * (t.retweets || 0) + 3 * (t.comments || 0) + 0.01 * (t.views || 0)
}
// Obvious crypto-shill / giveaway spam — down-ranked so substantive commentary
// leads the feed (these accounts often have high followers + bot engagement).
const PROMO_RE = /giveaway|airdrop|presale|whitelist|claim your|link in bio|join now|free \$|1000x|100x|pump it|to the moon/i
// Influence = how much an account's reach + this tweet's traction matter.
function influenceOf(t) {
  const base = Math.log10(1 + (t.followers || 0)) * 0.45 + Math.log10(1 + engagementOf(t)) * 0.55
  return PROMO_RE.test(t.text || '') ? base * 0.4 : base
}

const STOP = new Set([
  'will', 'the', 'be', 'by', 'end', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or',
  'a', 'an', 'win', 'wins', 'winner', 'reach', 'before', 'after', 'which', 'who', 'what',
  'when', 'how', 'vs', 'than', 'this', 'next', 'first', 'any', 'many', 'much', 'happen',
  'happens', 'hit', 'hits', 'get', 'gets', 'make', 'would', 'could', 'should', 'does',
  'are', 'is', 'was', 'between', 'into', 'out',
  '2024', '2025', '2026', '2027', '2028', '2029', '2030', '2031',
])

// Build a tweet search query from an event title — keep the distinctive
// entity words ("Democratic Presidential Nominee", "China invade Taiwan",
// "Fed rate cuts"). Numbers like "150k" are kept (they're real cashtag-ish
// targets), pure stopwords dropped.
function topicQuery(ev) {
  const title = ev?.title || ev?.question || ''
  const words = title
    .replace(/[^\w\s$]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()))
  return words.slice(0, 4).join(' ') || title.slice(0, 40)
}

// Leading outcome (name + yes%) from the list-level event card. Extracts the
// candidate name from the question ("Will Newsom win ..." -> "Newsom"), skips
// the "Person P / Team AM" placeholder outcomes and prefers traded markets so
// the chip doesn't show an untraded 50% ghost.
function extractOutcomeName(label) {
  const m = (label || '').match(/^will\s+(.+?)\s+win\b/i)
  return (m ? m[1] : label || '').replace(/\?$/, '').trim()
}
function isPlaceholderName(name) {
  return /^(person|candidate|team)\s+[a-z0-9]{1,3}$/i.test(name)
}
function leadingOutcome(ev) {
  const raw = ev?.outcomes || []
  if (raw.length === 1) {
    const pct = raw[0].yesPct
    return pct != null ? { label: null, yesPct: pct } : null
  }
  const outs = raw
    .map((o) => ({ name: extractOutcomeName(o.label || o.question), yesPct: o.yesPct ?? 0, vol: o.volume || 0 }))
    .filter((o) => o.name && !isPlaceholderName(o.name))
  if (!outs.length) return null
  const traded = outs.filter((o) => o.vol > 0)
  const pool = traded.length ? traded : outs
  const top = pool.reduce((b, o) => (o.yesPct > b.yesPct ? o : b), pool[0])
  return { label: top.name, yesPct: top.yesPct }
}

// Round-robin the highest-volume markets across categories so each category is
// represented before a second market from any one category is taken.
function pickDiverseTopics(events, n) {
  const byCat = {}
  for (const e of [...events].sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0))) {
    const c = e.category || 'other'
    ;(byCat[c] = byCat[c] || []).push(e)
  }
  const cats = Object.keys(byCat)
  const out = []
  let added = true
  while (out.length < n && added) {
    added = false
    for (const c of cats) {
      if (byCat[c].length) {
        out.push(byCat[c].shift())
        added = true
        if (out.length >= n) break
      }
    }
  }
  return out
}

const FOLLOWER_FLOOR = 2000 // a "voice" should have some reach

export function usePredictionsSocial(events, enabled) {
  const [state, setState] = useState({ topics: [], voices: [], feed: [], loading: true, error: false })
  const reqRef = useRef(0)

  // Stable key so we only refetch when the actual event set changes.
  const eventsKey = (events || []).slice(0, 12).map((e) => e.slug || e.id).join(',')

  useEffect(() => {
    if (!enabled) return
    if (!events || events.length === 0) {
      setState({ topics: [], voices: [], feed: [], loading: false, error: false })
      return
    }
    const reqId = ++reqRef.current
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: false }))

    async function run() {
      // Pick a CATEGORY-DIVERSE set of hot markets (round-robin across
      // categories by volume rank) so the trending view is general — politics,
      // sports, crypto, economy... — not just the 3 mega-events that dominate
      // raw volume.
      const top = pickDiverseTopics(events, 14)

      const results = (
        await pool(top, 4, async (ev) => {
          const q = topicQuery(ev)
          const tweets = await searchTopicTweets(q)
          return { ev, q, tweets }
        })
      ).filter(Boolean)

      if (cancelled || reqId !== reqRef.current) return

      // ── Topics: rank by social buzz ──────────────────────────────
      const topics = results
        .map(({ ev, q, tweets }) => {
          const ranked = [...tweets].sort((a, b) => influenceOf(b) - influenceOf(a))
          const buzz = ranked.slice(0, 8).reduce((s, t) => s + engagementOf(t), 0)
          const reach = ranked.reduce((m, t) => Math.max(m, t.followers || 0), 0)
          return {
            slug: ev.slug,
            title: ev.title,
            image: ev.image || ev.icon || '',
            category: ev.category,
            totalVolume: ev.totalVolume || 0,
            lead: leadingOutcome(ev),
            query: q,
            buzz,
            reach,
            tweetCount: tweets.length,
            sample: ranked[0] || null,
          }
        })
        .filter((tp) => tp.tweetCount > 0)
        .sort((a, b) => b.buzz - a.buzz)

      // ── Feed: best tweets across all topics, tagged to their market ──
      const seen = new Set()
      const feed = []
      for (const { ev, tweets } of results) {
        for (const t of tweets) {
          if (seen.has(t.id)) continue
          seen.add(t.id)
          feed.push({ ...t, topicSlug: ev.slug, topicTitle: ev.title, topicCategory: ev.category })
        }
      }
      feed.sort((a, b) => influenceOf(b) - influenceOf(a))

      // ── Voices: the biggest accounts in the conversation ─────────
      const byHandle = new Map()
      for (const t of feed) {
        const h = (t.handle || '').toLowerCase()
        if (!h || h === '@unknown') continue
        const prev = byHandle.get(h)
        if (!prev) {
          byHandle.set(h, {
            handle: t.handle,
            name: t.name,
            avatar: t.avatar,
            followers: t.followers || 0,
            verified: t.is_verified,
            engagement: engagementOf(t),
            topics: new Set([t.topicSlug]),
            posts: 1,
            top: t,
          })
        } else {
          prev.followers = Math.max(prev.followers, t.followers || 0)
          prev.engagement += engagementOf(t)
          prev.topics.add(t.topicSlug)
          prev.posts += 1
          if (influenceOf(t) > influenceOf(prev.top)) prev.top = t
        }
      }
      const voices = [...byHandle.values()]
        .filter((v) => v.followers >= FOLLOWER_FLOOR)
        .map((v) => ({ ...v, topicCount: v.topics.size }))
        .sort((a, b) => b.followers - a.followers)
        .slice(0, 14)

      setState({
        topics,
        voices,
        feed: feed.slice(0, 28),
        loading: false,
        error: topics.length === 0 && feed.length === 0,
      })
    }

    run().catch(() => {
      if (!cancelled && reqId === reqRef.current) {
        setState({ topics: [], voices: [], feed: [], loading: false, error: true })
      }
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, eventsKey])

  return state
}

export { engagementOf, influenceOf }
