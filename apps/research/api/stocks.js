/**
 * Vercel Serverless — Stocks API proxy for Research app
 * Handles all /api/stocks/* routes by proxying Yahoo Finance + Finnhub
 *
 * Routes (via vercel.json rewrite):
 *   /api/stocks/candles?symbol=AAPL&interval=1h&range=1mo
 *   /api/stocks/quotes?symbols=AAPL,MSFT
 *   /api/stocks/search?q=apple
 *   /api/stocks/fundamentals/AAPL  (path param via query rewrite)
 *   /api/stocks/news/AAPL
 *   /api/stocks/quote/AAPL
 *   /api/stocks/movers
 *   /api/stocks/indices
 *   /api/stocks/analysts/AAPL
 */

import { isAuthGateValid } from './auth-gate.js';
// The Yahoo cookie+crumb now lives in _lib so the options board shares ONE
// session with this handler rather than racing it for a fresh crumb.
import { getYahooSession, invalidateYahooSession } from './_lib/yahoo-session.js';
import { rateLimit } from './_lib/ratelimit.js';
import { buildReportedFigures } from '../../../packages/server/lib/earnings-report-core.js';

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || 'demo';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Curated high-profile earnings watch list — the index-moving mega-caps
// (Jahangir's list: the names whose prints actually swing SPX/NDX/volatility).
// Used as the default set for /api/stocks/earnings when no ?symbols= is passed,
// so the Lite widget, Command Center widget and TG bot all render the SAME
// coherent set. Callers can still pass an explicit ?symbols= to override.
const EARNINGS_WATCHLIST = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'AVGO', 'META', 'TSLA', 'MU', 'AMD', 'INTC', 'SPCX'];

// The last DAILY close strictly before the current session, derived from a
// v8 chart result. meta.chartPreviousClose is the close before the RANGE
// start (5d/1mo ago on these requests) — using it shipped multi-week moves
// as "daily" change in prod: quotes fallback, fundamentals, trending AND the
// market indices that drive the stock-mode bias. The Express dev twin already
// derives this correctly (index.js candlePrevClose) — parity fix 2026-07-13.
function prevDailyClose(result) {
  const meta = result?.meta || {};
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const sessionDay = new Date((Number(meta.regularMarketTime) || Math.floor(Date.now() / 1000)) * 1000)
    .toISOString().slice(0, 10);
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] == null || !Number.isFinite(closes[i])) continue;
    if (new Date(ts[i] * 1000).toISOString().slice(0, 10) < sessionDay) return closes[i];
  }
  const pc = Number(meta.previousClose);
  return Number.isFinite(pc) && pc > 0 ? pc : null;
}
function dailyChangePct(result) {
  const px = Number(result?.meta?.regularMarketPrice);
  const prev = prevDailyClose(result);
  return Number.isFinite(px) && Number.isFinite(prev) && prev > 0 ? ((px - prev) / prev) * 100 : null;
}

// In-memory cache (persists across warm invocations)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min default
const CACHE_TTL_CANDLES = 2 * 60 * 1000; // 2 min for candles
const CACHE_TTL_FUNDAMENTALS = 60 * 60 * 1000; // 60 min for fundamentals (stable data)

function getCached(key, ttl = CACHE_TTL) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  // Evict old entries (keep cache bounded)
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}
// The scheduled print time we already know for a symbol, read WITHOUT extending
// the entry's life — used only to decide how long the next read may be cached.
// Reads the entry directly rather than via getCached so an expired-but-present
// payload still tells us a print just happened.
function cachedEarningsTs(symbol) {
  for (const key of [`fund:${symbol}`, `earn:${symbol}`]) {
    const d = cache.get(key)?.data;
    const iso = d?.earningsDate;
    if (iso) {
      const t = new Date(iso).getTime();
      if (isFinite(t)) return t;
    }
  }
  return null;
}

// ─── Route handlers ────────────────────────────────────────────────

