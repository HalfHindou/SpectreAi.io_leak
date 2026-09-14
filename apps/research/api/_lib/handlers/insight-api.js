/**
 * Vercel Serverless - Insight generation API.
 * Supports:
 *  - POST /api/insight      -> generate AI insight for a metric
 *  - GET  /api/insights/rss -> RSS 2.0 feed (limited in stateless env)
 *
 * Routing: vercel.json rewrites:
 *   /api/insight       -> /api/insight-api
 *   /api/insights/rss  -> /api/insight-api?route=rss
 */

// ── Metric types map (mirrors packages/server/routes/insight.js) ─────────────
const METRIC_TYPES = {
  'fear-greed':       { label: 'Market Sentiment' },
  'dominance':        { label: 'Market Dominance' },
  'market-cap':       { label: 'Market Capitalization' },
  'volume':           { label: 'Trading Volume' },
  'price':            { label: 'Price Action' },
  'price-change':     { label: 'Price Movement' },
  'volatility':       { label: 'Volatility' },
  'liquidation':      { label: 'Liquidation Data' },
  'funding-rate':     { label: 'Funding Rate' },
  'open-interest':    { label: 'Open Interest' },
  'long-short-ratio': { label: 'Long/Short Ratio' },
  'tvl':              { label: 'Total Value Locked' },
  'gas':              { label: 'Network Gas' },
  'sector':           { label: 'Sector Performance' },
  'stablecoin-flow':  { label: 'Stablecoin Flow' },
  'exchange-flow':    { label: 'Exchange Flow' },
  'whale-activity':   { label: 'Whale Activity' },
  'social-sentiment': { label: 'Social Sentiment' },
  'etf-flow':         { label: 'ETF Flow' },
  'supply':           { label: 'Supply Metrics' },
  'custom':           { label: 'Intelligence' },
};

// ── Prompt builder ───────────────────────────────────────────────────────────
function buildPrompt({ metricType, metricValue, metricLabel, context }) {
  const { tokenSymbol, sector, timeframe, additionalContext } = context || {};

  return `You are a senior crypto analyst at a top-tier fund. A user is looking at a specific data point and wants to understand its trading implications.

METRIC TYPE: ${metricType}
CURRENT VALUE: ${metricValue}
LABEL: ${metricLabel}
${tokenSymbol ? `TOKEN: ${tokenSymbol}` : ''}
${sector ? `SECTOR: ${sector}` : ''}
${timeframe ? `TIMEFRAME: ${timeframe}` : ''}
${additionalContext ? `ADDITIONAL CONTEXT: ${JSON.stringify(additionalContext)}` : ''}

Respond with raw JSON (no markdown, no backticks):
{
  "title": "One sentence actionable headline. Max 12 words.",
  "body": "2-3 sentences explaining WHY this metric matters for trading. Specific to the current value.",
  "historical": "1-2 sentences about historical patterns at similar values. Include hit rates, returns, timeframes. null if no reliable pattern.",
  "actions": [
    { "type": "bullish|bearish|neutral", "text": "Specific actionable angle with token names, timeframes, or strategies." }
  ]
}

RULES:
- CRITICAL: Use EXACTLY the CURRENT VALUE provided above in your response. Do NOT substitute your own estimate or training data. The value "${metricValue}" is live data from the user's dashboard — treat it as ground truth.
- If extreme, call it out
- Actions must be concrete: name tokens, timeframes, strategies
- Always include at least one bearish/cautionary action
- Never say "buy" or "sell" directly
- Under 200 words total
- 2-3 actions maximum`;
}

// ── Fallback response ────────────────────────────────────────────────────────
function buildFallbackInsight(metricValue, metricLabel) {
  return {
    label: 'Intelligence',
    title: 'AI analysis temporarily unavailable',
    body: `The intelligence engine is processing. This metric shows ${metricValue} for ${metricLabel}. Check back shortly for AI-powered context.`,
    historical: null,
    actions: [{ type: 'neutral', text: 'Monitor this metric for significant changes' }],
  };
}

