/**
 * Shared module-level state and helpers for the Codex hook family.
 * Originally lived inside useCodexData.js. Extracted so each sub-hook can
 * import only the pieces it needs while preserving identical singleton
 * behaviour (caches, in-flight maps, WebSocket, persisted token index).
 */
import { isDev } from '@/utils/env';
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens';

/**
 * Check if string is a contract address (EVM or Solana)
 */
export function isContractAddress(str) {
  if (!str) return false;
  if (str.startsWith('0x') && str.length === 42) return true;
  if (str.length >= 32 && str.length <= 44 && !str.startsWith('0x')) {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (base58Regex.test(str)) return true;
  }
  return false;
}

/**
 * Singleton WebSocket connection to backend for real-time price streaming.
 * Multiple hooks share one connection with ref-counted subscriptions.
 * On Vercel/production (no WS server), this gracefully gives up after 3 failures
 * and individual hooks fall back to REST polling.
 */
export let wsInstance = null;
export const wsListeners = new Map(); // key -> Set<callback>
let wsReconnectTimer = null;
let wsFailCount = 0;
let wsGaveUp = false; // true when WS is permanently unavailable (e.g. Vercel)
const WS_MAX_FAILURES = 3; // Give up after this many consecutive failures

// Only attempt WS on localhost / dev - Vercel doesn't have a WS server
const isLocalDev = isDev;
const WS_URL = isLocalDev ? `ws://${window.location.hostname}:3001/ws` : null;

export function getWS() {
  // Don't even try on production or if we already gave up
  if (!WS_URL || wsGaveUp) return null;

  if (wsInstance && wsInstance.readyState === WebSocket.OPEN) return wsInstance;
  if (wsInstance && wsInstance.readyState === WebSocket.CONNECTING) return wsInstance;

  // Clean up old instance
  if (wsInstance) {
    try { wsInstance.close(); } catch (e) { console.error(e) }
  }

  try {
    wsInstance = new WebSocket(WS_URL);
  } catch(e) {
    wsGaveUp = true;
    return null;
  }

  wsInstance.onopen = () => {
    wsFailCount = 0; // Reset on success
    // Re-subscribe all active tokens
    wsListeners.forEach((_, key) => {
      const [address, networkId] = key.split('_');
      wsInstance.send(JSON.stringify({ type: 'subscribe', address, networkId: parseInt(networkId) }));
    });
  };

  wsInstance.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'price_update' && msg.address) {
        const key = `${msg.address.toLowerCase()}_${msg.networkId || 1}`;
        const listeners = wsListeners.get(key);
        if (listeners) {
          listeners.forEach(cb => cb(msg));
        }
      }
    } catch (e) { console.error(e) }
  };

  wsInstance.onclose = () => {
    wsInstance = null;
    wsFailCount++;
    if (wsFailCount >= WS_MAX_FAILURES) {
      wsGaveUp = true;
      return;
    }
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(getWS, 5000);
  };

  wsInstance.onerror = () => {
    // onclose will fire after this
  };

  return wsInstance;
}

/** Returns true if WebSocket is permanently unavailable */
export function isWSUnavailable() {
  return wsGaveUp || !WS_URL;
}

/** Live reference to the active WS instance (may be null). */
export function getWSInstance() {
  return wsInstance;
}

// ─── Trending / trades / bars caches ────────────────────────────────────────
export const ALL_NETWORKS = [1, 56, 137, 42161, 8453, 1399811149];
export const trendingCache = new Map(); // key: "1,56,137,..." → { data: [], timestamp }
// 5 min (was 60s). Each trending fetch is a Codex `filterTokens` which bills as
// TWO ops (the filter + an internal listPairsWithMetadataForToken pair
// aggregation for liquidity/volume). Beta-scale concurrent mounts across
// Welcome/AIScreener/discovery were each missing the 60s cache and re-firing.
// Trending rankings do not shift meaningfully within 5 min. 5x fewer fetches.
export const TRENDING_CACHE_TTL = 300_000;

export const tradesCache = new Map();
export const TRADES_CACHE_TTL = 30_000; // 30 seconds

export const barsCache = new Map();
export const BARS_CACHE_TTL = 30_000; // 30 seconds

// ─── Curated price cache ────────────────────────────────────────────────────
export const PRICE_CACHE_KEY = 'spectre_token_prices_cache';

