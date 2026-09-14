'use strict'
/**
 * Unified, traction-weighted trending scorer + per-chain tuning.
 *
 * SHARED logic for BOTH the dev Express route (packages/server/index.js) and
 * the prod Vercel handler (apps/trading/api/codex.js). Keep the prod mirror
 * (apps/trading/api/_lib/trending-score.js) byte-identical - mirror any change
 * to both, exactly like the existing spectre-data.js pair. (Vercel bundles each
 * serverless fn standalone, so a cross-package require from packages/server
 * does not resolve in prod; duplication is the established pattern here.)
 *
 * Philosophy: rank by REAL traction (activity), not raw price volatility.
 * Volatility ranking surfaces illiquid one-print pumps; traction ranking
 * surfaces tokens people are actually trading (DexScreener-like).
 *
 * Cost note: this is PURE scoring over fields already in hand. It selects
 * NOTHING from Codex. The caller supplies txnCount24 / holders from the
 * existing backfill (spectre-data.js) or - in dev only - a direct select.
 * Missing txns/holders degrade gracefully (weight folds into turnover + momentum).
 */

/**
 * Codex change-field unit is DUAL-FORMAT, verified 2026-06-15 against
 * DexScreener across chains AND magnitudes:
 *   |v| < 1  -> ratio   (0.5082 = 50.8%, 0.867 = 86.7%)    -> x100
 *   |v| >= 1 -> percent (61.24 = 61.24%, 118.875 = 118.9%) -> as-is
 * This is the ONE place that disambiguates. Do NOT re-apply x100 downstream.
 */
function normalizeCodexChange(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return 0
  return Math.abs(n) < 1 ? n * 100 : n
}

const SOLANA = 1399811149

// Per-chain tuning keyed by networkId. Thresholds are CHAIN-RELATIVE: a $30k
// pool is a real market on Solana/Base and dust on Ethereum, so liquidity
// floors, turnover caps and txn caps are expressed per chain rather than as one
// USD number. `default` covers anything unlisted.
const CHAIN_TUNING = {
  // Solana memecoins: fast, Codex often reports liquidity=0, so volume is the
  // real liquidity proxy. Looser liquidity gate, weight activity + holders.
  [SOLANA]: {
    minLiq: 0, minVolIfIlliquid: 30000, minHolders: 0, minTxns: 0,
    strictMinLiq: 12000, // strict gate: drop $0 bonding-curve / tiny-pool tokens
    newbornMinLiq: 20000, // <6h old: needs a real pool before it may appear at all
    washVolMcap: 250,
    w: { txn: 0.31, turn: 0.27, hold: 0.20, mom: 0.22 }, // momentum-weighted: movers rank above flat-high-txn
    txnCap: 50000, turnCap: 30, holderCap: 20000, momCap: 45,
    turnLiqFloor: 5000, volCap: 5e7, megacapStart: 5e8,
  },
  // EVM blue chips + L2s: deeper liquidity, holders meaningful. Weight
  // turnover + holders, lighter momentum (blue chips trend on real flow).
  default: {
    minLiq: 5000, minVolIfIlliquid: 0, minHolders: 0, minTxns: 0,
    strictMinLiq: 5000, // strict gate: deep-liquidity chains, real pools only
    newbornMinLiq: 15000,
    washVolMcap: 50,
    w: { txn: 0.34, turn: 0.30, hold: 0.24, mom: 0.12 },
    txnCap: 5000, turnCap: 12, holderCap: 200000, momCap: 40,
    turnLiqFloor: 10000, volCap: 5e8, megacapStart: 5e8,
  },
}
function chain(networkId, over) {
  CHAIN_TUNING[networkId] = Object.assign({}, CHAIN_TUNING.default, over)
}
// Ethereum: deep pools, expensive gas -> few but LARGE tickets. A low txn cap
// keeps mainnet tokens from being scored as inactive next to a 40k-txn Solana
// memecoin, and a high liquidity floor reflects what a real L1 pool costs.
chain(1, {
  strictMinLiq: 25000, newbornMinLiq: 60000, washVolMcap: 40,
  txnCap: 2500, turnCap: 8, turnLiqFloor: 50000, megacapStart: 1e9,
})
// BSC is spam-heavy -> stricter wash gate + higher strict liquidity floor (the
// per-chain audit found sub-$15k tokens reaching top-15; raising the floor trims
// the thin tail, complementing the now-accurate DexScreener txn counts).
chain(56, { washVolMcap: 40, strictMinLiq: 12000, newbornMinLiq: 20000 })
// Base: cheap gas, memecoin-heavy, mid-depth pools. Between Solana and ETH.
chain(8453, {
  strictMinLiq: 12000, newbornMinLiq: 20000, washVolMcap: 60,
  txnCap: 12000, turnCap: 18, turnLiqFloor: 15000,
  w: { txn: 0.32, turn: 0.28, hold: 0.20, mom: 0.20 },
})
// Arbitrum: cheap gas, DeFi-leaning, decent depth.
chain(42161, { strictMinLiq: 15000, newbornMinLiq: 25000, txnCap: 6000, turnCap: 12, turnLiqFloor: 20000 })
// Optimism: thinner book than Arbitrum, same character.
chain(10, { strictMinLiq: 10000, newbornMinLiq: 20000, txnCap: 4000, turnCap: 12, turnLiqFloor: 15000 })
// Polygon: thin + spam-prone -> tighter wash gate.
chain(137, { strictMinLiq: 8000, newbornMinLiq: 15000, washVolMcap: 45, txnCap: 6000, turnCap: 14 })
// Avalanche: thin book, few real movers.
chain(43114, { strictMinLiq: 8000, newbornMinLiq: 15000, txnCap: 4000, turnCap: 12, turnLiqFloor: 12000 })
// Robinhood Chain: brand new, structurally shallow. Floors scaled to what
// actually exists there, or the chain can never be represented at all.
chain(4663, {
  strictMinLiq: 3000, newbornMinLiq: 6000, washVolMcap: 60,
  txnCap: 3000, turnCap: 15, turnLiqFloor: 5000, megacapStart: 1e8,
})

