/**
 * Realtime RWA comparison data — merges:
 *  - CoinGecko market data for each project token (price, mcap, mcap rank)
 *  - DefiLlama protocol TVL for each protocol slug
 *
 * Returns rows in the same shape as the static `ZIGCHAIN_STATIC.comparison`
 * fallback so the table can render with or without live data.
 */
import { useEffect, useState } from 'react'

const PROJECTS = [
  { name: 'ZIGChain',       symbol: 'ZIG',   cgId: 'zignaly',       llamaSlug: null,            diff: 'Shariah-certified L1',           partnerships: 'Apex $3.4T · SEGG $300M',    license: 'FSCA · DIFC',  highlight: true },
  { name: 'Ondo Finance',   symbol: 'ONDO',  cgId: 'ondo-finance',  llamaSlug: 'ondo-finance',  diff: 'Tokenized US Treasuries',        partnerships: 'BlackRock · Morgan Stanley', license: '—' },
  { name: 'Centrifuge',     symbol: 'CFG',   cgId: 'centrifuge',    llamaSlug: 'centrifuge',    diff: 'Institutional fund tokenization', partnerships: 'Janus Henderson · Aave',     license: '—' },
  { name: 'Maple Finance',  symbol: 'SYRUP', cgId: 'syrup',         llamaSlug: 'maple',         diff: 'Institutional crypto lending',   partnerships: 'Institutional borrowers',    license: '—' },
  { name: 'Polymesh',       symbol: 'POLYX', cgId: 'polymesh',      llamaSlug: null,            diff: 'Regulated securities L1',        partnerships: 'BitGo · tZERO · Republic',   license: 'Built-in KYC' },
  { name: 'MANTRA',         symbol: 'OM',    cgId: 'mantra-dao',    llamaSlug: 'mantra-finance', diff: 'RWA L1 with VARA license',      partnerships: 'DAMAC $1B (pre-crash)',      license: 'VARA Dubai' },
]

const FETCH_TIMEOUT = 10_000
const CACHE_TTL = 60_000
let _cache = null
let _inflight = null // shared in-flight promise so concurrent mounts dedup

const fmtUsd = (n) => {
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n).toLocaleString()}`
}

async function fetchCoinGeckoMarkets(ids) {
  // Use the project's existing CG proxy at /api/coingecko/* so we share the
  // server-side rate-limit queue + API key.
  const url = `/api/coingecko/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&per_page=${ids.length}&page=1&sparkline=false`
  const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT), headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`CG ${r.status}`)
  const arr = await r.json()
  const map = {}
  for (const c of arr || []) {
    if (c?.id) map[c.id] = { mcap: c.market_cap, price: c.current_price, rank: c.market_cap_rank, change24h: c.price_change_percentage_24h }
  }
  return map
}

async function fetchLlamaProtocol(slug) {
  if (!slug) return null
  // 2026-05-28 hide-apis-phase1: was direct https://api.llama.fi/protocol/:slug.
  // Routed through the same-origin extended-proxy raw passthrough (response
  // shape preserved, 60s server-side cache). Pulls `api.llama.fi` out of the
  // public CSP connect-src and the user's Network tab.
  const r = await fetch(`/api/data-api?fn=extended-proxy&route=llama-protocol-raw&slug=${encodeURIComponent(slug)}`, {
    credentials: 'include', // gated data-api route — attach cookie on the PWA
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { Accept: 'application/json' },
  })
  if (!r.ok) return null
  const j = await r.json().catch(() => null)
  if (!j) return null
  const sum = j.currentChainTvls
    ? Object.values(j.currentChainTvls).reduce((a, v) => a + (Number(v) || 0), 0)
    : null
  if (Number.isFinite(sum) && sum > 0) return sum
  if (Array.isArray(j.tvl) && j.tvl.length) {
    const last = j.tvl[j.tvl.length - 1]
    return Number(last?.totalLiquidityUSD) || null
  }
  return null
}

async function fetchLlamaChain(name) {
  // 2026-05-28 hide-apis-phase1: was direct https://api.llama.fi/v2/chains.
  // Routed through the same-origin extended-proxy raw passthrough.
  const r = await fetch('/api/data-api?fn=extended-proxy&route=llama-chains-raw', {
    credentials: 'include', // gated data-api route — attach cookie on the PWA
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { Accept: 'application/json' },
  })
  if (!r.ok) return null
  const arr = await r.json().catch(() => [])
  const match = arr.find((c) => String(c?.name || '').toLowerCase() === name.toLowerCase())
  return match ? Number(match.tvl) || null : null
}

async function fetchUncached() {
  const ids = PROJECTS.map((p) => p.cgId).filter(Boolean)
  const [markets, ...tvls] = await Promise.all([
    fetchCoinGeckoMarkets(ids).catch(() => ({})),
    ...PROJECTS.map((p) =>
      (p.symbol === 'ZIG' ? fetchLlamaChain('ZIGChain') : fetchLlamaProtocol(p.llamaSlug)).catch(() => null)
    ),
  ])
  const rows = PROJECTS.map((p, i) => {
    const m = markets[p.cgId] || {}
    return {
      ...p,
      mcap: fmtUsd(m.mcap) || '—',
      tvl: fmtUsd(tvls[i]) || '—',
      mcapRaw: m.mcap || 0,
      tvlRaw: tvls[i] || 0,
    }
  })
  return { rows }
}

async function fetchAll(signal) {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.data
  // Inflight dedup: concurrent mounts (or a re-mount mid-fetch) share one
  // network fan-out instead of each firing 1 CG + 6 DefiLlama calls.
  if (!_inflight) {
    _inflight = fetchUncached()
      .then((data) => { _cache = { data, ts: Date.now() }; return data })
      .finally(() => { _inflight = null })
  }
  const data = await _inflight
  if (signal?.aborted) throw new Error('aborted')
  return data
}

// `enabled` defaults to true so existing callers don't break. The /zigchain
// hub gates this on an IntersectionObserver near the comparison table:
// fanning out 7 parallel calls (1 CG batched + 6 DefiLlama protocol/chain
// passthroughs) on initial mount for a table that's well below the fold is
// the dominant non-essential cost on the page.
export function useZigComparison({ enabled = true } = {}) {
  const [state, setState] = useState({ rows: [], loading: true, error: null })
  useEffect(() => {
    if (!enabled) return undefined
    const ctrl = new AbortController()
    fetchAll(ctrl.signal)
      .then(({ rows }) => setState({ rows, loading: false, error: null }))
      .catch((err) => {
        if (err?.message === 'aborted' || err?.name === 'AbortError') return
        setState({ rows: [], loading: false, error: err.message || 'Comparison unavailable' })
      })
    return () => ctrl.abort()
  }, [enabled])
  return state
}

export default useZigComparison
