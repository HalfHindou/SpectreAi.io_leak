'use strict'
/**
 * Research Memes — pure mapper from the trending engine's Solana board into the
 * four static schemas the meme UI components expect (Phase 2, ZERO new API cost).
 *
 * This is a PURE MAPPER. The Wire phase fetches the Solana trending board (the
 * array the existing trending engine already returns for networkId 1399811149)
 * and passes it in. We DO NOT fetch Codex (or anything) here — every number is
 * already on the input rows (DexScreener-enriched by the trending engine). No AI.
 *
 * Output (matches the components' static data shapes exactly):
 *   buildMemeSurfaces(solanaTrending, socialBySymbol) -> { dealFlow, scorecards, trends, theses }
 *     dealFlow   -> MemeFlowPipeline.jsx MEME_DEALS[] (4 STAGES: fresh/traction/viral/profit)
 *     scorecards -> DegenScorecard.jsx SCORECARDS[] (5 grades via GRADE_SCORE letters)
 *     trends     -> MemeTrendRadar.jsx TREND_DATA[] (5 categories: Animal/Political/AI/Culture/Degen)
 *     theses     -> DegenThesis.jsx THESES[] (rug-risk 1-8, conviction, comparables)
 *
 * SOCIAL (optional, GRACEFUL): `socialBySymbol` is keyed by UPPERCASE symbol ->
 * { mentions, distinctAuthors, velocity, sentiment }. It is supplied by the route
 * tier (dev + prod getMemes) from the /v1/social/mentions feed. When a symbol has
 * REAL data (mentions > 0) the deal/scorecard/thesis surfaces light up the social
 * fields (mention count string, up/down trend, community+hype grade nudge, a viral
 * catalyst line). When a symbol is ABSENT or mentions===0 (the dev default, where
 * the X feed is unauthed -> totals.mentions:0) the surfaces fall back to the EXACT
 * prior omit/proxy behaviour — no fabricated counts, never a misleading "0/hr".
 *
 * SHARED logic for BOTH the dev Express route (packages/server/routes/research-desk.js)
 * and the prod Vercel handler (apps/trading/api/research-desk.js). Keep the prod
 * mirror (apps/trading/api/_lib/research-memes.cjs) BYTE-IDENTICAL — the only
 * permitted difference is the require extensions:
 *     .js  : require('./trending-score')
 *     .cjs : require('./trending-score.cjs')
 *
 * DATA-INTEGRITY RULE: never fabricate. Where the trending row lacks a signal
 * (social mentions, holder velocity, LP-lock, deployer audit, top-holder %) we
 * OMIT the field or emit an honest heuristic label ('Likely safe'/'Unknown') —
 * NEVER an invented number or a claim like "audited". Every UI component already
 * guards optional fields, so an omitted field renders a clean fallback.
 */

const { normalizeCodexChange } = require('./trending-score')

// ── Constants ────────────────────────────────────────────────────────────────

const SOLANA = 1399811149

// networkId -> human chain label. The memes board used to be Solana-only, but it
// now also receives the MEME subset of the multi-chain alpha board (ETH/Base/BSC/
// Arb/Polygon), so a card can be on any chain — label it properly instead of the
// old "Chain <id>" fallback. Unknown ids still fall back to "Chain <id>".
const NETWORK_LABEL = {
  1: 'Ethereum', 8453: 'Base', 56: 'BNB Chain', 137: 'Polygon',
  42161: 'Arbitrum', 10: 'Optimism', 43114: 'Avalanche', 1399811149: 'Solana',
}
function chainLabel(networkId) {
  return NETWORK_LABEL[networkId] || `Chain ${networkId}`
}

// Caps that bound each surface (the components render dense boards, not endless
// lists). DealFlow = up to 12 cards across 4 stages; Scorecards = 8 rows;
// Theses = top 4 cards; Trends = the 5 fixed categories.
const DEAL_FLOW_CAP = 12
const SCORECARD_CAP = 8
const THESIS_CAP = 4

// Grade letter ladder (numeric 0..1 -> letter). Mirrors DegenScorecard.jsx
// GRADE_SCORE numeric->letter banding so a bar fill of N% maps to the letter
// whose GRADE_SCORE is closest. Generous-but-honest: a proxy with no real feed
// lands mid-table (C/B-) rather than fabricating an A.
function scoreToGrade(s) {
  const v = Math.max(0, Math.min(1, Number(s) || 0))
  if (v >= 0.95) return 'A+'
  if (v >= 0.89) return 'A'
  if (v >= 0.84) return 'A-'
  if (v >= 0.78) return 'B+'
  if (v >= 0.71) return 'B'
  if (v >= 0.64) return 'B-'
  if (v >= 0.58) return 'C+'
  if (v >= 0.51) return 'C'
  if (v >= 0.44) return 'C-'
  if (v >= 0.37) return 'D+'
  if (v >= 0.18) return 'D'
  return 'F'
}

// MemeTrendRadar.jsx phase ids (the 4 PHASES): rising/viral/cooling/dormant.
// MemeTrendRadar category ids (the 5 CATEGORY_ICONS / CATEGORY_COLORS keys):
// animal / political / ai / culture / degen.
const TREND_CATEGORY_IDS = ['animal', 'political', 'ai', 'culture', 'degen']
const TREND_CATEGORY_LABELS = {
  animal: 'Animal Memes', political: 'Political Memes', ai: 'AI / Tech Memes',
  culture: 'Culture Memes', degen: 'Degen / Meta',
}

