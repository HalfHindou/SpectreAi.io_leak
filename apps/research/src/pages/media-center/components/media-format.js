/**
 * Shared formatting helpers for the editorial Media surfaces (Discover, Podcasts).
 * Pure functions — no i18n. Time strings that need translation accept a `t`.
 */

/* 12:34 / 1:02:03 */
export function fmtDuration(seconds) {
  if (!seconds || seconds < 1) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/* Whole minutes, for "32 min watch" style pills */
export function fmtMinutes(seconds) {
  if (!seconds || seconds < 60) return seconds ? 1 : 0
  return Math.round(seconds / 60)
}

/* Hour-aware episode length: 1h 14m / 45m (empty when unknown) */
export function fmtEpLength(seconds) {
  if (!seconds || seconds < 60) return ''
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/* Compact count: 2.4M / 18K / 940 */
export function fmtCompact(n) {
  if (!n) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`
  return String(Math.round(n))
}

/* Translated relative time using the existing mediaCenter.time.* keys */
export function relTime(iso, t) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('mediaCenter.time.justNow')
  if (mins < 60) return t('mediaCenter.time.mAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('mediaCenter.time.hAgo', { n: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 30) return t('mediaCenter.time.dAgo', { n: days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('mediaCenter.time.moAgo', { n: months })
  return t('mediaCenter.time.yAgo', { n: Math.floor(months / 12) })
}

/* The set of canonical categories we surface, in display order */
export const CATEGORY_ORDER = [
  'Bitcoin', 'Ethereum', 'Solana', 'DeFi', 'Stablecoins',
  'RWAs', 'Macro', 'Trading', 'Altcoins', 'NFTs', 'Regulation', 'AI', 'Markets',
]

/* Derive the ordered unique category list present in a set of items */
export function deriveCategories(items) {
  const present = new Set()
  for (const it of items) {
    if (it?.category) present.add(it.category)
  }
  const ordered = CATEGORY_ORDER.filter(c => present.has(c))
  // append any categories not in the canonical order (defensive)
  for (const c of present) if (!ordered.includes(c)) ordered.push(c)
  return ordered
}

/* Flatten every item across a discover payload's sections (+ featured) */
export function flattenDiscover(data) {
  if (!data) return []
  const out = []
  const seen = new Set()
  const push = (it) => {
    if (it && it.id && !seen.has(it.id)) { seen.add(it.id); out.push(it) }
  }
  push(data.featured)
  for (const sec of (data.sections || [])) {
    for (const it of (sec.items || [])) push(it)
  }
  return out
}
