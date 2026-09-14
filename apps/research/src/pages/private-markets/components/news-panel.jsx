/**
 * NewsPanel — "Market Summary" style realtime news for the featured company.
 *
 * Headline list with source + relative time; clicking a row expands its
 * summary and links out. Sourced from Finnhub company news + funding RSS via
 * private-markets-api.getCompanyNews (not tweets). Pure presentational.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

function relTime(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const h = diff / 3.6e6
  if (h < 1) return `${Math.max(1, Math.round(diff / 6e4))}m ago`
  if (h < 24) return `${Math.round(h)}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function NewsRow({ item, expanded, onToggle }) {
  const { t } = useTranslation()
  return (
    <div className={`pi-news-row${expanded ? ' pi-news-row-open' : ''}`}>
      <button type="button" className="pi-news-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="pi-news-headline">{item.headline}</span>
        <svg className="pi-news-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="pi-news-meta caption">
        <span className="pi-news-source">{item.source}</span>
        {item.date ? <><span className="pm-dot" /><span>{relTime(item.date)}</span></> : null}
      </div>
      {expanded && (
        <div className="pi-news-body">
          {item.summary && <p className="pi-news-summary">{item.summary}</p>}
          <a className="pi-news-link" href={item.url} target="_blank" rel="noopener noreferrer">
            {t('privateMarkets.newsPanel.readFullStory', 'Read full story')}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M7 7h10v10" />
            </svg>
          </a>
        </div>
      )}
    </div>
  )
}

export default function NewsPanel({ news, title }) {
  const { t } = useTranslation()
  const panelTitle = title || t('privateMarkets.newsPanel.marketSummary', 'Market Summary')
  const { list = [], loading } = news || {}
  const [openId, setOpenId] = useState(null)

  return (
    <div className="pi-panel glass-card pi-panel-news">
      <div className="pi-panel-head">
        <span className="pi-panel-title">{panelTitle}</span>
        <span className="pi-panel-tag">{t('privateMarkets.newsPanel.newsTag', 'News')}</span>
      </div>
      <div className="pi-panel-body">
        {loading && list.length === 0 &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="pi-skel animate-shimmer" style={{ height: 40, borderRadius: 8 }} />
          ))}
        {!loading && list.length === 0 && (
          <div className="pi-panel-empty caption">{t('privateMarkets.newsPanel.noCoverage', 'No recent coverage.')}</div>
        )}
        {list.map((item, i) => (
          <NewsRow
            key={item.id}
            item={item}
            expanded={openId === (item.id || i)}
            onToggle={() => setOpenId((cur) => (cur === (item.id || i) ? null : item.id || i))}
          />
        ))}
      </div>
    </div>
  )
}
