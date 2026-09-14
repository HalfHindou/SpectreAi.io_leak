/**
 * Shared utilities for X Dash page, fast explore, and full dossier overlay.
 *
 * i18n contract:
 *   - relativeTime / relativeFutureTime / formatDateTime accept an optional
 *     `t` translator (i18next). When omitted they fall back to English so
 *     legacy call sites keep working until they migrate to the `t`-aware
 *     form. Locale-aware date formatting uses navigator default when no
 *     `locale` is passed.
 *   - The label-bearing helpers (heatBadge / getSignalPosture /
 *     getQualityTone / getFollowerTier / getAuthorRoleLabel /
 *     getAuthorDomainVerdict / formatRankDelta / accountAge) now return
 *     `{ key, fallback, params? }` style descriptors alongside their CSS
 *     class so consumers can resolve `t(key, fallback, params)` at render.
 */
// On-chain tokens open the standalone trading terminal (better charts) — the
// canonical helper lives in @/lib/trading-terminal; re-exported here so X Dash
// callers keep a single local import surface.
export { openTradingTerminal, tradingTerminalUrl } from '@/lib/trading-terminal'

const URL_RE = /https?:\/\/[^\s<)}\]]+/g

/* Translate via injected `t` when provided, else fall back to the English
   default. Keeps the helpers usable from non-React modules. */
function tt(t, key, fallback, params) {
  if (typeof t === 'function') return t(key, fallback, params)
  if (!params) return fallback
  let out = fallback
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
  }
  return out
}

