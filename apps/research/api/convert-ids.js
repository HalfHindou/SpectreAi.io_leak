/**
 * Vercel Serverless — Convert IDs passthrough
 * Thin proxy to the charts-proxy `convert_ids` endpoint so the frontend can
 * resolve a CoinGecko slug to a Codex address+networkId (and CMC id) without
 * the browser hitting a GCP URL directly. Mirrors the Express /api/convert-ids
 * route for production parity.
 */

// Step 1 (charts-proxy convert_ids) is dead — Cloud Run host gone. We now go
// straight to CoinGecko `platforms` for address + networkId resolution.
import { isAuthGateValid } from './auth-gate.js';
import { sealGatedResponse } from './_lib/gate-cache.js'

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';
const COINGECKO_HEADER_KEY = COINGECKO_API_KEY ? 'x-cg-pro-api-key' : '';

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

// CoinGecko `platforms` chain name → Codex networkId
const CG_PLATFORM_TO_NETWORK_ID = {
  'ethereum': 1,
  'binance-smart-chain': 56,
  'polygon-pos': 137,
  'avalanche': 43114,
  'arbitrum-one': 42161,
  'optimistic-ethereum': 10,
  'base': 8453,
  'solana': 1399811149,
};

async function resolveViaCoingeckoPlatforms(cgId) {
  try {
    const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`;
    const opts = { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
    const r = await fetch(url, opts);
    if (!r.ok) return null;
    const data = await r.json();
    const platforms = data?.platforms || {};
    for (const [chain, netId] of Object.entries(CG_PLATFORM_TO_NETWORK_ID)) {
      const addr = platforms[chain];
      if (addr && typeof addr === 'string' && addr.length > 3) {
        return { address: addr, networkId: netId };
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Per cold-start in-memory cache
const cache = {};
const TTL_HIT = 60 * 60 * 1000;   // 1h for successful resolutions
const TTL_MISS = 10 * 60 * 1000;  // 10m for unknown tokens (in case upstream adds them)

function getCached(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { delete cache[key]; return null; }
  return entry.data;
}

function setCached(key, data, ttl) {
  cache[key] = { data, ts: Date.now(), ttl };
}

export default async function handler(req, res) {
  const origin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 2026-05-11 lockdown: resolves via CoinGecko `coins/{id}` — Pro quota.
  if (!isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }
  // A response only this gate allowed must not land in a SHARED cache — the
  // edge keys on the URL alone, so a warm entry would answer the next
  // anonymous caller without the gate running. See _lib/gate-cache.js.
  sealGatedResponse(res)

  const cgId = (req.query.cgid || req.query.cgId || '').toString().trim().toLowerCase();
  if (!cgId) return res.status(400).json({ error: 'cgid query parameter is required' });

  const cached = getCached(cgId);
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(cached);
  }

  // CoinGecko platforms is the canonical source.
  let codex_id = null;
  let cmc_id = null;
  let quote = null;
  let address = null;
  let networkId = null;
  let source = null;

  const cg = await resolveViaCoingeckoPlatforms(cgId);
  if (cg) {
    address = cg.address;
    networkId = cg.networkId;
    source = 'coingecko-platforms';
    codex_id = `${address}:${networkId}`;
    quote = 'USD';
  }

  const result = { cgid: cgId, codex_id, cmc_id, quote, address, networkId, source };
  const ttl = address ? TTL_HIT : TTL_MISS;
  setCached(cgId, result, ttl);
  res.setHeader(
    'Cache-Control',
    address
      ? 'public, s-maxage=3600, stale-while-revalidate=7200'
      : 'public, s-maxage=600, stale-while-revalidate=1200'
  );
  return res.status(200).json(result);
}
