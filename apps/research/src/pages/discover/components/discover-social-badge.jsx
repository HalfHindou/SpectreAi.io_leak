/**
 * discover-social-badge.jsx
 *
 * A whisper on a Discover token card: a tiny carrier-dot cluster + a bull/bear
 * trend glyph, shown ONLY when the token has notable X chatter momentum. Most
 * cards show nothing — the indicator's scarcity IS the signal. Zero new color
 * budget: the glyph reuses the sanctioned --bull / --bear dyad.
 *
 * Tooltip (existing data-tooltip system): "+180% chatter · 8 KOLs carrying".
 *
 * Prefix: dsb-
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import './discover-social-badge.css'

const DiscoverSocialBadge = ({ entry }) => {
  const { t } = useTranslation()
  if (!entry || !entry.notable) return null

  const { deltaPct, trend, cur } = entry.momentum
  const carriers = (entry.carriers || []).slice(0, 2)
  const kolCount = entry.carrierCount || 0

  const chatterPart = deltaPct != null
    ? t('discover.socialBadge.chatter', { pct: `${deltaPct > 0 ? '+' : ''}${deltaPct}%`, defaultValue: '{{pct}} chatter' })
    : t('discover.socialBadge.mentions', { count: cur, defaultValue: '{{count}} mentions' })
  const kolPart = kolCount > 0
    ? t('discover.socialBadge.kols', { count: kolCount, defaultValue: '{{count}} KOLs carrying' })
    : t('discover.socialBadge.tracked', 'tracked on X')
  const tip = `${chatterPart} · ${kolPart}`

  return (
    <div className="dsb" data-tooltip={tip} aria-label={tip}>
      <span className="dsb__dots">
        {carriers.length > 0
          ? carriers.map((c, i) => (
            <span key={c.author_rest_id || c.screen_name || i} className="dsb__dot" style={{ zIndex: 2 - i }}>
              {c.avatar_image_url
                ? <img src={c.avatar_image_url} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                : null}
            </span>
          ))
          : <span className="dsb__dot dsb__dot--plain" />}
      </span>
      <span className={`dsb__glyph dsb__glyph--${trend === 'down' ? 'down' : 'up'}`}>
        {trend === 'down' ? '↓' : '↑'}
      </span>
    </div>
  )
}

export default DiscoverSocialBadge
