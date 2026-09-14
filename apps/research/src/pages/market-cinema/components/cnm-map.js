/**
 * cnm-map — event normalisation, the whale label grammar, and the formatters.
 *
 * PURE. No DOM, no React, no canvas, no clock reads except where a `now` is
 * passed in. Everything here is unit-testable with plain node, and it is the
 * only place that decides what an event MEANS. cnm-scene.js decides how it
 * looks; this file decides what it is.
 *
 * Packet §"Event → visual mapping" and §"Formatting".
 */

/* ─────────────────────────────────────────────────────────────────────────
   Thresholds
   ───────────────────────────────────────────────────────────────────────── */

// User-cyclable floor. Default is $1k. The raw tape is dust-heavy (measured
// 2026-08-13, two samples: 500 rows / 17 min, median $311, 58 rows ≥ $5k; and
// 500 rows / 26.5 min, median $200, 121 rows ≥ $1k against 56 rows ≥ $5k). The
// $1k step therefore roughly DOUBLES what reaches the stage while every drawn
// drop is still a real close — the dust below it is counted, never invented.
export const FLOOR_STEPS = [250, 1000, 5000, 25000, 100000]
// $250 default: the live tape's median event is ~$200, so this is the
// step where the stage reads as continuous real rain (founder: immersive).
export const DEFAULT_FLOOR = 250

export const LIQ_RING_FLOOR = 250000     // +1px ring, and an event-log row
export const LIQ_RIPPLE_FLOOR = 1000000  // + one-shot horizon ripple

export const WHALE_TIERS = [1000000, 10000000, 50000000] // three tiers, stroke+trail only
export const WHALE_LOG_FLOOR = 10000000  // event-log row with BOTH labels verbatim

/* ─────────────────────────────────────────────────────────────────────────
   Label grammar
   ───────────────────────────────────────────────────────────────────────── */

const ISSUER_RE = /issuer/i
const NULL_ADDRESS_RE = /null address/i
const EXCHANGE_RE = /\b(binance|coinbase|kraken|okx|okex|bybit|bitfinex|huobi|htx|kucoin|gate\.?io|crypto\.com|mexc|bitget|upbit|bithumb|gemini|bitstamp|robinhood|deribit|bitflyer|bitmex|poloniex|bitmart|whitebit)\b/i

// The feed labels a counterparty with its RAW ADDRESS when it has no name for
// it (measured: 24 of 100 label slots in one /smart-money/whale-transactions
// page were bare `bc1…` / `3…` / `1…` strings). An address is not a name, so
// these classify as unknown — the same as a null label. Anything else is a
// human-readable place and is printed verbatim.
const RAW_ADDRESS_RE = /^(0x[0-9a-fA-F]{8,}|bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{24,}|T[A-Za-z0-9]{32,}|[1-9A-HJ-NP-Za-km-z]{32,44})$/

/** A named place, or null when the counterparty is an unnamed wallet. */
export function labelName(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  if (RAW_ADDRESS_RE.test(s)) return null
  return s
}

export const UNKNOWN_WALLET = 'unknown wallet' // lowercase, verbatim from packet

function exchangeOf(name) {
  if (!name) return null
  const m = EXCHANGE_RE.exec(name)
  return m ? name : null
}

/**
 * Classify a whale transfer BY LABEL, never by tx_type.
 *
 * Order matters. Burn is tested before mint so a `Circle (USDC issuer) →
 * Null Address` row reads as the burn it is; issuer-in (a redemption) is
 * tested before the exchange rules so a fully-named Circle return does not
 * fall through to "unknown wallet".
 *
 * DEVIATION (documented): the packet names five classes. The live feed carries
 * a sixth that is neither — `to_label` IS the issuer (14 of 50 rows measured
 * 2026-08-13: USDC returning to Circle). Calling a transfer with two named
 * ends "unknown" would be dishonest, and the packet's own direction grammar
 * (left = issuance) already has a home for it: it travels R→L back to the
 * issuance rail, achromatic, like a burn but with a named destination.
 */
