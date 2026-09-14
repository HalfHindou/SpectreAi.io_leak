/**
 * Spectre Agent - conditional-order CRUD lane (dev Express twin of
 * apps/trading/api/agent-orders.js). All logic in lib/agent-orders-core.js;
 * this is auth + transport. Mounted at /api/agent/orders BEFORE the /api/agent
 * router-level routes would shadow it (separate mounts, no conflict).
 *
 *   GET    /api/agent/orders            list (?scope=open|all&token=<addr>)
 *   POST   /api/agent/orders            create (409 signer_not_granted until delegated)
 *   POST   /api/agent/orders/cancel     { orderId }
 *   GET    /api/agent/orders/inbox      last 20 notification events
 */
const express = require('express')
const router = express.Router()

const { requirePrivyAuth } = require('../lib/auth')
const core = require('../lib/agent-orders-core')

router.get('/', requirePrivyAuth, async (req, res) => {
  try {
    const orders = await core.listOrders(req.userId, {
      scope: req.query.scope === 'open' ? 'open' : 'all',
      tokenAddress: req.query.token || undefined,
    })
    res.json({ orders: orders.map(core.toClientOrder) })
  } catch (e) {
    console.error('[agent-orders] list failed:', e.message)
    res.status(500).json({ error: 'order store unavailable' })
  }
})

router.post('/', requirePrivyAuth, async (req, res) => {
  try {
    const { walletAddress } = req.body || {}
    if (!walletAddress) return res.status(400).json({ error: 'walletAddress required', code: 'bad_request' })

    const validated = core.validateOrderInput(req.body)
    if (validated.error) {
      const status = validated.code === 'cap_exceeded' || validated.code === 'unsupported_chain' ? 422 : 400
      return res.status(status).json({ error: validated.error, code: validated.code })
    }

    const delegation = await core.checkDelegation({ userId: req.userId, walletAddress })
    if (!delegation.ok) {
      if (delegation.reason === 'signer_not_granted') {
        return res.status(409).json({ error: 'automated orders are not enabled for this wallet', code: 'signer_not_granted' })
      }
      return res.status(403).json({ error: delegation.reason, code: 'wallet_check_failed' })
    }

    const result = await core.createOrder({
      userId: req.userId,
      walletAddress,
      walletId: delegation.walletId,
      orderInput: validated.order,
    })
    if (result.error) return res.status(429).json({ error: result.error, code: result.code })
    res.status(result.idempotent ? 200 : 201).json({ order: core.toClientOrder(result.order), idempotent: result.idempotent || false })
  } catch (e) {
    console.error('[agent-orders] create failed:', e.message)
    res.status(500).json({ error: 'order store unavailable' })
  }
})

router.post('/cancel', requirePrivyAuth, async (req, res) => {
  try {
    const { orderId } = req.body || {}
    if (!orderId) return res.status(400).json({ error: 'orderId required' })
    const result = await core.cancelOrder({ userId: req.userId, orderId })
    if (result.error) {
      const status = result.code === 'not_found' ? 404 : result.code === 'forbidden' ? 403 : 409
      return res.status(status).json({ error: result.error, code: result.code })
    }
    res.json({ order: core.toClientOrder(result.order) })
  } catch (e) {
    console.error('[agent-orders] cancel failed:', e.message)
    res.status(500).json({ error: 'order store unavailable' })
  }
})

router.get('/inbox', requirePrivyAuth, async (req, res) => {
  try {
    res.json({ events: await core.getInbox(req.userId) })
  } catch (e) {
    res.status(500).json({ error: 'inbox unavailable' })
  }
})

module.exports = router
