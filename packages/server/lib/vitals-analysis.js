/**
 * vitals-analysis.js — Gemini-powered AI read for the VITALS platform-fundamentals
 * feature (single platform + head-to-head compare).
 *
 * House pattern (mirrors apps/research/api/_lib/handlers/sentiment-read.js and
 * packages/server/routes/trending-brief.js): build a COMPACT, grounded facts
 * object server-side from vitals-core's real fields, hand it to the model as a
 * readable sheet, ask for strict JSON, then enforce honesty MECHANICALLY —
 * never trust the prompt alone.
 *
 * CJS on purpose: consumed by the Express dev server (CJS) directly, and by the
 * Vercel ESM handler via createRequire, so dev and prod cannot drift.
 *
 * This is a finance product. A fabricated number is the worst possible failure,
 * so every generation passes through two independent gates before it can reach
 * a reader:
 *   1. sanitize()   — structural: allowlist fields, clamp lengths, coerce the
 *                      verdict enum, cap array sizes. Modelled on sanitizeRead()
 *                      in sentiment-read.js.
 *   2. scrubLeaks()  — numeric: every `$`-figure and every `N%` figure written
 *                      by the model must match (or closely round to) a number
 *                      we actually put on the sheet. A sentence carrying an
 *                      unverifiable figure is dropped; the field is dropped
 *                      entirely only if nothing survives. Modelled on
 *                      scrubNumbers() in trending-brief.js.
 * A failed generation — no key, upstream down, JSON that won't parse, a read
 * that fails sanitize — never throws and never surfaces as an error string.
 * It returns null and the caller decides what to render.
 */

'use strict'

const { chat } = require('./llm-gateway')
const vitalsCore = require('./vitals-core')

const ANALYSIS_VERSION = 'vitals-analysis.v1'

// Gemini-first, free lane, same approach as trending-brief.js's BRIEF_CHAIN —
// the rest of the chain is the resilience ladder if Gemini is down/429s.
const ANALYSIS_CHAIN = ['gemini', 'cerebras', 'openrouter', 'groq', 'openai', 'anthropic', 'ollama']

// ---------------------------------------------------------------------------
// tiny formatters (mirrors sentiment-read.js's num/fmtUsd/fmt)
// ---------------------------------------------------------------------------

const num = (v) => (Number.isFinite(v) ? v : null)

