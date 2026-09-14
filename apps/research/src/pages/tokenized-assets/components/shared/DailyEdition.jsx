import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRwaAnalysis } from '../useRwaData'
import './ta-daily-edition.css'

/* ── Topic → editorial metadata. Eyebrow + fallback headline are translated
 *    at render time via i18n keys; English literals here are the fallbacks
 *    that ship in the en bundle and back up missing locales. ──
 */
const TOPIC_META = {
  overview: {
    eyebrowKey: 'tokenizedAssets.daily.overview.eyebrow',
    eyebrowDefault: 'The Tokenized Assets Brief',
    fallbackHeadlineKey: 'tokenizedAssets.daily.overview.headline',
    fallbackHeadlineDefault: 'The Daily Move in Tokenized Assets',
    palette: { a: '#06b6d4', b: '#8b5cf6' },
    motif: 'grid',
  },
  stablecoins: {
    eyebrowKey: 'tokenizedAssets.daily.stablecoins.eyebrow',
    eyebrowDefault: 'The Stablecoin Beat',
    fallbackHeadlineKey: 'tokenizedAssets.daily.stablecoins.headline',
    fallbackHeadlineDefault: 'Where the Dollar Went On-Chain Today',
    palette: { a: '#10b981', b: '#06b6d4' },
    motif: 'rings',
  },
  treasuries: {
    eyebrowKey: 'tokenizedAssets.daily.treasuries.eyebrow',
    eyebrowDefault: 'The Treasuries Wire',
    fallbackHeadlineKey: 'tokenizedAssets.daily.treasuries.headline',
    fallbackHeadlineDefault: 'Yield On-Chain, Priced in Basis Points',
    palette: { a: '#f59e0b', b: '#ef4444' },
    motif: 'bars',
  },
  credit: {
    eyebrowKey: 'tokenizedAssets.daily.credit.eyebrow',
    eyebrowDefault: 'The Credit Ledger',
    fallbackHeadlineKey: 'tokenizedAssets.daily.credit.headline',
    fallbackHeadlineDefault: 'Private Credit Meets Public Chains',
    palette: { a: '#a78bfa', b: '#ec4899' },
    motif: 'arcs',
  },
  commodities: {
    eyebrowKey: 'tokenizedAssets.daily.commodities.eyebrow',
    eyebrowDefault: 'The Commodities Bar',
    fallbackHeadlineKey: 'tokenizedAssets.daily.commodities.headline',
    fallbackHeadlineDefault: 'Gold, Tokenized',
    palette: { a: '#fbbf24', b: '#f97316' },
    motif: 'rays',
  },
  networks: {
    eyebrowKey: 'tokenizedAssets.daily.networks.eyebrow',
    eyebrowDefault: 'The Network Tape',
    fallbackHeadlineKey: 'tokenizedAssets.daily.networks.headline',
    fallbackHeadlineDefault: 'Where RWA Liquidity Lives',
    palette: { a: '#3b82f6', b: '#8b5cf6' },
    motif: 'nodes',
  },
  platforms: {
    eyebrowKey: 'tokenizedAssets.daily.platforms.eyebrow',
    eyebrowDefault: 'The Issuer Desk',
    fallbackHeadlineKey: 'tokenizedAssets.daily.platforms.headline',
    fallbackHeadlineDefault: 'Who Is Tokenizing What',
    palette: { a: '#22d3ee', b: '#818cf8' },
    motif: 'grid',
  },
}

/* ── Extract first paragraph (lede), strip "## What changed" ── */
function extractLede(article) {
  if (!article) return ''
  const cutoff = article.toLowerCase().search(/##\s+what changed|\*\*what changed/i)
  const lede = cutoff > 0 ? article.slice(0, cutoff).trim() : article.trim()
  return lede.replace(/\s+/g, ' ').slice(0, 340)
}

/* ── Pretty date e.g. "April 22, 2026" / "22 апреля 2026 г." (locale-aware) ── */
function formatDate(iso, locale = 'en') {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : new Date()
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(d)
  } catch { return d.toDateString() }
}

