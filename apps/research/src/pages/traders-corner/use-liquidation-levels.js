/**
 * use-liquidation-levels — real liquidation cluster data for the Liquidation
 * Bars / Bubbles widgets.
 *
 * Source: getExternalLiqHeatmap() (Binance-cohort liquidation heatmap, real
 * OI + leverage data) + getKlines() for the live mark price. We take the most
 * recent heatmap column, map its grid rows to price levels, and split them by
 * the live price:
 *   - levels ABOVE price  = SHORT liquidations (shorts blow out as price rises)
 *   - levels BELOW price  = LONG  liquidations (longs blow out as price falls)
 *
 * Returns plain objects (never arrays) per hook convention.
 */
import { useState, useEffect } from 'react'
import { getExternalLiqHeatmap, getKlines } from './tradersCornerApi'

// How many clusters to surface per side. Keeps the bar/bubble views readable.
const PER_SIDE = 5

function pickTopClusters(rows, currentPrice) {
  const longs = []  // below price
  const shorts = [] // above price
  for (const r of rows) {
    if (!Number.isFinite(r.price) || !Number.isFinite(r.amount) || r.amount <= 0) continue
    if (r.price < currentPrice) longs.push({ ...r, type: 'long' })
    else if (r.price > currentPrice) shorts.push({ ...r, type: 'short' })
  }
  const byAmount = (a, b) => b.amount - a.amount
  const topLongs = longs.sort(byAmount).slice(0, PER_SIDE).sort((a, b) => a.price - b.price)
  const topShorts = shorts.sort(byAmount).slice(0, PER_SIDE).sort((a, b) => a.price - b.price)
  return { longs: topLongs, shorts: topShorts }
}

export function useLiquidationLevels(symbol = 'BTCUSDT') {
  const [state, setState] = useState({
    currentPrice: 0,
    longs: [],   // [{ price, amount, type:'long' }]
    shorts: [],  // [{ price, amount, type:'short' }]
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [heatmap, klines] = await Promise.all([
          getExternalLiqHeatmap('Binance', symbol, '1w'),
          getKlines(symbol, '1h', 1).catch(() => []),
        ])

        // Live mark price: last kline close, fallback to heatmap mid-range.
        let currentPrice = klines.length ? klines[klines.length - 1].close : 0
        const priceArray = heatmap?.priceArray || []
        if (!currentPrice && priceArray.length) {
          currentPrice = priceArray[Math.floor(priceArray.length / 2)]
        }

        // Collapse the most recent time column into price-level magnitudes.
        const lastCol = (heatmap?.cols || 1) - 1
        const byRow = new Map()
        for (const cell of heatmap?.grid || []) {
          if (cell.col !== lastCol) continue
          byRow.set(cell.row, (byRow.get(cell.row) || 0) + cell.value)
        }

        const rows = [...byRow.entries()].map(([row, value]) => ({
          price: priceArray[row],
          amount: value,
        }))

        const { longs, shorts } = pickTopClusters(rows, currentPrice)

        if (!cancelled) {
          setState({ currentPrice, longs, shorts, loading: false, error: null })
        }
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: err.message }))
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [symbol])

  return state
}

export default useLiquidationLevels
