/**
 * Express router - X Dash intelligence proxy (dev mode)
 * Mirrors the Vercel serverless functions in apps/trading/api/x-dash-*.js
 * so the client can hit the same `/api/x-dash/*` URLs in dev and prod.
 *
 * Mounted at: app.use('/api/x-dash', xDashRouter) in packages/server/index.js
 */

const express = require('express')
const router = express.Router()

// Resolve the X Dash base URL from env so devops can swap hosts (Hetzner vs GCP) without
// touching code. Falls back to the Hetzner self-hosted instance which is the active source
// of truth as of 2026-04-25.
const X_DASH_API_BASE = (
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  process.env.X_DASH_API_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '')

// Per-endpoint in-memory caches. Keep them small; node restarts wipe them.
const tokenCache = new Map()
const searchCache = new Map()
const narrativeCache = new Map()
const kolsCache = new Map()

function setCached(map, key, data) {
  map.set(key, { data, ts: Date.now() })
  // Bound memory - drop oldest if we exceed 500 entries
  if (map.size > 500) {
    const firstKey = map.keys().next().value
    map.delete(firstKey)
  }
}

function getCached(map, key, ttlMs) {
  const entry = map.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) return null
  return entry.data
}

function getStale(map, key) {
  const entry = map.get(key)
  return entry ? entry.data : null
}

