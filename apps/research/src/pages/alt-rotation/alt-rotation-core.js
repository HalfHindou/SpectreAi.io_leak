// Microcaps / Alt Rotation — the shared brain.
//
// PRO (/alt-rotation) and Spectre Lite's Microcaps view both read this module,
// so the verdict, the chain map, the cycle-depth read and the on-chain DEX
// volume can never drift apart between the two surfaces. Everything here is
// pure or a plain fetch — no React, no hook state.
//
// Sources: CoinGecko ecosystem/meme categories (per-chain cohorts) + DefiLlama
// DEX overview (per-chain on-chain volume — free, no key, cached 2.5 min).
import { getCategoryCoins } from '@/services/coinGeckoApi'

// ── chains we track (the user's map: ETH-chain ATL, SOL, Base was quiet →
//    recovering, Robinhood the new vibe). CG ecosystem + dedicated meme
//    categories where they exist (ETH has no meme cat → global meme-token;
//    RH is small-cap/meme-heavy → split its own ecosystem by pattern). ────────
export const CHAINS = [
  { key: 'eth', name: 'Ethereum', short: 'ETH', cat: 'ethereum-ecosystem', memeCat: 'meme-token', dexSlug: 'ethereum', accent: '#8a92b2' },
  { key: 'sol', name: 'Solana', short: 'SOL', cat: 'solana-ecosystem', memeCat: 'solana-meme-coins', dexSlug: 'solana', accent: '#14f195' },
  { key: 'base', name: 'Base', short: 'BASE', cat: 'base-ecosystem', memeCat: 'base-meme-coins', dexSlug: 'base', accent: '#3c7cff' },
  { key: 'rh', name: 'Robinhood', short: 'RH', cat: 'robinhood-ecosystem', memeCat: null, dexSlug: 'robinhood-chain', accent: '#39d98a' },
]

