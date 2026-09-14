/**
 * XDTrackRecord — THE PROVENANCE TAPE. Spectre's paper-trading accountability
 * wall, rendered as the "Proof" view inside /x-dash.
 *
 * Every token Spectre surfaced socially is logged at its IMMUTABLE first-spotted
 * market cap (momentum_origin) and marked to its latest tracked market cap — a
 * virtual $1,000 paper trade per call. This page is the verifiable receipt:
 * winners AND losers, the real hit rate, the ~flat median. Honesty is the
 * credibility — we never hide the misses or inflate the aggregate.
 *
 * Section order (read top→bottom like a printed ledger):
 *   1. MASTHEAD          eyebrow + serif headline + honest trio (Stakes/Hit/Median)
 *   2. PROOF RIBBON      2× · 5× · 10× · best · best-peak · portfolio
 *   3. DISTRIBUTION BAND derived ROI histogram — the squint test
 *   4. HALL OF FAME      top 3 calls as oversized tape cards
 *   5. THE TAPE          full ledger — sort/status toolbar + dense rows
 *   6. THE HONEST LINE   methodology footnote, quiet close
 *
 * Data: the ledger is finished + derived — no per-token live fetch. The hook
 * reads /api/xdash/track-record (proxies /v1/social/track-record). The summary
 * + Hall of Fame come from one fetch; the tape refetches server-side on
 * sort/status change (server is the source of truth for the published ledger).
 *
 * Performance: default limit=400 (NOT 1,259). 400 covers the histogram, every
 * 5×+ moonshot, and a deep scrollable tape while keeping the DOM sane. Offscreen
 * rows use content-visibility:auto + contain-intrinsic-size so they don't paint.
 *
 * This view IGNORES the page command-bar controls (timeframe/ranking/segment/
 * mcap/chain) — a finished ledger has its own sort/status. Reads only
 * onOpenToken from props. Do NOT wire `controls` in by reflex.
 *
 * status server-side is only 'moon' | 'up' | 'down' (no unknown/flat/dead/rug);
 * x10 is genuinely 0; the "flat" tier is derived client-side from `calls`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useXDashTrackRecord } from '@/hooks/useXDashTrackRecord'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import { Avatar, Shimmer, EmptyState, ErrorState } from '../xd-bits'
import { fmtUsd, relativeTime } from '../x-dash-utils'

const LIVE_PAPER_PARAMS = {} // stable ref so the surface hook doesn't re-key
const STAKE_FALLBACK = 1000
const TOTAL_CALLS_FALLBACK = 1259
const DEFAULT_LIMIT = 400

/* honor reduced-motion once for the count-up / draw-on-reveal flourishes */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ---------- signed % / multiple formatters ---------- */
function fmtPct(value, digits = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}
function fmtMult(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}×`
}
function shortDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* status → tone for the row spine + card accent. */
function statusTone(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'moon') return 'moon'
  if (s === 'up') return 'up'
  if (s === 'down') return 'down'
  // numeric fallback handled by callers; default neutral
  return 'flat'
}

/* ---------- count-up hook (single run, tabular-nums so width never jumps) --- */
function useCountUp(target, { duration = 700, run = true } = {}) {
  const [value, setValue] = useState(run ? 0 : target)
  const rafRef = useRef(null)
  const startedRef = useRef(false)

  // first-reveal count-up animation (one-shot, honors reduced-motion)
  useEffect(() => {
    if (!run || prefersReducedMotion()) { startedRef.current = true; setValue(target); return undefined }
    if (startedRef.current) { setValue(target); return undefined }
    startedRef.current = true
    const to = Number(target) || 0
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(to * eased)
      if (t < 1) { rafRef.current = requestAnimationFrame(tick) }
      else { rafRef.current = null; setValue(to) } // done → clear so the sync effect can take over
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // once the reveal animation is done (or never ran), keep the displayed value
  // in sync when a background refetch changes the target — snap, don't re-animate.
  useEffect(() => {
    if (!startedRef.current || rafRef.current) return
    setValue(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  return value
}

/* ============================================================
   SECTION 1 — MASTHEAD
   ============================================================ */
function TrioCard({ kind, value, label, sub, valueTone, animate }) {
  const animated = useCountUp(value.raw, { run: animate && value.countable })
  const display = value.countable
    ? value.format(animated)
    : value.text
  return (
    <div className={`glass-card xd-tr-trio-card xd-tr-trio-card--${kind}`}>
      <div className={`xd-tr-trio-card__value xd-num${valueTone ? ` xd-tr-trio-card__value--${valueTone}` : ''}`}>
        {display}
      </div>
      <div className="xd-tr-trio-card__label">{label}</div>
      <div className="xd-tr-trio-card__sub">{sub}</div>
    </div>
  )
}

/* HIT-RATE TRUTH BAR — a hit rate is only honest if you can see what the misses
   ARE. Not every below-entry call is a loss you'll never recover: an UNDERWATER
   token is down hard but still actively tracked (bagholders alive, revival not
   ruled out) — salvageable. A DEAD / RUG token has gone quiet — gone for good.
   Splitting the misses this way is the difference between the raw % and the
   TRUE picture. Counts come straight from the summary (`dead` already includes
   rugs — deep loss + no pulse; `rug` is the data-api subset when present). */
function HitBreakdown({ summary, t }) {
  const calls = Number(summary?.calls) || 0
  if (!calls) return null
  const up = Number(summary?.up) || 0
  const dead = Number(summary?.dead) || 0             // deep loss + gone quiet (incl. rugs)
  const underwater = Number(summary?.underwater) || 0 // deep loss BUT still tracked
  const rug = Number(summary?.rug) || 0               // subset of `dead` (data-api; 0 until deployed)
  const deadOnly = Math.max(0, dead - rug)
  const below = Math.max(0, calls - up)
  const soft = Math.max(0, below - underwater - dead) // down, but not deep — still alive

  const segs = [
    { key: 'up', tone: 'up', n: up, label: t('xDash.trackRecord.truth.inProfit', 'in profit') },
    { key: 'soft', tone: 'soft', n: soft, label: t('xDash.trackRecord.truth.soft', 'down · still alive') },
    { key: 'underwater', tone: 'underwater', n: underwater, label: t('xDash.trackRecord.truth.underwater', 'underwater · salvageable') },
    // when the data-api ships the rug split, show dead + rug separately; else one "dead / rug · gone"
    ...(rug > 0
      ? [
          { key: 'dead', tone: 'dead', n: deadOnly, label: t('xDash.trackRecord.truth.dead', 'dead · gone') },
          { key: 'rug', tone: 'dead', n: rug, label: t('xDash.trackRecord.truth.rug', 'rugged · gone') },
        ]
      : [{ key: 'dead', tone: 'dead', n: dead, label: t('xDash.trackRecord.truth.deadRug', 'dead / rug · gone') }]),
  ].filter((sg) => sg.n > 0)

  const gone = deadOnly + rug
  return (
    <div className="xd-tr-truth" role="list" aria-label={t('xDash.trackRecord.truth.aria', 'Hit-rate breakdown')}>
      {segs.map((sg) => (
        <span className={`xd-tr-truth__seg xd-tr-truth__seg--${sg.tone}`} role="listitem" key={sg.key}>
          <span className="xd-tr-truth__n xd-num">{sg.n.toLocaleString('en-US')}</span>
          <span className="xd-tr-truth__label">{sg.label}</span>
        </span>
      ))}
      <span className="xd-tr-truth__note">
        {t('xDash.trackRecord.truth.note', 'underwater is still salvageable — only {{gone}} are truly gone', { gone: gone.toLocaleString('en-US') })}
      </span>
    </div>
  )
}

function Masthead({ summary, view, pop, onPop, sigAvailable, meta, t, animate }) {
  const signalsMode = pop === 'signals' && sigAvailable
  const calls = Number(view?.calls) || TOTAL_CALLS_FALLBACK
  const up = Number(view?.up) || 0
  const hitRate = Number(view?.hit_rate)
  const stake = Number(view?.stake_per_call) || STAKE_FALLBACK
  const invested = Number(view?.invested) || calls * stake
  const ts = meta?.ts
  // the third card leads with the strategy read — the honest positive stat.
  // Signal mode: the lane's own trailing-exit book. Firehose mode: the causal
  // small-cap cut. Median moved to the ribbon; nothing is hidden.
  const strat = summary?.strategy?.causal_smallcap
  const stratRoi = signalsMode
    ? Number(view?.trail_roi)
    : Number(strat?.trail_roi ?? summary?.strategy?.firehose?.trail_roi)
  const stratN = signalsMode ? calls : (Number(strat?.n) || 0)
  const trailPct = Number(summary?.strategy?.trail_pct) || 30
  const sigCalls = Number(summary?.signals?.calls) || 0
  const allCalls = Number(summary?.calls) || 0

  return (
    <header className="xd-tr-masthead">
      <div className="xd-tr-masthead__glow" aria-hidden="true" />

      <div className="xd-tr-eyebrow">
        <span className="xd-tr-eyebrow__label">{t('xDash.trackRecord.eyebrow', 'TRACK RECORD')}</span>
        <span className="xd-tr-eyebrow__right">
          <span className="xd-tr-pulse" aria-hidden="true" />
          <span className="xd-tr-fresh">
            {ts
              ? t('xDash.updated', 'updated {{when}}', { when: relativeTime(ts, t) })
              : t('xDash.updatingLabel', 'updating...')}
          </span>
          <span className="xd-tr-badge">Spectre AI</span>
        </span>
      </div>

      <h1 className="xd-tr-headline">
        {t('xDash.trackRecord.headline', 'Every call, marked to market.')}
      </h1>
      <p className="xd-tr-sub">
        {signalsMode
          ? t('xDash.trackRecord.subLeadSignals', 'The calls Spectre actually surfaced — 12+ callers or board top-10 at first sighting — logged at their first-seen market cap and marked to the latest tape. No edits. ')
          : t('xDash.trackRecord.subLead', 'We log every token the moment we spot it socially — at its first-seen market cap — then mark it to the latest tape. No edits. ')}
        <span className="xd-tr-sub__admit">{t('xDash.trackRecord.subAdmit', 'Winners and losers.')}</span>
        {t('xDash.trackRecord.subTail', ' This is the receipt.')}
      </p>

      {sigAvailable && (
        <div className="xd-toggle xd-tr-pop-toggle" role="tablist" aria-label={t('xDash.trackRecord.pop.aria', 'Ledger population')}>
          <button
            type="button"
            role="tab"
            aria-selected={pop === 'signals'}
            className={`xd-toggle__btn${pop === 'signals' ? ' xd-toggle__btn--active' : ''}`}
            onClick={() => onPop('signals')}
            data-tooltip={t('xDash.trackRecord.pop.signalsTip', 'Tokens that cleared the signal gate at first sighting (12+ callers or board top-10) — entry-time fields, no look-ahead.')}
          >
            {t('xDash.trackRecord.pop.signals', 'Signal calls ({{n}})', { n: sigCalls.toLocaleString('en-US') })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pop === 'all'}
            className={`xd-toggle__btn${pop === 'all' ? ' xd-toggle__btn--active' : ''}`}
            onClick={() => onPop('all')}
            data-tooltip={t('xDash.trackRecord.pop.allTip', 'Every token the radar ever spotted socially — most never became a call. Kept public so the signal lane can never be accused of cherry-picking.')}
          >
            {t('xDash.trackRecord.pop.all', 'Full radar ({{n}})', { n: allCalls.toLocaleString('en-US') })}
          </button>
        </div>
      )}

      <div className="xd-tr-trio">
        <TrioCard
          kind="stakes"
          animate={animate}
          value={{ raw: calls, countable: true, format: (v) => Math.round(v).toLocaleString('en-US') }}
          label={signalsMode
            ? t('xDash.trackRecord.trio.signalCallsLabel', 'SIGNAL CALLS')
            : t('xDash.trackRecord.trio.callsLabel', 'CALLS LOGGED')}
          sub={t('xDash.trackRecord.trio.callsSub', '${{stake}} each · {{invested}} deployed', {
            stake: stake.toLocaleString('en-US'),
            invested: fmtUsd(invested) || `$${invested.toLocaleString('en-US')}`,
          })}
        />
        <TrioCard
          kind="hitrate"
          animate={animate}
          value={{ raw: hitRate, countable: Number.isFinite(hitRate), format: (v) => `${v.toFixed(1)}%`, text: '—' }}
          label={t('xDash.trackRecord.trio.hitLabel', 'HIT RATE')}
          sub={(
            <>
              <span className="xd-tr-trio-card__sub-em">{up.toLocaleString('en-US')}</span>
              {t('xDash.trackRecord.trio.hitSub', ' of {{calls}} in profit', { calls: calls.toLocaleString('en-US') })}
            </>
          )}
        />
        <TrioCard
          kind="strategy"
          animate={animate}
          valueTone={Number.isFinite(stratRoi) ? (stratRoi >= 0 ? 'bull' : 'bear') : undefined}
          value={{ raw: stratRoi, countable: Number.isFinite(stratRoi), format: (v) => fmtPct(v, 1), text: '—' }}
          label={t('xDash.trackRecord.trio.strategyLabel', 'WITH TRAILING EXIT')}
          sub={signalsMode
            ? t('xDash.trackRecord.trio.strategySubSignals', '{{n}} signal calls · exit modeled {{pct}}% off peak', {
              n: stratN ? stratN.toLocaleString('en-US') : '—',
              pct: trailPct,
            })
            : t('xDash.trackRecord.trio.strategySub', '{{n}} small caps <$5M · exit modeled {{pct}}% off peak', {
              n: stratN ? stratN.toLocaleString('en-US') : '—',
              pct: trailPct,
            })}
        />
      </div>

      <HitBreakdown summary={view} t={t} />
    </header>
  )
}

/* ============================================================
   SECTION 2 — PROOF RIBBON
   ============================================================ */
function Ribbon({ summary, t }) {
  // PEAK-based hits — how many calls ever REACHED Nx (the opportunity the call
  // gave). A 25× that gave back to 5× still HIT 25×. This is the honest count;
  // the old current-mark tiers (x2/x5/x10) buried every runner that gave back.
  // Fall back to the current-mark tiers only if the peak fields aren't present.
  const px2 = Number(summary?.peak_x2 ?? summary?.x2) || 0
  const px5 = Number(summary?.peak_x5 ?? summary?.x5) || 0
  const px10 = Number(summary?.peak_x10 ?? summary?.x10) || 0
  const stillX10 = Number(summary?.x10) || 0 // still marked >=10x now (held)
  const best = Number(summary?.best_multiple)
  const bestPeak = Number(summary?.best_peak_multiple)
  const portfolio = Number(summary?.portfolio_multiple)
  const median = Number(summary?.median_multiple)

  const dead = Number(summary?.dead) || 0
  const underwater = Number(summary?.underwater) || 0
  const reachedTip = t('xDash.trackRecord.ribbon.reachedTip', 'Calls that REACHED this multiple at peak — the opportunity the call gave, not where it is marked now.')

  const stats = [
    { key: 'x2', label: t('xDash.trackRecord.ribbon.hit2', 'HIT 2×'), value: px2.toLocaleString('en-US'), tone: 'num', tip: reachedTip },
    { key: 'x5', label: t('xDash.trackRecord.ribbon.hit5', 'HIT 5×'), value: px5.toLocaleString('en-US'), tone: 'num', tip: reachedTip },
    {
      key: 'x10', label: t('xDash.trackRecord.ribbon.hit10', 'HIT 10×'), value: px10.toLocaleString('en-US'), tone: 'bull-bright',
      companion: stillX10 ? t('xDash.trackRecord.ribbon.stillHeld', '{{n}} still', { n: stillX10 }) : null,
      tip: reachedTip,
    },
    { key: 'best', label: t('xDash.trackRecord.ribbon.best', 'BEST'), value: fmtMult(best), tone: 'bull-bright' },
    { key: 'bestPeak', label: t('xDash.trackRecord.ribbon.bestPeak', 'BEST PEAK'), value: fmtMult(bestPeak), tone: 'bull' },
    {
      key: 'median',
      label: t('xDash.trackRecord.ribbon.median', 'MEDIAN'),
      value: Number.isFinite(median) ? fmtMult(median, 2) : '—',
      companion: Number.isFinite(median) ? fmtPct((median - 1) * 100, 0) : null,
      tone: 'num',
    },
    {
      key: 'portfolio',
      label: t('xDash.trackRecord.ribbon.portfolio', 'PORTFOLIO'),
      value: Number.isFinite(portfolio) ? fmtPct((portfolio - 1) * 100, 1) : '—',
      companion: Number.isFinite(portfolio) ? fmtMult(portfolio, 3) : null,
      tone: 'primary',
    },
    // honest tail: down-bad-but-alive vs truly abandoned. never hidden.
    { key: 'underwater', label: t('xDash.trackRecord.ribbon.underwater', 'UNDERWATER'), value: underwater.toLocaleString('en-US'), tone: 'underwater' },
    { key: 'dead', label: t('xDash.trackRecord.ribbon.dead', 'DEAD'), value: dead.toLocaleString('en-US'), tone: 'dead' },
  ]

  return (
    <div className="xd-tr-ribbon-wrap">
      <div className="xd-tr-ribbon" role="list">
        {stats.map((s, i) => (
          <span className="xd-tr-ribbon__item" role="listitem" key={s.key} {...(s.tip ? { 'data-tooltip': s.tip } : {})}>
            <span className="xd-tr-ribbon__label">{s.label}</span>
            <span className={`xd-tr-ribbon__value xd-num xd-tr-ribbon__value--${s.tone}`}>
              {s.value}
              {s.companion && <span className="xd-tr-ribbon__companion xd-num">{s.companion}</span>}
            </span>
            {i < stats.length - 1 && <span className="xd-tr-ribbon__sep" aria-hidden="true" />}
          </span>
        ))}
      </div>
      <PortfolioBreakdown summary={summary} t={t} />
    </div>
  )
}

/* Makes the ~flat portfolio legible: the +0.9% aggregate looks wrong next to
   763 below-entry vs 496 in-profit, but it's correct — losses cap at -1× per
   $1k stake while winners run 8×, so a few verticals offset the many duds.
   Winners gain · losers loss · net, with avg ROIs as a quiet second line. */
function PortfolioBreakdown({ summary, t }) {
  const gain = Number(summary?.gain_usd)
  const loss = Number(summary?.loss_usd)
  const net = Number(summary?.net_usd)
  const avgWin = Number(summary?.avg_winner_roi)
  const avgLoss = Number(summary?.avg_loser_roi)
  if (!Number.isFinite(gain) && !Number.isFinite(loss) && !Number.isFinite(net)) return null

  const gainText = Number.isFinite(gain) ? `+${fmtUsd(Math.abs(gain)) || '$0'}` : null
  const lossText = Number.isFinite(loss) ? `−${fmtUsd(Math.abs(loss)) || '$0'}` : null
  const netText = Number.isFinite(net) ? `${net >= 0 ? '+' : '−'}${fmtUsd(Math.abs(net)) || '$0'}` : null

  return (
    <div className="xd-tr-pnl">
      <span className="xd-tr-pnl__line">
        {gainText && (
          <span className="xd-tr-pnl__seg">
            <span className="xd-tr-pnl__seg-label">{t('xDash.trackRecord.pnl.winners', 'Winners')}</span>
            <span className="xd-tr-pnl__seg-val xd-num xd-tr-pnl__seg-val--bull">{gainText}</span>
          </span>
        )}
        {lossText && (
          <>
            <span className="xd-tr-pnl__dot" aria-hidden="true">·</span>
            <span className="xd-tr-pnl__seg">
              <span className="xd-tr-pnl__seg-label">{t('xDash.trackRecord.pnl.losers', 'Losers')}</span>
              <span className="xd-tr-pnl__seg-val xd-num xd-tr-pnl__seg-val--bear">{lossText}</span>
            </span>
          </>
        )}
        {netText && (
          <>
            <span className="xd-tr-pnl__dot" aria-hidden="true">·</span>
            <span className="xd-tr-pnl__seg">
              <span className="xd-tr-pnl__seg-label">{t('xDash.trackRecord.pnl.net', 'Net')}</span>
              <span className="xd-tr-pnl__seg-val xd-num xd-tr-pnl__seg-val--net">{netText}</span>
            </span>
          </>
        )}
      </span>
      {(Number.isFinite(avgWin) || Number.isFinite(avgLoss)) && (
        <span className="xd-tr-pnl__avg xd-num">
          {Number.isFinite(avgWin) && t('xDash.trackRecord.pnl.avgWin', 'avg winner {{pct}}', { pct: fmtPct(avgWin) })}
          {Number.isFinite(avgWin) && Number.isFinite(avgLoss) && ' · '}
          {Number.isFinite(avgLoss) && t('xDash.trackRecord.pnl.avgLoss', 'avg loser {{pct}}', { pct: fmtPct(avgLoss) })}
        </span>
      )}
    </div>
  )
}

/* ============================================================
   SECTION 3 — DISTRIBUTION BAND (derived client-side from calls)
   ============================================================ */
const DIST_BINS = 24
const DIST_MIN = -100
const DIST_MAX = 700

/* The endpoint now ships the AUTHORITATIVE full-ledger distribution (not the
   page sample): a 24-int ROI histogram over [-100%, +700%] plus the true tier
   totals (below / flat / mid / high). We only do presentation here — log-scale
   the server bin counts (same normalization the old client-derived builder
   used) so the dense near-zero cluster doesn't bury the tail, and tag each bar
   with its monochrome luminance tone by position relative to the 0% line. */
function buildBinsFromSummary(distribution) {
  const raw = Array.isArray(distribution?.bins) ? distribution.bins : []
  const bins = new Array(DIST_BINS).fill(0)
  for (let i = 0; i < DIST_BINS; i += 1) {
    const n = Number(raw[i])
    bins[i] = Number.isFinite(n) ? n : 0
  }
  const span = DIST_MAX - DIST_MIN
  // log-scale heights so the dense near-zero cluster doesn't bury the tail
  const logged = bins.map((n) => Math.log(n + 1))
  const maxLog = Math.max(...logged, 0.0001)
  const zeroIdx = Math.floor(((0 - DIST_MIN) / span) * DIST_BINS)
  return {
    bins: bins.map((count, i) => ({
      count,
      idx: i,
      h: logged[i] / maxLog,
      // bar tone: left of the 0% line = loss (dimmer), right = profit (brighter)
      tone: i < zeroIdx ? 'bear' : 'bull',
    })),
    zeroIdx,
  }
}

/* does a histogram bar fall inside the active filter's slice?
   - bars left of the entry line are the "below entry" (down/bear) slice
   - bars right are bucketed by their ROI band (flat 0–100, mid 100–400, 5×+ ≥400)
   the bar's ROI band is its center value across the [DIST_MIN, DIST_MAX] axis. */
function isBarActive(bar, filter) {
  if (!filter) return true
  const span = DIST_MAX - DIST_MIN
  const roi = DIST_MIN + ((bar.idx + 0.5) / DIST_BINS) * span // bar center ROI%
  // status takes precedence: 'down' = below entry, 'moon' = the 5×+ tail
  if (filter.status === 'down') return roi < 0
  if (filter.status === 'moon') return roi >= 400
  // min/cap define an explicit ROI band (flat 0–100, mid ≥100)
  const min = Number.isFinite(filter.minRoi) ? filter.minRoi : null
  const cap = Number.isFinite(filter.capRoi) ? filter.capRoi : null
  if (min != null || cap != null) {
    if (min != null && roi < min) return false
    if (cap != null && roi >= cap) return false
    return true
  }
  return true // no slice → everything is "active"
}

/* is any tier slice currently applied? (status set OR an ROI band set) */
function hasActiveSlice(filter) {
  return Boolean(filter && (filter.status || Number.isFinite(filter.minRoi) || Number.isFinite(filter.capRoi)))
}

/* does a tier chip's filter match the currently-applied filter signature? */
function tierIsActive(tierFilter, applied) {
  const ts = tierFilter.status ?? ''
  const tm = Number.isFinite(tierFilter.minRoi) ? tierFilter.minRoi : null
  const tc = Number.isFinite(tierFilter.capRoi) ? tierFilter.capRoi : null
  const as = applied?.status ?? ''
  const am = Number.isFinite(applied?.minRoi) ? applied.minRoi : null
  const ac = Number.isFinite(applied?.capRoi) ? applied.capRoi : null
  return ts === as && tm === am && tc === ac
}

function DistributionBand({ summary, activeFilter, onTier, t }) {
  const reduced = prefersReducedMotion()
  const distribution = summary?.distribution
  const dist = useMemo(() => buildBinsFromSummary(distribution), [distribution])
  const [drawn, setDrawn] = useState(reduced)
  const sliceActive = hasActiveSlice(activeFilter)

  useEffect(() => {
    if (reduced) { setDrawn(true); return undefined }
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  // TRUE full-ledger tier totals straight from the endpoint (not the sample) —
  // this is what makes the band honest: BELOW ENTRY shows the real 763, etc.
  const below = Number(distribution?.below) || 0
  const flat = Number(distribution?.flat) || 0 // 1×–2×
  const mid = Number(distribution?.mid) || 0 // 2×–5×
  const high = Number(distribution?.high) || 0 // 5×+

  // tier chips double as the status/min_roi filter
  const tiers = [
    { key: 'down', label: t('xDash.trackRecord.dist.belowEntry', 'BELOW ENTRY'), count: below, tone: 'bear', filter: { status: 'down' } },
    { key: 'flat', label: t('xDash.trackRecord.dist.flat', 'FLAT 0–2×'), count: flat, tone: 'tertiary', filter: { status: '', minRoi: 0, capRoi: 100 } },
    { key: 'mid', label: t('xDash.trackRecord.dist.mid', '2–5×'), count: mid, tone: 'bull-muted', filter: { minRoi: 100 } },
    { key: 'high', label: t('xDash.trackRecord.dist.high', '5×+'), count: high, tone: 'bull', filter: { status: 'moon' } },
  ]

  return (
    <section className="xd-tr-dist">
      <div className="xd-tr-dist__head">
        <span className="xd-tr-dist__eyebrow">{t('xDash.trackRecord.dist.title', 'OUTCOME DISTRIBUTION')}</span>
        <span className="xd-tr-dist__rule" aria-hidden="true" />
        <span className="xd-tr-dist__caption">
          {t('xDash.trackRecord.dist.caption', 'every call, marked to market')}
        </span>
      </div>

      <div className="xd-tr-dist__bars" role="img" aria-label={t('xDash.trackRecord.dist.aria', 'ROI distribution histogram')}>
        {dist.bins.map((b) => {
          const dim = sliceActive ? !isBarActive(b, activeFilter) : false
          return (
            <span
              key={b.idx}
              className={`xd-tr-dist__bar xd-tr-dist__bar--${b.tone}${dim ? ' is-dim' : ''}`}
              style={{
                height: drawn ? `${Math.max(2, b.h * 100)}%` : '0%',
                transitionDelay: `${b.idx * 8}ms`,
              }}
              title={`${b.count}`}
            />
          )
        })}
        <span className="xd-tr-dist__zero" style={{ left: `${(dist.zeroIdx / DIST_BINS) * 100}%` }} aria-hidden="true">
          <span className="xd-tr-dist__zero-tick">{t('xDash.trackRecord.dist.entry', 'entry')}</span>
        </span>
      </div>

      <div className="xd-tr-dist__axis">
        {['-100%', '0%', '+100%', '+300%', '+500%', '+700%'].map((tick, i) => (
          <span className="xd-tr-dist__tick xd-num" key={i}>{tick}</span>
        ))}
      </div>

      <div className="xd-tr-dist__tiers">
        {tiers.map((tier) => {
          const active = tierIsActive(tier.filter, activeFilter)
          return (
            <button
              type="button"
              key={tier.key}
              className={`xd-tr-dist__tier xd-tr-dist__tier--${tier.tone}${active ? ' is-active' : ''}`}
              onClick={() => onTier(tier.filter)}
            >
              <span className="xd-tr-dist__tier-label">{tier.label}</span>
              <span className="xd-tr-dist__tier-count xd-num">{tier.count.toLocaleString('en-US')}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ============================================================
   SECTION 4 — HALL OF FAME
   ============================================================ */
/* tiny entry→peak→now provenance arc (rises to peak, settles to now). */
function ProvenanceArc({ peakMult, nowMult, tone, draw }) {
  const W = 120
  const H = 40
  const P = 4
  const peak = Math.max(1, Number(peakMult) || 1)
  const now = Math.max(0, Number(nowMult) || 0)
  const maxV = Math.max(peak, now, 1)
  const y = (v) => P + (1 - v / maxV) * (H - 2 * P)
  // entry(0) -> peak(~0.6) -> now(1)
  const xs = [P, P + 0.58 * (W - 2 * P), W - P]
  const ys = [y(1), y(peak), y(now)]
  const path = `M ${xs[0]} ${ys[0]} Q ${(xs[0] + xs[1]) / 2} ${ys[1] - 2} ${xs[1]} ${ys[1]} T ${xs[2]} ${ys[2]}`
  const len = 220
  return (
    <svg className={`xd-tr-hof-card__arc xd-tr-hof-card__arc--${tone}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path
        className="xd-tr-hof-card__arc-line"
        d={path}
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        style={{ strokeDasharray: len, strokeDashoffset: draw ? 0 : len }}
      />
      <circle className="xd-tr-hof-card__arc-peak" cx={xs[1]} cy={ys[1]} r="2" />
      <circle className="xd-tr-hof-card__arc-now" cx={xs[2]} cy={ys[2]} r="2.6" />
    </svg>
  )
}

