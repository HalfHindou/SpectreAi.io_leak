/**
 * In-process market snapshot for the AI Market brief (prod / serverless).
 *
 * WHY THIS EXISTS (2026-07-02): generateCryptoBrief used to gather its data by
 * HTTP-fetching our own /api/market/* routes via `https://${VERCEL_URL}`. That
 * failed twice over in prod: the deployment-specific URL sits behind Vercel
 * deployment protection (302), and /api/market/* is tier-gated by market-api.js
 * (401 without the auth cookie a server-to-server fetch never has). Every field
 * came back null, the LLM was fed a sheet of "n/a", and the panel served
 * "Fear & Greed not available... no specific numbers on BTC, ETH and SOL" slop.
 *
 * Fix: gather everything IN-PROCESS from the real upstreams (CoinGecko,
 * alternative.me, Binance via the geo-proxy chain, CoinGlass with a Spectre
 * data-api fallback, the calendar merger, the intelligence store + live news
 * APIs). No self-HTTP, no auth wall, no dead deployment URLs.
 *
 * Every fetcher degrades to null on failure - the prompt builder renders "n/a"
 * honestly rather than fabricating.
 */

import { getBreaking, listNews } from './intelligence-store.js';
import { getEconomicEvents } from './handlers/calendar-api.js';

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';

// Stable public alias for the few OPEN self-routes we still use (stocks).
// NEVER use process.env.VERCEL_URL here - the deployment URL is protection-gated.
export const STABLE_BASE_URL = process.env.MARKET_BRIEF_BASE_URL || 'https://spectre-app-research.vercel.app';

// ── Low-level fetch helpers ─────────────────────────────────────────────────

export async function safeJson(url, { timeoutMs = 8000, headers } = {}) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

function isBinanceGeoBlock(data) {
  return data && typeof data === 'object' && !Array.isArray(data) &&
    data.code === 0 && typeof data.msg === 'string' && data.msg.includes('restricted location');
}

// Binance geo-blocks Vercel IP ranges. Direct first, then free CORS proxies in
// unrestricted regions. codetabs actually reaches Binance; allorigins kept as a
// last resort (it often returns the geo-block page verbatim, so reject that body).
export async function binanceFetch(url, { timeoutMs = 8000 } = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) {
      const data = await r.json();
      if (!isBinanceGeoBlock(data)) return data;
    }
  } catch (_) {}
  try {
    const proxyUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`;
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs + 4000) });
    if (r.ok) {
      const data = await r.json();
      if (!isBinanceGeoBlock(data)) return data;
    }
  } catch (_) {}
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs + 4000) });
    if (r.ok) {
      const data = await r.json();
      if (!isBinanceGeoBlock(data)) return data;
    }
  } catch (_) {}
  return null;
}

function spectreHeaders() {
  const h = { Accept: 'application/json' };
  if (SPECTRE_API_KEY) h['X-API-Key'] = SPECTRE_API_KEY;
  return h;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Majors: BTC / ETH / SOL with multi-window context ───────────────────────
// CoinGecko markets gives price + 1h/24h/7d/30d changes + 24h range + distance
// from ATH in ONE call - exactly the context a "dip or rally?" call needs.

async function fetchMajors() {
  const headers = { accept: 'application/json' };
  if (COINGECKO_API_KEY) headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana&price_change_percentage=1h,24h,7d,30d&sparkline=false`;
  const rows = await safeJson(url, { headers });
  const shape = (r) => r ? {
    price: num(r.current_price),
    change1h: num(r.price_change_percentage_1h_in_currency),
    change24h: num(r.price_change_percentage_24h_in_currency ?? r.price_change_percentage_24h),
    change7d: num(r.price_change_percentage_7d_in_currency),
    change30d: num(r.price_change_percentage_30d_in_currency),
    high24h: num(r.high_24h),
    low24h: num(r.low_24h),
    athChangePct: num(r.ath_change_percentage),
    volume24h: num(r.total_volume),
  } : null;
  if (Array.isArray(rows) && rows.length) {
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    return {
      btc: shape(byId.bitcoin),
      eth: shape(byId.ethereum),
      sol: shape(byId.solana),
    };
  }
  // Fallback: Binance spot 24h tickers (price / 24h change / range only).
  const syms = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT' };
  const out = { btc: null, eth: null, sol: null };
  await Promise.all(Object.entries(syms).map(async ([k, sym]) => {
    const t = await binanceFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
    if (t && t.lastPrice) {
      out[k] = {
        price: num(t.lastPrice),
        change1h: null,
        change24h: num(t.priceChangePercent),
        change7d: null,
        change30d: null,
        high24h: num(t.highPrice),
        low24h: num(t.lowPrice),
        athChangePct: null,
        volume24h: num(t.quoteVolume),
      };
    }
  }));
  return out;
}

