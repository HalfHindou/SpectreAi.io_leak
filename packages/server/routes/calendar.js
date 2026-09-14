/**
 * Spectre Intelligence Hub — Calendar Analysis Routes
 * Serves AI-generated economic calendar content.
 *
 * GET  /api/calendar/analysis  — latest market outlook
 * GET  /api/calendar/themes    — latest dominant themes
 * GET  /api/calendar/verdict   — latest regime verdict
 * GET  /api/calendar/history   — past analyses for history timeline
 * POST /api/calendar/generate  — admin trigger for immediate regeneration
 */
const express = require('express');
const router = express.Router();
const { loadArticle, listArticles } = require('../content/store');
const { generateCalendarAnalysis, generateEventBrief } = require('../agents/calendarAnalysisAgent');

// ── GET /economic — Live Economic Calendar Events ───────────────────────────
// Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&impact=critical,high&currency=USD
// Stale-while-revalidate cache: serve stale data instantly, refresh in background.
// Fresh fetches happen on boot and whenever cache age exceeds FRESH_TTL.
const economicCache = {};
const FRESH_TTL = 5 * 60 * 1000;      // 5 min — considered "fresh"
const STALE_TTL = 60 * 60 * 1000;     // 1 hour — still served, triggers background refresh
const UPSTREAM_TIMEOUT_MS = 6000;     // per-source upstream timeout (was 10s)
let economicInflight = null;          // dedup concurrent refreshes

// EXT_CALENDAR_URL / EXT_EVENT_DET_URL pointed at the dead Haitam Cloud Run
// service. Calendar list now sources from Spectre `/v1/calendar?month=` + Spectre
// /v1/calendar?upcoming=true (already wired in fetchEconomicEvents). Event detail
// uses Spectre `/v1/ai/calendar-event/{eventId}`. The ext-api fallback is
// retained as an opportunistic supplement; if it 404s the rest of the response
// still flows through.
const EXT_IMPACT_MAP = { NONE: 'low', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };
const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const eventDetailCache = {};
const EVENT_DETAIL_TTL = 60 * 1000; // 60s — actual can update
const EVENT_ID_RE = /^[a-zA-Z0-9-_]{1,64}$/;