export function relativeTime(dateStr, t) {
  if (!dateStr) return '-'
  const stamp = new Date(dateStr).getTime()
  if (!Number.isFinite(stamp)) return '-'
  const diff = Date.now() - stamp
  if (diff < 0) return relativeFutureTime(dateStr, t)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return tt(t, 'time.ago.justNow', 'just now')
  if (mins < 60) return tt(t, 'time.ago.minutes', '{{count}}m ago', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return tt(t, 'time.ago.hours', '{{count}}h ago', { count: hrs })
  const days = Math.floor(hrs / 24)
  return tt(t, 'time.ago.days', '{{count}}d ago', { count: days })
}

export function relativeFutureTime(dateStr, t) {
  if (!dateStr) return '-'
  const stamp = new Date(dateStr).getTime()
  if (!Number.isFinite(stamp)) return '-'
  const diff = stamp - Date.now()
  if (diff <= 0) return tt(t, 'xDash.utils.future.now', 'now')
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return tt(t, 'xDash.utils.future.under1m', 'in <1m')
  if (mins < 60) return tt(t, 'xDash.utils.future.minutes', 'in {{count}}m', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return tt(t, 'xDash.utils.future.hours', 'in {{count}}h', { count: hrs })
  const days = Math.floor(hrs / 24)
  return tt(t, 'xDash.utils.future.days', 'in {{count}}d', { count: days })
}

export function formatDateTime(dateStr, opts = {}) {
  if (!dateStr) {
    return typeof opts.t === 'function'
      ? opts.t('xDash.utils.timeUnavailable', 'Time unavailable')
      : 'Time unavailable'
  }
  const stamp = new Date(dateStr)
  if (!Number.isFinite(stamp.getTime())) {
    return typeof opts.t === 'function'
      ? opts.t('xDash.utils.timeUnavailable', 'Time unavailable')
      : 'Time unavailable'
  }
  const { withZone = true, locale } = opts
  const formatted = stamp.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    stamp.toLocaleTimeString(locale || undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
  return withZone ? `${formatted} UTC` : formatted
}

export function formatNum(n, opts = {}) {
  if (n == null || n === '') return '-'
  const value = Number(n)
  if (Number.isNaN(value)) return '-'
  const { digits = 1, locale, maxFraction } = opts
  if (value >= 1e9) return `${(value / 1e9).toFixed(digits)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(digits)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(digits)}K`
  // Sub-1000 falls through to toLocaleString, whose DEFAULT keeps up to 3
  // fraction digits - float metrics (weighted engagement, score sums) were
  // rendering as "801.434" / "146.298", which also reads as a thousands
  // separator in many locales. Callers displaying such floats pass
  // maxFraction to cap it. Opt-in only: at least one call site formats a
  // token PRICE this way (sub-cent values), where capping would destroy it.
  if (maxFraction != null) {
    return value.toLocaleString(locale || undefined, { maximumFractionDigits: maxFraction })
  }
  return value.toLocaleString(locale || undefined)
}

/* Compact USD formatter — $1.2M / $237M / $2.1B / $4.3K. Returns null for
   zero / non-finite so callers can fall back. Lifted from xd-thesis.jsx so the
   thesis panel + the Provenance Tape share one implementation. */
export function fmtUsd(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return null
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const fmt = (v, suffix) => {
    // 1 decimal below 100, none at/above — $1.2M, $237M.
    const r = v < 100 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toString()
    return `${sign}$${r}${suffix}`
  }
  if (abs >= 1e12) return fmt(abs / 1e12, 'T')
  if (abs >= 1e9) return fmt(abs / 1e9, 'B')
  if (abs >= 1e6) return fmt(abs / 1e6, 'M')
  if (abs >= 1e3) return fmt(abs / 1e3, 'K')
  return `${sign}$${Math.round(abs)}`
}

export function formatPercent(value, digits = 0) {
  if (value == null || value === '') return '-'
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return '-'
  return `${(numeric * 100).toFixed(digits)}%`
}

export function humanizeLabel(value) {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim()
  if (!text) return ''
  return text
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/* heatBadge — velocity > 2 / > 1 / else. Returns `{ key, fallback, label, cls }`
   so consumers can do `t(badge.key, badge.fallback)` while legacy callers
   that read `.label` keep rendering EN. */
export function heatBadge(velocity) {
  if (velocity > 2) return { key: 'xDash.utils.heat.hot', fallback: 'Hot', label: 'Hot', cls: 'xd-badge--hot' }
  if (velocity > 1) return { key: 'xDash.utils.heat.warm', fallback: 'Warm', label: 'Warm', cls: 'xd-badge--warm' }
  return { key: 'xDash.utils.heat.cool', fallback: 'Cool', label: 'Cool', cls: 'xd-badge--cool' }
}

export function getSignalPosture(metrics = {}, scheduler = {}) {
  const velocity = Number(metrics.velocity_ratio || 0)
  const cleanSignal = Number(metrics.clean_signal_score_24h || metrics.clean_signal_score || 0)
  const tier = String(scheduler.tier || '').toLowerCase()

  if (tier === 'hot' || velocity >= 1.75 || cleanSignal >= 0.76) {
    return { key: 'xDash.utils.posture.hot', fallback: 'Hot', label: 'Hot', cls: 'is-hot' }
  }
  if (tier === 'warm' || velocity >= 1 || cleanSignal >= 0.58) {
    return { key: 'xDash.utils.posture.warm', fallback: 'Warm', label: 'Warm', cls: 'is-warm' }
  }
  return { key: 'xDash.utils.posture.watch', fallback: 'Watch', label: 'Watch', cls: 'is-watch' }
}

export function getQualityTone(quality = {}) {
  const status = String(quality.quality_status || '').toLowerCase()
  const clean = Number(quality.clean_signal_score_24h || quality.clean_signal_score || 0)

  if (status.includes('hard') || clean < 0.45) {
    return { key: 'xDash.utils.qualityTone.fragile', fallback: 'Fragile', label: 'Fragile', cls: 'is-fragile' }
  }
  if (status.includes('soft') || clean < 0.7) {
    return { key: 'xDash.utils.qualityTone.guarded', fallback: 'Guarded', label: 'Guarded', cls: 'is-guarded' }
  }
  return { key: 'xDash.utils.qualityTone.clean', fallback: 'Clean', label: 'Clean', cls: 'is-clean' }
}

export function getFollowerTier(followers) {
  const count = Number(followers || 0)
  if (count >= 100000) return { key: 'xDash.utils.tier.kol', fallback: 'KOL', text: 'KOL', cls: 'tier-kol' }
  if (count >= 10000) return { key: 'xDash.utils.tier.influencer', fallback: 'Influencer', text: 'Influencer', cls: 'tier-influencer' }
  if (count >= 1000) return { key: 'xDash.utils.tier.creator', fallback: 'Creator', text: 'Creator', cls: 'tier-creator' }
  return { key: 'xDash.utils.tier.user', fallback: 'User', text: 'User', cls: 'tier-user' }
}

function mentionKey(mention) {
  if (!mention) return ''
  const tweetId = String(mention.tweet?.tweet_id || '')
  if (tweetId) return tweetId
  return [
    String(mention.token?.cg_id || ''),
    String(mention.author?.rest_id || mention.author?.screen_name || ''),
    String(mention.tweet?.created_at_utc || ''),
  ].join(':')
}

export function sortMentionsByRecent(mentions = []) {
  return [...mentions].sort((left, right) => {
    const stampDelta = String(right?.tweet?.created_at_utc || '').localeCompare(String(left?.tweet?.created_at_utc || ''))
    if (stampDelta !== 0) return stampDelta
    return Number(right?.derived?.weighted_engagement || 0) - Number(left?.derived?.weighted_engagement || 0)
  })
}

export function sortMentionsByWeighted(mentions = []) {
  return [...mentions].sort((left, right) => {
    const weightDelta = Number(right?.derived?.weighted_engagement || 0) - Number(left?.derived?.weighted_engagement || 0)
    if (weightDelta !== 0) return weightDelta
    return String(right?.tweet?.created_at_utc || '').localeCompare(String(left?.tweet?.created_at_utc || ''))
  })
}

export function getMentionText(mention) {
  return String(mention?.tweet?.full_text || mention?.tweet?.text || '').replace(/\s+/g, ' ').trim()
}

export function getMentionUrl(mention) {
  const direct = String(mention?.tweet?.x_url || '').trim()
  if (direct) return direct
  const handle = String(mention?.author?.screen_name || '').trim()
  const tweetId = String(mention?.tweet?.tweet_id || '').trim()
  if (handle && tweetId) return `https://x.com/${handle}/status/${tweetId}`
  return null
}

export function getMentionMediaUrl(mention) {
  const tweet = mention?.tweet || {}
  const candidates = [
    tweet.media_preview_url,
    tweet.media_url,
    tweet.media_url_https,
    tweet.preview_image_url,
    tweet.image_url,
    tweet.thumbnail_url,
    Array.isArray(tweet.media_urls) ? tweet.media_urls[0] : null,
    Array.isArray(tweet.media) ? tweet.media[0]?.media_url_https || tweet.media[0]?.media_url : null,
    tweet.entities?.media?.[0]?.media_url_https,
    tweet.entities?.media?.[0]?.media_url,
    tweet.extended_entities?.media?.[0]?.media_url_https,
    tweet.extended_entities?.media?.[0]?.media_url,
  ]
  const found = candidates.find(Boolean)
  return found ? String(found) : null
}

export function getAuthorId(author) {
  return String(author?.rest_id || author?.id || author?.author_rest_id || '').trim()
}

function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean)
  return []
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean))]
}

