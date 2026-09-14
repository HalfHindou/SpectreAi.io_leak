/**
 * Vercel Serverless – Heatmap aggregator
 * Fetches multiple pages of CoinGecko coins/markets for the heatmap view.
 * GET /api/coingecko/heatmap?limit=500&category=CATEGORY_ID
 */

import { rateLimit } from '../ratelimit.js';

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

// In-memory cache (persists across warm invocations)
const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (await rateLimit(req, res, { bucket: 'heatmap', max: 30, windowMs: 60_000 })) return;

  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
    const category = req.query.category || '';
    const cacheKey = `heatmap_${category || 'all'}_${limit}`;
    const now = Date.now();

    if (cache[cacheKey] && (now - cache[cacheKey]._ts < CACHE_TTL)) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.json({ data: cache[cacheKey].data, total: cache[cacheKey].data.length, cached: true });
    }

    const allCoins = [];
    const totalPages = Math.ceil(limit / 250);
    const headers = { Accept: 'application/json' };
    if (COINGECKO_API_KEY) headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;

    for (let page = 1; page <= totalPages; page++) {
      if (page > 1) await new Promise(r => setTimeout(r, COINGECKO_API_KEY ? 300 : 7000));
      const perPage = Math.min(250, limit - allCoins.length);
      let url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=1h,24h,7d,30d`;
      if (category) url += `&category=${encodeURIComponent(category)}`;

      let cgRes;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        cgRes = await fetch(url, { headers });
        if (cgRes.status !== 429) break;
      }
      if (!cgRes.ok) {
        if (page === 1) throw new Error(`CoinGecko API error: ${cgRes.status}`);
        break;
      }
      const data = await cgRes.json();
      if (!Array.isArray(data) || data.length === 0) break;
      allCoins.push(...data);
      if (allCoins.length >= limit) break;
    }

    const result = allCoins.slice(0, limit);
    cache[cacheKey] = { data: result, _ts: now };

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.json({ data: result, total: result.length, cached: false });
  } catch (err) {
    console.error('Heatmap fetch error:', err.message);
    const cacheKey = `heatmap_${req.query.category || 'all'}_${Math.min(parseInt(req.query.limit) || 500, 1000)}`;
    if (cache[cacheKey]?.data) {
      return res.json({ data: cache[cacheKey].data, total: cache[cacheKey].data.length, cached: true });
    }
    return res.status(500).json({ error: err.message });
  }
}
