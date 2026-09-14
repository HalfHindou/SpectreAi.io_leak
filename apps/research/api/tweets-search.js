/**
 * Vercel Serverless – Search tweets proxy for Research app
 * GET /api/tweets/search?query=$SPECT OR @spectre__ai
 * Same endpoint as trading app. Proxies to external backend and caches for 5 minutes.
 */

import { isAuthGateValid } from './auth-gate.js';
import { sealGatedResponse } from './_lib/gate-cache.js'

// 2026-07-29: repointed. The Cloud Run service above was decommissioned and
// returns 500 on EVERY route — the dev vite proxy was moved to api.spectreai.io
// in 9082dc29 but these serverless handlers were not, so tweets died in prod
// only. Route names changed with the host: /search_tweets -> /api/tweets/search,
// /get_official_tweets -> /api/tweets/official.
const TWEETS_API_BASE = 'https://api.spectreai.io';

const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 2026-05-11 lockdown: backend tweet search burns X-Dash quota.
  if (!isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }
  // A response only this gate allowed must not land in a SHARED cache — the
  // edge keys on the URL alone, so a warm entry would answer the next
  // anonymous caller without the gate running. See _lib/gate-cache.js.
  sealGatedResponse(res)

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

    const url = `${TWEETS_API_BASE}/api/tweets/search?query=${encodeURIComponent(query)}`;
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

    res.status(502).json({ error: 'Failed to search tweets', message: err.message });
  }
}
