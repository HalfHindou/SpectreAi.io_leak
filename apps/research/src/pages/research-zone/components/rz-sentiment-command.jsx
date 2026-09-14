/**
 * RZ Sentiment Command — the engine's topline read for one token.
 *
 * Gauge = the CROWD score (mindshare v2, LLM-classified + author-weighted,
 * -1..1 mapped to 0..100). Quality, attention phase and fade risk stay
 * separate, visible signals — no opaque blended "AI score". The verdict line
 * is deterministic priority logic over those signals (see useSentimentEngine).
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import SpectreLoader from '@/components/spectre-loader'
import { PHASE_LABELS, FADE_LABELS } from '@/lib/social-signals'
import './rz-sentiment-engine.css'

function fmtCompact(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${Math.round(n)}`
}

// Percent change — collapse extreme moves (a genesis-relative memecoin run can
// read +165551%) to a readable multiple: +1656x instead of a 6-digit percent.
function fmtPctChange(p) {
  if (p == null || !Number.isFinite(p)) return null
  const sign = p >= 0 ? '+' : '−'
  const a = Math.abs(p)
  if (a >= 1000) return `${sign}${Math.round(a / 100).toLocaleString('en-US')}x`
  return `${sign}${a.toFixed(1)}%`
}

const GAUGE_R = 60
const GAUGE_C = Math.PI * GAUGE_R

// Which feed produced the crowd score — a fallback LLM read of the live tape
// is honest data but NOT the same as the classified-post pipeline; say which.
const CROWD_SOURCE_LABEL = {
  'mindshare-v2': 'classified',
  'xdash-llm': 'live tape',
  legacy: 'legacy',
  'x-bubbles': 'x-bubbles',
}

// One semantic tone, not a rainbow scale (design system: colour is semantic
// only). The arc carries the score; a tip dot marks where it landed; the
// crowd-source rides as a quiet chip instead of loose flanked text.
function Gauge({ score, source }) {
  const { t } = useTranslation()
  const have = Number.isFinite(score)
  const fill = have ? (score / 100) * GAUGE_C : 0
  const tone = !have ? 'rgba(245,245,247,0.35)' : score >= 60 ? '#10B981' : score <= 40 ? '#EF4444' : '#F59E0B'
  const tipAngle = Math.PI - (have ? Math.min(1, Math.max(0, score / 100)) : 0) * Math.PI
  const tipX = 75 + Math.cos(tipAngle) * GAUGE_R
  const tipY = 84 - Math.sin(tipAngle) * GAUGE_R
  return (
    <div className="rz-sen-gauge" aria-hidden="true">
      <div className="rz-sen-gauge-arc">
        <svg viewBox="0 0 150 92" width="150" height="92">
          <path
            d="M 15 84 A 60 60 0 0 1 135 84"
            fill="none" stroke="rgba(245,245,247,0.09)" strokeWidth="6" strokeLinecap="round"
          />
          {have && (
            <path
              d="M 15 84 A 60 60 0 0 1 135 84"
              fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${fill} ${GAUGE_C}`} opacity="0.92"
              style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.16,1,0.3,1), stroke 300ms ease' }}
            />
          )}
          {have && (
            <circle
              cx={tipX} cy={tipY} r="4.5"
              fill="var(--bg-elevated, #16171c)" stroke={tone} strokeWidth="2.5"
              style={{ transition: 'cx 700ms cubic-bezier(0.16,1,0.3,1), cy 700ms cubic-bezier(0.16,1,0.3,1), stroke 300ms ease' }}
            />
          )}
        </svg>
        <div className="rz-sen-gauge-center">
          <span className="rz-sen-gauge-num">{have ? Math.round(score) : '—'}</span>
          <span className="rz-sen-gauge-sub">{t('researchPro.sentimentCommand.gauge.crowd', "Crowd")}</span>
        </div>
      </div>
      {source && CROWD_SOURCE_LABEL[source] ? <span className="rz-sen-gauge-src">{CROWD_SOURCE_LABEL[source]}</span> : null}
    </div>
  )
}

function StanceBar({ stance }) {
  const { t } = useTranslation()
  const bull = Number.isFinite(stance?.bullPct) ? stance.bullPct : null
  const bear = Number.isFinite(stance?.bearPct) ? stance.bearPct : null
  if (bull == null && bear == null) return null
  // All-zero split = no classified posts at all (legacy feed returns zeros
  // instead of nulls) — hiding beats rendering a fake "Neutral 100%".
  if (!bull && !bear) return null
  const b = Math.max(0, bull ?? 0)
  const r = Math.max(0, bear ?? 0)
  const n = Number.isFinite(stance?.neutralPct) ? Math.max(0, stance.neutralPct) : Math.max(0, 100 - b - r)
  const total = b + n + r || 1
  return (
    <div className="rz-sen-stance">
      <div className="rz-sen-stance-bar" role="img" aria-label={`Bullish ${Math.round(b)}%, bearish ${Math.round(r)}%`}>
        <span className="rz-sen-stance-seg--bull" style={{ width: `${(b / total) * 100}%` }} />
        <span className="rz-sen-stance-seg--neutral" style={{ width: `${(n / total) * 100}%` }} />
        <span className="rz-sen-stance-seg--bear" style={{ width: `${(r / total) * 100}%` }} />
      </div>
      <div className="rz-sen-stance-legend">
        <span className="rz-sen-stance-key"><i className="rz-sen-stance-swatch" style={{ background: '#10B981' }} />{t('researchPro.sentimentCommand.stancebar.bullish', "Bullish")} <span className="mono">{Math.round(b)}%</span></span>
        <span className="rz-sen-stance-key"><i className="rz-sen-stance-swatch" style={{ background: 'rgba(160,160,170,0.45)' }} />{t('researchPro.sentimentCommand.stancebar.neutral', "Neutral")} <span className="mono">{Math.round(n)}%</span></span>
        <span className="rz-sen-stance-key"><i className="rz-sen-stance-swatch" style={{ background: '#EF4444' }} />{t('researchPro.sentimentCommand.stancebar.bearish', "Bearish")} <span className="mono">{Math.round(r)}%</span></span>
      </div>
    </div>
  )
}

const usdShort = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`)

const RzSentimentCommand = React.memo(function RzSentimentCommand({ sym, engine, dayMode }) {
  const { t } = useTranslation()
  const { loading, crowd, social, signals, verdict, market, fundamentals } = engine

  if (loading && crowd?.score == null && social?.mentions24h == null) {
    return (
      <div className={`rz-sen-hero-skeleton ${dayMode ? 'rz-sen--day' : ''}`}>
        <SpectreLoader variant="logo" size="lg" label={t('researchPro.sentimentCommand.rzsentimentcommand.label', "Reading the crowd")} fullCard />
      </div>
    )
  }

  const phase = signals?.phase
  const fade = signals?.fade
  const quality = signals?.signalScore
  const change = market?.change24h

  const velocityTxt = Number.isFinite(social?.velocity) ? `${social.velocity.toFixed(1)}x` : null
  const baselineTone = Number.isFinite(social?.velocity)
    ? social.velocity >= 1.5 ? 'up' : social.velocity < 0.8 ? 'down' : null
    : null

  return (
    <div className={`rz-sen-hero ${dayMode ? 'rz-sen--day' : ''}`}>
      <div className="rz-sen-hero-main">
        <Gauge score={crowd?.score} source={crowd?.source} />

        <div className="rz-sen-hero-text">
          <span className="rz-sen-eyebrow">
            <span className="rz-sen-live" />
            Sentiment Engine · ${sym}
          </span>
          <h2 className={`rz-sen-verdict rz-sen-verdict--${verdict?.tone || 'neutral'}`}>
            {verdict?.label || 'Neutral'}
          </h2>
          <p className="rz-sen-verdict-line">{verdict?.line}</p>
          <div className="rz-sen-hero-pills">
            {phase?.phase && (
              <span className={`rz-sen-pill rz-sen-pill--${phase.tone === 'bull' ? 'bull' : phase.tone === 'warn' ? 'warn' : 'info'}`} title={phase.thesis}>
                <span className="rz-sen-dot" />{PHASE_LABELS[phase.phase]}
              </span>
            )}
            {fade?.tag && (
              <span className={`rz-sen-pill rz-sen-pill--${fade.tag === 'bearish' ? 'bear' : 'warn'}`} title={fade.thesis}>
                <span className="rz-sen-dot" />{FADE_LABELS[fade.tag]} {fade.score}
              </span>
            )}
            {social?.qualityStatus === 'quarantined' && (
              <span className="rz-sen-pill rz-sen-pill--bear">{t('researchPro.sentimentCommand.rzsentimentcommand.quarantinedChatter', "Quarantined chatter")}</span>
            )}
            {social?.qualityStatus === 'soft_penalized' && (
              <span className="rz-sen-pill rz-sen-pill--warn">{t('researchPro.sentimentCommand.rzsentimentcommand.penalizedChatter', "Penalized chatter")}</span>
            )}
            {quality?.tier && quality.tier !== 'quiet' && (
              <span className="rz-sen-pill rz-sen-pill--neutral">Quality {quality.score}/100 · {quality.tier}</span>
            )}
            {/* Cross-cluster reach — WHO is picking it up, front and center */}
            {Number.isFinite(social?.clusters?.breadth) && social.clusters.breadth > 0 && (
              <span
                className={`rz-sen-pill rz-sen-pill--${social.clusters.tone === 'broad' ? 'bull' : social.clusters.tone === 'echo' ? 'warn' : 'info'}`}
                title={`Discussed across ${social.clusters.breadth} community archetypes${social.clusters.dominant?.length ? ` (${social.clusters.dominant.slice(0, 3).join(', ')})` : ''} — ${social.clusters.tone === 'broad' ? 'broad organic interest' : social.clusters.tone === 'echo' ? 'single-cluster echo, hype-pocket risk' : 'moderate spread'}`}
              >
                <span className="rz-sen-dot" />{social.clusters.breadth}/7 clusters{social.clusters.tone === 'broad' ? ' · broad' : social.clusters.tone === 'echo' ? ' · echo' : ''}
              </span>
            )}
            {/* Fundamentals — hard supply/protocol facts as topline signals */}
            {Number.isFinite(fundamentals?.unlocks?.next?.pctOfSupply) && (
              <span className="rz-sen-pill rz-sen-pill--warn" title={`Next token unlock ${fundamentals.unlocks.next.date || 'upcoming'}: ${fundamentals.unlocks.next.pctOfSupply.toFixed(2)}% of supply${fundamentals.unlocks.next.amountUsd ? ` (${usdShort(fundamentals.unlocks.next.amountUsd)})` : ''} — future sell pressure`}>
                <span className="rz-sen-dot" />Unlock {fundamentals.unlocks.next.pctOfSupply.toFixed(1)}%{fundamentals.unlocks.next.date ? ` ${fundamentals.unlocks.next.date.slice(5)}` : ''}
              </span>
            )}
            {fundamentals?.unlocks?.fullyUnlocked && (
              <span className="rz-sen-pill rz-sen-pill--bull" title={t('researchPro.sentimentCommand.rzsentimentcommand.title', "Token is fully unlocked — no vesting cliff or unlock overhang ahead")}>
                <span className="rz-sen-dot" />{t('researchPro.sentimentCommand.rzsentimentcommand.fullyUnlocked', "Fully unlocked")}
              </span>
            )}
            {Number.isFinite(fundamentals?.tvl?.tvlUsd) && (
              <span className="rz-sen-pill rz-sen-pill--info" title={`Protocol TVL (DeFiLlama)${Number.isFinite(fundamentals.tvl.change30dPct) ? ` · ${fundamentals.tvl.change30dPct >= 0 ? '+' : ''}${fundamentals.tvl.change30dPct.toFixed(1)}% / 30d` : ''}`}>
                <span className="rz-sen-dot" />TVL {usdShort(fundamentals.tvl.tvlUsd)}
              </span>
            )}
          </div>
        </div>

        <div className="rz-sen-hero-stats">
          <div className="rz-sen-stat">
            <span className="rz-sen-stat-label">{t('researchPro.sentimentCommand.rzsentimentcommand.mentions24h', "Mentions 24h")}</span>
            <span className="rz-sen-stat-val">{fmtCompact(social?.mentions24h)}</span>
            {velocityTxt && (
              <span className={`rz-sen-stat-sub ${baselineTone ? `rz-sen-stat-sub--${baselineTone}` : ''}`}>
                {velocityTxt} vs baseline
              </span>
            )}
          </div>
          <div className="rz-sen-stat">
            <span className="rz-sen-stat-label">{t('researchPro.sentimentCommand.rzsentimentcommand.uniqueVoices', "Unique voices")}</span>
            <span className="rz-sen-stat-val">{fmtCompact(social?.uniqueAuthors)}</span>
            {Number.isFinite(social?.kolCount) && social.kolCount > 0 && (
              <span className="rz-sen-stat-sub">{social.kolCount} KOLs</span>
            )}
          </div>
          <div className="rz-sen-stat">
            <span className="rz-sen-stat-label">{t('researchPro.sentimentCommand.rzsentimentcommand.engagement', "Engagement")}</span>
            <span className="rz-sen-stat-val">{fmtCompact(social?.engagement)}</span>
            <span className="rz-sen-stat-sub">{t('researchPro.sentimentCommand.rzsentimentcommand.weighted', "weighted")}</span>
          </div>
          <div className="rz-sen-stat">
            <span className="rz-sen-stat-label">{t('researchPro.sentimentCommand.rzsentimentcommand.mindshare', "Mindshare")}</span>
            <span className="rz-sen-stat-val">
              {Number.isFinite(social?.mindsharePct) ? `${social.mindsharePct.toFixed(2)}%` : '—'}
            </span>
            {Number.isFinite(social?.mindshareRank) && (
              <span className="rz-sen-stat-sub">#{Math.round(social.mindshareRank)} by attention</span>
            )}
          </div>
          <div className="rz-sen-stat">
            <span className="rz-sen-stat-label">{t('researchPro.sentimentCommand.rzsentimentcommand.cleanSignal', "Clean signal")}</span>
            <span className="rz-sen-stat-val">
              {Number.isFinite(social?.cleanSignal) ? `${Math.round(social.cleanSignal * 100)}%` : '—'}
            </span>
            {Number.isFinite(social?.promoShare) && social.promoShare > 0 && (
              <span className={`rz-sen-stat-sub ${social.promoShare >= 0.15 ? 'rz-sen-stat-sub--down' : ''}`}>
                {Math.round(social.promoShare * 100)}% promo
              </span>
            )}
          </div>
          <div className="rz-sen-stat">
            <span className="rz-sen-stat-label">{t('researchPro.sentimentCommand.rzsentimentcommand.price24h', "Price 24h")}</span>
            <span className={`rz-sen-stat-val ${change != null ? (change >= 0 ? 'rz-sen-stat-sub--up' : 'rz-sen-stat-sub--down') : ''}`} style={{ fontSize: 15 }}>
              {fmtPctChange(change) ?? '—'}
            </span>
            {Number.isFinite(market?.change7d) && (
              <span className={`rz-sen-stat-sub ${market.change7d >= 0 ? 'rz-sen-stat-sub--up' : 'rz-sen-stat-sub--down'}`}>
                {fmtPctChange(market.change7d)} 7d
              </span>
            )}
          </div>
        </div>
      </div>

      <StanceBar stance={crowd?.stance} />
    </div>
  )
})

export default RzSentimentCommand
