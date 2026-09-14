import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getTrendingTokens,
  getNetworkName,
} from '@/services/codexApi';
import { getSpectreMarketTrending, getSpectreMarketTrendingTiered } from '@/services/spectreMarketApi';
import { fetchGtScreenerRows, GT_ONLY_NETWORKS } from '@/services/geckoTerminalApi';
import {
  ALL_NETWORKS,
  trendingCache,
  TRENDING_CACHE_TTL,
} from './_shared';

const VALID_TIERS = new Set(['majors', 'sub500m', 'sub50m', 'social', 'onchain']);

// Chains Codex cannot screen at all (Robinhood Chain, networkId 4663). Codex
// returns an EMPTY result for them rather than an error, so before this split
// a Robinhood selection rendered "no tokens" forever. GeckoTerminal indexes the
// chain from day one, so those networkIds route there instead.
const GT_ONLY_IDS = new Set(Object.keys(GT_ONLY_NETWORKS).map(Number));
const splitNetworks = (nets) => {
  const gt = [];
  const codex = [];
  for (const n of nets || []) (GT_ONLY_IDS.has(Number(n)) ? gt : codex).push(Number(n));
  return { gt, codex };
};

// CEX-dominant majors that pollute On-Chain trending — they belong in the Top
// Coins tab, not on a DEX-trending list. Stripped from every source.
const ONCHAIN_BLACKLIST_SYMBOLS = new Set(['BTC', 'ETH', 'USDT', 'USDC', 'BNB']);

function applyTierClientFilter(rows, tier) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  switch (tier) {
    case 'majors':
      return rows.filter((r) => (Number(r.marketCap) || 0) >= 500_000_000);
    case 'sub500m':
      return rows.filter((r) => {
        const m = Number(r.marketCap) || 0;
        return m > 0 && m < 500_000_000;
      });
    case 'sub50m':
      return rows.filter((r) => {
        const m = Number(r.marketCap) || 0;
        return m > 0 && m < 50_000_000;
      });
    case 'social':
      // No social signal on Codex DEX data — sort by 24h volume as a proxy
      return [...rows].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    case 'onchain':
    default:
      return rows;
  }
}

function formatCodexResult(result, index) {
  const change24 = parseFloat(result.change24) || 0;
  const volume24 = parseFloat(result.volume ?? result.volume24) || 0;
  const mcap = parseFloat(result.marketCap) || 0;
  const liq = parseFloat(result.liquidity) || 0;
  const netId = result.token?.networkId || 1;
  return {
    symbol: (result.token?.symbol || 'UNKNOWN').toUpperCase(),
    name: result.token?.name || 'Unknown Token',
    address: result.token?.address || '',
    networkId: netId,
    network: getNetworkName(netId),
    price: parseFloat(result.priceUSD) || 0,
    change: change24,
    change5m: parseFloat(result.change5m) || 0,
    change1h: parseFloat(result.change1) || 0,
    change4h: parseFloat(result.change4) || 0,
    change12h: parseFloat(result.change12) || 0,
    change24h: change24,
    volume24h: volume24,
    volume: volume24,
    // Liquidity fallback to volume when Codex returns 0 — gives a sane number to display
    liquidity: liq > 0 ? liq : volume24,
    marketCap: mcap,
    mcap,
    holders: Number(result.holders) || 0,
    logo: result.token?.info?.imageThumbUrl || result.token?.info?.imageSmallUrl || null,
    rank: index + 1,
    sparkline_7d: Array.isArray(result.sparkline_7d) ? result.sparkline_7d : null,
    _source: result._source || 'codex',
  };
}

// GeckoTerminal screener row -> the same shape formatCodexResult produces, so
// a Robinhood row is indistinguishable from a Codex row downstream.
function formatGtRow(row, index) {
  const volume24 = Number(row.volume24) || 0;
  return {
    symbol: (row.symbol || 'UNKNOWN').toUpperCase(),
    name: row.name || row.symbol || 'Unknown Token',
    address: row.address || '',
    networkId: row.networkId || 4663,
    network: getNetworkName(row.networkId || 4663),
    price: Number(row.price) || 0,
    change: Number(row.change) || 0,
    change5m: Number(row.change5m) || 0,
    change1h: Number(row.change1h) || 0,
    change4h: Number(row.change4h) || 0,
    change12h: 0,
    change24h: Number(row.change) || 0,
    volume24h: volume24,
    volume: volume24,
    // Real pooled depth from GT - never the volume-as-liquidity stand-in the
    // CG-tiered feed uses, which would make every thin runner look tradable.
    liquidity: Number(row.liquidity) || 0,
    marketCap: Number(row.marketCap) || 0,
    mcap: Number(row.marketCap) || 0,
    holders: 0,
    txns: Number(row.txns) || 0,
    createdAt: row.createdAt || null,
    poolCount: Number(row.poolCount) || 0,
    safety: row.safety || null,
    cgId: row.cgId || null,
    logo: row.logo || null,
    rank: index + 1,
    sparkline_7d: null,
    _source: 'geckoterminal',
  };
}

