/**
 * monarch-live-data — hydration layer for Monarch's rich data blocks.
 *
 * The LLM emits directives only (symbols + insight text). Every NUMBER a
 * block renders comes from here — live Spectre/CoinGecko/X-Dash data — so
 * the chat can never print a hallucinated price, mcap or 24h change.
 *
 * One shared top-250 snapshot backs token cards + bubble maps (it's the
 * same module-cached fetch the home/discover pages ride, so it's usually
 * warm). X-Dash tables ride the xdashRunners board (60s module cache).
 */
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { getXDashRunnerCoins } from '@/services/xdashRunners'

const TTL = 60_000
const _snap = { ts: 0, rows: null, promise: null }

async function topCoinsSnapshot() {
  if (_snap.rows && Date.now() - _snap.ts < TTL) return _snap.rows
  if (!_snap.promise) {
    _snap.promise = getTopCoinsMarketsPage(1, 250)
      .then(rows => {
        const list = Array.isArray(rows) ? rows : []
        _snap.rows = list
        _snap.ts = Date.now()
        _snap.promise = null
        return list
      })
      .catch(err => { _snap.promise = null; throw err })
  }
  return _snap.promise
}

/**
 * Resolve one symbol to a live CG-shaped market row (top 250 coverage).
 * Returns null when the symbol has no live match — callers render an
 * honest "no live feed" state, never fabricated zeros.
 */
export async function getLiveTokenRow(symbol) {
  const sym = String(symbol || '').replace(/^\$/, '').toUpperCase()
  if (!sym) return null
  try {
    const rows = await topCoinsSnapshot()
    return rows.find(r => String(r.symbol || '').toUpperCase() === sym) || null
  } catch {
    return null
  }
}

/** Live rows for a bubble map. source: 'top' | 'gainers' | 'losers' | 'xdash' */
export async function getBubbleRows(source = 'top', limit = 25) {
  const n = Math.max(6, Math.min(50, Number(limit) || 25))
  if (source === 'xdash') {
    try { return await getXDashRunnerCoins(n) } catch { return [] }
  }
  try {
    const rows = await topCoinsSnapshot()
    const usable = rows.filter(r => Number(r.market_cap) > 0)
    if (source === 'gainers' || source === 'losers') {
      const sorted = [...usable].sort((a, b) =>
        (Number(b.price_change_percentage_24h) || 0) - (Number(a.price_change_percentage_24h) || 0))
      return (source === 'gainers' ? sorted : sorted.reverse()).slice(0, n)
    }
    return usable.slice(0, n)
  } catch {
    return []
  }
}

/** X-Dash momentum board rows (CG-shaped + _xdash mentions metadata). */
export async function getXDashRows(limit = 10) {
  const n = Math.max(3, Math.min(25, Number(limit) || 10))
  try { return await getXDashRunnerCoins(n) } catch { return [] }
}

/* ── formatters shared by the block components ── */

export function fmtUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

export function fmtPriceUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toPrecision(3)}`
}

export function fmtPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
