/**
 * Vercel Serverless - TradingView universal symbol search.
 * Mirrors packages/server/index.js GET /api/tradingview/search.
 *
 * Resolves any asset (stocks, crypto, forex) to a TradingView-formatted symbol
 * by querying TradingView's own symbol_search endpoint.
 */

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181'];

const _cache = new Map();
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 300;

function cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) { _cache.delete(key); return null; }
  return e.data;
}

function cacheSet(key, data) {
  if (_cache.size >= MAX_ENTRIES) {
    // Evict oldest (Map iteration is insertion-order)
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
  _cache.set(key, { data, ts: Date.now() });
}

function pickBest(results, type, sym) {
  const cleanSym = sym.replace(/<\/?em>/g, '');
  if (type === 'stock') {
    return results.find((r) => r.type === 'stock' && r.is_primary_listing && r.country === 'US')
      || results.find((r) => r.type === 'stock' && r.is_primary_listing)
      || results.find((r) => r.type === 'stock')
      || results.find((r) => r.type === 'fund' && r.is_primary_listing)
      || null;
  }
  if (type === 'crypto') {
    const CEX = ['BINANCE', 'BYBIT', 'OKX', 'COINBASE', 'KRAKEN', 'MEXC', 'BITGET'];
    // 2026-06-10: only accept candidates whose BASE symbol is the asset we
    // asked about. TV's text search returns rows for other tickers matching
    // the query, and the loose "any Binance spot row" fallback fabricated
    // pairs like BINANCE:ANYONEUSDT → "This symbol doesn't exist" pane.
    const baseMatch = (r) => {
      const rs = String(r.symbol || '').replace(/<\/?em>/g, '');
      return rs === `${cleanSym}USDT` || rs === `${cleanSym}USD` || rs === cleanSym
        || rs === `${cleanSym}USDT.P` || rs === `${cleanSym}USD.P`;
    };
    const matched = results.filter(baseMatch);
    return matched.find((r) => r.type === 'spot' && r.source_id === 'BINANCE'
        && r.symbol.replace(/<\/?em>/g, '') === `${cleanSym}USDT`)
      || matched.find((r) => r.type === 'spot' && r.currency_code === 'USDT' && CEX.includes(r.source_id))
      || matched.find((r) => r.type === 'spot' && r.currency_code === 'USD' && CEX.includes(r.source_id))
      || matched.find((r) => r.type === 'spot' && r.source_id === 'CRYPTO'
        && r.symbol.replace(/<\/?em>/g, '').endsWith('USD'))
      || matched.find((r) => r.type === 'spot' && r.currency_code === 'USDT')
      || matched.find((r) => r.type === 'spot')
      || null;
  }
  return results[0] || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { query, type = '' } = req.query;
    if (!query || String(query).length < 1) {
      return res.status(400).json({ error: 'query parameter required' });
    }

    const key = `${String(query).toUpperCase()}:${type}`;
    const cached = cacheGet(key);
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
      return res.status(200).json(cached);
    }

    const params = new URLSearchParams({
      text: String(query),
      hl: '1',
      exchange: '',
      lang: 'en',
      type: String(type),
      domain: 'production',
    });

    const tvRes = await fetch(`https://symbol-search.tradingview.com/symbol_search/?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.tradingview.com' },
      signal: AbortSignal.timeout(5000),
    });

    if (!tvRes.ok) throw new Error(`TradingView search HTTP ${tvRes.status}`);
    const results = await tvRes.json();

    const best = pickBest(results, type, String(query).toUpperCase());

    if (!best) {
      const data = { found: false, symbol: null, exchange: null, type: null };
      cacheSet(key, data);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
      return res.status(200).json(data);
    }

    const exchange = (best.prefix || best.source_id || best.exchange || '').toUpperCase();
    const cleanSymbol = best.symbol.replace(/<\/?em>/g, '');
    const tvSymbol = exchange ? `${exchange}:${cleanSymbol}` : cleanSymbol;

    const data = {
      found: true,
      symbol: tvSymbol,
      exchange,
      description: (best.description || '').replace(/<\/?em>/g, ''),
      type: best.type,
      country: best.country || null,
      isPrimaryListing: best.is_primary_listing || false,
    };

    cacheSet(key, data);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json(data);
  } catch (err) {
    console.warn('[tradingview-search] error:', err.message);
    return res.status(200).json({ found: false, symbol: null, error: err.message });
  }
}
