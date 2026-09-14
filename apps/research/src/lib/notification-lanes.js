/**
 * Notification lanes — the client half of one shared taxonomy.
 *
 * The SERVER is the authority. `/v1/notifications/feed` stamps `lane` on every
 * row and `/v1/notifications/lanes` serves the catalog, so the in-app bell, the
 * Intel Desk and the Telegram bot all mean the same thing by a lane name.
 *
 * This file exists only so the app works BEFORE that ships, and it is written
 * to make itself redundant:
 *   - `laneOf()` returns the server's `lane` untouched whenever it is present.
 *   - `fetchLaneCatalog()` asks the API first and only falls back to LANES here.
 * When the API lands, every derivation below goes cold on its own — no second
 * release, no flag. Keep it that way: this is a bridge, not a second source of
 * truth. If you find yourself tuning a rule here, tune it on the server instead.
 */

// Mirrors src/lib/notification-lanes.js in the data-api. Order is display order.
export const LANES = {
  breaking:  { label: 'Breaking',        hint: 'crypto-native events the tape is already trading', priority: 0,  defaultOn: true },
  headline:  { label: 'Headlines',       hint: 'the story as it drops — no claim that anything moved yet', priority: 1,  defaultOn: false },
  policy:    { label: 'Policy & Data',   hint: 'Fed/ECB/BoJ decisions and the prints that landed', priority: 2,  defaultOn: true },
  systemic:  { label: 'Market Stress',   hint: 'defaults, downgrades, halts, crashes — rare by construction', priority: 3,  defaultOn: true },
  energy:    { label: 'Energy & Supply', hint: 'OPEC, supply shocks, Hormuz, refinery and pipeline hits', priority: 4,  defaultOn: true },
  trade:     { label: 'Trade & Sanctions', hint: 'tariffs, embargoes, export controls', priority: 5,  defaultOn: true },
  listings:  { label: 'New Listings',    hint: 'a major exchange lists or delists — low volume, high consequence', priority: 6,  defaultOn: true },
  runners:   { label: 'Degen Runners',   hint: 'low-cap onchain runners — early social breakouts', priority: 7,  defaultOn: true },
  brain:     { label: 'AI Desk Calls',   hint: 'published Brain desk calls — receipts-tracked', priority: 8,  defaultOn: true },
  social:    { label: 'Social Moves',    hint: 'mention velocity & price-vs-attention splits', priority: 9,  defaultOn: true },
  risk:      { label: 'Risk',            hint: 'fragility warnings, hacks', priority: 10, defaultOn: true },
  stocks:    { label: 'Equities',        hint: 'stock movers & key events', priority: 11, defaultOn: false },
  data:      { label: 'Data Signals',    hint: 'funding & OI anomalies, whale flows, convergence', priority: 12, defaultOn: false },
  pulse:     { label: 'Market Pulse',    hint: 'macro reads, BTC/ETH key levels & big moves', priority: 13, defaultOn: true },
}

// There is deliberately NO geopolitics lane. Founder call 2026-08-18: "leave
// the daily geopolitics out of it since rockets is daily news, so the stuff
// that matters." Measured the same day: of 100 live breaking rows, all four
// that classified as conflict were false positives — two were options
// commentary caught by the word "strikes". A conflict story is a headline. The
// geopolitics that MOVES something arrives as Energy & Supply, because a strike
// on a refinery is a supply event and the market trades the barrel.

const CRYPTO_RX = /\b(bitcoin|btc|ethereum|eth|solana|xrp|crypto|token|altcoin|stablecoin|usdt|usdc|defi|nft|airdrop|staking|halving|mainnet|unlock|delist|listing|binance|coinbase|kraken|bybit|okx|tether|circle|spot etf|sec (?:sues|approves|charges))\b/i
const LISTING_RX = /\b(lists?|listing|will list|delists?|delisting)\b/i
const DERIV_RX = /funding (?:rate|flip)|open interest|long.short|liquidation cascade|orderbook/i
const POLICY_RX = /\b(fed|fomc|powell|ecb|boj|pboc|central bank|interest rates?|basis points?|\bbps\b|cpi|ppi|pce|payrolls?|nonfarm|jobless|unemployment|gdp|inflation)\b/i
const SYSTEMIC_RX = /\b(default|downgrade|credit rating|debt ceiling|shutdown|bank run|insolven|halts? trading|circuit breaker|bailout|flash crash)\b/i
const ENERGY_RX = /\b(oil|crude|brent|wti|opec|barrels?|refiner(?:y|ies)?|pipelines?|natural gas|lng|hormuz|petroleum|tankers?)\b/i
const TRADE_RX = /\b(tariffs?|trade war|sanctions?|export controls?|embargo|duties)\b/i

