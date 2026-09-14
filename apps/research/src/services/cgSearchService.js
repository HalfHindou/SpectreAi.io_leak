/**
 * Shared CoinGecko search-hits service.
 *
 * Before this module, THREE surfaces (header search modal, welcome-page
 * watchlist search, watchlists-page add-token search) each ran their own
 * inline `/api/coingecko/search` + `/api/coingecko/coins/markets` chain per
 * keystroke — same query, three independent fetches, zero reuse across
 * remounts. This module gives them one implementation with a short module
 * cache + in-flight dedup (the standard fearGreedApi pattern), so a query
 * costs at most one /search + one /coins/markets per TTL window app-wide.
 *
 * Row shape (numeric, unformatted — display formatting is the caller's job):
 *   { symbol, name, price, change, marketCap, volume, image, cgId, rank }
 */

const TTL = 60_000;
const CACHE_MAX = 40;

const _hitsCache = new Map();     // query(lower) -> { data, ts }
const _hitsInflight = new Map();  // query(lower) -> Promise
const _mktCache = new Map();      // sorted-ids key -> { data: Map(id -> row), ts }
const _mktInflight = new Map();   // sorted-ids key -> Promise

function _fresh(entry) {
  return entry && (Date.now() - entry.ts) < TTL;
}

function _trim(map) {
  while (map.size > CACHE_MAX) {
    map.delete(map.keys().next().value);
  }
}

/**
 * Fetch /coins/markets rows for a set of CG ids, cached + deduped.
 * Returns Map(cgId -> raw market row). Never throws — returns an empty Map
 * on failure so callers degrade to "no live data" instead of erroring.
 */
export async function fetchCgMarketsByIds(ids) {
  const clean = (ids || []).filter(Boolean);
  if (clean.length === 0) return new Map();
  const key = [...clean].sort().join(',');
  const cached = _mktCache.get(key);
  if (_fresh(cached)) return cached.data;
  if (_mktInflight.has(key)) return _mktInflight.get(key);

  const promise = (async () => {
    try {
      const url = `/api/coingecko/coins/markets?vs_currency=usd&ids=${encodeURIComponent(clean.join(','))}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return new Map();
      const rows = await r.json();
      if (!Array.isArray(rows)) return new Map();
      const byId = new Map(rows.map((row) => [row.id, row]));
      _mktCache.set(key, { data: byId, ts: Date.now() });
      _trim(_mktCache);
      return byId;
    } catch {
      return new Map();
    } finally {
      _mktInflight.delete(key);
    }
  })();
  _mktInflight.set(key, promise);
  return promise;
}

/**
 * CG-first search hits for a text query: /search for canonical ids, then
 * /coins/markets for live stats, preserving CG's relevance order.
 * Returns [] on any failure (callers fall through to Codex naturally).
 */
export async function getCgSearchHits(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const cached = _hitsCache.get(key);
  if (_fresh(cached)) return cached.data;
  if (_hitsInflight.has(key)) return _hitsInflight.get(key);

  const promise = (async () => {
    try {
      const sr = await fetch(`/api/coingecko/search?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
      if (!sr.ok) return [];
      const sj = await sr.json();
      const coins = (sj?.coins || []).slice(0, 10);
      const ids = coins.map((c) => c.id).filter(Boolean);
      if (ids.length === 0) {
        _hitsCache.set(key, { data: [], ts: Date.now() });
        return [];
      }
      const byId = await fetchCgMarketsByIds(ids);
      const ordered = [];
      for (const coin of coins) {
        const row = byId.get(coin.id);
        if (!row) continue;
        ordered.push({
          symbol: String(row.symbol || '').toUpperCase(),
          name: row.name,
          price: Number(row.current_price) || 0,
          change: Number(row.price_change_percentage_24h) || 0,
          marketCap: Number(row.market_cap) || 0,
          volume: Number(row.total_volume) || 0,
          image: row.image,
          cgId: row.id,
          rank: row.market_cap_rank ?? null,
        });
      }
      _hitsCache.set(key, { data: ordered, ts: Date.now() });
      _trim(_hitsCache);
      return ordered;
    } catch {
      return [];
    } finally {
      _hitsInflight.delete(key);
    }
  })();
  _hitsInflight.set(key, promise);
  return promise;
}