async function fetchGlobal() {
  const headers = { accept: 'application/json' };
  if (COINGECKO_API_KEY) headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
  const json = await safeJson(`${COINGECKO_BASE}/global`, { headers });
  const d = json?.data;
  if (!d) return null;
  return {
    totalMcap: num(d.total_market_cap?.usd),
    totalVolume: num(d.total_volume?.usd),
    btcDominance: num(d.market_cap_percentage?.btc),
    ethDominance: num(d.market_cap_percentage?.eth),
    mcapChange24h: num(d.market_cap_change_percentage_24h_usd),
  };
}

// ── Sentiment: Fear & Greed with trend ──────────────────────────────────────
// alternative.me is keyless and returns history, so the model can say "fear at
// 20, down from 42 a week ago" instead of quoting a naked level.

export async function fetchFearGreed() {
  const json = await safeJson('https://api.alternative.me/fng/?limit=8&format=json');
  const rows = Array.isArray(json?.data) ? json.data : [];
  if (!rows.length) return null;
  const v = (i) => (rows[i] ? num(rows[i].value) : null);
  return {
    value: v(0),
    classification: rows[0].value_classification || null,
    yesterday: v(1),
    weekAgo: v(7),
  };
}

// ── Derivatives: funding, OI (+24h delta), retail L/S, TOP-TRADER L/S ───────
// topLongShortPositionRatio is Binance's top-trader POSITION skew - the closest
// public read on whether big players are net bidding or distributing.

async function fetchDerivatives() {
  const [btcFr, ethFr, retailLs, topLs, oiHist, btcOi, ethOi, ethPriceRow] = await Promise.all([
    binanceFetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'),
    binanceFetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=1'),
    binanceFetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1'),
    binanceFetch('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1'),
    binanceFetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=4h&limit=7'),
    binanceFetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
    binanceFetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT'),
    binanceFetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=ETHUSDT'),
  ]);

  const out = {
    fundingBtcPct: Array.isArray(btcFr) && btcFr[0] ? num(btcFr[0].fundingRate) * 100 : null,
    fundingEthPct: Array.isArray(ethFr) && ethFr[0] ? num(ethFr[0].fundingRate) * 100 : null,
    retailLsRatio: null, retailLongsPct: null,
    topTraderLsRatio: null, topTraderLongsPct: null,
    btcOiUsd: null, oiChange24hPct: null, ethOiUsd: null,
  };

  const rls = Array.isArray(retailLs) ? retailLs[0] : null;
  if (rls) {
    out.retailLsRatio = num(rls.longShortRatio);
    out.retailLongsPct = num(rls.longAccount) != null ? num(rls.longAccount) * 100 : null;
  }
  const tls = Array.isArray(topLs) ? topLs[0] : null;
  if (tls) {
    out.topTraderLsRatio = num(tls.longShortRatio);
    out.topTraderLongsPct = num(tls.longAccount) != null ? num(tls.longAccount) * 100 : null;
  }

  // BTC OI in USD + 24h delta from the 4h history (7 points = 24h window).
  if (Array.isArray(oiHist) && oiHist.length >= 2) {
    const latest = oiHist[oiHist.length - 1];
    const dayAgo = oiHist[0];
    const latestUsd = num(latest?.sumOpenInterestValue);
    const dayAgoUsd = num(dayAgo?.sumOpenInterestValue);
    if (latestUsd != null) out.btcOiUsd = latestUsd;
    if (latestUsd != null && dayAgoUsd) out.oiChange24hPct = ((latestUsd - dayAgoUsd) / dayAgoUsd) * 100;
  }
  if (out.btcOiUsd == null && btcOi?.openInterest) {
    // No hist -> raw coin OI; leave USD null rather than guessing a price here.
    out.btcOiCoins = num(btcOi.openInterest);
  }
  if (ethOi?.openInterest && ethPriceRow?.price) {
    out.ethOiUsd = num(ethOi.openInterest) * num(ethPriceRow.price);
  }

  // Spectre data-api fallback for funding if Binance was unreachable.
  if (out.fundingBtcPct == null && SPECTRE_API_KEY) {
    const fj = await safeJson(`${SPECTRE_API_BASE}/v1/derivatives/funding-rates`, { headers: spectreHeaders() });
    const rows = Array.isArray(fj?.data) ? fj.data : [];
    const row = (a) => rows.find((r) => (r.asset || '').toUpperCase() === a);
    const b = row('BTC'); const e = row('ETH');
    if (b) out.fundingBtcPct = num(b.rate ?? b.weighted_funding_rate) * 100;
    if (e) out.fundingEthPct = num(e.rate ?? e.weighted_funding_rate) * 100;
  }
  return out;
}

