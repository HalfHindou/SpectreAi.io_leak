/**
 * MarketThesis — LLM-generated narrative card for the /fear-greed page.
 *
 * Sections: READ -> THE THESIS -> BULL CASE -> BEAR CASE -> MEAN REVERSION
 *           -> WATCH THIS WEEK -> attribution footer.
 *
 * Voice: Spectre Brain — one person's POV, FYI tone, not a definitive call.
 * Data source: GET /api/fear-greed/thesis (Groq, 30-min server cache).
 * Empty / error: renders null so the page reflows cleanly. Same pattern
 * as the existing Reason card.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFgThesis } from './use-fg-thesis'
import './MarketThesis.css'

function fmtAgo(iso) {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000))
  if (mins < 1) return 'Just now'
  if (mins === 1) return '1m ago'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs === 1) return '1h ago'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/**
 * Split a body string so the first sentence leads the reading hierarchy
 * and the remainder renders in the standard body size.
 * Falls back to all-body if no terminator is present.
 */
function splitLeadSentence(text) {
  if (!text) return { lead: '', rest: '' }
  const trimmed = text.trim()
  // A '.' followed by a digit is a DECIMAL, not a sentence end — the naive
  // split rendered "24h gain of 1." / "2% and 7d…" as two paragraphs
  // (founder screenshot, 08-05).
  const match = trimmed.match(/^((?:[^.!?]|\.(?=\d))+[.!?])\s+(.*)$/s)
  if (!match) return { lead: trimmed, rest: '' }
  return { lead: match[1].trim(), rest: match[2].trim() }
}

/**
 * Normalize bullCase / bearCase into an array. The new prompt asks for an
 * array of scenarios but the LLM occasionally returns a single string —
 * accept both so we never drop content. Empty/whitespace items filtered.
 */
function asScenarioList(v) {
  if (Array.isArray(v)) return v.map(s => String(s || '').trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function ShimmerSection({ label, lines = 3 }) {
  return (
    <div className="mt-section mt-loading">
      <div className="mt-section-label" style={{ color: 'var(--text-tertiary, rgba(245,245,247,0.5))' }}>{label}</div>
      <div className="mt-shimmer-block">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="mt-shimmer-line" style={{ width: `${100 - i * 8}%` }} />
        ))}
      </div>
    </div>
  )
}

