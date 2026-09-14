/**
 * Vercel Serverless – Official Tweets proxy
 * Proxies requests to the Spectre tweets backend to avoid CORS issues.
 * Usage: /api/tweets?username=zssbecker
 */

const TWEETS_BACKEND = 'https://backend-277369611639.us-central1.run.app'

const _cache = {}
function getCached(key, ttlMs) {
  const e = _cache[key]
  if (!e || Date.now() - e.ts > ttlMs) return null
  return e.data
}
function setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const username = req.query.username
  if (!username) {
    return res.status(400).json({ error: 'Missing username parameter' })
  }

  const cacheKey = `tweets:${username}`
  const cached = getCached(cacheKey, 5 * 60 * 1000)
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(cached)
  }

  try {
    const r = await fetch(
      `${TWEETS_BACKEND}/get_official_tweets?username=${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!r.ok) {
      return res.status(r.status).json({ error: `Upstream returned ${r.status}` })
    }
    const data = await r.json()
    setCached(cacheKey, data)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(data)
  } catch (err) {
    console.error('Tweets proxy error:', err.message)
    return res.status(502).json({ error: 'Tweets backend unavailable' })
  }
}
