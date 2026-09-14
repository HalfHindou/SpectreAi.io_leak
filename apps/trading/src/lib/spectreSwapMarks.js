/**
 * Local record of transaction hashes executed through the Spectre swap panel.
 * Lets the token-page transaction feed badge the user's OWN Spectre trades
 * (matched by tx hash) with a Spectre marker. Device-local, public data only
 * (a tx hash is already on-chain) - no auth, no network.
 *
 * Hash casing: EVM hashes are hex (case-insensitive) so we store both raw and
 * lowercased; Solana signatures are base58 (case-SENSITIVE) so we match raw.
 */
const KEY = 'spectre-swap-txs-v1'
const CAP = 500

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

/** Record a completed Spectre swap's tx hash. */
export function markSpectreSwap(hash) {
  const h = String(hash || '')
  if (!h) return
  try {
    const arr = readRaw()
    if (!arr.includes(h)) arr.push(h)
    // Keep the most recent CAP entries.
    const capped = arr.slice(-CAP)
    localStorage.setItem(KEY, JSON.stringify(capped))
  } catch {
    /* storage full / private mode - best-effort marker */
  }
}

/** Set of recorded hashes (raw + lowercased) for O(1) lookup in the feed. */
export function readSpectreSwapMarks() {
  const set = new Set()
  for (const h of readRaw()) {
    set.add(h)
    if (h.startsWith('0x')) set.add(h.toLowerCase())
  }
  return set
}

/** True if `hash` was executed via Spectre (per the local marks set). */
export function isSpectreSwap(marks, hash) {
  if (!marks || !hash) return false
  const h = String(hash)
  if (marks.has(h)) return true
  return h.startsWith('0x') && marks.has(h.toLowerCase())
}

// -- Full own-swap records (for INJECTING your trade into the token's tx table
//    instantly, before Codex indexes it and independent of aggregator maker
//    attribution). Device-local, public data only. --

const ROWS_KEY = 'spectre-swap-rows-v1'
const ROWS_CAP = 200

function readRowsRaw() {
  try {
    const raw = localStorage.getItem(ROWS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * Record a completed swap with enough detail to render it as a trade row.
 * Also keeps the hash in the marks set (so a later Codex-indexed copy is badged).
 * Fires a `spectre-swap-recorded` window event so an open token page injects it
 * into the transactions table immediately.
 */
export function recordSpectreSwap({ hash, type, address, networkId, amount, price, usd, eth, maker }) {
  markSpectreSwap(hash)
  if (!hash || !address) return
  try {
    const rows = readRowsRaw().filter((r) => r && r.hash !== hash)
    rows.push({
      hash: String(hash),
      type: type === 'Sell' ? 'Sell' : 'Buy',
      address: String(address).toLowerCase(),
      networkId: Number(networkId) || 1,
      amount: Number(amount) || 0,
      price: Number(price) || 0,
      usd: Number(usd) || 0,
      eth: Number(eth) || 0,
      maker: maker || null,
      ts: Date.now(),
    })
    localStorage.setItem(ROWS_KEY, JSON.stringify(rows.slice(-ROWS_CAP)))
    try { window.dispatchEvent(new Event('spectre-swap-recorded')) } catch { /* SSR / no window */ }
  } catch {
    /* storage full / private mode - best-effort */
  }
}

/**
 * Own swaps for a token, shaped as trade rows (newest first). Only the last 2h,
 * so once Codex has long since indexed a trade the local copy stops cluttering.
 * The consumer dedupes by txHash against the live feed.
 */
export function readSpectreSwapRows(address, networkId) {
  if (!address) return []
  const addr = String(address).toLowerCase()
  const net = Number(networkId) || 1
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  return readRowsRaw()
    .filter((r) => r && r.address === addr && (Number(r.networkId) || 1) === net && r.ts >= cutoff)
    .sort((a, b) => b.ts - a.ts)
    .map((r) => ({
      type: r.type,
      timestamp: new Date(r.ts),
      price: r.price,
      amount: r.amount,
      value: r.usd,
      maker: r.maker,
      txHash: r.hash,
      _own: true,
      makerLabel: { label: 'YOU', name: 'Your trade', color: r.type === 'Buy' ? '#34D399' : '#F87171', desc: 'Executed via Spectre' },
    }))
}
