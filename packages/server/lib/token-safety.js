/**
 * token-safety - wash-volume heuristics + RugCheck screening for trending
 * surfaces. "No rugs, no scams, no fake volume."
 *
 * Two independent layers:
 *
 * 1. washReasons(row) - zero-cost heuristics on numbers we already hold.
 *    Calibrated on real offenders (welcome-board audit 2026-07-03 + the IRAN /
 *    BHETOKEN reports): bots cycle a thin pool so volume dwarfs liquidity
 *    (fake clusters run 400-750x vol/liq; real DEX tokens top out ~100x), or
 *    fabricate a large mcap on dust liquidity, or ping-pong buys/sells at
 *    near-perfect symmetry. Only fires when liquidity is a known positive -
 *    never on a genuine no-liquidity-data row.
 *
 * 2. rugcheckBatch(mints) - free RugCheck.xyz report summaries for Solana
 *    mints (holder concentration, LP unlocked, mint/freeze authority).
 *    BHETOKEN's real report: "Large Amount of LP Unlocked 100%" + "Top 10
 *    holders >70%" + single holder 50.5% - two danger-level risks.
 *    Drop rule: >= 2 danger risks, or any single always-fatal authority risk.
 *    A lone "LP Unlocked" danger is common on fresh legit memes - warn-only.
 *    Fail-open: no report / timeout = not flagged (heuristics still apply).
 */

const RUG_TTL_MS = 30 * 60 * 1000
const rugCache = new Map() // mint -> { verdict, ts }

const SOL_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// Authority risks that are disqualifying on their own.
const ALWAYS_FATAL = [
  /freeze authority/i,
  /mint authority/i,
]

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// Cap-tiered mcap/liq drop line. Below $1M a thin pool is normal; above $20M a
// token with 1500x its liquidity in claimed cap is fabricated supply.
// 2026-08-18: big-cap tier 6000 -> 1500, measured on the live BSC screener: a
// fake "USDT" at $731B mcap ran 5887x and PASSED the 6000 line by 2%; M21NT
// ($25B, 1872x) and BTW ($4.2B, 3087x) also slid under it. The highest
// LEGITIMATE survivor measured 1021x (bridged tokens whose main liquidity
// lives on their home chain), so 1500 sits in an empty band between the two
// populations. Keep in sync with isCleanRow in TrendingHub/index.jsx.
function mcapLiqDropLimit(mcap) {
  if (!(mcap > 0)) return Infinity
  if (mcap < 1_000_000) return 200
  if (mcap < 20_000_000) return 300
  return 1500
}

// Pull a percentage out of a RugCheck risk value ("65.00%", "Top 10 holders
// 71.2%"). Returns null when the risk carries no number.
function pctFrom(v) {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(v == null ? '' : v))
  return m ? Number(m[1]) : null
}

/**
 * Heuristic wash / fabrication flags. Returns [] when the row looks organic.
 * Row fields tolerated: volume24|volume, liquidity, marketCap, txns|txnCount24,
 * buys|buys24, sells|sells24.
 */
function washReasons(row, opts = {}) {
  // volLiqMax: confirmed fake clusters run 400-750x. The engine (which has
  // traction scoring + social reality behind its rows) drops at 400x so
  // borderline viral memecoins with thin pools (ANSEM 317x, QUIP 371x on
  // 2026-07-03) survive; raw screener surfaces with no such evidence use the
  // stricter 300x default.
  const volLiqMax = opts.volLiqMax || 300
  const reasons = []
  const vol = num(row.volume24 ?? row.volume)
  const liq = num(row.liquidity)
  const mcap = num(row.marketCap)
  const buys = num(row.buys ?? row.buys24)
  const sells = num(row.sells ?? row.sells24)
  const txns = num(row.txns ?? row.txnCount24) || (buys + sells)

  if (liq > 0) {
    if (vol > 0 && vol / liq > volLiqMax) reasons.push(`vol/liq ${(vol / liq).toFixed(0)}x`)
    // Fabricated market cap - the copycat signature. Measured on a live
    // `search?q=GameStop` (30 pairs, 21 distinct contracts, 20 sharing the "GME"
    // ticker): REAL tokens sit at mcap/liq 2-10x, every impersonator at
    // 147x-1674x. The old rule only fired above $20M mcap at >6000x, so all of
    // them passed. Thresholds are cap-tiered because a $500k token legitimately
    // runs thinner than a $50M one.
    // These are DROP thresholds, set at ~2x the flagging line: the 100-200x band
    // is handled by trending-score's liqDepthFactor demotion instead, so a
    // genuinely low-float token gets ranked down rather than deleted.
    if (mcap / liq > mcapLiqDropLimit(mcap)) reasons.push(`mcap/liq ${(mcap / liq).toFixed(0)}x`)
    if (liq < 1000 && vol > 100_000) reasons.push('dust liquidity')
    // Bot ping-pong: thousands of trades split almost exactly 50/50 while the
    // pool turns over at wash rates. Organic pumps skew buy-heavy.
    if (buys + sells > 2000 && vol / liq > 150) {
      const skew = Math.abs(buys - sells) / (buys + sells)
      if (skew < 0.02) reasons.push(`bot symmetry ${(skew * 100).toFixed(1)}%`)
    }
  }
  return reasons
}

