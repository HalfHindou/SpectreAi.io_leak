/**
 * Vercel Serverless - Derivatives & CoinGlass proxy.
 * CORS proxy for exchange futures APIs + CoinGlass derivatives data.
 * Matches Express routes at packages/server/index.js:2237-2375
 */

const DERIVATIVES_TARGETS = {
  binance: 'https://fapi.binance.com',
  'binance-spot': 'https://api.binance.com',
  bybit: 'https://api.bybit.com',
  okx: 'https://www.okx.com',
  deribit: 'https://www.deribit.com',
}

const COINGLASS_BASE = 'https://open-api-v4.coinglass.com/api'

const _cache = {}
function getCached(key, ttl) {
  const e = _cache[key]
  if (!e || Date.now() - e.ts > ttl) return null
  return e.data
}
function setCache(key, data) { _cache[key] = { data, ts: Date.now() } }

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// ── Derivatives exchange proxy ──────────────────────────────────────────────
async function handleDerivatives(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const exchange = req.query.exchange || ''
  const path = req.query.path || ''
  const baseUrl = DERIVATIVES_TARGETS[exchange]
  if (!baseUrl) return res.status(400).json({ error: `Unknown exchange: ${exchange}` })

  // 2026-05-12 path-injection lockdown: `path` is interpolated directly
  // into the upstream URL template. Without validation an attacker
  // could send `path=foo@evil.com/x` (URL parser-quirk hostname swap),
  // `path=../private`, `path=foo?inject=evil`, or `path=foo#frag` to
  // either escape the upstream's intended namespace or smuggle params
  // past our query-string filter below. Strict allowlist: alphanum,
  // dashes, underscores, slashes only — matches every legit upstream
  // endpoint shape (fapi/v1/klines, derivatives/instruments-info, etc.)
  if (!/^[a-zA-Z0-9_/-]+$/.test(String(path))) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  // Reconstruct query params (minus our internal routing ones)
  const params = new URLSearchParams(req.query)
  params.delete('fn')
  params.delete('route')
  params.delete('exchange')
  params.delete('path')
  const qs = params.toString()
  const targetUrl = `${baseUrl}/${path}${qs ? '?' + qs : ''}`
  const cacheKey = `deriv:${targetUrl}`

  // Match the CoinGlass handler — Cache-Control + CDN-Cache-Control + Vary
  // so Vercel's edge actually caches across visitors regardless of cookies.
  // /traders-corner fans out 10+ derivatives calls every 15 s; without
  // CDN-Cache-Control set explicitly, the second-and-later visitors in
  // the cache window cold-booted this function each time.
  const setCdnCache = (sMax) => {
    const h = `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 2}`
    res.setHeader('Cache-Control', h)
    res.setHeader('CDN-Cache-Control', h)
    res.setHeader('Vary', 'Accept-Encoding')
  }

  const cached = getCached(cacheKey, 10_000) // 10s TTL
  if (cached) {
    setCdnCache(10)
    res.setHeader('X-Cache', 'HIT')
    return res.status(200).json(cached)
  }

  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`${exchange} ${response.status}`)
    const data = await response.json()
    setCache(cacheKey, data)
    setCdnCache(10)
    res.setHeader('X-Cache', 'MISS')
    return res.status(200).json(data)
  } catch (err) {
    const stale = _cache[cacheKey]
    if (stale) { res.setHeader('X-Cache', 'STALE'); return res.status(200).json(stale.data) }
    console.error(`[derivatives] ${exchange} proxy error:`, err.message)
    return res.status(502).json({ error: `${exchange} unavailable` })
  }
}

