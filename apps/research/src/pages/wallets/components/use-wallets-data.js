/**
 * use-wallets-data — data lanes for the /wallets page.
 *
 * All lanes read the Spectre Data API wallets aggregates (box-side caches:
 * Nansen tracker cache, free whale/CEX/ETF lanes, keyless Hyperliquid) via
 * /data-api/v1/wallets/*. No lane ever triggers an external API call.
 *
 * Each lane: module cache + inflight dedup + adaptive polling, gated by
 * `enabled` so only the active tab fetches (api-patterns.md §L).
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { EXCHANGE_DOMAINS } from '@/lib/exchangeIcons'

const LANES = {
  command: { path: '/data-api/v1/wallets/command', ttl: 60_000, poll: 90_000 },
  board: { path: '/data-api/v1/wallets/board', ttl: 120_000, poll: 150_000 },
  hlDesks: { path: '/data-api/v1/wallets/hl-desks', ttl: 120_000, poll: 150_000 },
  read: { path: '/data-api/v1/wallets/read', ttl: 120_000, poll: 300_000 },
  history: { path: '/data-api/v1/wallets/flows-history', ttl: 600_000, poll: 900_000 },
  screener: { path: '/data-api/v1/wallets/screener', ttl: 120_000, poll: 180_000 },
}

const _cache = {}   // laneKey → { data, ts }
const _inflight = {}

async function fetchLane(key) {
  const lane = LANES[key]
  const hit = _cache[key]
  if (hit && Date.now() - hit.ts < lane.ttl) return hit.data
  if (_inflight[key]) return _inflight[key]
  _inflight[key] = fetch(lane.path, { signal: AbortSignal.timeout(25000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const data = j?.data || j || null
      if (data) _cache[key] = { data, ts: Date.now() }
      delete _inflight[key]
      return data
    })
    .catch(() => {
      delete _inflight[key]
      return _cache[key]?.data || null
    })
  return _inflight[key]
}

export default function useWalletsLane(key, { enabled = true } = {}) {
  const [data, setData] = useState(_cache[key]?.data || null)
  const [loading, setLoading] = useState(!_cache[key])

  const run = useCallback(async () => {
    if (!enabled) return
    if (typeof document !== 'undefined' && document.hidden) return
    const d = await fetchLane(key)
    setData((prev) => d || prev)
    setLoading(false)
  }, [key, enabled])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    fetchLane(key).then((d) => {
      if (cancelled) return
      setData((prev) => d || prev)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [key, enabled])

  useAdaptivePolling(run, { interval: LANES[key].poll, enabled })

  return { data, loading }
}

/* ── shared formatters ── */

export function fmtUsd(n, { sign = false } = {}) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const s = n < 0 ? '-' : sign && n > 0 ? '+' : ''
  if (abs >= 1e9) return `${s}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${s}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${s}$${(abs / 1e3).toFixed(0)}K`
  return `${s}$${abs.toFixed(0)}`
}

/* Token quantity — the counterpart to fmtUsd. Compact past 10k so a
   2,063,599 USDT transfer still fits a tape cell; separators below that;
   4 significant figures under 1 so dust never renders as "0". */
