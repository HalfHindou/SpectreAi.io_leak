/**
 * useEtfFlows — one aggregated read for the ETF Net Flows surfaces (dedicated
 * /etfs page, Command Center Flows tab, Wallets page section, Lite ETF tab).
 *
 * Data: /data-api/v1/etf/summary (per-issuer holdings + 1D + 7D, BTC + ETH) +
 * /data-api/v1/etf/flow-chart (daily net-flow + spot-price series per asset).
 * Both endpoints are edge-cached and settle once a day, so this polls slowly
 * and hydrates from a shared module cache (no shimmer on tab re-entry).
 *
 * 2026-07-31 (joGsu beta report "chart is not loading"): the single
 * Promise.all gated first paint on the slowest leg, and a failed flow-chart
 * leg was cached module-wide as "success with empty charts" for 4 minutes —
 * every surface showed "Flow history warming up" until the next poll. Now:
 * summary paints the page as soon as IT lands, charts fill in a second
 * commit, a failed leg falls back to the last good series per asset, and a
 * localStorage seed paints returning sessions instantly.
 *
 * The upstream provider name is intentionally never read or surfaced.
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const REFRESH_MS = 300_000 // 5 min — ETF flows settle once daily
const CACHE_TTL = 240_000
const LS_KEY = 'spectre-etf-flows-v1'
const LS_TTL = 6 * 3600_000 // flows settle daily — a six-hour seed is safe

let _cache = null // { data, ts }
let _inflight = null

function readSeed() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY))
    if (raw && raw.ts && Date.now() - raw.ts < LS_TTL && raw.data?.summary) return raw.data
  } catch { /* private mode / corrupt */ }
  return null
}
function writeSeed(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), data })) } catch { /* quota */ }
}

async function fetchJson(path) {
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(30000) })
    if (!r.ok) return null
    const j = await r.json()
    return j?.data ?? j ?? null // endpoints wrap in { data, meta }
  } catch {
    return null
  }
}

// onPartial fires when summary lands (paints the page); the returned promise
// resolves with the full payload once the chart legs settle too.
async function fetchEtf(onPartial) {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.data
  if (_inflight) return _inflight

  const prevCharts = _cache?.data?.charts || readSeed()?.charts || {}
  const summaryP = fetchJson('/data-api/v1/etf/summary')
  const btcP = fetchJson('/data-api/v1/etf/flow-chart?asset=BTC&range=daily&days=150')
  const ethP = fetchJson('/data-api/v1/etf/flow-chart?asset=ETH&range=daily&days=150')

  // fast first commit: the issuer tables + totals render from summary alone
  if (onPartial) {
    summaryP.then((summary) => {
      if (summary && summary.btc) onPartial({ summary, charts: prevCharts })
    }).catch(() => {})
  }

  _inflight = Promise.all([summaryP, btcP, ethP])
    .then(([summary, btc, eth]) => {
      const data = {
        // a poll where summary fails must not wipe a good view — keep the last
        summary: summary && summary.btc ? summary : (_cache?.data?.summary || null),
        charts: {
          // a failed/empty chart leg keeps the last good series for THAT asset
          BTC: (btc && btc.series && btc.series.length ? btc.series : prevCharts.BTC) || [],
          ETH: (eth && eth.series && eth.series.length ? eth.series : prevCharts.ETH) || [],
        },
      }
      if (data.summary) {
        _cache = { data, ts: Date.now() }
        writeSeed(data)
      }
      _inflight = null
      return data
    })
    .catch(() => {
      _inflight = null
      return _cache?.data || null
    })
  return _inflight
}

export default function useEtfFlows({ enabled = true } = {}) {
  const [data, setData] = useState(() => _cache?.data || readSeed())
  const [loading, setLoading] = useState(() => !_cache && !readSeed())

  const commit = useCallback((d) => {
    setData((prev) => d || prev)
    setLoading(false)
  }, [])

  const run = useCallback(async () => {
    if (!enabled) return
    if (typeof document !== 'undefined' && document.hidden) return
    commit(await fetchEtf(commit))
  }, [enabled, commit])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const safeCommit = (d) => { if (!cancelled) commit(d) }
    fetchEtf(safeCommit).then(safeCommit)
    return () => {
      cancelled = true
    }
  }, [enabled, commit])

  useAdaptivePolling(run, { interval: REFRESH_MS, enabled })

  return { data, loading }
}
