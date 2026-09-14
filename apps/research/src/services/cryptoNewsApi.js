/**
 * Crypto news – prefers the cached Spectre market news bridge.
 * Legacy source-specific proxies stay as fallbacks, but browser code should not
 * call Finnhub/CryptoCompare/CryptoPanic directly.
 */

import { logError } from '@/lib/logger'
import { getSpectreNews } from '@/services/spectreMarketApi'

/** Map symbol to CryptoCompare categories for filtering (optional) */
const SYMBOL_CATEGORIES = {
  BTC: ['BTC', 'BITCOIN', 'MARKET', 'CRYPTOCURRENCY'],
  ETH: ['ETH', 'ETHEREUM', 'MARKET', 'CRYPTOCURRENCY'],
  SOL: ['SOL', 'SOLANA', 'ALTCOIN', 'MARKET', 'CRYPTOCURRENCY'],
}

let newsCache = []
let newsCacheTime = 0
const NEWS_CACHE_TTL = 3 * 60 * 1000 // 3 min
const _newsInflight = {} // in-flight dedup for concurrent calls

/**
 * Fetch news from CryptoPanic (cryptopanic.com). Same shape as getCryptoNews.
 * @param {string} [symbol] - e.g. 'BTC', 'ETH', 'SOL'
 * @param {number} [limit=10] - max items
 * @returns {Promise<Array<{ id, title, url, summary, source, imageUrl, publishedOn, categories }>>}
 */
export async function getCryptoPanicNews(symbol, limit = 10) {
  const key = `panic:${symbol || ''}:${limit}`
  if (_newsInflight[key]) return _newsInflight[key]

  const promise = (async () => {
    const spectre = await getSpectreNews({ symbol, limit }).catch(() => [])
    if (spectre.length > 0) return spectre.slice(0, limit)

    try {
      const proxyUrl = `/api/cryptopanic?limit=${limit}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`
      const res = await fetch(proxyUrl, { method: 'GET', headers: { Accept: 'application/json' } })
      if (!res.ok) return []
      const json = await res.json()
      const raw = Array.isArray(json.results) ? json.results : []
      return raw.map((item) => ({
        id: String(item.id),
        title: item.title || '',
        url: item.url || '#',
        summary: item.summary || (item.title || '').slice(0, 160) + (item.title && item.title.length > 160 ? '…' : ''),
        source: item.source || 'CryptoPanic',
        imageUrl: item.imageUrl || null,
        publishedOn: item.publishedOn || 0,
        categories: item.categories || [],
      }))
    } catch (_) {
      return []
    } finally {
      delete _newsInflight[key]
    }
  })()
  _newsInflight[key] = promise
  return promise
}

/**
 * Fetch latest crypto news. Tries CryptoPanic first, then /api/news (CryptoCompare).
 * @param {string} [symbol] - e.g. 'BTC', 'ETH', 'SOL'
 * @param {number} [limit=8] - max items
 * @returns {Promise<Array<{ id: string, title: string, url: string, summary: string, source: string, imageUrl: string, time: string, categories: string }>>}
 */