export function splitTextLinks(text) {
  if (!text || typeof text !== 'string') return [{ type: 'text', value: text || '' }]
  const segments = []
  let lastIndex = 0
  let match
  URL_RE.lastIndex = 0

  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    const url = match[0].replace(/[.,;:!?)]+$/, '')
    segments.push({ type: 'link', value: url })
    lastIndex = match.index + url.length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments.length ? segments : [{ type: 'text', value: text }]
}

/* ---------- Mention match strength ----------
 * Source of truth = mention.match.strength (NOT matched_by). Returns a
 * normalized descriptor used by the mention card chip + filter toggle.
 *
 *   primary       direct token mention, full confidence
 *   contextual    ecosystem / handle context, secondary subject
 *   reply_context reply-chain context, the tweet itself is about someone
 *                 else but the parent referenced the token
 *   weak          low-confidence context, hidden by default
 *
 * `primaryCashtags` is the list of cashtags the tweet was REALLY about
 * (only populated for non-primary matches so the UI can show "main
 * subject $XYZ" next to a contextual chip).
 */
const STRENGTH_META = {
  primary: { kind: 'primary', label: 'Primary', tone: 'primary', key: 'xDash.utils.strength.primary', fallback: 'Primary' },
  contextual: { kind: 'contextual', label: 'Contextual', tone: 'context', key: 'xDash.utils.strength.contextual', fallback: 'Contextual' },
  reply_context: { kind: 'reply_context', label: 'Reply context', tone: 'reply', key: 'xDash.utils.strength.replyContext', fallback: 'Reply context' },
  weak: { kind: 'weak', label: 'Weak', tone: 'weak', key: 'xDash.utils.strength.weak', fallback: 'Weak' },
}

/* Priority used to break dominant-strength ties: a single primary always
   wins over many weaks; primary > contextual > reply_context > weak. */
const STRENGTH_PRIORITY = ['primary', 'contextual', 'reply_context', 'weak']

/* Aggregates mention.match.strength across a mentions array, grouped by
   the caller-supplied key fn. Returns Map<key, summary>. Each summary:
   { counts: {primary,contextual,reply_context,weak}, dominant, total }
   where `dominant` is the kind to render as the row's at-a-glance chip
   (primary preferred on ties). Used by the author drawer's Top tokens
   list (key by cg_id) and the token drawer's Carriers list (key by
   author screen_name / rest_id). */
