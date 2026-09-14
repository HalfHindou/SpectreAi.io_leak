/**
 * Spectre Intelligence Hub — RWA Analysis Agent
 * Generates concise analytical commentary for RWA subpages + per-protocol
 * deep-dives. Uses Perplexity sonar-pro via the shared gatedPerplexitySearch
 * client. Reads data from the warmer-hot helpers exported by routes/rwa.js.
 *
 * Modes:
 *   - Subpage:  topic ∈ { overview, stablecoins, treasuries, credit,
 *                         commodities, networks, platforms }
 *   - Protocol: topic='protocol' + slug
 *
 * Output is cached via saveArticle({ type: 'rwa-analysis', slug: <topic|protocol-slug> }).
 * Regenerates only when the cached file is older than 4h.
 */

const { saveArticle, loadArticle } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const rwa = require('../routes/rwa');
const { chat: gatewayChat } = require('../lib/llm-gateway');

const STALE_MS = 23 * 60 * 60 * 1000; // 23h — one fresh article per topic per day (Daily Edition)
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 40000;
// Gateway-aware: run the cron when ANY provider key is present (incl. free
// Cerebras/Gemini/OpenRouter), not only when GROQ_API_KEY is set.
const HAS_LLM_KEY = (() => {
  try { return require('../lib/llm-gateway').providerStatus().some(p => p.hasKey); }
  catch { return Boolean(process.env.GROQ_API_KEY); }
})();

// Delegates to the resilient multi-provider LLM gateway, GEMINI FIRST (free
// tier — founder directive 2026-08-14 "wire gemini no cost"), then the rest of
// the chain circuit-broken so generation survives a single-provider outage.
// Keep this chain in sync with apps/research/api/rwa-analysis.js (prod twin).
// Return shape preserved: { ok, content, model } | { ok:false, content:'', error, model }.
const RWA_LLM_CHAIN = ['gemini', 'groq', 'cerebras', 'openrouter', 'openai', 'anthropic'];
async function callGroq(systemPrompt, userMessage, { maxTokens = 1200, temperature = 0.25 } = {}) {
  const r = await gatewayChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    tier: 'smart',
    maxTokens,
    temperature,
    timeoutMs: GROQ_TIMEOUT_MS,
    chain: RWA_LLM_CHAIN,
  });
  return r.ok
    ? { ok: true, content: r.text, model: r.model, provider: r.provider }
    : { ok: false, content: '', error: r.error, model: r.model || GROQ_MODEL };
}

// ── SYSTEM PROMPTS ──────────────────────────────────────────────────────────

const SUBPAGE_SYSTEM_PROMPT = `You are Spectre AI's RWA (Real World Assets) research analyst writing the DAILY EDITION. One article per day. Write as "we" (Spectre AI). Institutional tone, data-driven, opinionated. Today's edition must thread together three layers:

  1) What moved in this RWA category, over 24h AND across the wider trend. Read the day against the multi-window moves on the sheet rather than in isolation, and say plainly when a daily wobble sits inside a multi-week direction.
  2) The notable tokenized-asset developments of the LAST TWO WEEKS, taken ONLY from the DEVELOPMENTS list on the sheet (issuer announcements, chain launches, regulatory moves, partnerships, research). Date every one you cite ("on Aug 10, ..."). Lead with the newest, but a material story from several days ago is still news the reader must know.
     NEVER write that news was quiet, that nothing broke, or that there were no major announcements while the DEVELOPMENTS list has entries in it. Only when that list explicitly says none were returned may you say there is nothing notable to report.
  3) General market context framing the above: BTC/ETH direction, US Treasury yields and dollar strength, equity risk tone, any macro catalyst (CPI, FOMC, ETF flows). Tie the RWA move to the macro frame in one sentence.

Format: 3–4 tight sentences of prose (the lede weaves RWA + macro), followed by a "## What changed" markdown heading and exactly 2–3 bullets under it. Each bullet is one sentence describing a concrete shift: distribution changes, inflow/outflow drivers, issuer concentration moves, peg anomalies, TVL rotations, or regulatory catalysts.

Focus areas by category:
- Treasuries: issuer concentration (BlackRock BUIDL, Franklin BENJI, Ondo USDY, Hashnote USYC), T-bill rate sensitivity, institutional inflows
- Stablecoins: peg stability, circulating supply deltas, chain distribution, issuer risk (USDT/USDC/DAI/USDe/FDUSD)
- Credit: Maple/Goldfinch/Centrifuge active loan books, defaults, yield spreads
- Commodities: PAXG/XAUT gold-backed flows, physical custody trust
- Networks: chain-level TVL dominance (Ethereum vs Polygon vs Avalanche vs Solana), bridged assets
- Platforms: issuer platforms (Ondo, Superstate, Backed), tokenization standards

Rules:
- Include specific numbers ($B TVL, % change, basis points) everywhere
- NO em-dashes. Use commas, colons, or split sentences
- Paragraphs: maximum 3 sentences. Bullets: one sentence each
- Do NOT place [1][2] citation markers in prose
- Banned phrases: "delve into", "landscape", "robust", "leverage" (as verb), "seamlessly", "groundbreaking", "deep dive", "pivotal", "realm", "navigate", "cutting-edge"
- 180–320 words total, no more`;

