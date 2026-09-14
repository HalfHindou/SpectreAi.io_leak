/**
 * NewsArticleReader — internal article reader for /news/:articleId
 * Renders full article with image, content, source link, related articles.
 * Receives article data via router state or fetches from API.
 * v3: Source logos in byline
 */
import { useState, useEffect, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getCryptoNews } from '@/services/cryptoNewsApi'
import { getSpectreNews } from '@/services/spectreMarketApi'
import { getSourceLogo, fetchMacroWire } from './NewsPage'
import { readForMacroArticle } from './macro-read'
import { useNewsBrief } from './use-news-brief'
import { decodeHtmlEntities } from '@/utils/html'
import './news-page.css'

/* ── Helpers ── */

function timeAgo(dateStr, t, locale) {
  if (!dateStr) return ''
  const now = Date.now()
  const then = typeof dateStr === 'number'
    ? (dateStr > 1e12 ? dateStr : dateStr * 1000)
    : new Date(dateStr).getTime()
  if (!then || isNaN(then)) return ''
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t ? t('news.time.justNow', 'Just now') : 'Just now'
  if (mins < 60) return t ? t('news.time.minutesAgo', { count: mins, defaultValue: '{{count}}m ago' }) : `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t ? t('news.time.hoursAgo', { count: hrs, defaultValue: '{{count}}h ago' }) : `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return t ? t('news.time.daysAgo', { count: days, defaultValue: '{{count}}d ago' }) : `${days}d ago`
  return new Date(then).toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDate(dateStr, locale) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d)) return ''
  return d.toLocaleDateString(locale || undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

const CAT_COLORS = {
  tech: '#3B82F6', ai: '#8B5CF6', science: '#10B981',
  business: '#F59E0B', finance: '#22C55E', world: '#EF4444',
  crypto: '#F7931A', health: '#06B6D4', energy: '#F97316',
  entertainment: '#EC4899', space: '#6366F1', macro: '#2DD4BF',
}

const PLACEHOLDER_IMAGES = {
  tech: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=900&h=500&fit=crop',
  ai: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=900&h=500&fit=crop',
  science: 'https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=900&h=500&fit=crop',
  business: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=900&h=500&fit=crop',
  finance: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=900&h=500&fit=crop',
  world: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=900&h=500&fit=crop',
  crypto: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=900&h=500&fit=crop',
  health: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=900&h=500&fit=crop',
  energy: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=900&h=500&fit=crop',
  macro: '/images/wire/rates.svg',
}

function SourceLogo({ source }) {
  const logo = getSourceLogo(source)
  if (!logo) return null
  return (
    <img
      src={logo}
      alt=""
      className="sn-source-logo"
      width="16"
      height="16"
      loading="lazy"
      onError={(e) => { e.target.style.display = 'none' }}
    />
  )
}

export default function NewsArticleReader({ articleId, dayMode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const [article, setArticle] = useState(location.state?.article || null)
  const [related, setRelated] = useState([])
  const [loading, setLoading] = useState(!location.state?.article)
  // The grounded read. A wire story is a headline plus one sentence (median 102
  // chars across a week of the wire), so without this the page has no body at
  // all - see the handler header for the full why.
  const { brief, loading: briefLoading } = useNewsBrief(article?.id || articleId)

  /* Reset scroll to top when navigating between articles */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [articleId])

  /* If no state passed, try to find article via API */
  useEffect(() => {
    if (location.state?.article) {
      setArticle(location.state.article)
      setLoading(false)
      setRelated([])
      return
    }
    setArticle(null)
    setLoading(true)
    setRelated([])
    let cancelled = false
    async function findArticle() {
      try {
        const decoded = decodeURIComponent(articleId)
        // Macro Wire deep link: /news/mw-<event_key> — the TG bot's 🌍 Macro
        // Shock alerts land here. Resolved against the wire ledger (tradfi
        // feed), not the editorial news feeds.
        if (decoded.startsWith('mw-')) {
          const wire = await fetchMacroWire()
          if (cancelled) return
          const hit = wire.find(a => a.id === decoded)
          if (hit) setArticle(hit)
          setLoading(false)
          return
        }
        // Spectre + Crypto lookups are independent until a match is found, so
        // fire both in parallel instead of awaiting Spectre, then Crypto.
        const [spectreRes, cryptoRes] = await Promise.allSettled([
          getSpectreNews({ limit: 50 }),
          getCryptoNews(null, 50),
        ])
        if (cancelled) return

        // Spectre wins on a tie (same priority as the prior sequential order).
        const spectreNews = spectreRes.status === 'fulfilled' && Array.isArray(spectreRes.value) ? spectreRes.value : []
        const spectreMatch = spectreNews.find(a => a.slug === decoded || a.id === decoded || String(a.id) === decoded)
        if (spectreMatch) {
          setArticle({
            id: spectreMatch.slug || spectreMatch.id,
            title: spectreMatch.headline || spectreMatch.title || '',
            summary: spectreMatch.summary || '',
            content: spectreMatch.content || spectreMatch.summary || '',
            source: spectreMatch.source || 'Spectre',
            sourceType: spectreMatch.category === 'stocks' ? 'stocks' : 'crypto',
            url: spectreMatch.url || '#',
            imageUrl: spectreMatch.imageUrl || null,
            publishedAt: spectreMatch.publishedAt || new Date().toISOString(),
            isSpectre: true,
            category: spectreMatch.category || 'crypto',
            sentiment: spectreMatch.sentiment || null,
          })
          setLoading(false)
          return
        }

        // Fall back to crypto news from the same parallel batch.
        const cryptoNews = cryptoRes.status === 'fulfilled' && Array.isArray(cryptoRes.value) ? cryptoRes.value : []
        const cryptoMatch = cryptoNews.find(a => String(a.id) === decoded || a.id === decoded)
        if (cryptoMatch) {
          setArticle({
            id: cryptoMatch.id,
            title: cryptoMatch.title || '',
            summary: cryptoMatch.summary || '',
            content: cryptoMatch.summary || '',
            source: cryptoMatch.source || 'Crypto',
            sourceType: 'crypto',
            url: cryptoMatch.url || '#',
            imageUrl: cryptoMatch.imageUrl || null,
            publishedAt: cryptoMatch.publishedOn
              ? new Date(cryptoMatch.publishedOn > 1e12 ? cryptoMatch.publishedOn : cryptoMatch.publishedOn * 1000).toISOString()
              : new Date().toISOString(),
            isSpectre: false,
            category: 'crypto',
          })
        }
      } catch {}
      if (!cancelled) setLoading(false)
    }
    findArticle()
    return () => { cancelled = true }
  }, [articleId, location.state?.article]) // eslint-disable-line

  /* Fetch related articles */
  useEffect(() => {
    setRelated([])
    if (!article) return
    let cancelled = false
    async function fetchRelated() {
      // Macro articles relate to the wire, not the crypto feed.
      if (article.isMacroWire) {
        try {
          const wire = await fetchMacroWire()
          if (!cancelled) setRelated(wire.filter(a => a.id !== article.id).slice(0, 4))
        } catch {}
        return
      }
      try {
        const cryptoNews = await getCryptoNews(null, 20)
        if (Array.isArray(cryptoNews) && !cancelled) {
          const items = cryptoNews
            .filter(a => String(a.id) !== String(article.id) && a.title !== article.title)
            .slice(0, 4)
            .map(a => ({
              id: a.id,
              title: a.title || '',
              source: a.source || 'Crypto',
              imageUrl: a.imageUrl || PLACEHOLDER_IMAGES.crypto,
              publishedAt: a.publishedOn
                ? new Date(a.publishedOn > 1e12 ? a.publishedOn : a.publishedOn * 1000).toISOString()
                : new Date().toISOString(),
              category: 'crypto',
            }))
          setRelated(items)
        }
      } catch {}
    }
    fetchRelated()
    return () => { cancelled = true }
  }, [article])

  const catColor = article ? (CAT_COLORS[article.category] || '#8B5CF6') : '#8B5CF6'
  const imgSrc = article?.imageUrl || PLACEHOLDER_IMAGES[article?.category] || PLACEHOLDER_IMAGES.crypto

  /* ── Loading ── */
  if (loading) {
    return (
      <div className={`sn-page ${dayMode ? 'sn-day' : ''}`}>
        <div className="sn-reader">
          <div className="sn-skel sn-skel--back" />
          <div className="sn-skel sn-skel--hero" />
          <div className="sn-skel sn-skel--title" />
          <div className="sn-skel sn-skel--meta" />
          <div className="sn-skel sn-skel--paragraph" />
          <div className="sn-skel sn-skel--paragraph is-95" />
          <div className="sn-skel sn-skel--paragraph is-90" />
          <div className="sn-skel sn-skel--paragraph is-80" />
          <div className="sn-skel sn-skel--paragraph" />
          <div className="sn-skel sn-skel--paragraph is-85" />
          <div className="sn-skel sn-skel--paragraph is-95" />
          <div className="sn-skel sn-skel--paragraph is-70" />
        </div>
      </div>
    )
  }

  /* ── Not found ── */
  if (!article) {
    return (
      <div className={`sn-page ${dayMode ? 'sn-day' : ''}`}>
        <div className="sn-reader">
          <div className="sn-reader__empty">
            <h2>{t('news.article.notFoundTitle', 'Article not found')}</h2>
            <p>{t('news.article.notFoundBody', 'This article may have been removed or the link is invalid.')}</p>
            <button className="sn-reader__back-btn" onClick={() => navigate('/news')}>
              {t('news.article.backToDiscover', 'Back to Discover')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── Article content ── */
  const contentParagraphs = (() => {
    // Decode entities so &#8217;s / &amp; render as proper glyphs in paragraphs.
    const text = decodeHtmlEntities(article.content || article.summary || '')
    if (!text) return []
    return text.split(/\n\n|\n/).filter(p => p.trim().length > 0)
  })()

  // SEO / GEO: NewsArticle schema + per-article meta
  const _articleUrl = `https://spectreai.io/news/${encodeURIComponent(article.id || articleId || '')}`
  const _articleTitle = article.title || t('news.article.defaultTitle', 'News Article')
  const _articleDesc = (article.summary || '').slice(0, 200) ||
    t('news.article.defaultDescription', { title: _articleTitle, defaultValue: '{{title}} - Breaking crypto news aggregated by Spectre AI.' })
  const _articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    '@id': _articleUrl,
    headline: _articleTitle,
    description: _articleDesc,
    url: _articleUrl,
    datePublished: article.publishedAt || new Date().toISOString(),
    dateModified: article.publishedAt || new Date().toISOString(),
    image: article.imageUrl || 'https://spectreai.io/og-image.png',
    author: {
      '@type': 'Organization',
      name: article.source || 'Spectre AI',
    },
    publisher: { '@id': 'https://spectreai.io/#organization' },
    mainEntityOfPage: _articleUrl,
    inLanguage: 'en-US',
    ...(article.category ? { articleSection: article.category } : {}),
  }

  return (
    <>
    <Helmet>
      <title>{`${_articleTitle} | Spectre AI`}</title>
      <meta name="description" content={_articleDesc} />
      <link rel="canonical" href={_articleUrl} />
      <meta property="og:title" content={_articleTitle} />
      <meta property="og:description" content={_articleDesc} />
      <meta property="og:url" content={_articleUrl} />
      <meta property="og:type" content="article" />
      {article.imageUrl && <meta property="og:image" content={article.imageUrl} />}
      <meta name="twitter:title" content={_articleTitle} />
      <meta name="twitter:description" content={_articleDesc} />
      <script type="application/ld+json">{JSON.stringify(_articleSchema)}</script>
    </Helmet>
    <div className={`sn-page ${dayMode ? 'sn-day' : ''}`}>
      <div className="sn-reader">
        {/* Back nav */}
        <button className="sn-reader__back" onClick={() => navigate('/news')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
          <span>{t('news.article.backToDiscover', 'Back to Discover')}</span>
        </button>

        {/* Hero image */}
        <div className="sn-reader__hero">
          <img
            src={imgSrc}
            alt=""
            className="sn-reader__hero-img"
            onError={(e) => { e.target.src = PLACEHOLDER_IMAGES[article.category] || PLACEHOLDER_IMAGES.crypto }}
          />
          <div className="sn-reader__hero-overlay" />
        </div>

        {/* Article header */}
        <div className="sn-reader__header">
          <div className="sn-reader__meta-row">
            <span className="sn-reader__cat" style={{ color: catColor }}>{article.category}</span>
            <span className="sn-reader__date">{formatDate(article.publishedAt, i18n.language)}</span>
          </div>
          <h1 className="sn-reader__title">{article.title}</h1>
          <div className="sn-reader__byline">
            <SourceLogo source={article.source} />
            <span className="sn-reader__source">{article.source}</span>
            <span className="sn-reader__sep">&middot;</span>
            <span className="sn-reader__time">{timeAgo(article.publishedAt, t, i18n.language)}</span>
            {article.sentiment && !article.isMacroWire && (
              <>
                <span className="sn-reader__sep">&middot;</span>
                <span className={`sn-reader__sentiment sn-reader__sentiment--${article.sentiment}`}>
                  {article.sentiment}
                </span>
              </>
            )}
          </div>
          {article.isMacroWire && (
            <div className="sn-reader__macro-meta">
              {article.laneLabel === 'Macro Shock' && (
                <span className="sn-macro-chip sn-macro-chip--shock">Macro Shock</span>
              )}
              {article.laneLabel === 'Breaking' && (
                <span className="sn-macro-chip sn-macro-chip--breaking">Breaking</span>
              )}
              {Number.isFinite(article.importance) && (
                <span className={`sn-macro-chip sn-macro-chip--impact${article.importance >= 85 ? ' sn-macro-chip--hot' : ''}`}>
                  {t('news.article.impact', 'Impact')} {Math.round(article.importance)}
                </span>
              )}
              {article.kindLabel && article.kindLabel !== 'Macro' && (
                <span className="sn-macro-chip" style={{ color: article.kindColor }}>{article.kindLabel}</span>
              )}
              {String(article.sentiment || '').includes('bull') && (
                <span className="sn-macro-chip sn-macro-chip--riskon">▲ {t('news.article.riskOn', 'Risk-on')}</span>
              )}
              {String(article.sentiment || '').includes('bear') && (
                <span className="sn-macro-chip sn-macro-chip--riskoff">▼ {t('news.article.riskOff', 'Risk-off')}</span>
              )}
              {(article.assets || []).slice(0, 6).map((a) => (
                <span key={a} className="sn-macro-chip sn-macro-chip--asset">{String(a).toUpperCase()}</span>
              ))}
            </div>
          )}
        </div>

        {/* Article body */}
        <div className="sn-reader__content">
          {article.summary && (
            <p className="sn-reader__lead">{article.summary}</p>
          )}
          {contentParagraphs.length > 0 && contentParagraphs.map((p, i) => (
            p !== article.summary ? <p key={i} className="sn-reader__paragraph">{p}</p> : null
          ))}

          {/* THE READ — the actual body of the page.
              A wire story arrives as a headline plus one sentence (median 102
              chars across a full week), and that sentence is already the lead
              above, so without this there is nothing here to read. Grounded
              server-side in the article plus live prices for its tagged assets;
              falls back to the deterministic driver map when no provider
              answers, so the floor is exactly the old behaviour. */}
          {(brief || briefLoading) && (
            <div className="sn-read">
              <div className="sn-read__head">
                <span className="sn-read__label">{t('news.article.theRead', 'The read')}</span>
                {brief?.inputs?.impact != null && (
                  <span className="sn-read__impact">{t('news.article.impact', 'Impact')} {Math.round(brief.inputs.impact)}</span>
                )}
              </div>

              {briefLoading && !brief ? (
                <>
                  {/* Say what is happening. Bare shimmer bars read as a stall,
                      and this is the one view that ever waits (~1.5s cold, then
                      cached for every later reader). Deliberately describes the
                      WORK, not the machine: no "AI is thinking", no robot. */}
                  <p className="sn-read__working">
                    {t('news.article.working', 'Reading the tape and writing the read')}
                    <span className="sn-read__dots"><i /><i /><i /></span>
                  </p>
                  <div className="sn-skel sn-skel--paragraph" />
                  <div className="sn-skel sn-skel--paragraph is-90" />
                  <div className="sn-skel sn-skel--paragraph is-70" />
                </>
              ) : (
                <>
                  {brief.what && (
                    <div className="sn-read__block">
                      <span className="sn-read__key">{t('news.article.whatHappened', 'What happened')}</span>
                      <p className="sn-read__body">{brief.what}</p>
                    </div>
                  )}
                  {brief.why && (
                    <div className="sn-read__block">
                      <span className="sn-read__key">{t('news.article.whyItMatters', 'Why it matters')}</span>
                      <p className="sn-read__body">{brief.why}</p>
                    </div>
                  )}
                  {brief.watch && (
                    <div className="sn-read__block">
                      <span className="sn-read__key">{t('news.article.whatToWatch', 'What to watch')}</span>
                      <p className="sn-read__body">{brief.watch}</p>
                    </div>
                  )}
                  {/* receipts: the live numbers the read was actually built on,
                      so the prose is checkable rather than asserted */}
                  {brief.inputs?.prices?.length > 0 && (
                    <div className="sn-read__receipts">
                      {brief.inputs.prices.map((p) => (
                        <span key={p.symbol} className="sn-read__tick">
                          <b>{p.symbol}</b>
                          {p.change24h != null && (
                            <em className={p.change24h >= 0 ? 'is-up' : 'is-down'}>
                              {p.change24h >= 0 ? '+' : ''}{p.change24h.toFixed(1)}%
                            </em>
                          )}
                        </span>
                      ))}
                      <span className="sn-read__asof">{t('news.article.atTimeOfWriting', 'at time of writing')}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Last resort: the endpoint itself is unreachable (the handler
              already serves the template internally when a provider fails). */}
          {!brief && !briefLoading && article.isMacroWire && (() => {
            const read = readForMacroArticle(`${article.title} ${article.summary || ''}`, article.sentiment)
            return read ? (
              <div className="sn-reader__wire-read">
                <span className="sn-reader__wire-read-label">{t('news.article.cryptoRead', 'The crypto read')}</span>
                <p className="sn-reader__paragraph">{read}</p>
              </div>
            ) : null
          })()}

          {/* SOURCES — real links only. A wire story has no origin URL (the
              desk rewrites primary coverage and the box does not store it), so
              rather than dead-ending we surface the coverage we actually hold
              on the same story and state the provenance plainly. Never a
              fabricated citation. */}
          {(article.url && article.url !== '#') || brief?.sources?.related?.length ? (
            <div className="sn-sources">
              <span className="sn-sources__label">{t('news.article.sources', 'Sources')}</span>

              {article.url && article.url !== '#' && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sn-reader__source-link"
                >
                  <SourceLogo source={article.source} />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  {t('news.article.readFullOn', { source: article.source, defaultValue: 'Read full article on {{source}}' })}
                </a>
              )}

              {brief?.sources?.related?.length > 0 && (
                <ul className="sn-sources__list">
                  {brief.sources.related.map((r) => (
                    <li key={r.url}>
                      <a href={r.url} target="_blank" rel="noopener noreferrer">
                        <SourceLogo source={r.source} />
                        <span className="sn-sources__title">{r.title}</span>
                        <span className="sn-sources__from">{r.source}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {/* Macro Wire provenance — kept, because a reader who finds no source
              link deserves to know why there isn't one. */}
          {article.isMacroWire && (
            <p className="sn-reader__wire-note">
              {t('news.article.wireNote', 'Spectre Macro Wire. Global macro and tradfi headlines, rewritten by our desk from primary wire coverage and ranked by market impact. The full feed lives on the Macro Wire tab in Discover.')}
            </p>
          )}
        </div>

        {/* Related articles */}
        {related.length > 0 && (
          <div className="sn-reader__related">
            <h3 className="sn-reader__related-title">
              {article.isMacroWire
                ? t('news.article.moreMacro', 'More from the Macro Wire')
                : t('news.article.moreStories', 'More Stories')}
            </h3>
            <div className="sn-reader__related-grid">
              {related.map(r => (
                <article
                  key={r.id}
                  className="sn-reader__related-card"
                  onClick={() => navigate(`/news/${encodeURIComponent(r.id)}`, { state: { article: r } })}
                >
                  <div className="sn-reader__related-img">
                    <img
                      src={r.imageUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.target.src = PLACEHOLDER_IMAGES[r.category] || PLACEHOLDER_IMAGES.crypto }}
                    />
                  </div>
                  <div className="sn-reader__related-body">
                    <h4 className="sn-reader__related-headline">{r.title}</h4>
                    <span className="sn-reader__related-meta">
                      <SourceLogo source={r.source} />
                      {r.source} &middot; {timeAgo(r.publishedAt, t, i18n.language)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