export function buildStrengthLookup(mentions = [], keyFn) {
  const out = new Map()
  if (!Array.isArray(mentions) || typeof keyFn !== 'function') return out
  for (const mention of mentions) {
    const key = keyFn(mention)
    if (!key) continue
    const strength = String(mention?.match?.strength || '').toLowerCase()
    if (!STRENGTH_META[strength]) continue
    let entry = out.get(key)
    if (!entry) {
      entry = { counts: { primary: 0, contextual: 0, reply_context: 0, weak: 0 }, dominant: null, total: 0 }
      out.set(key, entry)
    }
    entry.counts[strength] = (entry.counts[strength] || 0) + 1
    entry.total += 1
  }
  for (const entry of out.values()) {
    let best = null
    let bestCount = -1
    let bestIdx = STRENGTH_PRIORITY.length
    for (const kind of STRENGTH_PRIORITY) {
      const c = entry.counts[kind] || 0
      const idx = STRENGTH_PRIORITY.indexOf(kind)
      if (c > bestCount || (c === bestCount && c > 0 && idx < bestIdx)) {
        best = kind
        bestCount = c
        bestIdx = idx
      }
    }
    entry.dominant = best
  }
  return out
}

/* Friendly summary for the strength chip's hover tooltip:
   "12 primary · 3 contextual · 1 reply context" */
export function describeStrengthSummary(summary) {
  if (!summary) return ''
  const parts = []
  for (const kind of STRENGTH_PRIORITY) {
    const n = summary.counts?.[kind] || 0
    if (!n) continue
    parts.push(`${n} ${STRENGTH_META[kind].label.toLowerCase()}`)
  }
  return parts.join(' · ')
}

export const MENTION_STRENGTH_META = STRENGTH_META

export function getMentionMatch(mention) {
  const match = mention?.match || {}
  const raw = String(match.strength || '').toLowerCase()
  const meta = STRENGTH_META[raw] || { kind: 'unknown', label: '', tone: 'context' }
  const primaryCashtags = uniqueStrings(toList(match.primary_cashtags))
  const detectedCashtags = uniqueStrings(toList(match.detected_cashtags))
  return {
    kind: meta.kind,
    label: meta.label,
    tone: meta.tone,
    reason: match.reason || '',
    role: match.role || '',
    scoreWeight: Number(match.score_weight || 0),
    primaryCashtags,
    detectedCashtags,
    hideByDefault: meta.kind === 'weak',
  }
}

/* getMentionContextPills - AUTHOR + ENGAGEMENT properties only.
 * Match strength now lives in its own chip via getMentionMatch().
 * Don't infer cashtag/handle/conviction pills from matched_by anymore
 * - that signal is expressed by match.strength as source of truth. */
export function getMentionContextPills(mention, tokenInfo = {}) {
  const pills = []
  const authorHandle = String(mention?.author?.screen_name || '').replace(/^@/, '').toLowerCase()
  const tokenHandle = String(tokenInfo?.handle || '').replace(/^@/, '').toLowerCase()
  const followers = Number(mention?.author?.followers_count || 0)
  const weighted = Number(mention?.derived?.weighted_engagement || 0)

  if (tokenHandle && authorHandle && authorHandle === tokenHandle) pills.push('official')
  if (followers >= 100000) pills.push('KOL')
  if (weighted >= 400) pills.push('high impact')

  return uniqueStrings(pills)
}

export function filterMentionsByMode(mentions = [], mode = 'recent', tokenInfo = {}) {
  const authorHandle = String(tokenInfo?.handle || '').replace(/^@/, '').toLowerCase()

  if (mode === 'impact') {
    return sortMentionsByWeighted(mentions)
  }

  if (mode === 'official') {
    const officialMentions = mentions.filter((mention) => {
      const mentionHandle = String(mention?.author?.screen_name || '').replace(/^@/, '').toLowerCase()
      return authorHandle && mentionHandle && mentionHandle === authorHandle
    })
    return officialMentions.length ? sortMentionsByRecent(officialMentions) : []
  }

  if (mode === 'kol') {
    const kolMentions = mentions.filter((mention) => Number(mention?.author?.followers_count || 0) >= 100000)
    return kolMentions.length ? sortMentionsByRecent(kolMentions) : []
  }

  return sortMentionsByRecent(mentions)
}

/* accountAge — returns a localized string. Accepts optional `t` translator
   so non-React modules can still call this helper. */
export function accountAge(createdAt, t) {
  if (!createdAt) return null
  const stamp = new Date(createdAt)
  if (!Number.isFinite(stamp.getTime())) return null
  const diff = Date.now() - stamp.getTime()
  if (diff <= 0) return null
  const years = diff / (365.25 * 24 * 3600 * 1000)
  if (years >= 1) return tt(t, 'xDash.utils.accountAge.years', '{{count}}y old', { count: years.toFixed(1) })
  const months = Math.max(1, Math.floor(years * 12))
  return tt(t, 'xDash.utils.accountAge.months', '{{count}}mo old', { count: months })
}