// ── JSON parser with markdown fence stripping ────────────────────────────────
function parseInsightJson(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

// ── XML escape ───────────────────────────────────────────────────────────────
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
import { rateLimit } from '../ratelimit.js';
import { chat } from '../llm-gateway.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Rate-limit the POST (Anthropic call). RSS GET is cheap, skip the gate.
  if (req.method === 'POST') {
    if (await rateLimit(req, res, { bucket: 'insight', max: 10, windowMs: 60_000 })) return;
  }

  const route = (req.query.route || '').toLowerCase();

  // ── GET /api/insights/rss — empty feed in stateless serverless ────────────
  if (route === 'rss') {
    const now = new Date().toUTCString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:spectre="https://spectre.ai/rss/insight/1.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Spectre AI - Market Insights</title>
    <link>https://spectre.ai</link>
    <description>AI-powered market intelligence insights from Spectre AI</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>Spectre AI Insight Engine</generator>
    <atom:link href="https://spectre.ai/api/insights/rss" rel="self" type="application/rss+xml"/>
  </channel>
</rss>`;
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.send(xml);
  }

  // ── POST /api/insight — generate AI insight ───────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required for insight generation' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { metricType, metricValue, metricLabel, context } = body;

    // Validate required fields
    if (!metricType || metricValue === undefined || metricValue === null || !metricLabel) {
      return res.status(400).json({
        error: 'Missing required fields: metricType, metricValue, metricLabel',
      });
    }

    // Resolve label
    const metricMeta = METRIC_TYPES[metricType] || METRIC_TYPES.custom;
    const label = metricMeta.label;

    // Build prompt and call the resilient LLM gateway. We moved OFF Anthropic to
    // free/cheap models (groq -> cerebras -> gemini -> openrouter -> ... , circuit-
    // broken), so this handler must go through the gateway like the dev route
    // (packages/server/routes/insight.js) already does. The old raw-Anthropic path
    // called a retired model and silently returned the "temporarily unavailable"
    // fallback on every request -> the "i" tooltips showed no real analysis.
    // `tier: 'fast'` keeps it on the cheap models (these fire on every tap).
    const prompt = buildPrompt({ metricType, metricValue, metricLabel, context });

    let text = '';
    try {
      const r = await chat({
        messages: [{ role: 'user', content: prompt }],
        tier: 'fast',
        json: true,
        maxTokens: 512,
        temperature: 0.4,
        timeoutMs: 12000,
      });
      if (r.ok) text = r.text || '';
      else console.error('[insight-api] gateway: all providers failed', r.tried);
    } catch (e) {
      console.error('[insight-api] gateway threw:', e.message);
    }

    // Every provider down -> static fallback (still returns a usable insight).
    if (!text) {
      const fallback = buildFallbackInsight(metricValue, metricLabel);
      return res.json({
        insight: fallback,
        cached: false,
        fallback: true,
        generatedAt: new Date().toISOString(),
      });
    }

    // Parse JSON from response
    let insight;
    try {
      insight = parseInsightJson(text);
    } catch (parseErr) {
      console.error('[insight-api] JSON parse error:', parseErr.message);
      const fallback = buildFallbackInsight(metricValue, metricLabel);
      return res.json({
        insight: fallback,
        cached: false,
        fallback: true,
        generatedAt: new Date().toISOString(),
      });
    }

    // Validate structure
    if (!insight.title || !insight.body || !Array.isArray(insight.actions)) {
      console.error('[insight-api] Invalid structure from LLM');
      const fallback = buildFallbackInsight(metricValue, metricLabel);
      return res.json({
        insight: fallback,
        cached: false,
        fallback: true,
        generatedAt: new Date().toISOString(),
      });
    }

    return res.json({
      insight: { label, ...insight },
      cached: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[insight-api] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Failed to generate insight' });
  }
}