function fmtUsd(v) {
  if (v == null) return 'n/a'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(2)}`
}

function fmtPct(v, digits = 1) {
  return v == null ? 'n/a' : `${v.toFixed(digits)}%`
}

// ---------------------------------------------------------------------------
// compact facts — analysePlatform
// ---------------------------------------------------------------------------

/**
 * A few-hundred-token grounded facts object built from getPlatform()'s real
 * shape (packages/server/lib/vitals-core.js). Never the whole payload.
 */
function buildPlatformFacts(data) {
  const p = data.platform || {}
  const peers = data.peers || { rank: null, of: null, rows: [] }
  const topPeers = (peers.rows || [])
    .filter((r) => r && r.slug !== p.slug)
    .slice(0, 3)
    .map((r) => ({ name: r.name, fees30d: num(r.fees30d) }))

  const users = p.users
    ? {
      scope: 'first_hand',
      note: 'counted directly from Hyperliquid builder-code fills — perps venue only, not a total user count for a spot-first app',
      dau: num(p.users.dau),
      arpu: num(p.users.arpu),
    }
    : { scope: 'unavailable', note: 'no first-hand user/trader data collected for this platform', dau: null, arpu: null }

  return {
    slug: p.slug,
    name: p.name,
    category: p.category || null,
    chains: Array.isArray(p.chains) ? p.chains.slice(0, 6) : [],
    fees: { d1: num(p.fees?.d1), d30: num(p.fees?.d30), ann: num(p.fees?.ann) },
    revenue: { d30: num(p.revenue?.d30), ann: num(p.revenue?.ann) },
    takeRate: num(p.takeRate),
    feeGrowth7dPct: num(p.fees?.chg7d),
    feeGrowth30dPct: num(p.fees?.chg30d),
    dexVolume30d: num(p.dexVolume?.d30),
    perpVolume24h: num(p.perpVolume?.d1),
    tvl: num(p.tvl?.now),
    peerRank: peers.rank ?? null,
    peerCount: peers.of ?? null,
    topPeers,
    firstHandCoveragePct: num(data.firstHandCoverage?.revenueSharePct),
    users,
  }
}

function buildPlatformUserContent(f) {
  const lines = [
    `PLATFORM: ${f.name} (${f.slug}) — category: ${f.category || 'n/a'}${f.chains.length ? ` — chains: ${f.chains.join(', ')}` : ''}`,
    '',
    'FEES:',
    `  24h ${fmtUsd(f.fees.d1)} · 30d ${fmtUsd(f.fees.d30)} · annualized ${fmtUsd(f.fees.ann)}`,
    `  fee growth: 7d ${fmtPct(f.feeGrowth7dPct)} · 30d ${fmtPct(f.feeGrowth30dPct)} (each vs its own prior matching window)`,
    '',
    'REVENUE (kept by the protocol, not gross fees):',
    `  30d ${fmtUsd(f.revenue.d30)} · annualized ${fmtUsd(f.revenue.ann)}`,
    `  take rate (revenue ÷ fees): ${fmtPct(f.takeRate)}`,
    '',
    'VOLUME:',
    `  30d spot/DEX volume: ${fmtUsd(f.dexVolume30d)}`,
    `  24h perp volume: ${fmtUsd(f.perpVolume24h)}`,
    '',
    `TVL (value locked, now): ${fmtUsd(f.tvl)}`,
    '',
    'PEERS (same category, ranked by 30d fees):',
    f.peerRank != null ? `  this platform ranks #${f.peerRank} of ${f.peerCount}` : '  rank n/a',
    f.topPeers.length
      ? `  top peers: ${f.topPeers.map((p) => `${p.name} (${fmtUsd(p.fees30d)}/30d fees)`).join(', ')}`
      : '  no peer data available',
    '',
    'USERS / TRADERS:',
    f.users.scope === 'first_hand'
      ? `  first-hand daily traders: ${f.users.dau ?? 'n/a'} · revenue per trader: ${fmtUsd(f.users.arpu)} — ${f.users.note}`
      : `  n/a — ${f.users.note}`,
    f.firstHandCoveragePct != null
      ? `  first-hand coverage: our own collector directly measures ${fmtPct(f.firstHandCoveragePct)} of this platform's revenue; the rest is broader aggregate data, not counted first-hand`
      : null,
  ]
  return lines.filter((l) => l !== null).join('\n')
}

function collectAllowedNumbersPlatform(f) {
  const usd = []
  const pct = []
  const pushUsd = (v) => { if (Number.isFinite(v)) usd.push(v) }
  const pushPct = (v) => { if (Number.isFinite(v)) pct.push(v) }
  pushUsd(f.fees.d1); pushUsd(f.fees.d30); pushUsd(f.fees.ann)
  pushUsd(f.revenue.d30); pushUsd(f.revenue.ann)
  pushUsd(f.dexVolume30d); pushUsd(f.perpVolume24h); pushUsd(f.tvl)
  pushPct(f.takeRate); pushPct(f.feeGrowth7dPct); pushPct(f.feeGrowth30dPct)
  pushPct(f.firstHandCoveragePct)
  for (const peer of f.topPeers) pushUsd(peer.fees30d)
  return { usd, pct }
}

// ---------------------------------------------------------------------------
// compact facts — analyseCompare
// ---------------------------------------------------------------------------

function buildCompareFacts(data) {
  const platforms = (data.columns || []).map((c) => ({ slug: c.slug, name: c.name, category: c.category }))
  const rows = (data.rows || []).map((r) => ({
    key: r.key, label: r.label, hint: r.hint, kind: r.kind, values: r.values || {}, best: r.best || null,
  }))

  // Indexed-series endpoints (base 100) — first and last real reading per
  // platform, so the model can talk trajectory without seeing the raw series.
  const seriesEndpoints = {}
  for (const key of ['fees', 'revenue', 'dexVolume']) {
    const s = data.series?.[key]
    const idx = s?.indexed
    if (!idx || !idx.values) continue
    const perSlug = {}
    for (const [slug, vals] of Object.entries(idx.values)) {
      const finite = (Array.isArray(vals) ? vals : []).filter((v) => Number.isFinite(v))
      if (!finite.length) continue
      perSlug[slug] = { first: finite[0], last: finite[finite.length - 1] }
    }
    if (Object.keys(perSlug).length) seriesEndpoints[key] = perSlug
  }

  return { platforms, rows, seriesEndpoints }
}