/* formatRankDelta — returns string. Pass `t` for translated "Flat". */
export function formatRankDelta(token = {}, t) {
  const delta = Number(token.rank_change_positions || 0)
  if (!delta) return tt(t, 'xDash.utils.rankDelta.flat', 'Flat')
  if (delta > 0) return `+${delta}`
  return String(delta)
}

export function normalizeAuthorTokenBreadth(tokens = []) {
  return toList(tokens).map((entry) => {
    const token = entry?.token || entry?.asset || entry || {}
    return {
      cgId: token.cg_id || token.token_id || entry.cg_id || entry.token_id || '',
      name: token.name || entry.name || entry.symbol || 'Tracked token',
      symbol: token.symbol || entry.symbol || '',
      image: token.image_small || token.image_url || entry.image_small || entry.image_url || '',
      mentionCount: Number(entry.mention_count || entry.recent_mentions_24h || entry.total_mentions || 0),
      weightedEngagement: Number(entry.weighted_engagement || entry.total_weighted_engagement || 0),
      latestMentionAt: entry.latest_mention_at || entry.last_seen_at || null,
    }
  }).filter((entry) => entry.cgId || entry.symbol || entry.name)
}

/* Order a token's 3 bootstrap top_authors by weighted engagement, biggest
   carrier first. Pure - never mutates, never fetches. Used by CarrierCluster
   so the leaderboard cell stays cheap (no detail call). */
export function rankTopAuthors(topAuthors = []) {
  if (!Array.isArray(topAuthors)) return []
  return [...topAuthors]
    .filter(Boolean)
    .sort((left, right) => {
      const weightDelta = Number(right?.total_weighted_engagement || 0) - Number(left?.total_weighted_engagement || 0)
      if (weightDelta !== 0) return weightDelta
      return Number(right?.mention_count || 0) - Number(left?.mention_count || 0)
    })
}

/* Heuristic verified check - bootstrap top_authors lack an explicit flag,
   so fall back to the richer detail-author fields when present. */
export function looksVerified(author = {}) {
  return Boolean(
    author.is_blue_verified || author.legacy_verified || author.verified
    || author.is_verified || author.blue_verified,
  )
}

/* Build the full per-token carrier board for the token drawer.
 *
 * Merges three sources the detail endpoint provides:
 *   - top_authors (~8): authoritative per-token mention_count + weighted eng
 *   - authors (~13): the fuller creator set, same authoritative shape
 *   - mentions[]: unique authors seen in the kept-mention sample
 *
 * Dedups by author id. The authoritative per-token metrics from
 * top_authors / authors WIN over anything derived from the mention sample
 * (the mention array is a sample, not the full 24h corpus). Mention-only
 * authors keep their derived counts. Ranked by weighted engagement, then
 * mention count - the spec's ordering ("who is actually moving it").
 */
export function buildCarrierBoard(topAuthors = [], authors = [], mentions = []) {
  const board = new Map()

  /* 1. mention-sample authors first - lowest authority, may be overwritten */
  for (const mention of toList(mentions)) {
    const author = mention?.author || {}
    const id = getAuthorId(author)
    if (!id) continue
    const prev = board.get(id) || {
      ...author,
      author_rest_id: id,
      mention_count: 0,
      total_weighted_engagement: 0,
      proof_mentions: 0,
      _authoritative: false,
    }
    prev.proof_mentions += 1
    prev.total_weighted_engagement += Number(mention?.derived?.weighted_engagement || 0)
    prev.mention_count = Math.max(Number(prev.mention_count || 0), prev.proof_mentions)
    const createdAt = mention?.tweet?.created_at_utc
    if (createdAt && (!prev.last_seen_at || createdAt > prev.last_seen_at)) {
      prev.last_seen_at = createdAt
    }
    board.set(id, prev)
  }

  /* 2. authors[] then top_authors[] - authoritative per-token metrics win.
        top_authors applied last so its identity fields take final priority. */
  for (const author of [...toList(authors), ...toList(topAuthors)]) {
    const id = getAuthorId(author)
    if (!id) continue
    const prev = board.get(id) || {}
    board.set(id, {
      ...prev,
      ...author,
      author_rest_id: author.author_rest_id || author.rest_id || id,
      mention_count: Number(author.mention_count || prev.mention_count || 0),
      total_weighted_engagement: Number(
        author.total_weighted_engagement || prev.total_weighted_engagement || 0,
      ),
      proof_mentions: Number(prev.proof_mentions || 0),
      last_seen_at: author.last_seen_at || prev.last_seen_at || null,
      _authoritative: true,
    })
  }

  return [...board.values()].sort((left, right) => {
    const engDelta = Number(right.total_weighted_engagement || 0)
      - Number(left.total_weighted_engagement || 0)
    if (engDelta !== 0) return engDelta
    return Number(right.mention_count || 0) - Number(left.mention_count || 0)
  })
}