// Per-chain on-chain DEX volume — the real "is this chain alive" signal (ETH's
// volume is draining, RH is new but has real flow) + the daily volume history
// for the sparkline chart. Free source, cached 5 min.
// 2.5 min, deliberately UNDER the page's 3-minute chain wave: at the old 5 min
// every other refresh was served the same numbers back, so the on-chain leg of
// the verdict aged up to six minutes on a hero that claims to be live.
const DEX_TTL = 150000
const _dexCache = new Map()
export async function dexVolume(slug) {
  if (!slug) return null
  const hit = _dexCache.get(slug)
  if (hit && Date.now() - hit.ts < DEX_TTL) return hit.data
  try {
    const r = await fetch(`https://api.llama.fi/overview/dexs/${encodeURIComponent(slug)}?excludeTotalDataChartBreakdown=true`, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return null
    const j = await r.json()
    const chart = (Array.isArray(j.totalDataChart) ? j.totalDataChart : [])
      .map((p) => ({ ts: Number(p[0]) * 1000, v: Number(p[1]) }))
      .filter((p) => p.ts > 0 && p.v >= 0)
      .slice(-400) // ~13 months — enough for the 30D/90D/6M/1Y views
    // A young chain's % change is measured against days when it barely traded:
    // Robinhood Chain (37 days of history) reports change_1m = +144,592%. That
    // is arithmetic, not information — drop a window the history can't support.
    const days = chart.length
    const data = {
      vol24h: Number(j.total24h) || null,
      vol7d: Number(j.total7d) || null,
      chg7d: days >= 9 ? Number(j.change_7d) : null,
      chg30d: days >= 32 ? Number(j.change_1m) : null,
      chart,
    }
    _dexCache.set(slug, { ts: Date.now(), data })
    return data
  } catch { return null }
}

// ── ON-CHAIN IMPULSE — the one input on this page that can see TODAY ─────────
// BTC dominance, the Alt Season Index and the OTHERS2 sliver are all priced off
// CEX market caps. They move on a weekly clock, and until now they were the
// WHOLE verdict. Measured 2026-08-20: Ethereum DEX volume went $0.68B → $2.09B
// and Base $0.54B → $1.26B in two days (complete days, not a partial bar) while
// the headline sat at 31/100 "NOT GO TIME" — the page was printing a surge in
// its own chain cards that the verdict was structurally blind to.
//
// The read is an IMPULSE, not a trend: last 24h against the chain's OWN
// trailing-30d median. A 7d-vs-7d mean is five stale days out of seven and
// cannot see a two-day move by construction; DefiLlama's `change_7d` is one day
// against one day, so a single fat session last week flips it. Median across
// chains so no single chain carries the verdict, and the ratio is logged then
// squashed — a 10x day on a small chain reads as "hot", not ten times hotter.
export function dexImpulse(dex) {
  const chart = Array.isArray(dex?.chart) ? dex.chart.filter((p) => p.v > 0) : []
  if (chart.length < 12) return null
  const now = num(dex.vol24h) ?? chart[chart.length - 1].v
  const base = chart.slice(-31, -1).map((p) => p.v).sort((a, b) => a - b)
  if (base.length < 10 || !(now > 0)) return null
  const med = base[Math.floor(base.length / 2)]
  return med > 0 ? now / med : null
}

// chains (anything carrying a `.dex`) → the shared on-chain leg of the verdict.
// null when no chain holds enough tape, so the score renormalises instead of
// scoring a feed that never answered as a zero.
export function onchainPulse(chains) {
  const ratios = (Array.isArray(chains) ? chains : [])
    .map((c) => dexImpulse(c?.dex))
    .filter((r) => r != null && r > 0)
    .sort((a, b) => a - b)
  if (!ratios.length) return null
  const ratio = ratios[Math.floor(ratios.length / 2)]
  const expanding = ratios.filter((r) => r >= 1.15).length
  const shrinking = ratios.filter((r) => r <= 0.87).length // 1/1.15 — same band, other side
  // ln-ratio through tanh: 1.0x → 0.50, 2.0x → 0.91, 0.5x → 0.09. Bounded both
  // ways, so neither a dead week nor a mania can pin the whole score.
  const trend = clamp(0.5 + 0.5 * Math.tanh(Math.log(ratio) / 0.55), 0, 1)
  // Breadth has to be TWO-SIDED. Scoring it as `expanding / live` reads a
  // perfectly ordinary week — every chain at 1.0x, nothing expanding, nothing
  // dying — as 0.0, which drags a neutral tape into a bearish verdict. Counted
  // against its own opposite it sits at 0.5 when the chains are balanced.
  const spread = clamp(0.5 + (expanding - shrinking) / (2 * ratios.length), 0, 1)
  return { score01: 0.65 * trend + 0.35 * spread, ratio, expanding, shrinking, live: ratios.length }
}

// meme classifier — no CG per-chain meme category is reliable across all 4, so
// we tag by symbol/name pattern + the "meme-token" heavyweights. Utility = the
// rest of the ecosystem (DeFi / infra / AI / RWA / L2). Honest heuristic; the
// split is labelled "est." in the UI.
const MEME_RE = /(dog|doge|inu|shib|floki|bonk|wif|pepe|wojak|cat|meme|moon|elon|chad|based|frog|hat|coin$|baby|pump|trump|maga|pnut|mog|neiro|brett|toshi|ai16z|goat|fart|retard|giga|turbo|ponke|popcat|mew|slerf|myro|banana|tendies|swole|slippy|yolo|clawbank|wishbone|juggernaut|raxol|npc|degen)/i
const STABLE_RE = /^(usdt|usdc|dai|usde|usdg|fdusd|tusd|usds|pyusd|frax|lusd|gusd|susds|syrupusdg|usd0|buidl|ousg)/i
const WRAP_RE = /^(weth|wbtc|wsteth|steth|reth|cbeth|cbbtc|meth|wbeth|rseth|ezeth|weeth|sfrxeth|frxeth|beth)/i

function isStableOrWrap(sym) {
  const s = String(sym || '').toUpperCase()
  return STABLE_RE.test(s) || WRAP_RE.test(s)
}
function isMeme(coin) {
  const s = String(coin.symbol || '')
  const n = String(coin.name || '')
  return MEME_RE.test(s) || MEME_RE.test(n)
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// mcap-weighted mean of a % field across a coin set
function wMean(coins, field) {
  let sw = 0, sv = 0
  for (const c of coins) {
    const v = num(c[field]); const w = num(c.market_cap)
    if (v == null || !w || w <= 0) continue
    sw += w; sv += v * w
  }
  return sw > 0 ? sv / sw : null
}
// breadth: share of coins green over the field window (0-100)
function breadth(coins, field) {
  const vals = coins.map((c) => num(c[field])).filter((v) => v != null)
  return vals.length ? (vals.filter((v) => v > 0).length / vals.length) * 100 : null
}

const F24 = 'price_change_percentage_24h_in_currency'
const F7 = 'price_change_percentage_7d_in_currency'
const F30 = 'price_change_percentage_30d_in_currency'
function median(coins, field) {
  const v = coins.map((c) => num(c[field])).filter((x) => x != null).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}

// per-chain "vibe" — LIVENESS, not just token breadth. A new chain with real
// DEX volume + big runners (Robinhood) is ACTIVE, not "at the lows"; an
// established chain whose DEX volume is draining (Ethereum -32% 7d) is quiet /
// draining even if its blue-chips hold. Inputs: DEX-vol trend + runners +
// breadth. `runners` = { count>25% 7d, top 7d }, `dex` = { vol24h, chg7d }.
export function vibeFor({ med30d, br7d, runners, dex }) {
  const b7 = br7d ?? 0
  const dexChg = dex ? num(dex.chg7d) : null
  const top = runners?.top ?? 0
  const runN = runners?.count ?? 0
  // strong live runners → active/degen regardless of broad breadth (the RH case)
  if (top >= 60 && runN >= 2) return { label: 'Runners live', tone: 'hot', pct: clamp(68 + runN * 3, 68, 94) }
  // DEX volume clearly rising → alive
  if (dexChg != null && dexChg >= 8 && b7 >= 40) return { label: 'Heating up', tone: 'hot', pct: clamp(70 + b7 * 0.25, 70, 92) }
  if (dexChg != null && dexChg >= 0 && b7 >= 46) return { label: 'Recovering', tone: 'recover', pct: clamp(54 + b7 * 0.28, 52, 74) }
  // DEX volume draining hard → the chain is quieting down (the ETH case)
  if (dexChg != null && dexChg <= -25) return { label: 'Draining', tone: 'bleed', pct: clamp(24 + b7 * 0.25, 18, 42) }
  // genuinely dead: no runners, weak breadth, deeply negative month
  if (runN === 0 && (b7 < 26 || (med30d ?? 0) <= -25)) return { label: 'At the lows', tone: 'atl', pct: clamp(10 + b7 * 0.3, 6, 26) }
  return { label: 'Quiet / basing', tone: 'quiet', pct: clamp(38 + b7 * 0.22, 34, 51) }
}

// a cohort read = equal-weight typical move (median) + how many are green
function cohort(coins) {
  return {
    count: coins.length,
    mcap: coins.reduce((s, c) => s + (num(c.market_cap) || 0), 0),
    med7d: median(coins, F7), med30d: median(coins, F30),
    breadth7d: breadth(coins, F7), breadth30d: breadth(coins, F30),
  }
}

// The CoinGecko half of a chain read: ecosystem cohort, meme/utility split,
// runners and leaders. Kept separate from `dexVolume` so Lite can paint the
// (cheap, free) DEX volume for every chain up front and only pay for this
// 1-2 request cohort fan-out when the user opens a chain.
export async function loadChainCohort(chain) {
  // cgOnly: ecosystem categories aren't served by the Spectre bridge (see
  // getCategoryCoins note); go straight to CG with the % windows we need.
  const [ecoRaw, memeRaw] = await Promise.all([
    getCategoryCoins(chain.cat, 1, 100, { cgOnly: true, sparkline: false }).catch(() => []),
    chain.memeCat ? getCategoryCoins(chain.memeCat, 1, 60, { cgOnly: true, sparkline: false }).catch(() => []) : Promise.resolve(null),
  ])
  const eco = (Array.isArray(ecoRaw) ? ecoRaw : [])
    .filter((c) => c && num(c.market_cap) > 0 && !isStableOrWrap(c.symbol))
  // memes: dedicated category where it exists, else split the ecosystem by
  // pattern (RH is small-cap/meme-heavy so the pattern split is meaningful).
  const memeSet = Array.isArray(memeRaw)
    ? memeRaw.filter((c) => c && num(c.market_cap) > 0 && !isStableOrWrap(c.symbol))
    : eco.filter(isMeme)
  const memeIds = new Set(memeSet.map((c) => c.id))
  const utils = eco.filter((c) => !memeIds.has(c.id) && !isMeme(c))

  // headline chain momentum: mcap-weighted (size) for context; the honest
  // "are alts moving" read is the equal-weight breadth + median below.
  const med30 = median(eco, F30), med7 = median(eco, F7), br7 = breadth(eco, F7)
  const sorted7 = [...eco].filter((c) => num(c[F7]) != null).sort((a, b) => (num(b[F7]) || -999) - (num(a[F7]) || -999))
  // runners = the degen/activity tell (how RH stays "live" not "at the lows")
  const runners = { count: sorted7.filter((c) => num(c[F7]) > 25).length, top: sorted7.length ? (num(sorted7[0][F7]) || 0) : 0 }
  const leaders = sorted7.slice(0, 5)
    .map((c) => ({ sym: String(c.symbol || '').toUpperCase(), name: c.name, image: c.image, mcap: num(c.market_cap), chg7d: num(c[F7]), chg24h: num(c[F24]) }))
  return {
    key: chain.key, name: chain.name, short: chain.short, accent: chain.accent, cat: chain.cat,
    count: eco.length,
    mcap: eco.reduce((s, c) => s + (num(c.market_cap) || 0), 0),
    chg24h: wMean(eco, F24), chg7d: wMean(eco, F7), chg30d: wMean(eco, F30),
    med7d: med7, med30d: med30, breadth7d: br7, breadth30d: breadth(eco, F30),
    runners,
    meme: cohort(memeSet), utility: cohort(utils),
    leaders,
  }
}

// ── the GO-TIME verdict: 0-100 rotation-readiness from 6 grounded signals ────
// `onchain` is optional: it rides in with the chain cards, one wave behind the
// macro legs, so the hero paints on the five and upgrades in place. When it is
// missing the weights renormalise — a feed that failed must not read as a zero.
// "7d" is a claim, and after a seam it is a false one — label the leg with the
// window the number was actually measured over.
const winTxt = (d) => (d == null ? '7d' : d >= 1 ? `${Math.round(d)}d` : `${Math.max(1, Math.round(d * 24))}h`)

export function buildVerdict({ domDelta30d, altSeasonIdx, breadth7d, others2Trend7d, others2TrendDays, majorsVsAlts, onchain }) {
  const reasons = []
  let score = 0, wsum = 0
  const add = (w, s01, label, value, signal) => { score += w * s01; wsum += w; reasons.push({ label, value, signal }) }

  // 0) ON-CHAIN DEX impulse — listed first because it is the only leg that moves
  //    on the day, and micros trade HERE, not on a CEX top-100 index. Weight
  //    0.22: second only to dominance, ahead of the Alt Season Index (which
  //    measures the top 100 — by definition not the tail this page reads).
  if (onchain?.score01 != null) {
    const r = onchain.ratio
    add(0.22, onchain.score01, 'On-chain DEX impulse',
      `${r.toFixed(2)}× 30d · ${onchain.expanding}/${onchain.live} chains`,
      r >= 1.25 ? 'bull' : r <= 0.8 ? 'bear' : 'neutral')
  }
  // 1) BTC dominance trend — rising dominance drains alts (weight 0.28)
  if (domDelta30d != null) {
    const s = clamp(0.5 - domDelta30d / 4, 0, 1) // +2pt/30d → 0, -2pt → 1
    add(0.28, s, 'BTC dominance 30d', `${domDelta30d >= 0 ? '+' : ''}${domDelta30d.toFixed(1)}pt`, domDelta30d > 0.3 ? 'bear' : domDelta30d < -0.3 ? 'bull' : 'neutral')
  }
  // 2) Alt Season Index 30d (weight 0.24)
  if (altSeasonIdx != null) {
    add(0.24, clamp(altSeasonIdx / 100, 0, 1), 'Alt Season Index', `${Math.round(altSeasonIdx)}/100`, altSeasonIdx < 40 ? 'bear' : altSeasonIdx > 60 ? 'bull' : 'neutral')
  }
  // 3) Alt breadth 7d — are alts broadly green (weight 0.2)
  if (breadth7d != null) {
    add(0.2, clamp(breadth7d / 100, 0, 1), 'Alt breadth 7d', `${Math.round(breadth7d)}% green`, breadth7d < 40 ? 'bear' : breadth7d > 60 ? 'bull' : 'neutral')
  }
  // 4) OTHERS2 (long-tail) 7d trend — the tail expanding = capital coming in (0.16)
  if (others2Trend7d != null) {
    const s = clamp(0.5 + others2Trend7d / 20, 0, 1) // +10% → 1, -10% → 0
    add(0.16, s, `Long tail ${winTxt(others2TrendDays)}`, `${others2Trend7d >= 0 ? '+' : ''}${others2Trend7d.toFixed(1)}%`, others2Trend7d > 1 ? 'bull' : others2Trend7d < -1 ? 'bear' : 'neutral')
  }
  // 5) alts vs majors momentum — the rotation tell (weight 0.12)
  if (majorsVsAlts != null) {
    const s = clamp(0.5 + majorsVsAlts / 20, 0, 1)
    add(0.12, s, 'Alts vs majors 7d', `${majorsVsAlts >= 0 ? '+' : ''}${majorsVsAlts.toFixed(1)}pt`, majorsVsAlts > 1 ? 'bull' : majorsVsAlts < -1 ? 'bear' : 'neutral')
  }
  const val = wsum > 0 ? Math.round((score / wsum) * 100) : null
  let band = 'stirring', label = 'Mixed'
  if (val == null) { band = 'unknown'; label = '—' }
  else if (val < 22) { band = 'dead'; label = 'Micros are dead' }
  else if (val < 40) { band = 'notyet'; label = 'Not go time' }
  else if (val < 58) { band = 'stirring'; label = 'Stirring' }
  else if (val < 76) { band = 'rotating'; label = 'Rotating into alts' }
  else { band = 'gotime'; label = 'GO TIME' }
  return { score: val, band, label, reasons, note: verdictNote({ band, domDelta30d, others2Trend7d, onchain }) }
}

// The line under the verdict word. It used to be three hardcoded strings, which
// is how the hero came to print "the long tail bleeding" directly above its own
// chip reading "Long tail 7d +2.8%". Every clause below is read off a number.
function verdictNote({ band, domDelta30d, others2Trend7d, onchain }) {
  if (band === 'unknown') return 'Reading the tape…'
  const domUp = domDelta30d != null && domDelta30d > 0.3
  const tail = others2Trend7d
  const hot = onchain && onchain.ratio >= 1.25
  const cold = onchain && onchain.ratio <= 0.8
  const early = band === 'dead' || band === 'notyet' || band === 'stirring'
  // The front-run case: on-chain has already left while the majors still hold
  // the money. That is the tape on 2026-08-20, and the old copy could not say it.
  if (hot && early) {
    return `On-chain has already moved — DEX volume ${onchain.ratio.toFixed(1)}× its 30-day normal on ${onchain.expanding} of ${onchain.live} chains — while ${domUp ? 'dominance is still climbing' : 'the majors still hold the money'}. That is the early leg, not the confirmation: size it like it can go back to sleep.`
  }
  if (band === 'dead' || band === 'notyet') {
    const tailTxt = tail == null ? 'the long tail flat'
      : tail < -0.5 ? 'the long tail bleeding'
        : tail > 0.5 ? 'the long tail creeping up but not paid for yet'
          : 'the long tail going nowhere'
    return `Capital is still hiding in majors — ${domUp ? 'dominance up' : 'dominance flat'}, ${tailTxt}${cold ? ', on-chain volume under its own 30-day normal' : ''}. Patience pays here; nibble, don’t chase.`
  }
  if (band === 'gotime' || band === 'rotating') {
    return `Money is coming down the curve — breadth turning, the tail expanding${hot ? `, on-chain volume ${onchain.ratio.toFixed(1)}× normal` : ''}. This is when alts get bid from majors.`
  }
  return `Mixed tape — ${domUp ? 'dominance still rising' : 'dominance easing'}, ${tail != null && tail > 0.5 ? 'the tail expanding' : 'the tail flat'}${onchain ? `, on-chain ${onchain.ratio.toFixed(2)}× its 30-day normal` : ''}. Rotation not confirmed; wait for breadth to lead.`
}

// the setup line — the user's exact use case: when majors push, are micros
// getting bid yet? "following" = the long tail expanding over the month.
export function buildSetup({ majorsAvg30d, topMajor, alt30d, others2Trend7d }) {
  if (majorsAvg30d == null) return null
  const following = (alt30d != null && alt30d > 3) || (others2Trend7d != null && others2Trend7d > 2)
  const majorsPushing = majorsAvg30d > 4
  const lead = topMajor
    ? `${topMajor.sym} ${topMajor.chg30d >= 0 ? '+' : ''}${topMajor.chg30d.toFixed(0)}%`
    : `majors ${majorsAvg30d >= 0 ? '+' : ''}${majorsAvg30d.toFixed(0)}%`
  if (majorsPushing && following) return { tone: 'bull', text: `${lead} over 30d and the long tail is following — money is bidding down the curve. Micros getting picked up.` }
  if (majorsPushing && !following) return { tone: 'neutral', text: `${lead} over 30d but micros aren't following — capital parked in majors, not rotating down yet. Watch for the tail to turn.` }
  if (majorsAvg30d < -4) return { tone: 'bear', text: `Majors ${majorsAvg30d.toFixed(0)}% 30d — risk-off up top, no oxygen for micros.` }
  return { tone: 'neutral', text: `Majors flat over 30d (${majorsAvg30d >= 0 ? '+' : ''}${majorsAvg30d.toFixed(0)}%) — no push to spill into the tail yet.` }
}

// OTHERS2 7d trend from the recorded history (timestamp-based, so a gap in the
// series can't silently turn "7 days" into something else).
// ── OTHERS2 is DERIVED: total market cap minus the top 100, i.e. a ~2% sliver
//    left over from subtracting two ~$2.3T numbers whose sources refresh on
//    different cadences. Measured 2026-08-07 on the live tape: 234 moves of
//    >3% in a single 15-minute step across one week, range $41.3B-$58.0B on a
//    ~$51B number. None of that is the long tail moving - it is the arithmetic.
//    The box already publishes the HEADLINE as a rolling median for this
//    reason; the charts have to do the same or the number and the line tell
//    different stories.
//
//    Downsample by TIME into `n` bars and take the MEDIAN of each bar. Median,
//    not mean: a mean lets the outlier drag the very window that exists to
//    remove it. Bars are time-based (not index-based) so a gap in the tape
//    stays a gap instead of being squeezed shut.
//    🪤🪤 THE LAST BAR IS NOT "NOW". Binning by time makes the final bin one
//    full bar wide, so its median is the median of that WINDOW — and the window
//    is a function of the timeframe. Measured 2026-08-20 on the live tape, the
//    same instant printed three different market caps: 24H $53.48B (1h bin),
//    7D $53.33B (4h bin), ALL $52.14B (19h bin) — 2.4% under the $53.42B the
//    header prints six inches above it. Founder saw the number change every
//    time he pressed a timeframe. Pass `current` and the last bar carries the
//    same value the headline does, on every timeframe, like a live candle.
// 🪤🪤 A bin median only denoises when the bin is FAT. On the 24H view a bar
// holds ~4 samples and the median of four noisy prints is still noise: measured
// 2026-08-20, 44% of consecutive 15-min steps in the last day moved more than
// 3%, and the day ranged $41.2B-$59.4B — 1.44x — around a $50.4B median. The
// long tail did not swing 44% in a day; that is the subtraction. A 5-sample
// (75 min) CENTRED rolling median first drops that to 2% of steps and a 1.14x
// day without flattening the intraday shape, which a box-sized ~2h window does.
function rollingMedian(rows, w = 5) {
  if (rows.length < 3) return rows
  const half = Math.floor(w / 2)
  return rows.map((r, i) => {
    const win = rows.slice(Math.max(0, i - half), i + half + 1).map((x) => x.o).sort((a, b) => a - b)
    return { ...r, o: win[Math.floor(win.length / 2)] }
  })
}

export function medianBars(rows, n = 48, current = null) {
  const src = rollingMedian(Array.isArray(rows) ? rows.filter((r) => r && r.ts > 0 && r.o > 0) : [])
  const pin = (out) => {
    const now = num(current)
    if (!(now > 0) || !out.length) return out
    return out.map((b, i) => (i === out.length - 1 ? { ...b, o: now } : b))
  }
  if (src.length < 2 || n < 2) return pin(src)
  const t0 = src[0].ts, t1 = src[src.length - 1].ts
  const span = t1 - t0
  if (span <= 0) return src
  const bins = new Array(n)
  for (const r of src) {
    const i = Math.min(n - 1, Math.floor(((r.ts - t0) / span) * n))
    ;(bins[i] || (bins[i] = [])).push(r)
  }
  const out = []
  for (const bin of bins) {
    if (!bin || !bin.length) continue
    const vals = bin.map((r) => r.o).sort((a, b) => a - b)
    out.push({ ...bin[bin.length - 1], o: vals[Math.floor(vals.length / 2)] })
  }
  return pin(out)
}

// ── SEAMS ───────────────────────────────────────────────────────────────────
// The recorder rejects any 15-min move over 18% as impossible, so a step bigger
// than that in the tape is not the market — it is a SEAM, the moment the
// MEASUREMENT changed. One exists at 2026-08-20 09:30Z: OTHERS2 stopped being
// `total − sum(top 100)` and became a direct sum of ranks 101-2000, because the
// two CoinGecko aggregates the subtraction used disagree by ~0.5% on a $2.45T
// number and had drifted far enough apart that the "long tail" came out
// NEGATIVE for five hours. The level moved $53.5B → $67.1B in one step.
//
// A trend measured across a seam reports the seam: a +25% week no position could
// have captured, printed in the hero and fed to a verdict leg. Never cross one.
// Shorten the window instead, and say how short it is.
const SEAM = 0.18
export function findSeam(history) {
  const hist = Array.isArray(history) ? history.filter((p) => p && p.ts > 0 && num(p.o) > 0) : []
  for (let i = hist.length - 1; i > 0; i--) {
    const a = num(hist[i - 1].o), b = num(hist[i].o)
    if (Math.abs(b - a) / a > SEAM) return hist[i].ts
  }
  return null
}

// CHAIN-LINK the tape across its seams, the way any index is rebased when its
// basket changes. Both sides measure the same thing — the long tail — and differ
// by a scale factor, so the ratio at the seam converts the old basis onto the
// new one: everything before 2026-08-20 09:30Z is lifted by 67.08/53.48 = 1.254.
//
// Refusing to do this is worse than doing it. Left raw, the seam eats the 7d
// trend (no window can span it), it eats the verdict leg that trend feeds, and
// it puts a permanent cliff in the line. It also silently breaks the cycle-depth
// gauge, which compares today against a 2021 peak recorded on the OLD basis —
// that read "63% below peak" the moment the method changed, an improvement that
// happened entirely inside our own arithmetic.
//
// 🪤 A seam is only ever assumed to be a MEASUREMENT change. The recorder rejects
//    any >18% fifteen-minute move as impossible, so it cannot normally write one
//    — but it may after an outage, when the guard is bypassed against a stale
//    anchor, and then a genuinely violent gap would be rebased away. That is the
//    trade: one understated gap, against a cliff that corrupts every read after
//    it. The UI discloses the rebase either way.
export function chainLink(history) {
  const hist = Array.isArray(history) ? history.filter((p) => p && p.ts > 0 && num(p.o) > 0) : []
  if (hist.length < 2) return hist
  const factors = new Array(hist.length).fill(1)
  let f = 1
  for (let i = hist.length - 1; i > 0; i--) {
    const a = num(hist[i - 1].o), b = num(hist[i].o)
    factors[i] = f
    if (Math.abs(b - a) / a > SEAM) f *= b / a
  }
  factors[0] = f
  return factors.every((x) => x === 1) ? hist : hist.map((p, i) => ({ ...p, o: p.o * factors[i] }))
}

// { pct, days } over the trailing window. Links internally — chainLink is a
// no-op on an already-linked series, and a caller who forgets would otherwise
// get today's seam reported as a +31% week.
export function buildTrendWindow(history, current, wantDays = 7) {
  const hist = chainLink(Array.isArray(history) ? history.filter((p) => p && p.ts > 0 && num(p.o) > 0) : [])
  const now = num(current) ?? (hist.length ? num(hist[hist.length - 1].o) : null)
  if (hist.length < 2 || !(now > 0)) return null
  const floorTs = hist[0].ts
  const cutoff = Math.max(Date.now() - wantDays * 864e5, floorTs)
  // 🪤🪤 This used to anchor on ONE 15-minute print. On a series where a quarter
  // of consecutive steps move >3%, that makes the headline a coin flip:
  // measured 2026-08-20, letting the mark land on any row within ±6h of the
  // cutoff put "Long tail 7d" anywhere between +2.3% and +8.3% — same instant,
  // same tape, 6.0 points of spread on a number that prints in the hero and is
  // a verdict leg at weight 0.16. Anchor on the MEDIAN of the rows around the
  // mark instead: same sweep, 1.6 points.
  const win = hist
    .filter((p) => p.ts >= floorTs && Math.abs(p.ts - cutoff) <= 2 * 3600e3)
    .map((p) => num(p.o)).sort((a, b) => a - b)
  let past = null, anchorTs = cutoff
  if (win.length) past = win[Math.floor(win.length / 2)]
  else {
    const row = [...hist].reverse().find((p) => p.ts <= cutoff && p.ts >= floorTs)
      || hist.find((p) => p.ts >= floorTs) || hist[0]
    past = num(row.o); anchorTs = row.ts
  }
  if (!(past > 0)) return null
  const days = (Date.now() - anchorTs) / 864e5
  if (days < 0.5) return null
  return { pct: ((now - past) / past) * 100, days }
}



// CYCLE DEPTH — "how ATL are the micros?" OTHERS2 vs its all-time peak and its
// current-cycle floor. This is the capitulation read: the long tail sits ~70%
// below the 2021 top, near the cycle lows.
export function buildDepth(history, current) {
  // linked for the same reason as the trend: this gauge compares today against a
  // 2021 peak recorded on the OLD basis, so an unlinked seam silently turns "71%
  // below peak · capitulation" into "63% · basing" with nothing having moved.
  const hist = chainLink(Array.isArray(history) ? history : [])
  const now = num(current) ?? (hist.length ? num(hist[hist.length - 1].o) : null)
  if (hist.length <= 8 || !(now > 0)) return null
  const vals = hist.map((p) => num(p.o)).filter((v) => v > 0)
  if (!vals.length) return null
  const ath = Math.max(...vals)
  const athPt = hist.find((p) => num(p.o) === ath)
  const cut = Date.now() - 1300 * 864e5 // ~3.5y = this cycle's floor window
  const recent = hist.filter((p) => p.ts >= cut).map((p) => num(p.o)).filter((v) => v > 0)
  const low = recent.length ? Math.min(...recent) : Math.min(...vals)
  const pctBelowPeak = clamp((1 - now / ath) * 100, 0, 100)
  const posInRange = ath > low ? clamp(((now - low) / (ath - low)) * 100, 0, 100) : 50
  return {
    current: now, ath, low, pctBelowPeak, posInRange,
    athYear: athPt ? new Date(athPt.ts).getUTCFullYear() : null,
    zone: posInRange < 20 ? 'capitulation' : posInRange < 45 ? 'basing' : posInRange < 70 ? 'mid-cycle' : 'elevated',
  }
}
