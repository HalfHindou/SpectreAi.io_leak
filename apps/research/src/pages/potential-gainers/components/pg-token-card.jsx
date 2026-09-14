/*
 * PGTokenCard - one Potential Gainers SIGNAL, rendered as a dense row.
 *
 * Source: /api/momentum/setups/signals -> tokens[]. Each token is a PG
 * signal carried forward with a lifecycle phase, tracked from its first PG
 * timestamp - NOT a row in the hourly leaderboard snapshot.
 *
 * The row tells one honest story, left to right:
 *   [logo + symbol]  [Flagged <date> · signal mcap -> now]
 *   [lifecycle badge]  [mini trajectory chart]  [return since PG signal]  [peak since signal]
 *
 * The mini trajectory chart shows the 3-point path:
 *   signal mcap -> current mcap -> peak mcap (as dots on a line / mini bars)
 *
 * Return numbers (since-signal, peak) are the ONLY place --bull/--bear
 * appear. The lifecycle badge stays neutral glass.
 */
import { memo } from 'react'
import {
  formatMarketCap, formatSignedPct, returnTone, relativeTime, formatStamp,
  lifecycleMeta, toNumber,
} from './pg-utils'

/* Plain-language status label - phase AND return aware, so a developing
   token that is underwater never reads as "still playable". */
function statusLabel(phase, sinceSignal) {
  const p = String(phase || '').toLowerCase()
  if (p === 'fresh') return 'Still early'
  if (p === 'developing') {
    const r = toNumber(sinceSignal)
    return r != null && r < 0 ? 'Aging, weak so far' : 'Still early'
  }
  if (p === 'runner') return 'Already moved, watch continuation'
  if (p === 'already_ran' || p === 'matured_positive') return 'Proof call'
  if (p === 'drawdown') return 'Failed'
  return 'Cooled off'
}

/* Format hours_to_peak as a compact human label. */
function formatTimeToPeak(hours) {
  const h = toNumber(hours)
  if (h == null) return null
  if (h < 1) return '<1h to peak'
  if (h < 24) return `${Math.round(h)}h to peak`
  const d = Math.round(h / 24)
  return `${d}d to peak`
}

/* MiniTrajectory - compact 3-point sparkline showing the token's journey.
   signal mcap -> current mcap -> peak mcap.
   All three points are normalized: 0 = signal mcap baseline, scale to peak.
   Renders as a small SVG path with dots at each data point. */
function MiniTrajectory({ pg, masked }) {
  if (masked) return null

  /* Anchor the sparkline to the SPOT + receipt peak when we have them, so the
     path matches the "since spotted / peak since spotted" numbers instead of
     the flat since-flag shape (ANSEM ran $5.8M -> $405M before the flag). */
  const signalMcap = toNumber(pg?.first_seen?.mcap) ?? toNumber(pg?.signal?.market_cap)
  const currentMcap = toNumber(pg?.current_market_cap)
  const peakMcap = toNumber(pg?.first_seen?.peakMcap) ?? toNumber(pg?.peak_market_cap_since_signal)

  /* Need at least signal + current to render anything meaningful */
  if (signalMcap == null || currentMcap == null || signalMcap <= 0) {
    return <div className="pg-traj pg-traj--empty" aria-hidden="true" />
  }

  /* Normalize to percentage change from signal baseline */
  const curPct = ((currentMcap - signalMcap) / signalMcap) * 100
  const peakPct = peakMcap != null
    ? ((peakMcap - signalMcap) / signalMcap) * 100
    : curPct

  /* The three data points */
  const values = [0, curPct, peakPct]
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = Math.max(maxV - minV, 1)

  const W = 52
  const H = 28
  const PAD = 3

  /* Map a percent value to SVG Y coordinate */
  function svgY(v) {
    /* Inverted: higher value = lower Y in SVG space */
    return PAD + ((maxV - v) / range) * (H - PAD * 2)
  }

  const xs = [PAD, W / 2, W - PAD]
  const ys = values.map(svgY)

  /* Build a smooth path string */
  const pathD = xs
    .map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(' ')

  /* Line color based on current (not peak) — it's the live situation */
  const tone = returnTone(curPct)
  const strokeClass = `pg-traj__line--${tone}`

  /* Dot at peak gets a slightly different visual cue if peak > current */
  const peakIsDifferent = peakMcap != null && Math.abs(peakPct - curPct) > 2

  return (
    <div className="pg-traj" aria-label="Signal trajectory: entry to current to peak" role="img">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {/* Path line */}
        <polyline
          points={xs.map((x, i) => `${x},${ys[i]}`).join(' ')}
          className={`pg-traj__line ${strokeClass}`}
        />
        {/* Entry dot (signal) - always at index 0 */}
        <circle cx={xs[0]} cy={ys[0]} r={2.5} className="pg-traj__dot pg-traj__dot--entry" />
        {/* Current dot */}
        <circle cx={xs[1]} cy={ys[1]} r={3} className={`pg-traj__dot pg-traj__dot--cur pg-traj__dot--${tone}`} />
        {/* Peak dot (only if different from current) */}
        {peakIsDifferent && (
          <circle cx={xs[2]} cy={ys[2]} r={2.5} className="pg-traj__dot pg-traj__dot--peak" />
        )}
      </svg>
      <div className="pg-traj__labels">
        <span className="pg-traj__label">entry</span>
        <span className="pg-traj__label">now</span>
        <span className="pg-traj__label">peak</span>
      </div>
    </div>
  )
}