export function buildSignalCarriers(topAuthors = [], mentions = []) {
  const carrierMap = new Map()

  for (const mention of mentions) {
    const author = mention?.author || {}
    const authorId = getAuthorId(author)
    if (!authorId) continue
    const previous = carrierMap.get(authorId) || {
      ...author,
      author_rest_id: authorId,
      mention_count: 0,
      proof_mentions: 0,
      total_weighted_engagement: 0,
      last_seen_at: null,
    }

    previous.proof_mentions += 1
    previous.mention_count = Math.max(Number(previous.mention_count || 0), previous.proof_mentions)
    previous.total_weighted_engagement += Number(mention?.derived?.weighted_engagement || 0)

    const createdAt = mention?.tweet?.created_at_utc
    if (createdAt && (!previous.last_seen_at || createdAt > previous.last_seen_at)) {
      previous.last_seen_at = createdAt
    }

    carrierMap.set(authorId, previous)
  }

  for (const author of topAuthors) {
    const authorId = getAuthorId(author)
    if (!authorId) continue
    const previous = carrierMap.get(authorId) || {}
    carrierMap.set(authorId, {
      ...author,
      ...previous,
      author_rest_id: author.author_rest_id || authorId,
      proof_mentions: Number(previous.proof_mentions || 0),
      mention_count: Number(previous.mention_count || author.mention_count || 0),
      total_weighted_engagement: Number(previous.total_weighted_engagement || author.total_weighted_engagement || 0),
      last_seen_at: previous.last_seen_at || author.last_seen_at || null,
    })
  }

  return [...carrierMap.values()].sort((left, right) => {
    const leftHasProof = Number(left.proof_mentions || 0) > 0 ? 1 : 0
    const rightHasProof = Number(right.proof_mentions || 0) > 0 ? 1 : 0
    if (rightHasProof !== leftHasProof) return rightHasProof - leftHasProof

    const proofDelta = Number(right.proof_mentions || 0) - Number(left.proof_mentions || 0)
    if (proofDelta !== 0) return proofDelta

    const weightedDelta = Number(right.total_weighted_engagement || 0) - Number(left.total_weighted_engagement || 0)
    if (weightedDelta !== 0) return weightedDelta

    return Number(right.mention_count || 0) - Number(left.mention_count || 0)
  })
}

export function normalizeXDashDetail(detail) {
  if (!detail) {
    return {
      tokenInfo: {},
      metrics: {},
      quality: {},
      topAuthors: [],
      authors: [],
      mentions: [],
      topMentions: [],
      primaryMentions: [],
      mergedMentions: [],
      latestMentionAt: null,
      fetchCoverage: null,
      scheduler: {},
      state: {},
      queryList: [],
      intelligence: {},
      latestIntelligence: {},
      eventCandidates: {},
      trackedTweets: [],
      pagination: null,
      referenceNow: null,
      momentumEntry: null,
    }
  }

  const tokenEntry = detail.token && typeof detail.token === 'object' && (detail.token.token || detail.token.metrics)
    ? detail.token
    : null

  const tokenInfoRaw = tokenEntry?.token || detail.asset || detail.token || {}
  /* The per-token detail scatters identity across envelopes: `token` carries
     name/symbol/chain but global_rank / market_cap / the contract live on
     `state` (seen on zignaly: rank 575 + mcap present upstream while the
     drawer showed "Rank -"). Backfill so consumers read ONE object. */
  const stateEnvelope = detail.state || {}
  const tokenInfo = {
    ...tokenInfoRaw,
    global_rank: tokenInfoRaw.global_rank ?? stateEnvelope.global_rank ?? null,
    market_cap: tokenInfoRaw.market_cap ?? stateEnvelope.market_cap ?? null,
    contract_address: tokenInfoRaw.contract_address
      || stateEnvelope.onchain_signal?.contract_address
      || tokenInfoRaw.contract_address,
  }
  const metrics = tokenEntry?.metrics || detail.metrics || {}
  const quality = tokenEntry?.quality || detail.quality || {}
  const topAuthors = toList(tokenEntry?.top_authors || detail.top_authors || detail.authors)
  /* fuller per-token creator set (~13) the detail endpoint returns alongside
     top_authors (~8) - kept separate so the Carriers board can merge both. */
  const authors = toList(tokenEntry?.authors || detail.authors)
  const mentions = toList(detail.mentions)
  const explicitTopMentions = toList(detail.top_mentions)
  const primaryMentions = explicitTopMentions.length ? explicitTopMentions : sortMentionsByWeighted(mentions)

  const mergedMap = new Map()
  for (const mention of [...primaryMentions, ...mentions]) {
    const key = mentionKey(mention)
    if (!key || mergedMap.has(key)) continue
    mergedMap.set(key, mention)
  }

  const state = detail.state || {}
  const fetchCoverage = state.coverage || detail.fetch_coverage || tokenEntry?.fetch_coverage || null
  const scheduler = state.scheduler || fetchCoverage?.scheduler || detail.scheduler || {}
  const intelligence = detail.intelligence || detail.intel || {}

  return {
    tokenInfo,
    metrics,
    quality,
    topAuthors,
    authors,
    mentions,
    topMentions: explicitTopMentions,
    primaryMentions,
    mergedMentions: [...mergedMap.values()],
    latestMentionAt: detail.latest_kept_created_at || detail.latest_mention_at || tokenEntry?.latest_mention_at || null,
    fetchCoverage,
    scheduler,
    state,
    queryList: toList(fetchCoverage?.queries || state.queries),
    intelligence,
    /* X-Dash carries the Momentum Top-N entry record per token on the
       detail response. Surfacing it here so the x-dash drawer can render
       the Spectre Momentum block (entry rank, entry mcap, % since entry,
       entry-time mentions/authors). */
    momentumEntry: detail.momentum_entry || tokenEntry?.momentum_entry || null,
    latestIntelligence: intelligence.latest || {},
    eventCandidates: intelligence.latest_event_candidates || {},
    trackedTweets: toList(state.tracked_tweets),
    pagination: detail.pagination || tokenEntry?.pagination || null,
    referenceNow: detail.reference_now_utc || detail.generated_at_utc || intelligence.latest?.snapshot_at || null,
  }
}

