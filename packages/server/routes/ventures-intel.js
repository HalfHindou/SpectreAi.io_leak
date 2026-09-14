/**
 * Express router - Ventures AI Analyst (dev mode)
 *
 * Powers the "AI Analyst" box in VC Bubbles / Smart Money Universe. Takes the
 * fund's live book (holdings x sectors x 2026 focus x 24h momentum, computed
 * client-side) and asks Groq for a short desk-analyst thesis explaining what
 * the fund is actually doing. Grounded ONLY in the supplied numbers, so it
 * cannot hallucinate positions or news.
 *
 * No key / Groq failure -> empty thesis -> the client falls back to its instant
 * deterministic read (smu-vc-analyst). Zero spend on the failure path.
 *
 * Mirrors the Vercel serverless function apps/research/api/ventures-intel.js
 * so the client hits the same POST /api/ventures/intel URL in dev and prod.
 *
 * Mounted at: app.use('/api/ventures/intel', require('./routes/ventures-intel'))
 */

const express = require('express');
const router = express.Router();
const { chat: gatewayChat } = require('../lib/llm-gateway');

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
const GROQ_MODEL = process.env.MARKET_BRIEF_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 20000;

// 6h thesis cache, keyed by vc id + a fingerprint of the inputs so a changed
// book refreshes. Bounded to 200 funds; node restart wipes it.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const _cache = new Map(); // key -> { ts, data }

function setCached(key, data) {
  _cache.set(key, { ts: Date.now(), data });
  if (_cache.size > 200) _cache.delete(_cache.keys().next().value);
}
function getCached(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return e.data;
}

const SYSTEM_PROMPT = [
  'You are a sharp crypto-VC desk analyst. In 2-3 tight sentences, explain what',
  'this fund is actually doing right now: its sector tilt, highest-conviction',
  'positions, and the 2026 narratives it is pushing. Read like a buy-side note,',
  'not marketing. No hype, no emojis, no headers, no bullet points.',
  'STRICT: use ONLY the holdings, sectors, focus areas and any 24h book move',
  'given. NEVER invent a token, a price, a dollar figure, a fund size, or a',
  'news event that is not in the data. If a data point is absent, omit it',
  'silently - never write that something is unavailable, not provided or missing.',
  'Refer to tokens with a $ prefix (e.g. $SOL). 70 words max.',
].join(' ');

function fingerprint(p) {
  const toks = Array.isArray(p.tokens) ? p.tokens.slice(0, 12).join(',') : '';
  const sec = Array.isArray(p.sectors) ? p.sectors.join(',') : '';
  const foc = Array.isArray(p.focus) ? p.focus.join(',') : '';
  // momentum bucketed to ~1% so tiny price drift doesn't bust the cache.
  const mo = Number.isFinite(p.momentum) ? Math.round(p.momentum) : 'na';
  return `${p.vc || p.name}|${toks}|${sec}|${foc}|${mo}`;
}

function buildUserContent(p) {
  const lines = [];
  lines.push(`Fund: ${p.name}${p.type ? ` (${p.type})` : ''}`);
  if (p.aum) lines.push(`AUM (stated): ${p.aum}`);
  if (Array.isArray(p.sectors) && p.sectors.length) lines.push(`Sector tilt: ${p.sectors.join(', ')}`);
  if (Array.isArray(p.tokens) && p.tokens.length) lines.push(`Tracked token holdings: ${p.tokens.map((t) => `$${String(t).toUpperCase()}`).join(', ')}`);
  if (Array.isArray(p.companies) && p.companies.length) lines.push(`Portfolio companies: ${p.companies.join(', ')}`);
  if (Array.isArray(p.focus) && p.focus.length) lines.push(`Stated 2026 focus: ${p.focus.join(', ')}`);
  if (Number.isFinite(p.momentum)) lines.push(`Tracked book 24h move: ${p.momentum >= 0 ? '+' : ''}${p.momentum.toFixed(2)}%`);
  return lines.join('\n');
}

async function callGroq(systemPrompt, userContent, maxTokens = 320) {
  // Resilient multi-provider gateway (groq → cerebras → …). No key / all
  // providers down → null → the client falls back to its instant deterministic
  // read. Zero spend on the failure path (unchanged contract).
  try {
    const r = await gatewayChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      tier: 'smart',
      maxTokens,
      temperature: 0.4,
      timeoutMs: GROQ_TIMEOUT_MS,
    });
    if (!r.ok) {
      console.warn('[ventures-intel] gateway call failed:', r.error);
      return null;
    }
    const text = (r.text || '').trim();
    if (!text || text.length < 40) return null;
    return text;
  } catch (e) {
    console.warn('[ventures-intel] gateway call failed:', e.message);
    return null;
  }
}

router.post('/', express.json({ limit: '32kb' }), async (req, res) => {
  const p = req.body || {};
  if (!p.name) return res.status(400).json({ error: 'Missing fund name' });

  const handle = p.handle || null;
  const key = fingerprint(p);

  const cached = getCached(key);
  if (cached) return res.json({ ...cached, handle, _cached: true });

  // tweets is reserved for a future "fund's recent posts" feed (the client
  // fetches but does not yet render it). Return [] so the shape is stable.
  const thesis = await callGroq(SYSTEM_PROMPT, buildUserContent(p));
  const payload = { thesis: thesis || '', tweets: [], model: thesis ? GROQ_MODEL : null };

  if (thesis) setCached(key, payload);
  res.json({ ...payload, handle });
});

module.exports = router;
