/**
 * CcComingSoon — rich placeholder for Command Center tabs that are not live yet
 * (Liquidation, Calendar, Flows, Wallets). Per-tab icon, teaser copy and a row
 * of feature chips. Shared by the inline command center (welcome-page.jsx) and
 * the fullscreen overlay (cc-fullview-overlay.jsx).
 */
import { useTranslation } from 'react-i18next'

const ICON = {
  liquidation: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c3.5 4 6 6.8 6 10a6 6 0 0 1-12 0c0-3.2 2.5-6 6-10z" />
      <path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
      <path d="M7.5 13h3v3h-3z" fill="currentColor" stroke="none" />
    </svg>
  ),
  flows: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h13M13 4l4 4-4 4" />
      <path d="M20 16H7M11 20l-4-4 4-4" />
    </svg>
  ),
  wallets: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 9h13a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H3" />
      <circle cx="16.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
}

const COPY = {
  liquidation: {
    title: 'Liquidation',
    desc: 'Live liquidation heatmap and cascade alerts across major perp venues.',
    features: ['Heatmap levels', 'Cascade alerts', 'OI tracking'],
  },
  calendar: {
    title: 'Calendar',
    desc: 'Macro events, token unlocks and earnings — ranked by market impact.',
    features: ['Macro events', 'Token unlocks', 'Impact score'],
  },
  flows: {
    title: 'Flows',
    desc: 'Exchange in/out-flows, funding rates and stablecoin supply shifts.',
    features: ['CEX flows', 'Funding rates', 'Stablecoins'],
  },
  wallets: {
    title: 'Wallets',
    desc: 'Smart-money and whale wallet tracking with a live transaction feed.',
    features: ['Smart money', 'Whale moves', 'Live feed'],
  },
}

const FALLBACK_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

const CcComingSoon = ({ tab, label }) => {
  const { t } = useTranslation()
  const copy = COPY[tab] || { title: label || 'Coming Soon', desc: '', features: [] }
  const icon = ICON[tab] || FALLBACK_ICON

  return (
    <div className="cc-soon">
      <div className="cc-soon-glow" aria-hidden="true" />
      <div className="cc-soon-inner">
        <span className="cc-soon-icon" aria-hidden="true">{icon}</span>
        <span className="cc-soon-badge">
          <span className="cc-soon-dot" aria-hidden="true" />
          {t('homePage.ccComingSoon.cccomingsoon.comingSoon', "Coming Soon")}
        </span>
        <h4 className="cc-soon-title">{copy.title}</h4>
        {copy.desc && <p className="cc-soon-desc">{copy.desc}</p>}
        {copy.features?.length > 0 && (
          <div className="cc-soon-chips">
            {copy.features.map((f) => (
              <span key={f} className="cc-soon-chip">{f}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default CcComingSoon
