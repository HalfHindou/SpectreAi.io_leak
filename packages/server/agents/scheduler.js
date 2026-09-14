/**
 * Spectre Intelligence Hub — Scheduler
 * Newsroom: breaking/10min, curator/60min, analysis/2h, research/8h, daily brief 08:00+16:00 UTC.
 * Startup guard: skips cycles if agent ran recently (prevents restart-spam).
 * All agent counters persisted to disk via agentState.js.
 */
const { generateDailyBrief } = require('./dailyBriefAgent');
const { generateTokenAnalysis, SYMBOL_TO_CG } = require('./tokenAnalysisAgent');
const { generateStockAnalysis, STOCK_INFO } = require('./stockAnalysisAgent');
const { runCuratorCycle } = require('./newsCuratorAgent');
const { runBreakingCheck } = require('./breakingNewsAgent');
const { runAnalysisCycle } = require('./spectreAnalysisAgent');
const { runResearchCycle } = require('./researchArticleAgent');
const { generateCalendarAnalysis } = require('./calendarAnalysisAgent');
const { runRwaAnalysisCycle } = require('./rwaAnalysisAgent');
const { runTokenizedAssetsDaily } = require('./tokenizedAssetsDaily');
const { runMarketAnalysisCycle } = require('./marketAnalysisAgent');
const { runStockMarketAnalysisCycle } = require('./stockMarketAnalysisAgent');
const { logAgentActivity } = require('./activityLog');
const { canRunAgain, getAgentState, recordRun } = require('./agentState');
const { loadArticle } = require('../content/store');

// The target universe lives in its own module so the box worker can import it
// without dragging in this file's Express-coupled agent requires.
const { CRYPTO_TARGETS, STOCK_TARGETS } = require('./daily-targets');

const DELAY_MS = 3000; // 3s between each to respect rate limits

/**
 * shouldGenerate — checks if a specific article type/slug needs regeneration.
 * Used by the full generation cycle and on-demand endpoints.
 */