function cfgFor(networkId) {
  return CHAIN_TUNING[networkId] || CHAIN_TUNING.default
}

// ---- DexScreener-parity eligibility ----
// "Trending" surfaces fresh, actively-traded tokens - NOT the chain's base coin,
// stablecoins, wrapped/staking derivatives, or tokenized stocks. DexScreener's
// trendingScoreH24 never shows SOL/ETH/BNB, USDC/mUSD, WBTC/stETH, or SP500
// xStocks; mirror that. (Blue-chips still live in the separate "Top Coins" tab.)
const NATIVE_WRAPPED_SYMBOLS = new Set([
  // base L1 gas coins
  'SOL', 'ETH', 'BNB', 'MATIC', 'POL', 'AVAX', 'BTC',
  // wrapped natives
  'WSOL', 'WETH', 'WBNB', 'WMATIC', 'WPOL', 'WAVAX', 'WBTC', 'CBBTC', 'BTCB', 'WBETH',
  // liquid-staking / restaking derivatives (not "trending")
  'STETH', 'WSTETH', 'RETH', 'CBETH', 'METH', 'EZETH', 'RSETH', 'WEETH', 'OETH', 'MSETH',
  'SWETH', 'FRXETH', 'SFRXETH', 'JITOSOL', 'MSOL', 'JUPSOL', 'BSOL', 'JSOL', 'INF', 'TBTC', 'JLP',
  'BSDETH', 'ETHX', 'OSETH', 'ANKRETH', 'RSWETH', 'PUFETH', 'MEVETH', 'LSETH', 'UNIETH', 'CMETH', 'WBETH',
])
// Established majors / blue-chips. "Trending" is for DISCOVERY - users come here
// to find what they DON'T already know, not to see JUP/LINK/AAVE/etc. Memecoins
// (PEPE/WIF/BONK...) are deliberately NOT here - they still surface if active.
const MAJOR_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'MATIC', 'POL',
  'UNI', 'ATOM', 'LTC', 'ETC', 'FIL', 'ARB', 'OP', 'NEAR', 'APT', 'SUI', 'INJ', 'TIA', 'SEI',
  'AAVE', 'MKR', 'CRV', 'LDO', 'GRT', 'RENDER', 'RNDR', 'FET', 'TAO', 'ONDO', 'JUP', 'PYTH',
  'TRX', 'TON', 'XLM', 'HBAR', 'ICP', 'SHIB', 'XMR', 'BCH', 'SNX', 'COMP', 'STX', 'IMX', 'KAS',
])
// Major-asset wrapper/derivative names (catches bsdETH "Based ETH", "Staked ETH",
// "Wrapped Bitcoin", "Liquid Staked SOL"...). Whole-word asset match avoids
// false hits like "Ethos" / "Based Brett".
const DERIV_NAME_RE = /\b(staked|wrapped|based|liquid|restaked|yield[- ]?bearing|rocket pool|lido)\b[\s\S]{0,14}\b(eth|ethereum|btc|bitcoin|sol|solana|bnb|avax|matic)\b/i
// Stablecoins (+ commodity-pegged). Reuses the server isSpamToken / frontend
// SKIP_SYMBOLS vocabulary; the price-peg heuristic below catches any unlisted one.
const STABLE_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD', 'USDD', 'PYUSD',
  'EURC', 'EURS', 'USDE', 'SUSDS', 'CUSD', 'XAUT', 'CRVUSD', 'USDTB', 'USD1', 'USDT0',
  'REUSD', 'SUSD', 'USDS', 'FDUSD', 'USDX', 'GHO', 'DOLA', 'MIM', 'MAI', 'ALUSD', 'USDG',
  'RLUSD', 'USDY', 'USR', 'AUSD', 'USDB', 'USDL', 'BUIDL', 'USD0', 'EURT', 'USDM', 'USDAT',
  'USDQ', 'USDF', 'YUSD', 'DEUSD', 'LISUSD', 'USDA', 'MUSD', 'APXUSD', 'FRXUSD', 'SUSDE',
  'SDAI', 'SFRAX', 'PAXG', 'KAU', 'KAG', 'XAUM', 'XAU', 'XAG', 'USN', 'USDH', 'CASH', 'AUSDC',
])
// Tokenized stocks / equities / pre-IPO wrappers (SPYX = "SP500 xStock").
const STOCK_NAME_RE = /x\s?stock|tokenized|backed (stock|equity|share)|\bsp\s?500\b|\bnasdaq\b|\betf\b|pre-?ipo|proshares|direxion|ishares|invesco|\bspdr\b|vaneck|wisdomtree|backpack securities|ultrapro|ultrashort|\bqqq\b|\bspx\b/i

