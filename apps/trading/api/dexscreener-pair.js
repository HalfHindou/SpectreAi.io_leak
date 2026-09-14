/**
 * GET /api/dexscreener-pair/:chain/:address
 * Fetch a single token from DexScreener pair page using their public API.
 *
 * Query params: ?chain=<chain>&address=<address>
 * (rewritten from /api/dexscreener-pair/:chain/:address)
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
  // 2026-05-11 lockdown: DexScreener pair lookup. Public but adds load.
  if (!isAuthGateValid(req) && !isDemoSession(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }
  try {
    const chain = (req.query.chain || '').trim();
    const address = (req.query.address || '').trim();
    if (!chain || !address) {
      return res.status(400).json({ error: 'Chain and address are required' });
    }

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
    const networkId = CHAIN_TO_NETWORK[chainId] || 1;

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

    res.json({ token, source: 'dexscreener-pairs-api' });
  } catch (error) {
    console.error('DexScreener pair error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch pair' });
  }
}
