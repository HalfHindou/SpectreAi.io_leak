/**
 * Unified prediction-market proxy (Express dev). Mirrors
 * apps/research/api/predictions.js — Polymarket Gamma (volume-ordered) + Kalshi
 * public APIs, filtered by keyword. GET /api/predictions?q=spacex →
 * { polymarket, kalshi }. Never throws.
 */
const express = require('express');
const router = express.Router();

const GAMMA = 'https://gamma-api.polymarket.com/events';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const HEADERS = { 'User-Agent': 'Spectre/1.0', Accept: 'application/json' };

const _cache = new Map();
function getCached(k, ttl) {
  const e = _cache.get(k);
  if (!e || Date.now() - e.ts > ttl) return null;
  return e.data;
}
function setCached(k, d) {
  _cache.set(k, { data: d, ts: Date.now() });
  if (_cache.size > 60) _cache.delete(_cache.keys().next().value);
}

function polyOutcomes(markets) {
  const out = [];
  for (const m of Array.isArray(markets) ? markets : []) {
    let prices;
    try {
      prices = JSON.parse(m.outcomePrices || '[]');
    } catch {
      prices = [];
    }
    const yes = parseFloat(prices && prices[0]);
    if (!Number.isFinite(yes)) continue;
    const label = String(m.groupItemTitle || m.question || '').replace(/\?$/, '').trim();
    if (!label) continue;
    out.push({ label, prob: Math.round(yes * 100) });
  }
  return out.sort((a, b) => b.prob - a.prob).slice(0, 6);
}

async function fetchPolymarket(terms) {
  const r = await fetch(`${GAMMA}?closed=false&limit=250&order=volume&ascending=false`, {
    signal: AbortSignal.timeout(10000),
    headers: HEADERS,
  }).catch(() => null);
  if (!r || !r.ok) return [];
  const events = await r.json().catch(() => []);
  return (Array.isArray(events) ? events : [])
    .filter((e) => {
      if (/resolved/i.test(e.title || '')) return false;
      const hay = `${e.title || ''} ${e.description || ''}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    })
    .map((e) => ({
      id: e.slug || String(e.id),
      question: e.title || '',
      subtitle: '',
      url: e.slug ? `https://polymarket.com/event/${e.slug}` : 'https://polymarket.com',
      volume: parseFloat(e.volume) || 0,
      outcomes: polyOutcomes(e.markets),
      source: 'polymarket',
    }))
    .filter((e) => e.outcomes.length)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5);
}

async function fetchKalshi(terms) {
  const er = await fetch(`${KALSHI}/events?status=open&limit=200`, {
    signal: AbortSignal.timeout(10000),
    headers: HEADERS,
  }).catch(() => null);
  if (!er || !er.ok) return [];
  const ej = await er.json().catch(() => ({}));
  const events = (ej.events || [])
    .filter((e) => {
      const hay = `${e.title || ''} ${e.sub_title || ''} ${e.category || ''} ${e.series_ticker || ''}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    })
    .slice(0, 6);

  const out = [];
  for (const e of events) {
    let markets = [];
    const mr = await fetch(
      `${KALSHI}/markets?status=open&limit=40&event_ticker=${encodeURIComponent(e.event_ticker)}`,
      { signal: AbortSignal.timeout(8000), headers: HEADERS }
    ).catch(() => null);
    if (mr && mr.ok) {
      const mj = await mr.json().catch(() => ({}));
      markets = mj.markets || [];
    }
    const outcomes = markets
      .map((m) => {
        const cents =
          typeof m.last_price === 'number' && m.last_price > 0
            ? m.last_price
            : ((m.yes_bid || 0) + (m.yes_ask || 0)) / 2;
        return {
          label: m.yes_sub_title || m.subtitle || m.title || 'Yes',
          prob: Math.max(0, Math.min(100, Math.round(cents))),
        };
      })
      .filter((o) => o.label)
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 6);
    const volume = markets.reduce((s, m) => s + (m.volume || 0), 0);
    out.push({
      id: e.event_ticker,
      question: e.title,
      subtitle: e.sub_title || '',
      url: `https://kalshi.com/markets/${String(e.series_ticker || e.event_ticker || '').toLowerCase()}`,
      volume,
      outcomes,
      source: 'kalshi',
    });
  }
  return out.sort((a, b) => (b.volume || 0) - (a.volume || 0));
}

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const terms = q ? q.split(/[\s,]+/).filter(Boolean) : [];
  if (!terms.length) return res.json({ polymarket: [], kalshi: [] });
  const ck = `pred:${q}`;
  const cached = getCached(ck, 120000);
  if (cached) return res.json(cached);
  try {
    const [polymarket, kalshi] = await Promise.all([
      fetchPolymarket(terms).catch(() => []),
      fetchKalshi(terms).catch(() => []),
    ]);
    const data = { polymarket, kalshi };
    setCached(ck, data);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    console.error('[predictions] proxy error:', err.message);
    res.json({ polymarket: [], kalshi: [] });
  }
});

module.exports = router;
