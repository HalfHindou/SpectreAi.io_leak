/**
 * AIIntelligenceCard — replaces the AI Dossier paragraph with a
 * trading-desk intelligence readout.
 *
 *   • NeedleGauge sentiment 0..100, with verdict beside it
 *   • 3 ScoreChips: Momentum / Liquidity / Holder Trust
 *   • Strengths (mint) vs Risks (coral) chips derived from the scores
 *   • Attribute tag chips from dossier `lore.tags[]` (when present)
 *   • Two-sentence prose with a "Read full analysis" expander
 *
 * Reveal animation: a one-shot lime scan-line sweeps top-to-bottom the
 * first time the card enters the viewport (RevealOnScroll wrapper).
 *
 * Dossier fetch contract preserved exactly from DossierStory — same
 * endpoint, same 30s polling, same payload shape. Only the render
 * surface is new.
 */
import React, { useMemo, useState } from 'react'
import RevealOnScroll from './ui/RevealOnScroll'
import { NeedleGauge, ScoreChip } from './ui/viz'
import useDossier from '../hooks/useDossier'
import {
  liquidityHealth as computeLiquidityHealth,
  momentumScore,
  holderTrustScore,
  sentimentScore,
  scoreVerdict,
  deriveCallouts,
} from '../lib/derivedMetrics'
import './AIIntelligenceCard.css'

function firstTwoSentences(text) {
  const t = String(text || '').replace(/\nVerdict:.*/i, '').trim()
  if (!t) return ''
  const parts = t.match(/[^.!?]+[.!?]+/g)
  if (!parts || parts.length === 0) return t
  return parts.slice(0, 2).join(' ').trim()
}

