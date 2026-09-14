/**
 * MarketContext Component
 * Collapsible wrapper for Key Focus + Narrative + Market Regime Strip
 * + Dominant Themes + Analysis History.
 * Premium glass card with live pulse indicator and staggered content reveal.
 *
 * KEY FOCUS: Extracted from #1 theme headline — what's driving markets right now
 * NARRATIVE: The dominant market thesis — tariffs, AI, geopolitics, etc.
 */

import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import MarketRegimeStrip from './MarketRegimeStrip'
import DominantThemes from './DominantThemes'
import { formatTimeAgo } from '../utils/relativeTime'
import './MarketContext.css'

/* ── Risk Level Color ── */
function riskColor(level) {
  const map = { low: 'var(--bull)', moderate: 'var(--amber)', elevated: '#F97316', high: 'var(--bear)', extreme: '#DC2626' }
  return map[level?.toLowerCase()] || 'var(--text-muted)'
}

/* ── Key Focus + Narrative (extracted from themes) ── */
// `thesis` = the writer's marketThesis (politics/geopolitics, gold, oil,
// dollar, AI trade — the general read). The regime `verdict` is only the
// fallback for old payloads: it already renders as SPECTRE VERDICT inside
// MarketRegimeStrip, and showing it here too printed the same sentence
// twice on the page (2026-06-11).
const KeyFocusNarrative = ({ themes = [], verdict, thesis }) => {
  const { t } = useTranslation()
  const { keyFocus, narrative } = useMemo(() => {
    if (!themes || themes.length === 0) return { keyFocus: null, narrative: null }

    // Key focus = #1 major theme headline (or first theme if no major)
    const majorTheme = themes.find(t => t.type === 'major') || themes[0]
    const focusTheme = themes.find(t => t.type === 'focus')

    // Narrative = the focus theme body, or the first major theme body
    const narrativeSource = focusTheme || majorTheme
    const narrativeText = narrativeSource?.body || null

    return {
      keyFocus: majorTheme?.headline || null,
      narrative: narrativeText,
    }
  }, [themes])

  const thesisText = thesis || verdict

  if (!keyFocus && !narrative && !thesisText) return null

  return (
    <div className="mc-focus">
      {keyFocus && (
        <div className="mc-focus__row">
          <span className="mc-focus__label">{t('economicCalendar.marketContext.keyFocus', 'KEY FOCUS')}</span>
          <span className="mc-focus__text">{keyFocus}</span>
        </div>
      )}
      {narrative && (
        <div className="mc-focus__row">
          <span className="mc-focus__label">{t('economicCalendar.marketContext.narrative', 'NARRATIVE')}</span>
          <span className="mc-focus__narrative">{narrative}</span>
        </div>
      )}
      {thesisText && (
        <div className="mc-focus__row">
          <span className="mc-focus__label">{t('economicCalendar.marketContext.thesis', 'THESIS')}</span>
          <span className="mc-focus__thesis">{thesisText}</span>
        </div>
      )}
    </div>
  )
}

/* ── Analysis History Timeline ── */
const HistoryTimeline = ({ history = [], loading }) => {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  const [expanded, setExpanded] = useState(false)
  const items = expanded ? history : history.slice(0, 4)

  if (loading) {
    return (
      <div className="mc-history">
        <div className="mc-history__label">{t('economicCalendar.marketContext.analysisHistory', 'ANALYSIS HISTORY')}</div>
        <div className="mc-history__list">
          {[0, 1, 2].map(i => (
            <div key={i} className="mc-history__item mc-history__item--skeleton">
              <div className="mc-history__shimmer" style={{ width: '60%' }} />
              <div className="mc-history__shimmer" style={{ width: '40%', marginTop: 6 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (history.length === 0) return null

  return (
    <div className="mc-history">
      <div className="mc-history__label">{t('economicCalendar.marketContext.analysisHistory', 'ANALYSIS HISTORY')}</div>
      <div className="mc-history__list">
        {items.map((entry, i) => (
          <div
            key={entry.id || i}
            className="mc-history__item"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="mc-history__item-top">
              <span className="mc-history__timestamp">{formatTimeAgo(entry.generatedAt, t)}</span>
              {entry.outlook?.riskLevel && (
                <span
                  className="mc-history__risk"
                  style={{ color: riskColor(entry.outlook.riskLevel) }}
                >
                  {entry.outlook.riskLevel.toUpperCase()}
                </span>
              )}
              {entry.sentiment && (
                <span className={`mc-history__sentiment mc-history__sentiment--${entry.sentiment}`}>
                  {entry.sentiment}
                </span>
              )}
            </div>
            {entry.verdict && (
              <div className="mc-history__verdict">{entry.verdict}</div>
            )}
            {entry.themes?.length > 0 && (
              <div className="mc-history__themes">
                {entry.themes.map((t, j) => (
                  <span key={j} className={`mc-history__theme-tag mc-history__theme-tag--${t.type}`}>
                    {t.headline}
                  </span>
                ))}
              </div>
            )}
            {entry.dataSnapshot && (
              <div className="mc-history__snapshot">
                {entry.dataSnapshot.btcPrice && (
                  <span className="mc-history__snap-item">
                    BTC {fmtPrice(Number(entry.dataSnapshot.btcPrice))}
                  </span>
                )}
                {entry.dataSnapshot.fearGreed && (
                  <span className="mc-history__snap-item">
                    F&G {entry.dataSnapshot.fearGreed}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {history.length > 4 && (
        <button className="mc-history__toggle" onClick={() => setExpanded(p => !p)}>
          {expanded
            ? t('economicCalendar.marketContext.showLess', 'Show less')
            : t('economicCalendar.marketContext.showMore', 'Show {{count}} more', { count: history.length - 4 })}
        </button>
      )}
    </div>
  )
}

const MarketContext = ({ regime, themes = [], themesLoading, history = [], historyLoading, verdict, thesis }) => {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  if (!regime && themes.length === 0 && !themesLoading) return null

  return (
    <div className={`market-context${collapsed ? ' market-context--collapsed' : ''}`}>
      <button
        className="market-context__header"
        onClick={() => setCollapsed((p) => !p)}
      >
        <div className="market-context__header-left">
          <span className="market-context__pulse" />
          <span className="market-context__title">{t('economicCalendar.marketContext.title', 'Market Context')}</span>
          {regime?.weekOf && (
            <span className="market-context__week">{regime.weekOf}</span>
          )}
        </div>
        <span className={`market-context__chevron${collapsed ? ' market-context__chevron--down' : ''}`}>
          &#x25B4;
        </span>
      </button>

      {!collapsed && (
        <div className="market-context__body">
          {/* Key Focus + Narrative — always first */}
          <KeyFocusNarrative themes={themes} verdict={verdict} thesis={thesis} />

          {regime && <MarketRegimeStrip regime={regime} />}
          <DominantThemes themes={themes} loading={themesLoading} />
          <HistoryTimeline history={history} loading={historyLoading} />
        </div>
      )}
    </div>
  )
}

export default MarketContext
