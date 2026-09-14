/**
 * Serverless mirror of packages/server/content/store.js.
 * Reads from the build-time bundle written by scripts/build-intelligence-content.mjs.
 * Bundle is loaded once per cold start and held in module memory.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const TYPES = ['daily', 'crypto', 'stocks', 'research', 'news', 'calendar']

// ── Live source ────────────────────────────────────────────────────────────
// The bundle below is a build artefact: it can only ever contain what was
// COMMITTED when the deploy ran, and packages/server/content/articles/ is
// gitignored - which is why prod served 2026-06-11 articles on 2026-07-29.
// The newsroom now publishes each article to the data API as it writes it
// (packages/server/content/store.js), so that is the live source and the
// bundle is the cold-start fallback. Every helper here fails SOFT: any error,
// timeout or empty answer falls through to the bundle, so a box outage
// degrades to stale-but-working rather than an empty hub.
const API_BASE = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
// Same resolution chain the v1 proxy uses (handlers/extended-proxy.js) so this
// picks up whichever of the two the Vercel project actually has set.
const API_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_BRIDGE_KEY || ''
const BOX_TIMEOUT_MS = 4000

async function boxFetch(path) {
  if (!API_KEY) return null
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'X-API-Key': API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(BOX_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json?.data ?? null
  } catch {
    return null
  }
}

/** Live list. Returns null (not []) when unavailable so callers can fall back. */
export async function fetchLiveList({ types, limit }) {
  const q = new URLSearchParams()
  q.set('limit', String(Math.min(limit || 50, 200)))
  if (types?.length) q.set('type', types.join(','))
  const data = await boxFetch(`/v1/intel/articles?${q}`)
  const rows = Array.isArray(data?.articles) ? data.articles : null
  return rows && rows.length ? rows : null
}

/** Live single article. Null when unavailable OR genuinely absent. */
export async function fetchLiveArticle(type, slug) {
  if (!type || !slug) return null
  const data = await boxFetch(`/v1/intel/articles/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`)
  return data && data.slug ? data : null
}

let _bundle = null
function getBundle() {
  if (_bundle) return _bundle
  try {
    _bundle = require('../_data/intelligence-data.json')
  } catch (e) {
    console.warn('[intelligence-store] bundle missing — falling back to empty:', e.message)
    _bundle = { generatedAt: null, articles: TYPES.reduce((acc, t) => { acc[t] = []; return acc }, {}) }
  }
  return _bundle
}

function publishedOnly(arr) {
  return arr.filter(a => a && (!a.status || a.status === 'published'))
}

// `calendar` entries are DATA payloads wearing an article shape: the calendar
// agent saves `content: JSON.stringify(data)` so /api/calendar can read the
// outlook/themes/verdict back by slug (calendarAnalysisAgent.js). Listing them
// as articles renders a wall of JSON at the reader — prod shipped exactly that
// on 2026-07-29 ("Fed Stress Test" = calendar/themes-latest, and the only two
// entries LITE Insights could find). Verified against the bundle the same day:
// 1,636/1,636 calendar entries carry a JSON body and no other type carries one.
// loadArticle() is deliberately NOT filtered — the calendar page reads by slug.
function isReadable(a) {
  if (!a) return false
  if (a.type === 'calendar' || a.calendarType) return false
  return !/^\s*[[{]/.test(a.content || '')
}

export function loadArticle(type, slug) {
  if (!type || !slug) return null
  const list = getBundle().articles[type] || []
  return list.find(a => a.slug === slug) || null
}

export function listArticles(type, opts = {}) {
  const limit = Math.min(opts.limit || 100, 500)
  const list = publishedOnly(getBundle().articles[type] || [])
  return list.slice(0, limit)
}

export function listAllPublished(opts = {}) {
  const limit = Math.min(opts.limit || 200, 1000)
  const all = []
  for (const t of TYPES) all.push(...publishedOnly(getBundle().articles[t] || []).filter(isReadable))
  all.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
  return all.slice(0, limit)
}

export function listNews(opts = {}) {
  const { limit = 50, category, breakingOnly, featuredOnly } = opts
  let articles = listArticles('news', { limit: 500 })

  if (category && category !== 'all') {
    articles = articles.filter(a =>
      a.category === category ||
      (a.categories || []).includes(category)
    )
  }
  if (breakingOnly) articles = articles.filter(a => a.isBreaking)
  if (featuredOnly) articles = articles.filter(a => a.isFeatured)

  return articles.slice(0, Math.min(limit, 500))
}

export function getFeatured(limit = 5) {
  const featured = listNews({ limit: 20, featuredOnly: true })
  if (featured.length >= limit) return featured.slice(0, limit)
  const all = listAllPublished({ limit: 50 })
  const seen = new Set(featured.map(a => a.slug))
  const backfill = all.filter(a => !seen.has(a.slug)).slice(0, limit - featured.length)
  return [...featured, ...backfill].slice(0, limit)
}

export function getBreaking() {
  // A "breaking" article older than 24h is no longer breaking. Without
  // this cutoff the static bundle would surface month-old headlines as
  // BREAKING forever (build artefacts don't expire on their own).
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const news = listArticles('news', { limit: 500 })
  return news
    .filter(a => a.isBreaking)
    .filter(a => {
      const ts = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
      return Number.isFinite(ts) && ts > cutoff
    })
    .slice(0, 10)
}

export function getLatestDailyBrief() {
  const list = listArticles('daily', { limit: 1 })
  return list[0] || null
}

export function getStats() {
  const articles = getBundle().articles
  const byType = {}
  let total = 0
  for (const t of TYPES) {
    const n = (articles[t] || []).length
    byType[t] = n
    total += n
  }
  return { totalArticles: total, byType, generatedAt: getBundle().generatedAt }
}

/** Strip heavy fields for list views (mirror of routes/intelligence.js summarize). */
export function summarize(article) {
  if (!article) return null
  return {
    slug: article.slug,
    type: article.type,
    title: article.title,
    headline: article.headline,
    summary: article.summary,
    tickers: article.tickers,
    categories: article.categories,
    tags: article.tags,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    dataSnapshot: article.dataSnapshot,
    wordCount: article.content ? article.content.split(/\s+/).length : 0,
    sourceCount: (article.sourcesCited || []).length,
    isOriginal: article.isOriginal || false,
    coverImage: article.coverImage || article.sourceArticle?.imageUrl || null,
    ogImage: article.ogImage ? `/og/${article.type}/${article.slug}.png` : null,
  }
}

export function summarizeNews(article) {
  let contentPreview = ''
  if (article?.content) {
    let cleaned = article.content
      .replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
      .replace(/\n+/g, ' ').trim()
    const hl = (article.headline || article.title || '').replace(/\*\*/g, '').replace(/\*/g, '')
    if (hl && cleaned.startsWith(hl)) cleaned = cleaned.slice(hl.length).trim()
    contentPreview = cleaned.slice(0, 500)
  }
  return {
    ...summarize(article),
    contentPreview: contentPreview || null,
    sentiment: article?.sentiment || null,
    sentimentScore: article?.sentimentScore || null,
    category: article?.category || null,
    isBreaking: article?.isBreaking || false,
    isFeatured: article?.isFeatured || false,
    sourceArticle: article?.sourceArticle || null,
    expiresAt: article?.expiresAt || null,
  }
}
