/**
 * Market-data ranking exclusions.
 *
 * CoinGecko auto-lists tokens and ranks them purely by reported market cap,
 * including assets that are NOT tradeable cryptocurrencies in the normal sense,
 * or whose reported circulating supply / market cap is unreliable. These surface
 * at absurd ranks in our market-cap-ordered "Top Coins" lists — e.g. FIGR_HELOC
 * (Figure Heloc) at #9 with a ~$20B cap, RAIN at #12 with a ~$10B cap — while
 * stricter sources (CoinMarketCap) exclude them entirely. The usual reason is
 * that the project never registered/verified with the stricter source, OR the
 * "market cap" is a notional figure (RWA tokenized private credit) rather than a
 * liquid, tradeable float.
 *
 * IMPORTANT — this is deliberately a curated list, NOT a heuristic. We verified
 * that a liquidity/turnover filter is UNSAFE here: legitimate liquid-staking
 * derivatives (stETH ~0.00098, wstETH ~0.00101 volume/mcap) have an even lower
 * turnover than FIGR_HELOC (~0.00105), so any turnover floor that catches the
 * junk would also wrongly drop real top assets. CoinGecko exposes no "verified"
 * flag and no category in its bulk /coins/markets payload, so there is no clean
 * programmatic signal. A maintained id-keyed exclusion list is the honest fix.
 *
 * Scope: this only affects the OVERALL market-cap-ranked "Top Coins" list. These
 * tokens still resolve normally on search, token pages, and their own category
 * view (FIGR_HELOC under the RWA chip is correct — it just shouldn't rank #9
 * among all coins).
 *
 * Keep in sync with apps/research/api/cron/refresh-cg-snapshot.js
 * (RANK_EXCLUDED_COINGECKO_IDS there mirrors this set for the trending snapshot).
 */

// Keyed by CoinGecko id (stable, collision-free). Primary exclusion key.
export const RANK_EXCLUDED_COINGECKO_IDS = new Set([
  'figure-heloc', // RWA tokenized private credit. CG: ~$20B cap on ~$20M/24h vol. Not on CMC.
  'rain',         // GambleFi. CG: ~$10B cap on a likely-inflated circulating supply. Not on CMC.
  // Tokenized SpaceX equity. Reported at $25.8T - eleven times the entire
  // crypto market - and it ranked ABOVE Bitcoin on the LITE board (founder,
  // 2026-08-12). CG's own /coins/markets gives it a $2.8M cap and a
  // $25,751,820,390,209 FDV against a 20,232 total supply, so the trillions
  // are a supply-decimals error upstream. The ceiling below catches this class
  // in general; the id is listed because it is the one that was reported.
  'space-exploration-technologies-dinari-tokenized-stock',
]);

// Secondary guard for surfaces that carry only a symbol (no id). Keep this set
// to DISTINCTIVE symbols only — generic tickers (e.g. "RAIN") can collide with
// unrelated legit tokens, so those are excluded by id above, not by symbol.
export const RANK_EXCLUDED_SYMBOLS = new Set([
  'FIGR_HELOC',
]);

/**
 * True if a coin/market row should be hidden from the overall market-cap ranking.
 * Matches on CoinGecko id OR a distinctive symbol (either is sufficient).
 */
export function isRankExcluded(coin) {
  if (!coin) return false;
  const id = String(coin.id || coin.coingeckoId || coin.coingecko_id || '').toLowerCase();
  if (id && RANK_EXCLUDED_COINGECKO_IDS.has(id)) return true;
  const sym = String(coin.symbol || '').toUpperCase();
  if (sym && RANK_EXCLUDED_SYMBOLS.has(sym)) return true;
  if (hasImpossibleCap(coin)) return true;
  return false;
}

/**
 * The one rule that does NOT need curating: no single asset can be worth more
 * than every crypto asset combined. The whole market is ~$2.3T, so a row
 * reporting $25.8T is a decimals error in someone's supply figure, not an
 * asset - and because the lists here are market-cap-ordered, that error lands
 * the row at #1, above Bitcoin.
 *
 * Deliberately a CEILING and not a heuristic: it makes no judgement about what
 * an asset is or how liquid it is (the header above explains why turnover
 * filters are unsafe here), only that a number is arithmetically impossible.
 * $5T is ~2x the entire market today; if the market ever approaches it, this
 * constant is one line. A row whose cap contradicts its own price x supply by
 * more than 5x is caught too, which covers the error before it gets that big.
 */
export const IMPOSSIBLE_CAP_USD = 5e12;

export function hasImpossibleCap(coin) {
  if (!coin) return false;
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const cap = n(coin.market_cap ?? coin.marketCap);
  if (!(cap > 0)) return false;
  if (cap > IMPOSSIBLE_CAP_USD) return true;
  const price = n(coin.current_price ?? coin.price);
  const supply = n(coin.circulating_supply ?? coin.circulatingSupply);
  if (price > 0 && supply > 0) {
    const implied = price * supply;
    if (implied > 0 && cap / implied > 5) return true;
  }
  return false;
}

/** Drop excluded tokens from a market-cap-ranked list. Idempotent + null-safe. */
export function filterRankedCoins(list) {
  if (!Array.isArray(list)) return list;
  return list.filter((coin) => !isRankExcluded(coin));
}