function formatSpectreCgRow(row, index) {
  const change24 = parseFloat(row.price_change_percentage_24h ?? row.change24h ?? 0) || 0;
  const volume24 = parseFloat(row.total_volume ?? row.volume24h ?? 0) || 0;
  const mcap = parseFloat(row.market_cap ?? row.marketCap ?? 0) || 0;
  return {
    symbol: (row.symbol || '').toUpperCase() || 'UNKNOWN',
    name: row.name || 'Unknown Token',
    address: row.address || '',
    networkId: row.networkId || 1,
    network: getNetworkName(row.networkId || 1),
    price: parseFloat(row.current_price ?? row.price ?? 0) || 0,
    change: change24,
    change5m: 0,
    change1h: parseFloat(row.price_change_percentage_1h_in_currency ?? 0) || 0,
    change4h: 0,
    change12h: 0,
    change24h: change24,
    volume24h: volume24,
    volume: volume24,
    liquidity: volume24,
    marketCap: mcap,
    mcap,
    logo: row.image || row.logo || null,
    rank: index + 1,
    sparkline_7d: row.sparkline_in_7d?.price || null,
    _source: 'spectre-cg',
  };
}

/**
 * Hook for fetching trending/top tokens
 *
 * PRIMARY: Codex DEX `getTrendingTokens(networkIds, limit)` from codexApi.js.
 *   - Native chain filtering via networkIds.
 *   - Real DEX trending with granular change windows (5m/1h/4h/12h/24h),
 *     volume, liquidity, market cap, holders.
 *   - Internally cascades through Spectre Onchain Data Bridge (ETH/BSC) →
 *     Codex GraphQL (other chains) → Spectre market fallback.
 *
 * FALLBACK: Spectre tiered/legacy CG feed — used only if Codex returns nothing.
 *
 * Tier pills filter the Codex result client-side (mcap bands, volume sort).
 * Blacklist removes BTC/ETH/USDT/USDC/BNB from every source.
 */
