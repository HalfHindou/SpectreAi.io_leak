/**
 * Vercel Serverless - Polymarket proxy.
 * Multi-route handler:
 *   GET /api/polymarket?route=events         - all open events (parallel tag fetch, dedup)
 *   GET /api/polymarket?route=event&slug=X   - single event by slug
 *   GET /api/polymarket?route=prices-history  - CLOB price history
 *   GET /api/polymarket?route=orderbook       - CLOB order book depth
 *   GET /api/polymarket?route=trades          - CLOB recent trades
 */

import { chat as gatewayChat } from '../llm-gateway.js';

// Any one of these means the gateway has something to call.
const PROVIDER_KEYS = ['GROQ_API_KEY', 'CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'LENS_GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];


const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
];

// Strip Gamma event objects down to only the fields the frontend reads.
// Cuts payload ~3-5x. Keep in sync with packages/server/routes/polymarket.js.
function slimEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const markets = Array.isArray(event.markets) ? event.markets.map((m) => ({
    id: m.id,
    slug: m.slug,
    question: m.question,
    closed: m.closed,
    outcomePrices: m.outcomePrices,
    clobTokenIds: m.clobTokenIds,
    volume: m.volume,
    volumeNum: m.volumeNum,
    volume24hr: m.volume24hr,
    volume1wk: m.volume1wk,
    liquidity: m.liquidity,
    liquidityNum: m.liquidityNum,
    endDate: m.endDate,
    startDate: m.startDate,
    createdAt: m.createdAt,
    bestBid: m.bestBid,
    bestAsk: m.bestAsk,
    lastTradePrice: m.lastTradePrice,
    oneDayPriceChange: m.oneDayPriceChange,
    oneWeekPriceChange: m.oneWeekPriceChange,
  })) : [];
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    image: event.image,
    icon: event.icon,
    endDate: event.endDate,
    tags: (event.tags || []).map((t) => ({ slug: t.slug, label: t.label })),
    markets,
  };
}

const TAG_QUERIES = [
  { tag: '', limit: 100 },
  { tag: 'politics', limit: 50 },
  { tag: 'elections', limit: 50 },
  { tag: 'economy', limit: 50 },
  { tag: 'earnings', limit: 30 },
  { tag: 'basketball', limit: 30 },
  { tag: 'soccer', limit: 30 },
  { tag: 'science', limit: 30 },
  { tag: 'pop-culture', limit: 30 },
  { tag: 'crypto', limit: 50 },
];

function setCors(req, res) {
  const origin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function fetchTag(tag, limit) {
  const params = new URLSearchParams({ limit: String(limit), active: 'true', closed: 'false' });
  if (tag) params.set('tag', tag);
  const url = `${GAMMA_API}/events?${params}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) {
      console.warn(`Polymarket tag="${tag}" returned ${r.status}`);
      return [];
    }
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`Polymarket tag="${tag}" error:`, err.message);
    return [];
  }
}

// ── Route: events (default) ─────────────────────────────────────────
async function handleEvents(req, res) {
  const results = await Promise.all(
    TAG_QUERIES.map(({ tag, limit }) => fetchTag(tag, limit))
  );

  const seen = new Set();
  const events = [];
  for (const batch of results) {
    for (const event of batch) {
      const id = event.id || event.slug;
      if (id && !seen.has(id)) {
        seen.add(id);
        const slim = slimEvent(event);
        if (slim) events.push(slim);
      }
    }
  }

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(events);
}

// ── Route: event (single by slug) ───────────────────────────────────
async function fetchEventBySlug(slug) {
  const url = `${GAMMA_API}/events/slug/${encodeURIComponent(slug)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Gamma API returned ${response.status}`);
  const raw = await response.json();
  return slimEvent(raw);
}

async function handleEvent(req, res) {
  const slug = req.query.slug;
  if (!slug) return res.status(400).json({ error: 'Missing slug parameter' });
  const data = await fetchEventBySlug(slug);
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json(data);
}

// ── Route: event-bundle (event + initial price history) ─────────────
// One round trip for the detail page. Server resolves clobTokenIds from
// the event then fans out the CLOB prices fetch in the same invocation.
async function handleEventBundle(req, res) {
  const slug = req.query.slug;
  if (!slug) return res.status(400).json({ error: 'Missing slug parameter' });

  const interval = String(req.query.interval || '1w');
  const fidelity = String(req.query.fidelity || '200');
  const VALID = { '1h': '1h', '6h': '6h', '1d': '1d', '1w': '1w', '1m': '1m' };
  const isAll = interval === 'all';

  const event = await fetchEventBySlug(slug);
  const market = event?.markets?.[0];
  let yesTokenId = null;
  try {
    const ids = JSON.parse(market?.clobTokenIds || '[]');
    yesTokenId = ids[0] || null;
  } catch (_) {}

  let history = [];
  if (yesTokenId) {
    let params;
    if (isAll) {
      const startTs = market?.startDate
        ? Math.floor(new Date(market.startDate).getTime() / 1000)
        : (market?.createdAt ? Math.floor(new Date(market.createdAt).getTime() / 1000) : 0);
      params = new URLSearchParams({ market: yesTokenId, startTs: String(startTs), fidelity });
    } else {
      params = new URLSearchParams({ market: yesTokenId, interval: VALID[interval] || '1w', fidelity });
    }
    try {
      const r = await fetch(`${CLOB_API}/prices-history?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data = await r.json();
        history = data?.history || data || [];
      }
    } catch (e) {
      console.warn('[Polymarket] bundle prices fetch failed:', e.message);
    }
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json({ event, history, interval, fidelity });
}