export async function getCryptoNews(symbol, limit = 8) {
  const now = Date.now()
  if (newsCache.length && (now - newsCacheTime) < NEWS_CACHE_TTL) {
    return filterAndSlice(newsCache, symbol, limit)
  }

  const key = `news:${symbol || ''}:${limit}`
  if (_newsInflight[key]) return _newsInflight[key]

  const promise = (async () => {
    // The 3 sources are independent — race them in parallel instead of
    // awaiting serially. Each resolves to its rows ([] when empty/failed);
    // we keep the preference order (Spectre > CryptoPanic > /api/news) by
    // taking the first source in that order that returned non-empty rows.
    const spectreP = getSpectreNews({ symbol, limit })
      .catch((err) => { logError('cryptoNewsApi:spectre-news', err); return [] })

    const panicP = getCryptoPanicNews(symbol, limit)
      .catch((err) => { logError('cryptoNewsApi:cryptopanic', err); return [] })

    const proxyP = (async () => {
      try {
        const proxyUrl = `/api/news?lang=EN&limit=${limit}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`
        const res = await fetch(proxyUrl, { method: 'GET', headers: { Accept: 'application/json' } })
        if (!res.ok) return []
        const json = await res.json()
        const raw = Array.isArray(json.Data) ? json.Data : []
        return raw.map((item) => ({
          id: String(item.id),
          title: item.title || '',
          url: item.url || item.guid || '#',
          summary: (item.summary != null ? item.summary : (item.body || '').replace(/<[^>]+>/g, '').slice(0, 160)) + (item.body && item.body.length > 160 ? '…' : ''),
          source: item.source || 'Crypto',
          imageUrl: item.imageUrl || item.imageurl || null,
          publishedOn: item.publishedOn ?? item.published_on ?? 0,
          categories: item.categories || (item.categories ? (item.categories || '').split('|').filter(Boolean).map((c) => c.toUpperCase()) : []),
        }))
      } catch (err) { logError('cryptoNewsApi:proxy', err); return [] }
    })()

    const [spectre, panic, proxy] = await Promise.all([spectreP, panicP, proxyP])

    // First non-empty source in preference order wins (same semantics as the
    // old serial fallback, minus the 3 serial round-trips).
    const winner =
      (spectre && spectre.length > 0) ? spectre
      : (panic && panic.length > 0) ? panic
      : (proxy && proxy.length > 0) ? proxy
      : null

    if (winner) {
      newsCache = winner
      newsCacheTime = Date.now()
      return filterAndSlice(winner, symbol, limit)
    }
    return newsCache.length ? filterAndSlice(newsCache, symbol, limit) : []
  })().finally(() => { delete _newsInflight[key] })
  _newsInflight[key] = promise
  return promise
}

function filterAndSlice(list, symbol, limit) {
  let out = list
  if (symbol && SYMBOL_CATEGORIES[symbol]) {
    const cats = SYMBOL_CATEGORIES[symbol]
    const symbolLower = symbol.toLowerCase()
    out = list.filter((item) => {
      const titleLower = (item.title || '').toLowerCase()
      const hasInTitle = titleLower.includes(symbolLower) || titleLower.includes(symbol === 'BTC' ? 'bitcoin' : symbol === 'ETH' ? 'ethereum' : 'solana')
      if (hasInTitle) return true
      return (item.categories || []).some((c) => cats.includes(c))
    })
    if (out.length < 3) out = list.slice(0, limit * 2)
  }
  return out.slice(0, limit)
}

/**
 * Fetch market news from RSS feeds (CoinDesk, Cointelegraph). No API key. Uses /api/news/rss.
 * @param {string} [symbol] - e.g. 'BTC', 'ETH', 'SOL'
 * @param {number} [limit=10] - max items
 * @returns {Promise<Array<{ id, title, url, summary, source, imageUrl, publishedOn, categories }>>}
 */
export async function getRssMarketNews(symbol, limit = 50) {
  const key = `rss:${symbol || ''}:${limit}`
  if (_newsInflight[key]) return _newsInflight[key]

  const promise = (async () => {
    const spectre = await getSpectreNews({ symbol, limit }).catch(() => [])
    if (spectre.length > 0) return spectre.slice(0, limit)

    try {
      const url = `/api/news/rss?limit=${limit}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
      if (!res.ok) return []
      const json = await res.json()
      const raw = Array.isArray(json.results) ? json.results : []
      return raw.map((item, idx) => ({
        id: String(item.id || `rss-${idx}`),
        title: item.title || '',
        url: item.url || '#',
        summary: item.summary || (item.title || '').slice(0, 160) + (item.title && item.title.length > 160 ? '…' : ''),
        source: item.source || 'RSS',
        imageUrl: item.imageUrl || item.sourceIcon || null,
        publishedOn: item.publishedOn || item.publishedAt || 0,
        categories: item.categories || item.tags || [],
        breaking: item.breaking === true,
      }))
    } catch (_) {
      return []
    } finally {
      delete _newsInflight[key]
    }
  })()
  _newsInflight[key] = promise
  return promise
}

export default { getCryptoNews, getRssMarketNews }