/* ── SVG hero motif — never “an AI did this” ── */
function HeroArt({ palette, motif }) {
  const { a, b } = palette
  return (
    <svg viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" className="ta-de__art-svg" aria-hidden="true">
      <defs>
        <linearGradient id={`de-bg-${motif}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0b0c12" />
          <stop offset="100%" stopColor="#05060a" />
        </linearGradient>
        <radialGradient id={`de-glow-a-${motif}`} cx="30%" cy="30%" r="60%">
          <stop offset="0%" stopColor={a} stopOpacity="0.55" />
          <stop offset="60%" stopColor={a} stopOpacity="0.08" />
          <stop offset="100%" stopColor={a} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`de-glow-b-${motif}`} cx="75%" cy="70%" r="55%">
          <stop offset="0%" stopColor={b} stopOpacity="0.45" />
          <stop offset="60%" stopColor={b} stopOpacity="0.06" />
          <stop offset="100%" stopColor={b} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`de-line-${motif}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={a} stopOpacity="0.8" />
          <stop offset="100%" stopColor={b} stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {/* Base */}
      <rect width="800" height="420" fill={`url(#de-bg-${motif})`} />
      <rect width="800" height="420" fill={`url(#de-glow-a-${motif})`} />
      <rect width="800" height="420" fill={`url(#de-glow-b-${motif})`} />

      {/* Faint grid */}
      <g opacity="0.08" stroke="#ffffff" strokeWidth="0.5">
        {[0,1,2,3,4,5,6,7,8].map(i => (
          <line key={`h${i}`} x1="0" y1={i * 52.5} x2="800" y2={i * 52.5} />
        ))}
        {[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(i => (
          <line key={`v${i}`} x1={i * 50} y1="0" x2={i * 50} y2="420" />
        ))}
      </g>

      {motif === 'grid' && (
        <g>
          {/* Abstract stacked flow */}
          <path d="M 60 340 Q 160 280 260 300 T 460 220 T 660 180 T 780 140" stroke={`url(#de-line-${motif})`} strokeWidth="2.5" fill="none" opacity="0.85"/>
          <path d="M 60 340 Q 160 280 260 300 T 460 220 T 660 180 T 780 140 L 780 420 L 60 420 Z" fill={a} opacity="0.1" />
        </g>
      )}
      {motif === 'rings' && (
        <g transform="translate(400 210)">
          {[150, 110, 72, 40].map((r, i) => (
            <circle key={r} r={r} fill="none" stroke={i % 2 === 0 ? a : b} strokeOpacity={0.35 - i * 0.05} strokeWidth={1.5 - i * 0.2}/>
          ))}
          <circle r="14" fill={a} opacity="0.9" />
        </g>
      )}
      {motif === 'bars' && (
        <g transform="translate(0 60)">
          {Array.from({ length: 14 }).map((_, i) => {
            const h = 40 + ((i * 37) % 200)
            const x = 50 + i * 50
            return <rect key={i} x={x} y={320 - h} width="22" height={h} rx="4" fill={i % 2 === 0 ? a : b} opacity="0.55"/>
          })}
        </g>
      )}
      {motif === 'arcs' && (
        <g stroke={`url(#de-line-${motif})`} strokeWidth="2" fill="none" opacity="0.7">
          <path d="M 40 360 Q 200 120 400 240 T 780 100" />
          <path d="M 40 380 Q 220 180 420 300 T 780 180" opacity="0.6"/>
          <path d="M 40 400 Q 240 240 440 340 T 780 260" opacity="0.4"/>
        </g>
      )}
      {motif === 'rays' && (
        <g transform="translate(400 210)">
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * Math.PI * 2) / 12
            const x2 = Math.cos(angle) * 360
            const y2 = Math.sin(angle) * 200
            return <line key={i} x1="0" y1="0" x2={x2} y2={y2} stroke={a} strokeOpacity="0.2" strokeWidth="1.5"/>
          })}
          <circle r="60" fill={a} opacity="0.18"/>
          <circle r="28" fill={a} opacity="0.5"/>
        </g>
      )}
      {motif === 'nodes' && (
        <g>
          {[[180,140],[320,90],[520,180],[640,100],[420,280],[240,300],[660,320],[560,380]].map(([x,y], i) => (
            <circle key={i} cx={x} cy={y} r={6 + (i % 3) * 3} fill={i % 2 === 0 ? a : b} opacity="0.75"/>
          ))}
          <g stroke={`url(#de-line-${motif})`} strokeWidth="1" opacity="0.5">
            <line x1="180" y1="140" x2="320" y2="90" />
            <line x1="320" y1="90" x2="520" y2="180" />
            <line x1="520" y1="180" x2="640" y2="100" />
            <line x1="420" y1="280" x2="520" y2="180" />
            <line x1="240" y1="300" x2="420" y2="280" />
            <line x1="420" y1="280" x2="660" y2="320" />
            <line x1="660" y1="320" x2="560" y2="380" />
          </g>
        </g>
      )}

      {/* Edge fade */}
      <rect width="800" height="420" fill={`url(#de-bg-${motif})`} opacity="0.25"/>
    </svg>
  )
}