function StayBar({ value }) {
  const v = Number(value)
  const filled = Number.isFinite(v) ? Math.round((Math.max(0, Math.min(100, v)) / 100) * 4) : null
  if (filled == null) return <span className="xd-tr-stay xd-tr-stay--empty">—</span>
  return (
    <span className="xd-tr-stay" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`xd-tr-stay__seg${i < filled ? ' is-on' : ''}`} />
      ))}
    </span>
  )
}

function HofCard({ call, ordinal, onOpenToken, t }) {
  const reduced = prefersReducedMotion()
  const [draw, setDraw] = useState(reduced)
  const roi = Number(call?.roi_pct)
  const animatedRoi = useCountUp(roi, { run: !reduced })
  const tone = statusTone(call?.status)
  const peakRoi = Number(call?.peak_roi_pct)
  const id = call?.coingecko_id || call?.asset

  useEffect(() => {
    if (reduced) { setDraw(true); return undefined }
    const id2 = requestAnimationFrame(() => setDraw(true))
    return () => cancelAnimationFrame(id2)
  }, [reduced])

  const kicker = ordinal === 1
    ? t('xDash.trackRecord.hof.best', 'BEST CALL')
    : ordinal === 2
      ? t('xDash.trackRecord.hof.second', 'CALL')
      : t('xDash.trackRecord.hof.third', 'CALL')
  const numeral = `${ordinal}`

  return (
    <button
      type="button"
      className={`glass-card xd-tr-hof-card xd-tr-hof-card--${tone}${ordinal === 1 ? ' xd-tr-hof-card--lead' : ''} animate-fade-up stagger-${ordinal}`}
      onClick={() => id && onOpenToken(id)}
    >
      <div className="xd-tr-hof-card__kicker">
        <span className="xd-tr-hof-card__numeral xd-num">{numeral}</span>
        <span className="xd-tr-hof-card__kicker-label">{kicker}</span>
      </div>

      <div className="xd-tr-hof-card__id">
        <Avatar src={call?.image || call?.image_small} alt={call?.symbol} size={44} />
        <span className="xd-tr-hof-card__id-text">
          <span className="xd-tr-hof-card__cashtag xd-num">${call?.symbol}</span>
          <span className="xd-tr-hof-card__name">{call?.name}</span>
        </span>
      </div>

      <div className="xd-tr-hof-card__roi-row">
        <div className="xd-tr-hof-card__roi-block">
          <span className="xd-tr-hof-card__roi xd-num">{fmtPct(reduced ? roi : animatedRoi)}</span>
          <span className="xd-tr-hof-card__roi-label">{t('xDash.trackRecord.hof.liveRoi', 'live ROI')}</span>
        </div>
        <span className="xd-tr-hof-card__mult xd-num">{fmtMult(call?.multiple)}</span>
      </div>

      <div className="xd-tr-hof-card__prov">
        <ProvenanceArc peakMult={call?.peak_multiple} nowMult={call?.multiple} tone={tone} draw={draw} />
        <span className="xd-tr-hof-card__prov-line xd-num">
          {t('xDash.trackRecord.hof.entry', 'entry')} {fmtUsd(call?.entry_market_cap) || '—'}
          <span className="xd-tr-hof-card__prov-arrow" aria-hidden="true"> → </span>
          {fmtUsd(call?.last_market_cap) || '—'}
        </span>
      </div>

      <div className="xd-tr-hof-card__chips">
        <span className="xd-tr-hof-card__chip xd-tr-hof-card__chip--peak xd-num">
          {t('xDash.trackRecord.hof.peak', 'peak')} {fmtPct(peakRoi)}
        </span>
        <span className="xd-tr-hof-card__chip xd-num">{call?.days_tracked}{t('xDash.trackRecord.dayShort', 'd')}</span>
        <span className="xd-tr-hof-card__chip xd-tr-hof-card__chip--stay">
          <StayBar value={call?.staying_power} />
          <span className="xd-num">{t('xDash.trackRecord.hof.stay', 'stay {{n}}', { n: Math.round(Number(call?.staying_power) || 0) })}</span>
        </span>
        {Boolean(call?.gave_back) && (
          <span className="xd-tr-hof-card__chip xd-tr-hof-card__chip--gaveback">
            {t('xDash.trackRecord.gaveBack', 'gave back from peak')}
          </span>
        )}
      </div>
    </button>
  )
}

