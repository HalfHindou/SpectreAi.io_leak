/**
 * Vercel Serverless – Dossier API (Spectre-only revival, 2026-06-10)
 *
 * Serves the research /dossier page entirely from the Spectre Data API on
 * Hetzner — ZERO Codex. The original CA-dossier backend (OVH copy) burned
 * ~580K Codex ops/day calling filterTokens per /token page load and was
 * killed at the source in #757/#758. Every byte here comes from our own box:
 *
 *   /v1/intelligence/signals      xdash convergence signals → landing cards
 *   /v1/coins/markets             tracked-asset rows        → derived signals + identity
 *   /v1/scanner/token/:addr       DS/GT composite (no Codex)→ CA identity/market/pools/flows
 *   /v1/scanner/token/:addr/bundle-check                    → safety flags / rug signals
 *   /v1/dossier/:symbol           brain sections            → thesis, voices, narrative
 *   /v1/profiles/:symbol          description + links       → lore + socials
 *   /v1/candles/:key              candle store              → hero chart + sparkline
 *
 * Dispatched from intel-api.js (?fn=dossier-api). Not listed in any public
 * tier there, so it inherits tier3 = full auth gate: the showcase/demo path
 * can never trigger upstream work.
 *
 * The response shapes mirror the legacy Express /api/dossier contract
 * (packages/server/src/dossier/router.js) so dossierApi.js and the dossier
 * page/panel run unchanged.
 */

import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'

const API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || ''

async function hetzner(path, { timeoutMs = 8000 } = {}) {
  const headers = { Accept: 'application/json' }
  if (API_KEY) headers['X-API-Key'] = API_KEY
  const r = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) {
    const e = new Error(`spectre ${r.status} on ${path.split('?')[0]}`)
    e.status = r.status
    throw e
  }
  return r.json()
}

// Tiny module cache shared across warm invocations - keeps the 20s landing
// poll from re-hitting Hetzner when the Vercel edge cache misses.
const _cache = new Map()
async function cached(key, ttlMs, fn) {
  const e = _cache.get(key)
  if (e && Date.now() - e.ts < ttlMs) return e.v
  const v = await fn()
  _memSet(key, v)
  return v
}

function _memSet(key, v) {
  _cache.set(key, { v, ts: Date.now() })
  if (_cache.size > 300) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) _cache.delete(oldest[0])
  }
}

// KV-backed cached() for the SCANNER paths only. The in-memory map above
// lives as long as the lambda instance (minutes on prod), so per-address
// scanner calls were effectively uncached across visitors - and every
// address the box hasn't seen makes it run filterTokens+listPairs on ITS
// Codex key, asynchronously (the ingestion-key lockstep, 2026-08-14). Same
// per-address rule as PR #1423's spectre-data cache: positive hits cached,
// 404s cached as a short miss marker, transient failures never cached.
function _miss404() {
  const e = new Error('token not found on the Spectre scanner')
  e.status = 404
  return e
}
async function cachedKV(key, ttlSec, fn, { missTtlSec = 300 } = {}) {
  const mem = _cache.get(key)
  let hit = mem && Date.now() - mem.ts < ttlSec * 1000 ? mem.v : null
  if (hit == null) {
    try { hit = await getJsonWithTTL(`dossier:${key}`) } catch { hit = null }
    if (hit != null) _memSet(key, hit)
  }
  if (hit != null) {
    if (hit._miss) throw _miss404()
    return hit
  }
  let v
  try {
    v = await fn()
  } catch (err) {
    if (err?.status === 404) {
      const marker = { _miss: 404 }
      _memSet(key, marker)
      setJsonWithTTL(`dossier:${key}`, marker, missTtlSec).catch(() => {})
    }
    throw err
  }
  if (v != null) {
    _memSet(key, v)
    setJsonWithTTL(`dossier:${key}`, v, ttlSec).catch(() => {})
  }
  return v
}

// 'asset' is the symbol-keyed pseudo-chain: signals from the Hetzner side are
// tracked-asset rows without contract addresses, so cards link to
// /dossier/asset/BTC and lookup resolves by symbol instead of address.
const CHAIN_TO_SCANNER = { eth: 'ethereum', sol: 'solana', base: 'base', bsc: 'bsc', poly: 'polygon', arb: 'arbitrum', sonic: 'sonic' }
const CHAIN_TO_EVM_ID = { eth: 1, base: 8453, bsc: 56, poly: 137, arb: 42161, sonic: 146 }
const BUBBLE_NET = { eth: 'eth', base: 'base', bsc: 'bsc', poly: 'poly', arb: 'arbi', sol: 'sol', sonic: 'sonic' }
const RES_TO_INTERVAL = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 720: '12h', '1D': '1d', D: '1d' }

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

