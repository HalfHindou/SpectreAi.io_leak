/**
 * Vercel Serverless – Market Intelligence proxy.
 * Handles /api/market/* routes: funding, oi, ls-ratio, global, tickers, ai-analyse.
 * In dev these are served by Express; in prod this serverless function handles them.
 */

import { getShowcaseValue, setShowcaseValue } from '../kv.js';
import { generateStockBrief, generateCryptoBrief } from '../marketBrief.js';
import { binanceFetch } from '../market-snapshot.js';

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';
const COINGECKO_HEADER_KEY = 'x-cg-pro-api-key';

const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';

// In-memory cache (per serverless instance)
const _cache = {};
function getCached(key, ttlMs) {
  const e = _cache[key];
  if (!e || Date.now() - e.ts > ttlMs) return null;
  return e.data;
}
function setCache(key, data) {
  _cache[key] = { data, ts: Date.now() };
}

const CACHE_TTL = 30_000; // 30s default

// binanceFetch (direct -> codetabs -> allorigins geo-proxy chain) now lives in
// market-snapshot.js so the AI Market brief can share it without a cycle.

async function handleFunding() {
  const cached = getCached('funding', CACHE_TTL);
  if (cached) return cached;
  const [btcData, ethData] = await Promise.all([
    binanceFetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'),
    binanceFetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=1'),
  ]);
  const result = {
    btc: Array.isArray(btcData) && btcData[0] ? parseFloat(btcData[0].fundingRate) * 100 : 0,
    eth: Array.isArray(ethData) && ethData[0] ? parseFloat(ethData[0].fundingRate) * 100 : 0,
    btcTime: Array.isArray(btcData) && btcData[0]?.fundingTime,
    ethTime: Array.isArray(ethData) && ethData[0]?.fundingTime,
  };
  setCache('funding', result);
  return result;
}

async function handleOI() {
  const cached = getCached('oi', CACHE_TTL);
  if (cached) return cached;
  const [btcData, ethData] = await Promise.all([
    binanceFetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
    binanceFetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT'),
  ]);
  const result = {
    btc: btcData?.openInterest ? parseFloat(btcData.openInterest) : 0,
    eth: ethData?.openInterest ? parseFloat(ethData.openInterest) : 0,
  };
  setCache('oi', result);
  return result;
}

async function handleLSRatio() {
  const cached = getCached('lsRatio', CACHE_TTL);
  if (cached) return cached;
  const data = await binanceFetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1');
  const entry = Array.isArray(data) ? data[0] : null;
  const result = {
    ratio: entry ? parseFloat(entry.longShortRatio) : 1,
    longs: entry ? parseFloat(entry.longAccount) * 100 : 50,
    shorts: entry ? parseFloat(entry.shortAccount) * 100 : 50,
    timestamp: entry?.timestamp,
  };
  setCache('lsRatio', result);
  return result;
}

async function handleGlobal() {
  const cached = getCached('global', 60_000); // 1 min TTL
  if (cached) return cached;
  const opts = { headers: {} };
  if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
  const response = await fetch(`${COINGECKO_BASE}/global`, opts);
  const json = await response.json();
  const d = json.data;
  const result = {
    totalMarketCap: d?.total_market_cap?.usd || 0,
    totalVolume: d?.total_volume?.usd || 0,
    btcDominance: d?.market_cap_percentage?.btc || 0,
    ethDominance: d?.market_cap_percentage?.eth || 0,
    solDominance: d?.market_cap_percentage?.sol || 0,
    marketCapChange24h: d?.market_cap_change_percentage_24h_usd || 0,
    activeCryptos: d?.active_cryptocurrencies || 0,
    updatedAt: d?.updated_at || 0,
  };
  setCache('global', result);
  return result;
}

