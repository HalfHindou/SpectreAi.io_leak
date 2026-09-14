// Legacy `appresearchbeta` Cloud Run host is dead. All endpoints below now route
// to the migrated /api/* routes (Express in dev, Vercel functions in prod):
//   /fetch_tokens                → /api/search/tokens (CG + Codex composition)
//   /get-token-market-profile    → /api/token/market-profile (CG /coins/{id} + Spectre sentiment)
//   /get-token-market-data       → /api/token/market-profile (same endpoint; lighter normalizer)
const APP_RESEARCH_BASE_URL = ''
const APP_RESEARCH_PROXY_BASE_URL = ''

function toNumber(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,%\s,]/g, '')
    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toPercentString(ratio) {
  const num = toNumber(ratio)
  if (num == null) return '0.0'
  return (num * 100).toFixed(1)
}

function toIdentifier(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') return null
  return trimmed || null
}

function looksLikeContractAddress(value) {
  const id = toIdentifier(value)
  if (!id) return false
  if (/^0x[a-fA-F0-9]{40}$/.test(id)) return true
  // Solana/base58-style addresses are commonly 32-44 chars with no slug separators.
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)
}

function toCodexId(value) {
  const id = toIdentifier(value)
  if (!id) return null
  const base = id.includes(':') ? id.split(':')[0] : id
  return looksLikeContractAddress(base) ? base : null
}

function buildUrl(path, params = {}) {
  const searchParams = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== '')
  )
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return `${APP_RESEARCH_PROXY_BASE_URL}${path}${suffix}`
}

