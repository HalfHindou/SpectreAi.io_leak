/**
 * useXdashSocial — X-Dash mentions leaderboard for the mobile home Social
 * board. Lean copy of the TrendingHub loader (mentions ranking only), with a
 * module cache so home ↔ hub tab hops don't refire within the TTL. Polls 90s
 * ONLY while `enabled` and the tab is visible.
 *
 * Row shape (subset of the hub's): { symbol, name, logo, marketCap, mentions,
 * authors, velocity, address, networkId, cgId }.
 */
import { useEffect, useRef, useState } from 'react'

const POLL_MS = 90000
const TTL_MS = 60000
let _cache = { ts: 0, rows: null }
let _inflight = null

/* Real chain + CA resolution — same rules the TrendingHub uses (kept local so
   the home shell doesn't import the whole hub chunk). A row without a real
   CA + known chain gets networkId:null and stays non-tappable — never guess
   a chain (the $DOT-on-Base ≠ Polkadot identity trap). */
const XDASH_CHAIN_TO_NET = {
  ethereum: 1, eth: 1,
  solana: 1399811149, sol: 1399811149,
  'binance-smart-chain': 56, bsc: 56, bnb: 56,
  base: 8453,
  'arbitrum-one': 42161, arbitrum: 42161,
  'polygon-pos': 137, polygon: 137,
  'optimistic-ethereum': 10, optimism: 10,
  avalanche: 43114,
}
const isRealCa = (a) => typeof a === 'string' && (/^0x[0-9a-fA-F]{40}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))
function xdashChainInfo(tk) {
  const chain = (tk?.chain || '').toString().toLowerCase()
  let networkId = XDASH_CHAIN_TO_NET[chain] || null
  const platforms = (tk?.platforms && typeof tk.platforms === 'object') ? tk.platforms : {}
  if (!networkId) {
    for (const key of Object.keys(platforms)) {
      const net = XDASH_CHAIN_TO_NET[key.toLowerCase()]
      if (net) { networkId = net; break }
    }
  }
  let address = null
  if (networkId) {
    const slug = Object.keys(XDASH_CHAIN_TO_NET).find((k) => XDASH_CHAIN_TO_NET[k] === networkId && isRealCa(platforms[k]))
    if (slug) address = platforms[slug]
  }
  if (!address && isRealCa(tk?.contract_address)) address = tk.contract_address
  return { networkId, address }
}

async function fetchMentions() {
  if (_cache.rows && Date.now() - _cache.ts < TTL_MS) return _cache.rows
  if (_inflight) return _inflight
  _inflight = (async () => {
    const params = new URLSearchParams({
      page: '1', per_page: '30',
      timeframe: '24h', ranking: 'mentions',
      segment: 'all', market: 'all', min_kols: '1',
    })
    const res = await fetch(`/api/xdash/bootstrap?${params}`)
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = await res.json().catch(() => ({}))
    const arr = Array.isArray(data?.tokens) ? data.tokens : []
    const rows = arr.map((item) => {
      const tk = item?.token || {}
      const m = item?.metrics || {}
      const cgIdRaw = (tk.cg_id || '').toString().toLowerCase().trim()
      const chainInfo = xdashChainInfo(tk)
      return {
        address: chainInfo.address,
        networkId: chainInfo.networkId,
        cgId: /^[a-z0-9-]+$/.test(cgIdRaw) ? cgIdRaw : null,
        symbol: (tk.cashtag || tk.symbol || '').toString().toUpperCase().replace(/^\$/, '').slice(0, 14),
        name: tk.name || tk.cashtag || tk.symbol || '',
        logo: tk.image_thumb || tk.image_small || tk.image_large || tk.image_url || '',
        marketCap: parseFloat(tk.market_cap) || 0,
        mentions: parseFloat(m.mentions_24h ?? m.external_mentions_24h ?? m.total_mentions) || 0,
        authors: parseFloat(m.unique_external_authors_24h ?? m.effective_unique_external_authors_24h) || 0,
        velocity: parseFloat(m.velocity_ratio) || 0,
      }
    })
    if (rows.length === 0) throw new Error('X Dash returned no tokens')
    _cache = { ts: Date.now(), rows }
    return rows
  })()
  try {
    return await _inflight
  } finally {
    _inflight = null
  }
}

export default function useXdashSocial(enabled) {
  const [state, setState] = useState({ rows: _cache.rows || [], loading: !_cache.rows, error: null })
  const timerRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false

    const load = async () => {
      setState((s) => ({ ...s, loading: s.rows.length === 0, error: null }))
      try {
        const rows = await fetchMentions()
        if (!cancelled) setState({ rows, loading: false, error: null })
      } catch (e) {
        if (!cancelled) {
          setState((s) => (s.rows.length > 0
            ? { ...s, loading: false }
            : { rows: [], loading: false, error: e.message || 'X Dash offline' }))
        }
      }
    }

    load()
    timerRef.current = setInterval(() => {
      if (document.hidden) return
      load()
    }, POLL_MS)

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [enabled])

  return state
}