// ─── Search infrastructure ──────────────────────────────────────────────────
// /api/search/tokens (Express in dev, Vercel handler in prod) composes
// CoinGecko /search (canonical IDs + market caps + 1h/24h change via
// /coins/markets enrichment) with Codex filterTokens for DEX-only coverage,
// drops 0-mcap dust forks, and ranks canonical tokens above pump.fun lookalikes.
// `_mapSearchApiResults` already handles both the Codex `{token:{...}}` shape
// and the flat fetch_tokens shape this endpoint returns.
import { isDev as _searchIsDev } from '@/utils/env';
// `?v=2` cache-buster (2026-05-28): the previous URL had a 5min Vercel edge
// cache poisoned by a single transient upstream blip — every user got the
// same empty-prices response for the full TTL. Bumping the version segment
// makes the URL a fresh edge-cache key. Future versions can bump this
// (?v=3, ?v=4) to force-flush after any similar incident. Server-side TTL
// has also been lowered to 30s so this can't happen again at the same scale.
export const SEARCH_API_URL = '/api/search/tokens?v=2';
export const SEARCH_QUERY_KEY = 'query';
export function buildSearchUrl(searchQuery) {
  return `${SEARCH_API_URL}&query=${encodeURIComponent(searchQuery)}`;
}
export const SEARCH_MIN_QUERY_LENGTH = 2;

// Map chain name from search API to display name
export function chainToDisplayName(chain) {
  if (!chain) return null;
  // Numeric Codex networkIds (the token/details fast-path passes these as
  // strings) - without this the chain badge rendered raw "1399811149".
  const idMap = {
    '1': 'ETH', '56': 'BSC', '137': 'MATIC', '8453': 'BASE',
    '42161': 'ARB', '10': 'OP', '43114': 'AVAX', '250': 'FTM',
    '1399811149': 'SOL', '4663': 'HOOD',
  };
  if (idMap[String(chain)]) return idMap[String(chain)];
  const map = {
    ethereum: 'ETH', eth: 'ETH',
    bsc: 'BSC', 'binance-smart-chain': 'BSC',
    solana: 'SOL', sol: 'SOL',
    polygon: 'MATIC', matic: 'MATIC',
    arbitrum: 'ARB', 'arbitrum-one': 'ARB',
    base: 'BASE',
    avalanche: 'AVAX', avax: 'AVAX',
    optimism: 'OP', op: 'OP',
    fantom: 'FTM', ftm: 'FTM',
    tron: 'TRON',
    sui: 'SUI',
    aptos: 'APT',
    ton: 'TON',
    near: 'NEAR',
    cosmos: 'ATOM',
    robinhood: 'HOOD', hood: 'HOOD',
  };
  return map[chain.toLowerCase()] || chain.toUpperCase();
}

// Map chain name to Codex-compatible networkId
export function chainToNetworkId(chain) {
  if (chain == null || chain === '') return null;
  // Codex / DexScreener return the chain as a numeric id STRING (e.g. "8453"
  // for Base). chainToDisplayName already handles these via an id map; this
  // function did not, so "8453" fell through to null and the caller's
  // `networkId || 1` defaulted a Base/Arb/etc. token to Ethereum - the
  // trading terminal then fetched on the wrong chain and showed no
  // chart/data. Pass numeric chain ids straight through (Solana's
  // 1399811149 included). Names still resolve via the map below.
  if (/^\d+$/.test(String(chain).trim())) return Number(chain);
  const map = {
    ethereum: 1, eth: 1,
    bsc: 56, 'binance-smart-chain': 56,
    solana: 1399811149, sol: 1399811149,
    polygon: 137, matic: 137,
    arbitrum: 42161, 'arbitrum-one': 42161,
    base: 8453,
    avalanche: 43114, avax: 43114,
    optimism: 10, op: 10,
    fantom: 250, ftm: 250,
    robinhood: 4663, hood: 4663,
  };
  return map[chain.toLowerCase()] || null;
}

