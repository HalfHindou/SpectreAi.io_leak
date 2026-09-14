// force-redeploy 2026-07-02: pick up restored XDASH_API_TOKEN env
/**
 * Vercel Serverless - Social Intelligence proxy.
 * Proxies /api/xdash/* to the deployed dashboard API and /api/x-beta/* to the
 * same upstream contract.
 * Matches Express routes at packages/server/index.js:10019-10145 and routes/x-beta.js
 *
 * Redeploy marker 2026-06-07: real-change commit to force a Vercel git-integration
 * build that re-injects the corrected XDASH_API_TOKEN env value (empty redeploy
 * commits were skipped by Vercel; the prior live build had a stale token -> 401).
 *
 * Anti-scrape (2026-06-10): /api/xdash/* is public + unauthenticated, so a
 * per-IP sliding-window rate limit guards against bulk dataset extraction.
 * Generous enough for real browsing (a page load fires ~5 calls + polling,
 * and shared NAT/CGNAT IPs are common), tight enough to make paginating the
 * full token universe painful. Fail-soft: a KV outage falls back to an
 * in-memory counter (never bricks legit users). IP is derived from Vercel's
 * trusted x-vercel-forwarded-for, so X-Forwarded-For spoofing can't rotate it.
 */
import { rateLimit } from '../ratelimit.js'
import { withHealth, xdashHealth } from '../xdash-health.js'
import { reconcileReceipts, reconcileTrackRecord, stripGlitchedSignals, rebaseReceiptsToOrigin } from '../momentum-reconcile.js'

const DEFAULT_DASHBOARD_API_BASE = 'http://5.78.199.87:8092'
const DASHBOARD_API_BASE = (process.env.DASHBOARD_API_BASE_URL || process.env.X_DASH_BASE || DEFAULT_DASHBOARD_API_BASE).replace(/\/+$/, '')
// XDASH_API_TOKEN FIRST: it's the canonical current token. Prod (Vercel) may
// still carry a stale DASHBOARD_API_KEY/X_DASH_API_KEY (old rotated key) that
// would otherwise shadow it and send a dead key -> upstream 401 -> fallback.
// This was the works-local-fails-prod bug: local .env only had XDASH_API_TOKEN.
const DASHBOARD_API_KEY = process.env.XDASH_API_TOKEN || process.env.DASHBOARD_API_KEY || process.env.X_DASH_API_KEY || ''
// Canonical X Dash auth scheme is `Authorization: Bearer <token>` (the API also
// accepts X-API-Key). Send both so the proxy authenticates regardless of which
// the upstream prefers. Requires XDASH_API_TOKEN (or DASHBOARD_API_KEY) set in
// the Vercel env, or every /api/xdash/* call 401s.
const DASHBOARD_AUTH_HEADERS = DASHBOARD_API_KEY
  ? { 'Authorization': `Bearer ${DASHBOARD_API_KEY}`, 'X-API-Key': DASHBOARD_API_KEY }
  : {}

// X Beta now routes through the same dashboard API by default.
const X_BETA_BASE = (process.env.X_BETA_BASE || DASHBOARD_API_BASE).replace(/\/+$/, '')

const _cache = {}
function getCached(key, ttl) {
  const e = _cache[key]
  if (!e || Date.now() - e.ts > ttl) return null
  return e.data
}
function setCache(key, data) { _cache[key] = { data, ts: Date.now() } }
// stale-on-error: upstream now rate-limits (429) and auth-gates (401) in
// bursts - a warm instance's last good payload beats a blank error state
function getStale(key, maxAgeMs = 30 * 60_000) {
  const e = _cache[key]
  if (!e || Date.now() - e.ts > maxAgeMs) return null
  return e.data
}

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

