/**
 * Brain Desk — the market CONSCIOUSNESS layer (not a summarizer).
 *
 * Thin prod entry over _lib/desk-core.js (the ONE shared brain — the dev loop
 * generator api/_desk-gen.mjs consumes the same core; no prompt drift). Each
 * cycle: grade past calls in the KV ledger vs live prices (4h/24h/7d), read
 * the PRIOR read (KV memory), gather domains + live prices + the grades-v2
 * scorecard, one LLM call under per-domain context budgets, sanitize to the
 * strict trade-read schema (bull|bear only, invalidation, horizon), attach
 * live entry prices, persist every call to the ledger. Cached in KV.
 * Served via /api/intel-api?fn=brain-desk.
 */
import { chat } from '../llm-gateway.js'
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { gather, buildContext, sanitizeOutput, gradeLedger, buildOutcomeSummary, attachEntryPrices, toLedgerRows, makePriceFetcher, toPrior, SYSTEM } from '../desk-core.js'

const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const HEADERS = { Accept: 'application/json', ...(process.env.SPECTRE_API_KEY ? { 'X-API-Key': process.env.SPECTRE_API_KEY.trim() } : {}) }
const CACHE_KEY = 'brain-desk:v2'
const PRIOR_KEY = 'brain-desk:prior'
const LEDGER_KEY = 'brain-desk:ledger'
const LEDGER_MAX = 300 // KV has no list ops here — capped JSON array
const LEDGER_TTL_S = 90 * 24 * 3600
const TTL_S = 600

async function j(path, ms = 9000) {
  try {
    const r = await fetch(`${SPECTRE_API_BASE}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(ms) })
    if (!r.ok) return null
    const d = await r.json()
    return d?.data ?? d
  } catch { return null }
}

export default async function handler(req, res) {
  try {
    if (req.query.refresh !== '1') {
      const cached = await getJsonWithTTL(CACHE_KEY)
      if (cached?.intel?.length) return res.status(200).json({ ...cached, cached: true })
    }
    const priceFetcher = makePriceFetcher(j)

    // Self-grade past calls FIRST — the truth loop.
    const ledger = (await getJsonWithTTL(LEDGER_KEY).catch(() => null)) || []
    const { rows: gradedRows, graded } = await gradeLedger(ledger, priceFetcher)
    if (graded) await setJsonWithTTL(LEDGER_KEY, gradedRows, LEDGER_TTL_S).catch(() => {})
    const outcomeSummary = buildOutcomeSummary(gradedRows)

    const prior = (await getJsonWithTTL(PRIOR_KEY).catch(() => null)) || null
    const ctx = await gather(j)
    if (!ctx.signals?.length && !ctx.thesis) return res.status(200).json({ regime: null, context: null, convergence: [], intel: [], brief: [], error: 'no data' })
    if (ctx.meta.dropped_suspect_units) console.warn(`[brain-desk] dropped_suspect_units: ${ctx.meta.dropped_suspect_units}`)

    const r = await chat({
      tier: 'smart', json: true, maxTokens: 3000, temperature: 0.4, timeoutMs: 45000,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildContext(ctx, prior, outcomeSummary) }],
    })
    if (!r.ok || !r.text) return res.status(200).json({ regime: null, context: null, convergence: [], intel: [], brief: [], error: 'llm unavailable' })
    let p = null
    try { p = JSON.parse(r.text) } catch { const m = r.text.match(/\{[\s\S]*\}/); if (m) { try { p = JSON.parse(m[0]) } catch { /* noop */ } } }
    if (!p?.intel && !p?.convergence) return res.status(200).json({ regime: null, context: null, convergence: [], intel: [], brief: [], error: 'parse' })

    const { out, dropped } = sanitizeOutput(p)
    if (dropped.bad_direction) console.warn(`[brain-desk] dropped ${dropped.bad_direction} convergence row(s) with invalid direction`)
    await attachEntryPrices(out.convergence, priceFetcher, ctx.prices)

    // Ledger every call (capped array — newest last).
    const newRows = toLedgerRows(out.convergence)
    if (newRows.length) await setJsonWithTTL(LEDGER_KEY, [...gradedRows, ...newRows].slice(-LEDGER_MAX), LEDGER_TTL_S).catch(() => {})

    const payload = { ...out, provider: r.provider, generatedAt: new Date().toISOString() }
    await setJsonWithTTL(CACHE_KEY, payload, TTL_S)
    // persist a compact memory for next cycle's continuity
    await setJsonWithTTL(PRIOR_KEY, toPrior(out), 24 * 3600).catch(() => {})
    return res.status(200).json({ ...payload, cached: false })
  } catch (e) {
    return res.status(200).json({ regime: null, context: null, convergence: [], intel: [], brief: [], error: 'desk unavailable' })
  }
}