/* The Hall of Fame is the TRUE all-time top-3 by ROI over the FULL ledger,
   served on `data.hall_of_fame` from the stable summary fetch. It must NOT be
   re-derived from the sorted/filtered tape `calls` — doing that surfaced the
   "least-bad losers" ($SODA/$ROUTER/$NEXI at +0%) as "BEST CALL" whenever the
   tape was switched to DOWN/WORST. We still defensively sort the 3 by ROI in
   case the backend order ever drifts. */
function HallOfFame({ hallOfFame, onOpenToken, t }) {
  const top3 = useMemo(() => {
    return [...(hallOfFame || [])]
      .filter((c) => Number.isFinite(Number(c?.roi_pct)))
      .sort((a, b) => Number(b.roi_pct) - Number(a.roi_pct))
      .slice(0, 3)
  }, [hallOfFame])
  if (top3.length === 0) return null
  return (
    <section className="xd-tr-hof">
      <div className="xd-tr-section-label">{t('xDash.trackRecord.hof.label', 'BIGGEST CALLS')}</div>
      <div className="xd-tr-hof__grid">
        {top3.map((c, i) => (
          <HofCard key={c.coingecko_id || c.asset || i} call={c} ordinal={i + 1} onOpenToken={onOpenToken} t={t} />
        ))}
      </div>
    </section>
  )
}

