/**
 * Vercel Serverless Function - Codex Webhook Receiver
 *
 * Receives price alert and token transfer webhooks from Codex Enterprise.
 * Verifies SHA256 signature, stores triggered alerts, pushes to SSE clients.
 *
 * Endpoint: POST /api/webhook
 */

import crypto from 'node:crypto'
import { getRule, putRule, deleteRule } from './_lib/alert-rules.js'
import { notifyTrigger } from './_lib/alert-notify.js'

const CODEX_WEBHOOK_SECRET = process.env.CODEX_WEBHOOK_SECRET || ''

// In-memory store for triggered alerts (Vercel KV in production)
// Format: { [webhookId]: { type, data, triggeredAt } }
const triggeredAlerts = new Map()

// SSE clients waiting for alert notifications
const alertClients = new Set()

// ── Durable trigger persistence (Task 2) ──────────────────────────────────
// KV import lazy-loaded so the handler still runs without KV env configured.
let _kvPromise = null
async function getKv() {
  if (_kvPromise) return _kvPromise
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) { _kvPromise = Promise.resolve(null); return _kvPromise }
  _kvPromise = import('@upstash/redis').then(m => new m.Redis({ url, token })).catch(() => null)
  return _kvPromise
}

/**
 * Persist a triggered price-alert to the owning user's durable history.
 * Looks up ownership via `alerts:meta:{webhookId}` (written by alerts.js on
 * create) and LPUSHes a display-ready record to `alerts:triggered:{userId}`,
 * capped to the 50 most recent (LTRIM). Returns { record, userId } or null.
 */
async function persistTrigger(webhookId, data) {
  const kv = await getKv()
  if (!kv) return null
  try {
    const raw = await kv.get(`alerts:meta:${webhookId}`)
    const meta = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    if (!meta?.userId) return null

    const now = Date.now()
    const priceUsd = parseFloat(data.priceUsd) || 0
    const rule = meta.ruleId ? await getRule(kv, meta.userId, meta.ruleId) : null

    // Recurring anti-spam: INDEFINITE webhooks re-fire on every cross.
    // Notify at most once per cooldown AND only when price moved past
    // hysteresis from the previous notified trigger.
    if (rule && rule.repeat === 'recurring') {
      const COOLDOWN_MS = 10 * 60 * 1000
      const HYSTERESIS = 0.01 // 1%
      const withinCooldown = rule.lastTriggeredAt && (now - rule.lastTriggeredAt) < COOLDOWN_MS
      const withinHysteresis = rule.lastTriggerPrice > 0 && priceUsd > 0
        && Math.abs(priceUsd - rule.lastTriggerPrice) / rule.lastTriggerPrice < HYSTERESIS
      if (withinCooldown || withinHysteresis) return null
    }

    const record = {
      id: `t_${webhookId}_${now}`,
      webhookId,
      ruleId: meta.ruleId || null,
      tokenAddress: data.address || meta.tokenAddress || '',
      networkId: data.networkId || meta.networkId || 0,
      priceUsd,
      priceTarget: meta.priceTarget || 0,
      direction: meta.direction || 'above',
      name: meta.name || 'Price alert',
      symbol: meta.symbol || '',
      logo: meta.logo || '',
      triggeredAt: now,
    }
    const key = `alerts:triggered:${meta.userId}`
    await kv.lpush(key, JSON.stringify(record))
    await kv.ltrim(key, 0, 49)

    // Re-arm state is advanced only AFTER the trigger record is durable -
    // a crash in between fails toward a duplicate notification, never a
    // silently swallowed one.
    //
    // Re-read before mutating: a PATCH/DELETE may have landed while we were
    // writing the trigger record. Only advance state on a rule that still
    // exists, is still active, and still points at THIS webhook - otherwise
    // a stale snapshot would resurrect paused/deleted rules or consume a
    // freshly-rotated one.
    if (rule) {
      const fresh = await getRule(kv, meta.userId, rule.id)
      if (fresh && fresh.status === 'active' && fresh.codexWebhookId === webhookId) {
        if (fresh.repeat === 'recurring') {
          await putRule(kv, meta.userId, { ...fresh, lastTriggeredAt: now, lastTriggerPrice: priceUsd })
        } else {
          await deleteRule(kv, meta.userId, fresh.id)
        }
      }
    }

    return { record, userId: meta.userId }
  } catch (err) {
    console.warn('[webhook] persistTrigger failed:', err?.message)
    return null
  }
}

