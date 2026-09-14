const { API_BASE, API_KEY } = require('./config')

// Micro-cache: identical GETs within their TTL are served from memory.
// Charts in a hot market are overwhelmingly duplicate requests.
const cache = new Map()

async function get(pathname, { ttlMs = 30e3, timeoutMs = 20e3 } = {}) {
  const hit = cache.get(pathname)
  if (hit && Date.now() - hit.at < hit.ttlMs) return hit.data

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(API_BASE + pathname, {
      headers: { 'X-API-Key': API_KEY, Accept: 'application/json' },
      signal: ctl.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`data-api ${res.status} on ${pathname}`)
    if (!text) return null // known quirk: some lanes return empty 200 when cold
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return null // malformed 200 body — degrade like a cold lane, don't throw
    }
    const data = json.data ?? json
    cache.set(pathname, { at: Date.now(), ttlMs, data })
    if (cache.size > 500) {
      const oldest = cache.keys().next().value
      cache.delete(oldest)
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

const prices = (symbols, opts) =>
  get(`/v1/prices?symbols=${encodeURIComponent(symbols.map((s) => s.toUpperCase()).join(','))}`, { ttlMs: 20e3, ...opts })

const ohlcv = (symbol, interval, ttlMs) =>
  get(`/v1/prices/${encodeURIComponent(symbol.toUpperCase())}/ohlcv?interval=${interval}&range=24h`, {
    ttlMs: ttlMs ?? 5 * 60e3,
    timeoutMs: 40e3,
  })

const markets = (perPage = 100) => get(`/v1/coins/markets?per_page=${perPage}`, { ttlMs: 2 * 60e3, timeoutMs: 30e3 })
const signalsFeed = (limit = 12) => get(`/v1/notifications/feed?limit=${limit}`, { ttlMs: 60e3 })
const intelSignals = (limit = 10) => get(`/v1/intelligence/signals?limit=${limit}`, { ttlMs: 60e3 })
const globalStats = () => get('/v1/market/global', { ttlMs: 60e3 })
const fearGreed = () => get('/v1/market/fear-greed', { ttlMs: 5 * 60e3 })
const altSeason = () => get('/v1/market/alt-season', { ttlMs: 10 * 60e3 })
const news = (limit = 6) => get(`/v1/news?limit=${limit}`, { ttlMs: 2 * 60e3 })
const brainDesk = () => get('/v1/brain/desk', { ttlMs: 5 * 60e3 })
// 🪤 upstream silently caps per_page at 50 — asking for 100 returns 50 and the
// board is 400+ tokens deep. Stitch pages (each cached separately by get()) so
// symbol lookups cover the real universe, not just the top of the board.
async function xdashBootstrap(timeframe = '24h', perPage = 100) {
  const pages = Math.max(1, Math.min(5, Math.ceil(perPage / 50)))
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      get(`/v1/social/xdash/bootstrap?timeframe=${timeframe}&per_page=50&page=${i + 1}`, { ttlMs: 3 * 60e3, timeoutMs: 30e3 }).catch(() => null),
    ),
  )
  const first = results.find(Boolean)
  if (!first) return null
  const seen = new Set()
  const tokens = []
  for (const r of results) {
    for (const t of r?.tokens || []) {
      const key = t.token_id || t.cg_id || (t.symbol || '') + (t.contract_address || '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      tokens.push(t)
    }
  }
  return { ...first, tokens }
}

// ---- stocks & indices (per-user ask: price alerts for NVDA, SP500 etc.)
const INDEX_ALIAS = { SP500: 'SPX', SPY: 'SPX', ES: 'SPX', NASDAQ: 'NDX', QQQ: 'NDX', VIX: 'VIX', SPX: 'SPX', NDX: 'NDX', DXY: 'DXY' }

async function stockQuote(symbol, opts = {}) {
  const sym = String(symbol || '').toUpperCase()
  const idx = INDEX_ALIAS[sym]
  if (idx) {
    const rows = await get(`/v1/macro/equity-indices?symbol=${idx}&days=1`, { ttlMs: opts.ttlMs ?? 60e3 }).catch(() => null)
    const r = rows?.[0]
    if (!r) return null
    return { symbol: idx, name: { SPX: 'S&P 500', NDX: 'Nasdaq 100', DXY: 'Dollar Index', VIX: 'VIX' }[idx], price: r.price, change24: r.change_24h_pct, change7d: r.change_7d_pct, mcap: null, kind: 'index' }
  }
  const rows = await get(`/v1/macro/equity-quotes?symbols=${encodeURIComponent(sym)}`, { ttlMs: opts.ttlMs ?? 60e3 }).catch(() => null)
  const r = (rows || []).find((x) => x.symbol === sym)
  if (!r) return null
  return { symbol: r.symbol, name: r.name, price: r.price, change24: r.change_24h_pct, change7d: r.change_7d_pct, mcap: r.market_cap_usd, kind: 'stock' }
}

// Find a token's social row by ticker/cashtag in the X-Dash universe
// (250-deep stitched board — hunter tokens live well below the top 50)
async function socialRow(symbol) {
  const boot = await xdashBootstrap('24h', 250).catch(() => null)
  const tokens = boot?.tokens || []
  const want = symbol.toUpperCase()
  return (
    tokens.find((t) => (t.symbol || '').toUpperCase() === want) ||
    tokens.find((t) => (t.our_symbol || '').toUpperCase() === want) ||
    tokens.find((t) => (t.cashtag || '').toUpperCase() === '$' + want) ||
    null
  )
}

// Strict on-chain address shape (the bot's universe = EVM 0x…40hex + Solana
// base58 32-44). Replaces the old loose `[a-zA-Z0-9.:]{20,}` heuristic that let
// junk ("unkown", handles, url fragments) pass as a "contract".
const isTokenAddress = (v) =>
  /^0x[a-fA-F0-9]{40}$/.test(String(v || '')) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''))

// Verify a candidate CA actually points at the token we think it does — the guard
// against same-ticker CLONES (the STX/Stacks incident: real Stacks [cgId
// blockstack, ~$1B, its own L1] got mapped to an $18K Cronos "STX" clone at
// confidence 0.6) and non-token addresses (wallets/deployers). DexScreener check:
// the address must be the BASE token of a real pair AND its symbol must match the
// asset. Fail-CLOSED (unreachable / unindexed / mismatch → false → the caller
// drops the link to the safe X-Dash board rather than deep-link a wrong token).
const _norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const _verifyCache = new Map()
async function verifyToken(ca, wantSymbol) {
  if (!isTokenAddress(ca)) return false
  const want = _norm(wantSymbol)
  if (!want) return false
  const key = `${String(ca).toLowerCase()}|${want}`
  const cached = _verifyCache.get(key)
  if (cached && Date.now() - cached.at < 15 * 60e3) return cached.ok
  let ok = false
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(8e3) })
    if (res.ok) {
      const pairs = (await res.json())?.pairs || []
      ok = pairs.some(
        (p) => String(p.baseToken?.address || '').toLowerCase() === String(ca).toLowerCase() && _norm(p.baseToken?.symbol) === want,
      )
    }
  } catch { ok = false }
  _verifyCache.set(key, { ok, at: Date.now() })
  return ok
}

module.exports = { get, prices, ohlcv, markets, signalsFeed, intelSignals, globalStats, fearGreed, altSeason, news, brainDesk, xdashBootstrap, socialRow, stockQuote, isTokenAddress, verifyToken }
