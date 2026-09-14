/**
 * NewsSection — picks image-tile row vs card grid internally.
 *
 * If ≥3 items have imageUrl → render a 4-up tile row above the cards
 * (Google-image-row style). Otherwise just the cards.
 *
 * Each card: 96px square thumbnail (or favicon-only when no image) +
 * source row (favicon · source · relative time) + 2-line title +
 * optional 2-line summary snippet.
 */
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTimeAgo } from '@/lib/timeAgo'
import './news-section.css'

function domainOf(article) {
  if (article?.sourceDomain) return article.sourceDomain
  try { return new URL(article?.url || '').hostname.replace(/^www\./, '') } catch { return '' }
}

function faviconOf(article) {
  const d = domainOf(article)
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=32` : null
}

function NewsTileRow({ items, fmtAgo }) {
  return (
    <div className="se2-news-tiles">
      {items.slice(0, 4).map((a, i) => (
        <a
          key={`tile-${i}`}
          className="se2-news-tile"
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <div
            className="se2-news-tile-img"
            style={{ backgroundImage: `url(${a.imageUrl})` }}
            aria-hidden="true"
          />
          <div className="se2-news-tile-overlay">
            <div className="se2-news-tile-source">
              {faviconOf(a) && (
                <img
                  src={faviconOf(a)}
                  alt=""
                  className="se2-news-tile-favicon"
                  loading="lazy"
                />
              )}
              <span>{a.source || domainOf(a)}</span>
              {a.publishedAt && (
                <>
                  <span className="se2-news-tile-dot">·</span>
                  <span className="se2-news-tile-time">{fmtAgo(a.publishedAt)}</span>
                </>
              )}
            </div>
            <div className="se2-news-tile-title">{a.title}</div>
          </div>
        </a>
      ))}
    </div>
  )
}

function NewsCard({ article, fmtAgo }) {
  const fav = faviconOf(article)
  return (
    <a
      className="se2-news-card"
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {article.imageUrl ? (
        <div
          className="se2-news-card-thumb"
          style={{ backgroundImage: `url(${article.imageUrl})` }}
          aria-hidden="true"
        />
      ) : (
        <div className="se2-news-card-thumb se2-news-card-thumb-empty" aria-hidden="true">
          {fav && <img src={fav} alt="" loading="lazy" />}
        </div>
      )}
      <div className="se2-news-card-body">
        <div className="se2-news-card-meta">
          {fav && <img src={fav} alt="" className="se2-news-card-favicon" loading="lazy" />}
          <span className="se2-news-card-source">{article.source || domainOf(article)}</span>
          {article.publishedAt && (
            <>
              <span className="se2-news-card-dot" aria-hidden="true">·</span>
              <span className="se2-news-card-time">{fmtAgo(article.publishedAt)}</span>
            </>
          )}
        </div>
        <div className="se2-news-card-title">{article.title}</div>
        {article.summary && (
          <div className="se2-news-card-snippet">
            {article.summary.length > 140
              ? article.summary.slice(0, 140) + '…'
              : article.summary}
          </div>
        )}
      </div>
    </a>
  )
}

function NewsSection({ stream }) {
  const { t } = useTranslation()
  const fmtAgo = useTimeAgo()
  const items = useMemo(() => {
    // News can arrive from `news` slot or `breaking` slot. Merge if both.
    const news = Array.isArray(stream.slots?.news) ? stream.slots.news : []
    const breaking = Array.isArray(stream.slots?.breaking) ? stream.slots.breaking : []
    // De-dupe by url + cap to 12
    const seen = new Set()
    const merged = []
    for (const item of [...breaking, ...news]) {
      if (!item?.url || seen.has(item.url)) continue
      seen.add(item.url)
      merged.push(item)
      if (merged.length >= 12) break
    }
    return merged
  }, [stream.slots?.news, stream.slots?.breaking])

  if (items.length === 0) return null

  const withImages = items.filter((a) => a?.imageUrl)
  const showTileRow = withImages.length >= 3

  return (
    <section className="se2-news-section">
      <header className="se2-news-header">
        <h3 className="se2-news-title">{t('searchEngineV2.news.title', 'NEWS')}</h3>
        <span className="se2-news-count">{items.length}</span>
      </header>

      {showTileRow && <NewsTileRow items={withImages} fmtAgo={fmtAgo} />}

      <div className="se2-news-cards">
        {items.slice(0, 8).map((a, i) => (
          <NewsCard key={`card-${a.url || i}`} article={a} fmtAgo={fmtAgo} />
        ))}
      </div>
    </section>
  )
}

export default memo(NewsSection, (prev, next) => (
  prev.stream.slots?.news === next.stream.slots?.news &&
  prev.stream.slots?.breaking === next.stream.slots?.breaking
))
