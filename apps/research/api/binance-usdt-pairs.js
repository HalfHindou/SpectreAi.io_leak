// Returns { pairs, updatedAt } — base assets of live Binance USDT spot pairs,
// minus stables and wrapped/LST duplicates. Consumed by binanceCatalog.js.

import { rateLimit } from './_lib/ratelimit.js';

const TTL_MS = 6 * 60 * 60 * 1000;

const STABLES = new Set([
  'USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','USDE','PYUSD','USDS','USD1',
  'USDD','GHO','EUR','EURC','EURS','EURT','AEUR','XUSD','RLUSD','USDY','USDF',
  'USTB','USTBL','USYC','USDTB','USDG','USDAI','USDA','USD0','USDM','USDX',
  'SUSD','LUSD','GUSD','OUSD','USDB','FRAX','CRVUSD','RUSD','XAUT','PAXG','MUSD',
  'OUSG','VUSD','MIM','MKUSD','TGBP','EUROC','FEI','SAI','VAI','BILL','JTRSY',
  'BUIDL','SUSDS','SUSDE','EURI','APXUSD','APYUSD','BFUSD','SBTC','USTC',
]);

const WRAPPED = new Set([
  'WBTC','WBETH','WETH','WBNB','WSTETH','STETH','RETH','CBETH','FRXETH',
  'SFRXETH','TBTC','WSOL','MSOL','JITOSOL','BSOL','BNBX','WMATIC','BTCB',
  'LBTC','TKBTC','BNSOL',
]);

const ASCII = /^[A-Z0-9]+$/;
const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
  'https://app.spectreai.io',
  'https://research.spectreai.io',
];

let memoryCache = { pairs: [], updatedAt: 0 };

function filterCatalog(symbols) {
  return symbols
    .filter((s) => s.quoteAsset === 'USDT' && s.status === 'TRADING')
    .map((s) => s.baseAsset)
    .filter((b) => ASCII.test(b) && !STABLES.has(b) && !WRAPPED.has(b))
    .sort();
}

// CoinGecko fallback — when both Binance direct AND allorigins are down,
// emit a Binance-pair-shaped catalog derived from CG's top markets. The
// downstream consumer (binanceCatalog.js) only cares about base-asset
// symbols, so we don't need the full Binance schema — just a list of
// symbols that have USDT spot pairs on major exchanges.
async function fetchFromCoinGecko() {
  // CG top 300 by mcap covers every Binance USDT pair worth caring about
  // (Binance lists ~600 USDT pairs total, but the long tail is illiquid).
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false';
  const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!r.ok) throw new Error(`CG HTTP ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data)) return [];
  const symbols = data
    .map((c) => (c?.symbol || '').toUpperCase())
    .filter((s) => ASCII.test(s) && !STABLES.has(s) && !WRAPPED.has(s));
  return Array.from(new Set(symbols)).sort();
}

async function fetchFromBinance() {
  // Tier 1: direct Binance. Vercel IPs are often 451-blocked, so fast-fail
  // at 2s rather than burning the function budget on a hung TCP.
  try {
    const r = await fetch('https://api.binance.com/api/v3/exchangeInfo', {
      signal: AbortSignal.timeout(2_000),
    });
    if (r.ok) {
      const data = await r.json();
      return filterCatalog(data.symbols || []);
    }
  } catch (_) { /* fall through */ }

  // Tier 2: allorigins proxy (free, no SLA — when it's up, it works).
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://api.binance.com/api/v3/exchangeInfo')}`;
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(3_000) });
    if (r.ok) {
      const data = await r.json();
      return filterCatalog(data.symbols || []);
    }
  } catch (_) { /* fall through */ }

  // Tier 3: CoinGecko top-market symbols. The only path that's reliable
  // when Binance + allorigins both fail. Used to be missing — pre-fix this
  // produced 502s that blocked the welcome-page watchlist hook for ~10s
  // (audit 2026-06-03).
  return await fetchFromCoinGecko();
}

export default async function handler(req, res) {
  const origin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (await rateLimit(req, res, { bucket: 'binance-usdt-pairs', max: 30, windowMs: 60_000 })) return;

  try {
    const stale = Date.now() - memoryCache.updatedAt > TTL_MS;
    if (stale || memoryCache.pairs.length === 0) {
      const pairs = await fetchFromBinance();
      if (pairs.length > 0) {
        memoryCache = { pairs, updatedAt: Date.now() };
      } else {
        // 1-minute negative cache on empty upstream so we don't hammer Binance.
        memoryCache.updatedAt = Date.now() - (TTL_MS - 60_000);
      }
    }
    // 2026-06-03 cost war: Vercel edge IGNORES `Cache-Control` for cookie-
    // bearing requests (auth-gate). Every authed user was hitting the lambda
    // every 15s per the Vercel runtime logs. `CDN-Cache-Control` IS honored
    // regardless of cookie state, so the edge collapses all of those into one
    // origin hit per hour.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.json(memoryCache);
  } catch (err) {
    console.error('binance-usdt-pairs error:', err.message);
    if (memoryCache.pairs.length > 0) {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      return res.json(memoryCache);
    }
    return res.status(502).json({ error: 'Binance catalog unavailable', pairs: [], updatedAt: 0 });
  }
}