export function normalizeXDashAuthorDetail(detail) {
  if (!detail) {
    return {
      author: {},
      tokens: [],
      mentions: [],
      topMentions: [],
      primaryMentions: [],
      totals: {},
      history: null,
      latestMentionAt: null,
      intelligence: {},
      latestSignal: {},
      domainSkills: [],
      recentTransitions: [],
      referenceNow: null,
    }
  }

  const mentions = toList(detail.mentions)
  const topMentions = toList(detail.top_mentions)
  const intelligence = detail.intelligence || detail.intel || {}

  return {
    author: detail.author || {},
    tokens: normalizeAuthorTokenBreadth(detail.tokens),
    mentions,
    topMentions,
    primaryMentions: topMentions.length ? topMentions : sortMentionsByWeighted(mentions),
    totals: detail.totals || {},
    history: detail.history || null,
    latestMentionAt: detail.latest_mention_at || detail.author?.last_seen_at || null,
    intelligence,
    latestSignal: intelligence.latest_signal || {},
    domainSkills: toList(intelligence.latest_domain_skills),
    recentTransitions: toList(intelligence.recent_transitions || intelligence.transitions),
    referenceNow: detail.reference_now_utc || detail.generated_at_utc || intelligence.latest_signal?.snapshot_at || null,
  }
}

/* getAuthorRoleLabel — accepts optional `t` translator. Returns a localized
   string. Legacy call sites that omit `t` still get English. */
export function getAuthorRoleLabel(author = {}, detail = {}, t) {
  const latest = detail?.latestSignal || detail?.intelligence?.latest_signal || {}
  const leadLag = latest.lead_lag || {}
  const hitRate = Number(leadLag.early_signal_hit_rate_7d || author.early_signal_hit_rate_7d || 0)
  const leadMinutes = leadLag.avg_lead_minutes_7d ?? author.avg_lead_minutes_7d ?? null
  const replyContext = Number(latest.reply_context_mentions_7d || author.reply_context_mentions_7d || 0)
  const followers = Number(author.followers_count || latest.followers_count || 0)

  if (hitRate >= 0.5 && leadMinutes != null && leadMinutes <= 180) return tt(t, 'xDash.utils.roleLabel.fastScout', 'Fast scout')
  if (replyContext >= 12) return tt(t, 'xDash.utils.roleLabel.replyAmplifier', 'Reply amplifier')
  if (followers >= 100000) return tt(t, 'xDash.utils.roleLabel.broadcaster', 'Broadcaster')
  if (hitRate >= 0.35) return tt(t, 'xDash.utils.roleLabel.reliableTracker', 'Reliable tracker')
  if (followers >= 10000) return tt(t, 'xDash.utils.roleLabel.signalCarrier', 'Signal carrier')
  return tt(t, 'xDash.utils.roleLabel.watching', 'Watching')
}

