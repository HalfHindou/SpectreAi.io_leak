/**
 * Spectre SSE Relay
 *
 * Lightweight persistent server that bridges Codex Enterprise WebSocket
 * to browser EventSource connections. Deployed on OVH for production use.
 *
 * Endpoints:
 *   GET /api/codex/stream?tokens=addr:net,addr:net   - Price updates
 *   GET /api/codex/bars-stream?pairId=addr:net        - OHLCV bar updates
 *   GET /api/codex/trades-stream?pairAddress=&networkId= - Trade events
 *   GET /api/codex/stream/status                      - Debug info
 *   GET /health                                       - Health check
 *
 * Usage:
 *   CODEX_API_KEY=xxx node index.js
 *   CODEX_API_KEY=xxx PORT=4000 node index.js
 */

require('dotenv').config()

const express = require('express')
const cors = require('cors')
const codexStreamRouter = require('./codex-stream')

const app = express()
const PORT = process.env.PORT || 4000

// CORS - restrict to known frontends only
const ALLOWED_ORIGINS = [
  // The production apps since the 2026-05-19 DNS swap. Missing until
  // 2026-09-11: browsers on these origins were refused the stream (no ACAO
  // on the SSE response) even while the relay was up, so prod ran on the
  // polling fallbacks the whole time.
  'https://trade.spectreai.io',
  'https://app.spectreai.io',
  'https://spectre-trading.vercel.app',
  'https://spectre-app-research.vercel.app',
  'https://spectreai.io',
  'https://www.spectreai.io',
  'http://localhost:5180',
  'http://localhost:5181',
  'http://localhost:5182',
  'http://localhost:5183',
]

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin requests (curl, health checks, server-to-server)
    if (!origin) return cb(null, true)
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) return cb(null, true)
    cb(null, false)
  },
  credentials: true,
}))

// Per-IP connection limiter - max 10 concurrent SSE connections per IP
const ipConnections = new Map()
const MAX_CONNECTIONS_PER_IP = 10

app.use('/api/codex', (req, res, next) => {
  // Only limit SSE endpoints (they hold connections open)
  if (!req.url.includes('stream') || req.url.includes('status')) return next()

  const ip = req.ip || req.connection.remoteAddress
  const count = ipConnections.get(ip) || 0

  if (count >= MAX_CONNECTIONS_PER_IP) {
    return res.status(429).json({ error: 'Too many SSE connections from this IP' })
  }

  ipConnections.set(ip, count + 1)
  res.on('close', () => {
    const current = ipConnections.get(ip) || 0
    if (current <= 1) ipConnections.delete(ip)
    else ipConnections.set(ip, current - 1)
  })

  next()
})

// Mount the codex stream router (prices, bars, trades)
app.use('/api/codex', codexStreamRouter)

// Live subscription picture: which pairs are subscribed and how many billed
// messages each is delivering (per minute / last hour). Read-only.
app.get('/status', (_req, res) => {
  let stream = null
  try { stream = codexStreamRouter._getStreamStatus?.() || null } catch { stream = null }
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), stream })
})

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connections: [...ipConnections.entries()].reduce((sum, [, v]) => sum + v, 0),
  })
})

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sse-relay] Listening on :${PORT}`)
  console.log(`[sse-relay] CODEX_API_KEY: ${process.env.CODEX_API_KEY ? 'set' : 'MISSING'}`)
})
