/**
 * Brain Desk CORE — the ONE shared brain between the dev loop generator
 * (api/_desk-gen.mjs) and the prod serverless handler (_lib/handlers/brain-desk.js).
 *
 * Owns: the SYSTEM prompt, gather() (domains + live prices + scorecard + unit
 * hygiene), buildContext() (per-domain char budgets — graded track record /
 * scorecard / prices first and never truncated), sanitizeOutput() (trade-read
 * schema: strict bull|bear, invalidation, horizon), the outcome ledger row
 * shape, and gradeLedger() (4h/24h/7d checkpoint self-grading, grader-v2 hit
 * convention: signed pnl >= +0.5%).
 *
 * Entry points supply their own fetchJson(path) (env/base/timeout) and their
 * own ledger persistence (dev JSONL, prod KV) — everything else lives here.
 */
import { createHash } from 'node:crypto'

export const arr = (v) => (Array.isArray(v) ? v : [])
const itemsOf = (v) => (v && Array.isArray(v.items) ? v.items : v)
const str = (v, n = 240) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const list = (v, n, len = 180) => arr(v).map((x) => str(x, len)).filter(Boolean).slice(0, n)

// Symbol normalizer: '$sol' → 'SOL'; narrative names (spaces etc) → null.
export function normSym(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/^\$/, '').toUpperCase()
  return /^[A-Z0-9][A-Z0-9_\-.]{0,19}$/.test(s) ? s : null
}

// ── Unit hygiene ─────────────────────────────────────────────────────────────
// Whale/ETF/flow entries with implausible magnitudes (the "$250B ETH outflow"
// class of unit error) are dropped BEFORE they reach the LLM.
const FLOW_USD_MAX = 2e9 // single flow > $2B = suspect
const UNIT_MAX = { ETH: 500_000, BTC: 50_000 } // single movement caps

function suspectFlow(it) {
  if (!it || typeof it !== 'object') return false
  for (const [k, v] of Object.entries(it)) {
    if (typeof v === 'number' && Number.isFinite(v) && /usd|value|flow/i.test(k) && Math.abs(v) > FLOW_USD_MAX) return true
  }
  const sym = String(it.asset || it.symbol || '').toUpperCase()
  const amt = Number(it.amount ?? it.qty)
  if (Number.isFinite(amt) && UNIT_MAX[sym] && Math.abs(amt) > UNIT_MAX[sym]) return true
  return false
}

function sanitizeFlows(items, dropped) {
  const rows = arr(itemsOf(items))
  const kept = rows.filter((it) => {
    const bad = suspectFlow(it)
    if (bad) dropped.count++
    return !bad
  })
  return kept
}

// Flow garbage also arrives as TEXT inside /v1/brain/signals rows
// ("ETH outflow of 68913077.3 on Kraken" = 68.9M ETH ≈ $250B, a unit error).
// Applied only to flow/whale/exchange-typed signals so legit macro figures
// ("$3.5T total market cap") don't trip it.
const MULT = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }
function suspectFlowText(text) {
  if (!text) return false
  for (const m of text.matchAll(/\$\s?([\d][\d,]*(?:\.\d+)?)\s*(k|m|bn?|t|thousand|million|billion|trillion)?\b/gi)) {
    const mult = MULT[(m[2] || '').charAt(0).toLowerCase()] || 1
    if (parseFloat(m[1].replace(/,/g, '')) * mult > FLOW_USD_MAX) return true
  }
  for (const m of text.matchAll(/\b(ETH|BTC)\b[^$\d]{0,24}([\d][\d,]*(?:\.\d+)?)|([\d][\d,]*(?:\.\d+)?)\s*(ETH|BTC)\b/gi)) {
    const sym = (m[1] || m[4] || '').toUpperCase()
    const n = parseFloat((m[2] || m[3] || '').replace(/,/g, ''))
    if (UNIT_MAX[sym] && Number.isFinite(n) && n > UNIT_MAX[sym]) return true
  }
  return false
}

