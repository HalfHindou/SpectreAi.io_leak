/**
 * /api/rwa/analysis/:topic (+ /protocol/:slug) — Spectre Brain daily analysis
 * for the tokenized-assets pages, generated ON VERCEL.
 *
 * WHY THIS EXISTS: the old rewrite proxied these paths to the Hetzner box's
 * /v1/rwa/analysis/* — a route that was never built there, so every prod call
 * 404'd and all 7 subpage Brain cards (plus the protocol drawer) sat on
 * "Analyzing live signal" forever. Dev never showed it because Express
 * generates + caches locally via agents/rwaAnalysisAgent.js.
 *
 * This function is that agent's serverless twin: same Daily Edition prompt,
 * context gathered from the box's /v1/rwa/* data sheet, one pass through the
 * resilient LLM gateway with GEMINI FIRST (the free-tier provider — founder
 * directive 2026-08-14: "wire gemini no cost"), falling through to the rest of
 * the chain so a Gemini outage degrades instead of blanking the card.
 *
 * Caching mirrors rwa-review.js: KV 23h fresh (Daily Edition cadence, matches
 * the dev agent's STALE_MS) + 72h last-good fallback + a generation lock so
 * bursts never double-spend. First cold caller generates inline (~3-8s on
 * Gemini flash, inside this function's 45s budget); concurrent callers get the
 * lock → 202, and the client's existing 9s fast-retry loop picks up the KV
 * entry on its next pass.
 */
import { chat } from './_lib/llm-gateway.js'
import { getJsonWithTTL, setJsonWithTTL } from './_lib/kv.js'
import { rateLimit } from './_lib/ratelimit.js'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const API_BASE = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
const API_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_BRIDGE_KEY || ''

const TOPICS = new Set(['overview', 'stablecoins', 'treasuries', 'credit', 'commodities', 'networks', 'platforms'])

const FRESH_TTL_S = 23 * 60 * 60 // one edition per topic per day — matches the dev agent
const LAST_TTL_S = 72 * 60 * 60  // last-good survives a weekend of failed generations
const LOCK_TTL_S = 90

// Gemini first — free tier, founder-requested. The rest of the gateway chain
// stays as fallback so a tripped Gemini breaker degrades instead of blanking.
const CHAIN = ['gemini', 'groq', 'cerebras', 'openrouter', 'openai', 'anthropic']

async function boxGet(path, timeoutMs = 10000) {
  const headers = { Accept: 'application/json' }
  if (API_KEY) headers['X-API-Key'] = API_KEY
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
function fmtB(n) {
  const v = num(n); if (v == null) return '$0'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${Math.round(v)}`
}
const pct = (v) => (num(v) == null ? 'n/a' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`)

// ── Recent developments (2026-08-14) ────────────────────────────────────────
// The prompt has always asked for "the day's tokenized-asset news", but NO news
// was ever put in the context — the original agent ran on Perplexity sonar-pro,
// which searched the web itself; when generation moved to Groq/Gemini the search
// went away and the instruction did not. With an empty context and a licence to
// "note when nothing broke", every edition wrote "news was quiet, no major
// announcements" — false whenever anything shipped in the days before. So we now
// hand the model a real, dated list and forbid the quiet claim unless it's empty.
const NEWS_WINDOW_DAYS = 14
const NEWS_MAX_ITEMS = 12

// The box's /v1/rwa/news lane matches on a bare "rwa" substring, so it drags in
// SEC EDGAR filings for AIRWA INC., JETBLUE AIRWAYS, CLEARWATER PAPER and
// FORWARD AIR (21 of 60 rows measured 2026-08-14). Drop that source outright and
// require a genuine tokenized-asset term in the headline.
const RWA_TERMS = /\b(rwa|rwas|tokeniz\w*|real[- ]world asset|treasur\w*|t-bill|stablecoin|private credit|money market fund|tokenised|on-?chain fund|bond fund|gold-backed|custod\w*|issuer)\b/i

const HTML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
    .trim()
}