function fmtShort(v) {
  const n = num(v)
  if (n == null) return '?'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K'
  return String(Math.round(n))
}

function candleKey(chain, ca) {
  if (chain === 'asset') return encodeURIComponent(String(ca).toUpperCase())
  if (chain === 'sol') return encodeURIComponent(ca)
  const id = CHAIN_TO_EVM_ID[chain]
  return id ? encodeURIComponent(`${ca}:${id}`) : null
}

async function marketsMap() {
  return cached('markets', 60_000, async () => {
    const j = await hetzner('/v1/coins/markets?per_page=250&order=market_cap_desc')
    const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []
    const by = new Map()
    for (const r of rows) {
      const s = String(r.symbol || '').toUpperCase()
      if (s && !by.has(s)) by.set(s, r)
    }
    return { rows, by }
  })
}

async function xdashSignals(limit = 60) {
  return cached(`sig:${limit}`, 30_000, async () => {
    const j = await hetzner(`/v1/intelligence/signals?limit=${limit}`)
    return Array.isArray(j?.data) ? j.data : []
  })
}

async function scannerToken(chain, ca) {
  const scannerChain = CHAIN_TO_SCANNER[chain]
  if (!scannerChain) {
    const e = new Error(`unsupported chain: ${chain}`)
    e.status = 400
    throw e
  }
  return cachedKV(`scan:${chain}:${ca.toLowerCase()}`, 120, async () => {
    // v1 responses are envelope-wrapped: { data, meta }
    const j = await hetzner(`/v1/scanner/token/${encodeURIComponent(ca)}?chain=${scannerChain}`, { timeoutMs: 9000 })
    return j?.data ?? j
  })
}

// Honest mapping from xdash convergence types onto the landing's taxonomy.
// Types with no truthful DEX equivalent are dropped, not force-fitted - the
// category columns have a designed empty state.
const XDASH_KIND = {
  smart_divergence: 'smart_money',
  social_price_divergence: 'smart_money',
  kol_convergence: 'smart_money',
  narrative_momentum: 'trending_gainer',
  social_surge: 'trending_gainer',
  sentiment_flip: 'trending_gainer',
  momentum_spike: 'trending_gainer',
}

// Live rows are camelCase: { id, signalType, asset, score (0-100), headline,
// detail, metadata, createdAt } - verified against prod 2026-06-10.
const typeOf = (row) => row.signalType || row.signal_type || row.type || ''

function narrativeOf(row) {
  if (row.headline) return row.detail ? `${row.headline} — ${row.detail}` : row.headline
  return row.narrative || row.description || row.detail || row.summary || row.reason || row.text ||
    `${String(typeOf(row) || 'signal').replace(/_/g, ' ')} on ${row.asset || ''}`.trim()
}

function normScore(v) {
  const s = num(v)
  if (s == null) return 50
  return Math.max(0, Math.min(100, Math.round(s > 10 ? s : s * 10)))
}

