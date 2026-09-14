import { describe, expect, it } from 'vitest'
import { resolveChartPanMode } from '../src/lib/chart-pan-gesture'

describe('Chart history drag intent', () => {
  it('ignores tiny movements before deciding whether to pan prices', () => {
    expect(resolveChartPanMode(null, 2, 3)).toBeNull()
    expect(resolveChartPanMode(null, -5, -1)).toBeNull()
  })

  it.each([[6, 0], [12, 2], [-12, 2], [120, -30]])(
    'keeps a horizontal history drag with drift (%s, %s) on the time axis',
    (x, y) => expect(resolveChartPanMode(null, x, y)).toBe('horizontal'),
  )

  it.each([[0, 6], [1, -12], [12, 12], [-12, 6]])(
    'preserves deliberate vertical and diagonal price drags (%s, %s)',
    (x, y) => expect(resolveChartPanMode(null, x, y)).toBe('free'),
  )

  it('does not turn a late vertical wobble into a price jump or release momentum', () => {
    let mode = null
    for (const [x, y] of [[12, 2], [80, 8], [160, 14], [161, 56]]) {
      mode = resolveChartPanMode(mode, x, y)
      expect(mode).toBe('horizontal')
    }
  })

  it('keeps deliberate free movement after the direction changes', () => {
    const mode = resolveChartPanMode(null, 6, 10)
    expect(resolveChartPanMode(mode, 100, 10)).toBe('free')
  })
})
