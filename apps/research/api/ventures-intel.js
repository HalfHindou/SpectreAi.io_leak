/**
 * Vercel Serverless - Ventures AI Analyst (prod mirror of
 * packages/server/routes/ventures-intel.js).
 *
 * POST /api/ventures/intel  (vercel.json rewrites it to /api/ventures-intel)
 *
 * Takes the fund's live book (holdings x sectors x 2026 focus x 24h momentum)
 * and asks Groq for a short desk-analyst thesis grounded ONLY in the supplied
 * numbers. No key / Groq failure -> empty thesis -> the client falls back to
 * its instant deterministic read. Zero spend on the failure path.
 */

import { callLLM } from './_lib/marketBrief.js';

const GROQ_MODEL = process.env.MARKET_BRIEF_MODEL || 'openai/gpt-oss-120b';

// 6h thesis cache, keyed by vc id + input fingerprint. Survives only while the
// serverless instance is warm; that is enough to absorb re-selection bursts.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const _cache = new Map();

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181', 'https://app.spectreai.io'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const p = req.body || {};
  if (!p.name) return res.status(400).json({ error: 'Missing fund name' });

  const handle = p.handle || null;
  const key = fingerprint(p);

  const cached = getCached(key);
  if (cached) return res.json({ ...cached, handle, _cached: true });

  // tweets is reserved for a future "fund's recent posts" feed (the client
  // fetches but does not yet render it). Return [] so the shape is stable.
  const thesis = await callLLM(SYSTEM_PROMPT, buildUserContent(p), 320);
  const payload = { thesis: thesis || '', tweets: [], model: thesis ? GROQ_MODEL : null };

  if (thesis) setCached(key, payload);
  res.json({ ...payload, handle });
}