// Behavioural stablecoin catch: price ~ $1 and barely moves across windows.
function isStablePeg(r) {
  const px = num(r.priceUSD != null ? r.priceUSD : r.price)
  if (!(px >= 0.90 && px <= 1.10)) return false
  const c24 = Math.abs(normalizeCodexChange(r.change24))
  const c1 = Math.abs(normalizeCodexChange(r.change1))
  return c24 < 3 && c1 < 1.5
}

// True if the row belongs in a "trending" list at all.
// Robinhood Chain (Arbitrum Orbit L2) is the one network where a tokenized
// equity is the PRODUCT rather than the noise. Everywhere else, an "xStock" /
// "iShares" / "SP500 ETF" wrapper is a synthetic that does not belong on a
// memecoin discovery board - which is what STOCK_NAME_RE removes. On 4663 that
// instinct is exactly inverted: NVDA, SPY, QQQ, SGOV, GLD, SMH and their peers
// are the chain's flagship assets and the reason a user opens the Robinhood
// board at all. Measured 2026-09-08, the regex was silently deleting 16 of them
// from a 344-token roster.
const TOKENIZED_EQUITY_NETWORK = 4663
function isTokenizedEquityChain(r) {
  const netId = (r.token && r.token.networkId != null) ? r.token.networkId : r.networkId
  return Number(netId) === TOKENIZED_EQUITY_NETWORK
}

function isTrendingEligible(r) {
  const t = r.token || {}
  const sym = String(t.symbol || r.symbol || '').toUpperCase().replace(/^\$/, '')
  const name = String(t.name || r.name || '')
  if (!sym) return false
  if (NATIVE_WRAPPED_SYMBOLS.has(sym)) return false
  if (MAJOR_SYMBOLS.has(sym)) return false
  if (STABLE_SYMBOLS.has(sym)) return false
  // Stock exclusion is skipped ONLY on the tokenized-equity chain. Every other
  // exclusion still applies there, so its USDG / WETH / cbBTC / USDC
  // deployments stay off the board exactly as before.
  if ((STOCK_NAME_RE.test(name) || STOCK_NAME_RE.test(sym)) && !isTokenizedEquityChain(r)) return false
  if (DERIV_NAME_RE.test(name)) return false
  if (isStablePeg(r)) return false
  return true
}

// Age in hours from Codex createdAt (sec or ms). null when unknown - callers
// must treat null as "no opinion", never as "old".
function ageHours(createdAt) {
  let ts = Number(createdAt)
  if (!isFinite(ts) || ts <= 0) return null
  if (ts < 1e12) ts *= 1000 // seconds -> ms
  const h = (Date.now() - ts) / 3600000
  return h >= 0 ? h : null
}

// Freshness shaping. The curve PEAKS in the 1-5 day band - that is where new
// plays are discoverable but no longer in the first-hours rug window - and
// deliberately does NOT peak at "newest", because the riskiest tokens are the
// youngest (they also face the newborn gate in scoreTraction).
// Beyond 90d the factor dips below 1: an established token is welcome on the
// board, but it has to earn its place on momentum rather than on inertia.
function ageFactor(createdAt) {
  const h = ageHours(createdAt)
  if (h == null) return 1
  if (h <= 6) return 1.15    // brand new - gated hard elsewhere, not boosted here
  if (h <= 24) return 1.30
  if (h <= 120) return 1.45  // 1-5 days: the target band
  if (h <= 336) return 1.25  // 5-14 days
  if (h <= 720) return 1.10  // 14-30 days
  if (h <= 2160) return 0.92 // 1-3 months
  return 0.80                // older: no free pass, must out-move the field
}

