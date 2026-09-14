import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRwaAnalysis, useProtocolAnalysis } from '../useRwaData'
import './ta-ai.css'

/* ── Brain glyph (SVG — no emojis) ── */
function BrainGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 3a3.5 3.5 0 0 0-3.5 3.5V7A3.5 3.5 0 0 0 3 10.5v2A3.5 3.5 0 0 0 6 16v.5a3.5 3.5 0 0 0 3.5 3.5 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3Z"/>
      <path d="M14.5 3A3.5 3.5 0 0 1 18 6.5V7a3.5 3.5 0 0 1 3 3.5v2a3.5 3.5 0 0 1-3 3.5v.5a3.5 3.5 0 0 1-3.5 3.5 3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/>
    </svg>
  )
}

/* ── Relative timestamp ── */
function formatAgo(iso) {
  if (!iso) return ''
  const then = typeof iso === 'string' ? new Date(iso).getTime() : iso
  const diff = Math.max(0, Date.now() - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/* ── Parse body for optional "What changed" section (markdown header) ── */
function parseArticle(article) {
  if (!article || typeof article !== 'string') {
    return { body: article || '', changes: [] }
  }
  // Look for a header like "## What changed" / "**What changed**" / "What changed today:"
  const lower = article.toLowerCase()
  const patterns = [
    /\n\s*##\s+what changed[^\n]*\n/i,
    /\n\s*\*\*what changed[^*]*\*\*\s*\n/i,
    /\n\s*what changed today[:\-]\s*\n/i,
  ]
  for (const p of patterns) {
    const m = article.match(p)
    if (m) {
      const body = article.slice(0, m.index).trim()
      const rest = article.slice(m.index + m[0].length).trim()
      const changes = rest
        .split('\n')
        .map(l => l.replace(/^\s*[-*•]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3)
      return { body, changes }
    }
  }
  return { body: article.trim(), changes: [] }
}

/**
 * AIAnalysisCard — editorial block pulling Spectre Brain analysis.
 * Provide either `topic` (e.g. 'overview', 'stablecoins') OR `slug` for a protocol.
 */
export default function AIAnalysisCard({ topic, slug, collapsedOnMobile = true }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const topicHook = useRwaAnalysis(topic)
  const protocolHook = useProtocolAnalysis(slug)
  const source = slug ? protocolHook : topicHook
  const { article, lastUpdated, stale, loading } = source

  const { body, changes } = parseArticle(article)

  const headerLabel = slug
    ? t('tokenizedAssets.ai.protocolIntelligence', 'Protocol Intelligence')
    : t('tokenizedAssets.ai.spectreBrain', 'Spectre Brain')
  const ago = formatAgo(lastUpdated)

  return (
    <section
      className={`ta-ai${collapsedOnMobile ? ' ta-ai-collapsible' : ''}${expanded ? ' ta-ai-expanded' : ''}`}
      aria-label={t('tokenizedAssets.ai.ariaLabel', 'AI Analysis')}
    >
      <header className="ta-ai-head">
        <div className="ta-ai-chip">
          <BrainGlyph />
          <span className="ta-ai-chip-label">{headerLabel}</span>
        </div>
        <div className="ta-ai-head-right">
          {ago && <span className="ta-ai-timestamp">{ago}</span>}
          {stale && !loading && <span className="ta-ai-stale-pill">{t('tokenizedAssets.ai.refreshing', 'Refreshing')}</span>}
          {collapsedOnMobile && (
            <button
              type="button"
              className="ta-ai-chevron"
              onClick={() => setExpanded(e => !e)}
              aria-label={expanded ? t('tokenizedAssets.ai.collapse', 'Collapse') : t('tokenizedAssets.ai.expand', 'Expand')}
              aria-expanded={expanded}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          )}
        </div>
      </header>

      <div className="ta-ai-body-wrap">
        {!article ? (
          // No article yet — loading OR still generating upstream (202).
          // Show an alive "analyzing" treatment (beacon + scan + shimmer),
          // never dead copy. The 202 fast-retry swaps in real prose the
          // moment generation finishes.
          <div className="ta-ai-analyzing" role="status" aria-live="polite">
            <div className="ta-ai-analyzing-head">
              <span className="ta-ai-beacon" aria-hidden="true">
                <span className="ta-ai-beacon-ring" />
                <span className="ta-ai-beacon-ring ta-ai-beacon-ring--2" />
                <span className="ta-ai-beacon-core" />
              </span>
              <span className="ta-ai-analyzing-label">
                {slug
                  ? t('tokenizedAssets.ai.analyzingProtocol', 'Analyzing protocol signal')
                  : t('tokenizedAssets.ai.analyzingSignal', 'Analyzing live signal')}
              </span>
            </div>
            <div className="ta-ai-scan"><span className="ta-ai-scan-bar" /></div>
            <div className="ta-ai-skeleton">
              <div className="ta-ai-skel-line animate-shimmer" />
              <div className="ta-ai-skel-line animate-shimmer stagger-2" style={{ width: '88%' }} />
              <div className="ta-ai-skel-line animate-shimmer stagger-3" style={{ width: '62%' }} />
            </div>
          </div>
        ) : (
          <>
            <p className="ta-ai-body">{body}</p>
            {changes.length > 0 && (
              <div className="ta-ai-changes">
                <span className="ta-ai-changes-label">{t('tokenizedAssets.ai.whatChanged', 'What changed')}</span>
                <ul className="ta-ai-changes-list">
                  {changes.map((c, i) => (
                    <li key={i} className="ta-ai-changes-item">{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
