/**
 * Vercel Serverless - Token Resolve
 * Resolves a token symbol to its metadata (name, cgId, address, binancePair).
 * Mirrors the Express /api/token/resolve route for production deployment.
 *
 * Resolution chain:
 *   1. Token registry (packages/server/lib/token-registry)
 *   2. Hardcoded SYMBOL_TO_COINGECKO_ID fallback
 *   3. Codex GraphQL filterTokens search
 */

import { createRequire } from 'module';
import { isAuthGateValid } from './auth-gate.js';
import { sealGatedResponse } from './_lib/gate-cache.js';
import { lookupBinancePair } from './_lib/binance-bars.js';
const require = createRequire(import.meta.url);
const { getTokenInfo } = require('../../packages/server/lib/token-registry');
let codexMetricsKv = null;
try { codexMetricsKv = require('../../packages/server/lib/codex-metrics-kv'); } catch {}

const CODEX_API_KEY = process.env.CODEX_API_KEY;
const CODEX_URL = 'https://graph.codex.io/graphql';
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

// Fallback symbol -> CoinGecko ID map (covers tokens not in token-registry)
const SYMBOL_TO_COINGECKO_ID = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
  USDT: 'tether', USDC: 'usd-coin', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  LINK: 'chainlink', DOT: 'polkadot', MATIC: 'matic-network', UNI: 'uniswap',
  LTC: 'litecoin', SHIB: 'shiba-inu', TRX: 'tron', BCH: 'bitcoin-cash',
  ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', FLOKI: 'floki', WIF: 'dogwifhat',
  AAVE: 'aave', CRV: 'curve-dao-token', MKR: 'maker', LDO: 'lido-dao',
  GRT: 'the-graph', SUSHI: 'sushiswap', RENDER: 'render-token', RNDR: 'render-token',
  INJ: 'injective-protocol', FIL: 'filecoin', FET: 'fetch-ai', JUP: 'jupiter-exchange-solana',
  JTO: 'jito-governance-token', PYTH: 'pyth-network', BONK: 'bonk', TIA: 'celestia',
  SEI: 'sei-network', SUI: 'sui', APT: 'aptos',
  ATOM: 'cosmos', NEAR: 'near', ALGO: 'algorand', HBAR: 'hedera-hashgraph',
  ZIG: 'zignaly', ONDO: 'ondo-finance', CFG: 'centrifuge', MPL: 'maple',
  ENA: 'ethena', TAO: 'bittensor', AKT: 'akash-network', HNT: 'helium',
  NEURAL: 'neural-ai', SPECTRE: 'spectre-ai',
};

// In-memory cache (per cold-start lifetime, 1 hour TTL)
const cache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCached(symbol) {
  const entry = cache[symbol];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    delete cache[symbol];
    return null;
  }
  return entry.data;
}

function setCached(symbol, data) {
  cache[symbol] = { data, ts: Date.now() };
}

/**
 * Search Codex GraphQL for a token by symbol phrase.
 * Returns the best match or null.
 */
async function searchCodex(phrase) {
  if (!CODEX_API_KEY) return null;

  const query = `
    query SearchToken($phrase: String!) {
      filterTokens(phrase: $phrase, limit: 5) {
        results {
          token {
            address
            symbol
            name
            networkId
          }
        }
      }
    }
  `;

  const startTime = Date.now();
  let errored = false;
  try {
    const resp = await fetch(CODEX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': CODEX_API_KEY,
        'Origin': CODEX_ORIGIN,
      },
      body: JSON.stringify({ query, variables: { phrase } }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) { errored = true; return null; }
    const json = await resp.json();
    const results = json?.data?.filterTokens?.results;
    if (!results || results.length === 0) return null;

    // Prefer exact symbol match
    const upper = phrase.toUpperCase();
    const exact = results.find(r => r.token?.symbol?.toUpperCase() === upper);
    return exact?.token || results[0]?.token || null;
  } catch (err) {
    errored = true;
    console.error('Codex search error:', err.message);
    return null;
  } finally {
    try { codexMetricsKv?.trackQuery('SearchToken', Date.now() - startTime, errored, 'prod-research'); } catch {}
  }
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2026-05-11 lockdown: falls through to CoinGecko + Codex search on unknown
  // symbols (both burn paid quota).
  if (!isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  sealGatedResponse(res);

  // Parse symbol
  const rawSymbol = (req.query.symbol || '').trim().toUpperCase();
  if (!rawSymbol) {
    return res.status(400).json({ error: 'Missing required query parameter: symbol' });
  }

  // Check in-memory cache
  const cached = getCached(rawSymbol);
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(cached);
  }

  try {
    // 1. Primary: token-registry lookup
    const registryInfo = getTokenInfo(rawSymbol);
    if (registryInfo) {
      const result = {
        symbol: rawSymbol,
        name: registryInfo.name || rawSymbol,
        cgId: registryInfo.coingeckoId || SYMBOL_TO_COINGECKO_ID[rawSymbol] || null,
        // Real registry pair only — fabricated `${sym}USDT` pairs sent the
        // chart pipeline to a dead Binance tier (task #22, 2026-06-10).
        binancePair: registryInfo.binanceSymbol || null,
        address: registryInfo.address || null,
        networkId: registryInfo.networkId || null,
      };
      setCached(rawSymbol, result);
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json(result);
    }

    // 2. Fallback: check SYMBOL_TO_COINGECKO_ID map
    const fallbackCgId = SYMBOL_TO_COINGECKO_ID[rawSymbol];
    if (fallbackCgId) {
      const result = {
        symbol: rawSymbol,
        name: rawSymbol,
        cgId: fallbackCgId,
        binancePair: lookupBinancePair(rawSymbol, fallbackCgId),
        address: null,
        networkId: null,
      };
      setCached(rawSymbol, result);
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json(result);
    }

    // 3. Fallback: Codex GraphQL search
    const codexToken = await searchCodex(rawSymbol);
    if (codexToken) {
      const result = {
        symbol: codexToken.symbol?.toUpperCase() || rawSymbol,
        name: codexToken.name || rawSymbol,
        cgId: null,
        binancePair: lookupBinancePair(rawSymbol),
        address: codexToken.address || null,
        networkId: codexToken.networkId || null,
      };
      setCached(rawSymbol, result);
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json(result);
    }

    // 4. No data found - minimal response; binancePair only if registry-validated
    const result = {
      symbol: rawSymbol,
      name: rawSymbol,
      cgId: null,
      binancePair: lookupBinancePair(rawSymbol),
      address: null,
      networkId: null,
    };
    setCached(rawSymbol, result);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(result);
  } catch (err) {
    console.error('Token resolve error:', err.message);
    return res.status(502).json({ error: 'Token resolution failed' });
  }
}
