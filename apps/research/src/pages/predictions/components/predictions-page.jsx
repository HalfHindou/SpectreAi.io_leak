/**
 * PredictionsPage — blended Polymarket + Kalshi prediction markets.
 *
 * Desktop narrative: masthead band → stats strip → arbitrage spotlight →
 * category rail → featured hero → premium card grid (Signal Verdict baked in).
 * The Pulse tab swaps the grid for the social-intelligence panel.
 *
 * Each card carries a source badge (Polymarket vs Kalshi). Outcome rows are
 * probability bars (the data is the photography); the whole card → detail.
 *
 * Mobile: early-return with ppm- prefix, cinematic mobile patterns.
 */
import { useState, useMemo, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import lazy from '@/lib/lazy-with-retry'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useCurrency } from '@/hooks/useCurrency'
import {
  PREDICTION_CATEGORIES,
  CATEGORY_COPY,
  formatVolume,
} from './predictions-constants'
import { usePredictionMarkets } from './use-prediction-markets'
import PmMasthead from './pm-masthead'
import PmHero from './pm-hero'
import PmArbitrageSpotlight from './pm-arbitrage-spotlight'
import PmSourceBadge from './pm-source-badge'
import { PmVerdictChip } from './pm-signal-verdict'
import { outcomeLabel, leadOutcome } from './pm-outcome-label'
import './predictions-page.css'
import './predictions-page.mobile.css'

// Social-intelligence "Pulse" tab — heavy (tweet search + aggregation), only
// mounted when the user opens it.
const PredictionsSocialPanel = lazy(() => import('./predictions-social-panel'))
const PULSE_TAB = 'pulse'

