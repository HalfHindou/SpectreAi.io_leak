/**
 * Spectre Intelligence Hub — Calendar Analysis Agent
 * Generates real-time market analysis for the Economic Calendar page.
 * Produces 3 outputs: Market Outlook, Dominant Themes, Market Regime Verdict.
 * Uses Perplexity sonar-pro with data context from existing endpoints.
 * Runs on 4-hour cycle with breaking news triggers.
 */
const fetch = require('node-fetch');
const { saveArticle, loadArticle, listArticles } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const { gatedPerplexitySearch } = require('./perplexityGate');
const { recordRun, canRunAgain } = require('./agentState');

const SERVER_BASE = `http://localhost:${process.env.PORT || 3001}`;
const AGENT_NAME = 'calendar-analysis';

// 30-min cooldown between breaking updates
let lastBreakingUpdate = 0;
const BREAKING_COOLDOWN_MS = 30 * 60 * 1000;

// ── SYSTEM PROMPTS ──────────────────────────────────────────────────────────

const OUTLOOK_SYSTEM_PROMPT = `You are Spectre AI's senior macro analyst writing the economic calendar market outlook. Write as "we" (Spectre AI). Hedge fund tone, data-driven, opinionated. NOT a blog post.

You will be given current market data and upcoming economic events. Produce a JSON object (no markdown fences) with these exact keys:

{
  "nextKeyEvent": {
    "name": "Event Name",
    "dateTime": "ISO 8601 date string",
    "whyItMatters": "2-3 sentences explaining why this event matters for crypto and stocks"
  },
  "expectations": "2-3 sentences on consensus expectations and what numbers to watch",
  "fedContext": "2-3 sentences on current Fed stance, rate expectations, key officials",
  "bullCase": "2-3 sentences on the bullish scenario for crypto given the upcoming data",
  "bearCase": "2-3 sentences on the bearish scenario for crypto given the upcoming data",
  "weekAhead": "2-3 sentences summarizing the key events this week",
  "riskLevel": "low|moderate|elevated|high|extreme"
}

Rules:
- Include specific numbers, prices, and percentages
- Reference today's actual date
- Be honest about market conditions
- Focus on the NEXT major economic event coming up (Fed, CPI, GDP, jobs, PCE)
- riskLevel should reflect actual market conditions (VIX level, event proximity)

CURRENT FED REGIME (anchor fedContext to this — refresh after each FOMC; verify live before quoting):
- Chair: Kevin Warsh (first meeting June 2026; Powell's term ended May 2026). Do NOT attribute current guidance to Powell.
- Posture: explicitly data-dependent and "talk less" — shorter statements, far less forward guidance, the dot plot/SEP de-emphasized (Warsh withheld his own dot in June). Treat incoming inflation and labor prints, not Fed signaling, as the dominant driver of rate-cut odds.
- Rates: held at 3.50-3.75% in June 2026 with a hawkish lean (one hike penciled for 2026); 2026 inflation outlook raised to ~3.6% headline / ~3.3% core.
- Schedule: NEVER quote a meeting date from this block. The authoritative dates arrive in the SCHEDULED EVENTS list in the user message; use those and nothing else. (For background only, the 2026 cadence runs roughly late-Jul, mid-Sep, late-Oct, early-Dec.)

CONTENT LAW (non-negotiable):
- NO em-dashes. Use commas or colons instead
- No [1][2][3] citation markers
- Banned phrases: "delve into", "it's worth noting", "navigate", "landscape", "cutting-edge", "robust", "leverage" (verb), "seamlessly", "groundbreaking", "ever-evolving", "a testament to", "double-edged sword", "remains to be seen", "pivotal", "realm"
- Every sentence earns its place`;

