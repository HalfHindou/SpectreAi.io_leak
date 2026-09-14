/**
 * Pre-IPO — page-specific editorial overlay + constants.
 *
 * The backend /api/private/preipo returns the hard data (valuation, rounds,
 * investors, logo). This module adds the human/editorial layer that does NOT
 * live in the funding seed: the X handle used to pull linked tweets, the IPO
 * watch-status, HQ, founding year, and a one-line thesis. Keyed by the exact
 * `company` string the backend returns so the merge is a simple lookup.
 *
 * Page-scoped per .claude/rules/coding-standards.md O — NOT in src/constants.
 */

// The flagship company the hero celebrates. Today is the SpaceX listing, so
// SpaceX is featured with a live IPO treatment. Swap `company` to re-point the
// hero at any roster entry; the rest of the page reacts automatically.
export const FEATURED = {
  company: 'SpaceX',
  // Live event framing. The hard valuation ($350B) comes from the roster; the
  // ticker / "now trading" status is the listing event surfaced through the
  // live tweet rail below the hero (sourced, not asserted as Spectre data).
  eventTag: 'IPO DAY',
  ticker: '$SPCX',
  exchange: 'Nasdaq',
  // Live chart — NASDAQ:SPCX is a real TradingView symbol (Space Exploration
  // Technologies Corp). Embedded via the TradingView advanced-chart iframe.
  tvSymbol: 'NASDAQ:SPCX',
  // Tweet sources for the hero rail. The primary account's whole timeline is
  // kept; relatedAccounts (which post about many things) are filtered to posts
  // matching `relevance`; searches catch the broader listing buzz.
  twitter: 'SpaceX',
  relatedAccounts: ['elonmusk', 'WatcherGuru', 'Nasdaq'],
  searchQueries: ['$SPCX', 'SpaceX IPO', 'SpaceX'],
  relevance: /space\s?x|spcx/i,
}

/**
 * The spotlight company — the one the page argues is next, given its own tab.
 *
 * FEATURED above is a LISTING treatment: it has a ticker, an exchange and a
 * TradingView symbol because SpaceX trades. A private company has none of those,
 * so the spotlight is built on what a private company actually has — a priced
 * round ladder, the investors who set those prices, and the public record around
 * them. Re-point `company` at any roster entry and the tab follows; every number
 * on it comes from that entry and the live lanes, nothing is asserted here.
 */
export const SPOTLIGHT = {
  company: 'Anthropic',
  eventTag: 'IPO WATCH',
  // Tweet sources for the rail, same shape as FEATURED.
  twitter: 'AnthropicAI',
  relatedAccounts: ['AnthropicAI'],
  searchQueries: ['Anthropic', 'Anthropic IPO', 'Claude'],
  relevance: /anthropic|claude/i,
  // Prediction-market probe. Kalshi lists "Will OpenAI or Anthropic IPO first?";
  // the panel renders it only when it carries real volume, so an untraded market
  // never reads as a signal.
  predictionQuery: 'Anthropic',
}

// IPO watch-status → display tier. Monochrome by design (design-system.md K):
// status is signalled by label, not by hue.
export const IPO_STATUS = {
  ipo: 'Now trading',
  filed: 'Filed S-1',
  expected: 'IPO expected',
  rumored: 'IPO rumored',
  private: 'Private',
}

/**
 * Editorial overlay. Only the fields that aren't derivable from funding data.
 *   twitter   — X handle for official timeline + per-company tweet search
 *   hq        — headquarters
 *   founded   — founding year
 *   status    — key into IPO_STATUS
 *   timing    — short free-text timing note (shown next to status)
 *   blurb     — optional richer one-liner that overrides the seed description
 */
