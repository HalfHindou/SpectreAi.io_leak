/**
 * Kalshi prediction-markets proxy routes (Express dev).
 * Mirrors routes/polymarket.js in shape: normalizes Kalshi events into the SAME
 * slimmed event-card shape polymarketApi.formatEventCards consumes, so the grid
 * engine can blend both sources. Tags source:'kalshi' on every event/outcome.
 *
 * Kalshi cent->yesPct conversion: the public API now returns prices as DOLLAR
 * strings (last_price_dollars:"0.13"), so yesPct = round(dollars*100). Legacy
 * cent-int fields (last_price/yes_bid/yes_ask in 1-99) are honored as a fallback.
 *
 * Factory pattern — dependencies passed explicitly from index.js (mirrors polymarket.js).
 * Keep the normalizer in sync with apps/research/api/_lib/handlers/kalshi.js.
 */
const express = require('express');
const router = express.Router();

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const HEADERS = { 'User-Agent': 'Spectre/1.0', Accept: 'application/json' };

module.exports = function createKalshiRouter({ cache, helpers } = {}) {
  const { getCached, setCached } = helpers || {};

  // ── Price / number coercion ────────────────────────────────────────
  // Kalshi yes-price → 0..100. Prefer last trade, fall back to bid/ask mid.
  function yesPctFromMarket(m) {
    const dollars =
      pickNum(m.last_price_dollars) ??
      midDollars(m.yes_bid_dollars, m.yes_ask_dollars);
    if (dollars != null) return clampPct(Math.round(dollars * 100));
    // Legacy cent-integer fields (1..99) — only if the dollar fields are absent.
    const cents =
      pickNum(m.last_price) ?? mid(m.yes_bid, m.yes_ask);
    if (cents != null) return clampPct(Math.round(cents));
    return null;
  }

  function pickNum(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  function mid(a, b) {
    const x = pickNum(a), y = pickNum(b);
    if (x == null && y == null) return null;
    return ((x || 0) + (y || 0)) / 2;
  }
  function midDollars(a, b) {
    const x = pickNum(a), y = pickNum(b);
    if (x == null && y == null) return null;
    return ((x || 0) + (y || 0)) / 2;
  }
  function clampPct(n) { return Math.max(0, Math.min(100, n)); }

  // Market volume/liquidity are dollar/contract strings (volume_fp, etc.).
  function marketVolume(m) {
    return pickNum(m.volume_fp) ?? pickNum(m.volume) ?? 0;
  }
  function marketVol24(m) {
    return pickNum(m.volume_24h_fp) ?? pickNum(m.volume_24h) ?? 0;
  }
  function marketLiquidity(m) {
    return pickNum(m.liquidity_dollars) ?? pickNum(m.liquidity) ?? pickNum(m.open_interest_fp) ?? 0;
  }

  // ── Category mapping (Kalshi event.category → our category ids) ─────
  // Matches the taxonomy polymarketApi uses: politics|sports|crypto|economy|science|culture|other
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
  // Output mirrors the OBJECT formatEventCards emits so the grid treats both
  // sources identically: outcomes[{label,yesPct,...}], totalVolume, totalLiquidity,
  // category, image/icon, url, id, slug, title, endDate, tags, source.
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

      // For multi-outcome events the per-market yes_sub_title is the candidate/
      // bucket label ("Pierbattista Pizzaballa"); for binary events it's "Yes".
      const label = String(
        m.yes_sub_title || m.subtitle || m.title || event.title || ''
      ).trim();

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

    // Highest-probability outcome first (matches predictions.js ordering).
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

  // ═══════════════════════════════════════════════════════════════════
  // GET /api/kalshi/events — all open events, all categories, paginated, deduped
  // ═══════════════════════════════════════════════════════════════════
  let kalshiCache = { data: null, timestamp: 0 };
  const KALSHI_TTL = 3 * 60 * 1000; // 3 min cache (mirrors polymarket.js)
  const MAX_PAGES = 6;              // up to ~1200 events, then stop
  const PAGE_LIMIT = 200;

  router.get('/events', async (req, res) => {
    try {
      const now = Date.now();
      if (kalshiCache.data && (now - kalshiCache.timestamp) < KALSHI_TTL) {
        return res.json(kalshiCache.data);
      }

      const seen = new Set();
      const allEvents = [];
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
          const r = await fetch(`${KALSHI}/events?${params}`, {
            headers: HEADERS,
            signal: AbortSignal.timeout(10000),
          });
          if (!r.ok) break;
          json = await r.json();
        } catch (e) {
          console.warn('[Kalshi] events page', page, 'fetch failed:', e.message);
          break;
        }

        const events = Array.isArray(json?.events) ? json.events : [];
        for (const event of events) {
          const key = event.event_ticker;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const card = normalizeEvent(event);
          if (card) allEvents.push(card);
        }

        cursor = json?.cursor || '';
        if (!cursor || events.length < PAGE_LIMIT) break;
      }

      allEvents.sort((a, b) => b.totalVolume - a.totalVolume);
      kalshiCache = { data: allEvents, timestamp: now };
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      res.json(allEvents);
    } catch (err) {
      console.error('[Kalshi] events proxy error:', err.message);
      if (kalshiCache.data) return res.json(kalshiCache.data);
      res.json([]);
    }
  });

  // ── GET /api/kalshi/event/:ticker — single event by event_ticker ────
  async function fetchEventByTicker(ticker) {
    const cacheKey = `kalshi-event-${ticker}`;
    if (getCached && cache?.kalshiEvent) {
      const hit = getCached(cache.kalshiEvent, cacheKey, 60_000);
      if (hit) return hit;
    }
    const url = `${KALSHI}/events/${encodeURIComponent(ticker)}?with_nested_markets=true`;
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Kalshi API returned ${r.status}`);
    const json = await r.json();
    const card = normalizeEvent(json?.event || json);
    if (setCached && cache?.kalshiEvent) setCached(cache.kalshiEvent, cacheKey, card, 60_000);
    return card;
  }

  router.get('/event/:ticker', async (req, res) => {
    try {
      const { ticker } = req.params;
      if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });
      const data = await fetchEventByTicker(ticker);
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      res.json(data);
    } catch (err) {
      console.error('[Kalshi] event detail error:', err.message);
      res.status(502).json({ error: 'Kalshi event API unavailable' });
    }
  });

  return router;
};