/* ============================================================
   SECTION 5 — THE TAPE
   ============================================================ */
/* CALLERS column — the faces behind the call. Overlapping stack of the top
   3–4 KOLs who surfaced the token socially, +N for the rest. Real provenance:
   these are the screen_names/avatars from the social ledger (pbs.twimg.com),
   not a synthetic shape. The Avatar atom carries a letter fallback for missing
   / broken images, so a dead pbs URL degrades to a quiet initial chip.

   Perf: at most 6 lazy <img> + a tiny chip per row; offscreen rows never paint
   (the row-wrap uses content-visibility:auto), so the 400-row DOM stays cheap.
   Whole cell carries one global tooltip listing the @handles. */
const CALLERS_SHOWN = 6

function RowCallers({ kols }) {
  const list = Array.isArray(kols) ? kols.filter((k) => k && (k.screen_name || k.name || k.avatar)) : []
  if (list.length === 0) return <span className="xd-tr-row__callers xd-tr-row__callers--empty" aria-hidden="true" />
  const shown = list.slice(0, CALLERS_SHOWN)
  const extra = list.length - shown.length
  const handles = list
    .map((k) => (k.screen_name ? `@${k.screen_name}` : k.name))
    .filter(Boolean)
    .join('  ')
  return (
    <span className="xd-tr-row__callers" data-tooltip={handles || undefined} data-tooltip-pos="top">
      <span className="xd-tr-row__callers-stack">
        {shown.map((k, i) => (
          <span
            key={k.screen_name || k.avatar || i}
            className="xd-tr-row__callers-slot"
            style={{ zIndex: shown.length - i }}
          >
            <Avatar src={k.avatar} alt={k.screen_name || k.name} size={24} />
          </span>
        ))}
      </span>
      {extra > 0 && <span className="xd-tr-row__callers-more xd-num">+{extra}</span>}
    </span>
  )
}