// Minimum 24h/6h price move (percent) required to count as "trending", scaled
// by age. Unknown age gets the young bar - never punish missing data.
function moveBar(ageHrs) {
  if (ageHrs == null) return 6
  if (ageHrs <= 120) return 6    // <=5 days: the target band, lowest bar
  if (ageHrs <= 720) return 8    // 5-30 days
  if (ageHrs <= 2160) return 12  // 1-3 months
  return 20                      // older: has to genuinely move
}

// Acceleration from recentVolRatio (6h vol / 24h vol). Uniform = 0.25; above =
// accelerating (boost), well below = a fading pump (penalty). null -> neutral.
function accelFactor(recentVolRatio) {
  const v = Number(recentVolRatio)
  if (!isFinite(v)) return 1
  if (v >= 0.50) return 1.25
  if (v >= 0.35) return 1.15
  if (v >= 0.22) return 1.05
  if (v >= 0.10) return 1
  return 0.85
}

// Window key -> change field, for the momentum component + timeframe ranking.
// 6h uses change6h (DexScreener h6, merged in the route) to match DexScreener's
// columns; Codex has no native 6h window.
const WINDOW_FIELD = { '5m': 'change5m', '1h': 'change1', '6h': 'change6h', '24h': 'change24' }
// Hours each window spans - used to reject changes a token is too young to have.
const WINDOW_HOURS = { '5m': 1 / 12, '1h': 1, '6h': 6, '24h': 24 }

/**
 * Change over `win`, or null when the token has not existed long enough for the
 * number to mean anything. A 1-hour-old token's "24h change" is measured from
 * its own first print, so it reports the launch itself: GOAP showed +10,582% at
 * 1h old and GME +90,688% at 1h. Those are not 100x moves, they are the token
 * coming into existence, and ranking on them puts pure launch artifacts on the
 * board. Tokens with no known age keep every window (never punish missing data).
 */
function changeOverWindow(r, win, ageHrs) {
  const need = WINDOW_HOURS[win]
  if (ageHrs != null && need != null && ageHrs < need * 0.8) return null
  const field = WINDOW_FIELD[win]
  if (!field) return null
  const raw = r[field]
  if (raw == null) return null
  return normalizeCodexChange(raw)
}

function num(x) { const n = parseFloat(x); return Number.isFinite(n) ? n : 0 }

function logNorm(x, cap) {
  const v = Math.max(0, Number(x) || 0)
  if (cap <= 0) return 0
  return Math.min(1, Math.log10(1 + v) / Math.log10(1 + cap))
}

function megacapMultiplier(mcap, start) {
  if (mcap > 5e9) return 0.15
  if (mcap > 1e9) return 0.35
  if (mcap > start) return 0.6
  return 1
}

// ---- Quality (continuous demotion, NOT a binary drop) ----
//
// Every hard gate we added historically had to be loosened until it caught
// nothing, because a single false positive deletes a real viral token (ANSEM at
// 317x vol/liq, QUIP at 371x - both legitimate, both would die to a tight drop
// rule). So suspicion DEMOTES here and only the egregious cases still drop in
// token-safety.js. That is what lets these thresholds be genuinely tight.
//
// Organising principle: every farmable metric is a COUNT (txns, volume, makers,
// holders); every hard-to-fake metric is CAPITAL AT RISK (liquidity, vol/liq,
// liq/mcap), a TIMESTAMP, or an executed on-chain simulation. Everything below
// scores ratios and on-chain state - never counts.

// Log-interpolate `x` across [lo, hi] onto [1, floor]. Below lo = clean.
function taper(x, lo, hi, floor) {
  if (!(x > lo)) return 1
  if (x >= hi) return floor
  const t = (Math.log10(x) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))
  return 1 - (1 - floor) * t
}

// Churn: volume far above the pool that has to absorb it. Real trading tops out
// around 10x/day; 40-160x is the wash band the old 400x drop rule never saw.
function volLiqFactor(vol, liq) {
  if (!(liq > 0) || !(vol > 0)) return 1 // unknown -> neutral, never punish missing data
  return taper(vol / liq, 10, 160, 0.30)
}

// Depth vs valuation. Thin liquidity under a large cap is the exit-liquidity
// signature (BANK: $130k pool under a $107M cap = 0.12%). Also the copycat
// tell - real tokens sit at mcap/liq 2-10x, impersonators at 147x-1674x.
function liqDepthFactor(liq, mcap) {
  if (!(mcap > 0) || !(liq > 0)) return 1
  const pct = (liq / mcap) * 100
  if (pct >= 3) return 1
  if (pct <= 0.5) return 0.35
  return 0.35 + 0.65 * ((pct - 0.5) / 2.5)
}

