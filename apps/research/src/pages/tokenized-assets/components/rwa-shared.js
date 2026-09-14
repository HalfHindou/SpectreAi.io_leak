/* ═══════════════════════════════════════════════
   RWA Shared Utilities
   Single source of truth for classification,
   formatting, and color palettes.
   ═══════════════════════════════════════════════ */

/* ── Classification Keywords ── */

export const TREASURY_KEYWORDS = [
  'treasury', 'buidl', 'blackrock', 'usyc', 'benji', 'franklin',
  'ustb', 'superstate', 'wisdomtree', 'openeden', 'matrixdock',
  'ondo', 'spiko', 'anemoy', 't-bill',
]

export const CREDIT_KEYWORDS = [
  'centrifuge', 'maple', 'goldfinch', 'truefi', 'clearpool', 'credix', 'credit',
]

export const COMMODITY_KEYWORDS = [
  'gold', 'paxg', 'xaut', 'silver', 'platinum', 'commodity',
]

export const GOLD_EXCLUDE = ['gold', 'paxg', 'xaut', 'tether gold', 'silver', 'platinum']

const ASSET_CLASS_LABELS = {
  treasuries: 'Treasuries',
  credit: 'Credit',
  commodities: 'Commodities',
  stocks: 'Stocks/Equity',
  equity: 'Stocks/Equity',
  other: 'Other RWA',
}

export function classifyProtocol(nameOrProto) {
  if (nameOrProto && typeof nameOrProto === 'object') {
    const ac = nameOrProto.asset_class
    if (ac && ASSET_CLASS_LABELS[ac]) return ASSET_CLASS_LABELS[ac]
    return classifyProtocol(nameOrProto.name || '')
  }
  const lower = String(nameOrProto || '').toLowerCase()
  if (COMMODITY_KEYWORDS.some((k) => lower.includes(k))) return 'Commodities'
  if (TREASURY_KEYWORDS.some((k) => lower.includes(k))) return 'Treasuries'
  if (CREDIT_KEYWORDS.some((k) => lower.includes(k))) return 'Credit'
  return 'Other RWA'
}

export function isTreasuryProtocol(p) {
  if (p.asset_class) return p.asset_class === 'treasuries'
  const name = (p.name || '').toLowerCase()
  if (GOLD_EXCLUDE.some((g) => name.includes(g))) return false
  return TREASURY_KEYWORDS.some((kw) => name.includes(kw))
}

export function isCreditProtocol(p) {
  if (p.asset_class) return p.asset_class === 'credit'
  const name = (p.name || '').toLowerCase()
  const cat = (p.category || '').toLowerCase()
  return (
    CREDIT_KEYWORDS.some((kw) => name.includes(kw)) ||
    cat.includes('lending') ||
    (cat.includes('rwa') && name.includes('credit'))
  )
}

export function isCommodityProtocol(p) {
  if (p.asset_class) return p.asset_class === 'commodities'
  const name = (p.name || '').toLowerCase()
  return COMMODITY_KEYWORDS.some((kw) => name.includes(kw))
}

/* ── Formatters ──
   These helpers retain a USD-prefixed fallback used by canvas axes / SVG labels
   where a hook-bound formatter cannot reach. UI surfaces should prefer the
   `useCurrency()` bound `fmtLargeShort` / `fmtPrice` formatters so EUR/JPY/RUB
   users see the right symbol and magnitude.
*/

export function formatValue(val) {
  if (val == null || val === 0) return '--'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`
  return `$${Math.round(val).toLocaleString()}`
}

export function formatChange(val) {
  if (val == null) return null
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

export function formatCount(val) {
  if (val == null) return '--'
  return val.toLocaleString()
}

/* ── Color Palettes ── */

export const CATEGORY_COLORS = {
  Treasuries: '#3B82F6',
  'Private Credit': '#10B981',
  Credit: '#10B981',
  Commodities: '#F59E0B',
  'Real Estate': '#EC4899',
  'Stocks/Equity': '#A78BFA',
  Stablecoins: '#06B6D4',
  'Other RWA': '#94A3B8',
}

export const CHAIN_PALETTE = {
  Ethereum: '#627EEA',
  Solana: '#14F195',
  Arbitrum: '#28A0F0',
  Base: '#0052FF',
  Polygon: '#8247E5',
  Avalanche: '#E84142',
  BSC: '#F0B90B',
  Binance: '#F0B90B',
  Optimism: '#FF0420',
  Tron: '#FF0013',
  Aptos: '#06F7F7',
  Sui: '#4DA2FF',
  Noble: '#5856D6',
  Stellar: '#7D00FF',
  Fantom: '#1969FF',
  Mantle: '#64748B',
}

export const FALLBACK_COLORS = ['#94A3B8', '#64748B', '#475569', '#334155']

/* ── Canvas Font (CSS vars don't work in canvas) ── */
export const CANVAS_FONT_NUM = "'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace"
export const CANVAS_FONT_LABEL = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"

/* ── Color Helpers ── */

export function hexToRgba(hex, a) {
  if (!hex?.startsWith('#')) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

/* ── Weighted average change ── */

export function weightedChange(items, changeKey = 'change_7d') {
  if (!items?.length) return null
  let totalWeight = 0
  let weightedSum = 0
  items.forEach((p) => {
    const tvl = p.tvl || 0
    const change = p[changeKey] ?? null
    if (tvl > 0 && change != null) {
      totalWeight += tvl
      weightedSum += change * tvl
    }
  })
  return totalWeight > 0 ? weightedSum / totalWeight : null
}