async function handleCandles(req, res) {
  const symbol = (req.query.symbol || '').toUpperCase();
  const interval = req.query.interval || '1h';
  const range = req.query.range || '1mo';
  if (!symbol) return res.json({ bars: [] });

  const ck = `candles:${symbol}:${interval}:${range}`;
  const cached = getCached(ck, CACHE_TTL_CANDLES);
  if (cached) return res.json(cached);

  // Encoded, matching the dev twin (packages/server/index.js): index and
  // class-share tickers carry `^` and `.`, and unencoded they break the Yahoo
  // path in prod only — ^GSPC / ^VIX / BRK.B charted in dev and came back empty
  // on app.spectreai.io.
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Yahoo chart ${response.status}`);
  const data = await response.json();

  if (data?.chart?.result?.[0]) {
    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const bars = timestamps.map((t, i) => ({
      t, o: quote.open?.[i] || 0, h: quote.high?.[i] || 0,
      l: quote.low?.[i] || 0, c: quote.close?.[i] || 0, v: quote.volume?.[i] || 0,
    })).filter(bar => bar.o > 0 && bar.c > 0);

    const result2 = { bars };
    setCache(ck, result2);
    return res.json(result2);
  }
  res.json({ bars: [] });
}

async function handleQuotes(req, res) {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean).map(s => s.trim().toUpperCase());
  if (symbols.length === 0) return res.json({});

  const ck = `quotes:${symbols.join(',')}`;
  const cached = getCached(ck);
  if (cached) return res.json(cached);

  const quotes = {};

  // Primary: Yahoo v7 batch quote (crumbed) - includes real marketCap.
  // The v8 chart meta does NOT carry marketCap, so heatmap tile sizing needs this.
  // Chunk by 50 to keep each request URL well under length limits.
  try {
    const session = await getYahooSession();
    if (session.crumb && session.cookie) {
      const chunks = [];
      for (let i = 0; i < symbols.length; i += 50) chunks.push(symbols.slice(i, i + 50));
      await Promise.all(chunks.map(async (chunk) => {
        const qUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(session.crumb)}`;
        const r = await fetch(qUrl, {
          headers: { 'User-Agent': UA, 'Cookie': session.cookie },
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) return;
        const data = await r.json();
        for (const it of (data?.quoteResponse?.result || [])) {
          const sym = (it.symbol || '').toUpperCase();
          if (!sym || !(it.regularMarketPrice > 0)) continue;
          quotes[sym] = {
            symbol: sym,
            name: it.longName || it.shortName || sym,
            price: it.regularMarketPrice,
            previousClose: it.regularMarketPreviousClose || 0,
            change: typeof it.regularMarketChangePercent === 'number'
              ? it.regularMarketChangePercent
              : (it.regularMarketPrice && it.regularMarketPreviousClose
                ? ((it.regularMarketPrice - it.regularMarketPreviousClose) / it.regularMarketPreviousClose) * 100
                : 0),
            volume: it.regularMarketVolume || 0,
            marketCap: it.marketCap || 0,
            exchange: it.fullExchangeName || it.exchange || '',
            sector: '',
          };
        }
      }));
    }
  } catch (e) { /* fall through to v8 chart */ }

  // Fallback: Yahoo v8 chart per-symbol (no crumb) for any symbol v7 missed.
  // v8 lacks marketCap, but at least price/change stay live and accurate.
  const missing = symbols.filter(s => !quotes[s]);
  if (missing.length > 0) {
    await Promise.all(missing.map(async (sym) => {
      try {
        const url = `${YAHOO_CHART_URL}/${sym}?interval=1d&range=1mo`;
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
        if (!r.ok) return;
        const data = await r.json();
        const chartResult = data?.chart?.result?.[0];
        const meta = chartResult?.meta;
        if (meta) {
          // Recent daily closes for the welcome-hero sparkline (same field crypto
          // uses). Only this v8 path has candle data - the v7 primary path above
          // carries no closes, so hero charts in prod depend on the v8 fallback.
          const closes = (chartResult?.indicators?.quote?.[0]?.close || [])
            .filter(c => c !== null && c > 0);
          quotes[sym] = {
            symbol: sym,
            name: meta.longName || meta.shortName || sym,
            price: meta.regularMarketPrice || 0,
            previousClose: prevDailyClose(chartResult) || 0,
            change: dailyChangePct(chartResult) ?? 0,
            sparkline_7d: closes.slice(-14),
            volume: meta.regularMarketVolume || 0,
            marketCap: meta.marketCap || 0,
            exchange: meta.exchangeName || '',
            sector: '',
          };
        }
      } catch (e) { /* skip */ }
    }));
  }

  setCache(ck, quotes);
  res.json(quotes);
}

async function handleQuoteSingle(req, res) {
  const symbol = (req.query.sym || '').toUpperCase();
  if (!symbol) return res.json(null);
  // Reuse quotes logic
  req.query.symbols = symbol;
  const origJson = res.json.bind(res);
  let result = null;
  res.json = (data) => { result = data; };
  await handleQuotes(req, res);
  res.json = origJson;
  return res.json(result?.[symbol] || null);
}

