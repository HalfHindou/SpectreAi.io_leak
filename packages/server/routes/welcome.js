/**
 * Express router - Welcome page composite endpoints
 * Mirrors apps/research/api/welcome-tweets.js for dev parity.
 *
 * Mounted at: app.use('/api/welcome', welcomeRouter) in packages/server/index.js
 */

const express = require('express')
const router = express.Router()

const TWEETS_API_URL = (
  process.env.LATEST_TWEETS_API_URL ||
  'https://aut-tweets-api-test-277369611639.us-central1.run.app/latest-tweets'
).replace(/\/+$/, '')

const TIMEOUT_MS = 8000

let _cache = null
let _cacheTs = 0
const CACHE_TTL_MS = 120 * 1000

router.get('/x-tweets', async (req, res) => {
  if (_cache && (Date.now() - _cacheTs) < CACHE_TTL_MS) {
    return res.json(_cache)
  }

  try {
    const upstream = await fetch(TWEETS_API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
    const data = await upstream.json()
    const tweets = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : [])

    const ranked = tweets
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a?.created_at_iso || '') || 0
        const tb = Date.parse(b?.created_at_iso || '') || 0
        return tb - ta
      })

    const out = { results: ranked }
    _cache = out
    _cacheTs = Date.now()
    res.json(out)
  } catch (err) {
    if (_cache) return res.json(_cache)
    res.status(200).json({ results: [], error: err?.message || 'unavailable' })
  }
})

module.exports = router