async function upstreamFetch(path, apiKey, timeoutMs = 15000) {
  const res = await fetch(`${X_DASH_API_BASE}${path}`, {
    // Bearer is what the rotated upstream expects (mirrors the prod social-proxy).
    headers: { 'Authorization': `Bearer ${apiKey}`, 'x-api-key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`X Dash API returned ${res.status} ${res.statusText}`)
  }
  return res.json()
}

// Configure X_DASH_API_KEY / DASHBOARD_API_KEY in the server environment.
const X_DASH_FALLBACK_KEY = ''

function requireApiKey(res) {
  // XDASH_API_TOKEN = current rotated key (mirrors prod social-proxy priority).
  const key = process.env.XDASH_API_TOKEN || process.env.X_DASH_API_KEY || process.env.DASHBOARD_API_KEY || X_DASH_FALLBACK_KEY
  if (!key) {
    console.warn('[x-dash] X_DASH_API_KEY / DASHBOARD_API_KEY not configured')
    res.status(503).json({
      error: 'X Dash API key not configured',
      message: 'Set X_DASH_API_KEY in the server environment.',
    })
    return null
  }
  return key
}

// Input validation regexes - mirror the serverless functions exactly.
const CG_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
const QUERY_RE = /^[\w\s$@.-]{1,60}$/
// Narrative labels mirror CoinGecko categories verbatim ("Artificial Intelligence (AI)",
// "AI Agents", "Real World Assets (RWA)") so we must allow parens, periods, ampersands
// and slashes — not just word/space/hyphen.
const NARRATIVE_RE = /^[\w\s\-().&'/]{1,80}$/
const TIMEFRAME_RE = /^(24h|7d)$/
const RANKING_RE = /^(mentions|momentum|conviction)$/
const SEGMENT_RE = /^(all|major|opportunity|context)$/
const SORT_RE = /^(activity|reach)$/
const AUTHOR_SCOPE_RE = /^(top|all)$/
const AUTHOR_ID_RE = /^[a-zA-Z0-9_]{1,40}$/

// --------------------------------------------------------------------------
// GET /api/x-dash/token/:cgId  -- 60s cache
// --------------------------------------------------------------------------
router.get('/token/:cgId', async (req, res) => {
  const apiKey = requireApiKey(res)
  if (!apiKey) return

  try {
    const cgId = String(req.params.cgId || '').trim().toLowerCase()
    if (!cgId || !CG_ID_RE.test(cgId)) {
      return res.status(400).json({ error: 'Invalid cgId format' })
    }

    const force = req.query.force === 'true'
    const authorScope = String(req.query.author_scope || '').trim()
    const authorId = String(req.query.author_id || '').trim()

    if (authorScope && !AUTHOR_SCOPE_RE.test(authorScope)) {
      return res.status(400).json({ error: 'Invalid author_scope' })
    }
    if (authorId && !AUTHOR_ID_RE.test(authorId)) {
      return res.status(400).json({ error: 'Invalid author_id' })
    }

    const cacheKey = `token:${cgId}:${authorScope}:${authorId}`
    if (!force) {
      const cached = getCached(tokenCache, cacheKey, 60 * 1000)
      if (cached) return res.json(cached)
    }

    const params = new URLSearchParams()
    if (force) params.set('force', 'true')
    if (authorScope) params.set('author_scope', authorScope)
    if (authorId) params.set('author_id', authorId)
    const qs = params.toString()
    const path = `/api/token/${encodeURIComponent(cgId)}${qs ? `?${qs}` : ''}`

    const data = await upstreamFetch(path, apiKey, 15000)
    setCached(tokenCache, cacheKey, data)
    res.json(data)
  } catch (err) {
    console.error('[x-dash/token] error:', err.message)
    const cgId = String(req.params.cgId || '').trim().toLowerCase()
    const authorScope = String(req.query.author_scope || '').trim()
    const authorId = String(req.query.author_id || '').trim()
    const stale = getStale(tokenCache, `token:${cgId}:${authorScope}:${authorId}`)
    if (stale) return res.json(stale)
    res.status(502).json({ error: 'Failed to fetch token intelligence', message: err.message })
  }
})

// --------------------------------------------------------------------------
// GET /api/x-dash/search?q=...  -- 2min cache
// --------------------------------------------------------------------------
router.get('/search', async (req, res) => {
  const apiKey = requireApiKey(res)
  if (!apiKey) return

  try {
    const q = String(req.query.q || '').trim()
    if (!q || !QUERY_RE.test(q)) {
      return res.status(400).json({ error: 'Invalid query' })
    }
    const timeframe = String(req.query.timeframe || '24h').trim()
    const ranking = String(req.query.ranking || 'mentions').trim()
    if (!TIMEFRAME_RE.test(timeframe)) return res.status(400).json({ error: 'Invalid timeframe' })
    if (!RANKING_RE.test(ranking)) return res.status(400).json({ error: 'Invalid ranking' })

    const cacheKey = `search:${q.toLowerCase()}:${timeframe}:${ranking}`
    const cached = getCached(searchCache, cacheKey, 2 * 60 * 1000)
    if (cached) return res.json(cached)

    const params = new URLSearchParams({ q, timeframe, ranking, per_page: '10' })
    const data = await upstreamFetch(`/api/search?${params.toString()}`, apiKey, 10000)
    setCached(searchCache, cacheKey, data)
    res.json(data)
  } catch (err) {
    console.error('[x-dash/search] error:', err.message)
    res.status(502).json({ error: 'Failed to search X Dash', message: err.message })
  }
})

// --------------------------------------------------------------------------
// GET /api/x-dash/narrative-tokens?narrative=...  -- 5min cache
// --------------------------------------------------------------------------
router.get('/narrative-tokens', async (req, res) => {
  const apiKey = requireApiKey(res)
  if (!apiKey) return

  try {
    const narrative = String(req.query.narrative || '').trim()
    if (!narrative || !NARRATIVE_RE.test(narrative)) {
      return res.status(400).json({ error: 'Invalid narrative' })
    }
    const timeframe = String(req.query.timeframe || '24h').trim()
    const ranking = String(req.query.ranking || 'momentum').trim()
    const segment = String(req.query.segment || 'all').trim()
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 10, 25)

    if (!TIMEFRAME_RE.test(timeframe)) return res.status(400).json({ error: 'Invalid timeframe' })
    if (!RANKING_RE.test(ranking)) return res.status(400).json({ error: 'Invalid ranking' })
    if (!SEGMENT_RE.test(segment)) return res.status(400).json({ error: 'Invalid segment' })

    const cacheKey = `narr:${narrative.toLowerCase()}:${timeframe}:${ranking}:${segment}:${perPage}`
    const cached = getCached(narrativeCache, cacheKey, 5 * 60 * 1000)
    if (cached) return res.json(cached)

    // The upstream `/api/narrative-tokens` endpoint returns 400 for every slug
    // we throw at it (literal CoinGecko categories, slugs, lowercase, etc.).
    // The working pattern lives on `/api/search`: pass `category` + `category_scope=primary`
    // and you get back the same shape (`{ tokens: [...] }`) filtered to that category.
    // Caller-facing API stays `narrative=...` so we can swap the upstream silently.
    const params = new URLSearchParams({
      category: narrative,
      category_scope: 'primary',
      timeframe,
      ranking,
      segment,
      per_page: String(perPage),
    })
    const data = await upstreamFetch(`/api/search?${params.toString()}`, apiKey, 12000)
    setCached(narrativeCache, cacheKey, data)
    res.json(data)
  } catch (err) {
    console.error('[x-dash/narrative-tokens] error:', err.message)
    const narrative = String(req.query.narrative || '').trim().toLowerCase()
    const timeframe = String(req.query.timeframe || '24h').trim()
    const ranking = String(req.query.ranking || 'momentum').trim()
    const segment = String(req.query.segment || 'all').trim()
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 10, 25)
    const stale = getStale(narrativeCache, `narr:${narrative}:${timeframe}:${ranking}:${segment}:${perPage}`)
    if (stale) return res.json(stale)
    res.status(502).json({ error: 'Failed to fetch narrative tokens', message: err.message })
  }
})

// --------------------------------------------------------------------------
// GET /api/x-dash/kols  -- 5min cache
// --------------------------------------------------------------------------
router.get('/kols', async (req, res) => {
  const apiKey = requireApiKey(res)
  if (!apiKey) return

  try {
    const timeframe = String(req.query.timeframe || '24h').trim()
    const sort = String(req.query.sort || 'activity').trim()
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 20, 50)

    if (!TIMEFRAME_RE.test(timeframe)) return res.status(400).json({ error: 'Invalid timeframe' })
    if (!SORT_RE.test(sort)) return res.status(400).json({ error: 'Invalid sort' })

    const cacheKey = `kols:${timeframe}:${sort}:${perPage}`
    const cached = getCached(kolsCache, cacheKey, 5 * 60 * 1000)
    if (cached) return res.json(cached)

    const params = new URLSearchParams({ timeframe, sort, per_page: String(perPage) })
    const data = await upstreamFetch(`/api/kols?${params.toString()}`, apiKey, 12000)
    setCached(kolsCache, cacheKey, data)
    res.json(data)
  } catch (err) {
    console.error('[x-dash/kols] error:', err.message)
    const timeframe = String(req.query.timeframe || '24h').trim()
    const sort = String(req.query.sort || 'activity').trim()
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 20, 50)
    const stale = getStale(kolsCache, `kols:${timeframe}:${sort}:${perPage}`)
    if (stale) return res.json(stale)
    res.status(502).json({ error: 'Failed to fetch KOLs', message: err.message })
  }
})

module.exports = router