// One-sided flow. A near-pure-buy tape means either a honeypot (sells revert)
// or a bot ladder. Free signal - buys24/sells24 are already fetched.
function flowBalanceFactor(buys, sells) {
  const b = num(buys), s = num(sells)
  const total = b + s
  if (total < 50) return 1 // too few trades to read anything into
  const skew = Math.abs(b - s) / total
  if (skew <= 0.55) return 1
  if (skew >= 0.90) return 0.35
  return 1 - 0.65 * ((skew - 0.55) / 0.35)
}

// Average ticket. Thousands of ~$1 trades is a farm, not a market.
function ticketFactor(vol, txns) {
  if (txns == null || txns < 500 || !(vol > 0)) return 1
  const per = vol / txns
  if (per >= 8) return 1
  if (per <= 1) return 0.35
  return 0.35 + 0.65 * ((per - 1) / 7)
}

// Absurd prints. A +198,000% row is a pricing artifact on a dead pool, not a
// 1980x move; cap what it can contribute without dropping genuine 10x days.
function printSanityFactor(r, ageHrs) {
  const v = changeOverWindow(r, '24h', ageHrs)
  if (v == null) return 1 // too young to span 24h - already excluded from ranking
  const c24 = Math.abs(v)
  if (c24 <= 3000) return 1
  if (c24 >= 50000) return 0.40
  return 1 - 0.60 * ((c24 - 3000) / 47000)
}

// A market cap that dwarfs the volume supporting it. GME arrived on the board
// claiming $42.3M at ONE HOUR old on $275k of trading, and GOAP $3.4M on $82k -
// a cap that size has to trade to be real. Only applies above $2M, where a cap
// is a claim worth testing; genuinely small tokens legitimately trade thin.
function capVsFlowFactor(mcap, vol) {
  if (!(mcap > 2e6) || !(vol > 0)) return 1
  const share = vol / mcap
  if (share >= 0.05) return 1
  if (share <= 0.005) return 0.40
  return 0.40 + 0.60 * ((share - 0.005) / 0.045)
}

// A price move has to be PAID FOR. LARP arrived at +3,817% on 6% turnover and
// KYLE at +5,440% on 10% - a few thousand dollars walked up a thin book, which
// is a very different event from ANMOND doing +4,259% on 561% turnover. Only
// judges moves big enough to need corroboration; ordinary moves pass untouched.
function moveSupportFactor(r, mcap, vol, ageHrs) {
  let c = changeOverWindow(r, '24h', ageHrs)
  if (c == null) c = changeOverWindow(r, '6h', ageHrs)
  if (c == null) c = changeOverWindow(r, '1h', ageHrs)
  if (c == null || Math.abs(c) < 200) return 1
  if (!(mcap > 0) || !(vol > 0)) return 1
  const turn = vol / mcap
  if (turn >= 0.5) return 1
  if (turn <= 0.05) return 0.35
  return 0.35 + 0.65 * ((turn - 0.05) / 0.45)
}

// A confirmed identity squat (see lib/token-impersonation.js). Sits at the
// quality floor rather than being scored - the row survives only so the board
// can show WHAT it is impersonating.
function impersonationFactor(imp) {
  if (!imp) return 1
  return imp.kind === 'namesquat' ? 0.15 : 0.30
}

// Post-collapse husks. The movement gate is absolute-value by design (a big
// dump IS news), but a token down 70-90% in a day is a rug that ALREADY
// happened, not something to put at the top of a discovery board - DexScreener's
// own board carries ~9 of them. The dust ones die to the liquidity floor; the
// ones that kept a pool need this. Healthy retraces after a run are untouched.
function collapseFactor(r, ageHrs) {
  const c24 = changeOverWindow(r, '24h', ageHrs)
  if (c24 == null || c24 >= -50) return 1
  // Down 85%+ is not a trend, it is a token that already died - and these can
  // carry ENORMOUS turnover on the way down (goldentoad at 2245%, PEPG at 477%),
  // which is exactly what would otherwise rank them mid-board. Floor them.
  if (c24 <= -85) return 0.18
  return 1 - 0.82 * ((-c24 - 50) / 35)
}

// On-chain state from the security providers (token-safety.js attaches it as
// `_safety`). Warn-level findings demote; only fatal ones drop, upstream.
function securityFactor(sec) {
  if (!sec) return 1
  let f = 1
  if (sec.lpLocked === false) f *= 0.75
  if (sec.mintAuthority) f *= 0.70
  if (sec.freezeAuthority) f *= 0.70
  // NOTE: top10Pct MUST already exclude the AMM pool / bonding-curve address -
  // a healthy pump.fun token shows ~70% held by its own pool. token-safety.js
  // filters it; never feed a raw top-holder percentage in here.
  const t10 = Number(sec.top10Pct)
  if (Number.isFinite(t10)) {
    if (t10 >= 60) f *= 0.55
    else if (t10 >= 40) f *= 0.80
  }
  const tax = Number(sec.maxTaxPct)
  if (Number.isFinite(tax)) {
    if (tax >= 10) f *= 0.55
    else if (tax >= 5) f *= 0.80
  }
  if (num(sec.warnCount) >= 3) f *= 0.80
  return Math.max(0.25, f)
}

