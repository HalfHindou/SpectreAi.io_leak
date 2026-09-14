/**
 * useWatchlistLiveData — live price/mcap/liquidity map for watchlist entries.
 *
 * Lean mobile counterpart of LeftPanel's fetchWatchlistData: one
 * fetchTokenDetailsBatch call for ALL entries (the batch route groups per
 * chain server-side), polled every 90s ONLY while `enabled` (tab active)
 * and the document is visible. Returns { dataMap, loading } keyed by
 * lowercased address.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTokenDetailsBatch } from '../../../services/codexApi'
import { MAJOR_TOKEN_ADDR } from '../../../lib/majorTokens'

const POLL_MS = 90000

// Research-synced majors (BTC/ETH/SOL...) arrive WITHOUT an on-chain address -
// the research watchlist keys majors by symbol/cgId. Resolve them through the
// shared majors registry (the same mapping LeftPanel's desktop watchlist uses)
// so they hydrate instead of rendering as $0.00 identity rows.
function resolveTarget(t) {
  if (t?.address) return { address: t.address, networkId: t.networkId || 1 }
  const m = MAJOR_TOKEN_ADDR[String(t?.symbol || '').toUpperCase().replace(/^\$/, '')]
  return m ? { address: m.address, networkId: m.networkId } : null
}

export default function useWatchlistLiveData(watchlist, enabled = true) {
  const [dataMap, setDataMap] = useState({})
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const loadRef = useRef(null)

  const key = (watchlist || []).map(t => `${t.address || t.symbol}:${t.networkId || 1}`).join(',')

  useEffect(() => {
    if (!enabled || !watchlist || watchlist.length === 0) {
      if (!watchlist || watchlist.length === 0) setDataMap({})
      return undefined
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const targets = watchlist
          .map(t => ({ entry: t, resolved: resolveTarget(t) }))
          .filter(x => x.resolved)
        if (targets.length === 0) { setDataMap({}); return }
        const res = await fetchTokenDetailsBatch(
          targets.map(x => ({ address: x.resolved.address, networkId: x.resolved.networkId }))
        )
        if (cancelled || !res) return
        // Keyed by the entry's IDENTITY (address, or symbol for address-less
        // majors) - the same key the screen's merge uses - so resolved majors
        // find their live row too.
        const map = {}
        for (const { entry: t, resolved } of targets) {
          const idKey = String(t.address || t.symbol || '').toLowerCase()
          const d = res[resolved.address.toLowerCase()]
          if (d) {
            map[idKey] = {
              networkId: resolved.networkId,
              price: parseFloat(d.priceUSD || d.price) || 0,
              change1h: d.change1h != null ? parseFloat(d.change1h) : null,
              change4h: d.change4h != null ? parseFloat(d.change4h) : null,
              change12h: d.change12h != null ? parseFloat(d.change12h) : null,
              change24h: d.change24 != null ? parseFloat(d.change24) : null,
              marketCap: parseFloat(d.marketCap) || 0,
              liquidity: parseFloat(d.liquidity) || 0,
              volume24h: parseFloat(d.volume24 || d.volume24h) || 0,
              txnCount24: d.txnCount24 != null ? parseInt(d.txnCount24) : null,
              createdAt: d.createdAt || null,
              logo: d.logo || d.imageUrl || '',
            }
          }
        }
        setDataMap(map)
      } catch { /* keep last-known values */ } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    loadRef.current = load
    timerRef.current = setInterval(() => {
      if (document.hidden) return
      load()
    }, POLL_MS)

    return () => {
      cancelled = true
      loadRef.current = null
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  // Manual refetch (pull-to-refresh). Resolves when the batch lands so the
  // pull indicator can hold its spin until data is actually fresh.
  const refresh = useCallback(() => (loadRef.current ? loadRef.current() : Promise.resolve()), [])

  return { dataMap, loading, refresh }
}