export default function MarketThesis() {
  const { t } = useTranslation()
  const { data, loading, error, refetch } = useFgThesis()

  const ago = useMemo(() => fmtAgo(data?.generatedAt), [data?.generatedAt])
  const { lead: readLead, rest: readRest } = useMemo(() => splitLeadSentence(data?.read), [data?.read])
  const { lead: thesisLead, rest: thesisRest } = useMemo(() => splitLeadSentence(data?.thesis), [data?.thesis])

  // Loading state — shimmer through the section structure so the layout
  // doesn't reflow when content arrives.
  if (loading && !data) {
    return (
      <div className="mt-card mt-card--loading">
        <div className="mt-header">
          <span className="mt-label">{t('fearGreedPage.thesisLabel', 'MARKET THESIS')}</span>
          <span className="mt-updated">—</span>
        </div>
        <ShimmerSection label={t('fearGreedPage.thesisRead', 'READ')} lines={2} />
        <ShimmerSection label={t('fearGreedPage.thesisThesis', 'THE THESIS')} lines={4} />
        <div className="mt-bull"><ShimmerSection label={t('fearGreedPage.thesisBull', 'BULL CASE')} lines={2} /></div>
        <div className="mt-bear"><ShimmerSection label={t('fearGreedPage.thesisBear', 'BEAR CASE')} lines={2} /></div>
        <ShimmerSection label={t('fearGreedPage.thesisMeanRev', 'MEAN REVERSION')} lines={2} />
      </div>
    )
  }

  // Empty / error — hide the card. Page already has the gauge, chart, and
  // factors above. No "AI is thinking..." placeholder.
  if (error || !data || !data.thesis) return null

  return (
    <div className="mt-card">
      <div className="mt-header">
        <div className="mt-header-left">
          <span className="mt-label">{t('fearGreedPage.thesisLabel', 'MARKET THESIS')}</span>
          <span
            className="mt-live-dot"
            title={t('fearGreedPage.thesisLiveHint', 'Auto-updates when F&G zone, market regime, or BTC price shifts meaningfully. Otherwise refreshes daily.')}
          />
        </div>
        <div className="mt-header-right">
          {data.conviction && (
            <span className={`mt-conviction mt-conviction--${data.conviction}`}>{data.conviction} conviction</span>
          )}
          {ago && (
            <span
              className="mt-updated"
              title={t('fearGreedPage.thesisUpdatedHint', 'LLM last regenerated at this time. Quiet markets keep the same thesis.')}
            >{ago}</span>
          )}
          <button
            type="button"
            className="mt-refresh"
            onClick={refetch}
            aria-label={t('fearGreedPage.thesisRefresh', 'Refresh thesis')}
            title={t('fearGreedPage.thesisRefresh', 'Refresh thesis')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>
      </div>

      {/* READ — what this number means right now */}
      {data.read && (
        <div className="mt-section mt-section--read">
          <div className="mt-section-label">{t('fearGreedPage.thesisRead', 'READ')}</div>
          {readLead && <p className="mt-body mt-editorial">{readLead}</p>}
          {readRest && <p className="mt-body">{readRest}</p>}
        </div>
      )}

      <details className="mt-depth" open={!data.read}>
        <summary>
          <span className="mt-depth-closed">{t('fearGreedPage.thesisExpand', 'Explore the full analysis')}</span>
          <span className="mt-depth-open">{t('fearGreedPage.thesisCollapse', 'Close the full analysis')}</span>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="mt-depth-content">
      {/* THESIS — connect the dots, why we are here */}
      {data.thesis && (
        <div className="mt-section mt-section--thesis">
          <div className="mt-section-label">{t('fearGreedPage.thesisThesis', 'THE THESIS')}</div>
          {thesisLead && <p className="mt-body mt-editorial">{thesisLead}</p>}
          {thesisRest && <p className="mt-body">{thesisRest}</p>}
        </div>
      )}

      {/* CROSS-ASSET — where the money is going (TradFi pipe, pre-IPO, policy) */}
      {data.crossAsset && (
        <div className="mt-section mt-section--cross">
          <div className="mt-section-label mt-cross-label">{t('fearGreedPage.thesisCrossAsset', 'WHERE MONEY IS GOING')}</div>
          <p className="mt-body">{data.crossAsset}</p>
        </div>
      )}

      {/* BULL + BEAR side-by-side on desktop, multi-scenario lists */}
      {(() => {
        const bullList = asScenarioList(data.bullCase)
        const bearList = asScenarioList(data.bearCase)
        if (!bullList.length && !bearList.length) return null
        return (
          <div className="mt-cases">
            {bullList.length > 0 && (
              <div className="mt-section mt-bull">
                <div className="mt-section-label mt-bull-label">{t('fearGreedPage.thesisBull', 'BULL CASE')}</div>
                <ul className="mt-case-list">
                  {bullList.map((scenario, i) => <li key={`bull-${i}`}>{scenario}</li>)}
                </ul>
              </div>
            )}
            {bearList.length > 0 && (
              <div className="mt-section mt-bear">
                <div className="mt-section-label mt-bear-label">{t('fearGreedPage.thesisBear', 'BEAR CASE')}</div>
                <ul className="mt-case-list">
                  {bearList.map((scenario, i) => <li key={`bear-${i}`}>{scenario}</li>)}
                </ul>
              </div>
            )}
          </div>
        )
      })()}

      {/* MEAN REVERSION — historical pattern at this zone */}
      {data.meanReversion && (
        <div className="mt-section mt-meanrev">
          <div className="mt-section-label mt-meanrev-label">{t('fearGreedPage.thesisMeanRev', 'MEAN REVERSION')}</div>
          <p className="mt-body">{data.meanReversion}</p>
        </div>
      )}

      {/* WATCHLIST */}
      {Array.isArray(data.watchlist) && data.watchlist.length > 0 && (
        <div className="mt-section mt-section--watch">
          <div className="mt-section-label">{t('fearGreedPage.thesisWatch', 'WATCH THIS WEEK')}</div>
          <ul className="mt-watchlist">
            {data.watchlist.slice(0, 5).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

        </div>
      </details>

      {/* Attribution footer — frames this as one POV, not a definitive call */}
      <div className="mt-footer">
        <span className="mt-footer-brand">Spectre Brain</span>
        <span className="mt-footer-sep">·</span>
        <span className="mt-footer-pov">POV</span>

      </div>
    </div>
  )
}
