// Brain Desk generator — the market CONSCIOUSNESS loop (not a summarizer).
//
// Each cycle it: (1) GRADES its own past calls vs live prices (4h/24h/7d
// checkpoints → the outcome ledger), (2) reads its PRIOR read (memory),
// (3) absorbs live signals across every domain + live prices, (4) CONNECTS
// them into convergence TRADE READS (direction/conviction/horizon/invalidation
// /entry_price), (5) persists every call to the ledger so the next cycle can
// grade it. Writes public/brain-desk.json (next cycle's memory).
//
// All shared logic (prompt/gather/context budgets/sanitize/grading) lives in
// ./_lib/desk-core.js — the prod handler consumes the same core. No drift.
import { chat } from './_lib/llm-gateway.js'
import { gather, buildContext, sanitizeOutput, gradeLedger, buildOutcomeSummary, attachEntryPrices, toLedgerRows, makePriceFetcher, SYSTEM, arr } from './_lib/desk-core.js'
import { writeFileSync, readFileSync, renameSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'

const BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const H = { Accept: 'application/json', 'X-API-Key': (process.env.SPECTRE_API_KEY || '').trim() }
const OUT = fileURLToPath(new URL('../public/brain-desk.json', import.meta.url))
const LEDGER = fileURLToPath(new URL('./_data/brain-desk-ledger.jsonl', import.meta.url))
const j = async (p) => { try { const r = await fetch(BASE + p, { headers: H, signal: AbortSignal.timeout(12000) }); if (!r.ok) return null; const d = await r.json(); return d?.data ?? d } catch { return null } }

function readPrior() {
  try {
    const d = JSON.parse(readFileSync(OUT, 'utf8'))
    return {
      regime: d.regime, context: d.context,
      convergence: arr(d.convergence).map((c) => ({ asset: c.asset, direction: c.direction, why: c.why })),
      watching: d.watching,
    }
  } catch { return null }
}

function readLedger() {
  try { return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] }
}
function atomicWrite(path, text) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

const priceFetcher = makePriceFetcher(j)

// 1. Self-grade past calls FIRST — the truth loop.
const ledger = readLedger()
const { rows: gradedRows, graded } = await gradeLedger(ledger, priceFetcher)
if (graded) atomicWrite(LEDGER, gradedRows.map((r) => JSON.stringify(r)).join('\n') + '\n')
const outcomeSummary = buildOutcomeSummary(gradedRows)

// 2. Gather. If the data-api is dark, do NOT hallucinate — skip the cycle.
const ctx = await gather(j)
if (ctx.meta.null_domains / ctx.meta.total_domains >= 0.8) {
  console.log(`data-api dark (${ctx.meta.null_domains}/${ctx.meta.total_domains} domains null) — skipping cycle, no LLM call`)
  process.exit(0)
}
if (ctx.meta.dropped_suspect_units) console.log(`dropped_suspect_units: ${ctx.meta.dropped_suspect_units} (unit-suspect flow entries excluded from context)`)

const prior = readPrior()
const r = await chat({ tier: 'smart', json: true, maxTokens: 3000, temperature: 0.4, timeoutMs: 55000, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildContext(ctx, prior, outcomeSummary) }] })
if (!r.ok) { console.error('LLM failed:', r.error); process.exit(1) }
let p = null; try { p = JSON.parse(r.text) } catch { const m = r.text.match(/\{[\s\S]*\}/); if (m) { try { p = JSON.parse(m[0]) } catch { /* fallthrough */ } } }
if (!p) { console.error('parse failed — first 300 chars:', String(r.text).slice(0, 300)); process.exit(1) }

// 3. Sanitize (strict trade-read schema) + attach live entry prices.
const { out, dropped } = sanitizeOutput(p)
if (dropped.bad_direction) console.log(`dropped ${dropped.bad_direction} convergence row(s) with invalid direction (bull|bear only, never defaulted)`)
if (dropped.missing_invalidation) console.log(`${dropped.missing_invalidation} convergence row(s) missing invalidation (kept, null)`)
await attachEntryPrices(out.convergence, priceFetcher, ctx.prices)

// 4. Ledger every call, then publish atomically.
const newRows = toLedgerRows(out.convergence)
if (newRows.length) appendFileSync(LEDGER, newRows.map((row) => JSON.stringify(row)).join('\n') + '\n')

const payload = { ...out, provider: r.provider, generatedAt: new Date().toISOString() }
atomicWrite(OUT, JSON.stringify(payload))
console.log(`wrote brain-desk.json — ${out.convergence.length} convergences, ${out.intel.length} intel, ${out.watching.length} watching · memory:${prior ? 'yes' : 'cold'} · graded:${graded} ledger:${gradedRows.length + newRows.length} · outcome:${outcomeSummary ? `${outcomeSummary.n_graded} graded, 24h hit ${outcomeSummary.hit_rate_24h}%` : 'cold'} · ${r.provider}`)