async function fetchAppResearchJson(path, params = {}, { signal } = {}) {
  const url = buildUrl(path, params)
  const res = await fetch(url, {
    // Never unbounded: this feeds the RZ hook's Promise.allSettled, and a hung
    // serverless hop here held loading.price/market — and every pane gated on
    // them — indefinitely (founder 08-07). Callers may pass a tighter signal.
    signal: signal ?? AbortSignal.timeout(12000),
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Endpoint returned a non-JSON response')
  }

  const data = await res.json()
  if (data && typeof data === 'object' && !Array.isArray(data) && data.error) {
    throw new Error(data.error)
  }

  return data
}

export function chainToDisplayName(chain) {
  if (!chain) return 'Native'

  const normalized = String(chain).toLowerCase()
  const map = {
    ethereum: 'ETH',
    eth: 'ETH',
    bsc: 'BSC',
    'binance-smart-chain': 'BSC',
    solana: 'SOL',
    sol: 'SOL',
    '1399811149': 'SOL',
    polygon: 'MATIC',
    matic: 'MATIC',
    arbitrum: 'ARB',
    'arbitrum-one': 'ARB',
    base: 'BASE',
    avalanche: 'AVAX',
    avax: 'AVAX',
    optimism: 'OP',
    op: 'OP',
    fantom: 'FTM',
    ftm: 'FTM',
    celo: 'CELO',
    tron: 'TRON',
    sui: 'SUI',
    aptos: 'APT',
    ton: 'TON',
    near: 'NEAR',
    cosmos: 'ATOM',
    'rug-network': 'RUG',
  }

  return map[normalized] || String(chain).toUpperCase()
}

export function chainToNetworkId(chain) {
  if (chain == null || chain === '') return null

  // Numeric chain-id strings (e.g. "8453" for Base) arrive from Codex /
  // DexScreener. Pass them straight through instead of letting them fall to
  // null (which upstream defaults to Ethereum) - that mis-fetched Base/Arb
  // tokens on the wrong chain. Names resolve via the map below.
  if (/^\d+$/.test(String(chain).trim())) return Number(chain)

  const normalized = String(chain).toLowerCase()
  const map = {
    ethereum: 1,
    eth: 1,
    bsc: 56,
    'binance-smart-chain': 56,
    solana: 1399811149,
    sol: 1399811149,
    '1399811149': 1399811149,
    polygon: 137,
    matic: 137,
    arbitrum: 42161,
    'arbitrum-one': 42161,
    base: 8453,
    avalanche: 43114,
    avax: 43114,
    optimism: 10,
    op: 10,
    fantom: 250,
    ftm: 250,
    celo: 42220,
    'rug-network': 531,
  }

  return map[normalized] ?? null
}

export function normalizeAppResearchSearchToken(item) {
  if (!item?.ticker) return null
  const contractAddress = item.contract_address || null

  return {
    symbol: item.ticker,
    name: item.name || item.ticker,
    address: contractAddress,
    networkId: chainToNetworkId(item.chain),
    network: chainToDisplayName(item.chain),
    chain: item.chain || null,
    price: toNumber(item.price) ?? 0,
    change: toNumber(item.change_1h) ?? 0,
    volume: toNumber(item.volume) ?? 0,
    liquidity: null,
    marketCap: toNumber(item.market_cap) ?? 0,
    logo: item.logo || null,
    cgId: item.cg_id || null,
    tokenId: item.token_id || null,
    codexId: item.codex_id || item.codexId || toCodexId(contractAddress) || null,
    isStock: false,
    _source: 'appresearch',
  }
}

export async function searchAppResearchTokens(query, { signal } = {}) {
  const trimmed = (query || '').trim()
  if (!trimmed) return []

  // /api/search/tokens returns either a flat array (Express) or
  // { results: [...] } (Vercel handler). Normalize both.
  const res = await fetch(`/api/search/tokens?query=${encodeURIComponent(trimmed)}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
  const payload = await res.json()
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.results) ? payload.results : [])
  return items.map(normalizeAppResearchSearchToken).filter(Boolean)
}

function getBestIdentifierMatch(results, symbol) {
  const upper = (symbol || '').trim().toUpperCase()
  if (!upper || !Array.isArray(results) || results.length === 0) return null

  return (
    results.find((item) => item.symbol?.toUpperCase() === upper && item.cgId) ||
    results.find((item) => item.symbol?.toUpperCase() === upper) ||
    results[0] ||
    null
  )
}

export async function resolveAppResearchProfileIdentifier({ symbol, cgId, tokenId, signal } = {}) {
  if (cgId) return { cgId, codexId: null }
  if (tokenId) return { cgId: null, codexId: tokenId }
  if (!symbol) return { cgId: null, codexId: null }

  const matches = await searchAppResearchTokens(symbol, { signal })
  const bestMatch = getBestIdentifierMatch(matches, symbol)

  if (!bestMatch) return { cgId: null, codexId: null }

  return bestMatch.cgId
    ? { cgId: bestMatch.cgId, codexId: null }
    : {
        cgId: null,
        codexId: bestMatch.codexId || toCodexId(bestMatch.address) || toCodexId(bestMatch.tokenId) || null,
      }
}

export function normalizeAppResearchMarketProfile(payload, { cgId = null, codexId = null } = {}) {
  const details = payload?.token_details
  if (!details?.ticker) return null

  const perf = details.price_performance || {}
  const ath = perf.all_time_high || {}
  const atl = perf.all_time_low || {}
  const liquiditydata = details.liquiditydata || {}
  const intelligence = payload?.intelligence_ai_analysis || {}

  return {
    symbol: details.ticker,
    name: details.token_name || details.ticker,
    cgId,
    coingeckoId: cgId,
    tokenId: codexId,
    codexId,
    image: details.image || null,
    banner: details.banner || null,
    description: details.description || '',
    holders: toNumber(details.holders),
    price: toNumber(details.price) ?? 0,
    marketCap: toNumber(details.market_cap) ?? 0,
    mcap: toNumber(details.market_cap) ?? 0,
    liquidity: toNumber(details.liquidity ?? liquiditydata.liquidity),
    volume: toNumber(details.volume_24h) ?? 0,
    volume24h: toNumber(details.volume_24h) ?? 0,
    fdv: toNumber(details.fully_diluted_valuation),
    fullyDilutedValuation: toNumber(details.fully_diluted_valuation),
    circulating: toNumber(details.circulating_supply),
    circulatingSupply: toNumber(details.circulating_supply),
    totalSupply: toNumber(details.total_supply ?? details.max_supply),
    maxSupply: toNumber(details.max_supply ?? details.total_supply),
    categories: Array.isArray(details.categories) ? details.categories : [],
    volMktCapRatio: toNumber(details.vol_mkt_cap_ratio ?? liquiditydata.volMktCapRatio),
    volMcapPct: toPercentString(details.vol_mkt_cap_ratio ?? liquiditydata.volMktCapRatio),
    low24h: toNumber(perf.low_24h),
    high24h: toNumber(perf.high_24h),
    change1h: toNumber(perf.change_1h),
    change24h: toNumber(perf.change_24h ?? perf.change24h),
    change7d: toNumber(perf.change_7d),
    change30d: toNumber(perf.change_30d),
    ath: toNumber(ath.price),
    athDate: ath.date || null,
    athChangePct: toNumber(ath.change_percentage),
    atl: toNumber(atl.price),
    atlDate: atl.date || null,
    atlChangePct: toNumber(atl.change_percentage),
    keyLevels: {
      support: toNumber(details.key_levels?.support),
      resistance: toNumber(details.key_levels?.resistance),
    },
    support: toNumber(details.key_levels?.support),
    resistance: toNumber(details.key_levels?.resistance),
    aiInsight: details.ai_insight || '',
    score: toNumber(intelligence.sentiment_score),
    sentimentLabel: intelligence.label || null,
    overallTrend: intelligence.overall_trend || null,
    fearGreed: intelligence.fear_greed || null,
    liquiditydata: {
      ...liquiditydata,
      liquidity: toNumber(liquiditydata.liquidity),
      volume24h: toNumber(liquiditydata.volume24h),
      volume24hUsd: toNumber(liquiditydata.volume24hUsd),
      marketCapUsd: toNumber(liquiditydata.marketCapUsd),
      volMktCapRatio: toNumber(liquiditydata.volMktCapRatio),
      buySideDepth: toNumber(liquiditydata.buySideDepth),
      sellSideDepth: toNumber(liquiditydata.sellSideDepth),
    },
    raw: payload,
  }
}

export function normalizeAppResearchMarketData(payload, { cgId = null, codexId = null } = {}) {
  if (!payload || typeof payload !== 'object') return null

  const perf = payload.price_performance || {}
  const ath = perf.all_time_high || {}
  const atl = perf.all_time_low || {}
  const logo = payload.logo || payload.image || payload.icon || null

  return {
    cgId,
    coingeckoId: cgId,
    codexId,
    price: toNumber(payload.price ?? payload.current_price ?? payload.currentPrice) ?? 0,
    image: logo,
    logo,
    banner: payload.banner || null,
    marketCap: toNumber(payload.market_cap) ?? 0,
    mcap: toNumber(payload.market_cap) ?? 0,
    holders: toNumber(payload.holders),
    liquidity: toNumber(payload.liquidity),
    volume: toNumber(payload.volume_24h) ?? 0,
    volume24h: toNumber(payload.volume_24h) ?? 0,
    fdv: toNumber(payload.fully_diluted_valuation),
    fullyDilutedValuation: toNumber(payload.fully_diluted_valuation),
    circulating: toNumber(payload.circulating_supply),
    circulatingSupply: toNumber(payload.circulating_supply),
    totalSupply: toNumber(payload.total_supply ?? payload.max_supply),
    maxSupply: toNumber(payload.max_supply ?? payload.total_supply),
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    volMktCapRatio: toNumber(payload.vol_mkt_cap_ratio),
    volMcapPct: toPercentString(payload.vol_mkt_cap_ratio),
    low24h: toNumber(perf.low_24h),
    high24h: toNumber(perf.high_24h),
    change1h: toNumber(perf.change_1h),
    change24h: toNumber(perf.change_24h ?? perf.change24h),
    change7d: toNumber(perf.change_7d),
    change30d: toNumber(perf.change_30d),
    ath: toNumber(ath.price),
    athDate: ath.date || null,
    athChangePct: toNumber(ath.change_percentage),
    atl: toNumber(atl.price),
    atlDate: atl.date || null,
    atlChangePct: toNumber(atl.change_percentage),
    keyLevels: {
      support: toNumber(payload.key_levels?.support),
      resistance: toNumber(payload.key_levels?.resistance),
    },
    support: toNumber(payload.key_levels?.support),
    resistance: toNumber(payload.key_levels?.resistance),
    raw: payload,
  }
}

async function fetchTokenProfileJson({ cgId, codexId, signal }) {
  const params = new URLSearchParams()
  if (cgId) params.set('cg_id', cgId)
  if (codexId) params.set('codex_id', codexId)
  const res = await fetch(`/api/token/market-profile?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
  return res.json()
}

export async function getAppResearchTokenMarketProfile({ cgId = null, codexId = null, signal } = {}) {
  if ((cgId && codexId) || (!cgId && !codexId)) {
    throw new Error('Provide exactly one of cgId or codexId')
  }
  const data = await fetchTokenProfileJson({ cgId, codexId, signal })
  return normalizeAppResearchMarketProfile(data, { cgId, codexId })
}

export async function getAppResearchTokenMarketData({ cgId = null, codexId = null, signal } = {}) {
  const cleanCgId = toIdentifier(cgId)
  const cleanCodexId = toIdentifier(codexId)

  if ((cleanCgId && cleanCodexId) || (!cleanCgId && !cleanCodexId)) {
    throw new Error('Provide exactly one of cgId or codexId')
  }

  // Same endpoint; the `normalizeAppResearchMarketData` normalizer reads only
  // the `token_details` subset relevant to the lighter shape, so reusing the
  // profile response is safe and saves a round trip.
  const profile = await fetchTokenProfileJson({ cgId: cleanCgId, codexId: cleanCodexId, signal })
  const lighter = profile?.token_details ? { ...profile.token_details, ...(profile.intelligence_ai_analysis || {}) } : profile
  return normalizeAppResearchMarketData(lighter, {
    cgId: cleanCgId,
    codexId: cleanCodexId,
  })
}

export async function getAppResearchTokenMarketProfileByToken({ symbol, cgId = null, tokenId = null, signal } = {}) {
  const identifier = await resolveAppResearchProfileIdentifier({ symbol, cgId, tokenId, signal })
  if (!identifier.cgId && !identifier.codexId) return null
  return getAppResearchTokenMarketProfile({
    cgId: identifier.cgId,
    codexId: identifier.codexId,
    signal,
  })
}

export async function getAppResearchTokenMarketDataByToken({
  symbol,
  cgId = null,
  codexId = null,
  tokenId = null,
  address = null,
  signal,
} = {}) {
  const cleanCgId = toIdentifier(cgId)
  if (cleanCgId) {
    return getAppResearchTokenMarketData({ cgId: cleanCgId, signal })
  }

  const cleanCodexId = toIdentifier(codexId)
    || toCodexId(address)
    || toCodexId(tokenId)

  if (cleanCodexId) {
    return getAppResearchTokenMarketData({ codexId: cleanCodexId, signal })
  }

  const identifier = await resolveAppResearchProfileIdentifier({ symbol, signal })
  if (identifier.cgId) {
    return getAppResearchTokenMarketData({ cgId: identifier.cgId, signal })
  }
  const resolvedCodexId = toCodexId(identifier.codexId)
  if (resolvedCodexId) {
    return getAppResearchTokenMarketData({ codexId: resolvedCodexId, signal })
  }
  return null
}

export {
  APP_RESEARCH_BASE_URL,
  APP_RESEARCH_PROXY_BASE_URL,
}
