/**
 * Polymarket Gamma API proxy routes.
 * Factory pattern — dependencies passed explicitly from index.js.
 */
const express = require('express');
const router = express.Router();

module.exports = function createPolymarketRouter({ cache, helpers }) {
  const { getCached, setCached } = helpers;

  // Strip Gamma event objects down to only the fields the frontend uses.
  // Cuts payload ~3-5x — original events ship descriptions, resolution sources,
  // image variants, market `events` arrays etc., none of which the cards or
  // detail view read. Keep this in sync with `apps/research/api/_lib/handlers/polymarket.js`.
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // Polymarket Gamma API proxy — avoids CORS for browser requests
  // ═══════════════════════════════════════════════════════════════════════════════
  let polymarketCache = { data: null, timestamp: 0 };
  const POLYMARKET_TTL = 3 * 60 * 1000; // 3 min cache

  router.get('/events', async (req, res) => {
    try {
      const now = Date.now();
      if (polymarketCache.data && (now - polymarketCache.timestamp) < POLYMARKET_TTL) {
        return res.json(polymarketCache.data);
      }

      const GAMMA = 'https://gamma-api.polymarket.com/events';
      const hdrs = { Accept: 'application/json' };
      const seen = new Set();
      const allEvents = [];

      // Strategy: fetch by tag to get diverse categories
      // Each tag query pulls the most relevant events for that category
      const fetches = [
        // Latest (sports/esports etc)
        `${GAMMA}?closed=false&limit=100&offset=0&order=id&ascending=false`,
        // Politics & Elections
        `${GAMMA}?closed=false&limit=50&tag=politics`,
        `${GAMMA}?closed=false&limit=50&tag=elections`,
        // Economy & Finance
        `${GAMMA}?closed=false&limit=50&tag=economy`,
        `${GAMMA}?closed=false&limit=50&tag=earnings`,
        // Sports (deeper)
        `${GAMMA}?closed=false&limit=50&tag=basketball`,
        `${GAMMA}?closed=false&limit=50&tag=soccer`,
        // Science / Culture
        `${GAMMA}?closed=false&limit=30&tag=science`,
        `${GAMMA}?closed=false&limit=30&tag=pop-culture`,
        // Crypto
        `${GAMMA}?closed=false&limit=30&tag=crypto`,
      ];

      // Fetch all in parallel
      const results = await Promise.allSettled(
        fetches.map(url => fetch(url, { headers: hdrs }).then(r => r.ok ? r.json() : []))
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const data = result.value;
        if (!Array.isArray(data)) continue;
        for (const event of data) {
          if (!event.id || seen.has(event.id)) continue;
          seen.add(event.id);
          const slim = slimEvent(event);
          if (slim) allEvents.push(slim);
        }
      }

      polymarketCache = { data: allEvents, timestamp: now };
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      res.json(allEvents);
    } catch (err) {
      console.error('Polymarket proxy error:', err.message);
      if (polymarketCache.data) return res.json(polymarketCache.data);
      res.json([]);
    }
  });

  // ── Polymarket single event by slug ──────────────────────────────────
  async function fetchEventBySlug(slug) {
    const cacheKey = `polymarket-event-${slug}`;
    const cached = getCached(cache.polymarketEvent, cacheKey, 60_000);
    if (cached) return cached;

    const url = `https://gamma-api.polymarket.com/events/slug/${encodeURIComponent(slug)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Gamma API returned ${response.status}`);
    const raw = await response.json();
    const slim = slimEvent(raw);
    setCached(cache.polymarketEvent, cacheKey, slim, 60_000);
    return slim;
  }

  router.get('/event/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.status(400).json({ error: 'Missing slug parameter' });
      const data = await fetchEventBySlug(slug);
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      res.json(data);
    } catch (err) {
      console.error('[Polymarket] Event detail error:', err.message);
      res.status(502).json({ error: 'Polymarket event API unavailable' });
    }
  });

  // ── Polymarket event + initial price history bundle ────────────────
  // One round trip instead of two sequential ones. Server parallelises
  // the Gamma event fetch and the CLOB prices fetch (which the client
  // would otherwise have to wait for `clobTokenIds` to come back first).
  router.get('/event-bundle/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.status(400).json({ error: 'Missing slug parameter' });

      const interval = String(req.query.interval || '1w');
      const fidelity = String(req.query.fidelity || '200');

      const VALID = { '1h': '1h', '6h': '6h', '1d': '1d', '1w': '1w', '1m': '1m' };
      const isAll = interval === 'all';

      // Fetch the event first; we need its clobTokenIds + startDate before we
      // know which CLOB market to ask for. The event itself is cached 60s so
      // navigation between events stays cheap.
      const event = await fetchEventBySlug(slug);
      const market = event?.markets?.[0];
      let yesTokenId = null;
      try {
        const ids = JSON.parse(market?.clobTokenIds || '[]');
        yesTokenId = ids[0] || null;
      } catch (_) {}

      let history = [];
      if (yesTokenId) {
        const cacheKey = `polymarket-prices-${yesTokenId}-${isAll ? 'all' : (VALID[interval] || '1w')}-${fidelity}`;
        const cachedHist = getCached(cache.polymarketPrices, cacheKey, 60_000);
        if (cachedHist) {
          history = cachedHist?.history || cachedHist || [];
        } else {
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
            const r = await fetch(`https://clob.polymarket.com/prices-history?${params}`, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(10000),
            });
            if (r.ok) {
              const data = await r.json();
              setCached(cache.polymarketPrices, cacheKey, data, 60_000);
              history = data?.history || data || [];
            }
          } catch (e) {
            console.warn('[Polymarket] bundle prices fetch failed:', e.message);
          }
        }
      }

      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      res.json({ event, history, interval, fidelity });
    } catch (err) {
      console.error('[Polymarket] Event bundle error:', err.message);
      res.status(502).json({ error: 'Polymarket event bundle unavailable' });
    }
  });

  // ── Polymarket price history proxy (CLOB API) ───────────────────────
  router.get('/prices-history', async (req, res) => {
    try {
      const { tokenId, interval = '1w', fidelity = '200', startTs } = req.query;
      if (!tokenId) return res.status(400).json({ error: 'Missing tokenId parameter' });

      // CLOB API only accepts: 1h, 6h, 1d, 1w, 1m (or startTs mode for ALL)
      const VALID_INTERVALS = { '1h': '1h', '6h': '6h', '1d': '1d', '1w': '1w', '1m': '1m' };
      const INTERVAL_MAP = { '12h': '6h', '4h': '1h' };
      const isAll = interval === 'all';
      const clobInterval = isAll ? null : (VALID_INTERVALS[interval] || INTERVAL_MAP[interval] || '1w');

      const cacheKey = `polymarket-prices-${tokenId}-${isAll ? 'all' : clobInterval}-${fidelity}`;
      const cached = getCached(cache.polymarketPrices, cacheKey, 60_000);
      if (cached) return res.json(cached);

      let params;
      if (isAll) {
        // Use startTs mode - matches Polymarket's CLOB API pattern
        const ts = startTs || '0';
        const f = fidelity || '720';
        params = new URLSearchParams({ market: tokenId, startTs: ts, fidelity: f });
      } else {
        params = new URLSearchParams({ market: tokenId, interval: clobInterval, fidelity });
      }
      const url = `https://clob.polymarket.com/prices-history?${params}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`CLOB API returned ${response.status}`);

      const data = await response.json();
      setCached(cache.polymarketPrices, cacheKey, data, 60_000);
      res.json(data);
    } catch (err) {
      console.error('[Polymarket] Price history error:', err.message);
      res.status(502).json({ error: 'Polymarket price history API unavailable' });
    }
  });

  // ── Polymarket AI analysis ──────────────────────────────────────────
  router.get('/analysis', async (req, res) => {
    try {
      const { eventSlug } = req.query;
      if (!eventSlug) return res.status(400).json({ error: 'Missing eventSlug parameter' });

      const cacheKey = `polymarket-analysis-${eventSlug}`;
      const cached = getCached(cache.polymarketAnalysis, cacheKey, 1_800_000);
      if (cached) return res.json(cached);

      // Fetch event data from Gamma API
      const eventUrl = `https://gamma-api.polymarket.com/events/slug/${encodeURIComponent(eventSlug)}`;
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

      const ANALYSIS_API_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANALYSIS_API_KEY) {
        // Fallback analysis based on probability
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
        setCached(cache.polymarketAnalysis, cacheKey, fallback, 1_800_000);
        return res.json(fallback);
      }

      const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
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

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANALYSIS_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!claudeRes.ok) {
        console.error('[Polymarket] Claude API returned', claudeRes.status);
        throw new Error(`Claude API returned ${claudeRes.status}`);
      }

      const claudeData = await claudeRes.json();
      const text = claudeData?.content?.[0]?.text || '';
      let analysis;
      try {
        analysis = JSON.parse(text);
      } catch (_) {
        // Try extracting JSON from the response
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          analysis = JSON.parse(match[0]);
        } else {
          throw new Error('Failed to parse Claude response as JSON');
        }
      }

      setCached(cache.polymarketAnalysis, cacheKey, analysis, 1_800_000);
      res.json(analysis);
    } catch (err) {
      console.error('[Polymarket] Analysis error:', err.message);
      res.status(502).json({ error: 'Analysis unavailable' });
    }
  });

  // ── Polymarket order book proxy (CLOB API) ──────────────────────────
  router.get('/orderbook', async (req, res) => {
    try {
      const { tokenId } = req.query;
      if (!tokenId) return res.status(400).json({ error: 'Missing tokenId parameter' });

      const url = `https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      const data = await response.json();
      // CLOB returns 200 with {error: "..."} when no orderbook exists
      if (data.error) return res.json({ bids: [], asks: [] });

      res.json(data);
    } catch (err) {
      console.error('[Polymarket] Order book error:', err.message);
      res.json({ bids: [], asks: [] });
    }
  });

  // ── Polymarket recent trades proxy (Data API) ──────────────────────
  router.get('/trades', async (req, res) => {
    try {
      const { tokenId, eventSlug, limit = '20' } = req.query;
      if (!tokenId) return res.status(400).json({ error: 'Missing tokenId parameter' });

      const fetchLimit = eventSlug ? Math.min(parseInt(limit) * 3, 100) : limit;
      const params = new URLSearchParams({ asset_id: tokenId, limit: String(fetchLimit) });
      const url = `https://data-api.polymarket.com/trades?${params}`;
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

      res.json(data.slice(0, parseInt(limit)));
    } catch (err) {
      console.error('[Polymarket] Trades error:', err.message);
      res.json([]);
    }
  });

  return router;
};
