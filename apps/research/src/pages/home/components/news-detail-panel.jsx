/**
 * NewsDetailPanel - Fixed right-edge drawer overlay for news/tweet detail.
 * Rendered via portal to document.body so `position: fixed` is never
 * broken by ancestor transforms / backdrop-filters.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

/* ── Helpers (duplicated from news-tab-panel to avoid circular deps) ── */
const NEWS_SOURCE_DOMAINS = {
  coindesk: 'coindesk.com', 'the block': 'theblock.co', theblock: 'theblock.co',
  bloomberg: 'bloomberg.com', reuters: 'reuters.com', decrypt: 'decrypt.co',
  cointelegraph: 'cointelegraph.com', cointelgraph: 'cointelegraph.com',
  'crypto briefing': 'cryptobriefing.com', 'bitcoin magazine': 'bitcoinmagazine.com',
  blockworks: 'blockworks.co', defiant: 'thedefiant.io', 'the defiant': 'thedefiant.io',
  dlnews: 'dlnews.com', unchained: 'unchainedcrypto.com', benzinga: 'benzinga.com',
  cnbc: 'cnbc.com', 'wall street journal': 'wsj.com', wsj: 'wsj.com',
  'financial times': 'ft.com', ft: 'ft.com', 'yahoo finance': 'finance.yahoo.com',
  yahoo: 'finance.yahoo.com', 'market watch': 'marketwatch.com', marketwatch: 'marketwatch.com',
  'seeking alpha': 'seekingalpha.com', barrons: 'barrons.com', "barron's": 'barrons.com',
  investopedia: 'investopedia.com', fortune: 'fortune.com', forbes: 'forbes.com',
  cryptopanic: 'cryptopanic.com',
}

const getNewsSourceIcon = (source) => {
  if (!source) return null
  const key = source.toLowerCase().trim()
  const domain = NEWS_SOURCE_DOMAINS[key]
  if (domain) return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  return `https://www.google.com/s2/favicons?domain=${key.replace(/\s+/g, '') + '.com'}&sz=32`
}

const BULLISH_RE = /surge|rally|bullish|record|high|soar|gain|inflow|breakout|accelerat|recover|ath|all.time|boom|optimis/i
const BEARISH_RE = /crash|dump|bearish|decline|fall|drop|outflow|fear|sell|delay|reject|plunge|panic|capitulat|risk|warning|concern/i

function getArticleSentiment(news) {
  const text = (news?.title || '') + ' ' + (news?.summary || '')
  const bull = BULLISH_RE.test(text)
  const bear = BEARISH_RE.test(text)
  if (bull && !bear) return 'positive'
  if (bear && !bull) return 'negative'
  if (bull && bear) return 'mixed'
  return 'neutral'
}

const getImageUrl = (news, highRes = false) => {
  const url = news?.imageUrl || news?.image || null
  if (!url) return null
  if (url.includes('cryptocompare.com')) {
    const base = url.replace(/[?&]width=\d+/g, '')
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}width=${highRes ? 840 : 480}`
  }
  if (url.includes('unsplash.com')) {
    return url.replace(/w=\d+/, `w=${highRes ? 840 : 480}`).replace(/h=\d+/, `h=${highRes ? 560 : 320}`)
  }
  return url
}

const formatTimeAgo = (publishedOn) => {
  if (!publishedOn) return ''
  const diff = Math.floor(Date.now() / 1000 - publishedOn)
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function formatTweetTime(isoStr) {
  if (!isoStr) return ''
  const then = new Date(isoStr).getTime()
  if (isNaN(then)) return ''
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return `${Math.max(0, diffSec)}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  return `${Math.floor(diffHr / 24)}d`
}

