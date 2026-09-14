/**
 * Spectre Studio -- Canvas presets
 *
 * Each preset defines a theme and a set of pre-arranged stickers.
 * Positions are normalised 0-1 (fraction of canvas width/height).
 * When a preset is loaded the canvas is cleared and stickers are
 * placed with staggered entrance animation (60 ms delay between each).
 */

export const STUDIO_PRESETS = [

  /* ---------------------------------------------------------------- */
  /*  1. Trading Desk                                                  */
  /* ---------------------------------------------------------------- */
  {
    id: 'trading-desk',
    name: 'Trading Desk',
    description: 'Full Bloomberg-style layout with prices, charts, derivatives, and a scrolling ticker',
    theme: 'void',
    stickers: [
      { type: 'big-price',       token: 'BTC', x: 0.03,  y: 0.05 },
      { type: 'big-price',       token: 'ETH', x: 0.03,  y: 0.22 },
      { type: 'big-price',       token: 'SOL', x: 0.03,  y: 0.39 },
      { type: 'line-chart',      token: 'BTC', x: 0.28,  y: 0.03 },
      { type: 'candle-ghost',    token: 'BTC', x: 0.28,  y: 0.42 },
      { type: 'fear-greed-gauge',              x: 0.65,  y: 0.03 },
      { type: 'liquidation-bars',              x: 0.60,  y: 0.35 },
      { type: 'oi-pulse',                      x: 0.85,  y: 0.05 },
      { type: 'funding-strip',                 x: 0.85,  y: 0.25 },
      { type: 'ticker-tape',                   x: 0.03,  y: 0.88 },
      { type: 'narrative-tag',                 x: 0.55,  y: 0.75, text: 'Risk Off' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  2. Morning Brief                                                 */
  /* ---------------------------------------------------------------- */
  {
    id: 'morning-brief',
    name: 'Morning Brief',
    description: 'Clean editorial layout for a daily market overview',
    theme: 'zen-minimal',
    stickers: [
      { type: 'big-price',       token: 'BTC', x: 0.05,  y: 0.08, scale: 1.5 },
      { type: 'fear-greed-gauge',              x: 0.55,  y: 0.05 },
      { type: 'regime-badge',                  x: 0.05,  y: 0.40 },
      { type: 'narrative-tag',                 x: 0.05,  y: 0.55, text: 'Accumulation Zone' },
      { type: 'dominance-strip',               x: 0.05,  y: 0.68 },
      { type: 'macro-strip',                   x: 0.03,  y: 0.82 },
      { type: 'quote-block',                   x: 0.55,  y: 0.55 },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  3. Derivatives Focus                                             */
  /* ---------------------------------------------------------------- */
  {
    id: 'derivatives-focus',
    name: 'Derivatives Focus',
    description: 'Heavy on liquidation, open interest, and funding data',
    theme: 'void',
    stickers: [
      { type: 'big-price',        token: 'BTC', x: 0.03, y: 0.05 },
      { type: 'liquidation-bars',               x: 0.03, y: 0.25 },
      { type: 'ghost-heatmap',    token: 'BTC', x: 0.35, y: 0.05 },
      { type: 'oi-pulse',                       x: 0.60, y: 0.05 },
      { type: 'funding-strip',                  x: 0.60, y: 0.22 },
      { type: 'candle-ghost',     token: 'BTC', x: 0.60, y: 0.40 },
      { type: 'fear-greed-gauge',               x: 0.85, y: 0.05 },
      { type: 'ticker-tape',                    x: 0.03, y: 0.88 },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  4. Macro View                                                    */
  /* ---------------------------------------------------------------- */
  {
    id: 'macro-view',
    name: 'Macro View',
    description: 'Traditional macro indicators, correlations, and regime context',
    theme: 'zen-minimal',
    stickers: [
      { type: 'macro-strip',                     x: 0.03, y: 0.05 },
      { type: 'correlation-breakdown',            x: 0.05, y: 0.22 },
      { type: 'regime-badge',                     x: 0.05, y: 0.50 },
      { type: 'dominance-strip',                  x: 0.05, y: 0.68 },
      { type: 'big-price',        token: 'BTC',   x: 0.55, y: 0.22 },
      { type: 'signal-stack',                     x: 0.55, y: 0.50 },
      { type: 'narrative-tag',                    x: 0.55, y: 0.80, text: 'Risk Off' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  5. Zen                                                           */
  /* ---------------------------------------------------------------- */
  {
    id: 'zen',
    name: 'Zen',
    description: 'Minimal canvas with just three essential elements',
    theme: 'zen-minimal',
    stickers: [
      { type: 'big-price',       token: 'BTC', x: 0.30, y: 0.25, scale: 2.0 },
      { type: 'fear-greed-gauge',              x: 0.35, y: 0.60 },
      { type: 'quote-block',                   x: 0.25, y: 0.82 },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  6. Gallery                                                       */
  /* ---------------------------------------------------------------- */
  {
    id: 'gallery',
    name: 'Gallery',
    description: 'Street-art themed canvas showcasing art stickers',
    theme: 'street-art',
    stickers: [
      { type: 'painted-btc',                    x: 0.05, y: 0.05 },
      { type: 'warhol-grid',                    x: 0.40, y: 0.03 },
      { type: 'drip-price',     token: 'BTC',   x: 0.05, y: 0.50 },
      { type: 'stencil-word',                   x: 0.70, y: 0.10, text: 'HODL' },
      { type: 'graffiti-crown', token: 'BTC',   x: 0.72, y: 0.40 },
      { type: 'throw-up',                       x: 0.05, y: 0.80, text: 'MOON' },
      { type: 'ransom-note',                    x: 0.40, y: 0.70, text: 'BITCOIN' },
      { type: 'echo-text',                      x: 0.40, y: 0.45, text: 'BULL' },
    ],
  },
];
