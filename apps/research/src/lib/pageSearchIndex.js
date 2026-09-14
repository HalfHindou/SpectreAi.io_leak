/**
 * Page search index — fuzzy match scoring against PAGE_CATALOG.
 *
 * Pure, dependency-free. Synchronous. Designed to run on every keystroke
 * against ~60-100 catalog entries with sub-millisecond latency.
 *
 * Match weights (per field):
 *   title       3.0
 *   aliases     2.0
 *   keywords    1.0
 *   description 0.5
 *
 * Match types (per field):
 *   exact whole-string match     × 1.0
 *   starts-with match            × 0.8
 *   word-boundary contains       × 0.6
 *   any substring contains       × 0.4
 *   fuzzy (every query char in order, ignoring gaps) × 0.2
 *
 * Tier multiplier (after raw score):
 *   tier 1: × 1.0
 *   tier 2: × 0.85
 *   tier 3: × 0.65
 *
 * Floor: entries scoring below MIN_SCORE are dropped.
 */
import { PAGE_CATALOG } from '@/constants/pageCatalog'

const MIN_SCORE = 0.6
const MAX_RESULTS = 8

const FIELD_WEIGHTS = {
  title: 3.0,
  aliases: 2.0,
  keywords: 1.0,
  description: 0.5,
}

const TIER_MULTIPLIERS = { 1: 1.0, 2: 0.85, 3: 0.65 }

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Score a single normalized candidate string against a normalized query.
 * Returns 0 if no match, else 0.2 - 1.0.
 */
function scoreString(candidate, query) {
  if (!candidate || !query) return 0
  if (candidate === query) return 1.0
  if (candidate.startsWith(query)) return 0.8

  // Reverse starts-with: the user typed a long form (e.g. "ycombinator")
  // and the catalog has a short abbreviation alias ("yc"). The query starts
  // with the alias → still a strong intent signal. Capped at 0.7 so direct
  // matches always win.
  if (candidate.length >= 2 && query.startsWith(candidate)) {
    // Confidence scales with how much of the query the alias covers.
    const coverage = candidate.length / query.length
    return Math.max(0.5, Math.min(0.7, coverage + 0.3))
  }

  // Word-boundary contains: query starts a word inside candidate
  const wordBoundaryRe = new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  if (wordBoundaryRe.test(candidate)) return 0.6

  if (candidate.includes(query)) return 0.4

  // Fuzzy: every query char appears in order in the candidate
  let qi = 0
  for (let ci = 0; ci < candidate.length && qi < query.length; ci++) {
    if (candidate[ci] === query[qi]) qi++
  }
  if (qi === query.length) return 0.2

  return 0
}

/**
 * Score a list field (aliases / keywords) — take the best per-item score.
 */
function scoreList(list, query) {
  if (!Array.isArray(list) || list.length === 0) return 0
  let best = 0
  for (const item of list) {
    const s = scoreString(normalize(item), query)
    if (s > best) best = s
  }
  return best
}

/**
 * Tokenize a query into search tokens (split on spaces, drop empties).
 */
function tokenize(q) {
  return q.split(' ').filter((t) => t.length > 0)
}

/**
 * Match a query against a single entry. Returns { score, matchedField, matchedValue }.
 *
 * Two-pass strategy:
 *   1. Whole-query match (gets full credit for exact-string hits)
 *   2. Per-token match averaged (catches multi-word queries like "private deals"
 *      where the words live in different fields)
 *   Final score = max(whole, average-of-tokens)
 */
function matchEntry(entry, normalizedQuery) {
  // Pass 1: whole-query against each field
  const wholeTitle = scoreString(normalize(entry.title), normalizedQuery)
  const wholeAlias = scoreList(entry.aliases, normalizedQuery)
  const wholeKeyword = scoreList(entry.keywords, normalizedQuery)
  const wholeDesc = scoreString(normalize(entry.description), normalizedQuery)
  const wholeRaw =
    wholeTitle * FIELD_WEIGHTS.title +
    wholeAlias * FIELD_WEIGHTS.aliases +
    wholeKeyword * FIELD_WEIGHTS.keywords +
    wholeDesc * FIELD_WEIGHTS.description

  // Pass 2: per-token averaged (only when query has multiple tokens, since
  // single-token queries already collapse to pass 1).
  const tokens = tokenize(normalizedQuery)
  let tokenRaw = 0
  if (tokens.length > 1) {
    let tokenScoreSum = 0
    let tokenHits = 0
    for (const tok of tokens) {
      // For each token, take the BEST score across all fields, but still
      // weighted by which field hit. This lets "private" hit title and
      // "deals" hit aliases — both contribute.
      const titleS = scoreString(normalize(entry.title), tok) * FIELD_WEIGHTS.title
      const aliasS = scoreList(entry.aliases, tok) * FIELD_WEIGHTS.aliases
      const keywordS = scoreList(entry.keywords, tok) * FIELD_WEIGHTS.keywords
      const descS = scoreString(normalize(entry.description), tok) * FIELD_WEIGHTS.description
      const bestForToken = Math.max(titleS, aliasS, keywordS, descS)
      if (bestForToken > 0) {
        tokenScoreSum += bestForToken
        tokenHits++
      }
    }
    // Require all tokens to hit something — otherwise the query has stray terms
    // and we'd be matching half-relevant pages.
    if (tokenHits === tokens.length) {
      tokenRaw = tokenScoreSum / tokens.length
    }
  }

  const raw = Math.max(wholeRaw, tokenRaw)
  if (raw === 0) return { score: 0, matchedField: null }

  // Pick which field gave the highest CONTRIBUTION to the whole-query score
  // (so the badge shows the most relevant matched field).
  const titleScore = wholeTitle
  const aliasScore = wholeAlias
  const keywordScore = wholeKeyword
  const descScore = wholeDesc

  // Pick which field gave the highest weighted contribution (for badge UI)
  const contributions = [
    { f: 'title', v: titleScore * FIELD_WEIGHTS.title, val: entry.title },
    { f: 'aliases', v: aliasScore * FIELD_WEIGHTS.aliases, val: entry.aliases?.[0] },
    { f: 'keywords', v: keywordScore * FIELD_WEIGHTS.keywords, val: entry.keywords?.[0] },
    { f: 'description', v: descScore * FIELD_WEIGHTS.description, val: entry.description },
  ]
  contributions.sort((a, b) => b.v - a.v)
  const top = contributions[0]

  const tierMult = TIER_MULTIPLIERS[entry.tier] ?? 1.0
  return {
    score: raw * tierMult,
    matchedField: top.f,
    matchedValue: top.val,
  }
}

/**
 * Search the catalog. Returns up to MAX_RESULTS matches sorted by score.
 *
 * @param {string} query   raw user input
 * @param {object} opts    { limit, includeSubTabs }
 * @returns {Array<{ entry, score, matchedField, matchedValue }>}
 */
export function searchPages(query, { limit = MAX_RESULTS, includeSubTabs = true } = {}) {
  const q = normalize(query)
  if (!q || q.length < 2) return []

  const results = []
  for (const entry of PAGE_CATALOG) {
    if (!includeSubTabs && entry.parent) continue
    const m = matchEntry(entry, q)
    if (m.score >= MIN_SCORE) {
      results.push({ entry, ...m })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

/**
 * Smaller "did you mean" helper — returns just the top 1 result with a higher
 * score floor. Used for inline auto-complete hints.
 */
export function topPageMatch(query) {
  const results = searchPages(query, { limit: 1 })
  const top = results[0]
  if (!top || top.score < 1.2) return null
  return top
}