async function handleSearch(req, res) {
  const q = req.query.q || '';
  if (!q) return res.json([]);

  const ck = `search:${q.toLowerCase()}`;
  const cached = getCached(ck);
  if (cached) return res.json(cached);

  const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0`;
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Yahoo search ${response.status}`);
  const data = await response.json();

  const results = (data?.quotes || [])
    .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
    .map(r => ({
      symbol: r.symbol,
      name: r.shortname || r.longname || r.symbol,
      type: r.quoteType,
      exchange: r.exchange || r.exchDisp || '',
      sector: r.sector || '',
    }))
    .slice(0, 12);

  setCache(ck, results);
  res.json(results);
}

async function handleFundamentals(req, res) {
  const symbol = (req.query.sym || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const ck = `fund:${symbol}`;
  // Fundamentals are "stable data" for 60 min — except in the hours after a
  // print, which is the one window where the whole page is about to change.
  // SPCX reported 2026-08-04 20:00 UTC; the earnings tab kept serving the
  // pre-print payload while the wire was already carrying the beat (founder:
  // "i can see news fire but app didnt update"). Inside the print window we
  // re-check often so the actual lands as soon as the vendor publishes it.
  const prevEarningsTs = cachedEarningsTs(symbol);
  const inPrintWindow =
    prevEarningsTs != null &&
    Date.now() - prevEarningsTs >= 0 &&
    Date.now() - prevEarningsTs <= 36 * 60 * 60 * 1000;
  const ttl = inPrintWindow ? 3 * 60 * 1000 : CACHE_TTL_FUNDAMENTALS;
  if (inPrintWindow) {
    // …and don't let the CDN hold the stale copy for another 15 minutes either
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  }
  const cached = getCached(ck, ttl);
  if (cached) return res.json(cached);

  // Fetch Yahoo quoteSummary + chart price + Finnhub profile in parallel
  const [summaryRes, chartRes, profileRes] = await Promise.allSettled([
    (async () => {
      const session = await getYahooSession();
      if (!session.cookie || !session.crumb) return null;
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,defaultKeyStatistics,summaryDetail,assetProfile,calendarEvents,financialData,recommendationTrend,earningsHistory&crumb=${encodeURIComponent(session.crumb)}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cookie': session.cookie },
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 401) { invalidateYahooSession(); return null; }
      if (!r.ok) return null;
      return r.json();
    })(),
    (async () => {
      const url = `${YAHOO_CHART_URL}/${symbol}?interval=1d&range=5d`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return r.json();
    })(),
    (async () => {
      if (FINNHUB_API_KEY === 'demo') return null;
      const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return r.json();
    })(),
  ]);

  const summary = summaryRes.status === 'fulfilled' ? summaryRes.value : null;
  const chart = chartRes.status === 'fulfilled' ? chartRes.value : null;
  const profile = profileRes.status === 'fulfilled' ? profileRes.value : null;

  const price = summary?.quoteSummary?.result?.[0]?.price;
  const stats = summary?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
  const detail = summary?.quoteSummary?.result?.[0]?.summaryDetail;
  const assetProfile = summary?.quoteSummary?.result?.[0]?.assetProfile;
  const calendar = summary?.quoteSummary?.result?.[0]?.calendarEvents;
  const finData = summary?.quoteSummary?.result?.[0]?.financialData;
  const recTrend0 = summary?.quoteSummary?.result?.[0]?.recommendationTrend?.trend?.[0] || null;
  const meta = chart?.chart?.result?.[0]?.meta;
  // Next earnings date (unix seconds) — Yahoo returns a window [start, end];
  // take the first. Feeds the equity thesis "earnings gap risk" warning.
  const earningsTs = calendar?.earnings?.earningsDate?.[0]?.raw || null;
  // Historical earnings (last quarters) — actual vs estimate EPS + surprise.
  // Feeds the Markets → Earnings sub-tab beat/miss track record.
  const earningsHistoryRaw = summary?.quoteSummary?.result?.[0]?.earningsHistory?.history;
  const earningsHistory = Array.isArray(earningsHistoryRaw)
    ? earningsHistoryRaw
        .filter(h => h && (h.epsActual?.raw != null || h.epsEstimate?.raw != null))
        .map(h => ({
          date: h.quarter?.raw ? new Date(h.quarter.raw * 1000).toISOString() : null,
          quarter: h.quarter?.fmt || null,
          epsActual: h.epsActual?.raw ?? null,
          epsEstimate: h.epsEstimate?.raw ?? null,
        }))
        .slice(-8)
    : [];

  const domain = (profile?.weburl || assetProfile?.website || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')
    || `${symbol.toLowerCase()}.com`;

  const result = {
    symbol,
    name: profile?.name || meta?.longName || meta?.shortName || symbol,
    description: profile?.description || assetProfile?.longBusinessSummary || '',
    sector: profile?.finnhubIndustry || assetProfile?.sector || '',
    industry: assetProfile?.industry || profile?.finnhubIndustry || '',
    exchange: profile?.exchange || meta?.exchangeName || '',
    country: profile?.country || 'US',
    currency: profile?.currency || 'USD',
    logo: profile?.logo || `https://companiesmarketcap.com/img/company-logos/256/${symbol === 'GOOGL' ? 'GOOG' : symbol}.webp`,
    website: profile?.weburl || assetProfile?.website || '',
    ipo: profile?.ipo || null,
    ceo: assetProfile ? (assetProfile.companyOfficers || []).find(o => /CEO|Chief Executive/i.test(o.title))?.name || null : null,
    marketCap: price?.marketCap?.raw || (profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : 0) || meta?.marketCap || 0,
    pe: detail?.trailingPE?.raw || price?.trailingPE?.raw || null,
    forwardPe: detail?.forwardPE?.raw || stats?.forwardPE?.raw || null,
    eps: stats?.trailingEps?.raw || null,
    sharesOutstanding: stats?.sharesOutstanding?.raw || (profile?.shareOutstanding ? profile.shareOutstanding * 1_000_000 : 0),
    // Yahoo returns a FRACTION (0.0044) — convert to percent or the UI prints "0.00%"
    dividendYield: detail?.dividendYield?.raw != null ? detail.dividendYield.raw * 100 : null,
    beta: stats?.beta?.raw || null,
    employees: profile?.employeeTotal || assetProfile?.fullTimeEmployees || null,
    price: meta?.regularMarketPrice || price?.regularMarketPrice?.raw || 0,
    change: dailyChangePct(chart?.chart?.result?.[0])
      ?? (price?.regularMarketChangePercent?.raw != null ? price.regularMarketChangePercent.raw * 100 : 0),
    previousClose: prevDailyClose(chart?.chart?.result?.[0]) || price?.regularMarketPreviousClose?.raw || null,
    open: price?.regularMarketOpen?.raw || null,
    high: price?.regularMarketDayHigh?.raw || null,
    low: price?.regularMarketDayLow?.raw || null,
    week52High: detail?.fiftyTwoWeekHigh?.raw || null,
    week52Low: detail?.fiftyTwoWeekLow?.raw || null,
    earningsDate: earningsTs ? new Date(earningsTs * 1000).toISOString() : null,
    // Earnings estimates for the upcoming print (calendarEvents)
    earningsAvg: calendar?.earnings?.earningsAverage?.raw ?? null,
    revenueAvg: calendar?.earnings?.revenueAverage?.raw ?? null,
    // Past prints (actual vs estimate EPS) — Markets → Earnings tab
    earningsHistory,
    // Analyst consensus (financialData + recommendationTrend, current month)
    targetMeanPrice: finData?.targetMeanPrice?.raw ?? null,
    targetHighPrice: finData?.targetHighPrice?.raw ?? null,
    targetLowPrice: finData?.targetLowPrice?.raw ?? null,
    recommendationKey: finData?.recommendationKey || null,
    analystCount: finData?.numberOfAnalystOpinions?.raw ?? null,
    recTrend: recTrend0 ? {
      strongBuy: recTrend0.strongBuy || 0,
      buy: recTrend0.buy || 0,
      hold: recTrend0.hold || 0,
      sell: recTrend0.sell || 0,
      strongSell: recTrend0.strongSell || 0,
    } : null,
    volume: price?.regularMarketVolume?.raw || meta?.regularMarketVolume || 0,
    avgVolume: price?.averageDailyVolume3Month?.raw || 0,
    sources: {
      fundamentals: price ? 'yahoo_summary' : 'chart',
      profile: profile ? 'finnhub' : 'yahoo',
      quote: meta ? 'yahoo' : 'none',
    },
    updatedAt: new Date().toISOString(),
  };

  setCache(ck, result);
  res.json(result);
}


// ── The t.me flash wires ────────────────────────────────────────────────────
// The absolute figure ("$7.8 billion in revenue") broke HERE at 20:04 UTC —
// 20 minutes before any aggregator carried it and well over an hour before the
// vendor. The public preview pages are free, unauthenticated and already the
// TG bot's fastest lane, so the app reads the same source rather than waiting
// for the number to reach slower media (founder 08-04: "everyone is talking
// about the spcx figure ... u wait on yahoo").
const TME_WIRES = ['WatcherGuru', 'TreeNewsFeed', 'BWEnews'];
async function fetchTmeWire(symbol, companyName) {
  const needleParts = [symbol.toLowerCase()];
  if (companyName) {
    // First meaningful word of the name ("Space Exploration…" -> "space"), so a
    // headline that spells the company out is matched as readily as the ticker.
    const w = String(companyName).replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/)[0];
    if (w && w.length > 2) needleParts.push(w.toLowerCase());
  }
  const out = [];
  await Promise.all(TME_WIRES.map(async (ch) => {
    try {
      const r = await fetch(`https://t.me/s/${ch}`, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) return;
      const raw = await r.text();
      for (const block of raw.split('tgme_widget_message_wrap').slice(1)) {
        const m = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (!m) continue;
        const when = block.match(/<time datetime="([^"]+)"/)?.[1] || null;
        const text = m[1]
          .replace(/<br\/?>/g, ' ').replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
          // 🪤 t.me encodes '$' as &#036; — decoding only the NAMED entities left
          // "reports &#036;7.8 billion in revenue" with no dollar sign for the
          // figure patterns to anchor on, so the headline number was invisible.
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
          .replace(/\s+/g, ' ').trim();
        const low = text.toLowerCase();
        if (!needleParts.some((n) => low.includes(n))) continue;
        // The channel handle is a signature, not part of the story.
        out.push({ title: text.replace(new RegExp(`@${ch}\\s*$`, 'i'), '').trim(), source: 'Newswire', published_at: when });
      }
    } catch (_) { /* one wire down must not sink the rest */ }
  }));
  return out;
}