// ── Market-wide OI + 24h liquidations: CoinGlass -> Spectre data-api ────────

async function fetchOiAndLiquidations() {
  const out = { totalOiUsd: null, liqLongUsd: null, liqShortUsd: null, liqTotalUsd: null };
  const cgKey = process.env.COINGLASS_API_KEY;
  if (cgKey) {
    const cg = async (p) => {
      const j = await safeJson(`https://open-api-v4.coinglass.com/api${p}`, {
        headers: { 'CG-API-KEY': cgKey, Accept: 'application/json' }, timeoutMs: 10000,
      });
      return j && j.code === '0' ? j.data : null;
    };
    const [oiRows, liqRows] = await Promise.all([
      cg('/futures/open-interest/exchange-list?symbol='),
      cg('/futures/liquidation/exchange-list?symbol=&range=24h'),
    ]);
    if (Array.isArray(oiRows) && oiRows.length) {
      out.totalOiUsd = oiRows.reduce((s, r) => s + (num(r?.open_interest_usd) || 0), 0) || null;
    }
    if (Array.isArray(liqRows) && liqRows.length) {
      let lg = 0, sh = 0;
      for (const r of liqRows) {
        lg += num(r?.long_liquidation_usd ?? r?.long_liquidation_usd_24h) || 0;
        sh += num(r?.short_liquidation_usd ?? r?.short_liquidation_usd_24h) || 0;
      }
      if (lg || sh) { out.liqLongUsd = lg; out.liqShortUsd = sh; out.liqTotalUsd = lg + sh; }
    }
  }
  if ((out.totalOiUsd == null || out.liqTotalUsd == null) && SPECTRE_API_KEY) {
    const [oiJson, liqJson] = await Promise.all([
      out.totalOiUsd == null
        ? safeJson(`${SPECTRE_API_BASE}/v1/derivatives/open-interest?limit=500`, { headers: spectreHeaders() })
        : Promise.resolve(null),
      out.liqTotalUsd == null
        ? safeJson(`${SPECTRE_API_BASE}/v1/derivatives/liquidation-windows`, { headers: spectreHeaders() })
        : Promise.resolve(null),
    ]);
    if (oiJson && out.totalOiUsd == null) {
      out.totalOiUsd = num(oiJson?.meta?.total_oi_usd);
      if (out.totalOiUsd == null) {
        const rows = Array.isArray(oiJson?.data) ? oiJson.data : Array.isArray(oiJson?.rows) ? oiJson.rows : [];
        const sum = rows.reduce((s, r) => s + (num(r?.oi_usd ?? r?.total_oi_usd) || 0), 0);
        out.totalOiUsd = sum || null;
      }
    }
    if (liqJson && out.liqTotalUsd == null) {
      const w24 = liqJson?.data?.windows?.['24h'] || liqJson?.windows?.['24h'];
      if (w24) {
        out.liqLongUsd = num(w24.long);
        out.liqShortUsd = num(w24.short);
        out.liqTotalUsd = num(w24.total) ?? ((out.liqLongUsd || 0) + (out.liqShortUsd || 0) || null);
      }
    }
  }
  // Plausibility clamp: the data-api 12h/24h windows are known to inflate into
  // the tens of billions (unit bug upstream). The worst real day on record was
  // single-digit billions market-wide. Feeding a fabricated "$38B flush" to the
  // LLM is worse than an honest n/a.
  if (out.liqTotalUsd != null && out.liqTotalUsd > 12e9) {
    out.liqLongUsd = null; out.liqShortUsd = null; out.liqTotalUsd = null;
  }
  return out;
}

