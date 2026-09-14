/**
 * marketFormat — shared market-feed constants + pure formatters/sorters.
 *
 * Single source of truth for the category / chain / timeframe model and the
 * change-normalization + sort logic that BOTH the Discover page
 * (components/TokenDiscoveryTable.jsx) and the token-page left rail
 * (components/TokenScreener.jsx, via hooks/useMarketFeed.js) consume — so the
 * two surfaces show the SAME tokens for the same selection instead of drifting.
 *
 * Lifted verbatim from TokenDiscoveryTable.jsx (constants + helpers) so the
 * extraction is behavior-preserving. Same precedent as utils/trendingFilter.js,
 * which exists to keep the ticker bar + command palette in lockstep.
 */

/* ── Category / timeframe / chain model ── */
export const CATEGORIES = [
  { id: 'trending', label: 'Trending' },
  { id: 'top', label: 'Top Coins' },
  { id: 'gainers', label: 'Top Gainers' },
  { id: 'volume', label: 'Volume Leaders' },
  { id: 'new', label: 'New Listings' },
  { id: 'visited', label: 'Most Visited' },
]

export const TIMEFRAMES = [
  { id: '5m', label: '5m' },
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '24h', label: '24h' },
]

// ORDER MATTERS - this array IS the chain-pill order on every surface that
// renders it (TokenDiscoveryTable, TokenScreener's CHAIN_PILLS, MobileScreener).
// 'all' must stay at index 0: several callers use NETWORKS[0] as the fallback
// when the active chain id doesn't resolve.
export const NETWORKS = [
  { id: 'all', label: 'All Chains', color: null },
  { id: 'solana', label: 'Solana', color: '#9945FF', abbrev: 'SOL' },
  { id: 'ethereum', label: 'Ethereum', color: '#627EEA', abbrev: 'ETH' },
  // Robinhood Chain (Arbitrum Orbit L2, mainnet 2026-07-01). label MUST match
  // the server's getNetworkName(4663) = 'Robinhood Chain' so the client-side
  // chain filter (which matches token.network by string) doesn't over-filter.
  { id: 'robinhood', label: 'Robinhood Chain', color: '#00C805', abbrev: 'HOOD' },
  { id: 'bsc', label: 'BNB Chain', color: '#F0B90B', abbrev: 'BSC' },
  { id: 'base', label: 'Base', color: '#0052FF', abbrev: 'BASE' },
  { id: 'arbitrum', label: 'Arbitrum', color: '#28A0F0', abbrev: 'ARB' },
  { id: 'polygon', label: 'Polygon', color: '#8247E5', abbrev: 'MATIC' },
  { id: 'avalanche', label: 'Avalanche', color: '#E84142', abbrev: 'AVAX' },
  { id: 'optimism', label: 'Optimism', color: '#FF0420', abbrev: 'OP' },
]

export const NETWORK_LOOKUP = Object.fromEntries(
  NETWORKS.filter(n => n.id !== 'all').map(n => [n.id, n])
)

// Chain-filter id -> Codex networkId set. The trending feed is ranked by
// volume across ALL fetched chains at once, and Solana memecoin volume
// routinely fills the entire top-50 - so client-filtering that single list
// by chain left ETH / Base / Arbitrum / etc. empty ("No tokens match").
// Instead we fetch trending FOR the selected chain so every chip returns
// real data. 'all' uses the same 3 chains the header trending bar polls so
// the default view stays in lockstep with the bar.
export const ALL_TREND_CHAINS = [1, 56, 1399811149]
export const CHAIN_NET_IDS = {
  all: ALL_TREND_CHAINS,
  ethereum: [1],
  solana: [1399811149],
  base: [8453],
  arbitrum: [42161],
  bsc: [56],
  polygon: [137],
  avalanche: [43114],
  optimism: [10],
  robinhood: [4663],
}

// Exactly 30 rows per chain/tab in the discovery table.
export const TREND_DISPLAY_LIMIT = 30