const THEMES_SYSTEM_PROMPT = `You are Spectre AI's macro strategist identifying the dominant market narratives. Write as "we" (Spectre AI). Hedge fund tone.

You will be given current market data. Produce a JSON array (no markdown fences) with 2-3 theme objects. Each theme:

[
  {
    "id": "kebab-case-id",
    "headline": "Short punchy headline (max 60 chars)",
    "body": "3-5 sentences with specific data points. Include price levels, percentage moves, dates.",
    "catalysts": ["Catalyst 1 this week", "Catalyst 2", "Catalyst 3"],
    "affectedTickers": [
      {"symbol": "SPX", "assetClass": "equity"},
      {"symbol": "BTC", "assetClass": "crypto"}
    ],
    "relatedEventIds": [],
    "type": "major|focus",
    "publishedAt": "ISO 8601 now"
  }
]

Guidelines:
- First 2 themes should be "major" (the biggest narratives right now)
- Last theme should be "focus" (a secondary developing story)
- Cover BOTH crypto and traditional markets
- Reference real events happening this week
- Include at least one crypto-specific narrative (ETF flows, on-chain, regulation)
- affectedTickers must include a mix of equity, crypto, forex, bond, commodity

CONTENT LAW:
- NO em-dashes. Use commas or colons instead
- No citation markers
- Same banned phrases as above
- Specific numbers always`;

const EVENT_BRIEF_PROMPT = `You are Spectre AI's event analyst. An economic event just released results. Write a single breaking-news-style sentence (max 2 sentences) explaining what the result means for markets and crypto.

Given event data, produce a JSON object (no markdown fences):
{
  "brief": "1-2 sentences explaining the result and its market impact",
  "sentiment": "bullish|bearish|neutral",
  "significance": "high|medium|low"
}

Rules:
- Include the actual number and whether it beat/missed expectations
- Mention immediate market implications for crypto specifically
- Be direct and opinionated, hedge fund tone
- NO em-dashes
- No citation markers [1][2][3]
- Banned phrases: "delve into", "it's worth noting", "navigate", "landscape", "cutting-edge", "robust", "leverage" (verb), "seamlessly", "groundbreaking", "ever-evolving", "a testament to", "double-edged sword", "remains to be seen", "pivotal", "realm"`;

const VERDICT_SYSTEM_PROMPT = `You are Spectre AI's chief strategist delivering the weekly market regime verdict. One to two sentences maximum. Hedge fund CIO tone.

Given current market data, produce a JSON object (no markdown fences):

{
  "verdict": "1-2 sentences. Direct, opinionated market call. Reference specific levels, VIX, dollar, crypto positioning.",
  "sentiment": "bullish|cautious|bearish"
}

Rules:
- Must mention at least one specific price level or number
- Be directional, not wishy-washy
- NO em-dashes
- No banned AI phrases`;

// ── UPCOMING EVENTS (deterministic) ─────────────────────────────────────────
// 🪤🪤 This agent used to pass NO calendar events at all — buildDataSummary just
// told the model to "research the latest economic calendar events", so the whole
// event picture came out of training data. On 2026-07-29, an actual FOMC day,
// that produced three confident falsehoods at once: nextKeyEvent dated to
// YESTERDAY, themes claiming the decision was "expected to be announced on July
// 31", and the verdict naming a Fed press release about bank-examination
// procedures as the next major event.
//
// A scheduled event's name and time are DATA. Fetch them, hand them over, and
// overwrite whatever the model says about them.
const CAL_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const CAL_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';

