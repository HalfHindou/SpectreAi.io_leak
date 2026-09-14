/**
 * Spectre Intelligence Hub — Stock Market Analysis Agent
 *
 * The equities counterpart to marketAnalysisAgent.js. Generates the AI Market
 * Analysis brief rendered by the Command Center "AI Market" tab when the user
 * is in STOCKS mode. Before this agent existed, stocks fell back to a static
 * client-side template (computeStockMacro) that never read the news — so the
 * panel always said generic boilerplate regardless of what actually moved the
 * tape. This agent pulls LIVE index/VIX/mega-cap data AND the day's market
 * headlines from our own Express server, then asks Groq to write a real
 * 3-part brief that names the actual catalyst.
 *
 * Output cache: content/market-analysis/stocks-{timeframe}.json  (15m TTL)
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { logAgentActivity } = require('./activityLog');
const { chat: gatewayChat } = require('../lib/llm-gateway');

const STALE_MS = 15 * 60 * 1000; // 15 minutes
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 35000;
// Gateway-aware: the cron should still run when only a FREE provider key
// (Cerebras/Gemini/OpenRouter) is set, not just when GROQ_API_KEY is present.
const HAS_LLM_KEY = (() => {
  try { return require('../lib/llm-gateway').providerStatus().some(p => p.hasKey); }
  catch { return Boolean(process.env.GROQ_API_KEY); }
})();

// Delegates to the resilient multi-provider LLM gateway (groq → cerebras →
// gemini → openrouter → openai → anthropic → ollama, circuit-broken) instead of
// calling Groq directly, so the brief survives a single-provider outage.
// Return shape preserved: { ok, content, ... } | { ok:false, content:'', error }.
async function callGroq(systemPrompt, userMessage, { maxTokens = 1600, temperature = 0.35 } = {}) {
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
    ? { ok: true, content: r.text, provider: r.provider }
    : { ok: false, content: '', error: r.error };
}

const CACHE_DIR = path.join(__dirname, '..', 'content', 'market-analysis');
const VALID_TIMEFRAMES = ['1h', '24h', '7d'];

const TIMEFRAME_META = {
  '1h':  { window: 'intraday (last hour)',  horizon: 'next few hours' },
  '24h': { window: 'the latest session',    horizon: 'next trading session' },
  '7d':  { window: 'the last week',          horizon: 'coming week' },
};

// Cache files are namespaced with a `stocks-` prefix so they never collide with
// the crypto agent's {timeframe}.json files in the same directory.
function cachePath(timeframe) {
  return path.join(CACHE_DIR, `stocks-${timeframe}.json`);
}

function loadCache(timeframe) {
  try {
    const p = cachePath(timeframe);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function saveCache(timeframe, data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(timeframe), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[StockMarketAnalysis] Failed to save cache:', e.message);
  }
}

// ── IN-PROCESS DATA FETCH (localhost HTTP to our own Express) ───────────────
const PORT = process.env.PORT || 3001;
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;
// Mega-caps that drive the index. Kept short so the prompt stays dense.
const MEGACAP_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'];

async function fetchJson(url, timeoutMs = 6000) {
  try {
    const res = await fetch(url, { timeout: timeoutMs });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

function fmtPct(n, digits = 2) {
  if (n == null || !isFinite(n)) return 'n/a';
  const v = Number(n);
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

/**
 * Gather all live equities inputs from our own server in parallel.
 * Returns a structured snapshot the prompt builder can consume.
 */