function TapeRow({ call, onOpenToken, t, isOn, colStyle }) {
  const roi = Number(call?.roi_pct)
  const positive = roi >= 0
  // magnitude "heat" — the bigger the move, the more the ROI value glows. Calm
  // rows stay quiet; the verticals pop. Color lives on the data, not on chrome.
  const mag = Math.abs(Number.isFinite(roi) ? roi : 0)
  const heat = mag >= 700 ? 3 : mag >= 200 ? 2 : mag >= 40 ? 1 : 0
  const tone = statusTone(call?.status)
  const id = call?.coingecko_id || call?.asset
  const dead = Boolean(call?.dead)
  const isRug = dead && call?.dead_kind === 'rug'
  // UNDERWATER: deep loss but still actively tracked — alive, not a corpse.
  const underwater = !dead && Boolean(call?.underwater)
  // DCA is the more actionable signal — it supersedes the gave-back chip on a row.
  const dca = !dead && !underwater && Boolean(call?.dca)
  const showMeta = isOn('peak') || isOn('spotted') || isOn('stay')
  return (
    <button
      type="button"
      className={`xd-tr-row xd-tr-row--${tone}${dead ? ' xd-tr-row--dead' : ''}`}
      style={colStyle}
      onClick={() => id && onOpenToken(id)}
    >
      <span className="xd-tr-row__rank xd-num">{call?.rank}</span>
      <span className="xd-tr-row__token">
        <Avatar src={call?.image_small || call?.image} alt={call?.symbol} size={38} />
        <span className="xd-tr-row__token-text">
          <span className="xd-tr-row__cashtag-row">
            <span className="xd-tr-row__cashtag xd-num">${call?.symbol}</span>
            {dead && (
              <span className="xd-tr-tag xd-tr-tag--dead">
                {isRug ? t('xDash.trackRecord.tag.rug', 'RUG') : t('xDash.trackRecord.tag.dead', 'DEAD')}
              </span>
            )}
            {underwater && (
              <span
                className="xd-tr-tag xd-tr-tag--underwater"
                data-tooltip={t('xDash.trackRecord.tag.underwaterTip', 'Down hard from entry, but still actively tracked — bagholders alive, revival not ruled out.')}
              >
                {t('xDash.trackRecord.tag.underwater', 'UNDERWATER')}
              </span>
            )}
            {dca && (
              <span
                className="xd-tr-tag xd-tr-tag--dca"
                data-tooltip={t('xDash.trackRecord.tag.dcaTip', 'Ran, pulled back, still durably tracked — accumulation zone.')}
              >
                {t('xDash.trackRecord.tag.dca', 'DCA')}
              </span>
            )}
          </span>
          <span className="xd-tr-row__name">{call?.name}</span>
        </span>
      </span>
      {isOn('callers') && (
        <span className="xd-tr-row__callers-cell">
          <RowCallers kols={call?.kols} />
        </span>
      )}
      {(isOn('entry') || isOn('now')) && (
        <span className="xd-tr-row__flow">
          {isOn('entry') && (
            <span className="xd-tr-row__entry xd-num" data-tooltip={call?.entry_date ? relativeTime(call.entry_date, t) : undefined}>
              {fmtUsd(call?.entry_market_cap) || '—'}
            </span>
          )}
          {isOn('entry') && isOn('now') && <span className="xd-tr-row__arrow" aria-hidden="true">→</span>}
          {isOn('now') && <span className="xd-tr-row__now xd-num">{fmtUsd(call?.last_market_cap) || '—'}</span>}
        </span>
      )}
      {isOn('roi') && (
        <span className={`xd-tr-row__roi xd-num xd-tr-row__roi--${positive ? 'bull' : 'bear'} xd-tr-row__roi--h${heat}`}>
          {fmtPct(roi)}
        </span>
      )}
      {showMeta && (
        <span className="xd-tr-row__meta">
          {isOn('peak') && (
            <span className="xd-tr-row__peak">
              <span className="xd-tr-row__peak-roi xd-num">
                {fmtPct(call?.peak_roi_pct)}
                {!dca && Boolean(call?.gave_back) && <span className="xd-tr-row__gaveback" aria-hidden="true" title={t('xDash.trackRecord.gaveBack', 'gave back from peak')}>⤓</span>}
              </span>
              <span className="xd-tr-row__peak-sep" aria-hidden="true">·</span>
              <span className="xd-tr-row__peak-mcap xd-num">{fmtUsd(call?.peak_market_cap) || '—'}</span>
            </span>
          )}
          {isOn('spotted') && (
            <span className="xd-tr-row__spotted xd-num">
              {shortDate(call?.entry_date)}
              <span className="xd-tr-row__days"> · {call?.days_tracked}{t('xDash.trackRecord.dayShort', 'd')}</span>
            </span>
          )}
          {isOn('stay') && <span className="xd-tr-row__stay"><StayBar value={call?.staying_power} /></span>}
        </span>
      )}
      <span className="xd-tr-row__chev" aria-hidden="true">›</span>
    </button>
  )
}

const SORTS = [
  { key: 'roi', i18n: 'xDash.trackRecord.sort.roi', fallback: 'ROI' },
  { key: 'peak', i18n: 'xDash.trackRecord.sort.peak', fallback: 'Peak' },
  { key: 'recent', i18n: 'xDash.trackRecord.sort.recent', fallback: 'Recent' },
  { key: 'worst', i18n: 'xDash.trackRecord.sort.worst', fallback: 'Worst' },
  { key: 'mcap', i18n: 'xDash.trackRecord.sort.mcap', fallback: 'Mcap' },
]
const STATUSES = [
  { key: '', i18n: 'xDash.trackRecord.status.all', fallback: 'All' },
  { key: 'up', i18n: 'xDash.trackRecord.status.up', fallback: 'Up' },
  { key: 'down', i18n: 'xDash.trackRecord.status.down', fallback: 'Down' },
  { key: 'moon', i18n: 'xDash.trackRecord.status.moon', fallback: 'Moon' },
]

/* Column model for THE TAPE. rank·token·roi·chevron are structural (always on);
   the rest are user-toggleable via the Columns chooser and persisted. Each
   column contributes its grid track(s); the header + rows rebuild the same
   `--xd-tr-cols` template from the visible set. 'flow' = entry → now (3 tracks).
   The chooser is desktop-only — mobile media queries own the row layout. */
const TAPE_COLUMNS = [
  { key: 'rank', track: '44px', always: true },
  { key: 'token', track: 'minmax(150px, 1.6fr)', always: true },
  { key: 'callers', track: 'minmax(132px, 1.5fr)', i18n: 'xDash.trackRecord.col.callers', label: 'Callers' },
  { key: 'entry', track: 'minmax(96px, 1fr)', i18n: 'xDash.trackRecord.col.entry', label: 'Entry (mcap)' },
  { key: 'now', track: 'minmax(96px, 1fr)', i18n: 'xDash.trackRecord.col.now', label: 'Now (mcap)' },
  { key: 'roi', track: 'minmax(92px, 1fr)', i18n: 'xDash.trackRecord.col.roi', label: 'ROI' },
  { key: 'peak', track: 'minmax(140px, 1.5fr)', i18n: 'xDash.trackRecord.col.peak', label: 'Peak' },
  { key: 'spotted', track: 'minmax(84px, 1fr)', i18n: 'xDash.trackRecord.col.spotted', label: 'Spotted' },
  { key: 'stay', track: '64px', i18n: 'xDash.trackRecord.col.stay', label: 'Stay' },
  { key: 'chev', track: '20px', always: true },
]
const TAPE_TOGGLE_COLUMNS = TAPE_COLUMNS.filter((c) => !c.always)
const COLS_STORAGE_KEY = 'spectre-xdtr-cols-v1'

/* grid-template from the visible set. A 16px arrow-connector track sits between
   Entry and Now only when BOTH are shown (the → glyph that links entry → now). */
function buildColTemplate(hidden) {
  const parts = []
  for (const c of TAPE_COLUMNS) {
    if (!c.always && hidden.has(c.key)) continue
    parts.push(c.track)
    if (c.key === 'entry' && !hidden.has('now')) parts.push('16px')
  }
  return parts.join(' ')
}

function loadHiddenCols() {
  if (typeof window === 'undefined') return new Set()
  try {
    const arr = JSON.parse(window.localStorage.getItem(COLS_STORAGE_KEY) || '[]')
    return new Set(Array.isArray(arr) ? arr.filter((k) => TAPE_TOGGLE_COLUMNS.some((c) => c.key === k)) : [])
  } catch { return new Set() }
}
function saveHiddenCols(set) {
  try { window.localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...set])) } catch { /* quota / private mode */ }
}

/* Columns chooser dropdown — glass panel with a checkable row per toggleable
   column. Closes on outside-click / Escape. */
