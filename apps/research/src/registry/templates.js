/**
 * YOU V2 — Template registry.
 *
 * Six archetypal dashboards. Each one is a starting layout the user can
 * apply with one click and then customize freely.
 *
 * Validation: every widget_id MUST exist in widgets.js. No overlaps.
 * Total layout fits the 12-column grid. Each widget respects min_size
 * (and max_size when defined). Run validateTemplate(template) before
 * shipping any change.
 *
 * Some entries in the spec referenced widgets that are still planned
 * (not built today). Those have been substituted with the closest active
 * widget and noted in the description. See /tmp/youv2/template-gaps.txt
 * for the substitution audit.
 */

/** @typedef {import('./index.js').WidgetSize} WidgetSize */

/**
 * @typedef {Object} TemplateWidget
 * @property {string} widget_id            must exist in WIDGETS
 * @property {number} x                    0..11 grid column
 * @property {number} y                    0..N grid row
 * @property {number} w                    width in columns
 * @property {number} h                    height in rows
 * @property {Record<string, any>} [props] optional default-prop overrides
 */

/**
 * @typedef {Object} TemplateEntry
 * @property {string} id
 * @property {string} name
 * @property {string} tagline               one short line, founder voice
 * @property {string} description           one paragraph
 * @property {'perps'|'onchain'|'degen'|'rwa'|'narrative'|'whale'} archetype
 * @property {0 | 500 | 1000 | 7000} tier_min
 * @property {string} preview_image
 * @property {TemplateWidget[]} layout
 */