async function fetchRwaDevelopments() {
  const res = await boxGet('/v1/news/rwa?limit=60', 8000)
  const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
  const cutoff = Date.now() - NEWS_WINDOW_DAYS * 86400000
  const seen = new Set()
  const items = []
  for (const r of rows) {
    if (r?.source === 'SEC EDGAR') continue
    const title = decodeEntities(r?.title)
    if (!title) continue
    if (!RWA_TERMS.test(`${title} ${decodeEntities(r?.summary)}`)) continue
    const ts = Date.parse(r?.publishedAt || r?.published_at || '')
    if (!Number.isFinite(ts) || ts < cutoff) continue
    const key = title.toLowerCase().replace(/\W+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ date: new Date(ts).toISOString().slice(0, 10), source: r?.source || 'unknown', title })
    if (items.length >= NEWS_MAX_ITEMS) break
  }
  return items
}

// AUM trend per category over several windows. The daily series is forward-
// filled, so window N is simply N entries back from the end — never index from
// the START: `?range=30d` is not a valid key on the box (valid: 1m/3m/6m/1y/2y/
// all) and silently returns a full year, which made a naive first-vs-last "30d"
// read +1584%.
async function fetchSectorTrends() {
  const res = await boxGet('/v1/rwa/breakdown/history?range=3m', 20000)
  const data = res?.data || res
  const series = Array.isArray(data?.series) ? data.series : []
  const cats = Array.isArray(data?.categories) ? data.categories : []
  if (series.length < 8 || !cats.length) return null
  const at = (i, c) => Number(series[i]?.[c]) || 0
  const chg = (c, n) => {
    if (series.length < n + 1) return null
    const a = at(-(n + 1) + series.length, c)
    const b = at(series.length - 1, c)
    return a > 0 ? ((b - a) / a) * 100 : null
  }
  return cats
    .map((c) => ({ category: c, aum: at(series.length - 1, c), d7: chg(c, 7), d30: chg(c, 30), d90: chg(c, 90) }))
    .filter((r) => r.aum > 0)
    .sort((a, b) => b.aum - a.aum)
    .slice(0, 8)
}

// ── Prompts — kept in sync with packages/server/agents/rwaAnalysisAgent.js ──

const SUBPAGE_SYSTEM_PROMPT = `You are Spectre AI's RWA (Real World Assets) research analyst writing the DAILY EDITION. One article per day. Write as "we" (Spectre AI). Institutional tone, data-driven, opinionated. Today's edition must thread together three layers:

  1) What moved in this RWA category, over 24h AND across the wider trend. The sheet carries 7d / 30d / 90d AUM moves per category: read the day against that trend rather than in isolation, and say plainly when a daily wobble sits inside a multi-week direction.
  2) The notable tokenized-asset developments of the LAST TWO WEEKS, taken ONLY from the DEVELOPMENTS list on the sheet (issuer announcements, chain launches, regulatory moves, partnerships, research). Date every one you cite ("on Aug 10, ..."). Lead with the newest, but a material story from several days ago is still news the reader must know and is worth a line.
     NEVER write that news was quiet, that nothing broke, or that there were no major announcements while the DEVELOPMENTS list has entries in it. Only when that list explicitly says none were returned may you say there is nothing notable to report.
  3) General market context framing the above: BTC/ETH direction, US Treasury yields and dollar strength, equity risk tone, any macro catalyst (CPI, FOMC, ETF flows). Tie the RWA move to the macro frame in one sentence.

Format: 3–4 tight sentences of prose (the lede weaves RWA + macro), followed by a "## What changed" markdown heading and exactly 2–3 bullets under it. Each bullet is one sentence describing a concrete shift: distribution changes, inflow/outflow drivers, issuer concentration moves, peg anomalies, TVL rotations, or regulatory catalysts.

Rules:
- Include specific numbers ($B TVL, % change, basis points) everywhere, taken ONLY from the data sheet provided
- NO em-dashes. Use commas, colons, or split sentences
- Paragraphs: maximum 3 sentences. Bullets: one sentence each
- Do NOT place [1][2] citation markers in prose
- Banned phrases: "delve into", "landscape", "robust", "leverage" (as verb), "seamlessly", "groundbreaking", "deep dive", "pivotal", "realm", "navigate", "cutting-edge"
- 180–320 words total, no more`