function stripHtml(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function mergeKey(evt) {
  const hour = (evt.dateTime || '').slice(0, 13); // YYYY-MM-DDTHH
  const name = (evt.name || '').toLowerCase().replace(/\W+/g, '');
  return `${hour}_${evt.currency || ''}_${name}`;
}

// ext-api source dead — Spectre `/v1/calendar?month=` covers the same window.
// Stubbed for compatibility with the existing Promise.all merge in
// fetchEconomicEvents; safe to remove once no callers reference it.
async function fetchExtApiEvents() {
  return [];
}

// TradingView public economic calendar — macro backbone (2026-06-10), same
// source the prod handler uses (apps/research/api/_lib/handlers/calendar-api.js).
// Full months of future events + actuals within minutes of release; the
// Spectre DB's FairEconomy-derived macro rows have neither.
const TV_CALENDAR_URL = 'https://economic-calendar.tradingview.com/events';
const TV_COUNTRIES = 'US,EU,DE,GB,JP,CN,CA,AU,NZ,CH,FR,IT,ES,KR,IN,BR,MX,ZA,TR,SG,HK,SE,NO,PL,NL';
// US-only critical tier (2026-06-11): Fed-relevant US prints own 'critical';
// non-US equivalents (EU CPI Flash, BoJ/BoE/RBA) stay 'high'. Michigan is
// deliberately excluded — survey prelims are context, not critical. Mirrors prod.
const TV_CRITICAL_RE = /inflation rate|consumer price|cpi|non.?farm|payroll|unemployment rate|interest rate decision|fomc|gdp growth|pce price|producer price|\bppi\b/i;

function tvImpact(raw) {
  const imp = typeof raw.importance === 'number' ? raw.importance : -1;
  if (imp >= 1) {
    return raw.country === 'US' && TV_CRITICAL_RE.test(raw.title || '') ? 'critical' : 'high';
  }
  if (imp === 0) return 'medium';
  return 'low';
}

// TV ships each value in two shapes: SCALED display (`actual: 57`, scale 'K')
// and raw base units (`forecastRaw: 110000`). Preferring Raw per-field mixed
// magnitudes inside one event (actual 57 vs forecast 110000) and broke every
// actual-vs-forecast comparison + rendered "110000K". Normalize to the scaled
// display shape. Mirrors prod (calendar-api.js).
const TV_SCALE_FACTORS = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
function tvValue(scaled, rawUnits, scale) {
  if (scaled != null && scaled !== '') return scaled;
  if (rawUnits == null || rawUnits === '') return null;
  const f = TV_SCALE_FACTORS[String(scale || '').toUpperCase()];
  return f ? rawUnits / f : rawUnits;
}

// Dev cache is a single range-agnostic pool, so fetch a fixed -2mo..+3mo
// window in month chunks (TV caps responses around 2000 rows).
async function fetchTradingViewEvents() {
  const now = new Date();
  const chunks = [];
  for (let m = -2; m < 3; m++) {
    chunks.push([
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1)),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m + 1, 1)),
    ]);
  }
  // Bounded concurrency + one jittered retry per chunk, and report which
  // month ranges failed both attempts so the caller can backfill them from
  // Spectre macro rows instead of serving holes (same policy as the prod
  // handler — a partial TV result must not blank whole months).
  const fetchChunk = async ([f, t], timeoutMs) => {
    const qs = new URLSearchParams({ from: f.toISOString(), to: t.toISOString(), countries: TV_COUNTRIES });
    const r = await fetch(`${TV_CALENDAR_URL}?${qs}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Origin: 'https://www.tradingview.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return Array.isArray(j?.result) ? j.result : [];
  };
  const results = new Array(chunks.length);
  const failedRanges = [];
  let nextIdx = 0;
  await Promise.all(Array.from({ length: Math.min(5, chunks.length) }, async () => {
    while (nextIdx < chunks.length) {
      const i = nextIdx++;
      try {
        results[i] = await fetchChunk(chunks[i], 8000);
      } catch (e1) {
        try {
          await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
          results[i] = await fetchChunk(chunks[i], 5000);
        } catch (e2) {
          console.warn('[calendar-routes] tradingview chunk failed twice:', e2.message);
          results[i] = [];
          failedRanges.push(chunks[i]);
        }
      }
    }
  }));

  const seen = new Set();
  const out = [];
  for (const raw of results.flat()) {
    if (!raw || raw.id == null || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const name = raw.title || raw.indicator || '';
    if (!name || !raw.date) continue;
    out.push({
      id: `tv-${raw.id}`,
      name,
      nameShort: name.length > 30 ? name.slice(0, 30) : name,
      country: raw.country || 'US',
      currency: (raw.currency || 'USD').toUpperCase(),
      category: categorizeEvent(name),
      impact: tvImpact(raw),
      dateTime: raw.date,
      previous: tvValue(raw.previous, raw.previousRaw, raw.scale),
      forecast: tvValue(raw.forecast, raw.forecastRaw, raw.scale),
      actual: tvValue(raw.actual, raw.actualRaw, raw.scale),
      unit: [raw.scale, raw.unit].filter(Boolean).join('') || null,
      description: '',
      affectedAssets: [],
      isFedEvent: /fed|fomc/i.test(name),
      isCrypto: false,
      source: 'tradingview',
      event_type: 'macro',
      url: raw.source_url || null,
    });
  }
  return { events: out, failedRanges };
}

function mergeEvents(primary, secondary) {
  // primary wins on dedup (keeps actual/forecast/previous). secondary fills description if missing.
  const map = new Map();
  for (const e of primary) map.set(mergeKey(e), e);
  for (const e of secondary) {
    const k = mergeKey(e);
    if (map.has(k)) {
      const existing = map.get(k);
      if (!existing.description && e.description) existing.description = e.description;
    } else {
      map.set(k, e);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
  );
}

async function fetchSpectreCalendar(url, headers) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn(`[calendar-routes] upstream ${url} failed:`, e.message);
    return null;
  }
}

// Fetches fresh events from all upstreams + normalizes + merges. Throws on total failure.
async function fetchEconomicEvents() {
  const spectreApiKey = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_API_KEY;
  const headers = spectreApiKey ? { 'X-API-Key': spectreApiKey } : null;
  const currentMonth = new Date().toISOString().slice(0, 7);
  // Use direct Hetzner origin — api.spectreai.io is CF-blocked for server-to-server.
  const apiBase = (process.env.SPECTRE_API_BASE || process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');

  const [monthJson, upcomingJson, extEvents, tvResult] = await Promise.all([
    headers ? fetchSpectreCalendar(`${apiBase}/v1/calendar?month=${currentMonth}&limit=500`, headers) : null,
    headers ? fetchSpectreCalendar(`${apiBase}/v1/calendar?upcoming=true&limit=500`, headers) : null,
    fetchExtApiEvents(),
    fetchTradingViewEvents(),
  ]);
  const tvEvents = tvResult.events;

  const monthData = monthJson?.data || [];
  const upcomingData = upcomingJson?.data || [];

  if (monthData.length === 0 && upcomingData.length === 0 && extEvents.length === 0 && tvEvents.length === 0) {
    throw new Error('all upstream calendar sources failed');
  }

  // Merge and deduplicate by id
  const seen = new Set();
  const rawEvents = [];
  for (const evt of [...monthData, ...upcomingData]) {
    const key = `${evt.id}`;
    if (!seen.has(key)) { seen.add(key); rawEvents.push(evt); }
  }

  const spectreNormalized = rawEvents.map((raw, i) => ({
    id: `sc-${raw.id || i}`,
    name: raw.title,
    nameShort: raw.title?.length > 30 ? raw.title.slice(0, 30) : raw.title,
    country: raw.country || 'US',
    currency:
      raw.country === 'EUR' ? 'EUR' :
      raw.country === 'GBP' ? 'GBP' :
      raw.country === 'JPY' ? 'JPY' :
      raw.country === 'CAD' ? 'CAD' :
      raw.country === 'AUD' ? 'AUD' :
      raw.country === 'CHF' ? 'CHF' :
      raw.country === 'NZD' ? 'NZD' :
      raw.country === 'USD' ? 'USD' : 'USD',
    category: raw.category ? raw.category.charAt(0).toUpperCase() + raw.category.slice(1) : categorizeEvent(raw.title),
    // Same critical-tier policy as tvImpact: non-US macro tops out at 'high'.
    impact: (() => {
      const imp = raw.impact_level || raw.impact || 'medium';
      const isMacro = !raw.event_type || raw.event_type === 'macro';
      const isUS = raw.country === 'US' || raw.country === 'USD' || !raw.country;
      return imp === 'critical' && isMacro && !isUS ? 'high' : imp;
    })(),
    dateTime: raw.date,
    // Mirror the event-detail normalizer's field fallback: the upstream list
    // feed publishes some released values under `actual`/`forecast`/`previous`
    // (not the `*_value` field), so list rows showed ACT —— for past events.
    // Use ?? (not ||) so a legit 0 / "0" isn't dropped.
    previous: raw.previous_value ?? raw.previous ?? null,
    forecast: raw.forecast_value ?? raw.forecast ?? raw.consensus ?? null,
    actual: raw.actual_value ?? raw.actual ?? null,
    affectedAssets: raw.asset ? [raw.asset] : [],
    isFedEvent: /fed|fomc/i.test(raw.title),
    isCrypto: ['unlock', 'governance', 'protocol', 'conference'].includes(raw.event_type),
    source: raw.source || 'spectre',
    event_type: raw.event_type || 'macro',
    url: raw.url || null,
  }));

  // Same policy as the prod handler: when TradingView delivered, it owns the
  // macro layer (full months + live actuals); Spectre contributes only its
  // crypto-native events. Spectre macro rows are FairEconomy-shaped names
  // that never merge-key against TV's -> keeping both doubles every event.
  // Ownership is per-month: ranges whose TV chunk failed both attempts get
  // backfilled with Spectre macro rows (no TV rows there -> nothing doubles).
  if (tvEvents.length > 0) {
    const spectreCrypto = spectreNormalized.filter(e => e.event_type && e.event_type !== 'macro');
    let events = mergeEvents(tvEvents, spectreCrypto);
    if (tvResult.failedRanges.length > 0) {
      const inFailedRange = (e) => {
        const t = new Date(e.dateTime).getTime();
        return tvResult.failedRanges.some(([f, until]) => t >= f.getTime() && t < until.getTime());
      };
      const backfill = spectreNormalized.filter(e => e.event_type === 'macro' && inFailedRange(e));
      if (backfill.length > 0) events = mergeEvents(events, backfill);
    }
    return events;
  }
  return mergeEvents(spectreNormalized, extEvents);
}

// Deduplicated refresh — only one upstream fetch in-flight at a time.
function refreshEconomicCache() {
  if (economicInflight) return economicInflight;
  economicInflight = fetchEconomicEvents()
    .then((events) => {
      economicCache.all = { data: events, timestamp: Date.now() };
      return events;
    })
    .catch((err) => {
      console.warn('[calendar-routes] refresh failed:', err.message);
      throw err;
    })
    .finally(() => { economicInflight = null; });
  return economicInflight;
}

// Warm cache on boot so the first user doesn't pay the cold-start bill.
refreshEconomicCache().catch(() => { /* logged inside */ });

function filterEvents(events, { from, to, impact, currency }) {
  let result = events;
  if (from) {
    const fromTime = new Date(from).getTime();
    result = result.filter(e => new Date(e.dateTime).getTime() >= fromTime);
  }
  if (to) {
    const toDate = new Date(to); toDate.setHours(23, 59, 59, 999);
    result = result.filter(e => new Date(e.dateTime).getTime() <= toDate.getTime());
  }
  if (impact) {
    const levels = impact.split(',').map(s => s.trim().toLowerCase());
    result = result.filter(e => levels.includes(e.impact));
  }
  if (currency) {
    const currencies = currency.split(',').map(s => s.trim().toUpperCase());
    result = result.filter(e => currencies.includes(e.currency));
  }
  return result;
}

router.get('/economic', async (req, res) => {
  try {
    const now = Date.now();
    const cached = economicCache.all;
    const age = cached ? now - cached.timestamp : Infinity;

    // Fresh cache — serve immediately.
    if (cached && age < FRESH_TTL) {
      const events = filterEvents(cached.data, req.query);
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
      return res.json({ events, total: events.length, source: 'api', cache: 'fresh' });
    }

    // Stale cache — serve now, refresh in background.
    if (cached && age < STALE_TTL) {
      refreshEconomicCache().catch(() => { /* logged inside */ });
      const events = filterEvents(cached.data, req.query);
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.json({ events, total: events.length, source: 'api', cache: 'stale' });
    }

    // No cache or too stale — must block until fresh (or fail).
    try {
      const fresh = await refreshEconomicCache();
      const events = filterEvents(fresh, req.query);
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
      return res.json({ events, total: events.length, source: 'api', cache: 'cold' });
    } catch (err) {
      // All upstreams failed on cold cache — return empty but don't 5xx.
      res.setHeader('Cache-Control', 'public, max-age=15');
      return res.json({ events: [], total: 0, source: 'empty' });
    }
  } catch (e) {
    console.error('[calendar-routes] /economic error:', e.message);
    res.status(500).json({ error: 'Internal error', events: [] });
  }
});

// ── GET /reaction — Real first-15-min market reaction (2026-06-11) ──────────
// Mirrors the prod handler (apps/research/api/_lib/handlers/calendar-api.js):
// BTC/ETH from the Spectre candle store (1m), TradFi from Yahoo intraday 5m
// (futures so 8:30 ET pre-market prints have bars). Instruments with no bars
// in the window are dropped, never invented.
const REACTION_YAHOO = [
  { symbol: 'SPX', yahoo: 'ES=F' },
  { symbol: 'NDX', yahoo: 'NQ=F' },
  { symbol: 'DXY', yahoo: 'DX-Y.NYB' },
  { symbol: 'GOLD', yahoo: 'GC=F' },
  { symbol: 'US10Y', yahoo: '^TNX' },
  { symbol: 'WTI', yahoo: 'CL=F' },
];
const REACTION_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

async function fetchCryptoReaction(asset, t0ms) {
  try {
    const apiKey = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_API_KEY;
    const from = new Date(t0ms - 6 * 60e3).toISOString();
    const to = new Date(t0ms + 16 * 60e3).toISOString();
    const r = await fetch(
      `${SPECTRE_API_BASE}/v1/candles/${asset}?interval=1m&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { signal: AbortSignal.timeout(8000), headers: apiKey ? { 'X-API-Key': apiKey } : {} },
    );
    if (!r.ok) return null;
    const candles = (await r.json())?.data || [];
    if (!Array.isArray(candles) || candles.length < 2) return null;
    const rows = candles
      .map(c => ({ t: new Date(c.time).getTime(), close: Number(c.close) }))
      .filter(c => Number.isFinite(c.t) && Number.isFinite(c.close))
      .sort((a, b) => a.t - b.t);
    const beforeRow = [...rows].reverse().find(c => c.t < t0ms);
    const afterRow = [...rows].reverse().find(c => c.t <= t0ms + 15 * 60e3);
    if (!beforeRow || !afterRow || afterRow.t <= beforeRow.t) return null;
    return {
      symbol: asset,
      before: beforeRow.close,
      after: afterRow.close,
      changePct: +(((afterRow.close - beforeRow.close) / beforeRow.close) * 100).toFixed(2),
      series: rows.filter(c => c.t >= t0ms - 5 * 60e3).map(c => c.close),
    };
  } catch (e) {
    console.warn(`[calendar-routes] reaction ${asset} candles failed:`, e.message);
    return null;
  }
}

