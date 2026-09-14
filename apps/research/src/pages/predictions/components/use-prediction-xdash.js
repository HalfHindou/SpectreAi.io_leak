/**
 * usePredictionXDash — per-prediction X-Dash social intelligence.
 *
 * A prediction detail page asks one question: who is carrying this, and is the
 * timeline confirming or fighting the odds? For CRYPTO markets we have a far
 * richer signal than keyword tweet-search: the X-Dash per-token corpus
 * (mentions, carriers, velocity, clean-signal). This hook bridges the two:
 *
 *   1. Resolve the market -> a token CoinGecko id (crypto only). The resolver
 *      reads the event tags first (Polymarket tags carry "bitcoin"/"solana"
 *      style slugs), then the title, against SYMBOL_TO_COINGECKO_ID + a small
 *      alias table for the names that don't equal the ticker ("ether",
 *      "doge", "ripple"...). Conservative — a wrong token is worse than none.
 *   2. Pull useXDashToken(cgId) and normalize via the X-Dash utils so the
 *      detail page reuses the EXACT shapes the X-Dash drawer renders
 *      (mergedMentions, carrier board, metrics, clean-signal).
 *
 * For NON-crypto markets (politics, sports, geopolitics...) X-Dash has no
 * token corpus, so the hook returns `isCrypto:false` and the caller falls
 * back to the existing tweet-search social panel (use-predictions-social.js).
 *
 * Returns an OBJECT (never an array). Degrades to a premium empty state —
 * `hasSocial:false` with no error — when a crypto market has no warm corpus.
 */
import { useMemo } from 'react'
import { useXDashToken } from '@/hooks/useXDashToken'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import {
  normalizeXDashDetail,
  buildCarrierBoard,
  buildSignalCarriers,
} from '@/pages/x-dash/components/x-dash-utils'

/* Names/slugs that don't equal the ticker. Lowercased, longest-first matched. */
const NAME_TO_SYMBOL = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  ether: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
  ripple: 'XRP',
  xrp: 'XRP',
  cardano: 'ADA',
  ada: 'ADA',
  dogecoin: 'DOGE',
  doge: 'DOGE',
  avalanche: 'AVAX',
  avax: 'AVAX',
  polkadot: 'DOT',
  chainlink: 'LINK',
  polygon: 'MATIC',
  matic: 'MATIC',
  uniswap: 'UNI',
  cosmos: 'ATOM',
  litecoin: 'LTC',
  arbitrum: 'ARB',
  optimism: 'OP',
  aptos: 'APT',
  sui: 'SUI',
  injective: 'INJ',
  celestia: 'TIA',
  bittensor: 'TAO',
  ondo: 'ONDO',
  jupiter: 'JUP',
  pyth: 'PYTH',
  pepe: 'PEPE',
  dogwifhat: 'WIF',
  wif: 'WIF',
  bonk: 'BONK',
  shiba: 'SHIB',
  'shiba inu': 'SHIB',
  shib: 'SHIB',
  floki: 'FLOKI',
  spectre: 'SPECTRE',
  // Bare tickers that ARE the symbol still resolve through SYMBOL_TO_COINGECKO_ID,
  // but listing the common ones here keeps the title path fast + explicit.
  bnb: 'BNB',
  near: 'NEAR',
  aave: 'AAVE',
}

/* Resolve a Polymarket event -> { cgId, symbol } when it's a crypto market we
 * can map to an X-Dash token. Returns null otherwise. Order:
 *   1. event tags (most reliable — Polymarket tags like "bitcoin", "solana")
 *   2. whole-word scan of the title
 * Both resolve through NAME_TO_SYMBOL first, then SYMBOL_TO_COINGECKO_ID. */
function resolveCryptoToken(event, category) {
  if (!event) return null
  // Only attempt for crypto-categorised markets — avoids "Will SOL Levenson
  // win the senate" style false hits in politics titles.
  if (category && category !== 'crypto') return null

  const tagSlugs = (event.tags || [])
    .map((tg) => String(tg.slug || tg.label || '').toLowerCase().trim())
    .filter(Boolean)

  // 1) tags
  for (const slug of tagSlugs) {
    const sym = NAME_TO_SYMBOL[slug]
    if (sym && SYMBOL_TO_COINGECKO_ID[sym]) return { cgId: SYMBOL_TO_COINGECKO_ID[sym], symbol: sym }
    const upper = slug.toUpperCase()
    if (SYMBOL_TO_COINGECKO_ID[upper]) return { cgId: SYMBOL_TO_COINGECKO_ID[upper], symbol: upper }
  }

  // 2) title — whole-word scan, longest alias first so "shiba inu" wins over "shib"
  const title = String(event.title || event.question || '').toLowerCase()
  const aliases = Object.keys(NAME_TO_SYMBOL).sort((a, b) => b.length - a.length)
  for (const alias of aliases) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(title)) {
      const sym = NAME_TO_SYMBOL[alias]
      if (SYMBOL_TO_COINGECKO_ID[sym]) return { cgId: SYMBOL_TO_COINGECKO_ID[sym], symbol: sym }
    }
  }
  return null
}

/* engagement-weighted velocity proxy from the metrics block — falls back to
 * the raw mention count when velocity_ratio isn't populated. */
function readVelocity(metrics) {
  const v = Number(metrics?.velocity_ratio)
  return Number.isFinite(v) ? v : null
}

export function usePredictionXDash(event, category, { enabled = true } = {}) {
  const resolved = useMemo(
    () => (enabled ? resolveCryptoToken(event, category) : null),
    [enabled, event, category],
  )
  const cgId = resolved?.cgId || null

  // Only fires when we have a cgId — non-crypto markets never hit X-Dash.
  // 90s background refresh on focus mirrors the X-Dash drawer cadence.
  const { data, loading, error } = useXDashToken(cgId || '', {
    refreshIntervalMs: cgId ? 90_000 : 0,
    refreshOnFocus: !!cgId,
  })

  return useMemo(() => {
    if (!cgId) {
      return {
        isCrypto: false,
        cgId: null,
        symbol: null,
        loading: false,
        hasSocial: false,
        mentions: [],
        carriers: [],
        signalCarriers: [],
        metrics: {},
        quality: {},
        tokenInfo: {},
        velocity: null,
        kolCount: 0,
        error: false,
      }
    }

    const normalized = normalizeXDashDetail(data)
    const mentions = normalized.mergedMentions || []
    const carriers = buildCarrierBoard(
      normalized.topAuthors,
      normalized.authors,
      normalized.mentions,
    )
    // Signal carriers (proof-weighted) — used by the constellation KOL layer.
    const signalCarriers = buildSignalCarriers(normalized.topAuthors, normalized.mentions)
    const kolCount = carriers.filter(
      (c) => Number(c.followers_count || c.followers || 0) >= 100000,
    ).length

    return {
      isCrypto: true,
      cgId,
      symbol: resolved.symbol,
      loading: loading && !data,
      // Warm corpus = we actually have mentions OR named carriers to render.
      hasSocial: mentions.length > 0 || carriers.length > 0,
      mentions,
      carriers,
      signalCarriers,
      metrics: normalized.metrics || {},
      quality: normalized.quality || {},
      tokenInfo: normalized.tokenInfo || {},
      velocity: readVelocity(normalized.metrics),
      kolCount,
      error: !!error,
    }
  }, [cgId, resolved, data, loading, error])
}
