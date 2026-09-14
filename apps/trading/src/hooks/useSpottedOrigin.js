/**
 * useSpottedOrigin — when Spectre first spotted a token (the Proof receipt).
 *
 * Two ledgers, checked in order:
 *   1. /api/xdash/momentum-origin/:asset — the graded momentum_origin ledger
 *      (entry mcap -> peak -> now). Richest source, but only tokens that
 *      entered the Potential Gainers system have rows.
 *   2. The X-Dash board's own `momentum_entry` (via /api/xdash/bootstrap) —
 *      when the token sits on the social momentum board, its row carries
 *      entered_at + entry_market_cap (the "$1.7M spotted" figure). Matched
 *      by CONTRACT ADDRESS first (project-unique — the collision rule),
 *      then symbol.
 *
 * Both endpoints exist in dev (Express) and trading prod (vercel.json
 * rewrites -> api/xdash.js route=bootstrap|momentum-origin). Tokens in
 * neither ledger resolve to null and callers render nothing — no fake dots.
 *
 * Module caches + inflight dedup: chart remounts, Price/MCap flips and
 * timeframe changes never refetch.
 */
import { useEffect, useState } from 'react'

const TTL = 10 * 60_000
const BOARD_TTL = 60_000
const _originCache = new Map()   // key -> { data, ts }
const _originInflight = new Map()
const _board = { ts: 0, rows: null, promise: null }

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/^\$/, '')
}

async function fetchMomentumOrigin(key) {
  const cached = _originCache.get(key)
  if (cached && Date.now() - cached.ts < TTL) return cached.data
  if (_originInflight.has(key)) return _originInflight.get(key)
  const p = (async () => {
    try {
      const res = await fetch(`/api/xdash/momentum-origin/${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) return null
      const json = await res.json()
      const d = json?.data
      const data = (d && d.first_entered_at && Number(d.entry_market_cap) > 0)
        ? { ...d, source: 'momentum_origin' }
        : null
      _originCache.set(key, { data, ts: Date.now() })
      return data
    } catch {
      return null
    } finally {
      _originInflight.delete(key)
    }
  })()
  _originInflight.set(key, p)
  return p
}

async function fetchBoardRows() {
  if (_board.rows && Date.now() - _board.ts < BOARD_TTL) return _board.rows
  if (_board.promise) return _board.promise
  _board.promise = (async () => {
    try {
      const params = 'page=1&per_page=100&timeframe=24h&ranking=momentum&segment=all&market=all&min_kols=1'
      const res = await fetch(`/api/xdash/bootstrap?${params}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) return _board.rows || []
      const json = await res.json()
      const rows = Array.isArray(json?.tokens) ? json.tokens : []
      if (rows.length > 0) {
        _board.rows = rows
        _board.ts = Date.now()
      }
      return rows
    } catch {
      return _board.rows || []
    } finally {
      _board.promise = null
    }
  })()
  return _board.promise
}

/** Board fallback: find this token's row, adapt momentum_entry to the
 * momentum-origin shape so the marker code has ONE contract. */
async function fetchBoardEntry({ address, symbol }) {
  const rows = await fetchBoardRows()
  const addr = norm(address)
  const sym = norm(symbol)
  const row = rows.find((item) => {
    const t = item?.token && typeof item.token === 'object' ? item.token : item || {}
    const rowAddr = norm(t.contract_address || t.address)
    if (addr && rowAddr && rowAddr === addr) return true
    if (sym && norm(t.symbol) === sym) return true
    return false
  })
  const me = row?.momentum_entry
  if (!me?.entered_at || !(Number(me.entry_market_cap) > 0)) return null
  return {
    first_entered_at: me.entered_at,
    entry_market_cap: Number(me.entry_market_cap),
    entry_rank: me.entry_rank ?? null,
    source: 'xdash_board',
  }
}

/** Compact mcap label: 94356437 -> "$94.4M", 1704325 -> "$1.7M" */
export function fmtSpottedMcap(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}

export default function useSpottedOrigin({ cgId, symbol, address } = {}) {
  const originKey = norm(cgId) || norm(symbol)
  const addrKey = norm(address)
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    if (!originKey && !addrKey) return undefined
    ;(async () => {
      // Ledger first (graded, survives falling off the board), board second.
      const origin = originKey ? await fetchMomentumOrigin(originKey) : null
      if (cancelled) return
      if (origin) { setData(origin); return }
      const boardEntry = await fetchBoardEntry({ address: addrKey, symbol: originKey })
      if (!cancelled) setData(boardEntry)
    })()
    return () => { cancelled = true }
  }, [originKey, addrKey])

  return { spotted: data }
}