async function handleTickers() {
  const cached = getCached('tickers', CACHE_TTL);
  if (cached) return cached;
  const data = await binanceFetch('https://api.binance.com/api/v3/ticker/24hr', { timeoutMs: 12000 });
  if (!Array.isArray(data)) {
    const fallback = { topGainers: [], topLosers: [], majorCoins: {}, totalPairs: 0 };
    setCache('tickers', fallback);
    return fallback;
  }
  const usdtPairs = data
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
    .map(t => ({
      symbol: t.symbol.replace('USDT', ''),
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.priceChangePercent),
      volume: parseFloat(t.quoteVolume),
      high: parseFloat(t.highPrice),
      low: parseFloat(t.lowPrice),
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const majorCoins = {};
  ['BTC', 'ETH', 'SOL'].forEach(sym => {
    const t = usdtPairs.find(p => p.symbol === sym);
    if (t) majorCoins[sym.toLowerCase()] = t;
  });
  const result = {
    topGainers: usdtPairs.filter(t => t.change > 0).slice(0, 10),
    topLosers: usdtPairs.filter(t => t.change < 0).slice(0, 10),
    majorCoins,
    totalPairs: usdtPairs.length,
  };
  setCache('tickers', result);
  return result;
}

// Spectre data-api aggregates used to backfill fields the Binance-derived
// primary can't produce. Mirrors the Express spectreTotalOiUsd/spectreLiqWindow.
const SPECTRE_V1_KEY = process.env.SPECTRE_DATA_BRIDGE_KEY || SPECTRE_API_KEY;
async function fetchSpectreV1(path) {
  const r = await fetch(`${SPECTRE_API_BASE}/v1${path}`, {
    headers: { 'X-API-Key': SPECTRE_V1_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`spectre v1 ${path} ${r.status}`);
  return r.json();
}
async function spectreTotalOiUsd() {
  const j = await fetchSpectreV1('/derivatives/open-interest?limit=500');
  let total = Number(j?.meta?.total_oi_usd) || 0;
  if (!total) {
    const rows = Array.isArray(j?.data) ? j.data : [];
    total = rows.reduce((s, r) => s + (Number(r?.oi_usd ?? r?.total_oi_usd) || 0), 0);
  }
  if (!total) throw new Error('spectre oi empty');
  return total;
}
async function spectreLiqWindow(range = '24h') {
  const j = await fetchSpectreV1('/derivatives/liquidation-windows');
  const w = j?.data?.windows?.[range] || j?.windows?.[range];
  const long = Number(w?.long) || 0;
  const short = Number(w?.short) || 0;
  const total = Number(w?.total) || long + short;
  if (!total) throw new Error(`spectre liq window ${range} empty`);
  return { long, short, total };
}

// Backfill /api/market/ai-analyse with fields its consumers read but the
// Binance-derived primary can't carry: `openInterest` (Liquidation Heatmap
// header read it and ALWAYS got undefined -> $0 OI in prod) and non-empty
// liquidation windows. Both come from our Spectre data-api; failures leave
// the result untouched (consumers guard). Mirrors Express enrichAiAnalyse.
async function enrichAiAnalyse(result) {
  try {
    if (!result.openInterest) result.openInterest = await spectreTotalOiUsd();
  } catch (_) { /* leave unset - consumers guard */ }
  try {
    if (!result.liquidations?.total) {
      const w = await spectreLiqWindow('24h');
      result.liquidations = { long: w.long, short: w.short, total: w.total };
    }
  } catch (_) { /* keep whatever the primary produced */ }
}

// Primary upstream removed — the dashboard_ai_market Cloud Run service is gone.
// The Binance-derived fallback below is now the canonical source.
async function handleAIAnalyse() {
  const cached = getCached('aiAnalyse', CACHE_TTL);
  if (cached) return cached;

  // Binance-derived: funding (BTC/ETH avg) + whale flow (taker-buy net delta).
  const [fundingRaw, klinesRaw] = await Promise.all([
    Promise.all([
      binanceFetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'),
      binanceFetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=1'),
    ]),
    Promise.all(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map(sym =>
      binanceFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=24`)
    )),
  ]);
  const btcFr = Array.isArray(fundingRaw[0]) && fundingRaw[0][0] ? parseFloat(fundingRaw[0][0].fundingRate) : 0;
  const ethFr = Array.isArray(fundingRaw[1]) && fundingRaw[1][0] ? parseFloat(fundingRaw[1][0].fundingRate) : 0;
  const fundingAvgPct = ((btcFr + ethFr) / 2) * 100;
  let whaleFlowUsd = 0;
  for (const rows of klinesRaw) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      whaleFlowUsd += 2 * (parseFloat(row[10]) || 0) - (parseFloat(row[7]) || 0);
    }
  }
  const result = {
    fundingAvgPct,
    liquidations: { long: 0, short: 0, total: 0 },
    whaleFlowUsd,
    regime: 'NEUTRAL',
    state: 'Degraded',
    change24h: {},
    asText: {},
    _source: 'fallback',
    windowMinutes: 1440,
    ts: Date.now(),
  };
  await enrichAiAnalyse(result);
  setCache('aiAnalyse', result);
  return result;
}

const SECTOR_TTL = 300_000; // 5 min

// CoinGecko categories returns { id, name, market_cap, market_cap_change_24h,
// top_3_coins, volume_24h, content } per category. We adapt to the legacy
// `welcome/sectors` shape so the existing useSectorData consumer is happy.
async function fetchCgCategories() {
  const cached = getCached('cg-categories', SECTOR_TTL);
  if (cached) return cached;
  const opts = { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) };
  if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
  const resp = await fetch(`${COINGECKO_BASE}/coins/categories`, opts);
  if (!resp.ok) throw new Error(`CG categories HTTP ${resp.status}`);
  const data = await resp.json();
  setCache('cg-categories', data);
  return data;
}

function deriveLifecycle(cat) {
  const change = Math.abs(cat?.market_cap_change_24h || 0);
  const cap = cat?.market_cap || 0;
  if (cap > 50e9) return 'mature';
  if (cap > 5e9) return 'established';
  if (change > 5) return 'growth';
  return 'established';
}

function derivePerformance(change) {
  const c = Number(change || 0);
  if (c >= 8) return 'very_strong';
  if (c >= 3) return 'strong';
  if (c <= -5) return 'weak';
  if (c <= -1) return 'flat';
  return 'positive';
}

async function handleSectors() {
  const cached = getCached('sectors', SECTOR_TTL);
  if (cached) return cached;
  const cats = await fetchCgCategories();
  const sectors = cats
    .filter((c) => c?.id && c?.name)
    .slice(0, 30)
    .map((c) => ({
      sector_id: c.id,
      sector_name: c.name,
      change_24h: Number(c.market_cap_change_24h ?? 0),
      volume: Number(c.volume_24h ?? 0),
      market_cap: Number(c.market_cap ?? 0),
      lifecycle: deriveLifecycle(c),
      performance: derivePerformance(c.market_cap_change_24h),
    }));
  const result = { sectors, cached_at: new Date().toISOString() };
  setCache('sectors', result);
  return result;
}

async function handleSectorsTopMovers() {
  const cached = getCached('sectors-top-movers', SECTOR_TTL);
  if (cached) return cached;
  const cats = await fetchCgCategories();
  // top_3_coins is a list of CoinGecko logo URLs only — no ticker/price/change
  // so we surface the *category itself* as the top mover (sector-level summary)
  // until we have a per-sector trending tokens endpoint.
  const top_movers = cats
    .filter((c) => c?.id && c?.name)
    .slice(0, 30)
    .map((c) => ({
      sector_id: c.id,
      top_mover: {
        ticker: (c.name || '').toUpperCase().slice(0, 6),
        name: c.name,
        change_24h: Number(c.market_cap_change_24h ?? 0),
        price: null,
        image: Array.isArray(c.top_3_coins) ? c.top_3_coins[0] : null,
      },
    }));
  const result = { top_movers };
  setCache('sectors-top-movers', result);
  return result;
}

async function handleSectorsAiAnalysis() {
  // No drop-in replacement — the dead Haitam endpoint produced editorial copy.
  // Return empty `{}` so the consumer's permissive renderer hides the banner.
  // TODO: build a Groq-driven sector summary off the `cats` payload above.
  return {};
}

// Adapts Spectre's flat-list mindshare response to the nested shape the
// Welcome → Mindshare tab consumer expects (cycle/highlights/curve/matrix/sectors).
function adaptMindshare(spectreData) {
  const items = Array.isArray(spectreData?.data) ? spectreData.data : (Array.isArray(spectreData) ? spectreData : []);
  if (!items.length) return { cycle: 'expansion', highlights: [], curve: [], matrix: [], sectors: [] };

  const highlights = items
    .filter((x) => x?.asset && x?.mindsharePct != null)
    .slice(0, 12)
    .map((x) => ({
      narrative: x.asset,
      mindshare_pct: Number(x.mindsharePct ?? 0),
      social_volume: Number(x.socialVolume ?? 0),
      sentiment_score: x.sentimentScore != null ? Number(x.sentimentScore) : null,
    }));

  const matrix = items
    .filter((x) => x?.asset)
    .slice(0, 30)
    .map((x) => ({
      narrative: x.asset,
      x: Number(x.mindsharePct ?? 0) / 100,
      y: x.sentimentScore != null ? (Number(x.sentimentScore) + 1) / 2 : 0.5,
      size: Math.max(4, Math.min(40, Number(x.socialVolume ?? 0) / 25)),
    }));

  // No time-series in this endpoint — leave curve empty.
  return {
    cycle: 'expansion',
    highlights,
    curve: [],
    matrix,
    sectors: [],
  };
}

async function handleMindshare() {
  const cached = getCached('mindshare', SECTOR_TTL);
  if (cached) return cached;
  const headers = { accept: 'application/json' };
  if (SPECTRE_API_KEY) headers['X-API-Key'] = SPECTRE_API_KEY;
  const resp = await fetch(`${SPECTRE_API_BASE}/v1/intelligence/mindshare`, {
    headers, signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Spectre mindshare HTTP ${resp.status}`);
  const data = await resp.json();
  const adapted = adaptMindshare(data);
  setCache('mindshare', adapted);
  return adapted;
}

// Market regime: forwards to /v1/market/regime. Cached 5min server-side.
// On upstream failure returns {} so the frontend's permissive renderer
// hides the fear-greed Reason card gracefully.
const REGIME_TTL_MS = 5 * 60 * 1000;
async function handleRegime() {
  const cached = getCached('regime', REGIME_TTL_MS);
  if (cached) return cached;
  if (!SPECTRE_API_KEY) {
    console.warn('[market-intel] regime: SPECTRE_API_KEY not configured');
    return {};
  }
  try {
    const resp = await fetch(`${SPECTRE_API_BASE}/v1/market/regime`, {
      headers: { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) {
      console.warn(`[market-intel] regime upstream HTTP ${resp.status}`);
      return {};
    }
    const data = await resp.json();
    if (!data || !data.data) return {};
    setCache('regime', data);
    return data;
  } catch (err) {
    console.warn('[market-intel] regime upstream error:', err.message);
    return {};
  }
}

async function handleAiMarketText(_req) {
  // 2026-05-13 SEC-20260513-017: serve cron-warmed showcase cache so the
  // marketing iframe gets real LLM output without burning Anthropic on
  // every visitor. Falls back to {} if cache is cold (cron hasn't run yet
  // or KV is empty) - consumer's permissive parser handles missing text
  // gracefully. The local Groq-driven Express route remains the canonical
  // source for the authenticated dashboard; this Vercel handler is
  // showcase-only.
  const timeframe = (_req?.query?.timeframe || '24h').toString();
  const market = (_req?.query?.market || 'crypto').toString();

  // Serve the cron-warmed 3-part brief (analysis / macroConditions /
  // positioning) for BOTH markets so the "AI Market" panel is catalyst-aware in
  // prod instead of falling back to the static client template. Warmed by
  // cron/warm-showcase.js -> showcase:market-brief:{market}:*; generated
  // ON-DEMAND on a cold cache so first load (before the 30-min cron) still shows
  // a real read. A short KV lock prevents a generation stampede.
  if (market === 'stocks' || market === 'crypto') {
    const tf = ['1h', '24h', '7d'].includes(timeframe) ? timeframe : '24h';
    const key = `showcase:market-brief:${market}:${tf}`;
    const gen = market === 'stocks' ? generateStockBrief : generateCryptoBrief;

    // For crypto, also surface the legacy 40-60 word showcase paragraph for any
    // consumer that still reads `.text` (the marketing iframe), alongside the
    // rich brief the dashboard reads from `.analysis`.
    let text = null;
    if (market === 'crypto') {
      try { text = (await getShowcaseValue(`showcase:market-text:${tf}`))?.text || null; } catch (_) {}
    }
    const shape = (b, cached) => ({
      analysis: b.analysis,
      macroConditions: b.macroConditions || '',
      positioning: b.positioning || '',
      sources: b.sources || [],
      ...(text ? { text } : {}),
      timeframe: tf,
      market,
      source: cached ? 'showcase-cache' : 'on-demand',
      generatedAt: b.generatedAt || null,
      cached: !!cached,
    });
    try {
      const cached = (await getShowcaseValue(key)) || (await getShowcaseValue(`showcase:market-brief:${market}:24h`));
      if (cached?.analysis) return shape(cached, true);

      const lockKey = `${key}:gen`;
      const locked = await getShowcaseValue(lockKey);
      if (!locked) {
        await setShowcaseValue(lockKey, { at: 'gen' }, 60);
        const fresh = await gen({ timeframe: tf });
        if (fresh?.analysis) {
          const stored = { ...fresh, timeframe: tf, market, generatedAt: Date.now() };
          await setShowcaseValue(key, stored, 1500); // 25 min - cron refreshes well within this
          return shape(stored, false);
        }
      }
    } catch (err) {
      console.warn(`[market-intel] ai-market-text ${market} brief error:`, err.message);
    }
    // Rich brief cold/locked/failed: fall back to the legacy paragraph (crypto)
    // so the marketing iframe and any `.text` consumer keeps working.
    if (text) return { text, timeframe: tf, market, source: 'showcase-cache', cached: true };
    return {};
  }

  try {
    const cached = await getShowcaseValue(`showcase:market-text:${timeframe}`);
    if (cached?.text) {
      return {
        text: cached.text,
        timeframe,
        source: 'showcase-cache',
        generatedAt: cached.generatedAt || null,
        cached: true,
      };
    }
  } catch (err) {
    console.warn('[market-intel] ai-market-text cache read error:', err.message);
  }
  return {};
}

// Altcoin Season Index - CoinMarketCap's canonical gauge via CMC's PUBLIC web
// data-api (no pro key). Mirrors the Express /api/market/alt-season route.
function normalizeAltSeason(data) {
  const d = data || {};
  const hv = d.historicalValues || {};
  const points = Array.isArray(d.points) ? d.points : [];
  const last = points.length ? points[points.length - 1] : null;
  const pick = (o) => (o && o.altcoinIndex != null && Number.isFinite(Number(o.altcoinIndex)) ? Math.round(Number(o.altcoinIndex)) : null);
  const index = pick(hv.now) ?? pick(last);
  return {
    index,
    value: index,
    market_cap_usd: Number(hv.now?.altcoinMarketcap ?? last?.altcoinMarketcap) || null,
    yesterday: pick(hv.yesterday),
    last_week: pick(hv.lastWeek),
    last_month: pick(hv.lastMonth),
    yearly_high: pick(hv.yearlyHigh),
    yearly_low: pick(hv.yearlyLow),
    source: 'coinmarketcap',
    generated_at: new Date().toISOString(),
  };
}

async function handleAltSeason() {
  const cached = getCached('alt-season', 10 * 60 * 1000);
  if (cached) return cached;
  const now = Math.floor(Date.now() / 1000);
  const start = now - 10 * 24 * 3600;
  const r = await fetch(
    `https://api.coinmarketcap.com/data-api/v3/altcoin-season/chart?start=${start}&end=${now}`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) throw new Error(`cmc ${r.status}`);
  const j = await r.json();
  const out = normalizeAltSeason(j?.data);
  if (out.index == null) throw new Error('no altcoinIndex in payload');
  setCache('alt-season', out);
  return out;
}

const DEFAULTS = {
  funding: { btc: 0, eth: 0 },
  oi: { btc: 0, eth: 0 },
  'ls-ratio': { ratio: 1, longs: 50, shorts: 50 },
  global: { totalMarketCap: 0, btcDominance: 56, ethDominance: 10 },
  tickers: { topGainers: [], topLosers: [], totalPairs: 0 },
  'ai-analyse': { fundingAvgPct: 0, liquidations: { long: 0, short: 0, total: 0 }, whaleFlowUsd: 0, regime: 'NEUTRAL', state: 'Unknown', change24h: {}, asText: {} },
  sectors: { sectors: [] },
  'sectors-top-movers': { top_movers: [] },
  'sectors-ai-analysis': {},
  mindshare: {},
  'ai-market-text': {},
  regime: {},
  'alt-season': { index: null, value: null },
};

const HANDLERS = {
  funding: handleFunding,
  oi: handleOI,
  'ls-ratio': handleLSRatio,
  global: handleGlobal,
  tickers: handleTickers,
  'ai-analyse': handleAIAnalyse,
  sectors: handleSectors,
  'sectors-top-movers': handleSectorsTopMovers,
  'sectors-ai-analysis': handleSectorsAiAnalysis,
  mindshare: handleMindshare,
  'ai-market-text': handleAiMarketText,
  regime: handleRegime,
  'alt-season': handleAltSeason,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const route = req.query.route;
  const fn = HANDLERS[route];

  if (!fn) {
    return res.status(400).json({ error: `Unknown route: ${route}` });
  }

  try {
    // Pass the request so cache-aware handlers (ai-market-text) can read
    // query params like ?timeframe=24h.
    const data = await fn(req);
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (err) {
    console.error(`market-intel/${route} error:`, err.message);
    return res.status(200).json(DEFAULTS[route] || {});
  }
}
