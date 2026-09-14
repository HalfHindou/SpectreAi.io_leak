/**
 * ImageHeroStrip — Google/Perplexity-style image row above the answer.
 *
 * For asset queries: prepends the token logo (from price slot or known
 * asset-logo URL) + 3-5 news article thumbnails.
 * For news / macro / discovery: 4-6 news article thumbnails.
 *
 * Each tile is clickable — asset logo → token page, news tile → article URL.
 * Hidden when no image source is available (e.g. all-SEC-EDGAR news).
 */
import { useMemo } from 'react'
import './image-hero-strip.css'

function domainOf(article) {
  if (article?.sourceDomain) return article.sourceDomain
  try { return new URL(article?.url || '').hostname.replace(/^www\./, '') } catch { return '' }
}

function faviconOf(article) {
  const d = domainOf(article)
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=32` : null
}

function relTime(iso) {
  if (!iso) return ''
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  if (isNaN(t)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

export default function ImageHeroStrip({ stream }) {
  const items = useMemo(() => {
    const out = []

    // News tiles only — no giant asset logo (right rail already has the badge).
    const news = Array.isArray(stream?.slots?.news) ? stream.slots.news : []
    const breaking = Array.isArray(stream?.slots?.breaking) ? stream.slots.breaking : []
    const seen = new Set()
    for (const item of [...breaking, ...news]) {
      if (!item?.url || seen.has(item.url)) continue
      if (!item.imageUrl) continue
      seen.add(item.url)
      out.push({
        kind: 'news',
        image: item.imageUrl,
        title: item.title,
        subtitle: item.source || domainOf(item),
        time: item.publishedAt,
        href: item.url,
        favicon: faviconOf(item),
      })
      if (out.length >= 5) break
    }

    return out
  }, [stream?.slots?.news, stream?.slots?.breaking])

  // Require at least 2 tiles — a single full-width image looks lazy.
  if (items.length < 2) return null

  return (
    <section className="se-image-hero" aria-label="Visual context">
      <div className="se-image-hero-row">
        {items.map((item, i) => (
          <a
            key={`hero-${i}`}
            className="se-image-hero-tile"
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div
              className="se-image-hero-img"
              style={{ backgroundImage: `url(${item.image})` }}
              aria-hidden="true"
            />
            <div className="se-image-hero-overlay">
              <div className="se-image-hero-meta">
                {item.favicon && (
                  <img src={item.favicon} alt="" className="se-image-hero-favicon" loading="lazy" />
                )}
                <span className="se-image-hero-source">{item.subtitle}</span>
                {item.time && <span className="se-image-hero-time">{relTime(item.time)}</span>}
              </div>
              <div className="se-image-hero-title">{item.title}</div>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}