function TokenAvatar({ src, symbol, size = 34 }) {
  const letter = String(symbol || '?').replace(/^\$/, '').charAt(0).toUpperCase() || '?'
  const dim = { width: size, height: size, minWidth: size }
  if (!src) {
    return <span className="pg-avatar pg-avatar--fallback" style={dim} aria-hidden="true">{letter}</span>
  }
  return (
    <img
      className="pg-avatar"
      style={dim}
      src={src}
      alt={symbol || ''}
      loading="lazy"
      onError={(e) => {
        const span = document.createElement('span')
        span.className = 'pg-avatar pg-avatar--fallback'
        span.style.width = `${size}px`
        span.style.height = `${size}px`
        span.style.minWidth = `${size}px`
        span.textContent = letter
        e.currentTarget.replaceWith(span)
      }}
    />
  )
}

function PGTokenCard({ row, masked = false, onOpenToken }) {
  const token = row?.token || {}
  const pg = row?.potential_gainer || {}
  const signal = pg.signal || {}
  const life = pg.lifecycle || {}
  const lc = lifecycleMeta(life.phase)

  /* The whole row opens the X Dash token drawer - only when we have a
     CoinGecko id to look up and a handler, and never on the masked preview. */
  const cgId = token.cg_id
  const clickable = !masked && Boolean(cgId) && typeof onOpenToken === 'function'
  const openDetail = () => { if (clickable) onOpenToken(cgId) }

  const sinceSignal = pg.return_since_signal_pct
  const peakReturn = pg.peak_return_since_signal_pct
  const signalStamp = formatStamp(signal.signaled_at)

  const symbol = token.symbol ? String(token.symbol).replace(/^\$/, '') : ''
  const displaySymbol = masked ? '••••' : (symbol || '—')
  const displayName = masked ? 'Hidden' : (token.name || token.cg_id || 'Unknown')

  /* First-seen anchor (from momentum_origin / X Dash track-record): the mcap
     when Spectre FIRST saw this token, earlier than the top-10 PG flag. When
     present, the proof line tells the honest 3-stop story - first seen ->
     flagged -> now - and a "since first seen" multiple that reflects the real
     early catch, not just the (later, higher) flag entry. */
  const firstSeenMcap = masked ? null : toNumber(pg.first_seen?.mcap)
  const currentMcap = toNumber(pg.current_market_cap)
  const sinceFirstSeenPct = firstSeenMcap != null && firstSeenMcap > 0 && currentMcap != null
    ? (currentMcap / firstSeenMcap - 1) * 100
    : null
  /* Peak measured from the SPOT, not the (late) flag - the collector's
     peak_return is measured since the top-10 flag and buries the real run. */
  const firstSeenPeakRoi = firstSeenMcap != null ? toNumber(pg.first_seen?.peakRoi) : null
  /* When we have a genuine earlier spot, the row's headline returns anchor to
     it: "since spotted" (live) + peak-since-spotted. Otherwise the collector's
     since-flag numbers stand. */
  const anchored = firstSeenMcap != null
  const primaryReturn = anchored && sinceFirstSeenPct != null ? sinceFirstSeenPct : sinceSignal
  const primaryReturnLabel = anchored ? 'Since Spotted' : 'Since PG Signal'
  const displayPeakRaw = anchored && firstSeenPeakRoi != null ? firstSeenPeakRoi : peakReturn
  /* A peak can never read below the current return - guard against any stale or
     unfloored receipt (peak_market_cap < entry) leaking a nonsensical figure. */
  const displayPeak = anchored && displayPeakRaw != null && primaryReturn != null
    ? Math.max(displayPeakRaw, primaryReturn)
    : displayPeakRaw

  return (
    <article
      className={`pg-row pg-row--life-${lc.group}${masked ? ' pg-row--masked' : ''}${clickable ? ' pg-row--clickable' : ''}`}
      role={clickable ? 'button' : 'row'}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Open ${displaySymbol} signal detail` : undefined}
      onClick={clickable ? openDetail : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openDetail()
        }
      } : undefined}
    >
      {/* IDENTITY */}
      <div className={`pg-row__identity${masked ? ' pg-row__identity--masked' : ''}`}>
        <TokenAvatar src={masked ? null : (token.image_small || token.image_url)} symbol={symbol} />
        <div className="pg-row__id-text">
          <span className="pg-row__symbol">{displaySymbol}</span>
          <span className="pg-row__name">{displayName}</span>
        </div>
      </div>

      {/* FLAGGED PROOF - signal timestamp + signal mcap -> current mcap */}
      <div className="pg-row__proof">
        {signalStamp ? (
          <>
            <span className="pg-row__proof-flagged">
              Flagged {signalStamp}
              {signal.signaled_at && (
                <span className="pg-row__proof-ago"> · {relativeTime(signal.signaled_at)}</span>
              )}
            </span>
            {firstSeenMcap != null ? (
              <span className="pg-row__proof-now">
                <span className="pg-row__proof-mcap pg-row__proof-mcap--first">
                  {formatMarketCap(firstSeenMcap)}
                </span>
                <span className="pg-row__proof-arrow" aria-hidden="true"> &rarr; </span>
                <span className="pg-row__proof-mcap">{formatMarketCap(signal.market_cap)}</span>
                <span className="pg-row__proof-arrow" aria-hidden="true"> &rarr; </span>
                <span className="pg-row__proof-mcap pg-row__proof-mcap--now">
                  {formatMarketCap(pg.current_market_cap)}
                </span>
                <span className="pg-row__proof-cap"> first seen &rarr; flagged &rarr; now</span>
              </span>
            ) : (
              <span className="pg-row__proof-now">
                <span className="pg-row__proof-mcap">{formatMarketCap(signal.market_cap)}</span>
                <span className="pg-row__proof-arrow" aria-hidden="true"> &rarr; </span>
                <span className="pg-row__proof-mcap pg-row__proof-mcap--now">
                  {formatMarketCap(pg.current_market_cap)}
                </span>
                <span className="pg-row__proof-cap"> signal mcap &rarr; now</span>
              </span>
            )}
          </>
        ) : (
          <span className="pg-row__proof-flagged pg-row__proof-flagged--none">No signal timestamp</span>
        )}
      </div>

      {/* LIFECYCLE */}
      <div className="pg-row__life">
        <span className={`pg-life ${lc.cls}`} title={life.product_hint || undefined}>
          {lc.label}
        </span>
      </div>

      {/* MINI TRAJECTORY - 3-point path: signal -> current -> peak */}
      <div className="pg-row__traj">
        <MiniTrajectory pg={pg} masked={masked} />
      </div>

      {/* LIVE - return since we SPOTTED it (first sighting), or since the PG
          flag when there's no earlier spot to anchor to */}
      <div className="pg-row__return">
        <span className={`pg-row__return-value pg-tone--${returnTone(primaryReturn)}`}>{formatSignedPct(primaryReturn)}</span>
        <span className="pg-row__return-label">{primaryReturnLabel}</span>
      </div>

      {/* PEAK - best return reached. Anchored to the spot when we have one
          (ANSEM: +6893% from $5.8M), else the collector's since-flag peak. */}
      <div className="pg-row__peak">
        <span className={`pg-row__peak-value pg-tone--${returnTone(displayPeak)}`}>{formatSignedPct(displayPeak)}</span>
        <span className="pg-row__peak-label">
          {anchored
            ? 'peak since spotted'
            : `${formatTimeToPeak(pg.hours_to_peak) || 'peak'}${pg.peak_seen_at ? ` · ${relativeTime(pg.peak_seen_at)}` : ''}`}
        </span>
      </div>

      {/* STATUS - plain-language lifecycle summary */}
      <div className="pg-row__status">
        <span className="pg-row__status-label">{masked ? '' : statusLabel(life.phase, sinceSignal)}</span>
      </div>
    </article>
  )
}

// The 60s live-mcap poll preserves the exact row object ref for unchanged tokens
// (runners/matured/stalled that don't tick), so a shallow memo skips re-running
// the MiniTrajectory SVG math for them every poll.
export default memo(PGTokenCard)
