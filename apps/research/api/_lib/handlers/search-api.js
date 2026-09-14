/**
 * Vercel Serverless – Search routes handler.
 * Handles /api/search/* via vercel.json rewrites:
 *   /api/search/trending  -> /api/search-api?route=trending
 *   /api/search/tokens    -> /api/search-api?route=tokens&q=...
 *   /api/search/whisper   -> /api/search-api?route=whisper
 *   POST /api/search      -> /api/search-api (default)
 */

import { contractFromPlatforms } from '../cg-platforms.js';
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js';

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';
const CODEX_API_KEY = process.env.CODEX_API_KEY || '';
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';

// L4-PR2 (2026-06-03): Hetzner /v1/search as a parallel source. For text
// queries the composer can skip the Codex filterTokens(phrase:) call when
// Hetzner returns a healthy result set. Codex filterTokens hits the
// listPairsWithMetadataForToken lockstep bill (~27% of total Codex spend),
// so every text query we serve from Hetzner saves both the phrase op and
// the lockstep op. Codex still fires for raw addresses and as a fallback.
const SPECTRE_API_BASE_HOST = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850';
const SPECTRE_DATA_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';
const SPECTRE_SEARCH_TIMEOUT_MS = 800;
const _L4_PR2_DISABLE_HETZNER_SEARCH = process.env.L4_PR2_DISABLE_HETZNER_SEARCH === '1';

// CG-listed token -> its OWN verified contract, per CoinGecko's platform
// record. cg-platforms.js states the rule this implements: "the verified CG
// platform record is the contract AUTHORITY for CG-listed tokens - never a
// ticker-keyed search guess (the clone class)". Search used to graft whatever
// contract the matching DEX row carried; measured 2026-08-31 that stamped
// Wormhole-wrapped Solana addresses on BNB/ADA/AVAX/ARB/AAVE and a $16k Tron
// pool on ETH.
//
// Platforms never change, so this is cached hard: per-instance map + KV for
// 30 days, and a coin CG has no contract for (BTC, SOL, XRP, native L1s)
// caches its `null` too. Cost is one lightweight CG call per coin per month,
// paid only for rows a DEX row actually collapsed into (0-3 per query).
const _cgPlatformMem = new Map(); // cgId -> { address, networkId } | null
const CG_PLATFORM_KV_TTL = 30 * 24 * 3600;

async function cgCanonicalContract(cgId, cgHeaders) {
  if (!cgId) return null;
  if (_cgPlatformMem.has(cgId)) return _cgPlatformMem.get(cgId);
  const kvKey = `search:cgplat:v1:${cgId}`;
  try {
    const hit = await getJsonWithTTL(kvKey);
    if (hit !== null && hit !== undefined) {
      const val = hit.address ? hit : null;
      _cgPlatformMem.set(cgId, val);
      return val;
    }
  } catch (_) { /* KV is best effort */ }
  const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(cgId)}`
    + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false';
  const resp = await fetch(url, { headers: cgHeaders, signal: AbortSignal.timeout(2500) }).catch(() => null);
  // A failed lookup is not a verdict - leave it uncached so the next request
  // retries, and let the caller fall back to its heuristics.
  if (!resp || !resp.ok) return undefined;
  const profile = await resp.json().catch(() => null);
  if (!profile) return undefined;
  const val = contractFromPlatforms(profile);
  _cgPlatformMem.set(cgId, val);
  try { await setJsonWithTTL(kvKey, val || { address: null }, CG_PLATFORM_KV_TTL); } catch (_) { /* noop */ }
  return val;
}

function _isContractAddress(q) {
  if (!q) return false;
  if (q.startsWith('0x') && q.length === 42) return true;
  // Base58 charset check (matches the client's isContractAddress) — without
  // it any 32-44 char word counted as an "address" and skipped the cheap
  // Hetzner probe straight into the billed Codex path.
  if (!q.startsWith('0x') && q.length >= 32 && q.length <= 44
    && /^[1-9A-HJ-NP-Za-km-z]+$/.test(q)) return true;
  return false;
}

async function _fetchSpectreSearchComposer(q) {
  if (_L4_PR2_DISABLE_HETZNER_SEARCH) return null;
  try {
    const params = new URLSearchParams({ q, limit: '15' });
    const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/search?${params}`, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SPECTRE_SEARCH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const json = await r.json();
    const coins = json?.data?.coins || json?.coins || [];
    if (!Array.isArray(coins) || coins.length === 0) return null;
    return coins;
  } catch (_) {
    return null;
  }
}

