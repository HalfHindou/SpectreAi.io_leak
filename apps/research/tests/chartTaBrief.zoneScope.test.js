import { describe, it, expect } from 'vitest'
import { buildChartTaBrief } from '../src/lib/chart-ta-brief.js'

// Regression guard for the credibility bug: S/R zones are detected over the
// FULL fetched context (up to ~1,200 bars) while the strip reports the
// SELECTED window, so a 120-bar read printed "support ×29" — more touches than
// the window had swings. Zones still look wide (that is better analysis); the
// counts must simply say which scope they belong to.

const HOUR = 3600_000

/** Series with a known answer: a shelf at 110 tapped often in the distant
 *  past and exactly twice inside the trailing 120-bar window. */
function buildSeries() {
  const bars = []
  let t = 1_700_000_000_000
  const push = (o, h, l, c) => { bars.push({ t, o, h, l, c, v: 100 }); t += HOUR }
  for (let i = 0; i < 900; i++) {
    if (i % 30 === 15) push(104, 110, 103, 105)        // swing high into the shelf
    else if (i % 30 === 0) push(105, 106, 98, 99)      // swing low
    else push(103, 105, 101, 104)
  }
  for (let i = 0; i < 120; i++) {
    if (i === 40 || i === 90) push(104, 110, 103, 105) // exactly two taps
    else if (i % 20 === 0) push(105, 106, 99, 100)
    else push(103, 105, 101, 104)
  }
  return bars
}

function brief() {
  const bars = buildSeries()
  const win = bars.slice(-120)
  return buildChartTaBrief(
    bars,
    { fromTs: win[0].t, toTs: win[win.length - 1].t },
    { symbol: 'TEST', resolution: '60', price: 104 },
  )
}

describe('chart TA brief — zone touch counts are scoped to the read window', () => {
  it('reports the window it was actually asked about', () => {
    const b = brief()
    expect(b.ok).toBe(true)
    expect(b.stats.bars).toBe(120)
  })

  it('gives every zone both a window-scoped and a context-scoped count', () => {
    const zones = [...brief().resistances, ...brief().supports]
    expect(zones.length).toBeGreaterThan(0)
    for (const z of zones) {
      expect(Number.isFinite(z.touchesInWindow)).toBe(true)
      expect(Number.isFinite(z.touchesInContext)).toBe(true)
      expect(z.contextBars).toBe(1020)
    }
  })

  it('never claims more in-window touches than the window has bars', () => {
    const b = brief()
    for (const z of [...b.resistances, ...b.supports]) {
      expect(z.touchesInWindow).toBeLessThanOrEqual(b.stats.bars)
    }
  })

  it('keeps the wider context count — narrowing the search would weaken the read', () => {
    const zones = [...brief().resistances, ...brief().supports]
    const wide = zones.filter(z => z.touchesInContext > z.touchesInWindow)
    expect(wide.length).toBeGreaterThan(0)
  })

  it('tells the agent which scope each number belongs to', () => {
    const p = brief().prompt
    expect(p).toContain('Touch counts are SCOPED')
    expect(p).toMatch(/touches? in window, \d+ in context/)
    expect(p).toContain('Never state a context count as though it happened in the selected window')
  })

  it('never prints a bare "×N" on the chart unless the window earned it', () => {
    const b = brief()
    const bands = b.drawings.filter(d => d.tool === 'band')
    expect(bands.length).toBeGreaterThan(0)
    for (const band of bands) {
      const bare = band.label.match(/×(\d+)$/)          // "×N" with no scope tag
      if (bare) expect(Number(bare[1])).toBe(band.touchesInWindow)
      const tagged = band.label.match(/×(\d+) in context$/)
      if (tagged) expect(Number(tagged[1])).toBe(band.touchesInContext)
    }
  })
})

// ── band ordering ───────────────────────────────────────────────────────────
// The overlay places band labels top-down and may only nudge them DOWNWARD, so
// the drawings have to arrive highest price first. Measured on a real BTC read
// before this: 77,800 printed below 77,140, putting each number beside the
// wrong zone.
describe('chart TA brief — S/R bands are emitted top-down', () => {
  it('orders band drawings by price, highest first', () => {
    const bands = brief().drawings.filter(d => d.tool === 'band')
    expect(bands.length).toBeGreaterThan(1)
    const mids = bands.map(b => (b.low + b.high) / 2)
    const sorted = [...mids].sort((a, b) => b - a)
    expect(mids).toEqual(sorted)
  })

  it('still picks the nearest zones on both sides, not just the highest four', () => {
    const bands = brief().drawings.filter(d => d.tool === 'band')
    const styles = new Set(bands.map(b => b.style))
    expect(styles.has('resistance')).toBe(true)
    expect(styles.has('support')).toBe(true)
  })
})
