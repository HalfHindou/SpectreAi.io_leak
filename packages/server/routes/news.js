/**
 * News RSS — GET /api/news/rss
 * ═══════════════════════════════════════════════════════════════
 * Groq (llama-3.3-70b-versatile) + Spectre API. Replaced the inline
 * 40-feed RSS aggregator + Anthropic summarizer on 2026-04-11 after
 * the shadow A/B comparison (95ms vs 5358ms, real crypto news vs
 * "Watch: Match of the Day"). See SHADOW_TEST_RESULTS.md.
 *
 * Response shape: { results: [...] } where each item has
 * { id, title, summary, url, source, publishedAt, breaking, ... }.
 * The original inline implementation is preserved as a [SWAPPED]
 * comment block in packages/server/index.js around line 1419.
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
if (!SPECTRE_API_KEY) console.warn('[news] SPECTRE_DATA_BRIDGE_KEY not set - news routes will fail upstream');

const SPECTRE_TIMEOUT_MS = 10000;
const GROQ_TIMEOUT_MS = 15000;

// Max articles we'll ask Groq to summarize per request. Summarizing every
// article on every request would be slow + expensive, so this acts as a cap.
const MAX_SUMMARIZE = 5;

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

async function callGroq(systemPrompt, userMessage, { maxTokens = 300, temperature = 0.2 } = {}) {
  // Resilient multi-provider gateway (groq → cerebras → …). Returns the same
  // { ok, content, error, model } shape; falls back only when every provider
  // fails, so a single-provider outage no longer kills summarization.
  // tier:'fast' — the sole caller is the one-sentence (25-40 word) news
  // summarizer, a trivial task; the cheap 8B model is plenty and cuts cost.
  try {
    const r = await gatewayChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      tier: 'fast',
      maxTokens,
      temperature,
      timeoutMs: GROQ_TIMEOUT_MS,
    });
    if (!r.ok) {
      return { ok: false, content: '', error: r.error || 'llm call failed', model: null };
    }
    return { ok: true, content: r.text || '', error: null, model: r.model || GROQ_MODEL };
  } catch (e) {
    return { ok: false, content: '', error: e.message || String(e), model: GROQ_MODEL };
  }
}

/**
 * Normalize a news article from whatever shape the Spectre API returns into
 * the shape /api/news/rss produces. Defensive — fields may be missing.
 */
function normalizeArticle(raw, idx) {
  if (!raw || typeof raw !== 'object') return null;
  // Upstream Spectre /v1/news + /v1/breaking carry the article thumbnail
  // under a variety of names depending on the original feed (CryptoCompare
  // = imageurl, CryptoPanic = image, others = thumbnail / cover_image /
  // media.url). Previously this function dropped them, which is why every
  // crypto news card in the Command Center fell to the placeholder block.
  const imageUrl = raw.imageUrl
    || raw.image_url
    || raw.imageurl
    || raw.image
    || raw.thumbnail
    || raw.cover_image
    || raw.coverImage
    || raw.media?.url
    || null;
  return {
    id: raw.id || `spectre-${idx}-${Date.now()}`,
    title: raw.title || raw.headline || raw.name || '',
    summary: raw.summary || raw.description || raw.snippet || raw.body || '',
    url: raw.url || raw.link || raw.canonical_url || '',
    source: raw.source || raw.publisher || raw.outlet || 'Spectre',
    sourceIcon: raw.sourceIcon || raw.logo || null,
    imageUrl,
    publishedAt: raw.publishedAt || raw.published_at || raw.date || raw.pubDate || new Date().toISOString(),
    tags: raw.tags || raw.categories || [],
    breaking: raw.breaking === true,
    _raw: undefined, // don't leak upstream shape
  };
}

/** Pull the articles array out of various possible response shapes. */
function extractArticles(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.articles)) return payload.articles;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

/** Decide if an article needs summarization. */
function needsSummary(article) {
  const s = (article.summary || '').trim();
  return s.length < 40 || s.length > 800;
}

