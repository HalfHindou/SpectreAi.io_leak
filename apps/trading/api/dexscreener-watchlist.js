/**
 * GET /api/dexscreener-watchlist/:id
 * Fetch a DexScreener shared watchlist by ID via Firebase Firestore,
 * then enrich each pair with live data from DexScreener's public pairs API.
 *
 * Query param: ?id=<watchlist_id> (rewritten from /api/dexscreener-watchlist/:id)
 */

const CHAIN_TO_NETWORK = {
  solana: 1399811149,
  ethereum: 1,
  bsc: 56,
  base: 8453,
  arbitrum: 42161,
  polygon: 137,
  avalanche: 43114,
  optimism: 10,
  fantom: 250,
  pulsechain: 369,
  ton: 607,
  cronos: 25,
  sui: 784,
  aptos: 637,
  sei: 1329,
  injective: 6900,
  'near-protocol': 397,
  linea: 59144,
  zksync: 324,
  scroll: 534352,
  robinhood: 4663,
};

import { isAuthGateValid, isDemoSession } from './auth-gate.js';

export default async function handler(req, res) {
  // 2026-05-11 lockdown: Firestore + DexScreener per-pair enrichment burns
  // both upstreams hard if scraped anonymously.
  if (!isAuthGateValid(req) && !isDemoSession(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }
  try {
    const id = (req.query.id || '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Watchlist ID is required' });
    }

    // DexScreener stores shared watchlists in Firebase Firestore
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/dex-screener-16543/databases/(default)/documents/watchlists/${encodeURIComponent(id)}`;
    const fsRes = await fetch(firestoreUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!fsRes.ok) {
      return res.status(404).json({
        error: 'Watchlist not found. Check the URL and try again.',
      });
    }

    const fsData = await fsRes.json();
    const pairsField = fsData?.fields?.pairs?.arrayValue?.values;
    if (!pairsField || pairsField.length === 0) {
      return res.status(404).json({ error: 'Watchlist is empty.' });
    }

    // Extract pair IDs and chains from Firestore
    const rawPairs = pairsField
      .map((v) => {
        const f = v.mapValue?.fields || {};
        return {
          pairId: f.pairId?.stringValue || '',
          chainId: f.chainId?.stringValue || '',
          symbol: f.baseTokenSymbol?.stringValue || '',
          name: f.baseTokenName?.stringValue || '',
        };
      })
      .filter((p) => p.pairId && p.chainId);

    // Batch-enrich via DexScreener pairs API (5 concurrent)
    const BATCH_SIZE = 5;
    const tokens = [];
    for (let i = 0; i < rawPairs.length; i += BATCH_SIZE) {
      const batch = rawPairs.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (rp) => {
          try {
            const url = `https://api.dexscreener.com/latest/dex/pairs/${rp.chainId}/${rp.pairId}`;
            const r = await fetch(url, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) return { ...rp, enriched: false };
            const data = await r.json();
            const p = data.pair || (data.pairs && data.pairs[0]);
            if (!p) return { ...rp, enriched: false };
            const base = p.baseToken || {};
            const chainId = (p.chainId || rp.chainId).toLowerCase();
            const networkId = CHAIN_TO_NETWORK[chainId] || 1;
            const pcNum = (k) => {
              const v = parseFloat(p.priceChange?.[k]);
              return Number.isFinite(v) ? v : null;
            };
            return {
              symbol: base.symbol || rp.symbol || '?',
              name: base.name || rp.name || 'Unknown',
              address: base.address || rp.pairId,
              networkId,
              price: parseFloat(p.priceUsd || 0) || 0,
              change: parseFloat(p.priceChange?.h24 || 0) || 0,
              change5m: pcNum('m5'),
              change1h: pcNum('h1'),
              change6h: pcNum('h6'),
              change24h: pcNum('h24'),
              marketCap: parseFloat(p.fdv || p.marketCap || 0) || 0,
              volume24: parseFloat(p.volume?.h24 || 0) || 0,
              liquidity: parseFloat(p.liquidity?.usd || 0) || 0,
              logo: p.info?.imageUrl || null,
              enriched: true,
            };
          } catch {
            return { ...rp, enriched: false };
          }
        })
      );

      results.forEach((r) => {
        if (r.enriched) {
          tokens.push(r);
        } else {
          const networkId = CHAIN_TO_NETWORK[r.chainId] || 1;
          tokens.push({
            symbol: r.symbol || '?',
            name: r.name || 'Unknown',
            address: r.pairId,
            networkId,
            price: 0,
            change: 0,
            marketCap: 0,
            logo: null,
          });
        }
      });
    }

    // De-duplicate by address
    const seen = new Set();
    const uniqueTokens = tokens.filter((t) => {
      const key = (t.address || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ tokens: uniqueTokens, source: 'firestore', count: uniqueTokens.length });
  } catch (error) {
    console.error('DexScreener watchlist error:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch DexScreener watchlist',
    });
  }
}
