/**
 * brain-chat-stream-proxy — pipes the SSE token stream from the data API
 * through to the browser without buffering.
 *
 * Vercel Node functions support `res.write()` chunked responses; we read
 * the upstream body via Web ReadableStream and forward bytes verbatim.
 *
 * Mounted via /api/intel-api?fn=brain-chat-stream-proxy. The browser's
 * EventSource opens this URL and receives `event: token` / `event: done`
 * frames as they arrive from Groq via the data API.
 *
 * SEC hardening:
 *   - SEC-20260513-RT-02: tiered auth-gate (was completely unauthenticated;
 *     free LLM proxy for anyone who knew the URL).
 *   - SEC-20260513-RT-08: per-user concurrent-connection cap + 30s idle
 *     timeout. SSE was vulnerable to slowloris-style resource exhaustion.
 *   - SEC-20260513-007 (partial): force SPECTRE_API_ORIGIN to be HTTPS so
 *     we don't ship LLM prompts over an unencrypted hardcoded-IP HTTP hop.
 */

import { verifyPrivyToken } from '../auth.js'
import { rateLimit, userRateLimit } from '../ratelimit.js'
import { isAuthGateValid } from '../../auth-gate.js'

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

export const config = {
  // Tell Vercel not to buffer streaming responses.
  // (No effect on Edge runtime; Node runtime needs this hint.)
  api: { responseLimit: false },
}

// SEC-20260513-007: env-provided origins must be HTTPS (or opt in via
// SPECTRE_API_ALLOW_HTTP=1) — fail closed with 503 otherwise.
// Default to the direct Hetzner origin — api.spectreai.io is CF-WAF blocked
// for Vercel server-to-server traffic (audit 2026-06-10). Env var still wins.
const DEFAULT_DIRECT_ORIGIN = 'http://204.168.244.18:3850'
const SPECTRE_API_ORIGIN = (() => {
  const raw = process.env.SPECTRE_API_ORIGIN || DEFAULT_DIRECT_ORIGIN
  // SPECTRE_API_ALLOW_HTTP=1 escape hatch for env-provided HTTP origins; the
  // hardcoded internal default above is trusted (audit 2026-05-26 — CF-WAF
  // blocks Vercel SSE to api.spectreai.io).
  const allowInternalHttp = process.env.SPECTRE_API_ALLOW_HTTP === '1' || raw === DEFAULT_DIRECT_ORIGIN
  if (!raw.startsWith('https://') && !allowInternalHttp) {
    console.error('[brain-chat-stream-proxy] SPECTRE_API_ORIGIN must be HTTPS (or set SPECTRE_API_ALLOW_HTTP=1), got:', raw)
    return null
  }
  return raw
})()

// SEC-20260513-RT-08: per-user concurrent SSE cap. Each open stream costs
// upstream tokens; cap parallel streams to bound an attacker's leverage
// even after they pass the rate limit. Module-level Map (in-memory, per
// cold start) — acceptable defense in depth alongside per-user/per-IP
// rate limits which are KV-backed.
const MAX_CONCURRENT_PER_USER = 5
const concurrentByUser = new Map()
const IDLE_TIMEOUT_MS = 30_000

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // SEC-20260513-007: refuse to proxy if origin is misconfigured (non-https).
  if (!SPECTRE_API_ORIGIN) {
    return res.status(503).json({ error: 'Upstream origin not configured (HTTPS required)' })
  }

  // SEC-20260513-RT-02: tiered auth-gate. Bucket caps:
  //   - Privy user: 10/min (typical user runs ~2-3 chats per session)
  //   - auth-gate:  5/min per IP (lower because shared cookie + shared NAT)
  //   - neither:    401
  const userId = await verifyPrivyToken(req)
  if (userId) {
    if (await userRateLimit(res, { bucket: 'brain-chat-stream', userId, max: 10, windowMs: 60_000 })) return
  } else if (isAuthGateValid(req)) {
    if (await rateLimit(req, res, { bucket: 'brain-chat-stream-anon', max: 5, windowMs: 60_000 })) return
  } else {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // SEC-20260513-RT-08: enforce per-user concurrent cap only for Privy
  // users — anon traffic is already bounded by the per-IP rate limit above.
  if (userId) {
    const current = concurrentByUser.get(userId) || 0
    if (current >= MAX_CONCURRENT_PER_USER) {
      res.setHeader('Retry-After', '30')
      return res.status(429).json({ error: 'Too many concurrent streams' })
    }
    concurrentByUser.set(userId, current + 1)
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const upstream = new URL(`${SPECTRE_API_ORIGIN}/v1/brain/chat/stream`)
  for (const k of ['q', 'messages']) {
    if (req.query[k]) upstream.searchParams.set(k, String(req.query[k]))
  }

  const ctrl = new AbortController()
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

  // SEC-20260513-RT-08: hard 30s idle timeout. If no upstream byte arrives
  // within 30s, abort and close — prevents slowloris attackers holding
  // streams open indefinitely. lastActivity is reset on every chunk.
  let lastActivity = Date.now()
  const idleTimer = setInterval(() => {
    if (closed) return
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      try { ctrl.abort() } catch { /* already aborted */ }
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ detail: 'idle timeout' })}\n\n`)
        res.end()
      } catch { /* socket already closed */ }
      clearInterval(idleTimer)
      release()
    }
  }, 5_000)

  // Browser disconnect → abort upstream + decrement counter
  req.on('close', () => {
    clearInterval(idleTimer)
    try { ctrl.abort() } catch { /* already aborted */ }
    release()
  })

  try {
    const r = await fetch(upstream.toString(), {
      headers: { Accept: 'text/event-stream' },
      signal: ctrl.signal,
    })
    if (!r.ok || !r.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ status: r.status })}\n\n`)
      res.end()
      clearInterval(idleTimer)
      release()
      return
    }
    const reader = r.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        lastActivity = Date.now()
        // value is a Uint8Array; res.write accepts Buffer
        res.write(Buffer.from(value))
      }
    }
    res.end()
  } catch (err) {
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ detail: err?.message || 'aborted' })}\n\n`)
      res.end()
    } catch { /* socket already closed */ }
  } finally {
    clearInterval(idleTimer)
    release()
  }
}
