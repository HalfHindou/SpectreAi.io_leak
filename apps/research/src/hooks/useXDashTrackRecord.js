/**
 * useXDashTrackRecord — thin wrapper over useXDashSurface for the Provenance
 * Tape ("Proof" view on /x-dash). Reads the finished, derived paper-trade
 * ledger from /api/xdash/track-record (proxies /v1/social/track-record).
 *
 * Params (all optional): { sort, limit, status, minRoi }
 *   sort   : 'roi' (default) | 'peak' | 'recent' | 'worst' | 'mcap'
 *   status : 'up' | 'down' | 'moon'  (omit for All)
 *   limit  : number — DEFAULT 400 at the call site (enough for the histogram,
 *            all moonshots, and a deep scrollable tape without a 1,259-row DOM)
 *   minRoi : number — server-side ROI floor
 *
 * IMPORTANT (degraded contract): useXDashSurface calls res.json() directly and
 * only throws on a non-2xx response. The degraded envelope
 * `{ data: null, status: 'degraded' }` arrives over HTTP 200 — so it surfaces
 * as `data`, NOT as `error`. The view must guard on
 * `data?.status === 'degraded' || !data?.data?.calls?.length`. A killed
 * serverless fn (non-JSON gateway page / 5xx) surfaces via `error`.
 *
 * The proxied envelope is `{ data: {...}, meta: {...} }` — the ledger payload
 * (summary/calls/count/sort) lives under `.data`. Returns an object (never an
 * array), per the hook contract.
 */
import { useMemo } from 'react'
import { useXDashSurface } from './useXDashSurface'

export function useXDashTrackRecord(params = {}, options = {}) {
  const surfaceParams = useMemo(() => {
    const next = {}
    if (params.sort) next.sort = params.sort
    if (params.limit != null) next.limit = params.limit
    if (params.status) next.status = params.status
    if (params.minRoi != null) next.minRoi = params.minRoi
    return next
  }, [params.sort, params.limit, params.status, params.minRoi])

  const { data, loading, error, refetch } = useXDashSurface(
    '/api/xdash/track-record',
    surfaceParams,
    { ttlMs: 300_000, ...options },
  )

  // Unwrap the proxy envelope: { data: <ledger>, meta }.
  const ledger = data && typeof data === 'object' ? (data.data ?? null) : null
  const meta = data && typeof data === 'object' ? (data.meta ?? null) : null
  const degraded = data?.status === 'degraded' || (!loading && data != null && !ledger?.calls?.length)

  // hall_of_fame is the TRUE all-time top-3 by ROI over the FULL ledger — it
  // ships on the same response as `summary`/`calls`, NOT derived from the
  // sorted/filtered tape. Surfaced separately so the view renders the HoF from
  // the unfiltered summary fetch and it never changes on sort/status switches.
  const hallOfFame = Array.isArray(ledger?.hall_of_fame) ? ledger.hall_of_fame : null

  return { ledger, meta, hallOfFame, raw: data, loading, error, degraded, refetch }
}