export function useTrendingTokens(networkIds, tier, { enabled = true } = {}) {
  const nets = networkIds || ALL_NETWORKS;
  const safeTier = VALID_TIERS.has(tier) ? tier : null; // null = legacy aggregated path
  const networksKey = `${[...nets].sort((a, b) => a - b).join(',')}|${safeTier || 'all'}`;

  const [tokens, setTokens] = useState(() => {
    const cached = trendingCache.get(networksKey);
    return (cached && Date.now() - cached.timestamp < TRENDING_CACHE_TTL) ? cached.data : [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = trendingCache.get(networksKey);
    return !(cached && Date.now() - cached.timestamp < TRENDING_CACHE_TTL);
  });
  const [error, setError] = useState(null);
  const activeKeyRef = useRef(networksKey);
  activeKeyRef.current = networksKey;

  const fetchTokens = useCallback(async () => {
    const requestKey = networksKey;
    try {
      let allFormatted = [];

      // Route by tier: Codex DEX is only correct for the `onchain` tier (and
      // when tier is null = legacy aggregated). For majors/sub500m/sub50m/social
      // we go straight to Spectre's CG-backed tiered feed — the previous
      // Codex-first/Spectre-fallback path double-fetched on every render and
      // dropped majors entirely because Codex DEX has no large-cap rows.
      const useCodexPrimary = safeTier === 'onchain' || safeTier === null;

      // GT-only chains ride alongside (or instead of) Codex. On a single-chain
      // Robinhood selection this IS the feed; inside a multi-chain "All" set its
      // rows are merged into the Codex board so HOOD runners stop being invisible
      // on the default view.
      const { gt: gtNets, codex: codexNets } = splitNetworks(nets);
      let gtRows = [];
      if (useCodexPrimary && gtNets.length > 0) {
        const settled = await Promise.allSettled(
          gtNets.map((id) => fetchGtScreenerRows(id, { kind: 'top' }))
        );
        for (const s2 of settled) {
          if (s2.status === 'fulfilled') gtRows = gtRows.concat(s2.value || []);
          else console.warn('[trending] GeckoTerminal failed:', s2.reason?.message);
        }
      }

      if (!useCodexPrimary) {
        try {
          const cgTrending = await getSpectreMarketTrendingTiered(safeTier, 50);
          if (Array.isArray(cgTrending) && cgTrending.length > 0) {
            allFormatted = cgTrending.map((row, i) => formatSpectreCgRow(row, i));
          }
        } catch (err) {
          console.warn('[trending] Spectre tiered failed:', err.message);
        }
      }

      // Codex pass — primary for on-chain, fallback for everything else.
      if (allFormatted.length === 0 && codexNets.length > 0) {
        try {
          const data = await getTrendingTokens(codexNets, 100);
          const results = Array.isArray(data?.filterTokens?.results) ? data.filterTokens.results : [];
          const formatted = results
            .filter((r) => r?.token?.symbol)
            .map((r, i) => formatCodexResult(r, i));
          if (formatted.length > 0) {
            allFormatted = applyTierClientFilter(formatted, safeTier);
          }
        } catch (err) {
          console.warn('[trending] Codex trending failed:', err.message);
        }
      }

      // Last-resort Spectre legacy aggregated feed if both upstreams returned
      // nothing (network outage, etc). Never when a GT chain already has rows:
      // on a Robinhood-only selection Codex is skipped by design, and pouring a
      // generic CG board in here would bury the chain the user actually picked.
      if (allFormatted.length === 0 && gtRows.length === 0) {
        try {
          const cgTrending = await getSpectreMarketTrending(50);
          if (Array.isArray(cgTrending) && cgTrending.length > 0) {
            allFormatted = cgTrending.map((row, i) => formatSpectreCgRow(row, i));
          }
        } catch (err) {
          console.warn('[trending] Spectre legacy fallback failed:', err.message);
        }
      }

      // Fold in the GeckoTerminal chains. Sorting by 24h volume keeps the
      // merged board honest: a HOOD row earns its place next to a Codex row on
      // the same measure instead of being appended to the tail.
      if (gtRows.length > 0) {
        const gtFormatted = gtRows.map((r, i) => formatGtRow(r, i));
        allFormatted = allFormatted.length === 0
          ? gtFormatted
          : [...allFormatted, ...gtFormatted].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
      }

      // CEX-dominant majors belong in the Top Coins tab, not On-Chain
      // trending. Strip them from every source after the primary/fallback
      // pipeline, then rerank so visible row numbers stay 1..N.
      //
      // Dedupe by contract first. The upstreams genuinely repeat rows - the
      // Spectre market fallback returned the SAME 0G contract 19 times - and a
      // repeated row is not just noise: the table keys its <div> on the address,
      // so duplicate keys break React reconciliation and leave orphaned rows
      // from the previous chain sitting under the new one (a Robinhood-only
      // board rendering 93 rows for a 38-row dataset).
      const seenRow = new Set();
      allFormatted = allFormatted
        .filter((t) => !ONCHAIN_BLACKLIST_SYMBOLS.has(String(t.symbol || '').toUpperCase()))
        .filter((t) => {
          const k = `${t.networkId || 0}:${String(t.address || t.symbol || '').toLowerCase()}`;
          if (seenRow.has(k)) return false;
          seenRow.add(k);
          return true;
        })
        .map((t, i) => ({ ...t, rank: i + 1 }));

      if (allFormatted.length > 0) {
        trendingCache.set(requestKey, { data: allFormatted, timestamp: Date.now() });
        if (activeKeyRef.current === requestKey) {
          setTokens(allFormatted);
          setError(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch trending tokens:', err);
      if (activeKeyRef.current === requestKey) setError(err.message);
    } finally {
      if (activeKeyRef.current === requestKey) setLoading(false);
    }
  }, [networksKey, safeTier]);

  useEffect(() => {
    if (!enabled) return;
    const cached = trendingCache.get(networksKey);
    if (cached && Date.now() - cached.timestamp < TRENDING_CACHE_TTL) {
      setTokens(cached.data);
      setLoading(false);
      return;
    }
    // Clear stale tokens so the loading skeleton renders on chain switch
    setTokens([]);
    setLoading(true);
    fetchTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networksKey, enabled]);

  return { tokens, loading, error, refresh: fetchTokens };
}