// ── Gather ───────────────────────────────────────────────────────────────────
// fetchJson(path) → parsed `data` or null (caller owns base/headers/timeout).
export async function gather(fetchJson) {
  const [signals, thesis, deriv, macro, unlocks, etf, whales, dashboard, narratives, momentum, majors, scorecard] = await Promise.all([
    fetchJson('/v1/brain/signals?severity=critical,high,medium&hours=24&limit=45'),
    fetchJson('/v1/social/thesis?scope=combined'),
    fetchJson('/v1/brain/awareness/derivatives?limit=12'),
    fetchJson('/v1/brain/awareness/macro_confluence'),
    fetchJson('/v1/brain/awareness/unlocks?days=10'),
    fetchJson('/v1/brain/awareness/etf_flows'),
    fetchJson('/v1/brain/awareness/whales?limit=12'),
    fetchJson('/v1/brain/dashboard'),
    fetchJson('/v1/brain/narratives'),
    fetchJson('/v1/brain/trenches/momentum?limit=40'),
    fetchJson('/v1/prices?symbols=BTC,ETH,SOL'),
    fetchJson('/v1/brain/grades-v2/scorecard'),
  ])
  const domains = [signals, thesis, deriv, macro, unlocks, etf, whales, dashboard, narratives, momentum]
  const nullDomains = domains.filter((v) => v == null).length
  const dropped = { count: 0 }

  const sigRaw = arr(signals?.data).length ? signals.data : arr(signals).length ? signals : arr(signals?.signals)
  const sig = sigRaw.filter((s) => {
    if (!/flow|whale|exchange/i.test(s?.signal_type || '')) return true
    const bad = suspectFlowText(`${s.title || ''} ${s.summary || ''}`)
    if (bad) dropped.count++
    return !bad
  })
  const momRows = arr(momentum?.rows || momentum)

  // Live prices: majors from /v1/prices + top momentum assets (already priced).
  const prices = {}
  for (const [sym, v] of Object.entries(majors && typeof majors === 'object' ? majors : {})) {
    if (v && Number.isFinite(v.price)) prices[sym.toUpperCase()] = { price: v.price, chg_24h_pct: v.change?.['24h'] ?? null, chg_7d_pct: v.change?.['7d'] ?? null }
  }
  for (const m of momRows.slice(0, 12)) {
    const s = normSym(m?.asset)
    if (s && !prices[s] && Number.isFinite(m.price_usd)) prices[s] = { price: m.price_usd, chg_24h_pct: m.pct_change_24h ?? null }
  }

  return {
    signals: sig.map((s) => ({ type: s.signal_type, sev: s.severity, sent: s.sentiment, assets: (s.assets || []).slice(0, 3), title: s.title, summary: s.summary })),
    thesis: thesis ? { market_thesis: thesis.market_thesis, convergence: thesis.convergence, smart_money: thesis.smart_money, sectors: thesis.sectors, blowups: thesis.blowups } : null,
    derivatives: itemsOf(deriv), macro: itemsOf(macro), unlocks: itemsOf(unlocks),
    etf_flows: sanitizeFlows(etf, dropped), whales: sanitizeFlows(whales, dropped),
    narratives: arr(narratives?.data || narratives).slice(0, 12),
    diffusion: momRows,
    track_record: dashboard ? { hit_rate: dashboard.hit_rate, lessons: dashboard.lessons_recent, narratives_hot: dashboard.narratives_hot_24h, macro_events: dashboard.macro_events_7d } : null,
    prices,
    scorecard: scorecard ? { window_days: scorecard.window_days, overall: scorecard.overall, by_horizon: scorecard.by_horizon } : null,
    meta: { null_domains: nullDomains, total_domains: domains.length, dropped_suspect_units: dropped.count },
  }
}

// Batch price fetcher: symbols[] → { SYM: price } via /v1/prices?symbols=…
export function makePriceFetcher(fetchJson) {
  return async (symbols) => {
    const uniq = [...new Set(arr(symbols).map(normSym).filter(Boolean))]
    if (!uniq.length) return {}
    const d = await fetchJson('/v1/prices?symbols=' + encodeURIComponent(uniq.join(',')))
    const map = {}
    for (const [k, v] of Object.entries(d && typeof d === 'object' ? d : {})) {
      if (v && Number.isFinite(v.price)) map[k.toUpperCase()] = v.price
    }
    return map
  }
}

