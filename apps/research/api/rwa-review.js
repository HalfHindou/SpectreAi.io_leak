/**
 * /api/rwa/review — comprehensive AI review of the tokenized-assets (RWA)
 * landscape. Gathers the live RWA data sheet server-side (box /v1/rwa/*) and
 * runs ONE structured pass through the resilient LLM gateway (falls through
 * providers, so it does not depend on any single key). Output feeds BOTH the
 * web Review tab and the Telegram on-demand command — one pipeline, two faces.
 *
 * Cached in KV ~2h (RWA moves slowly) with a generation lock + last-good
 * fallback, so bursts never double-spend and a cold LLM never blanks the tab.
 * Numbers are gathered from real endpoints and handed to the model as a sheet;
 * the prose narrates only what is on the sheet (no self-fetch of our own /api).
 */
import { chat } from './_lib/llm-gateway.js'
import { getJsonWithTTL, setJsonWithTTL } from './_lib/kv.js'
import { rateLimit } from './_lib/ratelimit.js'

const API_BASE = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
const API_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_BRIDGE_KEY || ''

const CACHE_KEY = 'rwa-review:v1'
const LAST_KEY = 'rwa-review:last'
const LOCK_KEY = 'rwa-review:gen'
const CACHE_TTL_S = 2 * 60 * 60      // 2h fresh
const LAST_TTL_S = 24 * 60 * 60      // 24h last-good fallback
const LOCK_TTL_S = 60