const PROTOCOL_SYSTEM_PROMPT = `You are Spectre AI's RWA research analyst covering a single tokenized-asset protocol. Write as "we" (Spectre AI). Institutional tone, data-driven.

Format: 2–3 tight sentences covering the protocol's current TVL position and trajectory, followed by a "## What changed" markdown heading with exactly 2–3 one-sentence bullets. Cover: TVL direction, chain exposure shifts, and peer comparison within the RWA sector.

Rules:
- Include specific TVL figures and % changes from the data sheet only
- NO em-dashes. Use commas or colons
- Paragraphs: maximum 3 sentences. Bullets: one sentence each
- Do NOT place [1][2] citation markers in prose
- Banned phrases: "delve into", "landscape", "robust", "leverage" (as verb), "seamlessly", "deep dive", "pivotal", "realm"
- 180–300 words total`

// ── Context builders — box /v1/rwa/* is the data sheet ──────────────────────

function sectorLines(label, c) {
  if (!c) return []
  const lines = [`${label}: ${fmtB(c.tvl)} across ${c.count ?? '?'} tracked assets.`]
  for (const a of (c.assets || []).slice(0, 8)) {
    lines.push(`- ${a.name} (${a.symbol}): ${fmtB(a.market_cap)}, 24h ${pct(a.price_change_24h)}, 7d ${pct(a.price_change_7d)}`)
  }
  return lines
}

async function buildTopicContext(topic) {
  const [overviewRes, stablesRes, flowsRes, developments, trends] = await Promise.all([
    boxGet('/v1/rwa/overview'),
    topic === 'overview' || topic === 'stablecoins' ? boxGet('/v1/rwa/stablecoins-summary') : null,
    topic === 'overview' ? boxGet('/v1/rwa/flows/top?limit=8') : null,
    fetchRwaDevelopments().catch(() => []),
    fetchSectorTrends().catch(() => null),
  ])
  const data = overviewRes?.data
  if (!data) return null

  const cat = data.categories || {}
  const lines = [`Total RWA sector TVL: ${fmtB(data.total_rwa_tvl)} across ${data.total_assets ?? '?'} tracked assets.`]

  if (topic === 'overview') {
    lines.push(...sectorLines('Tokenized treasuries', cat.treasuries))
    lines.push(...sectorLines('Private credit', cat.credit))
    lines.push(...sectorLines('Commodities', cat.commodities))
    const stableTotal = stablesRes?.total ?? stablesRes?.data?.total ?? cat.stablecoins?.tvl
    if (stableTotal) lines.push(`Stablecoin supply: ${fmtB(stableTotal)}.`)
    lines.push('Top RWA-linked protocols by TVL:')
    for (const p of (data.top_protocols || []).slice(0, 8)) {
      lines.push(`- ${p.name}${p.symbol ? ` (${p.symbol})` : ''}: ${fmtB(p.tvl)}, 24h ${pct(p.price_change_24h)}, 7d ${pct(p.price_change_7d)}`)
    }
    const flows = Array.isArray(flowsRes?.data) ? flowsRes.data : Array.isArray(flowsRes) ? flowsRes : []
    if (flows.length) {
      lines.push('Top 7d flows:')
      for (const f of flows.slice(0, 6)) lines.push(`- ${JSON.stringify(f)}`)
    }
  } else if (topic === 'stablecoins') {
    const stableTotal = stablesRes?.total ?? stablesRes?.data?.total ?? cat.stablecoins?.tvl
    lines.push(`Total stablecoin supply: ${fmtB(stableTotal)}.`)
    lines.push(...sectorLines('Stablecoins', cat.stablecoins))
  } else if (topic === 'networks') {
    lines.push('Chains by RWA TVL:')
    for (const c of (data.chain_breakdown || []).slice(0, 10)) {
      lines.push(`- ${c.chain}: ${fmtB(c.tvl)} across ${c.count} assets`)
    }
  } else if (topic === 'platforms') {
    lines.push('Top RWA issuer platforms and linked protocols by TVL:')
    for (const p of (data.top_protocols || []).slice(0, 10)) {
      lines.push(`- ${p.name}${p.symbol ? ` (${p.symbol})` : ''}: ${fmtB(p.tvl)}, 7d ${pct(p.price_change_7d)}`)
    }
    lines.push(...sectorLines('Tokenized treasuries (largest issuer category)', cat.treasuries))
  } else {
    // treasuries / credit / commodities — the matching category block
    lines.push(...sectorLines(topic[0].toUpperCase() + topic.slice(1), cat[topic]))
  }
  if (data.narrative?.summary || data.narrative?.headline) {
    lines.push(`Current sector narrative: ${data.narrative.summary || data.narrative.headline}`)
  }

  if (trends?.length) {
    lines.push('', 'SECTOR AUM TREND (tokenized-asset categories, multi-window):')
    for (const t of trends) {
      lines.push(`- ${t.category}: ${fmtB(t.aum)} | 7d ${pct(t.d7)} | 30d ${pct(t.d30)} | 90d ${pct(t.d90)}`)
    }
  }

  lines.push('', `DEVELOPMENTS (tokenized-asset headlines, last ${NEWS_WINDOW_DAYS} days, newest first):`)
  if (developments.length) {
    for (const n of developments) lines.push(`- ${n.date} (${n.source}): ${n.title}`)
  } else {
    lines.push('- (none returned by the news feed for this window)')
  }

  return lines.join('\n')
}