async function xdashFetch(path, cacheKey, ttlMs = 60_000) {
  const cached = getCached(cacheKey, ttlMs)
  if (cached) return cached
  try {
    const r = await fetch(`${DASHBOARD_API_BASE}${path}`, {
      headers: {
        Accept: 'application/json',
        ...DASHBOARD_AUTH_HEADERS,
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) throw new Error(`X-Dash ${r.status}`)
    const data = await r.json()
    if (ttlMs > 0) setCache(cacheKey, data)
    return data
  } catch (err) {
    const stale = ttlMs > 0 ? getStale(cacheKey) : null
    if (stale) return stale
    throw err
  }
}

// Spectre API fallback for when X Dash is down
// Direct Hetzner origin default — api.spectreai.io is CF-WAF blocked for
// Vercel server-to-server traffic. Env var still wins when set.
const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').trim().replace(/\/+$/, '')
const SPECTRE_API_KEY_VAL = (process.env.SPECTRE_API_KEY || '').trim()

async function spectreApiFallbackBootstrap(perPage = 15) {
  const headers = { Accept: 'application/json', ...(SPECTRE_API_KEY_VAL ? { 'X-API-Key': SPECTRE_API_KEY_VAL } : {}) }
  const [trendingRes, bubblesRes] = await Promise.allSettled([
    fetch(`${SPECTRE_API_BASE}/v1/trending`, { headers, signal: AbortSignal.timeout(10000) }),
    fetch(`${SPECTRE_API_BASE}/v1/bubbles`, { headers, signal: AbortSignal.timeout(10000) })
  ])
  const trending = trendingRes.status === 'fulfilled' && trendingRes.value.ok ? (await trendingRes.value.json()).data || [] : []
  const bubbles = bubblesRes.status === 'fulfilled' && bubblesRes.value.ok ? (await bubblesRes.value.json()).data || [] : []
  const bubbleLookup = new Map()
  bubbles.forEach(b => bubbleLookup.set(b.asset, b))
  const source = trending.length > 0 ? trending : bubbles
  const tokens = source.slice(0, Math.max(perPage, 15)).map(item => {
    const b = bubbleLookup.get(item.asset) || item
    const cleanName = (item.name || item.asset || '').replace(/[^\x20-\x7E]/g, '').trim()
    return {
      token: {
        cg_id: cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || (item.asset || '').toLowerCase(),
        name: cleanName || item.asset, symbol: item.asset,
        cashtag: `$${item.asset}`, handle: cleanName.toLowerCase().replace(/\s+/g, ''),
        image_small: item.logo_url || null, image_url: item.logo_url || null,
        market_cap: b.market_cap || 0,
      },
      metrics: {
        mentions_24h: Math.round((item.trend_score || 1) * 100),
        external_mentions_24h: Math.round((item.trend_score || 1) * 80),
        unique_authors_24h: Math.round((item.trend_score || 1) * 10),
        unique_external_authors_24h: Math.round((item.trend_score || 1) * 8),
        total_weighted_engagement: Math.round((item.volume_spike || 1) * 500),
        external_weighted_engagement: Math.round((item.volume_spike || 1) * 300),
        velocity_ratio: item.volume_spike || 1, novelty_ratio: 0,
        unique_authors: Math.round((item.trend_score || 1) * 10),
        external_mentions: Math.round((item.trend_score || 1) * 80),
      },
      top_authors: [], top_mentions: [], latest_mention_at: new Date().toISOString(),
    }
  })
  return { tokens, _source: 'spectre-api-fallback' }
}

// ── X-Dash routes ───────────────────────────────────────────────────────────
// The dashboard API materialises ONE document per window. When a run does not
// produce the 24h rollup it still answers 200, serving whichever window it does
// hold (measured 2026-08-28: window_hours 168 on every request, rows only for
// timeframe=7d) - and on every row the whole `*_24h` metric family reads 0 while
// the window-scoped siblings stay intact: external_mentions 772, mentions_24h 0.
// The board reads the _24h family for mentions, signal and the attention map, so
// a perfectly good 7d payload paints as a wall of zeros and "-100%".
//
// Lifts each zeroed `X_24h` onto its window-scoped sibling `X`, guarded so it can
// never invent data: never for timeframe=24h (there the _24h family IS the
// answer), and only when the ENTIRE board is zeroed - one row with real 24h data
// means the upstream is healthy and a legitimate zero stays a zero. It therefore
// self-disables as soon as the box builds the 24h rollup again.
// Twin of backfillZeroedWindowMetrics in packages/server/index.js - keep in sync.
function backfillZeroedWindowMetrics(payload, timeframe) {
  if (timeframe === '24h') return payload
  if (!payload || !Array.isArray(payload.tokens) || payload.tokens.length === 0) return payload
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const majors = Array.isArray(payload.featured_majors) ? payload.featured_majors : []
  const rows = payload.tokens.concat(majors)
  if (rows.some((e) => num(e && e.metrics && e.metrics.external_mentions_24h) > 0)) return payload
  if (!rows.some((e) => num(e && e.metrics && e.metrics.external_mentions) > 0)) return payload

  // Every degraded key is `<name>_24h` and every window-scoped source is the same
  // name without the suffix, in both metrics and quality - one rule, ~20 fields.
  const lift = (block) => {
    if (!block || typeof block !== 'object') return block
    const out = { ...block }
    for (const key of Object.keys(block)) {
      if (!key.endsWith('_24h') || num(block[key]) > 0) continue
      const src = block[key.slice(0, -4)]
      if (typeof src === 'number' && Number.isFinite(src) && src !== 0) out[key] = src
    }
    return out
  }

  const rescope = (e) => {
    if (!e || !e.metrics) return e
    const metrics = lift(e.metrics)
    // `*_prev_daily_avg` is the baseline the share-delta divides by. Here it is a
    // straight `window_total / 6` derivation (ratio exactly 6.0 on all 48 rows),
    // so it holds no independent prior period and any delta from it is the same
    // invented number on every row. Drop it - no delta beats a wrong one.
    delete metrics.external_mentions_prev_daily_avg
    delete metrics.external_weighted_prev_daily_avg
    // `mentions_24h` has no window-scoped sibling to lift from, so mirror the
    // external count the way postProcessBootstrapMentions already does when it
    // rescales - the Degen view reads this field directly, not the external one.
    if (!num(metrics.mentions_24h) && num(metrics.external_mentions_24h) > 0) {
      metrics.mentions_24h = metrics.external_mentions_24h
    }
    metrics.mentions_window_backfilled = true
    return { ...e, metrics, quality: lift(e.quality) }
  }

  return {
    ...payload,
    tokens: payload.tokens.map(rescope),
    featured_majors: majors.length ? majors.map(rescope) : payload.featured_majors,
  }
}

async function handleXDash(req, res) {
  // Anti-scrape: per-IP sliding-window limit on the public X Dash data.
  // Two windows - per-minute catches bursts, per-hour catches the slow-drip
  // scraper that throttles under the per-minute cap. Limits are deliberately
  // generous so real browsing (and shared NAT/CGNAT) is never blocked; a bulk
  // scrape paginating the ~3,600-token universe across rankings/segments/
  // timeframes blows past them. rateLimit() writes the 429 + Retry-After and
  // returns true; it's fail-soft on KV outage (in-memory fallback).
  if (await rateLimit(req, res, { bucket: 'xdash-min', max: 120, windowMs: 60_000 })) return
  if (await rateLimit(req, res, { bucket: 'xdash-hour', max: 2000, windowMs: 3_600_000 })) return

  const route = req.query.route || ''

  if (route === 'bootstrap') {
    const params = new URLSearchParams({
      page: req.query.page || '1',
      per_page: req.query.per_page || '10',
      timeframe: req.query.timeframe || '24h',
      ranking: req.query.ranking || 'mentions',
      segment: req.query.segment || 'all',
      market: req.query.market || 'all',
      min_kols: req.query.min_kols || '1',
    })
    try {
      const data = await xdashFetch(`/api/bootstrap?${params}`, `xd-boot:${params}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      const rescoped = backfillZeroedWindowMetrics(data, params.get('timeframe'))
      return res.status(200).json(withHealth(rescoped, params.get('timeframe')))
    } catch (err) {
      console.error('[xdash] bootstrap error:', err.message, '- falling back to Spectre API')
      try {
        const perPage = parseInt(req.query.per_page) || 15
        const cached = getCached(`spectre-fb:${perPage}`, 60_000)
        if (cached) return res.status(200).json(cached)
        const fallback = await spectreApiFallbackBootstrap(perPage)
        setCache(`spectre-fb:${perPage}`, fallback)
        res.setHeader('Cache-Control', 'public, s-maxage=60')
        return res.status(200).json(fallback)
      } catch (fbErr) {
        console.error('[xdash] Spectre fallback also failed:', fbErr.message)
        // Carry the verdict in the error body too: the surfaces render one
        // panel for "X Dash is updating" and it must not need a 200 to say so.
        return res.status(502).json({
          error: 'Social intelligence temporarily unavailable',
          _health: xdashHealth(null, params.get('timeframe'), { upstreamDown: true }),
        })
      }
    }
  }

  if (route === 'leaderboard-bundle') {
    const params = new URLSearchParams({
      timeframe: req.query.timeframe || '24h',
      ranking: req.query.ranking || 'mentions',
      segment: req.query.segment || 'all',
      market: req.query.market || 'all',
      page: req.query.page || '1',
      per_page: req.query.per_page || '25',
      hero_limit: req.query.hero_limit || '20',
      treemap_limit: req.query.treemap_limit || '48',
    })
    try {
      const data = await xdashFetch(`/api/xdash/leaderboard-bundle?${params}`, `xd-bundle:${params}`, 30_000)
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json(withHealth(data, params.get('timeframe')))
    } catch (err) {
      console.error('[xdash] leaderboard-bundle error:', err.message)
      return res.status(502).json({
        error: 'Social intelligence temporarily unavailable',
        _health: xdashHealth(null, params.get('timeframe'), { upstreamDown: true }),
      })
    }
  }

  if (route === 'search') {
    if (!req.query.q) return res.status(400).json({ error: 'Search query required' })
    const params = new URLSearchParams({
      q: req.query.q,
      page: req.query.page || '1',
      per_page: req.query.per_page || '10',
      timeframe: req.query.timeframe || '24h',
      segment: req.query.segment || 'all',
      market: req.query.market || 'all',
      min_kols: req.query.min_kols || '1',
    })
    try {
      const data = await xdashFetch(`/api/search?${params}`, `xd-search:${params}`, 0)
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] search error:', err.message)
      return res.status(502).json({ error: 'Search temporarily unavailable' })
    }
  }

  if (route === 'admin-overview') {
    try {
      const data = await xdashFetch('/api/admin/overview', 'xd-admin-overview', 30_000)
      res.setHeader('Cache-Control', 'public, s-maxage=30')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] admin overview error:', err.message)
      return res.status(200).json({
        generated_at_utc: new Date().toISOString(),
        health: { status: 'waiting_on_upstream' },
        latest_db_tweets: [],
        _source: 'fallback',
      })
    }
  }

  if (route === 'new-tokens') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    try {
      const data = await xdashFetch(`/api/new-tokens?${params}`, `xd-new:${params}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] new-tokens error:', err.message)
      return res.status(200).json({
        generated_at_utc: new Date().toISOString(),
        tokens: [],
        pagination: { page: 1, per_page: Number(req.query.per_page || 24), returned_count: 0 },
        _source: 'fallback',
      })
    }
  }

  // Majors board — the upstream path is /api/majors (NOT /api/xdash/majors,
  // which 404s). The Majors tab fetches /api/xdash/majors, so map it here.
  if (route === 'majors') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    try {
      const data = await xdashFetch(`/api/majors?${params}`, `xd-majors:${params}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] majors error:', err.message)
      return res.status(200).json({
        generated_at_utc: new Date().toISOString(),
        tokens: [],
        pagination: { page: 1, per_page: Number(req.query.per_page || 20), returned_count: 0 },
        _source: 'fallback',
      })
    }
  }

  if (route === 'creator-edits') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    try {
      const data = await xdashFetch(`/api/creator-edits?${params}`, `xd-edits:${params}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] creator-edits error:', err.message)
      return res.status(200).json({
        generated_at_utc: new Date().toISOString(),
        summary: {},
        entries: [],
        pulse: [],
        field_mix: [],
        _source: 'fallback',
      })
    }
  }

  if (route === 'intel-domain-rotations') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    const qs = params.toString()
    try {
      const data = await xdashFetch(`/api/intel/domain-rotations${qs ? '?' + qs : ''}`, `xd-rot:${qs}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] domain-rotations error:', err.message)
      return res.status(200).json({
        generated_at_utc: new Date().toISOString(),
        rows: [],
        _source: 'fallback',
      })
    }
  }

  if (route === 'intel-token') {
    const cgId = req.query.cgId || ''
    if (!cgId) return res.status(400).json({ error: 'Missing cgId' })
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route'); params.delete('cgId')
    const qs = params.toString()
    try {
      const data = await xdashFetch(`/api/intel/token/${encodeURIComponent(cgId)}${qs ? '?' + qs : ''}`, `xd-intel-token:${cgId}:${qs}`, 30_000)
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] intel token error:', err.message)
      return res.status(200).json({
        token: { cg_id: cgId, name: cgId, symbol: cgId.toUpperCase() },
        current_state: {},
        latest: {},
        history: [],
        _source: 'fallback',
      })
    }
  }

  if (route === 'intel-author') {
    const authorId = req.query.authorId || ''
    if (!authorId) return res.status(400).json({ error: 'Missing authorId' })
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route'); params.delete('authorId')
    const qs = params.toString()
    try {
      const data = await xdashFetch(`/api/intel/author/${encodeURIComponent(authorId)}${qs ? '?' + qs : ''}`, `xd-intel-author:${authorId}:${qs}`, 30_000)
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] intel author error:', err.message)
      return res.status(200).json({
        author: { rest_id: authorId, screen_name: authorId, name: authorId },
        latest_signal: {},
        latest_domain_skills: [],
        recent_transitions: [],
        _source: 'fallback',
      })
    }
  }

  if (route === 'category-chatter') {
    const params = new URLSearchParams({
      page: req.query.page || '1',
      per_page: req.query.per_page || '8',
      timeframe: req.query.timeframe || '24h',
      category_scope: req.query.category_scope || 'primary',
    })
    try {
      const data = await xdashFetch(`/api/category-chatter?${params}`, `xd-cat:${params}`, 300_000)
      res.setHeader('Cache-Control', 'public, s-maxage=120')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] category-chatter error:', err.message)
      return res.status(502).json({ error: 'Category data temporarily unavailable' })
    }
  }

  if (route === 'category-momentum') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    try {
      const data = await xdashFetch(`/api/category-momentum?${params}`, `xd-mom:${params}`, 300_000)
      return res.status(200).json(data)
    } catch (err) {
      return res.status(502).json({ error: 'Momentum data unavailable' })
    }
  }

  if (route === 'category-tokens') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    try {
      const data = await xdashFetch(`/api/category-tokens?${params}`, `xd-ctk:${params}`, 300_000)
      return res.status(200).json(data)
    } catch (err) {
      return res.status(502).json({ error: 'Token data unavailable' })
    }
  }

  if (route === 'narratives') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    const qs = params.toString()
    try {
      const data = await xdashFetch(`/api/narratives${qs ? '?' + qs : ''}`, `xd-narr:${qs}`, 120_000)
      res.setHeader('Cache-Control', 'public, s-maxage=120')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] narratives error:', err.message)
      return res.status(200).json({ generated_at_utc: new Date().toISOString(), items: [], _source: 'fallback' })
    }
  }

  if (route === 'narrative-tokens') {
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route')
    const qs = params.toString()
    try {
      const data = await xdashFetch(`/api/narrative-tokens${qs ? '?' + qs : ''}`, `xd-narrtk:${qs}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] narrative-tokens error:', err.message)
      return res.status(200).json({ generated_at_utc: new Date().toISOString(), tokens: [], items: [], _source: 'fallback' })
    }
  }

  if (route === 'kols') {
    const params = new URLSearchParams({
      page: req.query.page || '1',
      per_page: req.query.per_page || '12',
      timeframe: req.query.timeframe || '24h',
      sort: req.query.sort || 'activity',
    })
    if (req.query.query) params.set('query', req.query.query)
    try {
      const data = await xdashFetch(`/api/kols?${params}`, `xd-kols:${params}`, 60_000)
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] kols error:', err.message)
      return res.status(502).json({ error: 'Creator board temporarily unavailable' })
    }
  }

  if (route === 'author') {
    const authorId = req.query.authorId || ''
    if (!authorId) return res.status(400).json({ error: 'Missing authorId' })
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route'); params.delete('authorId')
    const qs = params.toString()
    try {
      const data = await xdashFetch(`/api/author/${encodeURIComponent(authorId)}${qs ? '?' + qs : ''}`, `xd-author:${authorId}:${qs}`, 30_000)
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] author error:', err.message)
      return res.status(200).json({
        author: { rest_id: authorId, screen_name: authorId, name: authorId },
        tokens: [],
        mentions: [],
        top_mentions: [],
        totals: { mention_count: 0, tokens_mentioned_count: 0 },
        _source: 'fallback',
      })
    }
  }

  if (route === 'token') {
    const cgId = req.query.cgId || ''
    if (!cgId) return res.status(400).json({ error: 'Missing cgId' })
    const params = new URLSearchParams(req.query)
    params.delete('fn'); params.delete('route'); params.delete('cgId')
    const qs = params.toString()
    try {
      const data = await xdashFetch(`/api/token/${encodeURIComponent(cgId)}${qs ? '?' + qs : ''}`, `xd-tok:${cgId}:${qs}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    } catch (err) {
      // Return minimal shape so frontend doesn't break
      return res.status(200).json({
        token: {
          token: { cg_id: cgId, name: cgId, symbol: cgId.toUpperCase(), handle: cgId },
          metrics: { mentions_24h: 0, unique_authors_24h: 0, total_weighted_engagement: 0 },
        },
        authors: [], mentions: [], top_mentions: [], _source: 'fallback',
      })
    }
  }

  // ── Momentum / Potential Gainers ──────────────────────────────────────
  // Premium leaderboard distilled from X social intelligence. Upstream
  // paths are /api/momentum/* (NOT under /api/xdash/*). Vercel rewrites
  // map /api/momentum/* -> social-api?fn=xdash&route=momentum-*.
  if (route === 'momentum-setups') {
    const params = new URLSearchParams({
      timeframe: req.query.timeframe === '24h' ? '24h' : '7d',
      limit: String(Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 20)),
      scan_limit: String(Math.min(Math.max(parseInt(req.query.scan_limit, 10) || 500, 50), 2000)),
      include_reversals: req.query.include_reversals === 'true' ? 'true' : 'false',
      include_performance: req.query.include_performance === 'false' ? 'false' : 'true',
    })
    try {
      const data = await xdashFetch(`/api/momentum/setups?${params}`, `mom-setups:${params}`, 60_000)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[momentum] setups error:', err.message)
      return res.status(502).json({ error: 'Potential Gainers board temporarily unavailable' })
    }
  }

  if (route === 'momentum-performance') {
    const params = new URLSearchParams({
      timeframe: req.query.timeframe === '24h' ? '24h' : '7d',
      days: String(Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 90)),
      model: req.query.model || 'daily_unique',
    })
    try {
      const data = await xdashFetch(`/api/momentum/setups/performance?${params}`, `mom-perf:${params}`, 300_000)
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[momentum] performance error:', err.message)
      return res.status(502).json({ error: 'Performance tracker temporarily unavailable' })
    }
  }

  if (route === 'momentum-history') {
    const params = new URLSearchParams({
      timeframe: req.query.timeframe === '24h' ? '24h' : '7d',
      days: String(Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 90)),
      bucket: req.query.bucket === 'top20' ? 'top20' : 'top10',
      limit_snapshots: String(Math.min(Math.max(parseInt(req.query.limit_snapshots, 10) || 48, 1), 168)),
    })
    try {
      const data = await xdashFetch(`/api/momentum/setups/history?${params}`, `mom-hist:${params}`, 300_000)
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[momentum] history error:', err.message)
      return res.status(502).json({ error: 'Signal history temporarily unavailable' })
    }
  }

  if (route === 'momentum-receipts') {
    const params = new URLSearchParams({
      timeframe: req.query.timeframe === '24h' ? '24h' : '7d',
      days: String(Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 90)),
      bucket: req.query.bucket === 'top20' ? 'top20' : 'top10',
      model: req.query.model || 'first_ever',
      limit: String(Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100)),
    })
    try {
      const data = await xdashFetch(`/api/momentum/setups/receipts?${params}`, `mom-rcpt:${params}`, 300_000)
      // Reconcile in real momentum calls missing from the upstream receipts
      // table (see _lib/momentum-reconcile.js — ANSEM's corrected $5.85M entry).
      const reconciled = await reconcileReceipts(data, { bucket: req.query.bucket === 'top20' ? 'top20' : 'top10' })
      // Re-base Biggest Calls to the TRUE first-social-catch entry (momentum_origin)
      // so runners show real magnitude (KINS +1,135% not the late-flag +46%) + inject
      // the top runners PG's late flag missed. Never fails the response.
      let final = reconciled
      try {
        const tr = await spectreXBubblesFetch('/v1/social/track-record', 'sort=peak&limit=100', 12_000)
        final = rebaseReceiptsToOrigin(reconciled, tr)
      } catch (e) { console.warn('[momentum] receipts rebase skipped:', e.message) }
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      return res.status(200).json(final)
    } catch (err) {
      console.error('[momentum] receipts error:', err.message)
      return res.status(502).json({ error: 'Receipts temporarily unavailable' })
    }
  }

  // ── Social Market Read (thesis) ───────────────────────────────────────
  // Editorial "what's working / conviction / froth" read distilled from the
  // social corpus. NOTE: this lives on the Spectre Data API (Hetzner), NOT
  // the X Dash dashboard backend — so it uses the Spectre key + base, like
  // the x-bubbles / mindshare routes below, not xdashFetch.
  if (route === 'thesis') {
    const scope = ['general', '24h', 'combined'].includes(req.query.scope) ? req.query.scope : 'combined'
    const cacheKey = `xd-thesis:${scope}`
    const cached = getCached(cacheKey, 300_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      return res.status(200).json(cached)
    }
    try {
      const raw = await spectreXBubblesFetch('/v1/social/thesis', `scope=${encodeURIComponent(scope)}`)
      // Data API wraps the thesis as { data: <payload>, meta, stale? }. The panel
      // (xd-thesis.jsx) + hook consume the BARE payload (regime / general_7d /
      // timeframed_24h / proof at the top level), so unwrap .data here.
      const data = raw && raw.data ? { ...raw.data, stale: raw.stale === true } : raw
      setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] thesis error:', err.message)
      // Fail-soft: stale marker so the panel can show its degraded state
      // instead of vanishing. The UI tolerates missing sections.
      return res.status(200).json({
        generated_at: new Date().toISOString(),
        reference_now: new Date().toISOString(),
        stale: true,
        _source: 'fallback',
      })
    }
  }

  // ── Multi-window social leaderboard + Staying Power ───────────────────
  // Spectre's Daily/Weekly/Monthly/All-time leaderboard with the durability
  // ("Staying Power") score + trend. Lives on the Spectre Data API (Hetzner),
  // so it uses spectreXBubblesFetch, NOT xdashFetch.
  //   ?window=24h|7d|30d|all  ?ranking=mentions|weighted|signal|staying|velocity|presence
  //   ?limit= ?min_mcap= ?fields=staying
  if (route === 'leaderboard') {
    const win = ['24h', '7d', '30d', 'all'].includes(req.query.window) ? req.query.window : '24h'
    const p = new URLSearchParams({ window: win })
    if (req.query.ranking) p.set('ranking', String(req.query.ranking))
    if (req.query.limit) p.set('limit', String(req.query.limit))
    if (req.query.min_mcap) p.set('min_mcap', String(req.query.min_mcap))
    if (req.query.fields) p.set('fields', String(req.query.fields))
    const qs = p.toString()
    const cacheKey = `xd-lb-win:${qs}`
    const cached = getCached(cacheKey, 120_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json(cached)
    }
    try {
      const data = await spectreXBubblesFetch('/v1/social/leaderboard-rollup', qs, 20_000)
      if (data && data.data) setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] leaderboard(window) error:', err.message)
      return res.status(200).json({ data: null, status: 'degraded', reason: err.message })
    }
  }

  // ── Narrative Constellation (tokens by category, colored by authenticity) ─
  if (route === 'constellation') {
    const p = new URLSearchParams()
    for (const k of ['limit', 'min_mentions']) {
      if (req.query[k] != null && req.query[k] !== '') p.set(k, String(req.query[k]))
    }
    const qs = p.toString()
    const cacheKey = `xd-constellation:${qs}`
    const cached = getCached(cacheKey, 60_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180')
      return res.status(200).json(cached)
    }
    try {
      const data = await spectreXBubblesFetch('/v1/social/constellation', qs, 20_000)
      if (data && data.data) setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] constellation error:', err.message)
      return res.status(200).json({ data: null, status: 'degraded', reason: err.message })
    }
  }

  // ── Track Record (paper-trading accountability ledger) ────────────────
  // Spectre's $1k-per-call ledger off momentum_origin — portfolio stats + every
  // call. Powers the Provenance Tape. Spectre Data API, not xdashFetch.
  if (route === 'track-record') {
    const p = new URLSearchParams()
    for (const k of ['sort', 'limit', 'min_roi', 'status', 'pop']) {
      if (req.query[k] != null && req.query[k] !== '') p.set(k, String(req.query[k]))
    }
    const qs = p.toString()
    const cacheKey = `xd-tr:${qs}`
    const cached = getCached(cacheKey, 120_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json(cached)
    }
    try {
      const raw = await spectreXBubblesFetch('/v1/social/track-record', qs, 20_000)
      // Inject real calls missing from the Hetzner track-record (ANSEM's $5.85M
      // call) so they show in Biggest Calls + the tape. See _lib/momentum-reconcile.js.
      const data = await reconcileTrackRecord(raw)
      if (data && data.data) setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] track-record error:', err.message)
      return res.status(200).json({ data: null, status: 'degraded', reason: err.message })
    }
  }

  // ── Early Runners (pre-CoinGecko lane, worker-early-runner-detector) ──
  // Rich rows (CA, chain, buzz, mcap_at_confirm + self-grading at +24/48/72h)
  // for the X Intel Signal Desk. Spectre Data API, not xdashFetch.
  if (route === 'early-runners') {
    const p = new URLSearchParams()
    if (req.query.limit != null && req.query.limit !== '') p.set('limit', String(req.query.limit))
    const qs = p.toString()
    const cacheKey = `xd-er:${qs}`
    const cached = getCached(cacheKey, 60_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180')
      return res.status(200).json(cached)
    }
    try {
      const data = await spectreXBubblesFetch('/v1/social/early-runners', qs, 15_000)
      if (data && data.data) setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] early-runners error:', err.message)
      return res.status(200).json({ data: null, status: 'degraded', reason: err.message })
    }
  }

  // ── Live paper agent (the FORWARD, non-backtest proof) ────────────────
  // Spectre's social-conviction paper trader (paper_traders id 9) trading the
  // audited policy in real time. Combines trader detail + equity curve from the
  // Spectre Data API paper-trading endpoints for the Proof page's live strip.
  if (route === 'paper-trader') {
    // Spectre's live social-trading paper agents (paper_traders). Returns EACH
    // agent's detail + open/recent positions + equity curve so the Proof "picks"
    // panel can show every token an agent bought, entry mcap -> current mcap.
    const ids = String(req.query.ids || '9,10,11,12').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6)
    const cacheKey = `xd-paper:${ids.join(',')}`
    const cached = getCached(cacheKey, 60_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }
    try {
      const agents = await Promise.all(ids.map(async (id) => {
        const [detail, equity] = await Promise.all([
          spectreXBubblesFetch(`/v1/paper-trading/${encodeURIComponent(id)}`, '', 12_000).catch(() => null),
          spectreXBubblesFetch(`/v1/paper-trading/${encodeURIComponent(id)}/equity`, '', 12_000).catch(() => null),
        ])
        if (!detail?.data?.trader) return null
        return { ...detail.data, equity: Array.isArray(equity?.data) ? equity.data : [] }
      }))
      const list = agents.filter(Boolean)
      const data = { data: { agents: list } }
      if (list.length) setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] paper-trader error:', err.message)
      return res.status(200).json({ data: null, status: 'degraded', reason: err.message })
    }
  }

  // ── Momentum Origin (Spectre's immutable first-ever catch) ────────────
  // Spectre's OWN record of the market cap the FIRST time it surfaced a token
  // socially - never resets when the token leaves + re-enters the X Dash board
  // (which is why a $7.6M early catch was reading "+51% from a $25M re-entry").
  // Lives on the Spectre Data API (Hetzner), so it uses spectreXBubblesFetch,
  // NOT xdashFetch. Returns { data: { entry_market_cap, last_market_cap,
  // roi_pct, peak_roi_pct, ... }, meta } or a degraded envelope when untracked.
  if (route === 'momentum-origin') {
    const asset = String(req.query.asset || '').trim()
    if (!asset) return res.status(400).json({ error: 'Missing asset' })
    const cacheKey = `xd-mo:${asset.toLowerCase()}`
    const cached = getCached(cacheKey, 120_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json(cached)
    }
    try {
      const data = await spectreXBubblesFetch(`/v1/social/momentum-origin/${encodeURIComponent(asset)}`)
      // Only cache real hits - a degraded (no-row) reply should retry sooner so
      // a token's origin appears as soon as the tracker records it.
      if (data && data.data) setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] momentum-origin error:', err.message)
      // Fail-soft: degraded envelope so the drawer falls back to the X Dash
      // momentum_entry instead of erroring.
      return res.status(200).json({ data: null, status: 'degraded', reason: err.message })
    }
  }

  // ── Cross-platform mentions (Spectre Data API mention_events) ─────────
  // Powers the RZ mentions panel (X / TG / Reddit / YT aggregated, per-mention
  // sentiment labels + hourly velocity buckets). Was Express-dev-only until
  // 2026-07-02 — the panel 404'd on app.spectreai.io (API audit gap E#5).
  if (route === 'mentions') {
    const asset = String(req.query.asset || '').trim().toUpperCase()
    if (!asset || !/^[A-Z0-9$._-]{1,20}$/.test(asset)) {
      return res.status(400).json({ error: 'Missing asset' })
    }
    const since = Math.min(Math.max(parseInt(req.query.since, 10) || 1440, 30), 10080)
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100)
    const platforms = String(req.query.platforms || '').replace(/[^a-z,]/g, '')
    const qs = `since=${since}&limit=${limit}${platforms ? `&platforms=${platforms}` : ''}`
    const cacheKey = `xd-mentions:${asset}:${qs}`
    const cached = getCached(cacheKey, 30_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json(cached)
    }
    try {
      const data = await spectreXBubblesFetch(`/v1/social/mentions/${encodeURIComponent(asset)}?${qs}`)
      setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[xdash] mentions error:', err.message)
      return res.status(200).json({ data: null, status: 'degraded', reason: err.message })
    }
  }

  // Persistent Potential Gainers signal board - each token is a PG signal
  // with a lifecycle phase, tracked from its first PG timestamp.
  if (route === 'momentum-signals') {
    const params = new URLSearchParams({
      timeframe: req.query.timeframe === '24h' ? '24h' : '7d',
      bucket: req.query.bucket === 'top20' ? 'top20' : 'top10',
      watch_days: String(Math.min(Math.max(parseInt(req.query.watch_days, 10) || 10, 1), 60)),
      limit: String(Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100)),
    })
    try {
      const raw = await xdashFetch(`/api/momentum/setups/signals?${params}`, `mom-signals:${params}`, 60_000)
      // Strip phantom glitched tokens (ANSEM/the-black-bull frozen at $90.9M) so
      // they don't show as fresh signals + dupe the reconciled receipts.
      const data = stripGlitchedSignals(raw)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[momentum] signals error:', err.message)
      return res.status(502).json({ error: 'Potential Gainers signals temporarily unavailable' })
    }
  }

  return res.status(400).json({ error: `Unknown xdash route: ${route}` })
}

// ── X-Beta routes ───────────────────────────────────────────────────────────
async function handleXBeta(req, res) {
  const route = req.query.route || ''
  const params = new URLSearchParams(req.query)
  params.delete('fn'); params.delete('route'); params.delete('cgId')
  const qs = params.toString()

  let apiPath
  if (route === 'bootstrap') apiPath = `/api/bootstrap?${qs}`
  else if (route === 'search') apiPath = `/api/search?${qs}`
  else if (route === 'token') {
    const cgId = req.query.cgId || ''
    if (!cgId) return res.status(400).json({ error: 'Missing cgId' })
    apiPath = `/api/token/${encodeURIComponent(cgId)}${qs ? '?' + qs : ''}`
  } else {
    return res.status(400).json({ error: `Unknown x-beta route: ${route}` })
  }

  const cacheKey = `xb:${apiPath}`
  const cached = getCached(cacheKey, route === 'search' ? 0 : 60_000)
  if (cached) return res.status(200).json(cached)

  try {
    const r = await fetch(`${X_BETA_BASE}${apiPath}`, {
      headers: {
        Accept: 'application/json',
        ...DASHBOARD_AUTH_HEADERS,
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) throw new Error(`X-Beta ${r.status}`)
    const data = await r.json()
    if (route !== 'search') setCache(cacheKey, data)
    return res.status(200).json(data)
  } catch (err) {
    console.error(`[x-beta] ${route} error:`, err.message, '- falling back to Spectre API')
    // Fallback: bootstrap -> Spectre API, token -> minimal shape
    if (route === 'bootstrap') {
      try {
        const fallback = await spectreApiFallbackBootstrap(parseInt(req.query.per_page) || 50)
        return res.status(200).json(fallback)
      } catch (fbErr) {
        return res.status(502).json({ error: 'X-Beta service unavailable' })
      }
    }
    if (route === 'token') {
      const cgId = req.query.cgId || ''
      return res.status(200).json({
        token: { token: { cg_id: cgId, name: cgId, symbol: cgId.toUpperCase() }, metrics: {} },
        authors: [], mentions: [], top_mentions: [], _source: 'fallback',
      })
    }
    return res.status(502).json({ error: 'X-Beta service unavailable' })
  }
}

// ── X-Bubbles (Spectre social heatmap) ─────────────────────────────────────
// Proxies to api.spectreai.io/v1/social/x-bubbles. Powers /x-bubbles page.
// Auth via SPECTRE_API_KEY env var (internal research key).
async function spectreXBubblesFetch(path, params = '', timeoutMs = 10000) {
  const url = `${SPECTRE_API_BASE}${path}${params ? `?${params}` : ''}`
  const r = await fetch(url, {
    headers: { Accept: 'application/json', ...(SPECTRE_API_KEY_VAL ? { 'X-API-Key': SPECTRE_API_KEY_VAL } : {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) throw new Error(`Spectre API ${r.status}`)
  return r.json()
}

async function handleXBubbles(req, res) {
  const route = req.query.route || 'leaderboard'

  if (route === 'leaderboard') {
    const limit = Math.min(parseInt(req.query.limit) || 120, 1500)
    const minVolume = Math.max(parseInt(req.query.min_volume) || 1, 1)
    const ranking = String(req.query.ranking || 'mentions').toLowerCase()
    const params = new URLSearchParams({
      limit: String(limit),
      min_volume: String(minVolume),
      ranking,
    }).toString()
    const cacheKey = `xb-lb:${params}`
    const lastGoodKey = `xb-lb-good:${params}`
    const cached = getCached(cacheKey, 30_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json(cached)
    }
    try {
      // The x-bubbles query is slow on a cold cache (~5-9s, can spike >10s).
      // Give it room under the function's 30s budget so a cold miss returns
      // real data instead of being killed at the old 10s abort.
      const data = await spectreXBubblesFetch('/v1/social/x-bubbles', params, 22_000)
      setCache(cacheKey, data)
      if (data && Array.isArray(data.data) && data.data.length) setCache(lastGoodKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[x-bubbles] leaderboard error:', err.message)
      // Serve the last good payload (stale) rather than blanking the tab on a
      // transient slow/failed upstream.
      const stale = getCached(lastGoodKey, 6 * 60 * 60_000)
      if (stale) {
        res.setHeader('Cache-Control', 'public, s-maxage=15')
        return res.status(200).json({ ...stale, meta: { ...(stale.meta || {}), stale: true } })
      }
      return res.status(502).json({ error: 'X-Bubbles upstream unavailable', detail: err.message, data: [] })
    }
  }

  if (route === 'token') {
    const asset = String(req.query.asset || '').toUpperCase().trim()
    if (!asset) return res.status(400).json({ error: 'Missing :asset' })
    const cacheKey = `xb-tok:${asset}`
    const cached = getCached(cacheKey, 60_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }
    try {
      const data = await spectreXBubblesFetch(`/v1/social/x-bubbles/${encodeURIComponent(asset)}`)
      setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    } catch (err) {
      console.error('[x-bubbles] token error:', err.message)
      return res.status(502).json({ error: 'X-Bubbles upstream unavailable', detail: err.message })
    }
  }

  return res.status(400).json({ error: `Unknown x-bubbles route: ${route}` })
}

// ── Mindshare Heatmap (Spectre narrative-lifecycle composer) ───────────────
// Proxies to api.spectreai.io/v1/social/mindshare/heatmap. Powers the Market
// Treemap "Mindshare" view. Returns { data: [...], meta: {...} } where each
// row carries mindshare_pct, momentum, color bucket, plus joined assets +
// price-changes data ready for treemap rendering.
async function handleMindshareHeatmap(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  // Pass through optional filters when supplied. The upstream silently
  // ignores unknown keys, so it is safe to forward only the known ones.
  if (req.query.momentum) params.set('momentum', String(req.query.momentum))
  if (req.query.min_mindshare) params.set('min_mindshare', String(req.query.min_mindshare))
  if (req.query.sector) params.set('sector', String(req.query.sector))
  const qs = params.toString()

  const cacheKey = `ms-hm:${qs}`
  const cached = getCached(cacheKey, 30_000)
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return res.status(200).json(cached)
  }
  try {
    const data = await spectreXBubblesFetch('/v1/social/mindshare/heatmap', qs)
    setCache(cacheKey, data)
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return res.status(200).json(data)
  } catch (err) {
    console.error('[mindshare-heatmap] error:', err.message)
    return res.status(502).json({
      error: 'Mindshare heatmap upstream unavailable',
      detail: err.message,
      data: [],
      meta: { ts: Date.now(), count: 0 },
    })
  }
}

export { handleXDash, handleXBeta, handleXBubbles, handleMindshareHeatmap }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const fn = req.query.fn || ''
  if (fn === 'xdash') return handleXDash(req, res)
  if (fn === 'x-beta') return handleXBeta(req, res)
  if (fn === 'x-bubbles') return handleXBubbles(req, res)
  if (fn === 'mindshare-heatmap') return handleMindshareHeatmap(req, res)
  return res.status(400).json({ error: 'Unknown social-proxy function' })
}
