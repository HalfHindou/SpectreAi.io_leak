/**
 * Vercel Serverless – CryptoPanic news proxy.
 * GET /api/cryptopanic?symbol=BTC&limit=12
 */

const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY || '';
const CRYPTOPANIC_NEWS = 'https://cryptopanic.com/api/v1/posts/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!CRYPTOPANIC_API_KEY) {
      return res.status(200).json({ results: [] });
    }
    const symbol = (req.query.symbol || '').toUpperCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);
    const currencies = symbol && ['BTC', 'ETH', 'SOL'].includes(symbol) ? symbol : '';
    const url = `${CRYPTOPANIC_NEWS}?auth_token=${CRYPTOPANIC_API_KEY}&filter=rising${currencies ? `&currencies=${currencies}` : ''}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.warn('CryptoPanic news:', response.status);
      return res.status(200).json({ results: [] });
    }
    const json = await response.json();
    const raw = Array.isArray(json.results) ? json.results : [];
    const items = raw.slice(0, limit).map((item) => ({
      id: String(item.id),
      title: item.title || '',
      url: item.url || '#',
      summary: (item.title || '').slice(0, 160) + (item.title && item.title.length > 160 ? '…' : ''),
      source: (item.source && item.source.title) || 'CryptoPanic',
      imageUrl: (item.image && item.image.original) || null,
      publishedOn: item.published_at ? new Date(item.published_at).getTime() / 1000 : 0,
      categories: (item.currencies || []).map((c) => (c.code || c).toUpperCase()),
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240');
    return res.status(200).json({ results: items });
  } catch (e) {
    console.warn('CryptoPanic proxy error:', e.message);
    return res.status(200).json({ results: [] });
  }
}