// Module-level cache for search results (avoids re-fetching same query)
export const _searchCache = new Map(); // key: query string, value: { data, ts }
// 30s → 120s (2026-07-07 instant-search pass): search rows are identity +
// coarse metrics, not a live tape — re-typing the same query within 2min
// should paint instantly from cache instead of re-running the full fan-out.
export const SEARCH_CACHE_TTL = 120_000;
// Empty answers get their own, much shorter TTL. A brand-new listing or a
// single upstream blip returns zero rows for a query that is perfectly
// findable seconds later; at the 2-min TTL that one blip pinned
// "No tokens found" for the exact query the user keeps re-typing, which is
// what "search doesn't work for this token" reports usually are.
export const SEARCH_CACHE_EMPTY_TTL = 8_000;
export const SEARCH_CACHE_MAX = 50;

// In-flight request dedup - prevents duplicate parallel fetches for the same query
export const _searchInflight = new Map(); // key: query string, value: Promise

// Persistent local token index - accumulates every token the user has seen in search results.
// Enables GMGN-style instant local filtering across ALL tokens (not just major ones).
// Keyed by lowercase address; survives page reloads via localStorage.
const TOKEN_INDEX_KEY = 'spectre-token-index-v1';
const TOKEN_INDEX_MAX = 2000;
export const _tokenIndex = new Map(); // address -> { ... }

// Load from localStorage on module init
try {
  const raw = localStorage.getItem(TOKEN_INDEX_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry?.address) _tokenIndex.set(entry.address.toLowerCase(), entry);
      }
    }
  }
} catch { /* corrupt data, ignore */ }

let _indexPersistTimer = null;
function _persistTokenIndex() {
  if (_indexPersistTimer) clearTimeout(_indexPersistTimer);
  _indexPersistTimer = setTimeout(() => {
    try {
      const arr = Array.from(_tokenIndex.values()).slice(-TOKEN_INDEX_MAX);
      localStorage.setItem(TOKEN_INDEX_KEY, JSON.stringify(arr));
    } catch { /* quota exceeded, ignore */ }
  }, 1000);
}

export function _addToTokenIndex(results) {
  if (!Array.isArray(results) || results.length === 0) return;
  let added = 0;
  for (const r of results) {
    const addr = (r.address || r.ca || '').toLowerCase();
    if (!addr || !r.symbol) continue;
    _tokenIndex.set(addr, {
      symbol: r.symbol,
      name: r.name || r.symbol,
      address: r.address || r.ca,
      networkId: r.networkId ?? null,
      network: r.network || null,
      logo: r.logo || null,
      price: r.price || r.priceUSD || 0,
      change: r.change || r.change24 || 0,
      marketCap: r.marketCap || 0,
      liquidity: r.liquidity || 0,
      volume: r.volume || r.volume24 || 0,
      cgId: r.cgId || null,
    });
    added++;
  }
  if (_tokenIndex.size > TOKEN_INDEX_MAX) {
    // LRU: delete oldest entries
    const excess = _tokenIndex.size - TOKEN_INDEX_MAX;
    const keys = Array.from(_tokenIndex.keys()).slice(0, excess);
    keys.forEach(k => _tokenIndex.delete(k));
  }
  if (added > 0) _persistTokenIndex();
}

/**
 * Search the local token index (no API call, instant).
 * Returns scored matches by symbol or name.
 */
export function searchLocalTokenIndex(query, limit = 10) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  const matches = [];
  for (const entry of _tokenIndex.values()) {
    const symLower = (entry.symbol || '').toLowerCase();
    const nameLower = (entry.name || '').toLowerCase();
    const addrLower = (entry.address || '').toLowerCase();
    let score = 0;
    if (addrLower === q) score = 200;
    else if (symLower === q) score = 100;
    else if (nameLower === q) score = 95;
    else if (symLower.startsWith(q)) score = 80;
    else if (nameLower.startsWith(q)) score = 70;
    else if (symLower.includes(q)) score = 50;
    else if (nameLower.includes(q)) score = 40;
    if (score > 0) {
      matches.push({ ...entry, _score: score + Math.min(20, (entry.marketCap || 0) / 1e9) });
    }
  }
  matches.sort((a, b) => b._score - a._score);
  return matches.slice(0, limit);
}

// Find best prefix cache match for instant display while fetching
export function _getPrefixCached(query) {
  const lower = query.toLowerCase();
  // Try progressively shorter prefixes
  for (let i = lower.length - 1; i >= 1; i--) {
    const prefix = lower.slice(0, i);
    const cached = _searchCache.get(prefix);
    if (cached && (Date.now() - cached.ts) < (cached.ttl || SEARCH_CACHE_TTL)) {
      // Filter cached results to match new query
      return cached.data.filter(r =>
        (r.symbol || '').toLowerCase().includes(lower) ||
        (r.name || '').toLowerCase().includes(lower) ||
        (r.address || '').toLowerCase() === lower
      );
    }
  }
  return null;
}

