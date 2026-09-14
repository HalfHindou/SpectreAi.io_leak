'use strict';
/**
 * Research Desk — AI Content Reader (PROD-serverless stub).
 * ═══════════════════════════════════════════════════════════════════════════════
 * The dev reader (packages/server/agents/researchDeskContent.js → readResearchDeckContent)
 * loads persisted alpha-thesis + pitch-deck JSON from the on-disk content store
 * (packages/server/content/articles/research/*.json). That directory is server-local
 * and is NOT bundled into the Vercel serverless function — so in prod there is no
 * content to read.
 *
 * Per the Phase-2 contract, the reader DEGRADES TO {} on the serverless side: prod
 * simply returns empty content and the frontend (TokenPitchDeck / AlphaThesisCards)
 * falls back to its Phase-1 data-derived strings. This stub provides the identical
 * `readResearchDeckContent(symbols)` signature so the prod route (Wire phase) can
 * call it the same way it calls the dev module — it just always returns empty.
 *
 * If/when prod content delivery is wanted (e.g. persisting theses/pitches to Vercel
 * KV instead of disk), replace this stub's body with a KV read keyed by symbol.
 * The shape it must return is unchanged:
 *     { theses: { [SYMBOL]: thesisObj }, pitches: { [SYMBOL]: pitchObj } }
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * @param {string[]} _symbols - project symbols (ignored in the prod stub)
 * @returns {{ theses: Object, pitches: Object }} always empty in serverless prod
 */
function readResearchDeckContent(_symbols) {
  return { theses: {}, pitches: {} };
}

module.exports = { readResearchDeckContent };