// Lightweight keyword classifier -> the 5 MemeTrendRadar categories. Degen is the
// catch-all when nothing else matches (matches the component's "Degen / Meta"
// bucket for pure-meta plays with no clear theme).
const CATEGORY_KEYWORDS = {
  animal: ['cat', 'dog', 'inu', 'shib', 'doge', 'floki', 'wif', 'bonk', 'popcat', 'mew',
    'myro', 'pup', 'hound', 'kitty', 'paw', 'wolf', 'frog', 'toad', 'penguin', 'pengu',
    'bird', 'duck', 'goat', 'bull', 'bear', 'ape', 'monkey', 'sheep', 'fox', 'panda',
    'hippo', 'moo', 'cow', 'pig', 'hamster', 'rat', 'mouse', 'snek', 'snake', 'fish'],
  political: ['trump', 'maga', 'biden', 'kamala', 'harris', 'boden', 'tremp', 'potus',
    'president', 'election', 'vote', 'patriot', 'liberty', 'freedom', 'usa', 'america',
    'doland', 'politifi', 'milei', 'putin'],
  ai: ['ai', 'agent', 'gpt', 'goat', 'turbo', 'neural', 'bot', 'model', 'llm', 'gnon',
    'truth', 'terminal', 'machine', 'robot', 'sentient', 'compute', 'tensor', 'data',
    'algo', 'cyber', 'tech'],
  culture: ['pepe', 'wojak', 'chad', 'meme', 'based', 'gigachad', 'apu', 'brett', 'andy',
    'normie', 'feels', 'rare', 'kek', 'doomer', 'zoomer', 'boomer', 'sigma', 'culture',
    'internet', 'viral', 'mog', 'mochi', 'retard', 'autism'],
}

// ── Small helpers ────────────────────────────────────────────────────────────

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0 }

// Read a field by any of several aliases (the trending row uses Codex-shaped
// names; the task lists camelCase variants too). First defined non-null wins.
function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null) return row[k]
  }
  return null
}

// Pull the canonical identity off a trending row. The engine nests the real
// token under `token` but mirrors symbol/name at the top level.
function identityOf(row) {
  const t = (row && row.token) || {}
  return {
    symbol: String(pick(row, 'symbol') || t.symbol || '').replace(/^\$/, '').toUpperCase(),
    name: String(pick(row, 'name') || t.name || '') || (t.symbol || ''),
    address: pick(row, 'address') || t.address || null,
    networkId: num(pick(row, 'networkId') || t.networkId || SOLANA) || SOLANA,
    logo: pick(row, 'logo', 'logoUrl', 'image') || t.logo || t.imageThumbUrl || null,
  }
}

// Age in days from a unix timestamp (sec OR ms). null when absent.
function ageDaysFrom(ts) {
  let t = num(ts)
  if (t <= 0) return null
  if (t < 1e12) t *= 1000
  const d = (Date.now() - t) / 86400000
  return d >= 0 ? d : null
}