/**
 * handleReported — the printed figures, from the FASTEST source that has them.
 *
 * Founder 2026-08-04: "earnings should come from fastest true source not from
 * old media like yahoo if they are slow". The vendor's actual-vs-estimate row
 * lagged the wire by well over an hour on SPCX's print, so this reads the news
 * the page ALREADY has and extracts what the copy explicitly states. It never
 * invents: see earnings-report-core.js for the three rules that keep a backlog,
 * an IPO valuation or an analyst preview from being printed as a result.
 */
async function handleReported(req, res) {
  const symbol = (req.query.sym || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const ck = `reported:${symbol}`;
  const cached = getCached(ck, 2 * 60 * 1000); // a live print moves fast
  if (cached) return res.json(cached);

  // Reuse the calendar we already hold for the print time + Street numbers, so
  // the surprise is computed against the same consensus the rest of the page
  // shows rather than a second, possibly different, fetch.
  const cal = await handleEarningsForSymbol(symbol).catch(() => null);
  const companyName = String(req.query.name || '').trim();
  const articles = [];

  // The flash wires first — they carry the absolute figure minutes after the
  // print, which is the number everyone is quoting while slower media is still
  // writing the story.
  try { articles.push(...(await fetchTmeWire(symbol, companyName))); } catch (_) { /* ignore */ }

  // Company news (Finnhub / Google RSS) — the widest net, and what the News
  // rail on the page is already rendering.
  try {
    const r = await fetch(`https://${req.headers.host}/api/stocks/news/${encodeURIComponent(symbol)}`, {
      headers: { 'x-spectre-internal': process.env.INTERNAL_KEY || '' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j)) articles.push(...j); }
  } catch (_) { /* one source failing must not take the others down */ }

  // Google News — what the page's own News rail leads with, and where the
  // result headlines land ("Double Beat, Revenue Up 92%", "tops estimates").
  try {
    const r = await fetch(`https://${req.headers.host}/api/company-news?q=${encodeURIComponent(companyName || symbol)}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) {
        for (const n of j) articles.push({ title: n.headline || n.title, summary: n.summary || '', source: n.source || 'News', published_at: n.date || n.publishedOn || null });
      }
    }
  } catch (_) { /* ignore */ }

  // The desk's own macro wire — classified, and usually first to carry a print.
  try {
    const r = await fetch(`https://${req.headers.host}/data-api/v1/news/tradfi?hours=12&limit=60&order=recent`, {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = await r.json();
      for (const row of j?.data || []) {
        const assets = Array.isArray(row.assets) ? row.assets.map((a) => String(a).toUpperCase()) : [];
        if (assets.includes(symbol)) {
          articles.push({ title: row.headline, summary: row.context, source: 'Spectre Macro Wire', published_at: row.source_ts || row.ts });
        }
      }
    }
  } catch (_) { /* ignore */ }

  const reported = buildReportedFigures(articles, {
    printedAt: cal?.earningsDate || null,
    estimates: { eps: cal?.epsEstimate ?? null, revenue: cal?.revenueEstimate ?? null },
  });

  const payload = {
    symbol,
    printedAt: cal?.earningsDate || null,
    estimates: { eps: cal?.epsEstimate ?? null, revenue: cal?.revenueEstimate ?? null },
    ...reported,
  };
  if (reported.status === 'reported') setCache(ck, payload);
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.json(payload);
}

async function handleNews(req, res) {
  const symbol = (req.query.sym || '').toUpperCase();
  if (!symbol) return res.json([]);

  const ck = `news:${symbol}`;
  const cached = getCached(ck);
  if (cached) return res.json(cached);

  // Try Finnhub company news
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url = `${FINNHUB_BASE_URL}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const data = await r.json();
      const news = (data || []).slice(0, 20).map(n => ({
        id: n.id,
        headline: n.headline,
        summary: n.summary,
        source: n.source,
        url: n.url,
        image: n.image,
        datetime: n.datetime,
        related: n.related,
      }));
      setCache(ck, news);
      return res.json(news);
    }
  } catch (e) { /* fallthrough */ }

  res.json([]);
}

async function handleAnalysts(req, res) {
  const symbol = (req.query.sym || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const ck = `analysts:${symbol}`;
  const cached = getCached(ck, CACHE_TTL_FUNDAMENTALS);
  if (cached) return res.json(cached);

  try {
    const url = `${FINNHUB_BASE_URL}/stock/recommendation?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`Finnhub ${r.status}`);
    const data = await r.json();
    const latest = (data || [])[0] || {};

    const total = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0);
    let rating = 'N/A';
    if (total > 0) {
      const score = ((latest.strongBuy || 0) * 5 + (latest.buy || 0) * 4 + (latest.hold || 0) * 3 + (latest.sell || 0) * 2 + (latest.strongSell || 0) * 1) / total;
      if (score >= 4.2) rating = 'Strong Buy';
      else if (score >= 3.5) rating = 'Buy';
      else if (score >= 2.5) rating = 'Hold';
      else if (score >= 1.8) rating = 'Sell';
      else rating = 'Strong Sell';
    }

    const result = { ...latest, rating, history: (data || []).slice(0, 12) };
    setCache(ck, result);
    res.json(result);
  } catch (e) {
    res.json({ rating: 'N/A', history: [] });
  }
}