function buildCompareUserContent(f) {
  const nameOf = (slug) => f.platforms.find((p) => p.slug === slug)?.name || slug
  const fmtByKind = (kind, v) => {
    if (v == null || !Number.isFinite(v)) return 'n/a'
    if (kind === 'usd') return fmtUsd(v)
    if (kind === 'pct' || kind === 'chg') return fmtPct(v)
    if (kind === 'mult') return `${v.toFixed(2)}x`
    if (kind === 'count') return String(Math.round(v))
    return String(v)
  }

  const lines = [
    `COMPARING: ${f.platforms.map((p) => `${p.name} (${p.slug})`).join(' vs ')}`,
    '',
    'METRICS (value per platform on each row, and who has the best value):',
    ...f.rows.map((r) => {
      const vals = f.platforms.map((p) => `${p.name}: ${fmtByKind(r.kind, r.values[p.slug])}`).join(' · ')
      return `  ${r.label}${r.hint ? ` (${r.hint})` : ''} — ${vals}${r.best ? ` — best: ${nameOf(r.best)}` : ''}`
    }),
  ]

  const seriesKeys = Object.keys(f.seriesEndpoints)
  if (seriesKeys.length) {
    lines.push('', "TRAJECTORY (indexed to 100 at each platform's own start of window — compares SHAPE, not scale; different platforms can start on different dates):")
    for (const key of seriesKeys) {
      const parts = Object.entries(f.seriesEndpoints[key]).map(([slug, ep]) => {
        const growth = (Number.isFinite(ep.first) && ep.first !== 0)
          ? `${(((ep.last - ep.first) / ep.first) * 100).toFixed(1)}%` : 'n/a'
        return `${nameOf(slug)}: index ${ep.first.toFixed(0)} → ${ep.last.toFixed(0)} (${growth} change over the window)`
      }).join(' · ')
      lines.push(`  ${key}: ${parts}`)
    }
  }

  return lines.join('\n')
}

function collectAllowedNumbersCompare(f) {
  const usd = []
  const pct = []
  for (const row of f.rows) {
    const vals = Object.values(row.values || {}).filter((v) => Number.isFinite(v))
    if (row.kind === 'usd') usd.push(...vals)
    else if (row.kind === 'pct' || row.kind === 'chg') pct.push(...vals)
  }
  for (const key of Object.keys(f.seriesEndpoints)) {
    for (const ep of Object.values(f.seriesEndpoints[key])) {
      if (Number.isFinite(ep.first) && ep.first !== 0 && Number.isFinite(ep.last)) {
        pct.push(((ep.last - ep.first) / ep.first) * 100)
      }
    }
  }
  return { usd, pct }
}

// ---------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------

const HONESTY_RULES = `HARD RULES — this is a finance product, a fabricated number is the worst possible failure:
- Use ONLY the numbers given on the sheet below. NEVER invent, estimate, or infer a figure that is not explicitly on the sheet.
- If a metric on the sheet says n/a or "unavailable", say it is not available — do not guess a number to fill the gap.
- Every dollar figure or percentage you write MUST match a number on the sheet (or a rounding of it). Never compute or cite a derived figure the sheet doesn't already contain.
- NEVER predict future prices, token prices, or market moves.
- NEVER give investment advice ("buy", "sell", "a good entry/exit", "should you").
- Distinguish first-hand data (counted directly by Spectre) from broader/aggregate data when the sheet marks the difference — never blur the two.
- Voice: dry, precise, investor-to-investor. No hype, no exclamation marks, no emojis, no "game-changer"/"explosive"/"moon" language.`

const PLATFORM_SYSTEM_PROMPT = `You are a senior analyst at Spectre's research desk writing a short, sharp read on ONE crypto platform's business fundamentals — fees, revenue, growth, take rate, TVL, and trader activity.

${HONESTY_RULES}

Respond with STRICT JSON only, no markdown fences:
{
  "headline": "string, <=90 chars, plain and specific",
  "read": "string, 2-4 sentences — the core interpretation",
  "strengths": ["max 3 short strings, each grounded in a number on the sheet"],
  "risks": ["max 3 short strings, each grounded in a number on the sheet"],
  "verdict": "earning" | "growing" | "fading" | "speculative" | "unclear"
}`

