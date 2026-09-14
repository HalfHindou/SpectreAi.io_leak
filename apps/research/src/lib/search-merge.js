/**
 * Shared token-search merge pipeline.
 *
 * This logic used to live in FOUR near-copies (header.jsx getSearchResults,
 * welcome-page.jsx watchlist search, watchlists-page.jsx add-token search,
 * plus partial variants), and every scam-ranking / dedup fix had to be
 * hand-ported to each. This module is now the single implementation.
 *
 * Contract: operates on NUMERIC rows only — no display formatting. Callers
 * format (fmtLarge etc.) after the merge.
 *
 * Live row shape (what useTokenSearch returns):
 *   { symbol, name, logo, price, change, marketCap, volume, liquidity,
 *     address, networkId, network, cgId, codexId, tokenId, isMajor }
 * CG hit shape (what cgSearchService.getCgSearchHits returns):
 *   { symbol, name, price, change, marketCap, volume, image, cgId, rank }
 *
 * Output row extras: isMajor (major prepends), isCgCanonical (CG prepends),
 * plus `address`/`networkId`/`network` enriched onto CG prepends when a live
 * row folded into them.
 */

import { MAJOR_SYMBOLS, MAJOR_TOKEN_INFO, SYMBOL_TO_COINGECKO_ID, COINGECKO_LOGOS } from '@/constants/majorTokens';
import { chainToDisplayName } from '@/hooks/codex/_shared';

// Key normalizers — for COMPARISON ONLY, display keeps the raw value.
// On-chain tokens self-report "$"-prefixed tickers ("$PAAL") while CG lists
// the bare symbol ("PAAL"); raw-symbol keys made every dedup layer miss the
// same asset and search showed it twice.
export const normSym = (s) => String(s || '').toUpperCase().replace(/^\$+/, '');
export const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** EVM 0x-address or Solana base58 mint. */
export function isAddressQuery(q) {
  const s = String(q || '').trim();
  if (s.startsWith('0x') && s.length === 42) return true;
  return s.length >= 32 && s.length <= 44 && !s.startsWith('0x') && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

// Dust / scam filter: generated-looking symbols, rows with zero market data,
// and stat-fake clones (impossible mcap with zero real activity).
export function isDustRow(r) {
  const sym = String(r.symbol || '');
  const looksGenerated = /^[A-Z]+_[A-Z0-9]{5,}$/i.test(sym);
  const mc = Number(r.marketCap) || 0;
  const vol = Number(r.volume) || 0;
  const liq = Number(r.liquidity) || 0;
  const noData = mc === 0 && vol === 0 && liq === 0;
  // PALM $7T, PalmNads $10.55B class: huge claimed mcap, zero activity.
  // Real $100M+ tokens always have volume AND liquidity.
  const fakeMcap = mc >= 100_000_000 && vol === 0 && liq === 0;
  // Nothing legitimately exceeds $3T; BTC enters via the major prepend.
  const trillionScam = mc >= 3_000_000_000_000;
  // Wash pools (2026-08-31, the ENA/Ethena report): a farm of Solana "Ethena"
  // clones each claiming $756M-$9.2B of liquidity against $3.99 of 24h volume.
  // They clear fakeMcap (their LP is not zero) and credibleLive, then outrank
  // the real listing on every money-based signal. A pool holding real money
  // trades — judged on liquidity, never mcap (mcap describes the whole asset,
  // so a legitimate bridged row on a small venue must not read as washed).
  const washedPool = liq >= 1_000_000 && vol > 0 && vol < Math.max(1_000, liq * 0.0002);
  return looksGenerated || noData || fakeMcap || trillionScam || washedPool;
}

// Trust ranking for live/DEX rows: liquidity is the strongest signal, then
// volume; a claimed market cap only counts when the token shows real
// activity (otherwise a manipulated $900B mcap with $10 of volume outranks
// legit tokens with real LP). Mcap capped at $1T so absurd values can't
// dominate even for active rows.
export function trustScore(r) {
  const liq = Number(r.liquidity) || 0;
  const vol = Number(r.volume) || 0;
  const mc = Math.min(Number(r.marketCap) || 0, 1_000_000_000_000);
  const hasRealActivity = liq > 1_000 || vol > 10_000;
  return liq * 10 + vol + (hasRealActivity ? mc / 1000 : Math.min(mc, 1_000_000) / 1000);
}

// A live row credible enough to demote/escape a CG listing: real LP or volume.
const credibleLive = (r) => (Number(r.liquidity) || 0) > 1_000 || (Number(r.volume) || 0) > 10_000;
const liveMoney = (r) => Math.max(Number(r.marketCap) || 0, Number(r.volume) || 0, Number(r.liquidity) || 0);

/**
 * Build major-coin prepend rows for a query from MAJOR_SYMBOLS, merging live
 * market data (numeric). `marketBySym` is { SYM: { price, change, marketCap,
 * volume, image } } — the shape the surfaces keep in state.
 */
export function buildMajorMatches(query, marketBySym = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const sym of MAJOR_SYMBOLS) {
    const upper = sym.toUpperCase();
    const info = MAJOR_TOKEN_INFO[upper] || { symbol: upper, name: upper };
    const symMatch = upper.toLowerCase().includes(q);
    const nameMatch = (info.name || '').toLowerCase().includes(q);
    if (!symMatch && !nameMatch) continue;
    const live = marketBySym[upper] || null;
    out.push({
      symbol: upper,
      name: info.name || upper,
      // Live image (coin-images.coingecko.com) preferred over the hardcoded
      // assets.coingecko.com URL — the latter is the domain the PWA cache
      // once wedged on.
      logo: live?.image || COINGECKO_LOGOS[upper] || null,
      price: live?.price || 0,
      change: live?.change || 0,
      marketCap: live?.marketCap || 0,
      volume: live?.volume || 0,
      liquidity: 0,
      // Short display name ("ETH", not "ETHEREUM") — consistent with the
      // chain badges on live/DEX rows.
      network: chainToDisplayName(info.network) || info.network || null,
      networkId: info.networkId ?? null,
      address: info.address || null,
      cgId: SYMBOL_TO_COINGECKO_ID[upper] || null,
      codexId: info.address || null,
      tokenId: null,
      isMajor: true,
      isStock: false,
    });
  }
  return out;
}