/** @type {TemplateEntry[]} */
export const TEMPLATES = [
  {
    id: 'perps-trader',
    name: 'Perps Trader',
    tagline: 'Built for derivatives.',
    description: 'Funding skew, open interest, liquidation maps, and top trader positioning. Designed for someone running leveraged size who needs the derivatives picture in one glance.',
    archetype: 'perps',
    tier_min: 500,
    preview_image: '/templates/perps-trader.png',
    layout: [
      { widget_id: 'you-funding-heatmap',  x: 0, y: 0,   w: 8, h: 4 },
      { widget_id: 'you-perp-funding-skew', x: 8, y: 0,  w: 4, h: 4 },
      { widget_id: 'you-open-interest',    x: 0, y: 4,   w: 6, h: 4 },
      { widget_id: 'you-liq-bubbles',      x: 6, y: 4,   w: 6, h: 4 },
      { widget_id: 'you-cvd',              x: 0, y: 8,   w: 6, h: 4 },
      { widget_id: 'you-orderbook',        x: 6, y: 8,   w: 6, h: 4 },
      { widget_id: 'you-whale-alerts',     x: 0, y: 12,  w: 6, h: 5 },
      { widget_id: 'you-screener',         x: 6, y: 12,  w: 6, h: 5 },
    ],
  },
  {
    id: 'onchain-analyst',
    name: 'Onchain Analyst',
    tagline: 'The on-chain truth.',
    description: 'Whale flows, exchange deposits and withdrawals, supply movements, and macro context. For traders who think on-chain data leads price.',
    archetype: 'onchain',
    tier_min: 1000,
    preview_image: '/templates/onchain-analyst.png',
    layout: [
      { widget_id: 'you-whale-alerts',       x: 0, y: 0,   w: 8, h: 5 },
      { widget_id: 'you-exchange-flows',     x: 8, y: 0,   w: 4, h: 5 },
      { widget_id: 'you-onchain',            x: 0, y: 5,   w: 6, h: 4 },
      { widget_id: 'you-etf-flows',          x: 6, y: 5,   w: 6, h: 4 },
      { widget_id: 'you-watchlist',          x: 0, y: 9,   w: 6, h: 5 },
      { widget_id: 'you-verdict',            x: 6, y: 9,   w: 6, h: 5 },
      { widget_id: 'you-macro-pulse',        x: 0, y: 14,  w: 12, h: 3 },
    ],
  },
  {
    id: 'degen',
    name: 'Degen',
    tagline: 'Where the action is.',
    description: 'New pairs, narrative momentum, trending tokens, and social heat. For traders who hunt rotation and live on Crypto Twitter.',
    archetype: 'degen',
    tier_min: 0,
    preview_image: '/templates/degen.png',
    layout: [
      { widget_id: 'you-dex-new-pairs',     x: 0, y: 0,   w: 8, h: 5 },
      { widget_id: 'you-narrative-tracker', x: 8, y: 0,   w: 4, h: 5 },
      { widget_id: 'you-screener',          x: 0, y: 5,   w: 6, h: 5 },
      { widget_id: 'you-crypto-twitter',    x: 6, y: 5,   w: 3, h: 5 },
      { widget_id: 'you-fear-greed',        x: 9, y: 5,   w: 3, h: 4 },
      { widget_id: 'you-discovery',         x: 0, y: 10,  w: 8, h: 4 },
      { widget_id: 'you-mindshare-radar',   x: 8, y: 10,  w: 4, h: 4 },
    ],
  },
  {
    id: 'rwa-investor',
    name: 'RWA Investor',
    tagline: 'Tokenized everything.',
    description: 'Tokenized assets, real-world yields, regulatory news, RWA narratives. For capital tracking the institutional crossover.',
    archetype: 'rwa',
    tier_min: 1000,
    preview_image: '/templates/rwa-investor.png',
    layout: [
      { widget_id: 'you-rwa-overview',        x: 0, y: 0,   w: 8, h: 6 },
      { widget_id: 'you-etf-flows',           x: 8, y: 0,   w: 4, h: 5 },
      { widget_id: 'you-rwa-stablecoins',     x: 0, y: 6,   w: 6, h: 5 },
      { widget_id: 'you-rwa-chains',          x: 6, y: 6,   w: 6, h: 5 },
      { widget_id: 'you-news-feed',           x: 0, y: 11,  w: 8, h: 5 },
      { widget_id: 'you-us-market',           x: 8, y: 11,  w: 4, h: 4 },
      { widget_id: 'you-economic-calendar',   x: 0, y: 16,  w: 4, h: 4 },
      { widget_id: 'you-macro-signals',       x: 4, y: 16,  w: 4, h: 4 },
      { widget_id: 'you-stock-movers',        x: 8, y: 15,  w: 4, h: 5 },
    ],
  },
  {
    id: 'narrative-trader',
    name: 'Narrative Trader',
    tagline: 'Trade the story.',
    description: 'Narrative lifecycle, social momentum, related token clusters. For traders who rotate between themes before the market does.',
    archetype: 'narrative',
    tier_min: 500,
    preview_image: '/templates/narrative-trader.png',
    layout: [
      { widget_id: 'you-narrative-tracker', x: 0, y: 0,   w: 8, h: 5 },
      { widget_id: 'you-mindshare-radar',   x: 8, y: 0,   w: 4, h: 5 },
      { widget_id: 'you-sector-rotation',   x: 0, y: 5,   w: 6, h: 5 },
      { widget_id: 'you-crypto-twitter',    x: 6, y: 5,   w: 6, h: 5 },
      { widget_id: 'you-discovery',         x: 0, y: 10,  w: 8, h: 4 },
      { widget_id: 'you-fear-greed',        x: 8, y: 10,  w: 4, h: 4 },
      { widget_id: 'you-news-feed',         x: 0, y: 14,  w: 8, h: 5 },
      { widget_id: 'you-top-gainers',       x: 8, y: 14,  w: 4, h: 5 },
    ],
  },
  {
    id: 'token-watcher',
    name: 'Token Watcher',
    tagline: 'Dexscreener, the Spectre way.',
    description: 'Watchlist + chart + trending pairs + X social pulse. The day-to-day surface for hunting and tracking individual tokens.',
    archetype: 'watcher',
    tier_min: 500,
    preview_image: '/templates/token-watcher.png',
    layout: [
      { widget_id: 'you-watchlist',         x: 0, y: 0,   w: 4, h: 8 },
      { widget_id: 'you-chart',             x: 4, y: 0,   w: 8, h: 5 },
      { widget_id: 'you-orderbook',         x: 4, y: 5,   w: 4, h: 4 },
      { widget_id: 'you-token-search',      x: 8, y: 5,   w: 4, h: 4 },
      { widget_id: 'you-dex-new-pairs',     x: 0, y: 8,   w: 4, h: 6 },
      { widget_id: 'you-discovery',         x: 4, y: 9,   w: 4, h: 5 },
      { widget_id: 'you-x-trending',        x: 8, y: 9,   w: 4, h: 5 },
      { widget_id: 'you-crypto-twitter',    x: 0, y: 14,  w: 6, h: 5 },
      { widget_id: 'you-screener',          x: 6, y: 14,  w: 6, h: 5 },
    ],
  },
]

export default TEMPLATES
