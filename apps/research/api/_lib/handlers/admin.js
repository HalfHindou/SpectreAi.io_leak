/**
 * Vercel Serverless - Admin endpoint
 * Rewrite: /api/admin/:route* -> /api/admin?route=:route*
 *
 * Routes:
 *   GET  fee-config    - Read fee config (from Vercel KV)
 *   PUT  fee-config    - Update fee config (persists to Vercel KV)
 *   GET  stats         - Revenue stats
 *   GET  transactions  - Recent transactions
 *
 * All routes require: Authorization: Bearer <ADMIN_API_KEY>
 *
 * Fee config is persisted in Vercel KV via getFeeConfig/setFeeConfig from
 * `_lib/kv.js`. Defaults are seeded from FEE_* env vars on first read of an
 * empty KV store. Both research and trading apps read the same key
 * (`admin:fee-config`), so an admin update is visible to both.
 *
 * Stats/transactions still use module-scope memory (per-instance only).
 * Migrate those to KV when there's actual reporting demand.
 */

import crypto from 'crypto'
import { getFeeConfig, setFeeConfig } from '../kv.js'
import { rateLimit } from '../ratelimit.js'

const ADMIN_API_KEY = process.env.ADMIN_API_KEY

function timingSafeCompare(a, b) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

let swapLog = { transactions: [], totalVolume: 0, totalFees: 0 }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // 2026-05-12 hardening: rate-limit BEFORE the auth check so an attacker
  // brute-forcing the admin key gets throttled. Previously unlimited
  // attempts — combined with a low-entropy key, brute force was viable.
  // 5/15min per IP is plenty for legit admin use; locks the brute-force
  // door if the key ever leaks partially.
  if (await rateLimit(req, res, { bucket: 'admin', max: 5, windowMs: 15 * 60_000 })) return

  // Auth check
  if (!ADMIN_API_KEY) return res.status(503).json({ error: 'Admin API not configured' })
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ') || !timingSafeCompare(auth.slice(7), ADMIN_API_KEY)) {
    return res.status(403).json({ error: 'Invalid admin key' })
  }

  const route = req.query.route || ''

  // GET fee-config
  if (route === 'fee-config' && req.method === 'GET') {
    const feeConfig = await getFeeConfig()
    return res.json(feeConfig)
  }

  // PUT fee-config
  if (route === 'fee-config' && req.method === 'PUT') {
    const { feePercentage: pct, feeBps: bps, feeWallets: wallets } = req.body || {}

    // Read current value, build a new immutable object, persist atomically.
    // Cloning prevents mutating the cached reference inside kv.js.
    const current = await getFeeConfig()
    const next = {
      feePercentage: current.feePercentage,
      feeBps: current.feeBps,
      feeWallets: {
        primary: { ...current.feeWallets.primary },
        secondary: { ...current.feeWallets.secondary },
        tertiary: { ...current.feeWallets.tertiary },
      },
    }

    if (pct !== undefined) {
      const val = parseFloat(pct)
      if (isNaN(val) || val < 0 || val > 10) return res.status(400).json({ error: 'feePercentage must be 0-10' })
      next.feePercentage = val
      next.feeBps = Math.round(val * 100)
    }
    if (bps !== undefined) {
      const val = parseInt(bps, 10)
      if (isNaN(val) || val < 0 || val > 1000) return res.status(400).json({ error: 'feeBps must be 0-1000' })
      next.feeBps = val
      next.feePercentage = val / 100
    }
    if (wallets) {
      for (const key of ['primary', 'secondary', 'tertiary']) {
        if (wallets[key]) {
          if (wallets[key].evm !== undefined) next.feeWallets[key].evm = wallets[key].evm
          if (wallets[key].solana !== undefined) next.feeWallets[key].solana = wallets[key].solana
          if (wallets[key].share !== undefined) next.feeWallets[key].share = parseInt(wallets[key].share, 10) || 0
        }
      }
      const total = next.feeWallets.primary.share + next.feeWallets.secondary.share + next.feeWallets.tertiary.share
      if (total !== 100) return res.status(400).json({ error: `Shares must sum to 100, got ${total}` })
    }

    try {
      await setFeeConfig(next)
    } catch (err) {
      console.error('[admin] setFeeConfig failed:', err.message)
      return res.status(503).json({ error: 'Failed to persist fee config' })
    }
    return res.json({ ok: true, config: next })
  }

  // GET stats
  if (route === 'stats' && req.method === 'GET') {
    const feeConfig = await getFeeConfig()
    const now = Date.now()
    const day = 86400000
    const txLast24h = swapLog.transactions.filter(tx => (now - tx.timestamp) < day)
    const txLast7d = swapLog.transactions.filter(tx => (now - tx.timestamp) < 7 * day)
    const sum = (txs, key) => txs.reduce((s, tx) => s + (parseFloat(tx[key]) || 0), 0)

    return res.json({
      feePercentage: feeConfig.feePercentage,
      totalTransactions: swapLog.transactions.length,
      totalVolume: swapLog.totalVolume,
      totalFees: swapLog.totalFees,
      last24h: { transactions: txLast24h.length, volume: sum(txLast24h, 'volumeUsd'), fees: sum(txLast24h, 'feeUsd') },
      last7d: { transactions: txLast7d.length, volume: sum(txLast7d, 'volumeUsd'), fees: sum(txLast7d, 'feeUsd') },
      last30d: { transactions: swapLog.transactions.length, volume: swapLog.totalVolume, fees: swapLog.totalFees },
      walletSplit: feeConfig.feeWallets,
    })
  }

  // GET transactions
  if (route === 'transactions' && req.method === 'GET') {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
    const offset = parseInt(req.query.offset, 10) || 0
    return res.json({
      transactions: swapLog.transactions.slice(offset, offset + limit),
      total: swapLog.transactions.length,
      limit,
      offset,
    })
  }

  return res.status(404).json({ error: `Unknown route: ${route}` })
}
