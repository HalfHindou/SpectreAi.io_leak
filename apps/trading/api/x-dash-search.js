/**
 * Vercel Serverless – X Dash token search proxy
 * GET /api/x-dash-search?q=spectre[&timeframe=24h|7d][&ranking=mentions|momentum|conviction]
 *
 * Primary use case: resolving a token symbol to a cgId when token.cgId is null.
 * Secondary: powering search UI inside the X Intelligence dashboard.
 */

import { isAuthGateValid } from './auth-gate.js';

// 2026-07-16: repointed off the decommissioned GCP Cloud Run host (Google 404)
// to the env-driven Hetzner instance — mirrors packages/server/routes/x-dash.js.
const X_DASH_API_BASE = (
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '');
const CACHE_TTL = 2 * 60 * 1000; // 2min — search is cheaper to recompute

const searchCache = new Map();

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

// Permissive but length-capped query validation. Alphanumeric + common punctuation only.
const QUERY_RE = /^[\w\s$@.-]{1,60}$/;
const TIMEFRAME_RE = /^(24h|7d)$/;
const RANKING_RE = /^(mentions|momentum|conviction)$/;

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
    console.warn('[x-dash-search] X_DASH_API_KEY not configured');
    return res.status(503).json({ error: 'X Dash API key not configured' });
  }

  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q query parameter is required' });
    if (q.length > 60 || !QUERY_RE.test(q)) {
      return res.status(400).json({ error: 'Invalid query format' });
    }

    const timeframe = (req.query.timeframe || '24h').trim();
    const ranking = (req.query.ranking || 'mentions').trim();
    if (!TIMEFRAME_RE.test(timeframe)) return res.status(400).json({ error: 'Invalid timeframe' });
    if (!RANKING_RE.test(ranking)) return res.status(400).json({ error: 'Invalid ranking' });

    const cacheKey = `search:${q.toLowerCase()}:${timeframe}:${ranking}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=120');
      return res.json(cached.data);
    }

    const params = new URLSearchParams({ q, timeframe, ranking, per_page: '10' });
    const url = `${X_DASH_API_BASE}/api/search?${params.toString()}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`X Dash API returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    searchCache.set(cacheKey, { data, timestamp: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=120');
    return res.json(data);
  } catch (err) {
    console.error('[x-dash-search] proxy error:', err.message);
    return res.status(502).json({
      error: 'Failed to search X Dash',
      message: err.message,
    });
  }
}
