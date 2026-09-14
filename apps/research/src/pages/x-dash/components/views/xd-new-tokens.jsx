/**
 * New - Early Runner signals.
 *
 * Not "tokens that were listed recently" (an old token mentioned for weeks
 * isn't new). This is a degen early-catch board: it scans the live attention
 * board and scores every token for early-breakout potential (Runner Score,
 * see @/lib/runner-signal.js — shared with X Intel's Runners board) - small
 * cap + accelerating + climbing + clean + broad - then surfaces the top
 * setups as signal cards with the "why".
 */
import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { TokenCell, Shimmer, EmptyState, ErrorState } from '../xd-bits'
import { formatNum, matchesMcapBand } from '../x-dash-utils'
import { setTokenSeed } from '@/lib/xdash-token-seed'
import {
  computeRunnerScore, RUNNER_TIER_LABEL, RUNNER_MIN_SCORE, RUNNER_MAX_MCAP,
} from '@/lib/runner-signal'

function tokenIdentity(row) {
  return {
    symbol: row.symbol,
    name: row.name,
    cg_id: row.cg_id || row.token_id,
    cashtag: row.cashtag,
    segment: row.segment,
    chain: row.chain,
    image_small: row.image_small || row.image,
    image_url: row.image_url,
  }
}

function RunnerCard({ entry, rank, onOpenToken, fmtLargeShort }) {
  const { row, score, tier, reasons } = entry
  const identity = tokenIdentity(row)
  if (identity.cg_id) setTokenSeed(identity.cg_id, row)
  const mc = Number(row.market_cap || 0)
  const mentions = Number(row.external_mentions_24h || 0)
  const authors = Number(row.unique_external_authors_24h || row.author_count || 0)
  const open = () => identity.cg_id && onOpenToken(identity.cg_id)
  const onKeyDown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }

  return (
    <div className="xd-runner-card" role="button" tabIndex={0} onClick={open} onKeyDown={onKeyDown}>
      <div className="xd-runner-card__top">
        <span className="xd-runner-card__rank xd-num">{rank}</span>
        <div className="xd-runner-card__id"><TokenCell token={identity} compact /></div>
        <span className={`xd-runner-score xd-runner-score--${tier}`}>
          <span className="xd-runner-score__num xd-num">{score}</span>
          <span className="xd-runner-score__tier">{RUNNER_TIER_LABEL[tier]}</span>
        </span>
      </div>

      <div className="xd-runner-card__reasons">
        {reasons.map((r, i) => (
          <span key={i} className={`xd-runner-chip xd-runner-chip--${r.tone}`}>{r.text}</span>
        ))}
      </div>

      <div className="xd-runner-card__stats">
        <span className="xd-runner-stat"><b className="xd-num">{mc > 0 ? fmtLargeShort(mc) : '-'}</b> mcap</span>
        <span className="xd-runner-stat"><b className="xd-num">{formatNum(mentions)}</b> mentions</span>
        <span className="xd-runner-stat"><b className="xd-num">{formatNum(authors)}</b> authors</span>
      </div>
    </div>
  )
}

const SIGNALS_PAGE = 18 // initial grid size; "Show more" reveals the rest

export default function XDNewTokens({ controls, onOpenToken }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const params = useMemo(() => ({
    page: 1,
    perPage: 50,            // momentum-ranked scan; we re-score for early-runner fit
    timeframe: controls.timeframe,
    ranking: 'momentum',    // momentum board surfaces the accelerating set to score
    segment: controls.segment,
    market: controls.market,
    minKols: 1,
  }), [controls.timeframe, controls.segment, controls.market])

  const { data, loading, error } = useXDashBootstrap(params)

  const allSignals = useMemo(() => {
    const rows = data?.tokens || []
    return rows
      .map((row) => ({ row, ...computeRunnerScore(row) }))
      .filter((s) => {
        const mc = Number(s.row.market_cap || 0)
        if (s.score < RUNNER_MIN_SCORE || !(mc > 0) || mc > RUNNER_MAX_MCAP) return false
        /* Honor the command bar's market-cap band. The ceiling presets ("< $10M")
           and custom ranges are client-side - the API only takes floors - so
           without this the filter silently no-op'd on this view. */
        return matchesMcapBand(mc, controls.mcapBand)
      })
      .sort((a, b) => b.score - a.score)
  }, [data, controls.mcapBand])

  /* The grid used to hard-cap at 18 with no way to reach the rest — the
     19th-best runner was simply unreachable. Show the top page, expand on
     demand; reset the fold when the filter set changes. */
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setShowAll(false) }, [params])
  const signals = showAll ? allSignals : allSignals.slice(0, SIGNALS_PAGE)
  const hiddenCount = allSignals.length - signals.length

  if (loading && !data) return <Shimmer variant="row" count={9} />
  if (error && !data) return <ErrorState message={String(error)} />

  return (
    <div className="xd-runners">
      <div className="xd-view-banner">
        {t('xDash.runners.banner', 'Early runner signals - small caps with accelerating, clean social momentum, scored 0-100 for breakout potential. Caught while attention is building, not after they run. Not financial advice.')}
      </div>

      {signals.length === 0 ? (
        <EmptyState
          title={t('xDash.runners.empty.title', 'No early runner setups right now')}
          detail={t('xDash.runners.empty.detail', 'Nothing is accelerating cleanly off a low base for these filters. Widen the segment / market-cap floor, or check back as fresh attention builds.')}
        />
      ) : (
        <>
          <div className="xd-view-toolbar">
            <div className="xd-section-label" style={{ margin: 0 }}>
              {signals.length === 1
                ? t('xDash.runners.countOne', '1 runner signal')
                : t('xDash.runners.countMany', '{{count}} runner signals', { count: signals.length })}
            </div>
            <div className="xd-view-toolbar__spacer" />
            <span className="xd-view-count">{t('xDash.runners.sortedBy', 'by Runner Score')}</span>
          </div>
          <div className="xd-runners__grid">
            {signals.map((entry, i) => (
              <RunnerCard
                key={entry.row.cg_id || entry.row.token_id || entry.row.symbol}
                entry={entry}
                rank={i + 1}
                onOpenToken={onOpenToken}
                fmtLargeShort={fmtLargeShort}
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <div className="xd-runners__more">
              <button type="button" className="xd-btn xd-btn--ghost xd-btn--sm" onClick={() => setShowAll(true)}>
                {t('xDash.runners.showMore', 'Show {{count}} more signals', { count: hiddenCount })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
