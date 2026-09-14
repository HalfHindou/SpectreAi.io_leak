/**
 * Whisper Search — POST /api/search/whisper
 * ═══════════════════════════════════════════════════════════════
 * Groq (llama-3.3-70b-versatile) + Spectre API. Replaced the
 * Anthropic/Perplexity stack on 2026-04-11 after the shadow A/B
 * comparison passed 7/7 cases (see SHADOW_TEST_RESULTS.md).
 * The original inline implementation is preserved as a [SWAPPED]
 * comment block in packages/server/index.js around line 2158.
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
if (!SPECTRE_API_KEY) console.warn('[search] SPECTRE_DATA_BRIDGE_KEY not set - search routes will fail upstream');

const SPECTRE_TIMEOUT_MS = 8000;
const GROQ_TIMEOUT_MS = 20000;

// Known tickers for asset detection inside free-text queries.
// Deliberately narrow — we only care if the query is clearly about a specific coin.
const KNOWN_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT',
  'MATIC', 'ARB', 'OP', 'SUI', 'APT', 'TON', 'NEAR', 'ATOM', 'FTM', 'INJ',
  'TIA', 'SEI', 'PEPE', 'SHIB', 'WIF', 'BONK', 'JUP', 'RNDR', 'FET', 'TAO',
  'UNI', 'AAVE', 'LDO', 'MKR', 'CRV', 'SNX', 'COMP', 'PENDLE',
]);

const SYMBOL_ALIASES = {
  BITCOIN: 'BTC', ETHEREUM: 'ETH', SOLANA: 'SOL', BINANCE: 'BNB',
  RIPPLE: 'XRP', CARDANO: 'ADA', POLKADOT: 'DOT', AVALANCHE: 'AVAX',
  CHAINLINK: 'LINK', POLYGON: 'MATIC', DOGECOIN: 'DOGE',
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

/** Fetch a Spectre API endpoint. Returns { ok, status, data, error, path } — never throws. */
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

/** Detect first known ticker mentioned in a query. Returns symbol string or null. */
function detectAsset(query) {
  if (!query) return null;
  const upper = query.toUpperCase();

  // 1. $TICKER pattern
  const dollarMatch = upper.match(/\$([A-Z]{2,6})\b/);
  if (dollarMatch && KNOWN_TICKERS.has(dollarMatch[1])) return dollarMatch[1];

  // 2. Word-boundary tickers
  const tokens = upper.match(/\b[A-Z]{2,6}\b/g) || [];
  for (const t of tokens) {
    if (KNOWN_TICKERS.has(t)) return t;
  }

  // 3. Full-name aliases
  for (const [name, symbol] of Object.entries(SYMBOL_ALIASES)) {
    if (upper.includes(name)) return symbol;
  }

  return null;
}

/** Truncate JSON blob to keep Groq context manageable. */
function compact(obj, maxChars = 4000) {
  if (obj == null) return 'null';
  let s;
  try { s = JSON.stringify(obj); } catch { return '[unserializable]'; }
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `... [truncated, ${s.length - maxChars} chars omitted]`;
}

/**
 * Trim the X-Dash bootstrap payload to the LLM-relevant fields per token.
 * Raw response is ~90KB; trimmed is ~3KB for top 12 rows.
 */
function trimXDash(payload, topN = 12) {
  const root = payload?.data || payload || {};
  const rows = Array.isArray(root.tokens) ? root.tokens : [];
  if (rows.length === 0) return null;
  return {
    snapshot_at: root.generated_at_utc || null,
    token_count: root.token_count ?? null,
    mention_count: root.mention_count ?? null,
    top: rows.slice(0, topN).map((t) => ({
      rank: t.rank_position ?? null,
      symbol: t.symbol || t.our_symbol || t.token?.symbol || null,
      name: t.name || t.token?.name || null,
      mcap: t.market_cap ?? t.token?.market_cap ?? null,
      price: t.current_price ?? null,
      price_change_24h: t.price_change_24h ?? null,
      mentions_24h: t.external_mentions_24h ?? t.mentions_24h ?? null,
      authors_24h: t.unique_external_authors_24h ?? null,
      engagement_24h: t.external_weighted_engagement_24h ?? null,
      velocity: typeof t.velocity_ratio === 'number' ? Number(t.velocity_ratio.toFixed(2)) : null,
      novelty: typeof t.novelty_ratio === 'number' ? Number(t.novelty_ratio.toFixed(2)) : null,
      clean_signal: typeof t.clean_signal_score_24h === 'number' ? Number(t.clean_signal_score_24h.toFixed(2)) : null,
      category: t.primary_category || null,
      chain: t.platforms ? Object.keys(t.platforms)[0] : null,
    })),
  };
}

/**
 * Synthesis LLM call — routed through the resilient multi-provider gateway
 * (groq→cerebras→gemini→openrouter→openai→anthropic→ollama, circuit-broken)
 * so a single-provider billing outage can no longer blank the surface.
 * Returns { ok, content, error, model } — same shape the callers expect.
 */
async function callGroq(systemPrompt, userMessage, { maxTokens = 1200, temperature = 0.2 } = {}) {
  const r = await gatewayChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    tier: 'smart',
    maxTokens,
    temperature,
    timeoutMs: GROQ_TIMEOUT_MS,
    json: false,
  });
  if (!r.ok) {
    return { ok: false, content: '', error: r.error || 'all LLM providers failed', model: r.provider || null };
  }
  return { ok: true, content: r.text, error: null, model: r.model || GROQ_MODEL, provider: r.provider };
}