// ── Route: prices-history (CLOB proxy) ──────────────────────────────
async function handlePricesHistory(req, res) {
  const { tokenId, interval = '1w', fidelity = '200', startTs } = req.query;
  if (!tokenId) return res.status(400).json({ error: 'Missing tokenId parameter' });

  // CLOB API only accepts: 1h, 6h, 1d, 1w, 1m (or startTs mode for ALL)
  const VALID = { '1h': '1h', '6h': '6h', '1d': '1d', '1w': '1w', '1m': '1m' };
  const FALLBACK = { '12h': '6h', '4h': '1h' };
  const isAll = interval === 'all';
  const clobInterval = isAll ? null : (VALID[interval] || FALLBACK[interval] || '1w');

  let params;
  if (isAll) {
    // Use startTs mode - matches Polymarket's CLOB API pattern
    const ts = startTs || '0';
    const f = fidelity || '720';
    params = new URLSearchParams({ market: tokenId, startTs: ts, fidelity: f });
  } else {
    params = new URLSearchParams({ market: tokenId, interval: clobInterval, fidelity });
  }

  const url = `${CLOB_API}/prices-history?${params}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`CLOB API returned ${response.status}`);

  const data = await response.json();
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json(data);
}

// ── Route: analysis (AI-powered market analysis) ────────────────────
async function handleAnalysis(req, res) {
  const { eventSlug } = req.query;
  if (!eventSlug) return res.status(400).json({ error: 'Missing eventSlug parameter' });

  // Fetch event data from Gamma API
  const eventUrl = `${GAMMA_API}/events/slug/${encodeURIComponent(eventSlug)}`;
  const eventRes = await fetch(eventUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!eventRes.ok) throw new Error(`Gamma API returned ${eventRes.status}`);
  const eventData = await eventRes.json();

  // Parse market data
  const market = eventData?.markets?.[0];
  let yesPct = 50;
  let volume = 0;
  let liquidity = 0;
  if (market) {
    try {
      const prices = JSON.parse(market.outcomePrices || '["0.5","0.5"]');
      yesPct = Math.round(parseFloat(prices[0]) * 100);
    } catch (_) {}
    volume = parseFloat(market.volume || market.volumeNum || 0);
    liquidity = parseFloat(market.liquidity || market.liquidityNum || 0);
  }
  const tags = (eventData.tags || []).map(t => t.label || t.slug || '').filter(Boolean);

  // Was: require an Anthropic key or serve the deterministic fallback. A
  // per-market JSON analysis on Sonnet 4 is the most expensive thing in this
  // file, and it is a structured summary of four numbers we already hold — the
  // free chain writes it. The deterministic fallback stays as the floor for
  // when NO provider answers.
  const hasProvider = PROVIDER_KEYS.some((k) => process.env[k]);
  if (!hasProvider) {
    const sentiment = yesPct >= 65 ? 'bullish' : yesPct <= 35 ? 'bearish' : 'neutral';
    const fallback = {
      sentiment,
      confidence: Math.abs(yesPct - 50) + 50,
      reasoning: `Market probability stands at ${yesPct}% Yes. With $${(volume / 1e6).toFixed(1)}M in volume, this market shows ${sentiment} sentiment based on current trading activity.`,
      keyFactors: [
        `Current probability: ${yesPct}%`,
        `Trading volume: $${(volume / 1e6).toFixed(1)}M`,
        `Market liquidity: $${(liquidity / 1e6).toFixed(1)}M`,
      ],
      whaleActivity: {
        trades: Math.floor(volume / 50000),
        influencers: Math.floor(volume / 200000),
        summary: `Estimated ${Math.floor(volume / 50000)} large trades based on volume patterns.`,
      },
      analysis: `This prediction market currently prices the "Yes" outcome at ${yesPct}%. The market has attracted $${(volume / 1e6).toFixed(1)}M in total volume, indicating ${volume > 1e6 ? 'significant' : 'moderate'} interest from traders.\n\nBased on the current probability and trading patterns, market participants appear ${sentiment} on this outcome. The liquidity of $${(liquidity / 1e6).toFixed(1)}M suggests ${liquidity > 500000 ? 'healthy' : 'developing'} market depth.`,
    };
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(fallback);
  }

  const prompt = `Analyze this prediction market and return a JSON object. No markdown, no code fences - just raw JSON.

Market: "${eventData.title}"
Current Yes probability: ${yesPct}%
Volume: $${volume.toLocaleString()}
Liquidity: $${liquidity.toLocaleString()}
Tags: ${tags.join(', ') || 'none'}
End date: ${market?.endDate || 'unknown'}

Return this exact JSON structure:
{
  "sentiment": "bullish" or "neutral" or "bearish",
  "confidence": number 0-100,
  "reasoning": "2-3 sentence reasoning",
  "keyFactors": ["factor1", "factor2", "factor3"],
  "whaleActivity": {
    "trades": estimated number of large trades (>$10k),
    "influencers": estimated number of notable participants,
    "summary": "1-2 sentence whale activity summary"
  },
  "analysis": "2-3 paragraphs of market analysis"
}`;

  const r = await gatewayChat({
    messages: [{ role: 'user', content: prompt }],
    tier: 'smart', maxTokens: 1024, temperature: 0.3, json: true, timeoutMs: 30000,
  });
  if (!r?.ok) throw new Error(`analysis unavailable (${r?.error || 'no provider'})`);
  const text = r.text || '';
  let analysis;
  try {
    analysis = JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      analysis = JSON.parse(match[0]);
    } else {
      throw new Error('Failed to parse Claude response as JSON');
    }
  }

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  return res.status(200).json(analysis);
}

// ── Route: orderbook (CLOB order book depth) ──────────────────────────
async function handleOrderbook(req, res) {
  const { tokenId } = req.query;
  if (!tokenId) return res.status(400).json({ error: 'Missing tokenId parameter' });

  const url = `${CLOB_API}/book?token_id=${encodeURIComponent(tokenId)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  const data = await response.json();

  // CLOB returns 200 with {error: "..."} when no orderbook exists
  if (data.error) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ bids: [], asks: [] });
  }

  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
  return res.status(200).json(data);
}

