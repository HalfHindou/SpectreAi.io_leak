/**
 * Admin Routes
 * All routes require Authorization: Bearer <ADMIN_API_KEY>
 *
 * GET  /api/admin/fee-config    - Read current fee config
 * PUT  /api/admin/fee-config    - Update fee config
 * GET  /api/admin/stats         - Revenue statistics
 * GET  /api/admin/transactions  - Recent swap transactions
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const router = express.Router();

const FEE_CONFIG_PATH = path.resolve(__dirname, '..', 'data', 'fee-config.json');
const SWAP_LOG_PATH = path.resolve(__dirname, '..', 'data', 'swap-log.json');

// -- Auth middleware --
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'Admin API not configured' });
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = auth.slice(7);
  // Constant-time comparison to prevent timing oracle attacks on ADMIN_API_KEY.
  const a = Buffer.from(token);
  const b = Buffer.from(adminKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  next();
}

router.use(requireAdmin);

// -- Helpers --
function loadFeeConfig() {
  try {
    const raw = fs.readFileSync(FEE_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      feePercentage: 1.0,
      feeBps: 100,
      feeWallets: {
        primary: { evm: '', solana: '', share: 90 },
        secondary: { evm: '', solana: '', share: 5 },
        tertiary: { evm: '', solana: '', share: 5 },
      },
    };
  }
}

function saveFeeConfig(config) {
  const dir = path.dirname(FEE_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FEE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function loadSwapLog() {
  try {
    const raw = fs.readFileSync(SWAP_LOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { transactions: [], totalVolume: 0, totalFees: 0 };
  }
}

function appendSwapLog(entry) {
  const log = loadSwapLog();
  log.transactions.unshift(entry);
  // Keep only last 500 entries
  if (log.transactions.length > 500) log.transactions = log.transactions.slice(0, 500);
  // Recalculate totals
  log.totalVolume = log.transactions.reduce((sum, tx) => sum + (parseFloat(tx.volumeUsd) || 0), 0);
  log.totalFees = log.transactions.reduce((sum, tx) => sum + (parseFloat(tx.feeUsd) || 0), 0);

  const dir = path.dirname(SWAP_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SWAP_LOG_PATH, JSON.stringify(log, null, 2) + '\n', 'utf8');
  return log;
}

// -------------------------------------------------------
// GET /api/admin/fee-config
// -------------------------------------------------------
router.get('/fee-config', (req, res) => {
  const config = loadFeeConfig();
  res.json(config);
});

// -------------------------------------------------------
// PUT /api/admin/fee-config
// Body: { feePercentage?, feeBps?, feeWallets? }
// -------------------------------------------------------
router.put('/fee-config', (req, res) => {
  try {
    const current = loadFeeConfig();
    const { feePercentage, feeBps, feeWallets } = req.body;

    // Validate fee percentage
    if (feePercentage !== undefined) {
      const pct = parseFloat(feePercentage);
      if (isNaN(pct) || pct < 0 || pct > 10) {
        return res.status(400).json({ error: 'feePercentage must be between 0 and 10' });
      }
      current.feePercentage = pct;
      current.feeBps = Math.round(pct * 100);
    }

    if (feeBps !== undefined) {
      const bps = parseInt(feeBps, 10);
      if (isNaN(bps) || bps < 0 || bps > 1000) {
        return res.status(400).json({ error: 'feeBps must be between 0 and 1000' });
      }
      current.feeBps = bps;
      current.feePercentage = bps / 100;
    }

    // Validate wallet config
    if (feeWallets) {
      for (const key of ['primary', 'secondary', 'tertiary']) {
        if (feeWallets[key]) {
          if (feeWallets[key].evm !== undefined) current.feeWallets[key].evm = feeWallets[key].evm;
          if (feeWallets[key].solana !== undefined) current.feeWallets[key].solana = feeWallets[key].solana;
          if (feeWallets[key].share !== undefined) {
            const share = parseInt(feeWallets[key].share, 10);
            if (isNaN(share) || share < 0 || share > 100) {
              return res.status(400).json({ error: `${key}.share must be between 0 and 100` });
            }
            current.feeWallets[key].share = share;
          }
        }
      }

      // Validate shares sum to 100
      const totalShare = current.feeWallets.primary.share
        + current.feeWallets.secondary.share
        + current.feeWallets.tertiary.share;
      if (totalShare !== 100) {
        return res.status(400).json({ error: `Wallet shares must sum to 100, got ${totalShare}` });
      }
    }

    saveFeeConfig(current);
    console.log('[admin] Fee config updated:', JSON.stringify(current));
    res.json({ ok: true, config: current });
  } catch (err) {
    console.error('[admin] Fee config update error:', err.message);
    res.status(500).json({ error: 'Failed to update fee config' });
  }
});

// -------------------------------------------------------
// GET /api/admin/stats
// -------------------------------------------------------
router.get('/stats', (req, res) => {
  const log = loadSwapLog();
  const config = loadFeeConfig();

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const txLast24h = log.transactions.filter(tx => (now - tx.timestamp) < day);
  const txLast7d = log.transactions.filter(tx => (now - tx.timestamp) < 7 * day);
  const txLast30d = log.transactions.filter(tx => (now - tx.timestamp) < 30 * day);

  const sumVolume = (txs) => txs.reduce((s, tx) => s + (parseFloat(tx.volumeUsd) || 0), 0);
  const sumFees = (txs) => txs.reduce((s, tx) => s + (parseFloat(tx.feeUsd) || 0), 0);

  res.json({
    feePercentage: config.feePercentage,
    totalTransactions: log.transactions.length,
    totalVolume: log.totalVolume,
    totalFees: log.totalFees,
    last24h: { transactions: txLast24h.length, volume: sumVolume(txLast24h), fees: sumFees(txLast24h) },
    last7d: { transactions: txLast7d.length, volume: sumVolume(txLast7d), fees: sumFees(txLast7d) },
    last30d: { transactions: txLast30d.length, volume: sumVolume(txLast30d), fees: sumFees(txLast30d) },
    walletSplit: {
      primary: { share: config.feeWallets.primary.share, evm: config.feeWallets.primary.evm, solana: config.feeWallets.primary.solana },
      secondary: { share: config.feeWallets.secondary.share, evm: config.feeWallets.secondary.evm, solana: config.feeWallets.secondary.solana },
      tertiary: { share: config.feeWallets.tertiary.share, evm: config.feeWallets.tertiary.evm, solana: config.feeWallets.tertiary.solana },
    },
  });
});

// -------------------------------------------------------
// GET /api/admin/transactions?limit=50&offset=0
// -------------------------------------------------------
router.get('/transactions', (req, res) => {
  const log = loadSwapLog();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const page = log.transactions.slice(offset, offset + limit);
  res.json({
    transactions: page,
    total: log.transactions.length,
    limit,
    offset,
  });
});

// Export appendSwapLog so swap.js can use it
router.appendSwapLog = appendSwapLog;

module.exports = router;