const QUALITY_FLOOR = 0.15

/**
 * Continuous quality multiplier for one row.
 * @returns {{ factor: number, reasons: string[] }} factor in [0.15, 1]; reasons
 *   are short human strings for the UI ("vol/liq 63x", "98% buys") so the board
 *   teaches instead of silently filtering - and so calibration is debuggable.
 */
function qualityFactor(r) {
  const vol = num(r.volume24 != null ? r.volume24 : (r.volume24h != null ? r.volume24h : r.volume))
  const liq = num(r.liquidity)
  const mcap = num(r.marketCap)
  const txns = r.txnCount24 != null ? num(r.txnCount24) : null
  const sec = r._safety
  const ageHrs = ageHours(r.createdAt)
  const imp = r._impersonates

  const parts = [
    volLiqFactor(vol, liq),
    liqDepthFactor(liq, mcap),
    flowBalanceFactor(r.buys24, r.sells24),
    ticketFactor(vol, txns),
    printSanityFactor(r, ageHrs),
    securityFactor(sec),
    collapseFactor(r, ageHrs),
    capVsFlowFactor(mcap, vol),
    impersonationFactor(imp),
    moveSupportFactor(r, mcap, vol, ageHrs),
  ]
  const factor = Math.max(QUALITY_FLOOR, parts.reduce((a, b) => a * b, 1))

  const reasons = []
  if (parts[0] < 0.95) reasons.push(`vol/liq ${Math.round(vol / liq)}x`)
  if (parts[1] < 0.95) reasons.push(`liq ${((liq / mcap) * 100).toFixed(1)}% of mcap`)
  if (parts[2] < 0.95) {
    const b = num(r.buys24), s = num(r.sells24)
    const pct = Math.round((Math.max(b, s) / (b + s)) * 100)
    reasons.push(`${pct}% ${b >= s ? 'buys' : 'sells'}`)
  }
  if (parts[3] < 0.95) reasons.push(`$${(vol / txns).toFixed(1)}/txn`)
  if (parts[4] < 0.95) reasons.push('outlier print')
  if (parts[5] < 0.95 && sec) {
    if (sec.lpLocked === false) reasons.push('LP unlocked')
    if (sec.mintAuthority) reasons.push('mint authority live')
    if (sec.freezeAuthority) reasons.push('freeze authority live')
    if (Number(sec.top10Pct) >= 40) reasons.push(`top-10 ${Math.round(sec.top10Pct)}%`)
    if (Number(sec.maxTaxPct) >= 5) reasons.push(`${Math.round(sec.maxTaxPct)}% tax`)
  }
  if (parts[6] < 0.95) reasons.push(`down ${Math.round(-changeOverWindow(r, '24h', ageHrs))}% in 24h`)
  if (parts[7] < 0.95) reasons.push(`$${(mcap / 1e6).toFixed(0)}M cap on $${(vol / 1e3).toFixed(0)}k volume`)
  if (imp) {
    reasons.push(imp.kind === 'namesquat'
      ? `impersonates ${imp.symbol} ($${(imp.marketCap / 1e6).toFixed(0)}M, ${imp.ageDays}d)`
      : `squats the ${imp.symbol} ticker ($${(imp.marketCap / 1e6).toFixed(0)}M, ${imp.ageDays}d)`)
  }
  if (parts[9] < 0.95) reasons.push(`big move on ${Math.round((vol / mcap) * 100)}% turnover`)
  return { factor, reasons }
}

/**
 * Traction score for one Codex result row.
 * @param {object} r - row with token{networkId}, volume24, liquidity, marketCap,
 *   holders, txnCount24, change5m/change1/change4/change24
 * @param {object} [opts] - { window: '5m'|'1h'|'4h'|'24h' } momentum window (default 24h)
 * @returns {number} score (>=0; 0 means gated out)
 */
