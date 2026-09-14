/**
 * Vercel Serverless – X Dash token intelligence proxy
 * GET /api/x-dash-token?cgId=spectre-ai[&force=true][&author_scope=top|all][&author_id=X]
 *
 * Proxies to the X Dash API with Bearer + x-api-key auth.
 * Key is server-side only via XDASH_API_TOKEN / DASHBOARD_API_KEY / X_DASH_API_KEY.
 *
 * 2026-07-16: the old GCP Cloud Run host (x-dash-api-*.run.app) was
 * decommissioned (returned Google 404 for every token, so the whole X Dash
 * surface read "Not tracked"). Base is now env-driven and defaults to the
 * Hetzner self-hosted instance — same source the dev Express router
 * (packages/server/routes/x-dash.js) and api/xdash.js already use.
 */

import { isAuthGateValid } from './auth-gate.js';

const X_DASH_API_BASE = (
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '');
const CACHE_TTL = 60 * 1000; // 60s — token detail is the freshest endpoint per Alaa

const tokenCache = new Map();

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

// CoinGecko IDs are lowercase alphanumeric with hyphens. Start with alphanumeric.
const CG_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const AUTHOR_SCOPE_RE = /^(top|all)$/;
const AUTHOR_ID_RE = /^[a-zA-Z0-9_]{1,40}$/;

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
    console.warn('[x-dash-token] X_DASH_API_KEY not configured');
    return res.status(503).json({
      error: 'X Dash API key not configured',
      message: 'Set X_DASH_API_KEY in the server environment.',
    });
  }

  try {
    const cgId = (req.query.cgId || '').trim().toLowerCase();
    if (!cgId) {
      return res.status(400).json({ error: 'cgId query parameter is required' });
    }
    if (!CG_ID_RE.test(cgId)) {
      return res.status(400).json({ error: 'Invalid cgId format' });
    }

    // Optional query params — validate before forwarding
    const force = req.query.force === 'true';
    const authorScope = (req.query.author_scope || '').trim();
    const authorId = (req.query.author_id || '').trim();

    if (authorScope && !AUTHOR_SCOPE_RE.test(authorScope)) {
      return res.status(400).json({ error: 'Invalid author_scope' });
    }
    if (authorId && !AUTHOR_ID_RE.test(authorId)) {
      return res.status(400).json({ error: 'Invalid author_id' });
    }

    const cacheKey = `token:${cgId}:${authorScope}:${authorId}`;
    const cached = tokenCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      return res.json(cached.data);
    }

    const upstreamParams = new URLSearchParams();
    if (force) upstreamParams.set('force', 'true');
    if (authorScope) upstreamParams.set('author_scope', authorScope);
    if (authorId) upstreamParams.set('author_id', authorId);
    const qs = upstreamParams.toString();
    const url = `${X_DASH_API_BASE}/api/token/${encodeURIComponent(cgId)}${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`X Dash API returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    tokenCache.set(cacheKey, { data, timestamp: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
    return res.json(data);
  } catch (err) {
    console.error('[x-dash-token] proxy error:', err.message);

    // Return stale cache on transient failures
    const cgId = (req.query.cgId || '').trim().toLowerCase();
    const authorScope = (req.query.author_scope || '').trim();
    const authorId = (req.query.author_id || '').trim();
    const cacheKey = `token:${cgId}:${authorScope}:${authorId}`;
    const stale = tokenCache.get(cacheKey);
    if (stale) {
      res.setHeader('X-Cache-Status', 'stale');
      return res.json(stale.data);
    }

    return res.status(502).json({
      error: 'Failed to fetch X Dash token intelligence',
      message: err.message,
    });
  }
}