async function shouldGenerate(type, slug) {
  const existing = loadArticle(type, slug);
  if (!existing) return true;

  const ageHours = (Date.now() - new Date(existing.publishedAt)) / 3600000;

  // Daily briefs: regenerate after 8 hours
  if (type === 'daily') return ageHours > 8;

  // Token/stock analyses: regenerate after 20 hours
  if (type === 'crypto' || type === 'stocks') return ageHours > 20;

  // Research: never auto-regenerate (always new slug)
  if (type === 'research') return false;

  // News: never auto-regenerate
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let isRunning = false;

/**
 * Run the full generation cycle.
 */
async function runFullGeneration() {
  if (isRunning) {
    console.log('[scheduler] Generation already running, skipping.');
    return { status: 'already_running' };
  }

  isRunning = true;
  const startTime = Date.now();
  const results = { daily: null, crypto: [], stocks: [], errors: [] };

  logAgentActivity({
    agent: 'market-brief',
    action: 'scheduled',
    target: 'all',
    targetType: 'daily',
    title: 'Starting full generation cycle',
  });

  try {
    // 1. Daily Brief
    console.log('[scheduler] Generating daily brief...');
    results.daily = await generateDailyBrief();
    await sleep(DELAY_MS);

    // 2. Crypto tokens
    console.log(`[scheduler] Generating ${CRYPTO_TARGETS.length} crypto analyses...`);
    for (const symbol of CRYPTO_TARGETS) {
      try {
        const article = await generateTokenAnalysis(symbol, SYMBOL_TO_CG[symbol]);
        if (article) results.crypto.push(symbol);
        else results.errors.push({ type: 'crypto', symbol, error: 'null result' });
      } catch (e) {
        results.errors.push({ type: 'crypto', symbol, error: e.message });
      }
      await sleep(DELAY_MS);
    }

    // 3. Stocks
    console.log(`[scheduler] Generating ${STOCK_TARGETS.length} stock analyses...`);
    for (const symbol of STOCK_TARGETS) {
      try {
        const article = await generateStockAnalysis(symbol);
        if (article) results.stocks.push(symbol);
        else results.errors.push({ type: 'stocks', symbol, error: 'null result' });
      } catch (e) {
        results.errors.push({ type: 'stocks', symbol, error: e.message });
      }
      await sleep(DELAY_MS);
    }
  } finally {
    isRunning = false;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[scheduler] Full generation complete in ${(elapsed / 1000 / 60).toFixed(1)} min — ${results.crypto.length} crypto, ${results.stocks.length} stocks, ${results.errors.length} errors`);

  return {
    status: 'completed',
    elapsedMs: elapsed,
    daily: !!results.daily,
    cryptoCount: results.crypto.length,
    stockCount: results.stocks.length,
    errorCount: results.errors.length,
    errors: results.errors,
  };
}

/**
 * Generate a single article on demand.
 */
async function generateSingle(type, symbol) {
  if (type === 'daily') {
    // symbol can be a date string (YYYY-MM-DD) or anything else — default to today
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(symbol) ? symbol : undefined;
    return generateDailyBrief(dateStr);
  } else if (type === 'crypto') {
    return generateTokenAnalysis(symbol, SYMBOL_TO_CG[symbol.toUpperCase()]);
  } else if (type === 'stocks') {
    return generateStockAnalysis(symbol);
  }
  throw new Error(`Unknown type: ${type}`);
}

/**
 * Set up the daily cron (runs at 08:00 UTC).
 */
// 🪤 This used to be a single setTimeout aimed at the next 08:00 UTC, which
// re-armed only AFTER it fired. runFullGeneration is the ONLY producer of the
// crypto and stocks analyses, so that one timer was the entire cadence for
// those two types — and any process restart, redeploy or laptop sleep threw it
// away with nothing to catch up. That is why every other type stayed current
// (the newsroom below runs on setInterval) while crypto and stocks last
// published 2026-06-02: 8 weeks of missed 08:00s, none of them recoverable.
//
// Now it polls: every CRON_TICK_MS ask "is today's run still owed?" and run it
// if so. Surviving a restart is then the default rather than the happy path,
// and a box that was down at 08:00 catches up the moment it is back.
const CRON_TICK_MS = 15 * 60 * 1000;
const CRON_HOUR_UTC = 8;
const FULL_GEN_AGENT = 'full-generation';
const DAILY_LANE = 'daily-generation';

/**
 * Claim the daily lane on the data API.
 *
 * This lane also runs on the box (pm2 `spectre-newsroom`), so the two hosts
 * coordinate through a lease rather than an env switch — nothing has to know
 * which host is "the" generator, and either can be down.
 *
 * Fails OPEN: if the API is unreachable we still generate. A missed day is
 * worse than a duplicated one (both hosts upsert the same slugs), and this is
 * exactly the path that was silently dead for eight weeks.
 */
async function claimDailyLease() {
  const key = process.env.SPECTRE_API_KEY;
  if (!key) return true;
  const base = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850';
  try {
    const res = await fetch(`${base}/v1/intel/newsroom/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({
        lane: DAILY_LANE,
        date: new Date().toISOString().slice(0, 10),
        host: `express:${require('os').hostname()}`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => null);
    if (j?.data?.claimed) return true;
    const cur = j?.data?.current;
    console.log(`[scheduler] daily lane held by ${cur?.claimed_by || 'another host'} — skipping`);
    return false;
  } catch (e) {
    console.warn('[scheduler] lease unreachable, generating anyway:', e.message);
    return true;
  }
}

async function releaseDailyLease(ok) {
  const key = process.env.SPECTRE_API_KEY;
  if (!key) return;
  const base = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850';
  try {
    await fetch(`${base}/v1/intel/newsroom/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({ lane: DAILY_LANE, ok, note: 'express' }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { /* the 90min stale-claim recovery covers this */ }
}

/** Is today's full generation still owed? */
function fullGenerationDue() {
  const now = new Date();
  if (now.getUTCHours() < CRON_HOUR_UTC) return false;
  const last = getAgentState(FULL_GEN_AGENT)?.lastRunAt;
  if (!last) return true;
  // Compare UTC calendar days — one run per day, whenever the process is up.
  return new Date(last).toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
}

function startDailyCron() {
  const tick = async () => {
    try {
      if (!fullGenerationDue()) return;
      console.log('[scheduler] Daily generation due — running');
      // Stamp BEFORE the run: the cycle takes ~5min and the tick fires every
      // 15, but a slow or hung cycle must not be able to start a second one.
      // isRunning guards in-process; this guards across a crash-restart too.
      // The box runs this same lane (pm2 spectre-newsroom). Both hosts publish
      // to the same upsert endpoint, so a double run would not corrupt anything
      // — it would just burn a second set of LLM calls and race the content.
      // The lease makes exactly one host win per UTC day.
      const claimed = await claimDailyLease();
      if (!claimed) return;
      recordRun(FULL_GEN_AGENT);
      let ok = true;
      try {
        await runFullGeneration();
      } catch (e) {
        ok = false;
        throw e;
      } finally {
        await releaseDailyLease(ok);
      }
    } catch (e) {
      console.error('[scheduler] Daily generation failed:', e.message);
    }
  };
  setInterval(tick, CRON_TICK_MS);
  // Check on boot as well, so a process that starts at 09:00 does not wait
  // until the next tick (and one that starts at 07:00 simply finds nothing due).
  setTimeout(tick, 30 * 1000);
  console.log(`[scheduler] Daily generation: polling every ${CRON_TICK_MS / 60000}min, due from ${CRON_HOUR_UTC}:00 UTC`);
}

// ── NEWSROOM MULTI-SCHEDULE ──

let newsroomIntervals = [];

/**
 * Start the 24/7 newsroom agents.
 * - Breaking news check: every 10 minutes
 * - Curator cycle: every 30 minutes
 * - Daily brief: 08:00 and 16:00 UTC
 */
function startNewsroom() {
  console.log('[scheduler] Starting newsroom agents...');

  logAgentActivity({
    agent: 'news-curator',
    action: 'scheduled',
    target: 'newsroom',
    targetType: 'news',
    title: 'Newsroom agents started — curator/30min, breaking/10min',
  });

  // Run agents on startup ONLY if they haven't run recently.
  // This is the core fix for the "156 stories" bug — prevents restart-spam.
  // Minimum intervals: curator 20min, analysis 45min, research 4h
  setTimeout(async () => {
    const hasAI = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.PERPLEXITY_API_KEY;
    if (!hasAI) {
      console.log('[scheduler] Skipping initial agent cycles — no AI API key configured');
      return;
    }

    // Curator: only if not run in last 20 minutes
    if (canRunAgain('news-curator', 20 * 60 * 1000)) {
      console.log('[scheduler] Running initial curator cycle...');
      try {
        await runCuratorCycle();
      } catch (e) {
        console.error('[scheduler] Initial curator cycle failed:', e.message);
      }
    } else {
      console.log('[scheduler] Skipping startup curator — ran recently');
    }

    // Analysis: only if not run in last 45 minutes
    if (canRunAgain('spectre-analyst', 45 * 60 * 1000)) {
      console.log('[scheduler] Running initial analysis cycle...');
      try {
        await runAnalysisCycle();
      } catch (e) {
        console.error('[scheduler] Initial analysis cycle failed:', e.message);
      }
    } else {
      console.log('[scheduler] Skipping startup analysis — ran recently');
    }

    // Research: only if not run in last 4 hours
    if (canRunAgain('spectre-research', 4 * 60 * 60 * 1000)) {
      console.log('[scheduler] Running initial research cycle...');
      try {
        await runResearchCycle();
      } catch (e) {
        console.error('[scheduler] Initial research cycle failed:', e.message);
      }
    } else {
      console.log('[scheduler] Skipping startup research — ran recently');
    }

    // Calendar analysis: only if not run in last 2 hours
    if (canRunAgain('calendar-analysis', 2 * 60 * 60 * 1000)) {
      console.log('[scheduler] Running initial calendar analysis...');
      try {
        await generateCalendarAnalysis();
      } catch (e) {
        console.error('[scheduler] Initial calendar analysis failed:', e.message);
      }
    } else {
      console.log('[scheduler] Skipping startup calendar analysis — ran recently');
    }
  }, 10000);

  // Breaking news: every 10 minutes (RSS-only check, lightweight)
  const breakingInterval = setInterval(async () => {
    try {
      await runBreakingCheck();
    } catch (e) {
      console.error('[scheduler] Breaking check error:', e.message);
    }
  }, 10 * 60 * 1000);
  newsroomIntervals.push(breakingInterval);

  // Curator: every 60 minutes (reduced from 30 to prevent flood)
  const curatorInterval = setInterval(async () => {
    try {
      await runCuratorCycle();
    } catch (e) {
      console.error('[scheduler] Curator cycle error:', e.message);
    }
  }, 60 * 60 * 1000);
  newsroomIntervals.push(curatorInterval);

  // Spectre Analysis: every 2 hours (reduced from 60min)
  const analysisInterval = setInterval(async () => {
    try {
      await runAnalysisCycle();
    } catch (e) {
      console.error('[scheduler] Analysis cycle error:', e.message);
    }
  }, 2 * 60 * 60 * 1000);
  newsroomIntervals.push(analysisInterval);

  // Calendar analysis: every 4 hours (economic calendar content)
  const calendarInterval = setInterval(async () => {
    try {
      await generateCalendarAnalysis();
    } catch (e) {
      console.error('[scheduler] Calendar analysis error:', e.message);
    }
  }, 4 * 60 * 60 * 1000);
  newsroomIntervals.push(calendarInterval);

  // RWA Daily Edition: ticks every 3.5h, rotates through 7 topics.
  // Per-topic staleness is 23h inside rwaAnalysisAgent → each topic publishes once a day.
  const rwaAnalysisInterval = setInterval(async () => {
    try {
      if (canRunAgain('rwa-analysis', 3 * 60 * 60 * 1000)) {
        await runRwaAnalysisCycle();
      }
    } catch (e) {
      console.error('[scheduler] RWA analysis error:', e.message);
    }
  }, 3.5 * 60 * 60 * 1000);
  newsroomIntervals.push(rwaAnalysisInterval);

  // Tokenized Assets Daily Edition: one full-length editorial article per day.
  // Inner staleness check (today-slug exists) gates writes; we tick every 4h to
  // guarantee publication after a server restart or scheduler skip.
  const tokenizedAssetsDailyInterval = setInterval(async () => {
    try {
      if (canRunAgain('tokenized-assets-daily', 3 * 60 * 60 * 1000)) {
        await runTokenizedAssetsDaily();
      }
    } catch (e) {
      console.error('[scheduler] Tokenized Assets Daily error:', e.message);
    }
  }, 4 * 60 * 60 * 1000);
  newsroomIntervals.push(tokenizedAssetsDailyInterval);

  // Kick off an initial Tokenized Assets Daily ~60s after boot.
  setTimeout(async () => {
    try {
      if (canRunAgain('tokenized-assets-daily', 3 * 60 * 60 * 1000)) {
        console.log('[scheduler] Running initial Tokenized Assets Daily Edition...');
        await runTokenizedAssetsDaily();
      } else {
        console.log('[scheduler] Skipping startup Tokenized Assets Daily — ran recently');
      }
    } catch (e) {
      console.error('[scheduler] Initial Tokenized Assets Daily failed:', e.message);
    }
  }, 60_000);

  // Market analysis: every 15 minutes — keeps 1h/24h/7d timeframes warm 24/7
  const marketAnalysisInterval = setInterval(async () => {
    try {
      if (canRunAgain('market-analysis', 14 * 60 * 1000)) {
        await runMarketAnalysisCycle();
      }
    } catch (e) {
      console.error('[scheduler] Market analysis error:', e.message);
    }
  }, 15 * 60 * 1000);
  newsroomIntervals.push(marketAnalysisInterval);

  // Stock market analysis: same 15-min cadence, separate agent + cache so the
  // equities "AI Market" panel is catalyst-aware instead of static template copy.
  const stockMarketAnalysisInterval = setInterval(async () => {
    try {
      if (canRunAgain('stock-market-analysis', 14 * 60 * 1000)) {
        await runStockMarketAnalysisCycle();
      }
    } catch (e) {
      console.error('[scheduler] Stock market analysis error:', e.message);
    }
  }, 15 * 60 * 1000);
  newsroomIntervals.push(stockMarketAnalysisInterval);

  // Kick off an initial market analysis cycle ~45s after boot (gives the Express
  // server time to come fully online so the agent's localhost HTTP calls succeed).
  setTimeout(async () => {
    try {
      if (canRunAgain('market-analysis', 14 * 60 * 1000)) {
        console.log('[scheduler] Running initial market analysis cycle...');
        await runMarketAnalysisCycle();
      } else {
        console.log('[scheduler] Skipping startup market analysis — ran recently');
      }
    } catch (e) {
      console.error('[scheduler] Initial market analysis failed:', e.message);
    }
  }, 45_000);

  // Kick off an initial stock market analysis cycle ~55s after boot (staggered
  // behind crypto so the two Groq cycles don't fire in the same instant).
  setTimeout(async () => {
    try {
      if (canRunAgain('stock-market-analysis', 14 * 60 * 1000)) {
        console.log('[scheduler] Running initial stock market analysis cycle...');
        await runStockMarketAnalysisCycle();
      } else {
        console.log('[scheduler] Skipping startup stock market analysis — ran recently');
      }
    } catch (e) {
      console.error('[scheduler] Initial stock market analysis failed:', e.message);
    }
  }, 55_000);

  // Kick off an initial RWA analysis cycle ~30s after boot (once warmer has hot caches)
  setTimeout(async () => {
    try {
      if (canRunAgain('rwa-analysis', 3 * 60 * 60 * 1000)) {
        console.log('[scheduler] Running initial RWA analysis cycle...');
        await runRwaAnalysisCycle();
      } else {
        console.log('[scheduler] Skipping startup RWA analysis — ran recently');
      }
    } catch (e) {
      console.error('[scheduler] Initial RWA analysis failed:', e.message);
    }
  }, 30_000);

  // Research articles: every 8 hours (deep-dive thesis articles, 3x daily max)
  const researchInterval = setInterval(async () => {
    try {
      await runResearchCycle();
    } catch (e) {
      console.error('[scheduler] Research cycle error:', e.message);
    }
  }, 8 * 60 * 60 * 1000);
  newsroomIntervals.push(researchInterval);

  // Daily brief at 08:00 and 16:00 UTC
  function scheduleDailyBriefs() {
    const now = new Date();
    const targets = [8, 16]; // UTC hours
    let nextTarget = null;

    for (const hour of targets) {
      const t = new Date(now);
      t.setUTCHours(hour, 0, 0, 0);
      if (t > now && (!nextTarget || t < nextTarget)) {
        nextTarget = t;
      }
    }

    // If no target today, schedule first one tomorrow
    if (!nextTarget) {
      nextTarget = new Date(now);
      nextTarget.setUTCDate(nextTarget.getUTCDate() + 1);
      nextTarget.setUTCHours(targets[0], 0, 0, 0);
    }

    const delay = nextTarget - now;
    console.log(`[scheduler] Next daily brief at ${nextTarget.toISOString()} (in ${(delay / 1000 / 60 / 60).toFixed(1)}h)`);

    setTimeout(async () => {
      console.log('[scheduler] Newsroom daily brief triggered');
      try {
        await generateDailyBrief();
      } catch (e) {
        console.error('[scheduler] Daily brief error:', e.message);
      }
      scheduleDailyBriefs(); // schedule next
    }, delay);
  }
  scheduleDailyBriefs();

  console.log('[scheduler] Newsroom multi-schedule started — breaking/10min, market/15min, curator/60min, analysis/2h, calendar/4h, rwa/4h, research/8h, daily brief 08:00+16:00 UTC');
}

/**
 * Stop all newsroom intervals.
 */
function stopNewsroom() {
  newsroomIntervals.forEach(id => clearInterval(id));
  newsroomIntervals = [];
  console.log('[scheduler] Newsroom agents stopped');
}

module.exports = {
  runFullGeneration, generateSingle, startDailyCron,
  startNewsroom, stopNewsroom, shouldGenerate,
  runCuratorCycle, runBreakingCheck, runAnalysisCycle, runResearchCycle, generateCalendarAnalysis,
  CRYPTO_TARGETS, STOCK_TARGETS,
};