// Concentration dangers are the actual rug tell. "LP Unlocked" + "Low
// Liquidity" together describe half of all fresh legit memes (POKERBULL,
// 2026-07-03) - those alone never drop. BHETOKEN-class rugs pair LP risk
// with top-10/single-holder concentration.
const CONCENTRATION = /top 10|single holder|high ownership|creator|insider/i
const TOP10_RE = /top 10/i
function verdictFromReport(json) {
  const risks = Array.isArray(json && json.risks) ? json.risks : []
  const dangers = risks.filter((r) => r && r.level === 'danger')
  const fatal = dangers.some((r) => ALWAYS_FATAL.some((re) => re.test(r.name || '')))
  const concentrated = dangers.some((r) => CONCENTRATION.test(r.name || ''))
  const lpLockedPct = Number.isFinite(json && json.lpLockedPct) ? json.lpLockedPct : null
  // Concentration comes from RugCheck's OWN risk rows, deliberately NOT from
  // the full report's raw topHolders[]. On Solana the largest holder is almost
  // always the AMM pool / bonding curve itself - a healthy pump.fun token reads
  // 70%+ at topHolders[0] - so computing this ourselves would flag essentially
  // every legitimate Solana meme. RugCheck already excludes the pool. (It also
  // keeps us on the 0.6KB summary instead of the 545KB full report.)
  const top10 = risks.map((r) => (TOP10_RE.test((r && r.name) || '') ? pctFrom(r.value) : null))
    .find((v) => v != null)
  return {
    drop: fatal || (dangers.length >= 2 && concentrated),
    // Carry the value into the name ("Single holder ownership (65.00%)") -
    // the AI Read risk line can then state the actual float structure.
    dangers: dangers.map((r) => (r.value ? `${r.name} (${r.value})` : r.name)).slice(0, 4),
    warns: risks.filter((r) => r && r.level === 'warn').length,
    // Raw signals for downstream rules (ghost-volume gate): how much of the
    // LP is actually locked, and whether the token even has file metadata.
    lpLocked: lpLockedPct,
    noMeta: risks.some((r) => /missing file metadata/i.test((r && r.name) || '')),
    // ---- graded signals (feed trending-score's securityFactor) ----
    top10Pct: top10 != null ? top10 : null,
    mintAuthority: risks.some((r) => /mint authority/i.test((r && r.name) || '')),
    freezeAuthority: risks.some((r) => /freeze authority/i.test((r && r.name) || '')),
    // RugCheck's normalised risk score: 0 = clean, higher = riskier.
    score: Number.isFinite(json && json.score_normalised) ? json.score_normalised : null,
    checked: true,
  }
}

async function rugcheckOne(mint) {
  const hit = rugCache.get(mint)
  if (hit && Date.now() - hit.ts < RUG_TTL_MS) return hit.verdict
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) throw new Error(`rugcheck ${res.status}`)
    const text = await res.text()
    if (!text) throw new Error('empty report')
    const verdict = verdictFromReport(JSON.parse(text))
    rugCache.set(mint, { verdict, ts: Date.now() })
    if (rugCache.size > 1500) rugCache.delete(rugCache.keys().next().value)
    return verdict
  } catch {
    // Fail-open, short negative cache so fresh unindexed mints re-check soon.
    const verdict = { drop: false, dangers: [], warns: 0, lpLocked: null, noMeta: false, checked: false }
    rugCache.set(mint, { verdict, ts: Date.now() - RUG_TTL_MS + 5 * 60 * 1000 })
    return verdict
  }
}

