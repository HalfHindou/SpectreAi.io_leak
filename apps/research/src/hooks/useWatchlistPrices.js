/**
 * Watchlist prices hook
 * Shared realtime pricing across watchlist surfaces
 *
 * Strategy:
 * - Major tokens (BTC, ETH, SOL, etc.): CoinGecko API (reliable, has 1W/1M/1Y) + Binance (real-time prices)
 * - On-chain tokens: Codex API (on-chain data, age, txns, makers)
 *
 * Refresh: 60 seconds for full data, 5 seconds for real-time prices
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDetailedTokenInfo, getDetailedTokenInfoBatch, searchTokens, getTokenPriceBySymbol } from '@/services/codexApi';
import { getMajorTokenPrices, getCoinGeckoPricesForSymbols, getCoinGeckoLongWindowsByContracts } from '@/services/coinGeckoApi';
import { getStockQuotes, getStockLogoUrl } from '@/services/stockApi';
import { getSpectreSearch, getSpectreTokenResolve } from '@/services/spectreMarketApi';
import { binancePricesStore } from '@/services/prices/sharedBinancePrices';
import { getDexScreenerTokens } from '@/services/dexscreenerApi';
import { isMajorToken, getMajorTokenAddress, usesCoinGecko, COINGECKO_LOGOS, MAJOR_TOKEN_INFO, SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens';
import { hasBinancePair } from '@/services/binanceCatalog';
import { isAppActive, subscribeActivity } from '@/lib/idleManager';
import { snapPeek, snapPut } from '@/lib/snapshotCache';

// 2026-06-02 cost defense: 60s -> 120s. Watchlist tokens are research-tier
// data (mcap, vol24, change) - users monitor over minutes/hours, not seconds.
// Combined with the existing isAppActive (5min idle pause) + document.hidden
// gates this halves the watchlist Codex contribution. Real-time price still
// streams via the Binance store - no UX regression on the price column.
const REFRESH_INTERVAL = 120 * 1000;
// Watchlist surface is a SCAN view, not a trade screen — Binance ticker at 5 s
// was the actual source of "flashing" numbers. 15 s feels live enough while
// removing the per-tick reflow of the whole 46-row table.
const REALTIME_INTERVAL = 15 * 1000;

// Dynamic symbol -> { cgId, address, networkId } resolver.
//
// Primary: same-origin Spectre search bridge. Token resolution now stays on
// the keyed bridge instead of relying on the older public /api/token/resolve.
const SESSION_RESOLVE_CACHE = new Map();
const LS_RESOLVE_KEY = 'spectre-cg-resolve-cache';
const LS_RESOLVE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// Phase J3: negative cache for FAILED symbol resolutions. The resolve chain
// ends in a Codex filterTokens(phrase:) per unresolved symbol; without this, a
// permanently-unresolvable ticker (CEX-only, delisted, typo) re-fired that
// Codex call on EVERY 60s watchlist refresh. We retry only after 10 min - long
// enough to stop the storm, short enough that a transient upstream blip self-heals.
const NEG_RESOLVE_TTL = 10 * 60 * 1000;
const FAILED_RESOLVE_CACHE = new Map(); // symbol -> timestamp of last failed resolve

function loadPersistedResolveCache() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(LS_RESOLVE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    const now = Date.now();
    for (const [sym, entry] of Object.entries(entries || {})) {
      if (!entry || (entry.ts && now - entry.ts > LS_RESOLVE_TTL)) continue;
      SESSION_RESOLVE_CACHE.set(sym, entry.data);
    }
  } catch { /* corrupt storage - ignore */ }
}
loadPersistedResolveCache();

function persistResolveEntry(sym, data) {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(LS_RESOLVE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    store[sym] = { data, ts: Date.now() };
    localStorage.setItem(LS_RESOLVE_KEY, JSON.stringify(store));
  } catch { /* quota / parse error - ignore */ }
}

// Pick the best CG search hit for a given symbol:
//  1. exact symbol match with a market_cap_rank → take the highest-ranked
//  2. exact symbol match without rank → first one
//  3. fallback: first coin in the result
function pickCgSearchMatch(sym, coins) {
  if (!Array.isArray(coins) || coins.length === 0) return null;
  const upper = sym.toUpperCase();
  const exact = coins.filter(c => (c.symbol || '').toUpperCase() === upper);
  const pool = exact.length > 0 ? exact : coins;
  const ranked = pool.filter(c => Number.isFinite(c.market_cap_rank));
  if (ranked.length > 0) {
    ranked.sort((a, b) => a.market_cap_rank - b.market_cap_rank);
    return ranked[0];
  }
  return pool[0];
}

async function resolveViaTokenResolve(sym) {
  try {
    const data = await getSpectreTokenResolve(sym);
    // Upstream sometimes returns {resolved: false, symbol} with no cgId - skip.
    if (data && (data.cgId || data.address)) return data;
    return null;
  } catch { return null; }
}

async function resolveViaCoinGeckoSearch(sym) {
  try {
    const json = await getSpectreSearch(sym, 10);
    const match = pickCgSearchMatch(sym, json?.coins);
    if (!match?.id && !match?.coingecko_id) return null;
    return { symbol: sym, cgId: match.coingecko_id || match.id, address: null, networkId: null };
  } catch { return null; }
}

