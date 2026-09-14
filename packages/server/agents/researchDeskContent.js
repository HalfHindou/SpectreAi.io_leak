'use strict';
/**
 * Research Desk — AI Content Orchestrator + Reader (Phase 2, cost-bounded).
 * ═══════════════════════════════════════════════════════════════════════════════
 * Two responsibilities, deliberately split so the READER stays dependency-light
 * and serverless-safe:
 *
 *   1. generateResearchDeckContent(projects, opts) — the BATCH WRITER. Generates
 *      alpha theses + pitch decks for ONLY the top `limit` projects by
 *      compositeScore, skipping any with fresh (<7d) cached content, running
 *      SEQUENTIALLY with a small delay, hard-capping retries at 2, and tolerating
 *      per-project failures (Promise.allSettled-style — one failure never aborts
 *      the batch). Server-side only (Express warmer / cron). Pulls in the two
 *      agents (which pull in perplexityGate).
 *
 *   2. readResearchDeckContent(symbols) — the PURE READER. Loads persisted
 *      { theses, pitches } from the content store. NO generation, NO AI deps.
 *      The route uses THIS to serve tier=content. It is require-able from the
 *      serverless side: if store.js isn't available / readable in that runtime,
 *      it degrades to {} so prod simply returns empty and the frontend falls back
 *      to its data-derived strings.
 *
 * COST: see alphaThesisAgent.js / pitchDeckAgent.js. A full top-12 batch =
 *   12 × (1 thesis call + 1 pitch call) on Groq llama-3.3-70b ≈ $0.02-0.03, ONCE
 *   PER WEEK (freshness gate). Re-runs within 7 days are ~free (all skipped).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Reader-side store access is wrapped so a missing/unsafe store in the serverless
// runtime degrades to a no-op rather than throwing at require-time or call-time.
let _store = null;
try { _store = require('../content/store'); } catch (_) { _store = null; }

const CONTENT_TYPE = 'research';
const THESIS_PREFIX = 'research-desk-thesis-';
const PITCH_PREFIX = 'research-desk-pitch-';
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches the agents' internal gate

function normSym(symbol) {
  return String(symbol || '').replace(/^\$/, '').toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// READER (pure, serverless-safe — no AI deps)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load persisted AI content for the given symbols from the content store.
 * Pure read — never generates. Degrades to {} on any store failure so prod can
 * call it safely and the frontend falls back to data-derived strings.
 *
 * @param {string[]} symbols - project symbols (case-insensitive, '$' tolerated)
 * @returns {{ theses: Object<string,object>, pitches: Object<string,object> }}
 */
function readResearchDeckContent(symbols) {
  const out = { theses: {}, pitches: {} };
  if (!_store || typeof _store.loadArticle !== 'function') return out;
  if (!Array.isArray(symbols) || symbols.length === 0) return out;

  for (const raw of symbols) {
    const sym = normSym(raw);
    if (!sym) continue;
    const lower = sym.toLowerCase();
    try {
      const t = _store.loadArticle(CONTENT_TYPE, `${THESIS_PREFIX}${lower}`);
      if (t && t.thesis) out.theses[sym] = t.thesis;
    } catch (_) { /* missing/unreadable thesis -> skip (frontend falls back) */ }
    try {
      const p = _store.loadArticle(CONTENT_TYPE, `${PITCH_PREFIX}${lower}`);
      if (p && p.pitch) out.pitches[sym] = p.pitch;
    } catch (_) { /* missing/unreadable pitch -> skip */ }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH WRITER (server-side only — pulls in the agents + the gate)
// ═══════════════════════════════════════════════════════════════════════════════

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Lazy-require the agents so the READER half of this module never drags the
// gate/AI stack into the (serverless) require graph. Only the batch writer needs them.
function _loadAgents() {
  const { generateAlphaThesis } = require('./alphaThesisAgent');
  const { generatePitchDeck } = require('./pitchDeckAgent');
  return { generateAlphaThesis, generatePitchDeck };
}

/** Run an async fn with up to `maxRetries` retries (so 1 try + N retries). Never throws. */
async function withRetries(fn, maxRetries, label) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fn();
      if (r != null) return r; // a clean no-op (null) is NOT retried below
      return null;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await delay(800 * (attempt + 1));
    }
  }
  if (lastErr) console.error(`[research-desk-content] ${label} failed after retries:`, lastErr.message);
  return null;
}

