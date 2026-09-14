import { getTokenSlug, resolveSlugToSymbol } from '@/lib/tokenSlugs'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'

function normalizeString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeNetworkId(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildResearchZoneLocation(tokenData, isStock = false) {
  const pathname = `/research-zone/${getTokenSlug(
    tokenData?.symbol,
    isStock,
    tokenData?.cgId,
    tokenData?.name
  )}`

  if (isStock) {
    return { pathname, search: '' }
  }

  const symbol = normalizeString(tokenData?.symbol)
  const cgId = normalizeString(tokenData?.cgId)

  // Clean URL when the slug ALONE uniquely identifies the token on a cold
  // load: a cgId IS the globally-unique CoinGecko slug, and known majors
  // reverse-resolve via SYMBOL_TO_COINGECKO_ID ('bitcoin' -> BTC). In-app
  // navigation never needed the query string - app-shell seeds the full
  // token into AppState before navigating, and bare cgId paths already
  // cold-resolve through resolveSlugToSymbol/the server CG lookup. The
  // long ?tokenSymbol=&cgId=&address=... form stays for UNLISTED tokens
  // only, where same-symbol/name collisions make the slug ambiguous
  // (Gleb 2026-06-12: short shareable links).
  const slugIsUnique = !!cgId || !!(symbol && SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()])
  if (slugIsUnique) {
    return { pathname, search: '' }
  }

  const params = new URLSearchParams()
  const name = normalizeString(tokenData?.name)
  const codexId = normalizeString(tokenData?.codexId)
  const tokenId = normalizeString(tokenData?.tokenId)
  const address = normalizeString(tokenData?.address)
  const networkId = normalizeNetworkId(tokenData?.networkId)

  if (symbol) params.set('tokenSymbol', symbol)
  if (name) params.set('name', name)
  if (cgId) params.set('cgId', cgId)
  if (codexId) params.set('codexId', codexId)
  if (tokenId) params.set('tokenId', tokenId)
  if (address) params.set('address', address)
  if (networkId != null) params.set('networkId', String(networkId))

  const search = params.toString()
  return { pathname, search: search ? `?${search}` : '' }
}

// PR-3 (security/perf): the query-param identity is trusted enough to seed
// the token cache and skip the resolve round-trip on deep links, so every
// field is validated here - the single choke point - before anything
// downstream sees it. A tampered URL must not be able to poison the cache
// with an arbitrary address/network or inject markup through `name`.
const SYMBOL_RE = /^[A-Za-z0-9.$-]{1,15}$/
const CG_ID_RE = /^[a-z0-9-]{1,60}$/
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
// Networks the app actually resolves (mirror PLATFORM_NETWORK_MAP usage in
// use-research-zone-data.js): eth, bsc, polygon, arbitrum, optimism, base, solana
const ALLOWED_NETWORK_IDS = new Set([1, 56, 137, 42161, 10, 8453, 1399811149, 4663])

export function readResearchZoneTokenFromSearch(search = '') {
  const params = new URLSearchParams(search)
  const rawSymbol = normalizeString(params.get('tokenSymbol'))
  const rawCgId = normalizeString(params.get('cgId'))
  const rawCodexId = normalizeString(params.get('codexId'))
  const rawAddress = normalizeString(params.get('address'))
  const tokenId = normalizeString(params.get('tokenId'))
  const rawName = normalizeString(params.get('name'))
  const rawNetworkId = normalizeNetworkId(params.get('networkId'))

  const symbol = rawSymbol && SYMBOL_RE.test(rawSymbol) ? rawSymbol : null
  const cgId = rawCgId && CG_ID_RE.test(rawCgId) ? rawCgId : null
  const codexId = rawCodexId && /^[A-Za-z0-9:_-]{1,80}$/.test(rawCodexId) ? rawCodexId : null
  let address = rawAddress && (EVM_ADDRESS_RE.test(rawAddress) || SOLANA_ADDRESS_RE.test(rawAddress))
    ? rawAddress
    : null
  let networkId = rawNetworkId != null && ALLOWED_NETWORK_IDS.has(rawNetworkId) ? rawNetworkId : null
  // address and networkId only make sense as a validated pair
  if (!address) networkId = null
  const name = rawName ? rawName.slice(0, 80).replace(/[<>]/g, '') : (symbol || null)

  if (!symbol && !cgId && !address) return null

  return {
    symbol: symbol ? symbol.toUpperCase() : null,
    name,
    cgId,
    codexId,
    tokenId,
    address,
    networkId,
    isStock: false,
  }
}

export function doesResearchZoneTokenMatchSlug(tokenData, coinSlug) {
  if (!tokenData) return false
  if (!coinSlug) return true

  const tokenSymbol = normalizeString(tokenData.symbol)?.toUpperCase()
  const tokenSlug = tokenSymbol
    ? getTokenSlug(tokenSymbol, false, tokenData.cgId, tokenData.name)
    : null
  const resolvedSlugSymbol = resolveSlugToSymbol(coinSlug)

  return (
    tokenData.cgId === coinSlug ||
    tokenSlug === coinSlug ||
    (tokenSymbol != null && resolvedSlugSymbol?.toUpperCase() === tokenSymbol)
  )
}