export function getAuthorDomainVerdict(domainSkills = [], transitions = [], t) {
  const lead = domainSkills[0]
  const topShift = [...(transitions || [])].sort((left, right) => Number(right?.weighted_engagement || 0) - Number(left?.weighted_engagement || 0))[0]
  const newLane = tt(t, 'xDash.utils.domainVerdict.newLane', 'a new lane')
  const unknown = tt(t, 'xDash.utils.domainVerdict.unknown', 'unknown')
  if (lead && topShift) {
    return tt(
      t,
      'xDash.utils.domainVerdict.anchorAndRotation',
      '{{lead}} still anchors this account while flow starts moving into {{into}}',
      {
        lead: lead.domain_label || lead.domain_key,
        into: topShift.current_domain?.label || newLane,
      },
    )
  }
  if (lead) {
    return tt(
      t,
      'xDash.utils.domainVerdict.anchorOnly',
      '{{lead}} is still the dominant operating lane',
      { lead: lead.domain_label || lead.domain_key },
    )
  }
  if (topShift) {
    return tt(
      t,
      'xDash.utils.domainVerdict.rotationOnly',
      'Rotation is active from {{from}} into {{into}}',
      {
        from: topShift.previous_domain?.label || unknown,
        into: topShift.current_domain?.label || unknown,
      },
    )
  }
  return tt(t, 'xDash.utils.domainVerdict.warming', 'Domain edge is still warming for this snapshot')
}

/**
 * Narrative "heat" — how much of the board's CLEAN attention a cluster owns.
 * = mention_share (share of all board mentions) × authenticity discount
 *   × engagement magnitude (log-damped).
 *
 * Deliberately NOT score_sum: score_sum sums per-token scores, so it rewards a
 * narrative for having MANY tokens (breadth). That buried Robinhood (13 red-hot
 * tokens) below Gaming (47 quiet tokens) even though Robinhood had ~3× the
 * mentions, authors, engagement and mention-share. Heat measures intensity, not
 * basket size. Shared by the Narratives view AND the leaderboard's right-rail
 * "Narrative leaders" so both surfaces rank identically.
 */
export function narrativeHeat(it) {
  const share = Number(it?.mention_share) || 0
  const clean = Number(it?.average_clean_signal) || 0
  const eng = Number(it?.weighted_engagement) || 0
  return share * (0.5 + 0.5 * clean) * (1 + Math.log10(1 + eng))
}

/* ---------- Custom market-cap band ----------
   Lives here (not in x-dash-page) so the command bar AND the leaderboard's
   empty state can share it without a circular page <-> view import.

   parseMcapInput accepts what a trader would actually type: "500k", "2M",
   "1.5b", "$750K", "12,500,000". A BARE number is read as MILLIONS ("10" ->
   $10M), the range most of the board sits in - and the resolved band is echoed
   back in the dropdown label, so the interpretation is never left to guesswork.
   Returns null for blank/garbage, which callers treat as open-ended. */
const MCAP_UNITS = { k: 1e3, m: 1e6, b: 1e9 }
export function parseMcapInput(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[$,\s]/g, '')
  if (!s) return null
  const m = s.match(/^([0-9]*\.?[0-9]+)([kmb])?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  return n * (m[2] ? MCAP_UNITS[m[2]] : 1e6)
}

/* Ceiling presets. The upstream `market` param only does open-ended FLOORS
   (gt1m/gt10m/...), so "< $1M" has to be a client-side band - the board's value
   is finding SMALL caps that are being talked about, not confirming that BTC is
   mentioned. Keys map to the band's max; min stays open. */
export const MCAP_PRESET_MAX = {
  lt1m: 1e6,
  lt10m: 1e7,
  lt100m: 1e8,
  lt1b: 1e9,
}

/* True when a market cap sits inside the band. A row with no usable mcap is
   EXCLUDED while a band is active - a null can't be proven in range, and
   keeping it would pad the board with unfilterable rows. */
export function matchesMcapBand(mcap, band) {
  if (!band) return true
  const mc = Number(mcap)
  if (!Number.isFinite(mc) || mc <= 0) return false
  if (band.min != null && mc < band.min) return false
  if (band.max != null && mc > band.max) return false
  return true
}

/* Compact USD for the band label: 750000 -> "$750K", 2e6 -> "$2M". */
export function formatMcapShort(usd) {
  const n = Number(usd)
  if (!Number.isFinite(n) || n <= 0) return '-'
  const [div, suffix] = n >= 1e9 ? [1e9, 'B'] : n >= 1e6 ? [1e6, 'M'] : n >= 1e3 ? [1e3, 'K'] : [1, '']
  const v = n / div
  return `$${v % 1 === 0 ? v : parseFloat(v.toFixed(2))}${suffix}`
}
