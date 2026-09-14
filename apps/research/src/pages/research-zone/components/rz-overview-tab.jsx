/**
 * Research Zone PRO — Intelligence Tab (consolidated briefing)
 * Welcome-page language via SectionShell. Mirrors the old Overview tab
 * structure (AI Analysis, Live Events, Fundamentals, Category Analysis,
 * Market Scenario, Recent Performance, Price Catalysts, About) with real
 * data from existing hooks.
 */
import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fmtChange, fmtSupply,
  SectionDivider, ProgressRing,
} from './rz-pro-shared'
import SectionShell from './rz-pro-sections/section-shell'
import { GRADE_COLORS, GRADE_PCT } from '../data/rz-constants'
import { BrainIcon, ChartIcon } from '../data/rz-icons.jsx'
import './rz-overview-tab.css'

// Inline TrendBadge — bullish/bearish pill with pulse dot (formerly in rz-tab-primitives)
const TrendBadge = React.memo(({ bullish, label }) => (
  <span className={`rz-tb ${bullish ? 'rz-tb--bull' : 'rz-tb--bear'}`}>
    <span className="rz-tb-dot" />
    {label || (bullish ? 'Bullish' : 'Bearish')}
  </span>
))
TrendBadge.displayName = 'TrendBadge'


// ────────────────────────────────────────────────────────────────────────────────
// 1. AI ANALYSIS + SENTIMENT
// ────────────────────────────────────────────────────────────────────────────────

