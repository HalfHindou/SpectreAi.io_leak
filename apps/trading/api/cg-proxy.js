/**
 * Vercel Serverless Function - CoinGecko Proxy
 * Proxies CoinGecko API requests to avoid CORS and add API key
 */

import { rateLimit } from './_lib/ratelimit.js'
import { isAuthGateValid, isDemoSession } from './auth-gate.js'

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY
const CG_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 2026-05-11 lockdown: CoinGecko Pro key.
  if (!isAuthGateValid(req) && !isDemoSession(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  if (await rateLimit(req, res, { bucket: 'cg-proxy', max: 60, windowMs: 60_000 })) return

  // Build the CoinGecko URL from the request path
  // /api/coingecko/simple/price?ids=ethereum -> /simple/price?ids=ethereum
  const url = new URL(req.url, `https://${req.headers.host}`)
  const cgPath = url.pathname.replace(/^\/api\/coingecko/, '') || '/ping'
  const cgUrl = `${CG_BASE}${cgPath}${url.search}`

  try {
    const headers = { 'Accept': 'application/json' }
    if (COINGECKO_API_KEY) headers['x-cg-pro-api-key'] = COINGECKO_API_KEY

    const resp = await fetch(cgUrl, { headers, signal: AbortSignal.timeout(10000) })
    const data = await resp.json()

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    // L4-PR7: CDN-Cache-Control bypasses Vercel's cookie-disables-edge behavior.
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=30')
    return res.status(resp.status).json(data)
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
}