// ── Prompt ───────────────────────────────────────────────────────────────────
export const SYSTEM = `You are the Spectre Brain — a market CONSCIOUSNESS. You do not just track crypto, you UNDERSTAND it. You absorb live signals across every domain, CONNECT them into meaning, and every call you make is graded against price — so you learn.

You are given (in this order):
- your_graded_track_record: YOUR OWN graded desk calls (hit-rate, avg pnl, last 10, bias note). Condition on it.
- macro_brain_scorecard: the wider brain's graded scorecard (831+ calls, hit-rate by horizon). Long horizons have been weak — respect that.
- prices: LIVE prices for majors + top momentum assets. Use these for levels — never invent a price.
- prior_read: what YOU concluded last cycle (your memory)
- fresh signals across domains: price, on-chain flows, leverage/derivatives, ETF/institutional, whales, social + narrative, unlocks, macro

Think first, then return ONLY JSON:
{
  "regime": "one grounded line — the state of the tape",
  "context": {
    "read": "1-2 sentences — your CURRENT understanding of WHY the market is where it is (not what moved, why)",
    "changed": ["what is NEW or shifted since your prior read"],
    "confirmed": ["prior reads that are now playing out"],
    "fading": ["what is losing conviction"]
  },
  "convergence": [
    {
      "asset": "TICKER or narrative name",
      "direction": "bull|bear — EXACTLY one of these two strings; anything else and the row is DISCARDED",
      "conviction": 0-100,
      "horizon": "4h|1d|1w — the window this call plays out in",
      "invalidation": "REQUIRED — a falsifiable price level or concrete condition that would prove this call WRONG (e.g. 'BTC loses $60k on a daily close' or 'funding flips negative while OI holds')",
      "lenses": ["Leverage","Onchain","Institutional","Degen","Macro"],
      "signals": ["the 3-6 independent, concrete, grounded signals that ALIGN here — each with its unit and what it means"],
      "why": "why this convergence matters NOW — the emergent read no single signal gives"
    }
  ],
  "intel": [ {"project":"TICKER","lens":"Onchain|Institutional|Leverage|Degen|Macro|Governance","category":"...","bias":"bull|bear|neutral","read":"what happened + what it means + the read"} ],
  "watching": ["what would CONFIRM or INVALIDATE your top convergences next — your memory hooks"],
  "brief": ["3-4 synthesized bullets: what's happening + why it matters"]
}

HARD RULES:
- CONVERGENCE IS THE POINT. A token moving is noise. A token moving WHILE social accelerates AND whales rotate AND leverage builds AND a narrative forms is a SETUP. Find those. A convergence REQUIRES >=2 independent lenses agreeing — never call convergence off one signal. 3-6 convergences, strongest first.
- CONVICTION RUBRIC: 80+ requires 3+ independent lenses EACH backed by a grounded figure; 60-79 requires 2 lenses; below 60 do not emit the row at all.
- Every convergence is a TRADE READ: it MUST carry a falsifiable invalidation and a horizon. No invalidation you'd actually act on = not a call.
- Never state a number without its unit and what it MEANS. If a figure looks like a raw/unitless dump or implies an implausible magnitude (a single flow > $2B, > 500k ETH, > 50k BTC), treat it as corrupted data and DO NOT cite it.
- Your graded track record is above — if it shows a bias (e.g. overcalling bull, missing at long horizons), correct for it and SAY SO in context.read. If hit-rate is low, be humble and cite a lesson. Do not overclaim.
- Use prior_read to build CONTINUITY. Explicitly say what confirmed, changed, faded. You have memory — act like it.
- Ground every $/%/multiple in the data. Merge related raw events. NO hedging words ("unclear","uncertain","without more context") — drop weak items.`

// ── Context builder — per-domain char budgets, priority-ordered ──────────────
// Graded track record / scorecard / prices come FIRST and are never truncated.
const NO_CAP = Infinity
const BUDGETS = [
  ['your_graded_track_record', NO_CAP],
  ['macro_brain_scorecard', NO_CAP],
  ['prices', NO_CAP],
  ['prior_read', 3000],
  ['signals', 9000],
  ['thesis', 4000],
  ['narratives', 2500],
  ['diffusion', 3000],
  ['derivatives', 2000],
  ['whales', 2500],
  ['etf_flows', 1500],
  ['unlocks', 1500],
  ['macro', 2000],
  ['track_record', 1200],
]
const TOTAL_MAX = 35000