// ── Whale / taker flow: 24h net taker delta on BTC+ETH+SOL perps ────────────
// 2*takerBuyQuote - quoteVolume per bar = net aggressive buy USD. Positive =
// buyers lifting offers (bid pressure), negative = sellers hitting bids.

async function fetchTakerFlow() {
  const klines = await Promise.all(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map((sym) =>
    binanceFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=24`)
  ));
  let usd = 0; let any = false;
  for (const rows of klines) {
    if (!Array.isArray(rows)) continue;
    any = true;
    for (const row of rows) usd += 2 * (num(row[10]) || 0) - (num(row[7]) || 0);
  }
  return any ? usd : null;
}

// ── Economic calendar: next high-impact events ──────────────────────────────

async function fetchCalendar() {
  try {
    const now = new Date();
    const to = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const { events } = await getEconomicEvents({
      from: now.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    if (!Array.isArray(events)) return [];
    const nowMs = now.getTime() - 6 * 60 * 60 * 1000; // keep events from the last 6h too (fresh prints)
    return events
      .filter((e) => e?.dateTime && new Date(e.dateTime).getTime() > nowMs)
      .filter((e) => e.impact === 'high' || e.impact === 'medium' || e.isFedEvent)
      .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
      .slice(0, 8)
      .map((e) => ({
        name: e.name,
        currency: e.currency || e.country || '',
        impact: e.impact,
        dateTime: e.dateTime,
        forecast: e.forecast ?? null,
        previous: e.previous ?? null,
        actual: e.actual ?? null,
        isFedEvent: !!e.isFedEvent,
      }));
  } catch (err) {
    console.warn('[market-snapshot] calendar failed:', err.message);
    return [];
  }
}

// ── Headlines: crypto (breaking store + CryptoPanic) + macro/politics ────────
// The build-time intelligence store matches the panel's CONTEXT bullets;
// CryptoPanic and Finnhub add the live layer (geopolitics, Fed, war headlines).

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function fetchHeadlines() {
  const out = [];
  const seen = new Set();
  const push = (title, source, kind) => {
    const t = String(title || '').trim().replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c));
    if (!t) return;
    const k = normTitle(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ title: t, source: source || '', kind });
  };

  // 1+2. Spectre data-api: the live layer. /v1/news/breaking carries real-time
  // econ prints + important events with category tags (macro vs crypto);
  // /v1/news is the aggregated live crypto feed (CoinDesk/Cointelegraph/Block).
  const [breakingJson, newsJson, cp, fh] = await Promise.all([
    SPECTRE_API_KEY
      ? safeJson(`${SPECTRE_API_BASE}/v1/news/breaking?limit=12`, { headers: spectreHeaders() })
      : Promise.resolve(null),
    SPECTRE_API_KEY
      ? safeJson(`${SPECTRE_API_BASE}/v1/news?limit=10`, { headers: spectreHeaders() })
      : Promise.resolve(null),
    // 3. CryptoPanic important posts (live crypto + crypto-adjacent macro).
    process.env.CRYPTOPANIC_API_KEY
      ? safeJson(`https://cryptopanic.com/api/v1/posts/?auth_token=${process.env.CRYPTOPANIC_API_KEY}&kind=news&filter=important&public=true`)
      : Promise.resolve(null),
    // 4. Finnhub general news (macro, politics, war, Fed - the non-crypto WHY).
    process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY !== 'demo'
      ? safeJson(`https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`)
      : Promise.resolve(null),
  ]);

  const breakingRows = Array.isArray(breakingJson?.data) ? breakingJson.data
    : Array.isArray(breakingJson?.articles) ? breakingJson.articles : [];
  const domainCount = {};
  for (const b of breakingRows.slice(0, 10)) {
    // Skip low-signal on-chain noise (block mined etc); keep macro prints + important market events.
    const cat = (b?.category || '').toLowerCase();
    if (cat === 'onchain' && (b?.score ?? 0) < 80) continue;
    // One item per noisy stream (x_vip fires near-duplicate tweets in bursts).
    const dom = (b?.sourceDomain || '').toLowerCase();
    if (dom === 'x_vip') {
      domainCount[dom] = (domainCount[dom] || 0) + 1;
      if (domainCount[dom] > 1) continue;
    }
    const kind = cat === 'macro' ? 'macro' : 'crypto';
    const title = b?.summary && /forecast|previous/i.test(b.summary || '')
      ? `${b.title} (${String(b.summary).split('. Source')[0]})`
      : b?.title;
    push(title, b?.source || 'Spectre Breaking', kind);
  }
  const newsRows = Array.isArray(newsJson?.data) ? newsJson.data
    : Array.isArray(newsJson?.articles) ? newsJson.articles : [];
  for (const n of newsRows.slice(0, 8)) push(n?.title || n?.headline, n?.source, 'crypto');

  if (Array.isArray(cp?.results)) {
    for (const p of cp.results.slice(0, 8)) push(p?.title, p?.source?.title || 'CryptoPanic', 'crypto');
  }
  if (Array.isArray(fh)) {
    const cutoff = Date.now() / 1000 - 36 * 3600;
    for (const n of fh.filter((x) => (x?.datetime || 0) > cutoff).slice(0, 6)) {
      push(n?.headline || n?.title, n?.source, 'macro');
    }
  }

  // 5. In-process breaking store as backfill (same source as the panel's
  // CONTEXT bullets; build-time, so live feeds above take priority).
  if (out.length < 6) {
    try {
      for (const a of getBreaking().slice(0, 5)) push(a.headline || a.title, a.source?.name || a.source, 'crypto');
      if (out.length < 4) {
        for (const a of listNews({ limit: 5 })) push(a.headline || a.title, a.source?.name || a.source, 'crypto');
      }
    } catch (_) {}
  }
  return out.slice(0, 14);
}