// Relevance score: exact match > startsWith > includes. Used as the primary
// sort signal so a query like "dogeous" can surface a small-cap DEX token
// above larger-cap fuzzy hits (e.g. DOGE), while ties still resolve by mcap.
function _relevanceScore(item, q) {
  // Strip the "$" ticker prefix on-chain tokens self-report ("$PAAL"): the
  // user types "paal", and without this the real token scored a weak
  // `includes` (90) instead of an exact symbol match (200) and sank below
  // fuzzier hits.
  const sym = (item.symbol || '').toLowerCase().replace(/^\$+/, '');
  const name = (item.name || '').toLowerCase();
  const addr = (item.address || '').toLowerCase();
  if (addr === q) return 300;
  if (sym === q) return 200;
  if (name === q) return 180;
  if (sym.startsWith(q)) return 150;
  if (name.startsWith(q)) return 130;
  if (sym.includes(q)) return 90;
  if (name.includes(q)) return 70;
  return 0;
}

// Canonical-coin guard: spam tokens routinely use famous names as their literal
// symbol (e.g. HarryPotterObamaSonic10Inu's ticker is "BITCOIN", random Codex
// rows return "Purple Bitcoin"). Without a guard, those score 200 (exact sym
// match) and rank above the real BTC which only matches by name. Solution:
// when the query matches a major coin's NAME or CANONICAL SYMBOL, give that
// major coin a massive boost so it always ranks first.
const _CANONICAL_NAME_TO_SYMBOL = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', cardano: 'ADA',
  ripple: 'XRP', dogecoin: 'DOGE', polkadot: 'DOT', litecoin: 'LTC',
  chainlink: 'LINK', uniswap: 'UNI', polygon: 'MATIC', avalanche: 'AVAX',
  tron: 'TRX', cosmos: 'ATOM', monero: 'XMR', stellar: 'XLM',
  hyperliquid: 'HYPE', toncoin: 'TON', sui: 'SUI', aptos: 'APT', near: 'NEAR',
};
// symbol → the canonical name key ('BTC' → 'bitcoin'), for the identity check
// below. Built once from the map above.
const _CANONICAL_SYMBOL_TO_NAME = Object.fromEntries(
  Object.entries(_CANONICAL_NAME_TO_SYMBOL).map(([name, sym]) => [sym, name])
);

// Is this row actually the canonical coin, or just wearing its ticker? Spam
// tokens use famous tickers constantly (a Robinhood-chain "ETH" is really
// "RobinhoodVladRWAPepe67"), and handing them the +1000 put them in the same
// tier as the real asset. The CoinGecko id is the strongest signal; a name
// that IS the canonical name (or the ticker itself, for XRP-style coins whose
// name and symbol match) covers rows that arrived without one.
function _isCanonicalCoin(item, sym) {
  const wantName = _CANONICAL_SYMBOL_TO_NAME[sym];
  if (!wantName) return false;
  const cgId = String(item.cgId || '').toLowerCase();
  if (cgId) return cgId === wantName;
  const name = String(item.name || '').toLowerCase().trim();
  return name === wantName || name === sym.toLowerCase();
}

function _canonicalBoost(item, q) {
  const sym = (item.symbol || '').toUpperCase();
  // Direct symbol match against the canonical map's value (BTC === BTC for q=btc)
  if (q.toUpperCase() === sym && _isCanonicalCoin(item, sym)) return 1000;
  // Query matches a famous coin name → boost that coin's canonical symbol
  const wantSym = _CANONICAL_NAME_TO_SYMBOL[q];
  if (wantSym && sym === wantSym) return 1000;
  // …and a PREFIX of that name counts too. The exact-match-only rule left the
  // guard useless mid-typing: on q="ethe" a $78k meme whose ticker is literally
  // "ETHEREUM" (HarryPotterTrumpHomerSimpson777Inu) outranked the real ETH,
  // because a ticker prefix (150) beats a name prefix (130) and the boost never
  // fired. 3+ chars so "et" doesn't promote ETH over everything.
  if (q.length >= 3) {
    for (const [name, canonSym] of Object.entries(_CANONICAL_NAME_TO_SYMBOL)) {
      if (name.startsWith(q) && sym === canonSym) return 1000;
    }
  }
  // The mirror image: a token whose TICKER is a famous coin's NAME is
  // impersonating it (HarryPotterTrumpHomerSimpson777Inu trades as "ETHEREUM",
  // $78k cap). Its ticker prefix-matches every query the real coin answers, so
  // it rides along near the top. Push it below everything honest.
  const impersonated = _CANONICAL_NAME_TO_SYMBOL[sym.toLowerCase()];
  if (impersonated && impersonated !== sym) return -1000;
  return 0;
}

