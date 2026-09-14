/**
 * Vercel Serverless – Binance 24h ticker proxy.
 * Fetches only the USDT pairs the app actually needs.
 * Falls back to allorigins proxy, then individual fetches, then CoinGecko.
 */

import { rateLimit } from './_lib/ratelimit.js';

const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/24hr';

// The symbols the app uses (from binanceApi.js SYMBOL_TO_PAIR)
const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ARBUSDT', 'OPUSDT',
  'MATICUSDT', 'AVAXUSDT', 'LINKUSDT', 'UNIUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'DOTUSDT', 'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT', 'BONKUSDT',
  'FLOKIUSDT', 'NEARUSDT', 'APTUSDT', 'SUIUSDT', 'INJUSDT', 'AAVEUSDT',
  'FETUSDT', 'TAOUSDT', 'RENDERUSDT', 'GRTUSDT',
];

// Map Binance pair → CoinGecko id for fallback
const PAIR_TO_COINGECKO = {
  BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', BNBUSDT: 'binancecoin',
  SOLUSDT: 'solana', ARBUSDT: 'arbitrum', OPUSDT: 'optimism',
  MATICUSDT: 'matic-network', AVAXUSDT: 'avalanche-2', LINKUSDT: 'chainlink',
  UNIUSDT: 'uniswap', XRPUSDT: 'ripple', ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin', DOTUSDT: 'polkadot', PEPEUSDT: 'pepe',
  SHIBUSDT: 'shiba-inu', WIFUSDT: 'dogwifcoin', BONKUSDT: 'bonk',
  FLOKIUSDT: 'floki', NEARUSDT: 'near', APTUSDT: 'aptos',
  SUIUSDT: 'sui', INJUSDT: 'injective-protocol', AAVEUSDT: 'aave',
  FETUSDT: 'fetch-ai', TAOUSDT: 'bittensor', RENDERUSDT: 'render-token',
  GRTUSDT: 'the-graph',
};

// Dead-path negative cache, per warm instance (audit 2026-06-10): every 30s
// edge-cache refill was re-paying the dead direct attempt (451 from US
// egress) plus a slow allorigins hop before reaching the CoinGecko path that
// works — a recurring 3.3-3.8s TTFB spike for whoever landed on the expired
// cache. Once a path fails, skip it for 10 min; cold starts re-probe
// naturally (matters on fra1, where direct Binance is not legally blocked).
const PATH_SKIP_TTL_MS = 10 * 60_000;
let skipDirectUntil = 0;
let skipAllOriginsUntil = 0;

/**
 * CoinGecko fallback: fetch /coins/markets and convert to Binance ticker format.
 * This keeps the frontend binanceApi.js parseTickers() working transparently.
 */
async function getCoinGeckoFallback() {
  const ids = [...new Set(Object.values(PAIR_TO_COINGECKO))].join(',');
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;

  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
  const coins = await r.json();
  if (!Array.isArray(coins)) throw new Error('CoinGecko invalid response');

  // Build id → coin lookup
  const byId = {};
  coins.forEach(c => { byId[c.id] = c; });

  // Convert to Binance ticker format
  return DEFAULT_SYMBOLS.map(pair => {
    const cgId = PAIR_TO_COINGECKO[pair];
    const coin = cgId && byId[cgId];
    if (!coin) return null;
    return {
      symbol: pair,
      lastPrice: String(coin.current_price || 0),
      priceChangePercent: String(coin.price_change_percentage_24h || 0),
      quoteVolume: String(coin.total_volume || 0),
      highPrice: String(coin.high_24h || 0),
      lowPrice: String(coin.low_24h || 0),
    };
  }).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  // L4-PR7: CDN-Cache-Control beats Cache-Control on Vercel's edge for
  // cookie-bearing responses. Ticker is user-agnostic; one origin hit per
  // 30s serves every user regardless of session state.
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=30');

  if (await rateLimit(req, res, { bucket: 'binance-ticker', max: 60, windowMs: 60_000 })) return;

  const symbolsParam = JSON.stringify(DEFAULT_SYMBOLS);
  const directUrl = `${BINANCE_URL}?symbols=${encodeURIComponent(symbolsParam)}`;

  // Try direct Binance first. Vercel egress IPs are often 451-blocked by
  // Binance, so cap at 2s — fast-fail to the CoinGecko fallback rather than
  // chewing the function's 10s budget on a hung TCP connection (audit
  // 2026-05-26: this fetch was hanging the full 10s, leaving zero time for
  // the proven CG fallback).
  if (Date.now() >= skipDirectUntil) {
    try {
      const r = await fetch(directUrl, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const data = await r.json();
        return res.status(200).json(data);
      }
      console.error(`Binance direct failed: ${r.status}`);
      skipDirectUntil = Date.now() + PATH_SKIP_TTL_MS;
    } catch (err) {
      console.error('Binance direct error:', err.message);
      skipDirectUntil = Date.now() + PATH_SKIP_TTL_MS;
    }
  }

  // Fallback: fetch via allorigins proxy. Also bounded to 3s.
  if (Date.now() >= skipAllOriginsUntil) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const data = await r.json();
        return res.status(200).json(data);
      }
      console.error(`Binance allorigins fallback failed: ${r.status}`);
      skipAllOriginsUntil = Date.now() + PATH_SKIP_TTL_MS;
    } catch (err) {
      console.error('Binance allorigins error:', err.message);
      skipAllOriginsUntil = Date.now() + PATH_SKIP_TTL_MS;
    }
  }

  // Skip the per-symbol batch (28 parallel Binance requests against the same
  // blocked IP — also 451s, just slower). Go straight to the CoinGecko
  // fallback below, which is the only path that reliably works from Vercel.

  // Last resort: CoinGecko data in Binance ticker format
  try {
    const data = await getCoinGeckoFallback();
    if (data.length > 0) {
      return res.status(200).json(data);
    }
  } catch (err) {
    console.error('CoinGecko fallback error:', err.message);
  }

  res.status(502).json({ error: 'Binance ticker unavailable' });
}
