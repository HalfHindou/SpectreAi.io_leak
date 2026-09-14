/**
 * Shared utilities for the Intelligence Hub frontend.
 *
 * Most formatters accept an optional `{ t, locale }` second argument so callers
 * inside React components can pass `useTranslation()`'s `t` and `i18n.language`
 * for proper i18n + locale-aware dates. When called without it, English
 * fallbacks and `en-US` formatting are used so non-i18n contexts (server-side
 * fixtures, tests, isolated calls) keep working.
 */

export function timeAgo(dateStr, opts) {
  if (!dateStr) return ''
  const then = new Date(dateStr).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Math.max(0, Date.now() - then)
  const mins = Math.floor(diff / 60000)
  const t = opts?.t
  const locale = opts?.locale || 'en-US'
  if (mins < 1) return t ? t('intelligencePage.timeAgo.justNow') : 'Just now'
  if (mins < 60) {
    return t
      ? t('intelligencePage.timeAgo.minutes', { count: mins })
      : `${mins}m ago`
  }
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    return t
      ? t('intelligencePage.timeAgo.hours', { count: hours })
      : `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  if (days < 7) {
    return t
      ? t('intelligencePage.timeAgo.days', { count: days })
      : `${days}d ago`
  }
  return new Date(dateStr).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

// @deprecated - use fmtPrice from useCurrency() in components
export function formatPrice(price) {
  if (price == null || !Number.isFinite(Number(price))) return '-'
  const n = Number(price)
  if (n >= 1) {
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(8)}`
}

export function formatChange(change) {
  if (change == null || !Number.isFinite(Number(change))) return ''
  const n = Number(change)
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

// @deprecated - use fmtLargeShort from useCurrency() for currency values
export function formatNumber(num) {
  if (num == null || !Number.isFinite(Number(num))) return '-'
  const n = Number(num)
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return n.toLocaleString()
}

export function formatDate(dateStr, opts) {
  if (!dateStr) return ''
  const locale = opts?.locale || 'en-US'
  return new Date(dateStr).toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function agentLabel(agent, opts) {
  const t = opts?.t
  if (t) {
    switch (agent) {
      case 'market-brief': return t('intelligencePage.agents.marketBrief')
      case 'token-analysis': return t('intelligencePage.agents.tokenAnalysis')
      case 'stock-analysis': return t('intelligencePage.agents.stockAnalysis')
      case 'thematic': return t('intelligencePage.agents.thematic')
      case 'news-curator': return t('intelligencePage.agents.newsCurator')
      case 'news-writer': return t('intelligencePage.agents.newsWriter')
      case 'breaking-news': return t('intelligencePage.agents.breakingNews')
      default: return agent || t('intelligencePage.agents.fallback')
    }
  }
  switch (agent) {
    case 'market-brief': return 'Market Brief Agent'
    case 'token-analysis': return 'Token Analysis Agent'
    case 'stock-analysis': return 'Stock Analysis Agent'
    case 'thematic': return 'Thematic Agent'
    case 'news-curator': return 'News Curator'
    case 'news-writer': return 'News Writer'
    case 'breaking-news': return 'Breaking News'
    default: return agent || 'Agent'
  }
}

export function getSourceInfo(article, opts) {
  const t = opts?.t
  const fallback = t ? t('intelligencePage.sourceFallback') : 'News Wire'
  if (!article) return { isSpectre: false, sourceName: fallback }
  const isSpectre = article.isOriginal || article.sourceArticle?.source === 'Spectre AI'
  return {
    isSpectre,
    sourceName: isSpectre ? 'Spectre AI' : (article.sourceArticle?.source || fallback),
  }
}

export function actionVerb(action, agent, opts) {
  const t = opts?.t
  const name = agentLabel(agent, opts)
  if (t) {
    switch (action) {
      case 'started': return t('intelligencePage.agentActions.started', { name })
      case 'completed': return t('intelligencePage.agentActions.completed', { name })
      case 'failed': return t('intelligencePage.agentActions.failed', { name })
      case 'updated': return t('intelligencePage.agentActions.updated', { name })
      case 'scheduled': return t('intelligencePage.agentActions.scheduled', { name })
      default: return t('intelligencePage.agentActions.default', { name, action: action || 'acted' })
    }
  }
  switch (action) {
    case 'started': return `${name} started generating`
    case 'completed': return `${name} published`
    case 'failed': return `${name} failed`
    case 'updated': return `${name} updated`
    case 'scheduled': return `${name} scheduled`
    default: return `${name} ${action || 'acted'}`
  }
}