/* ── Top Coins sector categories ── */
export const COIN_SECTORS = [
  { id: 'all', label: 'All', color: null },
  { id: 'ai', label: 'AI', color: '#818cf8' },
  { id: 'rwa', label: 'RWA', color: '#f59e0b' },
  { id: 'meme', label: 'Meme', color: '#34d399' },
  { id: 'defi', label: 'DeFi', color: '#60a5fa' },
  { id: 'infra', label: 'Infrastructure', color: '#a78bfa' },
  { id: 'gamefi', label: 'GameFi', color: '#f472b6' },
  { id: 'sol-meme', label: 'Solana Meme', color: '#9945FF' },
]

// Reverse map: label/abbrev -> network object
export const NETWORK_BY_NAME = {}
NETWORKS.forEach(n => {
  if (n.id !== 'all') {
    NETWORK_BY_NAME[n.label.toLowerCase()] = n
    if (n.abbrev) NETWORK_BY_NAME[n.abbrev.toLowerCase()] = n
    NETWORK_BY_NAME[n.id] = n
  }
})

export function resolveNetwork(raw) {
  if (!raw) return null
  const key = String(raw).toLowerCase()
  return NETWORK_BY_NAME[key] || null
}

/** Format token age from unix timestamp to compact string */
export function formatAge(createdAt) {
  if (!createdAt) return '-'
  const now = Date.now() / 1000
  const diff = now - createdAt
  if (diff < 0) return '-'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo`
  const years = diff / (86400 * 365)
  return years >= 10 ? `${Math.floor(years)}y` : `${years.toFixed(1)}y`
}

/** Market-cap tier by RANK within the current list (percentile terciles), not
 *  by the average - so the colours spread evenly (~1/3 each) and differentiate
 *  the whole list, instead of flagging only the few outliers way above the mean.
 *  bands = { p33, p66 } mcap thresholds. low = blue, mid = pink, high = yellow. */
export function mcapTier(mcap, bands) {
  const m = Number(mcap) || 0
  if (!bands || m <= 0) return 'low'
  if (m >= bands.p66) return 'high'   // top third    -> yellow
  if (m >= bands.p33) return 'mid'    // middle third -> pink
  return 'low'                         // bottom third -> blue
}

/** Cap extreme percentages for column width.
 *  Codex / CoinGecko feed change as a RATIO for sub-100% moves (0.05 = 5%,
 *  -0.0129 = -1.29%) and as a plain percentage for >100% moves (14.62 =
 *  14.62%). Apply the same heuristic the sort path (getChangeForTimeframe /
 *  normalizeForSort) and the rest of the app (XFullView, useSwapExecution)
 *  already use, so the displayed % and the column sort agree. */
export function fmtChange(change) {
  if (change == null || !isFinite(change)) return { text: '-', cls: 'neutral' }
  let pct = change
  if (Math.abs(pct) <= 1 && pct !== 0) pct = pct * 100
  const abs = Math.abs(pct)
  // Round-to-zero guard: a tiny residual must not render a signed "-0.00%".
  if (abs < 0.005) return { text: '0.00%', cls: 'neutral' }
  const cls = pct >= 0 ? 'bull' : 'bear'
  const sign = pct >= 0 ? '+' : '-'
  let text
  if (abs >= 1e6) text = `${sign}>999K%`
  else if (abs >= 1e4) text = `${sign}${(abs / 1e3).toFixed(0)}K%`
  else if (abs >= 1e3) text = `${sign}${(abs / 1e3).toFixed(1)}K%`
  else if (abs >= 100) text = `${sign}${abs.toFixed(0)}%`
  else text = `${sign}${abs.toFixed(2)}%`
  return { text, cls }
}

/** Normalize ONE change value from the Codex TOKEN-DETAIL endpoint (change1/
 *  change4/change12/change24 on /api/codex?action=details) to a display percent.
 *
 *  The detail endpoint is MIXED-UNIT - the SAME change24 field arrives as a
 *  PERCENT (3.5661 == +3.57%) at some times and as a RATIO (0.031453 == +3.15%,
 *  matching Codex's own bars) at others. Reading it straight through renders the
 *  ratio form as a bogus +0.03%. So apply the shared heuristic: sub-1 magnitudes
 *  are ratios (*100), larger values are already percents (leave as-is - avoids
 *  the +356% banner bug where 3.5661 got *100'd).
 *
 *  This is a FALLBACK only: the token page's reliable source is Codex's own
 *  hourly bars (see useBarChangeWindows), which every window prefers. The
 *  heuristic can't distinguish a genuine sub-1% percent from a ratio, which is
 *  exactly why bars win. Returns null for a nullish/non-finite input so callers
 *  render "-" instead of a fake 0.00%; a real 0 stays 0. */
export function readCodexChangePct(v) {
  if (v == null) return null
  const n = Number(v)
  if (!isFinite(n)) return null
  if (Math.abs(n) <= 1 && n !== 0) return n * 100
  return n
}

/** Compact COUNT formatter (no currency prefix) for raw txn counts.
 *  e.g. 48800 -> "48.8K", 1240000 -> "1.24M". Returns "-" for nullish. */
export function fmtCount(n) {
  const v = Number(n)
  if (n == null || !isFinite(v)) return '-'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return `${Math.round(v)}`
}

/** Get change value for the selected timeframe, normalized to a consistent %.
 *  Codex returns mixed formats (0.05 = 5% vs 76.88 = 76.88%); normalize the
 *  sub-1 ratios up by 100 so callers compare/display apples to apples. */
export function getChangeForTimeframe(token, tf) {
  let v
  switch (tf) {
    case '5m': v = token.change5m ?? 0; break
    case '1h': v = token.change1h ?? 0; break
    case '6h': v = token.change6h ?? 0; break
    case '24h': v = token.change24h ?? token.change ?? 0; break
    default: v = token.change24h ?? token.change ?? 0; break
  }
  if (Math.abs(v) <= 1 && v !== 0) return v * 100
  return v
}

const CHANGE_KEYS = new Set(['change5m', 'change1h', 'change6h', 'change24h', 'change7d'])
/** Normalize a raw field value for column sorting (mirrors fmtChange's *100). */
export function normalizeForSort(val, key) {
  if (val == null || !isFinite(val)) return 0
  if (CHANGE_KEYS.has(key) && Math.abs(val) <= 1 && val !== 0) return val * 100
  return val
}

/**
 * Filter a token list to a single chain (no-op for 'all'). Matches the
 * client chain filter TokenDiscoveryTable applies on top of the per-chain
 * fetch (belt-and-suspenders for the 'all' multi-chain list).
 */
export function filterTokensByChain(tokens, chainId) {
  if (!chainId || chainId === 'all') return tokens
  const net = NETWORK_LOOKUP[chainId]
  if (!net) return tokens
  return tokens.filter(t => {
    const raw = (t.network || '').toLowerCase()
    return raw === net.label.toLowerCase() ||
           raw === (net.abbrev || '').toLowerCase() ||
           raw === net.id
  })
}

/**
 * Category ordering — the canonical sort the Discover board applies per tab.
 * Returns a NEW array (never mutates). Callers cap to their own display limit.
 * trending = server trendScore order (re-sorted by change only when not 24h);
 * gainers = change desc; volume = vol desc; new = newest; visited/top keep
 * their source order (server view-rank / mcap rank).
 */
export function sortTokensByCategory(tokens, category, timeframe) {
  const arr = [...tokens]
  switch (category) {
    case 'gainers':
      arr.sort((a, b) => getChangeForTimeframe(b, timeframe) - getChangeForTimeframe(a, timeframe))
      break
    case 'volume':
      arr.sort((a, b) => (b.volume24h || b.volume || 0) - (a.volume24h || a.volume || 0))
      break
    case 'new':
      arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      break
    case 'visited':
    case 'top':
      break // keep source order (server view-rank / mcap rank)
    case 'trending':
    default:
      if (timeframe !== '24h') {
        arr.sort((a, b) => getChangeForTimeframe(b, timeframe) - getChangeForTimeframe(a, timeframe))
      }
      break
  }
  return arr
}
