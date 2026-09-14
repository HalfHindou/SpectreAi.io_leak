'use strict';
/**
 * Research Desk — AI Alpha-Thesis Agent (Phase 2, cost-bounded).
 * ═══════════════════════════════════════════════════════════════════════════════
 * Generates Goldman-style investment-thesis cards for the trading app's Research
 * Desk (Discover page → AlphaThesisCards.jsx). Each thesis is a single JSON object
 * matching the THESES schema in apps/trading/src/components/AlphaThesisCards.jsx.
 *
 * COST DISCIPLINE (non-negotiable):
 *   - One gatedPerplexitySearch call per project (Groq Llama-3.3-70b PRIMARY/cheap;
 *     Perplexity/Anthropic only as emergency fallback inside the gate).
 *   - Per-call estimate: ~900 input + ~1200 output tokens on Groq llama-3.3-70b
 *     (~$0.0008/call at Groq's published rate; ≈ $0.01 for a full top-12 batch).
 *   - 7-DAY freshness stamp: a project is regenerated at most once per week.
 *   - ZERO billable Codex selects — the prompt is seeded only with the project's
 *     ALREADY-fetched live data (DefiLlama + DexScreener from the Phase-1 pipeline).
 *
 * GROUND-TRUTH MERGE: known on-chain numbers (mcap/tvl/volume/price/change) from
 * the project ALWAYS override any figure the model states. The model writes the
 * qualitative thesis (bull/bear/catalysts/comparable/note); the numbers are ours.
 *
 * PERSISTENCE: content store (store.js) under type 'research', slug
 * `research-desk-thesis-<symbol>`. The pure reader lives in researchDeskContent.js
 * (used by the route for tier=content) — this file only WRITES.
 *
 * This agent runs SERVER-SIDE ONLY (Express + warmer). Prod serverless reads the
 * persisted JSON via researchDeskContent.js; it never generates. If no AI key is
 * configured, generation no-ops cleanly (returns null) and the frontend falls
 * back to the Phase-1 data-derived `thesis` string.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { gatedPerplexitySearch } = require('./perplexityGate');
const store = require('../content/store');

const AGENT_ID = 'research-desk-thesis';
const CONTENT_TYPE = 'research';
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── helpers ──────────────────────────────────────────────────────────────────

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }

// DefiLlama/DexScreener change values are Codex dual-format (|v|<100 -> ratio,
// else percent). Normalize to a real percent for prompt seeding + the change24h
// numeric field (the component shows `{change24h}%`).
function toPct(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) < 100 ? n * 100 : n;
}

function fmtCompactUsd(n) {
  const v = num(n);
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPrice(n) {
  const v = num(n);
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs >= 0.01) return `$${v.toFixed(4)}`;
  if (abs >= 0.0001) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')}`;
}

/**
 * Robustly pull a single JSON object out of an LLM response: strip markdown
 * fences, then fall back to the first balanced {...} span. Returns null on failure.
 */
function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  // Strip ```json ... ``` (or bare ```) fences.
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  }
  try { return JSON.parse(s); } catch (_) { /* fall through to brace scan */ }
  // Brace-scan: find the first balanced object span (string-aware).
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const span = s.slice(start, i + 1);
        try { return JSON.parse(span); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function asStringArray(v, cap = 3) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, cap);
}

// ── seed ─────────────────────────────────────────────────────────────────────

/**
 * Pull the KNOWN, ground-truth numbers off a Phase-1 project row. These both
 * seed the prompt and override anything the model invents.
 */
function knownNumbers(project) {
  const change24h = toPct(project.change24h);
  const change7d = project.tvlChange7d != null ? num(project.tvlChange7d) : null;
  return {
    symbol: String(project.symbol || '').replace(/^\$/, '').toUpperCase(),
    name: project.name || project.symbol || 'Unknown',
    sector: project.sector || 'DeFi',
    chain: project.chain || null,
    category: project.category || null,
    mcap: num(project.mcap),
    fdv: num(project.fdv),
    tvl: num(project.tvl),
    volume24h: num(project.volume24h),
    liquidity: num(project.liquidity),
    price: num(project.priceUsd),
    change24h,
    change7d,
    revenue24h: project.revenue24h != null ? num(project.revenue24h) : null,
    audits: num(project.audits) || 0,
    ageDays: project.ageDays != null ? num(project.ageDays) : null,
    riskGrade: project.riskGrade || null,
  };
}