const SIGNAL_LANE = {
  breakout_radar: 'runners', early_runner: 'runners',
  fragility_warning: 'risk', hack_alert: 'risk',
  brain_call: 'brain', brain_intel: 'brain', alpha_report: 'brain',
  equity_event: 'stocks',
  market_pulse: 'pulse', btc_dominance_shift: 'pulse', fear_greed_extreme: 'pulse',
  social_momentum: 'social', kol_follow: 'social', momentum_divergence: 'social',
  funding_rate_extreme: 'data', volume_spike_cex: 'data', liquidation_cascade: 'data',
  exchange_flow: 'data', smart_money_flow: 'data', stablecoin_flow: 'data',
}

// The bell's own category, for signals that never touch the notifications feed
// (the client-side signal engine emits these directly).
const CATEGORY_LANE = {
  breaking: 'breaking', news: 'headline', whale: 'data', market: 'pulse',
  breakout: 'runners', fragility: 'risk', brain: 'brain',
  calendar: 'policy', watchlist: 'data', 'kol-follow': 'social',
}

/**
 * The lane for one signal. The server's answer always wins; everything below
 * is the bridge for feeds that predate it.
 */
export function laneOf(signal = {}) {
  if (signal.lane && LANES[signal.lane]) return signal.lane
  if (signal.meta?.lane && LANES[signal.meta.lane]) return signal.meta.lane

  const type = signal.meta?.type
  const signalType = signal.meta?.signalType
  const text = `${signal.title || ''} ${signal.detail || ''} ${signal.body || ''}`

  if (signalType && SIGNAL_LANE[signalType]) return SIGNAL_LANE[signalType]
  if (type === 'whale_move' || type === 'convergence') return 'data'

  if (type === 'breaking_news' || signal.category === 'breaking' || signalType === 'macro_news') {
    if (DERIV_RX.test(text)) return 'data'
    if (CRYPTO_RX.test(text) && LISTING_RX.test(text)) return 'listings'
    if (CRYPTO_RX.test(text)) return 'breaking'
    if (SYSTEMIC_RX.test(text)) return 'systemic'
    if (POLICY_RX.test(text)) return 'policy'
    if (ENERGY_RX.test(text)) return 'energy'
    if (TRADE_RX.test(text)) return 'trade'
    return 'headline'   // conflict lands here, by design
  }

  return CATEGORY_LANE[signal.category] || 'headline'
}

/**
 * A funding flip where every number rounds to zero is the detector talking to
 * itself. Measured 2026-08-18: 64 of 100 live breaking rows were these.
 */
export function isDetectorNoise(signal = {}) {
  const text = `${signal.title || ''} ${signal.detail || ''} ${signal.body || ''}`
  if (!DERIV_RX.test(text)) return false
  const nums = text.match(/-?\d+\.\d+\s*%/g) || []
  return nums.length > 0 && nums.every((v) => Math.abs(parseFloat(v)) < 0.001)
}

export function laneCatalog() {
  return Object.entries(LANES)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => a.priority - b.priority)
}

/** Ask the API for the catalog; fall back to the local mirror until it ships. */
export async function fetchLaneCatalog() {
  try {
    const res = await fetch('/data-api/v1/notifications/lanes', { signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const json = await res.json()
      const rows = Array.isArray(json?.data) ? json.data.filter((l) => l?.key) : []
      if (rows.length) return rows
    }
  } catch { /* not deployed yet — the local mirror is the bridge */ }
  return laneCatalog()
}