/**
 * Batch-generate AI content for the top projects.
 *
 * @param {Array<object>} projects - Phase-1 Research Desk project rows
 * @param {object} [opts]
 * @param {number}  [opts.limit=12]   - only the top-N by compositeScore are generated
 * @param {boolean} [opts.force=false] - bypass the 7-day freshness gate
 * @param {number}  [opts.delayMs=1200] - pause between projects (rate-friendly)
 * @returns {Promise<{ generated:number, skipped:number, failed:number, symbols:string[] }>}
 */
async function generateResearchDeckContent(projects, opts = {}) {
  const { limit = 12, force = false, delayMs = 1200 } = opts;
  const summary = { generated: 0, skipped: 0, failed: 0, symbols: [] };

  if (!Array.isArray(projects) || projects.length === 0) return summary;
  if (!_store || typeof _store.saveArticle !== 'function') {
    console.warn('[research-desk-content] content store unavailable — generation skipped');
    return summary;
  }

  let agents;
  try {
    agents = _loadAgents();
  } catch (err) {
    console.error('[research-desk-content] agents unavailable — generation skipped:', err.message);
    return summary;
  }
  const { generateAlphaThesis, generatePitchDeck } = agents;

  // Rank by compositeScore desc, take top-N. (compositeScore is the 0-100 int the
  // Phase-1 pipeline already attaches; fall back to 0 if absent.)
  const ranked = [...projects]
    .filter((p) => p && p.symbol)
    .sort((a, b) => (Number(b.compositeScore) || 0) - (Number(a.compositeScore) || 0))
    .slice(0, Math.max(0, limit));

  const t0 = Date.now();
  console.log(`[research-desk-content] batch start — top ${ranked.length} (force=${force})`);

  // SEQUENTIAL — never fan out (cost + rate). Per-project failures are isolated.
  let didWork = false; // track whether any real AI call ran (to gate the inter-project delay)
  for (let i = 0; i < ranked.length; i++) {
    const project = ranked[i];
    const sym = normSym(project.symbol);

    // Pre-skip: if BOTH a fresh thesis + pitch already exist, don't touch the
    // agents at all (zero AI cost) and label it accurately as skipped. The
    // agents also freshness-gate internally — this is the cheap outer guard that
    // also keeps the summary honest.
    if (!force && _isFresh(`${THESIS_PREFIX}${sym.toLowerCase()}`) && _isFresh(`${PITCH_PREFIX}${sym.toLowerCase()}`)) {
      summary.skipped++;
      continue;
    }

    // Pace only BETWEEN real AI passes (not after a pre-skip), so a batch that is
    // mostly cache-fresh returns fast.
    if (didWork && delayMs > 0) await delay(delayMs);

    const [thesis, pitch] = await Promise.allSettled([
      withRetries(() => generateAlphaThesis(project, { force }), 2, `thesis ${sym}`),
      withRetries(() => generatePitchDeck(project, { force }), 2, `pitch ${sym}`),
    ]).then((res) => res.map((r) => (r.status === 'fulfilled' ? r.value : null)));
    didWork = true;

    if (thesis || pitch) {
      summary.generated++;
      summary.symbols.push(sym);
    } else {
      // Both null: an agent-internal freshness skip slipped through (only one of
      // the two was fresh), OR no AI key / all providers failed. Count a fresh
      // hit as skipped, otherwise failed.
      const existsFresh = !force && (
        _isFresh(`${THESIS_PREFIX}${sym.toLowerCase()}`) ||
        _isFresh(`${PITCH_PREFIX}${sym.toLowerCase()}`)
      );
      if (existsFresh) summary.skipped++;
      else summary.failed++;
    }
  }

  console.log(
    `[research-desk-content] batch done — generated=${summary.generated} skipped=${summary.skipped} ` +
    `failed=${summary.failed} in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  return summary;
}

function _safeLoad(slug) {
  if (!_store || typeof _store.loadArticle !== 'function') return null;
  try { return _store.loadArticle(CONTENT_TYPE, slug); } catch (_) { return null; }
}

// True if a persisted article exists AND is younger than the 7-day freshness
// window (matches the agents' internal gate). Used by the batch to pre-skip.
function _isFresh(slug) {
  const a = _safeLoad(slug);
  if (!a || !a.updatedAt) return false;
  return (Date.now() - new Date(a.updatedAt).getTime()) < FRESH_MS;
}

module.exports = {
  readResearchDeckContent,
  generateResearchDeckContent,
  CONTENT_TYPE,
  THESIS_PREFIX,
  PITCH_PREFIX,
};
