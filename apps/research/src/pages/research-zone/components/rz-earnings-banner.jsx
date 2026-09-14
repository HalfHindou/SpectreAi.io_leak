import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { daysUntil } from '@/lib/earnings-countdown'
import './rz-earnings-banner.css'

// Compact large-USD formatter for the revenue estimate (e.g. $91.8B).
function fmtLargeUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return null
  const v = Number(n)
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

const GAP_RISK_NOTE = "Binary gap risk into the print — stops don't protect through earnings."

/**
 * buildEarningsModel — the one place the print is turned into words.
 *
 * Both faces below read from this, so the countdown, the date string and the
 * proximity tier can never disagree between the hero rail and the band.
 * Returns null when there is no usable date, or when the print is clearly in
 * the past (Yahoo occasionally lags a day or two).
 */
export function buildEarningsModel(earningsDate) {
  if (!earningsDate) return null
  const ms = new Date(earningsDate).getTime()
  if (!Number.isFinite(ms)) return null
  const days = daysUntil(earningsDate)
  if (days < -3) return null

  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })

  // The anchor reads as one line: a big value plus an optional unit. The short
  // unit is for the hero rail, where the row has to stay on one line.
  let countValue, countUnit, countUnitShort
  if (days < 0) { countValue = 'Reported'; countUnit = null; countUnitShort = null }
  else if (days === 0) { countValue = 'Today'; countUnit = null; countUnitShort = null }
  else if (days === 1) { countValue = 'Tomorrow'; countUnit = null; countUnitShort = null }
  else { countValue = `${days}`; countUnit = 'days left'; countUnitShort = 'days' }

  // Proximity tier drives WEIGHT, not colour: an imminent print gets the
  // brighter surface + the gap-risk warning, a far one stays quiet.
  const tier = days < 0 ? 'past' : days <= 7 ? 'imminent' : days <= 30 ? 'near' : 'far'

  return { days, dateStr, countValue, countUnit, countUnitShort, tier }
}

function fmtEps(v) {
  return v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : null
}

/**
 * isAwaitingFigures — the print has happened and the vendor has not published
 * the reported numbers yet.
 *
 * SPCX reported 2026-08-04 20:00 UTC and the history table still held nothing
 * newer than Mar 2026 an hour later, while the wire was already carrying the
 * beat. That window is precisely when a reader comes looking, so both the hero
 * rail and the Earnings tab have to name it — and they read it from HERE, for
 * the same reason the countdown does: two surfaces disagreeing about whether a
 * company has reported is worse than neither of them saying anything.
 *
 * 🪤 A history row is keyed by FISCAL QUARTER END, not report date. A print on
 * Aug 4 reports the quarter ending Jun 30 (~35 days back) while the PRIOR
 * quarter sits ~126 days back — so "already published" is a gap under ~120
 * days. Comparing the row date to the print date directly would mark every
 * freshly-published quarter as missing.
 */
export function isAwaitingFigures(earningsDate, earningsHistory) {
  if (!earningsDate) return false
  const printTs = new Date(earningsDate).getTime()
  if (!Number.isFinite(printTs)) return false
  if (daysUntil(earningsDate) > 0) return false // hasn't printed yet

  const rows = Array.isArray(earningsHistory) ? earningsHistory : []
  const newest = rows.reduce((max, h) => {
    const t = new Date(h?.date || h?.quarter).getTime()
    return Number.isFinite(t) && t > max ? t : max
  }, -Infinity)

  return !Number.isFinite(newest) || newest < printTs - 120 * 86400000
}

/**
 * RzHeroEarnings — the print, rendered INSIDE the hero banner's middle slot.
 *
 * On a stock the hero's middle is otherwise empty (RzWhatIf is crypto-only), so
 * the countdown and the Street estimates were living in a separate full-width
 * band below — a whole extra row of chrome for four numbers, and the band read
 * as two islands with a void between them at wide widths. Here they fill the
 * space the hero already had, in the same label-over-value language as the
 * left rail's stat tiles, and the page loses a row before the chart.
 *
 * Deliberately one line of cells, not the band's layout: it shares the hero row
 * with the identity block and the price, so it stays compact and wraps as a
 * unit under narrow layouts rather than reflowing internally.
 */