/**
 * DailyEdition — editorial hero card for the tokenized-assets tab.
 * One Spectre AI Daily Edition article per day, with hero image, eyebrow,
 * headline, lede, and byline. Uses /api/rwa/analysis/:topic.
 */
export default function DailyEdition({ topic = 'overview' }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const { article, headline, summary, ogImage, publishedAt, lastUpdated, loading } = useRwaAnalysis(topic)
  const [heroFallback, setHeroFallback] = useState(false)

  const meta = TOPIC_META[topic] || TOPIC_META.overview
  const lede = useMemo(() => extractLede(article) || summary || '', [article, summary])
  const dateLabel = formatDate(publishedAt || lastUpdated, locale)
  const fallbackHeadline = t(meta.fallbackHeadlineKey, meta.fallbackHeadlineDefault)
  const eyebrow = t(meta.eyebrowKey, meta.eyebrowDefault)
  const display = headline || fallbackHeadline

  const showSkeleton = loading && !article

  return (
    <article className="ta-de" aria-label={t('tokenizedAssets.daily.aria.edition', 'Spectre AI Daily Edition')}>
      {/* Hero image — remote ogImage first, SVG motif fallback */}
      <div className="ta-de__art">
        {ogImage && !heroFallback ? (
          <img
            src={ogImage}
            alt=""
            className="ta-de__art-img"
            loading="lazy"
            onError={() => setHeroFallback(true)}
          />
        ) : (
          <HeroArt palette={meta.palette} motif={meta.motif} />
        )}
        <div className="ta-de__art-scrim" />
        <div className="ta-de__masthead">
          <span className="ta-de__masthead-dot" />
          <span className="ta-de__masthead-text">{t('tokenizedAssets.daily.masthead', 'Spectre AI · Daily Edition')}</span>
        </div>
      </div>

      {/* Body */}
      <div className="ta-de__body">
        <div className="ta-de__eyebrow">
          <span className="ta-de__eyebrow-label">{eyebrow}</span>
          {dateLabel && <span className="ta-de__eyebrow-sep">·</span>}
          {dateLabel && <span className="ta-de__eyebrow-date">{dateLabel}</span>}
        </div>

        {showSkeleton ? (
          <>
            <div className="ta-de__skel ta-de__skel--title animate-shimmer" />
            <div className="ta-de__skel animate-shimmer" style={{ width: '96%' }} />
            <div className="ta-de__skel animate-shimmer" style={{ width: '88%' }} />
            <div className="ta-de__skel animate-shimmer" style={{ width: '72%' }} />
          </>
        ) : (
          <>
            <h3 className="ta-de__headline">{display}</h3>
            {lede ? (
              <p className="ta-de__lede">{lede}{lede.length >= 340 ? '…' : ''}</p>
            ) : (
              <p className="ta-de__lede ta-de__lede--empty">
                {t('tokenizedAssets.daily.draftingPlaceholder', "Spectre agents are drafting today's edition. It will publish here shortly.")}
              </p>
            )}
          </>
        )}

        <footer className="ta-de__footer">
          <span className="ta-de__byline">{t('tokenizedAssets.daily.byline', 'Written by Spectre Agents')}</span>
          <span className="ta-de__dot">·</span>
          <span className="ta-de__cadence">{t('tokenizedAssets.daily.cadence', '1 new article daily')}</span>
        </footer>
      </div>
    </article>
  )
}
