/**
 * RECEIPTS — the proof wall. Spectre grades itself in public: every socially
 * spotted token is a virtual $1k entry at its immutable first-spotted mcap
 * (momentum_origin), marked to now and to peak. This tab shows the win-rate
 * per signal class, the best calls WITH their give-backs, and the honest
 * misses — because a signal desk you can't audit is just marketing.
 */
import { useMemo } from 'react'
import { useReceiptsLedger, useEarlyRunners } from './use-x-intel-data'
import {
  fmtUsdShort, fmtPct, StatusChip, XiShimmer, XiEmpty, XiError,
} from './xi-bits'

/* ── class tiles ────────────────────────────────────────────────────── */

function ClassTile({ label, headline, sub, lines = [], caveat }) {
  return (
    <div className="xi-tile">
      <div className="xi-tile__label">{label}</div>
      <div className="xi-tile__headline xi-num">{headline}</div>
      {sub ? <div className="xi-tile__sub">{sub}</div> : null}
      {lines.map((l, i) => (
        <div key={i} className="xi-tile__line">
          <span>{l.k}</span>
          <b className="xi-num">{l.v}</b>
        </div>
      ))}
      {caveat ? <div className="xi-tile__caveat">{caveat}</div> : null}
    </div>
  )
}

function ClassTiles({ summary, erSummary }) {
  const sig = summary?.signals
  const conv = summary?.strategy?.conviction
  const g24 = erSummary?.grading?.h24

  return (
    <div className="xi-tiles">
      {sig ? (
        <ClassTile
          label="Spotted calls — signal lane"
          headline={`${sig.hit_rate}%`}
          sub={`hit rate · ${sig.calls} calls, $1k each`}
          lines={[
            { k: 'peaked ≥2×', v: sig.peak_x2 },
            { k: 'avg winner', v: fmtPct(sig.avg_winner_roi, { digits: 0 }) },
            { k: '30% trail exit', v: fmtPct(sig.trail_roi, { digits: 1 }) },
          ]}
          caveat="Entry-time fields only — causal, no look-ahead."
        />
      ) : null}

      <ClassTile
        label="Early runners — pre-CG"
        headline={g24?.graded ? `${g24.hit_rate}%` : '—'}
        sub={g24?.graded
          ? `hit rate at +24h · ${g24.graded} graded`
          : `${erSummary?.confirmed ?? 0} confirmed · grading armed`}
        lines={g24?.graded ? [
          { k: 'avg +24h', v: fmtPct(g24.avg_return_pct) },
          { k: 'best +24h', v: fmtPct(g24.best_return_pct) },
        ] : []}
        caveat={g24?.graded
          ? 'Graded vs mcap at confirmation, automatically.'
          : 'Every confirmation grades itself at +24/48/72h. First grades land as signals age past 24h — no number is claimed before then.'}
      />

      {summary ? (
        <ClassTile
          label="Firehose — every call"
          headline={`${summary.hit_rate}%`}
          sub={`hit rate · all ${summary.calls} spotted tokens`}
          lines={[
            { k: 'median multiple', v: `${summary.median_multiple}×` },
            { k: 'peaked ≥2×', v: summary.peak_x2 },
          ]}
          caveat="The unfiltered radar. Most calls don't run — the edge is the tail, and we show it anyway."
        />
      ) : null}

      {conv ? (
        <ClassTile
          label="Conviction filter"
          headline={fmtPct(conv.trail_roi, { digits: 1 })}
          sub={`trail ROI · ${conv.n} calls`}
          lines={[{ k: 'avg peak', v: `${conv.avg_peak_multiple}×` }]}
          caveat="Uses staying-power (look-ahead) — research finding, not a tradeable claim."
        />
      ) : null}
    </div>
  )
}

/* ── best calls wall ────────────────────────────────────────────────── */

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function CallCard({ call, rank }) {
  const statusTone = call.status === 'moon' ? 'graded-up' : call.status === 'up' ? 'running' : 'faded'
  const statusLabel = call.status === 'moon' ? 'Moonshot' : call.status === 'up' ? 'Up' : 'Down'
  const kols = Array.isArray(call.kols) ? call.kols.slice(0, 3) : []
  return (
    <article className="xi-card xi-call">
      <div className="xi-call__head">
        <span className="xi-call__rank xi-num">{rank}</span>
        <span className="xi-call__symbol">${call.symbol}</span>
        <span className="xi-runner__spacer" />
        <StatusChip tone={statusTone}>{statusLabel}</StatusChip>
      </div>
      <div className="xi-call__peak xi-num">{fmtPct(call.peak_roi_pct, { digits: 0 })}</div>
      <div className="xi-call__journey">
        <span>
          spotted <b className="xi-num">{fmtUsdShort(call.entry_market_cap)}</b>
          {fmtDate(call.entry_date) ? <span className="xi-ago"> {fmtDate(call.entry_date)}</span> : null}
        </span>
        <span className="xi-receipt-line__arrow">→</span>
        <span>
          peak <b className="xi-num">{fmtUsdShort(call.peak_market_cap)}</b>
          {fmtDate(call.peak_at) ? <span className="xi-ago"> {fmtDate(call.peak_at)}</span> : null}
        </span>
      </div>
      <div className="xi-call__now">
        now <b className={`xi-num ${Number(call.roi_pct) >= 0 ? 'xi-delta--up' : 'xi-delta--down'}`}>{fmtPct(call.roi_pct, { digits: 0 })}</b>
        {call.gave_back ? <span className="xi-call__gaveback">gave most of it back</span> : null}
      </div>
      {kols.length ? (
        <div className="xi-call__kols">
          {kols.map((k) => (
            <img key={k.screen_name} className="xi-call__kol" src={k.avatar} alt={k.screen_name} title={`@${k.screen_name}`} loading="lazy" />
          ))}
          <span className="xi-call__kolnote">called it early</span>
        </div>
      ) : null}
    </article>
  )
}

