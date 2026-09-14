/**
 * Spectre Intelligence — Tokenized Assets Daily Edition
 *
 * Publishes ONE full-length editorial article per day about tokenized assets.
 * Stored as { type: 'research', slug: 'tokenized-assets-daily-YYYY-MM-DD' }
 * so it appears in the Intelligence page research column and the rotation.
 *
 * Threads three layers:
 *   1) What moved in tokenized-assets today (TVL, inflows, issuer moves, peg)
 *   2) The day's RWA news (issuer announcements, regulation, partnerships)
 *   3) General crypto + macro context (BTC/ETH tape, yields, dollar, risk)
 *
 * Regenerates only when today's article does not exist.
 * Scheduler call: runTokenizedAssetsDaily().
 */

const { saveArticle, loadArticle } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const rwa = require('../routes/rwa');
const { chat: gatewayChat } = require('../lib/llm-gateway');

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 60000;
// Gateway-aware: publish the daily edition when ANY provider key is present
// (incl. free Cerebras/Gemini/OpenRouter), not only when GROQ_API_KEY is set.
const HAS_LLM_KEY = (() => {
  try { return require('../lib/llm-gateway').providerStatus().some(p => p.hasKey); }
  catch { return Boolean(process.env.GROQ_API_KEY); }
})();

// ── SYSTEM PROMPT ───────────────────────────────────────────────────────────