// ── Route: trades (Data API recent trades) ─────────────────────────────
async function handleTrades(req, res) {
  const { tokenId, eventSlug, limit = '20' } = req.query;
  if (!tokenId) return res.status(400).json({ error: 'Missing tokenId parameter' });

  // Fetch more than needed so we can filter to the specific market
  const fetchLimit = eventSlug ? Math.min(parseInt(limit) * 3, 100) : limit;
  const params = new URLSearchParams({
    asset_id: tokenId,
    limit: String(fetchLimit),
  });
  const url = `${DATA_API}/trades?${params}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Data API returned ${response.status}`);

  let data = await response.json();
  if (!Array.isArray(data)) data = [];

  // Filter to specific event if slug provided
  if (eventSlug && data.length > 0) {
    const filtered = data.filter(t => t.eventSlug === eventSlug || t.asset === tokenId);
    data = filtered.length > 0 ? filtered : data;
  }

  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
  return res.status(200).json(data.slice(0, parseInt(limit)));
}

// ── Main handler ────────────────────────────────────────────────────
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
      case 'event-bundle':
        return await handleEventBundle(req, res);
      case 'prices-history':
        return await handlePricesHistory(req, res);
      case 'analysis':
        return await handleAnalysis(req, res);
      case 'orderbook':
        return await handleOrderbook(req, res);
      case 'trades':
        return await handleTrades(req, res);
      default:
        return res.status(400).json({ error: `Unknown route: ${route}` });
    }
  } catch (err) {
    console.error(`[Polymarket] ${route} error:`, err.message);
    return res.status(502).json({ error: 'Polymarket API unavailable' });
  }
}
