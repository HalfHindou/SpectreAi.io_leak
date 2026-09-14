/**
 * W-032 · AI Brief Snapshot Widget
 * One-paragraph market brief composed from real scenario data.
 * Shows latest alpha feed item below. Links to full Intelligence page.
 */
import { useMarketIntel } from '@/hooks/useMarketIntel'
import './AIBrief.css'

/* ---------- helpers ---------- */

/** Truncate text to maxLen characters, adding ellipsis */
function truncate(text, maxLen) {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '...'
}

/** Format lastUpdated as relative time */
function formatRelativeTime(date) {
  if (!date) return null
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/* ---------- component ---------- */

export default function AIBrief() {
  const { scenario, alphaFeed, lastUpdated, loading } = useMarketIntel()

  const hasData = scenario && scenario.confidence > 0

  // Compose brief from trigger + abbreviated bullCase
  const briefText = hasData
    ? `${scenario.trigger} ${truncate(scenario.bullCase, 180)}`
    : null

  const latestNews = alphaFeed && alphaFeed.length > 0 ? alphaFeed[0] : null
  const updatedLabel = formatRelativeTime(lastUpdated)

  if (loading && !hasData) {
    return (
      <div className="tcab">
        <div className="tcw-shimmer tcab-skeleton" style={{ width: '40%' }} />
        <div className="tcw-shimmer tcab-skeleton" style={{ width: '80%' }} />
        <div className="tcw-shimmer tcab-skeleton" style={{ width: '60%' }} />
      </div>
    )
  }

  return (
    <div className="tcab">
      {/* Timestamp */}
      {updatedLabel && (
        <div className="tcab-updated">Updated {updatedLabel}</div>
      )}

      {/* Scenario label (scenario-driven color stays inline) */}
      {hasData && (
        <div className="tcab-label" style={{ color: scenario.color || 'var(--violet)' }}>
          {scenario.label}
        </div>
      )}

      {/* Brief text */}
      <div className="tcab-brief">
        {briefText || 'Awaiting market intelligence...'}
      </div>

      {/* Latest alpha feed item */}
      {latestNews && (
        <div className="tcab-news">
          <div className="tcab-news-inner">
            <div
              className="tcab-news-dot"
              style={{
                background: latestNews.severity === 'critical'
                  ? 'var(--bear)'
                  : latestNews.severity === 'high'
                  ? 'var(--amber)'
                  : 'var(--text-muted)',
              }}
            />
            <div className="tcab-news-body">
              <div className="tcab-news-headline">
                {latestNews.headline || latestNews.title}
              </div>
              <div className="tcab-news-meta">
                {latestNews.source} {latestNews.time && `· ${latestNews.time}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Link to Intelligence */}
      <div className="tcab-link">
        Read Full Brief &rarr;
      </div>
    </div>
  )
}