function scoreTraction(r, opts) {
  const o = opts || {}
  const networkId = (r.token && r.token.networkId != null) ? r.token.networkId : r.networkId
  const cfg = cfgFor(networkId)
  const window = (o.window && WINDOW_FIELD[o.window]) ? o.window : '24h'

  const vol = num(r.volume24 != null ? r.volume24 : (r.volume24h != null ? r.volume24h : r.volume))
  const liq = num(r.liquidity)
  const mcap = num(r.marketCap)
  const txns = r.txnCount24 != null ? num(r.txnCount24) : null
  const holders = r.holders != null ? num(r.holders) : null

  // ---- Hard gates (STRICT mode) ----
  // Trending shows only LIVE, fully-enriched tokens so every column is populated
  // (no "-", no fake-0%). A token must be DexScreener-enriched (complete columns)
  // AND have real liquidity AND be trading right now. This drops semi-dead
  // pump.fun / bonding-curve tokens (pumped early, stopped trading 1-4h ago)
  // whose 0%/$0 are real-but-incomplete. `r._dexEnriched` is set in the route
  // merge when DexScreener returned data for the address.
  if (!isTrendingEligible(r)) return 0                    // base coin / stablecoin / wrapped / tokenized stock -> never "trending"
  const enriched = r._dexEnriched === true
  // "Live now" for a 24h board = traded in the last hour OR >=12% of 24h volume
  // happened in the last 6h. The pure last-1h check was too strict (dropped tokens
  // active all day but quiet for one hour); the 6h-share still excludes DEAD pumps
  // (pumped early, then stopped) whose recentVolRatio collapses toward 0.
  const recentActive = num(r.txns1h) > 0 || num(r.vol1h) > 0 || num(r.recentVolRatio) >= 0.12
  if (!enriched) return 0                                 // no DexScreener data -> incomplete columns
  // Strict liquidity floor. opts.relaxLiq lowers it to a minimal real-pool floor
  // so a thin chain can fill a full board (still enriched + recent-active +
  // MOVING, just lower liquidity) instead of returning <30 rows.
  // The relaxed floor is an ABSOLUTE floor, not a token one: the rugged husks on
  // DexScreener's own board sit at liq ~= mcap ~= $3k, which passes every RATIO
  // test (1x) precisely because both sides are dust. Only a dollar floor catches
  // that shape.
  if (o.relaxLiq) { if (liq < 5000) return 0 }
  else if (liq < (cfg.strictMinLiq || 0)) return 0
  if (!recentActive) return 0                             // dead pump (no recent trades) -> fake 0% short-windows
  // Trending = MOVING. This gate is UNCONDITIONAL - it is the whole definition
  // of the board. The fill tier used to skip it so a thin chain could pad itself
  // from its most-active tokens; measured on the live board that single bypass
  // was responsible for 55% of rows being flat month-old large caps (UB at $305M
  // and 0.0% over 24h ranked #24). A row may relax its LIQUIDITY to fill a
  // board; it may never relax its MOVEMENT. A short board beats a padded one.
  // The bar SCALES WITH AGE. A 3-day-old token moving 7% is news; a 4-year-old
  // large cap moving 7% is Tuesday. Without this an "All chains" board fills
  // with established ETH/BSC tokens wiggling just over a flat threshold - 62% of
  // the board older than 90 days in the first measured run - which is the exact
  // opposite of what a trending board is for. Old tokens are NOT excluded; they
  // have to actually move to earn the slot.
  const ageH = ageHours(r.createdAt)
  const bar = moveBar(ageH)
  const c24 = changeOverWindow(r, '24h', ageH)
  const c6 = changeOverWindow(r, '6h', ageH)
  const c1 = changeOverWindow(r, '1h', ageH)
  const moved = (c24 != null && Math.abs(c24) >= bar)
             || (c6 != null && Math.abs(c6) >= bar)
             || (c1 != null && Math.abs(c1) >= bar * 0.85)
  // ...OR the tape is simply busy. Price is not the only way to trend: measured
  // against DexScreener's own board, their SOL #4 (Jimothy, $17.1M volume on a
  // $32.8M cap across 93k txns) is nearly FLAT on price and we were dropping it,
  // while their #1 on BSC (ARK) turns over 29% of its cap a day. What separates
  // those from the flat large caps this gate exists to block is turnover
  // RELATIVE TO SIZE - the padding rows sat at 3-4% (UB 3.3%, BANK 3.7%,
  // OLY 0.5%), the real ones at 29-660%. So volume worth a quarter of the market
  // cap in a day qualifies on its own.
  // opts.allowFlat serves the labeled "also active" tail ONLY (see the route).
  // Those rows still clear every other gate - eligibility, enrichment, liquidity,
  // recent activity, wash, newborn, safety, impersonation - and are scored into a
  // band strictly below every mover. A flat row must never reach the board
  // unlabeled; that was the original defect.
  const turnover = mcap > 0 ? vol / mcap : 0
  if (!moved && turnover < 0.25 && !o.allowFlat) return 0
  if (mcap > 0 && vol / mcap > cfg.washVolMcap) return 0  // wash trading
  // Newborn gate: the first hours are where rugs live, so a <6h token must show
  // a real pool and two-sided flow before it may appear at ALL. Everything that
  // survives is then boosted by ageFactor - risk gate first, recency reward
  // after.
  if (ageH != null && ageH < 6) {
    if (liq < (cfg.newbornMinLiq || 15000)) return 0
    const b = num(r.buys24), s = num(r.sells24)
    if (b + s >= 50 && Math.abs(b - s) / (b + s) > 0.85) return 0
    if (r._safety && r._safety.risk === 'high') return 0
  }

  // ---- Signals (0..1) ----
  const sTxn = txns != null ? logNorm(txns, cfg.txnCap) : 0
  // Turnover when liquidity is reliable; else rank by volume MAGNITUDE so the
  // signal still discriminates. Codex reports liquidity=0 for most Solana
  // tokens, which would otherwise saturate vol/turnLiqFloor to 1.0 for every
  // active token (the all-tied-at-1.0 bug seen in the first preview).
  const sTurn = liq >= cfg.turnLiqFloor
    ? logNorm(vol / liq, cfg.turnCap)
    : logNorm(vol, cfg.volCap)
  const sHold = holders != null ? logNorm(holders, cfg.holderCap) : 0
  // Rank on the requested window when the token spans it, else fall back to the
  // longest window it DOES span, so a 2-hour-old token is ranked on its 1h move
  // rather than on the launch print its "24h" column actually contains.
  let mom = changeOverWindow(r, window, ageH)
  if (mom == null) {
    for (const w of ['6h', '1h', '5m']) {
      const v = changeOverWindow(r, w, ageH)
      if (v != null) { mom = v; break }
    }
  }
  const sMom = Math.min(1, Math.abs(mom || 0) / cfg.momCap)

  // Graceful degrade: if txns/holders are unavailable, fold their weight into
  // turnover + momentum so the score collapses to a volume/momentum blend
  // rather than zeroing the activity dimension.
  let wTxn = cfg.w.txn, wTurn = cfg.w.turn, wHold = cfg.w.hold, wMom = cfg.w.mom
  if (txns == null) { wTurn += wTxn * 0.6; wMom += wTxn * 0.4; wTxn = 0 }
  if (holders == null) { wTurn += wHold * 0.6; wMom += wHold * 0.4; wHold = 0 }

  let score = wTxn * sTxn + wTurn * sTurn + wHold * sHold + wMom * sMom

  // ---- Penalties + recency/acceleration ----
  score *= megacapMultiplier(mcap, cfg.megacapStart)
  score *= ageFactor(r.createdAt)         // 1-5d peak (see ageFactor)
  score *= accelFactor(r.recentVolRatio)  // accelerating > fading pump

  // Quality demotion last, so it scales the finished score. `annotate` writes
  // the reasons back onto the row for the UI - same private-underscore
  // convention the route already uses for `_dexEnriched`.
  const q = qualityFactor(r)
  score *= q.factor
  if (o.annotate) r._quality = q

  return score
}

