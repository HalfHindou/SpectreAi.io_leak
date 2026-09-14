/**
 * useXDashConstellation — thin wrapper over useXDashSurface for the NARRATIVE
 * CONSTELLATION ("Map" view on /x-dash). Reads the force-map payload from
 * /api/xdash/constellation (proxies /v1/social/constellation):
 *
 *   { data: { generated_at, node_count, categories[], nodes[] }, meta }
 *
 * categories: [{ key, label, count, weighted, avg_authenticity (0-100) }] (~38,
 *   sorted by weighted desc) — the gravity wells.
 * nodes:      [{ asset, symbol, name, image, category (label), narrative_id,
 *   mentions, weighted (SIZE), authors, clean_signal, authenticity (COLOR 0-100),
 *   velocity, kol_count, market_cap, kols: [{ screen_name, avatar }] }] (up to 280).
 *
 * Params (optional): { limit = 280, minMentions = 1 }. The hook camel→snake
 * cases the keys (useXDashSurface.buildQuery): minMentions -> min_mentions.
 *
 * DEGRADED CONTRACT (mirrors useXDashTrackRecord): useXDashSurface reads
 * res.text() then JSON.parse (never raw res.json on a proxied route — a killed
 * serverless fn returns a non-JSON gateway page), AbortSignal.timeout(25s),
 * keeps last-good in its module cache. The HTTP-200 degraded envelope
 * `{ data: null, status: 'degraded' }` surfaces as `data`, NOT `error`. The view
 * must guard on `degraded || !nodes.length`. A killed fn (5xx / non-JSON)
 * surfaces via `error`. Returns an OBJECT (never an array), per the hook
 * contract.
 */
import { useMemo } from 'react'
import { useXDashSurface } from './useXDashSurface'

export function useXDashConstellation(params = {}, options = {}) {
  const surfaceParams = useMemo(() => ({
    limit: params.limit ?? 280,
    minMentions: params.minMentions ?? 1,
  }), [params.limit, params.minMentions])

  const { data, loading, error, refetch } = useXDashSurface(
    '/api/xdash/constellation',
    surfaceParams,
    { ttlMs: 120_000, ...options },
  )

  // Unwrap the proxy envelope: { data: <map>, meta }.
  const map = data && typeof data === 'object' ? (data.data ?? null) : null
  const meta = data && typeof data === 'object' ? (data.meta ?? null) : null

  const nodes = Array.isArray(map?.nodes) ? map.nodes : []
  const categories = Array.isArray(map?.categories) ? map.categories : []
  const generatedAt = map?.generated_at ?? null
  const nodeCount = map?.node_count ?? nodes.length

  const degraded = data?.status === 'degraded' || (!loading && data != null && !nodes.length)

  return {
    map, meta, nodes, categories, generatedAt, nodeCount,
    raw: data, loading, error, degraded, refetch,
  }
}
