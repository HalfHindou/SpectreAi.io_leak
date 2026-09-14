/**
 * Derivatives routes — Binance ticker, exchange CORS proxy, CoinGlass API.
 * Extracted from index.js for maintainability.
 */
const express = require('express')
const router = express.Router()
const fetch = require('node-fetch')
const { getHelpers } = require('./_helpers')

function h() { return getHelpers() }

/** Binance 24h ticker handler – reuse for both paths */
async function binanceTickerHandler(req, res) {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!response.ok) throw new Error(`Binance ${response.status}`);
    const data = await response.json();
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.json(data);
  } catch (err) {
    console.error('Binance proxy error:', err.message);
    res.status(502).json({ error: 'Binance ticker unavailable' });
  }
}

router.get('/binance/ticker/24hr', binanceTickerHandler);
router.get('/binance-ticker', binanceTickerHandler);

// ═══════════════════════════════════════════════════════════════════════════════
// DERIVATIVES PROXY — Forward requests to Binance Futures, Bybit, OKX, Deribit
// Browser can't call these directly due to CORS. Same pattern as binance ticker.
// ═══════════════════════════════════════════════════════════════════════════════

const DERIVATIVES_TARGETS = {
  binance: 'https://fapi.binance.com',
  'binance-spot': 'https://api.binance.com',
  bybit: 'https://api.bybit.com',
  okx: 'https://www.okx.com',
  deribit: 'https://www.deribit.com',
};

const derivativesCache = new Map();
const DERIV_CACHE_TTL = 10_000; // 10s - derivatives data is time-sensitive
h()._standaloneCaches.push({ map: derivativesCache, ttlField: 'ts', ttlMs: DERIV_CACHE_TTL });

router.get('/derivatives/:exchange/*', async (req, res) => {
  const { exchange } = req.params;
  const baseUrl = DERIVATIVES_TARGETS[exchange];
  if (!baseUrl) return res.status(400).json({ error: `Unknown exchange: ${exchange}` });

  // Reconstruct the path after /api/derivatives/:exchange/
  const restPath = req.params[0];
  const qs = new URLSearchParams(req.query).toString();
  const targetUrl = `${baseUrl}/${restPath}${qs ? '?' + qs : ''}`;

  // Cache key is the full target URL
  const cached = derivativesCache.get(targetUrl);
  if (cached && Date.now() - cached.ts < DERIV_CACHE_TTL) {
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }

  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`${exchange} ${response.status} ${response.statusText}`);
    const data = await response.json();
    derivativesCache.set(targetUrl, { data, ts: Date.now() });
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.setHeader('X-Cache', 'MISS');
    res.json(data);
  } catch (err) {
    // Return stale cache if available
    if (cached) {
      res.setHeader('X-Cache', 'STALE');
      return res.json(cached.data);
    }
    console.error(`[Derivatives] ${exchange} proxy error:`, err.message);
    res.status(502).json({ error: `${exchange} unavailable` });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COINGLASS — Accurate OI, liquidation, funding, L/S data
// Requires COINGLASS_API_KEY env var
// ═══════════════════════════════════════════════════════════════════════════════

const coinglassCache = new Map();
const CG_GLASS_TTL = 30_000; // 30s - derivatives data is time-sensitive
h()._standaloneCaches.push({ map: coinglassCache, ttlField: 'ts', ttlMs: CG_GLASS_TTL });

async function fetchCoinglass(path) {
  const key = process.env.COINGLASS_API_KEY;
  if (!key) throw new Error('COINGLASS_API_KEY not configured');
  const url = `https://open-api-v4.coinglass.com/api${path}`;
  const res = await fetch(url, {
    headers: { 'CG-API-KEY': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`CoinGlass ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.code !== '0') throw new Error(`CoinGlass error: ${json.msg}`);
  return json.data;
}

// GET /api/coinglass/coins-markets?per_page=50&page=1
// Returns per-coin OI, liquidations (all windows), funding, volume, L/S ratios
router.get('/coinglass/coins-markets', async (req, res) => {
  const perPage = parseInt(req.query.per_page) || 50;
  const page = parseInt(req.query.page) || 1;
  const cacheKey = `coins-markets-${perPage}-${page}`;
  const cached = coinglassCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CG_GLASS_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }
  try {
    const data = await fetchCoinglass(`/futures/coins-markets?per_page=${perPage}&page=${page}`);
    coinglassCache.set(cacheKey, { data, ts: Date.now() });
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    res.json(data);
  } catch (err) {
    if (cached) { res.setHeader('X-Cache', 'STALE'); return res.json(cached.data); }
    console.error('[CoinGlass] coins-markets error:', err.message);
    res.status(502).json({ error: 'CoinGlass unavailable' });
  }
});

// GET /api/coinglass/total-oi
// Returns aggregate OI across all exchanges
router.get('/coinglass/total-oi', async (req, res) => {
  const cacheKey = 'total-oi';
  const cached = coinglassCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CG_GLASS_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }
  try {
    const data = await fetchCoinglass('/futures/open-interest/exchange-list?symbol=');
    coinglassCache.set(cacheKey, { data, ts: Date.now() });
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    res.json(data);
  } catch (err) {
    if (cached) { res.setHeader('X-Cache', 'STALE'); return res.json(cached.data); }
    console.error('[CoinGlass] total-oi error:', err.message);
    res.status(502).json({ error: 'CoinGlass unavailable' });
  }
});

// GET /api/coinglass/total-liquidations?range=24h
// Returns aggregate liquidations across all exchanges for a time window
router.get('/coinglass/total-liquidations', async (req, res) => {
  const range = req.query.range || '24h';
  const cacheKey = `total-liq-${range}`;
  const cached = coinglassCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CG_GLASS_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }
  try {
    const data = await fetchCoinglass(`/futures/liquidation/exchange-list?symbol=&range=${range}`);
    coinglassCache.set(cacheKey, { data, ts: Date.now() });
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    res.json(data);
  } catch (err) {
    if (cached) { res.setHeader('X-Cache', 'STALE'); return res.json(cached.data); }
    console.error('[CoinGlass] total-liquidations error:', err.message);
    res.status(502).json({ error: 'CoinGlass unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN EXCHANGES — Real exchange data from CoinGecko + DexScreener
// Never return fabricated exchange listings
// ═══════════════════════════════════════════════════════════════════════════════

const exchangeCache = new Map(); // symbol -> { data, ts }
const EXCHANGE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
h()._standaloneCaches.push({ map: exchangeCache, ttlField: 'ts', ttlMs: EXCHANGE_CACHE_TTL });

// CoinGecko ID lookup — same as frontend majorTokens.js
const SYMBOL_TO_CG_ID = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink', UNI: 'uniswap', MATIC: 'matic-network',
  ARB: 'arbitrum', OP: 'optimism', NEAR: 'near', APT: 'aptos', SUI: 'sui',
  INJ: 'injective-protocol', AAVE: 'aave', MKR: 'maker', PEPE: 'pepe',
  WIF: 'dogwifcoin', BONK: 'bonk', SHIB: 'shiba-inu', FET: 'fetch-ai',
  RNDR: 'render-token', RENDER: 'render-token', TAO: 'bittensor',
  SPECTRE: 'spectre-ai', LTC: 'litecoin', ATOM: 'cosmos', FIL: 'filecoin',
  GRT: 'the-graph', CRV: 'curve-dao-token', LDO: 'lido-dao',
};


module.exports = router