// A row claiming >= $1M of liquidity while trading almost nothing is a wash
// clone (the "Ethena" farm: $756M LP, $3.99 of 24h volume). Judged on
// liquidity only — market cap describes the asset, not the pool, so a real
// bridged row on a small venue must not read as washed. Shared with the
// cross-source fold in useTokenSearch so both use ONE definition.
export function isWashedRow(r) {
  const liq = Number(r?.liquidity) || 0;
  if (liq < 1_000_000) return false;
  const vol = Number(r?.volume) || 0;
  return vol > 0 && vol < Math.max(1_000, liq * 0.0002);
}

// Size is a relevance signal in its own right, not just a tie-break. The text
// tiers below sit 20-50 points apart, so a $372k BSC token called "eTHENA"
// outranked the real $1.47B Ethena on q="ethena" purely because its TICKER
// matched exactly (200) while Ethena matched by NAME (180). A log scale ×8
// spans ~96 points across the whole cap range, which lets a mega-cap cross ONE
// tier but never lets a big fuzzy match beat a genuine exact match on a small
// token (the "dogeous" case the tiers exist for). Fabricated money buys
// nothing: a washed row scores 0.
function _sizeScore(item) {
  if (isWashedRow(item)) return 0;
  const money = Math.max(Number(item.marketCap) || 0, Number(item.volume) || 0);
  return money > 0 ? Math.min(96, Math.log10(money) * 8) : 0;
}

export function _sortSearchResults(results, searchQuery) {
  const q = (searchQuery || '').toLowerCase().trim();
  const isAddr = isContractAddress(searchQuery);
  // A row with no price, mcap, volume OR liquidity is an identity row whose
  // numbers have not landed (the box answers /v1/search with symbol + name
  // only). It renders with a blank right half, so it must never lead the list
  // — measured 2026-08-31 on q=ethe: six data-less rows (ETHE, ETHERPAD,
  // ETHE.D, ETHEREUM, ETHERA, SUSDE) sat above the real ETH purely on ticker
  // relevance. Ranks BEFORE relevance because "looks empty" beats any prefix
  // match; a no-op while a lane is still loading, since then every row is
  // data-less and the tier is uniform.
  const hasData = (r) => (Number(r.price) || 0) > 0 || (Number(r.marketCap) || 0) > 0
    || (Number(r.volume) || 0) > 0 || (Number(r.liquidity) || 0) > 0;
  results.sort((a, b) => {
    const da = hasData(a);
    const db = hasData(b);
    if (da !== db) return da ? -1 : 1;
    if (isAddr) {
      const aMatch = (a.address || '').toLowerCase() === q;
      const bMatch = (b.address || '').toLowerCase() === q;
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }
    // Canonical boost BEFORE isMajor — real BTC must beat 'BITCOIN'-symboled
    // spam tokens, and it must also beat an unrelated top-200 coin that merely
    // shares a substring (q="ethe" put SUSDE above ETH purely on its rank flag).
    const ca = _canonicalBoost(a, q);
    const cb = _canonicalBoost(b, q);
    if (ca !== cb) return cb - ca;
    if (a.isMajor && !b.isMajor) return -1;
    if (!a.isMajor && b.isMajor) return 1;
    const sa = _relevanceScore(a, q) + _sizeScore(a);
    const sb = _relevanceScore(b, q) + _sizeScore(b);
    if (sa !== sb) return sb - sa;
    return (b.marketCap || 0) - (a.marketCap || 0);
  });
  return results;
}

function _extractSearchApiRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.tokens)) return payload.tokens;
  if (Array.isArray(payload?.coins)) return payload.coins;
  if (Array.isArray(payload?.data?.coins)) return payload.data.coins;
  return [];
}

