/**
 * RZ Fundamentals — real per-project supply/protocol data, surfaced visibly
 * (not just narrated in the desk read): the token UNLOCK schedule (supply
 * overhang) and protocol TVL (adoption). Only renders when the data exists —
 * memecoins have neither, which the Sentiment engine already reads as a signal.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import './rz-sentiment-engine.css'

const num = (v) => (Number.isFinite(v) ? v : null)

function fmtUsd(n) {
  // 🪤 Never render a zero. The unlock rows for 19 of the 44 tracked assets are
  // curated and carry no USD figure at all; summing those nulls used to print
  // "$0 total overhang" on a token with 3.5% of supply still to vest — a number
  // that reads as the exact opposite of the truth. No value means "—".
  if (n == null || !Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}
function fmtTokens(n) {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}
function fmtDateShort(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })
}
function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const RzFundamentals = React.memo(function RzFundamentals({ fundamentals, dayMode }) {
  const { t } = useTranslation()
  // Hooks first — this component returns null for memecoins (no unlocks, no
  // TVL), and a useState below that early return would change hook order the
  // moment a token flips from "no data" to "data".
  const [showAll, setShowAll] = React.useState(false)

  const unlocks = fundamentals?.unlocks
  const tvl = fundamentals?.tvl
  const schedule = Array.isArray(unlocks?.schedule) ? unlocks.schedule : []
  const SCHEDULE_PREVIEW = 4
  const shown = showAll ? schedule : schedule.slice(0, SCHEDULE_PREVIEW)

  if (!unlocks && !tvl) return null

  const chg = num(tvl?.change30dPct)
  const tvlTone = chg == null ? '' : chg >= 5 ? 'up' : chg <= -10 ? 'down' : ''
  const tvlTrend = chg == null ? null : chg >= 5 ? 'growing adoption' : chg <= -10 ? 'outflows' : 'stable'

  return (
    <div className={`rz-sen-grid ${dayMode ? 'rz-sen--day' : ''}`}>
      {unlocks && (
        <div className="rz-sen-card">
          <span className="rz-sen-card-title">{t('researchPro.fundamentals.rzfundamentals.tokenUnlocks', "Token Unlocks")}</span>
          {unlocks.fullyUnlocked ? (
            <>
              <div className="rz-sen-card-hero">
                <span className="rz-sen-card-big rz-sen-card-big--bull" style={{ fontSize: 19, fontFamily: 'var(--font-display)' }}>{t('researchPro.fundamentals.rzfundamentals.fullyUnlocked', "Fully unlocked")}</span>
              </div>
              <p className="rz-sen-card-body up">No vesting cliff or unlock overhang ahead — supply is fully in the market, a structurally clean setup that removes a common bear thesis.</p>
            </>
          ) : unlocks.next ? (
            <>
              <div className="rz-sen-card-hero">
                <span className={`rz-sen-card-big ${(num(unlocks.next.pctOfSupply) ?? 0) >= 2 ? 'rz-sen-card-big--warn' : ''}`}>
                  {num(unlocks.next.pctOfSupply) != null ? `${unlocks.next.pctOfSupply.toFixed(2)}%` : '—'}
                </span>
                <span className="rz-sen-card-unit">of supply · next unlock</span>
              </div>
              <div className="rz-sen-card-rows">
                <div className="rz-sen-row"><span>{t('researchPro.fundamentals.rzfundamentals.date', "Date")}</span><span className="mono">{fmtDate(unlocks.next.date) || '—'}</span></div>
                {unlocks.next.amountUsd != null && (
                  <div className="rz-sen-row"><span>{t('researchPro.fundamentals.rzfundamentals.value', "Value")}</span><span className="mono">{fmtUsd(unlocks.next.amountUsd)}</span></div>
                )}
                {unlocks.next.category && (
                  <div className="rz-sen-row"><span>{t('researchPro.fundamentals.rzfundamentals.recipient', "Recipient")}</span><span className="mono" style={{ textTransform: 'capitalize' }}>{unlocks.next.category}</span></div>
                )}
                {unlocks.upcomingEvents > 1 && (
                  <div className="rz-sen-row">
                    <span>{t('researchPro.fundamentals.rzfundamentals.totalAhead', "Total ahead")}</span>
                    <span className="mono warn">
                      {num(unlocks.totalUpcomingPctOfSupply) != null ? `${unlocks.totalUpcomingPctOfSupply.toFixed(2)}% of supply` : `${unlocks.upcomingEvents} events`}
                      {num(unlocks.totalUpcomingUsd) > 0 ? ` · ${fmtUsd(unlocks.totalUpcomingUsd)}${unlocks.totalUpcomingUsdEstimated ? ' at spot' : ''}` : ''}
                    </span>
                  </div>
                )}
                {unlocks.lastUnlockDate && unlocks.upcomingEvents > 1 && (
                  <div className="rz-sen-row"><span>{t('researchPro.fundamentals.rzfundamentals.runsUntil', "Runs until")}</span><span className="mono">{fmtDate(unlocks.lastUnlockDate) || '—'}</span></div>
                )}
              </div>

              {schedule.length > 1 && (
                <div className="rz-sen-sched">
                  <div className="rz-sen-sched-head">
                    <span>{t('researchPro.fundamentals.rzfundamentals.remainingSchedule', "Remaining schedule")}</span>
                    <span className="mono">{schedule.length} event{schedule.length === 1 ? '' : 's'}</span>
                  </div>
                  <ul className="rz-sen-sched-list">
                    {shown.map((u, i) => {
                      const tokens = fmtTokens(u.amountTokens)
                      const usd = num(u.amountUsd) > 0 ? fmtUsd(u.amountUsd) : null
                      return (
                        <li key={`${u.date || i}-${i}`} className="rz-sen-sched-row">
                          <span className="rz-sen-sched-date mono">{fmtDateShort(u.date)}</span>
                          <span className={`rz-sen-sched-pct mono${(num(u.pctOfSupply) ?? 0) >= 2 ? ' warn' : ''}`}>
                            {num(u.pctOfSupply) != null ? `${u.pctOfSupply.toFixed(2)}%` : '—'}
                          </span>
                          <span className="rz-sen-sched-size mono">{usd || (tokens ? `${tokens} tokens` : '—')}</span>
                          <span className="rz-sen-sched-cat">{u.category || '—'}</span>
                        </li>
                      )
                    })}
                  </ul>
                  {schedule.length > SCHEDULE_PREVIEW && (
                    <button type="button" className="rz-sen-sched-more" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Show less' : `Show all ${schedule.length}`}
                    </button>
                  )}
                </div>
              )}

              <p className="rz-sen-card-body">Upcoming unlocks are concrete future sell pressure — size and timing matter for entries.{unlocks.totalUpcomingUsdEstimated ? ' Dollar sizes are the token amounts valued at spot.' : ''}</p>
            </>
          ) : null}
        </div>
      )}

      {tvl && (
        <div className="rz-sen-card">
          <span className="rz-sen-card-title">{t('researchPro.fundamentals.rzfundamentals.protocolTvl', "Protocol TVL")}</span>
          <div className="rz-sen-card-hero">
            <span className="rz-sen-card-big">{fmtUsd(tvl.tvlUsd)}</span>
            {chg != null && <span className={`rz-sen-card-unit ${tvlTone === 'up' ? 'up' : tvlTone === 'down' ? 'down' : ''}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}% / 30d</span>}
          </div>
          <p className={`rz-sen-card-body ${tvlTone === 'up' ? 'up' : tvlTone === 'down' ? 'down' : ''}`}>
            {tvlTrend ? `Capital locked in the protocol — ${tvlTrend} over 30 days. ` : 'Capital locked in the protocol. '}
            Real usage/adoption, an anchor of value beyond price and attention.
          </p>
        </div>
      )}
    </div>
  )
})

export default RzFundamentals
