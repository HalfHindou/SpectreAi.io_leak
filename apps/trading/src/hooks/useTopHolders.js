/**
 * useTopHolders — fetch the ranked top-holder list from the Spectre onchain
 * API for a given token. Returns the RAW upstream rows; the consumer
 * (DataTabs) maps them into display rows (balance/decimals, percentage, type).
 *
 *   GET /api/onchain/token/:address/top-holders                       (dev / Express proxy)
 *   GET https://onchain.spectreai.io/api/v2/token/:address/top-holders (prod, direct browser)
 *
 * Mirrors useHoldersChart.js:
 *   - EVM ONLY (reuses isHoldersChartSupported; Solana is unsupported upstream
 *     and returns [] without a request, so the consumer renders a clean
 *     "unavailable on this chain" state instead of fabricated rows).
 *   - ALWAYS calls the upstream DIRECTLY from the browser, dev included.
 *     Cloudflare in front of onchain.spectreai.io bot-blocks SERVER egress:
 *     measured 2026-08-17, Node's fetch gets 403 `cf-mitigated: challenge` even
 *     when it sends the browser User-Agent the Express proxy already sets, while
 *     curl with byte-identical headers gets 200 - so the block keys on the TLS
 *     fingerprint, not the UA. A real browser passes in EVERY environment, so
 *     dev cannot use the proxy either: it returns an empty list and no error
 *     (onchain-client `get()` treats 4xx as "not a server failure", so the 403
 *     is swallowed silently and the route reports "not available for this chain").
 *     Going direct is safe: upstream sends `Access-Control-Allow-Origin: *`, and
 *     we send only `Accept`, a CORS-safelisted header, so there is no preflight.
 *     Prod CSP connect-src already allowlists onchain.spectreai.io.
 *   - No cross-app imports (monorepo rule) - kept independent from research's
 *     useTopHolders in useOnchainData.js.
 */

import { useEffect, useState } from 'react'
import { isHoldersChartSupported } from './useHoldersChart'
import { getCodexHolders } from '../services/codexApi'

export default function useTopHolders(address, networkId, limit = 50) {
  const [holders, setHolders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!address || !isHoldersChartSupported(networkId)) {
      setHolders([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    // Browser goes direct in EVERY environment - see the Cloudflare note above.
    // The non-browser branch is kept only so this hook has no window dependency;
    // it cannot actually return data (server egress is blocked).
    const isBrowser = typeof window !== 'undefined'
    // NOTE the path differs per branch, deliberately. Upstream's own route is
    // `/v2/token/:addr/top-holders`, but BOTH our proxies expose it as
    // `holders` (dev `routes/onchain.js` `/token/:address/holders`; prod
    // `api/onchain.js` parseRoute `third === 'holders'` -> 'token-holders').
    // This used to request `top-holders` from the proxy too, which 404s in dev
    // AND on Vercel previews - the bug only hid because real prod skips the
    // proxy entirely, so the one environment nobody tests locally was the one
    // environment that worked.
    const url = isBrowser
      ? `https://onchain.spectreai.io/api/v2/token/${address}/top-holders?chainId=${networkId}&limit=${limit}`
      : `/api/onchain/token/${address}/holders?chainId=${networkId}&limit=${limit}`

    ;(async () => {
      // PRIMARY: Codex. The onchain.spectreai.io bridge below is a FALLBACK
      // because its snapshot is stale - measured 2026-08-17 on SPECTRE, every
      // row came back stamped updated_at 2026-06-12 (66 days), so balances that
      // moved since were simply wrong. Cross-checked against GMGN, Codex matched
      // to ~0.5% on every comparable wallet while the bridge was off by up to
      // 83%. Codex holder records update on every transfer.
      try {
        const codex = await getCodexHolders(address, networkId)
        if (!cancelled && Array.isArray(codex?.items) && codex.items.length) {
          setHolders(codex.items)
          setError(null)
          setLoading(false)
          return
        }
      } catch { /* fall through to the bridge */ }
      if (cancelled) return

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          if (!cancelled) { setHolders([]); setError(`HTTP ${res.status}`) }
          return
        }
        const json = await res.json()
        // Shapes: proxy `{ success, data: [...] }`, direct `{ data: [...] }`
        // or `{ data: { data: [...] } }`, occasionally `{ holders: [...] }`.
        const rawArr = Array.isArray(json?.data)
          ? json.data
          : (Array.isArray(json?.data?.data)
            ? json.data.data
            : (Array.isArray(json?.holders) ? json.holders : []))
        if (!cancelled) {
          setHolders(rawArr)
          setError(null)
        }
      } catch (err) {
        if (!cancelled && err?.name !== 'AbortError') {
          setError(err?.message || 'fetch failed')
          setHolders([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [address, networkId, limit])

  return { holders, loading, error }
}