async function handleMovers(req, res) {
  const ck = 'movers';
  const cached = getCached(ck);
  if (cached) return res.json(cached);

  // Use Yahoo trending tickers
  try {
    const url = 'https://query1.finance.yahoo.com/v1/finance/trending/US?count=20';
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const data = await r.json();
      const symbols = (data?.finance?.result?.[0]?.quotes || []).map(q => q.symbol).filter(Boolean).slice(0, 15);
      if (symbols.length > 0) {
        // Get quotes for trending symbols
        const quotes = {};
        await Promise.all(symbols.map(async (sym) => {
          try {
            const cr = await fetch(`${YAHOO_CHART_URL}/${sym}?interval=1d&range=5d`, {
              headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4000)
            });
            if (!cr.ok) return;
            const cd = await cr.json();
            const cres = cd?.chart?.result?.[0];
            const meta = cres?.meta;
            if (meta) {
              quotes[sym] = {
                symbol: sym, name: meta.longName || meta.shortName || sym,
                price: meta.regularMarketPrice || 0,
                change: dailyChangePct(cres) ?? 0,
                volume: meta.regularMarketVolume || 0,
              };
            }
          } catch (e) { /* skip */ }
        }));
        const movers = Object.values(quotes).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        const result = {
          gainers: movers.filter(m => m.change > 0).slice(0, 5),
          losers: movers.filter(m => m.change < 0).slice(0, 5),
          active: movers.slice(0, 5),
        };
        setCache(ck, result);
        return res.json(result);
      }
    }
  } catch (e) { /* fallthrough */ }
  res.json({ gainers: [], losers: [], active: [] });
}

