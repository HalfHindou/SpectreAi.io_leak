/**
 * usePageSearch — synchronous page-finder hook for the global search bar.
 *
 * Returns { matches, mode, strippedQuery } where:
 *   matches        — top results from PAGE_CATALOG (see searchPages)
 *   mode           — derived from query prefix: 'pages' | 'tokens' | 'ask' | 'all'
 *   strippedQuery  — query with the prefix removed (for downstream consumers)
 *
 * Prefix grammar:
 *   ">"  → pages mode  (e.g. "> fear and greed" finds /fear-greed)
 *   "$"  → tokens mode (e.g. "$ btc" forces token search)
 *   "?"  → ask mode    (e.g. "? what's the macro view" forces Whisper)
 *   (none) → all       (all three sections render together, ranked)
 */
import { useMemo } from 'react'
import { searchPages } from '@/lib/pageSearchIndex'

const PREFIX_MAP = {
  '>': 'pages',
  '$': 'tokens',
  '?': 'ask',
}

export function parsePrefix(rawQuery) {
  const q = String(rawQuery ?? '')
  const trimmed = q.trimStart()
  if (trimmed.length === 0) return { mode: 'all', strippedQuery: '' }
  const first = trimmed[0]
  if (PREFIX_MAP[first]) {
    return {
      mode: PREFIX_MAP[first],
      strippedQuery: trimmed.slice(1).trimStart(),
    }
  }
  return { mode: 'all', strippedQuery: q }
}

export function usePageSearch(rawQuery, { limit = 8 } = {}) {
  return useMemo(() => {
    const { mode, strippedQuery } = parsePrefix(rawQuery)
    // Skip the catalog search entirely when the user explicitly asked for
    // tokens or ask mode — saves the (small) work and keeps UI consistent.
    if (mode === 'tokens' || mode === 'ask') {
      return { matches: [], mode, strippedQuery }
    }
    const matches = searchPages(strippedQuery, { limit })
    return { matches, mode, strippedQuery }
  }, [rawQuery, limit])
}
