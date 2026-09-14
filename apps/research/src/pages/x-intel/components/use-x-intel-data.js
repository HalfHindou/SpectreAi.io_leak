/**
 * X Intel data layer — the Signal Desk's three feeds, all through the shared
 * useXDashSurface cache (client TTL + inflight dedup + hidden/idle-guarded
 * polling), so tab switches and the desk strip never duplicate a request.
 *
 *  - useEarlyRunners  : /api/xdash/early-runners (→ /v1/social/early-runners).
 *    The pre-CoinGecko lane from worker-early-runner-detector: confirmed +
 *    candidate rows with CA, chain, buzz, mcap_at_confirm and the +24/48/72h
 *    self-grading columns. Grades stamp server-side as signals age — the
 *    summary aggregates get honest on their own.
 *  - useBreakoutFeed  : /data-api/v1/notifications/feed, filtered to
 *    breakout_radar. Feed items are prose; parseBreakout lifts the numbers
 *    (authors / mcap / acceleration) back out for the card stats.
 *  - useReceiptsLedger: /api/xdash/track-record (momentum_origin $1k/call
 *    ledger) + a byAsset index so the Runners table can stamp SPOTTED MC /
 *    ROI receipts onto live board rows.
 */
import { useMemo, useState, useEffect } from 'react'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import { useXDashTrackRecord } from '@/hooks/useXDashTrackRecord'
import { getTokenWithPrice } from '@/services/codexApi'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* ── Contract-truth mcap overlay (the FEBU $2.3M→$3.2M fix) ──────────────
 * The X Dash board ships a frozen catalog `market_cap`; CoinGecko has no row
 * for on-chain degens like $FEBU. The contract is project-unique, so Codex
 * `details` by contract+network is the reliable live truth (same override the
 * X Dash drawer uses). Bounded to the visible rows + cached per contract so
 * it stays cheap — never the whole 50-row board. */
const CHAIN_NET = {
  ethereum: 1, eth: 1, base: 8453, solana: 1399811149, sol: 1399811149,
  bsc: 56, binance: 56, 'binance-smart-chain': 56, 'bnb chain': 56, bnb: 56,
  arbitrum: 42161, 'arbitrum-one': 42161, 'arbitrum one': 42161,
  polygon: 137, 'polygon-pos': 137, matic: 137,
  avalanche: 43114, avax: 43114, optimism: 10, 'optimistic-ethereum': 10, blast: 81457,
}
const chainNet = (c) => CHAIN_NET[String(c || '').toLowerCase().trim()] || null

const _mcapCache = new Map() // `${net}:${addr}` -> { mcap, ts }
const MCAP_TTL = 60_000