function formatCount(n) {
  if (n == null) return '0'
  if (typeof n === 'string') return n
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

const URL_RE = /https?:\/\/[^\s<)}\]]+/g
function linkifyText(text) {
  if (!text || typeof text !== 'string') return text
  const parts = []
  let lastIndex = 0
  let match
  URL_RE.lastIndex = 0
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const url = match[0].replace(/[.,;:!?)]+$/, '')
    parts.push(
      <a key={match.index} className="news-feed-x-link" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
        {url.replace(/^https?:\/\//, '').slice(0, 30)}{url.replace(/^https?:\/\//, '').length > 30 ? '\u2026' : ''}
      </a>
    )
    lastIndex = match.index + url.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}

/* ── Main Component ── */
export default function NewsDetailPanel({ detail, onClose, allNews, allTweets, onSelect }) {
  const { t } = useTranslation()
  const panelRef = React.useRef(null)
  const scrollToTop = () => panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

  // Close on Escape key
  React.useEffect(() => {
    if (!detail) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, detail])

  if (!detail) return null

  const isNews = detail.type === 'news'
  const currentId = detail.data?.id || detail.data?.handle
  const otherItems = isNews
    ? (allNews || []).filter(n => (n.id || n.title) !== (detail.data?.id || detail.data?.title))
    : (allTweets || []).filter(t => (t.id || t.handle) !== (detail.data?.id || detail.data?.handle))

  return createPortal(
    <div className="news-detail-panel" ref={panelRef}>
        <div className="news-detail-sidebar-header">
          <span className="news-detail-sidebar-label">
            {isNews ? 'Article' : 'Post'}
          </span>
          <button className="news-detail-sidebar-close" onClick={onClose} aria-label={t('homePage.newsDetailPanel.newsdetailpanel.ariaClose', "Close")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {isNews ? <NewsArticleDetail data={detail.data} /> : <TweetDetail data={detail.data} />}

        {/* All other items — same full card design */}
        {otherItems.length > 0 && (
          <div className="news-detail-more">
            <div className="news-detail-more-divider" />
            {otherItems.map((item) => {
              const key = item.id || item.handle || item.title
              return isNews
                ? <NewsArticleDetail key={key} data={item} />
                : <TweetDetail key={key} data={item} />
            })}
          </div>
        )}
    </div>,
    document.body
  )
}

function NewsArticleDetail({ data: n }) {
  const { t } = useTranslation()
  const img = getImageUrl(n, true)
  const sentiment = getArticleSentiment(n)
  const timeAgo = formatTimeAgo(n.publishedOn)

  return (
    <div className="news-detail-sidebar-body">
      {img && (
        <div className="news-detail-cover">
          <img src={img} alt="" loading="lazy" decoding="async" onError={e => { e.target.parentElement.style.display = 'none' }} />
          <div className="news-detail-cover-fade" />
        </div>
      )}
      <div className="news-detail-meta-row">
        <div className="news-detail-source">
          <img src={getNewsSourceIcon(n.source)} alt="" loading="lazy" decoding="async" width="16" height="16" className="news-detail-source-icon" onError={e => { e.target.style.display = 'none' }} />
          <span>{n.source}</span>
        </div>
        {timeAgo && <span className="news-detail-time">{timeAgo} ago</span>}
      </div>
      <h3 className="news-detail-title">{n.title}</h3>
      {n.summary && <p className="news-detail-summary">{n.summary}</p>}
      <div className="news-detail-tags">
        <span className={`news-detail-sentiment ${sentiment}`}>
          {sentiment === 'positive' ? 'Bullish' : sentiment === 'negative' ? 'Bearish' : sentiment === 'mixed' ? 'Mixed' : 'Neutral'}
        </span>
        {n.categories?.[0] && <span className="news-detail-category">{n.categories[0]}</span>}
        {n.url && (
          <a className="news-detail-cta" href={n.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
            {t('homePage.newsDetailPanel.newsarticledetail.readFullArticle', "Read full article")}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
          </a>
        )}
      </div>
    </div>
  )
}

function TweetDetail({ data: tw }) {
  const { t } = useTranslation()
  const mediaItem = tw.media?.[0] || null
  const mediaUrl = mediaItem?.type === 'video' ? mediaItem?.poster_url : mediaItem?.url

  return (
    <div className="news-detail-sidebar-body">
      <div className="news-detail-tweet-header">
        {tw.avatar ? (
          <img className={`news-detail-tweet-avatar${tw.profileShape === 'Square' ? ' shape-square' : ''}`} src={tw.avatar} alt="" loading="lazy" decoding="async" width="36" height="36" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }} />
        ) : (
          <span style={{ display: 'none' }} />
        )}
        <div className={`news-detail-tweet-avatar-fallback${!tw.avatar ? ' visible' : ''}${tw.profileShape === 'Square' ? ' shape-square' : ''}`}>{(tw.name || '?')[0]}</div>
        <div className="news-detail-tweet-user">
          <span className="news-detail-tweet-name">
            {tw.name}
            {tw.verified && <svg className="news-feed-x-verified" width="14" height="14" viewBox="0 0 22 22" fill="none"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.141.27.587.7 1.086 1.24 1.44s1.167.551 1.813.568c.645-.016 1.27-.213 1.808-.567.537-.354.973-.853 1.247-1.44.606.223 1.264.27 1.897.14.634-.131 1.217-.437 1.687-.883.445-.47.751-1.054.882-1.69.13-.633.083-1.29-.14-1.896.587-.274 1.084-.705 1.438-1.246.355-.54.553-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>}
          </span>
          <span className="news-detail-tweet-handle">{tw.handle}</span>
        </div>
        <span className="news-detail-tweet-time">{formatTweetTime(tw.time)}</span>
      </div>
      <p className="news-detail-tweet-text">{linkifyText(tw.text)}</p>
      {mediaUrl && (
        <div className="news-detail-tweet-media">
          <img src={mediaUrl} alt="" loading="lazy" decoding="async" onError={e => { e.target.parentElement.style.display = 'none' }} />
        </div>
      )}
      <div className="news-detail-tweet-stats">
        <span className="news-detail-tweet-stat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          {formatCount(tw.replies)}
        </span>
        <span className="news-detail-tweet-stat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          {formatCount(tw.reposts)}
        </span>
        <span className="news-detail-tweet-stat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          {formatCount(tw.likes)}
        </span>
        <span className="news-detail-tweet-stat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          {formatCount(tw.views)}
        </span>
        {tw.xUrl && (
          <a className="news-detail-cta" href={tw.xUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
            {t('homePage.newsDetailPanel.tweetdetail.viewOnX', "View on X")}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
          </a>
        )}
      </div>
    </div>
  )
}
