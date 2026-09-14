/**
 * Vercel Serverless – Search tweets proxy for Trading app
 * GET /api/tweets/search?query=$SPECT OR @spectre__ai
 * Proxies to external backend and caches for 5 minutes.
 */

import { isAuthGateValid, isDemoSession } from './auth-gate.js';

const TWEETS_API_BASE = 'https://backend-277369611639.us-central1.run.app';

const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 2026-05-11 lockdown: X-Dash quota.
  if (!isAuthGateValid(req) && !isDemoSession(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }

  try {
    const query = (req.query.query || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'query parameter is required' });
    }

    const cacheKey = `search:${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      return res.json(cached.data);
    }

    const url = `${TWEETS_API_BASE}/search_tweets?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      throw new Error(`Search tweets API returned ${response.status}`);
    }

    const data = await response.json();
    searchCache.set(cacheKey, { data, timestamp: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
    res.json(data);
  } catch (err) {
    console.error('Search tweets API proxy error:', err.message);

    const cacheKey = `search:${(req.query.query || '').trim().toLowerCase()}`;
    const stale = searchCache.get(cacheKey);
    if (stale) {
      return res.json(stale.data);
    }

    // Graceful degradation: upstream is Sunny's Cloud Run which can rate-limit
    // or 5xx for individual queries. Returning 502 floods every user's console
    // with red errors on the trading page (one /api/tweets/search call per
    // visible token in LeftPanel). Return 200 with empty results + a
    // `degraded: true` flag so the frontend can render "no tweets" cleanly.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ tweets: [], degraded: true, error: err.message });
  }
}
