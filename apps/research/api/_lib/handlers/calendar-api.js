/**
 * Vercel Serverless -- Calendar routes.
 * - `economic`: live faireconomy.media + Spectre Data API merge.
 * - `analysis`: Market Outlook (bull/bear thesis, next key event, week ahead).
 *   Read DIRECTLY from the Spectre Data API on Hetzner (/v1/calendar/analysis),
 *   with a staleness guard so a frozen payload never renders on a live macro day.
 * - `verdict`: derived from the live market regime (/v1/market/regime).
 * - `themes` / `history`: no live prod source -> graceful empty.
 *
 * NOTE (2026-06-10): analysis/themes/verdict/history used to proxy the OVH
 * Express box at srv.spectreai.io, but that host now 404s ("Cannot GET
 * /api/calendar/analysis") since the research calendar agent was never
 * deployed there. The dead proxy silently nulled the entire Outlook/Context
 * section in prod. We now source straight from Hetzner, which the analysis
 * writer POSTs into.
 *
 * Routing: vercel.json rewrites /api/calendar/* to
 *   /api/calendar-api?route=<sub-route>&<extra params>
 */

// OVH Express server is still the fallback origin for the raw economic event
// list when no Spectre key is configured (see getEconomicEvents). Keep it
// overridable via env (SPECTRE_SRV_ORIGIN).
const SRV_ORIGIN = (process.env.SPECTRE_SRV_ORIGIN || 'https://srv.spectreai.io').replace(/\/+$/, '');

// ── Event categorisation ───────────────────────────────────────────────────
// CANONICAL CATEGORY SET — must stay in sync with DEFAULT_CATEGORIES in
// apps/research/src/pages/economic-calendar/hooks/useFilters.js. The client
// filter drops any event whose category is not in its set, so a value emitted
// here but missing there is INVISIBLE in the UI with no way to switch it back
// on. That is exactly what happened before 2026-08-24: this function emitted
// 'Other' and 'Energy', which the filter never listed, while the filter
// offered a 'Speeches' pill this function never produced. The week of
// 2026-08-24 lost 30 of its 77 medium-and-above events that way — including
// all three days of the Jackson Hole Symposium, the Fed Chair's keynote, the
// ECB accounts, the RBA minutes and Durable Goods.
const EVENT_CATEGORIES = [
  'Interest Rate', 'Inflation', 'Employment', 'GDP', 'Housing', 'Manufacturing',
  'Consumer', 'Trade', 'Energy', 'Speeches', 'Crypto', 'Governance', 'Earnings', 'Other',
];

// Policy PUBLICATIONS (decision, minutes, accounts) stay under Interest Rate —
// they are the rate path itself. Individual officials speaking, testimony and
// the Jackson Hole symposium are 'Speeches'.
const CAT_RATE_RE = /interest rate|fed.*fund|fomc|rate decision|monetary policy|meeting minutes|meeting accounts|rate statement/i;
const CAT_SPEECH_RE = /speech|speaks|testimony|remarks|press conference|symposium|jackson hole|bulletin|panel|address/i;

function categorizeEvent(title) {
  if (!title) return 'Other';
  const t = title.toLowerCase();
  if (CAT_RATE_RE.test(t)) return 'Interest Rate';
  if (CAT_SPEECH_RE.test(t)) return 'Speeches';
  if (/cpi|ppi|pce|inflation|price index/i.test(t)) return 'Inflation';
  if (/payroll|employment|unemploy|jobless|labor|nfp/i.test(t)) return 'Employment';
  if (/gdp/i.test(t)) return 'GDP';
  if (/housing|home|building permit|mortgage/i.test(t)) return 'Housing';
  if (/ism|pmi|manufacturing|industrial|factory|durable goods/i.test(t)) return 'Manufacturing';
  // Inventories before Consumer: "Retail Inventories" is a trade-flow series,
  // not a household read, and belongs next to Goods Trade Balance.
  if (/trade|import|export|current account|inventories|wholesale/i.test(t)) return 'Trade';
  if (/consumer|retail|confidence|sentiment|spending|personal income/i.test(t)) return 'Consumer';
  if (/crude|oil|gas|energy|opec|eia\b|natural gas/i.test(t)) return 'Energy';
  return 'Other';
}

// Crypto-native rows arrive from Spectre with their own event_type. They were
// being title-cased into 'Governance' / 'Unlock' / 'Protocol' — none of which
// the client filter listed either, so the calendar's own 'Crypto' pill matched
// nothing and every unlock was invisible. Governance keeps its own category so
// DAO-vote volume can be switched off without hiding token unlocks.
function categorizeCryptoEvent(eventType) {
  return String(eventType || '').toLowerCase() === 'governance' ? 'Governance' : 'Crypto';
}

