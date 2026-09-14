/**
 * ATH Marker Overlay
 * Draws a horizontal price line at the all-time high.
 * Uses LWC's createPriceLine API on the price series.
 */

/**
 * Adds an ATH price line to a series.
 *
 * @param {ISeriesApi} series - The price series to add the line to
 * @param {number} athPrice - All-time high price
 * @param {boolean} isDayMode
 * @returns {{ remove: Function }} - Call remove() to clean up
 */
export function addATHMarker(series, athPrice, isDayMode) {
  if (!series || !athPrice || athPrice <= 0) return { remove: () => {} }

  const line = series.createPriceLine({
    price: athPrice,
    color: isDayMode ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.4)',
    lineWidth: 1,
    lineStyle: 2, // Dashed
    axisLabelVisible: true,
    title: 'ATH',
    lineVisible: true,
  })

  return {
    remove: () => {
      try { series.removePriceLine(line) } catch (e) { /* already removed */ }
    },
  }
}

/**
 * Finds the ATH from a set of bars.
 *
 * @param {Array<{high: number}>} bars
 * @returns {number}
 */
export function findATH(bars) {
  if (!bars || bars.length === 0) return 0
  return Math.max(...bars.map(b => b.high))
}