async function fetchUpcomingEvents() {
  try {
    const r = await fetch(`${CAL_BASE}/v1/calendar?upcoming=true&limit=200`, {
      headers: CAL_KEY ? { 'x-api-key': CAL_KEY } : {},
      timeout: 12000,
    });
    if (!r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    const now = Date.now();
    return rows
      .map((e) => ({
        name: String(e.title || e.event_name || e.name || '').trim(),
        at: Date.parse(e.date || e.event_date || e.dateTime || ''),
        impact: String(e.impact_level || e.impact || '').toLowerCase(),
        country: e.country || null,
        forecast: e.forecast_value ?? e.forecast ?? null,
        previous: e.previous_value ?? e.previous ?? null,
        actual: e.actual_value ?? e.actual ?? null,
      }))
      // a real release carries a time of day; the midnight rows are day markers
      // (the duplicate-row class that mis-fired the FOMC print this morning)
      .filter((e) => e.name && Number.isFinite(e.at) && e.at > now && new Date(e.at).getUTCHours() !== 0)
      .filter((e) => e.impact === 'critical' || e.impact === 'high')
      .sort((a, b) => a.at - b.at)
      .slice(0, 12);
  } catch (_) {
    return [];
  }
}

// ── DATA CONTEXT FETCHER ────────────────────────────────────────────────────

async function fetchCalendarContext() {
  const context = {};

  const [btcRes, ethRes, solRes, fgRes, stocksRes, statusRes] = await Promise.allSettled([
    fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT').then(r => r.json()),
    fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT').then(r => r.json()),
    fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT').then(r => r.json()),
    fetch('https://api.alternative.me/fng/').then(r => r.json()),
    fetch(`${SERVER_BASE}/api/stocks/quotes?symbols=SPY,GLD`).then(r => r.json()),
    fetch(`${SERVER_BASE}/api/stocks/market-status`).then(r => r.json()),
  ]);

  if (btcRes.status === 'fulfilled' && btcRes.value) {
    context.btcPrice = parseFloat(btcRes.value.lastPrice);
    context.btcChange = parseFloat(btcRes.value.priceChangePercent);
  }
  if (ethRes.status === 'fulfilled' && ethRes.value) {
    context.ethPrice = parseFloat(ethRes.value.lastPrice);
    context.ethChange = parseFloat(ethRes.value.priceChangePercent);
  }
  if (solRes.status === 'fulfilled' && solRes.value) {
    context.solPrice = parseFloat(solRes.value.lastPrice);
    context.solChange = parseFloat(solRes.value.priceChangePercent);
  }
  if (fgRes.status === 'fulfilled' && fgRes.value?.data?.[0]) {
    const fg = fgRes.value.data[0];
    context.fearGreed = `${fg.value} (${fg.value_classification})`;
  }
  if (stocksRes.status === 'fulfilled' && stocksRes.value) {
    const spy = stocksRes.value.SPY;
    const gld = stocksRes.value.GLD;
    if (spy) context.spy = `$${spy.price?.toFixed(2)} (${spy.change > 0 ? '+' : ''}${spy.change?.toFixed(1)}%)`;
    if (gld) context.gold = `$${gld.price?.toFixed(2)} (${gld.change > 0 ? '+' : ''}${gld.change?.toFixed(1)}%)`;
  }
  if (statusRes.status === 'fulfilled' && statusRes.value) {
    const s = statusRes.value;
    if (s.vix) context.vix = s.vix.value;
    context.marketStatus = s.status;
  }

  context.upcomingEvents = await fetchUpcomingEvents();

  return context;
}

function buildDataSummary(context) {
  const today = new Date().toISOString().split('T')[0];
  let summary = `Date: ${today}\n\nCurrent market data:\n`;

  if (context.btcPrice) summary += `- BTC: $${Number(context.btcPrice).toLocaleString()} (${context.btcChange > 0 ? '+' : ''}${context.btcChange?.toFixed(1)}% 24h)\n`;
  if (context.ethPrice) summary += `- ETH: $${Number(context.ethPrice).toLocaleString()} (${context.ethChange > 0 ? '+' : ''}${context.ethChange?.toFixed(1)}%)\n`;
  if (context.solPrice) summary += `- SOL: $${Number(context.solPrice).toLocaleString()} (${context.solChange > 0 ? '+' : ''}${context.solChange?.toFixed(1)}%)\n`;
  if (context.fearGreed) summary += `- Fear & Greed Index: ${context.fearGreed}\n`;
  if (context.spy) summary += `- SPY: ${context.spy}\n`;
  if (context.gold) summary += `- Gold (GLD): ${context.gold}\n`;
  if (context.vix) summary += `- VIX: ${context.vix}\n`;
  if (context.marketStatus) summary += `- Market status: ${context.marketStatus}\n`;

  const ev = Array.isArray(context.upcomingEvents) ? context.upcomingEvents : [];
  if (ev.length) {
    summary += `\nSCHEDULED EVENTS (authoritative, already published to our calendar — these are the ONLY events you may cite, and you must use these exact times):\n`;
    for (const e of ev) {
      const parts = [`- ${new Date(e.at).toISOString()} | ${e.country || 'US'} | ${e.impact} | ${e.name}`];
      if (e.forecast != null) parts.push(`forecast ${e.forecast}`);
      if (e.previous != null) parts.push(`previous ${e.previous}`);
      if (e.actual != null) parts.push(`ACTUAL ${e.actual}`);
      summary += parts.join(' · ') + '\n';
    }
    summary += `\nThe NEXT key event is the first line above. Do not name any other event as next, and do not state a date for it other than the one given. An event with no ACTUAL has not happened yet — never describe its outcome.\n`;
  } else {
    summary += `\nNo scheduled high-impact events are available right now. Say the calendar is quiet rather than recalling events from memory.\n`;
  }
  return summary;
}

// ── JSON PARSER (handles markdown fences) ───────────────────────────────────

function parseJSON(raw) {
  if (!raw) return null;
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[calendar-analysis] JSON parse failed:', e.message, '\nRaw:', cleaned.slice(0, 200));
    return null;
  }
}