async function boxGet(path, timeoutMs = 12000) {
  const headers = { Accept: 'application/json' }
  if (API_KEY) headers['X-API-Key'] = API_KEY
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
function fmtUsd(n) {
  const v = num(n); if (v == null) return null
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${Math.round(v)}`
}

// Compact the live RWA data into a numbers-only sheet the model narrates.
async function fetchRwaSheet() {
  const [overviewRes, stablesRes, flowsRes] = await Promise.all([
    boxGet('/v1/rwa/overview'),
    boxGet('/v1/rwa/stablecoins-summary'),
    boxGet('/v1/rwa/flows/top?limit=8'),
  ])
  const data = overviewRes?.data
  if (!data) return null

  const cat = data.categories || {}
  const sector = (c) => c ? {
    tvl: num(c.tvl),
    tvlFmt: fmtUsd(c.tvl),
    count: num(c.count),
    top: (c.assets || []).slice(0, 6).map((a) => ({
      name: a.name, sym: a.symbol, tvl: fmtUsd(a.tvl),
      chg24h: num(a.price_change_24h), chg7d: num(a.price_change_7d),
    })),
  } : null

  return {
    totalTvl: num(data.total_rwa_tvl),
    totalTvlFmt: fmtUsd(data.total_rwa_tvl),
    totalAssets: num(data.total_assets),
    sectors: {
      treasuries: sector(cat.treasuries),
      stablecoins: sector(cat.stablecoins),
      credit: sector(cat.credit),
      commodities: sector(cat.commodities),
    },
    topProtocols: (data.top_protocols || []).slice(0, 8).map((p) => ({
      name: p.name || p.platform || p.slug, tvl: fmtUsd(p.tvl ?? p.tvl_usd),
    })),
    chains: (data.chain_breakdown || []).slice(0, 6).map((c) => ({
      chain: c.chain || c.name, tvl: fmtUsd(c.tvl ?? c.tvl_usd),
    })),
    stablecoinSupply: fmtUsd(stablesRes?.total ?? stablesRes?.data?.total ?? cat.stablecoins?.tvl),
    topFlows: Array.isArray(flowsRes?.data) ? flowsRes.data.slice(0, 8)
      : Array.isArray(flowsRes) ? flowsRes.slice(0, 8) : null,
    narrative: data.narrative?.summary || data.narrative?.headline || null,
  }
}

const SYSTEM_PROMPT = `You are a senior real-world-asset (RWA / tokenized-assets) strategist writing a comprehensive desk review for institutional crypto investors. You cover tokenized US treasuries, stablecoins, on-chain private credit, and tokenized commodities.

Write a grounded, decision-useful read of the WHOLE tokenized-assets market from the data sheet provided. Every claim must trace to a number on the sheet — never invent figures or names not present.

Voice: dry, precise, investor-to-investor. BANNED: hype ("massive", "explosive", "game-changer", "moon"), exclamation marks, emojis, hedging filler ("it's important to note"), and any promise of returns.

Return ONLY valid JSON, no markdown, matching exactly:
{
  "stance": "constructive" | "cautious" | "neutral" | "mixed",
  "headline": "<=90 chars, the one-line takeaway",
  "summary": "2-3 sentences: the overall state of tokenized assets right now",
  "regime": "<=130 chars: the macro/liquidity regime framing RWA flows now",
  "sectors": [
    { "name": "Tokenized Treasuries", "signal": "expanding" | "steady" | "cooling", "read": "1-2 sentences citing the sector TVL and a top name/mover" },
    { "name": "Stablecoins", "signal": "...", "read": "..." },
    { "name": "Private Credit", "signal": "...", "read": "..." },
    { "name": "Commodities", "signal": "...", "read": "..." }
  ],
  "risks": ["2-4 concrete risks, each a short phrase"],
  "opportunities": ["2-4 concrete opportunities, each a short phrase"],
  "catalysts": ["2-4 forward catalysts to watch, each a short phrase"]
}`

function buildContent(sheet) {
  return `RWA DATA SHEET (live):\n${JSON.stringify(sheet, null, 2)}\n\nWrite the comprehensive review as specified. Ground every sector read in its tvl/top-name/mover from the sheet.`
}

const STANCES = new Set(['constructive', 'cautious', 'neutral', 'mixed'])
const SIGNALS = new Set(['expanding', 'steady', 'cooling'])
const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const arr = (v, n, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x) => s(x, max)) : [])

function sanitize(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const stance = STANCES.has(parsed.stance) ? parsed.stance : 'neutral'
  const headline = s(parsed.headline, 110)
  if (!headline) return null
  const sectors = (Array.isArray(parsed.sectors) ? parsed.sectors : []).slice(0, 4).map((x) => ({
    name: s(x?.name, 40) || 'Sector',
    signal: SIGNALS.has(x?.signal) ? x.signal : 'steady',
    read: s(x?.read, 320),
  })).filter((x) => x.read)
  return {
    stance,
    headline,
    summary: s(parsed.summary, 500),
    regime: s(parsed.regime, 160),
    sectors,
    risks: arr(parsed.risks, 4, 160),
    opportunities: arr(parsed.opportunities, 4, 160),
    catalysts: arr(parsed.catalysts, 4, 160),
  }
}

export async function generateRwaReview() {
  const sheet = await fetchRwaSheet()
  if (!sheet) return null
  const r = await chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildContent(sheet) },
    ],
    tier: 'smart',
    json: true,
    maxTokens: 1100,
    temperature: 0.4,
    timeoutMs: 30_000,
  })
  if (!r.ok || !r.text) return null
  let parsed = null
  try { parsed = JSON.parse(r.text) } catch {
    const m = r.text.match(/\{[\s\S]*\}/)
    if (m) { try { parsed = JSON.parse(m[0]) } catch { parsed = null } }
  }
  const review = sanitize(parsed)
  if (!review) return null
  return {
    ...review,
    inputs: {
      totalTvl: sheet.totalTvlFmt,
      totalAssets: sheet.totalAssets,
      treasuries: sheet.sectors.treasuries?.tvlFmt || null,
      stablecoins: sheet.stablecoinSupply || sheet.sectors.stablecoins?.tvlFmt || null,
      credit: sheet.sectors.credit?.tvlFmt || null,
      commodities: sheet.sectors.commodities?.tvlFmt || null,
      topProtocols: sheet.topProtocols.slice(0, 5),
    },
    provider: r.provider,
    generatedAt: new Date().toISOString(),
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (await rateLimit(req, res, { bucket: 'rwa-review', max: 20, windowMs: 60_000 })) return

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200')
  try {
    const cached = await getJsonWithTTL(CACHE_KEY)
    if (cached?.headline) return res.status(200).json({ review: cached, cached: true })

    // Only one generator at a time; concurrent callers get the last good read.
    const lock = await getJsonWithTTL(LOCK_KEY)
    if (lock) {
      const last = await getJsonWithTTL(LAST_KEY).catch(() => null)
      if (last?.headline) return res.status(200).json({ review: last, cached: true, stale: true })
      return res.status(200).json({ review: null, pending: true })
    }
    await setJsonWithTTL(LOCK_KEY, { ts: Date.now() }, LOCK_TTL_S)

    const review = await generateRwaReview()
    if (!review) {
      const last = await getJsonWithTTL(LAST_KEY).catch(() => null)
      if (last?.headline) return res.status(200).json({ review: last, cached: true, stale: true })
      return res.status(200).json({ review: null, error: 'unavailable' })
    }
    await setJsonWithTTL(CACHE_KEY, review, CACHE_TTL_S)
    await setJsonWithTTL(LAST_KEY, review, LAST_TTL_S)
    return res.status(200).json({ review, cached: false })
  } catch (err) {
    console.error('[rwa-review]', err.message)
    const last = await getJsonWithTTL(LAST_KEY).catch(() => null)
    if (last?.headline) return res.status(200).json({ review: last, cached: true, stale: true })
    return res.status(502).json({ review: null, error: 'Failed to generate review' })
  }
}
