/**
 * Spectre Intelligence Hub — Research Desk Warmer Agent
 * Keeps the Research Desk bundle hot by periodically rebuilding the qualified
 * universe (slow) + refreshing live metrics (fast), then auto-publishing the
 * result into the route's in-memory cache.
 *
 * Schedule (mirrors rwaWarmer.js):
 *   - Slow loop (45 min): buildResearchDeskUniverse — sources DefiLlama /protocols
 *     (~8MB) + /overview/fees, applies the eligibility gate. Heavy + slow-moving.
 *     ALSO warms the sectors tier (computeSectorRotation reuses the SAME /protocols
 *     array — no re-fetch) and triggers the AI content batch (thesis + pitch for
 *     the top-12 projects) on this slow cadence. The content batch is fully
 *     cost-bounded (freshness-gated, ~once/week of real AI work) and NEVER blocks
 *     the universe build — it runs in the background via Promise.allSettled.
 *   - Fast loop (5 min): refreshResearchDeskMetrics — re-enrich via DexScreener,
 *     re-score/stage/grade, publish into the route cache. ALSO warms the memes
 *     tier (reuses the shared trending engine + its cache — zero extra Codex cost).
 *     Light + keeps numbers fresh.
 *
 * The warmer calls the route's exported helpers directly (not via HTTP) so there
 * is no proxy hop. Initial fires are staggered so the universe is built before
 * the first metrics pass.
 */

const researchDesk = require('../routes/research-desk');
const { generateResearchDeckContent } = require('../agents/researchDeskContent');

const FAST_INTERVAL_MS = 5 * 60 * 1000;    // 5 min
const SLOW_INTERVAL_MS = 45 * 60 * 1000;   // 45 min

// AI content generation: top-N projects per slow refresh. Bounded + freshness-
// gated inside generateResearchDeckContent (within-7-day re-runs are ~free), so
// real AI spend is ~once/week of $0.02-0.03 for the full batch. Never blocks.
const CONTENT_BATCH_LIMIT = 12;

let intervals = [];

function fmtMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Slow loop: rebuild the qualified universe (force-refresh the slow tier), warm
// the sectors tier off the same /protocols array, and kick the AI content batch.
async function warmUniverse() {
  const t0 = Date.now();
  // Universe first, then sectors (depends on the universe build's raw /protocols).
  const [uni] = await Promise.allSettled([researchDesk.getUniverse(true)]);
  const [sec] = await Promise.allSettled([researchDesk.getSectors(true)]);

  const uniCount = uni.status === 'fulfilled' ? (uni.value || []).length : -1;
  const secCount = sec.status === 'fulfilled' ? (sec.value?.meta?.count ?? (sec.value?.sectors || []).length) : -1;

  if (uni.status === 'rejected') {
    console.error(`[ResearchDesk Warmer] universe ERR: ${uni.reason?.message?.slice(0, 60)}`);
  }
  if (sec.status === 'rejected') {
    console.error(`[ResearchDesk Warmer] sectors ERR: ${sec.reason?.message?.slice(0, 60)}`);
  }

  // AI content batch — non-blocking, cost-bounded, never throws into the loop.
  // Seeded from the freshly-published bundle's projects (carry compositeScore for
  // ranking). Runs on the slow cadence only; the agents freshness-gate internally.
  let contentCount = -1;
  try {
    // Pre-warm the content tier via the WORKING AI path (intel crawler in
    // routes/research-desk getContent). Populates contentState so first user load
    // gets cached AI thesis/pitch instead of racing the slow cold crawl.
    const [content] = await Promise.allSettled([
      researchDesk.getContent(true),
    ]);
    if (content.status === 'fulfilled') {
      const th = (content.value && content.value.content && content.value.content.theses) || {};
      contentCount = Object.keys(th).length;
    } else {
      console.error(`[ResearchDesk Warmer] content ERR: ${content.reason?.message?.slice(0, 60)}`);
    }
  } catch (err) {
    console.error(`[ResearchDesk Warmer] content ERR: ${err.message?.slice(0, 60)}`);
  }

  console.log(
    `[ResearchDesk Warmer] universe(${uniCount}) sectors(${secCount}) content(${contentCount}) — ${fmtMs(Date.now() - t0)}`
  );
}

// Fast loop: refresh live metrics + publish the bundle into the route cache, and
// warm the memes tier (shared trending engine — zero extra Codex cost).
async function warmMetrics() {
  const t0 = Date.now();
  const [bundle, memes] = await Promise.allSettled([
    researchDesk.getBundle(true),
    researchDesk.getMemes(true),
  ]);

  const coreCount = bundle.status === 'fulfilled'
    ? (bundle.value?.meta?.count ?? (bundle.value?.projects || []).length)
    : -1;
  const memeCount = memes.status === 'fulfilled'
    ? (memes.value?.meta?.counts?.dealFlow ?? (memes.value?.dealFlow || []).length)
    : -1;

  if (bundle.status === 'rejected') {
    console.error(`[ResearchDesk Warmer] fast ERR: ${bundle.reason?.message?.slice(0, 60)}`);
  }
  if (memes.status === 'rejected') {
    console.error(`[ResearchDesk Warmer] memes ERR: ${memes.reason?.message?.slice(0, 60)}`);
  }

  console.log(`[ResearchDesk Warmer] fast(${coreCount}) memes(${memeCount}) — ${fmtMs(Date.now() - t0)}`);
}

/**
 * Start the Research Desk warmer.
 * @param {object} opts
 * @param {number} [opts.port] - optional, unused (here for API symmetry with rwaWarmer)
 */
function startResearchDeskWarmer(/* { port } = {} */) {
  console.log('[ResearchDesk Warmer] Starting — slow(universe+sectors+content)/45min, fast(metrics+memes)/5min');

  // Build the universe first (8s after boot so the HTTP server is bound), then
  // the first metrics pass (12s) so it runs over a populated universe.
  setTimeout(() => { warmUniverse().catch(() => {}); }, 8000);
  setTimeout(() => { warmMetrics().catch(() => {}); }, 12000);

  intervals.push(setInterval(() => { warmUniverse().catch(() => {}); }, SLOW_INTERVAL_MS));
  intervals.push(setInterval(() => { warmMetrics().catch(() => {}); }, FAST_INTERVAL_MS));
}

function stopResearchDeskWarmer() {
  intervals.forEach((id) => clearInterval(id));
  intervals = [];
  console.log('[ResearchDesk Warmer] Stopped');
}

module.exports = { startResearchDeskWarmer, stopResearchDeskWarmer };
