/**
 * Kline adapters for the CEX venue lane. Binance is delegated to the existing
 * fetchBinanceKlines (which carries the allorigins proxy fallback that is the
 * real prod path — do not reimplement it). Bybit and OKX are new.
 */
import { fetchBinanceKlines } from './binance-bars.js';

// TradingView/Codex resolution -> venue interval. 720 (12H) is deliberately
// present here but is NOT offered by the chart's resolution ladder (no symbol
// payload lists it) — see charts-system.md §I3.
export const CEX_INTERVALS = {
  bybit: {
    '1': '1', '3': '3', '5': '5', '15': '15', '30': '30', '60': '60',
    '120': '120', '240': '240', '360': '360', '720': '720',
    'D': 'D', '1D': 'D', 'W': 'W', '1W': 'W', 'M': 'M', '1M': 'M',
  },
  okx: {
    '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1H',
    '120': '2H', '240': '4H', '360': '6H', '720': '12H',
    'D': '1D', '1D': '1D', 'W': '1W', '1W': '1W', 'M': '1M', '1M': '1M',
  },
};

export function cexPairSymbol(venue, base, target) {
  return venue === 'okx' ? `${base}-${target}` : `${base}${target}`;
}

/**
 * Normalize a Bybit or OKX kline array. Both answer DESCENDING with ms string
 * timestamps and [ts, o, h, l, c, volume] in the first six slots, so one
 * parser serves both. Filters match _parseKlines in binance-bars.js.
 */
export function parseCexKlines(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const t = Math.floor(Number(r[0]) / 1000);
    const o = parseFloat(r[1]);
    const h = parseFloat(r[2]);
    const l = parseFloat(r[3]);
    const c = parseFloat(r[4]);
    const v = parseFloat(r[5]) || 0;
    if (!Number.isFinite(t) || t <= 0) continue;
    if (![o, h, l, c].every(Number.isFinite)) continue;
    if (o <= 0 || c <= 0) continue;
    out.push({ t, o, h, l, c, v });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Fetch klines from the resolved venue. Returns bars or null; never throws.
 *
 * Window limits: Bybit caps at 1000 bars, OKX at 300. The TradingView datafeed
 * pages on its own when a window exceeds what one call returns, exactly as it
 * already does for Binance's 1000-bar cap.
 */
export async function fetchCexKlines(venue, base, target, resolution, fromSec, toSec) {
  if (!venue || !base || !target) return null;
  if (fromSec == null || toSec == null || fromSec >= toSec) return null;

  const pair = cexPairSymbol(venue, base, target);
  if (venue === 'binance') return fetchBinanceKlines(pair, resolution, fromSec, toSec);

  const iv = CEX_INTERVALS[venue]?.[resolution];
  if (!iv) return null;

  const startMs = Math.floor(fromSec * 1000);
  const endMs = Math.floor(toSec * 1000);

  // OKX pagination is inverted from intuition: `before` returns records NEWER
  // than the timestamp, `after` returns records EARLIER. So the window
  // [from..to] is before=from, after=to.
  const url = venue === 'bybit'
    ? `https://api.bybit.com/v5/market/kline?category=spot&symbol=${pair}`
      + `&interval=${iv}&start=${startMs}&end=${endMs}&limit=1000`
    : `https://www.okx.com/api/v5/market/candles?instId=${pair}`
      + `&bar=${iv}&before=${startMs}&after=${endMs}&limit=300`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const rows = venue === 'bybit' ? j?.result?.list : j?.data;
    return parseCexKlines(rows);
  } catch (e) {
    if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') {
      console.warn(`[cex-bars] ${venue} ${pair} ${iv} failed:`, e.message);
    }
    return null;
  }
}
