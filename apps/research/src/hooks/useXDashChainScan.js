import { useState, useEffect, useRef } from 'react'
import { normalizeItem } from '@/hooks/useXDashBootstrap'

/**
 * Wide chain-scan for the X Dash leaderboard.
 *
 * The board's chain dropdown filters CLIENT-SIDE, but the live (24h/7d) view
 * only holds one paginated page (20-48 rows) — so a chain like Robinhood, whose
 * ~8-13 tokens are scattered across the momentum ranking, showed only the 3-6
 * that happened to land on the visible page. `/api/xdash/bootstrap` doesn't take
 * a chain param and serves the whole board across ~2 pages of 50 (top by
 * ranking). This hook stitches those pages into ONE pool so the chain filter can
 * match across the entire available board, then the caller paginates the
 * filtered result itself. Only runs when a specific chain is selected (the
 * all-chains path keeps its cheap single-page fetch).
 */
const CACHE = new Map() // key -> { rows, ts }
const TTL = 60_000
const MAX_PAGES = 10     // board runs deep (~460 tokens / 10 pages of 50, verified live)
const WAVE = 4           // pages fetched per parallel wave; short page = board end, bail
const PER_PAGE = 50
const FETCH_TIMEOUT = 12_000 // per page; pages run in parallel so this is the wall-clock ceiling

function scanKey(p) {
  return [p.timeframe || '24h', p.ranking || 'momentum', p.segment || 'all', p.market || 'all', p.minKols || 1].join('|')
}

export function useXDashChainScan(params = {}, { enabled = false } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const key = scanKey(params)
  const paramsRef = useRef(params)
  paramsRef.current = params

  useEffect(() => {
    if (!enabled) { setRows([]); return undefined }

    const cached = CACHE.get(key)
    if (cached && Date.now() - cached.ts < TTL) {
      setRows(cached.rows)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      const p = paramsRef.current
      const fetchPage = async (page) => {
        try {
          const q = new URLSearchParams({
            page: String(page),
            per_page: String(PER_PAGE),
            timeframe: p.timeframe || '24h',
            ranking: p.ranking || 'momentum',
            segment: p.segment || 'all',
            market: p.market || 'all',
            min_kols: String(p.minKols || 1),
          })
          // credentials:'include' - same iOS-PWA gate-cookie reason as useXDashBootstrap.
          const res = await fetch(`/api/xdash/bootstrap?${q}`, {
            credentials: 'include',
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
          })
          if (!res.ok) return []
          const json = await res.json()
          return Array.isArray(json?.tokens) ? json.tokens.map(normalizeItem) : []
        } catch {
          return []
        }
      }
      // The board runs ~460 tokens deep (10 pages of 50). Fetch in parallel
      // WAVES of 4 — parallel within a wave so one slow/cold page doesn't
      // serialize into a stall, waved so we don't slam the upstream with 10
      // concurrent requests. A short page = end of board; bail early. Rows
      // stream into state per wave so the filter fills progressively.
      const acc = []
      for (let start = 1; start <= MAX_PAGES && !cancelled; start += WAVE) {
        const pages = Array.from(
          { length: Math.min(WAVE, MAX_PAGES - start + 1) },
          (_, i) => start + i,
        )
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(pages.map(fetchPage))
        if (cancelled) return
        acc.push(...results.flat())
        setRows([...acc])
        const boardEnded = results.some((r) => r.length < PER_PAGE)
        if (boardEnded) break
      }
      if (cancelled) return
      CACHE.set(key, { rows: acc, ts: Date.now() })
      setRows(acc)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [enabled, key])

  return { rows, loading }
}
