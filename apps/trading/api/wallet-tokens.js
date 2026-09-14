/**
 * Vercel Serverless - Wallet token auto-discovery (trading app)
 * GET /api/wallet-tokens?address=<addr>&networkId=<id>
 *
 * Returns EVERY token a wallet holds on that chain via Codex balances - native
 * + any ERC-20 / SPL, priced - so a deposited token the old hardcoded list never
 * tracked (ARB, GMX, an SPL, ...) still shows. Prod twin of the dev Express route
 * packages/server/routes/wallet-tokens.js; both share the same core logic in
 * packages/server/lib/wallet-tokens-core.js (bundled via vercel.json includeFiles).
 */

import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const { getWalletTokenBalances } = _require('../../../packages/server/lib/wallet-tokens-core.js')

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
  'https://trade.spectreai.io',
  'https://app.spectreai.io',
  'https://spectre-trading.vercel.app',
  'https://spectre-app-research.vercel.app',
]

export default async function handler(req, res) {
  const origin = req.headers?.origin
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Per-wallet data - never CDN/shared-cache it.
  res.setHeader('Cache-Control', 'private, no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const address = String(req.query?.address || '').trim()
  const networkId = parseInt(req.query?.networkId)
  if (!address || !Number.isFinite(networkId)) {
    return res.status(400).json({ error: 'address and networkId are required' })
  }

  try {
    const tokens = await getWalletTokenBalances(address, networkId)
    return res.status(200).json({ tokens })
  } catch (err) {
    console.error('[wallet-tokens] discovery failed:', err?.message)
    // 502 so the frontend falls back to its Multicall3 path (balances never vanish).
    return res.status(502).json({ error: 'discovery_failed' })
  }
}
