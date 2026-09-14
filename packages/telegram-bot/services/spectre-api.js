/**
 * Spectre API client — wraps the same endpoints the research app consumes
 * (X-Dash bootstrap, Momentum setups, token detail). Used by the X-Dash
 * Telegram commands so we can answer in real time without needing a
 * Puppeteer screenshot for text-mode responses.
 *
 * Base URL is the Vite dev server when running locally (it proxies
 * /api/xdash + /api/momentum + /api/coingecko through to the right
 * backends). In production the bot would point at the Vercel-deployed
 * research app instead.
 */
const APP_URL = process.env.SPECTRE_APP_URL || 'http://localhost:5180'
const FETCH_TIMEOUT_MS = 25_000  // bootstrap can be 500KB+ under load; 12s was tight

async function fetchJson(path, opts = {}) {
  const url = `${APP_URL}${path}`
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), opts.timeoutMs || FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`)
    return await res.json()
  } finally {
    clearTimeout(id)
  }
}

/* ─── X-Dash ─────────────────────────────────────────────────────── */

/**
 * Bootstrap = the leaderboard view: tokens ranked by 24h attention with
 * full mentions/authors/engagement metrics + creator rollups.
 */
async function getXDashBootstrap({ timeframe = '24h', perPage = 15 } = {}) {
  return fetchJson(`/api/xdash/bootstrap?timeframe=${timeframe}&per_page=${perPage}`)
}

/** Per-token X-Dash detail (mentions, history, momentum_entry). */
async function getXDashToken(cgId, { timeframe = '24h' } = {}) {
  return fetchJson(`/api/xdash/token/${encodeURIComponent(cgId)}?timeframe=${timeframe}&per_page=20`)
}

/**
 * X-Dash leaderboard bundle — single endpoint that returns tokens ranked
 * by the requested signal (default = momentum), each row with full metrics,
 * quality, momentum_entry, rank deltas. Use this for any signal-leaderboard
 * view rather than joining /xdash/bootstrap with /momentum/setups manually.
 *
 * Response shape: { hero: {tokens[]}, board: {tokens[]}, treemap: {tokens[]}, params, token_count, ... }
 * `board.tokens` is the canonical ranked list.
 */
async function getXDashLeaderboardBundle({
  timeframe = '24h',
  ranking = 'momentum',
  segment = 'all',
  market = 'all',
  page = 1,
  perPage = 20,
  heroLimit = 20,
  treemapLimit = 48,
} = {}) {
  const qs = new URLSearchParams({
    timeframe, ranking, segment, market,
    page: String(page),
    per_page: String(perPage),
    hero_limit: String(heroLimit),
    treemap_limit: String(treemapLimit),
  })
  return fetchJson(`/api/xdash/leaderboard-bundle?${qs}`)
}

/* ─── Momentum (Potential Gainers backend) ───────────────────────── */

/**
 * The current Spectre Momentum board — Top-N tokens flagged as setups
 * with entry rank, entry mcap, current performance, lifecycle phase.
 */
async function getMomentumSetups({ timeframe = '24h', limit = 25 } = {}) {
  return fetchJson(
    `/api/momentum/setups?timeframe=${timeframe}&limit=${limit}&scan_limit=500&include_reversals=false&include_performance=true`
  )
}

/* ─── Tiny formatters ────────────────────────────────────────────── */

function fmtUsd(v) {
  const n = Number(v) || 0
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtNum(v) {
  const n = Number(v) || 0
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function fmtPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function fmtAgo(iso) {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

module.exports = {
  getXDashBootstrap,
  getXDashToken,
  getXDashLeaderboardBundle,
  getMomentumSetups,
  fmtUsd,
  fmtNum,
  fmtPct,
  fmtAgo,
  APP_URL,
}
