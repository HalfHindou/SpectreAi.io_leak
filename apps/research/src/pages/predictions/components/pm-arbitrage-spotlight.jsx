/**
 * PmArbitrageSpotlight — the page's marquee. Cross-source spread cards.
 *
 * When the same real-world question trades at materially different odds on
 * Polymarket vs Kalshi, that gap is found money. This is the ONE place amber is
 * allowed (the spread = the "marquee project" exception).
 *
 * Renders null entirely when there are no qualifying spreads — absence is
 * silent, never a hollow "No arbitrage found" shell.
 *
 * `spreads` = output of kalshiApi.findCrossSourceArbitrage:
 *   { question, pmYesPct, kalshiYesPct, spread, pmUrl, kalshiUrl }
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import PmSourceBadge from './pm-source-badge'
import './pm-arbitrage-spotlight.css'

// Pull the Polymarket event slug out of its public URL so the card opens the
// in-app detail route (/predictions/:slug) instead of leaving the app.
function extractSlug(url) {
  return (url || '').split('/event/')[1]?.split(/[?#]/)[0] || ''
}

function ArbCard({ row, t, onOpen }) {
  const polyHigher = row.pmYesPct >= row.kalshiYesPct
  // The actionable play: buy the cheaper Yes venue, buy No on the pricier.
  const cheaper = polyHigher ? 'Kalshi' : 'Polymarket'
  const pricier = polyHigher ? 'Polymarket' : 'Kalshi'
  const action = t('predictionsPage.arb.action', {
    defaultValue: 'Buy Yes on {{cheaper}} · Buy No on {{pricier}}',
    cheaper,
    pricier,
  })

  return (
    <button type="button" className="pm-arb__card" onClick={() => onOpen(row)}>
      <div className="pm-arb__card-top">
        <h3 className="pm-arb__q">{row.question}</h3>
        <span className="pm-arb__spread mono">
          {t('predictionsPage.arb.spread', { defaultValue: 'SPREAD {{pts}} pts', pts: Math.round(row.spread) })}
        </span>
      </div>

      <div className="pm-arb__prices">
        <span className="pm-arb__venue">
          <PmSourceBadge source="polymarket" />
          <span className="pm-arb__venue-row">
            <span className="pm-arb__pct mono">{row.pmYesPct}%</span>
            <span className="pm-arb__dir">{polyHigher ? '↑' : '↓'}</span>
          </span>
          <span className="pm-arb__mini" style={{ '--src-hue': '108 140 180' }}>
            <span className="pm-arb__mini-fill" style={{ width: `${row.pmYesPct}%` }} />
          </span>
        </span>
        <span className="pm-arb__venue">
          <PmSourceBadge source="kalshi" />
          <span className="pm-arb__venue-row">
            <span className="pm-arb__pct mono">{row.kalshiYesPct}%</span>
            <span className="pm-arb__dir">{polyHigher ? '↓' : '↑'}</span>
          </span>
          <span className="pm-arb__mini" style={{ '--src-hue': '190 168 120' }}>
            <span className="pm-arb__mini-fill" style={{ width: `${row.kalshiYesPct}%` }} />
          </span>
        </span>
      </div>

      <p className="pm-arb__action">{action}</p>
    </button>
  )
}

function PmArbitrageSpotlight({ spreads, updatedAgo }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const rows = Array.isArray(spreads) ? spreads.filter((r) => Math.round(r.spread) >= 3).slice(0, 6) : []
  if (rows.length === 0) return null

  // Open the in-app Polymarket detail page (Kalshi has no in-app detail route).
  const openRow = (row) => {
    const slug = extractSlug(row.pmUrl)
    if (slug) navigate(`/predictions/${slug}`)
    else if (row.pmUrl) window.open(row.pmUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="pm-arb animate-fade-up" aria-label={t('predictionsPage.arb.aria', { defaultValue: 'Cross-source arbitrage' })}>
      <div className="pm-arb__header">
        <span className="pm-arb__eyebrow">{t('predictionsPage.arb.title', { defaultValue: 'Arbitrage' })}</span>
        <span className="pm-arb__count mono">
          {t('predictionsPage.arb.found', {
            defaultValue: '{{count}} spreads found',
            count: rows.length,
          })}
        </span>
        {updatedAgo != null && (
          <span className="pm-arb__fresh">
            {t('predictionsPage.arb.updated', { defaultValue: 'Updated {{secs}}s ago', secs: updatedAgo })}
          </span>
        )}
      </div>
      <div className="pm-arb__rail">
        {rows.map((row, i) => (
          <ArbCard key={`${row.question}-${i}`} row={row} t={t} onOpen={openRow} />
        ))}
      </div>
    </section>
  )
}

export default PmArbitrageSpotlight