const PROTOCOL_SYSTEM_PROMPT = `You are Spectre AI's RWA research analyst covering a single tokenized-asset protocol. Write as "we" (Spectre AI). Institutional tone, data-driven.

Format: 2–3 tight sentences covering the protocol's current TVL position and trajectory, followed by a "## What changed" markdown heading with exactly 2–3 one-sentence bullets. Cover: TVL direction over 1d/7d/30d, chain exposure shifts, peer comparison within its RWA category (Treasuries / Credit / Commodities / Other), and any issuer concentration or mandate changes.

Rules:
- Include specific TVL figures and % changes
- NO em-dashes. Use commas or colons
- Paragraphs: maximum 3 sentences. Bullets: one sentence each
- Do NOT place [1][2] citation markers in prose
- Banned phrases: "delve into", "landscape", "robust", "leverage" (as verb), "seamlessly", "deep dive", "pivotal", "realm"
- 180–300 words total`;

// ── DATA BUILDERS ───────────────────────────────────────────────────────────

const TOPIC_KEYWORDS = {
  treasuries: ['treasury', 'buidl', 'usyc', 'benji', 'ustb', 't-bill', 'wisdomtree', 'superstate', 'openeden', 'matrixdock', 'ondo', 'spiko', 'usdy'],
  credit: ['centrifuge', 'maple', 'goldfinch', 'truefi', 'clearpool', 'credix', 'credit'],
  commodities: ['gold', 'paxg', 'xaut', 'silver', 'platinum', 'commodity'],
  platforms: ['ondo', 'superstate', 'backed', 'matrixdock', 'openeden'],
};

function filterByTopic(protocols, topic) {
  const kws = TOPIC_KEYWORDS[topic];
  if (!kws) return protocols;
  const nameMatch = (p) => kws.some(k => (p.name || '').toLowerCase().includes(k));
  return protocols.filter(nameMatch);
}

