/**
 * ZIGChain — Partners & Announcements.
 *
 * Two halves, one dedicated home for everything partner-related:
 *   1. Partner logo wall — every marquee partner with its logo + role + stat.
 *   2. Live announcements — pulled straight from the official @ZIGChain X feed
 *      via useZigAnnouncements, so new partnerships (Fasset, Beehive, …) surface
 *      automatically. Falls back to the curated intelligence feed when the live
 *      feed is unavailable (e.g. auth gate) so the section is never empty.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { PARTNER_LOGOS } from '../zigchain.constants'
import { fmtRelTime, fmtCompact } from '../hooks/useZigAnnouncements'
import './ZigAnnouncements.css'

const LETTER_COLORS = {
  A: '#3B82F6', B: '#10B981', D: '#F43F5E', E: '#14B8A6', F: '#F97316',
  N: '#6366F1', O: '#F59E0B', P: '#06B6D4', S: '#8B5CF6', T: '#EC4899',
  V: '#22D3EE', Z: '#FBBF24',
}

function Logo({ name, size = 40 }) {
  const [fail, setFail] = React.useState(false)
  const src = PARTNER_LOGOS[name]
  const letter = (name || '?')[0].toUpperCase()
  if (src && !fail) {
    return (
      <img
        src={src}
        alt=""
        className="zann-logo"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setFail(true)}
      />
    )
  }
  const tone = LETTER_COLORS[letter] || '#6B7280'
  return (
    <span
      className="zann-logo zann-logo--init"
      style={{ width: size, height: size, background: `${tone}1f`, color: tone, fontSize: size * 0.4 }}
    >
      {letter}
    </span>
  )
}

function AnnouncementCard({ item }) {
  const partnerLogo = item.partner ? PARTNER_LOGOS[item.partner] : null
  const engagement = [
    fmtCompact(item.retweets) && `${fmtCompact(item.retweets)} reposts`,
    fmtCompact(item.likes) && `${fmtCompact(item.likes)} likes`,
    fmtCompact(item.views) && `${fmtCompact(item.views)} views`,
  ].filter(Boolean)
  return (
    <a className="zann-card" href={item.url} target="_blank" rel="noopener noreferrer">
      <div className="zann-card-top">
        <span className="zann-card-src">@ZIGChain</span>
        <span className="zann-card-time">{fmtRelTime(item.createdAt) || 'Latest'}</span>
      </div>
      <div className="zann-card-body">
        {item.partner && partnerLogo && (
          <span className="zann-card-partner"><Logo name={item.partner} size={28} /></span>
        )}
        <h4 className="zann-card-headline">{item.headline}</h4>
      </div>
      {item.text && item.text !== item.headline && (
        <p className="zann-card-text">{item.text.length > 200 ? `${item.text.slice(0, 198)}…` : item.text}</p>
      )}
      <div className="zann-card-foot">
        <div className="zann-card-tags">
          {item.tags.map((tag) => <span key={tag} className="zann-tag">{tag}</span>)}
        </div>
        {engagement.length > 0 && <span className="zann-card-engage">{engagement.join(' · ')}</span>}
      </div>
    </a>
  )
}

// Curated intelligence-feed item → same card shape, so the fallback renders
// identically to live announcements.
function curatedToItem(it, i) {
  return {
    id: `curated-${i}`,
    url: it.url,
    text: it.summary,
    headline: it.headline,
    createdAt: null,
    tags: (it.tags || []).slice(0, 3),
    partner: null,
    likes: 0, retweets: 0, views: 0,
  }
}

export default function ZigAnnouncements({ partners = [], announcements = [], loading = false, fallback = [] }) {
  const { t } = useTranslation()
  const live = (announcements || []).slice(0, 6)
  const isLive = live.length > 0
  const fallbackItems = (fallback || []).filter((it) => it.recent).slice(0, 6).map(curatedToItem)
  const feed = isLive ? live : fallbackItems

  return (
    <section className="zann">
      <div className="zann-head">
        <div className="zann-head-titles">
          <h2 className="zann-title">{t('zigchainChrome.section.partnersAnnouncements', 'Partners & Announcements')}</h2>
          <p className="zann-sub">{t('zigchainChrome.partners.sub', 'Institutional partners and the latest from the ZIGChain ecosystem.')}</p>
        </div>
        <span className={`zann-feed-status${isLive ? ' is-live' : ''}`}>
          {isLive
            ? <><span className="zann-live-dot" /> {t('zigchainChrome.partners.liveX', 'Live · @ZIGChain')}</>
            : t('zigchainChrome.partners.curated', 'Curated updates')}
        </span>
      </div>

      {/* Partner logo wall */}
      <div className="zann-wall">
        {partners.map((p) => (
          <div key={p.name} className="zann-partner">
            <Logo name={p.name} size={44} />
            <div className="zann-partner-info">
              <span className="zann-partner-name">{p.name}</span>
              <span className="zann-partner-role">{p.role}</span>
            </div>
            {p.stat && <span className="zann-partner-stat">{p.stat}</span>}
          </div>
        ))}
      </div>

      {/* Live announcements feed */}
      <div className="zann-feed">
        {loading && !feed.length && (
          <div className="zann-skel" aria-hidden>
            <div className="zann-skel-card" />
            <div className="zann-skel-card" />
            <div className="zann-skel-card" />
          </div>
        )}
        {!loading && !feed.length && (
          <p className="zann-empty">{t('zigchainChrome.partners.noUpdates', 'No recent announcements.')}</p>
        )}
        {feed.length > 0 && (
          <div className="zann-feed-grid">
            {feed.map((item) => <AnnouncementCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </section>
  )
}
