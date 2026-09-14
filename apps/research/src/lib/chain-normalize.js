/**
 * chain-normalize.js — one canonical chain identity for filtering + labelling.
 *
 * Why this exists: the X Dash sources disagree on the chain STRING. The
 * bootstrap board emits CoinGecko platform slugs (`binance-smart-chain`,
 * `arbitrum-one`, `optimistic-ethereum`, `polygon-pos`, `robinhood`), while the
 * Spectre-API fallback, the /majors board and the Codex/DexScreener enrichment
 * emit short names (`bsc`, `arbitrum`, `optimism`, `polygon`). A strict
 * `token.chain === filterKey` match therefore silently dropped whole chains and
 * had no way to reach the newer runner chains (Robinhood Chain, XRP...). This
 * module folds every alias to ONE canonical key so a filter matches regardless
 * of source, and gives each chain a stable display label.
 *
 * Robinhood Chain (Arbitrum-Orbit L2, CG/GeckoTerminal slug `robinhood`) and
 * XRP now carry real X Dash runner volume — they were missing from the filter.
 */

// [canonicalKey, label, aliases[]]. Array order = preferred dropdown order for
// the curated fallback / tie-breaks. Aliases cover CG platform slugs, short
// names, and common variants; the canonical key itself is always an alias too.
const CHAIN_REGISTRY = [
  ['ethereum', 'Ethereum', ['eth', 'ethereum', 'erc20', 'ethereum-mainnet']],
  ['solana', 'Solana', ['sol', 'solana', 'spl']],
  ['base', 'Base', ['base', 'base-mainnet']],
  ['bsc', 'BSC', ['bsc', 'bnb', 'binance', 'bnb-chain', 'bnb chain', 'binance-smart-chain', 'binance smart chain']],
  ['arbitrum', 'Arbitrum', ['arbitrum', 'arb', 'arbitrum-one', 'arbitrum one', 'arbitrum-nova']],
  ['robinhood', 'Robinhood', ['robinhood', 'robinhood-chain', 'robinhood chain', 'rhc']],
  ['xrp', 'XRP', ['xrp', 'xrp-ledger', 'xrpl', 'ripple']],
  ['optimism', 'Optimism', ['optimism', 'op', 'optimistic-ethereum', 'op-mainnet']],
  ['polygon', 'Polygon', ['polygon', 'matic', 'polygon-pos', 'polygon pos']],
  ['avalanche', 'Avalanche', ['avalanche', 'avax', 'avalanche-2', 'avalanche-c-chain']],
  ['tron', 'Tron', ['tron', 'trx', 'tron20']],
  ['ton', 'TON', ['ton', 'the-open-network', 'toncoin']],
  ['hyperliquid', 'Hyperliquid', ['hyperliquid', 'hyperevm', 'hype']],
  ['sui', 'Sui', ['sui']],
  ['aptos', 'Aptos', ['aptos', 'apt']],
  ['sei', 'Sei', ['sei', 'sei-network', 'sei-v2']],
  ['blast', 'Blast', ['blast']],
  ['sonic', 'Sonic', ['sonic']],
  ['berachain', 'Berachain', ['berachain', 'bera']],
  ['near', 'NEAR', ['near', 'near-protocol']],
  ['abstract', 'Abstract', ['abstract']],
  ['linea', 'Linea', ['linea']],
  ['scroll', 'Scroll', ['scroll']],
  ['zksync', 'zkSync', ['zksync', 'zksync-era']],
  ['cardano', 'Cardano', ['cardano', 'ada']],
]

const ALIAS_TO_KEY = new Map()
const KEY_TO_LABEL = new Map()
const KEY_ORDER = new Map()
CHAIN_REGISTRY.forEach(([key, label, aliases], i) => {
  KEY_TO_LABEL.set(key, label)
  KEY_ORDER.set(key, i)
  for (const a of aliases) ALIAS_TO_KEY.set(a, key)
})

/** Fold any chain string (slug / short name / variant) to ONE canonical key. */
// Upstream placeholders for "chain not resolved" — these must NOT become a
// filter option (X Dash emits `chain:undefined` + `platforms:{unkown:unkown}`
// for tokens whose chain it couldn't determine; note the misspelling).
const UNRESOLVED_CHAINS = new Set(['unknown', 'unkown', 'null', 'undefined', 'none', 'n/a', 'na', '-'])

export function canonicalChainKey(raw) {
  if (!raw || typeof raw !== 'string') return null
  const k = raw.trim().toLowerCase()
  if (!k || UNRESOLVED_CHAINS.has(k)) return null
  if (ALIAS_TO_KEY.has(k)) return ALIAS_TO_KEY.get(k)
  // Unknown chain: return a stable slug so it still groups/filters consistently.
  return k.replace(/[\s_]+/g, '-')
}

/** Human display label for a canonical key (falls back to title-case). */
export function chainLabel(key) {
  if (!key) return ''
  if (KEY_TO_LABEL.has(key)) return KEY_TO_LABEL.get(key)
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Does a token belong to `canonicalKey`? Matches the token's primary `chain`
 * first, and only consults the `platforms` map when the primary chain is
 * missing (a token listed across chains keeps its primary chain authoritative).
 */
export function tokenMatchesChain(token, canonicalKey) {
  if (!canonicalKey || canonicalKey === 'all') return true
  if (!token) return false
  const primary = canonicalChainKey(token.chain)
  if (primary) return primary === canonicalKey
  const platforms = token.platforms
  if (platforms && typeof platforms === 'object') {
    return Object.keys(platforms).some((p) => canonicalChainKey(p) === canonicalKey)
  }
  return false
}

/**
 * Build ordered `{ key, label, count }` chain options from a token list — the
 * chains actually present in the board, canonicalized + counted, most-common
 * first (registry order breaks ties). Powers the data-driven chain dropdown so
 * the user only sees chains that have tokens (and always sees Robinhood/XRP when
 * they do), instead of a static list where half the chains are empty.
 */
export function chainOptionsFromTokens(tokens) {
  const counts = new Map()
  for (const t of tokens || []) {
    if (!t) continue
    let key = canonicalChainKey(t.chain)
    if (!key && t.platforms && typeof t.platforms === 'object') {
      key = canonicalChainKey(Object.keys(t.platforms)[0])
    }
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: chainLabel(key), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      const oa = KEY_ORDER.has(a.key) ? KEY_ORDER.get(a.key) : 999
      const ob = KEY_ORDER.has(b.key) ? KEY_ORDER.get(b.key) : 999
      return oa - ob
    })
}
