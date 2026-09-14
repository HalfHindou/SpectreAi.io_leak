/**
 * Vercel Serverless - Kalshi prediction-markets proxy.
 * Mirror of packages/server/routes/kalshi.js. Multi-route handler:
 *   GET /api/kalshi?route=events          - all open events, all categories (paginated, deduped)
 *   GET /api/kalshi?route=event&ticker=X  - single event by event_ticker
 *
 * Normalizes Kalshi events into the SAME slim event-card shape
 * polymarketApi.formatEventCards emits, tagging source:'kalshi'. Keep the
 * normalizer in sync with the Express router.
 */

const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';
const HEADERS = { 'User-Agent': 'Spectre/1.0', Accept: 'application/json' };

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

// ── Price / number coercion ──────────────────────────────────────────
function pickNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function midOf(a, b) {
  const x = pickNum(a), y = pickNum(b);
  if (x == null && y == null) return null;
  return ((x || 0) + (y || 0)) / 2;
}
function clampPct(n) { return Math.max(0, Math.min(100, n)); }

// Kalshi yes-price → 0..100. Prefer last trade, fall back to bid/ask mid.
// Public API returns dollar strings ("0.13"); legacy cent ints (1..99) honored too.
function yesPctFromMarket(m) {
  const dollars = pickNum(m.last_price_dollars) ?? midOf(m.yes_bid_dollars, m.yes_ask_dollars);
  if (dollars != null) return clampPct(Math.round(dollars * 100));
  const cents = pickNum(m.last_price) ?? midOf(m.yes_bid, m.yes_ask);
  if (cents != null) return clampPct(Math.round(cents));
  return null;
}

function marketVolume(m) { return pickNum(m.volume_fp) ?? pickNum(m.volume) ?? 0; }
function marketVol24(m) { return pickNum(m.volume_24h_fp) ?? pickNum(m.volume_24h) ?? 0; }
function marketLiquidity(m) {
  return pickNum(m.liquidity_dollars) ?? pickNum(m.liquidity) ?? pickNum(m.open_interest_fp) ?? 0;
}

// ── Category mapping (Kalshi event.category → our category ids) ───────
function mapCategory(raw) {
  const c = String(raw || '').toLowerCase().trim();
  if (!c) return 'other';
  if (/politic|election|geopolit|world|government/.test(c)) return 'politics';
  if (/econom|financ|fed|inflation|interest|gdp|jobs|treasur/.test(c)) return 'economy';
  if (/crypto|bitcoin|ethereum/.test(c)) return 'crypto';
  if (/sport/.test(c)) return 'sports';
  if (/science|technolog|space/.test(c)) return 'science';
  if (/climate|weather|culture|entertain|music|movie|tv|award|celebrit/.test(c)) return 'culture';
  return 'other';
}

// ── Normalize a Kalshi event (with nested markets) → slim card shape ──
function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const markets = Array.isArray(event.markets) ? event.markets : [];
  if (markets.length === 0) return null;

  const category = mapCategory(event.category);
  const outcomes = [];
  let totalVolume = 0;
  let totalLiquidity = 0;
  let volume24h = 0;
  let latestClose = '';

  for (const m of markets) {
    if (m.status && !/active|open/i.test(m.status)) continue;
    const yesPct = yesPctFromMarket(m);
    if (yesPct == null) continue;

    const vol = marketVolume(m);
    const liq = marketLiquidity(m);
    totalVolume += vol;
    totalLiquidity += liq;
    volume24h += marketVol24(m);

    const label = String(m.yes_sub_title || m.subtitle || m.title || event.title || '').trim();
    const close = m.close_time || m.expected_expiration_time || '';
    if (close && (!latestClose || close > latestClose)) latestClose = close;

    outcomes.push({
      id: m.ticker || m.event_ticker || `${event.event_ticker}-${outcomes.length}`,
      question: m.title || event.title || '',
      label: label === (event.title || '') ? '' : label,
      yesPct,
      volume: vol,
      liquidity: liq,
      endDate: close,
      source: 'kalshi',
    });
  }

  if (outcomes.length === 0) return null;
  outcomes.sort((a, b) => b.yesPct - a.yesPct);

  const ticker = event.event_ticker || '';
  const series = String(event.series_ticker || ticker || '').toLowerCase();
  const endDate = event.close_time || latestClose || '';
  const endStr = endDate
    ? new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '-';

  return {
    id: ticker || series,
    slug: ticker,
    title: event.title || outcomes[0].question,
    image: '',
    icon: '',
    category,
    outcomes: outcomes.slice(0, 4),
    totalVolume,
    totalLiquidity,
    volume24h,
    endDate: endStr,
    url: series ? `https://kalshi.com/markets/${series}` : 'https://kalshi.com',
    source: 'kalshi',
  };
}

function setCors(req, res) {
  const origin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Route: events (default) ───────────────────────────────────────────
const MAX_PAGES = 6;
const PAGE_LIMIT = 200;

async function handleEvents(req, res) {
  const seen = new Set();
  const events = [];
  let cursor = '';

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      status: 'open',
      limit: String(PAGE_LIMIT),
      with_nested_markets: 'true',
    });
    if (cursor) params.set('cursor', cursor);

    let json;
    try {
      const r = await fetch(`${KALSHI_API}/events?${params}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) break;
      json = await r.json();
    } catch (err) {
      console.warn('[Kalshi] events page', page, 'error:', err.message);
      break;
    }

    const batch = Array.isArray(json?.events) ? json.events : [];
    for (const event of batch) {
      const key = event.event_ticker;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const card = normalizeEvent(event);
      if (card) events.push(card);
    }

    cursor = json?.cursor || '';
    if (!cursor || batch.length < PAGE_LIMIT) break;
  }

  events.sort((a, b) => b.totalVolume - a.totalVolume);
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(events);
}

// ── Route: event (single by event_ticker) ─────────────────────────────
async function handleEvent(req, res) {
  const ticker = req.query.ticker || req.query.slug;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const url = `${KALSHI_API}/events/${encodeURIComponent(ticker)}?with_nested_markets=true`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Kalshi API returned ${r.status}`);
  const json = await r.json();
  const card = normalizeEvent(json?.event || json);

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json(card);
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const route = req.query.route || 'events';

  try {
    switch (route) {
      case 'events':
        return await handleEvents(req, res);
      case 'event':
        return await handleEvent(req, res);
      default:
        return res.status(400).json({ error: `Unknown route: ${route}` });
    }
  } catch (err) {
    console.error(`[Kalshi] ${route} error:`, err.message);
    return res.status(502).json({ error: 'Kalshi API unavailable' });
  }
}