async function buildProtocolContext(slug) {
  // DeFiLlama single-protocol endpoint — small payload, same slugs the app uses.
  let p = null
  try {
    const r = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10000) })
    if (r.ok) p = await r.json()
  } catch { /* fall through */ }
  const overviewRes = await boxGet('/v1/rwa/overview')
  const lines = []
  if (p && !p.statusCode) {
    const chainTvls = p.currentChainTvls || {}
    const total = Object.values(chainTvls).reduce((s, v) => s + (num(v) || 0), 0)
    lines.push(`Protocol: ${p.name} (${slug})`)
    lines.push(`Current TVL: ${fmtB(total)}`)
    const chains = Object.entries(chainTvls).sort((a, b) => b[1] - a[1]).slice(0, 6)
    if (chains.length) lines.push(`Chain exposure: ${chains.map(([c, v]) => `${c} ${fmtB(v)}`).join(', ')}`)
    if (p.description) lines.push(`Description: ${String(p.description).slice(0, 300)}`)
  } else {
    lines.push(`Protocol slug "${slug}" — live TVL detail unavailable right now; reason cautiously from the sector sheet below and say data is thin.`)
  }
  const data = overviewRes?.data
  if (data) {
    lines.push('', `RWA sector context: total TVL ${fmtB(data.total_rwa_tvl)}.`, 'Peer RWA-linked protocols by TVL:')
    for (const x of (data.top_protocols || []).slice(0, 8)) lines.push(`- ${x.name}: ${fmtB(x.tvl)}`)
  }
  return lines.join('\n')
}

// ── Generation ──────────────────────────────────────────────────────────────

export async function generateRwaAnalysis(topic, slug) {
  return generate(topic, slug)
}

