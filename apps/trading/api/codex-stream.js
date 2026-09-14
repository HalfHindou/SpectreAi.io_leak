/**
 * Vercel Serverless Function - Codex Stream Fallback
 *
 * In production, WebSocket relay isn't available (needs persistent server).
 * This returns a one-shot SSE response with current prices from getTokenPrices,
 * then closes. The frontend EventSource will auto-reconnect every ~30s,
 * effectively becoming a polling mechanism.
 */

import { createRequire } from 'module';
import { codexGuard } from './_lib/codex-guard.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { isAuthGateValid } from './auth-gate.js'
const _require = createRequire(import.meta.url);
let codexMetricsKv = null;
try { codexMetricsKv = _require('../../../packages/server/lib/codex-metrics-kv'); } catch {}

const CODEX_API_KEY = process.env.CODEX_API_KEY
const CODEX_URL = 'https://graph.codex.io/graphql'
// Codex key is origin-restricted; server-to-server calls must present the
// allowed origin. Override via CODEX_ORIGIN env if the allowlist changes.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'

// Wave 5h (SEC-20260516-004): per-user concurrent connection ceiling. SSE
// streams are long-lived (or repeatedly reconnecting in polling mode), so
// a stolen JWT can multiply Codex `getTokenPrices` cost linearly. Capped
// at 5 simultaneous streams per user; in-memory only (resets on cold start),
// which is acceptable defense in depth - the per-user/per-IP rate limits
// below are the primary controls.
const MAX_CONCURRENT_PER_USER = 5
const concurrentByUser = new Map()
const IDLE_TIMEOUT_MS = 30_000

export default async function handler(req, res) {
  // Wave 5h (SEC-20260516-004): tiered gate. SSE is rate-limited tightly
  // (5/min Privy user, 3/min anon IP) because each call costs a Codex
  // `getTokenPrices` batch and EventSource auto-reconnects ~every 30s.
  if (await codexGuard(req, res, { action: 'stream' })) return

  const userId = await verifyPrivyToken(req)
  if (userId) {
    if (await userRateLimit(res, { bucket: 'codex-stream', userId, max: 5, windowMs: 60_000 })) return
  } else if (isAuthGateValid(req)) {
    if (await rateLimit(req, res, { bucket: 'codex-stream-anon', max: 3, windowMs: 60_000 })) return
  } else {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Per-user concurrent connection cap (Privy users only - anon users hit
  // the per-IP rate limit above which already bounds parallelism by IP).
  if (userId) {
    const current = concurrentByUser.get(userId) || 0
    if (current >= MAX_CONCURRENT_PER_USER) {
      res.setHeader('Retry-After', '30')
      return res.status(429).json({ error: 'Too many concurrent streams' })
    }
    concurrentByUser.set(userId, current + 1)
  }

  const tokensParam = req.query?.tokens || ''
  const tokenKeys = tokensParam.split(',').filter(Boolean)

  if (!tokenKeys.length) {
    if (userId) concurrentByUser.set(userId, Math.max(0, (concurrentByUser.get(userId) || 1) - 1))
    return res.status(400).json({ error: 'tokens required' })
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Hard 30s idle timeout - prevents an attacker holding the socket open
  // indefinitely. Vercel maxDuration already enforces this, but the explicit
  // timer keeps the in-memory concurrent counter accurate on local Express.
  let closed = false
  const release = () => {
    if (closed) return
    closed = true
    if (userId) {
      const remaining = (concurrentByUser.get(userId) || 1) - 1
      if (remaining <= 0) concurrentByUser.delete(userId)
      else concurrentByUser.set(userId, remaining)
    }
  }
  const idleTimer = setTimeout(() => {
    try { res.end() } catch { /* socket already closed */ }
    release()
  }, IDLE_TIMEOUT_MS)
  res.on('close', () => { clearTimeout(idleTimer); release() })

  res.write(`event: connected\ndata: ${JSON.stringify({ subscribed: tokenKeys.length, wsReady: false, mode: 'polling' })}\n\n`)

  // Fetch current prices via getTokenPrices batch
  try {
    const inputs = tokenKeys.map(k => {
      const [address, networkId] = k.split(':')
      return { address, networkId: parseInt(networkId) }
    })

    const query = `
      query GetTokenPrices($inputs: [GetPriceInput!]!) {
        getTokenPrices(inputs: $inputs) {
          address
          networkId
          priceUsd
          timestamp
        }
      }
    `
    const _startTime = Date.now()
    let _errored = false
    let resp, data
    try {
      resp = await fetch(CODEX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
        body: JSON.stringify({ query, variables: { inputs } }),
      })
      data = await resp.json()
      if (!resp.ok || data?.errors) _errored = true
    } catch (err) {
      _errored = true
      throw err
    } finally {
      try { codexMetricsKv?.trackQuery('GetTokenPrices', Date.now() - _startTime, _errored, 'prod-trading') } catch {}
    }
    const prices = data.data?.getTokenPrices || []

    for (const p of prices) {
      if (p?.priceUsd) {
        res.write(`data: ${JSON.stringify(p)}\n\n`)
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
  }

  // Close after sending prices (serverless can't keep connection open).
  // The on-close listener releases the concurrent-connection counter.
  clearTimeout(idleTimer)
  res.end()
  release()
}
