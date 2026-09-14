/**
 * Vercel Serverless Function — Fear & Greed Index Proxy
 *
 * Proxies CoinMarketCap Pro API v3 so the Chrome extension can fetch
 * the Fear & Greed Index without exposing the CMC API key.
 *
 * GET /api/market/fear-greed
 */

import { rateLimit } from './_lib/ratelimit.js';

const CMC_API_KEY = process.env.CMC_API_KEY || '';
const CMC_URL = 'https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest';

// In-memory cache (persists across warm Vercel invocations)
let cached = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (await rateLimit(req, res, { bucket: 'fear-greed', max: 60, windowMs: 60_000 })) return;

  // Serve from cache if fresh
  if (cached && Date.now() - cachedAt < CACHE_TTL) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
    return res.status(200).json(cached);
  }

  if (!CMC_API_KEY) {
    return res.status(502).json({ error: 'Fear & Greed data unavailable' });
  }

  try {
    const response = await fetch(CMC_URL, {
      headers: {
        Accept: 'application/json',
        'X-CMC_PRO_API_KEY': CMC_API_KEY,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`CMC Fear & Greed returned ${response.status}`);
      return res.status(502).json({ error: 'Fear & Greed data unavailable' });
    }

    const json = await response.json();
    const d = json?.data;

    if (!d || d.value == null) {
      console.error('CMC Fear & Greed: unexpected response shape', JSON.stringify(json).slice(0, 200));
      return res.status(502).json({ error: 'Fear & Greed data unavailable' });
    }

    const result = {
      value: d.value,
      classification: d.value_classification || '',
      timestamp: d.timestamp || new Date().toISOString(),
      source: 'coinmarketcap',
    };

    // Update cache
    cached = result;
    cachedAt = Date.now();

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
    return res.status(200).json(result);
  } catch (err) {
    console.error('Fear & Greed proxy error:', err.message);

    // Serve stale cache if available
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      return res.status(200).json(cached);
    }

    return res.status(502).json({ error: 'Fear & Greed data unavailable' });
  }
}
