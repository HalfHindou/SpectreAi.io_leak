const express = require('express')
const router = express.Router()

// Route through the X Dash API (same social intelligence backend).
// Falls back to Spectre API trending/bubbles when X Dash is down.
// XDASH_API_TOKEN first - the upstream rotated its key (old values 401).
const X_DASH_API_KEY = process.env.XDASH_API_TOKEN || process.env.X_DASH_API_KEY || ''
const EXTERNAL_BASE = 'https://x-dash-api-277369611639.europe-west1.run.app'
// Direct Hetzner origin + SPECTRE_DATA_API_KEY (the key actually present in .env);
// api.spectreai.io sits behind a Cloudflare WAF that stalls server-to-server calls.
const SPECTRE_API_BASE = process.env.SPECTRE_API_ORIGIN || process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || ''

// Simple in-memory cache
const cache = new Map()
function cached(key, ttlMs, fetcher) {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data)
  return fetcher().then(data => {
    cache.set(key, { data, ts: Date.now() })
    return data
  })
}

// Spectre API fallback: transforms trending/bubbles into bootstrap shape
async function spectreBootstrapFallback(perPage = 50) {
  const headers = { Accept: 'application/json', ...(SPECTRE_API_KEY ? { 'X-API-Key': SPECTRE_API_KEY } : {}) }
  // 25s - the box routinely takes 15-22s on a cold cache; 10s starved the fallback.
  const [trendingRes, bubblesRes] = await Promise.allSettled([
    fetch(`${SPECTRE_API_BASE}/v1/trending`, { headers, signal: AbortSignal.timeout(25000) }),
    fetch(`${SPECTRE_API_BASE}/v1/bubbles`, { headers, signal: AbortSignal.timeout(25000) }),
  ])
  const trending = trendingRes.status === 'fulfilled' && trendingRes.value.ok ? (await trendingRes.value.json()).data || [] : []
  const bubbles = bubblesRes.status === 'fulfilled' && bubblesRes.value.ok ? (await bubblesRes.value.json()).data || [] : []
  const bubbleLookup = new Map()
  bubbles.forEach(b => bubbleLookup.set(b.asset, b))
  const source = trending.length > 0 ? trending : bubbles
  const tokens = source.slice(0, perPage).map(item => {
    const b = bubbleLookup.get(item.asset) || item
    const cleanName = (item.name || item.asset || '').replace(/[^\x20-\x7E]/g, '').trim()
    return {
      token: {
        cg_id: cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || (item.asset || '').toLowerCase(),
        name: cleanName || item.asset, symbol: item.asset,
        cashtag: `$${item.asset}`, handle: cleanName.toLowerCase().replace(/\s+/g, ''),
        image_small: item.logo_url || null, market_cap: b.market_cap || 0,
      },
      metrics: {
        mentions_24h: Math.round((item.trend_score || 1) * 100),
        external_mentions_24h: Math.round((item.trend_score || 1) * 80),
        unique_authors_24h: Math.round((item.trend_score || 1) * 10),
        unique_external_authors_24h: Math.round((item.trend_score || 1) * 8),
        total_weighted_engagement: Math.round((item.volume_spike || 1) * 500),
        external_weighted_engagement: Math.round((item.volume_spike || 1) * 300),
        velocity_ratio: item.volume_spike || 1,
      },
      top_authors: [], top_mentions: [],
    }
  })
  return { tokens, _source: 'spectre-api-fallback' }
}

// GET /api/x-beta/bootstrap
router.get('/bootstrap', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString()
    const key = `bootstrap:${qs}`
    const data = await cached(key, 60000, async () => {
      const r = await fetch(`${EXTERNAL_BASE}/api/bootstrap?${qs}`, {
        headers: { ...(X_DASH_API_KEY ? { 'Authorization': `Bearer ${X_DASH_API_KEY}`, 'x-api-key': X_DASH_API_KEY } : {}), Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) throw new Error(`External API ${r.status}`)
      return r.json()
    })
    res.json(data)
  } catch (err) {
    console.error('[x-beta] bootstrap error:', err.message, '- falling back to Spectre API')
    try {
      const perPage = parseInt(req.query.per_page) || 50
      const fallback = await cached(`spectre-fb:${perPage}`, 60000, () => spectreBootstrapFallback(perPage))
      res.json(fallback)
    } catch (fbErr) {
      console.error('[x-beta] Spectre fallback failed:', fbErr.message)
      res.status(502).json({ error: 'Failed to fetch bootstrap data' })
    }
  }
})

// GET /api/x-beta/search
router.get('/search', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString()
    const r = await fetch(`${EXTERNAL_BASE}/api/search?${qs}`, {
      headers: { ...(X_DASH_API_KEY ? { 'Authorization': `Bearer ${X_DASH_API_KEY}`, 'x-api-key': X_DASH_API_KEY } : {}), Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) throw new Error(`External API ${r.status}`)
    const data = await r.json()
    res.json(data)
  } catch (err) {
    console.error('[x-beta] search error:', err.message)
    res.status(502).json({ error: 'Failed to search' })
  }
})

// GET /api/x-beta/token/:cgId
router.get('/token/:cgId', async (req, res) => {
  try {
    const { cgId } = req.params
    const key = `token:${cgId}`
    const data = await cached(key, 120000, async () => {
      const r = await fetch(`${EXTERNAL_BASE}/api/token/${encodeURIComponent(cgId)}`, {
        headers: { ...(X_DASH_API_KEY ? { 'Authorization': `Bearer ${X_DASH_API_KEY}`, 'x-api-key': X_DASH_API_KEY } : {}), Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) throw new Error(`External API ${r.status}`)
      return r.json()
    })
    res.json(data)
  } catch (err) {
    console.error('[x-beta] token detail error:', err.message)
    // Return minimal shape so frontend doesn't break
    const cgId = req.params.cgId
    res.json({
      token: { token: { cg_id: cgId, name: cgId, symbol: cgId.toUpperCase() }, metrics: {} },
      authors: [], mentions: [], top_mentions: [], _source: 'fallback',
    })
  }
})

module.exports = router