// Returns { [contractAddressLower]: mcapUsd } for the (bounded) rows.
export function useContractMcaps(rows, { max = 18 } = {}) {
  const [mcaps, setMcaps] = useState({})

  const targets = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const r of rows || []) {
      const addr = r?.contract_address
      const net = chainNet(r?.chain)
      if (!addr || !net) continue
      const contract = String(addr).toLowerCase()
      const key = `${net}:${contract}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ addr, net, key, contract })
      if (out.length >= max) break
    }
    return out
  }, [rows, max])
  const targetsKey = targets.map((t) => t.key).join(',')

  useEffect(() => {
    if (!targets.length) return undefined
    let cancelled = false

    // Instant paint from cache.
    const seed = {}
    for (const t of targets) {
      const c = _mcapCache.get(t.key)
      if (c && Date.now() - c.ts < MCAP_TTL && c.mcap > 0) seed[t.contract] = c.mcap
    }
    if (Object.keys(seed).length) setMcaps((prev) => ({ ...prev, ...seed }))

    ;(async () => {
      const results = await Promise.all(targets.map(async (t) => {
        const cached = _mcapCache.get(t.key)
        if (cached && Date.now() - cached.ts < MCAP_TTL) return [t.contract, cached.mcap]
        try {
          const r = await getTokenWithPrice(t.addr, t.net)
          const mc = Number(r?.marketCap) || 0
          _mcapCache.set(t.key, { mcap: mc, ts: Date.now() })
          return [t.contract, mc]
        } catch {
          return [t.contract, 0]
        }
      }))
      if (cancelled) return
      const next = {}
      for (const [contract, mc] of results) if (mc > 0) next[contract] = mc
      if (Object.keys(next).length) setMcaps((prev) => ({ ...prev, ...next }))
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey])

  return mcaps
}

/* ── Early Runners ──────────────────────────────────────────────────── */

// followers_reach is a Postgres bigint → arrives as a string; timestamps as ISO.
function normalizeRunner(row) {
  if (!row || typeof row !== 'object') return row
  return {
    ...row,
    followers_reach: num(row.followers_reach),
    confirmedTs: row.confirmed_at ? Date.parse(row.confirmed_at) : null,
    firstSeenTs: row.first_seen_at ? Date.parse(row.first_seen_at) : null,
    // Live drift since confirmation — the card's own receipt while the formal
    // +24h grade is still cooking. Null when either side is missing.
    driftPct: (num(row.market_cap_usd) > 0 && num(row.mcap_at_confirm) > 0)
      ? ((row.market_cap_usd / row.mcap_at_confirm) - 1) * 100
      : null,
  }
}

export function useEarlyRunners(hookOptions = {}) {
  const { data, loading, error, refetch } = useXDashSurface(
    '/api/xdash/early-runners',
    { limit: 60 },
    { ttlMs: 60_000, refreshIntervalMs: 120_000, ...hookOptions },
  )
  const payload = data && typeof data === 'object' ? (data.data ?? null) : null
  const degraded = data?.status === 'degraded' || (!loading && data != null && !payload)
  const confirmed = useMemo(
    () => (Array.isArray(payload?.confirmed) ? payload.confirmed.map(normalizeRunner) : []),
    [payload],
  )
  const candidates = useMemo(
    () => (Array.isArray(payload?.candidates) ? payload.candidates.map(normalizeRunner) : []),
    [payload],
  )
  return {
    confirmed,
    candidates,
    summary: payload?.summary || null,
    generatedTs: data?.meta?.ts || null,
    loading,
    error,
    degraded,
    refetch,
  }
}

/* ── Lifecycle (wallet → social → price) ────────────────────────────────
 * Nansen smart-money netflow + X-Dash social velocity + price, fused
 * server-side (/v1/intel/lifecycle) into a per-token stage. meta.wallet_stale
 * flags when the smart-money feed is aging (test-key credits) — surfaced
 * honestly, never hidden or faked. */
export function useLifecycle({ source = 'trending', ...hookOptions } = {}) {
  const { data, loading, error, refetch } = useXDashSurface(
    '/data-api/v1/intel/lifecycle',
    { limit: 60, source },
    { ttlMs: 60_000, refreshIntervalMs: 180_000, ...hookOptions },
  )
  const rows = useMemo(() => (Array.isArray(data?.data) ? data.data : []), [data])
  return { rows, meta: data?.meta || null, loading, error, refetch }
}

/* ── Breakout radar (bell feed) ─────────────────────────────────────── */

// "HOPPY breakout — 10 authors @ $1.06M" + "…accelerating 51.4×" → numbers.
// Prose is the source of truth here; parsing is best-effort and every field
// degrades to null (rendered as absent, never fabricated).
function parseMoney(text) {
  const m = /\$([\d.]+)\s*([KMB])/i.exec(text || '')
  if (!m) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()]
  return Number(m[1]) * mult
}

function parseBreakout(item) {
  const text = `${item.title || ''} ${item.body || ''}`
  const authors = /(\d+)\s+(?:distinct\s+)?authors/i.exec(text)
  const accel = /accelerating\s+([\d.]+)\s*[×x]/i.exec(text)
  return {
    id: item.id,
    asset: item.asset || null,
    title: item.title || '',
    body: item.body || '',
    score: num(item.score),
    severity: item.severity || null,
    direction: item.direction || null,
    createdTs: item.createdAt ? Date.parse(item.createdAt) : null,
    authors: authors ? Number(authors[1]) : null,
    mcap: parseMoney(item.title) ?? parseMoney(item.body),
    accel: accel ? Number(accel[1]) : null,
  }
}

export function useBreakoutFeed(hookOptions = {}) {
  const { data, loading, error, refetch } = useXDashSurface(
    '/data-api/v1/notifications/feed',
    { limit: 60 },
    { ttlMs: 60_000, refreshIntervalMs: 120_000, ...hookOptions },
  )
  const breakouts = useMemo(() => {
    const items = Array.isArray(data?.data) ? data.data : []
    const seen = new Set()
    return items
      .filter((i) => i.signalType === 'breakout_radar')
      .map(parseBreakout)
      .filter((b) => {
        // Collapse repeat fires per asset to the newest (feed is newest-first).
        const key = b.asset || b.title
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [data])
  return { breakouts, loading, error, refetch }
}

/* ── Receipts ledger (track record) ─────────────────────────────────── */

// One params object shared by every caller → one cache entry for the whole
// page (Receipts wall + the Runners table's receipt columns).
const LEDGER_PARAMS = { sort: 'peak', limit: 400 }

export function useReceiptsLedger(hookOptions = {}) {
  const { ledger, hallOfFame, loading, error, degraded, refetch } = useXDashTrackRecord(
    LEDGER_PARAMS,
    hookOptions,
  )
  const calls = useMemo(
    () => (Array.isArray(ledger?.calls) ? ledger.calls : []),
    [ledger],
  )
  // cg_id is the primary join key onto board rows; symbol is the fallback
  // (kept only when unclaimed — multi-chain ticker clones must not collide).
  const byAsset = useMemo(() => {
    const map = new Map()
    for (const call of calls) {
      if (call.coingecko_id) {
        const key = String(call.coingecko_id).toLowerCase()
        if (!map.has(key)) map.set(key, call)
      }
      if (call.symbol) {
        const key = `sym:${String(call.symbol).toUpperCase()}`
        if (!map.has(key)) map.set(key, call)
      }
    }
    return map
  }, [calls])
  return {
    summary: ledger?.summary || null,
    calls,
    hallOfFame,
    byAsset,
    loading,
    error,
    degraded,
    refetch,
  }
}

export function findReceipt(byAsset, row) {
  if (!byAsset || !row) return null
  const cgId = row.cg_id || row.token_id
  if (cgId) {
    const hit = byAsset.get(String(cgId).toLowerCase())
    if (hit) return hit
  }
  if (row.symbol) return byAsset.get(`sym:${String(row.symbol).toUpperCase()}`) || null
  return null
}