// ── GENERATION FUNCTIONS ────────────────────────────────────────────────────

async function generateOutlook(context) {
  const userPrompt = buildDataSummary(context) + '\n\nGenerate the Market Outlook JSON object.';

  const result = await gatedPerplexitySearch({
    query: userPrompt,
    systemPrompt: OUTLOOK_SYSTEM_PROMPT,
    maxTokens: 2000,
    model: 'sonar-pro',
    agentId: AGENT_NAME,
    timeout: 45000,
    searchContextSize: 'high',
    skipResolution: true,
  });

  if (!result || result.type === 'ERROR') {
    throw new Error(result?.error || 'Outlook generation failed');
  }

  const parsed = parseJSON(result.content);
  if (!parsed || !parsed.nextKeyEvent) {
    throw new Error('Invalid outlook JSON structure');
  }

  // The model may still drift on the name or the date even when handed the
  // list, so the two facts we actually know are OVERWRITTEN, not trusted. Only
  // whyItMatters stays model-authored. This is the difference between an
  // opinion about an event and a claim about when it happens.
  const nextEv = (context.upcomingEvents || [])[0];
  if (nextEv) {
    parsed.nextKeyEvent = {
      ...parsed.nextKeyEvent,
      name: nextEv.name,
      dateTime: new Date(nextEv.at).toISOString(),
    };
  }

  return { data: parsed, model: result.model, citations: result.citations || [] };
}

async function generateThemes(context) {
  const userPrompt = buildDataSummary(context) + '\n\nGenerate the Dominant Themes JSON array (2-3 themes).';

  const result = await gatedPerplexitySearch({
    query: userPrompt,
    systemPrompt: THEMES_SYSTEM_PROMPT,
    maxTokens: 3000,
    model: 'sonar-pro',
    agentId: AGENT_NAME,
    timeout: 45000,
    searchContextSize: 'high',
    skipResolution: true,
  });

  if (!result || result.type === 'ERROR') {
    throw new Error(result?.error || 'Themes generation failed');
  }

  const parsed = parseJSON(result.content);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Invalid themes JSON structure');
  }

  // Ensure timestamps
  const now = new Date().toISOString();
  parsed.forEach(theme => {
    if (!theme.publishedAt) theme.publishedAt = now;
    if (!theme.updatedAt) theme.updatedAt = now;
  });

  return { data: parsed, model: result.model, citations: result.citations || [] };
}

