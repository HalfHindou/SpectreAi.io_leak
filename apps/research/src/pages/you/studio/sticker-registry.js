/**
 * Spectre Studio -- Sticker registry
 *
 * Every "sticker" is a draggable live-data widget on the Studio canvas.
 * This file is data-only: no React, no rendering.
 *
 * 8 categories, 37 stickers total.
 */

/* ------------------------------------------------------------------ */
/*  Categories                                                         */
/* ------------------------------------------------------------------ */

export const STICKER_CATEGORIES = [
  { id: 'core',        name: 'CORE',        icon: 'T' },
  { id: 'market',      name: 'MARKET',      icon: null },
  { id: 'derivatives', name: 'DERIVATIVES', icon: null },
  { id: 'macro',       name: 'MACRO',       icon: null },
  { id: 'sentiment',   name: 'SENTIMENT',   icon: null },
  { id: 'editorial',   name: 'EDITORIAL',   icon: null },
  { id: 'media',       name: 'MEDIA',       icon: null },
  { id: 'art',         name: 'ART',         icon: null, artOnly: true },
];

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

export const STICKER_REGISTRY = [

  /* -- CORE (7) ----------------------------------------------------- */

  {
    id: 'big-price',
    name: 'Big Price',
    category: 'core',
    description: 'Large live price display with sparkline and 24h change',
    defaultSize: { w: 240, h: 100 },
    defaultToken: 'BTC',
    maintainAspect: false,
  },
  {
    id: 'line-chart',
    name: 'Line Chart',
    category: 'core',
    description: 'SVG area chart showing 24h price with gradient fill',
    defaultSize: { w: 320, h: 140 },
    defaultToken: 'BTC',
    maintainAspect: false,
  },
  {
    id: 'candle-ghost',
    name: 'Candle Ghost',
    category: 'core',
    description: 'Floating candlestick chart with transparent background',
    defaultSize: { w: 300, h: 160 },
    defaultToken: 'BTC',
    maintainAspect: false,
  },
  {
    id: 'ticker-tape',
    name: 'Ticker Tape',
    category: 'core',
    description: 'Horizontally scrolling strip showing live prices for 8+ tokens',
    defaultSize: { w: 600, h: 36 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'narrative-tag',
    name: 'Narrative Tag',
    category: 'core',
    description: 'Pill badge showing a current market narrative',
    defaultSize: { w: 160, h: 32 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'dominance-strip',
    name: 'Dominance Strip',
    category: 'core',
    description: 'Horizontal stacked bar chart of market dominance',
    defaultSize: { w: 280, h: 40 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'fear-greed-gauge',
    name: 'Fear & Greed Gauge',
    category: 'core',
    description: 'Semi-circular arc gauge with animated needle',
    defaultSize: { w: 180, h: 120 },
    defaultToken: null,
    maintainAspect: true,
  },

  /* -- MARKET (4) --------------------------------------------------- */

  {
    id: 'top-coins-ladder',
    name: 'Top Coins Ladder',
    category: 'market',
    description: 'Vertical leaderboard of top-performing tokens',
    defaultSize: { w: 240, h: 280 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'sector-heatmap',
    name: 'Sector Heatmap',
    category: 'market',
    description: 'Treemap grid colored by sector performance',
    defaultSize: { w: 320, h: 200 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'rotation-compass',
    name: 'Rotation Compass',
    category: 'market',
    description: 'Radar chart showing capital flow direction across sectors',
    defaultSize: { w: 200, h: 200 },
    defaultToken: null,
    maintainAspect: true,
  },
  {
    id: 'breadth-meter',
    name: 'Breadth Meter',
    category: 'market',
    description: 'Gauge showing percentage of green vs red coins',
    defaultSize: { w: 260, h: 60 },
    defaultToken: null,
    maintainAspect: false,
  },

  /* -- DERIVATIVES (4) ---------------------------------------------- */

  {
    id: 'liquidation-bars',
    name: 'Liquidation Bars',
    category: 'derivatives',
    description: 'Bi-directional bar chart of long/short liquidation clusters',
    defaultSize: { w: 300, h: 180 },
    defaultToken: 'BTC',
    maintainAspect: false,
  },
  {
    id: 'oi-pulse',
    name: 'OI Pulse',
    category: 'derivatives',
    description: 'Open interest value with sonar pulse animation',
    defaultSize: { w: 200, h: 80 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'funding-strip',
    name: 'Funding Strip',
    category: 'derivatives',
    description: 'Horizontal bar showing current funding rate',
    defaultSize: { w: 260, h: 50 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'ghost-heatmap',
    name: 'Ghost Heatmap',
    category: 'derivatives',
    description: 'Mini liquidation density heatmap with price axis',
    defaultSize: { w: 200, h: 240 },
    defaultToken: 'BTC',
    maintainAspect: false,
  },

  /* -- MACRO (4) ---------------------------------------------------- */

  {
    id: 'macro-strip',
    name: 'Macro Strip',
    category: 'macro',
    description: 'Horizontal row of macro indicators with sparklines',
    defaultSize: { w: 600, h: 70 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'correlation-breakdown',
    name: 'Correlation Breakdown',
    category: 'macro',
    description: 'BTC correlation bars to SPX, Gold, and DXY',
    defaultSize: { w: 240, h: 120 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'regime-badge',
    name: 'Regime Badge',
    category: 'macro',
    description: 'Large status badge for the current market regime',
    defaultSize: { w: 240, h: 70 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'signal-stack',
    name: 'Signal Stack',
    category: 'macro',
    description: 'Vertical stack of AI signal badges with conviction dots',
    defaultSize: { w: 220, h: 160 },
    defaultToken: null,
    maintainAspect: false,
  },

  /* -- SENTIMENT (3) ------------------------------------------------ */

  {
    id: 'ct-mood',
    name: 'CT Mood',
    category: 'sentiment',
    description: 'Crypto Twitter sentiment bar with pointer',
    defaultSize: { w: 220, h: 70 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'whale-activity',
    name: 'Whale Activity',
    category: 'sentiment',
    description: 'Recent large wallet movements with dollar amounts',
    defaultSize: { w: 280, h: 120 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'smart-money-flow',
    name: 'Smart Money Flow',
    category: 'sentiment',
    description: 'Capital flow direction arrow with intensity bar',
    defaultSize: { w: 200, h: 100 },
    defaultToken: null,
    maintainAspect: false,
  },

  /* -- EDITORIAL (4) ------------------------------------------------ */

  {
    id: 'quote-block',
    name: 'Quote Block',
    category: 'editorial',
    description: 'Pull quote with editorial typography and decorative mark',
    defaultSize: { w: 320, h: 120 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'big-label',
    name: 'Big Label',
    category: 'editorial',
    description: 'Huge faded background text used as a canvas texture element',
    defaultSize: { w: 600, h: 180 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'headline',
    name: 'Headline',
    category: 'editorial',
    description: 'Newspaper-style headline with date stamp',
    defaultSize: { w: 360, h: 80 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'stat-block',
    name: 'Stat Block',
    category: 'editorial',
    description: 'Generic stat display with label, value, and subtitle',
    defaultSize: { w: 200, h: 80 },
    defaultToken: null,
    maintainAspect: false,
  },

  /* -- MEDIA (3) ---------------------------------------------------- */

  {
    id: 'market-clock',
    name: 'Market Clock',
    category: 'media',
    description: 'Four-timezone clock with live ticking and market status',
    defaultSize: { w: 320, h: 70 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'countdown',
    name: 'Countdown',
    category: 'media',
    description: 'Event countdown timer with impact level indicator',
    defaultSize: { w: 260, h: 70 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'audio-visualizer',
    name: 'Audio Visualizer',
    category: 'media',
    description: 'Ambient animated bars for canvas atmosphere',
    defaultSize: { w: 300, h: 80 },
    defaultToken: null,
    maintainAspect: false,
  },

  /* -- ART (8) -- only visible when Street Art theme is active ------- */

  {
    id: 'painted-btc',
    name: 'Painted BTC',
    category: 'art',
    description: 'Large Bitcoin symbol rendered as painted SVG art',
    defaultSize: { w: 160, h: 160 },
    defaultToken: null,
    maintainAspect: true,
  },
  {
    id: 'warhol-grid',
    name: 'Warhol Grid',
    category: 'art',
    description: 'Pop art 2x2 grid of Bitcoin symbols in contrasting colors',
    defaultSize: { w: 200, h: 200 },
    defaultToken: null,
    maintainAspect: true,
  },
  {
    id: 'drip-price',
    name: 'Drip Price',
    category: 'art',
    description: 'Price number with paint dripping off the bottom of each digit',
    defaultSize: { w: 320, h: 140 },
    defaultToken: 'BTC',
    maintainAspect: false,
  },
  {
    id: 'stencil-word',
    name: 'Stencil Word',
    category: 'art',
    description: 'Spray-stenciled word with imperfect edges',
    defaultSize: { w: 200, h: 70 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'graffiti-crown',
    name: 'Graffiti Crown',
    category: 'art',
    description: 'Basquiat-style three-point crown above a token name',
    defaultSize: { w: 100, h: 80 },
    defaultToken: 'BTC',
    maintainAspect: true,
  },
  {
    id: 'throw-up',
    name: 'Throw-Up',
    category: 'art',
    description: 'Bubble graffiti letters with thick stroke and fill',
    defaultSize: { w: 300, h: 100 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'ransom-note',
    name: 'Ransom Note',
    category: 'art',
    description: 'Each letter in a different font, size, color, and rotation',
    defaultSize: { w: 400, h: 80 },
    defaultToken: null,
    maintainAspect: false,
  },
  {
    id: 'echo-text',
    name: 'Echo Text',
    category: 'art',
    description: 'Same word stacked three times with offset for screen-print effect',
    defaultSize: { w: 320, h: 120 },
    defaultToken: null,
    maintainAspect: false,
  },
];
