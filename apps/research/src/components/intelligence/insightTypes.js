/**
 * Metric type definitions for the Intelligence "i" Button system.
 * Each metric has a human-readable label, category grouping, and cache TTL.
 *
 * Categories:
 *   market    - price, volume, market cap (fast-moving, 5min cache)
 *   onchain   - whale, flow, address activity (moderate, 15min cache)
 *   defi      - TVL, rates, liquidations (moderate, 15min cache)
 *   builder   - dev activity, audits (slow-moving, 1hr cache)
 *   social    - sentiment, narratives (moderate, 10min cache)
 *   portfolio - PnL signals (fast-moving, 5min cache)
 *   macro     - dominance, stablecoins, derivatives (moderate, 15min cache)
 */

export const METRIC_TYPES = {
  // -- Market --
  'token-price':       { label: 'Price action',        category: 'market',    cacheTTL: 300000 },
  'price-change-pct':  { label: 'Price movement',      category: 'market',    cacheTTL: 300000 },
  'market-cap':        { label: 'Market cap',           category: 'market',    cacheTTL: 300000 },
  'volume-24h':        { label: 'Trading volume',       category: 'market',    cacheTTL: 300000 },
  'volume-change':     { label: 'Volume shift',         category: 'market',    cacheTTL: 300000 },
  'ath-distance':      { label: 'ATH distance',         category: 'market',    cacheTTL: 300000 },
  'atl-distance':      { label: 'ATL distance',         category: 'market',    cacheTTL: 300000 },

  // -- On-chain --
  'capital-flow':         { label: 'Capital flow signal',   category: 'onchain',  cacheTTL: 900000 },
  'whale-accumulation':   { label: 'Whale activity',        category: 'onchain',  cacheTTL: 900000 },
  'whale-distribution':   { label: 'Whale distribution',    category: 'onchain',  cacheTTL: 900000 },
  'exchange-netflow':     { label: 'Exchange flow',         category: 'onchain',  cacheTTL: 900000 },
  'active-addresses':     { label: 'Network activity',      category: 'onchain',  cacheTTL: 900000 },
  'holder-count':         { label: 'Holder base',           category: 'onchain',  cacheTTL: 900000 },
  'holder-change':        { label: 'Holder momentum',       category: 'onchain',  cacheTTL: 900000 },
  'transaction-count':    { label: 'Transaction velocity',  category: 'onchain',  cacheTTL: 900000 },

  // -- DeFi --
  'tvl':                { label: 'Total value locked',  category: 'defi',     cacheTTL: 900000 },
  'tvl-change':         { label: 'TVL movement',        category: 'defi',     cacheTTL: 900000 },
  'protocol-revenue':   { label: 'Protocol revenue',    category: 'defi',     cacheTTL: 900000 },
  'supply-rate':        { label: 'Supply rate',          category: 'defi',     cacheTTL: 900000 },
  'borrow-rate':        { label: 'Borrow rate',          category: 'defi',     cacheTTL: 900000 },
  'utilization-rate':   { label: 'Utilization',          category: 'defi',     cacheTTL: 900000 },
  'liquidation-volume': { label: 'Liquidations',         category: 'defi',     cacheTTL: 900000 },

  // -- Builder --
  'builder-score':      { label: 'Builder score',         category: 'builder',  cacheTTL: 3600000 },
  'commit-velocity':    { label: 'Development velocity',  category: 'builder',  cacheTTL: 3600000 },
  'contributor-count':  { label: 'Team activity',         category: 'builder',  cacheTTL: 3600000 },
  'deployment-count':   { label: 'Ship frequency',        category: 'builder',  cacheTTL: 3600000 },
  'audit-status':       { label: 'Security posture',      category: 'builder',  cacheTTL: 3600000 },
  'github-stars':       { label: 'Developer interest',    category: 'builder',  cacheTTL: 3600000 },

  // -- Social --
  'social-volume':        { label: 'Social attention',     category: 'social',   cacheTTL: 600000 },
  'social-sentiment':     { label: 'Sentiment signal',     category: 'social',   cacheTTL: 600000 },
  'narrative-momentum':   { label: 'Narrative momentum',   category: 'social',   cacheTTL: 600000 },
  'fear-greed':           { label: 'Market sentiment',     category: 'social',   cacheTTL: 600000 },
  'analyst-accuracy':     { label: 'Analyst reputation',   category: 'social',   cacheTTL: 600000 },
  'analyst-position':     { label: 'Verified position',    category: 'social',   cacheTTL: 600000 },

  // -- Portfolio --
  'portfolio-pnl':  { label: 'Portfolio signal',  category: 'portfolio',  cacheTTL: 300000 },
  'position-pnl':   { label: 'Position signal',   category: 'portfolio',  cacheTTL: 300000 },

  // -- Macro --
  'sector-attention':   { label: 'Sector signal',       category: 'macro',  cacheTTL: 900000 },
  'btc-dominance':      { label: 'Dominance signal',    category: 'macro',  cacheTTL: 900000 },
  'alt-season':         { label: 'Alt season signal',   category: 'macro',  cacheTTL: 900000 },
  'stablecoin-supply':  { label: 'Stablecoin signal',   category: 'macro',  cacheTTL: 900000 },
  'funding-rate':       { label: 'Funding signal',      category: 'macro',  cacheTTL: 900000 },
  'open-interest':      { label: 'Derivatives signal',  category: 'macro',  cacheTTL: 900000 },
};

const DEFAULT_INFO = { label: 'Intelligence', category: 'market', cacheTTL: 300000 };

export function getMetricInfo(type) {
  return METRIC_TYPES[type] || DEFAULT_INFO;
}