function buildSignals(rows, mk, limit) {
  const out = []
  // Stable hour bucket so derived signals don't read "now ago" on every
  // 20s landing poll.
  const hourBucket = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString()

  for (const r of rows) {
    const kind = XDASH_KIND[typeOf(r)]
    const sym = String(r.asset || r.symbol || '').toUpperCase()
    if (!kind || !sym || sym.length > 12) continue
    // xdash also tracks macro entities (e.g. "US") - only token cards belong
    // on this page, so the symbol must resolve in our tracked-asset set.
    const m = mk.by.get(sym)
    if (!m) continue
    out.push({
      id: `x-${r.id || `${typeOf(r)}-${sym}-${r.created_at || ''}`}`,
      kind,
      chain: 'asset',
      ca: sym,
      score: normScore(r.score),
      detectedAt: r.createdAt || r.created_at || r.ts || hourBucket,
      narrative: narrativeOf(r),
      token: { symbol: sym, logo: m.image || null },
      market: { priceUsd: num(m.current_price), mcap: num(m.market_cap), change24h: num(m.price_change_percentage_24h) },
    })
  }

  // Derived from our own market rows - honest price/turnover reads.
  const movers = mk.rows
    .filter((r) => (num(r.price_change_percentage_24h) ?? -1) >= 9 && (num(r.total_volume) || 0) >= 1_000_000)
    .sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0))
  for (const m of movers.slice(0, 8)) {
    const sym = String(m.symbol || '').toUpperCase()
    const ch = num(m.price_change_percentage_24h)
    out.push({
      id: `b-${sym}`,
      kind: 'price_breakout',
      chain: 'asset',
      ca: sym,
      score: Math.min(95, Math.round(50 + ch)),
      detectedAt: hourBucket,
      narrative: `+${ch.toFixed(1)}% in 24h on $${fmtShort(m.total_volume)} turnover — ${m.name || sym} leading the tracked set.`,
      token: { symbol: sym, logo: m.image || null },
      market: { priceUsd: num(m.current_price), mcap: num(m.market_cap), change24h: ch },
    })
  }

  const turners = mk.rows
    .filter((r) => (num(r.total_volume) || 0) >= 3_000_000 && (num(r.market_cap) || 0) >= 1_000_000)
    .map((r) => ({ r, ratio: r.total_volume / Math.max(r.market_cap, 1) }))
    .filter((x) => x.ratio >= 0.35)
    .sort((a, b) => b.ratio - a.ratio)
  for (const { r: m, ratio } of turners.slice(0, 8)) {
    const sym = String(m.symbol || '').toUpperCase()
    out.push({
      id: `v-${sym}`,
      kind: 'volume_spike',
      chain: 'asset',
      ca: sym,
      score: Math.min(92, Math.round(45 + ratio * 60)),
      detectedAt: hourBucket,
      narrative: `$${fmtShort(m.total_volume)} traded against $${fmtShort(m.market_cap)} mcap (${(ratio * 100).toFixed(0)}% turnover) in 24h.`,
      token: { symbol: sym, logo: m.image || null },
      market: { priceUsd: num(m.current_price), mcap: num(m.market_cap), change24h: num(m.price_change_percentage_24h) },
    })
  }

  // Breakdowns fill the "Rug & scam alerts" column with honest price reads
  // (severe 24h drawdown on real volume) until a global scanner alert feed
  // exists for liquidity drains / honeypot flips.
  const dumpers = mk.rows
    .filter((r) => (num(r.price_change_percentage_24h) ?? 0) <= -12 && (num(r.total_volume) || 0) >= 500_000)
    .sort((a, b) => (a.price_change_percentage_24h || 0) - (b.price_change_percentage_24h || 0))
  for (const m of dumpers.slice(0, 8)) {
    const sym = String(m.symbol || '').toUpperCase()
    const ch = num(m.price_change_percentage_24h)
    out.push({
      id: `d-${sym}`,
      kind: 'price_breakdown',
      chain: 'asset',
      ca: sym,
      score: Math.min(95, Math.round(50 + Math.abs(ch))),
      detectedAt: hourBucket,
      narrative: `${ch.toFixed(1)}% in 24h on $${fmtShort(m.total_volume)} volume — ${m.name || sym} breaking down.`,
      token: { symbol: sym, logo: m.image || null },
      market: { priceUsd: num(m.current_price), mcap: num(m.market_cap), change24h: ch },
    })
  }

  out.sort((a, b) => (new Date(b.detectedAt) - new Date(a.detectedAt)) || (b.score - a.score))
  return out.slice(0, limit)
}

// ── lookup composition ─────────────────────────────────────────────────────

async function lookupAsset(symbolRaw) {
  const sym = String(symbolRaw || '').toUpperCase()
  const mk = await marketsMap()
  let m = mk.by.get(sym) || null
  if (!m) {
    // Long-tail tokens (rank > 250) miss the markets map - /v1/prices serves
    // every tracked asset with price/mcap/volume/changes/logo (DSYNC fix:
    // the panel showed "worker cooking" for anything outside the top 250).
    try {
      const pr = await hetzner(`/v1/prices/${encodeURIComponent(sym)}`, { timeoutMs: 6000 })
      const p = pr?.data ?? pr
      if (p && (p.price != null || p.name)) {
        m = {
          symbol: p.symbol || sym,
          name: p.name,
          image: p.image,
          current_price: p.price,
          price_change_percentage_24h: p.change?.['24h'] ?? p.change_24h ?? p.change24h,
          market_cap: p.market_cap,
          fully_diluted_valuation: p.fdv,
          total_volume: p.volume_24h,
        }
      }
    } catch (_) { /* fall through to search */ }
  }
  if (!m) {
    try {
      const sr = await hetzner(`/v1/search?q=${encodeURIComponent(sym)}&limit=5`)
      const coins = sr?.data?.coins || []
      const hit = coins.find((c) => String(c.symbol || '').toUpperCase() === sym) || coins[0]
      if (hit) m = { symbol: hit.symbol, name: hit.name, image: hit.image }
    } catch (_) { /* identity falls back to the bare symbol */ }
  }
  const identity = { chain: 'asset', ca: sym, symbol: sym, name: m?.name || sym, logo: m?.image || null }
  const market = m && m.current_price != null ? {
    priceUsd: num(m.current_price),
    change24h: num(m.price_change_percentage_24h),
    mcap: num(m.market_cap),
    fdv: num(m.fully_diluted_valuation),
    vol24h: num(m.total_volume),
    liquidity: null,
    priceSource: 'spectre',
    updatedAt: new Date().toISOString(),
  } : null
  return { identity, market, flows: null, safety: null, socials: null }
}