const COMPARE_SYSTEM_PROMPT = `You are a senior analyst at Spectre's research desk comparing several crypto platforms head-to-head on fees, revenue, growth, take rate, TVL, and trajectory.

${HONESTY_RULES}
- Different metrics can have different winners — say so explicitly rather than declaring one platform better on everything.

Respond with STRICT JSON only, no markdown fences:
{
  "headline": "string, <=90 chars, plain and specific",
  "read": "string, 2-4 sentences — the core interpretation of how these platforms compare",
  "strengths": ["max 3 short strings"],
  "risks": ["max 3 short strings"],
  "verdict": "earning" | "growing" | "fading" | "speculative" | "unclear",
  "winner": "the slug of the platform that looks strongest OVERALL, or null if it's genuinely mixed",
  "byDimension": [{ "dimension": "short label e.g. 'Fees'", "slug": "the winning platform's slug", "why": "short reason, <=1 sentence" }] max 4 entries, covering the metrics where the winner differs by dimension
}`

// ---------------------------------------------------------------------------
// mechanical honesty enforcement
// ---------------------------------------------------------------------------

const VERDICTS = new Set(['earning', 'growing', 'fading', 'speculative', 'unclear'])

function str(v, max) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function arr(v, maxItems, maxLen) {
  return Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []
}

/**
 * Structural gate — modelled on sanitizeRead() in
 * apps/research/api/_lib/handlers/sentiment-read.js. Allowlists every field,
 * clamps lengths, coerces the verdict against a Set, caps array sizes, and
 * HARD-REJECTS (returns null) when `headline` or `read` is missing.
 */
function sanitize(raw, { compare = false } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const headline = str(raw.headline, 90)
  const read = str(raw.read, 900)
  if (!headline || !read) return null

  const out = {
    headline,
    read,
    strengths: arr(raw.strengths, 3, 140),
    risks: arr(raw.risks, 3, 140),
    verdict: VERDICTS.has(raw.verdict) ? raw.verdict : 'unclear',
  }

  if (compare) {
    out.winner = (typeof raw.winner === 'string' && raw.winner.trim()) ? raw.winner.trim().toLowerCase().slice(0, 60) : null
    out.byDimension = Array.isArray(raw.byDimension)
      ? raw.byDimension.map((d) => {
        if (!d || typeof d !== 'object') return null
        const dimension = str(d.dimension, 60)
        const slug = (typeof d.slug === 'string' && d.slug.trim()) ? d.slug.trim().toLowerCase().slice(0, 60) : null
        const why = str(d.why, 200)
        if (!dimension || !slug || !why) return null
        return { dimension, slug, why }
      }).filter(Boolean).slice(0, 4)
      : []
  }

  return out
}

// Extraction regexes for the leak guard — every "$"-figure and every "N%"
// figure a model could write.
const USD_MATCH_RE = /\$\s?-?\d[\d,]*(?:\.\d+)?\s?(?:[BMK]\b|billion|million|thousand)?/gi
const PCT_MATCH_RE = /[+-]?\d[\d,]*(?:\.\d+)?\s?%/g

function parseUsdAmount(raw) {
  const cleaned = raw.replace(/\$/g, '').trim()
  const suffixMatch = cleaned.match(/(billion|million|thousand|[BMK])$/i)
  let numPart = cleaned
  let mult = 1
  if (suffixMatch) {
    numPart = cleaned.slice(0, cleaned.length - suffixMatch[0].length).trim()
    const s = suffixMatch[0].toLowerCase()
    mult = s.startsWith('b') ? 1e9 : s.startsWith('m') ? 1e6 : 1e3
  }
  const n = parseFloat(numPart.replace(/,/g, ''))
  return Number.isFinite(n) ? n * mult : null
}

function parsePctAmount(raw) {
  const n = parseFloat(raw.replace(/%/g, '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function closeEnough(a, b, relTol, absTol = 0) {
  const diff = Math.abs(a - b)
  if (diff <= absTol) return true
  const scale = Math.max(Math.abs(a), Math.abs(b), 1)
  return diff / scale <= relTol
}

function sentenceVerifies(sentence, allowed) {
  const usdHits = sentence.match(USD_MATCH_RE) || []
  for (const raw of usdHits) {
    const val = parseUsdAmount(raw)
    if (val == null) continue
    if (!allowed.usd.some((v) => closeEnough(val, v, 0.05))) return false
  }
  const pctHits = sentence.match(PCT_MATCH_RE) || []
  for (const raw of pctHits) {
    const val = parsePctAmount(raw)
    if (val == null) continue
    if (!allowed.pct.some((v) => closeEnough(val, v, 0.05, 1))) return false
  }
  return true
}

/**
 * Number-leak guard — modelled on scrubNumbers() in
 * packages/server/routes/trending-brief.js. Extracts every $-figure and every
 * N% figure from the generated prose and verifies each one against the real
 * facts we passed in. Drops any SENTENCE carrying an unverifiable figure
 * (same sentence-boundary split trending-brief uses); the field is dropped
 * entirely (null) only if nothing survives.
 */
function scrubLeaks(text, allowed) {
  if (typeof text !== 'string' || !text) return text
  const sentences = text.split(/(?<=[.!?])\s+/)
  const kept = sentences.filter((s) => sentenceVerifies(s, allowed))
  const joined = kept.join(' ').trim()
  return joined || null
}

function parseJsonLoose(text) {
  try { return JSON.parse(text) } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* give up */ } }
  return null
}

