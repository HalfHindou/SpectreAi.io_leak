/**
 * useFearGreedData — aggregates all fear-greed dashboard data
 * Fetches current F&G, history, global metrics, and top movers in parallel.
 * Computes contributing factors from real market data.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import {
  getFearGreedCurrent,
  getFearGreedHistory,
  getGlobalMetrics,
  getTopMovers,
  getBtcPriceHistory,
} from '@/services/fearGreedApi'

/**
 * Compute contributing factors from real global metrics and movers data.
 * Each factor returns { value: 0-100, sentiment: 'fear'|'neutral'|'greed' }
 */
function computeFactors(global, movers) {
  if (!global && !movers) return null

  const factors = {}

  // 1. Price Momentum
  if (movers?.gainers?.length && movers?.losers?.length) {
    const avgGain = movers.gainers.reduce((s, c) => s + Math.abs(c.change), 0) / movers.gainers.length
    const avgLoss = movers.losers.reduce((s, c) => s + Math.abs(c.change), 0) / movers.losers.length
    const ratio = avgGain / (avgGain + avgLoss + 0.001)
    const momentum = Math.round(ratio * 100)
    factors.momentum = {
      value: Math.min(100, Math.max(0, momentum)),
      sentiment: momentum > 60 ? 'greed' : momentum < 40 ? 'fear' : 'neutral',
    }
  } else {
    factors.momentum = { value: 50, sentiment: 'neutral' }
  }

  // 2. Volatility
  if (movers?.gainers?.length && movers?.losers?.length) {
    const topGain = Math.abs(movers.gainers[0]?.change || 0)
    const topLoss = Math.abs(movers.losers[0]?.change || 0)
    const spread = topGain + topLoss
    const vol = spread < 10 ? 80 + (10 - spread) * 2 : spread < 30 ? 80 - (spread - 10) * 3 : Math.max(0, 20 - (spread - 30))
    factors.volatility = {
      value: Math.min(100, Math.max(0, Math.round(vol))),
      sentiment: vol > 60 ? 'greed' : vol < 40 ? 'fear' : 'neutral',
    }
  } else {
    factors.volatility = { value: 50, sentiment: 'neutral' }
  }

  // 3. Market Volume
  if (global?.totalVolume && global?.totalMarketCap) {
    const volRatio = (global.totalVolume / global.totalMarketCap) * 100
    const volScore = volRatio < 2 ? 20 : volRatio < 4 ? 35 : volRatio < 6 ? 55 : volRatio < 8 ? 70 : Math.min(95, 70 + (volRatio - 8) * 3)
    factors.volume = {
      value: Math.round(volScore),
      sentiment: volScore > 60 ? 'greed' : volScore < 40 ? 'fear' : 'neutral',
    }
  } else {
    factors.volume = { value: 50, sentiment: 'neutral' }
  }

  // 4. Market Dominance
  if (global?.btcDominance) {
    const btcD = global.btcDominance
    const domScore = btcD > 65 ? 15 : btcD > 58 ? 30 : btcD > 52 ? 50 : btcD > 45 ? 70 : 85
    factors.dominance = {
      value: domScore,
      sentiment: domScore > 60 ? 'greed' : domScore < 40 ? 'fear' : 'neutral',
    }
  } else {
    factors.dominance = { value: 50, sentiment: 'neutral' }
  }

  return factors
}

// 365 days covers the chart's default 1Y timeframe — cheap first paint
// (~50KB CMC payload vs ~1MB for the full 2600-day load). The 2600-day
// upgrade fires after first paint to fill the Distribution + Forward
// Returns cards that actually need multi-year history.
const FAST_HISTORY_LIMIT = 365
const FULL_HISTORY_LIMIT = 2600