export function fmtQty(n) {
  const v = Number(n)
  if (n == null || !isFinite(v)) return '—'
  const abs = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (abs >= 1e9) return `${s}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${s}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${s}${(abs / 1e3).toFixed(1)}K`
  if (abs >= 1) return `${s}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (abs === 0) return '0'
  return `${s}${abs.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`
}

export function relTime(ts) {
  if (!ts) return ''
  const d = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  return `${Math.floor(d / 86400)}d`
}

/**
 * How old a stored snapshot is, and whether that age is normal.
 *
 * The desks cohort is not a live feed, whatever the copy used to say. The box
 * polls Hyperliquid positions every 15 minutes and the read path is rewritten
 * every 30, so a perfectly healthy snapshot is routinely half an hour old —
 * measured stepping 20:01:10 to 20:31:10 UTC on 2026-08-24, an exact 30-minute
 * stride, with the client's own 150s poll on top.
 *
 * So the stale bar is set past the write cadence, not near it: 45 minutes is
 * the first age that means the pipeline stopped rather than that it is simply
 * between writes.
 */
export function snapshotAge(ts, staleAfterMin = 45) {
  if (!ts) return null
  const ms = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return { text: relTime(ts), minutes: ms / 60000, stale: ms > staleAfterMin * 60000 }
}

export function shortAddr(a) {
  if (!a) return ''
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

/* A tape party is either a human label ("Binance 14", "Tether Treasury") or a
   raw address the upstream never resolved. Address shapes covered: EVM hex,
   bech32 (BTC/LTC segwit), base58 legacy BTC/LTC, and Solana-length base58.
   Any unbroken alphanumeric run past 25 chars is treated as an address — a
   real entity label has spaces or is short. */
const RAW_ADDR_RX = new RegExp([
  '^0x[0-9a-fA-F]{16,}$',                       // EVM
  '^(?:bc1|tb1|ltc1|bcrt1)[02-9ac-hj-np-z]{20,}$', // bech32
  '^[13LM][1-9A-HJ-NP-Za-km-z]{24,}$',          // base58 legacy BTC / LTC
  '^[1-9A-HJ-NP-Za-km-z]{32,44}$',              // base58 (Solana-shaped)
  '^[A-Za-z0-9]{26,}$',                         // generic unbroken run
].join('|'))

export function isRawAddr(label) {
  const s = String(label || '').trim()
  if (s.length <= 25 || /\s/.test(s)) return false
  return RAW_ADDR_RX.test(s)
}

/* Render-ready party for a tape row side. `raw` lets each surface pick its own
   muted/mono treatment without re-implementing the detection. */
export function tapeParty(label, fallback = '') {
  const s = String(label || '').trim()
  if (!s) return { text: fallback, raw: false, full: '' }
  if (isRawAddr(s)) return { text: shortAddr(s), raw: true, full: s }
  return { text: s, raw: false, full: s }
}

// Editorial blocklist — tokens whose NAME is the problem (gross-out or slur
// tickers). The data stays true upstream; Spectre just doesn't publish them
// on its boards. Keep the list surgical: FARTCOIN-class juvenile is fine,
// DIARRHEA-class gross-out and slurs are not.
const UGLY_NAME_RX = /(diarrh|feces|faeces|vomit|\bcum\b|rape\b|incest|pedo|hitler|nigg|fagg|retard)/i
export const isUglyToken = (symbol, name) => UGLY_NAME_RX.test(String(symbol || '')) || UGLY_NAME_RX.test(String(name || ''))

export const CHAIN_SHORT = {
  ethereum: 'ETH', solana: 'SOL', base: 'BASE', bnb: 'BNB',
  arbitrum: 'ARB', polygon: 'POL', bitcoin: 'BTC',
}

const DS_CHAIN = { ethereum: 'ethereum', solana: 'solana', base: 'base', bnb: 'bsc', arbitrum: 'arbitrum', polygon: 'polygon' }
export const tokenLogoUrl = (chain, contract) => {
  const slug = DS_CHAIN[chain]
  return slug && contract ? `https://dd.dexscreener.com/ds-data/tokens/${slug}/${contract}.png` : null
}

export const explorerTxUrl = (txHash, chain) => {
  if (!txHash) return '#'
  if (chain === 'bitcoin') return `https://mempool.space/tx/${txHash}`
  return `https://etherscan.io/tx/${txHash}`
}

export const hlAddressUrl = (addr) => `https://hypurrscan.io/address/${addr}`

/* ── shared read semantics (consumed by desktop + mobile renders) ── */

/* Codex network ids RZ understands (research-zone-routing ALLOWED_NETWORK_IDS) */
export const CHAIN_NETWORK_ID = { ethereum: 1, bnb: 56, polygon: 137, arbitrum: 42161, base: 8453, solana: 1399811149 }

export const STANCE_LABEL = { risk_on: 'Money entering', neutral: 'Mixed flows', risk_off: 'Money leaving' }

export const READ_BADGE = {
  front_running: { label: 'Front-running', title: 'Smart money buying before the crowd notices' },
  buying_into_buzz: { label: 'Buying buzz', title: 'Smart money buying while attention rises' },
  selling_into_buzz: { label: 'Exit into buzz', title: 'Smart money selling into rising attention' },
}

/* ── cohort classification ──
   One classifier, four tape surfaces. A row lands in exactly one cohort:
   stables → exchange → fund → whale (first match wins, most specific first).
   The exchange name set is derived from the icon registry so there is only
   ever one list of venue names in the app. */

const EXCHANGE_NAMES = new Set(Object.keys(EXCHANGE_DOMAINS).map((n) => n.toLowerCase()))

/* "Binance 14" → "binance" · "Coinbase (Cold)" → "coinbase" · "Gate.io" stays.
   Strips wallet-role words and trailing indices so numbered hot wallets match
   their venue. Never strips inside a word ("1inch" survives). */
function normalizeEntity(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[:_/|,]+/g, ' ')
    .replace(/\b(?:hot|cold|deposit|deposits|withdrawal|withdrawals|custody|reserve|reserves|treasury|wallet|wallets|exchange|address|account|user|users|funds?|\d+)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isExchangeLabel(label) {
  if (!label || isRawAddr(label)) return false
  const n = normalizeEntity(label)
  if (!n) return false
  if (EXCHANGE_NAMES.has(n)) return true
  const head = n.split(' ')[0]
  return head.length >= 3 && EXCHANGE_NAMES.has(head)
}

/* Institutional allocators + issuers-of-record. Named const so the list is
   editable in one place as new ETF/desk labels show up upstream. */
const FUND_RX = /\b(?:blackrock|ibit|fbtc|arkb|bitb|hodl|ezbc|brrr|btco|grayscale|gbtc|ethe|fidelity|ark\s*(?:21shares|invest)?|21shares|bitwise|vaneck|invesco|franklin|wisdomtree|valkyrie|hashdex|galaxy|jump|wintermute|cumberland|drw|gsr|amber|falconx|pantera|a16z|paradigm|dragonfly|polychain|multicoin|micro\s?strategy|metaplanet|foundation|treasury|dao)\b/i

function isFundLabel(label) {
  if (!label || isRawAddr(label)) return false
  return FUND_RX.test(label)
}

/* Classify a whale-tape transfer into a tone + short tag + cohort.
   Tone stays consistent with the In/Out language already on the page:
   coins ARRIVING at a venue read distribution-side (red), coins LEAVING read
   accumulation-side (green), venue-internal shuffles stay neutral. */
export function tapeRead(row) {
  const from = row.fromLabel || ''
  const to = row.toLabel || ''

  const isIssuer = (l) => /circle|tether/i.test(l)
  if (isIssuer(from)) return { tone: 'mint', tag: 'Mint', cohort: 'stables' }
  if (isIssuer(to)) return { tone: 'burn', tag: 'Redeem', cohort: 'stables' }

  const fromEx = isExchangeLabel(from)
  const toEx = isExchangeLabel(to)
  if (fromEx && toEx) return { tone: 'move', tag: '⇄ Exchange', cohort: 'exchange' }
  if (toEx) return { tone: 'in', tag: '→ Exchange', cohort: 'exchange' }
  if (fromEx) return { tone: 'out', tag: '← Exchange', cohort: 'exchange' }

  if (isFundLabel(to)) return { tone: 'in', tag: '→ Fund', cohort: 'fund' }
  if (isFundLabel(from)) return { tone: 'out', tag: '← Fund', cohort: 'fund' }

  if (from && !to) return { tone: 'out', tag: 'Out', cohort: 'whale' }
  if (!from && to) return { tone: 'in', tag: 'In', cohort: 'whale' }
  if (from && to) return { tone: 'move', tag: 'Move', cohort: 'whale' }
  return { tone: 'move', tag: 'Whale', cohort: 'whale' }
}

/* Shared cohort filter options — the Tape toolbar on desktop + mobile and the
   River click-through both key off these ids. */
export const TAPE_COHORTS = ['all', 'exchange', 'stables', 'fund', 'whale']

export const matchesCohort = (row, cohort) => cohort === 'all' || tapeRead(row).cohort === cohort
