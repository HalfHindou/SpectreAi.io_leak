/**
 * discover-social-pulse.jsx
 *
 * "SOCIAL PULSE" — a Discover section ranking tokens by X chatter MOMENTUM
 * (velocity, not absolute volume). Each card shows a chatter-velocity sparkline,
 * a 24h momentum delta, and a cluster of carrier KOL avatars. A faint dashed
 * "conversation flows in" motif ties the carriers to the token, and tokens that
 * share a carrier KOL get a subtle "shared with $X" thread — kin to the
 * predictions galaxy constellation language.
 *
 * Clicking a card OR a carrier deep-links to /x-dash/token/:cgId.
 * No signal → the parent renders nothing (this component returns null too).
 *
 * Prefix: dsp-
 */
import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { getFollowerTier } from '@/pages/x-dash/components/x-dash-utils'
import './discover-social-pulse.css'

// ── tiny chatter-velocity sparkline (warm-white bars, last bar tinted by trend) ──
const PulseSpark = ({ entry }) => {
  const { cur, prev, deltaPct, trend } = entry.momentum
  // We don't get an hourly chatter series on the leaderboard row, so build a
  // deterministic 6-bar shape from the prev→cur trajectory. The LAST bar is the
  // live 24h count (tinted), the leading bars ease from the prior daily average.
  const base = prev > 0 ? prev : Math.max(cur * 0.6, 1)
  const bars = [0.55, 0.62, 0.7, 0.8, 0.9, 1].map((f, i, arr) => {
    const t = i / (arr.length - 1)
    // interpolate base → cur, with a gentle curve so it reads as a ramp
    return base + (cur - base) * Math.pow(t, 1.4)
  })
  const max = Math.max(...bars, 1)
  return (
    <div className="dsp-spark" aria-hidden="true">
      {bars.map((v, i) => (
        <span
          key={i}
          className={`dsp-spark__bar${i === bars.length - 1 ? ` dsp-spark__bar--last dsp-spark__bar--${trend}` : ''}`}
          style={{ height: `${Math.max(12, (v / max) * 100)}%` }}
        />
      ))}
      <span className={`dsp-spark__glyph dsp-spark__glyph--${trend}`}>
        {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
      </span>
    </div>
  )
}

const CarrierCluster = ({ carriers, count, onCarrier }) => {
  const { t } = useTranslation()
  const shown = carriers.slice(0, 3)
  const extra = Math.max(0, count - shown.length)
  return (
    <div className="dsp-carriers">
      <div className="dsp-carriers__stack">
        {shown.length === 0 && (
          <span className="dsp-carriers__dot dsp-carriers__dot--empty" />
        )}
        {shown.map((c, i) => {
          const tier = getFollowerTier(c.followers_count)
          const handle = String(c.screen_name || '').replace(/^@/, '')
          return (
            <button
              key={c.author_rest_id || c.screen_name || i}
              className={`dsp-carriers__avatar dsp-carriers__avatar--${tier.cls}`}
              style={{ zIndex: shown.length - i }}
              onClick={(e) => { e.stopPropagation(); onCarrier?.(c) }}
              data-tooltip={handle ? `@${handle}` : (c.name || tier.text)}
              aria-label={handle ? `@${handle}` : (c.name || tier.text)}
            >
              {c.avatar_image_url
                ? <img src={c.avatar_image_url} alt="" loading="lazy" onError={(ev) => { ev.target.style.display = 'none' }} />
                : <span className="dsp-carriers__initial">{(handle || c.name || '?').charAt(0).toUpperCase()}</span>}
            </button>
          )
        })}
      </div>
      <span className="dsp-carriers__count">
        {count > 0
          ? t('discover.socialPulse.carriers', { count, defaultValue: '{{count}} carriers' })
          : t('discover.socialPulse.noCarriers', 'Building')}
      </span>
    </div>
  )
}

const PulseCard = ({ entry, sharedSet, onOpen, onCarrier }) => {
  const { t } = useTranslation()
  const { deltaPct } = entry.momentum
  const rgb = TOKEN_ROW_COLORS[entry.symbol]?.bg || '245, 245, 247'
  const shared = sharedSet ? Array.from(sharedSet).slice(0, 2) : []

  return (
    <div
      className="dsp-card"
      style={{ '--brand-rgb': rgb }}
      onClick={() => onOpen(entry)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(entry) }}
    >
      <div className="dsp-card__head">
        <div className="dsp-card__logo-wrap">
          <span className="dsp-card__ring" style={{ borderColor: `rgba(${rgb}, 0.45)` }} />
          {entry.image
            ? <img className="dsp-card__logo" src={entry.image} alt={entry.symbol} loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden' }} />
            : <span className="dsp-card__logo dsp-card__logo--fallback">{entry.symbol.charAt(0)}</span>}
        </div>
        <div className="dsp-card__id">
          <span className="dsp-card__symbol">{entry.symbol}</span>
          <span className="dsp-card__name">{entry.name}</span>
        </div>
      </div>

      <div className="dsp-card__metric">
        <PulseSpark entry={entry} />
        <span className={`dsp-card__delta dsp-card__delta--${entry.momentum.trend}`}>
          {deltaPct != null
            ? <>{deltaPct > 0 ? '+' : ''}{deltaPct}% <em>{t('discover.socialPulse.chatter', 'chatter 24h')}</em></>
            : <>{entry.momentum.cur} <em>{t('discover.socialPulse.mentions', 'mentions 24h')}</em></>}
        </span>
      </div>

      {/* conversation-flows-in dashed motif */}
      <div className="dsp-card__thread" aria-hidden="true" />

      <CarrierCluster carriers={entry.carriers} count={entry.carrierCount} onCarrier={onCarrier} />

      {shared.length > 0 && (
        <div className="dsp-card__shared">
          {t('discover.socialPulse.sharedWith', {
            tokens: shared.map((s) => `$${s}`).join(', '),
            defaultValue: 'Shared KOLs with {{tokens}}',
          })}
        </div>
      )}
    </div>
  )
}

