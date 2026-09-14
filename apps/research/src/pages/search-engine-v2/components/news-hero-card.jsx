/**
 * NewsHeroCard — large image-led top story for NEWS classification.
 * v2.1 stub. NewsSection below still renders the full feed.
 */
import { useTranslation } from 'react-i18next'
import './_stub.css'

export default function NewsHeroCard({ stream }) {
  const { t } = useTranslation()
  const news = stream.slots?.news
  const top = Array.isArray(news) ? news.find((n) => n?.imageUrl) : null
  if (!top) return null
  return (
    <a
      className="se2-stub"
      href={top.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: 'none', textAlign: 'left' }}
    >
      <div className="se2-stub-label">{t('searchEngineV2.newsHero.label', 'LEAD STORY')}</div>
      <div className="se2-stub-body">
        <strong style={{ color: 'rgba(245,245,247,0.95)', display: 'block', marginBottom: 4 }}>
          {top.title}
        </strong>
        <span>
          {t('searchEngineV2.newsHero.sourceTail', '{{source}} · click to open', {
            source: top.source || '',
          })}
        </span>
      </div>
    </a>
  )
}