const AnalysisSection = React.memo(({ aiAnalysis, change24h, sentScore, fearGreed, aiAnalyse }) => {
  const { t } = useTranslation()
  if (!aiAnalysis) return null
  // Coerce to number — sentScore.overall has been observed as a string from
  // the API, which made `.toFixed(1)` throw and crashed the Overview tab.
  const scoreNum = Number(sentScore?.overall)
  const score = Number.isFinite(scoreNum) ? scoreNum : 6.5
  const sentLabel = score >= 7 ? 'Bullish' : score >= 4 ? 'Neutral' : 'Bearish'
  const isBullish = change24h >= 0

  const fg = fearGreed
  const fgScore = fg?.score ?? null
  const fgLabel = fg?.name ?? null
  const fgColor = fgScore != null
    ? (fgScore <= 25 ? '#ef4444' : fgScore <= 45 ? '#f97316'
       : fgScore <= 55 ? '#eab308' : fgScore <= 75 ? '#84cc16' : '#22c55e')
    : null

  return (
    <SectionShell
      id="intel-ai-analysis"
      label={t('researchPro.overview.analysis.label', "INTELLIGENCE · AI ANALYSIS")}
      title={t('researchPro.overview.analysis.title', "AI Analysis")}
      subtitle={t('researchPro.overview.analysis.subtitle', "Cross-signal synthesis · trend, support, resistance")}
      aiBadge
      rightSlot={<TrendBadge bullish={isBullish} />}
      collapsible
    >
      <p className="rz-ov2-analysis-text">{aiAnalysis.trend}</p>
      <p className="rz-ov2-analysis-subtext">{aiAnalysis.quickTA}</p>

      <div className="rz-ov2-analysis-grid">
        <div className="rz-ov2-analysis-metric">
          <span className="rz-ov2-analysis-metric-label">
            <svg className="rz-ov2-analysis-metric-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
            {t('researchPro.overview.analysis.support', "Support")}
          </span>
          <span className="rz-ov2-analysis-metric-val positive">{aiAnalysis.support}</span>
        </div>
        <div className="rz-ov2-analysis-metric">
          <span className="rz-ov2-analysis-metric-label">
            <svg className="rz-ov2-analysis-metric-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            {t('researchPro.overview.analysis.resistance', "Resistance")}
          </span>
          <span className="rz-ov2-analysis-metric-val negative">{aiAnalysis.resistance}</span>
        </div>
        <div className="rz-ov2-analysis-metric">
          <span className="rz-ov2-analysis-metric-label">
            <svg className="rz-ov2-analysis-metric-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>
            {t('researchPro.overview.analysis.sentiment', "Sentiment")}
          </span>
          <span className="rz-ov2-analysis-metric-val neutral">{score.toFixed(1)}/10 {sentLabel}</span>
        </div>
        {fgScore != null && (
          <div className="rz-ov2-analysis-metric">
            <span className="rz-ov2-analysis-metric-label">
              <svg className="rz-ov2-analysis-metric-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0z"/></svg>
              Fear & Greed
            </span>
            <span className="rz-ov2-analysis-metric-val" style={{ color: fgColor }}>
              {fgScore} {fgLabel}
            </span>
          </div>
        )}
      </div>

      {/* Market Regime badge */}
      {aiAnalyse?.regime && (
        <div className="rz-ov2-regime-row">
          <span className={`rz-ov2-regime-badge ${aiAnalyse.regime.toLowerCase()}`}>
            {aiAnalyse.regime}
          </span>
          {aiAnalyse.state && (
            <span className="rz-ov2-regime-state">{aiAnalyse.state}</span>
          )}
          {aiAnalyse.liquidations?.total != null && (
            <span className="rz-ov2-regime-liq">
              Liq ${(aiAnalyse.liquidations.total / 1e6).toFixed(1)}M
            </span>
          )}
          {aiAnalyse.whaleFlowUsd != null && (
            <span className="rz-ov2-regime-whale">
              Whale {aiAnalyse.whaleFlowUsd >= 0 ? '+' : ''}${(Math.abs(aiAnalyse.whaleFlowUsd) / 1e6).toFixed(1)}M
            </span>
          )}
        </div>
      )}
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 2. LIVE EVENTS STRIP
// ────────────────────────────────────────────────────────────────────────────────

const EVENT_SEVERITY = { liquidation: 'critical', whale: 'high' }

const typeIcon = (type) => {
  const s = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (type) {
    case 'breakout':
      return <svg {...s}><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
    case 'liquidation':
      return <svg {...s}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
    case 'whale':
      return <svg {...s}><path d="M2 12c2-3 4-4 6-4s4 2 6 2 4-1 6-4" /><path d="M2 16c2-3 4-4 6-4s4 2 6 2 4-1 6-4" /></svg>
    case 'volume':
      return <svg {...s}><rect x="6" y="10" width="3" height="8" rx="1" /><rect x="10.5" y="6" width="3" height="12" rx="1" /><rect x="15" y="2" width="3" height="16" rx="1" /></svg>
    case 'listing':
      return <svg {...s}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    default:
      return <svg {...s}><circle cx="12" cy="12" r="4" /></svg>
  }
}

const LiveEventsStrip = React.memo(({ liveEvents }) => {
  const { t } = useTranslation()
  if (!liveEvents || liveEvents.length === 0) return null
  const events = liveEvents.slice(0, 5)

  return (
    <SectionShell
      id="intel-live-events"
      label={t('researchPro.overview.liveeventsstrip.label', "INTELLIGENCE · LIVE EVENTS")}
      title={t('researchPro.overview.liveeventsstrip.title', "Live Events")}
      subtitle={t('researchPro.overview.liveeventsstrip.subtitle', "Whale moves, liquidations, breakouts in real-time")}
      liveBadge
      collapsible
    >
      <div className="rz-ov2-events-list">
        {events.map((ev, i) => {
          const severity = EVENT_SEVERITY[ev.type] || 'medium'
          return (
            <div
              key={ev.id || i}
              className={`rz-ov2-event-row rz-ov2-event--${severity}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className={`rz-ov2-event-icon-wrap rz-ov2-event-icon--${ev.type}`}>{typeIcon(ev.type)}</span>
              <div className="rz-ov2-event-content">
                <span className="rz-ov2-event-token">{ev.token}</span>
                <span className="rz-ov2-event-action">{ev.action}</span>
                {ev.amount && <span className="rz-ov2-event-amount">{ev.amount}</span>}
              </div>
              {ev.time && <span className="rz-ov2-event-time">{ev.time}</span>}
            </div>
          )
        })}
      </div>
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 3. FUNDAMENTALS GRADE — Ported from Analysis tab
// ────────────────────────────────────────────────────────────────────────────────

const FundamentalsSection = React.memo(({ sym, grades }) => {
  const { t } = useTranslation()
  if (!grades) return null

  // Use API-provided dimensions if available, fallback to hardcoded keys
  const dimensions = grades.dimensions?.length
    ? grades.dimensions
    : [
        { key: 'liquidity', label: 'Liquidity', letter: grades.liquidity, score: GRADE_PCT[grades.liquidity] || 50 },
        { key: 'supply', label: 'Supply', letter: grades.supply, score: GRADE_PCT[grades.supply] || 50 },
        { key: 'revenue', label: 'Revenue', letter: grades.revenue, score: GRADE_PCT[grades.revenue] || 50 },
        { key: 'smartMoney', label: 'Smart Money', letter: grades.smartMoney, score: GRADE_PCT[grades.smartMoney] || 50 },
        { key: 'momentum', label: 'Momentum', letter: grades.momentum, score: GRADE_PCT[grades.momentum] || 50 },
      ].filter(d => d.letter)

  const overallColor = GRADE_COLORS[grades.overall] || '#F59E0B'

  return (
    <SectionShell
      id="intel-fundamentals"
      label={t('researchPro.overview.fundamentals.label', "INTELLIGENCE · FUNDAMENTALS")}
      title={t('researchPro.overview.fundamentals.title', "Fundamentals")}
      subtitle={t('researchPro.overview.fundamentals.subtitle', "Liquidity · supply · momentum · revenue · smart money")}
      rightSlot={grades.overallScore != null && (
        <span className="rz-intel-fund-score-badge" style={{ color: overallColor }}>
          {grades.overallScore}/100
        </span>
      )}
      collapsible
    >
      {/* Overall grade with ProgressRing */}
      {/* 2026-05-26 beta-quality fix: only render when there's a real overall
          grade or score. Previously defaulted to a 50% amber "C" ring even
          when the API returned no overall — looked like a real verdict. */}
      {(grades.overall || grades.overallScore != null) && (
        <div className="rz-intel-fund-overall">
          <ProgressRing value={grades.overallScore ?? GRADE_PCT[grades.overall] ?? 50} size={44} strokeWidth={4} color={overallColor} />
          <div>
            <span className="rz-intel-fund-overall-label">{t('researchPro.overview.fundamentals.overallGrade', "Overall Grade")}</span>
            <span className="rz-intel-fund-overall-grade" style={{ color: overallColor }}>
              {grades.overall || '—'}
            </span>
          </div>
        </div>
      )}

      {/* Dimension rows */}
      {dimensions.length > 0 && (
        <div className="rz-intel-fund-dims">
          {dimensions.map(dim => {
            // 2026-05-26 beta-quality fix: don't fabricate a 'C' / 50% grade
            // when the API returns a dimension with no letter/score. Skip
            // those rows entirely so we never show a fake middling grade.
            const letter = dim.letter || grades[dim.key]
            if (!letter) return null
            const color = GRADE_COLORS[letter] || '#F59E0B'
            const pct = dim.score || GRADE_PCT[letter] || 50
            return (
              <div key={dim.key} className="rz-intel-fund-dim">
                <span className="rz-intel-fund-dim-label">{dim.label}</span>
                <div className="rz-intel-fund-dim-bar-track">
                  <div className="rz-intel-fund-dim-bar-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
                <span className="rz-intel-fund-dim-grade" style={{ color }}>{letter}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Insight + catalysts/risks */}
      {grades.insight && (
        <div className="rz-intel-fund-insight">
          <p className="rz-intel-fund-insight-text">{grades.insight}</p>
          <div className="rz-intel-fund-tags">
            {(grades.catalysts || []).map(c => (
              <span key={c} className="rz-intel-fund-tag rz-intel-fund-tag--positive">{c}</span>
            ))}
            {(grades.risks || []).map(r => (
              <span key={r} className="rz-intel-fund-tag rz-intel-fund-tag--negative">{r}</span>
            ))}
          </div>
        </div>
      )}
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 4. MARKET SCENARIO — Ported from Sentiment tab
// ────────────────────────────────────────────────────────────────────────────────

const MarketScenarioSection = React.memo(({ scenario }) => {
  const { t } = useTranslation()
  if (!scenario) return null
  return (
    <SectionShell
      id="intel-scenario"
      label={t('researchPro.overview.marketscenario.label', "INTELLIGENCE · MARKET SCENARIO")}
      title={t('researchPro.overview.marketscenario.title', "Market Scenario")}
      subtitle={t('researchPro.overview.marketscenario.subtitle', "Regime · bull / bear case · key levels")}
      aiBadge
      collapsible
    >
      <div className="rz-intel-scenario-header">
        <span className="rz-intel-scenario-label" style={{ color: scenario.color }}>{scenario.label}</span>
        <span className="rz-intel-scenario-conf">{scenario.confidence}% confidence</span>
      </div>
      <p className="rz-intel-scenario-trigger">{scenario.trigger}</p>
      <div className="rz-intel-scenario-cases">
        <div className="rz-intel-scenario-case bull">
          <div className="rz-intel-scenario-case-title">{t('researchPro.overview.marketscenario.bullCase', "Bull Case")}</div>
          <p className="rz-intel-scenario-case-text">{scenario.bullCase}</p>
        </div>
        <div className="rz-intel-scenario-case bear">
          <div className="rz-intel-scenario-case-title">{t('researchPro.overview.marketscenario.bearCase', "Bear Case")}</div>
          <p className="rz-intel-scenario-case-text">{scenario.bearCase}</p>
        </div>
      </div>
      {scenario.keyLevels?.length > 0 && (
        <div className="rz-intel-scenario-levels">
          {scenario.keyLevels
            .filter(lvl => {
              if (lvl == null) return false
              const p = Number(lvl.price ?? lvl)
              return Number.isFinite(p) || typeof lvl === 'string'
            })
            .map((lvl, i) => (
              <span key={i} className="rz-intel-scenario-level">{lvl.label}: {lvl.price}</span>
            ))}
        </div>
      )}
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 4b. RECENT PERFORMANCE — 24h, 7d, 30d change stats + narrative
// ────────────────────────────────────────────────────────────────────────────────

const RecentPerformanceSection = React.memo(({ td, sym, fmtPrice }) => {
  const { t } = useTranslation()
  const c24 = td?.change24h
  const c7 = td?.change7d
  const c30 = td?.change30d

  if (c24 == null && c7 == null && c30 == null) return null

  const fmt = (v) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—'
  const cls = (v) => v != null ? (v >= 0 ? 'positive' : 'negative') : ''

  // Build narrative
  const parts = []
  if (c30 != null) parts.push(`The price is ${c30 >= 0 ? 'up' : 'down'} ${fmt(c30)} over the past 30 days`)
  if (c24 != null) parts.push(`${c30 != null ? '' : 'The price is '}${c24 >= 0 ? 'up' : 'down'} ${fmt(c24)} in the last 24 hours`)

  let momentum = ''
  if (c24 != null && c7 != null) {
    if (c24 > 0 && c7 > 0) momentum = `${sym} has shown significant positive momentum recently.`
    else if (c24 < 0 && c7 < 0) momentum = `${sym} has been under selling pressure recently.`
    else momentum = `${sym} is showing mixed signals in the short term.`
  }

  const narrative = parts.length > 0
    ? `${parts.join(' and ')}.${momentum ? ' ' + momentum : ''}`
    : null

  return (
    <SectionShell
      id="intel-recent-perf"
      label={t('researchPro.overview.recentperformance.label', "INTELLIGENCE · RECENT PERFORMANCE")}
      title={t('researchPro.overview.recentperformance.title', "Recent Performance")}
      subtitle={t('researchPro.overview.recentperformance.subtitle', "24h / 7d / 30d change · momentum narrative")}
      collapsible
    >
        <div className="rz-intel-perf-cards">
          <div className="rz-intel-perf-card">
            <span className="rz-intel-perf-card-label">24h</span>
            <span className={`rz-intel-perf-card-value ${cls(c24)}`}>{fmt(c24)}</span>
          </div>
          <div className="rz-intel-perf-card">
            <span className="rz-intel-perf-card-label">7d</span>
            <span className={`rz-intel-perf-card-value ${cls(c7)}`}>{fmt(c7)}</span>
          </div>
          <div className="rz-intel-perf-card">
            <span className="rz-intel-perf-card-label">30d</span>
            <span className={`rz-intel-perf-card-value ${cls(c30)}`}>{fmt(c30)}</span>
          </div>
        </div>

        {narrative && (
          <p className="rz-intel-perf-narrative">{narrative}</p>
        )}
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 4c. PRICE CATALYSTS — bulleted list of catalyst strings
// ────────────────────────────────────────────────────────────────────────────────

const PriceCatalystsSection = React.memo(({ tokenProfile, fundamentalsGrades }) => {
  const { t } = useTranslation()
  const catalysts = fundamentalsGrades?.catalysts
    || tokenProfile?.token_details?.catalysts
    || []

  if (!catalysts.length) return null

  return (
    <SectionShell
      id="intel-catalysts"
      label={t('researchPro.overview.pricecatalysts.label', "INTELLIGENCE · PRICE CATALYSTS")}
      title={t('researchPro.overview.pricecatalysts.title', "Price Catalysts")}
      subtitle={t('researchPro.overview.pricecatalysts.subtitle', "Tracked events that could move the market")}
      collapsible
    >
      <ul className="rz-intel-catalyst-list">
        {catalysts.map((c, i) => (
          <li key={i} className="rz-intel-catalyst-item">
            <span className="rz-intel-catalyst-dot" />
            <span className="rz-intel-catalyst-text">{c}</span>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 5. ABOUT + LINKS — description, categories, token links
// ────────────────────────────────────────────────────────────────────────────────

const scoreColor = (v) => {
  if (v >= 70) return '#34d399'
  if (v >= 50) return '#eab308'
  return '#f87171'
}

const AboutSection = React.memo(({ description, categories, coinDetails, spectreSocial, sym, dayMode }) => {
  const [expanded, setExpanded] = useState(false)
  const text = description || ''
  const isLong = text.length > 240
  const cats = (categories || []).slice(0, 6)

  if (!text && cats.length === 0) return null

  const hasMeta = coinDetails?.genesisDate || (coinDetails?.platforms && Object.keys(coinDetails.platforms).length > 0)
  const scores = coinDetails?.scores
  const scoreEntries = scores ? [
    scores.coingecko != null && { label: 'CoinGecko', value: scores.coingecko },
    scores.community != null && { label: 'Community', value: scores.community },
    scores.developer != null && { label: 'Developer', value: scores.developer },
    scores.liquidity != null && { label: 'Liquidity', value: scores.liquidity },
  ].filter(Boolean) : []

  // Enrich coinDetails with spectreSocial links if coinDetails is missing links
  const enrichedCoinDetails = coinDetails || (spectreSocial?.Social_Media ? {
    links: {
      homepage: spectreSocial.Social_Media.Website ? [spectreSocial.Social_Media.Website] : [],
      twitter_screen_name: spectreSocial.Social_Media.Twitter
        ? spectreSocial.Social_Media.Twitter.replace('https://twitter.com/', '').replace('https://x.com/', '')
        : null,
      telegram_channel_identifier: spectreSocial.Social_Media.Telegram
        ? spectreSocial.Social_Media.Telegram.replace(/^https:\/\/(?:t|telegram)\.me\//, '')
        : null,
      subreddit_url: spectreSocial.Social_Media.Reddit || null,
      repos_url: { github: spectreSocial.Social_Media.Github ? [spectreSocial.Social_Media.Github] : [] },
    },
  } : null)

  return (
    <SectionShell
      id="intel-about"
      label={`INTELLIGENCE · ABOUT ${sym}`}
      title={`About ${sym}`}
      subtitle={categories?.length ? `${categories[0]}${categories[1] ? ' · ' + categories[1] : ''}` : undefined}
      collapsible
      rightSlot={hasMeta ? (
        <div className="rz-ov2-about-meta">
          {coinDetails.genesisDate && (
            <span className="rz-ov2-about-meta-pill">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              {coinDetails.genesisDate}
            </span>
          )}
          {coinDetails.platforms && Object.keys(coinDetails.platforms).length > 0 && (
            <span className="rz-ov2-about-meta-pill">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              {Object.keys(coinDetails.platforms).length} chain{Object.keys(coinDetails.platforms).length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      ) : undefined}
    >
      {/* Description */}
      {text && (
        <div className="rz-ov2-about-body">
          <p className={`rz-ov2-about-text ${!expanded && isLong ? 'rz-ov2-about-text--clamped' : ''}`}>
            {text}
          </p>
          {isLong && (
            <button type="button" className="rz-ov2-about-toggle" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Show less' : 'Read more'}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={expanded ? 'rz-ov2-about-toggle-icon flipped' : 'rz-ov2-about-toggle-icon'}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Scores */}
      {scoreEntries.length > 0 && (
        <div className="rz-ov2-about-scores">
          {scoreEntries.map(s => (
            <div key={s.label} className="rz-ov2-about-score">
              <div className="rz-ov2-about-score-ring">
                <svg width="36" height="36" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke={scoreColor(s.value)} strokeWidth="3"
                    strokeDasharray={`${2 * Math.PI * 15}`}
                    strokeDashoffset={`${2 * Math.PI * 15 * (1 - s.value / 100)}`}
                    strokeLinecap="round" transform="rotate(-90 18 18)"
                    style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
                  />
                </svg>
                <span className="rz-ov2-about-score-num" style={{ color: scoreColor(s.value) }}>
                  {s.value % 1 === 0 ? s.value : s.value.toFixed(1)}
                </span>
              </div>
              <span className="rz-ov2-about-score-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Categories footer */}
      {cats.length > 0 && (
        <div className="rz-ov2-about-footer">
          <div className="rz-ov2-about-chips">
            {cats.map(cat => (
              <span key={cat} className="rz-ov2-about-chip">{cat}</span>
            ))}
          </div>
        </div>
      )}
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// 3b. CATEGORY ANALYSIS — Sector performance chart + top mover + AI analysis
// ────────────────────────────────────────────────────────────────────────────────

const CategoryAnalysisSection = React.memo(({ sectors, aiAnalysis, dayMode }) => {
  const { t } = useTranslation()
  // SectionShell owns collapsible state; we still need local isOpen to gate canvas draw
  const [isOpen, setIsOpen] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('rz-collapsed-sections')) || {}
      return stored['intel-category-analysis'] !== false
    } catch { return true }
  })
  const canvasRef = useRef(null)
  const [selectedCategory, setSelectedCategory] = useState('')

  const items = (sectors || []).slice(0, 8)

  // Find top mover
  const topMover = items.length
    ? items.reduce((best, s) => (Math.abs(s.avgChange) > Math.abs(best.avgChange) ? s : best), items[0])
    : null

  // AI analysis categories
  const categories = aiAnalysis?.categories || items.map(s => s.name)
  const activeCat = selectedCategory || (categories.length ? categories[0] : '')

  // Draw bar chart
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !items.length || !isOpen) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const w = rect.width
    const h = rect.height
    const barCount = items.length
    const gap = 4
    const barW = Math.max(6, (w - gap * (barCount + 1)) / barCount)
    const maxAbs = Math.max(...items.map(s => Math.abs(s.avgChange)), 1)
    const zeroY = h / 2

    // Draw zero line
    ctx.strokeStyle = dayMode ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, zeroY)
    ctx.lineTo(w, zeroY)
    ctx.stroke()

    items.forEach((s, i) => {
      const x = gap + i * (barW + gap)
      const barH = (Math.abs(s.avgChange) / maxAbs) * (h / 2 - 8)
      const isPositive = s.avgChange >= 0
      const y = isPositive ? zeroY - barH : zeroY
      const fillColor = isPositive
        ? (dayMode ? '#059669' : '#10b981')
        : (dayMode ? '#dc2626' : '#ef4444')

      ctx.fillStyle = fillColor
      ctx.globalAlpha = 0.8
      if (ctx.roundRect) {
        ctx.beginPath()
        ctx.roundRect(x, y, barW, barH, 2)
        ctx.fill()
      } else {
        ctx.fillRect(x, y, barW, barH)
      }
      ctx.globalAlpha = 1

      // Label below chart
      ctx.fillStyle = dayMode ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)'
      ctx.font = '9px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      const label = s.name.length > 6 ? s.name.slice(0, 5) + '..' : s.name
      ctx.fillText(label, x + barW / 2, h - 2)
    })
  }, [items, dayMode, isOpen])

  if (!items.length) return null

  // Get AI text for selected category
  const getAiText = () => {
    if (!aiAnalysis) return 'No analysis available for this category.'
    if (aiAnalysis['AI Analysis']) {
      // If there's a general AI analysis, check if it mentions the selected category
      return aiAnalysis['AI Analysis']
    }
    return 'No analysis available for this category.'
  }

  return (
    <SectionShell
      id="intel-category-analysis"
      label={t('researchPro.overview.categoryanalysis.label', "INTELLIGENCE · CATEGORY ANALYSIS")}
      title={t('researchPro.overview.categoryanalysis.title', "Category Analysis")}
      subtitle={t('researchPro.overview.categoryanalysis.subtitle', "Sector performance · top mover · AI narrative")}
      aiBadge
      collapsible
    >
          <div className="rz-intel-cat-grid">
            {/* Left: Sector Performance bar chart */}
            <div className="rz-intel-cat-chart-col">
              <span className="rz-intel-cat-label">{t('researchPro.overview.categoryanalysis.sectorPerformance', "Sector Performance")}</span>
              <div className="rz-intel-cat-chart-wrap">
                <canvas ref={canvasRef} className="rz-intel-cat-canvas" />
              </div>
            </div>

            {/* Middle: Top category token */}
            <div className="rz-intel-cat-top-col">
              <span className="rz-intel-cat-label">{t('researchPro.overview.categoryanalysis.topCategoryToken', "Top category token")}</span>
              {topMover && (
                <div className="rz-intel-cat-top-info">
                  <span className="rz-intel-cat-top-name">{topMover.topMover || topMover.name}</span>
                  <span className={`rz-intel-cat-top-change ${topMover.avgChange >= 0 ? 'positive' : 'negative'}`}>
                    {topMover.avgChange >= 0 ? '+' : ''}{topMover.avgChange.toFixed(2)}%
                  </span>
                  <span className="rz-intel-cat-top-sector">{topMover.name}</span>
                </div>
              )}
            </div>

            {/* Right: AI Analysis with dropdown */}
            <div className="rz-intel-cat-ai-col">
              <span className="rz-intel-cat-label">{t('researchPro.overview.categoryanalysis.aiAnalysis', "AI Analysis")}</span>
              <select
                className="rz-intel-cat-dropdown"
                value={activeCat}
                onChange={e => setSelectedCategory(e.target.value)}
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <p className="rz-intel-cat-ai-text">{getAiText()}</p>
            </div>
          </div>
    </SectionShell>
  )
})


// ────────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE TAB — Main export
// ────────────────────────────────────────────────────────────────────────────────

export default function IntelligenceTab({
  sym, td, aiAnalysis,
  fmtPrice, fmtLarge,
  coinDetails, dayMode,
  spectreSentScore, spectreFearGreed, spectreTweets, spectreMarketDetails,
  onChainData, aiAnalyse, dominance, liveEvents,
  marketScenario, spectreSocial,
  tokenProfile, fundamentalsGrades,
  sectorData, sectorAiAnalysis,
}) {
  // Enrich AI analysis with token profile data if available
  const enrichedAnalysis = aiAnalysis && tokenProfile?.token_details ? {
    ...aiAnalysis,
    support: aiAnalysis.support || (tokenProfile.token_details.key_levels?.support
      ? `$${tokenProfile.token_details.key_levels.support.toLocaleString()}`
      : aiAnalysis.support),
    resistance: aiAnalysis.resistance || (tokenProfile.token_details.key_levels?.resistance
      ? `$${tokenProfile.token_details.key_levels.resistance.toLocaleString()}`
      : aiAnalysis.resistance),
    trend: tokenProfile.token_details.ai_insight || aiAnalysis.trend,
  } : aiAnalysis

  return (
    <div className="rz-ov2-container">
      {/* 1. AI Analysis + Sentiment */}
      <AnalysisSection
        aiAnalysis={enrichedAnalysis}
        change24h={td.change24h}
        sentScore={spectreSentScore}
        fearGreed={spectreFearGreed}
        aiAnalyse={aiAnalyse}
      />

      {/* 2. Live Events */}
      <LiveEventsStrip liveEvents={liveEvents} />

      {/* 3. Fundamentals Grade */}
      <FundamentalsSection sym={sym} grades={fundamentalsGrades} />

      {/* 3b. Category Analysis */}
      <CategoryAnalysisSection
        sectors={sectorData}
        aiAnalysis={sectorAiAnalysis}
        dayMode={dayMode}
      />

      {/* 4. Market Scenario */}
      <MarketScenarioSection scenario={marketScenario} />

      {/* 4b. Recent Performance */}
      <RecentPerformanceSection td={td} sym={sym} fmtPrice={fmtPrice} />

      {/* 4c. Price Catalysts */}
      <PriceCatalystsSection tokenProfile={tokenProfile} fundamentalsGrades={fundamentalsGrades} />

      {/* 5. About + Links */}
      <AboutSection
        description={coinDetails?.description}
        categories={coinDetails?.categories}
        coinDetails={coinDetails}
        spectreSocial={spectreSocial}
        sym={sym}
        dayMode={dayMode}
      />
    </div>
  )
}