/**
 * Run both gates. Returns null (never throws, never surfaces an error) if
 * the structural sanitize fails, or if scrubbing leaves headline/read empty.
 */
function finalizeAnalysis(rawText, allowed, { compare = false, knownSlugs = null } = {}) {
  const parsed = parseJsonLoose(rawText)
  const clean = sanitize(parsed, { compare })
  if (!clean) return null

  clean.headline = scrubLeaks(clean.headline, allowed)
  clean.read = scrubLeaks(clean.read, allowed)
  clean.strengths = clean.strengths.map((s) => scrubLeaks(s, allowed)).filter(Boolean)
  clean.risks = clean.risks.map((s) => scrubLeaks(s, allowed)).filter(Boolean)

  if (compare) {
    if (clean.winner && knownSlugs && !knownSlugs.has(clean.winner)) clean.winner = null
    clean.byDimension = clean.byDimension
      .map((d) => ({ ...d, why: scrubLeaks(d.why, allowed) }))
      .filter((d) => d.why && (!knownSlugs || knownSlugs.has(d.slug)))
  }

  if (!clean.headline || !clean.read) return null
  return clean
}

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

/**
 * AI read for one platform. Returns null when the platform doesn't exist, no
 * LLM provider is available, or the generation fails the honesty gates —
 * never throws.
 */
async function analysePlatform(slug) {
  try {
    const data = await vitalsCore.getPlatform(slug)
    if (!data) return null

    const facts = buildPlatformFacts(data)
    const allowed = collectAllowedNumbersPlatform(facts)

    const r = await chat({
      messages: [
        { role: 'system', content: PLATFORM_SYSTEM_PROMPT },
        { role: 'user', content: buildPlatformUserContent(facts) },
      ],
      tier: 'smart',
      json: true,
      chain: ANALYSIS_CHAIN,
      maxTokens: 1800,
      temperature: 0.35,
      timeoutMs: 30_000,
    })
    if (!r.ok || !r.text) return null

    const clean = finalizeAnalysis(r.text, allowed, { compare: false })
    if (!clean) return null

    return {
      ...clean,
      slug: facts.slug,
      provider: r.provider,
      model: r.model,
      generatedAt: new Date().toISOString(),
      version: ANALYSIS_VERSION,
    }
  } catch (err) {
    console.error('[vitals-analysis] analysePlatform', slug, err && err.message ? err.message : err)
    return null
  }
}

/**
 * AI read comparing two-to-four platforms. Returns null on any failure
 * (fewer than two platforms resolve, no LLM provider, honesty gates fail) —
 * never throws.
 */
async function analyseCompare(slugs) {
  try {
    const data = await vitalsCore.getCompare(slugs)
    if (!data || !Array.isArray(data.columns) || data.columns.length < 2) return null

    const facts = buildCompareFacts(data)
    const allowed = collectAllowedNumbersCompare(facts)
    const knownSlugs = new Set(facts.platforms.map((p) => p.slug))

    const r = await chat({
      messages: [
        { role: 'system', content: COMPARE_SYSTEM_PROMPT },
        { role: 'user', content: buildCompareUserContent(facts) },
      ],
      tier: 'smart',
      json: true,
      chain: ANALYSIS_CHAIN,
      maxTokens: 1800,
      temperature: 0.35,
      timeoutMs: 30_000,
    })
    if (!r.ok || !r.text) return null

    const clean = finalizeAnalysis(r.text, allowed, { compare: true, knownSlugs })
    if (!clean) return null

    return {
      ...clean,
      slugs: facts.platforms.map((p) => p.slug),
      provider: r.provider,
      model: r.model,
      generatedAt: new Date().toISOString(),
      version: ANALYSIS_VERSION,
    }
  } catch (err) {
    console.error('[vitals-analysis] analyseCompare', slugs, err && err.message ? err.message : err)
    return null
  }
}

module.exports = { analysePlatform, analyseCompare, ANALYSIS_VERSION }
