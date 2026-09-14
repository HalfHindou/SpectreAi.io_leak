/**
 * Vercel Serverless - DexScreener tokens batch proxy.
 * Mirrors the Express /api/dexscreener-tokens route in packages/server/.
 * Accepts CSV `addresses` query param (up to 30) and returns the most-liquid
 * pair per token, normalized to a flat shape consumers can merge with Codex
 * data (price, % changes, volume, market cap, liquidity, 24h txn count,
 * oldest pairCreatedAt, logo).
 *
 * Optional `chains` CSV (aligned with `addresses`, canonical chain keys) routes
 * each address through DexScreener's CHAIN-SCOPED /tokens/v1/{chain}/{csv}
 * endpoint and rejects cross-chain pairs. Two failure modes forced this:
 * (1) /latest/dex/tokens silently caps the response at 30 pairs TOTAL across
 * all queried addresses, so in a full 30-address batch a token keeps only its
 * DexScreener-top-ranked pair — or none; (2) the same contract address can be
 * a DIFFERENT token on another chain (CULT on Ethereum vs RVLT on Polygon,
 * same 0xf0f9… address), and grouping by base address alone let RVLT's $447K
 * mcap replace CULT's real $2.7M and fire a false "Rug Risk" tag. With a chain
 * hint, a token with no matching-chain pair returns NOTHING for that address
 * (callers keep their CG/frozen fallback) — never a cross-chain twin's data.
 */

import { rateLimit } from './_lib/ratelimit.js';

const DS_BASE = 'https://api.dexscreener.com/latest/dex/tokens';
const DS_CHAIN_BASE = 'https://api.dexscreener.com/tokens/v1';
// Canonical chain key (lib/chain-normalize.js) -> DexScreener chainId, where
// the two differ; plus raw CoinGecko platform slugs for callers that don't
// pre-normalize. Everything else passes through unchanged.
const DS_CHAIN_IDS = {
  hyperliquid: 'hyperevm', hyperevm: 'hyperevm', xrp: 'xrpl',
  'binance-smart-chain': 'bsc', 'arbitrum-one': 'arbitrum',
  'optimistic-ethereum': 'optimism', 'polygon-pos': 'polygon',
};

function parseFloatSafe(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    ['http://localhost:5180', 'http://localhost:5181']
      .includes(req.headers?.origin) ? req.headers.origin : ''
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (await rateLimit(req, res, { bucket: 'dexscreener-tokens', max: 30, windowMs: 60_000 })) return;

  try {
    const raw = String(req.query.addresses || '').trim();
    if (!raw) return res.status(400).json({ error: 'addresses query param required' });
    const rawAddrs = raw.split(',').map(s => s.trim());
    const rawChains = String(req.query.chains || '').split(',').map(s => s.trim().toLowerCase());
    const seen = new Set();
    const entries = [];
    rawAddrs.forEach((addr, i) => {
      if (!addr) return;
      const key = addr.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const canon = rawChains[i] || '';
      entries.push({ addr, dsChain: canon ? (DS_CHAIN_IDS[canon] || canon) : '' });
    });
    const capped = entries.slice(0, 30);
    if (capped.length === 0) return res.status(400).json({ error: 'no valid addresses' });

    // Chain-hinted addresses go through the chain-scoped endpoint (immune to
    // the 30-pair cap and to cross-chain address twins); the rest share one
    // legacy batch call. A failed chain-scoped call falls back to the legacy
    // batch — the per-address chain FILTER below still protects it.
    const chainByAddr = new Map(capped.map(e => [e.addr.toLowerCase(), e.dsChain]));
    const byChain = new Map();
    for (const e of capped) {
      const k = e.dsChain || '';
      if (!byChain.has(k)) byChain.set(k, []);
      byChain.get(k).push(e.addr);
    }
    const legacyAddrs = byChain.get('') || [];
    byChain.delete('');

    const pairs = [];
    await Promise.all([...byChain.entries()].map(async ([chain, addrs]) => {
      try {
        const r = await fetch(`${DS_CHAIN_BASE}/${chain}/${addrs.join(',')}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        const data = await r.json();
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.pairs) ? data.pairs : []);
        pairs.push(...arr);
      } catch {
        legacyAddrs.push(...addrs);
      }
    }));
    if (legacyAddrs.length) {
      const r = await fetch(`${DS_BASE}/${legacyAddrs.join(',')}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok && pairs.length === 0) return res.status(502).json({ error: `DexScreener upstream ${r.status}` });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data?.pairs)) pairs.push(...data.pairs);
      }
    }

    const byAddress = new Map();
    for (const p of pairs) {
      const baseAddr = (p?.baseToken?.address || '').toLowerCase();
      if (!baseAddr) continue;
      if (!byAddress.has(baseAddr)) byAddress.set(baseAddr, []);
      byAddress.get(baseAddr).push(p);
    }

    const tokens = {};
    for (const [addr, group] of byAddress) {
      // With a chain hint, only same-chain pairs may represent this address —
      // a cross-chain twin (same contract, different token) is worse than no
      // data. No matching pair -> no entry (caller keeps its fallback).
      const wantChain = chainByAddr.get(addr) || '';
      const arr = wantChain ? group.filter(p => p?.chainId === wantChain) : group;
      if (!arr.length) continue;
      arr.sort((a, b) => parseFloat(b?.liquidity?.usd || 0) - parseFloat(a?.liquidity?.usd || 0));
      const top = arr[0];
      let oldestCreatedAt = null;
      for (const p of arr) {
        const ts = Number(p?.pairCreatedAt);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        if (oldestCreatedAt == null || ts < oldestCreatedAt) oldestCreatedAt = ts;
      }
      tokens[addr] = {
        price: parseFloatSafe(top?.priceUsd) || 0,
        change5m: parseFloatSafe(top?.priceChange?.m5),
        change1h: parseFloatSafe(top?.priceChange?.h1),
        change6h: parseFloatSafe(top?.priceChange?.h6),
        change24h: parseFloatSafe(top?.priceChange?.h24) || 0,
        volume24: parseFloatSafe(top?.volume?.h24) || 0,
        marketCap: parseFloatSafe(top?.marketCap ?? top?.fdv) || 0,
        liquidity: parseFloatSafe(top?.liquidity?.usd) || 0,
        txns24: (parseInt(top?.txns?.h24?.buys) || 0) + (parseInt(top?.txns?.h24?.sells) || 0),
        logo: top?.info?.imageUrl || top?.baseToken?.info?.imageUrl || null,
        pairCreatedAt: oldestCreatedAt,
        chainId: top?.chainId || null,
        pairAddress: top?.pairAddress || null,
      };
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.json({ tokens, source: 'dexscreener', cached_at: new Date().toISOString() });
  } catch (err) {
    console.error('DexScreener tokens batch error:', err);
    res.status(500).json({ error: err?.message || 'Failed' });
  }
}
