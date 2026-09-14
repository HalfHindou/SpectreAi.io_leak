/**
 * Vercel Serverless – X Dash narrative tokens proxy
 * GET /api/x-dash-narrative-tokens?narrative=cats[&timeframe=24h|7d][&ranking=mentions|momentum|conviction]
 *
 * Returns tokens inside a derived narrative. Used by the peer-comparison panel
 * in the X Intelligence dashboard to show which peer tokens sit in the same
 * narrative as the currently selected token.
 */

import { isAuthGateValid } from './auth-gate.js';

// 2026-07-16: repointed off the decommissioned GCP Cloud Run host (Google 404)
// to the env-driven Hetzner instance — mirrors packages/server/routes/x-dash.js.
const X_DASH_API_BASE = (
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '');
const CACHE_TTL = 5 * 60 * 1000; // 5min — narratives shift slowly

const narrativeCache = new Map();

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

// Narrative labels mirror CoinGecko categories verbatim ("Artificial Intelligence (AI)",
// "AI Agents", "Real World Assets (RWA)") so we must allow parens, periods, ampersands
// and slashes — not just word/space/hyphen.
const NARRATIVE_RE = /^[\w\s\-().&'/]{1,80}$/;
const TIMEFRAME_RE = /^(24h|7d)$/;
const RANKING_RE = /^(mentions|momentum|conviction)$/;
const SEGMENT_RE = /^(all|major|opportunity|context)$/;

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
    console.warn('[x-dash-narrative-tokens] X_DASH_API_KEY not configured');
    return res.status(503).json({ error: 'X Dash API key not configured' });
  }

  try {
    const narrative = (req.query.narrative || '').trim();
    if (!narrative) return res.status(400).json({ error: 'narrative query parameter is required' });
    if (!NARRATIVE_RE.test(narrative)) return res.status(400).json({ error: 'Invalid narrative' });

    const timeframe = (req.query.timeframe || '24h').trim();
    const ranking = (req.query.ranking || 'momentum').trim();
    const segment = (req.query.segment || 'all').trim();
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 10, 25);

    if (!TIMEFRAME_RE.test(timeframe)) return res.status(400).json({ error: 'Invalid timeframe' });
    if (!RANKING_RE.test(ranking)) return res.status(400).json({ error: 'Invalid ranking' });
    if (!SEGMENT_RE.test(segment)) return res.status(400).json({ error: 'Invalid segment' });

    const cacheKey = `narr:${narrative.toLowerCase()}:${timeframe}:${ranking}:${segment}:${perPage}`;
    const cached = narrativeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
      return res.json(cached.data);
    }

    // The upstream `/api/narrative-tokens` endpoint returns 400 for every slug
    // we throw at it. The working pattern is `/api/search` with `category` +
    // `category_scope=primary` — same response shape, filtered to that category.
    // Caller-facing API stays `narrative=...` so we can swap the upstream silently.
    const params = new URLSearchParams({
      category: narrative,
      category_scope: 'primary',
      timeframe,
      ranking,
      segment,
      per_page: String(perPage),
    });
    const url = `${X_DASH_API_BASE}/api/search?${params.toString()}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`X Dash API returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    narrativeCache.set(cacheKey, { data, timestamp: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
    return res.json(data);
  } catch (err) {
    console.error('[x-dash-narrative-tokens] proxy error:', err.message);

    const narrative = (req.query.narrative || '').trim().toLowerCase();
    const timeframe = (req.query.timeframe || '24h').trim();
    const ranking = (req.query.ranking || 'momentum').trim();
    const segment = (req.query.segment || 'all').trim();
    const perPage = Math.min(parseInt(req.query.per_page, 10) || 10, 25);
    const cacheKey = `narr:${narrative}:${timeframe}:${ranking}:${segment}:${perPage}`;
    const stale = narrativeCache.get(cacheKey);
    if (stale) {
      res.setHeader('X-Cache-Status', 'stale');
      return res.json(stale.data);
    }

    return res.status(502).json({
      error: 'Failed to fetch narrative tokens',
      message: err.message,
    });
  }
}
