/**
 * Vercel Serverless - Fee Config endpoint
 * GET /api/fee-config - Returns platform fee configuration (public)
 *
 * Reads from Vercel KV via _lib/kv.js getFeeConfig (defaults seeded from
 * env vars). Admin updates via /api/admin/fee-config are reflected here.
 * Returns only `feeRecipient` (primary wallet) - secondary/tertiary splits
 * are admin-internal and not exposed publicly.
 */

import { getFeeConfig } from '../kv.js'

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
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const cfg = await getFeeConfig()
    // Public fee config (2026-05-22 privacy update). Returns ONLY fee
    // amount info; collector + recipient addresses are server-internal
    // (used by the consolidate-and-distribute cron + on-chain verification).
    // Addresses remain visible on-chain via swap explorers (fundamentally
    // public) but no longer trivially scraped via curl.
    const fee = cfg.fee || { bps: cfg.feeBps, percentage: cfg.feePercentage }
    res.json({
      fee,
      // Legacy keys (deprecated, kept so a mid-deploy client doesn't crash):
      feePercentage: fee.percentage,
      feeBps: fee.bps,
    })
  } catch (err) {
    console.error('[fee-config] read error:', err.message)
    res.status(503).json({ error: 'Fee config unavailable' })
  }
}
