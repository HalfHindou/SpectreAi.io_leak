/**
 * Spectre Intelligence Hub - Article Page
 * Full article reader with live data card, markdown content, sources, related research, and CTA.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Helmet } from 'react-helmet-async'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { spectreIcons } from '@/icons/spectreIcons'
import { useIsMobile } from '@/hooks/useMediaQuery'
import useSettingsStore from '@/store/useSettingsStore'
import { formatChange, formatDate, timeAgo } from '../utils'
import { useCurrency } from '@/hooks/useCurrency'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { getSpectreNews, getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { decodeHtmlEntities } from '@/utils/html'
import '../Intelligence.css'
import '../intelligence-page.mobile.css'

export default function ArticlePage() {
  const { type, slug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Article passed via navigation state (e.g. from the breaking banner, whose
  // items live in a feed that the article endpoints can't resolve by slug).
  const seedArticle = location.state?.article || null
  const isMobile = useIsMobile()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { fmtPrice: formatPrice, fmtLargeShort } = useCurrency()
  const [article, setArticle] = useState(null)
  const [liveData, setLiveData] = useState(null)
  const [related, setRelated] = useState([])
  const [loading, setLoading] = useState(true)

  // Reset scroll to top when navigating between articles
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [type, slug])

  // Fetch article - try intelligence API first (full content), fall back to news API
  useEffect(() => {
    let cancelled = false
    setArticle(null)
    setLiveData(null)
    setRelated([])
    setLoading(true)
    async function load() {
      try {
        // 1. Try intelligence API first (full editorial content)
        let data = null
        try {
          const res = await fetch(`/api/intelligence/${type}/${slug}`)
          if (res.ok) {
            const full = await res.json()
            if (full && (full.title || full.headline)) data = full
          }
        } catch {}

        // 2. Fall back to news API search (regular + breaking feeds)
        if (!data) {
          const [newsRows, breakingRows] = await Promise.all([
            getSpectreNews({ limit: 40 }).catch(() => []),
            getSpectreNews({ breaking: true, limit: 8 }).catch(() => []),
          ])
          const rows = [...newsRows, ...breakingRows]
          data = rows.find((item) => item.slug === slug || String(item.id) === slug) || null
          // Also grab related articles from the regular feed
          if (!cancelled && newsRows.length) {
            setRelated(newsRows.filter(a => (a.slug || a.id) !== slug).slice(0, 3).map((item) => ({
              ...item,
              slug: item.slug || item.id,
              headline: item.headline || item.title,
              sourceArticle: { source: item.source || 'Spectre', url: item.url || '#' },
            })))
          }
        }

        // 3. Last resort: article handed to us via navigation state
        if (!data && seedArticle) data = seedArticle

        if (!data) throw new Error('Not found')
        if (!cancelled) {
          // Decode HTML entities (&#8216; → ' etc.) before passing to render -
          // feed sources serve entity-encoded titles, React text nodes don't
          // HTML-parse, so without this they show literal &#8216; on screen.
          const decode = (s) => {
            if (!s || typeof s !== 'string' || !s.includes('&')) return s
            if (typeof document === 'undefined') return s
            try { const ta = document.createElement('textarea'); ta.innerHTML = s; return ta.value } catch { return s }
          }
          setArticle({
            ...data,
            slug: data.slug || data.id,
            title: decode(data.title || data.headline),
            headline: decode(data.headline || data.title),
            summary: decode(data.summary || ''),
            content: decode(data.content || data.summary || ''),
            sourceArticle: data.sourceArticle
              ? { ...data.sourceArticle, source: decode(data.sourceArticle.source), title: decode(data.sourceArticle.title) }
              : { source: decode(data.source || 'Spectre'), url: data.url || '#', imageUrl: data.imageUrl || null },
            tickers: data.tickers || data.relatedAssets || data.assets || [],
          })
        }
      } catch (e) {
        // silently handled
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [type, slug, seedArticle])

  // Fetch live price data for crypto/stocks
  useEffect(() => {
    if (!article) return
    const ticker = (article.tickers || [])[0]
    if (!ticker) return
    let cancelled = false

    async function fetchLive() {
      try {
        if (type === 'stocks') {
          const res = await fetch(`/api/stocks/quote/${ticker}`)
          if (cancelled) return
          if (res.ok) {
            const d = await res.json()
            if (cancelled) return
            setLiveData({
              price: d.price,
              change: d.change,
              volume: d.volume,
              high: d.week52High,
              low: d.week52Low,
              marketCap: d.marketCap,
            })
          }
        } else {
          // crypto + research (and any token-referencing article): try crypto price lookup
          const rows = await getSpectrePricesBySymbols([ticker])
          if (cancelled) return
          const d = rows?.[String(ticker).toUpperCase()]
          if (d && !cancelled) {
            setLiveData({
              price: d.price,
              change: d.change24h ?? d.change,
              volume: d.volume,
              high: d.high24h,
              low: d.low24h,
            })
          }
        }
      } catch (_) { if (!cancelled) console.error(_) }
    }
    fetchLive()
    return () => { cancelled = true }
  }, [article, type])

  // Sources for citation linking
  const sources = useMemo(() => article?.sourcesCited || [], [article])

  // Render inline text - bold, italic, tickers, inline links (NO inline [N] citations - stripped per Content Law)
  const renderInline = useCallback((text) => {
    if (!text) return text
    // Decode HTML entities upfront so &#8217;s and &amp; render as proper glyphs
    // instead of literal escape sequences in body copy.
    const decoded = decodeHtmlEntities(text)
    // First: strip all [N] citation markers from text entirely (Content Law: no inline citations)
    const cleaned = decoded.replace(/\s*\[\d+\]/g, '')
    // Split on: **bold**, *italic*, $TICKER, [text](url) links
    const parts = cleaned.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\$[A-Z]{1,6}|\[[^\]]+\]\([^)]+\))/g)
    return parts.map((part, i) => {
      if (!part) return null
      // Bold
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
      // Italic
      if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) return <em key={i}>{part.slice(1, -1)}</em>
      // Ticker highlight
      if (/^\$[A-Z]{1,6}$/.test(part)) return <span key={i} className="ticker-highlight">{part}</span>
      // Inline link [text](url)
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        return <a key={i} href={linkMatch[2]} className="intel-inline-link" target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>
      }
      return part
    })
  }, [])

  // Render markdown table from lines
  const renderTable = useCallback((tableLines, keyBase) => {
    const parseRow = (line) => line.split('|').slice(1, -1).map(cell => cell.trim())
    const headers = parseRow(tableLines[0])
    const startRow = tableLines[1]?.match(/^\|[\s\-:|]+\|$/) ? 2 : 1
    const rows = tableLines.slice(startRow).map(parseRow)

    return (
      <div key={`table-${keyBase}`} className="intel-table-wrap">
        <table className="intel-table">
          <thead>
            <tr>{headers.map((h, hi) => <th key={hi}>{renderInline(h)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => <td key={ci}>{renderInline(cell)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [renderInline])

  // Full markdown renderer - line-by-line React elements
  const contentElements = useMemo(() => {
    if (!article?.content) return null
    // Some stored entries are DATA payloads, not prose - the calendar agent
    // saves `content: JSON.stringify(...)` so /api/calendar can read it back by
    // slug. Those are filtered out of every list now, but a deep link or a
    // cached URL must never dump raw JSON at a reader.
    if (/^\s*[[{]/.test(article.content)) {
      return [<p key="payload">This entry is a stored data snapshot, not a written analysis.</p>]
    }
    const lines = article.content.split('\n')
    const elements = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // Markdown tables: | col | col |
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines = []
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i])
          i++
        }
        if (tableLines.length >= 2) {
          elements.push(renderTable(tableLines, elements.length))
          continue
        }
        tableLines.forEach((tl, ti) => {
          elements.push(<p key={`${elements.length}-${ti}`}>{renderInline(tl)}</p>)
        })
        continue
      }

      // Thesis callout: > **THESIS AT A GLANCE:**
      if (line.trim().startsWith('> **THESIS AT A GLANCE:**') || line.trim().startsWith('>**THESIS AT A GLANCE:**')) {
        const calloutText = line.replace(/^>\s*/, '').replace(/^\*\*THESIS AT A GLANCE:\*\*\s*/, '')
        // Collect continuation lines
        let fullText = calloutText
        while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].startsWith('#') && !lines[i + 1].startsWith('**') && !lines[i + 1].startsWith('> ') && !lines[i + 1].startsWith('|') && !lines[i + 1].startsWith('- ')) {
          i++
          fullText += ' ' + lines[i].replace(/^>\s*/, '').trim()
        }
        elements.push(
          <div key={`thesis-${i}`} className="intel-thesis-callout">
            <div className="intel-thesis-callout__label">THESIS AT A GLANCE</div>
            <div className="intel-thesis-callout__text">{renderInline(fullText.trim())}</div>
          </div>
        )
        i++
        continue
      }

      // Blockquotes: > text (for key voice quotes)
      if (line.trim().startsWith('> ')) {
        const quoteText = line.replace(/^>\s*/, '')
        elements.push(
          <blockquote key={`quote-${i}`} className="intel-quote">{renderInline(quoteText)}</blockquote>
        )
        i++
        continue
      }

      // H2: ## heading
      if (line.startsWith('## ')) {
        elements.push(<h2 key={`h2-${i}`}>{line.slice(3)}</h2>)
        i++
        continue
      }

      // H3: ### heading
      if (line.startsWith('### ')) {
        elements.push(<h3 key={`h3-${i}`}>{line.slice(4)}</h3>)
        i++
        continue
      }

      // Bold section headers: **ALL CAPS TEXT** on its own line
      const boldHeaderMatch = line.match(/^\*\*([^*]+)\*\*$/)
      if (boldHeaderMatch) {
        elements.push(<h3 key={`bh-${i}`} className="intel-bold-header">{boldHeaderMatch[1]}</h3>)
        i++
        continue
      }

      // List items: - text
      if (line.startsWith('- ')) {
        elements.push(<li key={`li-${i}`}>{renderInline(line.slice(2))}</li>)
        i++
        continue
      }

      // Images: ![alt](url) with optional caption on next line
      const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      if (imgMatch) {
        const alt = imgMatch[1]
        const src = imgMatch[2]
        let caption = null
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith('*') && lines[i + 1].trim().endsWith('*') && !lines[i + 1].trim().startsWith('**')) {
          i++
          caption = lines[i].trim().slice(1, -1)
        }
        elements.push(
          <figure key={`img-${i}`} className="intel-article-figure">
            <img src={src} alt={alt} className="intel-article-figure__img" loading="lazy" />
            {caption && <figcaption className="intel-article-figure__caption">{caption}</figcaption>}
          </figure>
        )
        i++
        continue
      }

      // Empty lines
      if (line.trim() === '') {
        i++
        continue
      }

      // Regular paragraphs
      elements.push(<p key={`p-${i}`}>{renderInline(line)}</p>)
      i++
    }

    return elements
  }, [article, renderInline, renderTable])

  // ── MOBILE LOADING ──
  if (loading && isMobile) {
    return (
      <div className="intel-hub mint-article-page">
        <div className="mint-article">
          <div className="mint-section" style={{ paddingTop: 8 }}>
            <div className="mint-skeleton mint-skeleton--line" style={{ width: 120 }} />
            <div className="mint-skeleton mint-skeleton--hero" />
            <div className="mint-skeleton mint-skeleton--line" style={{ width: '80%', marginTop: 16 }} />
            <div className="mint-skeleton mint-skeleton--line" />
            <div className="mint-skeleton mint-skeleton--line" />
            <div className="mint-skeleton mint-skeleton--line" style={{ width: '60%' }} />
          </div>
          <div className="mint-article-bottom-spacer" />
        </div>
      </div>
    )
  }

  // ── DESKTOP LOADING ──
  if (loading) {
    return (
      <div className="intel-hub">
        <div className="intel-article">
          <div className="st-skel st-skel--label animate-shimmer" style={{ width: 200, marginBottom: 24 }} />
          <div className="st-skel st-skel--image animate-shimmer" />
          <div className="st-skel st-skel--title animate-shimmer" />
          <div className="st-skel st-skel--meta animate-shimmer" />
          <div className="st-skel st-skel--paragraph animate-shimmer" />
          <div className="st-skel st-skel--paragraph is-95 animate-shimmer" />
          <div className="st-skel st-skel--paragraph is-90 animate-shimmer" />
          <div className="st-skel st-skel--paragraph is-80 animate-shimmer" />
          <div className="st-skel st-skel--paragraph animate-shimmer" />
          <div className="st-skel st-skel--paragraph is-85 animate-shimmer" />
          <div className="st-skel st-skel--paragraph is-95 animate-shimmer" />
          <div className="st-skel st-skel--paragraph is-70 animate-shimmer" />
        </div>
      </div>
    )
  }

  // ── NOT FOUND (shared) ──
  if (!article) {
    if (isMobile) {
      return (
        <div className="intel-hub mint-article-page">
          <div className="mint-article">
            <button className="mint-article-back" onClick={() => navigate('/intelligence')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
              </svg>
              {t('intelligencePage.back')}
            </button>
            <div className="mint-section" style={{ textAlign: 'center', padding: '60px 16px' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{t('intelligencePage.articleNotFound')}</div>
              <div style={{ fontSize: 13, color: 'rgba(245,245,247,0.4)' }}>{t('intelligencePage.articleNotFoundDesc')}</div>
            </div>
            <div className="mint-article-bottom-spacer" />
          </div>
        </div>
      )
    }
    return (
      <div className="intel-hub">
        <div className="intel-article">
          <button className="intel-article__back" onClick={() => navigate('/intelligence')}>
            {spectreIcons.chevronLeft} {t('intelligencePage.backToHub')}
          </button>
          <div className="intel-empty">
            <div className="intel-empty__title">{t('intelligencePage.articleNotFound')}</div>
            <div className="intel-empty__desc">{t('intelligencePage.articleNotFoundDesc')}</div>
          </div>
        </div>
      </div>
    )
  }

  const ticker = (article.tickers || [])[0] || ''
  const snap = article.dataSnapshot || {}
  const categoryLabel = type === 'crypto'
    ? t('intelligencePage.articleType.crypto')
    : type === 'stocks'
      ? t('intelligencePage.articleType.stocks')
      : type === 'daily'
        ? t('intelligencePage.articleType.daily')
        : type === 'news'
          ? t('intelligencePage.articleType.news')
          : t('intelligencePage.articleType.research')
  const wordCount = article.content ? article.content.split(/\s+/).length : 0
  const displayPrice = liveData?.price ?? snap.price
  const displayChange = liveData?.change ?? snap.change

  // SEO / GEO: Article schema + per-article meta. Shared across mobile + desktop renders.
  const _articleUrl = `https://spectreai.io/intelligence/${type}/${slug}`
  const _articleTitle = article.title || article.headline || 'Intelligence Article'
  const _articleDesc = (article.summary || article.subtitle || '').slice(0, 200) ||
    t('intelligencePage.seoFallback', { title: _articleTitle })
  const _articleSchema = {
    '@context': 'https://schema.org',
    '@type': type === 'news' ? 'NewsArticle' : 'Article',
    '@id': _articleUrl,
    headline: _articleTitle,
    description: _articleDesc,
    url: _articleUrl,
    datePublished: article.publishedAt || article.createdAt,
    dateModified: article.updatedAt || article.publishedAt || article.createdAt,
    image: article.imageUrl || article.coverImage || 'https://spectreai.io/og-image.png',
    author: { '@id': 'https://spectreai.io/#organization' },
    publisher: { '@id': 'https://spectreai.io/#organization' },
    mainEntityOfPage: _articleUrl,
    inLanguage: i18n.language,
    ...(Array.isArray(article.tickers) && article.tickers.length > 0
      ? { about: article.tickers.map((t) => ({ '@type': 'Thing', name: t })) }
      : {}),
  }
  const articleHelmet = (
    <Helmet>
      <title>{`${_articleTitle} | Spectre AI`}</title>
      <meta name="description" content={_articleDesc} />
      <link rel="canonical" href={_articleUrl} />
      <meta property="og:title" content={_articleTitle} />
      <meta property="og:description" content={_articleDesc} />
      <meta property="og:url" content={_articleUrl} />
      <meta property="og:type" content="article" />
      {(article.imageUrl || article.coverImage) && (
        <meta property="og:image" content={article.imageUrl || article.coverImage} />
      )}
      <meta name="twitter:title" content={_articleTitle} />
      <meta name="twitter:description" content={_articleDesc} />
      <script type="application/ld+json">{JSON.stringify(_articleSchema)}</script>
    </Helmet>
  )

  // ════════════════════════════════════════════════════════
  // MOBILE ARTICLE RENDER
  // ════════════════════════════════════════════════════════
  if (isMobile) {
    return (
      <>
      {articleHelmet}
      <div className={`intel-hub mint-article-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mint-article">
          {/* Back */}
          <button className="mint-article-back" onClick={() => navigate('/intelligence')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
            {t('intelligencePage.back')}
          </button>

          {/* Hero image - only show real images, not AI-generated fallbacks */}
          {(article.coverImage || article.sourceArticle?.imageUrl) && (
            <div className="mint-article-hero">
              <img
                src={article.coverImage || article.sourceArticle?.imageUrl}
                alt={article.headline || ''}
                loading="eager"
                onError={(e) => { e.target.parentElement.style.display = 'none' }}
              />
            </div>
          )}

          {/* Category + meta */}
          <div className="mint-article-meta-row">
            <span className="mint-article-category">{categoryLabel}</span>
            {article.sentiment && (
              <span className={`mint-article-sentiment mint-article-sentiment--${article.sentiment}`}>
                {article.sentiment === 'bullish' ? '\u25B2' : article.sentiment === 'bearish' ? '\u25BC' : '\u2022'} {article.sentiment === 'bullish' ? t('intelligencePage.sentimentBullish') : article.sentiment === 'bearish' ? t('intelligencePage.sentimentBearish') : t('intelligencePage.sentimentNeutral')}
              </span>
            )}
            <span className="mint-article-updated">{timeAgo(article.updatedAt, { t })}</span>
          </div>

          {/* Live data card */}
          {ticker && type !== 'daily' && displayPrice != null && (
            <div className="mint-article-live-card">
              <div className="mint-article-live-top">
                <span className="mint-article-live-symbol">{ticker}</span>
                <div>
                  <span className="mint-article-live-price">{displayPrice != null ? formatPrice(displayPrice) : '-'}</span>
                  {displayChange != null && (
                    <span className={`mint-article-live-change${displayChange >= 0 ? ' mint-article-live-change--up' : ' mint-article-live-change--down'}`}>
                      {formatChange(displayChange)}
                    </span>
                  )}
                </div>
              </div>
              <div className="mint-article-live-metrics">
                {snap.marketCap && <span className="mint-article-live-metric">{t('intelligencePage.liveLabel.marketCap')} <span>{fmtLargeShort(snap.marketCap)}</span></span>}
                {(liveData?.volume || snap.volume) && <span className="mint-article-live-metric">{t('intelligencePage.liveLabel.volume')} <span>{fmtLargeShort(liveData?.volume || snap.volume)}</span></span>}
                {snap.rank && <span className="mint-article-live-metric">{t('intelligencePage.liveLabel.rank')} <span>#{snap.rank}</span></span>}
              </div>
            </div>
          )}

          {/* Title */}
          <h1 className="mint-article-title">{article.headline || article.title}</h1>
          <div className="mint-article-author">
            <img src="/spectre-logo-black.png" alt="" width="40" height="40" decoding="async" className="mint-article-author-logo" />
            <div className="mint-article-author-info">
              <span className="mint-article-author-name">Spectre AI</span>
              <span className="mint-article-author-time">
                {formatDate(article.publishedAt, { locale })} &middot; {wordCount.toLocaleString(locale)} {t('intelligencePage.words')}
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="mint-article-body">
            {contentElements}
          </div>

          {/* Sources */}
          {sources.length > 0 && (
            <div className="mint-article-sources">
              <div className="mint-article-sources-label">{t('intelligencePage.sourcesLabel')}</div>
              <div className="mint-article-sources-list">
                {sources.map((src, i) => {
                  const url = typeof src === 'string' ? src : src?.url || ''
                  const name = typeof src === 'string' ? '' : (src?.name || '')
                  let domain = ''
                  try { domain = new URL(url).hostname.replace('www.', '') } catch (_) { domain = url.slice(0, 30) }
                  const label = name || domain || t('intelligencePage.sourceFallback')
                  return (
                    <a
                      key={i}
                      className="mint-article-source-pill"
                      href={url || '#'}
                      target={url ? '_blank' : undefined}
                      rel={url ? 'noopener noreferrer' : undefined}
                    >
                      {domain && (
                        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" loading="lazy" decoding="async" width="16" height="16" className="mint-article-source-favicon" />
                      )}
                      <span>{label}</span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}

          {/* Related articles - horizontal scroll */}
          {related.length > 0 && (
            <div className="mint-related">
              <div className="mint-related-label">{t('intelligencePage.relatedResearch')}</div>
              <div className="mint-related-scroll">
                {related.map(r => (
                  <Link
                    key={r.slug}
                    to={`/intelligence/${r.type}/${r.slug}`}
                    className="mint-related-card"
                    style={{ textDecoration: 'none' }}
                  >
                    {/* 2026-05-26 beta-quality fix: only render ticker pill when non-empty
                      (was rendering an empty styled pill on tickerless related articles). */}
                  {((r.tickers || [])[0]) && (
                    <div className="mint-related-ticker">{(r.tickers || [])[0]}</div>
                  )}
                    <div className="mint-related-headline">{r.headline || r.title}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mint-article-bottom-spacer" />
        </div>
      </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════
  // DESKTOP ARTICLE RENDER
  // ════════════════════════════════════════════════════════
  const categoryClass = type === 'crypto' ? 'category-badge--crypto' : type === 'stocks' ? 'category-badge--stocks' : type === 'news' ? 'category-badge--news' : 'category-badge--daily'

  return (
    <>
    {articleHelmet}
    <div className="intel-hub">
      <div className="intel-article">
        <button className="intel-article__back" onClick={() => navigate('/intelligence')}>
          {spectreIcons.chevronLeft} {t('intelligencePage.backToHub')}
        </button>

        {/* Category + Updated */}
        <div className="intel-article__category-row">
          <span className={`category-badge ${categoryClass}`}>{categoryLabel}</span>
          {article.sentiment && (
            <span className={`intel-sentiment-badge intel-sentiment-badge--${article.sentiment}`}>
              {article.sentiment === 'bullish' ? '\u25B2' : article.sentiment === 'bearish' ? '\u25BC' : '\u25CF'} {article.sentiment === 'bullish' ? t('intelligencePage.sentimentBullish') : article.sentiment === 'bearish' ? t('intelligencePage.sentimentBearish') : t('intelligencePage.sentimentNeutral')}
            </span>
          )}
          <span className="intel-article__updated">{t('intelligencePage.updatedWhen', { when: timeAgo(article.updatedAt, { t }) })}</span>
        </div>

        {/* Source Article link for news */}
        {type === 'news' && article.sourceArticle?.url && (
          <div className="intel-source-link">
            {t('intelligencePage.sourcePrefix')}<a href={article.sourceArticle.url} target="_blank" rel="noopener noreferrer">
              {article.sourceArticle.source || t('intelligencePage.originalArticle')} - {article.sourceArticle.title || t('intelligencePage.viewSource')}
            </a>
          </div>
        )}

        {/* Hero Image - only show real images, not AI-generated fallbacks */}
        {(article.coverImage || article.sourceArticle?.imageUrl) && (
          <div className="intel-article__hero">
            <img
              src={article.coverImage || article.sourceArticle?.imageUrl}
              alt={article.headline || ''}
              loading="eager"
              onError={(e) => { e.target.parentElement.style.display = 'none' }}
            />
          </div>
        )}

        {/* Live Data Card */}
        {ticker && type !== 'daily' && displayPrice != null && (
          <div className="intel-live-card">
            <div className="intel-live-card__top">
              <div className="intel-live-card__name">
                <span className="intel-live-card__symbol">{ticker}</span>
                <span className="intel-live-card__fullname">{article.headline?.replace(` (${ticker}) Analysis`, '') || ''}</span>
              </div>
              <div>
                <span className="intel-live-card__price">{displayPrice != null ? formatPrice(displayPrice) : '-'}</span>
                {displayChange != null && (
                  <span className={`intel-live-card__change ${displayChange >= 0 ? 'intel-live-card__change--up' : 'intel-live-card__change--down'}`}>
                    {formatChange(displayChange)} {t('intelligencePage.last24h')}
                  </span>
                )}
              </div>
            </div>
            <div className="intel-live-card__metrics">
              {snap.marketCap && <span className="intel-live-card__metric">{t('intelligencePage.liveLabel.marketCap')} <span>{fmtLargeShort(snap.marketCap)}</span></span>}
              {(liveData?.volume || snap.volume) && <span className="intel-live-card__metric">{t('intelligencePage.liveLabel.volume')} <span>{fmtLargeShort(liveData?.volume || snap.volume)}</span></span>}
              {snap.rank && <span className="intel-live-card__metric">{t('intelligencePage.liveLabel.rank')} <span>#{snap.rank}</span></span>}
              {liveData?.high && <span className="intel-live-card__metric">{t('intelligencePage.liveLabel.high')} <span>{formatPrice(liveData.high)}</span></span>}
              {liveData?.low && <span className="intel-live-card__metric">{t('intelligencePage.liveLabel.low')} <span>{formatPrice(liveData.low)}</span></span>}
            </div>
          </div>
        )}

        {/* Article Body */}
        <div className="intel-article-body">
          <h1 className="intel-article-body__title">{article.headline || article.title}</h1>
          <div className="intel-article-body__author">
            <div className="intel-article-body__author-info">
              <span className="intel-article-body__author-name">Spectre AI</span>
              <span className="intel-article-body__author-time">
                {formatDate(article.publishedAt, { locale })} &middot; {wordCount.toLocaleString(locale)} {t('intelligencePage.words')} &middot; {sources.length} {t('intelligencePage.sources')}
              </span>
            </div>
          </div>
          <div className="intel-article-body__content">
            {contentElements}
          </div>

          {/* Sources */}
          {sources.length > 0 && (
            <div className="intel-article__sources">
              <div className="intel-sources__label">{t('intelligencePage.sourcesLabel')}</div>
              <div className="intel-sources__list">
                {sources.map((src, i) => {
                  const url = typeof src === 'string' ? src : src?.url || ''
                  const name = typeof src === 'string' ? '' : (src?.name || '')
                  let domain = ''
                  try { domain = new URL(url).hostname.replace('www.', '') } catch (_) { domain = url.slice(0, 30) }
                  const label = name || domain || t('intelligencePage.sourceFallback')
                  return (
                    <a
                      key={i}
                      className="intel-source-pill"
                      href={url || '#'}
                      target={url ? '_blank' : undefined}
                      rel={url ? 'noopener noreferrer' : undefined}
                    >
                      {domain && (
                        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" loading="lazy" decoding="async" width="16" height="16" className="intel-source-favicon" />
                      )}
                      <span className="intel-source-domain">{label}</span>
                      <span className="intel-source-num">[{i + 1}]</span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Related Research */}
        {related.length > 0 && (
          <section className="intel-related">
            <div className="intel-section-label">{t('intelligencePage.relatedResearch')}</div>
            <div className="intel-related__grid">
              {related.map(r => (
                <Link
                  key={r.slug}
                  to={`/intelligence/${r.type}/${r.slug}`}
                  className="intel-inner-card"
                  style={{ textDecoration: 'none' }}
                >
                  {/* 2026-05-26 beta-quality fix: only render ticker line when non-empty. */}
                  {((r.tickers || [])[0]) && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {(r.tickers || [])[0]}
                    </div>
                  )}
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                    {r.headline || r.title}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <div className="intel-glass-card intel-cta">
          <p className="intel-cta__text">
            {ticker
              ? t('intelligencePage.cta.withTicker', { ticker })
              : t('intelligencePage.cta.anyAsset')}
          </p>
          <div className="intel-cta__buttons">
            <Link to="/monarch-chat" className="intel-cta__btn intel-cta__btn--primary">
              {t('intelligencePage.cta.askSpectre')}
            </Link>
            {ticker && (
              <Link to={`/research-zone/${getTokenSlug(ticker)}`} className="intel-cta__btn intel-cta__btn--ghost">
                {t('intelligencePage.cta.openResearchZone')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