export function buildContext(gathered, prior, outcomeSummary) {
  const src = {
    your_graded_track_record: outcomeSummary || { note: 'no graded desk calls yet — this is a young ledger, stay humble' },
    macro_brain_scorecard: gathered.scorecard,
    prices: gathered.prices,
    prior_read: prior,
    signals: gathered.signals,
    thesis: gathered.thesis,
    narratives: gathered.narratives,
    diffusion: gathered.diffusion,
    derivatives: gathered.derivatives,
    whales: gathered.whales,
    etf_flows: gathered.etf_flows,
    unlocks: gathered.unlocks,
    macro: gathered.macro,
    track_record: gathered.track_record,
  }
  const fit = {}
  for (const [key, cap] of BUDGETS) {
    const v = src[key]
    if (v == null || (Array.isArray(v) && !v.length)) continue
    const s = JSON.stringify(v)
    fit[key] = s.length <= cap ? v : s.slice(0, cap) + '…[truncated]'
  }
  let out = JSON.stringify(fit)
  // total guard: halve the largest truncatable domain until under budget
  let guard = 8
  while (out.length > TOTAL_MAX && guard-- > 0) {
    const shrinkable = BUDGETS.filter(([k, cap]) => cap !== NO_CAP && fit[k] != null)
      .sort((a, b) => JSON.stringify(fit[b[0]]).length - JSON.stringify(fit[a[0]]).length)
    if (!shrinkable.length) break
    const k = shrinkable[0][0]
    const cur = JSON.stringify(fit[k]).length
    fit[k] = JSON.stringify(src[k]).slice(0, Math.max(400, Math.floor(cur / 2))) + '…[truncated]'
    out = JSON.stringify(fit)
  }
  return out
}

// ── Output sanitizer — trade-read schema ─────────────────────────────────────
const LENS = new Set(['Onchain', 'Institutional', 'Leverage', 'Degen', 'Macro', 'Governance'])
const HORIZONS = new Set(['4h', '1d', '1w'])
const HEDGE = /unclear|uncertain|without more context|remains to be seen|impact is (unclear|uncertain)/i

export function sanitizeOutput(p) {
  const dropped = { bad_direction: 0, missing_invalidation: 0 }
  const convergence = []
  for (const c of arr(p.convergence)) {
    if (!c || !c.asset || arr(c.signals).length < 2) continue
    if (convergence.length >= 6) break
    // direction: STRICT bull|bear — anything else drops the row, never defaults
    const direction = c.direction === 'bull' || c.direction === 'bear' ? c.direction : null
    if (!direction) { dropped.bad_direction++; continue }
    const invalidation = str(c.invalidation, 220)
    if (!invalidation) dropped.missing_invalidation++
    convergence.push({
      asset: str(c.asset, 24),
      direction,
      conviction: Math.max(0, Math.min(100, Math.round(Number(c.conviction) || 0))),
      horizon: HORIZONS.has(c.horizon) ? c.horizon : '1d',
      invalidation,
      entry_price: null, // attached by attachEntryPrices after the LLM pass
      lenses: list(c.lenses, 5, 16).filter((l) => LENS.has(l)),
      signals: list(c.signals, 6, 160),
      why: str(c.why, 280),
    })
  }
  const out = {
    regime: str(p.regime, 200),
    context: p.context && typeof p.context === 'object' ? {
      read: str(p.context.read, 300),
      changed: list(p.context.changed, 4, 160),
      confirmed: list(p.context.confirmed, 4, 160),
      fading: list(p.context.fading, 4, 160),
    } : null,
    convergence,
    intel: arr(p.intel).filter((x) => x && x.read && !HEDGE.test(x.read)).slice(0, 22).map((x) => ({
      project: str(x.project, 22) || 'Market', lens: LENS.has(x.lens) ? x.lens : 'Signal',
      category: str(x.category, 28) || '', bias: ['bull', 'bear', 'neutral'].includes(x.bias) ? x.bias : 'neutral', read: str(x.read, 260),
    })),
    watching: list(p.watching, 5, 180),
    brief: list(p.brief, 4, 220),
  }
  return { out, dropped }
}

