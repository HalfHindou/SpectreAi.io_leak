/**
 * Default grid layout for Spectre YOU — first-time users.
 * Grid: 12 columns, 80px row unit, 8px gutters
 *   (was 180px / 14px before YOU V2 spec compliance — h and y values rescaled 2×
 *    to preserve effective widget heights when row-height changed.)
 *
 * YOU-first layout with 16 widgets across 6 sections.
 * Prioritizes YOU-exclusive widgets, keeps only essential TC.
 *
 * Row 0:  BTC(3,h4) · ETH(3,h4) · SOL(3,h4) · Fear&Greed(3,h4)
 * Row 4:  TradingView Chart(8,h8) · Macro Signals(4,h8)
 * Row 12: News Feed(6,h6) · Economic Calendar(6,h6)
 * Row 18: Narrative Tracker(4,h6) · Discovery(4,h6) · ROI Calculator(4,h6)
 * Row 24: Top Coins(6,h6) · Heatmap(6,h6)
 * Row 30: Market Flows(6,h6) · Spectre Verdict(3,h6) · AI Brief(3,h6)
 */

const DEFAULT_LAYOUT = [
  // Row 0 — Price cards + Fear & Greed
  { i: 'you-btc-price',      x: 0,  y: 0,  w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'you-eth-price',      x: 3,  y: 0,  w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'you-sol-price',      x: 6,  y: 0,  w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'you-fear-greed',     x: 9,  y: 0,  w: 3, h: 4, minW: 2, minH: 2 },

  // Row 4 — Chart + Macro Signals
  { i: 'you-chart',           x: 0,  y: 4,  w: 8, h: 8, minW: 4, minH: 4 },
  { i: 'you-macro-signals',   x: 8,  y: 4,  w: 4, h: 8, minW: 3, minH: 3 },

  // Row 12 — News + Calendar
  { i: 'you-news-feed',          x: 0,  y: 12, w: 6, h: 6, minW: 4, minH: 3 },
  { i: 'you-economic-calendar',  x: 6,  y: 12, w: 6, h: 6, minW: 4, minH: 3 },

  // Row 18 — Narrative + Discovery + ROI
  { i: 'you-narrative-tracker',  x: 0,  y: 18, w: 4, h: 6, minW: 3, minH: 3 },
  { i: 'you-discovery',         x: 4,  y: 18, w: 4, h: 6, minW: 3, minH: 3 },
  { i: 'you-roi-calculator',    x: 8,  y: 18, w: 4, h: 6, minW: 3, minH: 3 },

  // Row 24 — Top Coins + Heatmap
  { i: 'you-top-coins',  x: 0,  y: 24, w: 6, h: 6, minW: 3, minH: 3 },
  { i: 'you-heatmap',    x: 6,  y: 24, w: 6, h: 6, minW: 3, minH: 3 },

  // Row 30 — Market Flows + Verdict + AI Brief
  { i: 'you-market-flows',  x: 0,  y: 30, w: 6, h: 6, minW: 4, minH: 3 },
  { i: 'you-verdict',       x: 6,  y: 30, w: 3, h: 6, minW: 2, minH: 3 },
  { i: 'you-ai-brief',      x: 9,  y: 30, w: 3, h: 6, minW: 2, minH: 3 },
]

export default DEFAULT_LAYOUT

/** Get widget IDs present in the default layout */
export function getDefaultWidgetIds() {
  return DEFAULT_LAYOUT.map(item => item.i)
}
