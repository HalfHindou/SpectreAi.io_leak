/**
 * Vercel Serverless – CryptoCompare news proxy.
 * GET /api/news?symbol=BTC&limit=12&lang=EN
 */

const CRYPTOCOMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY || '';
const CRYPTOCOMPARE_NEWS = 'https://min-api.cryptocompare.com/data/v2/news/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);
    const url = `${CRYPTOCOMPARE_NEWS}?lang=EN`;
    const opts = {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    };
    if (CRYPTOCOMPARE_API_KEY) opts.headers['Authorization'] = `Apikey ${CRYPTOCOMPARE_API_KEY}`;
    const response = await fetch(url, opts);
    if (!response.ok) {
      console.warn('CryptoCompare news:', response.status);
      return res.status(200).json({ Data: [] });
    }
    const json = await response.json();
    let raw = Array.isArray(json.Data) ? json.Data : [];
    if (symbol && ['BTC', 'ETH', 'SOL'].includes(symbol)) {
      const symbolLower = symbol.toLowerCase();
      const cats = symbol === 'BTC' ? ['BTC', 'BITCOIN'] : symbol === 'ETH' ? ['ETH', 'ETHEREUM'] : ['SOL', 'SOLANA'];
      raw = raw.filter((item) => {
        const title = (item.title || '').toLowerCase();
        if (title.includes(symbolLower) || title.includes(symbol === 'BTC' ? 'bitcoin' : symbol === 'ETH' ? 'ethereum' : 'solana')) return true;
        const itemCats = ((item.categories || '').split('|').filter(Boolean)).map((c) => c.toUpperCase());
        return itemCats.some((c) => cats.includes(c));
      });
      if (raw.length < 3) raw = (Array.isArray(json.Data) ? json.Data : []).slice(0, limit * 2);
    }
    const items = raw.slice(0, limit).map((item) => ({
      id: String(item.id),
      title: item.title || '',
      url: item.url || item.guid || '#',
      summary: (item.body || '').replace(/<[^>]+>/g, '').slice(0, 160) + (item.body && item.body.length > 160 ? '…' : ''),
      source: (item.source_info && item.source_info.name) || item.source || 'Crypto',
      imageUrl: item.imageurl || null,
      publishedOn: item.published_on || 0,
      categories: (item.categories || '').split('|').filter(Boolean).map((c) => c.toUpperCase()),
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240');
    // L4-PR7: CDN-Cache-Control beats Cache-Control on Vercel's edge for
    // cookie-bearing responses. News is user-agnostic; one origin hit per
    // 2 min serves every user.
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=120');
    return res.status(200).json({ Data: items });
  } catch (e) {
    console.warn('News proxy error:', e.message);
    return res.status(200).json({ Data: [] });
  }
}