// ── Cross-asset equities (open self-route on the stable alias) ──────────────

export async function fetchEquities(baseUrl) {
  const indices = await safeJson(`${baseUrl || STABLE_BASE_URL}/api/stocks/indices`);
  if (!indices || typeof indices !== 'object') return null;
  // The route returns an OBJECT keyed by symbol ({"^GSPC": {...}}), not an
  // array. Accept both shapes defensively.
  const rows = Array.isArray(indices) ? indices : Object.values(indices);
  const byName = {};
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (r.name) byName[String(r.name).trim().toLowerCase()] = r;
    if (r.symbol) byName[String(r.symbol).trim().toLowerCase()] = r;
  }
  const pick = (...names) => { for (const n of names) { const h = byName[n.toLowerCase()]; if (h) return h; } return null; };
  const sp = pick('s&p 500', '^gspc');
  const ndq = pick('nasdaq composite', 'nasdaq', '^ixic');
  const vix = pick('cboe volatility index', 'vix', '^vix');
  if (!sp && !ndq && !vix) return null;
  return {
    sp500: sp ? { price: num(sp.price), change: num(sp.change) } : null,
    nasdaq: ndq ? { price: num(ndq.price), change: num(ndq.change) } : null,
    vix: vix ? { price: num(vix.price), change: num(vix.change) } : null,
  };
}

// ── The full snapshot ────────────────────────────────────────────────────────

export async function gatherCryptoSnapshot({ baseUrl } = {}) {
  const [majors, global, fearGreed, derivs, oiLiq, takerFlowUsd, calendar, headlines, equities] = await Promise.all([
    fetchMajors(),
    fetchGlobal(),
    fetchFearGreed(),
    fetchDerivatives(),
    fetchOiAndLiquidations(),
    fetchTakerFlow(),
    fetchCalendar(),
    fetchHeadlines(),
    fetchEquities(baseUrl),
  ]);
  return {
    btc: majors?.btc || null,
    eth: majors?.eth || null,
    sol: majors?.sol || null,
    global,
    fearGreed,
    derivs,
    oiLiq,
    takerFlowUsd,
    calendar,
    headlines,
    equities,
    ts: Date.now(),
  };
}
