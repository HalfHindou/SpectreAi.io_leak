/**
 * Vercel Serverless - CryptoCompare news history (sampled timeline).
 * Used by Fear & Greed page chart events overlay.
 * GET /api/news/history?days=90&symbol=BTC
 *
 * Mirrors packages/server/index.js /api/news/history but with a smaller
 * request budget (Vercel functions have a 10s default timeout vs 60s+ Express).
 */

const CRYPTOCOMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY || '';
const CRYPTOCOMPARE_NEWS_URL = 'https://min-api.cryptocompare.com/data/v2/news/';

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181'];

// Per-instance cache - 30 min TTL keyed on `${days}:${symbol}`
const _cache = new Map();
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 20;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 180);
    const symbol = String(req.query.symbol || '').toUpperCase();
    const cacheKey = `${days}:${symbol}`;

    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ data: cached.data });
    }

    const cats = symbol === 'BTC'
      ? ['btc', 'bitcoin', 'crypto', 'market']
      : symbol === 'ETH' ? ['eth', 'ethereum']
      : symbol === 'SOL' ? ['sol', 'solana']
      : ['crypto', 'market'];

    // Sample fewer points than Express to fit in Vercel's timeout.
    // 1 sample per ~10 days, max 10 requests.
    const numSamples = Math.min(Math.ceil(days / 10), 10);
    const now = Math.floor(Date.now() / 1000);
    const interval = (days * 86400) / numSamples;
    const timestamps = [];
    for (let i = 0; i < numSamples; i++) timestamps.push(Math.floor(now - i * interval));

    const opts = {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    };
    if (CRYPTOCOMPARE_API_KEY) opts.headers['Authorization'] = `Apikey ${CRYPTOCOMPARE_API_KEY}`;

    // Fetch all in parallel - serverless can run them concurrently within timeout
    const results = await Promise.allSettled(
      timestamps.map((ts) =>
        fetch(`${CRYPTOCOMPARE_NEWS_URL}?lang=EN&lTs=${ts}`, opts).then((r) => (r.ok ? r.json() : null))
      )
    );

    const all = [];
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const raw = Array.isArray(result.value.Data) ? result.value.Data : [];
      for (const item of raw) {
        if (cats.length) {
          const title = (item.title || '').toLowerCase();
          const itemCats = (item.categories || '').toLowerCase();
          if (!cats.some((c) => title.includes(c) || itemCats.includes(c))) continue;
        }
        all.push({
          id: String(item.id),
          title: item.title || '',
          url: item.url || '#',
          summary: (item.body || '').replace(/<[^>]+>/g, '').slice(0, 160),
          source: (item.source_info && item.source_info.name) || item.source || 'Crypto',
          publishedOn: item.published_on || 0,
        });
      }
    }

    // Dedupe by id
    const seen = new Set();
    const deduped = [];
    for (const item of all) {
      if (!seen.has(item.id)) { seen.add(item.id); deduped.push(item); }
    }

    if (_cache.size >= MAX_ENTRIES) {
      const firstKey = _cache.keys().next().value;
      if (firstKey) _cache.delete(firstKey);
    }
    _cache.set(cacheKey, { data: deduped, ts: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ data: deduped });
  } catch (e) {
    console.warn('[news-history] error:', e.message);
    return res.status(200).json({ data: [] });
  }
}