const EDITORIAL_SYSTEM_PROMPT = `You are the lead writer of Spectre AI's Tokenized Assets Daily Edition. You publish ONE full-length editorial article per day. Institutional readers: fund managers, family offices, fintech operators, sovereign desks.

Voice:
- Write as "we" (Spectre AI). Confident, data-led, opinionated but never flippant.
- Think Bloomberg Odd Lots meets Matt Levine meets Bridgewater daily observations.
- Every claim is grounded in the numbers provided. When you make a call, say so plainly.

DATA DISCIPLINE (absolute, non-negotiable):
- Use ONLY numbers that appear in the DATA BLOCK the user provides. If it is not in the block, you cannot mention it.
- Never invent chain-level inflows/outflows, tokenized-Treasury spreads, DXY moves, yields, or total market cap figures. If a field is marked "unavailable" or "not in today's pull," acknowledge that briefly ("the 2-year yield is not in today's pull") and move on.
- If the macro tape disagrees with the crypto-price direction (e.g., prices up while Fear & Greed prints "Fear"), LEAD with that tension — it is the story.
- If the yield curve data is available and inverted (2Y > 10Y), call it out explicitly. Do NOT leave that signal on the floor.

TIMEFRAME DISCIPLINE (the most important rule):
- 24h is noise. 7d is story. 30d is trend.
- The DATA BLOCK gives you weighted 1d, 7d, and 30d sector change. READ THEM BEFORE WRITING. The framing of the entire article follows from those three numbers.
- If 7d is positive (>= +0.5%) or 30d is positive (>= +1%), you are writing about a sector that is holding or expanding — NOT a "mixed signals" story. The lede must reflect the longer arc. Call out the structural trend first, then use the 24h print as consolidation/noise context.
- If 7d and 30d disagree (e.g., 30d up, 7d down), that is a rotation story — name which issuers are pulling back and which are absorbing.
- "Mixed signals" is a banned phrase unless the 7d is within ±0.3% AND the 30d is within ±0.5%. If either timeframe prints clear direction, write the directional story.
- Reference at least one 7d AND one 30d number in the lede or "What Moved" section.

ONE OBSERVATION, ONE MENTION:
- Any single data point appears at most ONCE in the article. If Fear & Greed is in the lede, it is NOT in "The Macro Frame." If the sector 7d is in "What Moved," it is not restated in "The Macro Frame."
- When tempted to restate, delete instead. Forward motion only.

MECHANISM AWARENESS:
- Fear & Greed is a retail-sentiment composite. It does NOT directly drive institutional RWA allocation (BUIDL, Ondo, Franklin, Circle USYC move on a different clock). Use F&G as tone/risk context only, never as a cause of institutional inflow/outflow.
- Do not write "fear may lead to decreased demand for RWA." Institutional mandates do not flip because of a retail-sentiment index.

NO HEDGING PARAGRAPHS:
- Banned template: "X may benefit Y… may also lead to Z… unclear… difficult to predict." A paragraph that hedges in both directions and nets to zero information MUST be deleted or committed to a directional read.
- If you have a real directional view, write ONE sentence saying so. If you don't, cut the paragraph entirely.

CONDITIONAL MACRO FRAME:
- The "Macro Frame" section is OPTIONAL. Write it only if the DATA BLOCK has at least TWO live macro signals among {DXY, 10Y, 2Y, VIX}.
- If the DATA BLOCK says two or more of those are unavailable, COLLAPSE "The Macro Frame" to a single sentence: "Rates and dollar feed are not available in today's pull; we will restore the macro frame when the data returns." Do NOT fill a section with disclosures of missing data.
- Even when you collapse, you may still cover the crypto tape (BTC/ETH/total cap/dominance) if those ARE present — but merge it into the lede or "What Moved," don't float a half-empty section.

STRUCTURE (markdown, exactly this shape):

# {headline — 6 to 12 words, concrete, specific, no clickbait}

{A 3-sentence editorial lede. Sentence 1: the one-line thesis for today. Sentence 2: the sharpest data point supporting it. Sentence 3: the counter-signal or tension. Reads like a print newspaper opener, not a LinkedIn post.}

## What Moved
{2 paragraphs. First: the biggest TVL shifts across issuers and categories, with hard numbers from the DATA BLOCK. Second: stablecoin circulation shifts and chain-level TVL ranking (use the provided chain-breakdown, NOT fabricated inflow numbers).}

## The News Desk
{If there is substantive tokenized-asset news today: 1 to 2 paragraphs summarizing the beats — issuer announcements, chain launches, regulatory signals, ETF flows. If nothing material broke today, say so in a single sentence ("The news desk is quiet today.") and MOVE ON — do not pad.}

## The Macro Frame
{OPTIONAL — render only if ≥2 of DXY, 10Y, 2Y, VIX are present in the DATA BLOCK.
If ≥2 are unavailable: replace this entire section with the single sentence "Rates and dollar feed are not available in today's pull; we will restore the macro frame when the data returns." Do not pad.
If rendered: 1-2 paragraphs drawing on the crypto tape lines (BTC/ETH/total cap/dominance) AND the rates/dollar lines you have. Every figure from the DATA BLOCK. Each macro point tied to a specific RWA implication. Do NOT re-cite Fear & Greed if it already appeared in the lede.}

## What We're Watching
{Exactly 3 bullets. Each bullet is ONE sentence naming a specific catalyst to track over the next 24 to 72 hours.}

---

Rules:
- 650 to 900 words total.
- Include specific figures everywhere, but ONLY figures from the DATA BLOCK.
- NO em-dashes anywhere. Use commas, colons, or split sentences.
- NO citation markers like [1][2].
- NO filler scaffolding. Do NOT repeat "we see this as a sign that…" — use that phrasing at most ONCE in the entire article, and only when you have a specific causal claim to attach to it.
- NO duplicated sentences or paraphrases of the same point across sections.
- NO hype words. Banned list: "delve into", "landscape", "robust", "leverage" (as verb), "seamlessly", "groundbreaking", "deep dive", "pivotal", "realm", "navigate", "cutting-edge", "game-changing", "unlock", "empower", "revolutionize".
- Do NOT hedge with "it will be interesting to see". Make calls.
- Use active voice. One clean sentence per idea.`;

// ── DATA BUILDERS ───────────────────────────────────────────────────────────