// Calendar list now sources from Spectre `/v1/calendar` + faireconomy fallback.
// Event detail uses Spectre `/v1/ai/calendar-event/{eventId}`. The Haitam
// EXT_CALENDAR_URL / EXT_EVENT_DET_URL hosts have been deprovisioned.
const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const FAIRECONOMY_THISWEEK = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// TradingView's public economic calendar — the macro backbone (2026-06-10).
// No auth, global coverage months into the future, and `actual` values land
// within minutes of release. The previous macro chain couldn't do either:
// FairEconomy only publishes the current week and strips actuals entirely
// (next/lastweek JSONs 404), and the Spectre DB ingests from that same feed,
// so prod rendered a one-week month grid with no prints.
const TV_CALENDAR_URL = 'https://economic-calendar.tradingview.com/events';
// Curated country set keeps each month-chunk under TV's ~2000-row response
// cap while widening the old FairEconomy major-currency coverage.
const TV_COUNTRIES = 'US,EU,DE,GB,JP,CN,CA,AU,NZ,CH,FR,IT,ES,KR,IN,BR,MX,ZA,TR,SG,HK,SE,NO,PL,NL';
// ── Impact tiering: crypto relevance, not global-macro importance ──────────
// TradingView's own `importance` (-1 / 0 / 1) ranks events for a global macro
// desk. Read straight through it puts German GfK Consumer Confidence (1) ABOVE
// US Initial Jobless Claims (0), and scores the Jackson Hole Symposium a 0 —
// the single biggest catalyst of its week for risk assets. This page answers
// one question — what moves crypto — so the tiers are re-derived around the US
// rate path, and TV's number is only the tiebreak.
//
// critical = repricing the Fed path outright (the print, or the Fed talking)
// high     = moves the tape but rarely the path (US second-tier, global policy)
// medium   = context: surveys, soft data, regional officials
// low      = auctions, sub-indices, revisions nobody trades
const US_MARKETS = new Set(['US', 'USD']);

// The Fed-path prints. A surprise here reprices rate expectations, and that
// repricing is the transmission channel into BTC.
const FED_PATH_RE = /inflation rate|consumer price|\bcpi\b|non.?farm|payroll|unemployment rate|interest rate decision|fomc|gdp growth|pce price|producer price|\bppi\b/i;
// The Fed speaking for itself. TV rates a Fed Chair speech `1` and Jackson Hole
// `0`; for crypto both belong in the top tier — Powell's 2022 Jackson Hole
// keynote took BTC down ~9% inside two sessions, with no data released at all.
const FED_VOICE_RE = /fed chair|fed chairman|jackson hole|humphrey.?hawkins/i;
// US second-tier releases that still move the tape on the day. Jobless claims
// sits here deliberately: it is the highest-frequency read on the labour side
// of the mandate, and the ImpactBadge tooltip has always named it as 'high'.
const US_HIGH_RE = /jobless claims|retail sales|\bism\b|\bpmi\b|durable goods|personal (income|spending)|consumer confidence|michigan|jolts|beige book|housing starts|trade balance/i;
// Non-US policy events that reach global risk: any rate decision, and the
// minutes/accounts that carry the reaction function.
const GLOBAL_POLICY_RE = /interest rate decision|rate decision|monetary policy (decision|statement|meeting)|meeting minutes|meeting accounts|rate statement/i;
// Opinion surveys, not prints. Sunny's rule — "a survey prelim is context, not
// a critical event" — applied consistently: outside the US these cap at medium
// however TV rates them. This is what demotes GfK/Ifo below US claims.
const SOFT_SURVEY_RE = /consumer confidence|business climate|business confidence|sentiment|expectations|leading indicator|economic optimism|\bgfk\b|\bifo\b|\bzew\b|\bkof\b|tankan/i;

// Scheduled multi-day events (Jackson Hole, an NPC session, a central-bank
// board meeting) carry no clock time — TradingView stamps them at exactly
// 00:00 UTC with no period and no values. Rendered as a timestamp they became
// "2:00 AM" for a European reader, which reads as a precise release time that
// does not exist. Flagged here so the views can label them "All day".
function tvIsAllDay(raw) {
  return /T00:00:00(\.000)?Z?$/.test(String(raw.date || '')) &&
    !raw.period &&
    raw.actual == null && raw.previous == null && raw.forecast == null &&
    raw.actualRaw == null && raw.previousRaw == null && raw.forecastRaw == null;
}

// TV ships magnitude and currency separately — scale 'B' + unit 'A$'. Glued
// they rendered "1.929BA$", which reads as a typo. A multi-character currency
// gets a space; the single-character ones ($, ¥, %) stay glued the conventional
// way ("-101.5B$", "3.4%").
function joinUnit(scale, unit) {
  const s = String(scale || '').trim();
  const u = String(unit || '').trim();
  if (!s) return u || null;
  if (!u) return s;
  return u.length > 1 ? `${s} ${u}` : `${s}${u}`;
}

