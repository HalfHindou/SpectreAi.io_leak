/**
 * DealCard — single funding round tile in the Private Markets feed.
 *
 * Glass-card pattern from .claude/rules/design-system.md D.
 * Uses monospace for numbers, near-invisible borders, hover translateY.
 * The mark is <PmLogo>, which only fetches a favicon for a domain that matches
 * the company name — see pm-logo.jsx for why the old chain rendered the
 * publisher's logo on half the feed.
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import PmLogo from './pm-logo'
import {
  roundBadgeTier,
  SOURCE_LABELS,
  formatAmount,
  formatRelativeDate,
} from './private-markets-constants'

/**
 * The one line of prose a card can carry.
 *
 * Every deal ships a headline and the card was throwing it away, so the tile
 * ran name → amount → source badge and left a hole in the middle. Most of those
 * headlines are worth reading ("Fiat Ventures combines venture and advisory
 * divisions into new brand"); the ones that are not just restate the two
 * numbers already on the card ("Keenable raises $26M Seed"), and those are
 * dropped rather than printed twice.
 */
function blurbFor(deal) {
  const text = (deal.description || deal.headline || '').trim()
  if (!text) return null
  const company = (deal.company || '').toLowerCase()
  const rest = text
    .toLowerCase()
    .replace(company, ' ')
    .replace(/[$€£][\d.,]+\s*[bmk]?/gi, ' ')
    .replace(/\b(raises?|raised|secures?|closes?|lands?|series|seed|round|funding|pre-ipo|led|by|in|a|at|for|to|the|of|and)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return rest.length >= 3 ? text : null
}

function DealCard({ deal, onSelect, isActive }) {
  const { t, i18n } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)
  const roundTier = roundBadgeTier(deal.roundType)
  const sourceLabel = SOURCE_LABELS[deal.sourceBadge] || deal.sourceBadge || t('privateMarkets.dealCard.sourceFallback')
  const sector = deal.sector || t('privateMarkets.dealCard.otherSector')
  const companyLabel = deal.company || t('privateMarkets.dealCard.unknownCompanyAria')
  const roundLabel = deal.roundType || t('privateMarkets.dealCard.fundingRoundAria')
  const blurb = blurbFor(deal)

  return (
    <article
      className={`pm-deal-card glass-card${isActive ? ' pm-deal-card-active' : ''}`}
      onClick={() => onSelect(deal)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(deal)
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={t('privateMarkets.deal.cardAria', '{{company}} - {{round}} {{amount}}', { company: companyLabel, round: roundLabel, amount: fmtMoney(deal.amountUsd) })}
    >
      {/* Top row: logo + company + round badge */}
      <div className="pm-deal-top">
        <PmLogo className="pm-deal-logo" company={deal.company} logoUrl={deal.logoUrl} />
        <div className="pm-deal-company">
          <div className="pm-deal-name heading">{deal.company || t('privateMarkets.dealCard.unknown')}</div>
          <div className="caption pm-deal-sector">{sector}</div>
        </div>
        {deal.roundType && (
          <span className={`pm-deal-round-badge pm-round-${roundTier}`}>
            {deal.roundType}
          </span>
        )}
      </div>

      {/* Amount row */}
      <div className="pm-deal-amount-row">
        <div className="pm-deal-amount mono">{fmtMoney(deal.amountUsd)}</div>
        {deal.valuationUsd && (
          <div className="pm-deal-val mono">
            <span className="pm-deal-val-label">@</span>
            {fmtMoney(deal.valuationUsd)}
          </div>
        )}
      </div>

      {blurb && <p className="pm-deal-headline caption">{blurb}</p>}

      {/* Lead investor */}
      {deal.leadInvestor && (
        <div className="pm-deal-lead">
          <span className="caption pm-deal-lead-label">{t('privateMarkets.dealCard.ledBy')}</span>
          <span className="pm-deal-lead-name">{deal.leadInvestor}</span>
        </div>
      )}

      {/* Footer: source + date */}
      <div className="pm-deal-footer">
        <span className="pm-deal-source">{sourceLabel}</span>
        <span className="pm-deal-date caption">{formatRelativeDate(deal.date, t, i18n.language)}</span>
      </div>
    </article>
  )
}

// memo: clicking a card toggles selection in the parent, re-rendering the whole
// visible grid (up to 60 cards). onSelect is useCallback-stable, so only the 2
// cards whose isActive flipped re-render.
export default memo(DealCard)
