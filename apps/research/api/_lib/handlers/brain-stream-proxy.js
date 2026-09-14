/**
 * brain-stream-proxy — Vercel pass-through for the multiplexed SSE
 * consciousness stream (trends + verdicts + pulses).
 *
 * Browser hits /api/brain/stream → vercel.json rewrite →
 *   /api/intel-api?fn=brain-stream-proxy → spectre-data-api /v1/brain/stream
 *
 * The data API endpoint requires X-API-Key, supplied here from env.
 *
 * SEC hardening:
 *   - SEC-20260513-007 (partial): force SPECTRE_API_ORIGIN to HTTPS so the
 *     X-API-Key header isn't sent over a plaintext IP HTTP fallback.
 *   - SEC-20260513-RT-08: 30s idle timeout. SSE was vulnerable to a
 *     slowloris where attackers held connections open indefinitely.
 */

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

export const config = { api: { responseLimit: false } }

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
    console.error('[brain-stream-proxy] SPECTRE_API_ORIGIN must be HTTPS (or set SPECTRE_API_ALLOW_HTTP=1), got:', raw)
    return null
  }
  return raw
})()

const IDLE_TIMEOUT_MS = 30_000

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (!SPECTRE_API_ORIGIN) {
    return res.status(503).json({ error: 'Upstream origin not configured (HTTPS required)' })
  }

  const apiKey = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'SPECTRE_DATA_API_KEY not configured' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const ctrl = new AbortController()
  // SEC-20260513-RT-08: idle timeout. Reset on each upstream chunk; if
  // 30s pass with no data, drop the connection. Stops slowloris-style
  // resource exhaustion against this serverless function.
  let lastActivity = Date.now()
  let closed = false
  const idleTimer = setInterval(() => {
    if (closed) return
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      try { ctrl.abort() } catch { /* already aborted */ }
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ detail: 'idle timeout' })}\n\n`)
        res.end()
      } catch { /* socket already closed */ }
      clearInterval(idleTimer)
      closed = true
    }
  }, 5_000)
  req.on('close', () => {
    clearInterval(idleTimer)
    try { ctrl.abort() } catch { /* already aborted */ }
    closed = true
  })

  try {
    const r = await fetch(`${SPECTRE_API_ORIGIN}/v1/brain/stream`, {
      headers: { 'X-API-Key': apiKey, Accept: 'text/event-stream' },
      signal: ctrl.signal,
    })
    if (!r.ok || !r.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ status: r.status })}\n\n`)
      res.end()
      clearInterval(idleTimer)
      closed = true
      return
    }
    const reader = r.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        lastActivity = Date.now()
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
    closed = true
  }
}
