/**
 * useLivePrices(tokens)
 *
 * Returns a Map<`${address}:${networkId}`, priceUsd> updated every REFRESH_MS
 * from Codex `getTokenPrices` via the server's batch endpoint. ONE POST per
 * refresh (server chunks up to 25 addresses per Codex call internally), so the
 * cost scales with refresh frequency, not token count.
 *
 * Strategy:
 *   - One batch POST every REFRESH_MS, capped at MAX_TOKENS.
 *   - Visibility-aware: pauses when document.hidden so a backgrounded tab
 *     doesn't burn quota.
 *   - One AbortController per refresh; in-flight request is cancelled when
 *     the token list changes or the component unmounts.
 *
 * Previous implementation fanned out N parallel /api/bars requests (one per
 * token, each fetching the last 5 min of 1-min bars to read the latest close).
 * That worked when the table was mostly Binance-pair majors (cached fast), but
 * with DEX-heavy Codex trending it produced 50 slow Codex round-trips per
 * refresh. The batch endpoint exists for exactly this use case.
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { isDev } from '@/utils/env'
import { isAppActive } from '@/lib/idleManager'

// 2026-06-03 cost war: 12s -> 30s. The Codex SSE stream covers per-token
// live price ticks at sub-second latency; this batch is the fallback for
// tokens that aren't subscribed. At 50 users × 2h/day × visible Welcome
// pages with the OnChain tab clicked once, 12s was burning ~900K ops/month
// against Codex `getTokenPrices`. 30s drops that 2.5x with no perceived
// UX cost (the price chip blinks every 30s instead of every 12s; SSE-driven
// tokens still tick smoothly underneath).
const REFRESH_MS = 30_000
const MAX_TOKENS = 50            // cap visible token coverage

function tokenKey(token) {
  const addr = token?.address
  const netId = token?.networkId
  if (!addr || !netId) return null
  const isSolana = !addr.startsWith('0x') && addr.length >= 32
  const norm = isSolana ? addr : addr.toLowerCase()
  return `${norm}:${netId}`
}

async function fetchBatchPrices(tokens, signal) {
  if (!Array.isArray(tokens) || tokens.length === 0) return new Map()

  // Dedup by (address, networkId) and keep the order — chunk size handled
  // server-side. Reject rows missing the required pair.
  const seen = new Set()
  const inputs = []
  for (const t of tokens) {
    const addr = t?.address
    const netId = Number(t?.networkId)
    if (!addr || !Number.isFinite(netId)) continue
    const key = tokenKey(t)
    if (!key || seen.has(key)) continue
    seen.add(key)
    inputs.push({ address: addr, networkId: netId, _key: key })
    if (inputs.length >= MAX_TOKENS) break
  }
  if (inputs.length === 0) return new Map()

  try {
    // Dev: Express /api/tokens/batch-prices (POST, address+networkId payload).
    // Prod: same path is rewritten to the codex serverless function with
    // matching POST handling (see apps/research/api/codex.js).
    const url = isDev ? '/api/tokens/batch-prices' : '/api/codex?action=batchPrices'
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: inputs.map(({ address, networkId }) => ({ address, networkId })) }),
      signal,
    })
    if (!resp.ok) return new Map()
    const data = await resp.json()
    const prices = Array.isArray(data?.prices) ? data.prices : []
    const out = new Map()
    for (const p of prices) {
      const addr = p?.address
      const netId = p?.networkId
      if (!addr || !netId) continue
      const isSolana = !addr.startsWith('0x') && addr.length >= 32
      const norm = isSolana ? addr : String(addr).toLowerCase()
      const price = parseFloat(p?.priceUsd ?? p?.price)
      if (!Number.isFinite(price) || price <= 0) continue
      out.set(`${norm}:${netId}`, price)
    }
    return out
  } catch {
    return new Map()
  }
}

export default function useLivePrices(tokens) {
  // Stable signature so the effect only re-fires on real membership changes
  const signature = useMemo(() => {
    if (!Array.isArray(tokens) || tokens.length === 0) return ''
    const keys = []
    for (let i = 0; i < tokens.length && keys.length < MAX_TOKENS; i++) {
      const k = tokenKey(tokens[i])
      if (k) keys.push(k)
    }
    return keys.sort().join(',')
  }, [tokens])

  const [priceMap, setPriceMap] = useState(() => new Map())
  const tokensRef = useRef(tokens)
  tokensRef.current = tokens

  useEffect(() => {
    if (!signature) {
      setPriceMap(new Map())
      return
    }

    let cancelled = false
    let abortController = null
    let timer = null

    const run = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) {
        // Skip when hidden; will fire again when visible
        timer = setTimeout(run, REFRESH_MS)
        return
      }
      if (!isAppActive()) {
        // Skip when user has been idle past IDLE_TIMEOUT. Resumes via
        // visibilitychange listener below when user returns.
        timer = setTimeout(run, REFRESH_MS)
        return
      }
      abortController = new AbortController()
      const next = await fetchBatchPrices(tokensRef.current || [], abortController.signal)
      if (cancelled) return
      // Only commit if anything actually changed (avoids a render churn)
      let changed = next.size !== priceMap.size
      if (!changed) {
        for (const [k, v] of next) {
          if (priceMap.get(k) !== v) { changed = true; break }
        }
      }
      if (changed) setPriceMap(next)
      if (!cancelled) timer = setTimeout(run, REFRESH_MS)
    }

    run()

    const onVisibility = () => {
      if (!document.hidden && !timer) run()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      cancelled = true
      if (abortController) abortController.abort()
      if (timer) clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return priceMap
}

export { tokenKey }
