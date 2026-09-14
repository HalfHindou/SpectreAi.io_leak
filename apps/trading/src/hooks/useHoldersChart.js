/**
 * useHoldersChart — fetch holder-count history from the Spectre onchain
 * API for a given token, normalised into `[{t, v}]` points.
 *
 * Backed by the Express proxy at:
 *   GET /api/onchain/token/:address/holders/chart
 * which delegates to our api-eth backend on monsol (PM2 + nginx +
 * Cloudflare). Response shape:
 *   { success: true, data: [{ bucket: ISO-string, holders: "string-int", ... }] }
 *
 * Gotchas:
 *   - EVM ONLY. Solana (networkId 1399811149) is explicitly unsupported
 *     by the upstream — the hook returns `data: []` for it without
 *     hitting the endpoint, so the consumer can render a clean
 *     count-only fallback instead of "Series pending".
 *   - The endpoint is Cloudflare-fronted with bot-block. Browsers
 *     (Origin: trade.spectreai.io / localhost:5181) and Vercel egress
 *     pass through fine; raw `curl` from a local dev terminal often
 *     returns empty data because Cloudflare flags the unknown UA. Test
 *     in the browser, not the terminal.
 *   - We do NOT poll. The 14d daily series doesn't change frequently;
 *     re-mounting on token switch is enough.
 *
 * Mirror of `useHoldersChart` in `apps/research/src/hooks/useOnchainData.js`
 * but kept independent — cross-app imports are forbidden by the
 * monorepo rules (`.claude/rules/coding-standards.md` section E).
 */

import { useEffect, useState } from 'react'

// Chains the upstream supports per the proxy route. Anything outside
// this set short-circuits to empty data — caller renders a count-only
// state without the sparkline.
const EVM_SUPPORTED = new Set([1, 56, 137, 8453, 42161])
const SOLANA_NETWORK_ID = 1399811149

export function isHoldersChartSupported(networkId) {
  const n = Number(networkId)
  if (!Number.isFinite(n) || n === SOLANA_NETWORK_ID) return false
  return EVM_SUPPORTED.has(n)
}

/**
 * @param {string} address - token contract address (lowercased upstream)
 * @param {number} networkId - EVM chain id (1, 56, 137, 8453, 42161)
 * @param {Object} [opts]
 * @param {'1h'|'4h'|'1d'} [opts.bucket='1d']  bucket size
 * @param {number}         [opts.limit=14]     number of buckets
 * @returns {{ data: Array<{t:string,v:number}>, loading: boolean, error: string|null }}
 */
export default function useHoldersChart(address, networkId, { bucket = '1d', limit = 14 } = {}) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!address || !isHoldersChartSupported(networkId)) {
      setData([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    // Call the upstream onchain API DIRECTLY from the browser, dev included.
    // Cloudflare in front of onchain.spectreai.io bot-blocks SERVER egress:
    // measured 2026-08-17, Node's fetch gets 403 `cf-mitigated: challenge` even
    // sending the browser User-Agent our Express proxy already sets, while curl
    // with byte-identical headers gets 200 - the block keys on the TLS
    // fingerprint, not the UA. So the dev proxy is just as blocked as Vercel's
    // and returns an empty series with no error.
    // The old comment here claimed dev had to use the proxy because "CORS would
    // block the direct call" - measured false: upstream sends
    // `Access-Control-Allow-Origin: *`, and we send only `Accept`, a
    // CORS-safelisted header, so there is not even a preflight.
    // Prod CSP `connect-src` already allowlists onchain.spectreai.io.
    const isBrowser = typeof window !== 'undefined'
    const url = isBrowser
      ? `https://onchain.spectreai.io/api/v2/token/${address}/holders/chart` +
        `?chainId=${networkId}&bucket=${bucket}&limit=${limit}`
      : `/api/onchain/token/${address}/holders/chart` +
        `?chainId=${networkId}&bucket=${bucket}&limit=${limit}`

    ;(async () => {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          // Direct upstream returns { data: [...] }; proxy returns
          // { success: true, data: [...] }. We handle both shapes below.
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          if (!cancelled) { setData([]); setError(`HTTP ${res.status}`) }
          return
        }
        const json = await res.json()
        // Two shapes to handle:
        //   - Vercel proxy: { success: true, data: [...] }
        //   - Direct upstream: { data: [...] } or { data: { data: [...] } }
        const rawArr = Array.isArray(json?.data)
          ? json.data
          : (Array.isArray(json?.data?.data) ? json.data.data : [])
        // Upstream uses string ints for holders (potentially > 2^32). parseInt
        // handles both the string `"5680251"` and the (rare) number form.
        const points = rawArr
          .map(d => ({ t: d.bucket, v: parseInt(d.holders, 10) }))
          .filter(p => Number.isFinite(p.v))
        if (!cancelled) {
          setData(points)
          setError(null)
        }
      } catch (err) {
        if (!cancelled && err?.name !== 'AbortError') {
          setError(err?.message || 'fetch failed')
          setData([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [address, networkId, bucket, limit])

  return { data, loading, error }
}