/**
 * The canonical merge: majors first, then CG-canonical prepends, then
 * trust-ranked live/DEX rows, with same-asset folding and the stale-CG
 * demotion. Returns numeric rows.
 */
export function mergeTokenSearchResults({ query, majorRows = [], cgHits = [], liveRows = [] }) {
  const q = String(query || '').trim().toLowerCase();
  const addressQuery = isAddressQuery(query);

  // Codex returns "trending" majors for any query — require the symbol or
  // name to actually contain the query. Address queries match on the
  // contract instead (the resolved token's symbol/name don't contain the
  // pasted address).
  const matchesQuery = (r) => {
    if (addressQuery) return String(r.address || '').toLowerCase() === q;
    const sym = String(r.symbol || '').toLowerCase();
    const name = String(r.name || '').toLowerCase();
    return sym.includes(q) || name.includes(q);
  };

  const cleanLive = (liveRows || [])
    .filter((r) => r && !isDustRow(r) && matchesQuery(r))
    .sort((a, b) => trustScore(b) - trustScore(a));

  const majorSymSet = new Set(majorRows.map((m) => normSym(m.symbol)));

  // Majors NEVER take price/change/mcap/volume from live rows (Codex hits
  // wrapped or illiquid pools of the same ticker with garbage stats); they
  // only borrow a logo as a last-resort fallback.
  const liveBySym = new Map();
  for (const r of cleanLive) {
    const k = normSym(r.symbol);
    if (k && !liveBySym.has(k)) liveBySym.set(k, r);
  }
  const majorMerged = majorRows.map((m) => {
    const live = liveBySym.get(normSym(m.symbol));
    return live ? { ...m, logo: m.logo || live.logo } : m;
  });

  // CG-canonical prepends: CG-listed tokens matching the query that aren't
  // majors. They rank above Codex impostors.
  const cgPrepends = (cgHits || [])
    .filter((h) => !majorSymSet.has(normSym(h.symbol)))
    .map((h) => ({
      symbol: h.symbol,
      name: h.name,
      logo: h.image || h.logo || null,
      price: h.price,
      change: h.change,
      marketCap: h.marketCap,
      volume: h.volume,
      liquidity: 0,
      network: null,
      networkId: null,
      address: null,
      cgId: h.cgId,
      codexId: null,
      tokenId: null,
      rank: h.rank ?? null,
      isCgCanonical: true,
      isMajor: false,
      isStock: false,
    }));

  const cgPrependById = new Map();
  const cgPrependByKey = new Map(); // normSym|normName -> prepend
  const cgPrependBySym = new Map(); // normSym -> prepend
  for (const h of cgPrepends) {
    if (h.cgId && !cgPrependById.has(h.cgId)) cgPrependById.set(h.cgId, h);
    const key = `${normSym(h.symbol)}|${normName(h.name)}`;
    if (!cgPrependByKey.has(key)) cgPrependByKey.set(key, h);
    const sk = normSym(h.symbol);
    if (sk && !cgPrependBySym.has(sk)) cgPrependBySym.set(sk, h);
  }

  // Fold a live row into its CG prepend when they're the SAME asset (shared
  // cgId, same normalized symbol+name, or an address-less row sharing the
  // symbol), carrying the on-chain identity over so the merged row keeps a
  // chain badge, copyable contract and contract-verified navigation. CG
  // stats stay — they're the canonical read (Codex/DS mcap is often FDV).
  const enrichPrepend = (h, r) => {
    if (!h.address && r.address) {
      h.address = r.address;
      h.networkId = r.networkId ?? null;
      h.network = r.network || null;
      h.codexId = r.codexId || r.address;
    }
    if (!h.logo && r.logo) h.logo = r.logo;
  };
  const filteredLive = cleanLive.filter((r) => {
    const sym = normSym(r.symbol);
    if (majorSymSet.has(sym)) return false;
    const prepend = (r.cgId && cgPrependById.get(r.cgId))
      || cgPrependByKey.get(`${sym}|${normName(r.name)}`)
      || (!r.address ? cgPrependBySym.get(sym) : null);
    if (!prepend) return true;
    // Stale-CG escape (cash-cat class): a credible live token 10x the CG
    // listing's money means CG tracks a dead/migrated contract — keep the
    // live row separate; the stale prepend demotes below (guard next).
    // Only listings that LOOK dead (sub-$1M mcap, like cash-cat's $99) can
    // be escaped/demoted — a CG listing with a real market cap is never
    // outranked by a DEX read (corrupted pool mcaps gamed this).
    if ((Number(prepend.marketCap) || 0) < 1_000_000
      && credibleLive(r) && liveMoney(r) >= Math.max(Number(prepend.marketCap) || 0, 1) * 10) return true;
    enrichPrepend(prepend, r);
    return false;
  });

  // Stale-CG demotion: only a CREDIBLE live row (real LP or volume — a
  // fake-mcap clone with zero activity must not demote a real listing) with
  // >=10x the CG row's market cap pushes the CG prepend below the live rows.
  const staleCgPrepend = (h) => {
    const cgMc = Number(h.marketCap) || 0;
    // Dead-listing gate: only a sub-$1M CG mcap (cash-cat's $99) can demote.
    // A listing with a real market cap stays canonical no matter what the
    // DEX lanes claim.
    if (cgMc >= 1_000_000) return false;
    const sym = normSym(h.symbol);
    return filteredLive.some((r) => normSym(r.symbol) === sym
      && credibleLive(r)
      && Math.max(Number(r.marketCap) || 0, Number(r.volume) || 0) >= Math.max(cgMc, 1) * 10);
  };
  const freshPrepends = cgPrepends.filter((h) => !staleCgPrepend(h));
  const stalePrepends = cgPrepends.filter((h) => staleCgPrepend(h));

  return [...majorMerged, ...freshPrepends, ...filteredLive, ...stalePrepends];
}