async function fetchYahooReaction(symbol, yahooSym, t0ms) {
  try {
    const t0s = Math.floor(t0ms / 1000);
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=5m&period1=${t0s - 1800}&period2=${t0s + 1800}`,
      { headers: { 'User-Agent': REACTION_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null;
    const result = (await r.json())?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const rows = ts.map((t, i) => ({ t, close: closes[i] })).filter(x => Number.isFinite(x.close));
    // Yahoo stamps bars at their START; the bar starting at t closes at t+300.
    const beforeRow = [...rows].reverse().find(x => x.t + 300 <= t0s);
    const afterRow = [...rows].reverse().find(x => x.t + 300 <= t0s + 900);
    if (!beforeRow || !afterRow || afterRow.t <= beforeRow.t) return null;
    return {
      symbol,
      before: +beforeRow.close.toFixed(2),
      after: +afterRow.close.toFixed(2),
      changePct: +(((afterRow.close - beforeRow.close) / beforeRow.close) * 100).toFixed(2),
    };
  } catch (e) {
    console.warn(`[calendar-routes] reaction ${symbol} yahoo failed:`, e.message);
    return null;
  }
}

router.get('/reaction', async (req, res) => {
  const t0 = new Date(String(req.query.date || '')).getTime();
  if (!Number.isFinite(t0)) {
    return res.status(400).json({ error: 'Invalid or missing date' });
  }
  const now = Date.now();
  if (t0 > now) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ pending: true, reactions: [], btcSeries: [] });
  }
  const settled = now >= t0 + 16 * 60e3;
  res.setHeader('Cache-Control', settled ? 'public, max-age=86400' : 'public, max-age=30');
  try {
    const [btc, eth, ...tradfi] = await Promise.all([
      fetchCryptoReaction('BTC', t0),
      fetchCryptoReaction('ETH', t0),
      ...REACTION_YAHOO.map(i => fetchYahooReaction(i.symbol, i.yahoo, t0)),
    ]);
    const btcSeries = (btc && btc.series) || [];
    const reactions = [btc, eth, ...tradfi].filter(Boolean).map(({ series, ...rest }) => rest);
    return res.json({ pending: !settled, reactions, btcSeries });
  } catch (e) {
    console.error('[calendar-routes] /reaction error:', e.message);
    return res.json({ pending: false, reactions: [], btcSeries: [] });
  }
});

function categorizeEvent(title) {
  if (!title) return 'Other';
  const t = title.toLowerCase();
  if (/interest rate|fed.*fund|fomc|boe.*rate|ecb.*rate/i.test(t)) return 'Interest Rate';
  if (/cpi|ppi|pce|inflation|price index/i.test(t)) return 'Inflation';
  if (/payroll|employment|unemploy|jobless|labor|nfp/i.test(t)) return 'Employment';
  if (/gdp/i.test(t)) return 'GDP';
  if (/housing|home|building permit|mortgage/i.test(t)) return 'Housing';
  if (/ism|pmi|manufacturing|industrial|factory/i.test(t)) return 'Manufacturing';
  if (/consumer|retail|confidence|sentiment|spending/i.test(t)) return 'Consumer';
  if (/trade|import|export|current account/i.test(t)) return 'Trade';
  if (/crude|oil|gas|energy|opec/i.test(t)) return 'Energy';
  return 'Other';
}

// ── GET /event/:id — Event Detail (Spectre /v1/ai/calendar-event/{eventId}) ─
// Strips both `sc-` and `ext-` prefixes (legacy) before lookup. If Spectre has
// no detail for the id (typical for ext-api-prefixed legacy entries) we fall
// through to the merged-event cache so the drawer at least renders the basic
// name/date/impact instead of erroring.
router.get('/event/:id', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').replace(/^(sc|ext)-/, '');
    if (!EVENT_ID_RE.test(rawId)) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    const now = Date.now();
    const cached = eventDetailCache[rawId];
    if (cached && now - cached.ts < EVENT_DETAIL_TTL) {
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.json(cached.data);
    }

    const apiKey = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY;
    let detail = null;

    try {
      const upstream = await fetch(`${SPECTRE_API_BASE}/v1/ai/calendar-event/${encodeURIComponent(rawId)}`, {
        signal: AbortSignal.timeout(10000),
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
      });
      if (upstream.ok) {
        const raw = await upstream.json();
        const data = raw?.data || raw;
        detail = {
          id: `sc-${data.id || rawId}`,
          name: data.name || data.title,
          nameShort: (data.name || data.title || '').length > 30 ? (data.name || data.title).slice(0, 30) : (data.name || data.title || ''),
          currency: data.currency || data.currencyCode || data.country,
          country: data.country || data.countryCode || null,
          dateTime: data.date || data.dateUtc,
          category: data.category?.name || data.category || null,
          impact: data.impact_level || data.impact || EXT_IMPACT_MAP[data.volatility] || 'medium',
          description: stripHtml(data.description),
          headline: data.headline || null,
          whyMatters: stripHtml(data.why_matters || data.whyMatters || data.summary),
          actual: data.actual_value ?? data.actual ?? null,
          forecast: data.forecast_value ?? data.forecast ?? data.consensus ?? null,
          previous: data.previous_value ?? data.previous ?? null,
          revised: data.revised ?? null,
          isBetterThanExpected: data.is_better_than_expected ?? data.isBetterThanExpected ?? null,
          deviation: typeof data.ratio_deviation === 'number' ? +(data.ratio_deviation * 100).toFixed(2)
            : typeof data.ratioDeviation === 'number' ? +(data.ratioDeviation * 100).toFixed(2) : null,
          potency: data.potency || null,
          isAllDay: !!(data.is_all_day || data.isAllDay),
          isPreliminary: !!(data.is_preliminary || data.isPreliminary),
          isReport: !!(data.is_report || data.isReport),
          isSpeech: !!(data.is_speech || data.isSpeech),
          isTentative: !!(data.is_tentative || data.isTentative),
          hasHistorical: !!(data.has_historical || data.hasHistorical),
          nextReleaseDate: data.next_release_date || (data.nextReleaseDate && data.nextReleaseDate.startsWith('0001') ? null : data.nextReleaseDate),
          sourceUrl: data.official_source_url || data.officialSourceUrl || data.url || null,
          tags: Array.isArray(data.tags) ? data.tags : [],
          lastUpdated: data.last_updated || data.lastUpdated || null,
          source: 'spectre-ai-calendar-event',
        };
      }
    } catch (e) {
      console.warn('[calendar-routes] Spectre event detail failed:', e.message);
    }

    // Fallback: pull from merged calendar cache so the drawer always has *some*
    // shape. Better than a 500 or empty drawer.
    if (!detail) {
      const cachedAll = economicCache.all?.data || [];
      const found = cachedAll.find(e => String(e.id).replace(/^(sc|ext)-/, '') === rawId);
      if (found) {
        detail = {
          ...found,
          source: 'cache-fallback',
          headline: null,
          whyMatters: '',
          revised: null,
          isBetterThanExpected: null,
          deviation: null,
          potency: null,
          isAllDay: false,
          isPreliminary: false,
          isReport: false,
          isSpeech: false,
          isTentative: false,
          hasHistorical: false,
          nextReleaseDate: null,
          sourceUrl: found.url || null,
          tags: [],
          lastUpdated: null,
        };
      }
    }

    if (!detail) {
      return res.status(404).json({ error: 'Event not found' });
    }

    eventDetailCache[rawId] = { data: detail, ts: now };
    if (Object.keys(eventDetailCache).length > 2000) {
      const oldest = Object.entries(eventDetailCache).sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) delete eventDetailCache[oldest[0]];
    }

    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(detail);
  } catch (e) {
    console.error('[calendar-routes] /event/:id error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── GET /analysis — Latest Market Outlook ──────────────────────────────────
router.get('/analysis', (req, res) => {
  try {
    const article = loadArticle('calendar', 'latest');
    if (!article || !article.analysisData) {
      return res.status(404).json({ error: 'No analysis available', analysis: null });
    }

    res.json({
      analysis: article.analysisData,
      model: article.model || 'unknown',
      updatedAt: article.updatedAt,
      publishedAt: article.publishedAt,
    });
  } catch (e) {
    console.error('[calendar-routes] /analysis error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── GET /themes — Latest Dominant Themes ────────────────────────────────────
router.get('/themes', (req, res) => {
  try {
    const article = loadArticle('calendar', 'themes-latest');
    if (!article || !article.themesData) {
      return res.status(404).json({ error: 'No themes available', themes: [] });
    }

    res.json({
      themes: article.themesData,
      model: article.model || 'unknown',
      updatedAt: article.updatedAt,
      publishedAt: article.publishedAt,
    });
  } catch (e) {
    console.error('[calendar-routes] /themes error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── GET /verdict — Latest Market Regime Verdict ─────────────────────────────
router.get('/verdict', (req, res) => {
  try {
    const article = loadArticle('calendar', 'verdict-latest');
    if (!article || !article.verdictData) {
      return res.status(404).json({ error: 'No verdict available', verdict: null });
    }

    res.json({
      verdict: article.verdictData.verdict,
      sentiment: article.verdictData.sentiment,
      model: article.model || 'unknown',
      updatedAt: article.updatedAt,
      publishedAt: article.publishedAt,
    });
  } catch (e) {
    console.error('[calendar-routes] /verdict error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── GET /history — Past analyses for timeline ───────────────────────────────
router.get('/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const all = listArticles('calendar', { limit: 200 });

    // Filter for history entries only
    const history = all
      .filter(a => a.calendarType === 'history')
      .slice(0, limit)
      .map(a => {
        let parsed = null;
        try {
          parsed = JSON.parse(a.content);
        } catch (_) {}

        return {
          id: a.slug,
          generatedAt: parsed?.generatedAt || a.publishedAt,
          outlook: parsed?.outlook ? {
            nextEvent: parsed.outlook.nextKeyEvent?.name,
            riskLevel: parsed.outlook.riskLevel,
          } : null,
          themes: parsed?.themes ? parsed.themes.map(t => ({
            headline: t.headline,
            type: t.type,
          })) : [],
          verdict: parsed?.verdict?.verdict || null,
          sentiment: parsed?.verdict?.sentiment || null,
          dataSnapshot: parsed?.dataSnapshot || null,
        };
      });

    res.json({ history, total: history.length });
  } catch (e) {
    console.error('[calendar-routes] /history error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Helpers reused by /bundle ───────────────────────────────────────────────
// Async: returns the same shape /economic emits — events + source + cacheState.
async function getEconomicForBundle(query) {
  try {
    const now = Date.now();
    const cached = economicCache.all;
    const age = cached ? now - cached.timestamp : Infinity;

    if (cached && age < FRESH_TTL) {
      return { events: filterEvents(cached.data, query), source: 'api', cache: 'fresh' };
    }
    if (cached && age < STALE_TTL) {
      refreshEconomicCache().catch(() => {});
      return { events: filterEvents(cached.data, query), source: 'api', cache: 'stale' };
    }
    try {
      const fresh = await refreshEconomicCache();
      return { events: filterEvents(fresh, query), source: 'api', cache: 'cold' };
    } catch {
      return { events: [], source: 'empty', cache: 'cold' };
    }
  } catch (e) {
    console.error('[calendar-routes] bundle events error:', e.message);
    return { events: [], source: 'empty', cache: 'error' };
  }
}

function getAnalysisForBundle() {
  const article = loadArticle('calendar', 'latest');
  if (!article || !article.analysisData) return null;
  return {
    analysis: article.analysisData,
    model: article.model || 'unknown',
    updatedAt: article.updatedAt,
    publishedAt: article.publishedAt,
  };
}

function getThemesForBundle() {
  const article = loadArticle('calendar', 'themes-latest');
  if (!article || !article.themesData) return null;
  return {
    themes: article.themesData,
    model: article.model || 'unknown',
    updatedAt: article.updatedAt,
    publishedAt: article.publishedAt,
  };
}

function getVerdictForBundle() {
  const article = loadArticle('calendar', 'verdict-latest');
  if (!article || !article.verdictData) return null;
  return {
    verdict: article.verdictData.verdict,
    sentiment: article.verdictData.sentiment,
    model: article.model || 'unknown',
    updatedAt: article.updatedAt,
    publishedAt: article.publishedAt,
  };
}

function getHistoryForBundle(limitParam) {
  try {
    const limit = Math.min(parseInt(limitParam) || 20, 50);
    const all = listArticles('calendar', { limit: 200 });
    const history = all
      .filter(a => a.calendarType === 'history')
      .slice(0, limit)
      .map(a => {
        let parsed = null;
        try { parsed = JSON.parse(a.content); } catch (_) {}
        return {
          id: a.slug,
          generatedAt: parsed?.generatedAt || a.publishedAt,
          outlook: parsed?.outlook ? {
            nextEvent: parsed.outlook.nextKeyEvent?.name,
            riskLevel: parsed.outlook.riskLevel,
          } : null,
          themes: parsed?.themes ? parsed.themes.map(t => ({
            headline: t.headline,
            type: t.type,
          })) : [],
          verdict: parsed?.verdict?.verdict || null,
          sentiment: parsed?.verdict?.sentiment || null,
          dataSnapshot: parsed?.dataSnapshot || null,
        };
      });
    return { history, total: history.length };
  } catch (e) {
    console.error('[calendar-routes] bundle history error:', e.message);
    return { history: [], total: 0 };
  }
}

// ── GET /bundle — One-shot for the economic-calendar page ───────────────────
// Returns events + analysis + themes + history + verdict in a single
// round-trip. Each slice is computed in parallel.
router.get('/bundle', async (req, res) => {
  try {
    const eventsP = getEconomicForBundle(req.query);
    // Sync slices — content store is in-memory, no I/O.
    const analysis = getAnalysisForBundle();
    const themes = getThemesForBundle();
    const verdict = getVerdictForBundle();
    const history = getHistoryForBundle(req.query.limit);
    const { events, source } = await eventsP;
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    res.json({
      events,
      total: events.length,
      source,
      analysis,
      themes,
      verdict,
      history,
    });
  } catch (e) {
    console.error('[calendar-routes] /bundle error:', e.message);
    res.status(500).json({
      error: 'Internal error',
      events: [], total: 0, source: 'empty',
      analysis: null, themes: null, verdict: null, history: { history: [], total: 0 },
    });
  }
});

// ── POST /generate — Admin trigger for immediate regen ──────────────────────
router.post('/generate', async (req, res) => {
  try {
    console.log('[calendar-routes] Manual generation triggered');
    const result = await generateCalendarAnalysis();
    res.json({
      status: result ? 'completed' : 'failed',
      outlook: !!result?.outlook,
      themes: !!result?.themes,
      verdict: !!result?.verdict,
    });
  } catch (e) {
    console.error('[calendar-routes] /generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /event-brief — AI brief for a released economic event ────────────────
router.get('/event-brief', async (req, res) => {
  try {
    const { name, actual, forecast, previous, country, category } = req.query;
    if (!name || !actual) {
      return res.status(400).json({ error: 'name and actual params required' });
    }

    const brief = await generateEventBrief({
      name,
      actual,
      forecast: forecast || null,
      previous: previous || null,
      country: country || 'US',
      category: category || 'Other',
    });

    if (!brief) {
      return res.status(404).json({ error: 'Brief generation failed' });
    }

    res.json(brief);
  } catch (e) {
    console.error('[calendar-routes] /event-brief error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
