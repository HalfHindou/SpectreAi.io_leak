// X Dash proxy for the trading app (TrendingHub Social board + runner enrichment).
//
// The TrendingHub calls /api/xdash/bootstrap (Social board) and
// /api/xdash/momentum-origin/:asset. Those routes live on the shared Express
// server (dev) and the RESEARCH app's serverless (prod) — but the trading app
// had no equivalent, so they 404'd on trade.spectreai.io. We can't rewrite to
// app.spectreai.io (Cloudflare WAF blocks server-to-server), so we proxy the
// upstream origins DIRECTLY, mirroring the research social-proxy.
//
// REQUIRES on the trading Vercel project:
//   DASHBOARD_API_KEY (or X_DASH_API_KEY)  — the X Dash dashboard bearer token
//   optionally DASHBOARD_API_BASE_URL / X_DASH_BASE  (default 5.78.199.87:8092)
//   SPECTRE_API_KEY + SPECTRE_API_BASE     — for momentum-origin (Hetzner)
// Without DASHBOARD_API_KEY the dashboard returns 401 → the board shows the
// existing "Social feed reconnecting" state (graceful).

const DASHBOARD_BASE = (process.env.DASHBOARD_API_BASE_URL || process.env.X_DASH_BASE || 'http://5.78.199.87:8092').replace(/\/+$/, '')
// XDASH_API_TOKEN first - the upstream rotated its key (old values 401).
const DASHBOARD_KEY = (process.env.XDASH_API_TOKEN || process.env.DASHBOARD_API_KEY || process.env.X_DASH_API_KEY || '').trim()
const SPECTRE_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const SPECTRE_KEY = (process.env.SPECTRE_API_KEY || '').trim()

const ALLOWED_ORIGINS = [
  'http://localhost:5181', 'http://localhost:5180',
  'https://trade.spectreai.io', 'https://app.spectreai.io',
]

function setCors(req, res) {
  const origin = req.headers?.origin
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const route = String(req.query.route || 'bootstrap')

  try {
    if (route === 'bootstrap') {
      const p = new URLSearchParams({
        page: String(req.query.page || '1'),
        per_page: String(req.query.per_page || '30'),
        timeframe: String(req.query.timeframe || '24h'),
        ranking: String(req.query.ranking || 'mentions'),
        segment: String(req.query.segment || 'all'),
        market: String(req.query.market || 'all'),
        min_kols: String(req.query.min_kols || '1'),
      })
      const headers = { Accept: 'application/json' }
      if (DASHBOARD_KEY) { headers.Authorization = `Bearer ${DASHBOARD_KEY}`; headers['X-API-Key'] = DASHBOARD_KEY }
      const r = await fetch(`${DASHBOARD_BASE}/api/bootstrap?${p}`, { headers, signal: AbortSignal.timeout(10000) })
      if (!r.ok) return res.status(r.status).json({ error: `dashboard ${r.status}`, tokens: [] })
      const data = await r.json()
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    }

    if (route === 'momentum-origin') {
      const asset = String(req.query.asset || '').trim()
      if (!asset) return res.status(400).json({ error: 'Missing asset' })
      const headers = { Accept: 'application/json', ...(SPECTRE_KEY ? { 'X-API-Key': SPECTRE_KEY } : {}) }
      const r = await fetch(`${SPECTRE_BASE}/v1/social/momentum-origin/${encodeURIComponent(asset)}`, { headers, signal: AbortSignal.timeout(8000) })
      if (!r.ok) return res.status(200).json({ data: null, status: 'degraded', reason: `spectre ${r.status}` })
      const data = await r.json()
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(data)
    }

    return res.status(404).json({ error: `Unknown xdash route: ${route}` })
  } catch (err) {
    return res.status(200).json({ error: err?.message || 'xdash proxy error', tokens: [], data: null, status: 'degraded' })
  }
}