function extractHandle(url) {
  const m = /(?:x|twitter)\.com\/(@?[A-Za-z0-9_]+)/.exec(url || '')
  return m ? m[1].replace(/^@/, '') : null
}
function extractTg(url) {
  const m = /t\.me\/([A-Za-z0-9_+]+)/.exec(url || '')
  return m ? m[1] : null
}

async function lookupCa(chain, ca) {
  const [tokR, bunR] = await Promise.allSettled([
    scannerToken(chain, ca),
    // Safety flags move slowly - 5 min KV cache keeps repeat CA lookups off
    // the box's scanner (same enrichment cost as the main scanner call).
    cachedKV(`bundle:${chain}:${ca.toLowerCase()}`, 300, () =>
      hetzner(`/v1/scanner/token/${encodeURIComponent(ca)}/bundle-check?chain=${CHAIN_TO_SCANNER[chain]}`, { timeoutMs: 9000 })),
  ])
  if (tokR.status !== 'fulfilled') {
    const status = tokR.reason?.status
    const e = new Error(status === 404 ? 'token not found on the Spectre scanner' : 'Spectre scanner unavailable')
    e.status = status === 404 || status === 400 ? status : 502
    throw e
  }
  const tok = tokR.value
  // Scanner pair schema is GT/DS-normalized snake_case (verified live):
  // { dex, pair_address, base:{symbol,name}, quote:{symbol}, price_usd,
  //   volume_24h, liquidity_usd, fdv_usd, market_cap_usd, change_24h_pct, … }
  const pairs = Array.isArray(tok.pairs) ? tok.pairs : []
  const best = pairs.slice().sort((a, b) => (num(b?.liquidity_usd) || 0) - (num(a?.liquidity_usd) || 0))[0] || null
  const info = tok.info || {}
  const detail = tok.detail || {}

  const identity = {
    chain,
    ca,
    symbol: tok.symbol || best?.base?.symbol || null,
    name: tok.name || best?.base?.name || null,
    logo: info.image_url || info.imageUrl || info.image || null,
  }
  const priceUsd = num(best?.price_usd) ?? num(detail.price_usd)
  const market = priceUsd != null ? {
    priceUsd,
    change24h: num(best?.change_24h_pct),
    mcap: num(best?.market_cap_usd) ?? num(detail.market_cap_usd),
    fdv: num(best?.fdv_usd) ?? num(detail.fdv_usd),
    vol24h: num(best?.volume_24h) ?? num(detail.volume_24h_usd),
    liquidity: num(best?.liquidity_usd) ?? num(detail.total_reserve_in_usd),
    priceSource: 'spectre-scanner',
    updatedAt: new Date().toISOString(),
  } : null

  const buys = num(best?.txns_24h_buys) ?? num(best?.buys_24h) ?? num(best?.txns?.h24?.buys)
  const sells = num(best?.txns_24h_sells) ?? num(best?.sells_24h) ?? num(best?.txns?.h24?.sells)
  const flows = buys != null || sells != null ? {
    buys24h: buys,
    sells24h: sells,
    buyVol24h: null,
    sellVol24h: null,
    netVol24h: null,
    uniqueBuyers24h: null,
    uniqueSellers24h: null,
    smartMoneyNet24h: null,
    smartMoneyTags: [],
    updatedAt: new Date().toISOString(),
  } : null

  const bun = bunR.status === 'fulfilled' ? bunR.value : null
  const safety = bun ? {
    isHoneypot: Array.isArray(bun.signals) && bun.signals.some((s) => /honeypot/i.test(s.type || '')),
    buyTax: null,
    sellTax: null,
    lpLocked: null,
    ownerRenounced: null,
    ownerShare: null,
    mintable: null,
    proxy: null,
    flags: Array.isArray(bun.signals) ? bun.signals.slice(0, 8).map((s) => (s.severity ? `${s.type} (${s.severity})` : String(s.type || ''))).filter(Boolean) : [],
    checkedAt: new Date().toISOString(),
    source: 'spectre scanner bundle-check',
  } : null

  // Scanner info carries GT token metadata: twitter_handle, telegram_handle,
  // discord_url, websites: [url, ...], description.
  let socials = null
  const websites = Array.isArray(info.websites) ? info.websites : []
  const tw = info.twitter_handle || null
  const tg = info.telegram_handle || null
  const dc = info.discord_url || null
  const web = typeof websites[0] === 'string' ? websites[0] : websites[0]?.url || null
  if (tw || tg || dc || web) socials = { twitter: tw, telegram: tg, discord: dc, website: web, github: null, twitterBio: null }

  const lore = typeof info.description === 'string' && info.description.trim()
    ? { projectDescription: info.description.trim(), projectGeneratedAt: tok.generated_at || new Date().toISOString() }
    : null

  return { identity, market, flows, safety, socials, lore, _pairs: pairs }
}

