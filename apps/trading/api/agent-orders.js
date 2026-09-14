/**
 * Vercel Serverless Function - Spectre Agent conditional-order CRUD (prod
 * twin of packages/server/routes/agent-orders.js). Logic lives in the
 * shared CJS core (includeFiles); this file is auth + dispatch.
 *
 *   GET  /api/agent/orders          -> ?action=list
 *   POST /api/agent/orders          -> ?action=create
 *   POST /api/agent/orders/cancel   -> ?action=cancel
 *   GET  /api/agent/orders/inbox    -> ?action=inbox
 */

import { createRequire } from 'module'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'

const _require = createRequire(import.meta.url)
const core = _require('../../../packages/server/lib/agent-orders-core.js')

const ALLOWED_ORIGINS = [
  'http://localhost:5181', 'http://localhost:5183',
  'https://trade.spectreai.io', 'https://spectre-trading.vercel.app',
  'https://app.spectreai.io',
]

function setCors(req, res) {
  // Strict allowlist (swap.js parity) - no *.vercel.app reflection with
  // credentials on a mutation surface.
  const origin = req.headers?.origin || ''
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
}

export default async function handler(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (await rateLimit(req, res, { bucket: 'agent-orders', max: 30, windowMs: 60_000 })) return
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  if (await userRateLimit(res, { bucket: 'agent-orders', userId, max: 20, windowMs: 60_000 })) return

  const action = String(req.query.action || (req.method === 'GET' ? 'list' : 'create'))

  try {
    if (action === 'list' && req.method === 'GET') {
      const orders = await core.listOrders(userId, {
        scope: req.query.scope === 'open' ? 'open' : 'all',
        tokenAddress: req.query.token || undefined,
      })
      return res.status(200).json({ orders: orders.map(core.toClientOrder) })
    }

    if (action === 'create' && req.method === 'POST') {
      const { walletAddress } = req.body || {}
      if (!walletAddress) return res.status(400).json({ error: 'walletAddress required', code: 'bad_request' })

      const validated = core.validateOrderInput(req.body)
      if (validated.error) {
        const status = validated.code === 'cap_exceeded' || validated.code === 'unsupported_chain' ? 422 : 400
        return res.status(status).json({ error: validated.error, code: validated.code })
      }

      const delegation = await core.checkDelegation({ userId, walletAddress })
      if (!delegation.ok) {
        if (delegation.reason === 'signer_not_granted') {
          return res.status(409).json({ error: 'automated orders are not enabled for this wallet', code: 'signer_not_granted' })
        }
        return res.status(403).json({ error: delegation.reason, code: 'wallet_check_failed' })
      }

      const result = await core.createOrder({
        userId, walletAddress, walletId: delegation.walletId, orderInput: validated.order,
      })
      if (result.error) return res.status(429).json({ error: result.error, code: result.code })
      return res.status(result.idempotent ? 200 : 201).json({ order: core.toClientOrder(result.order), idempotent: result.idempotent || false })
    }

    if (action === 'cancel' && req.method === 'POST') {
      const { orderId } = req.body || {}
      if (!orderId) return res.status(400).json({ error: 'orderId required' })
      const result = await core.cancelOrder({ userId, orderId })
      if (result.error) {
        const status = result.code === 'not_found' ? 404 : result.code === 'forbidden' ? 403 : 409
        return res.status(status).json({ error: result.error, code: result.code })
      }
      return res.status(200).json({ order: core.toClientOrder(result.order) })
    }

    if (action === 'inbox' && req.method === 'GET') {
      return res.status(200).json({ events: await core.getInbox(userId) })
    }

    return res.status(404).json({ error: 'Unknown action' })
  } catch (e) {
    console.error('[agent-orders] failed:', e.message)
    return res.status(500).json({ error: 'order store unavailable' })
  }
}
