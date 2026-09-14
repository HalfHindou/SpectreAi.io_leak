/**
 * Trade Markers Overlay
 * Adds buy/sell markers from wallet transaction history to the chart.
 * Uses LWC's setMarkers API on the price series.
 */

/**
 * Sets trade markers on a series.
 *
 * @param {ISeriesApi} series - The price series
 * @param {Array<{time: number, type: 'buy'|'sell', price: number, amount?: string}>} trades
 * @returns {{ remove: Function }}
 */
export function setTradeMarkers(series, trades) {
  if (!series || !trades || trades.length === 0) {
    return { remove: () => {} }
  }

  const markers = trades
    .filter(t => t.time && t.type)
    .sort((a, b) => a.time - b.time)
    .map(t => ({
      time: t.time,
      position: t.type === 'buy' ? 'belowBar' : 'aboveBar',
      color: t.type === 'buy' ? '#10B981' : '#EF4444',
      shape: t.type === 'buy' ? 'arrowUp' : 'arrowDown',
      text: t.type === 'buy' ? 'B' : 'S',
      size: 1,
    }))

  series.setMarkers(markers)

  return {
    remove: () => {
      try { series.setMarkers([]) } catch (e) { /* series removed */ }
    },
  }
}
