/**
 * useCategorySparklines - REAL 7d trend lines for category cards/rows.
 *
 * CoinGecko has no per-category price series on the API, and the page used to
 * fake one (buildSyntheticWave hash-noise seeded by the 24h change). Instead:
 * blend each category's top-3 coins' real 7d sparklines, cap-weighted, from
 * the shared top-250 markets fetch (one cached call that home/discover already
 * make - no new upstream traffic). Matching prefers CG's `top_3_coins_id`;
 * Spectre-bridge rows without ids match by the coin-image id in the
 * `top_3_coins` URLs. Categories whose leaders sit outside the top 250 get no
 * series - the UI falls back to an honest 24h momentum bar, never a fake wave.
 */
import { useState, useEffect, useMemo } from 'react'
import { getTopCoinsWithSparklines } from '@/services/coinGeckoApi'

const POINTS = 40
const IMG_ID_RE = /\/coins\/images\/(\d+)\//

export default function useCategorySparklines(categories, { enabled = true } = {}) {
  const [coins, setCoins] = useState(null)

  useEffect(() => {
    if (!enabled || coins) return
    let cancelled = false
    getTopCoinsWithSparklines()
      .then((rows) => { if (!cancelled && Array.isArray(rows) && rows.length) setCoins(rows) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return useMemo(() => {
    const seriesById = new Map()
    if (!coins || !Array.isArray(categories) || categories.length === 0) return seriesById

    const byId = new Map()
    const byImageId = new Map()
    for (const c of coins) {
      const spark = c?.sparkline_in_7d?.price
      if (!Array.isArray(spark) || spark.length < 8 || !(spark[0] > 0)) continue
      const entry = { spark, mcap: Number(c.market_cap) || 0 }
      if (c.id) byId.set(c.id, entry)
      const m = String(c.image || '').match(IMG_ID_RE)
      if (m) byImageId.set(m[1], entry)
    }

    for (const cat of categories) {
      const entries = []
      for (const id of Array.isArray(cat.top_3_coins_id) ? cat.top_3_coins_id : []) {
        const e = byId.get(id)
        if (e) entries.push(e)
      }
      if (entries.length === 0) {
        for (const img of Array.isArray(cat.top_3_coins) ? cat.top_3_coins : []) {
          const m = String(img).match(IMG_ID_RE)
          const e = m && byImageId.get(m[1])
          if (e) entries.push(e)
        }
      }
      if (entries.length === 0) continue

      // Cap-weighted mean of each coin's %-move-from-window-start, resampled
      // to a fixed point count so every card draws the same density.
      const totalW = entries.reduce((s, e) => s + (e.mcap || 1), 0) || 1
      const points = new Array(POINTS).fill(0)
      for (const e of entries) {
        const w = (e.mcap || 1) / totalW
        const s = e.spark
        const base = s[0]
        for (let i = 0; i < POINTS; i++) {
          const v = s[Math.min(s.length - 1, Math.round((i / (POINTS - 1)) * (s.length - 1)))]
          points[i] += (v / base - 1) * w
        }
      }
      seriesById.set(cat.id || cat.name, {
        points,
        change7d: points[POINTS - 1] * 100,
        matched: entries.length,
      })
    }
    return seriesById
  }, [coins, categories])
}
