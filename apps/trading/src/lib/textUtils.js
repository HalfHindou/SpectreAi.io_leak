/**
 * textUtils.js — small string helpers for the AI narrative surface.
 *
 * - firstTwoSentences(text)
 *     Returns the first 1–2 sentences of an arbitrary string. Strips a
 *     trailing "Verdict: …" tail the dossier sometimes appends.
 *
 * - highlightEntities(text, opts)
 *     Returns an array of React-renderable parts where matched entities
 *     are wrapped in <mark className="hd-mark">…</mark>. Matches:
 *       1. The current token symbol (case-insensitive, with optional $).
 *       2. The chain name (e.g. "Ethereum", "Solana").
 *       3. Numeric tokens with units: $1.23M, 50%, 1,234, etc.
 *
 *     Used by HeaderDossier to draw the eye to substance.
 */

import React from 'react'

export function firstTwoSentences(text) {
  const t = String(text || '').replace(/\nVerdict:.*/i, '').trim()
  if (!t) return ''
  const parts = t.match(/[^.!?]+[.!?]+/g)
  if (!parts || parts.length === 0) return t
  return parts.slice(0, 2).join(' ').trim()
}

/**
 * Single-sentence variant — keeps the AI Dossier header row compact.
 * Picks the first sentence; clips at ~180 chars even if the sentence is
 * unusually long so the lead stays within a 2-line visual budget.
 */
export function firstSentence(text) {
  const t = String(text || '').replace(/\nVerdict:.*/i, '').trim()
  if (!t) return ''
  const parts = t.match(/[^.!?]+[.!?]+/g)
  let lead = parts && parts.length ? parts[0].trim() : t
  if (lead.length > 180) {
    // Snap to a word boundary instead of mid-word truncation.
    const slice = lead.slice(0, 180)
    const lastSpace = slice.lastIndexOf(' ')
    lead = (lastSpace > 120 ? slice.slice(0, lastSpace) : slice).trim() + '…'
  }
  return lead
}

// Escape a string for safe use inside a RegExp.
function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Curated trading-term lexicon. These words are highlighted inline so a
 * trader can scan the dossier in seconds and pick out the structural
 * info — what the project IS, what it DOES, risk/quality signals,
 * other chains it interacts with.
 *
 * Sorted longest-first when assembled into the regex so multi-word
 * phrases ("smart contracts") win over single-word substrings
 * ("smart"). The matcher is case-insensitive with word boundaries.
 *
 * Deliberately omitted (too generic to be useful as a highlight):
 * platform, network, data, service(s), protocol, technology, project.
 */
const TRADING_TERMS = [
  // Protocol / asset categories — what the project IS
  'oracle network', 'automated market maker', 'decentralized exchange',
  'lending protocol', 'meme coin', 'memecoin', 'governance token',
  'utility token', 'security token', 'stablecoin', 'index token',
  'oracle', 'AMM', 'DEX', 'CEX', 'bridge', 'aggregator', 'launchpad',
  'rollup', 'sidechain', 'subnet', 'wrapped',
  'layer 1', 'layer 2', 'L1', 'L2',

  // DeFi / on-chain primitives — what the project DOES
  'liquidity pool', 'smart contracts', 'smart contract',
  'yield farming', 'flash loan', 'data feeds', 'cross-chain',
  'cross chain', 'on-chain', 'off-chain', 'multisig',
  'staking', 'governance', 'vault', 'tokenomics', 'automation',
  'lending', 'borrowing', 'derivatives', 'perpetuals', 'NFT', 'DeFi',

  // Quality / trust signals
  'tamper-proof', 'tamper proof', 'critical infrastructure',
  'institutional', 'audited', 'verified', 'mainnet', 'testnet',
  'permissionless', 'trustless', 'non-custodial', 'open-source',

  // Risk signals
  'rug pull', 'rugpull', 'honeypot', 'unlocked', 'locked',
  'burned', 'burn', 'minted', 'dev wallet', 'whale',

  // Market / scale terms
  'market cap', 'liquidity', 'volume', 'TVL', 'APY', 'APR',
  'slippage', 'gas fees',

  // Other chains — when the narrative mentions chains besides the
  // active token's (the active chain is already matched by chainName)
  'Ethereum', 'Solana', 'Bitcoin', 'Polygon', 'Arbitrum', 'Base',
  'BNB Chain', 'BSC', 'Avalanche', 'Optimism', 'Cardano',
  'Cosmos', 'Polkadot', 'Tron',

  // Notable protocols / ecosystems (highlight when name-dropped in
  // a different project's narrative)
  'Uniswap', 'PancakeSwap', 'SushiSwap', 'Curve', 'Aave', 'Compound',
  'MakerDAO', 'Chainlink', 'The Graph', 'Lido', 'Jupiter', 'Raydium',
]

/**
 * Split `text` into an array of plain strings and <mark> elements.
 * Matches (in priority order, longest match wins via regex alternation):
 *   1. Curated trading-term lexicon — pops the structural words
 *   2. The active token symbol (case-insensitive, with optional $)
 *   3. The active chain name
 *   4. Numeric tokens with units ($1.23M, 50%, 1,234)
 */
export function highlightEntities(text, opts = {}) {
  const str = String(text || '')
  if (!str) return []

  const { tokenSymbol, chainName } = opts
  const patterns = []

  // Trading terms — sort longest first so "smart contracts" matches
  // before "smart" would.
  const tradingSorted = TRADING_TERMS
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((term) =>
      // Spaces inside a phrase tolerate any whitespace run
      escapeRegExp(term).replace(/\\\s+|\s+/g, '\\s+')
    )
  patterns.push('\\b(?:' + tradingSorted.join('|') + ')\\b')

  if (tokenSymbol && tokenSymbol.length >= 2 && tokenSymbol.length <= 12) {
    patterns.push('\\$?\\b' + escapeRegExp(tokenSymbol) + '\\b')
  }
  if (chainName && chainName.length >= 2 && chainName.length <= 20) {
    patterns.push('\\b' + escapeRegExp(chainName) + '\\b')
  }
  patterns.push('\\$?\\d+(?:,\\d{3})*(?:\\.\\d+)?[KMBT%]?')

  const regex = new RegExp('(' + patterns.join('|') + ')', 'gi')

  const out = []
  let lastIndex = 0
  let match
  let counter = 0
  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      out.push(str.slice(lastIndex, match.index))
    }
    out.push(
      React.createElement(
        'mark',
        { key: 'hd-m-' + counter, className: 'hd-mark' },
        match[0]
      )
    )
    counter++
    lastIndex = match.index + match[0].length
    // Prevent infinite loop on zero-width matches
    if (match.index === regex.lastIndex) regex.lastIndex++
  }
  if (lastIndex < str.length) out.push(str.slice(lastIndex))
  return out
}

/**
 * Relative-time string ("just now", "2m ago", "1h ago", "3d ago").
 * Returns '' for falsy timestamps.
 */
export function relativeTime(ts) {
  if (!ts) return ''
  const diff = Math.max(0, Date.now() - ts)
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