// Dense cells (week columns, month cells) render `nameShort`. A hard 30-char
// slice cut mid-word — "Non Farm Payrolls Annual Revis" — so trim on a word
// boundary and mark the truncation.
function shortName(name) {
  const s = String(name || '');
  if (s.length <= 30) return s;
  const cut = s.slice(0, 30);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 18 ? cut.slice(0, sp) : cut).trimEnd()}\u2026`;
}

function tvImpact(raw) {
  const title = raw.title || '';
  const imp = typeof raw.importance === 'number' ? raw.importance : -1;
  const isUS = US_MARKETS.has(raw.country);

  // The Fed talking outranks TV's number outright — that is the whole point of
  // this override, since TV scores Jackson Hole a 0.
  if (isUS && FED_VOICE_RE.test(title)) return 'critical';
  if (imp < 0) return 'low';
  if (isUS) {
    // Only the HEADLINE print is critical. The same release ships a stack of
    // sub-indices under near-identical names (PCE Price Index YoY, Core PCE
    // Prices QoQ 2nd Est …) — promoting those on the title alone put seven
    // red rows on one morning and made the tier meaningless.
    if (imp >= 1 && FED_PATH_RE.test(title)) return 'critical';
    return imp >= 1 || FED_PATH_RE.test(title) || US_HIGH_RE.test(title) ? 'high' : 'medium';
  }
  if (GLOBAL_POLICY_RE.test(title)) return 'high';
  if (SOFT_SURVEY_RE.test(title)) return 'medium';
  return imp >= 1 ? 'high' : 'medium';
}

// TV ships each value in two shapes: the SCALED display number (`actual: 57`
// with `scale: 'K'` - what tradingview.com renders as "57K") and raw base
// units (`forecastRaw: 110000`). The old mapping preferred Raw per-field, so
// one event could mix magnitudes (actual 57 vs forecast 110000) - breaking
// every consumer that compares or displays them (NFP card showed
// "49K vs 110000K exp", beat/miss badges and deviation % were garbage for
// every K-scaled event). Normalize everything to the scaled display shape.
const TV_SCALE_FACTORS = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
function tvValue(scaled, rawUnits, scale) {
  if (scaled != null && scaled !== '') return scaled;
  if (rawUnits == null || rawUnits === '') return null;
  const f = TV_SCALE_FACTORS[String(scale || '').toUpperCase()];
  return f ? rawUnits / f : rawUnits;
}

// Returns { events, chunksTotal, failedRanges }. failedRanges lists the
// [from, to) month windows whose TV fetch failed BOTH attempts, so the
// caller can backfill those months from another macro source instead of
// serving holes. Before 2026-06-11 this returned a bare (possibly partial)
// array and any non-ok chunk silently became [] — a 13-month window fires
// 13 requests, TV rate-limits the burst, and whole months vanished from an
// already-rendered calendar on the next poll.
async function fetchTradingViewEvents({ from, to } = {}) {
  const now = new Date();
  const start = from && !isNaN(new Date(from)) ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = to && !isNaN(new Date(to)) ? new Date(to) : new Date(now.getFullYear(), now.getMonth() + 2, 1);
  if (start >= end) return { events: [], chunksTotal: 0, failedRanges: [] };

  // Month-sized chunks keep each response under TV's row cap.
  const chunks = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  let safety = 14;
  while (cursor < end && safety-- > 0) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    chunks.push([new Date(Math.max(cursor, start)), new Date(Math.min(next, end))]);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

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

  // Bounded concurrency (worker pool) + one jittered retry per chunk —
  // a full-window burst is what trips TV's rate limiting in the first place.
  const results = new Array(chunks.length);
  const failedRanges = [];
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(5, chunks.length) }, async () => {
    while (nextIdx < chunks.length) {
      const i = nextIdx++;
      try {
        results[i] = await fetchChunk(chunks[i], 8000);
      } catch (e1) {
        try {
          await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
          results[i] = await fetchChunk(chunks[i], 5000);
        } catch (e2) {
          console.warn('[calendar-api] tradingview chunk failed twice:', e2.message);
          results[i] = [];
          failedRanges.push(chunks[i]);
        }
      }
    }
  });
  await Promise.all(workers);

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
      nameShort: shortName(name),
      country: raw.country || 'US',
      currency: (raw.currency || 'USD').toUpperCase(),
      category: categorizeEvent(name),
      impact: tvImpact(raw),
      dateTime: raw.date,
      previous: tvValue(raw.previous, raw.previousRaw, raw.scale),
      forecast: tvValue(raw.forecast, raw.forecastRaw, raw.scale),
      actual: tvValue(raw.actual, raw.actualRaw, raw.scale),
      unit: joinUnit(raw.scale, raw.unit),
      description: '',
      affectedAssets: [],
      isFedEvent: /fed|fomc/i.test(name),
      isCrypto: false,
      allDay: tvIsAllDay(raw),
      source: 'tradingview',
      event_type: 'macro',
      url: raw.source_url || null,
    });
  }
  return { events: out, chunksTotal: chunks.length, failedRanges };
}

// Max age for the Market Outlook payload. Older than this -> treat as missing
// so we render the clean empty state instead of a stale thesis (e.g. an
// FOMC-era payload on a CPI day). Default 36h tolerates several missed writer
// cycles without flapping; override via CALENDAR_ANALYSIS_STALE_HOURS.
const ANALYSIS_STALE_MS = Number(process.env.CALENDAR_ANALYSIS_STALE_HOURS || 36) * 3600 * 1000;

function spectreApiHeaders() {
  const key = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY;
  return key ? { 'X-API-Key': key, Accept: 'application/json' } : { Accept: 'application/json' };
}

// GET Hetzner /v1/calendar/analysis -> { analysis, source, generatedAt } | null.
// Returns null (not stale content) when the payload is older than ANALYSIS_STALE_MS
// or the upstream is unavailable, so callers render an honest empty state.
async function fetchCalendarAnalysis({ timeoutMs = 8000 } = {}) {
  try {
    const r = await fetch(`${SPECTRE_API_BASE}/v1/calendar/analysis`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: spectreApiHeaders(),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const payload = body?.data?.analysis || body?.analysis || null;
    if (!payload || typeof payload !== 'object') return null;
    const generatedAt = body?.data?.generatedAt || body?.generatedAt || payload.updatedAt || null;
    if (generatedAt) {
      const age = Date.now() - new Date(generatedAt).getTime();
      if (Number.isFinite(age) && age > ANALYSIS_STALE_MS) {
        console.warn(`[calendar-api] analysis stale (${Math.round(age / 3.6e6)}h old) — suppressing`);
        return null;
      }
    }
    return { analysis: payload, source: body?.data?.source || body?.source || null, generatedAt };
  } catch (err) {
    console.warn('[calendar-api] analysis fetch failed:', err.message);
    return null;
  }
}

// Map the live market regime to the verdict-card shape the page expects
// ({ verdict: <string>, sentiment }). This is self-maintaining — it always
// reflects current conditions and never goes stale like the outlook payload.
const REGIME_SENTIMENT = {
  capitulation: 'bearish', markdown: 'bearish', distribution: 'cautious',
  transition: 'cautious', accumulation: 'cautious', markup: 'bullish', euphoria: 'bullish',
};
async function fetchRegimeVerdict({ timeoutMs = 8000 } = {}) {
  try {
    const r = await fetch(`${SPECTRE_API_BASE}/v1/market/regime/`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: spectreApiHeaders(),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const d = body?.data || body;
    if (!d || !d.regime) return null;
    const ctx = d.context || {};
    const bits = [];
    if (typeof ctx.fearGreed === 'number') bits.push(`Fear & Greed at ${ctx.fearGreed}`);
    if (typeof ctx.btcDominance === 'number') bits.push(`BTC dominance ${ctx.btcDominance.toFixed(1)}%`);
    if (typeof ctx.bullishAssetsPct === 'number') bits.push(`${ctx.bullishAssetsPct}% of assets bullish over 30d`);
    const detail = bits.length ? ` ${bits.join(', ')}.` : '';
    const verdict = `${d.label || d.regime}: ${d.description || ''}.${detail}`
      .replace(/\s*\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
    return {
      verdict,
      sentiment: REGIME_SENTIMENT[String(d.regime).toLowerCase()] || 'cautious',
      regime: d.regime,
      confidence: typeof d.confidence === 'number' ? d.confidence : null,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[calendar-api] regime verdict fetch failed:', err.message);
    return null;
  }
}
const EXT_IMPACT_MAP = { NONE: 'low', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };
const FAIRECONOMY_IMPACT_MAP = {
  Holiday: 'low',
  Low: 'low',
  Medium: 'medium',
  High: 'high',
};
const EVENT_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

// Stable id from event fields so the same event keeps the same id across polls.
function hashEventId(prefix, ...parts) {
  let h = 5381;
  const str = parts.filter(Boolean).join('|');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

function stripHtml(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function mergeKey(evt) {
  const hour = (evt.dateTime || '').slice(0, 13);
  const name = (evt.name || '').toLowerCase().replace(/\W+/g, '');
  return `${hour}_${evt.currency || ''}_${name}`;
}

// Public Forex Factory feed (no key, current week only). Used as a final
// fallback when the Spectre data API and the Cloud Run service are
// unreachable, so the calendar isn't entirely empty in prod.
async function fetchFairEconomyEvents() {
  try {
    const res = await fetch(FAIRECONOMY_THISWEEK, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Spectre-AI/1.0; +https://spectreai.io)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((raw) => {
      const name = raw.title || '';
      const impact = FAIRECONOMY_IMPACT_MAP[raw.impact] || 'low';
      const dateTime = raw.date || null;
      return {
        id: hashEventId('ff', dateTime, raw.country, name),
        name,
        nameShort: shortName(name),
        country: raw.country || 'USD',
        currency: raw.country || 'USD',
        category: categorizeEvent(name),
        impact,
        dateTime,
        previous: raw.previous || null,
        forecast: raw.forecast || null,
        actual: null,
        description: '',
        affectedAssets: [],
        isFedEvent: /fed|fomc/i.test(name),
        isCrypto: false,
        source: 'faireconomy',
        event_type: 'macro',
        url: null,
      };
    });
  } catch (e) {
    console.warn('[calendar-api] faireconomy fetch failed:', e.message);
    return [];
  }
}

// ext-api source dead — Spectre `/v1/calendar?month=` covers the same window.
// Stubbed for compatibility with the existing Promise.all merge below.
async function fetchExtApiEvents() {
  return [];
}

// ── Market reaction (2026-06-11) ─────────────────────────────────────────────
// Real first-15-min reaction to a release. The old MarketReaction component
// FABRICATED before/after prices from hardcoded base prices (BTC "97,420" while
// spot was ~62K) with seeded pseudo-random moves — pure fiction. This computes
// the actual move: BTC/ETH from the Spectre candle store (1m), TradFi from
// Yahoo intraday 5m. Futures contracts (ES/NQ) instead of cash indices so
// 8:30 ET pre-market prints still have bars. Instruments with no bars in the
// window (closed market) are dropped, never invented.
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
    const from = new Date(t0ms - 6 * 60e3).toISOString();
    const to = new Date(t0ms + 16 * 60e3).toISOString();
    const r = await fetch(
      `${SPECTRE_API_BASE}/v1/candles/${asset}?interval=1m&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { signal: AbortSignal.timeout(8000), headers: spectreApiHeaders() },
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
    console.warn(`[calendar-api] reaction ${asset} candles failed:`, e.message);
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
    console.warn(`[calendar-api] reaction ${symbol} yahoo failed:`, e.message);
    return null;
  }
}