/**
 * Check a list of Solana mints against RugCheck. Bounded concurrency + an
 * overall time budget: whatever hasn't resolved inside budgetMs fails open
 * THIS round but keeps resolving in the background and lands in the cache
 * for the next compute.
 * @returns Map(mint -> verdict)
 */
async function rugcheckBatch(mints, { concurrency = 4, budgetMs = 5000 } = {}) {
  const out = new Map()
  const list = [...new Set(mints.filter((m) => typeof m === 'string' && SOL_MINT_RE.test(m)))]
  if (!list.length) return out
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const mint = list[i++]
      out.set(mint, await rugcheckOne(mint))
    }
  }
  const run = Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
  await Promise.race([run, new Promise((r) => setTimeout(r, budgetMs))])
  return out // background workers keep filling rugCache after the budget
}

// ── EVM honeypot / unsellable screening (GoPlus) ─────────────────────────────
// RugCheck is Solana-only; EVM honeypots (e.g. V GOD 0xf3c188…, confirmed a
// honeypot by BOTH GoPlus is_honeypot AND honeypot.is medium_siphon_rate) sail
// through the wash gate because their vol/liq can look organic. GoPlus runs an
// on-chain buy+sell simulation and exposes it as is_honeypot / cannot_sell_all /
// cannot_buy / sell_tax. Batch per chain (up to 100 addresses/request), 30-min
// cached, fail-open under a time budget.
const GOPLUS_TTL_MS = 30 * 60 * 1000
const goplusCache = new Map() // `${chainId}:${addrLower}` -> { verdict, ts }
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/

// A DROP verdict = a token you cannot buy, cannot sell, or can only sell at an
// extortionate (>=50%) tax. We deliberately do NOT drop on merely-*potential*
// risks (blacklist/pausable/modifiable-tax) - those are common on legit tokens
// and belong in a warn layer, not a trending exclusion.
function verdictFromGoplus(t) {
  if (!t || typeof t !== 'object') return { drop: false, reasons: [], checked: false }
  const reasons = []
  const sellTax = Number(t.sell_tax) || 0
  const buyTax = Number(t.buy_tax) || 0
  if (t.is_honeypot === '1') reasons.push('honeypot')
  if (t.cannot_sell_all === '1') reasons.push('cannot sell all')
  if (t.cannot_buy === '1') reasons.push('cannot buy')
  if (sellTax >= 0.5) reasons.push(`sell tax ${Math.round(sellTax * 100)}%`)
  if (buyTax >= 0.5) reasons.push(`buy tax ${Math.round(buyTax * 100)}%`)
  // ---- graded signals (feed trending-score's securityFactor) ----
  // LP lock state across all LP holders: locked when every LP position is
  // either locked or burned (GoPlus marks burn addresses is_locked=1).
  const lps = Array.isArray(t.lp_holders) ? t.lp_holders : null
  const lpLocked = lps && lps.length
    ? lps.every((h) => String(h && h.is_locked) === '1')
    : null
  // owner_percent / creator_percent are supply SHARES ("0.05" = 5%) - the
  // closest EVM analogue to RugCheck's top-10 concentration.
  const ownerPct = Math.max(num(t.owner_percent), num(t.creator_percent)) * 100
  return {
    drop: reasons.length > 0,
    reasons,
    lpLocked,
    top10Pct: ownerPct > 0 ? ownerPct : null,
    // is_mintable is the EVM equivalent of a live mint authority.
    mintAuthority: t.is_mintable === '1',
    // No EVM freeze authority; the equivalent capability is a transfer
    // blacklist or a pause switch the owner still controls.
    freezeAuthority: t.is_blacklisted === '1' || t.transfer_pausable === '1',
    maxTaxPct: Math.max(sellTax, buyTax) * 100,
    holders: Number.isFinite(Number(t.holder_count)) ? Number(t.holder_count) : null,
    checked: true,
  }
}

/**
 * Fold whatever the providers returned into the single `_safety` shape that
 * trending-score's securityFactor consumes. Every field is optional - a missing
 * provider must read as "no opinion" (undefined), never as "clean" or "bad".
 * @param {object} [rug] verdict from rugcheckBatch
 * @param {object} [gp]  verdict from goplusHoneypotBatch
 */