function buildSeedBlock(k) {
  const lines = [
    `Project: ${k.name} ($${k.symbol})`,
    k.sector ? `Sector: ${k.sector}` : null,
    k.category ? `DefiLlama category: ${k.category}` : null,
    k.chain ? `Chain: ${k.chain}` : null,
    k.price != null ? `Price: ${fmtPrice(k.price)}` : null,
    k.change24h != null ? `24h change: ${k.change24h >= 0 ? '+' : ''}${k.change24h.toFixed(2)}%` : null,
    k.change7d != null ? `TVL 7d change: ${k.change7d >= 0 ? '+' : ''}${k.change7d.toFixed(1)}%` : null,
    k.mcap != null ? `Market cap: ${fmtCompactUsd(k.mcap)}` : null,
    k.fdv != null ? `FDV: ${fmtCompactUsd(k.fdv)}` : null,
    k.tvl != null ? `TVL: ${fmtCompactUsd(k.tvl)}` : null,
    k.volume24h != null ? `24h volume: ${fmtCompactUsd(k.volume24h)}` : null,
    k.liquidity != null ? `Liquidity: ${fmtCompactUsd(k.liquidity)}` : null,
    k.revenue24h != null ? `Daily revenue (DefiLlama): ${fmtCompactUsd(k.revenue24h)}` : null,
    `Audits: ${k.audits}`,
    k.ageDays != null ? `Token age: ${k.ageDays} days` : null,
    k.riskGrade ? `Pipeline risk grade: ${k.riskGrade}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

const THESIS_SYSTEM_PROMPT = `You are a senior crypto investment analyst at an institutional digital-asset fund, writing a concise, sober alpha thesis on an emerging on-chain DeFi protocol.

Return ONLY a single JSON object, no prose, no markdown fences. The object MUST have EXACTLY these keys:
{
  "comparable": "string - one sharp analogy, e.g. 'The Stripe of on-chain credit'. Max 70 chars.",
  "conviction": "High" | "Medium" | "Low",
  "riskScore": integer 1-8 (1 = safest blue-chip, 8 = highly speculative micro-cap),
  "timeHorizon": "string - e.g. '6-12 months'",
  "priceTarget": "string - a plausible range derived from the data, e.g. '$2.40-3.80'. Use 'data not available' if you cannot justify one.",
  "analystNote": "string - 2-3 sentence institutional analyst note. Specific, no hype, no hedging filler.",
  "bullCase": ["3 short bullet strings - concrete upside drivers"],
  "bearCase": ["3 short bullet strings - concrete, honest risks"],
  "catalysts": [{"event":"string","timing":"string e.g. 'Q1 2026' or 'Ongoing'","impact":"high"|"medium"|"low"}],  // 2-3 items
  "peerComps": [{"symbol":"string","mcap":"string e.g. '$1.2B'","metric":"string e.g. 'TVL $620M'"}]  // 2-3 peers in the same sector
}

RULES:
- Base every claim on the LIVE DATA provided. Do NOT invent price, market cap, TVL, volume, or revenue numbers — those are supplied separately and will overwrite anything you write.
- riskScore: emerging micro-caps with low TVL/liquidity and short age skew 5-8; established protocols with deep TVL + audits skew 1-4.
- conviction reflects YOUR confidence in the thesis, independent of riskScore.
- Keep bull/bear bullets under ~60 chars each. No emojis. No citation markers.
- If the project is too thin to assess, still return valid JSON — keep it terse and honest (e.g. priceTarget "data not available", conviction "Low"). Do not refuse.`;

// ── core: build the component-shaped thesis object ───────────────────────────

/**
 * Merge the AI qualitative thesis with the KNOWN on-chain numbers, producing an
 * object that matches the AlphaThesisCards THESES schema exactly. Known numbers
 * ALWAYS win over any figure the model stated.
 */
function buildThesisObject(ai, k, meta) {
  const conviction = ['High', 'Medium', 'Low'].includes(ai.conviction) ? ai.conviction : 'Medium';
  let riskScore = parseInt(ai.riskScore, 10);
  if (!Number.isFinite(riskScore)) riskScore = 5;
  riskScore = Math.max(1, Math.min(8, riskScore));

  // Catalysts: clamp impact to the 3 allowed values, cap 3.
  const catalysts = Array.isArray(ai.catalysts)
    ? ai.catalysts.slice(0, 3).map((c) => ({
        event: typeof c.event === 'string' ? c.event.trim() : '',
        timing: typeof c.timing === 'string' && c.timing.trim() ? c.timing.trim() : 'TBD',
        impact: ['high', 'medium', 'low'].includes(c.impact) ? c.impact : 'medium',
      })).filter((c) => c.event)
    : [];

  // Peer comps: cap 3, only well-formed entries.
  const peerComps = Array.isArray(ai.peerComps)
    ? ai.peerComps.slice(0, 3).map((p) => ({
        symbol: typeof p.symbol === 'string' ? p.symbol.replace(/^\$/, '').toUpperCase().slice(0, 10) : '',
        mcap: typeof p.mcap === 'string' ? p.mcap.trim() : '',
        metric: typeof p.metric === 'string' ? p.metric.trim() : '',
      })).filter((p) => p.symbol)
    : [];

  // Socials: built from the project's known links (never from the model).
  const socials = {};
  if (meta.website) socials.website = meta.website;
  if (meta.x) socials.x = meta.x;

  return {
    id: `t-${k.symbol.toLowerCase()}`,
    symbol: k.symbol,
    name: k.name,
    sector: k.sector,
    comparable: (typeof ai.comparable === 'string' && ai.comparable.trim()) ? ai.comparable.trim().slice(0, 90) : `${k.sector} protocol on ${k.chain || 'chain'}`,
    riskScore,
    timeHorizon: (typeof ai.timeHorizon === 'string' && ai.timeHorizon.trim()) ? ai.timeHorizon.trim() : '6-12 months',
    priceTarget: (typeof ai.priceTarget === 'string' && ai.priceTarget.trim()) ? ai.priceTarget.trim() : 'data not available',
    conviction,
    // ── KNOWN numbers (ground-truth, formatted) — override any AI figure ──
    mcap: fmtCompactUsd(k.mcap) || 'N/A',
    fdv: fmtCompactUsd(k.fdv) || undefined,
    volume24h: fmtCompactUsd(k.volume24h) || undefined,
    tvl: fmtCompactUsd(k.tvl) || undefined,
    chain: k.chain || undefined,
    currentPrice: fmtPrice(k.price) || 'N/A',
    change24h: k.change24h != null ? Math.round(k.change24h * 10) / 10 : null,
    analystNote: (typeof ai.analystNote === 'string' && ai.analystNote.trim()) ? ai.analystNote.trim() : '',
    peerComps,
    bullCase: asStringArray(ai.bullCase, 3),
    bearCase: asStringArray(ai.bearCase, 3),
    catalysts,
    socials,
  };
}

// ── public: generateAlphaThesis(project) ─────────────────────────────────────

/**
 * Generate (or refresh) an alpha thesis for one project.
 * @param {object} project - a Phase-1 Research Desk project row
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - bypass the 7-day freshness check
 * @returns {Promise<object|null>} the persisted thesis object, or null on no-op/failure
 */
async function generateAlphaThesis(project, opts = {}) {
  const { force = false } = opts;
  if (!project || !project.symbol) return null;

  const k = knownNumbers(project);
  if (!k.symbol) return null;
  const slug = `research-desk-thesis-${k.symbol.toLowerCase()}`;

  // Freshness gate: skip if a recent thesis already exists.
  if (!force) {
    const existing = store.loadArticle(CONTENT_TYPE, slug);
    if (existing && existing.updatedAt && (Date.now() - new Date(existing.updatedAt).getTime()) < FRESH_MS) {
      return existing.thesis || null;
    }
  }

  const meta = {
    website: project.socials?.website || project.url || null,
    x: project.socials?.x || (project.twitter ? `https://x.com/${String(project.twitter).replace(/^@/, '')}` : null),
  };

  const userPrompt = `${buildSeedBlock(k)}\n\nWrite the alpha-thesis JSON object for ${k.name} ($${k.symbol}).`;

  let result;
  try {
    result = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: THESIS_SYSTEM_PROMPT,
      maxTokens: 1400,
      model: 'sonar', // legacy param; the gate pins Groq llama-3.3-70b as primary
      agentId: AGENT_ID,
      timeout: 45000,
      skipResolution: true, // known project — no entity disambiguation needed
    });
  } catch (err) {
    console.error(`[${AGENT_ID}] ${k.symbol} gate error:`, err.message);
    return null;
  }

  // No AI key / all providers failed -> clean no-op (frontend falls back to data string).
  if (!result || result.type !== 'SUCCESS' || !result.content) {
    console.log(`[${AGENT_ID}] ${k.symbol} no content (type=${result?.type || 'null'})`);
    return null;
  }

  const ai = extractJsonObject(result.content);
  if (!ai || typeof ai !== 'object') {
    console.error(`[${AGENT_ID}] ${k.symbol} JSON extract failed`);
    return null;
  }

  const thesis = buildThesisObject(ai, k, meta);

  // Persist. The store wraps it as an "article"; `thesis` carries the payload.
  try {
    store.saveArticle({
      type: CONTENT_TYPE,
      slug,
      title: `Alpha Thesis — ${k.name} (${k.symbol})`,
      summary: thesis.comparable,
      symbol: k.symbol,
      kind: 'research-desk-thesis',
      thesis,
      model: result.model || null,
      tags: ['research-desk', 'alpha-thesis', k.symbol, k.sector].filter(Boolean),
    });
  } catch (err) {
    console.error(`[${AGENT_ID}] ${k.symbol} save failed:`, err.message);
    // The object is still valid even if persistence failed.
  }

  return thesis;
}

module.exports = {
  generateAlphaThesis,
  // exported for the batch entry + reader + tests
  extractJsonObject,
  knownNumbers,
  AGENT_ID,
  CONTENT_TYPE,
  FRESH_MS,
};