async function generate(topic, slug) {
  const isProtocol = topic === 'protocol'
  const ctx = isProtocol ? await buildProtocolContext(slug) : await buildTopicContext(topic)
  if (!ctx) return null
  const today = new Date().toISOString().slice(0, 10)
  const userPrompt = isProtocol
    ? `Write a concise institutional analysis of the RWA protocol "${slug}" using the live data below. Cover TVL trajectory, chain exposure, and peer comparison.\n\n${ctx}`
    : `Today: ${today}. Write TODAY'S Daily Edition article on the RWA ${topic} category using the live data below. Weave three threads: (1) what moved in ${topic} today, read against the 7d/30d/90d trend on the sheet, (2) the notable tokenized-asset developments of the last two weeks from the DEVELOPMENTS list, each one dated, (3) the general crypto + macro frame. Call out distribution changes, inflow/outflow drivers, issuer concentration shifts, and peg anomalies where relevant. Do not claim the news was quiet while the DEVELOPMENTS list has entries.\n\n${ctx}`

  const r = await chat({
    messages: [
      { role: 'system', content: isProtocol ? PROTOCOL_SYSTEM_PROMPT : SUBPAGE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    tier: 'smart',
    maxTokens: 1200,
    temperature: 0.25,
    timeoutMs: 30_000,
    chain: CHAIN,
  })
  if (!r.ok || !r.text) return null
  const now = new Date().toISOString()
  const displayTopic = isProtocol ? slug : topic
  return {
    slug: isProtocol ? `protocol-${slug}` : topic,
    topic: isProtocol ? 'protocol' : topic,
    article: r.text.trim(),
    headline: isProtocol ? `${slug} RWA Analysis` : `RWA ${displayTopic} Analysis`,
    summary: r.text.replace(/[#*]/g, '').slice(0, 200).trim(),
    ogImage: null,
    publishedAt: now,
    lastUpdated: now,
    provider: r.provider,
    model: r.model,
    // Which providers the gateway actually CONSIDERED. A provider with no key
    // is filtered out before any request, so it leaves no trace in the logs —
    // which cost a round of log-spelunking to work out that Gemini was absent
    // from prod rather than failing there. Names only, never key material.
    tried: r.tried,
  }
}

const shape = (doc, stale) => ({ ...doc, stale })

const pending = (topic, slug) => ({
  slug: topic === 'protocol' ? `protocol-${slug}` : topic,
  topic,
  article: null,
  headline: null,
  summary: null,
  ogImage: null,
  publishedAt: null,
  lastUpdated: null,
  stale: true,
  message: 'Analysis being generated',
})

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const protoSlug = String(req.query.protocol || '').trim()
  const topic = protoSlug ? 'protocol' : String(req.query.topic || '').trim().toLowerCase()
  if (topic === 'protocol') {
    if (!protoSlug || !/^[a-z0-9-]{1,80}$/i.test(protoSlug)) return res.status(400).json({ error: 'Bad protocol slug' })
  } else if (!TOPICS.has(topic)) {
    return res.status(400).json({ error: `Unknown topic. Must be one of: ${[...TOPICS].join(', ')}` })
  }

  // Same gate the data-api routes enforce — this surface was gated before.
  // The warm-cache cron carries no cookie, so its UA is accepted like
  // warm-cache itself accepts Vercel's cron UA. Spoofable, but the payoff for
  // a spoofer is reading public-grade market prose from KV — generation is
  // locked + 23h-cached + rate-limited, so the LLM spend is bounded either way.
  const isCronWarm = req.headers['x-vercel-cron'] === '1'
    || String(req.headers['user-agent'] || '').startsWith('vercel-cron/')
    || req.headers['user-agent'] === 'Vercel-Cron-Warmer'
  if (!isCronWarm) {
    const userId = await verifyPrivyToken(req)
    if (!userId && !isAuthGateValid(req)) {
      return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
    }
  }
  // A response only this gate allowed must not land in a SHARED cache — the
  // edge keys on the URL alone, so a warm entry would answer the next
  // anonymous caller without the gate running. See _lib/gate-cache.js.
  sealGatedResponse(res)
  if (await rateLimit(req, res, { bucket: 'rwa-analysis', max: 30, windowMs: 60_000 })) return

  const storeKey = topic === 'protocol' ? `protocol-${protoSlug}` : topic
  const FRESH_KEY = `rwa-analysis:v2:${storeKey}`
  const LAST_KEY = `rwa-analysis:last:${storeKey}`
  const LOCK_KEY = `rwa-analysis:gen:${storeKey}`

  try {
    const fresh = await getJsonWithTTL(FRESH_KEY)
    if (fresh?.article) {
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
      return res.status(200).json(shape(fresh, false))
    }

    const lock = await getJsonWithTTL(LOCK_KEY)
    if (lock) {
      const last = await getJsonWithTTL(LAST_KEY).catch(() => null)
      if (last?.article) return res.status(200).json(shape(last, true))
      return res.status(202).json(pending(topic, protoSlug))
    }
    await setJsonWithTTL(LOCK_KEY, { ts: Date.now() }, LOCK_TTL_S)

    const doc = await generate(topic, protoSlug)
    if (!doc) {
      const last = await getJsonWithTTL(LAST_KEY).catch(() => null)
      if (last?.article) return res.status(200).json(shape(last, true))
      return res.status(202).json(pending(topic, protoSlug))
    }
    await setJsonWithTTL(FRESH_KEY, doc, FRESH_TTL_S)
    await setJsonWithTTL(LAST_KEY, doc, LAST_TTL_S)
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
    return res.status(200).json(shape(doc, false))
  } catch (err) {
    console.error('[rwa-analysis]', err.message)
    const last = await getJsonWithTTL(LAST_KEY).catch(() => null)
    if (last?.article) return res.status(200).json(shape(last, true))
    return res.status(502).json({ error: 'Failed to generate analysis' })
  }
}