function mergeEvents(primary, secondary) {
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

// Shared by /api/calendar/economic and /api/calendar/bundle. Hits Spectre Data
// API direct when SPECTRE_DATA_API_KEY is set, falls back to OVH srv proxy.
// Returns the already-filtered event list.
async function getEconomicEvents({ from, to, impact, currency } = {}) {
  const monthsToFetch = (() => {
    const out = new Set();
    const now = new Date();
    const start = from ? new Date(from) : now;
    const end = to ? new Date(to) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    let safety = 12;
    while (cursor <= end && safety-- > 0) {
      out.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    out.add(now.toISOString().slice(0, 7));
    return Array.from(out);
  })();

  // 2026-06-10: also accept SPECTRE_API_KEY. This path previously required
  // SPECTRE_DATA_API_KEY specifically (unlike spectreApiHeaders above), so a
  // Vercel env with only SPECTRE_API_KEY silently dropped the Spectre source.
  const spectreApiKey = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';
  const headers = spectreApiKey ? { 'X-API-Key': spectreApiKey } : null;
  const haveSpectreKey = Boolean(headers);

  const monthFetches = haveSpectreKey
    ? monthsToFetch.map(m =>
        fetch(`${SPECTRE_API_BASE}/v1/calendar?month=${m}&limit=500`, {
          signal: AbortSignal.timeout(8000), headers,
        }).catch((e) => { console.warn(`[calendar-api] month ${m} fetch:`, e.message); return null; })
      )
    : [];

  const upcomingFetch = haveSpectreKey
    ? fetch(`${SPECTRE_API_BASE}/v1/calendar?upcoming=true&limit=500`, {
        signal: AbortSignal.timeout(8000), headers,
      }).catch((e) => { console.warn('[calendar-api] upcoming fetch:', e.message); return null; })
    : Promise.resolve(null);

  const srvFetch = haveSpectreKey
    ? Promise.resolve(null)
    : (async () => {
        const params = new URLSearchParams();
        if (from) params.set('from', String(from));
        if (to) params.set('to', String(to));
        const qs = params.toString();
        try {
          const r = await fetch(`${SRV_ORIGIN}/api/calendar/economic${qs ? `?${qs}` : ''}`, {
            signal: AbortSignal.timeout(10000),
            headers: { Accept: 'application/json' },
          });
          if (!r.ok) return null;
          const j = await r.json();
          return Array.isArray(j?.events) ? j.events : null;
        } catch (e) {
          console.warn('[calendar-api] srv proxy failed:', e.message);
          return null;
        }
      })();

  const [monthResults, upcomingRes, srvResult, extEvents, tvResult] = await Promise.all([
    Promise.all(monthFetches),
    upcomingFetch,
    srvFetch,
    fetchExtApiEvents(),
    fetchTradingViewEvents({ from, to }),
  ]);
  const tvEvents = tvResult.events;

  // FairEconomy is only worth fetching when TradingView came back empty —
  // its event names don't merge-key with TV's, so merging both doubles
  // every macro event for the current week.
  const faireconomyEvents = tvEvents.length > 0 ? [] : await fetchFairEconomyEvents();

  const monthOks = monthResults.filter(r => r && r.ok);
  const upcomingOk = upcomingRes && upcomingRes.ok;
  const srvEvents = Array.isArray(srvResult) ? srvResult : [];

  const haveSpectre = monthOks.length > 0 || upcomingOk;
  const haveSrv = srvEvents.length > 0;

  if (!haveSpectre && !haveSrv && tvEvents.length === 0 && extEvents.length === 0 && faireconomyEvents.length === 0) {
    return { events: [], source: 'empty', degraded: true };
  }

  const monthDataArrays = await Promise.all(
    monthOks.map(r => r.json().then(j => j?.data || []).catch(() => []))
  );
  const upcomingData = upcomingOk ? ((await upcomingRes.json()).data || []) : [];

  const seen = new Set();
  const rawEvents = [];
  for (const arr of monthDataArrays) {
    for (const evt of arr) {
      const key = `${evt.id}`;
      if (!seen.has(key)) { seen.add(key); rawEvents.push(evt); }
    }
  }
  for (const evt of upcomingData) {
    const key = `${evt.id}`;
    if (!seen.has(key)) { seen.add(key); rawEvents.push(evt); }
  }

  const spectreNormalized = rawEvents.map((raw, i) => ({
    id: `sc-${raw.id || i}`,
    name: raw.title,
    nameShort: shortName(raw.title),
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
    // Crypto-native rows (governance / unlock / protocol / conference) get a
    // category the client filter actually lists; macro rows fall back to the
    // title classifier. The old title-case of `raw.category` produced values
    // ('Governance', 'Unlock', 'Economic') that no filter pill matched, so
    // every one of those rows was dropped before it reached a view.
    category: raw.event_type && raw.event_type !== 'macro'
      ? categorizeCryptoEvent(raw.event_type)
      : categorizeEvent(raw.title),
    // Same critical-tier policy as tvImpact: non-US macro tops out at 'high'.
    impact: (() => {
      const imp = raw.impact_level || raw.impact || 'medium';
      const isMacro = !raw.event_type || raw.event_type === 'macro';
      const isUS = raw.country === 'US' || raw.country === 'USD' || !raw.country;
      return imp === 'critical' && isMacro && !isUS ? 'high' : imp;
    })(),
    dateTime: raw.date,
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

  // When TradingView delivered, it owns the macro layer: it has the full
  // month (past + future) AND live actuals. Spectre's macro rows are the
  // same FairEconomy-shaped events under different names (no merge-key
  // overlap -> duplicates), so keep only Spectre's crypto-native events
  // (governance / unlocks / regulatory / protocol / conference) on top.
  //
  // TV ownership is per-month, not all-or-nothing: when some month chunks
  // failed (rate-limited burst), Spectre macro rows backfill ONLY those
  // failed ranges — TV has zero rows there, so nothing can double — instead
  // of the old behavior where one surviving chunk dropped every Spectre
  // macro row and whole months went blank mid-session.
  let events;
  let degraded = false;
  if (tvEvents.length > 0) {
    const spectreCrypto = spectreNormalized.filter(e => e.event_type && e.event_type !== 'macro');
    events = mergeEvents(mergeEvents(tvEvents, spectreCrypto), srvEvents.filter(e => e.event_type && e.event_type !== 'macro'));
    if (tvResult.failedRanges.length > 0) {
      degraded = true;
      const inFailedRange = (e) => {
        const t = new Date(e.dateTime).getTime();
        return tvResult.failedRanges.some(([f, until]) => t >= f.getTime() && t < until.getTime());
      };
      const backfill = spectreNormalized.filter(e => e.event_type === 'macro' && inFailedRange(e));
      if (backfill.length > 0) events = mergeEvents(events, backfill);
      console.warn(`[calendar-api] TV partial: ${tvResult.failedRanges.length}/${tvResult.chunksTotal} chunks failed, backfilled ${backfill.length} Spectre macro rows`);
    }
  } else {
    // TV fully failed — Spectre macro (TV-ingested on the box) is the backbone.
    degraded = tvResult.chunksTotal > 0;
    events = mergeEvents(
      mergeEvents(
        mergeEvents(spectreNormalized, srvEvents),
        extEvents
      ),
      faireconomyEvents
    );
  }

  if (from) {
    const fromTime = new Date(from).getTime();
    events = events.filter(e => new Date(e.dateTime).getTime() >= fromTime);
  }
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    events = events.filter(e => new Date(e.dateTime).getTime() <= toDate.getTime());
  }
  if (impact) {
    const levels = impact.split(',').map(s => s.trim().toLowerCase());
    events = events.filter(e => levels.includes(e.impact));
  }
  if (currency) {
    const currencies = currency.split(',').map(s => s.trim().toUpperCase());
    events = events.filter(e => currencies.includes(e.currency));
  }

  return { events, source: 'api', degraded };
}

// Reused in-process by market-snapshot.js (AI Market brief) so the brief can
// cite the upcoming catalyst window without an HTTP self-fetch through the
// tier gate.
export { getEconomicEvents };

// Pure helpers exported for the tiering test
// (apps/research/api/_lib/handlers/__tests__ / scripts/check-calendar-tiers.mjs).
export { categorizeEvent, tvImpact, EVENT_CATEGORIES };

// Release window detector: a critical/high print due within 15 min or released
// within the last 45 min. During that window the 5-min edge cache (+15 min SWR)
// is what makes fresh actuals invisible right when everyone is watching - drop
// to a 30s cache so live results land within seconds of the client poll.
const HOT_BEFORE_MS = 15 * 60 * 1000;
const HOT_AFTER_MS = 45 * 60 * 1000;
function releaseWindowHot(events) {
  const now = Date.now();
  return (events || []).some((e) => {
    if (e.impact !== 'critical' && e.impact !== 'high') return false;
    const t = new Date(e.dateTime).getTime();
    return Number.isFinite(t) && t > now - HOT_AFTER_MS && t < now + HOT_BEFORE_MS;
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const route = (req.query.route || '').toLowerCase();

  // ══════════════════════════════════════════════════════════════════════════
  // GET /api/calendar/economic — Live economic calendar.
  // Source priority:
  //   1. Spectre Data API direct (needs SPECTRE_DATA_API_KEY on Vercel)
  //   2. OVH srv proxy (srv.spectreai.io/api/calendar/economic — its own
  //      credentials, works without any Vercel env)
  //   3. faireconomy.media public feed (current week only — last-ditch)
  //
  // The handler also derives the upstream `month=` fetches from the
  // request's from/to range, so navigating to August from a June session
  // doesn't return an empty grid.
  // ══════════════════════════════════════════════════════════════════════════
  if (route === 'economic') {
    // Calendar data changes on the scale of minutes (release schedule, actual
    // values trickle in around release time). Long edge cache + SWR lets the
    // overwhelming majority of requests hit Vercel's CDN.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    try {
      const { events, source, degraded } = await getEconomicEvents(req.query);
      // A degraded payload (TV chunks failed) must not occupy the edge cache
      // for 5+15 minutes — every user would see the holes until it expires.
      // Same short cache around release moments so live actuals show fast.
      if (degraded || releaseWindowHot(events)) res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({ events, total: events.length, source, ...(degraded ? { degraded: true } : {}) });
    } catch (err) {
      console.error('[calendar-api] /economic error:', err.message);
      res.setHeader('Cache-Control', 'public, s-maxage=15');
      return res.status(200).json({ events: [], total: 0, source: 'empty', degraded: true });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /api/calendar/bundle — One-shot for the economic-calendar page.
  // Returns events + analysis + themes + history + verdict in a single
  // round-trip. Each slice is fetched in parallel server-side, so the
  // bundle's wall-clock is bounded by the slowest single fetch instead of
  // 5 sequential client-side round-trips.
  // ══════════════════════════════════════════════════════════════════════════
  if (route === 'bundle') {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    try {
      const [eventsResult, analysis, verdict] = await Promise.all([
        getEconomicEvents(req.query).catch((e) => {
          console.warn('[calendar-api] bundle events failed:', e.message);
          return { events: [], source: 'empty', degraded: true };
        }),
        fetchCalendarAnalysis(),
        fetchRegimeVerdict(),
      ]);
      const events = eventsResult.events || [];
      if (eventsResult.degraded || releaseWindowHot(events)) res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({
        events,
        total: events.length,
        source: eventsResult.source || 'empty',
        ...(eventsResult.degraded ? { degraded: true } : {}),
        // `analysis` already matches the legacy proxy body: { analysis, source, generatedAt }.
        analysis: analysis || null,
        themes: null, // no live prod themes source; Outlook + Verdict carry the narrative.
        verdict: verdict || null,
        history: { history: [], total: 0 },
      });
    } catch (err) {
      console.error('[calendar-api] /bundle error:', err.message);
      res.setHeader('Cache-Control', 'public, s-maxage=15');
      return res.status(200).json({
        events: [], total: 0, source: 'empty', degraded: true,
        analysis: null, themes: null, verdict: null, history: { history: [], total: 0 },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /api/calendar/reaction?date=ISO — Real first-15-min market reaction.
  // BTC/ETH from the candle store, TradFi from Yahoo intraday. History is
  // immutable once t0+15m has passed -> cached hard at the edge.
  // ══════════════════════════════════════════════════════════════════════════
  if (route === 'reaction') {
    const t0 = new Date(String(req.query.date || '')).getTime();
    if (!Number.isFinite(t0)) {
      return res.status(400).json({ error: 'Invalid or missing date' });
    }
    const now = Date.now();
    if (t0 > now) {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ pending: true, reactions: [], btcSeries: [] });
    }
    const settled = now >= t0 + 16 * 60e3;
    res.setHeader('Cache-Control', settled
      ? 'public, s-maxage=86400, stale-while-revalidate=604800'
      : 'public, s-maxage=30');
    try {
      const [btc, eth, ...tradfi] = await Promise.all([
        fetchCryptoReaction('BTC', t0),
        fetchCryptoReaction('ETH', t0),
        ...REACTION_YAHOO.map(i => fetchYahooReaction(i.symbol, i.yahoo, t0)),
      ]);
      const btcSeries = btc?.series || [];
      const reactions = [btc, eth, ...tradfi].filter(Boolean).map(({ series, ...rest }) => rest);
      return res.status(200).json({ pending: !settled, reactions, btcSeries });
    } catch (err) {
      console.error('[calendar-api] /reaction error:', err.message);
      return res.status(200).json({ pending: false, reactions: [], btcSeries: [] });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /api/calendar/event/:id — Event Detail proxy
  // ══════════════════════════════════════════════════════════════════════════
  if (route === 'event') {
    const rawId = String(req.query.id || '').replace(/^(sc|ext|ff)-/, '');
    if (!rawId || rawId.length < 1 || rawId.length > 64) {
      return res.status(400).json({ error: 'Invalid event id' });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    try {
      const apiKey = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY;
      const upstream = await fetch(`${SPECTRE_API_BASE}/v1/ai/calendar-event/${encodeURIComponent(rawId)}`, {
        signal: AbortSignal.timeout(10000),
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
      });
      if (!upstream.ok) {
        return res.status(404).json({ error: 'Event detail unavailable', id: rawId });
      }
      const raw = await upstream.json();
      const data = raw?.data || raw;
      const detail = {
        id: `sc-${data.id || rawId}`,
        name: data.name || data.title,
        nameShort: shortName(data.name || data.title || ''),
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
      return res.status(200).json(detail);
    } catch (err) {
      console.error('[calendar-api] /event error:', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Analysis / verdict — sourced from the Spectre Data API (Hetzner).
  // themes / history have no live prod source -> graceful empty.
  // ══════════════════════════════════════════════════════════════════════════

  // GET /api/calendar/analysis — Market Outlook (bull/bear cases, fed context).
  // Hetzner /v1/calendar/analysis, suppressed when stale (see fetchCalendarAnalysis).
  if (route === 'analysis') {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    const result = await fetchCalendarAnalysis();
    if (result) return res.status(200).json(result);
    return res.status(200).json({ analysis: null });
  }

  // GET /api/calendar/themes — Dominant themes. No live prod source; empty.
  if (route === 'themes') {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({ themes: [] });
  }

  // GET /api/calendar/verdict — Market regime verdict (thesis under Next Key Event).
  // Derived live from /v1/market/regime, so always current.
  if (route === 'verdict') {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    const verdict = await fetchRegimeVerdict();
    if (verdict) return res.status(200).json(verdict);
    return res.status(200).json({ verdict: null });
  }

  // GET /api/calendar/history — Past analyses for the timeline. No live prod source.
  if (route === 'history') {
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ history: [], total: 0 });
  }

  // GET /api/calendar/event-brief — Perplexity-powered, content-store backed.
  // The agent + article store don't exist in serverless, so return graceful 404.
  if (route === 'event-brief') {
    // 200, not 404: this is a deliberate "feature absent here" answer, not a
    // failed request. A 404 printed a red console line on prod every time the
    // calendar switched events, for a stub. The client already guards on
    // `data?.brief`, so a null brief renders exactly as before.
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ brief: null, available: false, reason: 'not-available-in-serverless' });
  }

  // Unknown sub-route
  return res.status(200).json({ events: [], total: 0 });
}