async function gatherLiveSnapshot() {
  const [indicesRaw, quotesRaw, newsRaw, breakingRaw, tickersRaw, fgRaw] = await Promise.all([
    fetchJson(`${LOCAL_BASE}/api/stocks/indices`),
    fetchJson(`${LOCAL_BASE}/api/stocks/quotes?symbols=${MEGACAP_SYMBOLS.join(',')}`),
    fetchJson(`${LOCAL_BASE}/api/stocks/news/market`),
    // Same breaking feed that powers the panel's CONTEXT bullets — the brief
    // must cite the catalyst the user is already seeing, not generic mock news.
    fetchJson(`${LOCAL_BASE}/api/intelligence/breaking`),
    // Cross-asset: the crypto tape. Stocks AND crypto selling off together is a
    // shared risk-on/off regime — give the model the crypto context so it can
    // place the equity move inside the broader speculative complex.
    fetchJson(`${LOCAL_BASE}/api/market/tickers`),
    fetchJson(`${LOCAL_BASE}/api/fear-greed/current`),
  ]);

  // /api/stocks/indices returns an array of { symbol, name, price, change, ... }
  const idxByName = {};
  if (Array.isArray(indicesRaw)) {
    for (const row of indicesRaw) {
      const key = (row?.name || row?.symbol || '').toLowerCase();
      idxByName[key] = row;
    }
  }
  const pick = (...names) => {
    for (const n of names) {
      const hit = idxByName[n.toLowerCase()];
      if (hit) return hit;
    }
    return null;
  };
  const sp = pick('s&p 500', '^gspc');
  const dow = pick('dow jones', '^dji');
  const nasdaq = pick('nasdaq', '^ixic');
  const russell = pick('russell 2000', '^rut');
  const vix = pick('vix', '^vix');

  const megacaps = {};
  if (quotesRaw && typeof quotesRaw === 'object') {
    for (const sym of MEGACAP_SYMBOLS) {
      const q = quotesRaw[sym];
      if (q && q.price != null) megacaps[sym] = { price: q.price, change: q.change };
    }
  }

  // Top headlines = the catalyst surface. Prefer the Spectre breaking feed
  // (same source as the panel's CONTEXT bullets) so the brief leads with the
  // catalyst the user is seeing; supplement with the market-news feed. Dedupe.
  const breakingArts = breakingRaw?.articles || breakingRaw?.items || (Array.isArray(breakingRaw) ? breakingRaw : []);
  const rawHeads = [
    ...(Array.isArray(breakingArts) ? breakingArts : []),
    ...(Array.isArray(newsRaw) ? newsRaw : []),
  ];
  const seen = new Set();
  const headlines = [];
  for (const n of rawHeads) {
    const title = (n?.headline || n?.title || '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    headlines.push({ title, source: n?.source?.name || n?.source || '', time: n?.published_at || n?.publishedAt || '' });
    if (headlines.length >= 8) break;
  }

  // Cross-asset crypto context. /api/market/tickers -> { majorCoins: { btc, eth } }.
  const majors = tickersRaw?.majorCoins || {};
  const btcT = majors.btc || null;
  const ethT = majors.eth || null;
  let crypto = null;
  if (btcT || ethT || fgRaw) {
    crypto = {
      btc: btcT ? { change: btcT.change } : null,
      eth: ethT ? { change: ethT.change } : null,
      fearGreed: fgRaw && fgRaw.value != null ? { value: fgRaw.value, classification: fgRaw.classification } : null,
    };
  }

  return {
    indices: {
      sp500: sp ? { price: sp.price, change: sp.change } : null,
      dow: dow ? { price: dow.price, change: dow.change } : null,
      nasdaq: nasdaq ? { price: nasdaq.price, change: nasdaq.change } : null,
      russell: russell ? { price: russell.price, change: russell.change } : null,
    },
    vix: vix ? { price: vix.price, change: vix.change } : null,
    megacaps,
    headlines,
    crypto,
  };
}

// ── PROMPT BUILDERS ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Spectre AI's lead equities strategist. The voice is a senior macro/equity trader briefing a peer at a multi-strategy fund. Sharp, opinionated, data-first. No retail hand-holding. No marketing. Write as "we" (Spectre AI).

You will be given LIVE index levels, the VIX, mega-cap moves, and the day's REAL market headlines. You MUST NOT contradict the numbers. Anchor every claim to a number or a headline actually in the data. If a value is "n/a", say so or skip it, never fabricate.

CAUSALITY DISCIPLINE (this is the most important rule):
- Only explain the move with a catalyst that is actually in the HEADLINES provided, or with the index/VIX/mega-cap numbers themselves. If the headlines don't clearly explain the tape, say the move looks like positioning or rotation and read the price action. NEVER invent a reason.
- Match the magnitude. A 0.3% index move is normal session noise, not a crash or a "plunge". Do not dramatize a small move, and do not attribute a small move to a huge unrelated event.
- A giant private company (SpaceX, OpenAI, Stripe) CAN move the tape, but only through a REAL, NAMED channel — a publicly-traded proxy (Tesla for anything Musk/SpaceX, a Starlink IPO, SpaceX-exposed funds like Destiny Tech100/DXYZ or ARK), the relevant SECTOR (space, defense, satellites, semis), or named suppliers. If a headline names such a company, connect it through that channel and say so. What you must NOT do: claim it moved an INDEX directly (it is not an index member), or invent the size of the effect. Don't ignore it, and don't overstate it.
- NEVER state that any event "erased", "wiped", or "added" a specific share or dollar amount of an index's or company's market cap unless that exact figure is in the data.
- NEVER attribute a claim to a named outlet (CNBC, Bloomberg, Reuters, CoinDesk) unless that outlet appears in the HEADLINES list.

WHAT MAKES AN ANSWER GOOD:
- Each section must say something a smart reader does not already see on the dashboard. We can see the S&P is down 0.3%. Tell us what is driving it (from the headlines), what it confirms or breaks, and the next decision point.
- Connect numbers to mechanics. "VIX at 20 with the Nasdaq leading the downside" means the selling is concentrated in growth/tech, not broad panic. Spell out that kind of read.
- Have an opinion. "Disciplined traders watch the prior session low on the S&P" is fine. "It remains to be seen" is not.

FORMAT: exactly three sections, literal headers, prose only (no bullets, no tables, no subheads).

ANALYSIS
<3-4 sentences. SENTENCE 1 MUST answer WHY, in plain language a non-expert understands: what moved and its cause from the headlines, e.g. "Stocks are down because a chip-sector rout, Micron-led, is dragging the whole tech complex." NOT "the market is exhibiting a neutral bias." If no headline explains the move, say so plainly ("no single obvious catalyst — this looks like positioning"). Then cite the S&P / Nasdaq / Dow percent moves and end with the regime read: risk-off rotation, tech-led pullback, broad grind, melt-up, etc.>

MACRO CONDITIONS
<3-4 sentences. The drivers: which headlines matter (Fed, CPI/jobs, earnings, rates, a sector story), the VIX read (complacent <15, moderate 15-20, elevated 20-30, fear >30), and breadth (is it mega-cap-led or broad). Name the imbalance honestly. If the headlines are thin, say so and lean on the VIX + breadth read. CROSS-ASSET: if the crypto line is present and crypto is moving the SAME direction as equities, say so — that is one broad risk-on/off regime across the whole speculative complex (equities, crypto, and richly-valued private names all reprice together). Crypto is the highest-beta member, so it moves more (a 0.4% S&P day can be a 4% BTC day). If they are DECOUPLING (equities red, crypto green or vice versa), that divergence is the signal — call it out.>

POSITIONING
<3-4 sentences. What a disciplined trader does over the stated horizon. Specific levels or triggers where possible: which index level to defend, the catalyst window (next CPI / jobs print / FOMC / earnings), sector tilt. At least one concrete "if X then Y" structure. No "this is not financial advice" cope.>

NON-NEGOTIABLES:
- NEVER invent numbers, catalysts, or sources. If there is no clear catalyst, say the move is positioning/rotation.
- No em-dashes. Use commas, colons, or split sentences.
- No citation markers like [1][2] in prose.
- Banned phrases: "delve into", "landscape", "robust", "leverage" (as verb), "seamlessly", "deep dive", "navigate", "remains to be seen", "in conclusion", "it is worth noting", "as we move forward", "a testament to", "double-edged sword", "only time will tell", "cautiously optimistic".
- Length: 280-450 words total. Density beats brevity. Earn every line.`;

function buildUserPrompt(timeframe, snapshot) {
  const meta = TIMEFRAME_META[timeframe] || TIMEFRAME_META['24h'];
  const idx = snapshot.indices || {};
  const vix = snapshot.vix || null;
  const mc = snapshot.megacaps || {};
  const heads = snapshot.headlines || [];

  const lines = [];
  lines.push(`Write a 3-part Spectre AI equities brief targeting ${meta.window}. Horizon for the Positioning section: ${meta.horizon}.`);
  lines.push('');
  lines.push('LIVE MARKET DATA (these are the ONLY numbers you may cite — do not contradict them):');
  lines.push('');
  lines.push('Indices (change is for the current session):');
  lines.push(`  S&P 500: ${idx.sp500 ? `${idx.sp500.price?.toLocaleString?.() ?? idx.sp500.price}, ${fmtPct(idx.sp500.change)}` : 'n/a'}`);
  lines.push(`  Nasdaq: ${idx.nasdaq ? `${idx.nasdaq.price?.toLocaleString?.() ?? idx.nasdaq.price}, ${fmtPct(idx.nasdaq.change)}` : 'n/a'}`);
  lines.push(`  Dow Jones: ${idx.dow ? `${idx.dow.price?.toLocaleString?.() ?? idx.dow.price}, ${fmtPct(idx.dow.change)}` : 'n/a'}`);
  lines.push(`  Russell 2000: ${idx.russell ? `${idx.russell.price?.toLocaleString?.() ?? idx.russell.price}, ${fmtPct(idx.russell.change)}` : 'n/a'}`);
  lines.push(`  VIX: ${vix ? `${vix.price?.toFixed?.(2) ?? vix.price} (${fmtPct(vix.change)})` : 'n/a'}`);
  lines.push('');
  lines.push('Mega-caps (session change):');
  const mcLines = Object.entries(mc).map(([sym, q]) => `  ${sym}: $${q.price?.toLocaleString?.() ?? q.price}, ${fmtPct(q.change)}`);
  lines.push(mcLines.length ? mcLines.join('\n') : '  n/a');
  lines.push('');

  // ── CROSS-ASSET: the crypto tape ──
  const cr = snapshot.crypto;
  if (cr) {
    lines.push('CROSS-ASSET (crypto, latest — use to frame the broader risk regime, not as equity data):');
    lines.push(`  BTC: ${cr.btc ? fmtPct(cr.btc.change) : 'n/a'}, ETH: ${cr.eth ? fmtPct(cr.eth.change) : 'n/a'}, Crypto Fear & Greed: ${cr.fearGreed ? `${cr.fearGreed.value} (${cr.fearGreed.classification || 'n/a'})` : 'n/a'}`);
    lines.push('');
  }

  lines.push('TODAY\'S MARKET HEADLINES (the ONLY catalysts you may cite — if none explain the move, say so, do not invent one):');
  if (heads.length) {
    for (const h of heads) {
      lines.push(`  - ${h.title}${h.source ? ` (${h.source})` : ''}`);
    }
  } else {
    lines.push('  (no headlines available — read the tape from the index/VIX/breadth numbers, do not fabricate a catalyst)');
  }
  lines.push('');

  // ── INTERPRETIVE PRIMERS ──
  const spCh = idx.sp500?.change;
  const ndqCh = idx.nasdaq?.change;
  const vixVal = vix?.price;
  const inferredBias = spCh == null ? null : spCh < -0.25 ? 'down' : spCh > 0.25 ? 'up' : 'flat';
  const vixRegime = vixVal == null ? null
    : vixVal < 15 ? 'complacent'
    : vixVal < 20 ? 'moderate'
    : vixVal < 30 ? 'elevated' : 'fear';
  const breadth = (spCh != null && ndqCh != null)
    ? (Math.abs(ndqCh) > Math.abs(spCh) * 1.25 ? 'tech/growth-led' : 'broad')
    : null;

  lines.push('REGIME CUES (analytical scaffolding, weave into prose, do not list them):');
  if (inferredBias) lines.push(`  - Tape bias: ${inferredBias}`);
  if (vixRegime) lines.push(`  - VIX regime: ${vixRegime}`);
  if (breadth) lines.push(`  - Move concentration: ${breadth}`);
  lines.push('');
  lines.push('ANALYTICAL FRAMES YOU MAY USE:');
  lines.push('  - "Nasdaq down more than the S&P with VIX moderate" -> tech-led pullback, not broad panic; rotation not capitulation.');
  lines.push('  - "Broad red with VIX spiking above 25" -> genuine risk-off, defensives outperform, reduce gross.');
  lines.push('  - "Small move, VIX <15, no clear headline" -> low-conviction grind, selectivity over index bets.');
  lines.push('  - "Indices up with VIX falling" -> orderly risk-on, trend continuation until a catalyst hits.');
  lines.push('');
  lines.push('Pick the frame that matches the live cues. Apply it. Name the setup. Then give the trigger that confirms or invalidates it.');
  lines.push('');
  lines.push(`Remember: window is "${meta.window}". Do not describe the tape as green when the S&P number above is negative, and vice versa. Lead with the real catalyst from the headlines if one exists.`);

  return lines.join('\n');
}

// ── RESPONSE PARSER (identical header contract to the crypto agent) ──────────

function parseSections(content) {
  if (!content) return { analysis: '', macroConditions: '', positioning: '' };
  const text = String(content).trim();
  const parts = text.split(/\n\s*(?=(?:ANALYSIS|MACRO CONDITIONS|POSITIONING)\b)/i);
  const out = { analysis: '', macroConditions: '', positioning: '' };
  for (const chunk of parts) {
    const clean = chunk.replace(/^[#*\s]+/, '').trim();
    if (/^ANALYSIS\b/i.test(clean)) {
      out.analysis = clean.replace(/^ANALYSIS\b\s*[:\-]?\s*/i, '').trim();
    } else if (/^MACRO CONDITIONS\b/i.test(clean)) {
      out.macroConditions = clean.replace(/^MACRO CONDITIONS\b\s*[:\-]?\s*/i, '').trim();
    } else if (/^POSITIONING\b/i.test(clean)) {
      out.positioning = clean.replace(/^POSITIONING\b\s*[:\-]?\s*/i, '').trim();
    } else if (!out.analysis) {
      out.analysis = clean;
    }
  }
  return out;
}

// ── MAIN ENTRY ──────────────────────────────────────────────────────────────

/**
 * Generate stock-market analysis for a timeframe.
 * @param {object} opts
 * @param {'1h'|'24h'|'7d'} [opts.timeframe]
 * @param {boolean} [opts.force] - bypass cache
 * @returns {Promise<{analysis, macroConditions, positioning, sources, timeframe, market, lastUpdated} | null>}
 */
async function generateStockMarketAnalysis({ timeframe = '24h', force = false } = {}) {
  if (!VALID_TIMEFRAMES.includes(timeframe)) timeframe = '24h';

  if (!HAS_LLM_KEY) {
    console.warn('[StockMarketAnalysis] No GROQ_API_KEY — skipping generation (no-op)');
    return null;
  }

  if (!force) {
    const cached = loadCache(timeframe);
    if (cached && cached.generatedAt) {
      const ageMs = Date.now() - new Date(cached.generatedAt).getTime();
      if (ageMs < STALE_MS && cached.data) return cached.data;
    }
  }

  const startTime = Date.now();

  try {
    const snapshot = await gatherLiveSnapshot();
    const userPrompt = buildUserPrompt(timeframe, snapshot);
    const gateResult = await callGroq(SYSTEM_PROMPT, userPrompt, { maxTokens: 1600, temperature: 0.35 });

    if (!gateResult.ok || !gateResult.content) {
      throw new Error(gateResult.error || 'Groq returned no content');
    }

    const sections = parseSections(gateResult.content);
    if (!sections.analysis && !sections.macroConditions && !sections.positioning) {
      throw new Error('Parser returned no sections');
    }

    const data = {
      analysis: sections.analysis,
      macroConditions: sections.macroConditions,
      positioning: sections.positioning,
      sources: snapshot.headlines.map((h) => ({ title: h.title, source: h.source })).slice(0, 6),
      timeframe,
      market: 'stocks',
      lastUpdated: new Date().toISOString(),
    };

    saveCache(timeframe, { data, generatedAt: data.lastUpdated });

    const spCh = snapshot?.indices?.sp500?.change;
    const vixVal = snapshot?.vix?.price;
    const elapsedS = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[StockMarketAnalysis] ${timeframe} regenerated (${elapsedS}s) — S&P ${fmtPct(spCh)}, VIX ${vixVal ?? 'n/a'}, ${snapshot.headlines.length} headlines`);

    try {
      logAgentActivity({
        agent: 'stock-market-analysis',
        action: 'completed',
        target: timeframe,
        targetType: 'market-analysis',
        title: `Stock market analysis ${timeframe} regenerated`,
        generationTimeMs: Date.now() - startTime,
        sourceCount: data.sources.length,
      });
    } catch (_) { /* non-fatal */ }

    return data;
  } catch (err) {
    console.error(`[StockMarketAnalysis] ${timeframe} generation failed:`, err.message);
    const cached = loadCache(timeframe);
    if (cached?.data) return cached.data;
    return null;
  }
}

/**
 * Scheduler entry — regenerates all three timeframes back-to-back.
 */
async function runStockMarketAnalysisCycle() {
  if (!HAS_LLM_KEY) {
    console.log('[StockMarketAnalysis] Skipping cycle — no LLM API key configured');
    return null;
  }
  const results = {};
  for (const tf of VALID_TIMEFRAMES) {
    try {
      results[tf] = await generateStockMarketAnalysis({ timeframe: tf, force: true });
    } catch (e) {
      console.error(`[StockMarketAnalysis] cycle error for ${tf}:`, e.message);
      results[tf] = null;
    }
  }
  return results;
}

module.exports = {
  generateStockMarketAnalysis,
  runStockMarketAnalysisCycle,
  VALID_TIMEFRAMES,
};