// Merge brain-side sections (/v1/dossier + /v1/profiles) for tracked symbols.
async function brainMerge(base) {
  const sym = String(base.identity?.symbol || '').toUpperCase()
  if (!sym || !/^[A-Z0-9]{1,12}$/.test(sym)) return base
  const [dosR, profR] = await Promise.allSettled([
    cached(`dossier:${sym}`, 120_000, async () => {
      const j = await hetzner(`/v1/dossier/${encodeURIComponent(sym)}`, { timeoutMs: 9000 })
      return j?.data ?? j
    }),
    cached(`profile:${sym}`, 600_000, () => hetzner(`/v1/profiles/${encodeURIComponent(sym)}`, { timeoutMs: 6000 })),
  ])
  const dos = dosR.status === 'fulfilled' ? dosR.value : null
  const profRaw = profR.status === 'fulfilled' ? profR.value : null
  const prof = profRaw?.data || profRaw || null

  // Seed from whatever the base lookup already knew (scanner description),
  // then let profile + brain content take precedence.
  const lore = { ...(base.lore || {}) }
  // Live profile shape: { symbol, name, tagline, profile, classification,
  // details, scores, links, categories, updated_at } - no `description`.
  const profText = [prof?.profile, prof?.description].find((v) => typeof v === 'string' && v.trim().length > 0)
    || (typeof prof?.tagline === 'string' && prof.tagline.trim() ? prof.tagline : null)
  if (profText) {
    lore.projectDescription = profText
    lore.projectGeneratedAt = prof.updated_at || prof.updatedAt || null
  }
  // ── Street Take: composed per-token read, not just the 280-char voice ──
  // The brain dossier carries structured thesis.bull_case / bear_case,
  // risk_flags (with evidence), technicals and derivatives. The voiceStylize
  // one-liner alone read as templated filler with no bull/bear reasoning
  // (Sunny, 2026-06-10) - so compose the narrative from the actual data.
  // Every timestamp gets a real fallback: rel(null) in the panel rendered
  // "NaNh ago".
  const brainTs = dos?.last_brain_thought_at || dos?.metadata?.generated_at || new Date().toISOString()
  if (lore.projectDescription && !lore.projectGeneratedAt) lore.projectGeneratedAt = brainTs
  const voiceText = typeof dos?.brain_voice === 'string'
    ? dos.brain_voice
    : dos?.brain_voice?.text || dos?.brain_voice?.voice_text || null

  const tech = dos?.technicals || null
  const deriv = dos?.derivatives || null
  const riskFlags = Array.isArray(dos?.risk_flags) ? dos.risk_flags : []
  const bulls = Array.isArray(dos?.thesis?.bull_case) ? dos.thesis.bull_case : []
  const bears = Array.isArray(dos?.thesis?.bear_case) ? dos.thesis.bear_case : []
  const conviction = dos?.conviction || null
  const hit = dos?.hit_rate || null

  const forSym = (e) => e && (
    String(e.asset || '').toUpperCase() === sym ||
    (Array.isArray(e.assets) && e.assets.map((a) => String(a).toUpperCase()).includes(sym))
  )
  const caseLine = (e) => e.thesis
    ? `${e.title}: ${e.thesis}`
    : `${e.title}${e.severity ? ` (${e.severity} severity${e.probability ? `, ${e.probability} probability` : ''})` : ''}`

  const parts = []
  if (voiceText) parts.push(voiceText.trim())
  if (tech && (tech.trend || num(tech.rsi_14) != null)) {
    const bits = []
    if (tech.trend) bits.push(`trend ${tech.trend}`)
    if (num(tech.rsi_14) != null) bits.push(`RSI ${Math.round(tech.rsi_14)}`)
    if (num(tech.support) != null && num(tech.resistance) != null) bits.push(`range $${fmtShort(tech.support)}–$${fmtShort(tech.resistance)}`)
    if (tech.ma_signal) bits.push(`MAs say ${tech.ma_signal}`)
    if (bits.length) parts.push(`Setup: ${bits.join(', ')}.`)
  }
  // Derivatives only exist for perp-listed assets. On-chain-only tokens come
  // back with null/zero derivatives - printing "funding 0.000%/8h, OI $0" on
  // a DEX project is noise, not intel (Sunny, DSYNC review). Same for the
  // funding/liquidation-derived risk flags.
  const oiUsd = num(deriv?.open_interest_usd)
  const fundingAvg = num(deriv?.funding_rate_8h_avg)
  const hasDerivMarket = (oiUsd != null && oiUsd > 100_000) || (fundingAvg != null && fundingAvg !== 0)
  if (deriv && hasDerivMarket) {
    const bits = []
    if (fundingAvg != null && fundingAvg !== 0) bits.push(`funding ${(fundingAvg * 100).toFixed(3)}%/8h (${fundingAvg >= 0 ? 'longs' : 'shorts'} paying)`)
    if (oiUsd != null && oiUsd > 100_000) {
      const oiCh = num(deriv.oi_change_24h_pct)
      bits.push(`OI $${fmtShort(oiUsd)}${oiCh != null ? ` (${oiCh >= 0 ? '+' : ''}${oiCh.toFixed(2)}% 24h)` : ''}`)
    }
    if ((num(deriv.liquidations_24h_usd) || 0) > 0) {
      const longShare = num(deriv.long_liquidations_24h) != null
        ? Math.round((deriv.long_liquidations_24h / deriv.liquidations_24h_usd) * 100)
        : null
      bits.push(`$${fmtShort(deriv.liquidations_24h_usd)} liquidated 24h${longShare != null ? ` (${longShare}% longs)` : ''}`)
    }
    if (bits.length) parts.push(`Positioning: ${bits.join('; ')}.`)
  }
  // Only THIS token's bull/bear entries. The brain thesis also carries
  // market-wide calls about other assets - those read as filler on a token
  // page ("Market bull case: ETH Bounce Play" on a DSYNC dossier).
  const bullPicks = bulls.filter(forSym).slice(0, 2)
  if (bullPicks.length) parts.push(`Bull case: ${bullPicks.map(caseLine).join(' · ')}`)
  const bearPicks = bears.filter(forSym).slice(0, 2)
  const DERIV_FLAG_RE = /funding|liquidat|open.?interest|\boi\b/i
  const relevantFlags = riskFlags.filter((f) => hasDerivMarket || !DERIV_FLAG_RE.test(`${f.flag} ${f.evidence || ''}`))
  const flagLines = relevantFlags.slice(0, 2).map((f) => `${String(f.flag || '').replace(/_/g, ' ')} — ${f.evidence || f.severity || 'flagged'}`)
  if (bearPicks.length || flagLines.length) {
    parts.push(`Bear case: ${[...bearPicks.map(caseLine), ...flagLines].join(' · ')}`)
  }
  if (conviction?.stance) {
    const hr = hit && num(hit.score) != null && (num(hit.n) || 0) > 0
      ? `; ${Math.round(hit.score * 100)}% hit rate over ${hit.n} graded calls`
      : ''
    parts.push(`Brain stance: ${conviction.stance}${conviction.tier ? ` (${conviction.tier} tier)` : ''}${conviction.has_conviction === false ? ', low conviction' : ''}${hr}.`)
  }
  if (parts.length) {
    lore.communityNarrative = parts.join('\n\n')
    lore.narrativeGeneratedAt = brainTs
    if (conviction?.stance) lore.narrativeVerdict = String(conviction.stance).toLowerCase()
  }

  const confOf = (v) => {
    const c = num(v)
    if (c == null) return 0
    return c > 1 ? Math.min(1, c / 10) : c
  }
  const SEV_CONF = { critical: 0.95, high: 0.9, med: 0.6, medium: 0.6, low: 0.35 }
  // Voices repeat when the same on-chain event fires multiple collectors -
  // dedup by claim/body before mapping.
  const seenVoice = new Set()
  const voices = (Array.isArray(dos?.voices) ? dos.voices : []).filter((v) => {
    const k = String(v.claim || v.text || v.summary || '').slice(0, 120)
    if (!k || seenVoice.has(k)) return false
    seenVoice.add(k)
    return true
  })
  const brainAnnotations = voices.slice(0, 6).map((v) => ({
    kind: v.signal_type || v.kind || v.type || v.source || 'voice',
    body: v.claim
      ? (v.summary && v.summary !== v.claim ? `${v.claim} — ${v.summary}` : v.claim)
      : (v.text || v.body || v.summary || v.detail || ''),
    confidence: v.severity ? (SEV_CONF[String(v.severity).toLowerCase()] ?? confOf(v.confidence ?? v.score)) : confOf(v.confidence ?? v.score),
    createdAt: v.timestamp || v.created_at || v.createdAt || v.ts || brainTs,
  })).filter((a) => a.body)
  for (const e of bearPicks) {
    brainAnnotations.unshift({ kind: 'bear_case', body: caseLine(e), confidence: SEV_CONF[String(e.severity || '').toLowerCase()] ?? 0.6, createdAt: brainTs })
  }
  for (const e of bullPicks) {
    brainAnnotations.unshift({ kind: 'bull_case', body: caseLine(e), confidence: 0.65, createdAt: brainTs })
  }
  for (const f of relevantFlags.slice(0, 3)) {
    brainAnnotations.push({
      kind: 'risk_flag',
      body: `${String(f.flag || '').replace(/_/g, ' ')} — ${f.evidence || 'flagged'}`,
      confidence: SEV_CONF[String(f.severity || '').toLowerCase()] ?? 0.5,
      createdAt: brainTs,
    })
  }
  if (brainAnnotations.length > 10) brainAnnotations.length = 10

  const links = prof?.links || prof || {}
  if (links.website || links.twitter || links.telegram || links.github || links.discord) {
    base.socials = {
      twitter: base.socials?.twitter || extractHandle(links.twitter) || links.twitter || null,
      telegram: base.socials?.telegram || extractTg(links.telegram) || links.telegram || null,
      discord: base.socials?.discord || links.discord || null,
      website: base.socials?.website || links.website || null,
      github: base.socials?.github || links.github || null,
      twitterBio: base.socials?.twitterBio || null,
    }
  }

  return {
    ...base,
    lore: Object.keys(lore).length ? lore : null,
    brainAnnotations,
  }
}