function ColumnMenu({ hidden, onToggle, t }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="xd-tr-colmenu" ref={ref}>
      <button
        type="button"
        className={`xd-tr-colmenu__btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <line x1="6.4" y1="2.5" x2="6.4" y2="13.5" />
          <line x1="10" y1="2.5" x2="10" y2="13.5" />
        </svg>
        {t('xDash.trackRecord.tape.columns', 'Columns')}
      </button>
      {open && (
        <div className="xd-tr-colmenu__panel" role="menu">
          <span className="xd-tr-colmenu__title">{t('xDash.trackRecord.tape.columnsTitle', 'Show columns')}</span>
          {TAPE_TOGGLE_COLUMNS.map((c) => {
            const on = !hidden.has(c.key)
            return (
              <button
                key={c.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className={`xd-tr-colmenu__item${on ? ' is-on' : ''}`}
                onClick={() => onToggle(c.key)}
              >
                <span className="xd-tr-colmenu__check" aria-hidden="true">
                  {on && (
                    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2.4 6.3l2.2 2.3 5-5.2" /></svg>
                  )}
                </span>
                {t(c.i18n, c.label)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Tape({
  calls, shown, total, sort, status, onSort, onStatus, graveyard, onGraveyard, deadCount, refetching, onOpenToken, onReset, t,
}) {
  const [hiddenCols, setHiddenCols] = useState(loadHiddenCols)
  const isOn = (key) => !hiddenCols.has(key)
  const toggleCol = (key) => setHiddenCols((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    saveHiddenCols(next)
    return next
  })
  // rebuild the grid template from the visible columns → both header + rows read
  // it via the --xd-tr-cols custom property (desktop only; mobile CSS overrides).
  const gridTemplate = useMemo(() => buildColTemplate(hiddenCols), [hiddenCols])
  const colStyle = { '--xd-tr-cols': gridTemplate }

  return (
    <section className="xd-tr-tape">
      <div className="xd-tr-tape-toolbar">
        <span className="xd-tr-section-label xd-tr-tape-toolbar__title">{t('xDash.trackRecord.tape.title', 'THE TAPE')}</span>
        <span className="xd-tr-tape-toolbar__count xd-num">
          {t('xDash.trackRecord.tape.count', '{{shown}} of {{total}} calls', {
            shown: shown.toLocaleString('en-US'),
            total: total.toLocaleString('en-US'),
          })}
        </span>
        <span className="xd-tr-tape-toolbar__spacer" />
        <div className="xd-toggle xd-tr-tape-toolbar__sorts">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`xd-toggle__btn${sort === s.key ? ' xd-toggle__btn--active' : ''}`}
              onClick={() => onSort(s.key)}
            >
              {t(s.i18n, s.fallback)}
            </button>
          ))}
        </div>
        <div className="xd-toggle xd-tr-tape-toolbar__statuses">
          {STATUSES.map((s) => (
            <button
              key={s.key || 'all'}
              type="button"
              className={`xd-toggle__btn${status === s.key && !graveyard ? ' xd-toggle__btn--active' : ''}`}
              onClick={() => onStatus(s.key)}
            >
              {t(s.i18n, s.fallback)}
            </button>
          ))}
          <button
            type="button"
            className={`xd-toggle__btn xd-tr-tape-toolbar__graveyard${graveyard ? ' xd-toggle__btn--active' : ''}`}
            onClick={onGraveyard}
            data-tooltip={t('xDash.trackRecord.tape.graveyardTip', 'Dead and rugged calls are kept out of the tape by default — every count above still includes them. Toggle to inspect the graveyard.')}
          >
            {t('xDash.trackRecord.tape.graveyard', 'Graveyard ({{n}})', { n: deadCount.toLocaleString('en-US') })}
          </button>
        </div>
        <ColumnMenu hidden={hiddenCols} onToggle={toggleCol} t={t} />
      </div>

      <div className="xd-tr-tape__head" style={colStyle} aria-hidden="true">
        <span>{t('xDash.trackRecord.col.rank', '#')}</span>
        <span>{t('xDash.trackRecord.col.token', 'Token')}</span>
        {isOn('callers') && <span className="xd-tr-tape__head--c">{t('xDash.trackRecord.col.callers', 'CALLERS')}</span>}
        {isOn('entry') && <span className="xd-tr-tape__head--r">{t('xDash.trackRecord.col.entry', 'Entry')}</span>}
        {isOn('entry') && isOn('now') && <span />}
        {isOn('now') && <span className="xd-tr-tape__head--r">{t('xDash.trackRecord.col.now', 'Now')}</span>}
        {isOn('roi') && <span className="xd-tr-tape__head--r">{t('xDash.trackRecord.col.roi', 'ROI')}</span>}
        {isOn('peak') && <span className="xd-tr-tape__head--r">{t('xDash.trackRecord.col.peak', 'Peak')}</span>}
        {isOn('spotted') && <span className="xd-tr-tape__head--r">{t('xDash.trackRecord.col.spotted', 'Spotted')}</span>}
        {isOn('stay') && <span className="xd-tr-tape__head--c">{t('xDash.trackRecord.col.stay', 'Stay')}</span>}
        <span />
      </div>

      <div className="xd-tr-tape__body">
        {refetching ? (
          <Shimmer variant="row" count={12} />
        ) : calls.length === 0 ? (
          <EmptyState
            title={t('xDash.trackRecord.empty.bucketTitle', 'No calls in this bucket')}
            detail={t('xDash.trackRecord.empty.bucketDetail', 'Switch to All to see the full ledger.')}
            action={(
              <button type="button" className="xd-btn xd-btn--secondary xd-btn--sm" onClick={onReset}>
                {t('xDash.trackRecord.empty.reset', 'Reset')}
              </button>
            )}
          />
        ) : (
          calls.map((c, i) => (
            <div
              className={`xd-tr-row-wrap${i < 20 ? ` animate-fade-up` : ''}`}
              style={i < 20 ? { animationDelay: `${i * 24}ms` } : undefined}
              key={c.coingecko_id || c.asset || i}
            >
              <TapeRow call={c} onOpenToken={onOpenToken} t={t} isOn={isOn} colStyle={colStyle} />
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/* ============================================================
   SECTION 6 — THE HONEST LINE
   ============================================================ */
function Footnote({ summary, meta, t }) {
  const stake = Number(summary?.stake_per_call) || STAKE_FALLBACK
  const calls = Number(summary?.calls) || TOTAL_CALLS_FALLBACK
  return (
    <footer className="xd-tr-footnote">
      <p className="xd-tr-footnote__quote">
        {t('xDash.trackRecord.footnote.quote', 'Most calls go nowhere. A few go vertical. The median call is roughly flat — and we show it on purpose.')}
      </p>
      <div className="xd-tr-footnote__facts">
        <span className="xd-tr-footnote__fact">{t('xDash.trackRecord.footnote.stake', 'stake')} <b className="xd-num">${stake.toLocaleString('en-US')}</b> {t('xDash.trackRecord.footnote.perCall', '/ call')}</span>
        <span className="xd-tr-footnote__fact">{meta?.note || t('xDash.trackRecord.footnote.note', 'marked to last tracked price')}</span>
        <span className="xd-tr-footnote__fact">{t('xDash.trackRecord.footnote.n', 'n =')} <b className="xd-num">{calls.toLocaleString('en-US')}</b></span>
      </div>
    </footer>
  )
}

/* ============================================================
   LOADING SHELL — three-tier shimmer matching the final shape
   ============================================================ */
function LoadingShell({ t }) {
  return (
    <div className="xd-track-record xd-track-record--loading">
      <header className="xd-tr-masthead">
        <div className="xd-tr-masthead__glow" aria-hidden="true" />
        <div className="xd-tr-eyebrow">
          <span className="xd-tr-eyebrow__label">{t('xDash.trackRecord.eyebrow', 'TRACK RECORD')}</span>
          <span className="xd-tr-eyebrow__right">
            <span className="xd-tr-pulse" aria-hidden="true" />
            <span className="xd-tr-badge">Spectre AI</span>
          </span>
        </div>
        <h1 className="xd-tr-headline">{t('xDash.trackRecord.headline', 'Every call, marked to market.')}</h1>
        <p className="xd-tr-sub">
          {t('xDash.trackRecord.subLead', 'We log every token the moment we spot it socially — at its first-seen market cap — then mark it to the latest tape. No edits. ')}
          <span className="xd-tr-sub__admit">{t('xDash.trackRecord.subAdmit', 'Winners and losers.')}</span>
          {t('xDash.trackRecord.subTail', ' This is the receipt.')}
        </p>
        <div className="xd-tr-trio">
          {[0, 1, 2].map((i) => (
            <div className={`glass-card xd-tr-trio-card xd-tr-trio-card--shimmer stagger-${i + 1}`} key={i}>
              <div className="xd-tr-shimmer xd-tr-shimmer--xs animate-shimmer" />
              <div className="xd-tr-shimmer xd-tr-shimmer--lg animate-shimmer" />
              <div className="xd-tr-shimmer xd-tr-shimmer--sm animate-shimmer" />
            </div>
          ))}
        </div>
      </header>

      <div className="xd-tr-ribbon xd-tr-ribbon--shimmer">
        {Array.from({ length: 6 }).map((_, i) => (
          <span className="xd-tr-shimmer xd-tr-shimmer--pill animate-shimmer" key={i} />
        ))}
      </div>

      <section className="xd-tr-dist">
        <div className="xd-tr-dist__bars xd-tr-dist__bars--shimmer">
          {Array.from({ length: DIST_BINS }).map((_, i) => {
            // pre-baked log curve so it reads as a distribution loading
            const center = DIST_BINS * 0.42
            const h = Math.max(8, 90 * Math.exp(-Math.pow((i - center) / 4.5, 2)))
            return <span className="xd-tr-dist__bar xd-tr-dist__bar--shimmer animate-shimmer" style={{ height: `${h}%` }} key={i} />
          })}
        </div>
      </section>

      <section className="xd-tr-hof">
        <Shimmer variant="card" count={3} />
      </section>

      <section className="xd-tr-tape">
        <Shimmer variant="row" count={12} />
      </section>
    </div>
  )
}

/* ============================================================
   SECTION 2b — STRATEGY BAND
   ------------------------------------------------------------
   The receipt above is a backtest of ONE accidental strategy: "log every
   social mention, hold forever, never sell." That's the worst way to trade a
   fat-tailed signal — every runner gives it all back. This band shows the SAME
   calls under a real exit policy. The signal is the alpha; the exit is the
   strategy. Data from summary.strategy (data-api backtest over the full ledger).
   ============================================================ */
function StrategyBand({ summary, t }) {
  const st = summary?.strategy
  if (!st || !st.firehose) return null
  const fh = st.firehose || {}
  // The ENTRY filter is causal — entry market cap is the FIRST-SEEN cap (known
  // at entry). The EXIT is modeled at 30% off each call's whole-life peak (a
  // best-case trailing stop, not a fill). We deliberately do NOT
  // headline the old staying_power "conviction" number: staying_power is measured
  // over each token's whole life, so filtering past calls by it peeks at which
  // ones turned out to sustain — an inflated, non-tradeable figure.
  const cs = st.causal_smallcap && Number.isFinite(Number(st.causal_smallcap.trail_roi))
    ? st.causal_smallcap
    : { trail_roi: fh.trail_roi, n: fh.n } // fall back to all-calls trailing (also causal)
  const trailPct = Number(st.trail_pct) || 30
  const roi = (v) => (Number.isFinite(Number(v)) ? fmtPct(Number(v), 1) : '—')
  const roiTone = (v) => (Number(v) >= 0 ? 'bull' : 'bear')

  return (
    <section className="xd-tr-strat" aria-label={t('xDash.trackRecord.strat.aria', 'Strategy backtest')}>
      <div className="xd-tr-strat__head">
        <span className="xd-tr-strat__eyebrow">{t('xDash.trackRecord.strat.eyebrow', 'HOLD-FOREVER IS THE MISTAKE — THE EXIT IS THE STRATEGY')}</span>
        <span className="xd-tr-strat__lead">
          {t('xDash.trackRecord.strat.lead', 'Same calls, two ways to trade them')}
          <span className="xd-tr-strat__causal">{t('xDash.trackRecord.strat.causalTag', 'backtest · entry-time filter · exit modeled 30% off peak')}</span>
        </span>
      </div>
      <div className="xd-tr-strat__grid">
        {/* what the raw receipt above implies: buy the firehose, never sell */}
        <div className="xd-tr-strat__col xd-tr-strat__col--naive">
          <span className="xd-tr-strat__col-label">{t('xDash.trackRecord.strat.naiveLabel', 'Buy everything · hold forever')}</span>
          <span className={`xd-tr-strat__col-val xd-num xd-tr-strat__col-val--${roiTone(fh.hold_roi)}`}>{roi(fh.hold_roi)}</span>
          <span className="xd-tr-strat__col-sub">
            {t('xDash.trackRecord.strat.naiveSub', '{{n}} calls · marked to now · no exit', { n: (Number(fh.n) || 0).toLocaleString('en-US') })}
          </span>
        </div>
        <div className="xd-tr-strat__arrow" aria-hidden="true">→</div>
        {/* small caps (known at entry) + a real exit policy — fully causal */}
        <div className="xd-tr-strat__col xd-tr-strat__col--edge">
          <span className="xd-tr-strat__col-label">{t('xDash.trackRecord.strat.edgeLabel', 'Small caps · trailing exit')}</span>
          <span className={`xd-tr-strat__col-val xd-num xd-tr-strat__col-val--${roiTone(cs.trail_roi)}`}>{roi(cs.trail_roi)}</span>
          <span className="xd-tr-strat__col-sub">
            {t('xDash.trackRecord.strat.edgeSub2', '{{n}} calls · entry <$5M · exit modeled {{pct}}% off peak', {
              n: (Number(cs.n) || 0).toLocaleString('en-US'), pct: trailPct,
            })}
          </span>
          <span className="xd-tr-strat__col-tag">{t('xDash.trackRecord.strat.causalChip', 'entry-time filter')}</span>
        </div>
      </div>
      <p className="xd-tr-strat__foot">
        {t('xDash.trackRecord.strat.foot2', 'The entry filter uses entry-time features only — no future data picks the calls. The exit is modeled, not filled: 30% off each call’s whole-life peak, the best case for a trailing stop. Adding that exit discipline (never hold forever) and skipping the already-big caps flips the same calls from a loss to a real edge. An earlier cut that filtered by all-time attention read far higher, but that peeks at which tokens turned out to sustain — look-ahead bias — so we don’t count it. The live agent below is the honest forward test.')}
      </p>
    </section>
  )
}

/* ============================================================
   SECTION 2c — LIVE PAPER AGENT (the forward, non-backtest proof)
   ------------------------------------------------------------
   The Strategy band above is a backtest. THIS is Spectre's social-conviction
   agent trading the same policy FORWARD, in real time, in paper — so it eats
   the rugs a survivorship-biased backtest never sees. Reads the live equity
   from /api/xdash/paper-trader (data-api paper_traders). Renders nothing until
   the agent has a snapshot, so it's safe if the agent is paused.
   ============================================================ */
function EquitySpark({ series, up }) {
  const w = 132, h = 34
  if (!Array.isArray(series) || series.length < 2) return null
  const min = Math.min(...series), max = Math.max(...series)
  const span = (max - min) || 1
  const pts = series
    .map((v, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 3) - 1.5).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="xd-tr-live__spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? 'var(--bull-bright, #34D399)' : 'var(--bear, #EF4444)'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const LIVE_MIN_SAMPLE = 15 // closed trades before we publish a live return %

/* what happened to a pick — plain-English status + tone. */
function pickStatus(pos, t) {
  if (pos.status === 'open') return { label: t('xDash.trackRecord.pick.holding', 'holding'), tone: 'open' }
  const win = Number(pos.pnl_pct) >= 0
  const r = String(pos.close_reason || '')
  if (r === 'trailing_stop') return { label: t('xDash.trackRecord.pick.trailed', 'trailed out'), tone: win ? 'bull' : 'bear' }
  if (r === 'doa_stop') return { label: t('xDash.trackRecord.pick.doa', 'cut — flat'), tone: 'bear' }
  if (r === 'hard_stop') return { label: t('xDash.trackRecord.pick.stopped', 'stopped'), tone: 'bear' }
  if (r === 'time_stop') return { label: t('xDash.trackRecord.pick.timed', 'timed out'), tone: 'bear' }
  return { label: t('xDash.trackRecord.pick.closed', 'closed'), tone: win ? 'bull' : 'bear' }
}

/* one pick: token · entry mcap → current/exit mcap · ROI · entry→peak→now arc. */
function PickChip({ pos, t }) {
  const entry = Number(pos.entry_price)
  const isOpen = pos.status === 'open'
  const now = isOpen ? Number(pos.current_mcap) : Number(pos.exit_price || pos.current_mcap)
  const peak = Number(pos.peak_price || entry)
  const roi = entry > 0 && Number.isFinite(now) ? (now / entry - 1) * 100 : Number(pos.pnl_pct)
  const up = Number(roi) >= 0
  const sym = pos.symbol || pos.asset
  const st = pickStatus(pos, t)
  return (
    <div className={`xd-tr-pick xd-tr-pick--${isOpen ? 'open' : 'closed'}`}>
      <div className="xd-tr-pick__head">
        <Avatar src={pos.image_small} alt={sym} size={18} />
        <span className="xd-tr-pick__sym">{String(sym || '').toUpperCase()}</span>
        <span className={`xd-tr-pick__badge xd-tr-pick__badge--${st.tone}`}>{st.label}</span>
      </div>
      <div className="xd-tr-pick__mcap xd-num">
        {fmtUsd(entry) || '—'}<span className="xd-tr-pick__arrow" aria-hidden="true"> → </span>{fmtUsd(now) || '—'}
      </div>
      <div className="xd-tr-pick__foot">
        <span className={`xd-tr-pick__roi xd-num xd-tr-pick__roi--${up ? 'bull' : 'bear'}`}>{Number.isFinite(Number(roi)) ? fmtPct(roi, 0) : '—'}</span>
        <ProvenanceArc peakMult={entry > 0 ? peak / entry : 1} nowMult={entry > 0 && Number.isFinite(now) ? now / entry : 1} tone={up ? 'up' : 'down'} draw />
      </div>
    </div>
  )
}

/* one agent: header (name · strategy · equity · building/return) + its picks. */
function AgentCard({ agent, t }) {
  const trader = agent.trader
  const snap = agent.latest_snapshot
  if (!trader) return null
  const eqNow = Number(snap?.total_equity ?? trader.current_balance)
  const ret = Number(snap?.total_return_pct)
  const closed = (Number(trader.wins) || 0) + (Number(trader.losses) || 0)
  const hasSample = closed >= LIVE_MIN_SAMPLE
  const up = Number.isFinite(ret) ? ret >= 0 : eqNow >= Number(trader.starting_balance)
  const isBreadth = Boolean(trader.config?.min_authors)
  const strat = isBreadth
    ? t('xDash.trackRecord.agent.breadth', 'caller breadth')
    : t('xDash.trackRecord.agent.durability', 'durable attention')
  const opens = (Array.isArray(agent.open_positions) ? agent.open_positions : []).map((p) => ({ ...p, status: 'open' }))
  const closedTrades = (Array.isArray(agent.recent_trades) ? agent.recent_trades : []).filter((x) => x.status === 'closed').slice(0, 6)
  const picks = [...opens, ...closedTrades]
  return (
    <div className="xd-tr-agent">
      <div className="xd-tr-agent__head">
        <span className="xd-tr-live__dot" aria-hidden="true" />
        <span className="xd-tr-agent__name">{String(trader.name || '').replace(/_/g, ' ')}</span>
        <span className="xd-tr-agent__strat">{strat}</span>
        <span className="xd-tr-agent__eq xd-num">{fmtUsd(eqNow) || `$${Math.round(eqNow).toLocaleString('en-US')}`}</span>
        <span className="xd-tr-agent__meta">
          {hasSample
            ? <span className={`xd-num xd-tr-agent__ret xd-tr-agent__ret--${up ? 'bull' : 'bear'}`}>{fmtPct(ret, 1)}</span>
            : <span className="xd-tr-agent__building">{t('xDash.trackRecord.agent.building', 'building · {{c}}/{{m}}', { c: closed, m: LIVE_MIN_SAMPLE })}</span>}
          <span className="xd-tr-agent__sep"> · </span>
          {t('xDash.trackRecord.agent.meta', '{{n}} open · since {{d}}', { n: opens.length, d: shortDate(trader.started_at) })}
        </span>
      </div>
      {picks.length ? (
        <div className="xd-tr-agent__picks">
          {picks.map((p) => <PickChip key={p.id} pos={p} t={t} />)}
        </div>
      ) : (
        <div className="xd-tr-agent__empty">{t('xDash.trackRecord.agent.scanning', 'scanning for a pick…')}</div>
      )}
    </div>
  )
}

function LivePaperStrip({ t }) {
  const { data } = useXDashSurface('/api/xdash/paper-trader', LIVE_PAPER_PARAMS, { ttlMs: 60_000 })
  const d = data && typeof data === 'object' ? (data.data ?? null) : null
  const agents = (Array.isArray(d?.agents) ? d.agents : []).filter((a) => a && a.trader)
  if (!agents.length) return null

  return (
    <section className="xd-tr-live" aria-label={t('xDash.trackRecord.live.aria', 'Live paper agents')}>
      <div className="xd-tr-live__head">
        <span className="xd-tr-live__dot" aria-hidden="true" />
        <span className="xd-tr-live__eyebrow">{t('xDash.trackRecord.live.eyebrow3', 'SPECTRE IS TRADING THIS — LIVE PAPER · EVERY PICK SHOWN')}</span>
      </div>
      <div className="xd-tr-agents">
        {agents.map((a) => <AgentCard key={a.trader.id} agent={a} t={t} />)}
      </div>
      <p className="xd-tr-live__foot">
        {t('xDash.trackRecord.live.footAgents', 'Two agents trading the same signals live — one on durable attention, one on caller breadth. Every pick shown, entry cap to now, winners and losers. We publish a headline return once each has a real sample; a handful of trades isn’t a track record.')}
      </p>
    </section>
  )
}

/* ============================================================
   MAIN
   ============================================================ */
export default function XDTrackRecord({ onOpenToken }) {
  const { t } = useTranslation()
  const [sort, setSort] = useState('roi')
  const [status, setStatus] = useState('') // '' = All
  // client-side cap for the derived "FLAT 0–2×" tier (no server param for it)
  const [capRoi, setCapRoi] = useState(null)
  const [minRoi, setMinRoi] = useState(null)
  // dead/rugged rows are quarantined out of the default tape (no server param —
  // status is only up/down/moon). The toggle flips the tape to graveyard-only;
  // summary counts and the truth bar always include them.
  const [graveyard, setGraveyard] = useState(false)
  // population: the SIGNAL lane (calls that cleared the entry-time gate) is the
  // default story; the full radar firehose stays one tap away for honesty.
  const [pop, setPop] = useState('signals')

  const params = useMemo(() => ({
    sort,
    limit: DEFAULT_LIMIT,
    status: status || undefined,
    minRoi: minRoi ?? undefined,
    pop: pop === 'signals' ? 'signals' : undefined,
  }), [sort, status, minRoi, pop])

  const { ledger, meta, hallOfFame, loading, error, degraded, refetch } = useXDashTrackRecord(params)

  // keep the last good summary so masthead/ribbon/dist/HoF survive a degraded
  // or empty sorted refetch (they describe the FULL set, fetched once).
  const lastSummaryRef = useRef(null)
  if (ledger?.summary) lastSummaryRef.current = ledger.summary
  const summary = ledger?.summary || lastSummaryRef.current

  // the population-scoped summary every band renders from. Falls back to the
  // firehose when the signals block hasn't shipped (stale cache/older API).
  const sigAvailable = Boolean(summary?.signals?.calls)
  const view = pop === 'signals' && sigAvailable ? summary.signals : summary

  // Hall of Fame = true all-time top-3 over the FULL ledger. Cache the last good
  // one (same as summary) so it stays MANIFEST/KINS/HUNT and never flickers or
  // re-derives when the tape refetches on sort/status change.
  const lastHofRef = useRef(null)
  if (hallOfFame?.length) lastHofRef.current = hallOfFame
  const hof = hallOfFame?.length ? hallOfFame : lastHofRef.current

  const allCalls = useMemo(() => (Array.isArray(ledger?.calls) ? ledger.calls : []), [ledger])

  // client-side cap only for the FLAT tier (0 ≤ roi < 100%) + graveyard split.
  const tapeCalls = useMemo(() => {
    let rows = allCalls.filter((c) => (graveyard ? !!c?.dead : !c?.dead))
    if (capRoi != null) rows = rows.filter((c) => Number(c?.roi_pct) < capRoi)
    return rows
  }, [allCalls, capRoi, graveyard])

  const totalCalls = Number(view?.calls) || TOTAL_CALLS_FALLBACK

  const handleTier = (filter) => {
    setStatus(filter.status ?? '')
    setMinRoi(filter.minRoi ?? null)
    setCapRoi(filter.capRoi ?? null)
  }
  const handleSort = (next) => { setSort(next) }
  const handleStatus = (next) => { setStatus(next); setMinRoi(null); setCapRoi(null); setGraveyard(false) }
  const handleReset = () => { setStatus(''); setMinRoi(null); setCapRoi(null); setSort('roi'); setGraveyard(false) }

  // animate the masthead trio only on the very first successful render
  const animatedOnceRef = useRef(false)
  const firstReveal = !animatedOnceRef.current
  useEffect(() => { if (summary) animatedOnceRef.current = true }, [summary])

  // ── States ──
  if (loading && !ledger && !summary) return <LoadingShell t={t} />

  // genuine zero ledger
  if (summary && Number(summary.calls) === 0) {
    return (
      <div className="xd-track-record">
        <EmptyState
          title={t('xDash.trackRecord.empty.title', 'No calls logged yet')}
          detail={t('xDash.trackRecord.empty.detail', "Spectre logs each token at the market cap it's first spotted. The tape fills as calls accrue.")}
        />
      </div>
    )
  }

  // hard error from a killed serverless fn (non-JSON / 5xx) with nothing cached
  if (error && !summary) return <ErrorState message={error} onRetry={refetch} />

  // degraded envelope with no cached summary to fall back on
  if (degraded && !summary) {
    return (
      <div className="xd-track-record">
        <Masthead summary={null} view={null} pop={pop} onPop={setPop} sigAvailable={false} meta={meta} t={t} animate={false} />
        <ErrorState
          message={t('xDash.trackRecord.degraded.title', 'Track record temporarily unavailable')}
          onRetry={refetch}
        />
        <p className="xd-tr-degraded-note">
          {t('xDash.trackRecord.degraded.detail', 'The provenance ledger is rebuilding. The numbers are real — give it a moment.')}
        </p>
      </div>
    )
  }

  // the tape body shows shimmer during a sort/status refetch; the rest persists.
  const refetching = loading && !ledger?.calls?.length && !!summary
  const tapeDegraded = degraded && !!summary

  return (
    <div className="xd-track-record">
      <Masthead
        summary={summary}
        view={view}
        pop={pop}
        onPop={setPop}
        sigAvailable={sigAvailable}
        meta={meta}
        t={t}
        animate={firstReveal}
      />
      <Ribbon summary={view} t={t} />
      <StrategyBand summary={summary} t={t} />
      <LivePaperStrip t={t} />
      <DistributionBand
        summary={view}
        activeFilter={{ status, minRoi, capRoi }}
        onTier={handleTier}
        t={t}
      />
      <HallOfFame hallOfFame={hof} onOpenToken={onOpenToken} t={t} />
      {tapeDegraded ? (
        <section className="xd-tr-tape">
          <ErrorState
            message={t('xDash.trackRecord.degraded.title', 'Track record temporarily unavailable')}
            onRetry={refetch}
          />
        </section>
      ) : (
        <Tape
          calls={tapeCalls}
          shown={tapeCalls.length}
          total={totalCalls}
          sort={sort}
          status={status}
          onSort={handleSort}
          onStatus={handleStatus}
          graveyard={graveyard}
          onGraveyard={() => setGraveyard((g) => !g)}
          deadCount={Number(view?.dead) || 0}
          refetching={refetching}
          onOpenToken={onOpenToken}
          onReset={handleReset}
          t={t}
        />
      )}
      <Footnote summary={summary} meta={meta} t={t} />
    </div>
  )
}
