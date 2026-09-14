/**
 * Fee Config Route
 * GET /api/fee-config - Returns platform fee configuration (public)
 */
const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const FEE_CONFIG_PATH = path.resolve(__dirname, '..', 'data', 'fee-config.json');

function loadFeeConfig() {
  try {
    const raw = fs.readFileSync(FEE_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[fee-config] Failed to load fee config:', err.message);
    // Return defaults if file is missing
    return {
      feePercentage: 1.0,
      feeBps: 100,
      feeWallets: {
        primary: {
          evm: process.env.FEE_WALLET_PRIMARY_EVM || '',
          solana: process.env.FEE_WALLET_PRIMARY_SOL || '',
          share: 96,
        },
        secondary: {
          evm: process.env.FEE_WALLET_SECONDARY_EVM || '',
          solana: process.env.FEE_WALLET_SECONDARY_SOL || '',
          share: 2,
        },
        tertiary: {
          evm: process.env.FEE_WALLET_TERTIARY_EVM || '',
          solana: process.env.FEE_WALLET_TERTIARY_SOL || '',
          share: 2,
        },
      },
    };
  }
}

router.get('/', (req, res) => {
  const config = loadFeeConfig();
  // Only expose what the frontend needs - primary wallet for fee recipient
  res.json({
    feePercentage: config.feePercentage,
    feeBps: config.feeBps,
    feeRecipient: {
      evm: config.feeWallets.primary.evm,
      solana: config.feeWallets.primary.solana,
    },
  });
});

module.exports = router;
