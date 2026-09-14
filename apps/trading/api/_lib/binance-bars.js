/**
 * Binance Klines → TradingView/Codex bars adapter.
 *
 * L4-PR4 (2026-06-03): the single biggest tactical fix for the Codex bill.
 * Per Sunny's dashboard (Jun 2 2026), `getBars` was 45% of daily Codex ops
 * (598K / 1.55M). For ANY token with a known Binance USDT pair, route the
 * chart bars request to Binance public klines (FREE, real-time) before
 * touching Codex.
 *
 * Strategy:
 *   Tier 1: Binance klines (covered token) ← THIS MODULE
 *   Tier 2: Codex getTokenBars (existing path, unchanged)
 *
 * Long-tail DEX tokens (no Binance USDT pair) skip this module entirely and
 * fall through to the existing Codex tier — same code path as before. L4-PR5
 * adds Hetzner candles between Binance and Codex for those.
 *
 * Failure modes (all soft, return null → caller falls back to Codex):
 *   - Binance IP-blocked from Vercel: allorigins.win CORS proxy retry
 *   - Both fail: return null
 *   - Empty klines: return null
 *   - Timeout (3s direct + 4s allorigins): return null
 *
 * Kill switch: L4_PR4_DISABLE_BINANCE=1 (Vercel env) bypasses every call.
 * Verify by reading the env var in lookupBinancePair (returns null).
 */

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

// Load the canonical token registry from packages/server/lib so research +
// trading apps stay in lockstep on symbol → binanceSymbol mapping. Same path
// the research codex.js handler uses.
let TOKEN_REGISTRY = null;
let KNOWN_TOKEN_ADDRESSES = null;
try {
  const reg = _require('../../../../packages/server/lib/token-registry');
  TOKEN_REGISTRY = reg?.TOKEN_REGISTRY || null;
  KNOWN_TOKEN_ADDRESSES = reg?.KNOWN_TOKEN_ADDRESSES || null;
} catch (e) {
  // Fallback BINANCE_MAJORS below covers the top of the cap table, but the
  // address/cgId -> Binance reverse-map is DEAD without the registry. This
  // exact failure shipped silently on trading prod (vercel.json includeFiles
  // missing token-registry.js) and routed majors to GT/Codex - never again.
  console.error('[binance-bars] token-registry failed to load - address reverse-map disabled:', e?.message);
}

// Backstop hardcoded map of the top 50 majors by Binance USDT pair listing.
// Used only if the token-registry import fails (it shouldn't). Matches the
// canonical `<SYMBOL> → <SYMBOL>USDT` convention.
const BINANCE_MAJORS_FALLBACK = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT',
  XRP: 'XRPUSDT', ADA: 'ADAUSDT', DOGE: 'DOGEUSDT', AVAX: 'AVAXUSDT',
  DOT: 'DOTUSDT', LINK: 'LINKUSDT', MATIC: 'MATICUSDT', UNI: 'UNIUSDT',
  ATOM: 'ATOMUSDT', LTC: 'LTCUSDT', ETC: 'ETCUSDT', FIL: 'FILUSDT',
  ARB: 'ARBUSDT', OP: 'OPUSDT', NEAR: 'NEARUSDT', APT: 'APTUSDT',
  SUI: 'SUIUSDT', INJ: 'INJUSDT', TIA: 'TIAUSDT', SEI: 'SEIUSDT',
  AAVE: 'AAVEUSDT', MKR: 'MKRUSDT', CRV: 'CRVUSDT', LDO: 'LDOUSDT',
  GRT: 'GRTUSDT', RENDER: 'RENDERUSDT', RNDR: 'RENDERUSDT',
  FET: 'FETUSDT', TAO: 'TAOUSDT', ONDO: 'ONDOUSDT', JUP: 'JUPUSDT',
  PYTH: 'PYTHUSDT', JTO: 'JTOUSDT', PEPE: 'PEPEUSDT', SHIB: 'SHIBUSDT',
  FLOKI: 'FLOKIUSDT', WIF: 'WIFUSDT', BONK: 'BONKUSDT',
  PENDLE: 'PENDLEUSDT', SUSHI: 'SUSHIUSDT', TRX: 'TRXUSDT',
  ALGO: 'ALGOUSDT', BCH: 'BCHUSDT', XLM: 'XLMUSDT', VET: 'VETUSDT',
  EOS: 'EOSUSDT', HBAR: 'HBARUSDT', ICP: 'ICPUSDT',
};

