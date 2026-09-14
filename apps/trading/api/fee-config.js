/**
 * Vercel Serverless - Fee Config endpoint (trading app)
 * GET /api/fee-config - Returns platform fee configuration (public)
 *
 * Shares the same Vercel KV key as research (`admin:fee-config`), so admin
 * updates made through research's /api/admin/fee-config endpoint are
 * immediately reflected here. Defaults seed from FEE_* env vars on first
 * read of an empty KV store.
 */

import { getFeeConfig } from './_lib/kv.js'

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
  // L4-PR7: fee config is global (not per-user) - CDN-Cache-Control collapses
  // every client's quote-init fetch to one origin hit per minute.
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const cfg = await getFeeConfig()
    // Public fee config (2026-05-22 privacy update). Returns ONLY fee
    // amount info (bps + percentage). The collector wallet address and the
    // 90/5/5 recipient addresses are server-internal - exposing them via
    // a public REST endpoint made them trivially scrapable. They remain
    // visible on-chain on every swap (chain explorers are fundamentally
    // public), but we no longer hand them out via curl.
    //
    // Clients only need the fee amount to display "1% platform fee" in
    // the swap UI - they do NOT need the recipient address (the server
    // injects it into Jupiter/0x quote calls; on-chain verification
    // happens server-side against the env-loaded collector).
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