function safetySignals(rug, gp) {
  const out = {}
  const pick = (a, b) => (a != null ? a : (b != null ? b : undefined))
  // lpLocked is a percentage on RugCheck and a boolean on GoPlus - normalise to
  // a boolean, treating "most of it locked" as locked.
  const rugLp = rug && rug.lpLocked
  if (Number.isFinite(rugLp)) out.lpLocked = rugLp >= 50
  else if (gp && gp.lpLocked != null) out.lpLocked = gp.lpLocked

  const top10 = pick(rug && rug.top10Pct, gp && gp.top10Pct)
  if (top10 != null) out.top10Pct = top10
  if ((rug && rug.mintAuthority) || (gp && gp.mintAuthority)) out.mintAuthority = true
  if ((rug && rug.freezeAuthority) || (gp && gp.freezeAuthority)) out.freezeAuthority = true
  const tax = gp && gp.maxTaxPct
  if (Number.isFinite(tax) && tax > 0) out.maxTaxPct = tax
  const holders = gp && gp.holders
  if (holders != null) out.holders = holders
  out.warnCount = num(rug && rug.warns)
  // Coarse level the newborn gate reads. RugCheck's normalised score runs
  // 0 (clean) upward; 40+ alongside danger findings is a real red flag.
  const score = rug && rug.score
  if ((rug && rug.drop) || (gp && gp.drop)) out.risk = 'high'
  else if (Number.isFinite(score) && score >= 40) out.risk = 'high'
  else if (out.warnCount >= 3 || out.mintAuthority || out.freezeAuthority) out.risk = 'med'
  else out.risk = 'low'
  return out
}

// GoPlus's multi-address batch endpoint is unreliable - it returns only a
// subset (often just the already-warmed tokens) even when the rest exist, so we
// query ONE address at a time (single queries are reliable) with bounded
// concurrency + a time budget, exactly like rugcheckBatch.
async function goplusOne(chain, addr) {
  const ck = `${chain}:${addr}`
  const hit = goplusCache.get(ck)
  if (hit && Date.now() - hit.ts < GOPLUS_TTL_MS) return hit.verdict
  try {
    const url = `https://api.gopluslabs.io/api/v1/token_security/${chain}?contract_addresses=${addr}`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`goplus ${res.status}`)
    const json = await res.json()
    const t = (json && json.result && (json.result[addr] || json.result[addr.toLowerCase()])) || null
    if (!t) throw new Error('empty') // not analyzed yet -> fail-open + short cache
    const verdict = verdictFromGoplus(t)
    goplusCache.set(ck, { verdict, ts: Date.now() })
    return verdict
  } catch {
    // Fail-open, short negative cache so an unanalyzed / rate-limited token
    // re-checks on a soon-following sweep (and lands in the 30-min cache then).
    const verdict = { drop: false, reasons: [], checked: false }
    goplusCache.set(ck, { verdict, ts: Date.now() - GOPLUS_TTL_MS + 5 * 60 * 1000 })
    return verdict
  }
}

/**
 * Screen EVM tokens for honeypot / unsellable status via GoPlus.
 * @param items [{ address, networkId }]  (non-EVM / malformed entries ignored)
 * @returns Map(addressLower -> { drop, reasons, checked })
 */
async function goplusHoneypotBatch(items, { concurrency = 4, budgetMs = 6000 } = {}) {
  const out = new Map()
  const list = []
  const seen = new Set()
  for (const it of items || []) {
    const addr = String(it && it.address || '').toLowerCase()
    const chain = Number(it && it.networkId)
    if (!EVM_ADDR_RE.test(addr) || !Number.isFinite(chain) || chain <= 0) continue
    const key = `${chain}:${addr}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ chain, addr })
  }
  if (!list.length) return out
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const { chain, addr } = list[i++]
      out.set(addr, await goplusOne(chain, addr))
    }
  }
  const run = Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
  // Whatever hasn't resolved inside the budget fails open this round but keeps
  // filling goplusCache for the next sweep (mirrors rugcheckBatch).
  await Promise.race([run, new Promise((r) => setTimeout(r, budgetMs))])
  if (goplusCache.size > 2000) goplusCache.delete(goplusCache.keys().next().value)
  return out
}

module.exports = {
  washReasons, rugcheckBatch, goplusHoneypotBatch, safetySignals,
  mcapLiqDropLimit, SOL_MINT_RE,
}
