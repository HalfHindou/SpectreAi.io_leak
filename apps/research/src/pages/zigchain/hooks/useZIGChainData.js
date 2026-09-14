import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getSpectrePricesBySymbols, getSpectreTokenChart, getSpectreTokenProfile } from '@/services/spectreMarketApi'

// Persistent cache so the hero numbers paint instantly on revisit, even
// before the network responds. Refreshed via the existing polling loop.
const LS_KEY = 'spectre.zigchain.snapshot.v1'
const LS_MAX_AGE_MS = 6 * 60 * 60 * 1000

function readSnapshot() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.ts || Date.now() - parsed.ts > LS_MAX_AGE_MS) return null
    return parsed
  } catch (_) { return null }
}
function writeSnapshot(snap) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...snap, ts: Date.now() })) } catch (_) { /* noop */ }
}

export function useZIGChainData() {
  const _seed = readSnapshot()
  const [price, setPrice] = useState(() => _seed?.price || null)
  const [marketData, setMarketData] = useState(() => _seed?.marketData || null)
  const [sparkline, setSparkline] = useState(() => _seed?.sparkline || null)
  const [loading, setLoading] = useState(() => !_seed)
  const [error, setError] = useState(null)
  // Mirror refs - lets the snapshot writer read latest values without nested setState.
  const priceRef = useRef(price)
  const marketRef = useRef(marketData)
  const sparkRef = useRef(sparkline)
  useEffect(() => { priceRef.current = price }, [price])
  useEffect(() => { marketRef.current = marketData }, [marketData])
  useEffect(() => { sparkRef.current = sparkline }, [sparkline])

  const fetchAll = useCallback(async () => {
    setError(null)

    // Kick off all three in parallel but commit each one to state the moment
    // it lands. Previously we awaited Promise.all which made the price card
    // sit on "..." until the slowest call (chart, ~1s+) returned. Now the
    // price + rank populate as soon as /prices comes back (~300ms) and the
    // detailed market stats / sparkline backfill as their fetches resolve.
    const pPrice = getSpectrePricesBySymbols(['ZIG'])
      .then((priceData) => {
        const row = priceData?.ZIG
        if (!row) return
        // Promote whatever the prices endpoint already gives us into the
        // marketData block so high/low + period changes + ATH render
        // without waiting for the profile bridge.
        setPrice({
          usd: row.price,
          change24h: row.change24,
          marketCap: row.marketCap,
          volume24h: row.volume,
        })
        const ath = row.ath && typeof row.ath === 'object' ? row.ath : null
        const athPrice = ath?.price ?? (typeof row.ath === 'number' ? row.ath : null)
        // Spectre /prices sometimes returns ath.change_pct = null even when
        // ath.price is set. Compute it from the current price as fallback.
        const athChangeComputed = athPrice && row.price
          ? ((row.price - athPrice) / athPrice) * 100
          : null
        setMarketData((prev) => ({
          ...(prev || {}),
          ath: athPrice ?? prev?.ath ?? null,
          athDate: ath?.date ?? prev?.athDate ?? null,
          athChangePercent: ath?.change_pct ?? athChangeComputed ?? prev?.athChangePercent ?? null,
          low24h: row.low24h ?? prev?.low24h ?? null,
          high24h: row.high24h ?? prev?.high24h ?? null,
          fdv: row.fdv ?? prev?.fdv ?? null,
          totalSupply: row.totalSupply ?? prev?.totalSupply ?? null,
          circulatingSupply: row.circulatingSupply ?? prev?.circulatingSupply ?? null,
          marketCapRank: row.rank ?? prev?.marketCapRank ?? null,
          change7d: row.change7d ?? prev?.change7d ?? null,
          change30d: row.change30d ?? prev?.change30d ?? null,
          change1h: row.change1h ?? prev?.change1h ?? null,
          change1y: row.change1y ?? prev?.change1y ?? null,
        }))
        // Once the price card has data we can drop the global skeleton.
        setLoading(false)
      })
      .catch(() => {})

    const pProfile = getSpectreTokenProfile('ZIG')
      .then((coinData) => {
        if (!coinData) return
        // Profile may carry richer fields than /prices (description, links,
        // ath history). Merge on top of whatever /prices already populated.
        const p = coinData.price || coinData.market_data || {}
        const m = coinData.market || coinData.market_data || {}
        const s = coinData.supply || coinData.market_data || {}
        const ch = p.change || {}
        const ath = p.ath && typeof p.ath === 'object'
          ? p.ath
          : { price: p.ath ?? null, date: p.ath_date ?? null, change_pct: p.ath_change_percentage ?? null }
        setMarketData((prev) => ({
          ...(prev || {}),
          ath: prev?.ath ?? ath?.price ?? null,
          athDate: prev?.athDate ?? ath?.date ?? null,
          athChangePercent: prev?.athChangePercent ?? ath?.change_pct ?? p.ath_change_percentage ?? null,
          low24h: prev?.low24h ?? p.low_24h ?? m.low_24h ?? null,
          high24h: prev?.high24h ?? p.high_24h ?? m.high_24h ?? null,
          fdv: prev?.fdv ?? m.fully_diluted_valuation ?? m.fdv ?? null,
          totalSupply: prev?.totalSupply ?? s.total ?? s.total_supply ?? m.total_supply ?? null,
          circulatingSupply: prev?.circulatingSupply ?? s.circulating ?? s.circulating_supply ?? m.circulating_supply ?? null,
          marketCapRank: prev?.marketCapRank ?? coinData.rank ?? coinData.market_cap_rank ?? m.market_cap_rank ?? null,
          change7d: prev?.change7d ?? p.change_7d ?? ch['7d'] ?? m.price_change_percentage_7d ?? null,
          change30d: prev?.change30d ?? p.change_30d ?? ch['30d'] ?? m.price_change_percentage_30d ?? null,
          change1h: prev?.change1h ?? p.change_1h ?? ch['1h'] ?? null,
          change1y: prev?.change1y ?? p.change_1y ?? ch['1y'] ?? null,
        }))
      })
      .catch(() => {})

    const pChart = getSpectreTokenChart('ZIG', { interval: '1h', limit: 168 })
      .then((chartData) => {
        if (!Array.isArray(chartData) || !chartData.length) return
        setSparkline(chartData.map((row) => row.close ?? row.price).filter((n) => Number.isFinite(Number(n))))
      })
      .catch(() => {})

    // If everything fails, still drop loading after a short grace window.
    Promise.allSettled([pPrice, pProfile, pChart]).finally(() => {
      setLoading(false)
      // Snapshot whatever we ended up with so next visit paints instantly.
      // Microtask so the refs catch the last setState batch from this fetch.
      queueMicrotask(() => writeSnapshot({
        price: priceRef.current,
        marketData: marketRef.current,
        sparkline: sparkRef.current,
      }))
    })
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  useAdaptivePolling(fetchAll, { interval: 60_000 })

  return { price, marketData, sparkline, loading, error, refetch: fetchAll }
}