// TradingView/Codex resolution → Binance interval. Binance valid intervals:
// 1s 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M
export const BINANCE_INTERVAL_MAP = {
  '1S': '1s', '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', '120': '2h', '180': '3m', '240': '4h', '360': '6h', '480': '8h',
  '720': '12h',
  'D': '1d', '1D': '1d', '3D': '3d',
  'W': '1w', '1W': '1w', '7D': '1w',
  'M': '1M', '1M': '1M',
};

/**
 * Resolve `symbol` (in many possible shapes) → Binance USDT pair name.
 *
 * Inputs we see in the wild:
 *   - "BTC", "ETH", "SOL"            ← canonical symbol
 *   - "0xC02a...:1"                  ← address:networkId (Codex symbol form)
 *   - "0xC02a..."                    ← bare EVM address
 *   - "So11111111111111111111111..." ← bare Solana address
 *   - "BTCUSDT"                      ← already-pair form (passthrough)
 *
 * Returns `'BTCUSDT'` / `null` (no Binance coverage → keep on Codex).
 */
export function lookupBinancePair(symbol, cgIdHint = null, addressHint = null) {
  // Kill switch — set in Vercel env to disable the Binance tier across the
  // board if anything goes sideways post-deploy.
  if (process.env.L4_PR4_DISABLE_BINANCE === '1') return null;
  if (!symbol) return null;

  const raw = String(symbol).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  // (a) Already in <SYM>USDT form (some callers pre-resolve). Trust it.
  if (/^[A-Z0-9]+USDT$/.test(upper) && upper.length <= 16) {
    return upper;
  }

  // (b) Direct registry hit on canonical symbol.
  if (TOKEN_REGISTRY?.[upper]?.binanceSymbol) {
    return TOKEN_REGISTRY[upper].binanceSymbol;
  }

  // (c) Hardcoded fallback (only if registry didn't load).
  if (BINANCE_MAJORS_FALLBACK[upper]) {
    return BINANCE_MAJORS_FALLBACK[upper];
  }

  // (d) Address form — reverse-lookup via KNOWN_TOKEN_ADDRESSES.
  const looksLikeAddress = raw.startsWith('0x') || raw.includes(':') || (raw.length >= 32 && !raw.includes(' '));
  if (looksLikeAddress) {
    const addr = (raw.includes(':') ? raw.split(':')[0] : raw).toLowerCase();
    const registries = [
      { src: KNOWN_TOKEN_ADDRESSES, key: 'address' },
      { src: TOKEN_REGISTRY, key: 'address' },
    ];
    for (const { src, key } of registries) {
      if (!src) continue;
      for (const [sym, info] of Object.entries(src)) {
        const a = info?.[key];
        if (a && String(a).toLowerCase() === addr) {
          // Resolved symbol → check Binance coverage in registry or fallback.
          const upperSym = sym.toUpperCase();
          const mapped = TOKEN_REGISTRY?.[upperSym]?.binanceSymbol || BINANCE_MAJORS_FALLBACK[upperSym] || null;
          if (mapped) {
            // Observability: this reverse-map silently dying (registry not
            // bundled) is what exiled address-form majors to GT/Codex.
            console.log(`[router] reverse-mapped ${addr} -> ${mapped}`);
            return mapped;
          }
        }
      }
    }
  }

  // (e) CG id hint (e.g. "bitcoin" → "BTCUSDT").
  if (cgIdHint && TOKEN_REGISTRY) {
    const cgLower = String(cgIdHint).toLowerCase();
    for (const [sym, info] of Object.entries(TOKEN_REGISTRY)) {
      if (info?.coingeckoId === cgLower && info?.binanceSymbol) {
        console.log(`[router] reverse-mapped cgId:${cgLower} -> ${info.binanceSymbol}`);
        return info.binanceSymbol;
      }
    }
  }

  // (f) Explicit address hint (when caller has it as a separate param).
  if (addressHint && (KNOWN_TOKEN_ADDRESSES || TOKEN_REGISTRY)) {
    return lookupBinancePair(addressHint, cgIdHint, null);
  }

  return null;
}

/**
 * Fetch Binance klines for `pair` and return TradingView/Codex shaped bars.
 *
 *   pair      "BTCUSDT" (already resolved via lookupBinancePair).
 *   interval  TradingView resolution string ("60", "240", "1D", "1W"…)
 *   fromSec   request window start, unix seconds.
 *   toSec     request window end, unix seconds.
 *
 * Returns `[{t, o, h, l, c, v}, ...]` (t = unix seconds) or `null` on:
 *   - Both Binance direct + allorigins fall through
 *   - Empty klines
 *   - Any exception (logged but swallowed — caller must retry on Codex)
 *
 * Binance gives base-asset volume in `k[5]`. The current Codex output also
 * uses base-asset volume, so this is byte-for-byte parity with what the chart
 * already shows.
 */
