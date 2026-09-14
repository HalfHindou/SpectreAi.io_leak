// Run: node apps/trading/src/lib/__tests__/tokenLayout.test.mjs
import assert from 'node:assert'
import {
  DEFAULT_TOKEN_LAYOUT, LAYOUT_PRESETS, sanitizeTokenLayout, swapSides,
  moveSection, swapSection, toggleSectionHidden, compileTokenLayout, SECTION_IDS,
} from '../tokenLayout.js'

let n = 0
const t = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`) }

// ---- sanitizer ----
t('garbage input falls back to default', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}, { zones: null }]) {
    assert.deepStrictEqual(sanitizeTokenLayout(bad).zones, { left: ['watch'], center: ['banner', 'chart', 'txns'], right: ['trade'], bottom: [] })
  }
})
t('default layout passes through unchanged', () => {
  const s = sanitizeTokenLayout(DEFAULT_TOKEN_LAYOUT)
  assert.deepStrictEqual(s.zones, { left: ['watch'], center: ['banner', 'chart', 'txns'], right: ['trade'], bottom: [] })
  assert.deepStrictEqual(s.sizes, { leftW: 380, rightW: 380 })
})
t('every section placed exactly once even when blob drops/duplicates', () => {
  const s = sanitizeTokenLayout({ zones: { left: ['watch', 'watch'], center: ['chart'], right: [], bottom: ['chart'] } })
  const all = [...s.zones.left, ...s.zones.center, ...s.zones.right, ...s.zones.bottom]
  assert.deepStrictEqual([...all].sort(), [...SECTION_IDS].sort())
  assert.strictEqual(all.length, 5)
})
t('wide sections forced out of rails', () => {
  const s = sanitizeTokenLayout({ zones: { left: ['chart', 'txns'], center: ['banner'], right: ['trade'], bottom: [] } })
  assert.ok(!s.zones.left.includes('chart') && !s.zones.left.includes('txns'))
  assert.ok(s.zones.center.includes('chart'))
})
t('center never empty - chart pulled back', () => {
  const s = sanitizeTokenLayout({ zones: { left: ['watch'], center: [], right: ['trade'], bottom: ['banner', 'chart', 'txns'] } })
  assert.ok(s.zones.center.length >= 1)
})
t('sizes clamped 280-560; every section is hideable but never all 5', () => {
  const s = sanitizeTokenLayout({ zones: DEFAULT_TOKEN_LAYOUT.zones, sizes: { leftW: 50, rightW: 9000 }, hidden: ['chart', 'trade', 'banner'] })
  assert.deepStrictEqual(s.sizes, { leftW: 280, rightW: 560 })
  assert.deepStrictEqual([...s.hidden].sort(), ['banner', 'chart', 'trade'])
  // Guard: hiding ALL sections keeps the chart visible (never a blank page).
  const all = sanitizeTokenLayout({ zones: DEFAULT_TOKEN_LAYOUT.zones, hidden: ['watch', 'banner', 'chart', 'txns', 'trade'] })
  assert.ok(!all.hidden.includes('chart'))
  assert.strictEqual(all.hidden.length, 4)
})

// ---- moves ----
t('swapSides mirrors zones and rail widths', () => {
  const s = swapSides({ ...DEFAULT_TOKEN_LAYOUT, sizes: { leftW: 300, rightW: 464 } })
  assert.deepStrictEqual(s.zones.left, ['trade'])
  assert.deepStrictEqual(s.zones.right, ['watch'])
  assert.deepStrictEqual(s.sizes, { leftW: 464, rightW: 300 })
})
t('moveSection trade -> occupied left rail SWAPS with watch', () => {
  const s = moveSection(DEFAULT_TOKEN_LAYOUT, 'trade', 'left', 0)
  assert.deepStrictEqual(s.zones.left, ['trade'])
  assert.deepStrictEqual(s.zones.right, ['watch'])
})
t('rails hold one section - extras re-home (free default rail first)', () => {
  const s = sanitizeTokenLayout({ zones: { left: ['watch', 'trade'], center: ['banner', 'chart', 'txns'], right: [], bottom: [] } })
  assert.deepStrictEqual(s.zones.left, ['watch'])
  assert.deepStrictEqual(s.zones.right, ['trade']) // its default zone was free
  // when the default rail is ALSO occupied, the extra drops to bottom
  const s2 = sanitizeTokenLayout({ zones: { left: ['trade', 'watch'], center: ['banner', 'chart', 'txns'], right: [], bottom: [] } })
  assert.deepStrictEqual(s2.zones.left, ['trade'])
  assert.deepStrictEqual(s2.zones.bottom, ['watch']) // left (its default) held trade
})
t('moveSection watch -> bottom', () => {
  const s = moveSection(DEFAULT_TOKEN_LAYOUT, 'watch', 'bottom')
  assert.deepStrictEqual(s.zones.left, [])
  assert.deepStrictEqual(s.zones.bottom, ['watch'])
})
t('moveSection rejects wide section into rail (unchanged)', () => {
  const s = moveSection(DEFAULT_TOKEN_LAYOUT, 'chart', 'left')
  assert.deepStrictEqual(s.zones, sanitizeTokenLayout(DEFAULT_TOKEN_LAYOUT).zones)
})
t('moveSection refuses to empty center', () => {
  const soloCenter = sanitizeTokenLayout({ zones: { left: ['watch'], center: ['chart'], right: ['trade'], bottom: ['banner', 'txns'] } })
  const s = moveSection(soloCenter, 'chart', 'bottom')
  assert.ok(s.zones.center.includes('chart'))
})
t('swapSection: same-zone center swap trades positions', () => {
  const s = swapSection(DEFAULT_TOKEN_LAYOUT, 'banner', 'chart')
  assert.deepStrictEqual(s.zones.center, ['chart', 'banner', 'txns'])
})
t('swapSection: chart <-> txns (both center)', () => {
  const s = swapSection(DEFAULT_TOKEN_LAYOUT, 'chart', 'txns')
  assert.deepStrictEqual(s.zones.center, ['banner', 'txns', 'chart'])
})
t('swapSection: watch <-> trade flips the rails', () => {
  const s = swapSection(DEFAULT_TOKEN_LAYOUT, 'watch', 'trade')
  assert.deepStrictEqual(s.zones.left, ['trade'])
  assert.deepStrictEqual(s.zones.right, ['watch'])
})
t('swapSection: wide section into a rail is rejected (unchanged)', () => {
  const s = swapSection(DEFAULT_TOKEN_LAYOUT, 'chart', 'trade')
  assert.deepStrictEqual(s.zones, sanitizeTokenLayout(DEFAULT_TOKEN_LAYOUT).zones)
})
t('swapSection: same section is a no-op', () => {
  const s = swapSection(DEFAULT_TOKEN_LAYOUT, 'chart', 'chart')
  assert.deepStrictEqual(s.zones, sanitizeTokenLayout(DEFAULT_TOKEN_LAYOUT).zones)
})
t('reorder within center', () => {
  const s = moveSection(DEFAULT_TOKEN_LAYOUT, 'chart', 'center', 0)
  assert.deepStrictEqual(s.zones.center, ['chart', 'banner', 'txns'])
})
t('toggleSectionHidden round-trips for any section incl. chart/trade', () => {
  const h = toggleSectionHidden(DEFAULT_TOKEN_LAYOUT, 'banner')
  assert.deepStrictEqual(h.hidden, ['banner'])
  assert.deepStrictEqual(toggleSectionHidden(h, 'banner').hidden, [])
  // chart + trade are now hideable (Gleb request)
  assert.deepStrictEqual(toggleSectionHidden(DEFAULT_TOKEN_LAYOUT, 'chart').hidden, ['chart'])
  assert.deepStrictEqual(toggleSectionHidden(DEFAULT_TOKEN_LAYOUT, 'trade').hidden, ['trade'])
})

// ---- compiler ----
t('default compile: 3 rows (last flexible), expected placements', () => {
  const c = compileTokenLayout(DEFAULT_TOKEN_LAYOUT)
  assert.strictEqual(c.containerStyle.gridTemplateRows, 'minmax(0, auto) minmax(0, auto) minmax(0, 1fr)')
  assert.deepStrictEqual(c.sectionStyles.watch, { gridColumn: '1', gridRow: '1 / 4' })
  assert.deepStrictEqual(c.sectionStyles.banner, { gridColumn: '2', gridRow: '1 / 2' })
  assert.deepStrictEqual(c.sectionStyles.chart, { gridColumn: '2', gridRow: '2 / 3' })
  assert.deepStrictEqual(c.sectionStyles.txns, { gridColumn: '2', gridRow: '3 / 4' })
  assert.deepStrictEqual(c.sectionStyles.trade, { gridColumn: '3', gridRow: '1 / 4' })
  assert.strictEqual(c.containerStyle.gridTemplateColumns, '380px minmax(0, 1fr) 380px')
})
t('collapse zeroes the rail width; railCap clamps', () => {
  const c = compileTokenLayout(DEFAULT_TOKEN_LAYOUT, { leftCollapsed: true })
  assert.strictEqual(c.containerStyle.gridTemplateColumns, '0px minmax(0, 1fr) 380px')
  const capped = compileTokenLayout(LAYOUT_PRESETS.terminal, { railCap: 300 })
  assert.strictEqual(capped.containerStyle.gridTemplateColumns, '0px minmax(0, 1fr) 300px')
})
t('trade-on-left + watch-right mirrors columns, rows unchanged', () => {
  const c = compileTokenLayout(swapSides(DEFAULT_TOKEN_LAYOUT))
  assert.deepStrictEqual(c.sectionStyles.trade, { gridColumn: '1', gridRow: '1 / 4' })
  assert.deepStrictEqual(c.sectionStyles.watch, { gridColumn: '3', gridRow: '1 / 4' })
})
t('watch-bottom-full-width: empty rail 0px + bottom row', () => {
  const c = compileTokenLayout(moveSection(DEFAULT_TOKEN_LAYOUT, 'watch', 'bottom'))
  assert.ok(c.containerStyle.gridTemplateColumns.startsWith('0px '))
  assert.strictEqual(c.containerStyle.gridTemplateRows, 'minmax(0, auto) minmax(0, auto) minmax(0, 1fr) minmax(0, auto)')
  assert.deepStrictEqual(c.sectionStyles.watch, { gridColumn: '1 / -1', gridRow: '4 / 5' })
  assert.strictEqual(c.meta.leftEmpty, true)
  assert.strictEqual(c.meta.hasBottom, true)
})
t('swap-on-drop compile: trade left / watch right, full spans', () => {
  const c = compileTokenLayout(moveSection(DEFAULT_TOKEN_LAYOUT, 'trade', 'left', 1))
  assert.deepStrictEqual(c.sectionStyles.trade, { gridColumn: '1', gridRow: '1 / 4' })
  assert.deepStrictEqual(c.sectionStyles.watch, { gridColumn: '3', gridRow: '1 / 4' })
  assert.strictEqual(c.meta.rightEmpty, false)
})
t('hidden sections get display:none and free their rows', () => {
  const c = compileTokenLayout(toggleSectionHidden(DEFAULT_TOKEN_LAYOUT, 'banner'))
  assert.deepStrictEqual(c.sectionStyles.banner, { display: 'none' })
  assert.strictEqual(c.containerStyle.gridTemplateRows, 'minmax(0, auto) minmax(0, 1fr)')
  assert.deepStrictEqual(c.sectionStyles.chart, { gridColumn: '2', gridRow: '1 / 2' })
})
t('focus preset: just chart center + txns bottom (trade hidden)', () => {
  const c = compileTokenLayout(LAYOUT_PRESETS.focus)
  assert.strictEqual(c.containerStyle.gridTemplateRows, 'minmax(0, auto) minmax(0, auto) minmax(0, 1fr)')
  assert.deepStrictEqual(c.sectionStyles.chart, { gridColumn: '2', gridRow: '1 / 2' })
  assert.deepStrictEqual(c.sectionStyles.trade, { display: 'none' })
  assert.deepStrictEqual(c.sectionStyles.txns, { gridColumn: '1 / -1', gridRow: '2 / 3' })
  assert.deepStrictEqual(c.sectionStyles.watch, { display: 'none' })
  assert.ok(c.containerStyle.gridTemplateColumns.startsWith('0px '))
})
t('narrow tier forces default + watch hidden', () => {
  const custom = swapSides(DEFAULT_TOKEN_LAYOUT)
  const c = compileTokenLayout(custom, { tier: 'narrow' })
  assert.deepStrictEqual(c.sectionStyles.watch, { display: 'none' })
  assert.deepStrictEqual(c.sectionStyles.trade, { gridColumn: '3', gridRow: '1 / 4' }) // default placement, not swapped
  assert.ok(c.containerStyle.gridTemplateColumns.startsWith('0px '))
})
t('single tier stacks everything full-width', () => {
  const c = compileTokenLayout(DEFAULT_TOKEN_LAYOUT, { tier: 'single' })
  assert.deepStrictEqual(c.sectionStyles.banner, { gridColumn: '1 / -1', gridRow: '1 / 2' })
  assert.deepStrictEqual(c.sectionStyles.trade, { gridColumn: '1 / -1', gridRow: '4 / 5' })
  assert.deepStrictEqual(c.sectionStyles.watch, { display: 'none' })
})
t('terminal preset: no left rail, 464px trade', () => {
  const c = compileTokenLayout(LAYOUT_PRESETS.terminal)
  assert.strictEqual(c.containerStyle.gridTemplateColumns, '0px minmax(0, 1fr) 464px')
})

console.log(`\nall ${n} tokenLayout tests passed`)