function fmtB(n) {
  if (!n || !isFinite(n)) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

/* ── Recent developments + multi-window trend ────────────────────────────────
   TWIN of apps/research/api/rwa-analysis.js (prod). Keep the filters, window
   and thresholds in sync.

   Why this exists: the prompt has always asked for "the day's tokenized-asset
   news" while NOTHING put news in the context — the original agent ran on
   Perplexity sonar-pro, which searched the web itself. When generation moved to
   the LLM gateway the search went away and the instruction stayed, so every
   edition wrote "news was quiet" no matter what had shipped that week. */
const NEWS_WINDOW_DAYS = 14;
const NEWS_MAX_ITEMS = 12;
const SPECTRE_ORIGIN = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const SPECTRE_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_API_KEY || '';

// The box's /v1/rwa/news lane matches a bare "rwa" substring, so it drags in
// SEC EDGAR filings for AIRWA INC., JETBLUE AIRWAYS and CLEARWATER PAPER.
const RWA_TERMS = /\b(rwa|rwas|tokeniz\w*|tokenised|real[- ]world asset|treasur\w*|t-bill|stablecoin|private credit|money market fund|on-?chain fund|bond fund|gold-backed|custod\w*|issuer)\b/i;

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

async function fetchRwaDevelopments() {
  const headers = { Accept: 'application/json' };
  if (SPECTRE_KEY) headers['X-API-Key'] = SPECTRE_KEY;
  let rows = [];
  try {
    const r = await fetch(`${SPECTRE_ORIGIN}/v1/news/rwa?limit=60`, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = await r.json();
    rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  } catch { return []; }

  const cutoff = Date.now() - NEWS_WINDOW_DAYS * 86400000;
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r?.source === 'SEC EDGAR') continue;
    const title = decodeEntities(r?.title);
    if (!title) continue;
    if (!RWA_TERMS.test(`${title} ${decodeEntities(r?.summary)}`)) continue;
    const ts = Date.parse(r?.publishedAt || r?.published_at || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const key = title.toLowerCase().replace(/\W+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`- ${new Date(ts).toISOString().slice(0, 10)} (${r.source || 'unknown'}): ${title}`);
    if (out.length >= NEWS_MAX_ITEMS) break;
  }
  return out;
}

// Never index this series from the START: `?range=30d` is not a valid key on
// the box (1m/3m/6m/1y/2y/all) and silently returns a full year, which makes a
// naive first-vs-last "30d" read +1584%. Walk back from the end instead.
async function fetchSectorTrendLines() {
  let data;
  try { data = await rwa.getRwaBreakdownHistory('3m'); } catch { return []; }
  const body = data?.data || data;
  const series = Array.isArray(body?.series) ? body.series : [];
  const cats = Array.isArray(body?.categories) ? body.categories : [];
  if (series.length < 8 || !cats.length) return [];
  const at = (i, c) => Number(series[i]?.[c]) || 0;
  const chg = (c, n) => {
    if (series.length < n + 1) return null;
    const a = at(series.length - 1 - n, c);
    const b = at(series.length - 1, c);
    return a > 0 ? ((b - a) / a) * 100 : null;
  };
  const p = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
  return cats
    .map(c => ({ c, aum: at(series.length - 1, c), d7: chg(c, 7), d30: chg(c, 30), d90: chg(c, 90) }))
    .filter(r => r.aum > 0)
    .sort((a, b) => b.aum - a.aum)
    .slice(0, 8)
    .map(r => `- ${r.c}: ${fmtB(r.aum)} | 7d ${p(r.d7)} | 30d ${p(r.d30)} | 90d ${p(r.d90)}`);
}

async function buildSubpageContext(topic) {
  const lines = [];
  const protocols = await rwa.getRwaProtocols().catch(() => []);
  const totalTvl = protocols.reduce((s, p) => s + (p.tvl || 0), 0);

  lines.push(`Total RWA sector TVL: ${fmtB(totalTvl)} across ${protocols.length} protocols.`);

  if (topic === 'overview') {
    const top = protocols.slice(0, 10);
    lines.push('Top 10 RWA protocols by TVL:');
    top.forEach(p => {
      const ch = p.change_7d != null ? ` (7d: ${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}%)` : '';
      lines.push(`- ${p.name}: ${fmtB(p.tvl)}${ch}, chains: ${(p.chains || []).slice(0, 3).join(', ')}`);
    });
    try {
      const { data: movers } = await rwa.getRwaMovers();
      if (movers?.gainers?.length) {
        lines.push(`Top 24h gainer: ${movers.gainers[0].name} (${movers.gainers[0].change_1d > 0 ? '+' : ''}${movers.gainers[0].change_1d.toFixed(1)}%)`);
      }
      if (movers?.losers?.length) {
        lines.push(`Top 24h loser: ${movers.losers[0].name} (${movers.losers[0].change_1d.toFixed(1)}%)`);
      }
    } catch (_) {}
  } else if (topic === 'stablecoins') {
    const stables = await rwa.getRwaStablecoins().catch(() => []);
    const byMcap = stables
      .map(s => ({
        name: s.name, symbol: s.symbol,
        mcap: s.circulating?.peggedUSD || 0,
        prevDay: s.circulatingPrevDay?.peggedUSD || 0,
        prevWeek: s.circulatingPrevWeek?.peggedUSD || 0,
        pegMechanism: s.pegMechanism,
        chains: s.chains || [],
      }))
      .sort((a, b) => b.mcap - a.mcap)
      .slice(0, 10);
    const totalStable = stables.reduce((s, x) => s + (x.circulating?.peggedUSD || 0), 0);
    lines.push(`Total stablecoin mcap: ${fmtB(totalStable)} across ${stables.length} pegged assets.`);
    lines.push('Top 10 stablecoins by market cap:');
    byMcap.forEach(s => {
      const dayDelta = s.prevDay ? ((s.mcap - s.prevDay) / s.prevDay * 100).toFixed(2) : 'n/a';
      const weekDelta = s.prevWeek ? ((s.mcap - s.prevWeek) / s.prevWeek * 100).toFixed(2) : 'n/a';
      lines.push(`- ${s.symbol} (${s.name}): ${fmtB(s.mcap)}, 1d: ${dayDelta}%, 7d: ${weekDelta}%, peg: ${s.pegMechanism || 'n/a'}, chains: ${s.chains.length}`);
    });
  } else if (topic === 'networks') {
    const chains = await rwa.getRwaChains().catch(() => []);
    lines.push('Top 10 chains by RWA TVL:');
    chains.slice(0, 10).forEach(c => {
      lines.push(`- ${c.chain}: ${fmtB(c.totalRwaTvl)} across ${c.protocolCount} protocols`);
    });
  } else {
    const filtered = filterByTopic(protocols, topic).slice(0, 12);
    const catTvl = filtered.reduce((s, p) => s + (p.tvl || 0), 0);
    lines.push(`${topic} subcategory TVL: ${fmtB(catTvl)} across ${filtered.length} tracked protocols.`);
    filtered.forEach(p => {
      const ch = p.change_7d != null ? ` (7d: ${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}%)` : '';
      lines.push(`- ${p.name}: ${fmtB(p.tvl)}${ch}`);
    });
  }

  const [devLines, trendLines] = await Promise.all([
    fetchRwaDevelopments().catch(() => []),
    fetchSectorTrendLines().catch(() => []),
  ]);

  if (trendLines.length) {
    lines.push('', 'SECTOR AUM TREND (tokenized-asset categories, multi-window):', ...trendLines);
  }
  lines.push('', `DEVELOPMENTS (tokenized-asset headlines, last ${NEWS_WINDOW_DAYS} days, newest first):`);
  lines.push(...(devLines.length ? devLines : ['- (none returned by the news feed for this window)']));

  return lines.join('\n');
}

async function buildProtocolContext(slug) {
  const protocols = await rwa.getRwaProtocols().catch(() => []);
  const p = protocols.find(x => x.slug === slug);
  if (!p) {
    return `Protocol slug "${slug}" not found in current RWA protocol list. Reason about it from public knowledge.`;
  }
  const peers = protocols
    .filter(x => x.slug !== slug)
    .slice(0, 10);
  const lines = [];
  lines.push(`Protocol: ${p.name} (${p.slug})`);
  lines.push(`Current TVL: ${fmtB(p.tvl)}`);
  if (p.change_1d != null) lines.push(`1d change: ${p.change_1d > 0 ? '+' : ''}${p.change_1d.toFixed(2)}%`);
  if (p.change_7d != null) lines.push(`7d change: ${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(2)}%`);
  if (p.change_30d != null) lines.push(`30d change: ${p.change_30d > 0 ? '+' : ''}${p.change_30d.toFixed(2)}%`);
  lines.push(`Chains: ${(p.chains || []).join(', ') || 'n/a'}`);
  if (p.description) lines.push(`Description: ${p.description.slice(0, 300)}`);
  lines.push('');
  lines.push('Peer RWA protocols (top 10 by TVL) for comparison:');
  peers.forEach(x => lines.push(`- ${x.name}: ${fmtB(x.tvl)}`));
  return lines.join('\n');
}

// ── MAIN ENTRY ──────────────────────────────────────────────────────────────

/**
 * Generate RWA analysis for a subpage or protocol.
 * @param {object} opts
 * @param {string} opts.topic - subpage topic OR 'protocol' for per-protocol
 * @param {string} [opts.slug] - required when topic='protocol'
 * @param {boolean} [opts.force] - skip staleness check
 * @returns {Promise<{slug: string, article: string|null, lastUpdated: string|null, topic: string} | null>}
 */
async function generateRwaAnalysis({ topic, slug, force = false } = {}) {
  if (!HAS_LLM_KEY) {
    console.warn('[rwa-analysis] no LLM provider key — skipping generation (no-op)');
    return null;
  }

  const isProtocol = topic === 'protocol';
  if (isProtocol && !slug) {
    console.warn('[rwa-analysis] protocol topic requires slug — skipping');
    return null;
  }

  const storeSlug = isProtocol ? `protocol-${slug}` : topic;
  const startTime = Date.now();

  // Freshness guard
  if (!force) {
    const existing = loadArticle('rwa-analysis', storeSlug);
    if (existing) {
      const ageMs = Date.now() - new Date(existing.updatedAt || existing.publishedAt).getTime();
      if (ageMs < STALE_MS) {
        return {
          slug: storeSlug,
          topic: isProtocol ? 'protocol' : topic,
          article: existing.content,
          lastUpdated: existing.updatedAt || existing.publishedAt,
        };
      }
    }
  }

  logAgentActivity({
    agent: 'rwa-analysis',
    action: 'started',
    target: storeSlug,
    targetType: 'rwa-analysis',
    title: `Generating RWA analysis: ${storeSlug}`,
  });

  let systemPrompt, userPrompt, displayName;
  try {
    if (isProtocol) {
      systemPrompt = PROTOCOL_SYSTEM_PROMPT;
      const ctx = await buildProtocolContext(slug);
      userPrompt = `Write a concise institutional analysis of the RWA protocol "${slug}" using the live data below. Cover TVL trajectory, chain exposure, and peer comparison.\n\n${ctx}\n\nCross-reference latest news and on-chain flows for this protocol.`;
      displayName = slug;
    } else {
      systemPrompt = SUBPAGE_SYSTEM_PROMPT;
      const ctx = await buildSubpageContext(topic);
      const today = new Date().toISOString().slice(0, 10);
      userPrompt = `Today: ${today}. Write TODAY'S Daily Edition article on the RWA ${topic} category using the live data below. Weave three threads: (1) what moved in ${topic} today, (2) the day's tokenized-asset news, (3) the general crypto + macro frame (BTC/ETH trend, Treasury yields, dollar, risk tone). Call out distribution changes, inflow/outflow drivers, issuer concentration shifts, and peg anomalies where relevant. Read the day against the 7d/30d/90d trend on the sheet, date every development you cite, and do NOT claim the news was quiet while the DEVELOPMENTS list has entries.\n\n${ctx}`;
      displayName = topic;
    }

    const gateResult = await callGroq(systemPrompt, userPrompt, { maxTokens: 1200, temperature: 0.25 });

    if (!gateResult.ok || !gateResult.content) {
      throw new Error(gateResult.error || 'Groq returned no content');
    }

    const content = gateResult.content;
    const citations = [];

    const title = isProtocol
      ? `${slug} RWA Analysis | Spectre Intelligence`
      : `RWA ${topic[0].toUpperCase() + topic.slice(1)} Analysis | Spectre Intelligence`;

    const article = saveArticle({
      slug: storeSlug,
      type: 'rwa-analysis',
      title,
      headline: isProtocol ? `${slug} RWA Analysis` : `RWA ${topic} Analysis`,
      summary: content.replace(/[#*]/g, '').slice(0, 200).trim(),
      content,
      tags: ['rwa', topic, isProtocol ? slug : undefined].filter(Boolean),
      sourcesCited: citations,
      model: gateResult.model || GROQ_MODEL,
      generationTimeMs: Date.now() - startTime,
    });

    logAgentActivity({
      agent: 'rwa-analysis',
      action: 'completed',
      target: storeSlug,
      targetType: 'rwa-analysis',
      title: `RWA ${displayName} analysis (${content.split(/\s+/).length} words)`,
      sourceCount: citations.length,
      generationTimeMs: Date.now() - startTime,
      slug: storeSlug,
    });

    console.log(`[rwa-analysis] Generated ${storeSlug} in ${Date.now() - startTime}ms`);

    return {
      slug: storeSlug,
      topic: isProtocol ? 'protocol' : topic,
      article: article.content,
      lastUpdated: article.updatedAt,
    };
  } catch (e) {
    logAgentActivity({
      agent: 'rwa-analysis',
      action: 'failed',
      target: storeSlug,
      targetType: 'rwa-analysis',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[rwa-analysis] Failed for ${storeSlug}:`, e.message);
    return null;
  }
}

// Rotate through the 7 subpage topics — one per scheduler cycle
const SUBPAGE_TOPICS = ['overview', 'stablecoins', 'treasuries', 'credit', 'commodities', 'networks', 'platforms'];

/**
 * Scheduler entry point — rotates through subpage topics, one per call.
 * Uses agentState.getTopicIndex/setTopicIndex to persist rotation position.
 */
async function runRwaAnalysisCycle() {
  if (!HAS_LLM_KEY) {
    console.log('[rwa-analysis] Skipping cycle — no LLM provider key');
    return null;
  }
  const { getTopicIndex, setTopicIndex } = require('./agentState');
  const idx = getTopicIndex('rwa-analysis') % SUBPAGE_TOPICS.length;
  const topic = SUBPAGE_TOPICS[idx];
  setTopicIndex('rwa-analysis', (idx + 1) % SUBPAGE_TOPICS.length);

  console.log(`[rwa-analysis] Cycle ${idx + 1}/${SUBPAGE_TOPICS.length} — topic=${topic}`);
  return generateRwaAnalysis({ topic });
}

module.exports = {
  generateRwaAnalysis,
  runRwaAnalysisCycle,
  SUBPAGE_TOPICS,
};