export function RzHeroEarnings({ earningsDate, earningsAvg, revenueAvg, earningsHistory, reported, isEstimate = false }) {
  const { t } = useTranslation()
  const model = useMemo(() => buildEarningsModel(earningsDate), [earningsDate])
  const pending = useMemo(
    () => isAwaitingFigures(earningsDate, earningsHistory),
    [earningsDate, earningsHistory],
  )
  if (!model) return null

  const eps = fmtEps(earningsAvg)
  const rev = fmtLargeUsd(revenueAvg)

  // Wire-reported values. Deliberately NOT merged into the estimate cells above
  // — a reader has to be able to see which number is the Street's and which is
  // the company's, especially while only one of the two exists.
  const wireGrowth = reported?.revenueGrowthPct?.value ?? null
  const wireRevenue = reported?.revenue?.value ?? null
  const wireEps = reported?.eps?.value ?? null
  const wireVerdict = reported?.verdict?.value ?? null

  return (
    <div className={`rzh-earn rzh-earn--${model.tier}`} role="note" aria-label={t('researchPro.earningsBanner.rzheroearnings.ariaNextEarnings', "Next earnings")}>
      <div className="rzh-earn-cell rzh-earn-cell--lead">
        <i>{t('researchPro.earningsBanner.rzheroearnings.nextEarnings', "Next earnings")}</i>
        <b className="mono">
          {model.countValue}
          {model.countUnitShort && <em>{model.countUnitShort}</em>}
        </b>
      </div>

      <div className="rzh-earn-cell">
        <i>{isEstimate ? 'Est. date' : 'Date'}</i>
        <b>{model.dateStr}</b>
      </div>

      {/* The estimates stay on the rail AFTER the print, not just before it —
          once a company has reported they are the only reference a reader has
          until the vendor publishes, and they are what every wire headline is
          quoting against ("EST. $6.81B"). The label switches to say so. */}
      {eps && (
        <div className="rzh-earn-cell">
          <i>{pending ? 'Street EPS' : 'Est. EPS'}</i>
          <b className="mono">{eps}</b>
        </div>
      )}

      {rev && (
        <div className="rzh-earn-cell">
          <i>{pending ? 'Street revenue' : 'Est. revenue'}</i>
          <b className="mono">{rev}</b>
        </div>
      )}

      {/* The printed result, the moment any source states it. The vendor row is
          slower than the wire by 20-40+ minutes, and this rail is what a reader
          looks at during exactly those minutes (founder 08-04). */}
      {wireGrowth != null && (
        <div className="rzh-earn-cell rzh-earn-cell--reported">
          <i>{t('researchPro.earningsBanner.rzheroearnings.revenue', "Revenue")}</i>
          <b className={`mono ${wireGrowth >= 0 ? 'up' : 'down'}`}>{wireGrowth >= 0 ? '+' : ''}{wireGrowth}%</b>
        </div>
      )}
      {wireRevenue != null && (
        <div className="rzh-earn-cell rzh-earn-cell--reported">
          <i>{t('researchPro.earningsBanner.rzheroearnings.reportedRevenue', "Reported revenue")}</i>
          <b className="mono">{fmtLargeUsd(wireRevenue)}</b>
        </div>
      )}
      {wireEps != null && (
        <div className="rzh-earn-cell rzh-earn-cell--reported">
          <i>{t('researchPro.earningsBanner.rzheroearnings.reportedEps', "Reported EPS")}</i>
          <b className="mono">{fmtEps(wireEps)}</b>
        </div>
      )}

      {wireVerdict ? (
        <span
          className={`rzh-earn-chip is-${wireVerdict}`}
          title={`Reported by ${reported?.verdict?.sources || 1} source${(reported?.verdict?.sources || 1) > 1 ? 's' : ''}. Vendor-confirmed figures follow.`}
        >
          {wireVerdict === 'beat' ? 'Beat' : wireVerdict === 'miss' ? 'Miss' : 'Mixed'}
        </span>
      ) : pending ? (
        <span className="rzh-earn-chip is-pending" title={t('researchPro.earningsBanner.rzheroearnings.title', "The print has happened. Confirmed figures are not published yet — the numbers shown are the Street's going in.")}>
          {t('researchPro.earningsBanner.rzheroearnings.figuresPending', "Figures pending")}
        </span>
      ) : model.tier === 'imminent' ? (
        <span className="rzh-earn-chip" title={GAP_RISK_NOTE}>{t('researchPro.earningsBanner.rzheroearnings.gapRisk', "Gap risk")}</span>
      ) : null}
    </div>
  )
}

