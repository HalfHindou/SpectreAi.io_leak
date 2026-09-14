import { useState, useEffect, useRef } from 'react';
import { getSpectreSearch } from '@/services/spectreMarketApi';
import { MAJOR_TOKEN_INFO } from '@/constants/majorTokens';
import {
  SEARCH_API_URL,
  SEARCH_MIN_QUERY_LENGTH,
  _searchCache,
  SEARCH_CACHE_TTL,
  _searchInflight,
  _getPrefixCached,
  _sortSearchResults,
  isWashedRow,
  _mapSearchApiResults,
  _cacheSearchResults,
  _addToTokenIndex,
  searchLocalTokenIndex,
  chainToDisplayName,
  isContractAddress,
} from './_shared';

// Instant-search pass (2026-07-07):
// - QUICK_LANE_DELAY_MS: the cheap Spectre lane (our own box, 30s edge cache)
//   fires after a short pause so first network rows paint while the user may
//   still be typing; the full composer round (billed Codex + CG + DexScreener
//   fan-out) keeps the longer debounce as cost defense.
// - COMPOSER_TIMEOUT_MS: a hung composer (degraded upstream used to hold the
//   merged set hostage for 12s+) now settles with whatever the Spectre leg
//   returned after this cap.
const QUICK_LANE_DELAY_MS = 150;
const COMPOSER_TIMEOUT_MS = 5000;

// Rows from the persistent local token index (2000-token LRU accumulated from
// past searches) — the zero-network instant layer. _score is internal.
function _localIndexRows(q) {
  return searchLocalTokenIndex(q, 10).map(({ _score, ...row }) => row);
}

/**
 * Hook for searching tokens via the /fetch_tokens proxy.
 * Uses a short-lived cache and in-flight request deduplication.
 */
