/**
 * GET /api/wallet-tokens?address=<addr>&networkId=<id>
 *
 * Dev (Express) twin of apps/trading/api/wallet-tokens.js. Returns every token
 * the wallet holds on that chain (Codex auto-discovery) - native + any ERC-20 /
 * SPL, priced. Balances are per-wallet, so responses are never CDN-cached.
 */
const express = require('express');
const router = express.Router();
const { getWalletTokenBalances } = require('../lib/wallet-tokens-core');

router.get('/', async (req, res) => {
  const address = String(req.query.address || '').trim();
  const networkId = parseInt(req.query.networkId);

  if (!address || !Number.isFinite(networkId)) {
    return res.status(400).json({ error: 'address and networkId are required' });
  }

  // Per-wallet data - do not let any shared cache hold it.
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const tokens = await getWalletTokenBalances(address, networkId);
    return res.json({ tokens });
  } catch (err) {
    console.error('[wallet-tokens] discovery failed:', err?.message);
    // 502 so the frontend falls back to its Multicall3 path (balances never vanish).
    return res.status(502).json({ error: 'discovery_failed' });
  }
});

module.exports = router;
