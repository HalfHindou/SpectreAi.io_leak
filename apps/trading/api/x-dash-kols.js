/**
 * Vercel Serverless – X Dash KOL leaderboard proxy
 * GET /api/x-dash-kols[?timeframe=24h|7d][&sort=activity|reach][&per_page=20]
 *
 * Global KOL leaderboard. Used as a fallback context panel when token detail
 * doesn't return enough top_authors, and for sanity-check UI ("is this author
 * a known KOL globally").
 */

import { isAuthGateValid } from './auth-gate.js';

// 2026-07-16: repointed off the decommissioned GCP Cloud Run host (Google 404)
// to the env-driven Hetzner instance — mirrors packages/server/routes/x-dash.js.
const X_DASH_API_BASE = (
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '');
const CACHE_TTL = 5 * 60 * 1000; // 5min

const kolsCache = new Map();

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

const TIMEFRAME_RE = /^(24h|7d)$/;
const SORT_RE = /^(activity|reach)$/;

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : ''
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 2026-05-11 lockdown: X-Dash quota.
  if (!isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }

  const apiKey = (process.env.XDASH_API_TOKEN || process.env.DASHBOARD_API_KEY || process.env.X_DASH_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[x-dash-kols] X_DASH_API_KEY not configured');
    return res.status(503).json({ error: 'X Dash API key not configured' });
  }

  try {
    const timeframe = (req.query.timeframe || '24h').trim();
    const sort = (req.query.sort || 'activity').trim();
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 20, 50);

    if (!TIMEFRAME_RE.test(timeframe)) return res.status(400).json({ error: 'Invalid timeframe' });
    if (!SORT_RE.test(sort)) return res.status(400).json({ error: 'Invalid sort' });

    const cacheKey = `kols:${timeframe}:${sort}:${perPage}`;
    const cached = kolsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
      return res.json(cached.data);
    }

    const params = new URLSearchParams({ timeframe, sort, per_page: String(perPage) });
    const url = `${X_DASH_API_BASE}/api/kols?${params.toString()}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`X Dash API returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    kolsCache.set(cacheKey, { data, timestamp: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
    return res.json(data);
  } catch (err) {
    console.error('[x-dash-kols] proxy error:', err.message);

    const timeframe = (req.query.timeframe || '24h').trim();
    const sort = (req.query.sort || 'activity').trim();
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 20, 50);
    const cacheKey = `kols:${timeframe}:${sort}:${perPage}`;
    const stale = kolsCache.get(cacheKey);
    if (stale) {
      res.setHeader('X-Cache-Status', 'stale');
      return res.json(stale.data);
    }

    return res.status(502).json({ error: 'Failed to fetch KOLs', message: err.message });
  }
}