async function fetchCandles(chain, ca, { resolution = '60', hours = 24 }) {
  const key = candleKey(chain, ca)
  if (!key) return []
  const interval = RES_TO_INTERVAL[resolution] || '1h'
  const clampedHours = Math.min(Math.max(Number(hours) || 24, 1), 2160)
  const to = new Date()
  const from = new Date(Date.now() - clampedHours * 3_600_000)
  const j = await hetzner(
    `/v1/candles/${key}?interval=${interval}&from=${from.toISOString()}&to=${to.toISOString()}&limit=1000`,
    { timeoutMs: 9000 },
  )
  const rows = Array.isArray(j?.data) ? j.data : []
  return rows
    .map((r) => ({
      t: Math.floor(new Date(r.time || r.bucket || r.ts).getTime() / 1000),
      o: num(r.open), h: num(r.high), l: num(r.low), c: num(r.close), v: num(r.volume) || 0,
    }))
    .filter((b) => Number.isFinite(b.t) && b.o != null && b.c != null)
}

// ── main ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const route = String(req.query.route || '')
  const chain = String(req.query.chain || '').toLowerCase()
  const ca = String(req.query.ca || '').trim()
  const setCache = (sMax, swr) => {
    const h = `public, s-maxage=${sMax}, stale-while-revalidate=${swr}`
    res.setHeader('Cache-Control', h)
    res.setHeader('CDN-Cache-Control', h)
  }

  try {
    if (route === 'noop') {
      // Legacy enrichment POSTs (safety/check, socials/refresh, flows/refresh,
      // lore/generate). In spectre-api-only mode enrichment happens upstream
      // on Hetzner workers - acknowledge so the panel's refresh flow proceeds.
      return res.status(200).json({ ok: true, queued: false, mode: 'spectre-api-only' })
    }

    if (route === 'health') {
      setCache(120, 300)
      let h = null
      try { h = await cached('health', 120_000, () => hetzner('/v1/health', { timeoutMs: 5000 })) } catch (_) { h = null }
      let events = null
      try { events = (await xdashSignals(60)).length } catch (_) { events = null }
      return res.status(200).json({
        ok: true,
        source: 'spectre-data-api',
        counts: {
          tokens: num(h?.assets) ?? num(h?.stats?.assets) ?? num(h?.counts?.assets) ?? null,
          safety: null,
          events,
        },
      })
    }

    if (route === 'signals') {
      setCache(60, 120)
      const limit = Math.min(Number(req.query.limit) || 100, 200)
      const [rows, mk] = await Promise.all([
        xdashSignals(60).catch(() => []),
        marketsMap(),
      ])
      return res.status(200).json({ signals: buildSignals(rows, mk, limit) })
    }

    if (route === 'annotations') {
      setCache(60, 120)
      const limit = Math.min(Number(req.query.limit) || 10, 50)
      const [rows, mk] = await Promise.all([xdashSignals(40).catch(() => []), marketsMap().catch(() => ({ by: new Map() }))])
      const annotations = rows.slice(0, limit).map((r) => {
        const sym = String(r.asset || '').toUpperCase()
        return {
          kind: typeOf(r) || 'signal',
          chain: 'asset',
          // Only tracked tokens get a clickable target - macro entities
          // (e.g. "US") keep ca:null so the landing's `a.ca &&` guard holds.
          ca: mk.by.has(sym) ? sym : null,
          confidence: (() => { const s = num(r.score); return s == null ? 0 : Math.min(1, s > 1 ? s / 100 : s) })(),
          createdAt: r.createdAt || r.created_at || null,
          body: narrativeOf(r),
        }
      })
      return res.status(200).json({ annotations })
    }

    if (route === 'search') {
      setCache(30, 60)
      const q = String(req.query.q || '').trim()
      if (!q) return res.status(200).json({ results: [] })
      const j = await hetzner(`/v1/search?q=${encodeURIComponent(q)}&limit=10`)
      const coins = j?.data?.coins || []
      return res.status(200).json({
        results: coins.map((c) => ({
          chain: 'asset',
          ca: String(c.symbol || '').toUpperCase(),
          symbol: c.symbol,
          name: c.name,
          logo: c.image || null,
        })),
      })
    }

    // Everything below needs chain + ca.
    if (!chain || !ca) return res.status(400).json({ error: 'chain and ca required' })

    if (route === 'lookup') {
      setCache(60, 180)
      const base = chain === 'asset' ? await lookupAsset(ca) : await lookupCa(chain, ca)
      // Scanner pairs can come back empty for tracked majors (their volume
      // lives on CEXes, not DEX pools). Fall back to our own market row.
      if (!base.market && base.identity?.symbol) {
        try {
          const mk = await marketsMap()
          const m = mk.by.get(String(base.identity.symbol).toUpperCase())
          if (m) {
            base.market = {
              priceUsd: num(m.current_price),
              change24h: num(m.price_change_percentage_24h),
              mcap: num(m.market_cap),
              fdv: num(m.fully_diluted_valuation),
              vol24h: num(m.total_volume),
              liquidity: null,
              priceSource: 'spectre',
              updatedAt: new Date().toISOString(),
            }
            if (!base.identity.logo) base.identity.logo = m.image || null
          }
        } catch (_) { /* market stays null - panel shows its empty state */ }
      }
      const merged = await brainMerge(base)
      const { _pairs, ...payload } = merged
      return res.status(200).json({
        ...payload,
        holders: null,
        mindshare: null,
        brainAnnotations: payload.brainAnnotations || [],
        meta: { source: 'spectre-data-api', composed_at: new Date().toISOString() },
      })
    }

    // Address-keyed candle reads miss when the token has no chart_assets row;
    // tracked tokens (PEPE etc.) still have CEX candles under their symbol.
    const candlesWithSymbolFallback = async (opts) => {
      let bars = await fetchCandles(chain, ca, opts)
      if (!bars.length && chain !== 'asset') {
        try {
          const tok = await scannerToken(chain, ca)
          const sym = tok?.symbol || tok?.pairs?.[0]?.base?.symbol
          if (sym) bars = await fetchCandles('asset', sym, opts)
        } catch (_) { /* keep empty - chart shows its overlay */ }
      }
      return bars
    }

    if (route === 'series') {
      setCache(60, 120)
      const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168)
      const bars = await candlesWithSymbolFallback({ resolution: '15', hours })
      return res.status(200).json({ points: bars.map((b) => ({ ts: b.t * 1000, priceUsd: b.c })) })
    }

    if (route === 'candles') {
      setCache(60, 120)
      const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 2160)
      const resolution = String(req.query.resolution || '60')
      const bars = await candlesWithSymbolFallback({ resolution, hours })
      return res.status(200).json({ bars, resolution, hours, source: 'spectre-candle-store' })
    }

    if (route === 'pools') {
      setCache(120, 300)
      if (chain === 'asset') return res.status(200).json({ pools: [], primary: null, dexId: null })
      const tok = await scannerToken(chain, ca)
      const pairs = Array.isArray(tok.pairs) ? tok.pairs : []
      const pools = pairs.map((p) => ({
        dex: p.dex || p.dexId || null,
        quote: p.quote?.symbol || null,
        liquidity: num(p.liquidity_usd),
        volume24h: num(p.volume_24h),
        pairCreatedAt: p.pair_created_at || p.pairCreatedAt || null,
        labels: Array.isArray(p.labels) ? p.labels : [],
      })).sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0))
      return res.status(200).json({ pools, primary: pairs[0]?.pair_address || null, dexId: pools[0]?.dex || null })
    }

    if (route === 'bubblemaps') {
      setCache(86400, 86400)
      const net = BUBBLE_NET[chain]
      if (!net) return res.status(404).json({ error: 'bubblemaps not supported on this chain' })
      return res.status(200).json({
        embedUrl: `https://app.bubblemaps.io/${net}/token/${ca}?mode=1`,
        viewUrl: `https://app.bubblemaps.io/${net}/token/${ca}`,
        chain,
        ca,
      })
    }

    return res.status(400).json({ error: `Unknown dossier-api route: ${route}` })
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
    return res.status(status).json({ error: err.message || 'dossier-api error' })
  }
}