// Tertiary resolver: Codex filterTokens by phrase. Catches DEX-only memecoins
// (KOL, SVPN, $WELF, etc.) that Spectre/CG search don't index but that exist
// on-chain with real liquidity. Picks the highest-liquidity match — symbol
// collisions across chains are real but the deepest pool is the canonical pick.
async function resolveViaCodexSearch(symbol) {
  try {
    const res = await fetch(`/api/codex?action=search&q=${encodeURIComponent(symbol)}&limit=10`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const rows = j?.results || j?.filterTokens?.results || [];
    const sym = String(symbol || '').toUpperCase();
    // Prefer exact symbol match with the highest liquidity.
    const exact = rows
      .filter(r => (r?.token?.symbol || '').toUpperCase() === sym && r?.token?.address)
      .sort((a, b) => (Number(b.liquidity) || 0) - (Number(a.liquidity) || 0))[0];
    const pick = exact || rows.find(r => r?.token?.address);
    if (!pick?.token?.address) return null;
    return {
      symbol: sym,
      cgId: null,
      address: pick.token.address,
      networkId: pick.token.networkId || 1,
    };
  } catch { return null; }
}

async function resolveSymbolsBatch(symbols) {
  // Only skip symbols that have a SUCCESSFUL resolution cached. Never cache
  // null/failed results — otherwise a single transient resolve failure
  // poisons the session and forces the symbol down the pure on-chain branch
  // for the rest of the tab's lifetime (e.g. PAAL stuck in On-Chain view).
  const now = Date.now();
  const unresolved = symbols.filter(s => {
    if (!s || SESSION_RESOLVE_CACHE.get(s)) return false;
    // Skip symbols that failed to resolve within the negative-cache window so a
    // permanently-unresolvable ticker doesn't re-fire the Codex resolve every 60s.
    const failedAt = FAILED_RESOLVE_CACHE.get(s);
    if (failedAt && now - failedAt < NEG_RESOLVE_TTL) return false;
    return true;
  });
  if (unresolved.length > 0) {
    await Promise.all(unresolved.map(async (sym) => {
      // Resolution chain: CG /search (canonical) → Spectre /v1/token/resolve
      // (broader) → Codex filterTokens (DEX-only longtail). The Codex fallback
      // is what unblocks rows like KOL that show $0 across the board because
      // they aren't indexed anywhere except on-chain DEXes.
      const primary = await resolveViaCoinGeckoSearch(sym);
      const data = primary || await resolveViaTokenResolve(sym) || await resolveViaCodexSearch(sym);
      if (data) {
        SESSION_RESOLVE_CACHE.set(sym, data);
        persistResolveEntry(sym, data);
        FAILED_RESOLVE_CACHE.delete(sym);
      } else {
        // Negative-cache the failure (timestamp) so the resolve chain - which
        // ends in a per-symbol Codex filterTokens - isn't re-run until the
        // NEG_RESOLVE_TTL window elapses. Retried after, never poisoned forever.
        FAILED_RESOLVE_CACHE.set(sym, Date.now());
      }
    }));
  }
  const out = {};
  for (const sym of symbols) out[sym] = SESSION_RESOLVE_CACHE.get(sym) || null;
  return out;
}

// Get logo for a token
const getLogoForToken = (symbol, apiLogo) => {
  if (apiLogo && !apiLogo.includes('placeholder')) return apiLogo;
  const upperSymbol = (symbol || '').toUpperCase();
  return COINGECKO_LOGOS[upperSymbol] || null;
};

export default function useWatchlistPrices(watchlist = []) {
  // PR-4 (perf): hydrate the last visit's price map so watchlist rows render
  // real numbers at first commit; the mount fetch refreshes them in place.
  const [liveData, setLiveData] = useState(() => {
    const snap = snapPeek('watchlist-prices');
    return snap?.data && typeof snap.data === 'object' ? snap.data : {};
  });
  const [realtimePrices, setRealtimePrices] = useState({});
  const [loading, setLoading] = useState(false);
  const lastUpdatedRef = useRef(null);

  // Get ALL crypto watchlist symbols for real-time updates.
  // 2026-06-03 perf fix: was filtering to ONLY major tokens (isMajorToken),
  // which meant long-tail tokens (memecoins, freshly-launched) had to wait
  // for the resolveSymbolsBatch chain (CG search → Spectre resolve → Codex
  // filterTokens, ~3-5s) BEFORE any price rendered. Now we subscribe every
  // non-stock crypto symbol to the shared Hetzner /v1/prices store which
  // returns 76ms regardless. Symbols Hetzner doesn't know are just
  // omitted from the result — no penalty.
  const watchlistSymbolsKey = watchlist?.map(t => t.symbol || '').join(',') || ''
  // Identity-aware key so the realtime subscription re-computes when a token's
  // cgId/address identity changes, not only when its symbol does.
  const watchlistRealtimeKey = watchlist?.map(t => `${(t.symbol || '').toUpperCase()}:${(t.cgId || t.address) ? 1 : 0}:${(t.isStock || t.assetClass === 'stock' || t.type === 'stock') ? 's' : 'c'}`).join(',') || ''
  const majorSymbolsInWatchlist = useMemo(() => {
    if (!watchlist) return [];
    return watchlist
      .filter(token => {
        // Stocks never get a Binance ticker — exclude them so we don't subscribe
        // AAPL/NVDA to the crypto realtime store (which would return nothing).
        if (token.isStock || token.assetClass === 'stock' || token.type === 'stock') return false;
        const sym = (token.symbol || '').toUpperCase();
        if (!sym) return false;
        // Only symbol-subscribe a token the SYMBOL unambiguously identifies.
        // The shared realtime store is symbol-keyed (/v1/prices?symbols= -> the
        // Hetzner ticker index), so a long-tail token pinned by a specific
        // cgId/address (PROS = Pharos, while the index returns "Prospective"
        // for the PROS ticker) would get the WRONG same-symbol price+logo and
        // override the identity-correct row ~1s after add. Majors / Binance
        // pairs are safe; identity-less legacy entries have nothing but symbol.
        if (isMajorToken(sym) || hasBinancePair(sym)) return true;
        return !token.cgId && !token.address;
      })
      .map(token => (token.symbol || '').toUpperCase())
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistRealtimeKey]);

  // Realtime price subscription wired into the shared Binance store so this
  // watchlist hook reuses the same fetch as the top-coins ticker, the inline
  // ticker bar, and any other consumer of `useBinanceTopCoinPrices`. We used
  // to spin our own 5s setInterval here, which meant every welcome-page mount
  // resulted in 2-3 parallel /api/binance-ticker calls for overlapping symbol
  // sets.
  const majorSymbolsKey = majorSymbolsInWatchlist.join(',')

  const fetchWatchlistData = useCallback(async () => {
    if (!watchlist || watchlist.length === 0) {
      setLiveData({});
      return;
    }

    setLoading(true);

    try {
      // Phase 0: split stocks out. Stock watchlist rows (isStock) MUST resolve
      // via the stocks API, never the crypto CG/Codex/DexScreener pipeline.
      // A stock ticker run through CG/Codex symbol-search binds to whatever
      // memecoin shares the ticker (e.g. an "AAPL"/"NVDA" pump.fun token at
      // ~$0 with a random tweet-image logo) — which is exactly the $0.000 /
      // wrong-logo rows seen in the watchlist. Keep them on the stock path.
      const isStockToken = (t) => !!(t && (t.isStock || t.assetClass === 'stock' || t.type === 'stock'));
      const stockTokens = watchlist.filter(isStockToken);
      const cryptoWatchlist = watchlist.filter(t => !isStockToken(t));

      // Phase 1: dynamically resolve any symbol that isn't in the hardcoded
      // CoinGecko map. Spectre resolve walks search results before dropping to
      // on-chain/Codex-only handling.
      // and returns { cgId, address, networkId } so we can route HYPE to
      // Hyperliquid, PI to Pi Network, CHIMP to its real on-chain address, etc.
      // Any wrong address cached in the user's watchlist entry gets overridden
      // by the canonical resolution.
      const symbolsNeedingResolve = [];
      for (const token of cryptoWatchlist) {
        const sym = (token.symbol || '').toUpperCase();
        // Only resolve symbols we can't already identify. Entries added from
        // search carry their own cgId/address (the exact token the user picked);
        // re-resolving by ticker returns the highest-market-cap-rank same-symbol
        // token, which on a collision (PROS = new Pharos vs old Prosper) is the
        // WRONG one. Hardcoded majors resolve via the static map.
        if (!sym) continue;
        if (SYMBOL_TO_COINGECKO_ID[sym]) continue;
        if (token.cgId || token.address) continue;
        symbolsNeedingResolve.push(sym);
      }
      const resolved = symbolsNeedingResolve.length > 0
        ? await resolveSymbolsBatch(symbolsNeedingResolve)
        : {};

      // Phase 2: split into buckets
      // - coinGeckoSymbols: symbol is in the hardcoded map
      // - dynamicCgTokens: symbol -> cgId resolved at runtime
      // - onChainTokens: fetch Codex details
      const coinGeckoSymbols = [];
      const dynamicCgTokens = {};
      const onChainTokens = [];

      cryptoWatchlist.forEach(token => {
        const symbol = (token.symbol || '').toUpperCase();
        const hardcodedCgId = SYMBOL_TO_COINGECKO_ID[symbol];
        const resolvedInfo = resolved[symbol] || null;
        const resolvedCgId = resolvedInfo?.cgId || null;
        const resolvedAddress = resolvedInfo?.address || null;
        const resolvedNetId = resolvedInfo?.networkId || null;
        const majorTokenAddress = getMajorTokenAddress(symbol);
        // GROUND TRUTH: an entry added from search stores the exact token it
        // identified (cgId and/or address). Price by THAT identity, never by
        // symbol-resolution - which returns the wrong same-symbol token on a
        // collision (PROS = new Pharos vs old Prosper, EITHER, etc.). Stored
        // identity takes priority over the resolved-by-ticker result below.
        const storedCgId = token.cgId || null;

        if (hardcodedCgId) {
          coinGeckoSymbols.push(symbol);
          const addr = token.address || majorTokenAddress;
          if (addr) {
            onChainTokens.push({
              ...token,
              address: addr,
              networkId: token.networkId || MAJOR_TOKEN_INFO[symbol]?.networkId || 1,
            });
          }
        } else if (storedCgId) {
          // Authoritative CoinGecko id from the user's search pick. Fetch the
          // exact coin by this id - do NOT symbol-resolve.
          dynamicCgTokens[symbol] = storedCgId;
          if (token.address) {
            onChainTokens.push({ ...token, address: token.address, networkId: token.networkId || 1 });
          }
        } else if (token.address) {
          // Authoritative on-chain address from the user's search pick (the
          // user pinned a SPECIFIC token; its address is ground truth).
          onChainTokens.push({ ...token, address: token.address, networkId: token.networkId || 1 });
        } else if (resolvedCgId) {
          // Legacy entry (symbol only, no stored identity) - fall back to the
          // resolved-by-ticker CoinGecko id. Dynamic CG-backed tokens (HYPE,
          // PI, PAAL). This is the only path that can pick a wrong same-symbol
          // token, and it now fires ONLY when the entry has no cgId/address.
          dynamicCgTokens[symbol] = resolvedCgId;
          if (resolvedAddress) {
            onChainTokens.push({
              ...token,
              address: resolvedAddress,
              networkId: resolvedNetId || token.networkId || 1,
            });
          }
        } else if (resolvedAddress) {
          // Legacy symbol-only entry that resolved to a pure on-chain token.
          onChainTokens.push({
            ...token,
            address: resolvedAddress,
            networkId: resolvedNetId || 1,
          });
        }
      });

      const newData = {};

      // Phase 2.5: STOCKS — one batched stocks-API call. Real prices, real
      // 24h change, real market cap + the correct per-ticker stock logo.
      // Keyed by symbol so the merge below (liveData[symbol]) picks it up.
      if (stockTokens.length > 0) {
        try {
          const stockSyms = stockTokens.map(t => (t.symbol || '').toUpperCase()).filter(Boolean);
          const quotes = await getStockQuotes(stockSyms);
          for (const t of stockTokens) {
            const sym = (t.symbol || '').toUpperCase();
            const q = quotes?.[sym];
            if (!q || !(Number(q.price) > 0)) continue;
            const chg = q.change != null ? Number(q.change) : 0;
            newData[sym] = {
              price: Number(q.price),
              change: chg,
              change5m: null,
              change1h: null,
              change6h: null,
              change24h: chg,
              change7d: null,
              change30d: null,
              change1y: null,
              volume: q.volume ?? 0,
              marketCap: q.marketCap ?? 0,
              liquidity: 0,
              logo: getStockLogoUrl(sym),
              sparkline_7d: null,
              isStock: true,
              // Routes taps to Research Zone and keeps the row out of the
              // on-chain branch; stocks are never DEX tokens.
              isMajor: true,
            };
          }
        } catch (_) {
          // Stocks fetch failed — leave them; the merge falls back to
          // last-known-good so prices don't flash to $0.
        }
      }

      // Phase 3: fetch CoinGecko prices (hardcoded + dynamic) in parallel
      const [cgStaticResult, cgDynamicResult] = await Promise.all([
        coinGeckoSymbols.length > 0
          ? getMajorTokenPrices(coinGeckoSymbols).catch(() => ({}))
          : Promise.resolve({}),
        Object.keys(dynamicCgTokens).length > 0
          ? getCoinGeckoPricesForSymbols(dynamicCgTokens).catch(() => ({}))
          : Promise.resolve({}),
      ]);
      const cgResult = { ...cgStaticResult, ...cgDynamicResult };
      const foundTokens = [];

      // Process CoinGecko results
      if (cgResult) {
        Object.entries(cgResult).forEach(([symbol, data]) => {
          newData[symbol] = {
            price: data.price,
            change: data.change,
            change5m: null,
            change1h: data.change1h ?? null,
            change6h: null,
            change24h: data.change,
            change7d: data.change7d || 0,
            change30d: data.change30d || 0,
            change1y: data.change1y || 0,
            volume: data.volume,
            marketCap: data.marketCap,
            liquidity: data.liquidity,
            logo: data.logo || COINGECKO_LOGOS[symbol],
            sparkline_7d: data.sparkline_7d || null,
            isMajor: true,
          };
        });
      }

      // Add found unknown tokens to on-chain list
      onChainTokens.push(...foundTokens);

      // 3-5. Fire all three on-chain enrichment batches IN PARALLEL.
      //
      // Codex details, DexScreener, and CG long-windows all key off the same
      // `onChainTokens` and never depend on each other's RESULT — only the
      // ORDER in which they're merged into `newData` matters (Codex base ->
      // DS override -> CG long-window fill). So we fetch concurrently (saves
      // ~2 round-trips per 120s refresh) but keep the three merge loops below
      // in their original sequential order.
      //
      // Each fetch carries its own error handling so one failing batch can't
      // blow up the others:
      //  - Codex/DS: the service calls already swallow/allSettle internally;
      //    we add a .catch fallback to a neutral empty result for safety.
      //  - CG long-windows: optional enrichment, .catch -> empty Map.
      let batchResults = new Map();
      let dsMap = {};
      let cgLongMap = new Map();
      if (onChainTokens.length > 0) {
        const addrNetPairs = onChainTokens.map(t => ({ address: t.address, networkId: t.networkId || 1 }));
        const [codexRes, dsRes, cgLongRes] = await Promise.all([
          getDetailedTokenInfoBatch(addrNetPairs).catch(() => new Map()),
          getDexScreenerTokens(onChainTokens.map(t => t.address)).catch(() => ({})),
          getCoinGeckoLongWindowsByContracts(addrNetPairs).catch(() => new Map()),
        ]);
        batchResults = codexRes instanceof Map ? codexRes : new Map();
        dsMap = dsRes || {};
        cgLongMap = cgLongRes instanceof Map ? cgLongRes : new Map();
      }

      // 3. Merge on-chain token data from Codex (base layer).
      if (onChainTokens.length > 0) {
        for (const token of onChainTokens) {
          const info = batchResults.get(token.address.toLowerCase());
          if (!info) continue;

          const addrKey = token.address.toLowerCase();
          const symKey = (token.symbol || '').toUpperCase();
          let ageDisplay = null;
          const ageDays = info.age ?? (info.createdAt ? Math.floor((Date.now() / 1000 - info.createdAt) / (60 * 60 * 24)) : null);
          if (ageDays != null && ageDays >= 0) {
            if (ageDays >= 365) ageDisplay = `${Math.floor(ageDays / 365)}y`;
            else if (ageDays >= 30) ageDisplay = `${Math.floor(ageDays / 30)}mo`;
            else ageDisplay = `${ageDays}d`;
          }

          const onChainFields = {
            txns: info.txnCount24 ?? 0,
            makers: info.uniqueWallets24 ?? 0,
            holders: info.holders ?? 0,
          };

          // If this token already has CoinGecko data, only merge supplementary on-chain fields
          // (skip age — Codex createdAt reflects DEX pair creation, not token launch)
          const existing = symKey ? newData[symKey] : null;
          if (existing?.isMajor) {
            Object.assign(existing, onChainFields);
            // For DEX-primary tokens (no Binance spot pair), Codex IS the
            // live truth — CoinGecko aggregates with delay and sometimes
            // shows the 24h LOW as "current price". Override CG price
            // with the live Codex price when we have one.
            const codexPrice = parseFloat(info.price);
            const hasCodexPrice = Number.isFinite(codexPrice) && codexPrice > 0;
            const isCexBacked = hasBinancePair(symKey);
            if (hasCodexPrice && !isCexBacked) {
              existing.price = codexPrice;
            }
            // Dynamic CG-backed tokens (e.g. PAAL, HYPE) sometimes come back with 0/null
            // 24h change because CoinGecko updates them slower than Codex. Prefer the
            // on-chain Codex change when CG's value is missing or exactly 0.
            const codexChange24 = parseFloat(info.change24);
            const codexChange1h = parseFloat(info.change1h);
            const hasCodexChange = Number.isFinite(codexChange24) && codexChange24 !== 0;
            const cgChange = existing.change24h ?? existing.change;
            if (hasCodexChange && (cgChange == null || cgChange === 0)) {
              existing.change = codexChange24;
              existing.change24h = codexChange24;
              if (Number.isFinite(codexChange1h) && codexChange1h !== 0) existing.change1h = codexChange1h;
            }
            // Same logic applied to price: if Codex differs from CG by >5%
            // for non-CEX tokens, take Codex (CG snapshot is stale).
            newData[addrKey] = existing;
          } else {
            const num = (v) => {
              const n = parseFloat(v)
              return Number.isFinite(n) ? n : null
            }
            const priceData = {
              price: parseFloat(info.price ?? 0) || 0,
              change: parseFloat(info.change24 ?? 0) || 0,
              change5m: null,
              change1h: num(info.change1h),
              change6h: null,
              change24h: parseFloat(info.change24 ?? 0) || 0,
              change7d: num(info.change7d),
              change30d: num(info.change30d),
              change1y: num(info.change1y ?? info.change365),
              volume: info.volume24 ?? 0,
              marketCap: info.marketCap ?? 0,
              liquidity: info.liquidity ?? 0,
              logo: info.logo || null,
              age: ageDisplay,
              ...onChainFields,
              isMajor: false,
            };
            newData[addrKey] = priceData;
            if (symKey) newData[symKey] = priceData;
          }
        }
      }

      // 4. DexScreener enrichment for on-chain tokens.
      //
      // Runs for EVERY on-chain token (not just Codex misses) because Codex
      // often returns unreliable `createdAt` for Solana pump.fun pairs — e.g.
      // XCHAT shows Codex-age "0d" while DS correctly reports pair age "1y".
      // DS's `pairCreatedAt` is the authoritative DEX-pair-creation timestamp,
      // and `txns.h24.buys + sells` is a real 24h trade count.
      //
      // Strategy:
      // - Codex data (price/volume/mcap/liquidity/holders/makers/1h change) stays primary.
      // - DS AGE overrides Codex age when available (Codex age is unreliable).
      // - DS TXNS overrides Codex txns when Codex returned 0 or null.
      // - DS 5m/6h changes fill in (Codex doesn't provide these).
      // - If Codex returned no price at all, DS becomes the sole data source.
      // `dsMap` was fetched above in the parallel batch. One server-cached
      // batch call (CSV up to 30 addresses) returns the most-liquid pair per
      // token plus the oldest pairCreatedAt across all pairs (so pump.fun →
      // Raydium migrations don't make tokens look "0d").
      if (onChainTokens.length > 0) {
        for (const token of onChainTokens) {
          const addrKey = (token.address || '').toLowerCase();
          const ds = dsMap[addrKey];
          if (!ds) continue;
          const symKey = (token.symbol || '').toUpperCase();

          let dsAgeDisplay = null;
          if (ds.pairCreatedAt) {
            const ageDays = Math.floor((Date.now() - ds.pairCreatedAt) / 86400000);
            if (ageDays >= 0) {
              if (ageDays >= 365) dsAgeDisplay = `${Math.floor(ageDays / 365)}y`;
              else if (ageDays >= 30) dsAgeDisplay = `${Math.floor(ageDays / 30)}mo`;
              else dsAgeDisplay = `${ageDays}d`;
            }
          }

          const existing = newData[addrKey] || (symKey ? newData[symKey] : null);
          if (existing?.price) {
            // Codex priced this token — enrich with DS fields only.
            // DS age overrides Codex (Codex `createdAt` is unreliable on
            // Solana pump.fun pairs). DS txns fill in when Codex returned 0.
            // DS 5m/6h changes always fill in (Codex doesn't provide these).
            if (dsAgeDisplay) existing.age = dsAgeDisplay;
            if (ds.txns24 > 0 && !existing.txns) existing.txns = ds.txns24;
            if (ds.change5m != null) existing.change5m = ds.change5m;
            if (ds.change6h != null) existing.change6h = ds.change6h;
            // Prefer the DexScreener-by-contract MCAP over Codex's: Codex/CG
            // often carry a stale or wrong circulating supply for fair-launch
            // on-chain tokens, so the price ticks live but the mcap is off —
            // ANSEM read $93M on a wrong ~413M supply vs the real ~1B → $221.7M;
            // SPECTRE lagged $3.71M vs $3.90M. DexScreener values it off the live
            // pool by contract. (The on-chain path is overwhelmingly fair-launch
            // tokens where FDV = mcap; vesting majors go via the CG-major path.)
            if (Number.isFinite(ds.marketCap) && ds.marketCap > 0) existing.marketCap = ds.marketCap;
            newData[addrKey] = existing;
            if (symKey) newData[symKey] = existing;
          } else if (ds.price > 0) {
            // Codex didn't price — DS becomes the sole source.
            const priceData = {
              price: ds.price,
              change: ds.change24h,
              change5m: ds.change5m,
              change1h: ds.change1h,
              change6h: ds.change6h,
              change24h: ds.change24h,
              volume: ds.volume24,
              marketCap: ds.marketCap,
              liquidity: ds.liquidity,
              logo: ds.logo,
              age: dsAgeDisplay,
              txns: ds.txns24 || null,
              makers: null,
              holders: null,
              isMajor: false,
            };
            newData[addrKey] = priceData;
            if (symKey) newData[symKey] = priceData;
          }
        }
      }

      // 5. CoinGecko long-window enrichment for on-chain tokens.
      //
      // Codex `filterTokens` only returns change1/4/12/24 — no 7d/30d/1y. For
      // address-pinned watchlist rows (DexScreener imports, on-chain search),
      // that left the 7D/30D/1Y columns permanently blank. CG /coins/{platform}/
      // contract/{address} has the long-window % for any token CG indexes.
      // `cgLongMap` was fetched above in the parallel batch (errors already
      // caught -> empty Map). Only the change windows + sparkline are merged —
      // price/mcap/vol stay sourced from Codex/DS (more real-time).
      if (onChainTokens.length > 0 && cgLongMap.size > 0) {
        for (const token of onChainTokens) {
          const addrKey = (token.address || '').toLowerCase();
          const long = cgLongMap.get(addrKey);
          if (!long) continue;
          const symKey = (token.symbol || '').toUpperCase();
          const existing = newData[addrKey] || (symKey ? newData[symKey] : null);
          if (!existing) continue;
          if (long.change7d != null) existing.change7d = long.change7d;
          if (long.change30d != null) existing.change30d = long.change30d;
          if (long.change1y != null) existing.change1y = long.change1y;
          if (long.sparkline_7d && !existing.sparkline_7d) existing.sparkline_7d = long.sparkline_7d;
          newData[addrKey] = existing;
          if (symKey) newData[symKey] = existing;
        }
      }

      setLiveData(prev => {
        const merged = { ...prev, ...newData };
        // PR-4 (perf): persist the merged price map (minus bulky sparklines)
        // so the watchlist renders real prices at first commit next visit.
        try {
          const slim = {};
          for (const [k, v] of Object.entries(merged)) {
            if (!v || typeof v !== 'object') continue;
            const { sparkline_7d, ...rest } = v;
            slim[k] = rest;
          }
          snapPut('watchlist-prices', slim);
        } catch (_) { /* never break the merge for a cache write */ }
        return merged;
      });
      lastUpdatedRef.current = Date.now();
    } catch (err) {
      console.error('Failed to fetch watchlist prices:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistSymbolsKey]);

  useEffect(() => {
    fetchWatchlistData();
    const interval = setInterval(() => {
      // Skip when the tab is hidden OR the user has gone idle (visible-but-
      // abandoned tab). Each tick is a Codex details-batch; idle tabs left open
      // were a named cost driver. See lib/idleManager.js.
      if (document.hidden || !isAppActive()) return;
      fetchWatchlistData();
    }, REFRESH_INTERVAL);
    // Refresh once the moment the user comes back from idle (no stale-data UX).
    const unsubscribeActivity = subscribeActivity((active) => {
      if (active && !document.hidden) fetchWatchlistData();
    });
    return () => { clearInterval(interval); unsubscribeActivity(); };
  }, [fetchWatchlistData]);

  // Real-time price updates via the shared Binance store. The store dedupes
  // overlapping symbols across all subscribers and pauses on tab visibility
  // hidden, so we don't need our own setInterval or document.hidden guard.
  useEffect(() => {
    if (!majorSymbolsKey) {
      setRealtimePrices({})
      return undefined
    }
    const ourSymbols = majorSymbolsKey.split(',')
    const wanted = new Set(ourSymbols)
    // Throttle so the watchlist doesn't re-render on every Binance tick.
    // Binance can fire 3-5×/s across 40+ symbols; with React.memo + sparkline
    // memoisation the cost per row is small, but the SUMMARY + heat strip
    // still recompute on every parent setState, which the user perceived as
    // "glitching". 2 s is the longest delay where the row still feels alive.
    const THROTTLE_MS = 2000
    let pendingPrices = null
    let lastFlush = 0
    let flushTimer = null
    const flush = () => {
      if (!pendingPrices) return
      const incoming = pendingPrices
      pendingPrices = null
      lastFlush = Date.now()
      flushTimer = null
      setRealtimePrices((prev) => {
        let changed = false
        const next = { ...prev }
        for (const sym of wanted) {
          const nw = incoming[sym]
          if (!nw) continue
          const old = prev[sym]
          if (!old || old.price !== nw.price || old.change !== nw.change) {
            next[sym] = nw
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
    const handler = (allPrices) => {
      pendingPrices = allPrices
      const now = Date.now()
      const since = now - lastFlush
      if (since >= THROTTLE_MS) {
        flush()
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, THROTTLE_MS - since)
      }
    }
    const unsubscribe = binancePricesStore.subscribe(ourSymbols, REALTIME_INTERVAL, handler)
    return () => {
      unsubscribe?.()
      if (flushTimer) clearTimeout(flushTimer)
    }
  }, [majorSymbolsKey]);

  // Merge live data with watchlist tokens (including real-time prices)
  // Last-known-good cache per symbol|address. When a refresh cycle returns
  // null/empty for any field, fall back to the previous good value so the
  // UI doesn't flicker fields in and out. Survives across the hook's render
  // cycles. Cleared only when the symbol leaves the watchlist.
  const lastGoodRef = useRef(new Map());

  const watchlistWithLiveData = useMemo(() => {
    if (!watchlist) return [];

    return watchlist.map((token) => {
      const symbol = (token.symbol || '').toUpperCase();
      const addrKey = token.address?.toLowerCase();
      const goodKey = addrKey || symbol;
      const prevGood = lastGoodRef.current.get(goodKey) || {};

      // Check for data by symbol (majors) or address (on-chain)
      const data = liveData[symbol] || (addrKey ? liveData[addrKey] : null);

      // Get real-time price from the shared symbol-keyed store - but ONLY for a
      // token the SYMBOL unambiguously identifies. For an identity-pinned
      // long-tail token (cgId/address, e.g. PROS = Pharos) the store returns the
      // WRONG same-symbol token (the Hetzner ticker index resolves PROS to
      // "Prospective" $0.0223), so consulting it would override the
      // identity-correct `data` row ~1s after add. Majors / Binance pairs are
      // safe; identity-less legacy entries have nothing but the symbol anyway.
      const isSymbolSafe = isMajorToken(symbol) || hasBinancePair(symbol) || (!token.cgId && !token.address);
      // Skip realtime rows the store flagged stale (Hetzner ingester stall
      // with no live CG/Binance re-source) - otherwise a frozen "realtime"
      // price outranks the fresher Codex/DexScreener-enriched `data` below.
      const realtimeRow = isSymbolSafe ? realtimePrices[symbol] : null;
      const realtime = realtimeRow && !realtimeRow.stale ? realtimeRow : null;

      // If neither current data nor realtime, render last-known-good
      // (so fields don't disappear during a transient refresh failure).
      if (!data && !realtime) {
        if (prevGood.price || prevGood.marketCap || prevGood.logo) {
          return { ...token, ...prevGood, hasLiveData: true, _stale: true };
        }
        return {
          ...token,
          logo: getLogoForToken(token.symbol, token.logo),
          // isMajor MUST be set even on the empty first-render shell.
          // Otherwise downstream (header search ordering, resolveRouteMode
          // for click navigation) treats the token as on-chain for the
          // ~60s until the first refresh resolves it, mis-routing BTC/ETH
          // clicks to the on-chain token chart instead of Research Zone.
          isMajor: isMajorToken(symbol),
          hasLiveData: false,
        };
      }

      // 1W backfill: when no change7d is available from CG/Codex but we DO
      // have a sparkline_7d (168 hourly points = exactly 7 days), compute
      // the change ourselves from first-vs-last price.
      const spark = data?.sparkline_7d;
      let computed7d = null;
      if (data?.change7d == null && Array.isArray(spark) && spark.length >= 2) {
        const first = Number(spark[0]);
        const last = Number(spark[spark.length - 1]);
        if (first > 0 && Number.isFinite(last)) {
          computed7d = ((last - first) / first) * 100;
        }
      }

      // Merge with last-known-good as a backstop: if current refresh has
      // null where we previously had a value, keep the previous value. This
      // is what kills the "data sometimes appears, sometimes doesn't" UX —
      // upstream blips no longer null out fields.
      const pick = (current, fallback) => (current != null && current !== '' && current !== 0)
        ? current
        : (fallback != null ? fallback : current);

      const next = {
        ...token,
        price: (realtime?.price > 0 ? realtime.price : null) ?? data?.price ?? prevGood.price ?? token.price,
        // 2026-06-03 watchlist audit: realtime (Hetzner /v1/prices) now wins
        // for change too. Previously realtime was Binance-only (no change for
        // DEX tokens), so DEX rows fell to data?.change which was often a
        // different source (DexScreener, Codex) with a different number.
        // PALM showed -0.14% in UI vs Hetzner's -11.95% for 24h. Fixed.
        change: realtime?.change ?? data?.change ?? prevGood.change ?? token.change,
        change5m: pick(data?.change5m, prevGood.change5m),
        change1h: pick(realtime?.change1h ?? data?.change1h, prevGood.change1h),
        change6h: pick(data?.change6h, prevGood.change6h),
        change24h: realtime?.change24 ?? realtime?.change ?? data?.change24h ?? data?.change ?? prevGood.change24h ?? token.change24h ?? token.change,
        change7d: pick(realtime?.change7d ?? data?.change7d ?? computed7d, prevGood.change7d),
        change30d: pick(realtime?.change30d ?? data?.change30d, prevGood.change30d),
        change1y: pick(realtime?.change1y ?? data?.change1y, prevGood.change1y),
        sparkline_7d: data?.sparkline_7d || prevGood.sparkline_7d || null,
        volume: realtime?.volume ?? data?.volume ?? prevGood.volume ?? token.volume,
        marketCap: realtime?.marketCap ?? data?.marketCap ?? prevGood.marketCap ?? token.marketCap,
        liquidity: realtime?.liquidity ?? data?.liquidity ?? prevGood.liquidity ?? token.liquidity,
        // Logo: prefer realtime (Hetzner) image first - it's the freshest source
        // for memecoins where stale localStorage token.logo or empty data.logo
        // would otherwise render the letter fallback.
        logo: getLogoForToken(token.symbol, realtime?.image || data?.logo || prevGood.logo || token.logo),
        age: data?.age ?? prevGood.age,
        txns: data?.txns ?? prevGood.txns,
        makers: data?.makers ?? prevGood.makers,
        holders: data?.holders ?? prevGood.holders,
        // isMajor: stable per-token. Once a token resolves through CG (data
        // .isMajor: true), it stays Major across subsequent refreshes via
        // lastGoodRef even if a single fetch cycle returns no data. This kills
        // the random toggle behavior (token jumping between Major and On-Chain
        // depending on which upstream resolved first).
        isMajor: data?.isMajor ?? prevGood.isMajor ?? isMajorToken(symbol),
        hasLiveData: true,
      };

      // Persist last-known-good for next render (includes isMajor so the flag
      // never flips back to false on a transient null fetch).
      lastGoodRef.current.set(goodKey, {
        price: next.price, change: next.change, change5m: next.change5m,
        change1h: next.change1h, change6h: next.change6h, change24h: next.change24h,
        change7d: next.change7d, change30d: next.change30d, change1y: next.change1y,
        sparkline_7d: next.sparkline_7d, volume: next.volume, marketCap: next.marketCap,
        liquidity: next.liquidity, logo: next.logo, age: next.age, txns: next.txns,
        makers: next.makers, holders: next.holders, isMajor: next.isMajor,
      });

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist, watchlistSymbolsKey, liveData, realtimePrices]);

  return {
    watchlistWithLiveData,
    liveData,
    loading,
    lastUpdated: lastUpdatedRef.current,
    refresh: fetchWatchlistData,
  };
}