export function _mapSearchApiResults(payload) {
  const rows = _extractSearchApiRows(payload);
  const mapped = rows
    .map(row => {
      // Codex shape (`/api/tokens/search`, `/api/codex?action=search`):
      //   { token: { symbol, name, address, networkId, info: {...}, networkName },
      //     priceUSD, volume24, liquidity, marketCap, change24, holders, qualityScore }
      // Flatten so the rest of the mapper sees a flat `item`.
      if (row && row.token && typeof row.token === 'object') {
        const t = row.token;
        return {
          symbol: t.symbol,
          name: t.name,
          address: t.address,
          networkId: t.networkId,
          network: t.networkName || null,
          price: row.priceUSD || row.price || 0,
          change24h: row.change24 || row.change || 0,
          volume_24h: row.volume24 || row.volume || 0,
          liquidity: row.liquidity || 0,
          market_cap: row.marketCap || 0,
          image_small: t.info?.imageThumbUrl || t.info?.imageLargeUrl || null,
          rank: row.rank ?? null,
          cg_id: row.cgId || row.coingecko_id || null,
        };
      }
      return row;
    })
    .filter(item => item && (item.ticker || item.symbol))
    .map(item => ({
      symbol: item.ticker || item.symbol,
      name: item.name || item.ticker || item.symbol,
      address: item.contract_address || item.address || null,
      networkId: item.networkId || chainToNetworkId(item.chain || item.network),
      network: typeof item.network === 'string' ? item.network : chainToDisplayName(item.chain || item.network),
      price: item.price || 0,
      // 24h change is the canonical row metric. The old order preferred
      // change_1h when present, so some rows showed a 1-hour move mislabeled
      // as the change while others showed 24h - inconsistent %. Prefer 24h
      // (change24h / change), fall back to change_1h only when 24h is absent.
      change: item.change24h ?? item.change ?? item.change_1h ?? 0,
      volume: item.volume || item.volume_24h || 0,
      liquidity: item.liquidity || 0,
      marketCap: item.market_cap || item.marketCap || 0,
      // CG /search coins (returned via Spectre /v1/search) expose `large` / `thumb`
      // instead of `image_small`. Include both fallbacks.
      logo: item.logo || item.image || item.image_small || item.large || item.thumb || null,
      isMajor: (item.market_cap_rank != null && Number(item.market_cap_rank) <= 200)
        || (item.rank != null && Number(item.rank) <= 200),
      cgId: item.cg_id || item.coingecko_id || item.id,
      tokenId: item.token_id,
      codexId: item.codex_id || item.codexId || item.contract_address || item.address || null,
      rank: item.market_cap_rank ?? item.rank ?? null,
    }));

  // Plausibility clamp: decimal-corrupted pool reads produce absurd market
  // caps (the REAL BONK contract briefly mapped a $2.01T mcap next to $43M
  // of volume, out-money-ing the canonical CG listing 5000:1 and gaming
  // every "bigger token wins" heuristic downstream). A 9-figure mcap with
  // measured activity must be proportionate to it — otherwise zero the mcap
  // so ranking/dedup fall back to volume + liquidity. Identity rows without
  // activity data (CG/Spectre metadata rows) are left untouched.
  for (let i = 0; i < mapped.length; i++) {
    const mc = Number(mapped[i].marketCap) || 0;
    const activity = Math.max(Number(mapped[i].volume) || 0, Number(mapped[i].liquidity) || 0);
    if (mc >= 100_000_000 && activity > 0 && mc > 10_000 * activity) {
      mapped[i] = { ...mapped[i], marketCap: 0 };
    }
  }

  mapped.forEach(result => {
    // Backfill cgId by symbol ONLY for results without a contract address.
    // An address-resolved (on-chain) token is uniquely identified by its
    // contract, and its ticker can collide with a major coin — e.g. a Base
    // token "$DOT" at 0x23A2847d... is NOT Polkadot. Blindly mapping
    // symbol -> cgId there stamped cgId='polkadot' onto the on-chain token,
    // which made the router skip its contract-verification and open
    // /research-zone/polkadot. Leaving cgId null lets the degen router
    // (lookupCgByContract in app-shell) resolve the address to the real
    // token. Text/name searches (no address) keep the symbol fallback.
    if (!result.cgId && !result.address) {
      const symbol = (result.symbol || '').toUpperCase();
      const knownCgId = SYMBOL_TO_COINGECKO_ID[symbol];
      if (knownCgId) result.cgId = knownCgId;
    }
  });

  // Ticker bombs (2026-08-31): a Robinhood-chain joke token
  // (0xAE2Df3c1749d…) uses a concatenation of ~250 tickers as its SYMBOL —
  // "BTCETHUSDTBNBUSDCXRPSOLTRX…" — so it matches almost any query and its
  // symbol wrapped over five lines, painting straight through the price. No
  // real ticker needs 20 characters; past that it is a layout weapon, so the
  // row keeps its data and loses the tail. Display only — address, cgId and
  // codexId (what navigation actually uses) are untouched.
  // Its NAME is the same weapon at 4,000 characters ("Bitcoin Ethereum Tether
  // USDt BNB USDC XRP …"). CSS already clamps it to one line, but the raw
  // string is carried into selected-token state and written into the recents
  // localStorage entry, so it is capped here too. Both caps are symmetric
  // across lanes (every lane maps through this function), so the symbol|name
  // dedupe keys still agree.
  for (let i = 0; i < mapped.length; i++) {
    const sym = String(mapped[i].symbol || '');
    const name = String(mapped[i].name || '');
    if (sym.length > 20 || name.length > 60) {
      mapped[i] = {
        ...mapped[i],
        symbol: sym.length > 20 ? `${sym.slice(0, 20)}…` : mapped[i].symbol,
        name: name.length > 60 ? `${name.slice(0, 60)}…` : mapped[i].name,
      };
    }
  }

  // Ghost rows (2026-08-31): Spectre /v1/search answers a ticker prefix with
  // exchange listing artifacts — ETH-USDT, ETH3S, "ETHᅠ" (a unicode filler
  // char), ETHPRAGUE, ETHGAS, ETHER — carrying no price, no mcap, no volume,
  // no contract AND no CoinGecko id (measured on q=eth: 7 of 25 rows). They
  // render as a bare symbol with an empty right half and lead nowhere when
  // tapped: with neither a cgId nor an address there is nothing to open.
  // Missing market data alone is NOT the disqualifier — an identity row with
  // a cgId is legitimate and the surfaces' live-refresh fills its numbers in.
  // Missing data AND identity is.
  return mapped.filter((r) => r.cgId || r.address
    || (Number(r.price) || 0) > 0
    || (Number(r.marketCap) || 0) > 0
    || (Number(r.volume) || 0) > 0
    || (Number(r.liquidity) || 0) > 0);
}