// Compact $ formatter (matches the components' "$420M" / "$1.2B" style).
function fmtCompactNum(n) {
  const v = num(n)
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}
function fmtUsd(n) { return n == null || num(n) <= 0 ? null : `$${fmtCompactNum(n)}` }
// Holder count formatter ("18.2K" / "1.4M"). Returns null when unknown — the UI
// guards a missing holders metric (renders nothing rather than "0").
function fmtCount(n) {
  const v = num(n)
  if (v <= 0) return null
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

// 24h change as a plain number (the components compare `change24h >= 0` and
// render `{change24h}%`). normalizeCodexChange turns the dual-format ratio into a
// clean percent; round to 1dp to match the static data's precision.
function pct1(row) {
  const v = normalizeCodexChange(pick(row, 'change24h', 'change24', 'change24H'))
  return Math.round(v * 10) / 10
}

// Net buy pressure 0..1 (>0.5 = net buying). 0.5 (neutral) when no txn split.
function buyPressure(row) {
  const buys = num(pick(row, 'buys24', 'buys'))
  const sells = num(pick(row, 'sells24', 'sells'))
  const total = buys + sells
  return total > 0 ? buys / total : 0.5
}

// ── Social helpers (GRACEFUL — only ever derived from a REAL feed entry) ───────
//
// `social` is one socialBySymbol entry: { mentions, distinctAuthors, velocity, sentiment }.
// EVERY function here treats a missing/zero-mention entry as "no data" and returns
// null — so an absent social feed (the dev default) yields the exact prior surface.

// True only when this row has a real mention count we can show.
function hasSocial(social) {
  return !!(social && num(social.mentions) > 0)
}

// Compact mention string for a 24h-ish window ("1.2K/24h" / "840/24h"). null when
// no data — callers MUST keep their prior omit behaviour on null.
function socialMentionsLabel(social) {
  if (!hasSocial(social)) return null
  const m = num(social.mentions)
  if (m <= 0) return null
  return `${fmtCount(m) || String(Math.round(m))}/24h`
}

// up/down/flat from the velocity sign. velocity is a plain number (per-hr trend or
// the last velocity point). null -> no directional claim (caller keeps its proxy).
function socialTrendDir(social) {
  if (!hasSocial(social)) return null
  const v = social.velocity
  if (v == null || !Number.isFinite(Number(v))) return null
  const n = Number(v)
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'flat'
}

// 0..1 community/hype nudge from mention volume + distinct authors (log-scaled).
// Returns null when no data so the proxy score is used unchanged.
function socialScore01(social) {
  if (!hasSocial(social)) return null
  const m = num(social.mentions)
  const a = num(social.distinctAuthors)
  // mentions to ~5k = strong, authors to ~1k = strong; blend.
  const mScore = Math.min(1, Math.log10(1 + m) / Math.log10(1 + 5_000))
  const aScore = a > 0 ? Math.min(1, Math.log10(1 + a) / Math.log10(1 + 1_000)) : null
  return aScore != null ? 0.65 * mScore + 0.35 * aScore : mScore
}

// Liquidity / volume / mcap accessors (aliases per the trending row + task spec).
function liqOf(row) { return num(pick(row, 'liquidity', 'liq')) }
function volOf(row) { return num(pick(row, 'volume24h', 'volume24', 'volume')) }
function mcapOf(row) {
  return num(pick(row, 'marketCap', 'mcap', 'fdv'))
}

// ── Category classifier ──────────────────────────────────────────────────────

// Classify a meme into one of the 5 MemeTrendRadar categories from its
// symbol+name. Degen is the deliberate catch-all when no keyword matches.
function classifyCategory(symbol, name) {
  const hay = `${String(symbol || '')} ${String(name || '')}`.toLowerCase()
  // Whole-token (symbol) exact hits first so e.g. "GOAT" -> ai not animal.
  for (const cat of ['political', 'ai', 'culture', 'animal']) {
    const kws = CATEGORY_KEYWORDS[cat]
    for (const kw of kws) {
      // word-ish boundary so "ai" doesn't match "rain"; allow substring for the
      // long animal/culture lists but require a boundary for the 2-letter "ai".
      if (kw.length <= 2) {
        if (new RegExp(`\\b${kw}\\b`, 'i').test(hay)) return cat
      } else if (hay.includes(kw)) {
        return cat
      }
    }
  }
  return 'degen'
}

// Investor-facing category WORD for the card badges (DealFlow/Scorecard/Thesis
// use a single capitalized word: 'Animal' | 'Political' | 'AI' | 'Culture' | 'Degen').
const CATEGORY_WORD = {
  animal: 'Animal', political: 'Political', ai: 'AI', culture: 'Culture', degen: 'Degen',
}

// ── Stage + momentum derivation ──────────────────────────────────────────────

// Momentum 0..1 from |24h change| + buy pressure + recent-vol acceleration.
// Used for stage selection, grades, and trend phase.
function momentum01(row) {
  const chg = Math.abs(normalizeCodexChange(pick(row, 'change24h', 'change24')))
  const chgScore = Math.min(1, chg / 60)            // cap at 60% move
  const accel = pick(row, 'recentVolRatio')
  const accelScore = accel != null ? Math.min(1, num(accel) / 0.5) : null
  const pressure = buyPressure(row)                  // 0..1
  // Blend: change dominates, accel + pressure nudge.
  if (accelScore != null) return 0.55 * chgScore + 0.25 * accelScore + 0.20 * pressure
  return 0.7 * chgScore + 0.3 * pressure
}

// DealFlow stage (the 4 MemeFlowPipeline STAGES ids). Driven by age + momentum:
//   fresh    - young (<14d) OR very small mcap, unproven
//   traction - climbing (positive change + net buying), mid mcap
//   viral    - explosive (big move + accel) OR high vol/mcap board leaders
//   profit   - mature + cooling (negative change, declining momentum)
function deriveStage(row) {
  const ageD = ageDaysFrom(pick(row, 'createdAt', 'pairCreatedAt'))
  const chg = normalizeCodexChange(pick(row, 'change24h', 'change24'))
  const mom = momentum01(row)
  const mcap = mcapOf(row)
  const accel = num(pick(row, 'recentVolRatio'))

  // Fresh: genuinely young, or tiny + unproven.
  if (ageD != null && ageD < 14) return 'fresh'
  if (mcap > 0 && mcap < 3_000_000 && (ageD == null || ageD < 30)) return 'fresh'

  // Viral: strong upward move with acceleration, or board-leading momentum.
  if (chg >= 25 && (accel >= 0.3 || mom >= 0.6)) return 'viral'
  if (mom >= 0.72) return 'viral'

  // Profit: cooling / distributing (down on the day, momentum faded).
  if (chg < -3 && mom < 0.4) return 'profit'
  if (chg <= 0 && mcap >= 500_000_000) return 'profit' // large-cap drifting down

  // Default: organically gaining.
  return 'traction'
}

// MemeTrendRadar phase from aggregate category momentum + velocity direction.
function derivePhase(avgMomentum, velocityChange, volume7d) {
  if (avgMomentum >= 0.6 && velocityChange >= 0) return 'viral'
  if (velocityChange >= 8) return 'rising'
  if (avgMomentum <= 0.25 && velocityChange < 0) return 'dormant'
  if (velocityChange < 0) return 'cooling'
  return 'rising'
}

// ── Deployer / LP heuristics (HONEST — never claim "audited") ─────────────────

// Deployer safety heuristic from liquidity depth + age. We have NO audit feed,
// so this is a label, never a claim of verification.
//   deep liquidity + mature -> 'Likely safe'
//   thin / very young        -> 'Unverified'
//   else                     -> 'Unknown'
function deployerHeuristic(row) {
  const liq = liqOf(row)
  const ageD = ageDaysFrom(pick(row, 'createdAt', 'pairCreatedAt'))
  if (liq >= 250_000 && ageD != null && ageD >= 30) return { label: 'Likely safe', safe: true }
  if (liq < 30_000 || (ageD != null && ageD < 3)) return { label: 'Unverified', safe: false }
  return { label: 'Unknown', safe: liq >= 100_000 }
}

// ── Surface 1: DealFlow (MemeFlowPipeline MEME_DEALS) ─────────────────────────

function buildDealCard(row, social) {
  const id = identityOf(row)
  if (!id.symbol) return null
  const cat = classifyCategory(id.symbol, id.name)
  const stage = deriveStage(row)
  const chg = pct1(row)
  const mom01 = momentum01(row)

  // Risk letter from a blended safety score (liquidity depth + age + buy pressure
  // - momentum-derived; NO holder/audit feed). Lower = riskier.
  const liq = liqOf(row)
  const ageD = ageDaysFrom(pick(row, 'createdAt', 'pairCreatedAt'))
  const depthScore = Math.min(1, Math.log10(1 + liq) / Math.log10(1 + 5_000_000))
  const ageScore = ageD == null ? 0.3 : Math.min(1, ageD / 180)
  const riskScore = 0.5 * depthScore + 0.3 * ageScore + 0.2 * buyPressure(row)
  const riskGrade = scoreToGrade(riskScore)

  const dep = deployerHeuristic(row)
  const holders = fmtCount(pick(row, 'holders', 'holderCount'))
  // Social trend: REAL velocity sign when the feed has data, else the prior
  // price-derived directional proxy (unchanged behaviour when social absent).
  const socialMentionsStr = socialMentionsLabel(social)              // null when no feed
  const socialTrend = socialTrendDir(social) || (chg > 3 ? 'up' : chg < -3 ? 'down' : 'flat')

  // Build socials only from real links present on the row (omit otherwise).
  const socials = {}
  const website = pick(row, 'website', 'url')
  const twitter = pick(row, 'twitter', 'x')
  const telegram = pick(row, 'telegram')
  if (website) socials.website = String(website)
  if (twitter) socials.x = /^https?:/i.test(String(twitter)) ? String(twitter) : `https://x.com/${String(twitter).replace(/^@/, '')}`
  if (telegram) socials.telegram = String(telegram)

  // Factual signal string (data-derived, no invented narrative).
  const volStr = fmtUsd(volOf(row))
  const sigParts = []
  if (stage === 'fresh') sigParts.push('Newly listed')
  else if (stage === 'viral') sigParts.push('Explosive volume + momentum')
  else if (stage === 'profit') sigParts.push('Momentum fading from peak')
  else sigParts.push('Organic activity climbing')
  if (volStr) sigParts.push(`${volStr} 24h vol`)
  if (chg !== 0) sigParts.push(`${chg >= 0 ? '+' : ''}${chg}% 24h`)

  return {
    id: id.address ? `m-${id.address}` : `m-${id.symbol}`,
    stage,
    symbol: id.symbol,
    name: id.name || id.symbol,
    thesis: `${CATEGORY_WORD[cat]} meme on ${chainLabel(id.networkId)} · ${stage} stage`,
    category: CATEGORY_WORD[cat],
    risk: riskGrade,
    riskColor: gradeColor(riskGrade),
    holders: holders || '-',                          // UI guards "-"
    // holderVelocity: PROXY from buy/sell trend when we have a txn split; else omit.
    holderVelocity: holderVelocityProxy(row),
    volume24h: volStr || '-',
    // LP-lock: NO feed -> omit lpPct, mark lpLocked unknown (false renders "LP Unlocked"
    // which would be a false claim, so we only set true when liquidity is genuinely deep).
    lpLocked: liq >= 100_000,                          // depth heuristic, not a lock proof
    lpPct: null,                                       // unknown -> UI shows "LP <empty>"; guarded
    change24h: chg,
    mcap: fmtUsd(mcapOf(row)) || '-',
    // socialMentions: REAL count string from the /v1/social/mentions feed when
    // present (e.g. "1.2K/24h"); null when ABSENT or mentions===0 (dev default) ->
    // the UI keeps its prior omitted state. socialTrend is the real velocity sign
    // when we have it, else the price-derived directional proxy. NEVER fabricated.
    socialMentions: socialMentionsStr,
    socialTrend,
    deployer: dep.label,                               // 'Likely safe'/'Unverified'/'Unknown'
    deployerSafe: dep.safe,
    chain: chainLabel(id.networkId),
    topHolderPct: null,                                // no holder feed -> omit
    signal: sigParts.join(' · '),
    socials: Object.keys(socials).length ? socials : null,
    logo: id.logo,
    _mom: mom01,                                       // internal sort key (stripped)
  }
}

// Holder-velocity proxy: with a buy/sell split we can say net-buying/net-selling
// pressure as a coarse direction; without it, omit (return null). NEVER a number.
function holderVelocityProxy(row) {
  const buys = num(pick(row, 'buys24', 'buys'))
  const sells = num(pick(row, 'sells24', 'sells'))
  if (buys + sells <= 0) return '-'
  const p = buys / (buys + sells)
  if (p >= 0.58) return '+ buying'
  if (p <= 0.42) return '- selling'
  return 'flat'
}

// Risk grade colour (matches the components' green/amber/red usage).
function gradeColor(g) {
  if (g === 'A+' || g === 'A' || g === 'A-' || g === 'B+') return '#10B981'
  if (g === 'B' || g === 'B-' || g === 'C+') return '#FBBF24'
  if (g === 'C' || g === 'C-') return '#F59E0B'
  return '#EF4444'
}

function buildDealFlow(rows, socialBySymbol) {
  const social = socialBySymbol || {}
  const cards = []
  for (const r of rows) {
    const id = identityOf(r)
    const c = buildDealCard(r, id.symbol ? social[id.symbol] : null)
    if (c) cards.push(c)
  }
  // Rank by momentum FIRST so the same-symbol dedupe keeps the strongest pool.
  cards.sort((a, b) => b._mom - a._mom)
  // SAME-SYMBOL dedupe (mirrors the keyTokens uppercase-Set dedupe in
  // lib/research-desk.js): two distinct Codex pools for one ticker (e.g. SPCX
  // twice) carry unique ids so React doesn't crash, but reading the same symbol
  // twice in the pipeline looks like a bug. Keep the FIRST (highest momentum)
  // card per uppercase symbol, drop the rest, THEN stage-assign + slice(0,12).
  const seenSym = new Set()
  const deduped = []
  for (const c of cards) {
    const key = String(c.symbol || '').toUpperCase()
    if (!key || seenSym.has(key)) continue
    seenSym.add(key)
    deduped.push(c)
  }
  const capped = deduped.slice(0, DEAL_FLOW_CAP)
  for (const c of capped) delete c._mom
  return capped
}

// ── Surface 2: Scorecards (DegenScorecard SCORECARDS) ────────────────────────

// 5-dimension grades for one meme: community, liquidity, distribution, hype, safety.
// Real signals where a feed exists; honest PROXIES (mid-table) where none does.
function deriveScorecardGrades(row, social) {
  const liq = liqOf(row)
  const vol = volOf(row)
  const mcap = mcapOf(row)
  const holders = num(pick(row, 'holders', 'holderCount'))
  const txns = num(pick(row, 'txnCount24', 'txnCount'))
  const ageD = ageDaysFrom(pick(row, 'createdAt', 'pairCreatedAt'))

  // REAL social score (0..1) when the feed has mentions for this symbol; else null
  // -> the proxy paths below run UNCHANGED (zero regression when social absent).
  const soc = socialScore01(social)

  // Community: holders + txn activity proxy, BUMPED toward the real social score
  // when we have one (mention volume + distinct authors is a truer community
  // signal than on-chain activity). Without social, identical to the prior proxy.
  const holderScore = holders > 0
    ? Math.min(1, Math.log10(1 + holders) / Math.log10(1 + 1_000_000))
    : null
  const txnScore = Math.min(1, Math.log10(1 + txns) / Math.log10(1 + 50_000))
  let sCommunity = holderScore != null ? 0.6 * holderScore + 0.4 * txnScore : 0.4 + 0.3 * txnScore
  if (soc != null) sCommunity = 0.45 * sCommunity + 0.55 * soc

  // Liquidity REAL: depth (log to ~$20M) + turnover (vol/liq capped).
  const depth = Math.min(1, Math.log10(1 + liq) / Math.log10(1 + 20_000_000))
  const turnover = liq > 0 ? Math.min(1, (vol / liq) / 4) : 0
  const sLiquidity = 0.6 * depth + 0.4 * turnover

  // Distribution PROXY (no holder-concentration feed): more holders relative to
  // mcap = more distributed. Neutral 0.5 when we can't tell.
  let sDistribution = 0.5
  if (holders > 0 && mcap > 0) {
    const perHolder = mcap / holders // $ mcap per holder; lower = more distributed
    // < $5k/holder = very distributed, > $200k/holder = concentrated.
    const t = (Math.log10(Math.max(1, perHolder)) - 3.7) / (5.3 - 3.7) // ~5k..~200k
    sDistribution = Math.max(0.15, Math.min(0.9, 1 - t))
  }

  // Hype REAL-ish: momentum (|24h| + accel + buy pressure), BUMPED by the real
  // social score when present (hype IS attention). Unchanged when social absent.
  let sHype = momentum01(row)
  if (soc != null) sHype = 0.5 * sHype + 0.5 * soc

  // Safety PROXY (no audit feed): liquidity depth + age. Honest heuristic only.
  const ageScore = ageD == null ? 0.3 : Math.min(1, ageD / 365)
  const sSafety = 0.55 * depth + 0.45 * ageScore

  return {
    grades: {
      community: scoreToGrade(sCommunity),
      liquidity: scoreToGrade(sLiquidity),
      distribution: scoreToGrade(sDistribution),
      hype: scoreToGrade(sHype),
      safety: scoreToGrade(sSafety),
    },
    _numeric: { sCommunity, sLiquidity, sDistribution, sHype, sSafety },
  }
}

function buildScorecard(row, social) {
  const id = identityOf(row)
  if (!id.symbol) return null
  const cat = classifyCategory(id.symbol, id.name)
  const sc = deriveScorecardGrades(row, social)
  // Overall = mean of the 5 numerics -> letter.
  const n = sc._numeric
  const overallScore = (n.sCommunity + n.sLiquidity + n.sDistribution + n.sHype + n.sSafety) / 5
  const overall = scoreToGrade(overallScore)

  // Extended metrics — REAL where present, omitted otherwise (UI guards).
  const metrics = {}
  const holders = fmtCount(pick(row, 'holders', 'holderCount'))
  const vol = fmtUsd(volOf(row))
  if (holders) metrics.holders = holders
  if (vol) metrics.volume24h = vol
  // socialFollowers + topWhale: NO feed -> omit (never fabricate).

  // Dimension notes — factual, data-derived (no invented narrative).
  const liqStr = fmtUsd(liqOf(row))
  const chg = pct1(row)
  const dimensionNotes = {
    community: holders
      ? `${holders} holders with ${fmtCount(pick(row, 'txnCount24', 'txnCount')) || 'low'} 24h transactions. Activity-based proxy (no social feed).`
      : 'Holder count unavailable. Graded from on-chain transaction activity only.',
    liquidity: liqStr
      ? `${liqStr} pooled liquidity${vol ? `, ${vol} 24h volume` : ''}. Turnover-based depth score.`
      : 'Thin or unverified liquidity.',
    distribution: (pick(row, 'holders') != null && mcapOf(row) > 0)
      ? 'Holder-to-mcap spread proxy. No per-wallet concentration feed available.'
      : 'Concentration unknown — neutral grade (no holder-distribution feed).',
    hype: `Momentum from ${chg >= 0 ? '+' : ''}${chg}% 24h move${pick(row, 'recentVolRatio') != null ? ' and recent-volume acceleration' : ''}.`,
    safety: `Heuristic from liquidity depth and ${ageDaysFrom(pick(row, 'createdAt', 'pairCreatedAt')) != null ? 'pair age' : 'unknown age'}. Not an audit.`,
  }

  // Build socials from real links only.
  const socials = {}
  const website = pick(row, 'website', 'url')
  const twitter = pick(row, 'twitter', 'x')
  const telegram = pick(row, 'telegram')
  if (website) socials.website = String(website)
  if (twitter) socials.x = /^https?:/i.test(String(twitter)) ? String(twitter) : `https://x.com/${String(twitter).replace(/^@/, '')}`
  if (telegram) socials.telegram = String(telegram)

  const insight = `${CATEGORY_WORD[cat]} meme. ${liqStr ? `${liqStr} liquidity` : 'Thin liquidity'}${vol ? `, ${vol} 24h volume` : ''}. Grades are activity + liquidity derived (no social/audit feed).`

  return {
    symbol: id.symbol,
    name: id.name || id.symbol,
    overall,
    category: CATEGORY_WORD[cat],
    mcap: fmtUsd(mcapOf(row)) || '-',
    chain: chainLabel(id.networkId),
    grades: sc.grades,
    insight,
    extended: {
      // prevGrade: NO history feed -> omit (UI guards ext.prevGrade).
      metrics: Object.keys(metrics).length ? metrics : null,
      socials: Object.keys(socials).length ? socials : null,
      dimensionNotes,
      // catalysts/risks: factual, data-derived bullet strings (social-aware).
      catalysts: buildScorecardCatalysts(row, cat, social),
      risks: buildScorecardRisks(row),
    },
    logo: id.logo,
    _score: overallScore,
  }
}

function buildScorecardCatalysts(row, cat, social) {
  const out = []
  // REAL social catalyst FIRST when the feed has data for this symbol (factual,
  // count-derived). Omitted entirely when absent -> prior catalyst set unchanged.
  if (hasSocial(social)) {
    const mLabel = socialMentionsLabel(social)
    const dir = socialTrendDir(social)
    if (mLabel) {
      out.push(
        dir === 'up'
          ? `Social mentions rising — ${mLabel} across tracked platforms`
          : dir === 'down'
            ? `${mLabel} social mentions, though velocity is cooling`
            : `${mLabel} social mentions across tracked platforms`
      )
    }
  }
  const chg = pct1(row)
  if (chg > 10) out.push(`Strong ${chg >= 0 ? '+' : ''}${chg}% 24h move signals active momentum`)
  if (num(pick(row, 'recentVolRatio')) >= 0.3) out.push('Recent-volume acceleration above baseline')
  if (buyPressure(row) >= 0.58) out.push('Net buy pressure across recent transactions')
  if (cat === 'animal') out.push('Animal-meme meta remains the dominant Solana narrative')
  if (out.length === 0) out.push('Liquidity and listing in place for re-rating on a catalyst')
  return out.slice(0, 3)
}

function buildScorecardRisks(row) {
  const out = []
  const liq = liqOf(row)
  const ageD = ageDaysFrom(pick(row, 'createdAt', 'pairCreatedAt'))
  if (liq < 50_000) out.push('Thin liquidity — vulnerable to slippage and whale dumps')
  if (ageD != null && ageD < 14) out.push('Very young pair — limited price history, unproven')
  if (buyPressure(row) <= 0.42) out.push('Net selling pressure in recent transactions')
  if (out.length === 0) out.push('No holder-concentration or audit feed — distribution risk unverified')
  return out.slice(0, 3)
}

function buildScorecards(rows, socialBySymbol) {
  const social = socialBySymbol || {}
  const cards = []
  for (const r of rows) {
    const id = identityOf(r)
    const c = buildScorecard(r, id.symbol ? social[id.symbol] : null)
    if (c) cards.push(c)
  }
  cards.sort((a, b) => b._score - a._score)
  const capped = cards.slice(0, SCORECARD_CAP)
  for (const c of capped) delete c._score
  return capped
}

// ── Surface 3: Trends (MemeTrendRadar TREND_DATA — 5 fixed categories) ────────

function buildTrends(rows) {
  // Bucket every meme into its category, aggregate momentum/volume/velocity.
  const buckets = {}
  for (const id of TREND_CATEGORY_IDS) buckets[id] = []
  for (const r of rows) {
    const id = identityOf(r)
    if (!id.symbol) continue
    const cat = classifyCategory(id.symbol, id.name)
    buckets[cat].push(r)
  }

  const out = []
  for (const catId of TREND_CATEGORY_IDS) {
    const members = buckets[catId]
    // Aggregate metrics from the members. Empty category -> dormant placeholder
    // built only from REAL aggregates (zeros), no invented numbers.
    const n = members.length
    const sumVol = members.reduce((a, r) => a + volOf(r), 0)
    const sumMcap = members.reduce((a, r) => a + mcapOf(r), 0)
    const avgMom = n ? members.reduce((a, r) => a + momentum01(r), 0) / n : 0
    const avgChg = n ? members.reduce((a, r) => a + pct1(r), 0) / n : 0
    // Social velocity PROXY (no social feed): 24h transactions across the bucket
    // as a coarse "mentions/hr"-shaped activity number. Honest: it's tx-derived.
    const sumTxn = members.reduce((a, r) => a + num(pick(r, 'txnCount24', 'txnCount')), 0)
    const socialVelocity = Math.round(sumTxn / 24) // tx/hr as the activity proxy
    const velocityChange = Math.round(avgChg * 10) / 10
    const momentum = Math.round(Math.max(0, Math.min(1, avgMom)) * 100)
    const phase = n === 0 ? 'dormant' : derivePhase(avgMom, velocityChange, sumVol)

    // Top mover within the bucket (factual symbol + its 24h %).
    let topMover = null
    if (n) {
      const sorted = [...members].sort((a, b) => Math.abs(pct1(b)) - Math.abs(pct1(a)))
      const top = identityOf(sorted[0])
      const tchg = pct1(sorted[0])
      topMover = `${top.symbol} ${tchg >= 0 ? '+' : ''}${tchg}%`
    }

    // Key tokens (top 4 by |move|) with factual role strings + real socials.
    const keyTokens = (n ? [...members].sort((a, b) => momentum01(b) - momentum01(a)) : [])
      .slice(0, 4)
      .map((r) => {
        const id = identityOf(r)
        const tchg = pct1(r)
        const socials = {}
        const website = pick(r, 'website', 'url')
        const twitter = pick(r, 'twitter', 'x')
        const telegram = pick(r, 'telegram')
        if (website) socials.website = String(website)
        if (twitter) socials.x = /^https?:/i.test(String(twitter)) ? String(twitter) : `https://x.com/${String(twitter).replace(/^@/, '')}`
        if (telegram) socials.telegram = String(telegram)
        return {
          symbol: id.symbol,
          change: `${tchg >= 0 ? '+' : ''}${tchg}%`,
          role: `${CATEGORY_WORD[catId]} meme · ${fmtUsd(mcapOf(r)) || 'micro-cap'}`,
          socials: Object.keys(socials).length ? socials : undefined,
        }
      })

    out.push({
      id: catId,
      label: TREND_CATEGORY_LABELS[catId],
      phase,
      socialVelocity,                                  // tx/hr proxy (honest)
      velocityChange,                                  // avg 24h % across bucket
      volume7d: fmtUsd(sumVol) || '$0',                // 24h vol sum (no 7d feed; see note)
      momentum,
      topMover: topMover || '-',
      signal: buildTrendSignal(catId, phase, n, velocityChange),
      extended: {
        totalMcap: fmtUsd(sumMcap) || '$0',
        volume7d: fmtUsd(sumVol) || '$0',
        activeTokens: n,
        avgHolderGrowth: null,                         // NO holder-history feed -> omit
        insight: buildTrendInsight(catId, phase, n, sumVol, velocityChange),
        keyTokens,
        catalysts: buildTrendCatalysts(catId),
        risks: buildTrendRisks(catId),
      },
    })
  }

  // Sort by momentum desc so the strongest category leads (component re-sorts too).
  out.sort((a, b) => b.momentum - a.momentum)
  return out
}

function buildTrendSignal(catId, phase, count, velocityChange) {
  const label = CATEGORY_WORD[catId]
  if (count === 0) return `No active ${label.toLowerCase()} memes on the board right now. Waiting for a catalyst.`
  const dir = velocityChange >= 0 ? 'gaining' : 'losing'
  return `${count} active ${label.toLowerCase()} meme${count === 1 ? '' : 's'} · ${dir} momentum (${velocityChange >= 0 ? '+' : ''}${velocityChange}% avg 24h). Phase: ${phase}.`
}

function buildTrendInsight(catId, phase, count, sumVol, velocityChange) {
  const label = CATEGORY_WORD[catId]
  const volStr = fmtUsd(sumVol) || '$0'
  if (count === 0) {
    return `The ${label} meme category has no qualifying tokens on the current Solana trending board. Activity-derived view only — no social-listening feed.`
  }
  return `${count} ${label} meme${count === 1 ? '' : 's'} on the board totalling ${volStr} 24h volume, averaging ${velocityChange >= 0 ? '+' : ''}${velocityChange}% 24h. Category is in the ${phase} phase. Metrics are on-chain activity derived (transactions, volume, price) — there is no social-mentions or holder-history feed behind these numbers.`
}

// Static, factual category catalysts/risks (no per-token fabrication).
function buildTrendCatalysts(catId) {
  const map = {
    animal: ['Animal-meme meta is self-reinforcing through viral content', 'Solana throughput enables rapid launches and trading', 'CEX listings for leading animal tokens create fresh demand'],
    political: ['Election-cycle news events drive sudden volume spikes', 'Political endorsement of crypto can pull in a crossover audience', 'Regulatory clarity could legitimize the sector'],
    ai: ['More AI agents autonomously launching tokens builds the meta', 'Mainstream AI headlines drive crossover attention', 'Novelty — AI memes feel genuinely new vs recycled themes'],
    culture: ['Viral internet moments spawn new culture-meme opportunities', 'Established culture memes act as the category blue chip', 'Influencer and cultural-event endorsements widen reach'],
    degen: ['A fresh meme season could lift all boats including pure-meta plays', 'Novel launch mechanisms (AI agents, fair launches) create hype', 'CT influencer rotation back into the degen sector'],
  }
  return map[catId] || map.degen
}
function buildTrendRisks(catId) {
  const map = {
    animal: ['Animal-meme meta can rotate to a new theme overnight', 'Low-quality imitators dilute attention', 'Legacy animal tokens anchoring while new plays run'],
    political: ['Severe whale concentration is common in political memes', 'Regulatory scrutiny specifically targets political tokens', 'Binary event risk — wrong side of a news cycle causes sharp crashes'],
    ai: ['Most AI memes have zero technical substance — pure narrative', 'AI-hype bubble risk if the broader AI trade disappoints', 'Low liquidity on most AI meme tokens — high slippage'],
    culture: ['Culture is fickle — today’s viral meme is tomorrow’s forgotten one', 'Gas/fees can limit retail entry during high volatility', 'Meme fatigue if the broader market turns bearish'],
    degen: ['Most degen tokens trend to zero — very high failure rate', 'No fundamental floor — purely attention-driven', 'Extreme whale concentration across pure-meta plays'],
  }
  return map[catId] || map.degen
}

// ── Surface 4: Theses (DegenThesis THESES) ───────────────────────────────────

function buildThesis(row, peers, social) {
  const id = identityOf(row)
  if (!id.symbol) return null
  const cat = classifyCategory(id.symbol, id.name)
  const chg = pct1(row)
  const mom01 = momentum01(row)
  const liq = liqOf(row)
  const ageD = ageDaysFrom(pick(row, 'createdAt', 'pairCreatedAt'))

  // rugRisk 1-8 (1 = safest, 8 = riskiest) from LP depth + age + buy pressure.
  // We have NO LP-lock or holder-concentration feed -> depth/age heuristic only.
  let risk = 4 // neutral baseline
  if (liq >= 1_000_000) risk -= 2
  else if (liq >= 250_000) risk -= 1
  else if (liq < 30_000) risk += 2
  else if (liq < 75_000) risk += 1
  if (ageD != null && ageD >= 180) risk -= 1
  else if (ageD != null && ageD < 7) risk += 2
  else if (ageD != null && ageD < 30) risk += 1
  if (buyPressure(row) <= 0.4) risk += 1
  risk = Math.max(1, Math.min(8, risk))

  // viralPotential + conviction from momentum (High/Medium/Low labels).
  const viralPotential = mom01 >= 0.6 ? 'High' : mom01 >= 0.35 ? 'Medium' : 'Low'
  const conviction = (mom01 >= 0.55 && risk <= 3) ? 'High' : (risk >= 6 || mom01 < 0.3) ? 'Low' : 'Medium'

  // comparable one-liner (factual).
  const mcapStr = fmtUsd(mcapOf(row)) || 'micro-cap'
  const comparable = `${CATEGORY_WORD[cat]} meme on ${chainLabel(id.networkId)} · ${mcapStr}`

  // analystNote — DATA-DERIVED factual string (no invented narrative/claims).
  const noteParts = [`${id.symbol} is a ${CATEGORY_WORD[cat].toLowerCase()} meme`]
  const liqStr = fmtUsd(liq)
  if (liqStr) noteParts.push(`with ${liqStr} pooled liquidity`)
  if (ageD != null) noteParts.push(`and a ${Math.round(ageD)}-day-old pair`)
  noteParts.push(`. 24h move ${chg >= 0 ? '+' : ''}${chg}%`)
  noteParts.push(`with ${buyPressure(row) >= 0.5 ? 'net buying' : 'net selling'} pressure.`)
  noteParts.push(`Rug risk is heuristic (liquidity depth + pair age) — there is no LP-lock or audit feed behind it.`)
  const analystNote = noteParts.join(' ').replace(/\s+\./g, '.')

  // viralCatalysts / rugFactors — DATA-DERIVED factual bullet strings.
  const viralCatalysts = []
  // REAL social viral catalyst FIRST when the feed has data (factual count + an
  // honest authors/velocity qualifier). Omitted when absent -> unchanged set.
  if (hasSocial(social)) {
    const mLabel = socialMentionsLabel(social)
    const dir = socialTrendDir(social)
    const authors = num(social.distinctAuthors)
    if (mLabel) {
      const authorPart = authors > 0 ? ` from ${fmtCount(authors) || authors} authors` : ''
      viralCatalysts.push(
        dir === 'up'
          ? `Accelerating social chatter — ${mLabel} mentions${authorPart}`
          : `${mLabel} social mentions${authorPart} across tracked platforms`
      )
    }
  }
  if (chg > 10) viralCatalysts.push(`Active ${chg >= 0 ? '+' : ''}${chg}% 24h momentum`)
  if (num(pick(row, 'recentVolRatio')) >= 0.3) viralCatalysts.push('Recent-volume acceleration above baseline')
  if (cat === 'animal') viralCatalysts.push('Riding the dominant animal-meme meta on Solana')
  if (buyPressure(row) >= 0.58) viralCatalysts.push('Net buy pressure across recent transactions')
  if (viralCatalysts.length === 0) viralCatalysts.push('Liquidity and listing in place for a momentum re-rating')

  const rugFactors = []
  if (liq < 75_000) rugFactors.push('Thin liquidity — high slippage and whale-dump exposure')
  if (ageD != null && ageD < 14) rugFactors.push('Very young pair — limited history, unproven')
  rugFactors.push('No LP-lock or holder-concentration feed — concentration risk unverified')
  if (buyPressure(row) <= 0.42) rugFactors.push('Net selling pressure recently')

  // whaleActivity — buy/sell-pressure derived (honest), or omit if no split.
  const buys = num(pick(row, 'buys24', 'buys'))
  const sells = num(pick(row, 'sells24', 'sells'))
  let whaleActivity = 'No recent buy/sell split available; aggregate flow only.'
  if (buys + sells > 0) {
    const p = buys / (buys + sells)
    whaleActivity = p >= 0.55
      ? `Recent transactions skew to buying (${Math.round(p * 100)}% buys). No per-wallet whale feed — this is aggregate flow, not wallet tracking.`
      : p <= 0.45
        ? `Recent transactions skew to selling (${Math.round((1 - p) * 100)}% sells). No per-wallet whale feed — aggregate flow only.`
        : `Balanced buy/sell flow recently. No per-wallet whale-tracking feed available.`
  }

  // comparables — peer memes from the SAME category bucket (factual symbol+mcap).
  const comparables = (peers || [])
    .filter((p) => {
      const pid = identityOf(p)
      return pid.symbol && pid.symbol !== id.symbol && classifyCategory(pid.symbol, pid.name) === cat
    })
    .slice(0, 3)
    .map((p) => {
      const pid = identityOf(p)
      return { symbol: pid.symbol, mcap: fmtUsd(mcapOf(p)) || '-', metric: `${CATEGORY_WORD[cat]} peer` }
    })

  // socials from real links only.
  const socials = {}
  const website = pick(row, 'website', 'url')
  const twitter = pick(row, 'twitter', 'x')
  const telegram = pick(row, 'telegram')
  if (website) socials.website = String(website)
  if (twitter) socials.x = /^https?:/i.test(String(twitter)) ? String(twitter) : `https://x.com/${String(twitter).replace(/^@/, '')}`
  if (telegram) socials.telegram = String(telegram)

  return {
    id: id.address ? `dt-${id.address}` : `dt-${id.symbol}`,
    symbol: id.symbol,
    name: id.name || id.symbol,
    category: CATEGORY_WORD[cat],
    comparable,
    rugRisk: risk,
    viralPotential,
    conviction,
    mcap: fmtUsd(mcapOf(row)) || '-',
    holders: fmtCount(pick(row, 'holders', 'holderCount')) || '-',
    volume24h: fmtUsd(volOf(row)) || '-',
    chain: chainLabel(id.networkId),
    topWhale: null,                                    // no holder feed -> omit (UI guards)
    lpLocked: 'Unknown',                                    // no LP-lock feed -> omit (UI guards "LP: <empty>")
    analystNote,
    viralCatalysts: viralCatalysts.slice(0, 3),
    rugFactors: rugFactors.slice(0, 3),
    whaleActivity,
    comparables,
    socials: Object.keys(socials).length ? socials : null,
    logo: id.logo,
    _mom: mom01,
  }
}

function buildTheses(rows, socialBySymbol) {
  const social = socialBySymbol || {}
  const cards = []
  for (const r of rows) {
    const id = identityOf(r)
    const c = buildThesis(r, rows, id.symbol ? social[id.symbol] : null)
    if (c) cards.push(c)
  }
  cards.sort((a, b) => b._mom - a._mom)
  const capped = cards.slice(0, THESIS_CAP)
  for (const c of capped) delete c._mom
  return capped
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Map the Solana trending board into the four meme UI surfaces. PURE — no fetch,
 * no AI. Safe with any input (returns empty arrays on bad/empty input, never throws).
 *
 * @param {Array<object>} solanaTrending - the trending engine's networkId 1399811149 rows
 * @param {Object<string, {mentions:number, distinctAuthors?:number, velocity?:number, sentiment?:string}>} [socialBySymbol={}]
 *   Optional social-velocity map keyed by UPPERCASE symbol. Supplied by the route
 *   tier from /v1/social/mentions. A symbol whose entry has mentions>0 lights up
 *   the social fields on dealFlow/scorecards/theses; ABSENT or mentions===0
 *   degrades to the EXACT prior omit/proxy behaviour (the dev default). The trends
 *   surface keeps its tx-derived socialVelocity proxy (already honest), unchanged.
 * @returns {{ dealFlow:Array, scorecards:Array, trends:Array, theses:Array }}
 */
function buildMemeSurfaces(solanaTrending, socialBySymbol = {}) {
  const rows = Array.isArray(solanaTrending) ? solanaTrending.filter((r) => r && typeof r === 'object') : []
  const social = (socialBySymbol && typeof socialBySymbol === 'object') ? socialBySymbol : {}
  if (rows.length === 0) {
    return { dealFlow: [], scorecards: [], trends: buildTrends([]), theses: [] }
  }
  return {
    dealFlow: buildDealFlow(rows, social),
    scorecards: buildScorecards(rows, social),
    trends: buildTrends(rows),
    theses: buildTheses(rows, social),
  }
}

module.exports = {
  buildMemeSurfaces,
  // exported for the route + tests
  classifyCategory,
  scoreToGrade,
  TREND_CATEGORY_IDS,
}
