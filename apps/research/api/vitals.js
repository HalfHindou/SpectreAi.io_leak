/**
 * /api/vitals — the data surface behind the VITALS page (platform fundamentals).
 *
 * Thin transport. All logic lives in packages/server/lib/vitals-core.js, which
 * the Express dev server requires directly, so dev and prod cannot drift (the
 * parity rule in the root CLAUDE.md, principle 5).
 *
 *   ?fn=bundle&tier=core|full   index payload: tide, ladders, categories, first-hand
 *   ?fn=platform&slug=…         one platform, full detail + first-hand history
 *   ?fn=leaderboard&metric=&window=&category=&limit=
 *   ?fn=search&q=
 *   ?fn=thirdparty&slug=…      third-party user block; its own request so the
 *                               platform page never waits on a rate-limited lane
 *   ?fn=compare&slugs=a,b,c    two to four platforms side by side + aligned series
 *   ?fn=analyze&slug=…         Gemini-powered AI read, one platform
 *   ?fn=analyze&slugs=a,b      Gemini-powered AI read, compare
 *
 * Caching is two-layer: the core holds a process-local TTL cache (warm lambda)
 * and KV holds a cross-instance copy with a last-good fallback, so a cold
 * instance or a wobbly upstream never blanks the page.
 */

import { createRequire } from 'node:module'
import { getJsonWithTTL, setJsonWithTTL } from './_lib/kv.js'
import { rateLimit } from './_lib/ratelimit.js'

const require = createRequire(import.meta.url)
const vitals = require('../../../packages/server/lib/vitals-core.js')
const vitalsAnalysis = require('../../../packages/server/lib/vitals-analysis.js')

// Edge + KV TTLs per function. The first-hand archive publishes once a day and
// the shadow dimensions move hourly, so nothing here needs to be seconds-fresh.
const TTL = {
  bundle: 900,      // 15 min
  platform: 1800,   // 30 min
  leaderboard: 900,
  search: 3600,
  compare: 1800,
  analyze: 21_600,  // 6h — an LLM read on slow-moving fundamentals, worth caching hard
}

const KV_PREFIX = 'spectre:vitals:v1:'

async function withKv(key, ttlSec, produce) {
  const kvKey = KV_PREFIX + key
  try {
    const hit = await getJsonWithTTL(kvKey)
    if (hit && hit.value !== undefined && hit.expires > Date.now()) return hit.value
    var stale = hit && hit.value !== undefined ? hit.value : null
  } catch { /* KV is an accelerator, never a dependency */ }

  try {
    const value = await produce()
    // Store our own expiry alongside so a stale-but-present entry can still be
    // served when the upstream is down.
    setJsonWithTTL(kvKey, { value, expires: Date.now() + ttlSec * 1000 }, ttlSec * 6).catch(() => {})
    return value
  } catch (err) {
    if (typeof stale !== 'undefined' && stale) return stale
    throw err
  }
}

function sendCached(res, ttlSec, body) {
  const header = `public, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 4}`
  res.setHeader('Cache-Control', header)
  res.setHeader('CDN-Cache-Control', header)
  return res.status(200).json(body)
}

export default async function handler(req, res) {
  const fn = String(req.query.fn || 'bundle')

  const limited = await rateLimit(req, res, { bucket: 'vitals', max: 120, windowMs: 60_000 })
  if (limited) return

  try {
    if (fn === 'bundle') {
      const tier = req.query.tier === 'full' ? 'full' : 'core'
      const body = await withKv(`bundle:${tier}`, TTL.bundle, () => vitals.getBundle({ tier }))
      return sendCached(res, TTL.bundle, body)
    }

    if (fn === 'platform') {
      const slug = String(req.query.slug || '').trim().toLowerCase()
      if (!slug) return res.status(400).json({ error: 'slug required' })
      const history = Math.min(45, Math.max(7, Number(req.query.history) || 30))
      const body = await withKv(`platform:${slug}:${history}`, TTL.platform,
        () => vitals.getPlatform(slug, { history }))
      if (!body) return res.status(404).json({ error: 'platform not found', slug })
      return sendCached(res, TTL.platform, body)
    }

    if (fn === 'leaderboard') {
      const opts = {
        metric: String(req.query.metric || 'fees'),
        window: String(req.query.window || 'd30'),
        category: req.query.category ? String(req.query.category) : null,
        limit: Math.min(200, Math.max(5, Number(req.query.limit) || 50)),
      }
      const key = `lb:${opts.metric}:${opts.window}:${opts.category || 'all'}:${opts.limit}`
      const body = await withKv(key, TTL.leaderboard, () => vitals.getLeaderboard(opts))
      return sendCached(res, TTL.leaderboard, body)
    }

    if (fn === 'thirdparty') {
      const slug = String(req.query.slug || '').trim().toLowerCase()
      if (!slug) return res.status(400).json({ error: 'slug required' })
      const body = await withKv(`tp:${slug}`, TTL.thirdparty, async () => ({ thirdParty: await vitals.getThirdParty(slug) }))
      return sendCached(res, TTL.thirdparty, body)
    }

    if (fn === 'compare') {
      const slugs = String(req.query.slugs || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
      if (slugs.length < 2) return res.status(400).json({ error: 'compare needs at least two slugs' })
      const history = Math.min(730, Math.max(30, Number(req.query.history) || 180))
      // Sorted in the cache key so a,b and b,a share one entry.
      const key = `cmp:${[...slugs].sort().join('+')}:${history}`
      const body = await withKv(key, TTL.compare, () => vitals.getCompare(slugs, { history }))
      return sendCached(res, TTL.compare, body)
    }

    if (fn === 'search') {
      const q = String(req.query.q || '').trim().slice(0, 40)
      if (!q) return res.status(200).json({ rows: [] })
      const body = await withKv(`search:${q.toLowerCase()}`, TTL.search, () => vitals.searchPlatforms(q))
      return sendCached(res, TTL.search, body)
    }

    if (fn === 'analyze') {
      const slugsParam = String(req.query.slugs || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
      const slug = String(req.query.slug || '').trim().toLowerCase()
      let body
      if (slugsParam.length >= 2) {
        // Sorted in the cache key so a,b and b,a share one entry (mirrors ?fn=compare).
        const key = `analyze:v1:${[...slugsParam].sort().join('+')}`
        body = await withKv(key, TTL.analyze, () => vitalsAnalysis.analyseCompare(slugsParam))
      } else if (slug) {
        const key = `analyze:v1:${slug}`
        body = await withKv(key, TTL.analyze, () => vitalsAnalysis.analysePlatform(slug))
      } else {
        return res.status(400).json({ error: 'slug or slugs (>=2) required' })
      }
      if (!body) return res.status(200).json({ analysis: null })
      return sendCached(res, TTL.analyze, { analysis: body })
    }

    return res.status(400).json({ error: `unknown fn "${fn}"` })
  } catch (err) {
    console.error('[vitals]', fn, err?.message || err)
    return res.status(502).json({ error: 'vitals upstream unavailable', fn })
  }
}
