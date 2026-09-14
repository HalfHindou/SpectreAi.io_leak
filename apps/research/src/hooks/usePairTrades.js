/**
 * usePairTrades — pulls last N trades from GeckoTerminal for any (chain, pair).
 * Falls back to resolving (chain, pair) from a contract address via DexScreener
 * when caller only passes `ca`. Refreshes every 25s. Direct client → public API.
 */
import { useEffect, useRef, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

const REFRESH_MS = 25_000

const GT_CHAIN = {
  ethereum: 'eth', eth: 'eth', solana: 'solana', sol: 'solana',
  bsc: 'bsc', base: 'base', arbitrum: 'arbitrum', optimism: 'optimism',
  polygon: 'polygon_pos', avalanche: 'avax',
}

async function resolveFromCa(ca) {
  // Resolve via our /api/dexscreener-tokens proxy (CSV batch endpoint).
  // The normalized response carries chainId + pairAddress of the most-liquid
  // pair, which is exactly what GeckoTerminal needs for its trades feed.
  try {
    const r = await fetch(`/api/dexscreener-tokens?addresses=${encodeURIComponent(ca)}`)
    if (!r.ok) return null
    const j = await r.json()
    const tok = j?.tokens?.[String(ca).toLowerCase()]
    if (!tok?.chainId || !tok?.pairAddress) return null
    return { chain: tok.chainId, pairAddress: tok.pairAddress }
  } catch { return null }
}

export default function usePairTrades({ chain, pairAddress, ca, enabled = true } = {}) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [resolved, setResolved] = useState(() => (chain && pairAddress ? { chain, pairAddress } : null))

  // Reset on contract switch. Without this, once token A resolves, the resolve
  // effect below short-circuits on `if (resolved) return` and the trades tape
  // keeps showing A's pool/swaps under token B forever. Explicit chain+pair
  // callers never use ca-resolution, so they're unaffected.
  const firstCaRef = useRef(true)
  useEffect(() => {
    if (chain && pairAddress) return
    if (firstCaRef.current) { firstCaRef.current = false; return }
    setResolved(null)
    setData([])
  }, [ca, chain, pairAddress])

  useEffect(() => {
    if (resolved) return
    if (!ca) return
    let alive = true
    resolveFromCa(ca).then((r) => { if (alive && r) setResolved(r) })
    return () => { alive = false }
  }, [ca, resolved])

  useEffect(() => {
    const c = chain || resolved?.chain
    const p = pairAddress || resolved?.pairAddress
    if (!enabled || !c || !p) return
    // Per-effect closure flag (NOT a hook-scope ref) — see useTokenMentions.
    let cancelled = false
    let timer

    const slug = GT_CHAIN[String(c).toLowerCase()] || String(c).toLowerCase()
    const url = `https://api.geckoterminal.com/api/v2/networks/${slug}/pools/${p}/trades?trade_volume_in_usd_greater_than=0`

    const tick = async () => {
      setLoading(true)
      try {
        const r = await fetch(url)
        if (cancelled) return
        if (!r.ok) { setError(`HTTP ${r.status}`); return }
        const j = await r.json()
        const items = (j?.data || []).map((t) => {
          const a = t.attributes || {}
          return {
            hash: a.tx_hash,
            side: a.kind,
            baseAmount: parseFloat(a.kind === 'sell' ? a.from_token_amount : a.to_token_amount) || 0,
            usd: parseFloat(a.volume_in_usd) || 0,
            wallet: (a.tx_from_address || '').toLowerCase(),
            ts: a.block_timestamp ? new Date(a.block_timestamp).getTime() : 0,
            chain: c,
          }
        })
        if (cancelled) return
        setData(items)
        setUpdatedAt(Date.now())
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'fetch failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    tick()
    timer = setInterval(() => {
      if ((typeof document !== 'undefined' && document.hidden) || !isAppActive()) return
      tick()
    }, REFRESH_MS)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [enabled, chain, pairAddress, resolved])

  return { data, loading, error, updatedAt, resolved }
}