// ── SHADOW SYSTEM PROMPT ─────────────────────────────────────────────────────
const SHADOW_SUMMARY_PROMPT = `You are a financial news summarizer. Rewrite the provided article into a single concise sentence (25 to 40 words) capturing the most important trading-relevant fact. No preamble, no headers, no hedging. Respond with the summary text only — nothing else.`;

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/news/rss
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/rss', async (req, res) => {
  const start = Date.now();
  try {
    const symbol = (req.query.symbol || '').toString().toUpperCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    // Default OFF to match the prior /api/news/rss behavior (never summarized).
    // Set ?summarize=true to opt in to Groq rewrites (caps at MAX_SUMMARIZE).
    const summarize = req.query.summarize === 'true';

    // ── 1. FETCH NEWS + BREAKING IN PARALLEL ─────────────────────────────────
    const newsPath = symbol
      ? `/v1/news?symbol=${encodeURIComponent(symbol)}&limit=${limit}`
      : `/v1/news?limit=${limit}`;
    const [newsRes, breakingRes] = await Promise.all([
      spectreFetch(newsPath),
      spectreFetch('/v1/breaking'),
    ]);

    const sources = [];
    const failures = [];

    const newsArticles = newsRes.ok ? extractArticles(newsRes.data) : [];
    if (newsRes.ok) sources.push({ label: 'news', path: newsRes.path, count: newsArticles.length });
    else failures.push({ label: 'news', path: newsRes.path, status: newsRes.status, error: newsRes.error });

    const breakingArticles = breakingRes.ok ? extractArticles(breakingRes.data) : [];
    if (breakingRes.ok) sources.push({ label: 'breaking', path: breakingRes.path, count: breakingArticles.length });
    else failures.push({ label: 'breaking', path: breakingRes.path, status: breakingRes.status, error: breakingRes.error });

    // Tag breaking articles so the frontend can surface them
    const taggedBreaking = breakingArticles.map(a => ({ ...a, breaking: true }));

    // Merge + dedup by URL or title
    const seen = new Set();
    const merged = [];
    for (const raw of [...taggedBreaking, ...newsArticles]) {
      const n = normalizeArticle(raw, merged.length);
      if (!n || !n.title) continue;
      const key = (n.url || n.title).slice(0, 200).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(n);
      if (merged.length >= limit) break;
    }

    // ── 2. SUMMARIZE (GROQ) ──────────────────────────────────────────────────
    const summarizedIndices = [];
    const summaryErrors = [];
    // Key-agnostic: the gateway routes to any live provider (a free Cerebras/
    // Gemini key works even without GROQ_API_KEY), so gate only on the opt-in.
    if (summarize && merged.length > 0) {
      const candidates = [];
      for (let i = 0; i < merged.length && candidates.length < MAX_SUMMARIZE; i++) {
        if (needsSummary(merged[i])) candidates.push(i);
      }

      await Promise.all(candidates.map(async idx => {
        const a = merged[idx];
        const userMsg = `TITLE: ${a.title}\nSOURCE: ${a.source}\nRAW: ${(a.summary || '').slice(0, 1200)}`;
        const result = await callGroq(SHADOW_SUMMARY_PROMPT, userMsg, { maxTokens: 120 });
        if (result.ok && result.content) {
          merged[idx] = { ...a, summary: result.content.trim(), summarizedBy: 'groq' };
          summarizedIndices.push(idx);
        } else if (!result.ok) {
          summaryErrors.push({ idx, error: result.error });
        }
      }));
    }

    const elapsed = Date.now() - start;
    const response = {
      results: merged,
      shadow: {
        ok: merged.length > 0 || failures.length === 0,
        elapsedMs: elapsed,
        sources,
        failures,
        summarized: summarizedIndices.length,
        summarizedIndices,
        summaryErrors,
        model: GROQ_MODEL,
        summarize,
      },
    };

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240');
    res.json(response);
  } catch (err) {
    console.error('[news-shadow] Unhandled error:', err.message);
    res.status(500).json({ error: 'Shadow news failed: ' + err.message });
  }
});

module.exports = router;