async function generateVerdict(context) {
  const userPrompt = buildDataSummary(context) + '\n\nGenerate the Market Regime Verdict JSON object.';

  const result = await gatedPerplexitySearch({
    query: userPrompt,
    systemPrompt: VERDICT_SYSTEM_PROMPT,
    maxTokens: 500,
    model: 'sonar-pro',
    agentId: AGENT_NAME,
    timeout: 30000,
    searchContextSize: 'high',
    skipResolution: true,
  });

  if (!result || result.type === 'ERROR') {
    throw new Error(result?.error || 'Verdict generation failed');
  }

  const parsed = parseJSON(result.content);
  if (!parsed || !parsed.verdict) {
    throw new Error('Invalid verdict JSON structure');
  }

  return { data: parsed, model: result.model, citations: result.citations || [] };
}

// ── EVENT BRIEF GENERATION ─────────────────────────────────────────────────

/**
 * Generate a 1-2 sentence AI brief for an economic event that just released results.
 * E.g., "CPI came in at 2.8% vs 3.0% forecast, signaling cooling inflation..."
 * Results are cached per event per day to avoid redundant API calls.
 */
async function generateEventBrief(eventData) {
  const { name, actual, forecast, previous, country, category } = eventData;
  const today = new Date().toISOString().split('T')[0];
  const kebabName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const kebabActual = String(actual).replace(/[^a-z0-9.-]+/gi, '');
  const cacheSlug = `event-brief-${today}-${kebabName}-${kebabActual}`;

  // Check cache first
  const cached = loadArticle('calendar', cacheSlug);
  if (cached && cached.briefData) {
    console.log(`[calendar-analysis] Event brief cache hit: ${cacheSlug}`);
    return cached.briefData;
  }

  // Fetch live market context for richer analysis
  let contextSummary = '';
  try {
    const context = await fetchCalendarContext();
    contextSummary = buildDataSummary(context);
  } catch (e) {
    console.warn('[calendar-analysis] Event brief context fetch failed, proceeding without:', e.message);
    contextSummary = `Date: ${today}\n\nMarket context unavailable.`;
  }

  const userPrompt = `${contextSummary}

Economic event just released:
- Event: ${name}
- Country: ${country || 'US'}
- Category: ${category || 'Other'}
- Actual: ${actual}
- Forecast: ${forecast || 'N/A'}
- Previous: ${previous || 'N/A'}

Generate the event brief JSON object.`;

  const result = await gatedPerplexitySearch({
    query: userPrompt,
    systemPrompt: EVENT_BRIEF_PROMPT,
    maxTokens: 500,
    model: 'sonar-pro',
    agentId: AGENT_NAME,
    timeout: 20000,
    searchContextSize: 'low',
    skipResolution: true,
  });

  if (!result || result.type === 'ERROR') {
    console.error('[calendar-analysis] Event brief generation failed:', result?.error);
    return null;
  }

  const parsed = parseJSON(result.content);
  if (!parsed || !parsed.brief) {
    console.error('[calendar-analysis] Invalid event brief JSON structure');
    return null;
  }

  // Cache the result
  saveArticle({
    slug: cacheSlug,
    type: 'calendar',
    title: `Event Brief: ${name}`,
    headline: parsed.brief.slice(0, 80),
    content: JSON.stringify(parsed),
    categories: ['calendar', 'event-brief'],
    tags: ['calendar', 'event-brief', kebabName],
    model: result.model || 'sonar-pro',
    sourcesCited: result.citations || [],
    calendarType: 'event-brief',
    briefData: parsed,
    eventData: { name, actual, forecast, previous, country, category },
  });

  console.log(`[calendar-analysis] Event brief generated and cached: ${cacheSlug}`);
  return parsed;
}

// ── MAIN GENERATION CYCLE ───────────────────────────────────────────────────

/**
 * Generate all calendar analysis content (outlook + themes + verdict).
 * Saves each as separate JSON articles in the 'calendar' content type.
 */
