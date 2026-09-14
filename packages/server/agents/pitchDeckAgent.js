'use strict';
/**
 * Research Desk — AI Pitch-Deck Agent (Phase 2, cost-bounded).
 * ═══════════════════════════════════════════════════════════════════════════════
 * Generates a VC-style 7-slide pitch deck for the trading app's Research Desk
 * (Discover page → TokenPitchDeck.jsx). Each deck is a single JSON object matching
 * the PITCHES schema in apps/trading/src/components/TokenPitchDeck.jsx, with the
 * 7 slides: tagline/comparable, problem, solution, traction{aum,users,revenue,gmv},
 * tokenomics, team{founders,org,headcount,backers,audits}, moat{description,
 * factors[{name,score}]}, valuation.
 *
 * COST DISCIPLINE (non-negotiable):
 *   - One gatedPerplexitySearch call per project (Groq Llama-3.3-70b PRIMARY/cheap).
 *   - Per-call estimate: ~950 input + ~1600 output tokens on Groq llama-3.3-70b
 *     (~$0.0011/call; ≈ $0.013 for a full top-12 batch). Combined with the thesis
 *     agent, a full top-12 content refresh is ≈ $0.02-0.03.
 *   - 7-DAY freshness stamp: regenerated at most once per week.
 *   - ZERO billable Codex selects — seeded only with Phase-1 live data.
 *
 * GROUND-TRUTH MERGE: known on-chain numbers (mcap → traction.aum, fdv →
 * valuation.fdv, tvl, volume) ALWAYS override the model. The model writes the
 * qualitative deck (problem/solution/team/moat/verdict); the headline numbers
 * are ours. Note: the frontend (useResearchDeskPrices) further overlays LIVE
 * CoinGecko mcap/fdv at render time, so the persisted numbers are a sane seed.
 *
 * PERSISTENCE: content store under type 'research', slug
 * `research-desk-pitch-<symbol>`. The pure reader lives in researchDeskContent.js.
 *
 * SERVER-SIDE ONLY (Express + warmer). Prod serverless reads the persisted JSON;
 * it never generates. No AI key configured -> clean no-op (frontend falls back to
 * its data-derived deck strings).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { gatedPerplexitySearch } = require('./perplexityGate');
const store = require('../content/store');

const AGENT_ID = 'research-desk-pitch';
const CONTENT_TYPE = 'research';
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── helpers ──────────────────────────────────────────────────────────────────

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }

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

function fmtPct(n) {
  const v = num(n);
  if (v == null) return null;
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(0)}%`;
}

/** Robust single-JSON-object extraction (string-aware brace scan). Mirrors alphaThesisAgent. */
function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  }
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
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
        try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function asStr(v, fallback = '') {
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
}

function asStringArray(v, cap = 4) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, cap);
}

// ── seed (shared shape with the thesis agent) ────────────────────────────────

function knownNumbers(project) {
  const change24h = toPct(project.change24h);
  const change7d = project.tvlChange7d != null ? num(project.tvlChange7d) : null;
  return {
    symbol: String(project.symbol || '').replace(/^\$/, '').toUpperCase(),
    name: project.name || project.symbol || 'Unknown',
    sector: project.sector || 'DeFi',
    chain: project.chain || null,
    category: project.category || null,
    address: project.address || null,
    mcap: num(project.mcap),
    fdv: num(project.fdv),
    tvl: num(project.tvl),
    volume24h: num(project.volume24h),
    liquidity: num(project.liquidity),
    revenue24h: project.revenue24h != null ? num(project.revenue24h) : null,
    change24h,
    change7d,
    audits: num(project.audits) || 0,
    auditLinks: Array.isArray(project.auditLinks) ? project.auditLinks : [],
    ageDays: project.ageDays != null ? num(project.ageDays) : null,
    dealFlowStage: project.dealFlowStage || null,
  };
}

