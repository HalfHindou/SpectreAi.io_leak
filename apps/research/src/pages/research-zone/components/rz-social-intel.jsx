/**
 * RZ Social Intelligence — the X Dash forensics layer for one token.
 *
 * Six compartments: signal score (chatter quality composite), attention
 * lifecycle phase, quality forensics (promo / cashtag-only / clean signal /
 * quarantine), the immutable since-tracked receipt (momentum origin), crowd
 * stance split, and raw reach. Everything deterministic and sourced — no
 * invented numbers; missing feeds render as honest em-dashes.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { PHASE_LABELS, CLUSTER_LABELS } from '@/lib/social-signals'
import './rz-sentiment-engine.css'

const num = (v) => (Number.isFinite(v) ? v : null)

const CLUSTER_TONE = {
  broad: { label: 'Broad cross-cluster interest', cls: 'up' },
  moderate: { label: 'Moderate spread', cls: '' },
  echo: { label: 'Single-cluster echo — hype-pocket risk', cls: 'warn' },
  narrow: { label: 'Narrow attention', cls: '' },
}

function fmtCompact(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${Math.round(n)}`
}
function fmtUsdCompact(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const RING_R = 26
const RING_C = 2 * Math.PI * RING_R

function SignalRing({ score, tone }) {
  const have = Number.isFinite(score)
  const color = tone === 'bull' ? '#34D399' : tone === 'warn' ? '#FBBF24' : 'rgba(245,245,247,0.75)'
  return (
    <div className="rz-sen-ring" aria-hidden="true">
      <svg viewBox="0 0 62 62" width="62" height="62">
        <circle cx="31" cy="31" r={RING_R} fill="none" stroke="rgba(128,128,138,0.16)" strokeWidth="5" />
        {have && (
          <circle
            cx="31" cy="31" r={RING_R} fill="none"
            stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * RING_C} ${RING_C}`}
            transform="rotate(-90 31 31)"
            style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.16,1,0.3,1)' }}
          />
        )}
      </svg>
      <span className="rz-sen-ring-num">{have ? Math.round(score) : '—'}</span>
    </div>
  )
}

const PART_LABELS = { clean: 'Clean', breadth: 'Breadth', vel: 'Velocity', nov: 'Novelty', eng: 'Engagement' }

const RzSocialIntel = React.memo(function RzSocialIntel({ sym, engine, dayMode }) {
  const { t } = useTranslation()
  const { social, signals, crowd, origin, market } = engine
  const quality = signals?.signalScore
  const phase = signals?.phase
  const fade = signals?.fade

  const noXDash = !social?.hasXDash
  const ringTone = quality?.tier === 'elite' || quality?.tier === 'strong' ? 'bull' : quality?.tier === 'building' ? null : 'warn'

  const stance = crowd?.stance
  const bull = num(stance?.bullPct)
  const bear = num(stance?.bearPct)
  const neutral = num(stance?.neutralPct) ?? (bull != null && bear != null ? Math.max(0, 100 - bull - bear) : null)

  const roi = num(origin?.roiPct)
  const peakRoi = num(origin?.peakRoiPct)

  // Notable external callers (KOLs) — what we can honestly derive from the
  // tweets when there is no classified bull/bear split.
  const notable = Array.isArray(social?.notableAuthors) ? social.notableAuthors : []

  // Presence per card — a card renders only when it carries real signal (or an
  // informative "building/paused" state). Blank "—" cards are collapsed rather
  // than shown, so a partially-covered token doesn't read as broken.
  const hasCoverage = !!social?.hasXDash || !!social?.xdashWarming || !!social?.xdashDegraded
    || num(social?.mentions24h) != null || num(social?.cleanSignal) != null
  const hasQualityParts = !!quality?.parts
  const hasLifecycle = !!(phase?.phase || fade?.tag)
  const hasForensics = [social?.cleanSignal, social?.promoShare, social?.cashtagShare, social?.novelty].some((v) => num(v) != null)
  const hasOrigin = !!(origin && (roi != null || origin.entryMcap != null))
  const hasStance = bull != null || bear != null
  const hasReach = [social?.mentions24h, social?.prevDailyAvg, social?.velocity, social?.uniqueAuthors, social?.engagement].some((v) => num(v) != null)
  const clusters = social?.clusters
  const hasClusters = !!(clusters && clusters.breadth > 0)

  // Nothing to show at all. While X Dash forensics are still in flight (~6s
  // cold) show a shimmer, not a false "no coverage" that would pop into a full
  // grid a beat later. Only when the fetch has settled empty do we say so.
  if (!hasCoverage && !hasOrigin && !hasStance && notable.length === 0) {
    if (social?.xdashPending) {
      return (
        <div className={`rz-sen-grid ${dayMode ? 'rz-sen--day' : ''}`}>
          {[0, 1, 2].map((i) => (
            <div className="rz-sen-card" key={i}>
              <span className="rz-sen-card-title animate-shimmer" style={{ width: 90, height: 10, borderRadius: 4, display: 'inline-block' }} />
              <div className="animate-shimmer" style={{ height: 48, borderRadius: 8, marginTop: 12 }} />
            </div>
          ))}
        </div>
      )
    }
    return (
      <div className={`rz-sen-grid ${dayMode ? 'rz-sen--day' : ''}`}>
        <div className="rz-sen-card" style={{ gridColumn: '1 / -1' }}>
          <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.socialIntelligence', "Social Intelligence")}</span>
          <p className="rz-sen-card-body">
            {social?.xdashWarming
              ? `X Dash is building social coverage for $${sym} — chatter forensics, lifecycle and the crowd read fill in on the next refresh.`
              : `No social telemetry coverage for $${sym} yet. When the crowd starts talking, the chatter-quality, lifecycle and reach breakdown appear here.`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`rz-sen-grid ${dayMode ? 'rz-sen--day' : ''}`}>
      {/* 1 — Chatter quality (NOT crowd sentiment — the hero gauge owns that;
            naming them apart kills the "64 here, 57 there" contradiction read) */}
      {(hasQualityParts || hasCoverage) && (
      <div className="rz-sen-card">
        <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.chatterQuality', "Chatter Quality")}</span>
        <div className="rz-sen-ring-wrap">
          <SignalRing score={quality?.score} tone={ringTone} />
          <div className="rz-sen-card-rows" style={{ flex: 1 }}>
            {quality?.parts ? (
              Object.entries(quality.parts).map(([k, v]) => (
                <div className="rz-sen-row" key={k}>
                  <span>{PART_LABELS[k]}</span>
                  <span className="rz-sen-meter"><i style={{ width: `${Math.round(v * 100)}%` }} /></span>
                </div>
              ))
            ) : (
              <p className="rz-sen-card-body">
                {social?.xdashWarming
                  ? `X Dash is building coverage for $${sym} — the forensics fill in on the next refresh.`
                  : social?.xdashDegraded
                    ? 'X Dash telemetry is unavailable right now — score paused, not absent.'
                    : noXDash
                      ? `No social telemetry coverage for $${sym} yet.`
                      : 'Chatter below the signal floor.'}
              </p>
            )}
          </div>
        </div>
        {quality?.tier && (
          <span className="rz-sen-card-body" style={{ textTransform: 'capitalize' }}>
            {quality.tier} chatter quality
            {quality.degraded && <span className="rz-sen-chip rz-sen-chip--warn" style={{ marginLeft: 8, textTransform: 'none' }}>{t('researchPro.socialIntel.rzsocialintel.degradedFeed', "degraded feed")}</span>}
          </span>
        )}
      </div>
      )}

      {/* 2 — Attention phase (flat is a real read only when we HAVE coverage) */}
      {(hasLifecycle || hasCoverage) && (
      <div className="rz-sen-card">
        <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.attentionLifecycle', "Attention Lifecycle")}</span>
        {phase?.phase ? (
          <>
            <div className="rz-sen-card-hero">
              <span className={`rz-sen-card-big ${phase.tone === 'bull' ? 'rz-sen-card-big--bull' : phase.tone === 'warn' ? 'rz-sen-card-big--warn' : ''}`} style={{ fontSize: 19, fontFamily: 'var(--font-display)' }}>
                {PHASE_LABELS[phase.phase]}
              </span>
              <span className="rz-sen-card-unit">{phase.score}/100 · {phase.tier}</span>
            </div>
            <p className="rz-sen-card-body">{phase.thesis}</p>
          </>
        ) : fade?.tag ? (
          <>
            <div className="rz-sen-card-hero">
              <span className={`rz-sen-card-big ${fade.tag === 'bearish' ? 'rz-sen-card-big--bear' : 'rz-sen-card-big--warn'}`} style={{ fontSize: 19, fontFamily: 'var(--font-display)' }}>
                {fade.tag === 'bearish' ? 'Fading' : 'Hype Risk'}
              </span>
              <span className="rz-sen-card-unit">{fade.score}/100 · {fade.tier}</span>
            </div>
            <p className="rz-sen-card-body">{fade.thesis}</p>
          </>
        ) : social?.xdashWarming ? (
          <p className="rz-sen-card-body">
            Lifecycle read is warming up — X Dash is building forensics for this token. Mention telemetry (Reach) already updates.
          </p>
        ) : social?.xdashDegraded ? (
          <p className="rz-sen-card-body">
            Lifecycle read paused — the X Dash forensics feed is unavailable right now. Mention telemetry (Reach) still updates.
          </p>
        ) : (
          <p className="rz-sen-card-body">
            No lifecycle read — attention is neither spiking nor unwinding. Flat chatter is its own signal: nobody is front-running this.
          </p>
        )}
      </div>
      )}

      {/* 3 — Quality forensics */}
      {hasForensics && (
      <div className="rz-sen-card">
        <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.chatterForensics', "Chatter Forensics")}</span>
        <div className="rz-sen-card-rows">
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.cleanSignal', "Clean signal")}</span>
            <span className={`mono ${num(social?.cleanSignal) != null ? (social.cleanSignal >= 0.7 ? 'up' : social.cleanSignal < 0.5 ? 'down' : '') : ''}`}>
              {num(social?.cleanSignal) != null ? `${Math.round(social.cleanSignal * 100)}%` : '—'}
            </span>
          </div>
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.promoShare', "Promo share")}</span>
            <span className={`mono ${num(social?.promoShare) != null && social.promoShare >= 0.15 ? 'warn' : ''}`}>
              {num(social?.promoShare) != null ? `${Math.round(social.promoShare * 100)}%` : '—'}
            </span>
          </div>
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.cashtagOnlyPosts', "Cashtag-only posts")}</span>
            <span className={`mono ${num(social?.cashtagShare) != null && social.cashtagShare >= 0.7 ? 'warn' : ''}`}>
              {num(social?.cashtagShare) != null ? `${Math.round(social.cashtagShare * 100)}%` : '—'}
            </span>
          </div>
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.novelty', "Novelty")}</span>
            <span className="mono">{num(social?.novelty) != null ? `${social.novelty.toFixed(1)}x` : '—'}</span>
          </div>
        </div>
        {(social?.qualityStatus || social?.qualityReasons?.length > 0) && (
          <div className="rz-sen-chips">
            {social.qualityStatus === 'quarantined' && <span className="rz-sen-chip rz-sen-chip--bear">{t('researchPro.socialIntel.rzsocialintel.quarantined', "quarantined")}</span>}
            {social.qualityStatus === 'soft_penalized' && <span className="rz-sen-chip rz-sen-chip--warn">{t('researchPro.socialIntel.rzsocialintel.softPenalized', "soft-penalized")}</span>}
            {social.qualityReasons.slice(0, 3).map((r) => (
              <span key={r} className="rz-sen-chip">{String(r).replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
      </div>
      )}

      {/* 4 — Since tracked (momentum origin). Only render when a real receipt
            exists — the resolver (useSentimentEngine) tries cgId, symbol and the
            canonical slug, so a proven runner surfaces here instead of a false
            "never crossed the radar". No receipt → collapse the card entirely. */}
      {hasOrigin && (
      <div className="rz-sen-card">
        <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.sinceFirstTracked', "Since First Tracked")}</span>
        {(
          <>
            <div className="rz-sen-card-hero">
              <span className={`rz-sen-card-big ${roi != null ? (roi >= 0 ? 'rz-sen-card-big--bull' : 'rz-sen-card-big--bear') : ''}`}>
                {roi != null ? `${roi >= 0 ? '+' : ''}${Math.abs(roi) >= 100 ? Math.round(roi) : roi.toFixed(1)}%` : '—'}
              </span>
              {peakRoi != null && <span className="rz-sen-card-unit">peak {peakRoi >= 0 ? '+' : ''}{Math.round(peakRoi)}%</span>}
            </div>
            <div className="rz-sen-card-rows">
              <div className="rz-sen-row">
                <span>{t('researchPro.socialIntel.rzsocialintel.enteredRadar', "Entered radar")}</span>
                <span className="mono">{fmtDate(origin.firstSeen)}</span>
              </div>
              <div className="rz-sen-row">
                <span>{t('researchPro.socialIntel.rzsocialintel.entryMcap', "Entry mcap")}</span>
                <span className="mono">{fmtUsdCompact(origin.entryMcap)}</span>
              </div>
              <div className="rz-sen-row">
                <span>{t('researchPro.socialIntel.rzsocialintel.now', "Now")}</span>
                <span className="mono">{fmtUsdCompact(num(market?.marketCap) ?? origin.lastMcap)}</span>
              </div>
              {origin.peakMcap != null && (
                <div className="rz-sen-row">
                  <span>{t('researchPro.socialIntel.rzsocialintel.peak', "Peak")}</span>
                  <span className="mono">{fmtUsdCompact(origin.peakMcap)}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {/* 5 — Crowd stance. With a classified split → the bull/neutral/bear bars.
            No split but real KOL chatter → an honest "who is calling it" read
            derived from the tweets (never a fabricated %). Neither → collapse. */}
      {(hasStance || notable.length > 0) && (
      <div className="rz-sen-card">
        <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.crowdStance', "Crowd Stance")}</span>
        {hasStance ? (
          <>
            <div className="rz-sen-card-rows">
              <div className="rz-sen-row">
                <span>{t('researchPro.socialIntel.rzsocialintel.bullish', "Bullish")}</span>
                <span className="rz-sen-meter"><i className="bull" style={{ width: `${Math.min(100, bull ?? 0)}%` }} /></span>
                <span className="mono up">{bull != null ? `${Math.round(bull)}%` : '—'}</span>
              </div>
              <div className="rz-sen-row">
                <span>{t('researchPro.socialIntel.rzsocialintel.neutral', "Neutral")}</span>
                <span className="rz-sen-meter"><i style={{ width: `${Math.min(100, neutral ?? 0)}%` }} /></span>
                <span className="mono">{neutral != null ? `${Math.round(neutral)}%` : '—'}</span>
              </div>
              <div className="rz-sen-row">
                <span>{t('researchPro.socialIntel.rzsocialintel.bearish', "Bearish")}</span>
                <span className="rz-sen-meter"><i className="bear" style={{ width: `${Math.min(100, bear ?? 0)}%` }} /></span>
                <span className="mono down">{bear != null ? `${Math.round(bear)}%` : '—'}</span>
              </div>
            </div>
            <p className="rz-sen-card-body">
              Per-post LLM classification, weighted by author quality
              {crowd?.source === 'mindshare-v2' ? '' : crowd?.source === 'xdash-llm' ? ' — classified from the live X tape' : ' (legacy feed)'}.
            </p>
          </>
        ) : (
          <>
            <p className="rz-sen-card-body">
              No classified bull/bear split for a token this size — but the chatter is KOL-led. Who is calling it:
            </p>
            <div className="rz-sen-card-rows">
              {notable.map((a) => (
                <div className="rz-sen-row" key={a.handle}>
                  <span>@{a.handle}{a.verified ? ' ✓' : ''}</span>
                  <span className="mono">{a.followers != null ? `${fmtCompact(a.followers)} followers` : '—'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      )}

      {/* 5b — Cross-cluster reach (aixbt-inspired): WHICH community archetypes
            are discussing this. Broad spread = organic conviction; a single
            trencher/influencer cluster is a loud but narrow hype pocket. */}
      {hasClusters && (
      <div className="rz-sen-card">
        <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.crossClusterReach', "Cross-Cluster Reach")}</span>
        <div className="rz-sen-card-hero">
          <span className="rz-sen-card-big">{clusters.breadth}<span className="rz-sen-card-unit" style={{ fontSize: 13 }}>/7 clusters</span></span>
        </div>
        <div className="rz-sen-chips">
          {clusters.dominant.map((k) => (
            <span key={k} className="rz-sen-chip">{CLUSTER_LABELS[k] || k}</span>
          ))}
        </div>
        <p className={`rz-sen-card-body ${(CLUSTER_TONE[clusters.tone]?.cls) === 'up' ? 'up' : (CLUSTER_TONE[clusters.tone]?.cls) === 'warn' ? 'warn' : ''}`}>
          {CLUSTER_TONE[clusters.tone]?.label || 'Cross-cluster read'} — {clusters.breadth >= 3
            ? 'interest is spread across distinct communities, not one echo chamber.'
            : 'attention sits in a narrow slice of the crowd; watch for it to broaden or fade.'}
        </p>
      </div>
      )}

      {/* 6 — Reach */}
      {hasReach && (
      <div className="rz-sen-card">
        <span className="rz-sen-card-title">{t('researchPro.socialIntel.rzsocialintel.reach', "Reach")}</span>
        <div className="rz-sen-card-rows">
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.mentions24h', "Mentions 24h")}</span>
            <span className="mono">{fmtCompact(num(social?.mentions24h))}</span>
          </div>
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.dailyBaseline', "Daily baseline")}</span>
            <span className="mono">{fmtCompact(num(social?.prevDailyAvg))}</span>
          </div>
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.velocity', "Velocity")}</span>
            <span className={`mono ${num(social?.velocity) != null ? (social.velocity >= 2 ? 'up' : social.velocity < 0.8 ? 'down' : '') : ''}`}>
              {num(social?.velocity) != null ? `${social.velocity.toFixed(1)}x` : '—'}
            </span>
          </div>
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.uniqueVoices', "Unique voices")}</span>
            <span className="mono">{fmtCompact(num(social?.uniqueAuthors))}</span>
          </div>
          <div className="rz-sen-row">
            <span>{t('researchPro.socialIntel.rzsocialintel.weightedEngagement', "Weighted engagement")}</span>
            <span className="mono">{fmtCompact(num(social?.engagement))}</span>
          </div>
        </div>
      </div>
      )}
    </div>
  )
})

export default RzSocialIntel