export async function fetchBinanceKlines(pair, resolution, fromSec, toSec) {
  if (!pair || fromSec == null || toSec == null || fromSec >= toSec) return null;

  const interval = BINANCE_INTERVAL_MAP[resolution] || '1h';
  const startMs = Math.floor(fromSec * 1000);
  const endMs = Math.floor(toSec * 1000);

  // Binance hard limit is 1000 bars per call; that covers ~41 days of 1h
  // bars, ~16 weeks of 4h bars, ~2.7 years of 1d bars. The TradingView
  // datafeed pages on its own when the window exceeds 1000 candles.
  //
  // CRITICAL window>1000 handling (2026-06-11 audit): with startTime AND
  // endTime, Binance returns klines ASCENDING FROM startTime - a 1500-bar
  // window (the wide-probe clamp) yielded the EARLIEST 1000 bars and the
  // chart's right edge went ~500 intervals stale (BTC opened ~3 weeks old
  // on 1H). When the window exceeds the limit, drop startTime and use the
  // endTime-only form so Binance returns the LAST 1000 bars ending at `to`
  // (mirrors the long-standing UDF Tier-2 fallback behavior).
  const _intervalSec = {
    '1s': 1, '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
    '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800, '1M': 2592000,
  }[interval] || 3600;
  const windowExceedsLimit = (toSec - fromSec) / _intervalSec > 1000;
  const url = windowExceedsLimit
    ? `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&endTime=${endMs}&limit=1000`
    : `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=1000`;

  // Attempt 1: direct Binance. Tight 3s timeout — fast-fail to the proxy
  // since Vercel IPs are frequently 451-blocked by Binance edge.
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const arr = await resp.json();
      const bars = _parseKlines(arr);
      if (bars?.length > 0) {
        return bars;
      }
    }
  } catch (e) {
    // Swallow; proxy is below.
    if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') {
      console.warn(`[L4-PR4-Binance] direct ${pair} ${interval} failed:`, e.message);
    }
  }

  // Attempt 2: allorigins.win CORS proxy. Slower budget (4s) because the
  // proxy adds a hop. This is the path that actually succeeds from Vercel.
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const arr = await resp.json();
      const bars = _parseKlines(arr);
      if (bars?.length > 0) {
        return bars;
      }
    }
  } catch (e) {
    if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') {
      console.warn(`[L4-PR4-Binance] allorigins ${pair} ${interval} failed:`, e.message);
    }
  }

  // Both upstreams failed. Caller falls back to Codex.
  return null;
}

/**
 * Binance klines → TradingView UDF shape: `{ s, t[], o[], h[], l[], c[], v[] }`.
 * Caller can use this directly OR convert rows further via _parseKlines.
 */
export function klinesToUDF(klines) {
  if (!Array.isArray(klines) || klines.length === 0) return null;
  const out = { s: 'ok', t: [], o: [], h: [], l: [], c: [], v: [] };
  for (const k of klines) {
    if (!Array.isArray(k) || k.length < 6) continue;
    const t = Math.floor(k[0] / 1000);
    const o = parseFloat(k[1]);
    const h = parseFloat(k[2]);
    const l = parseFloat(k[3]);
    const c = parseFloat(k[4]);
    const v = parseFloat(k[5]) || 0;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (o <= 0 || c <= 0) continue;
    out.t.push(t);
    out.o.push(o);
    out.h.push(h);
    out.l.push(l);
    out.c.push(c);
    out.v.push(v);
  }
  return out.t.length > 0 ? out : null;
}

/**
 * Parse Binance kline array → row-shaped bars `[{t,o,h,l,c,v}]`. Used by the
 * /api/bars endpoint which returns rows rather than UDF.
 *
 * Raw kline: [openTime, open, high, low, close, volume, closeTime, quoteVol,
 *             trades, takerBaseVol, takerQuoteVol, ignore]
 */
function _parseKlines(klines) {
  if (!Array.isArray(klines) || klines.length === 0) return null;
  const out = [];
  for (const k of klines) {
    if (!Array.isArray(k) || k.length < 6) continue;
    const t = Math.floor(k[0] / 1000);
    const o = parseFloat(k[1]);
    const h = parseFloat(k[2]);
    const l = parseFloat(k[3]);
    const c = parseFloat(k[4]);
    const v = parseFloat(k[5]) || 0;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (o <= 0 || c <= 0) continue;
    out.push({ t, o, h, l, c, v });
  }
  return out.length > 0 ? out : null;
}

export const __test__ = { _parseKlines };