function relativeTime(ts) {
  if (!ts) return ''
  const diff = Math.max(0, Date.now() - ts)
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function AIIntelligenceCard({
  token,
  marketCap,
  liquidity,
  change5m,
  change1h,
  change4h,
  change6h,
  change24h,
  holders,
  buyVolUSD,            // recent buy volume (from useLatestTrades aggregation)
  sellVolUSD,           // recent sell volume
  hourlyVolumes,        // last-N hourly volume array (optional)
}) {
  const { data, updatedAt, chain } = useDossier(token)
  const loading = !data
  const ca = token?.address
  const [expanded, setExpanded] = useState(false)

  // §II.9 backend additive — these are undefined until the dossier API
  // ships the holders.history14d + holders.top10Pct fields. Until then
  // both consumers degrade transparently.
  const holderHistory14d = data?.holders?.history14d
  const top10Pct = typeof data?.holders?.top10Pct === 'number'
    ? data.holders.top10Pct
    : undefined

  // ----- derived scores -----
  const lh = useMemo(
    () => computeLiquidityHealth({ liquidity, marketCap }),
    [liquidity, marketCap]
  )

  const momentum = useMemo(
    () => momentumScore({ change5m, change1h, change6h: change6h ?? change4h, change24h }),
    [change5m, change1h, change6h, change4h, change24h]
  )

  const trust = useMemo(
    () => holderTrustScore({ holderHistory14d, top10Pct, currentHolders: holders }),
    [holderHistory14d, top10Pct, holders]
  )

  // hourly volume trend tag for callouts (advisory)
  const hourlyTrend = useMemo(() => {
    if (!Array.isArray(hourlyVolumes) || hourlyVolumes.length < 4) return null
    const last = hourlyVolumes[hourlyVolumes.length - 1] || 0
    const tail = hourlyVolumes.slice(-7, -1)
    const avg = tail.reduce((s, v) => s + (v || 0), 0) / (tail.length || 1)
    if (avg <= 0) return null
    const r = last / avg
    if (r >= 1.2) return 'rising'
    if (r <= 0.7) return 'falling'
    return null
  }, [hourlyVolumes])

  const sentiment = useMemo(
    () => sentimentScore({
      momentum,
      buyVol: buyVolUSD,
      sellVol: sellVolUSD,
      hourlyVolumes,
      liquidityHealthScore: lh.score,
    }),
    [momentum, buyVolUSD, sellVolUSD, hourlyVolumes, lh.score]
  )

  const callouts = useMemo(
    () => deriveCallouts({
      liquidityHealth: lh,
      momentum,
      holderTrust: trust,
      sentiment,
      top10Pct,
      hourlyVolumeTrend: hourlyTrend,
    }),
    [lh, momentum, trust, sentiment, top10Pct, hourlyTrend]
  )

  const verdict = scoreVerdict(sentiment)

  // ----- prose -----
  const narrative = data?.lore?.communityNarrative
  const fallbackBio = data?.socials?.twitterBio
  const projectDescription = data?.lore?.projectDescription
  const rawProse = narrative || projectDescription || fallbackBio || ''
  const shortProse = firstTwoSentences(rawProse)
  const hasMoreProse = rawProse.length > shortProse.length + 10

  // ----- tags -----
  const tags = useMemo(() => {
    const fromLore = Array.isArray(data?.lore?.tags) ? data.lore.tags : []
    return fromLore.slice(0, 6)
  }, [data?.lore?.tags])

  // ----- official links (fallback when the backend has no AI narrative yet) -----
  // The dossier's lore generator sometimes returns null prose (no sources
  // gathered upstream). Rather than a dead "No narrative" line, surface the
  // project's own channels so the card is still useful. Handles are normalized
  // to full URLs; already-URL values pass through untouched.
  const socialLinks = useMemo(() => {
    const s = data?.socials
    if (!s) return []
    const norm = (v, base) => {
      if (!v || typeof v !== 'string') return null
      const t = v.trim()
      if (!t) return null
      if (/^https?:\/\//i.test(t)) return t
      return base + t.replace(/^@/, '')
    }
    return [
      { label: 'Website', url: norm(s.website, '') },
      { label: 'X', url: norm(s.twitter, 'https://x.com/') },
      { label: 'Telegram', url: norm(s.telegram, 'https://telegram.me/') },
    ].filter((l) => l.url)
  }, [data?.socials])

  // No token selected — render nothing
  if (!chain || !ca) return null

  const isAnalyzing = loading && !data
  const liveLabel = isAnalyzing ? 'Analyzing' : 'Live'

  return (
    <RevealOnScroll className="aic-reveal">
      <section className="aic" aria-label="AI Intelligence">
        {/* Scan-line — fires once on reveal */}
        <span className="aic-scanline" aria-hidden="true" />

        <header className="aic-head">
          <div className="aic-eyebrow-row">
            <span className="aic-glyph" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2 L13 5 L13 11 L8 14 L3 11 L3 5 Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <circle cx="8" cy="8" r="2" fill="currentColor" />
              </svg>
            </span>
            <span className="aic-eyebrow">AI Dossier</span>
            <span className={['aic-live', isAnalyzing ? 'aic-live--analyzing' : 'aic-live--on'].join(' ')}>
              <span className="aic-live-dot" aria-hidden="true" />
              {liveLabel}
            </span>
          </div>
          {updatedAt && (
            <span className="aic-updated">Updated {relativeTime(updatedAt)}</span>
          )}
        </header>

        {/* Gauge centerpiece */}
        <div className="aic-gauge-row">
          <NeedleGauge score={sentiment} size={180} verdict={verdict} />
        </div>

        {/* Three derived score chips */}
        <div className="aic-chip-row">
          <ScoreChip label="Momentum"   score={momentum} glyph="bar" />
          <ScoreChip label="Liquidity"  score={lh.score} glyph="radial" />
          <ScoreChip label="Holders"    score={trust.score} glyph="radial" limited={trust.limited} />
        </div>

        {/* Strengths / Risks */}
        {(callouts.strengths.length > 0 || callouts.risks.length > 0) && (
          <div className="aic-callouts">
            {callouts.strengths.length > 0 && (
              <div className="aic-callout-row">
                <span className="aic-callout-label">Strengths</span>
                <ul className="aic-callout-chips">
                  {callouts.strengths.map((s, i) => (
                    <li key={i} className="aic-callout-chip aic-callout-chip--mint">{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {callouts.risks.length > 0 && (
              <div className="aic-callout-row">
                <span className="aic-callout-label">Risks</span>
                <ul className="aic-callout-chips">
                  {callouts.risks.map((r, i) => (
                    <li key={i} className="aic-callout-chip aic-callout-chip--coral">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <ul className="aic-tags">
            {tags.map((t, i) => (
              <li key={i} className="aic-tag">{t}</li>
            ))}
          </ul>
        )}

        {/* Prose */}
        {shortProse && (
          <div className="aic-prose">
            <p>{expanded ? rawProse : shortProse}</p>
            {hasMoreProse && (
              <button
                type="button"
                className="aic-expand"
                onClick={() => setExpanded((x) => !x)}
              >
                {expanded ? 'Show less ⌃' : 'Read full analysis ⌄'}
              </button>
            )}
          </div>
        )}

        {!shortProse && !isAnalyzing && socialLinks.length > 0 && (
          <div className="aic-links">
            <span className="aic-links-label">Official links</span>
            <ul className="aic-links-row">
              {socialLinks.map((l) => (
                <li key={l.label}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="aic-link">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!shortProse && !isAnalyzing && socialLinks.length === 0 && (
          <div className="aic-empty">No narrative available for this token.</div>
        )}
        {!shortProse && isAnalyzing && (
          <div className="aic-empty">Generating narrative…</div>
        )}
      </section>
    </RevealOnScroll>
  )
}

export default React.memo(AIIntelligenceCard)
