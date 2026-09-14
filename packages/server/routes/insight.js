/**
 * SHADOW ENDPOINT — POST /api/insight-shadow
 * ═══════════════════════════════════════════════════════════════
 * Groq + Spectre API replacement for the /api/insight flow.
 * Mirrors the response shape of routes/insight.js so the frontend
 * and test harness can swap with zero changes.
 * ═══════════════════════════════════════════════════════════════
 */
const express = require('express');
const fetch = require('node-fetch');
const { chat: gatewayChat } = require('../lib/llm-gateway');

const router = express.Router();

// ── CONFIG ───────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SPECTRE_API_BASE = process.env.SPECTRE_API_BASE_URL || 'http://204.168.244.18';
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_BRIDGE_KEY;
if (!SPECTRE_API_KEY) console.warn('[insight] SPECTRE_DATA_BRIDGE_KEY not set - insight routes will fail upstream');

const SPECTRE_TIMEOUT_MS = 8000;
const GROQ_TIMEOUT_MS = 20000;

// Mirror the label map from routes/insight.js so the shadow returns the same
// `label` field the frontend expects.
const METRIC_LABELS = {
  'fear-greed':       'Market Sentiment',
  'dominance':        'Market Dominance',
  'market-cap':       'Market Capitalization',
  'market_cap':       'Market Capitalization',
  'volume':           'Trading Volume',
  'price':            'Price Action',
  'price-change':     'Price Movement',
  'volatility':       'Volatility',
  'liquidation':      'Liquidation Data',
  'funding-rate':     'Funding Rate',
  'funding_rate':     'Funding Rate',
  'open-interest':    'Open Interest',
  'long-short-ratio': 'Long/Short Ratio',
  'rsi':              'RSI',
  'tvl':              'Total Value Locked',
  'gas':              'Network Gas',
  'sector':           'Sector Performance',
  'stablecoin-flow':  'Stablecoin Flow',
  'alt-season':       'Alt Season Index',
  'btc-dominance':    'BTC Dominance',
  'exchange-flow':    'Exchange Flow',
  'whale-activity':   'Whale Activity',
  'social-sentiment': 'Social Sentiment',
  'etf-flow':         'ETF Flow',
  'supply':           'Supply Metrics',
  'custom':           'Intelligence',
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function spectreFetch(path) {
  const url = `${SPECTRE_API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SPECTRE_TIMEOUT_MS),
    });
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: typeof body === 'string' ? body.slice(0, 200) : (body?.error || `HTTP ${res.status}`), path };
    }
    return { ok: true, status: res.status, data: body, error: null, path };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message || String(e), path };
  }
}

function compact(obj, maxChars = 2000) {
  if (obj == null) return 'null';
  let s;
  try { s = JSON.stringify(obj); } catch { return '[unserializable]'; }
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `... [truncated]`;
}

/**
 * Insight LLM call — routed through the resilient multi-provider gateway
 * (groq→cerebras→gemini→openrouter→openai→anthropic→ollama, circuit-broken)
 * so a single-provider billing outage can no longer blank the surface.
 * Requests a JSON object (json:true) since the caller parses one out.
 * Returns { ok, content, error, model } — same shape the caller expects.
 */
async function callGroq(systemPrompt, userMessage, { maxTokens = 512, temperature = 0.2 } = {}) {
  const r = await gatewayChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    tier: 'smart',
    maxTokens,
    temperature,
    timeoutMs: GROQ_TIMEOUT_MS,
    json: true,
  });
  if (!r.ok) {
    return { ok: false, content: '', error: r.error || 'all LLM providers failed', model: r.provider || null };
  }
  return { ok: true, content: r.text, error: null, model: r.model || GROQ_MODEL, provider: r.provider };
}

/** Extract JSON object from LLM text (handles markdown fences, leading text). */
function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch { /* noop */ } }
  return null;
}

// ── SHADOW SYSTEM PROMPT ─────────────────────────────────────────────────────
const SHADOW_SYSTEM_PROMPT = `You are Spectre's metric insight engine. Given a specific metric and its current value for an asset, explain what this means for a trader. Frame as "here's the play" not "here's the definition." Use specific numbers from the data provided. 2-3 sentences max.

You must respond with raw JSON only (no markdown, no backticks, no prefix text), matching this exact schema:
{
  "title": "One sentence actionable headline. Max 12 words.",
  "body": "2-3 sentences explaining the current trading implication. Cite numbers from the provided data.",
  "historical": "1-2 sentences about historical patterns at similar values, or null if data isn't available.",
  "actions": [
    { "type": "bullish|bearish|neutral", "text": "Specific angle with timeframe or strategy." }
  ]
}

RULES:
- Be specific to the CURRENT VALUE.
- Name specific numbers from the data (price, change %, volume, scores, etc.).
- Always include at least one cautionary ("bearish" or "neutral") action.
- Never say "buy" or "sell" directly.
- 2 to 3 actions maximum.
- Under 200 words total.`;

function buildFallback(metricValue, metricLabel) {
  return {
    label: metricLabel || 'Intelligence',
    title: 'AI analysis temporarily unavailable',
    body: `Metric shows ${metricValue} for ${metricLabel || 'this metric'}. Check back shortly.`,
    historical: null,
    actions: [{ type: 'neutral', text: 'Monitor this metric for significant changes' }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/insight-shadow
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  const start = Date.now();
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // Accept both legacy (metricType/metricValue/metricLabel/context)
    // and the new test-harness shape (metric_key/asset/current_value/context).
    const metricKey = body.metric_key || body.metricType || body.metricKey || '';
    const asset = body.asset || body.context?.tokenSymbol || body.tokenSymbol || '';
    const currentValue = body.current_value !== undefined
      ? body.current_value
      : body.metricValue;
    const metricLabel = body.metricLabel || METRIC_LABELS[metricKey] || METRIC_LABELS.custom;
    const extraContext = body.context || {};

    if (!metricKey || currentValue === undefined || currentValue === null) {
      return res.status(400).json({
        error: 'Missing required fields: metric_key and current_value (or metricType and metricValue)',
      });
    }

    // ── 1. FETCH SPECTRE DATA IN PARALLEL (if we have an asset) ──────────────
    const context = {};
    const sources = [];
    const failures = [];

    if (asset) {
      const assetU = String(asset).toUpperCase();
      const fetches = [
        { label: 'price', req: spectreFetch(`/v1/prices/${encodeURIComponent(assetU)}`) },
        { label: 'technicals', req: spectreFetch(`/v1/technicals/${encodeURIComponent(assetU)}`) },
        { label: 'scores', req: spectreFetch(`/v1/institutional/scores/${encodeURIComponent(assetU)}`) },
      ];
      const settled = await Promise.all(fetches.map(async f => ({ label: f.label, result: await f.req })));
      for (const { label, result } of settled) {
        if (result.ok) {
          context[label] = result.data;
          sources.push({ label, path: result.path });
        } else {
          failures.push({ label, path: result.path, status: result.status, error: result.error });
        }
      }
    }

    // ── 2. BUILD USER PROMPT ─────────────────────────────────────────────────
    const userBlock = [
      `METRIC_KEY: ${metricKey}`,
      `METRIC_LABEL: ${metricLabel}`,
      `CURRENT_VALUE: ${currentValue}`,
      asset ? `ASSET: ${String(asset).toUpperCase()}` : 'ASSET: (none)',
      extraContext?.sector ? `SECTOR: ${extraContext.sector}` : '',
      extraContext?.timeframe ? `TIMEFRAME: ${extraContext.timeframe}` : '',
      '',
      'SPECTRE DATA (may be partial or empty):',
      ...Object.entries(context).map(([k, v]) => `[${k.toUpperCase()}] ${compact(v, 1500)}`),
    ].filter(Boolean);
    if (failures.length) {
      userBlock.push('', 'FAILED ENDPOINTS:');
      failures.forEach(f => userBlock.push(`- ${f.label} (${f.path}): ${f.status || 'network'} ${f.error}`));
    }
    if (!Object.keys(context).length && !failures.length) {
      userBlock.push('', 'NOTE: No asset provided — reasoning from metric value alone.');
    }

    // ── 3. GROQ SYNTHESIS ─────────────────────────────────────────────────────
    const groqResult = await callGroq(SHADOW_SYSTEM_PROMPT, userBlock.join('\n'));
    const elapsed = Date.now() - start;

    if (!groqResult.ok) {
      return res.json({
        insight: buildFallback(currentValue, metricLabel),
        cached: false,
        fallback: true,
        generatedAt: new Date().toISOString(),
        shadow: {
          ok: false,
          error: groqResult.error,
          elapsedMs: elapsed,
          sources,
          failures,
          raw: context,
          model: groqResult.model,
        },
      });
    }

    // ── 4. PARSE + VALIDATE ──────────────────────────────────────────────────
    let insight = extractJSON(groqResult.content);
    if (!insight || !insight.title || !insight.body || !Array.isArray(insight.actions)) {
      return res.json({
        insight: buildFallback(currentValue, metricLabel),
        cached: false,
        fallback: true,
        generatedAt: new Date().toISOString(),
        shadow: {
          ok: false,
          error: 'Groq returned invalid insight JSON',
          elapsedMs: elapsed,
          raw: context,
          rawContent: groqResult.content?.slice(0, 500),
          sources,
          failures,
          model: groqResult.model,
        },
      });
    }

    res.json({
      insight: { label: metricLabel, ...insight },
      cached: false,
      generatedAt: new Date().toISOString(),
      shadow: {
        ok: true,
        elapsedMs: elapsed,
        sources,
        failures,
        model: groqResult.model,
        usage: groqResult.usage,
        raw: context,
      },
    });
  } catch (err) {
    console.error('[insight-shadow] Unhandled error:', err.message);
    res.status(500).json({ error: 'Shadow insight failed: ' + err.message });
  }
});

module.exports = router;