export function classifyWhale(row) {
  const from = labelName(row?.from_label)
  const to = labelName(row?.to_label)

  if (to && NULL_ADDRESS_RE.test(to)) {
    return { cls: 'burn', dir: 'rtl', from, to, leftLabel: null, rightLabel: from, tint: null }
  }
  // A transfer OUT of the zero address is a mint in the same sense an issuer
  // send is: the left rail is where supply comes from.
  if (from && (ISSUER_RE.test(from) || NULL_ADDRESS_RE.test(from))) {
    return { cls: 'mint', dir: 'ltr', from, to, leftLabel: from, rightLabel: to, tint: null }
  }
  if (to && ISSUER_RE.test(to)) {
    return { cls: 'redeem', dir: 'rtl', from, to, leftLabel: to, rightLabel: from, tint: null }
  }
  if (exchangeOf(to)) {
    return { cls: 'deposit', dir: 'ltr', from, to, leftLabel: from, rightLabel: to, tint: 'bear' }
  }
  if (exchangeOf(from)) {
    return { cls: 'withdrawal', dir: 'rtl', from, to, leftLabel: to, rightLabel: from, tint: 'bull' }
  }
  return { cls: 'unknown', dir: 'ltr', from, to, leftLabel: null, rightLabel: null, tint: null }
}

/** The log line: both ends verbatim, `unknown wallet` where the feed has none. */
export function whaleLine(c) {
  return `${c.from || UNKNOWN_WALLET} → ${c.to || UNKNOWN_WALLET}`
}

const CLS_WORD = {
  mint: 'mint',
  burn: 'burn',
  redeem: 'return',
  deposit: 'in',
  withdrawal: 'out',
  unknown: '—',
}
export function whaleWord(cls) { return CLS_WORD[cls] || '—' }

/* ─────────────────────────────────────────────────────────────────────────
   Normalisation
   ───────────────────────────────────────────────────────────────────────── */

function parseTs(row) {
  const iso = row?.time
  if (typeof iso === 'string') {
    const t = Date.parse(iso)
    if (Number.isFinite(t)) return t
  }
  const unix = Number(row?.time_unix)
  if (Number.isFinite(unix) && unix > 0) return unix * 1000
  return NaN
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Cheap deterministic 32-bit hash — gives each event a stable lane/x seed. */
export function hashId(str) {
  let h = 2166136261
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0)
}

/**
 * Liquidation row → scene event. Radius is the packet's curve at 1.35× scale,
 * still referenced to a fixed $5k (NOT the active floor) so a drop keeps the
 * same size when the user cycles the floor. The 2.5px minimum is the size the
 * new $1k–$4k rain draws at: present, but unmistakably the smallest thing on
 * the stage. `exchange` is carried for the log line only — never encoded
 * visually.
 */
export function normalizeLiq(row) {
  const t = parseTs(row)
  if (!Number.isFinite(t)) return null
  const usd = num(row.usd_value)
  if (usd <= 0) return null
  const asset = String(row.asset || '').toUpperCase()
  const side = row.side === 'short' ? 'short' : 'long'
  const id = `l:${t}:${asset}:${row.exchange}:${side}:${usd}`
  return {
    kind: 'liq',
    id,
    seed: hashId(id),
    t,
    asset,
    exchange: String(row.exchange || ''),
    side,
    usd,
    price: num(row.price),
    radius: Math.min(26, Math.max(2.5, 2.7 + 5.67 * Math.log10(Math.max(usd, 1000) / 5000))),
    ring: usd >= LIQ_RING_FLOOR,
    ripple: usd >= LIQ_RIPPLE_FLOOR,
    logged: usd >= LIQ_RING_FLOOR,
  }
}