// ── MAIN SYSTEM PROMPT ───────────────────────────────────────────────────────
const SHADOW_SYSTEM_PROMPT = `You are Spectre's search engine. Synthesize the provided data into a clear, comprehensive answer. Cite specific numbers and sources. If the data doesn't answer the query, say so.

Available context blocks:
- NEWS: query-filtered news headlines from Spectre's news engine
- SIGNALS: current intelligence signals (regime, anomalies, breakouts)
- TRENDING: top trending tokens by market cap / volume
- XDASH: the canonical X-Dash social momentum board — top tokens ranked by 24h social attention. Each row has mcap, mentions_24h, authors_24h, velocity, novelty, clean_signal. This is the source of truth for "what's popping on social" / "momentum" / "attention" queries.
- XDASH_TOKEN (only when a ticker is detected): per-token X-Dash detail with mentions, top carriers, history
- PRICE / SCORES (only when a ticker is detected): live price + institutional grade for the specific token

Format your answer as a short intelligence brief:
- Lead with the key finding in one sentence.
- For social / momentum / attention questions, pull from XDASH and cite specific symbols + mention counts + velocity.
- Follow with specific numbers (price, change, volume, mentions, etc.) pulled from the data.
- Quote article titles or signal labels when relevant.
- If the data is incomplete or empty, explicitly say which endpoints returned nothing and why the answer is limited.
- Keep it under 250 words. No markdown headers. No hedging filler.`;

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/search/whisper
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/whisper', async (req, res) => {
  const start = Date.now();
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const query = typeof body.query === 'string' ? body.query.trim() : '';

    if (query.length < 3) {
      return res.status(400).json({ error: 'Query must be at least 3 characters' });
    }

    const asset = detectAsset(query);

    // ── 1. FETCH SPECTRE DATA IN PARALLEL ────────────────────────────────────
    // X-Dash bootstrap is always included so Whisper has the canonical
    // social-momentum board (same source as /x-dash and the Telegram bot).
    // Trimmed to top 12 rows + key fields before the LLM sees it.
    const fetches = [
      { label: 'news', req: spectreFetch(`/v1/news?q=${encodeURIComponent(query)}`) },
      { label: 'signals', req: spectreFetch('/v1/intelligence/signals') },
      { label: 'trending', req: spectreFetch('/v1/trending') },
      { label: 'xdash', req: spectreFetch('/v1/social/xdash/bootstrap?per_page=15&timeframe=24h') },
    ];
    if (asset) {
      fetches.push({ label: 'price', req: spectreFetch(`/v1/prices/${encodeURIComponent(asset)}`) });
      fetches.push({ label: 'scores', req: spectreFetch(`/v1/institutional/scores/${encodeURIComponent(asset)}`) });
      // Per-token X-Dash detail when a specific ticker is in the query —
      // gives the LLM mentions / top carriers / engagement for THAT asset.
      const cgGuess = asset.toLowerCase();
      fetches.push({ label: 'xdash_token', req: spectreFetch(`/v1/social/xdash/token/${encodeURIComponent(cgGuess)}?timeframe=24h&per_page=10`) });
    }

    const settled = await Promise.all(fetches.map(async f => ({ label: f.label, result: await f.req })));

    // Collect what worked + track what didn't
    const context = {};
    const sources = [];
    const failures = [];
    for (const { label, result } of settled) {
      if (result.ok) {
        // X-Dash bootstrap is huge (~90KB) — trim before adding to LLM context.
        context[label] = label === 'xdash' ? trimXDash(result.data) : result.data;
        sources.push({ label, path: result.path });
      } else {
        failures.push({ label, path: result.path, status: result.status, error: result.error });
      }
    }

    // ── 2. BUILD CONTEXT BLOCK ───────────────────────────────────────────────
    const contextBlock = [
      `QUERY: ${query}`,
      asset ? `DETECTED_ASSET: ${asset}` : `DETECTED_ASSET: (none)`,
      '',
      'SPECTRE DATA (fetched in parallel):',
      ...Object.entries(context).map(([k, v]) => `[${k.toUpperCase()}] ${compact(v, 1500)}`),
    ];
    if (failures.length) {
      contextBlock.push('', 'FAILED ENDPOINTS:');
      failures.forEach(f => contextBlock.push(`- ${f.label} (${f.path}): ${f.status || 'network'} ${f.error}`));
    }

    // ── 3. GROQ SYNTHESIS ─────────────────────────────────────────────────────
    const groqResult = await callGroq(SHADOW_SYSTEM_PROMPT, contextBlock.join('\n'));

    const elapsed = Date.now() - start;

    // ── 4. RETURN IN WHISPER RESPONSE SHAPE ──────────────────────────────────
    // Original whisper returns { interpretation, assetClass, filters, symbols, results }.
    // Shadow returns the same keys so the frontend or test harness can swap with zero change,
    // plus a `shadow` block with raw data and diagnostics.
    if (!groqResult.ok) {
      return res.json({
        interpretation: `Shadow error: ${groqResult.error}`,
        assetClass: asset ? 'crypto' : 'crypto',
        filters: {},
        symbols: asset ? [asset] : [],
        results: [],
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

    res.json({
      interpretation: groqResult.content,
      assetClass: asset ? 'crypto' : 'crypto',
      filters: {},
      symbols: asset ? [asset] : [],
      results: [],
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
    console.error('[search-shadow] Unhandled error:', err.message);
    res.status(500).json({ error: 'Shadow search failed: ' + err.message });
  }
});

module.exports = router;