// Debounce 800→450ms (2026-07-06): 800ms was the single biggest chunk of
// perceived search latency — the request didn't even START until nearly a
// second after the last keystroke. 450ms still coalesces normal typing;
// the server composer + edge cache absorb the extra misses.
export function useTokenSearch(query, debounceMs = 450) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const trimmedQuery = (query || '').trim();
  const tooShort = trimmedQuery.length > 0 && trimmedQuery.length < SEARCH_MIN_QUERY_LENGTH;

  useEffect(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();

    // Require 2+ chars: a single letter returns thousands of noisy matches
    // and generates one request per keystroke for no user benefit.
    if (!query || query.trim().length < SEARCH_MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const searchQuery = query.trim();
    const cacheKey = searchQuery.toLowerCase();
    setError(null);

    // Check exact cache first - instant return
    const cached = _searchCache.get(cacheKey);
    // Per-entry TTL: an empty answer expires in seconds, a real result set in
    // minutes (see SEARCH_CACHE_EMPTY_TTL).
    if (cached && (Date.now() - cached.ts) < (cached.ttl || SEARCH_CACHE_TTL)) {
      setResults(cached.data);
      setLoading(false);
      return;
    }

    // Show prefix-matched results immediately while fetching. When there's
    // no prefix match, fall back to the persistent local token index so any
    // token seen in a past search paints at KEYSTROKE time (zero network) —
    // only a truly never-seen query renders empty while loading. Stale rows
    // from an older query must never be visible under a new one; both layers
    // are filtered to the current query so that invariant holds.
    const prefixResults = _getPrefixCached(searchQuery);
    if (prefixResults && prefixResults.length > 0) {
      setResults(prefixResults);
    } else {
      setResults(_localIndexRows(searchQuery));
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Two-tier debounce: the quick Spectre lane fires after a short pause and
    // paints first network rows early; fetchV1Json's inflight+TTL dedup makes
    // the later full round reuse this same request, so it costs no extra call.
    let fullSettled = false;
    let quickTimer = null;
    if (!isContractAddress(searchQuery) && debounceMs > QUICK_LANE_DELAY_MS) {
      quickTimer = setTimeout(() => {
        getSpectreSearch(searchQuery, 25).then((quickPayload) => {
          if (fullSettled || controller.signal.aborted) return;
          const quick = _mapSearchApiResults({ coins: quickPayload?.coins || [] });
          if (quick.length > 0) setResults(_sortSearchResults(quick, searchQuery));
        }).catch(() => { /* quick lane is best-effort */ });
      }, QUICK_LANE_DELAY_MS);
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const inflightKey = cacheKey;
        const existing = _searchInflight.get(inflightKey);
        const p = existing || (() => {
          const fresh = (async () => {
            // Address paste lane. /api/token/details resolves a CA directly:
            // Solana is auto-detected server-side, but an EVM address with no
            // networkId is ALWAYS resolved as Ethereum (dev defaults
            // networkId=1, prod sends chain=ethereum) — so a Base / BSC /
            // Arbitrum token misses here by construction and only the composer
            // below finds it. Measured 2026-08-24 on Stockify (STFY, Base):
            // ?address= alone → degraded null, ?address=&networkId=8453 → full.
            //
            // This used to be AWAITED before the lanes below, so every
            // off-Ethereum paste paid ~650ms of guaranteed-miss latency before
            // the search that actually works even started. It is now one of the
            // parallel lanes: Ethereum + Solana keep the direct hit, everyone
            // else settles as fast as the composer answers.
            const addressLane = isContractAddress(searchQuery)
              ? (async () => {
                  const url = `/api/token/details?address=${encodeURIComponent(searchQuery)}`;
                  const r = await fetch(url, { signal: controller.signal });
                  if (!r.ok) return null;
                  const t = await r.json();
                  if (!t || !(t.address || t.symbol)) return null;
                  return {
                    ticker: t.symbol || '',
                    name: t.name || t.symbol || '',
                    contract_address: t.address || searchQuery,
                    chain: t.networkId != null ? String(t.networkId) : null,
                    price: t.price != null ? String(t.price) : null,
                    change: t.change24 != null ? String(t.change24) : null,
                    volume: t.volume24 != null ? String(t.volume24) : null,
                    liquidity: t.liquidity != null ? String(t.liquidity) : null,
                    market_cap: t.marketCap != null ? String(t.marketCap) : null,
                    logo: t.logo || null,
                    cg_id: null,
                  };
                })().catch(() => null) // a miss is the normal case, not a partial
              : Promise.resolve(null);

            // Two parallel sources:
            //   1. Spectre /v1/search — broad CoinGecko-indexed catalogue
            //   2. /api/search/tokens — composes CG /search + Codex filterTokens
            //                           + DexScreener (handler does the merging)
            // Run both unconditionally and merge; the previous "Spectre first,
            // fall back if empty" gate hid DEX-only tokens (e.g. DOGEOUS) whenever
            // Spectre returned even a single fuzzy match.
            const [addrRes, spectreRes, composerRes] = await Promise.allSettled([
              addressLane,
              getSpectreSearch(searchQuery, 25),
              // Capped: a hung composer (degraded upstream) settles this leg
              // as rejected after COMPOSER_TIMEOUT_MS instead of blocking the
              // merged set behind a 12s+ fetch — Spectre rows stand alone.
              Promise.race([
                (async () => {
                  const r = await fetch(
                    // SEARCH_API_URL already includes a ?v=N cache-buster — append with &
                    `${SEARCH_API_URL}&query=${encodeURIComponent(searchQuery)}`,
                    { signal: controller.signal }
                  );
                  if (!r.ok) throw new Error(`Search ${r.status}`);
                  return r.json();
                })(),
                new Promise((_, reject) => setTimeout(
                  () => reject(new Error('composer timeout')), COMPOSER_TIMEOUT_MS)),
              ]),
            ]);

            const spectreCoins = spectreRes.status === 'fulfilled'
              ? (spectreRes.value?.coins || []) : [];
            const composerRows = composerRes.status === 'fulfilled'
              ? (Array.isArray(composerRes.value)
                  ? composerRes.value
                  : (composerRes.value?.results || [])) : [];
            // The address row is an EXACT contract hit — it leads the composer
            // rows, and the address-keyed dedupe below folds the composer's own
            // row for the same token into it.
            const addrRow = addrRes.status === 'fulfilled' && addrRes.value
              ? [addrRes.value] : [];

            // Spectre rows first (canonical CG metadata), then composer rows
            // (which already include CG hits with prices + Codex DEX + DexScreener).
            // _mapSearchApiResults handles both shapes; we dedupe after mapping.
            // _partial: a leg failed (timeout/502/cooldown) — the caller shows
            // these rows but must NOT cache them for SEARCH_CACHE_TTL, or a
            // one-off blip would pin an incomplete list for 2 minutes.
            return {
              coins: spectreCoins,
              results: [...addrRow, ...composerRows],
              _partial: spectreRes.status !== 'fulfilled' || composerRes.status !== 'fulfilled',
            };
          })();
          _searchInflight.set(inflightKey, fresh);
          fresh.finally(() => _searchInflight.delete(inflightKey));
          return fresh;
        })();

        // Progressive first paint: Spectre /v1/search answers in ~50-300ms
        // while the composer fans out to CG+Codex+DexScreener (0.5-2s).
        // Paint the fast lane immediately; the full merged set replaces it
        // when the composer lands. Usually already done by the quick-lane
        // timer above; kept for consumers with debounceMs <= the quick delay.
        // fetchV1Json dedupes the underlying request, so no extra call.
        if (!isContractAddress(searchQuery)) {
          getSpectreSearch(searchQuery, 25).then((quickPayload) => {
            if (fullSettled || controller.signal.aborted) return;
            const quick = _mapSearchApiResults({ coins: quickPayload?.coins || [] });
            if (quick.length > 0) setResults(_sortSearchResults(quick, searchQuery));
          }).catch(() => { /* quick lane is best-effort */ });
        }

        const payload = await p;
        fullSettled = true;
        // Map each branch separately then merge: _mapSearchApiResults autodetects
        // the row shape but we want a deterministic order (Spectre first).
        const fromSpectre = _mapSearchApiResults({ coins: payload.coins || [] });
        const fromComposer = _mapSearchApiResults({ results: payload.results || [] });

        // Dedupe across sources. Spectre /v1/search returns identity-only rows
        // (no contract address, no price/mcap), while the composer returns
        // address-tagged DEX rows with full metrics. A naive key-by-address
        // would leave both visible. So:
        //   Pass 1 — index every row by address (when present) AND by
        //            symbol|name (always). One row can occupy two slots.
        //   Pass 2 — walk in source order; if an incoming row has no address
        //            but a previously-seen row matches by symbol|name AND has
        //            an address, merge into the addressed row and skip emit.
        // Math.max on numeric fields means whichever source knows the larger
        // non-zero value (price, mcap, volume, liquidity) wins on merge.
        // `incoming` is the authoritative row at both call sites (the later
        // source in the address dedupe, the fold WINNER below), so its number
        // stands and the other only fills a gap. This used to be Math.max,
        // which imported the CLONE's fabricated figures into the row that beat
        // it: the real Ethena row carried marketCap $18.9B (the wash clone's)
        // next to its own $1.48B, and "Ena coin" carried $1.9B against $70 of
        // volume. Nothing on screen showed it while the surfaces happened to
        // repaint from CoinGecko — but it is the number that ranks, that the
        // desktop and mobile lists then disagreed on, and that a tap carries.
        const pickNum = (fallback, preferred) => {
          const p = Number(preferred) || 0;
          return p > 0 ? p : (Number(fallback) || 0);
        };
        const merge = (existing, incoming) => ({
          ...existing,
          ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v != null && v !== '' && v !== 0)),
          price: pickNum(existing.price, incoming.price),
          marketCap: pickNum(existing.marketCap, incoming.marketCap),
          volume: pickNum(existing.volume, incoming.volume),
          liquidity: pickNum(existing.liquidity, incoming.liquidity),
          logo: existing.logo || incoming.logo,
          cgId: existing.cgId || incoming.cgId,
          address: existing.address || incoming.address,
          network: existing.network || incoming.network,
          networkId: existing.networkId ?? incoming.networkId,
        });
        // Normalize name so "Dogeus Maximus" / "DogeusMaximus" / "DOGEUS-MAXIMUS"
        // all hash to the same value (different sources do different casing /
        // punctuation for the same token).
        const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Strip the "$" ticker prefix for KEYS only (display keeps the raw
        // symbol): on-chain tokens self-report "$PAAL" while CG lists "PAAL" —
        // raw-symbol keys made the cross-source fold miss the same asset and
        // search showed it twice.
        const normSymbol = (s) => String(s || '').toUpperCase().replace(/^\$+/, '');
        const symNameKey = (r) => `${normSymbol(r.symbol)}|${normName(r.name)}`;
        // Dedupe order: address > symbol|name. Two rows with the SAME address
        // are definitely the same token. Two rows with the same symbol|name
        // are the same ONLY if at most one of them has an address (an identity
        // row vs an on-chain row). When both have addresses and they differ,
        // they are distinct multi-chain deployments — keep both.
        const byAddr = new Map();      // address → row
        const byIdentity = new Map();  // symbol|name → row (only used for rows lacking an address)
        const ordered = [];            // emit order; rows replaced via map mutation
        const placeIdx = new Map();    // row → index in `ordered` for in-place updates
        for (const r of [...fromSpectre, ...fromComposer]) {
          if (!r) continue;
          const aKey = r.address ? String(r.address).toLowerCase() : null;
          const snKey = symNameKey(r);

          // 1. Same contract address → guaranteed same token, merge.
          if (aKey && byAddr.has(aKey)) {
            const prev = byAddr.get(aKey);
            const merged = merge(prev, r);
            byAddr.set(aKey, merged);
            ordered[placeIdx.get(prev)] = merged;
            placeIdx.set(merged, placeIdx.get(prev));
            // The identity slot (if any) now points at the merged row.
            if (byIdentity.get(snKey) === prev) byIdentity.set(snKey, merged);
            continue;
          }

          // 2. Same symbol|name collision. Two cases:
          //    a) At most one row has an address → fold (identity row + DEX row
          //       for the same token, different shapes).
          //    b) Both have addresses → these are either multi-chain legit
          //       deployments (USDC-Polygon vs USDC-ETH) OR ghost-clones of a
          //       meme (DOGEUS on 4 Sui forks vs DOGEUS-ETH). Keep the row
          //       with the most data (mcap + volume + liquidity) and drop the
          //       lesser. This collapses the meme-clone case to one canonical
          //       row; for multi-chain assets the user lands on the highest-
          //       liquidity venue (the natural canonical pick).
          if (byIdentity.has(snKey)) {
            const prev = byIdentity.get(snKey);
            const prevHasAddr = !!prev.address;
            const incomingHasAddr = !!r.address;
            // Claimed money only counts when the pool actually trades. A wash
            // clone ("Ethena" on Solana: $18.9B mcap, $756M LP, $3.99 of 24h
            // volume) otherwise wins this comparison outright, takes over the
            // real row's slot and drops its cgId — which routes the tap to the
            // fake contract instead of Research Zone. Server-side search now
            // filters these, but rows also arrive from the Spectre lane and
            // from cached responses, so the fold must not trust a raw total.
            // isWashedRow (_shared.js) is the ONE definition, shared with the
            // ranking's size score and mirroring the server composer's filter.
            const dataScore = (x) => (isWashedRow(x)
              ? (Number(x.volume) || 0)
              : (Number(x.marketCap) || 0) + (Number(x.volume) || 0) + (Number(x.liquidity) || 0));
            if (!prevHasAddr || !incomingHasAddr || dataScore(r) > dataScore(prev) * 2 || dataScore(prev) > dataScore(r) * 2) {
              // Identity fold OR clear dominance — pick the richer row and
              // merge non-conflicting fields from the other.
              const winner = dataScore(r) >= dataScore(prev) ? r : prev;
              const loser = winner === r ? prev : r;
              let folded = merge(loser, winner); // winner wins on conflicts
              // The other direction of the same rule: when the WINNER is an
              // addressless CG-canonical row, merge()'s `existing || incoming`
              // hands it the LOSER's contract — that is how the real Bitcoin
              // row ended up wearing a TRON badge and a Tron contract (a
              // bridged/wrapped BTC row folded into it; the prices agree, so
              // no price check can catch it). An unverified contract on a
              // canonical row is a wrong CA to copy and a wrong token to seed
              // Research Zone with, so it stays addressless — the server grafts
              // the verified one from CoinGecko's platform record when there is
              // one, and RZ recovers it otherwise.
              if (!winner.address && winner.cgId) {
                folded = { ...folded, address: null, networkId: null, network: null, codexId: null }
              }
              // Identity must follow the WINNER. merge()'s explicit
              // `existing || incoming` fields were written for the
              // addressed-row + addressless-identity-row fold; in the
              // clone-dominance case (both addressed) they handed the merged
              // row the LOSER's address/network/logo — CASHCAT showed the
              // real Robinhood-chain token's stats wearing a Base clone's
              // address + BASE badge, and clicking navigated to the clone.
              if (winner.address) {
                folded = {
                  ...folded,
                  address: winner.address,
                  networkId: winner.networkId ?? null,
                  network: winner.network || null,
                  codexId: winner.codexId || winner.address || null,
                  logo: winner.logo || loser.logo || null,
                };
                // Inherit the loser's cgId only when it plausibly describes
                // the SAME asset: an addressless CG identity row of comparable
                // size. A stale CG listing tracking a dead/migrated contract
                // (cash-cat: $99 CG mcap vs the live $6.2M token) must not
                // hijack navigation to the dead page.
                const loserMcap = Number(loser.marketCap) || 0;
                const winnerMoney = Math.max(Number(winner.marketCap) || 0, Number(winner.liquidity) || 0, Number(winner.volume) || 0);
                folded.cgId = winner.cgId
                  || ((!loser.address && loserMcap >= winnerMoney / 10) ? loser.cgId : null);
              }
              const finalAddr = folded.address ? String(folded.address).toLowerCase() : null;
              byIdentity.set(snKey, folded);
              if (finalAddr) byAddr.set(finalAddr, folded);
              ordered[placeIdx.get(prev)] = folded;
              placeIdx.set(folded, placeIdx.get(prev));
              continue;
            }
            // Both addressed AND comparable data → genuine multi-chain.
            // Fall through to "new row" so both appear.
          }

          // 3. New row.
          placeIdx.set(r, ordered.length);
          ordered.push(r);
          if (aKey) byAddr.set(aKey, r);
          byIdentity.set(snKey, r);
        }
        // Backfill network from MAJOR_TOKEN_INFO for known coins (BTC, ETH, …)
        // so canonical assets always display their chain label, then dedupe
        // any final phantom entries (a row that was replaced mid-walk).
        const seen = new Set();
        const merged = ordered.filter((r) => {
          if (!r || seen.has(r)) return false;
          seen.add(r);
          return true;
        }).map((r) => {
          if (r.network) return r;
          const info = MAJOR_TOKEN_INFO[String(r.symbol || '').toUpperCase()];
          if (!info?.network) return r;
          return {
            ...r,
            network: chainToDisplayName(info.network) || info.network,
            networkId: info.networkId ?? r.networkId,
          };
        });

        const sorted = _sortSearchResults(merged, searchQuery);

        // Stale-listing demotion (2026-07-02): a CG/identity row tracking a
        // dead or migrated contract (cash-cat: the $99 CG listing shadowing
        // the live $6.2M Robinhood-chain token) must not outrank the live
        // asset. Within each symbol, if a CREDIBLE row (real LP or volume —
        // guards against $7T fake-mcap clones with zero activity) carries
        // >=10x another row's money, the shadowed row demotes below it.
        const money = (r) => Math.max(Number(r.marketCap) || 0, Number(r.volume) || 0, Number(r.liquidity) || 0);
        const credible = (r) => (Number(r.liquidity) || 0) > 1_000 || (Number(r.volume) || 0) > 10_000;
        const bestBySym = new Map();
        for (const r of sorted) {
          const k = normSymbol(r.symbol);
          if (!k) continue;
          const prev = bestBySym.get(k);
          if (!prev || money(r) > money(prev)) bestBySym.set(k, r);
        }
        const isShadowed = (r) => {
          // Dead-listing gate: only rows that LOOK dead (sub-$1M money, like
          // cash-cat's $99 CG listing) may be demoted — a listing with a
          // real market cap is never pushed below a DEX read (decimal-
          // corrupted pool mcaps were gaming this with fake $2T caps).
          if (money(r) >= 1_000_000) return false;
          const best = bestBySym.get(normSymbol(r.symbol));
          return !!best && best !== r && credible(best) && money(best) >= Math.max(money(r), 1) * 10;
        };
        const demoted = [...sorted.filter((r) => !isShadowed(r)), ...sorted.filter(isShadowed)];

        setResults(demoted);
        setLoading(false);
        setError(null);
        // Cache only complete rounds — partial results (a leg timed out or
        // failed) render but stay uncached so the next attempt retries fully.
        if (!payload._partial) _cacheSearchResults(cacheKey, demoted);
        // Accumulate into local token index for instant offline filtering next time
        _addToTokenIndex(demoted);
      } catch (err) {
        if (err.name === 'AbortError') {
          setLoading(false);
          return;
        }
        console.error('Token search failed:', err);
        // Keep the local layers visible when the API fails so the user still
        // sees something useful instead of "no results + red error".
        const prefix = _getPrefixCached(searchQuery);
        setResults(prefix && prefix.length > 0 ? prefix : _localIndexRows(searchQuery));
        setError(err.message);
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (quickTimer) clearTimeout(quickTimer);
    };
  }, [query, debounceMs]);

  return { results, loading, error, tooShort, minQueryLength: SEARCH_MIN_QUERY_LENGTH };
}