async function generateCalendarAnalysis() {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];

  logAgentActivity({
    agent: AGENT_NAME,
    action: 'started',
    target: today,
    targetType: 'calendar',
    title: `Generating calendar analysis for ${today}`,
  });

  recordRun(AGENT_NAME);

  try {
    const context = await fetchCalendarContext();
    const results = {};

    // Generate all three in parallel
    const [outlookResult, themesResult, verdictResult] = await Promise.allSettled([
      generateOutlook(context),
      generateThemes(context),
      generateVerdict(context),
    ]);

    // Save outlook
    if (outlookResult.status === 'fulfilled') {
      const { data, model, citations } = outlookResult.value;
      data.updatedAt = new Date().toISOString();
      results.outlook = saveArticle({
        slug: 'latest',
        type: 'calendar',
        title: 'Calendar Market Outlook',
        headline: `Market Outlook: ${data.nextKeyEvent?.name || 'Macro Analysis'}`,
        content: JSON.stringify(data),
        categories: ['calendar', 'outlook'],
        tags: ['calendar', 'outlook', 'macro'],
        model: model || 'sonar-pro',
        generationTimeMs: Date.now() - startTime,
        sourcesCited: citations,
        calendarType: 'outlook',
        analysisData: data,
        dataSnapshot: {
          btcPrice: context.btcPrice || null,
          ethPrice: context.ethPrice || null,
          spy: context.spy || null,
          vix: context.vix || null,
          fearGreed: context.fearGreed || null,
        },
      });
      console.log(`[calendar-analysis] Outlook saved (${model})`);
    } else {
      console.error(`[calendar-analysis] Outlook failed:`, outlookResult.reason?.message);
    }

    // Save themes
    if (themesResult.status === 'fulfilled') {
      const { data, model, citations } = themesResult.value;
      results.themes = saveArticle({
        slug: 'themes-latest',
        type: 'calendar',
        title: 'Calendar Dominant Themes',
        headline: data[0]?.headline || 'Market Themes',
        content: JSON.stringify(data),
        categories: ['calendar', 'themes'],
        tags: ['calendar', 'themes', 'narratives'],
        model: model || 'sonar-pro',
        generationTimeMs: Date.now() - startTime,
        sourcesCited: citations,
        calendarType: 'themes',
        themesData: data,
      });
      console.log(`[calendar-analysis] Themes saved (${data.length} themes, ${model})`);
    } else {
      console.error(`[calendar-analysis] Themes failed:`, themesResult.reason?.message);
    }

    // Save verdict
    if (verdictResult.status === 'fulfilled') {
      const { data, model, citations } = verdictResult.value;
      data.updatedAt = new Date().toISOString();
      results.verdict = saveArticle({
        slug: 'verdict-latest',
        type: 'calendar',
        title: 'Market Regime Verdict',
        headline: data.verdict?.slice(0, 80) || 'Market Verdict',
        content: JSON.stringify(data),
        categories: ['calendar', 'verdict'],
        tags: ['calendar', 'verdict', 'regime'],
        model: model || 'sonar-pro',
        generationTimeMs: Date.now() - startTime,
        sourcesCited: citations,
        calendarType: 'verdict',
        verdictData: data,
      });
      console.log(`[calendar-analysis] Verdict saved (${model})`);
    } else {
      console.error(`[calendar-analysis] Verdict failed:`, verdictResult.reason?.message);
    }

    // Save to history (timestamped slug for the archive)
    const historySlug = `analysis-${today}-${Date.now()}`;
    saveArticle({
      slug: historySlug,
      type: 'calendar',
      title: `Calendar Analysis ${today}`,
      headline: results.outlook?.analysisData?.nextKeyEvent?.name || `Analysis ${today}`,
      content: JSON.stringify({
        outlook: outlookResult.status === 'fulfilled' ? outlookResult.value.data : null,
        themes: themesResult.status === 'fulfilled' ? themesResult.value.data : null,
        verdict: verdictResult.status === 'fulfilled' ? verdictResult.value.data : null,
        generatedAt: new Date().toISOString(),
        dataSnapshot: {
          btcPrice: context.btcPrice || null,
          ethPrice: context.ethPrice || null,
          spy: context.spy || null,
          vix: context.vix || null,
          fearGreed: context.fearGreed || null,
        },
      }),
      categories: ['calendar', 'history'],
      tags: ['calendar', 'history'],
      calendarType: 'history',
    });

    const elapsed = Date.now() - startTime;
    const successCount = [outlookResult, themesResult, verdictResult].filter(r => r.status === 'fulfilled').length;

    logAgentActivity({
      agent: AGENT_NAME,
      action: 'completed',
      target: today,
      targetType: 'calendar',
      title: `Calendar analysis: ${successCount}/3 sections (${(elapsed / 1000).toFixed(0)}s)`,
      generationTimeMs: elapsed,
    });

    console.log(`[calendar-analysis] Complete: ${successCount}/3 in ${(elapsed / 1000).toFixed(0)}s`);
    return results;
  } catch (e) {
    logAgentActivity({
      agent: AGENT_NAME,
      action: 'failed',
      target: today,
      targetType: 'calendar',
      title: `Calendar analysis failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[calendar-analysis] Failed:`, e.message);
    return null;
  }
}