function buildSeedBlock(k) {
  const lines = [
    `Project: ${k.name} ($${k.symbol})`,
    k.sector ? `Sector: ${k.sector}` : null,
    k.category ? `DefiLlama category: ${k.category}` : null,
    k.chain ? `Chain: ${k.chain}` : null,
    k.mcap != null ? `Market cap: ${fmtCompactUsd(k.mcap)}` : null,
    k.fdv != null ? `FDV: ${fmtCompactUsd(k.fdv)}` : null,
    k.tvl != null ? `TVL: ${fmtCompactUsd(k.tvl)}` : null,
    k.volume24h != null ? `24h volume: ${fmtCompactUsd(k.volume24h)}` : null,
    k.liquidity != null ? `Liquidity: ${fmtCompactUsd(k.liquidity)}` : null,
    k.revenue24h != null ? `Daily revenue (DefiLlama): ${fmtCompactUsd(k.revenue24h)} (~${fmtCompactUsd(k.revenue24h * 365)} annualized)` : null,
    k.change24h != null ? `24h change: ${k.change24h >= 0 ? '+' : ''}${k.change24h.toFixed(2)}%` : null,
    k.change7d != null ? `TVL 7d change: ${k.change7d >= 0 ? '+' : ''}${k.change7d.toFixed(1)}%` : null,
    `Audits on record: ${k.audits}${k.auditLinks.length ? ` (${k.auditLinks.length} audit links)` : ''}`,
    k.ageDays != null ? `Token age: ${k.ageDays} days` : null,
    k.dealFlowStage ? `Deal-flow stage: ${k.dealFlowStage}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

const PITCH_SYSTEM_PROMPT = `You are a VC partner at a top-tier crypto fund writing a one-page investment memo on an emerging on-chain DeFi protocol, framed like a startup pitch deck.

Return ONLY a single JSON object, no prose, no markdown fences. The object MUST have EXACTLY these keys:
{
  "tagline": "string - a crisp positioning line, e.g. 'The Stripe of on-chain credit'. Max 50 chars.",
  "comparable": "string - one sentence: 'What X did for Y, <project> does for Z'. Max 120 chars.",
  "stage": "Early Growth" | "Growth" | "Mature" | "Seed",
  "problem": "string - 2-3 sentences on the real market problem this protocol attacks.",
  "solution": "string - 2-3 sentences on how the protocol solves it.",
  "traction": {
    "users": { "value": "string e.g. '8.2K'", "label": "string e.g. 'Token Holders'", "change": "string e.g. '+184%'", "period": "string e.g. '30d'" },
    "revenue": { "value": "string", "label": "string e.g. 'Annual Protocol Revenue'", "change": "string", "period": "string" }
  },
  "tokenomics": {
    "supply": "string e.g. '590M / 700M' OR 'data not available'",
    "supplyPct": integer 0-100 (best estimate of % circulating; 100 if fully diluted/unknown),
    "inflation": "string e.g. '0% (fixed)' or 'data not available'",
    "staked": "string e.g. '34%' or 'N/A'",
    "topHolders": "string e.g. '22%' or 'data not available'",
    "vestingNote": "string - 1-2 sentences on supply/vesting/unlock risk."
  },
  "team": {
    "founders": "string - named founders if known, else 'Anon / not disclosed'",
    "org": "string - the entity/labs/DAO behind it",
    "headcount": "string e.g. '~12 contributors' or 'data not available'",
    "backers": ["2-4 short investor/backer strings, or [] if unknown"],
    "audits": ["1-3 short auditor/audit strings - use the audit count provided"],
    "auditStatus": "string e.g. 'Audited' / 'In progress' / 'Unaudited'"
  },
  "moat": {
    "description": "string - 1-2 sentences on the durable competitive advantage.",
    "factors": [{"name":"string e.g. 'Liquidity Depth'","score":integer 0-100}]  // EXACTLY 4 factors
  },
  "valuation": {
    "mcapRevenue": "string e.g. '81x' or 'Pre-revenue' or 'N/A'",
    "mcapTvl": "string e.g. '0.33x' or 'N/A'",
    "peerAvg": "string e.g. '120x P/Rev' or comparable",
    "verdict": "string - 2-3 sentence valuation verdict; is it cheap/expensive vs peers and why."
  }
}

RULES:
- Base every claim on the LIVE DATA provided. Do NOT invent market cap, TVL, FDV, volume, or revenue numbers — headline numbers are supplied separately and will overwrite yours.
- For traction.users/revenue, give your best estimate of value+label+change+period; the period and change can be qualitative if not in the data.
- moat.factors MUST be exactly 4, each scored 0-100, honest (emerging micro-caps usually 55-80, not 90+).
- If a field is unknown, write 'data not available' / 'N/A' / [] rather than fabricating. Emerging micro-caps will have thin team/tokenomics data — that is fine, keep it honest.
- No emojis. No citation markers. Return valid JSON even for thin projects (do not refuse).`;

// ── core: build the component-shaped pitch object ────────────────────────────

function clampScore(v) {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) n = 60;
  return Math.max(0, Math.min(100, n));
}

function buildKpi(aiKpi, fallbackLabel) {
  const o = (aiKpi && typeof aiKpi === 'object') ? aiKpi : {};
  return {
    value: asStr(o.value, 'N/A'),
    label: asStr(o.label, fallbackLabel),
    change: asStr(o.change, ''),
    period: asStr(o.period, ''),
  };
}

/**
 * Merge AI qualitative deck with KNOWN on-chain numbers -> PITCHES schema object.
 * Known numbers win: traction.aum = mcap, traction.gmv = 24h volume,
 * valuation.fdv = fdv (or mcap). The model fills users/revenue/team/moat/etc.
 */
function buildPitchObject(ai, k) {
  const aiTraction = (ai.traction && typeof ai.traction === 'object') ? ai.traction : {};
  const aiTok = (ai.tokenomics && typeof ai.tokenomics === 'object') ? ai.tokenomics : {};
  const aiTeam = (ai.team && typeof ai.team === 'object') ? ai.team : {};
  const aiMoat = (ai.moat && typeof ai.moat === 'object') ? ai.moat : {};
  const aiVal = (ai.valuation && typeof ai.valuation === 'object') ? ai.valuation : {};

  // ── Traction: aum + gmv are KNOWN numbers; users + revenue are AI ──
  const traction = {
    aum: {
      value: fmtCompactUsd(k.mcap) || (fmtCompactUsd(k.tvl) || 'N/A'),
      label: k.mcap != null ? 'Market Cap' : 'Total Value Locked',
      change: k.change7d != null ? fmtPct(k.change7d) : '',
      period: k.change7d != null ? '7d' : '',
    },
    users: buildKpi(aiTraction.users, 'Token Holders'),
    revenue: k.revenue24h != null
      ? {
          value: fmtCompactUsd(k.revenue24h * 365),
          label: 'Annual Revenue (est.)',
          change: '',
          period: 'annualized',
        }
      : buildKpi(aiTraction.revenue, 'Protocol Revenue'),
    gmv: {
      value: fmtCompactUsd(k.volume24h) || 'N/A',
      label: 'Daily Volume (GMV)',
      change: k.change24h != null ? fmtPct(k.change24h) : '',
      period: k.change24h != null ? '24h' : '',
    },
  };

  // ── Tokenomics: supplyPct clamped; audits seeded from the real count ──
  let supplyPct = parseInt(aiTok.supplyPct, 10);
  if (!Number.isFinite(supplyPct)) supplyPct = 100;
  supplyPct = Math.max(0, Math.min(100, supplyPct));
  const tokenomics = {
    supply: asStr(aiTok.supply, 'data not available'),
    supplyPct,
    inflation: asStr(aiTok.inflation, 'data not available'),
    staked: asStr(aiTok.staked, 'N/A'),
    topHolders: asStr(aiTok.topHolders, 'data not available'),
    vestingNote: asStr(aiTok.vestingNote, 'Supply and vesting schedule not fully disclosed.'),
  };

  // ── Team: backers/audits as arrays; audit count anchors auditStatus ──
  let audits = asStringArray(aiTeam.audits, 3);
  if (audits.length === 0 && k.audits > 0) audits = [`${k.audits} audit${k.audits > 1 ? 's' : ''} on record`];
  if (audits.length === 0) audits = ['No audits on record'];
  const auditStatus = asStr(aiTeam.auditStatus, k.audits > 0 ? 'Audited' : 'Unaudited');
  const team = {
    founders: asStr(aiTeam.founders, 'Not disclosed'),
    org: asStr(aiTeam.org, k.name),
    headcount: asStr(aiTeam.headcount, 'data not available'),
    backers: asStringArray(aiTeam.backers, 4),
    audits,
    auditStatus,
  };

  // ── Moat: exactly 4 factors, scores clamped ──
  let factors = Array.isArray(aiMoat.factors)
    ? aiMoat.factors.slice(0, 4).map((f) => ({ name: asStr(f && f.name, 'Factor'), score: clampScore(f && f.score) }))
    : [];
  // Pad to 4 with sensible defaults if the model under-delivered.
  const FALLBACK_FACTORS = [
    { name: 'Liquidity Depth', score: 60 },
    { name: 'Product-Market Fit', score: 60 },
    { name: 'Security Record', score: 60 },
    { name: 'Momentum', score: 60 },
  ];
  for (let i = factors.length; i < 4; i++) factors.push(FALLBACK_FACTORS[i]);
  const moat = {
    description: asStr(aiMoat.description, `Emerging ${k.sector} protocol on ${k.chain || 'chain'}.`),
    factors,
  };

  // ── Valuation: fdv + the two ratios are computed from KNOWN numbers when we
  // have the inputs (the model can't invent a wrong ratio); only the peerAvg +
  // verdict are AI prose. The ratios are headline due-diligence figures, so
  // ground truth wins over any AI-stated value (incl. garbage like "oops"). ──
  const annualRev = k.revenue24h != null ? k.revenue24h * 365 : null;
  const mcapRevenue = (k.mcap != null && annualRev != null && annualRev > 0)
    ? `${(k.mcap / annualRev).toFixed(0)}x`
    : asStr(aiVal.mcapRevenue, k.revenue24h != null ? 'N/A' : 'Pre-revenue');
  const mcapTvl = (k.mcap != null && k.tvl != null && k.tvl > 0)
    ? `${(k.mcap / k.tvl).toFixed(2)}x`
    : asStr(aiVal.mcapTvl, 'N/A');
  const valuation = {
    fdv: fmtCompactUsd(k.fdv) || (fmtCompactUsd(k.mcap) || 'N/A'),
    mcapRevenue,
    mcapTvl,
    peerAvg: asStr(aiVal.peerAvg, 'N/A'),
    verdict: asStr(aiVal.verdict, ''),
  };

  // Deal-flow stage -> a reasonable default for the cover badge if AI omits one.
  const stageMap = { sourced: 'Seed', diligence: 'Seed', conviction: 'Early Growth', positioned: 'Growth' };
  const stage = ['Seed', 'Early Growth', 'Growth', 'Mature'].includes(ai.stage)
    ? ai.stage
    : (stageMap[k.dealFlowStage] || 'Early Growth');

  const pitch = {
    id: `p-${k.symbol.toLowerCase()}`,
    symbol: k.symbol,
    name: k.name,
    tagline: asStr(ai.tagline, `${k.sector} on ${k.chain || 'chain'}`).slice(0, 60),
    comparable: asStr(ai.comparable, `An emerging ${k.sector} protocol building on-chain.`).slice(0, 140),
    sector: k.sector,
    stage,
    problem: asStr(ai.problem, ''),
    solution: asStr(ai.solution, ''),
    traction,
    tokenomics,
    team,
    moat,
    valuation,
  };
  if (k.address) pitch.address = k.address;
  return pitch;
}

// ── public: generatePitchDeck(project) ───────────────────────────────────────

/**
 * Generate (or refresh) a pitch deck for one project.
 * @param {object} project - a Phase-1 Research Desk project row
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - bypass the 7-day freshness check
 * @returns {Promise<object|null>} the persisted pitch object, or null on no-op/failure
 */
async function generatePitchDeck(project, opts = {}) {
  const { force = false } = opts;
  if (!project || !project.symbol) return null;

  const k = knownNumbers(project);
  if (!k.symbol) return null;
  const slug = `research-desk-pitch-${k.symbol.toLowerCase()}`;

  if (!force) {
    const existing = store.loadArticle(CONTENT_TYPE, slug);
    if (existing && existing.updatedAt && (Date.now() - new Date(existing.updatedAt).getTime()) < FRESH_MS) {
      return existing.pitch || null;
    }
  }

  const userPrompt = `${buildSeedBlock(k)}\n\nWrite the VC pitch-deck JSON object for ${k.name} ($${k.symbol}).`;

  let result;
  try {
    result = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: PITCH_SYSTEM_PROMPT,
      maxTokens: 1900,
      model: 'sonar', // legacy param; gate pins Groq llama-3.3-70b primary
      agentId: AGENT_ID,
      timeout: 45000,
      skipResolution: true,
    });
  } catch (err) {
    console.error(`[${AGENT_ID}] ${k.symbol} gate error:`, err.message);
    return null;
  }

  if (!result || result.type !== 'SUCCESS' || !result.content) {
    console.log(`[${AGENT_ID}] ${k.symbol} no content (type=${result?.type || 'null'})`);
    return null;
  }

  const ai = extractJsonObject(result.content);
  if (!ai || typeof ai !== 'object') {
    console.error(`[${AGENT_ID}] ${k.symbol} JSON extract failed`);
    return null;
  }

  const pitch = buildPitchObject(ai, k);

  try {
    store.saveArticle({
      type: CONTENT_TYPE,
      slug,
      title: `Pitch Deck — ${k.name} (${k.symbol})`,
      summary: pitch.tagline,
      symbol: k.symbol,
      kind: 'research-desk-pitch',
      pitch,
      model: result.model || null,
      tags: ['research-desk', 'pitch-deck', k.symbol, k.sector].filter(Boolean),
    });
  } catch (err) {
    console.error(`[${AGENT_ID}] ${k.symbol} save failed:`, err.message);
  }

  return pitch;
}

module.exports = {
  generatePitchDeck,
  extractJsonObject,
  knownNumbers,
  AGENT_ID,
  CONTENT_TYPE,
  FRESH_MS,
};