const SocialPulseSkeleton = () => (
  <div className="dsp-rail">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="dsp-card dsp-card--skeleton">
        <div className="dsp-card__head">
          <div className="animate-shimmer dsp-sk-logo" />
          <div className="dsp-sk-lines">
            <div className="animate-shimmer dsp-sk-line dsp-sk-line--sm" />
            <div className="animate-shimmer dsp-sk-line dsp-sk-line--xs" />
          </div>
        </div>
        <div className="animate-shimmer dsp-sk-block" />
        <div className="animate-shimmer dsp-sk-line dsp-sk-line--md" />
      </div>
    ))}
  </div>
)

const DiscoverSocialPulse = ({ social, isMobile = false }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const scrollRef = useRef(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(true)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 20)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 20)
  }, [])

  useEffect(() => { checkScroll() }, [social?.pulse, checkScroll])

  const scroll = (dir) => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -360 : 360, behavior: 'smooth' })
  }

  const openToken = useCallback((entry) => {
    if (entry?.cgId) navigate(`/x-dash/token/${encodeURIComponent(entry.cgId)}`)
  }, [navigate])

  const openCarrier = useCallback((carrier) => {
    const id = carrier?.author_rest_id || carrier?.rest_id
    if (id) navigate(`/x-dash/author/${encodeURIComponent(id)}`)
  }, [navigate])

  // Loading: shimmer that matches the rail shape. Never a spinner.
  if (social?.loading && (!social.pulse || social.pulse.length === 0)) {
    return (
      <section className="dsp-section">
        <div className="dsp-header">
          <span className="dsp-header__eyebrow">{t('discover.socialPulse.eyebrow', 'SOCIAL PULSE')}</span>
          <span className="dsp-header__sub">{t('discover.socialPulse.sub', 'What the timeline is moving')}</span>
        </div>
        <SocialPulseSkeleton />
      </section>
    )
  }

  // No signal → render nothing (premium silence, not an empty shell).
  if (!social || social.error || !social.pulse || social.pulse.length === 0) return null

  return (
    <section className="dsp-section">
      <div className="dsp-header">
        <div className="dsp-header__lead">
          <span className="dsp-header__eyebrow">{t('discover.socialPulse.eyebrow', 'SOCIAL PULSE')}</span>
          <span className="dsp-header__sub">{t('discover.socialPulse.sub', 'What the timeline is moving')}</span>
        </div>
        {!isMobile && (
          <div className="dsp-nav">
            <button className={`dsp-arrow${!canLeft ? ' dsp-arrow--off' : ''}`} onClick={() => scroll('left')} disabled={!canLeft} aria-label={t('discover.scrollLeftAria', 'Scroll left')}>←</button>
            <button className={`dsp-arrow${!canRight ? ' dsp-arrow--off' : ''}`} onClick={() => scroll('right')} disabled={!canRight} aria-label={t('discover.scrollRightAria', 'Scroll right')}>→</button>
          </div>
        )}
      </div>

      <div className="dsp-rail" ref={scrollRef} onScroll={checkScroll}>
        {social.pulse.map((entry) => (
          <PulseCard
            key={entry.cgId || entry.symbol}
            entry={entry}
            sharedSet={social.sharedKol?.get(entry.symbol)}
            onOpen={openToken}
            onCarrier={openCarrier}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

export default DiscoverSocialPulse