// localStorage instant-paint seed. The hook is memory-only, so a cold reload
// shimmered the gauge + chart + factors through the full fetch even though F&G
// barely moves intraday. We persist a compact snapshot (current + 365-day
// history + global + movers, capped to the fast-tier size so we never blow the
// quota), hydrate it instantly on mount, then revalidate via fetchFast. The
// 2600-day upgrade still re-loads via the background tier. All access is
// try/catch (private-mode / quota safe).
const FG_PERSIST_KEY = 'spectre-feargreed-v1'
const FG_PERSIST_TTL = 60 * 60 * 1000 // 1h - seed is just for first paint; we revalidate immediately

function fgPersistLoad() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(FG_PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number') return null
    if (Date.now() - parsed.ts > FG_PERSIST_TTL) return null
    return { ...parsed.data, _ts: parsed.ts }
  } catch {
    return null
  }
}

function fgPersistSave(d) {
  if (typeof window === 'undefined') return
  try {
    const history = Array.isArray(d.history) ? d.history.slice(-FAST_HISTORY_LIMIT) : []
    const btcHistory = d.btcHistory?.prices?.length
      ? {
          prices: d.btcHistory.prices.slice(-FAST_HISTORY_LIMIT),
          total_volumes: (d.btcHistory.total_volumes || []).slice(-FAST_HISTORY_LIMIT),
        }
      : null
    const data = { current: d.current, history, global: d.global, movers: d.movers, btcHistory }
    window.localStorage.setItem(FG_PERSIST_KEY, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // quota exceeded / private mode - silently ignore
  }
}

export function useFearGreedData(refreshInterval = 120000) {
  const [tick, setTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Guards against writing state after the hook truly unmounts. Reset to true
  // at the start of the effect below (StrictMode reuses the same ref across its
  // mount -> cleanup -> mount cycle, so it must be restored, not left false).
  const mountedRef = useRef(true)
  const dataRef = useRef({
    current: null,
    history: [],
    global: null,
    movers: null,
    factors: null,
    btcHistory: null,
    lastUpdated: null,
  })
  // Once the 2600-day payload arrives, fast-tier refreshes must not clobber
  // it back down to 365 days — Distribution + Forward Returns would lose
  // their multi-year baseline on the next poll tick.
  const fullHistoryLoadedRef = useRef(false)
  // Cheap signature of the last computeFactors inputs — skip recompute when
  // global metrics + top movers are unchanged (factors are derived purely from
  // these, so identical inputs always yield identical factors).
  const factorsSigRef = useRef(null)

  // Fast tier: gauge, chart (1Y), factors, market regime. Runs on mount AND
  // every poll. Excludes the 2600-day history and the CoinGecko BTC fallback
  // so first paint isn't blocked on a ~1MB CMC payload or CoinGecko's serial
  // rate-queue (~2.2s).
  const fetchFast = useCallback(async () => {
    const [currentRes, historyRes, globalRes, moversRes] = await Promise.allSettled([
      getFearGreedCurrent(),
      getFearGreedHistory(FAST_HISTORY_LIMIT),
      getGlobalMetrics(),
      getTopMovers(),
    ])

    if (!mountedRef.current) return

    const d = dataRef.current
    if (currentRes.status === 'fulfilled') d.current = currentRes.value
    if (historyRes.status === 'fulfilled') {
      const hist = historyRes.value
      if (!fullHistoryLoadedRef.current) {
        d.history = hist?.data || []
        // CMC historical embeds BTC prices alongside F&G — use them
        // directly instead of a second CoinGecko round-trip.
        if (hist?.btcPrices?.length) {
          d.btcHistory = { prices: hist.btcPrices, total_volumes: hist.btcVolumes || [] }
        }
      }
    }
    if (globalRes.status === 'fulfilled') d.global = globalRes.value
    if (moversRes.status === 'fulfilled') d.movers = moversRes.value

    // Only recompute factors when the inputs (global metrics + top movers)
    // actually changed. computeFactors reads only these scalars/top entries, so
    // a matching signature guarantees identical output — skip and keep the
    // existing d.factors reference (which the slice memo then holds).
    const g = d.global, m = d.movers
    // Includes top AND bottom entry of each list (momentum reduces over the
    // whole array; the head/tail changing is a reliable proxy for the set moving
    // without paying a full per-element hash each poll).
    const gA = m?.gainers, lA = m?.losers
    const factorsSig = `${g?.totalMarketCap ?? ''}|${g?.totalVolume ?? ''}|${g?.btcDominance ?? ''}` +
      `|${gA?.length ?? 0}|${lA?.length ?? 0}` +
      `|${gA?.[0]?.change ?? ''}|${gA?.[gA.length - 1]?.change ?? ''}` +
      `|${lA?.[0]?.change ?? ''}|${lA?.[lA.length - 1]?.change ?? ''}`
    if (factorsSig !== factorsSigRef.current) {
      factorsSigRef.current = factorsSig
      d.factors = computeFactors(g, m)
    }
    d.lastUpdated = new Date()

    const allFailed = [currentRes, historyRes, globalRes, moversRes].every(r => r.status === 'rejected')
    // Write through to the instant-paint snapshot only on a real refresh (don't
    // clobber a good seed with an all-failed poll).
    if (!allFailed) fgPersistSave(d)
    setError(allFailed ? 'All data sources failed' : null)
    setLoading(false)
    setTick(t => t + 1)
  }, [])

  // Background tier: the 2600-day history (~1MB) + the lazy CoinGecko BTC
  // fallback. Both are below-the-fold concerns, so this runs ONCE per mount,
  // off the boot path, and never on the poll loop (daily F&G doesn't move in
  // 2 min). The two fetches are independent and fire in parallel — the BTC
  // fallback must NOT be gated behind the slow 2600-day await.
  const fetchBackground = useCallback(() => {
    if (fullHistoryLoadedRef.current) return

    // 1. Full 2600-day history. Distribution + Forward Returns upgrade from
    // the fast-tier 365-day baseline once this lands.
    getFearGreedHistory(FULL_HISTORY_LIMIT).then(fullHist => {
      if (!mountedRef.current) return
      // Only flip the guard AFTER the full payload is in hand, so a failed
      // fetch leaves the fast tier free to keep refreshing the 365-day data.
      fullHistoryLoadedRef.current = true
      const d = dataRef.current
      if (fullHist?.data?.length) d.history = fullHist.data
      if (fullHist?.btcPrices?.length) {
        d.btcHistory = { prices: fullHist.btcPrices, total_volumes: fullHist.btcVolumes || [] }
      }
      setTick(t => t + 1)
    }).catch(() => { /* fast-tier 365-day history still powers the chart */ })

    // 2. CoinGecko BTC fallback — only if CMC didn't ship BTC inline (e.g. the
    // Alternative.me fallback path on the server). Fired in PARALLEL with the
    // 2600-day fetch above (no longer awaited after it), and never awaited by
    // the chart: the F&G line renders immediately and the BTC overlay simply
    // appears whenever this resolves. A slow CoinGecko rate-queue therefore
    // can't gate the chart, and a failure degrades gracefully (no overlay).
    if (!dataRef.current.btcHistory) {
      getBtcPriceHistory(365).then(btc => {
        if (!mountedRef.current || !btc || dataRef.current.btcHistory) return
        dataRef.current.btcHistory = btc
        setTick(t => t + 1)
      }).catch(() => { /* chart degrades without BTC overlay */ })
    }
  }, [])

  useEffect(() => {
    // Reset to true on every effect run. In React 18 StrictMode the effect
    // fires mount -> cleanup -> mount on the SAME instance (same ref), so the
    // first cleanup sets this false and the second run must restore it, or the
    // fetchFast() never clears `loading` and the page sticks on skeletons.
    mountedRef.current = true

    // Instant-paint: hydrate a recent localStorage snapshot so the gauge,
    // chart and factors render immediately instead of shimmering through the
    // fetch. fetchFast revalidates right after and overwrites with live data.
    if (!dataRef.current.current) {
      const seed = fgPersistLoad()
      if (seed) {
        const d = dataRef.current
        d.current = seed.current || null
        d.history = Array.isArray(seed.history) ? seed.history : []
        d.global = seed.global || null
        d.movers = seed.movers || null
        if (seed.btcHistory) d.btcHistory = seed.btcHistory
        d.factors = computeFactors(d.global, d.movers)
        d.lastUpdated = seed._ts ? new Date(seed._ts) : null
        setLoading(false)
        setTick(t => t + 1)
      }
    }

    // Defer the heavy background tier to idle so first paint (gauge + 1Y
    // chart + factors from fetchFast) isn't blocked by the ~1MB 2600-day
    // payload. requestIdleCallback where available, setTimeout otherwise.
    let idleId = null
    let timeoutId = null
    const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : null

    fetchFast().then(() => {
      if (!mountedRef.current) return
      if (ric) {
        idleId = ric(() => { if (mountedRef.current) fetchBackground() }, { timeout: 3000 })
      } else {
        timeoutId = setTimeout(() => { if (mountedRef.current) fetchBackground() }, 200)
      }
    })

    return () => {
      mountedRef.current = false
      if (idleId != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId)
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [fetchFast, fetchBackground])

  useAdaptivePolling(fetchFast, { interval: refreshInterval })

  // Each returned slice is memoized on a CHEAP SCALAR signature of its own
  // data, NOT on `tick`. The 120s poll bumps `tick` every time, but a slice's
  // identity only changes when its underlying value actually moves — so a poll
  // that returns the same numbers re-uses the same object references and the
  // memo'd children (Gauge/Chart/Metrics/Factors) hold. A genuine value change
  // flips the signature, mints a new reference, and the children re-render.
  // `dataRef` is read inside each memo (deliberate — `tick` is the trigger that
  // re-evaluates these memos after a fetch mutates the ref).

  /* eslint-disable react-hooks/exhaustive-deps */
  const current = dataRef.current.current
  const currentSlice = useMemo(
    () => current,
    [current?.value, current?.classification, current?.timestamp]
  )

  const global = dataRef.current.global
  const globalSlice = useMemo(
    () => global,
    [global?.totalMarketCap, global?.totalVolume, global?.btcDominance]
  )

  const movers = dataRef.current.movers
  const moversSlice = useMemo(
    () => movers,
    // gainers/losers arrays are replaced wholesale on each fetch; key on the
    // top mover identities so identity only changes when the leaderboard moves.
    [movers?.gainers?.length, movers?.losers?.length,
     movers?.gainers?.[0]?.change, movers?.losers?.[0]?.change]
  )

  const factors = dataRef.current.factors
  const factorsSlice = useMemo(
    () => factors,
    // factors is recomputed (when inputs change) inside fetchFast; key on the
    // four scalar values it produces so a no-op recompute keeps identity.
    [factors?.momentum?.value, factors?.volatility?.value,
     factors?.volume?.value, factors?.dominance?.value]
  )

  const history = dataRef.current.history
  const historySlice = useMemo(
    () => history,
    // history grows/upgrades by length (365 -> 2600) or moves at its tail.
    [history?.length, history?.[history.length - 1]?.value,
     history?.[history.length - 1]?.timestamp]
  )

  const btcHistory = dataRef.current.btcHistory
  const btcHistorySlice = useMemo(
    () => btcHistory,
    [btcHistory?.prices?.length,
     btcHistory?.prices?.[btcHistory.prices.length - 1]?.[1]]
  )

  const lastUpdated = dataRef.current.lastUpdated
  /* eslint-enable react-hooks/exhaustive-deps */

  return useMemo(() => ({
    current: currentSlice,
    global: globalSlice,
    movers: moversSlice,
    factors: factorsSlice,
    history: historySlice,
    btcHistory: btcHistorySlice,
    lastUpdated,
    loading,
    error,
    refetch: fetchFast,
  }), [currentSlice, globalSlice, moversSlice, factorsSlice, historySlice,
       btcHistorySlice, lastUpdated, loading, error, fetchFast])
}
