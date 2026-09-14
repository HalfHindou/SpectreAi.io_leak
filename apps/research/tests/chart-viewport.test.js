import { describe, expect, it } from 'vitest'
import { computeChartGeometry, computeChartWindow, computeOffsetBounds, MIN_CHART_ZOOM } from '../src/lib/chart-viewport'
import { getDefaultChartZoom } from '../src/lib/chart-default-view'

const firstX = (window, width) => (window.leftEmptyCandles - window.rightEmptyCandles + 0.5) * width
const lastX = (window, width) => firstX(window, width) + (window.endIndex - window.startIndex - 1) * width

describe('Chart viewport boundaries', () => {
  it('stops the reported 24h zoom-out at the complete loaded history', () => {
    // Before the fix this production-sized buffer occupied 18.4–70.0% of the pane.
    const geometry = computeChartGeometry(620, 0.5, 1200, '1D')
    expect(geometry).toEqual(computeChartGeometry(620, MIN_CHART_ZOOM, 1200, '1D'))
    expect(geometry.visibleCount).toBe(620)
    const window = computeChartWindow(620, geometry.visibleCount, 0, true)
    expect(window.startIndex).toBe(0)
    expect(window.endIndex).toBe(620)
    expect(firstX(window, geometry.candleWidth)).toBeLessThan(2)
    expect(lastX(window, geometry.candleWidth)).toBeGreaterThan(1198)
  })

  it.each(['1M', '1D', '1W', '1MO', 'YTD', 'ALL'])('enforces the full-buffer zoom floor for %s', timeframe => {
    for (const len of [0, 5, 18, 620, 5000]) {
      const full = computeChartGeometry(len, 1, 1200, timeframe)
      expect(Number.isFinite(full.candleWidth)).toBe(true)
      expect(Number.isFinite(full.visibleCount)).toBe(true)
      expect(computeChartGeometry(len, 0.1, 1200, timeframe)).toEqual(full)
    }
  })

  it('counts future space once when candle-width limits leave an underfilled buffer', () => {
    const visibleCount = 1200
    const { minOffset } = computeOffsetBounds(620, visibleCount, true)
    const window = computeChartWindow(620, visibleCount, minOffset, true)
    // Each endpoint is a candle centre: add half a slot to measure the gutter.
    expect(lastX(window, 1) + 0.5).toBe(1200 * 0.85)
    expect(window.rightEmptyCandles).toBe(180)
    expect(window.endIndex - window.startIndex).toBe(620)
  })

  it('keeps future overscroll capped at 15% with a full buffer', () => {
    const window = computeChartWindow(1000, 200, -1000, true)
    expect(window.clampedPanOffset).toBe(-30)
    expect(lastX(window, 5) + 2.5).toBe(850)
  })

  it('keeps the oldest-history edge reachable, including when all loaded bars fit', () => {
    for (const [len, visibleCount] of [[620, 620], [1000, 200]]) {
      const bounds = computeOffsetBounds(len, visibleCount, true)
      expect(bounds.maxOffset).toBe(bounds.baseMaxOffset + Math.floor(visibleCount * 0.12))
      const window = computeChartWindow(len, visibleCount, bounds.maxOffset, true)
      expect(window.startIndex).toBe(0)
      expect(window.leftEmptyCandles).toBe(Math.floor(visibleCount * 0.12))
      expect(window.rightEmptyCandles).toBe(0)
      expect(window.clampedPanOffset).toBeGreaterThan(0)
      expect(computeOffsetBounds(len, visibleCount, false).maxOffset).toBe(bounds.baseMaxOffset)
    }
  })

  it('preserves preset framing for sparse data and full-history views', () => {
    const now = Date.UTC(2026, 8, 13, 18)
    const bars = Array.from({ length: 300 }, (_, i) => ({ date: new Date(now - (299 - i) * 3600_000) }))
    const zoom = getDefaultChartZoom(bars, '1D', false, now)
    const geometry = computeChartGeometry(bars.length, zoom, 1200, '1D')
    expect(geometry.visibleCount).toBe(25)
    expect(geometry.candleWidth * geometry.visibleCount).toBeCloseTo(1200)
    expect(computeChartGeometry(5000, 1, 1200, 'ALL').visibleCount).toBe(5000)
    expect(computeChartGeometry(5000, 1, 1200, 'YTD').visibleCount).toBe(5000)
  })

  it('preserves visible density when older history is prepended', () => {
    const before = computeChartGeometry(1000, 4, 1200, '1D')
    const after = computeChartGeometry(4000, 4 * (4000 / 1000), 1200, '1D')
    expect(after).toEqual(before)
    const window = computeChartWindow(4000, after.visibleCount, 0, true)
    expect(window.endIndex).toBe(4000)
    expect(window.leftEmptyCandles).toBe(0)
    expect(window.rightEmptyCandles).toBe(0)
  })
})