/**
 * RzEarningsBanner — the "Next Earnings" band, now the MOBILE face of the print
 * (the desktop hero renders RzHeroEarnings inline instead).
 *
 * Hierarchy by SCALE and WEIGHT, not by colour wash: glass surface, warm-white
 * type, the countdown as the anchor number. Gap risk (a real, useful warning)
 * reads as a small neutral chip plus one quiet line — never a red slab.
 * Layout is a wrapping flex row so it reflows at any container width or browser
 * zoom instead of clipping (the >90%-zoom break reported on desktop Firefox).
 *
 * Purely a reader of tokenData — no fetch here; the date is the same fresh Yahoo
 * calendarEvents value the rest of the page uses.
 */
export default function RzEarningsBanner({ earningsDate, earningsAvg, revenueAvg, earningsHistory, isEstimate = false }) {
  const { t } = useTranslation()
  const model = useMemo(() => buildEarningsModel(earningsDate), [earningsDate])
  const pending = useMemo(
    () => isAwaitingFigures(earningsDate, earningsHistory),
    [earningsDate, earningsHistory],
  )

  // Collapsible (founder 08-05: "earnings maybe open close?"). A print that is
  // imminent — or already happened with figures pending — opens itself; a far
  // one starts as a single quiet row.
  const urgent = pending || model?.tier === 'imminent'
  const [open, setOpen] = useState(urgent)

  if (!model) return null

  const eps = fmtEps(earningsAvg)
  const rev = fmtLargeUsd(revenueAvg)
  const expanded = open || urgent

  return (
    <div
      className={`rze-banner rze-banner--${model.tier}${expanded ? '' : ' rze-banner--closed'}`}
      role="note"
      aria-label={t('researchPro.earningsBanner.rzearningsbanner.ariaNextEarnings', "Next earnings")}
    >
      <button
        type="button"
        className="rze-toggle"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="rze-lead">
          <span className="rze-kicker">{t('researchPro.earningsBanner.rzearningsbanner.nextEarnings', "Next earnings")}</span>
          <span className="rze-count">
            <b className="mono">{model.countValue}</b>
            {model.countUnit && <i>{model.countUnit}</i>}
          </span>
        </div>

        <div className="rze-when">
          <b>{model.dateStr}</b>
          {isEstimate && <i>{t('researchPro.earningsBanner.rzearningsbanner.estimatedDate', "estimated date")}</i>}
        </div>

        <svg
          className="rze-chevron"
          viewBox="0 0 24 24" width="14" height="14" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <>
          {pending ? (
            <div className="rze-risk">
              <span className="rze-chip">{t('researchPro.earningsBanner.rzearningsbanner.figuresPending', "Figures pending")}</span>
              <p className="rze-risk-note">Reported — confirmed figures not published yet. The numbers below are the Street's going in.</p>
            </div>
          ) : model.tier === 'imminent' ? (
            <div className="rze-risk">
              <span className="rze-chip">{t('researchPro.earningsBanner.rzearningsbanner.gapRisk', "Gap risk")}</span>
              <p className="rze-risk-note">{GAP_RISK_NOTE}</p>
            </div>
          ) : null}

          {(eps || rev) && (
            <div className="rze-ests">
              {eps && (
                <div className="rze-est">
                  <i>{pending ? 'Street EPS' : 'Est. EPS'}</i>
                  <b className="mono">{eps}</b>
                </div>
              )}
              {rev && (
                <div className="rze-est">
                  <i>{pending ? 'Street revenue' : 'Est. revenue'}</i>
                  <b className="mono">{rev}</b>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