async function handleIndices(req, res) {
  const ck = 'indices';
  const cached = getCached(ck);
  if (cached) return res.json(cached);

  const indexSymbols = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX'];
  const indices = {};
  await Promise.all(indexSymbols.map(async (sym) => {
    try {
      const r = await fetch(`${YAHOO_CHART_URL}/${encodeURIComponent(sym)}?interval=1d&range=5d`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000)
      });
      if (!r.ok) return;
      const data = await r.json();
      const ires = data?.chart?.result?.[0];
      const meta = ires?.meta;
      if (meta) {
        indices[sym] = {
          symbol: sym, name: meta.longName || meta.shortName || sym,
          price: meta.regularMarketPrice || 0,
          change: dailyChangePct(ires) ?? 0,
        };
      }
    } catch (e) { /* skip */ }
  }));
  setCache(ck, indices);
  res.json(indices);
}

// ─── Main handler ──────────────────────────────────────────────────

// ── SEC EDGAR insider activity (keyless) ────────────────────────────────────
// Form 4 filings → per-transaction parse → 90d open-market net flow. Only
// code P (open-market purchase) and S (sale) count toward the net — option
// exercises / awards / tax withholding are compensation mechanics, not
// conviction. SEC requires a descriptive User-Agent; no API key needed.
const SEC_UA = 'SpectreAI research (research@spectreai.io)';
let _cikMap = null;
let _cikMapTs = 0;