/** Whale row → scene event. */
export function normalizeWhale(row) {
  const t = parseTs(row)
  if (!Number.isFinite(t)) return null
  const usd = num(row.amount_usd)
  if (usd <= 0) return null
  const c = classifyWhale(row)
  const id = `w:${row.tx_hash || `${t}:${row.asset}:${usd}`}`
  const tier = usd >= WHALE_TIERS[2] ? 3 : usd >= WHALE_TIERS[1] ? 2 : 1
  return {
    kind: 'whale',
    id,
    seed: hashId(id),
    t,
    asset: String(row.asset || '').toUpperCase(),
    chain: String(row.chain || ''),
    usd,
    cls: c.cls,
    dir: c.dir,
    tint: c.tint,
    from: c.from,
    to: c.to,
    leftLabel: c.leftLabel,
    rightLabel: c.rightLabel,
    line: whaleLine(c),
    // 1.5× the packet's curve. The lane is the page's crown jewel and it was
    // reading as hairlines; the scene derives head size and trail length from
    // this, so widening it here widens the whole streak coherently.
    stroke: Math.min(7.5, Math.max(1.5, 1.5 + 2.4 * Math.log10(Math.max(usd, 100000) / 100000))),
    tier,
    // Unknown transfers are drawn but not narrated (packet): no log row, no
    // rail plate — they are texture, not statements.
    logged: usd >= WHALE_LOG_FLOOR && c.cls !== 'unknown',
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   Formatting — packet §"Formatting". Every one of these feeds a .cnm-num.
   ───────────────────────────────────────────────────────────────────────── */

export function fmtUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

export function fmtPrice(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n > 100) return `$${Math.round(n).toLocaleString('en-US')}`
  // 4 significant figures below $100 — 73.64, 7.284, 0.9412, 0.0001234
  const digits = Math.min(10, Math.max(0, 4 - (Math.floor(Math.log10(n)) + 1)))
  return `$${n.toFixed(digits)}`
}

export function fmtCount(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-US')
}

/** 14:02:39 — always UTC, labelled once in the meta rail. */
export function fmtClock(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** 14:02 — the tape's `since` stamp. */
export function fmtClockShort(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '--:--'
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** Compact age for the meta rail — driven by module-ticker, never setState. */
export function fmtAge(deltaMs) {
  const s = Math.max(0, Math.floor(deltaMs / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty']

/**
 * Durations are spelled out in the narration and the title line, numeric in the
 * meta rail. The number that carries the emphasis on this page is the dollar
 * figure; the duration is prose around it ("liquidated in seventeen minutes").
 */
export function spellCount(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v) || v < 0) return String(n)
  if (v < 20) return ONES[v]
  if (v < 60) {
    const t = Math.floor(v / 10)
    const r = v % 10
    return r ? `${TENS[t]}-${ONES[r]}` : TENS[t]
  }
  return fmtCount(v)
}

/** "seventeen minutes" / "forty seconds" / "two hours". */
export function spellDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${spellCount(s)} second${s === 1 ? '' : 's'}`
  const m = Math.round(s / 60)
  if (m < 90) return `${spellCount(m)} minute${m === 1 ? '' : 's'}`
  const h = Math.round(m / 60)
  return `${spellCount(h)} hour${h === 1 ? '' : 's'}`
}

/** "$25,000" — the floor is stated in full, never abbreviated, in microcopy. */
export function fmtFloorFull(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '$0'
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** "$25k" — the control label. */
export function fmtFloorShort(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '$0'
  if (n >= 1e6) return `$${n / 1e6}M`
  // 🪤 Sub-$1k floors are reachable now (the $250 step, and the buffer's own
  // auto-raise lands on values like $320). `Math.round(320/1e3)+'k'` rendered
  // "$0k" — on the floor BUTTON, top-right, and on the auto-raise meta line.
  // Below a thousand the figure is simply said in full.
  if (n >= 1000) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n)}`
}