/**
 * Verify Codex webhook signature.
 * Hash = SHA256(securityToken + deduplicationId)
 */
function verifySignature(body) {
  if (!CODEX_WEBHOOK_SECRET || !body.hash || !body.deduplicationId) return false
  // 2026-05-12 hardening: validate hash shape BEFORE Buffer.from / timingSafeEqual.
  // Buffer.from(x, 'hex') returns a shorter buffer on invalid input, then
  // timingSafeEqual throws "Input buffers must have the same byte length"
  // synchronously — that throw propagates up and the catch in the outer
  // handler used to respond 200 { ok:true, error:err.message } on malformed
  // hashes, leaking crypto details + masking attack signal in logs.
  if (typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(body.hash)) return false
  const expected = crypto
    .createHash('sha256')
    .update(CODEX_WEBHOOK_SECRET)
    .update(body.deduplicationId)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(body.hash, 'hex')
  )
}

/**
 * Process a TOKEN_PRICE_EVENT webhook.
 */
function handlePriceAlert(body) {
  const { webhookId, data } = body
  const alert = {
    type: 'price_alert',
    webhookId,
    tokenAddress: data.address,
    networkId: data.networkId,
    priceUsd: data.priceUsd,
    timestamp: data.timestamp || Math.floor(Date.now() / 1000),
    triggeredAt: Date.now(),
  }

  triggeredAlerts.set(webhookId, alert)

  // Broadcast to SSE clients
  const payload = `event: alert\ndata: ${JSON.stringify(alert)}\n\n`
  for (const client of alertClients) {
    try { client.write(payload) } catch {}
  }

  return alert
}

/**
 * Process a TOKEN_TRANSFER_EVENT webhook (whale tracking).
 */
function handleTransferAlert(body) {
  const { webhookId, data } = body
  const alert = {
    type: 'transfer_alert',
    webhookId,
    tokenAddress: data.tokenAddress,
    networkId: data.networkId,
    fromAddress: data.fromAddress,
    toAddress: data.toAddress,
    amount: data.shiftedAmount || data.amount,
    direction: data.direction,
    txHash: data.transactionHash,
    timestamp: data.timestamp || Math.floor(Date.now() / 1000),
    triggeredAt: Date.now(),
  }

  triggeredAlerts.set(webhookId, alert)

  const payload = `event: alert\ndata: ${JSON.stringify(alert)}\n\n`
  for (const client of alertClients) {
    try { client.write(payload) } catch {}
  }

  return alert
}

// CORS headers
const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

export default async function handler(req, res) {
  // CORS
  const origin = req.headers?.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // GET /api/webhook/stream - SSE endpoint for alert notifications
  if (req.method === 'GET' && req.url?.includes('stream')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    alertClients.add(res)
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'ok' })}\n\n`)

    const keepAlive = setInterval(() => {
      try { res.write(': keepalive\n\n') } catch {}
    }, 15000)

    req.on('close', () => {
      clearInterval(keepAlive)
      alertClients.delete(res)
    })
    return
  }

  // POST /api/webhook - receive Codex webhook
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }

  try {
    const body = req.body

    if (!body || !body.type) {
      return res.status(400).json({ error: 'Invalid webhook payload' })
    }

    // Verify signature - fail closed if secret is not configured
    if (!CODEX_WEBHOOK_SECRET) {
      console.error('[webhook] CODEX_WEBHOOK_SECRET not configured - refusing webhook')
      return res.status(503).json({ error: 'Webhook not configured' })
    }
    if (!verifySignature(body)) {
      console.error('[webhook] Signature verification failed for:', body.webhookId)
      return res.status(401).json({ error: 'Invalid signature' })
    }

    let result
    switch (body.type) {
      case 'TOKEN_PRICE_EVENT':
        result = handlePriceAlert(body)
        // Durable path (KV) — in-memory/SSE broadcast above is unchanged.
        {
          const persisted = await persistTrigger(body.webhookId, body.data || {})
          if (persisted) await notifyTrigger(await getKv(), persisted.userId, persisted.record)
        }
        break
      case 'TOKEN_TRANSFER_EVENT':
        result = handleTransferAlert(body)
        break
      default:
        console.log('[webhook] Unhandled type:', body.type)
        result = { type: body.type, received: true }
    }

    // Respond 200 within 3s (Codex requirement)
    return res.status(200).json({ ok: true, processed: result.type })
  } catch (err) {
    console.error('[webhook] Processing error:', err)
    return res.status(200).json({ ok: true, error: err.message })
  }
}