export function _cacheSearchResults(key, data) {
  _searchCache.set(key, {
    data,
    ts: Date.now(),
    ttl: data && data.length > 0 ? SEARCH_CACHE_TTL : SEARCH_CACHE_EMPTY_TTL,
  });
  if (_searchCache.size > SEARCH_CACHE_MAX) {
    const firstKey = _searchCache.keys().next().value;
    _searchCache.delete(firstKey);
  }
}

/**
 * Prefetch popular search queries into cache (fire-and-forget on app mount).
 * Warms the cache so common searches are instant from the first keystroke.
 */
const _prefetchDone = { current: false };
export function prefetchPopularSearches() {
  if (_prefetchDone.current) return;
  _prefetchDone.current = true;
  // Keep the same source of truth as interactive search, but do less work:
  // only warm the highest-frequency symbols after first paint. The old 10-query
  // warmup made every route look like a search page to the backend.
  const queries = ['btc', 'eth', 'sol'];
  const missing = queries.filter(q => !_searchCache.has(q));
  if (missing.length === 0) return;

  const run = () => {
    // Use Spectre /v1/search via dynamic import to avoid a circular dep with services
    import('@/services/spectreMarketApi').then(({ getSpectreSearch }) => {
      missing.forEach(q => {
        getSpectreSearch(q, 10)
          .then(payload => {
            const mapped = _mapSearchApiResults(payload);
            if (mapped.length > 0) _cacheSearchResults(q, mapped);
          })
          .catch(() => {}); // silent warm cache
      });
    }).catch(() => {});
  };

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 250);
  }
}

// ─── Token details cache (for useTokenDetails) ──────────────────────────────
export const tokenDetailsCache = new Map();
export const CACHE_TTL = 10000; // 10s client cache - real-time price updates