async function secJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': SEC_UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`SEC ${r.status}`);
  return r.json();
}

async function cikForTicker(symbol) {
  if (!_cikMap || Date.now() - _cikMapTs > 24 * 3600 * 1000) {
    const raw = await secJson('https://www.sec.gov/files/company_tickers.json');
    _cikMap = new Map(Object.values(raw).map((e) => [String(e.ticker).toUpperCase(), e.cik_str]));
    _cikMapTs = Date.now();
  }
  return _cikMap.get(String(symbol).toUpperCase()) || null;
}

const TXN_KIND = { P: 'buy', S: 'sell', M: 'exercise', F: 'tax', A: 'award', G: 'gift', C: 'conversion', D: 'disposition' };

function parseForm4(xml) {
  const owner = (xml.match(/<rptOwnerName>([^<]+)/) || [])[1] || null;
  const title = (xml.match(/<officerTitle>([^<]+)/) || [])[1]
    || (/<isDirector>(1|true)/.test(xml) ? 'Director' : null);
  const txns = [];
  const re = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = m[1];
    const code = (t.match(/<transactionCode>([A-Z])/) || [])[1];
    const shares = Number((t.match(/<transactionShares>\s*<value>([\d.]+)/) || [])[1]);
    const price = Number((t.match(/<transactionPricePerShare>\s*<value>([\d.]+)/) || [])[1]);
    const date = (t.match(/<transactionDate>\s*<value>([\d-]+)/) || [])[1];
    if (!code || !Number.isFinite(shares)) continue;
    txns.push({ code, kind: TXN_KIND[code] || code, shares, price: Number.isFinite(price) ? price : null, date });
  }
  return { owner, title, txns };
}

async function handleInsiders(req, res) {
  const symbol = String(req.query.sym || req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
  const ck = `insiders:${symbol}`;
  const cached = getCached(ck, 6 * 3600 * 1000);
  if (cached) return res.json(cached);

  const cik = await cikForTicker(symbol);
  if (!cik) {
    const empty = { symbol, summary: null, filings: [], note: 'no SEC issuer match' };
    setCache(ck, empty);
    return res.json(empty);
  }
  const subs = await secJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`);
  const r = subs?.filings?.recent || {};
  const picks = [];
  for (let i = 0; i < (r.form || []).length && picks.length < 8; i++) {
    if (r.form[i] !== '4') continue;
    // recent list is date-desc — stop once filings age out of the window
    if (Date.now() - new Date(r.filingDate[i]).getTime() > 120 * 86400 * 1000) break;
    picks.push(i);
  }
  const filings = [];
  for (const i of picks) {
    try {
      const acc = r.accessionNumber[i].replace(/-/g, '');
      const doc = String(r.primaryDocument[i] || '').replace(/^.*\//, ''); // strip xsl render prefix → raw XML
      if (!doc.endsWith('.xml')) continue;
      const xr = await fetch(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${doc}`,
        { headers: { 'User-Agent': SEC_UA }, signal: AbortSignal.timeout(8000) });
      if (!xr.ok) continue;
      const parsed = parseForm4(await xr.text());
      for (const t of parsed.txns) {
        filings.push({
          owner: parsed.owner, title: parsed.title, ...t,
          value: t.price != null ? Math.round(t.shares * t.price) : null,
          filedAt: r.filingDate[i],
        });
      }
    } catch (e) { /* one bad filing never blanks the card */ }
  }
  const cutoff = Date.now() - 90 * 86400 * 1000;
  let buys = 0;
  let sells = 0;
  for (const f of filings) {
    if (!f.value || !f.date || new Date(f.date).getTime() < cutoff) continue;
    if (f.code === 'P') buys += f.value;
    else if (f.code === 'S') sells += f.value;
  }
  const payload = {
    symbol,
    summary: { buys90d: buys, sells90d: sells, netFlow90d: buys - sells, filingsParsed: filings.length },
    filings: filings.slice(0, 12),
  };
  setCache(ck, payload);
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=43200');
  return res.json(payload);
}