function fmtB(n) {
  if (!n || !isFinite(n)) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function pct(v) {
  if (v == null || !isFinite(v)) return 'n/a';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/**
 * Outlier filter. DefiLlama occasionally returns absurd 1d deltas when a
 * protocol restructures, rebases, or a new pool is launched off near-zero.
 * Anything beyond ±500% over 24h is treated as a data artifact, not a real move.
 */
const MOVER_SANITY_CAP_PCT = 500;
function isRealMover(p) {
  const c = p?.change_1d;
  return typeof c === 'number' && isFinite(c) && Math.abs(c) <= MOVER_SANITY_CAP_PCT;
}

/** Try a stooq CSV quote. Returns { last, changePct } or null. */
async function stooqQuote(symbol) {
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const txt = await res.text();
    const row = txt.split('\n')[1];
    if (!row) return null;
    const cells = row.split(',');
    // symbol,date,time,open,high,low,close,volume
    const open = parseFloat(cells[3]);
    const close = parseFloat(cells[6]);
    if (!isFinite(close)) return null;
    const changePct = isFinite(open) && open !== 0 ? ((close - open) / open) * 100 : null;
    return { last: close, changePct };
  } catch { return null; }
}

async function buildContext() {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`TODAY: ${today}`);
  lines.push('');

  const sources = new Set();

  // ── RWA sector data ──
  const [protocols, stablecoins, chains, moversResult] = await Promise.all([
    rwa.getRwaProtocols().catch(() => []),
    rwa.getRwaStablecoins().catch(() => []),
    rwa.getRwaChains().catch(() => []),
    rwa.getRwaMovers().catch(() => ({ data: { gainers: [], losers: [] } })),
  ]);
  if (protocols.length) sources.add('DefiLlama RWA (api.llama.fi)');
  if (stablecoins.length) sources.add('DefiLlama Stablecoins (stablecoins.llama.fi)');

  const totalTvl = protocols.reduce((s, p) => s + (p.tvl || 0), 0);
  const totalStable = stablecoins.reduce((s, x) => s + (x.circulating?.peggedUSD || 0), 0);

  // Pre-compute top-10 sum so the LLM does not mis-add.
  const top10 = protocols.slice(0, 10);
  const top10Sum = top10.reduce((s, p) => s + (p.tvl || 0), 0);
  const top10Share = totalTvl > 0 ? (top10Sum / totalTvl) * 100 : 0;

  // ── Multi-timeframe sector trajectory (24h is noise; story is in 7d / 30d) ──
  const sanityClamp = (v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= MOVER_SANITY_CAP_PCT;
  function weightedChange(key) {
    let w = 0, s = 0;
    for (const p of protocols) {
      const t = p.tvl || 0;
      const v = p[key];
      if (t > 0 && sanityClamp(v)) { w += t; s += v * t; }
    }
    return w > 0 ? s / w : null;
  }
  const w1d = weightedChange('change_1d');
  const w7d = weightedChange('change_7d');
  const w30d = weightedChange('change_30d');

  // Stablecoin sector aggregate 1d/7d.
  let stablePrev = 0, stablePrevWeek = 0;
  for (const s of stablecoins) {
    stablePrev += (s.circulatingPrevDay?.peggedUSD || 0);
    stablePrevWeek += (s.circulatingPrevWeek?.peggedUSD || 0);
  }
  const stable1d = stablePrev > 0 ? ((totalStable - stablePrev) / stablePrev) * 100 : null;
  const stable7d = stablePrevWeek > 0 ? ((totalStable - stablePrevWeek) / stablePrevWeek) * 100 : null;
  const stable7dAbs = stablePrevWeek > 0 ? totalStable - stablePrevWeek : null;

  lines.push(`=== SECTOR SNAPSHOT (multi-timeframe) ===`);
  lines.push(`Total RWA onchain value (DefiLlama RWA category): ${fmtB(totalTvl)} across ${protocols.length} protocols.`);
  lines.push(`Top-10 RWA issuers sum to ${fmtB(top10Sum)} (${top10Share.toFixed(1)}% of sector).`);
  lines.push(`RWA sector TVL, TVL-weighted change: 1d ${w1d != null ? pct(w1d) : 'n/a'} | 7d ${w7d != null ? pct(w7d) : 'n/a'} | 30d ${w30d != null ? pct(w30d) : 'n/a'}`);
  lines.push(`Total stablecoin market cap: ${fmtB(totalStable)} across ${stablecoins.length} pegged assets.`);
  lines.push(`Stablecoin sector mcap change: 1d ${stable1d != null ? pct(stable1d) : 'n/a'} | 7d ${stable7d != null ? pct(stable7d) : 'n/a'}${stable7dAbs != null ? ` (${fmtB(stable7dAbs)} net issuance over 7d)` : ''}`);
  lines.push('');
  lines.push(`EDITORIAL GUIDANCE: 24-hour change is usually noise. The story is in the 7d and 30d trajectory, and in which issuers are holding vs rotating. If 24h is flat or mixed but 7d/30d print clear direction, LEAD with the longer arc. Do NOT default to calling the sector "mixed signals" when the weekly print is positive.`);
  lines.push('');

  lines.push(`=== TOP 10 RWA PROTOCOLS BY TVL ===`);
  top10.forEach(p => {
    lines.push(`- ${p.name}: ${fmtB(p.tvl)}, 1d: ${pct(p.change_1d)}, 7d: ${pct(p.change_7d)}, 30d: ${pct(p.change_30d)}, chains: ${(p.chains || []).slice(0, 3).join(', ')}`);
  });
  lines.push('');

  // Outlier-filter movers: drop anything with |1d| > 500%.
  const moversRaw = moversResult?.data || moversResult || {};
  const gainers = (moversRaw.gainers || []).filter(isRealMover).slice(0, 5);
  const losers = (moversRaw.losers || []).filter(isRealMover).slice(0, 5);
  const droppedGainers = (moversRaw.gainers || []).filter(p => !isRealMover(p)).map(p => p.name);
  const droppedLosers = (moversRaw.losers || []).filter(p => !isRealMover(p)).map(p => p.name);

  if (gainers.length) {
    lines.push(`=== 24H GAINERS (outliers >500% excluded) ===`);
    gainers.forEach(p => { lines.push(`- ${p.name}: ${fmtB(p.tvl)}, 1d: ${pct(p.change_1d)}`); });
    lines.push('');
  }
  if (losers.length) {
    lines.push(`=== 24H LOSERS (outliers >500% excluded) ===`);
    losers.forEach(p => { lines.push(`- ${p.name}: ${fmtB(p.tvl)}, 1d: ${pct(p.change_1d)}`); });
    lines.push('');
  }
  if (droppedGainers.length || droppedLosers.length) {
    lines.push(`NOTE: Dropped suspected data artifacts (likely DefiLlama rebase/migration glitches): ${[...droppedGainers, ...droppedLosers].join(', ')}. Do NOT reference these in the article.`);
    lines.push('');
  }

  lines.push(`=== TOP STABLECOINS ===`);
  stablecoins
    .slice()
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 8)
    .forEach(s => {
      const mcap = s.circulating?.peggedUSD || 0;
      const prevDay = s.circulatingPrevDay?.peggedUSD || 0;
      const prevWeek = s.circulatingPrevWeek?.peggedUSD || 0;
      const day = prevDay ? ((mcap - prevDay) / prevDay * 100).toFixed(2) : 'n/a';
      const week = prevWeek ? ((mcap - prevWeek) / prevWeek * 100).toFixed(2) : 'n/a';
      lines.push(`- ${s.symbol || s.name}: ${fmtB(mcap)}, 1d: ${day}%, 7d: ${week}%, peg: ${s.pegMechanism || 'n/a'}`);
    });
  lines.push('');

  if (chains?.length) {
    lines.push(`=== TOP CHAINS BY RWA TVL ===`);
    chains.slice(0, 8).forEach(c => {
      lines.push(`- ${c.chain}: ${fmtB(c.totalRwaTvl)} across ${c.protocolCount} protocols`);
    });
    lines.push('');
  }

  // ── Crypto macro (CoinGecko global + Binance) ──
  lines.push(`=== CRYPTO MACRO ===`);
  try {
    const g = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8000) });
    if (g.ok) {
      const j = await g.json();
      const d = j?.data;
      if (d) {
        const totalCap = d.total_market_cap?.usd || 0;
        const dominance = d.market_cap_percentage || {};
        const change24h = d.market_cap_change_percentage_24h_usd;
        lines.push(`- Total crypto market cap: ${fmtB(totalCap)} (24h: ${change24h != null ? pct(change24h) : 'n/a'})`);
        lines.push(`- BTC dominance: ${dominance.btc != null ? dominance.btc.toFixed(2) : 'n/a'}% | ETH dominance: ${dominance.eth != null ? dominance.eth.toFixed(2) : 'n/a'}%`);
        lines.push(`- Stablecoin share of total: ${(totalStable / totalCap * 100).toFixed(1)}%`);
        sources.add('CoinGecko Global (/api/v3/global)');
      }
    } else {
      lines.push('- CoinGecko global: unavailable');
    }
  } catch (_) { lines.push('- CoinGecko global: unavailable'); }

  try {
    const macroRes = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22%2C%22ETHUSDT%22%5D', {
      signal: AbortSignal.timeout(8000),
    });
    if (macroRes.ok) {
      const data = await macroRes.json();
      data.forEach(t => {
        const sym = t.symbol.replace('USDT', '');
        lines.push(`- ${sym}: $${parseFloat(t.lastPrice).toFixed(2)}, 24h: ${parseFloat(t.priceChangePercent).toFixed(2)}%, vol: ${fmtB(parseFloat(t.quoteVolume))}`);
      });
      sources.add('Binance 24h Ticker (api.binance.com)');
    }
  } catch (_) { lines.push('- BTC/ETH tape: unavailable'); }

  try {
    const fngRes = await fetch('https://api.alternative.me/fng/', { signal: AbortSignal.timeout(6000) });
    if (fngRes.ok) {
      const fng = await fngRes.json();
      const cur = fng?.data?.[0];
      if (cur) {
        lines.push(`- Fear & Greed Index: ${cur.value} (${cur.value_classification})`);
        sources.add('Alternative.me Fear & Greed');
      }
    }
  } catch (_) {}
  lines.push('');

  // ── Rates + Dollar (stooq, best effort) ──
  lines.push(`=== RATES + DOLLAR (best effort, may be partial) ===`);
  const [dxy, y10, y2] = await Promise.all([
    stooqQuote('^dxy'),   // US Dollar Index
    stooqQuote('^tnx'),   // 10Y Treasury yield (CBOE, as percent * 10 in some feeds — we render raw)
    stooqQuote('^vix'),   // VIX (proxy for risk; 2Y yield feed is unreliable on stooq free)
  ]);
  if (dxy && isFinite(dxy.last)) {
    lines.push(`- DXY (US Dollar Index): ${dxy.last.toFixed(2)}${dxy.changePct != null ? `, intraday: ${pct(dxy.changePct)}` : ''}`);
    sources.add('Stooq (DXY)');
  } else {
    lines.push('- DXY: unavailable today (do NOT invent a figure).');
  }
  if (y10 && isFinite(y10.last)) {
    // ^tnx is reported in basis-points/10 on some feeds. Normalize if value looks off.
    const normalized = y10.last > 100 ? y10.last / 10 : y10.last;
    lines.push(`- US 10Y Treasury yield: ${normalized.toFixed(2)}%${y10.changePct != null ? `, intraday: ${pct(y10.changePct)}` : ''}`);
    sources.add('Stooq (10Y Treasury)');
  } else {
    lines.push('- US 10Y Treasury yield: unavailable today (do NOT invent a figure).');
  }
  if (y2 && isFinite(y2.last)) {
    lines.push(`- VIX: ${y2.last.toFixed(2)}${y2.changePct != null ? `, intraday: ${pct(y2.changePct)}` : ''}`);
    sources.add('Stooq (VIX)');
  } else {
    lines.push('- VIX: unavailable today.');
  }
  lines.push(`- US 2Y Treasury yield: not in today's pull (do NOT invent a figure).`);
  lines.push('');

  // Final anti-hallucination reminder inside the data block itself.
  lines.push(`=== DATA DISCIPLINE ===`);
  lines.push(`Only use numbers that appear EXPLICITLY above. If a field reads "unavailable" or "not in today's pull", acknowledge that briefly and move on. Do NOT invent chain-level flow figures — we do not feed inflow/outflow numbers. Do NOT invent tokenized-Treasury spreads — we do not have that data today. Do NOT invent yields we did not surface.`);

  return { context: lines.join('\n'), sources: [...sources] };
}

