/**
 * DexScreener proxy routes — watchlist import + pair lookup.
 * Extracted from index.js for maintainability.
 */
const express = require('express')
const router = express.Router()
const fetch = require('node-fetch')

/** DexScreener chainId -> our networkId (Codex) */
const DEXSCREENER_CHAIN_TO_NETWORK = {
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
  mantle: 5000,
  blast: 81457,
  'polygon-zkevm': 1101,
  mode: 34443,
  treos: 606,
  berachain: 80094,
  robinhood: 4663,
};

/**
 * GET /api/dexscreener-watchlist/:id
 * Fetch a DexScreener shared watchlist by ID (from URL .../watchlist/ID).
 * DexScreener does not document a public watchlist API; we try internal endpoints and HTML parsing.
 */
router.get('/watchlist/:id', async (req, res) => {
  try {
    const id = (req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Watchlist ID is required' });
    }

    console.log(`DexScreener import: Fetching watchlist "${id}" via Firestore`);

    // DexScreener stores shared watchlists in Firebase Firestore (project: dex-screener-16543)
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/dex-screener-16543/databases/(default)/documents/watchlists/${encodeURIComponent(id)}`;
    const fsRes = await fetch(firestoreUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!fsRes.ok) {
      console.log(`DexScreener Firestore: status ${fsRes.status}`);
      return res.status(404).json({
        error: 'Watchlist not found. Check the URL and try again.',
      });
    }

    const fsData = await fsRes.json();
    const pairsField = fsData?.fields?.pairs?.arrayValue?.values;
    if (!pairsField || pairsField.length === 0) {
      return res.status(404).json({ error: 'Watchlist is empty.' });
    }

    console.log(`DexScreener: Found ${pairsField.length} pairs in Firestore, enriching via pairs API...`);

    // Extract pair IDs and chains from Firestore data
    const rawPairs = pairsField.map((v) => {
      const f = v.mapValue?.fields || {};
      return {
        pairId: f.pairId?.stringValue || '',
        chainId: f.chainId?.stringValue || '',
        symbol: f.baseTokenSymbol?.stringValue || '',
        name: f.baseTokenName?.stringValue || '',
        dexId: f.dexId?.stringValue || '',
      };
    }).filter((p) => p.pairId && p.chainId);

    // Batch-enrich via DexScreener pairs API (5 concurrent, with rate limiting)
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
            const networkId = DEXSCREENER_CHAIN_TO_NETWORK[chainId] || 1;
            return {
              symbol: base.symbol || rp.symbol || '?',
              name: base.name || rp.name || 'Unknown',
              address: base.address || rp.pairId,
              networkId,
              price: parseFloat(p.priceUsd || 0) || 0,
              change: parseFloat(p.priceChange?.h24 || 0) || 0,
              marketCap: parseFloat(p.fdv || p.marketCap || 0) || 0,
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
          // Fallback: use raw Firestore data without live price
          const networkId = DEXSCREENER_CHAIN_TO_NETWORK[r.chainId] || 1;
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

    console.log(`DexScreener: Returning ${uniqueTokens.length} tokens (${uniqueTokens.filter(t => t.enriched !== false).length} enriched)`);
    res.json({ tokens: uniqueTokens, source: 'firestore', count: uniqueTokens.length });
  } catch (error) {
    console.error('DexScreener watchlist error:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch DexScreener watchlist',
    });
  }
});

/**
 * GET /api/dexscreener-pair/:chain/:address
 * Fetch a single token from DexScreener pair page using their public API.
 * Example: /api/dexscreener-pair/solana/abc123
 */
router.get('/pair/:chain/:address', async (req, res) => {
  try {
    const { chain, address } = req.params;
    if (!chain || !address) {
      return res.status(400).json({ error: 'Chain and address are required' });
    }
    
    console.log(`DexScreener pair lookup: ${chain}/${address}`);
    
    // Use DexScreener's documented public API for pairs
    const url = `https://api.dexscreener.com/latest/dex/pairs/${chain}/${address}`;
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!r.ok) {
      return res.status(404).json({ error: 'Pair not found on DexScreener' });
    }
    
    const data = await r.json();
    const pair = data.pair || (data.pairs && data.pairs[0]);
    
    if (!pair) {
      return res.status(404).json({ error: 'Pair data not found' });
    }
    
    const base = pair.baseToken || {};
    const chainId = (pair.chainId || chain).toLowerCase();
    const networkId = DEXSCREENER_CHAIN_TO_NETWORK[chainId] || 1;
    
    const token = {
      symbol: base.symbol || '?',
      name: base.name || base.symbol || 'Unknown',
      address: base.address,
      networkId,
      price: parseFloat(pair.priceUsd || 0) || 0,
      change: parseFloat(pair.priceChange?.h24 || 0) || 0,
      marketCap: parseFloat(pair.fdv || pair.marketCap || 0) || 0,
      liquidity: parseFloat(pair.liquidity?.usd || 0) || 0,
      volume24: parseFloat(pair.volume?.h24 || 0) || 0,
      logo: pair.info?.imageUrl || base.info?.imageUrl,
    };
    
    console.log(`DexScreener pair found: ${token.symbol} on ${chainId}`);
    res.json({ token, source: 'dexscreener-pairs-api' });
    
  } catch (error) {
    console.error('DexScreener pair error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch pair' });
  }
});

/**
 * Resolve a token symbol to its full identity (CoinGecko ID, Binance pair, contract address, networkId, name).
 * Used by research-zone-lite and other consumers that start from a symbol string.
 */

// Helper: resolve Codex address from CoinGecko ID via convert_ids service
async function resolveCodexAddressFromCgId(cgId) {
  if (!cgId) return null;
  try {
    const res = await fetch(
      `${CHARTS_PROXY_BASE}/convert_ids?cgid=${encodeURIComponent(cgId)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.codex_id) {
      const parts = data.codex_id.split(':');
      const address = parts[0] || null;
      const networkId = parseInt(parts[1]) || 1;
      if (address) return { address, networkId };
    }
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = router
