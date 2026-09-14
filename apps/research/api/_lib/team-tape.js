/**
 * team-tape — the project's OWN X timeline, one shared transport for every
 * consumer (sentiment-read, dossier-proxy, anything else that needs "is the
 * team actually posting").
 *
 * Transport order matters: the data-api box is the one host with a WORKING
 * keyless X fetch (/v1/social/x-timeline, added 2026-08-25 after the legacy
 * Cloud Run backend started 500ing on every handle — which made every project
 * read as "team unknown / no X activity" while teams posted daily). The legacy
 * base stays as a fallback in case it revives.
 *
 * Contract: returns
 *   { handle, posts24h, posts7d, newestAgeHours, sample: [{age, text}] }  on data,
 *   { unavailable: true, handle }                                        when every
 * transport failed — the caller must treat that as UNKNOWN, never as silence.
 * Returns null only when no handle was given. Never throws.
 */

const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').trim().replace(/\/+$/, '')
const SPECTRE_HEADERS = {
  Accept: 'application/json',
  ...(process.env.SPECTRE_API_KEY ? { 'X-API-Key': process.env.SPECTRE_API_KEY.trim() } : {}),
}
const TWEETS_RUN_BASE = (process.env.TWEETS_BACKEND_BASE || 'https://backend-277369611639.us-central1.run.app').replace(/\/+$/, '')

async function fetchJson(url, headers, timeoutMs) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

function toHours(s) {
  if (!s) return null
  const abs = Date.parse(s)
  if (Number.isFinite(abs)) {
    const h = (Date.now() - abs) / 3_600_000
    return h >= 0 && h < 24 * 400 ? h : null
  }
  const m = String(s).match(/(\d+)\s*(minute|hour|day|week|month)/i)
  if (!m) return null
  const mult = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 720 }[m[2].toLowerCase()]
  return mult != null ? Number(m[1]) * mult : null
}

function ageLabel(h) {
  if (h == null) return null
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

function shape(handle, tweets) {
  const ages = tweets.map((t) => toHours(t.created_at || t.date)).filter((v) => v != null)
  // Syndication puts the PINNED tweet first with its original (old) created_at
  // — sort by recency so the sample is the newest posts, not a months-old pin.
  // Cadence math is order-safe already (newest = min age, counts scan all).
  const own = tweets
    .filter((t) => !t.is_retweet && !/^RT @/i.test(String(t.text || t.tweet_text || '')))
    .slice()
    .sort((a, b) => (toHours(a.created_at || a.date) ?? Infinity) - (toHours(b.created_at || b.date) ?? Infinity))
  return {
    handle,
    posts24h: ages.filter((h) => h <= 24).length,
    posts7d: ages.filter((h) => h <= 168).length,
    newestAgeHours: ages.length ? Math.round(Math.min(...ages) * 10) / 10 : null,
    sample: own.slice(0, 3).map((t) => {
      const h = toHours(t.created_at || t.date)
      return {
        age: h == null ? (t.date || null) : ageLabel(h),
        text: String(t.text || t.tweet_text || '').replace(/\s+/g, ' ').trim().slice(0, 180),
      }
    }),
  }
}

export async function fetchTeamTape(xHandle) {
  if (!xHandle) return null
  const handle = String(xHandle).replace(/^@/, '')
  // 1. the box lane (working transport, 15-min server cache)
  const box = await fetchJson(`${SPECTRE_API_BASE}/v1/social/x-timeline/${encodeURIComponent(handle)}`, SPECTRE_HEADERS, 10_000)
  const boxTweets = box?.data?.tweets
  if (Array.isArray(boxTweets) && boxTweets.length) return shape(handle, boxTweets)
  // 2. legacy Cloud Run backend (dead as of 2026-08-25; kept as a revival path)
  const j = await fetchJson(`${TWEETS_RUN_BASE}/get_official_tweets?username=${encodeURIComponent(handle)}`, { Accept: 'application/json' }, 8_000)
  const tweets = Array.isArray(j?.tweets) ? j.tweets : []
  if (tweets.length) return shape(handle, tweets)
  // both transports failed or empty: the team's X activity is UNKNOWN
  return { unavailable: true, handle }
}