// ── CoinGlass proxy ─────────────────────────────────────────────────────────
async function fetchCoinglass(apiPath) {
  const key = process.env.COINGLASS_API_KEY
  if (!key) throw new Error('COINGLASS_API_KEY not configured')
  const url = `${COINGLASS_BASE}${apiPath}`
  const r = await fetch(url, {
    headers: { 'CG-API-KEY': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  // Audit 2026-06-03: was throw new Error(`CoinGlass ${r.status}`) which
  // swallowed the upstream body. Log status + body slice so 502 root cause
  // is visible in Vercel logs (rate limit vs key dead vs intermittent 503).
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`CoinGlass HTTP ${r.status}: ${txt.slice(0, 120)}`)
  }
  const json = await r.json()
  if (json.code !== '0') throw new Error(`CoinGlass code=${json.code} msg=${json.msg}`)
  return json.data
}

// ── Spectre data-api fallback (keyless/degraded CoinGlass) ──────────────────
// Mirrors the Express fallback (packages/server/index.js spectreTotalOiUsd /
// spectreLiqWindow). Without this, prod returned a bare array on the keyless
// path and consumers reading `.data` summed $0 — the Traders Corner / Liq-Heatmap
// "$0 OI + $0 24h-liq" bug (#1091 fixed dev only).
const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_BRIDGE_KEY
  || process.env.SPECTRE_DATA_API_KEY
  || process.env.SPECTRE_API_KEY
  || ''

async function fetchSpectreV1(path) {
  const r = await fetch(`${SPECTRE_API_BASE}/v1${path}`, {
    headers: { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) throw new Error(`spectre v1 ${path} ${r.status}`)
  return r.json()
}

async function spectreTotalOiUsd() {
  const j = await fetchSpectreV1('/derivatives/open-interest?limit=500')
  let total = Number(j?.meta?.total_oi_usd) || 0
  if (!total) {
    const rows = Array.isArray(j?.data) ? j.data : []
    total = rows.reduce((s, r) => s + (Number(r?.oi_usd ?? r?.total_oi_usd) || 0), 0)
  }
  if (!total) throw new Error('spectre oi empty')
  return total
}

async function spectreLiqWindow(range = '24h') {
  const j = await fetchSpectreV1('/derivatives/liquidation-windows')
  const w = j?.data?.windows?.[range] || j?.windows?.[range]
  const long = Number(w?.long) || 0
  const short = Number(w?.short) || 0
  const total = Number(w?.total) || long + short
  if (!total) throw new Error(`spectre liq window ${range} empty`)
  return { long, short, total }
}

async function handleCoinglass(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const route = req.query.sub || req.query.route || ''

  // Audit 2026-06-03: every coinglass response now carries CDN-Cache-Control
  // in addition to Cache-Control so Vercel's edge actually caches cookie-
  // bearing requests. Vary: Accept-Encoding excludes Cookie/Origin from the
  // cache key (responses are public, not user-specific). Single biggest perf
  // lever per backend audit -> ~30% lambda offload on hot endpoints.
  const setCdnCache = (sMax) => {
    const h = `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 2}`
    res.setHeader('Cache-Control', h)
    res.setHeader('CDN-Cache-Control', h)
    res.setHeader('Vary', 'Accept-Encoding')
  }

  if (route === 'coins-markets') {
    const perPage = parseInt(req.query.per_page) || 50
    const page = parseInt(req.query.page) || 1
    const cacheKey = `cg-coins-${perPage}-${page}`
    const cached = getCached(cacheKey, 30_000)
    if (cached) { setCdnCache(30); return res.status(200).json(cached) }
    try {
      const data = await fetchCoinglass(`/futures/coins-markets?per_page=${perPage}&page=${page}`)
      setCache(cacheKey, data)
      setCdnCache(30)
      return res.status(200).json(data)
    } catch (err) {
      const stale = _cache[cacheKey]
      if (stale) {
        res.setHeader('X-Cache', 'STALE')
        setCdnCache(60)
        return res.status(200).json(stale.data)
      }
      console.error('[coinglass] coins-markets error:', err.message)
      return res.status(502).json({ error: 'CoinGlass unavailable' })
    }
  }

  // Returns { data: [rows], source } — consumers (tradersCornerApi.js) sum
  // rows[].open_interest_usd from the `data` array, so the envelope must match
  // the Express route. Falls back to the Spectre data-api aggregate when
  // CoinGlass is keyless/empty (same as Express).
  if (route === 'total-oi') {
    const cacheKey = 'cg-total-oi'
    const cached = getCached(cacheKey, 30_000)
    if (cached) { setCdnCache(30); return res.status(200).json(cached) }
    try {
      let payload
      try {
        const rows = await fetchCoinglass('/futures/open-interest/exchange-list?symbol=')
        payload = { data: Array.isArray(rows) ? rows : [], source: 'coinglass' }
        if (payload.data.length === 0) throw new Error('coinglass oi empty')
      } catch (cgErr) {
        const total = await spectreTotalOiUsd()
        payload = { data: [{ exchange: 'Aggregate', open_interest_usd: total }], source: 'spectre-data-api' }
      }
      setCache(cacheKey, payload)
      setCdnCache(30)
      return res.status(200).json(payload)
    } catch (err) {
      const stale = _cache[cacheKey]
      if (stale) {
        res.setHeader('X-Cache', 'STALE')
        setCdnCache(60)
        return res.status(200).json(stale.data)
      }
      console.error('[coinglass] total-oi error:', err.message)
      return res.status(502).json({ error: 'CoinGlass unavailable' })
    }
  }

  // Returns { data: [rows], source } — consumers sum long/short_liquidation_usd
  // from the `data` array. Falls back to the Spectre liquidation-windows
  // aggregate when CoinGlass is keyless/empty (same as Express).
  if (route === 'total-liquidations') {
    const range = req.query.range || '24h'
    const cacheKey = `cg-total-liq-${range}`
    const cached = getCached(cacheKey, 30_000)
    if (cached) { setCdnCache(30); return res.status(200).json(cached) }
    try {
      let payload
      try {
        const rows = await fetchCoinglass(`/futures/liquidation/exchange-list?symbol=&range=${range}`)
        payload = { data: Array.isArray(rows) ? rows : [], source: 'coinglass' }
        if (payload.data.length === 0) throw new Error('coinglass liq empty')
      } catch (cgErr) {
        const w = await spectreLiqWindow(range)
        payload = {
          data: [{ exchange: 'Aggregate', long_liquidation_usd: w.long, short_liquidation_usd: w.short }],
          source: 'spectre-data-api',
        }
      }
      setCache(cacheKey, payload)
      setCdnCache(30)
      return res.status(200).json(payload)
    } catch (err) {
      const stale = _cache[cacheKey]
      if (stale) {
        res.setHeader('X-Cache', 'STALE')
        setCdnCache(60)
        return res.status(200).json(stale.data)
      }
      console.error('[coinglass] total-liquidations error:', err.message)
      return res.status(502).json({ error: 'CoinGlass unavailable' })
    }
  }

  return res.status(400).json({ error: `Unknown coinglass route: ${route}` })
}

// ── Deriv-agg (aggregated overview from Spectre API) ────────────────────────
async function handleDerivAgg(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Direct Hetzner origin default — api.spectreai.io is CF-WAF blocked for
  // Vercel server-to-server traffic. Env var still wins when set.
  const API_BASE = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
  const API_KEY = process.env.SPECTRE_API_KEY
  const cacheKey = 'deriv-agg'

  // The /api/deriv-agg endpoint previously set no Cache-Control headers
  // at all, meaning every visitor cold-booted the serverless function
  // even though the in-memory cache TTL was 30 s. s-maxage matches that
  // TTL so Vercel edge can answer follow-up visitors within the window.
  const setCdnCache = (sMax) => {
    const h = `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 2}`
    res.setHeader('Cache-Control', h)
    res.setHeader('CDN-Cache-Control', h)
    res.setHeader('Vary', 'Accept-Encoding')
  }

  const cached = getCached(cacheKey, 30_000)
  if (cached) {
    setCdnCache(30)
    return res.status(200).json(cached)
  }

  try {
    const headers = { Accept: 'application/json' }
    if (API_KEY) headers['X-API-Key'] = API_KEY
    const r = await fetch(`${API_BASE}/api/deriv-agg`, {
      headers,
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) throw new Error(`Spectre API ${r.status}`)
    const data = await r.json()
    setCache(cacheKey, data)
    setCdnCache(30)
    return res.status(200).json(data)
  } catch (err) {
    console.error('[deriv-agg] error:', err.message)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ exchanges: [], summary: {} })
  }
}

export { handleDerivatives, handleCoinglass, handleDerivAgg }

export default async function handler(req, res) {
  const route = req.query.route || ''
  if (route === 'derivatives') return handleDerivatives(req, res)
  if (route === 'coinglass') return handleCoinglass(req, res)
  if (route === 'deriv-agg') return handleDerivAgg(req, res)
  return res.status(400).json({ error: `Unknown derivatives route: ${route}` })
}