/**
 * Which gate rejected this row, or null if it scored. Pure re-derivation of
 * scoreTraction's gates for DIAGNOSTICS - a short board is either honest
 * scarcity or over-gating, and guessing between those two is how calibration
 * goes wrong. Keep in step with scoreTraction.
 */
function gateReason(r, opts) {
  const o = opts || {}
  const networkId = (r.token && r.token.networkId != null) ? r.token.networkId : r.networkId
  const cfg = cfgFor(networkId)
  const vol = num(r.volume24 != null ? r.volume24 : (r.volume24h != null ? r.volume24h : r.volume))
  const liq = num(r.liquidity)
  const mcap = num(r.marketCap)
  if (!isTrendingEligible(r)) return 'ineligible'
  if (r._dexEnriched !== true) return 'not-enriched'
  if (o.relaxLiq ? liq < 5000 : liq < (cfg.strictMinLiq || 0)) return 'liquidity-floor'
  if (!(num(r.txns1h) > 0 || num(r.vol1h) > 0 || num(r.recentVolRatio) >= 0.12)) return 'not-recently-active'
  const ageH = ageHours(r.createdAt)
  const bar = moveBar(ageH)
  const c24 = changeOverWindow(r, '24h', ageH)
  const c6 = changeOverWindow(r, '6h', ageH)
  const c1 = changeOverWindow(r, '1h', ageH)
  const moved = (c24 != null && Math.abs(c24) >= bar)
             || (c6 != null && Math.abs(c6) >= bar)
             || (c1 != null && Math.abs(c1) >= bar * 0.85)
  const turnover = mcap > 0 ? vol / mcap : 0
  if (!moved && turnover < 0.25) return 'flat-and-quiet'
  if (mcap > 0 && vol / mcap > cfg.washVolMcap) return 'wash'
  if (ageH != null && ageH < 6) {
    if (liq < (cfg.newbornMinLiq || 15000)) return 'newborn-thin-pool'
    const b = num(r.buys24), s = num(r.sells24)
    if (b + s >= 50 && Math.abs(b - s) / (b + s) > 0.85) return 'newborn-one-sided'
    if (r._safety && r._safety.risk === 'high') return 'newborn-high-risk'
  }
  return null
}

module.exports = {
  scoreTraction, qualityFactor, gateReason, normalizeCodexChange, isTrendingEligible,
  ageHours, ageFactor, moveBar, CHAIN_TUNING, WINDOW_FIELD, cfgFor,
}