function PredictionsPage({ dayMode }) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtVol = (n) => formatVolume(n, fmtLargeShort)
  const [activeCategory, setActiveCategory] = useState('trending')

  const isPulse = activeCategory === PULSE_TAB
  const { events, loading, arb, sources, aggregate } = usePredictionMarkets(isPulse ? 'trending' : activeCategory)

  // Stats for the strip: rank volume first, add a consensus tilt + sources.
  const stats = useMemo(() => {
    const totalMarkets = events.reduce((s, e) => s + e.outcomes.length, 0)
    const vol24h = events.reduce((s, e) => s + (e.volume24h || 0), 0)
    const totalLiquidity = events.reduce((s, e) => s + (e.totalLiquidity || 0), 0)
    const bullish = events.reduce((s, e) => s + e.outcomes.filter((o) => o.yesPct > 50).length, 0)
    const sentiment = totalMarkets > 0 ? Math.round((bullish / totalMarkets) * 100) : 50
    return { totalMarkets, vol24h, totalLiquidity, sentiment }
  }, [events])

  // The cinematic featured market — highest-volume event in this category.
  const heroEvent = useMemo(() => (events.length ? events[0] : null), [events])
  // Grid excludes the hero (it's already the cover).
  const gridEvents = useMemo(
    () => (heroEvent ? events.slice(1) : events),
    [events, heroEvent]
  )

  const pulseEvents = useMemo(() => (isPulse ? events : null), [isPulse, events])

  function handleCardClick(ev) {
    if (ev.slug) navigate(`/predictions/${ev.slug}`)
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MOBILE RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  if (isMobile) {
    const catLabel = (cat) => t(cat.labelKey, { defaultValue: cat.defaultLabel })
    return (
      <div className={`pm-page ppm-page${dayMode ? ' day-mode' : ''}`}>
        <div className="ppm-content">
          <div className="ppm-header-spacer" aria-hidden="true" />

          {/* Hero */}
          <div className="ppm-section ppm-hero">
            <span className="ppm-eyebrow">{CATEGORY_COPY[isPulse ? 'pulse' : activeCategory]?.eyebrow}</span>
            <h1 className="ppm-title">{CATEGORY_COPY[isPulse ? 'pulse' : activeCategory]?.headline}</h1>
            <p className="ppm-subtitle">
              {t('predictionsPage.hero.subtitle', { defaultValue: 'Real odds on what happens next — Polymarket + Kalshi.' })}
            </p>
          </div>

          {/* Stats strip — horizontal scroll */}
          <div className="ppm-section-flush">
            <div className="ppm-stats-strip">
              <div className="ppm-stat-chip">
                <span className="ppm-stat-chip-value">{stats.totalMarkets}</span>
                <span className="ppm-stat-chip-label">{/* "Markets in view", not "Markets": this strip is category-scoped (so are
              the volume/liquidity/consensus figures beside it) while the masthead
              above counts the whole cross-venue pool. Both said plain "Markets" and
              printed different numbers 70px apart - 466 vs 157 - which read as a bug. */}
              {t('predictionsPage.stats.marketsInView', { defaultValue: 'Markets in view' })}</span>
              </div>
              <div className="ppm-stat-chip">
                <span className="ppm-stat-chip-value">{fmtVol(stats.vol24h)}</span>
                <span className="ppm-stat-chip-label">{t('predictionsPage.stats.vol24h', { defaultValue: '24h Volume' })}</span>
              </div>
              <div className="ppm-stat-chip">
                <span className="ppm-stat-chip-value">{fmtVol(stats.totalLiquidity)}</span>
                <span className="ppm-stat-chip-label">{t('predictionsPage.stats.liquidity', { defaultValue: 'Liquidity' })}</span>
              </div>
              <div className="ppm-stat-chip">
                <span className={`ppm-stat-chip-value${stats.sentiment >= 50 ? ' ppm-bull' : ' ppm-bear'}`}>
                  {t('predictionsPage.stats.sentimentYes', { defaultValue: '{{pct}}% Yes', pct: stats.sentiment })}
                </span>
                <span className="ppm-stat-chip-label">{t('predictionsPage.stats.consensus', { defaultValue: 'Consensus' })}</span>
              </div>
            </div>
          </div>

          {/* Category tabs — ghost pills */}
          <div className="ppm-section-flush">
            <div className="ppm-tabs" role="tablist" aria-label={t('predictionsPage.tabs.ariaLabel', { defaultValue: 'Prediction categories' })}>
              {PREDICTION_CATEGORIES.map((cat) => {
                const active = activeCategory === cat.id
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`ppm-tab${active ? ' ppm-tab--active' : ''}`}
                    onClick={() => setActiveCategory(cat.id)}
                  >
                    {catLabel(cat)}
                  </button>
                )
              })}
              <button
                type="button"
                role="tab"
                aria-selected={isPulse}
                className={`ppm-tab ppm-tab--pulse${isPulse ? ' ppm-tab--active' : ''}`}
                onClick={() => setActiveCategory(PULSE_TAB)}
              >
                <span className="pm-tab-pulse-dot" />
                {t('predictionsPage.social.tab', { defaultValue: 'Pulse' })}
              </button>
            </div>
          </div>

          {isPulse && (
            <div className="ppm-section">
              <Suspense fallback={null}>
                <PredictionsSocialPanel events={pulseEvents} dayMode={dayMode} isMobile={true} />
              </Suspense>
            </div>
          )}

          {!isPulse && (
            <div className="ppm-section">
              <div className="ppm-section-header">
                <span className="ppm-section-label">{t('predictionsPage.events.label', { defaultValue: 'Markets' })}</span>
                {!loading && events.length > 0 && <span className="ppm-section-count">{events.length}</span>}
              </div>

              {loading ? (
                <div className="ppm-feed">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="ppm-skel">
                      <div className="ppm-skel-head">
                        <div className="ppm-skel-img animate-shimmer" />
                        <div className="ppm-skel-title animate-shimmer" />
                      </div>
                      <div className="ppm-skel-row animate-shimmer" />
                      <div className="ppm-skel-row animate-shimmer" />
                      <div className="ppm-skel-foot animate-shimmer" />
                    </div>
                  ))}
                </div>
              ) : events.length === 0 ? (
                <div className="ppm-empty">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8 12h8M12 8v8" />
                  </svg>
                  <p>{t('predictionsPage.empty.noMarkets', { defaultValue: 'No prediction markets found for this category.' })}</p>
                </div>
              ) : (
                <div className="ppm-feed">
                  {events.map((ev) => {
                    const isSingle = ev.outcomes.length === 1
                    const lead = leadOutcome(ev)
                    const displayed = ev.outcomes.slice(0, 4)
                    const extra = ev.outcomes.length - displayed.length
                    return (
                      <button key={`${ev.source}-${ev.id}`} type="button" className="ppm-card" onClick={() => handleCardClick(ev)}>
                        <div className="ppm-card-head">
                          {(ev.image || ev.icon) && (
                            <img src={ev.image || ev.icon} alt="" className="ppm-card-img" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                          )}
                          <div className="ppm-card-head-text">
                            <h3 className="ppm-card-title">{ev.title}</h3>
                            <div className="ppm-card-meta">
                              <span className="ppm-card-vol">{t('predictionsPage.card.volSuffix', { defaultValue: '{{amount}} Vol', amount: fmtVol(ev.totalVolume) })}</span>
                              <span className="ppm-card-sep">·</span>
                              <PmSourceBadge source={ev.source || 'polymarket'} compact />
                              {ev.endDate && (
                                <>
                                  <span className="ppm-card-sep">·</span>
                                  <span className="ppm-card-date">{ev.endDate}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="ppm-card-outcomes">
                          {displayed.map((o) => {
                            const label = isSingle ? null : outcomeLabel(o, ev)
                            const yesPct = o.yesPct
                            return (
                              <div key={o.id} className="ppm-outcome">
                                {label && <span className="ppm-outcome-label">{label}</span>}
                                <span className="ppm-outcome-track">
                                  <span className={`ppm-outcome-fill${yesPct >= 50 ? '' : ' ppm-outcome-fill--no'}`} style={{ width: `${yesPct}%` }} />
                                </span>
                                <span className="ppm-outcome-pct">{yesPct}%</span>
                              </div>
                            )
                          })}
                          {extra > 0 && <span className="ppm-more">{t('predictionsPage.card.moreOutcomes', { defaultValue: '+{{count}} more outcomes', count: extra })}</span>}
                        </div>

                        <div className="ppm-card-foot">
                          <PmVerdictChip
                            yesPct={lead.yesPct}
                            delta={ev._deltaPts || 0}
                            leadLabel={isSingle ? '' : outcomeLabel(lead, ev)}
                            velocity={ev.totalVolume ? (ev.volume24h || 0) / ev.totalVolume : 0}
                          />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="ppm-bottom-spacer" />
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DESKTOP RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  return (
    <div className="pm-page">
      {/* Masthead band — title + canonical metric. Hidden on Pulse (it's a mode). */}
      <PmMasthead
        category={isPulse ? 'pulse' : activeCategory}
        openInterest={aggregate.openInterest}
        marketCount={aggregate.marketCount}
        sources={sources}
        fmtVol={fmtVol}
      />

      {/* Stats strip */}
      <div className="pm-stats-bar">
        <div className="pm-stat">
          <span className="pm-stat-label">{/* "Markets in view", not "Markets": this strip is category-scoped (so are
              the volume/liquidity/consensus figures beside it) while the masthead
              above counts the whole cross-venue pool. Both said plain "Markets" and
              printed different numbers 70px apart - 466 vs 157 - which read as a bug. */}
              {t('predictionsPage.stats.marketsInView', { defaultValue: 'Markets in view' })}</span>
          <span className="pm-stat-value mono">{stats.totalMarkets.toLocaleString('en-US')}</span>
        </div>
        <div className="pm-stat">
          <span className="pm-stat-label">{t('predictionsPage.stats.vol24h', { defaultValue: '24h Volume' })}</span>
          <span className="pm-stat-value mono">{fmtVol(stats.vol24h)}</span>
        </div>
        <div className="pm-stat">
          <span className="pm-stat-label">{t('predictionsPage.stats.liquidity', { defaultValue: 'Liquidity' })}</span>
          <span className="pm-stat-value mono">{fmtVol(stats.totalLiquidity)}</span>
        </div>
        <div className="pm-stat">
          <span className="pm-stat-label">{t('predictionsPage.stats.consensus', { defaultValue: 'Consensus' })}</span>
          <span className={`pm-stat-value mono${stats.sentiment >= 50 ? ' pm-bull' : ' pm-bear'}`}>
            {t('predictionsPage.stats.sentimentYes', { defaultValue: '{{pct}}% Yes', pct: stats.sentiment })}
          </span>
        </div>
        <div className="pm-stat pm-stat--sources">
          <span className="pm-stat-label">{t('predictionsPage.stats.sources', { defaultValue: 'Sources' })}</span>
          <span className="pm-stat-sources">
            {sources.includes('polymarket') && <PmSourceBadge source="polymarket" />}
            {sources.includes('kalshi') && <PmSourceBadge source="kalshi" />}
          </span>
        </div>
      </div>

      {/* Arbitrage spotlight — the WOW. Renders null when no qualifying spreads. */}
      {!isPulse && <PmArbitrageSpotlight spreads={arb} />}

      {/* Category rail */}
      <div className="pm-tabs">
        <div className="pm-tabs-scroll">
          {PREDICTION_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`pm-tab${activeCategory === cat.id ? ' pm-tab--active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {t(cat.labelKey, { defaultValue: cat.defaultLabel })}
            </button>
          ))}
          <button
            type="button"
            className={`pm-tab pm-tab--pulse${isPulse ? ' pm-tab--active' : ''}`}
            onClick={() => setActiveCategory(PULSE_TAB)}
          >
            <span className="pm-tab-pulse-dot" />
            {t('predictionsPage.social.tab', { defaultValue: 'Pulse' })}
          </button>
        </div>
      </div>

      {isPulse ? (
        <Suspense fallback={null}>
          <PredictionsSocialPanel events={pulseEvents} dayMode={dayMode} isMobile={false} />
        </Suspense>
      ) : loading ? (
        <div className="pm-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="pm-skel" style={{ '--card-index': i }}>
              <div className="pm-skel-header">
                <div className="pm-skel-img animate-shimmer" />
                <div className="pm-skel-title animate-shimmer" />
              </div>
              <div className="pm-skel-row animate-shimmer" />
              <div className="pm-skel-row animate-shimmer" />
              <div className="pm-skel-footer animate-shimmer" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="pm-empty">
          <p className="pm-empty-text">{t('predictionsPage.empty.noMarkets', { defaultValue: 'No prediction markets found for this category.' })}</p>
        </div>
      ) : (
        <>
          {/* Featured hero — the cinematic story */}
          {heroEvent && <PmHero event={heroEvent} onOpen={handleCardClick} fmtVol={fmtVol} />}

          {/* The grid — premium story-cards */}
          <div className="pm-grid">
            {gridEvents.map((ev, i) => {
              const isSingle = ev.outcomes.length === 1
              const lead = leadOutcome(ev)
              const displayed = ev.outcomes.slice(0, 3)
              const extra = ev.outcomes.length - displayed.length
              return (
                <button
                  key={`${ev.source}-${ev.id}`}
                  type="button"
                  className="pm-card"
                  style={{ '--card-index': i }}
                  onClick={() => handleCardClick(ev)}
                >
                  {/* Header: image + question */}
                  <div className="pm-card-head">
                    {(ev.image || ev.icon) && (
                      <img
                        src={ev.image || ev.icon}
                        alt=""
                        className={`pm-card-img pm-card-img--${ev.source || 'polymarket'}`}
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    )}
                    <h3 className="pm-card-title">{ev.title}</h3>
                  </div>

                  {/* Outcome probability bars */}
                  <div className="pm-card-outcomes">
                    {isSingle ? (
                      <PmOutcomeBar yesPct={ev.outcomes[0].yesPct} />
                    ) : (
                      displayed.map((o) => (
                        <PmOutcomeBar
                          key={o.id}
                          yesPct={o.yesPct}
                          label={outcomeLabel(o, ev)}
                        />
                      ))
                    )}
                    {!isSingle && extra > 0 && (
                      <span className="pm-more">{t('predictionsPage.card.moreOutcomes', { defaultValue: '+{{count}} more outcomes', count: extra })}</span>
                    )}
                  </div>

                  {/* Signal Verdict chip */}
                  <PmVerdictChip
                    yesPct={lead.yesPct}
                    delta={ev._deltaPts || 0}
                    leadLabel={isSingle ? '' : outcomeLabel(lead, ev)}
                    velocity={ev.totalVolume ? (ev.volume24h || 0) / ev.totalVolume : 0}
                  />

                  {/* Footer: volume · source · close date */}
                  <div className="pm-card-foot">
                    <span className="pm-card-vol mono">{fmtVol(ev.totalVolume)}</span>
                    <PmSourceBadge source={ev.source || 'polymarket'} compact />
                    <span className="pm-card-date">{ev.endDate}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// One probability bar row. Binary markets get a single bar (Yes share, colored
// by ≥50 → bull / <50 → bear). Multi-outcome rows get a name label above.
function PmOutcomeBar({ yesPct, label }) {
  const pct = Math.max(0, Math.min(100, yesPct))
  const fillClass = pct >= 50 ? 'pm-outcome__fill' : 'pm-outcome__fill pm-outcome__fill--no'
  return (
    <div className="pm-outcome">
      <div className="pm-outcome__main">
        {label && <span className="pm-outcome__label">{label}</span>}
        <span className="pm-outcome__track">
          <span className={fillClass} style={{ width: `${pct}%` }} />
        </span>
      </div>
      <span className="pm-outcome__pct mono">{pct}%</span>
    </div>
  )
}

export default PredictionsPage