// Next-earnings for a batch of tickers — date + Street EPS/revenue estimates,
// pulled from Yahoo quoteSummary calendarEvents (the SAME source the per-symbol
// stock page uses, so the widgets/bot never disagree with the detail page).
// No ?symbols= -> the curated high-profile watch list. Per-symbol cached 60min
// (earnings dates barely move); the countdown is computed client-side off the
// returned date so it is always live and never a stale baked-in "N days".
async function handleEarningsForSymbol(symbol) {
  const ck = `earn:${symbol}`;
  const cached = getCached(ck, CACHE_TTL_FUNDAMENTALS);
  if (cached) return cached;

  let result = { symbol, name: symbol, earningsDate: null, earningsDateEnd: null, epsEstimate: null, revenueEstimate: null, isEstimate: false };
  try {
    const session = await getYahooSession();
    if (session.cookie && session.crumb) {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,calendarEvents&crumb=${encodeURIComponent(session.crumb)}`;
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': session.cookie }, signal: AbortSignal.timeout(6000) });
      if (r.status === 401) { invalidateYahooSession(); }
      else if (r.ok) {
        const json = await r.json();
        const node = json?.quoteSummary?.result?.[0];
        const price = node?.price;
        const cal = node?.calendarEvents?.earnings;
        const dates = Array.isArray(cal?.earningsDate) ? cal.earningsDate : [];
        const ts0 = dates[0]?.raw || null;
        const ts1 = dates[1]?.raw || null;
        result = {
          symbol,
          name: price?.longName || price?.shortName || symbol,
          earningsDate: ts0 ? new Date(ts0 * 1000).toISOString() : null,
          // Yahoo returns a [start,end] window when the date is still an estimate;
          // a single element means it is confirmed.
          earningsDateEnd: ts1 ? new Date(ts1 * 1000).toISOString() : null,
          epsEstimate: cal?.earningsAverage?.raw ?? null,
          revenueEstimate: cal?.revenueAverage?.raw ?? null,
          isEstimate: dates.length > 1,
        };
      }
    }
  } catch { /* degrade to the null skeleton — never fabricate a date */ }

  // Only cache real hits; a transient Yahoo miss shouldn't poison the 60min slot.
  if (result.earningsDate) setCache(ck, result);
  return result;
}

async function handleEarnings(req, res) {
  const raw = (req.query.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const symbols = (raw.length ? raw : EARNINGS_WATCHLIST).slice(0, 30);

  const ck = `earnings:${symbols.join(',')}`;
  const cached = getCached(ck, 30 * 60 * 1000);
  if (cached) return res.json(cached);

  const rows = await Promise.all(symbols.map(s => handleEarningsForSymbol(s).catch(() => null)));
  const earnings = rows
    .filter(r => r && r.earningsDate)
    .sort((a, b) => new Date(a.earningsDate).getTime() - new Date(b.earningsDate).getTime());

  const result = { earnings, count: earnings.length, updatedAt: new Date().toISOString() };
  setCache(ck, result);
  res.json(result);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Read-only public market data (Yahoo/Finnhub). Anonymous access is allowed
  // but rate-limited to protect upstream quotas; gated/team sessions get a
  // higher cap. Replaces the 2026-05-11 hard auth gate, which made anonymous
  // users get 401 and silently fall back to stale hardcoded prices
  // (e.g. pre-split NVDA $958 instead of the real ~$220).
  const _gated = isAuthGateValid(req);
  if (await rateLimit(req, res, { bucket: _gated ? 'stocks-gated' : 'stocks-anon', max: _gated ? 120 : 30, windowMs: 60_000 })) return;

  // Route is passed via query param from vercel.json rewrite
  const route = (req.query.route || '').toLowerCase();

  // SEC-20260521-STOCKS: Finnhub-backed, slow-changing actions get a longer edge
  // cache so anonymous repeat traffic hits Vercel's edge instead of the Finnhub
  // quota. Freshness-sensitive Yahoo actions (quote/quotes/candles/movers/indices/
  // search) keep the global s-maxage=60 set above.
  if (route === 'news' || route === 'analysts' || route === 'fundamentals' || route === 'earnings') {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  }

  try {
    switch (route) {
      case 'candles':
        return await handleCandles(req, res);
      case 'quotes':
        return await handleQuotes(req, res);
      case 'quote':
        return await handleQuoteSingle(req, res);
      case 'search':
        return await handleSearch(req, res);
      case 'fundamentals':
        return await handleFundamentals(req, res);
      case 'news':
        return await handleNews(req, res);
      case 'analysts':
        return await handleAnalysts(req, res);
      case 'movers':
        return await handleMovers(req, res);
      case 'indices':
        return await handleIndices(req, res);
      case 'insiders':
        return await handleInsiders(req, res);
      case 'earnings':
        return await handleEarnings(req, res);
      case 'reported':
        return await handleReported(req, res);
      default:
        return res.status(404).json({ error: `Unknown stock route: ${route}` });
    }
  } catch (err) {
    console.error(`Stocks API error (${route}):`, err.message);
    res.status(502).json({ error: 'Failed to fetch stock data', message: err.message });
  }
}