const TRENDING = [
  { title: 'Top gainers last 24h', category: 'MARKETS', icon: 'fire', query: 'Top gaining crypto tokens in the last 24 hours with volume over $1M' },
  { title: 'Whale wallet movements', category: 'ON-CHAIN', icon: 'whale', query: 'Largest crypto whale wallet movements and transfers today' },
  { title: 'New Solana token launches', category: 'DISCOVERY', icon: 'listing', query: 'New Solana tokens launched in the last 48 hours with growing volume' },
  { title: 'ETH gas tracker', category: 'TOOLS', icon: 'volume', query: 'Current Ethereum gas prices and network congestion status' },
  { title: 'Undervalued DeFi gems', category: 'ALPHA', icon: 'sparkles', query: 'Undervalued DeFi protocols with growing TVL and low market cap' },
  { title: 'Institutional flows today', category: 'SMART MONEY', icon: 'bank', query: 'Institutional crypto fund flows and BTC ETF inflows/outflows today' },
];

function normalizeFetchTokensResults(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.tokens)) return payload.tokens;
  return [];
}

function buildTokenSearchResponse(query, {
  results = [],
  error = null,
  cached = false,
  stale = false,
  upstreamStatus = null,
} = {}) {
  return {
    query,
    results,
    error,
    meta: {
      source: 'fetch_tokens',
      minQueryLength: 2,
      cached,
      stale,
      upstreamStatus,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const route = req.query.route || '';

  // --- /api/search/trending ---
  if (route === 'trending') {
    // L4-PR7: trending list is a static constant in this stub - safe to edge-
    // cache for 5 min. CDN-Cache-Control beats Cache-Control on Vercel's edge
    // for cookie-bearing responses (auth-gate cookie was making this endpoint
    // bypass the edge cache for logged-in users).
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
    return res.status(200).json(TRENDING);
  }

  // --- /api/search/tokens?q=... ---
  if (route === 'tokens') {
    const q = req.query.query || req.query.q || '';
    if (!q) {
      return res.status(400).json(buildTokenSearchResponse('', {
        error: 'Missing query parameter',
      }));
    }
    try {
      const cgHeaders = { accept: 'application/json' };
      if (COINGECKO_API_KEY) cgHeaders['x-cg-pro-api-key'] = COINGECKO_API_KEY;

      // Latency shape (2026-07-06): the pipeline used to run the Hetzner
      // probe SERIALLY before the fan-out (≤800ms dead time), then the CG
      // /coins/markets enrichment and the Codex backfill serially after it.
      // Now every lane starts immediately and chains its own follow-up:
      //   CG lane:    /search → /coins/markets       (pipelined)
      //   Codex lane: Hetzner probe → filterTokens → backfill
      //               (probe still gates Codex — L4-PR2 cost defense: skip
      //               the billed phrase+lockstep ops when Hetzner has ≥3
      //               healthy results for a text query)
      //   DS lane:    /search
      // Total = slowest lane instead of probe + slowest + enrich + backfill.
      const looksLikeAddress = _isContractAddress(q);

      const cgLane = (async () => {
        const cgResp = await fetch(`${COINGECKO_BASE}/search?query=${encodeURIComponent(q)}`,
          { headers: cgHeaders, signal: AbortSignal.timeout(3500) }).catch(() => null);
        const cgData = cgResp && cgResp.ok ? await cgResp.json().catch(() => null) : null;
        const coins = Array.isArray(cgData?.coins) ? cgData.coins.slice(0, 12) : [];
        // Enrich with prices + 1h/24h change via /coins/markets.
        const priceMap = new Map();
        if (coins.length) {
          const ids = coins.map(c => c.id).filter(Boolean).join(',');
          const mUrl = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&price_change_percentage=1h,24h&sparkline=false`;
          const mResp = await fetch(mUrl, { headers: cgHeaders, signal: AbortSignal.timeout(4000) }).catch(() => null);
          if (mResp && mResp.ok) {
            const arr = await mResp.json().catch(() => null);
            if (Array.isArray(arr)) for (const m of arr) priceMap.set(m.id, m);
          }
        }
        return { coins, priceMap };
      })();

      const codexLane = (async () => {
        const spectreCoins = looksLikeAddress ? null : await _fetchSpectreSearchComposer(q);
        const skipCodex = !looksLikeAddress
          && Array.isArray(spectreCoins)
          && spectreCoins.length >= 3;
        if (skipCodex) return { skipped: true, results: [], backfill: new Map() };
        const codexResp = await fetch('https://graph.codex.io/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
          body: JSON.stringify({
            // change24 is a plain result field (same class as change1/change4,
            // NOT the billed pair-aggregation fields volume24/liquidity/
            // marketCap that LEVER 3 backfills). It was missing from the
            // query, so the mapper's `r.change24` was always undefined and
            // every Codex row showed its 4-HOUR change labeled as 24h.
            query: `query Search($q: String!, $lim: Int) { filterTokens(phrase:$q,limit:$lim,rankings:[{attribute:liquidity,direction:DESC}]) { results { token { name symbol address networkId info { imageThumbUrl } } priceUSD change1 change4 change24 } } }`,
            variables: { q, lim: 12 },
          }),
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);
        const codexJson = codexResp && codexResp.ok ? await codexResp.json().catch(() => null) : null;
        const results = codexJson?.data?.filterTokens?.results || [];
        // LEVER 3 (2026-06-02): backfill the dropped volume24/liquidity/
        // marketCap fields from cg:snap -> /v1/coins/markets -> /v1/scanner.
        // Fail-soft per token; nulls tolerated downstream.
        let backfill = new Map();
        if (results.length) {
          try {
            const mod = await import('../spectre-data.js').catch(() => null);
            if (mod?.getMarketDataForAddresses) {
              const inputs = results
                .filter((r) => r?.token?.address && r?.token?.networkId)
                .map((r) => ({ address: r.token.address, networkId: r.token.networkId }));
              backfill = await mod.getMarketDataForAddresses(inputs).catch(() => new Map());
            }
          } catch (_) { /* helper unavailable - codex rows degrade to nulls */ }
        }
        return { skipped: false, results, backfill };
      })();

      const dsLane = (async () => {
        const dsResp = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
          { signal: AbortSignal.timeout(3000) }).catch(() => null);
        const dsJson = dsResp && dsResp.ok ? await dsResp.json().catch(() => null) : null;
        return Array.isArray(dsJson?.pairs) ? dsJson.pairs : [];
      })();

      const [cgOut, codexOut, dsPairs] = await Promise.all([cgLane, codexLane, dsLane]);
      const cgCoins = cgOut.coins;
      const priceMap = cgOut.priceMap;
      const skipCodex = codexOut.skipped;
      const codexResults = codexOut.results;
      const codexBackfill = codexOut.backfill;

      const cgTokens = cgCoins
        .map((c) => {
          const m = priceMap.get(c.id) || {};
          return {
            ticker: (c.symbol || '').toUpperCase(),
            name: c.name || '',
            contract_address: null,
            chain: null,
            price: m.current_price != null ? String(m.current_price) : null,
            change_1h: m.price_change_percentage_1h_in_currency != null ? String(m.price_change_percentage_1h_in_currency) : null,
            change: m.price_change_percentage_24h != null ? String(m.price_change_percentage_24h) : null,
            volume: m.total_volume != null ? String(m.total_volume) : null,
            market_cap: m.market_cap != null ? String(m.market_cap) : null,
            logo: c.large || m.image || c.thumb || null,
            cg_id: c.id || null,
            token_id: null,
            codex_id: null,
          };
        })
        // Drop CG dust forks (no mcap data in /coins/markets means CG hasn't indexed them).
        .filter(t => Number(t.market_cap || 0) > 0);

      // Wash-pool guard (2026-08-31, the ENA/Ethena report). DexScreener's
      // search for "ethena" answers with a farm of Solana clones all named
      // "Ethena" claiming $756M-$9.2B of liquidity and an $18.9B market cap
      // against $3.99 of 24h volume. The money floors below pass them
      // trivially, and every downstream money-based rank (server collapse,
      // the client's clone-dominance fold, mcap tie-break) then puts the
      // clone ABOVE the real CoinGecko row - so tapping "Ethena" opened a
      // fake contract in the trading terminal.
      // The tell is not the absolute number, it is turnover: a pool holding
      // real money trades. Judged on LIQUIDITY only - market cap describes the
      // whole asset, not this pool, so a legitimate bridged row (Ethena USDe
      // on TON: $4.1B asset cap, a $205k pool doing $23k/day) would fail an
      // mcap-based test. Only pools >= $1M are judged, and only when a 24h
      // volume is actually reported (a null volume is missing data, not
      // evidence of fraud - the Codex lane's backfill is fail-soft).
      const MIN_TURNOVER_RATIO = 0.0002; // 0.02% of pool liquidity per day
      const hasPlausibleTurnover = (t) => {
        const liq = Number(t.liquidity) || 0;
        if (liq < 1_000_000) return true;
        if (t.volume == null) return true;
        return Number(t.volume) >= Math.max(1_000, liq * MIN_TURNOVER_RATIO);
      };

      const dexTokens = codexResults
        .filter((r) => r?.token?.address && r?.token?.networkId)
        .map((r) => {
          // LEVER 3: pull volume/liquidity/marketCap from helper backfill.
          const bf = codexBackfill.get((r.token.address || '').toLowerCase()) || {};
          return {
            ticker: (r.token.symbol || '').toUpperCase(),
            name: r.token.name || '',
            contract_address: r.token.address,
            chain: String(r.token.networkId),
            price: r.priceUSD != null ? String(r.priceUSD) : null,
            change_1h: r.change1 != null ? String(r.change1) : null,
            change: r.change24 != null ? String(r.change24) : (r.change4 != null ? String(r.change4) : null),
            volume: bf.volume24 != null ? String(bf.volume24) : null,
            liquidity: bf.liquidity != null ? String(bf.liquidity) : null,
            market_cap: bf.marketCap != null ? String(bf.marketCap) : null,
            logo: r.token?.info?.imageThumbUrl || null,
            cg_id: null,
            token_id: null,
            codex_id: `${r.token.address}:${r.token.networkId}`,
          };
        })
        // Filter Codex noise: keep any token with real money (mcap, volume, OR
        // liquidity). Loosened 2026-05-28 from $50K mcap floor — was hiding
        // legitimate new launches like DOGEOUS (low mcap, real LP).
        .filter(t => Number(t.market_cap || 0) > 25_000 || Number(t.volume || 0) > 5_000 || Number(t.liquidity || 0) > 5_000)
        .filter(hasPlausibleTurnover);

      // DexScreener: dedupe pairs to one row per base token (highest-liquidity
      // pair wins). Map chain slugs to Codex networkIds where possible.
      const DS_CHAIN_TO_NETWORK_ID = {
        ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, base: 8453,
        avalanche: 43114, optimism: 10, fantom: 250, solana: 1399811149,
        robinhood: 4663,
      };
      const dsByToken = new Map();
      for (const p of dsPairs) {
        const addr = p?.baseToken?.address;
        if (!addr) continue;
        const key = `${(p.chainId || '').toLowerCase()}:${addr.toLowerCase()}`;
        const liq = Number(p?.liquidity?.usd) || 0;
        const prev = dsByToken.get(key);
        if (!prev || liq > Number(prev?.liquidity?.usd || 0)) dsByToken.set(key, p);
      }
      const dsTokens = Array.from(dsByToken.values())
        .map((p) => {
          const networkId = DS_CHAIN_TO_NETWORK_ID[(p.chainId || '').toLowerCase()] || null;
          return {
            ticker: (p.baseToken?.symbol || '').toUpperCase(),
            name: p.baseToken?.name || p.baseToken?.symbol || '',
            contract_address: p.baseToken?.address || null,
            chain: networkId ? String(networkId) : (p.chainId || null),
            price: p.priceUsd != null ? String(p.priceUsd) : null,
            change_1h: p?.priceChange?.h1 != null ? String(p.priceChange.h1) : null,
            change: p?.priceChange?.h24 != null ? String(p.priceChange.h24) : null,
            volume: p?.volume?.h24 != null ? String(p.volume.h24) : null,
            liquidity: p?.liquidity?.usd != null ? String(p.liquidity.usd) : null,
            market_cap: (p.marketCap || p.fdv) != null ? String(p.marketCap || p.fdv) : null,
            logo: p.info?.imageUrl || null,
            cg_id: null,
            token_id: null,
            codex_id: networkId && p.baseToken?.address ? `${p.baseToken.address}:${networkId}` : null,
          };
        })
        .filter(t => t.contract_address)
        .filter(t => Number(t.liquidity || 0) > 5_000 || Number(t.volume || 0) > 5_000)
        .filter(hasPlausibleTurnover);

      // Dedupe across sources: prefer CG hit (canonical metadata) > Codex (full
      // metrics) > DexScreener (longtail). Key on lowercased contract address;
      // CG rows have no address so they key on cg_id and never collide.
      const seenAddrs = new Set();
      const dedupedDex = [];
      for (const t of [...dexTokens, ...dsTokens]) {
        const k = (t.contract_address || '').toLowerCase();
        if (!k || seenAddrs.has(k)) continue;
        seenAddrs.add(k);
        dedupedDex.push(t);
      }
      // 2026-06-10: CG rows carry no contract, so the address dedupe above
      // can't collapse a CG hit with its own Codex/DS row — search showed
      // ANYONE twice with conflicting 24h%. Same ticker + substring-related
      // names ("ANyONe Protocol" vs Codex's "Anyone") is the same asset; the
      // CG row (canonical id, slug nav) wins. Unrelated names sharing a
      // ticker ("Chat with Anyone") survive as distinct results.
      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      // Strip the "$" prefix on-chain tickers self-report ("$PAAL" vs CG's
      // "PAAL") — a raw `===` on tickers made this collapse miss the same
      // asset and the client received it twice with conflicting stats.
      const normTicker = (s) => String(s || '').toUpperCase().replace(/^\$+/, '');
      const cgRows = cgTokens.map((t) => ({ ticker: normTicker(t.ticker), name: norm(t.name), mcap: Number(t.market_cap) || 0, src: t }));
      // Stale-CG guard (2026-07-02, found via Robinhood Chain launch): CG's
      // listing can track a dead/migrated contract (cash-cat: CG mcap ~$99 vs
      // the live $4.6M DEX token on Robinhood Chain) — collapsing the live DEX
      // row into it served users the corpse. Only collapse when the CG listing
      // is at least a comparable-size asset (>= 1/10th of the DEX row's money);
      // otherwise keep BOTH rows so the live token stays findable.
      const moneyOf = (t) => Math.max(Number(t.market_cap) || 0, Number(t.liquidity) || 0, Number(t.volume) || 0);
      const findCgRow = (t) => {
        const dn = norm(t.name);
        const tk = normTicker(t.ticker);
        const match = cgRows.find((c) => c.ticker === tk
          && (c.name === dn || (dn && c.name.includes(dn)) || (c.name && dn.includes(c.name))));
        if (!match) return null;
        return match.mcap >= moneyOf(t) / 10 ? match : null;
      };
      const crossDeduped = [];
      const graftCandidates = new Map(); // CG row -> the DEX row that vouched for it
      for (const t of dedupedDex) {
        const match = findCgRow(t);
        if (!match) { crossDeduped.push(t); continue; }
        // Collapsed into the CG row — backfill the on-chain identity the CG
        // shape lacks so the client keeps a chain badge, copyable contract
        // and contract-verified navigation on the canonical row.
        //
        // The DEX row's own contract is NOT that identity. It matched on
        // ticker+name, which a clone wears for free (the ENA report:
        // DexScreener's best-funded "Ethena" on Solana is HKcn49jf…, priced
        // 16% off CG's ENA and absent from CG's platform list, whose real
        // Solana deployment is 72QvBVwp…) — and even an honest match is
        // usually a WRAPPED deployment, not the asset (measured 2026-08-31:
        // Solana-wrapped BNB/ADA/AVAX/ARB/AAVE, a $16k Tron pool on ETH).
        // So the contract comes from CoinGecko's own platform record below;
        // this row only decides WHETHER the canonical row gets one at all.
        //
        // Two local conditions gate that, so a clone can't trigger a lookup
        // that then dresses the row up:
        //   price  - a real deployment of a listed asset is arbitraged to
        //            within a few percent of the listing price;
        //   depth  - and it is a venue that matters for that asset. Clones
        //            are cheap to seed at the right price; not to fund.
        // When either fails the row stays identity-only and navigation falls
        // back to the CG id, which is always correct — Research Zone recovers
        // the verified contract from CoinGecko's platform record anyway.
        const cgPrice = Number(match.src.price) || 0;
        const dexPrice = Number(t.price) || 0;
        const priceAgrees = cgPrice > 0 && dexPrice > 0
          && Math.max(cgPrice, dexPrice) / Math.min(cgPrice, dexPrice) <= 1.10;
        const deepEnough = Number(t.liquidity || 0)
          >= Math.max(100_000, (Number(match.src.market_cap) || 0) * 0.0005);
        const sameAsset = priceAgrees && deepEnough;
        const cg = match.src;
        if (sameAsset && !cg.contract_address && !graftCandidates.has(cg)) graftCandidates.set(cg, t);
        // Liquidity rides on the same confirmation: an unconfirmed row's LP is
        // some other token's pool ($125.7M of clone liquidity was showing on
        // the canonical ENA row).
        if (sameAsset && cg.liquidity == null && t.liquidity != null) cg.liquidity = t.liquidity;
      }
      // One CG platform lookup per candidate row (cached hard, see
      // cgCanonicalContract). A miss or a failed lookup leaves the row
      // identity-only, which is the safe outcome — never the DEX guess.
      await Promise.all([...graftCandidates.keys()].map(async (cg) => {
        const canon = await cgCanonicalContract(cg.cg_id, cgHeaders).catch(() => undefined);
        if (!canon || !canon.address) return;
        cg.contract_address = canon.address;
        cg.chain = String(canon.networkId);
        cg.codex_id = `${canon.address}:${canon.networkId}`;
      }));
      const results = [...cgTokens, ...crossDeduped].slice(0, 25);

      // Search cache: 30s s-maxage, 2min stale-while-revalidate. Lowered from
      // 5min 2026-05-28 after a single bad response (CG transient) cached at
      // the Vercel edge poisoned every user's search for the full TTL. 30s
      // means transient upstream blips heal in 30s instead of 5 min. Quota
      // impact: ~10× more cache misses on hot queries, but each is cheap
      // (1 CG + 1 Codex + 1 DexScreener); CG Pro quota easily absorbs it.
      // For empty-result responses, cache even shorter so 'no results' for
      // brand-new launches refreshes quickly.
      const cacheSeconds = results.length > 0 ? 30 : 5;
      res.setHeader('Cache-Control', `public, s-maxage=${cacheSeconds}, stale-while-revalidate=120`);
      // L4-PR7: CDN-Cache-Control is honored by Vercel's edge even when the
      // response sets cookies (auth-gate / Privy), so logged-in users finally
      // hit the edge instead of bypassing it. Same TTL as Cache-Control above.
      res.setHeader('CDN-Cache-Control', `public, s-maxage=${cacheSeconds}`);
      if (skipCodex) res.setHeader('X-L4-PR2-Codex-Skipped', '1');
      return res.status(200).json(buildTokenSearchResponse(q, { results }));
    } catch (err) {
      console.error('Token search proxy error:', err.message);
      // Return 200 with empty results — every upstream call is already wrapped
      // in .catch(() => null), so reaching this catch is a defensive net.
      // The client treats [] as "no results" and avoids surfacing a scary
      // "API Error: Search service unavailable" message to users.
      return res.status(200).json(buildTokenSearchResponse(q, {
        results: [],
        upstreamStatus: err.upstreamStatus || null,
      }));
    }
  }

  // --- /api/search/whisper ---
  if (route === 'whisper') {
    // Whisper search requires the full Express server with LLM integration.
    // Return a graceful fallback in serverless mode.
    return res.status(200).json({
      interpretation: null,
      results: [],
      fallback: true,
      message: 'Whisper search requires the Spectre server.',
    });
  }

  // --- POST /api/search (default search endpoint) ---
  let query = '';
  if (req.method === 'POST' && req.body) {
    query = req.body.query || req.body.q || '';
  } else {
    query = req.query.q || req.query.query || '';
  }

  return res.status(200).json({
    query,
    research: {
      content: 'Search requires the Spectre server.',
      model: 'fallback',
      dataState: 'INTERNAL_ONLY',
    },
    relatedSearches: [],
  });
}
