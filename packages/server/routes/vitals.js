/**
 * Express dev mirror of apps/research/api/vitals.js.
 *
 * Both sides require the same packages/server/lib/vitals-core.js, so the only
 * thing duplicated here is transport (the dev/prod parity rule — a route that
 * exists only in Express silently 404s in production).
 *
 * GET /api/vitals?fn=bundle&tier=core|full
 * GET /api/vitals?fn=platform&slug=…&history=21
 * GET /api/vitals?fn=leaderboard&metric=&window=&category=&limit=
 * GET /api/vitals?fn=search&q=
 * GET /api/vitals?fn=compare&slugs=a,b,c
 * GET /api/vitals?fn=analyze&slug=…            AI read, one platform
 * GET /api/vitals?fn=analyze&slugs=a,b         AI read, compare
 */

const express = require('express');
const vitals = require('../lib/vitals-core');
const vitalsAnalysis = require('../lib/vitals-analysis');

const router = express.Router();

const TTL = { bundle: 900, platform: 1800, leaderboard: 900, search: 3600, compare: 1800, analyze: 21_600 };

function cache(res, ttlSec) {
  const header = `public, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 4}`;
  res.set('Cache-Control', header);
  res.set('CDN-Cache-Control', header);
}

router.get('/', async (req, res) => {
  const fn = String(req.query.fn || 'bundle');
  try {
    if (fn === 'bundle') {
      const tier = req.query.tier === 'full' ? 'full' : 'core';
      cache(res, TTL.bundle);
      return res.json(await vitals.getBundle({ tier }));
    }

    if (fn === 'platform') {
      const slug = String(req.query.slug || '').trim().toLowerCase();
      if (!slug) return res.status(400).json({ error: 'slug required' });
      const history = Math.min(45, Math.max(7, Number(req.query.history) || 30));
      const body = await vitals.getPlatform(slug, { history });
      if (!body) return res.status(404).json({ error: 'platform not found', slug });
      cache(res, TTL.platform);
      return res.json(body);
    }

    if (fn === 'leaderboard') {
      cache(res, TTL.leaderboard);
      return res.json(await vitals.getLeaderboard({
        metric: String(req.query.metric || 'fees'),
        window: String(req.query.window || 'd30'),
        category: req.query.category ? String(req.query.category) : null,
        limit: Math.min(200, Math.max(5, Number(req.query.limit) || 50)),
      }));
    }

    if (fn === 'thirdparty') {
      const slug = String(req.query.slug || '').trim().toLowerCase();
      if (!slug) return res.status(400).json({ error: 'slug required' });
      cache(res, TTL.thirdparty);
      return res.json({ thirdParty: await vitals.getThirdParty(slug) });
    }

    if (fn === 'compare') {
      const slugs = String(req.query.slugs || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (slugs.length < 2) return res.status(400).json({ error: 'compare needs at least two slugs' });
      const history = Math.min(730, Math.max(30, Number(req.query.history) || 180));
      cache(res, TTL.compare);
      return res.json(await vitals.getCompare(slugs, { history }));
    }

    if (fn === 'search') {
      const q = String(req.query.q || '').trim().slice(0, 40);
      if (!q) return res.json({ rows: [] });
      cache(res, TTL.search);
      return res.json(await vitals.searchPlatforms(q));
    }

    if (fn === 'analyze') {
      const slugsParam = String(req.query.slugs || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      const slug = String(req.query.slug || '').trim().toLowerCase();
      let body;
      if (slugsParam.length >= 2) {
        body = await vitalsAnalysis.analyseCompare(slugsParam);
      } else if (slug) {
        body = await vitalsAnalysis.analysePlatform(slug);
      } else {
        return res.status(400).json({ error: 'slug or slugs (>=2) required' });
      }
      if (!body) return res.status(200).json({ analysis: null });
      cache(res, TTL.analyze);
      return res.json({ analysis: body });
    }

    return res.status(400).json({ error: `unknown fn "${fn}"` });
  } catch (err) {
    console.error('[vitals]', fn, err && err.message ? err.message : err);
    return res.status(502).json({ error: 'vitals upstream unavailable', fn });
  }
});

module.exports = router;