/* ── honest misses ──────────────────────────────────────────────────── */

function DistributionChart({ distribution }) {
  const bins = Array.isArray(distribution?.bins) ? distribution.bins : []
  if (!bins.length) return null
  const max = Math.max(...bins, 1)
  const min = Number(distribution.min) || -100
  const span = (Number(distribution.max) || 700) - min
  const W = 480
  const H = 96
  const bw = W / bins.length
  // The bin boundary where ROI crosses 0 — losses left, gains right.
  const zeroX = ((0 - min) / span) * W
  return (
    <svg className="xi-dist" viewBox={`0 0 ${W} ${H + 18}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="ROI distribution across all calls">
      {bins.map((count, i) => {
        const h = count > 0 ? Math.max((count / max) * H, 2) : 0
        const gain = (min + (i + 0.5) * (span / bins.length)) >= 0
        return h > 0 ? (
          <rect
            key={i}
            className={gain ? 'xi-dist__bar xi-dist__bar--gain' : 'xi-dist__bar'}
            x={i * bw + 1}
            y={H - h}
            width={bw - 2}
            height={h}
            rx="1.5"
          />
        ) : null
      })}
      <line className="xi-dist__zero" x1={zeroX} y1="0" x2={zeroX} y2={H} />
      <text className="xi-dist__label" x="0" y={H + 14}>-100%</text>
      <text className="xi-dist__label" x={zeroX} y={H + 14} textAnchor="middle">0</text>
      <text className="xi-dist__label" x={W} y={H + 14} textAnchor="end">+700%</text>
    </svg>
  )
}

function HonestMisses({ summary }) {
  if (!summary) return null
  return (
    <div className="xi-misses">
      <div className="xi-misses__stats">
        <div className="xi-misses__stat">
          <b className="xi-num">{summary.dead}</b>
          <span>died (−70%+, no pulse)</span>
        </div>
        <div className="xi-misses__stat">
          <b className="xi-num">{summary.rug}</b>
          <span>pumped then rugged</span>
        </div>
        <div className="xi-misses__stat">
          <b className="xi-num">{summary.underwater}</b>
          <span>underwater, still alive</span>
        </div>
        <div className="xi-misses__stat">
          <b className="xi-num">{summary.median_multiple}×</b>
          <span>median outcome</span>
        </div>
      </div>
      <DistributionChart distribution={summary.distribution} />
      <p className="xi-misses__copy">
        This is what the whole book looks like — most social calls bleed, a thin tail moons. The desk's job is
        finding that tail early and exiting the rest with discipline, and the ledger above is how you check we do.
      </p>
    </div>
  )
}

/* ── tab root ───────────────────────────────────────────────────────── */

export default function XiReceipts() {
  const { summary, calls, loading, error, degraded, refetch } = useReceiptsLedger()
  const { summary: erSummary } = useEarlyRunners()

  const bestCalls = useMemo(
    () => calls.filter((c) => Number(c.peak_roi_pct) > 0).slice(0, 6),
    [calls],
  )

  if (loading && !summary) return <XiShimmer variant="card" count={4} />
  if (error && !summary) return <XiError message={String(error)} onRetry={refetch} />
  if (degraded && !summary) {
    return (
      <XiEmpty
        title="Ledger temporarily unreachable"
        detail="The track-record pipeline is separate from the live board — it retries on its own."
      />
    )
  }

  return (
    <div className="xi-receipts">
      <section className="xi-section">
        <header className="xi-section__head">
          <h2 className="xi-section__title">Win rate, by signal class</h2>
          <span className="xi-section__sub">
            Every spotted token becomes a virtual $1k entry at its first-seen mcap — graded whether it flies or dies.
          </span>
        </header>
        <ClassTiles summary={summary} erSummary={erSummary} />
      </section>

      <section className="xi-section">
        <header className="xi-section__head">
          <h2 className="xi-section__title">Best calls</h2>
          <span className="xi-section__sub">Entry → peak with dates. “Now” included, give-backs flagged.</span>
        </header>
        {bestCalls.length ? (
          <div className="xi-cards">
            {bestCalls.map((call, i) => <CallCard key={call.asset || call.symbol} call={call} rank={i + 1} />)}
          </div>
        ) : (
          <XiEmpty title="No graded winners yet" detail="The wall fills as calls age and grade." />
        )}
      </section>

      <section className="xi-section">
        <header className="xi-section__head">
          <h2 className="xi-section__title">The honest part</h2>
          <span className="xi-section__sub">Full outcome distribution — no cherry-picking.</span>
        </header>
        <HonestMisses summary={summary} />
      </section>

      <p className="xi-disclaimer">
        Receipts are marked from live market caps with clone-guarded healing. Information, never financial advice.
      </p>
    </div>
  )
}