/**
 * Trigger a breaking news update (themes + verdict only, lighter than full cycle).
 * Called by breakingNewsAgent when a TIER1 story lands.
 * Has a 30-min cooldown to prevent spam.
 */
async function triggerBreakingUpdate() {
  const now = Date.now();
  if (now - lastBreakingUpdate < BREAKING_COOLDOWN_MS) {
    console.log(`[calendar-analysis] Breaking update skipped (cooldown: ${((BREAKING_COOLDOWN_MS - (now - lastBreakingUpdate)) / 60000).toFixed(0)}min remaining)`);
    return null;
  }

  lastBreakingUpdate = now;
  console.log('[calendar-analysis] Breaking news triggered themes + verdict refresh');

  logAgentActivity({
    agent: AGENT_NAME,
    action: 'started',
    target: 'breaking-update',
    targetType: 'calendar',
    title: 'Breaking news: refreshing themes + verdict',
  });

  try {
    const context = await fetchCalendarContext();
    const [themesResult, verdictResult] = await Promise.allSettled([
      generateThemes(context),
      generateVerdict(context),
    ]);

    if (themesResult.status === 'fulfilled') {
      const { data, model, citations } = themesResult.value;
      saveArticle({
        slug: 'themes-latest',
        type: 'calendar',
        title: 'Calendar Dominant Themes',
        headline: data[0]?.headline || 'Market Themes',
        content: JSON.stringify(data),
        categories: ['calendar', 'themes'],
        tags: ['calendar', 'themes', 'narratives', 'breaking-update'],
        model: model || 'sonar-pro',
        sourcesCited: citations,
        calendarType: 'themes',
        themesData: data,
      });
    }

    if (verdictResult.status === 'fulfilled') {
      const { data, model, citations } = verdictResult.value;
      data.updatedAt = new Date().toISOString();
      saveArticle({
        slug: 'verdict-latest',
        type: 'calendar',
        title: 'Market Regime Verdict',
        headline: data.verdict?.slice(0, 80) || 'Market Verdict',
        content: JSON.stringify(data),
        categories: ['calendar', 'verdict'],
        tags: ['calendar', 'verdict', 'regime', 'breaking-update'],
        model: model || 'sonar-pro',
        sourcesCited: citations,
        calendarType: 'verdict',
        verdictData: data,
      });
    }

    logAgentActivity({
      agent: AGENT_NAME,
      action: 'completed',
      target: 'breaking-update',
      targetType: 'calendar',
      title: 'Breaking update: themes + verdict refreshed',
    });

    return { themes: themesResult.status === 'fulfilled', verdict: verdictResult.status === 'fulfilled' };
  } catch (e) {
    console.error('[calendar-analysis] Breaking update failed:', e.message);
    return null;
  }
}

module.exports = {
  generateCalendarAnalysis,
  generateEventBrief,
  triggerBreakingUpdate,
  AGENT_NAME,
};