// ── Entry prices ─────────────────────────────────────────────────────────────
// Attach a live entry_price to each convergence row: first from the prices
// already gathered this cycle, then one batch fetch for the rest. Unresolvable
// (narratives etc) stays null — still ledgered.
export async function attachEntryPrices(convergence, priceFetcher, prices = {}) {
  const unresolved = []
  for (const c of arr(convergence)) {
    const s = normSym(c.asset)
    const known = s && prices[s] && Number.isFinite(prices[s].price) ? prices[s].price : null
    c.entry_price = known
    if (known == null && s) unresolved.push(s)
  }
  if (unresolved.length) {
    let fetched = {}
    try { fetched = await priceFetcher(unresolved) } catch { /* stays null */ }
    for (const c of arr(convergence)) {
      if (c.entry_price != null) continue
      const s = normSym(c.asset)
      if (s && Number.isFinite(fetched[s])) c.entry_price = fetched[s]
    }
  }
  return convergence
}

// ── Outcome ledger ───────────────────────────────────────────────────────────
export function toLedgerRows(convergence, ts = new Date().toISOString()) {
  return arr(convergence).map((c) => ({
    id: createHash('sha1').update(`${ts}|${c.asset}|${c.direction}`).digest('hex').slice(0, 12),
    ts,
    asset: c.asset,
    direction: c.direction,
    conviction: c.conviction,
    horizon: c.horizon,
    invalidation: c.invalidation,
    entry_price: c.entry_price ?? null,
    signals: c.signals,
  }))
}

// ── Self-grading — 4h/24h/7d checkpoints, grader-v2 hit convention ───────────
const CHECKPOINTS = [
  { key: 'graded_4h', ms: 4 * 3600_000 },
  { key: 'graded_24h', ms: 24 * 3600_000 },
  { key: 'graded_7d', ms: 7 * 24 * 3600_000 },
]
const HIT_PNL_PCT = 0.5

export async function gradeLedger(rows, priceFetcher) {
  const all = arr(rows)
  const now = Date.now()
  const due = all.filter((r) => {
    if (!r || !Number.isFinite(r.entry_price) || r.entry_price <= 0) return false
    const age = now - Date.parse(r.ts)
    return Number.isFinite(age) && CHECKPOINTS.some((c) => age >= c.ms && !r[c.key])
  })
  if (!due.length) return { rows: all, graded: 0 }
  let prices = {}
  try { prices = await priceFetcher(due.map((r) => r.asset)) } catch { /* grade next cycle */ }
  let graded = 0
  for (const r of due) {
    const sym = normSym(r.asset)
    const cur = sym ? prices[sym] : null
    if (!Number.isFinite(cur)) continue
    const age = now - Date.parse(r.ts)
    const raw = ((cur - r.entry_price) / r.entry_price) * 100
    const pnl = Math.round((r.direction === 'bear' ? -raw : raw) * 100) / 100
    for (const c of CHECKPOINTS) {
      if (age >= c.ms && !r[c.key]) {
        r[c.key] = { pnl_pct: pnl, hit: pnl >= HIT_PNL_PCT, at: new Date(now).toISOString() }
        graded++
      }
    }
  }
  return { rows: all, graded }
}

// The desk's own graded record, injected FIRST into every context.
export function buildOutcomeSummary(rows) {
  const graded = arr(rows).filter((r) => r && (r.graded_4h || r.graded_24h || r.graded_7d))
  if (!graded.length) return null
  const g24 = graded.filter((r) => r.graded_24h)
  const hits24 = g24.filter((r) => r.graded_24h.hit).length
  const pick = (r) => r.graded_24h || r.graded_4h || r.graded_7d
  const last10 = graded.slice(-10).map((r) => {
    const g = pick(r)
    return { asset: r.asset, direction: r.direction, conviction: r.conviction, horizon: r.horizon, pnl_pct: g.pnl_pct, hit: g.hit }
  })
  const bulls = last10.filter((x) => x.direction === 'bull')
  const bullHits = bulls.filter((x) => x.hit).length
  return {
    n_graded: graded.length,
    hit_rate_24h: g24.length ? Math.round((hits24 / g24.length) * 100) : null,
    avg_pnl_24h: g24.length ? Math.round((g24.reduce((s, r) => s + r.graded_24h.pnl_pct, 0) / g24.length) * 100) / 100 : null,
    last_10: last10,
    bias_note: `bull calls ${bulls.length}/${last10.length}${bulls.length ? `, hit ${bullHits}/${bulls.length}` : ''}`,
  }
}

// Shared prior shape (memory for the next cycle).
export function toPrior(out) {
  return {
    regime: out.regime,
    context: out.context,
    convergence: arr(out.convergence).map((c) => ({ asset: c.asset, direction: c.direction, why: c.why })),
    watching: out.watching,
  }
}