// Delegates to the resilient multi-provider LLM gateway (groq → cerebras →
// gemini → openrouter → openai → anthropic → ollama, circuit-broken) instead of
// calling Groq directly, so the daily edition survives a single-provider outage.
// Return shape preserved: { ok, content, model } | { ok:false, content:'', error, model }.
async function callGroq(systemPrompt, userMessage, { maxTokens = 2800, temperature = 0.35 } = {}) {
  const r = await gatewayChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    tier: 'smart',
    maxTokens,
    temperature,
    timeoutMs: GROQ_TIMEOUT_MS,
  });
  return r.ok
    ? { ok: true, content: r.text, model: r.model, provider: r.provider }
    : { ok: false, content: '', error: r.error, model: r.model || GROQ_MODEL };
}

// ── MAIN ENTRY ──────────────────────────────────────────────────────────────

/** Today's slug: tokenized-assets-daily-YYYY-MM-DD (local UTC day). */
function todaySlug() {
  return `tokenized-assets-daily-${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Parse the H1 headline out of the article body. Fallback to a generic title.
 */
function extractHeadline(content) {
  const m = content.match(/^\s*#\s+([^\n]+)/m);
  if (m) return m[1].replace(/[*_`]/g, '').trim();
  // Second fallback — first non-empty line
  const line = (content.split('\n').find(l => l.trim()) || '').replace(/[*_`#]/g, '').trim();
  return line || `Tokenized Assets Daily — ${new Date().toISOString().slice(0, 10)}`;
}

function extractSummary(content) {
  // Take the first paragraph after the H1.
  const lines = content.split('\n');
  let started = false;
  const paragraph = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!started) {
      if (line.startsWith('#')) { started = true; continue; }
      continue;
    }
    if (line === '') {
      if (paragraph.length) break;
      continue;
    }
    if (line.startsWith('#')) break;
    paragraph.push(line);
  }
  return paragraph.join(' ').slice(0, 280).trim();
}

/**
 * Generate today's Tokenized Assets Daily Edition.
 * @param {object} [opts]
 * @param {boolean} [opts.force] - force regeneration even if today's article exists
 */
async function generateTokenizedAssetsDaily({ force = false } = {}) {
  if (!HAS_LLM_KEY) {
    console.warn('[ta-daily] no LLM provider key — skipping');
    return null;
  }

  const slug = todaySlug();

  // Daily uniqueness: if today's article exists, short-circuit.
  if (!force) {
    const existing = loadArticle('research', slug);
    if (existing) {
      return {
        slug,
        article: existing.content,
        lastUpdated: existing.updatedAt || existing.publishedAt,
        skipped: true,
      };
    }
  }

  const startTime = Date.now();
  logAgentActivity({
    agent: 'tokenized-assets-daily',
    action: 'started',
    target: slug,
    targetType: 'research',
    title: `Writing today's Tokenized Assets Daily Edition`,
  });

  try {
    const { context, sources } = await buildContext();
    const userPrompt = `Write today's Tokenized Assets Daily Edition using the DATA BLOCK below as your ONLY evidence base. Weave (1) today's RWA moves, (2) the day's tokenized-asset news, (3) the general crypto + macro context. Write the full editorial: H1 headline, lede, What Moved, The News Desk, The Macro Frame, What We're Watching.\n\n=== DATA BLOCK START ===\n${context}\n=== DATA BLOCK END ===`;

    const result = await callGroq(EDITORIAL_SYSTEM_PROMPT, userPrompt, { maxTokens: 2800, temperature: 0.35 });

    if (!result.ok || !result.content) {
      throw new Error(result.error || 'Groq returned no content');
    }

    const content = result.content.trim();
    const headline = extractHeadline(content);
    const summary = extractSummary(content);

    // Attribute data sources with the homepage of each provider so the
    // article footer renders them as clickable favicon pills.
    const SOURCE_URLS = {
      'DefiLlama RWA (api.llama.fi)': 'https://defillama.com/categories/rwa',
      'DefiLlama Stablecoins (stablecoins.llama.fi)': 'https://defillama.com/stablecoins',
      'CoinGecko Global (/api/v3/global)': 'https://www.coingecko.com/en/global-charts',
      'Binance 24h Ticker (api.binance.com)': 'https://www.binance.com/en/markets/overview',
      'Alternative.me Fear & Greed': 'https://alternative.me/crypto/fear-and-greed-index/',
      'Stooq (DXY)': 'https://stooq.com/q/?s=%5Edxy',
      'Stooq (10Y Treasury)': 'https://stooq.com/q/?s=%5Etnx',
      'Stooq (VIX)': 'https://stooq.com/q/?s=%5Evix',
    };
    const sourcesCited = (sources || []).map(name => ({
      name,
      url: SOURCE_URLS[name] || '',
      type: 'data',
    }));

    const article = saveArticle({
      slug,
      type: 'research',
      title: `${headline} | Spectre AI Daily Edition`,
      headline,
      summary,
      content,
      tags: ['tokenized-assets', 'rwa', 'daily-edition', 'spectre-ai'],
      categories: ['rwa', 'research'],
      category: 'rwa',
      sourcesCited,
      model: result.model || GROQ_MODEL,
      generationTimeMs: Date.now() - startTime,
      isFeatured: true,
    });

    logAgentActivity({
      agent: 'tokenized-assets-daily',
      action: 'completed',
      target: slug,
      targetType: 'research',
      title: `Tokenized Assets Daily published (${content.split(/\s+/).length} words)`,
      generationTimeMs: Date.now() - startTime,
      slug,
    });

    console.log(`[ta-daily] Published ${slug} in ${Date.now() - startTime}ms`);
    return {
      slug,
      article: article.content,
      lastUpdated: article.updatedAt,
      skipped: false,
    };
  } catch (e) {
    logAgentActivity({
      agent: 'tokenized-assets-daily',
      action: 'failed',
      target: slug,
      targetType: 'research',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error('[ta-daily] Failed:', e.message);
    return null;
  }
}

module.exports = {
  generateTokenizedAssetsDaily,
  runTokenizedAssetsDaily: generateTokenizedAssetsDaily,
};
