/**
 * useSpectreResearchZoneData — PARALLEL to useResearchZoneData (6-fan).
 *
 * The current hook fires 6 upstream calls per token nav:
 *   bootstrap + binance + cgMarket + cgDetails + codex + appResearch
 *
 * This hook reduces that to 2 calls:
 *   bootstrap + coin/{id}    (for fields bootstrap doesn't fill)
 *
 * Bootstrap returns:
 *   identity (symbol, name, cg_id, logo, categories, twitter, telegram, ...)
 *   profile (name, category, launchDate, links)
 *   score (overall, fundamentals, technical, social, risk, momentum)
 *   candles (200 bars OHLCV)
 *   pairs (per-DEX/CEX market list with priceUsd)
 *   mentions, narratives, sentiment, derivatives, technicals
 *
 * Bootstrap does NOT return (per probe 2026-05-15):
 *   price.current (use pairs[0].priceUsd or supplement)
 *   market cap, FDV, supply
 *   ATH/ATL, ATH change %
 *   sparkline_7d
 *   change 1h / 7d / 30d
 *
 * The supplement call to /v1/coins/{id} fills those. Bootstrap also gives
 * us coingecko_id in identity, so the supplement uses the right slug.
 *
 * Audit-mode: parallel infrastructure. The existing useResearchZoneData
 * stays wired into /research-zone until /dev/spectre-audit confirms parity.
 */
import { useState, useEffect, useRef } from 'react'

const DATA_API = '/data-api'
const FETCH_TIMEOUT = 15_000

async function fetchBootstrap(symbol) {
  const t0 = performance.now()
  const url = `${DATA_API}/v1/rz/${encodeURIComponent(symbol.toUpperCase())}/bootstrap`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`bootstrap HTTP ${res.status}`)
  const json = await res.json()
  return { data: json?.data || null, latencyMs: Math.round(performance.now() - t0) }
}

async function fetchCoinDetails(cgId) {
  if (!cgId) return { data: null, latencyMs: 0 }
  const t0 = performance.now()
  const url = `${DATA_API}/v1/coins/${encodeURIComponent(cgId)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`coins/{id} HTTP ${res.status}`)
  const json = await res.json()
  return { data: json || null, latencyMs: Math.round(performance.now() - t0) }
}

function extractPriceFromBootstrap(bs) {
  // Prefer pairs[0].priceUsd (sorted by volume by the backend); fall back to
  // last-candle close. The bootstrap.price field is currently null per probe.
  const fromPair = bs?.pairs?.[0]?.priceUsd
  if (Number.isFinite(fromPair) && fromPair > 0) return { value: fromPair, source: 'pair' }
  const lastCandle = bs?.candles?.[bs.candles.length - 1]
  if (lastCandle?.close && Number.isFinite(Number(lastCandle.close))) {
    return { value: Number(lastCandle.close), source: 'candle' }
  }
  return { value: null, source: null }
}

function extractMarketFromDetails(details) {
  if (!details) return null
  const md = details.market_data || {}
  return {
    mcap: md.market_cap?.usd ?? null,
    fdv: md.fully_diluted_valuation?.usd ?? null,
    circulatingSupply: md.circulating_supply ?? null,
    totalSupply: md.total_supply ?? null,
    maxSupply: md.max_supply ?? null,
    volume24h: md.total_volume?.usd ?? null,
    ath: md.ath?.usd ?? null,
    athDate: md.ath_date?.usd ?? null,
    athChangePct: md.ath_change_percentage?.usd ?? null,
    atl: md.atl?.usd ?? null,
    atlDate: md.atl_date?.usd ?? null,
    atlChangePct: md.atl_change_percentage?.usd ?? null,
    change1h: md.price_change_percentage_1h_in_currency?.usd ?? null,
    change24h: md.price_change_percentage_24h ?? null,
    change7d: md.price_change_percentage_7d ?? null,
    change30d: md.price_change_percentage_30d ?? null,
    sparkline7d: Array.isArray(md.sparkline_7d?.price) ? md.sparkline_7d.price : null,
  }
}

/**
 * @param {string} symbol  e.g. 'BTC' (case-insensitive)
 * @returns {{
 *   identity, price, market, score, candles, pairs, mentions, narratives,
 *   sentiment, derivatives, technicals,
 *   loading: boolean, error: string|null, meta: object
 * }}
 */
export function useSpectreResearchZoneData(symbol) {
  const [state, setState] = useState({
    identity: null, price: null, market: null, score: null,
    candles: [], pairs: [], mentions: [], narratives: [],
    sentiment: null, derivatives: null, technicals: null,
    loading: true, error: null,
    meta: { bootstrapMs: null, detailsMs: null, totalMs: null, calls: 0 },
  })
  const activeSymRef = useRef(symbol)
  activeSymRef.current = symbol

  useEffect(() => {
    if (!symbol) { setState(s => ({ ...s, loading: false })); return }
    let cancelled = false
    const tStart = performance.now()

    async function run() {
      setState(s => ({ ...s, loading: true, error: null }))
      try {
        const bs = await fetchBootstrap(symbol)
        if (cancelled || activeSymRef.current !== symbol) return

        const identity = bs.data?.identity || null
        const cgId = identity?.coingecko_id || null
        const priceFromBs = extractPriceFromBootstrap(bs.data || {})

        // Early-paint: surface bootstrap fields immediately, supplement later.
        setState(s => ({
          ...s,
          identity,
          price: priceFromBs.value
            ? { current: priceFromBs.value, source: `spectre-${priceFromBs.source}` }
            : null,
          score: bs.data?.score || null,
          candles: bs.data?.candles || [],
          pairs: bs.data?.pairs || [],
          mentions: bs.data?.mentions || [],
          narratives: bs.data?.narratives || [],
          sentiment: bs.data?.sentiment || null,
          derivatives: bs.data?.derivatives || null,
          technicals: bs.data?.technicals || null,
          meta: { bootstrapMs: bs.latencyMs, detailsMs: null, totalMs: null, calls: 1 },
        }))

        // Supplement market data via /v1/coins/{id} (Spectre-side cached).
        // Skip if no cgId in bootstrap (truly orphan token — UI shows partial).
        if (!cgId) {
          setState(s => ({
            ...s,
            loading: false,
            meta: {
              ...s.meta,
              totalMs: Math.round(performance.now() - tStart),
              note: 'no cgId — market fields unfilled',
            },
          }))
          return
        }

        const det = await fetchCoinDetails(cgId)
        if (cancelled || activeSymRef.current !== symbol) return
        const market = extractMarketFromDetails(det.data)

        setState(s => ({
          ...s,
          market,
          loading: false,
          meta: {
            bootstrapMs: bs.latencyMs,
            detailsMs: det.latencyMs,
            totalMs: Math.round(performance.now() - tStart),
            calls: 2,
          },
        }))
      } catch (err) {
        if (cancelled || activeSymRef.current !== symbol) return
        setState(s => ({
          ...s,
          loading: false,
          error: err?.message || 'fetch failed',
          meta: { ...s.meta, totalMs: Math.round(performance.now() - tStart) },
        }))
      }
    }

    run()
    return () => { cancelled = true }
  }, [symbol])

  return state
}