export const PREIPO_META = {
  SpaceX:        { twitter: 'SpaceX',        hq: 'Hawthorne, CA',  founded: 2002, status: 'ipo',      timing: 'Listing today', ticker: '$SPCX' },
  OpenAI:        { twitter: 'OpenAI',        hq: 'San Francisco',  founded: 2015, status: 'rumored' },
  ByteDance:     { twitter: 'ByteDanceTalk', hq: 'Beijing',        founded: 2012, status: 'private' },
  Anthropic:     { twitter: 'AnthropicAI',   hq: 'San Francisco',  founded: 2021, status: 'expected' },
  xAI:           { twitter: 'xai',           hq: 'Palo Alto, CA',  founded: 2023, status: 'private' },
  Stripe:        { twitter: 'stripe',        hq: 'San Francisco',  founded: 2010, status: 'rumored' },
  Shein:         { twitter: 'SHEIN_Official',hq: 'Singapore',      founded: 2008, status: 'filed' },
  Databricks:    { twitter: 'databricks',    hq: 'San Francisco',  founded: 2013, status: 'expected' },
  Revolut:       { twitter: 'RevolutApp',    hq: 'London',         founded: 2015, status: 'rumored' },
  Canva:         { twitter: 'canva',         hq: 'Sydney',         founded: 2013, status: 'rumored' },
  'Epic Games':  { twitter: 'EpicGames',     hq: 'Cary, NC',       founded: 1991, status: 'private' },
  Fanatics:      { twitter: 'Fanatics',      hq: 'New York',       founded: 1995, status: 'expected' },
  Chime:         { twitter: 'Chime',         hq: 'San Francisco',  founded: 2012, status: 'filed' },
  Discord:       { twitter: 'discord',       hq: 'San Francisco',  founded: 2015, status: 'rumored' },
  'Scale AI':    { twitter: 'scale_AI',      hq: 'San Francisco',  founded: 2016, status: 'private' },
  Celonis:       { twitter: 'Celonis',       hq: 'Munich',         founded: 2011, status: 'expected' },
  Anduril:       { twitter: 'anduriltech',   hq: 'Costa Mesa, CA', founded: 2017, status: 'expected' },
  Perplexity:    { twitter: 'perplexity_ai', hq: 'San Francisco',  founded: 2022, status: 'private' },
  Kraken:        { twitter: 'krakenfx',      hq: 'San Francisco',  founded: 2011, status: 'expected', timing: '2026 listing' },
  Ramp:          { twitter: 'tryramp',       hq: 'New York',       founded: 2019, status: 'private' },
  Rippling:      { twitter: 'Rippling',      hq: 'San Francisco',  founded: 2016, status: 'expected' },
  Plaid:         { twitter: 'Plaid',         hq: 'San Francisco',  founded: 2013, status: 'expected' },
  CoreWeave:     { twitter: 'CoreWeave',     hq: 'Roseland, NJ',   founded: 2017, status: 'expected' },
  'Figure AI':   { twitter: 'Figure_robot',  hq: 'Sunnyvale, CA',  founded: 2022, status: 'private' },
  Groq:          { twitter: 'GroqInc',       hq: 'Mountain View',  founded: 2016, status: 'private' },
  'Mistral AI':  { twitter: 'MistralAI',     hq: 'Paris',          founded: 2023, status: 'private' },
  Cohere:        { twitter: 'cohere',        hq: 'Toronto',        founded: 2019, status: 'private' },
  'Hugging Face':{ twitter: 'huggingface',   hq: 'New York',       founded: 2016, status: 'private' },
  Glean:         { twitter: 'glean',         hq: 'Palo Alto, CA',  founded: 2019, status: 'private' },
  Harvey:        { twitter: 'harvey__ai',    hq: 'San Francisco',  founded: 2022, status: 'private' },
  'Together AI': { twitter: 'togethercompute',hq: 'San Francisco', founded: 2022, status: 'private' },
  Lambda:        { twitter: 'LambdaAPI',     hq: 'San Francisco',  founded: 2012, status: 'private' },
  'Physical Intelligence': { twitter: 'physical_int', hq: 'San Francisco', founded: 2024, status: 'private' },
  'Shield AI':   { twitter: 'shieldaitech',  hq: 'San Diego',      founded: 2015, status: 'private' },
  Saronic:       { twitter: 'saronic_tech',  hq: 'Austin, TX',     founded: 2022, status: 'private' },
  Helsing:       { twitter: 'helsing_ai',    hq: 'Munich',         founded: 2021, status: 'private' },
  'Safe Superintelligence': { twitter: 'ssi', hq: 'Palo Alto, CA', founded: 2024, status: 'private' },
  'Isomorphic Labs': { twitter: 'IsomorphicLabs', hq: 'London',    founded: 2021, status: 'private' },
  'Xaira Therapeutics': { hq: 'San Francisco', founded: 2023, status: 'private' },
  'Celestial AI': { twitter: 'CelestialAI_', hq: 'Santa Clara, CA',founded: 2020, status: 'private' },
  'Commonwealth Fusion': { twitter: 'CFS_energy', hq: 'Devens, MA',founded: 2018, status: 'private' },
  'Impulse Space':{ twitter: 'Impulse_Space',hq: 'El Segundo, CA', founded: 2021, status: 'private' },
  'Stoke Space': { twitter: 'stoke_space',   hq: 'Kent, WA',       founded: 2019, status: 'private' },
  Monad:         { twitter: 'monad_xyz',     hq: 'Remote',         founded: 2022, status: 'private' },
  Berachain:     { twitter: 'berachain',     hq: 'Remote',         founded: 2021, status: 'private' },
  EigenLayer:    { twitter: 'eigenlayer',    hq: 'Seattle, WA',    founded: 2021, status: 'private' },
  Farcaster:     { twitter: 'farcaster_xyz', hq: 'Los Angeles',    founded: 2020, status: 'private' },
}

// Sort modes for the roster grid. `value` is canonical (English) — display is
// resolved via t(labelKey).
export const SORT_OPTIONS = [
  { value: 'valuation', labelKey: 'privateMarkets.preIpo.sort.valuation' },
  { value: 'multiple',  labelKey: 'privateMarkets.preIpo.sort.multiple' },
  { value: 'raised',    labelKey: 'privateMarkets.preIpo.sort.raised' },
  { value: 'recent',    labelKey: 'privateMarkets.preIpo.sort.recent' },
]

/**
 * Company name <-> URL slug. The roster is keyed by the exact display name, and
 * the route has to survive "Epic Games" and "Scale AI", so the mapping is
 * generated from the roster rather than hand-maintained in two places.
 */
export function companySlug(company) {
  return String(company || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Slug -> the exact roster name, or null when nothing matches. */
export function companyFromSlug(slug, roster) {
  const want = companySlug(slug)
  if (!want) return null
  const hit = (roster || []).find((r) => companySlug(r.company) === want)
  if (hit) return hit.company
  return Object.keys(PREIPO_META).find((name) => companySlug(name) === want) || null
}

export function preipoMeta(company) {
  return PREIPO_META[company] || null
}

// Resolve the X handle for a roster entry (editorial map → null).
export function twitterHandle(company) {
  return PREIPO_META[company]?.twitter || null
}

// Multiple → compact "12x" / "1.4x" string. null/≤1 returns null (no badge).
export function formatMultiple(mult) {
  if (mult == null || !Number.isFinite(mult) || mult <= 1.05) return null
  if (mult >= 10) return `${Math.round(mult)}x`
  return `${mult.toFixed(1)}x`
}

// Tier → short label for the valuation badge.
export const TIER_LABEL = {
  Hectocorn: 'Hectocorn',
  Decacorn: 'Decacorn',
  Unicorn: 'Unicorn',
}
