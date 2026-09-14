/**
 * SIGNALS — the action feed. Two lanes, newest first, receipts on everything:
 *
 *  1. Early Runner lane (ours; X Dash cannot see these): pre-CoinGecko tokens
 *     confirmed from X buzz + on-chain volume by worker-early-runner-detector.
 *     Each card carries its own live receipt (mcap at confirm → now) and the
 *     formal +24h grade once the detector stamps it.
 *  2. Breakout radar: the intelligence-feed breadth-fingerprint signals.
 *
 * Every card shows data age. Unknowns render as absent, never as 0.
 */
import { useMemo } from 'react'
import { useEarlyRunners, useBreakoutFeed } from './use-x-intel-data'
import {
  fmtUsdShort, fmtCount, fmtPct, fmtAgo,
  ChainChip, StatusChip, CaRow, XiShimmer, XiEmpty, XiError, TokenLogo,
} from './xi-bits'

const DAY_MS = 24 * 60 * 60 * 1000

function runnerStatus(row) {
  if (row.status === 'expired' || row.expired_at) return { tone: 'faded', label: 'Faded' }
  if (row.return_24h_pct != null) {
    const up = Number(row.return_24h_pct) >= 0
    return {
      tone: up ? 'graded-up' : 'graded-down',
      label: `+24h ${fmtPct(row.return_24h_pct)}`,
    }
  }
  if (row.confirmedTs && Date.now() - row.confirmedTs < DAY_MS) return { tone: 'fresh', label: 'Fresh' }
  return { tone: 'running', label: 'Running' }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const buzzWidth = (buzz) => `${Math.round(clamp01(Math.log10(Math.max(Number(buzz) || 1, 1)) / 3.5) * 100)}%`

function RunnerCard({ row }) {
  const status = runnerStatus(row)
  const mcap = fmtUsdShort(row.market_cap_usd)
  const vol = fmtUsdShort(row.volume_24h_usd)
  const liq = fmtUsdShort(row.liquidity_usd)
  const reach = fmtCount(row.followers_reach)
  const confirmMc = fmtUsdShort(row.mcap_at_confirm)
  const drift = fmtPct(row.driftPct)
  const thinLiq = Number(row.liquidity_usd) > 0 && Number(row.liquidity_usd) < 25_000

  return (
    <article className={`xi-card xi-runner xi-runner--${status.tone}`}>
      <div className="xi-runner__head">
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
        <AgoInline ts={row.confirmedTs || row.firstSeenTs} />
        <span className="xi-runner__spacer" />
        <span className="xi-precg" title="Not indexed by CoinGecko or X Dash when confirmed">PRE-CG</span>
      </div>

      <div className="xi-runner__id">
        <TokenLogo chain={row.chain} address={row.contract_address} symbol={row.symbol} />
        <span className="xi-runner__symbol">${row.symbol}</span>
        <ChainChip chain={row.chain} />
        {thinLiq ? <span className="xi-warn">thin liq</span> : null}
        {row.cg_listed ? <span className="xi-warn xi-warn--soft">now on CG</span> : null}
      </div>

      <div className="xi-runner__stats">
        {mcap ? <span className="xi-stat"><b className="xi-num">{mcap}</b> mcap</span> : null}
        {vol ? <span className="xi-stat"><b className="xi-num">{vol}</b> vol 24h</span> : null}
        {liq ? <span className="xi-stat"><b className="xi-num">{liq}</b> liq</span> : null}
      </div>

      <div className="xi-runner__social">
        {row.unique_authors_24h != null ? <span><b className="xi-num">{fmtCount(row.unique_authors_24h)}</b> authors</span> : null}
        {row.mentions_24h != null ? <span><b className="xi-num">{fmtCount(row.mentions_24h)}</b> mentions</span> : null}
        {reach ? <span><b className="xi-num">{reach}</b> reach</span> : null}
      </div>

      {Number(row.buzz_score) > 0 ? (
        <div className="xi-buzz" title="Buzz score — X attention vs the token's own baseline">
          <span className="xi-buzz__track"><span className="xi-buzz__fill" style={{ width: buzzWidth(row.buzz_score) }} /></span>
          <span className="xi-buzz__num xi-num">{Math.round(row.buzz_score)}</span>
        </div>
      ) : null}

      {confirmMc ? (
        <div className="xi-receipt-line">
          <span className="xi-receipt-line__label">receipt</span>
          <span className="xi-num">{confirmMc}</span>
          <span className="xi-receipt-line__arrow">→</span>
          <span className="xi-num">{mcap || '—'}</span>
          {drift ? (
            <span className={`xi-num xi-delta ${Number(row.driftPct) >= 0 ? 'xi-delta--up' : 'xi-delta--down'}`}>{drift}</span>
          ) : null}
        </div>
      ) : null}

      <CaRow address={row.contract_address} chain={row.chain} symbol={row.symbol} />
    </article>
  )
}

function AgoInline({ ts }) {
  const label = fmtAgo(ts)
  return label ? <span className="xi-ago">{label}</span> : null
}

function CandidateRow({ row }) {
  return (
    <div className="xi-cand">
      <span className="xi-cand__symbol">${row.symbol}</span>
      <ChainChip chain={row.chain} />
      <span className="xi-cand__meta">
        {row.unique_authors_24h != null ? <span><b className="xi-num">{fmtCount(row.unique_authors_24h)}</b> authors</span> : null}
        {Number(row.buzz_score) > 0 ? <span><b className="xi-num">{Math.round(row.buzz_score)}</b> buzz</span> : null}
        {fmtUsdShort(row.market_cap_usd) ? <span><b className="xi-num">{fmtUsdShort(row.market_cap_usd)}</b> mcap</span> : null}
      </span>
      <span className="xi-cand__spacer" />
      <AgoInline ts={row.firstSeenTs} />
    </div>
  )
}

function BreakoutCard({ item }) {
  return (
    <article className="xi-card xi-breakout">
      <div className="xi-breakout__head">
        <StatusChip tone="running">Breakout</StatusChip>
        <AgoInline ts={item.createdTs} />
        <span className="xi-runner__spacer" />
        {item.score != null ? <span className="xi-breakout__score xi-num" title="Detector score">{item.score}</span> : null}
      </div>
      <div className="xi-runner__id">
        <span className="xi-runner__symbol">{item.asset ? `$${item.asset}` : item.title}</span>
      </div>
      <div className="xi-runner__social">
        {item.authors != null ? <span><b className="xi-num">{item.authors}</b> authors</span> : null}
        {item.mcap != null ? <span><b className="xi-num">{fmtUsdShort(item.mcap)}</b> mcap</span> : null}
        {item.accel != null ? <span><b className="xi-num">{item.accel}×</b> accel</span> : null}
      </div>
      {item.body ? <p className="xi-breakout__body">{item.body}</p> : null}
    </article>
  )
}

// The lane's collective receipt: honest "grading armed" before data exists,
// real hit-rate figures the moment the detector stamps the first +24h grades.
function GradingStrip({ summary }) {
  const g = summary?.grading?.h24
  if (!g) return null
  if (!g.graded) {
    return (
      <div className="xi-grading">
        <span className="xi-grading__dot" />
        Self-grading armed — every confirmation is graded at +24 / 48 / 72h against its confirm mcap. First grades land as signals age past 24h.
      </div>
    )
  }
  return (
    <div className="xi-grading">
      <span className="xi-grading__dot xi-grading__dot--live" />
      <span>24h grades:</span>
      <b className="xi-num">{g.hit_rate}% hit</b>
      <span className="xi-num">({g.hits}/{g.graded})</span>
      {g.avg_return_pct != null ? <span>avg <b className="xi-num">{fmtPct(g.avg_return_pct)}</b></span> : null}
      {g.best_return_pct != null ? <span>best <b className="xi-num">{fmtPct(g.best_return_pct)}</b></span> : null}
    </div>
  )
}

export default function XiSignals() {
  const { confirmed, candidates, summary, loading, error, degraded, refetch } = useEarlyRunners()
  const { breakouts, loading: feedLoading } = useBreakoutFeed()

  const liveConfirmed = useMemo(
    () => confirmed.filter((r) => r.status !== 'expired').slice(0, 30),
    [confirmed],
  )
  const faded = useMemo(
    () => confirmed.filter((r) => r.status === 'expired').slice(0, 6),
    [confirmed],
  )
  const brewing = useMemo(() => candidates.slice(0, 10), [candidates])

  if (loading && !confirmed.length && !degraded) return <XiShimmer variant="card" count={6} />
  if (error && !confirmed.length) return <XiError message={String(error)} onRetry={refetch} />

  return (
    <div className="xi-signals">
      <section className="xi-section">
        <header className="xi-section__head">
          <h2 className="xi-section__title">Early Runner lane</h2>
          <span className="xi-section__badge">pre-CoinGecko</span>
          <span className="xi-section__sub">
            Confirmed from X buzz + on-chain volume before CoinGecko or X Dash have a row for them.
          </span>
          {summary ? (
            <span className="xi-section__count xi-num">
              {summary.confirmed} confirmed · {summary.candidates} brewing
            </span>
          ) : null}
        </header>

        <GradingStrip summary={summary} />

        {degraded && !liveConfirmed.length ? (
          <XiEmpty
            title="Early-runner lane is indexing"
            detail="The detector is live upstream but this surface couldn't reach it. It retries on its own."
          />
        ) : liveConfirmed.length ? (
          <div className="xi-cards">
            {liveConfirmed.map((row) => <RunnerCard key={row.id || `${row.symbol}-${row.chain}`} row={row} />)}
          </div>
        ) : (
          <XiEmpty
            title="No confirmed early runners right now"
            detail="Confirmations require real X breadth plus on-chain volume — the bar is deliberately high."
          />
        )}

        {faded.length ? (
          <div className="xi-faded">
            <div className="xi-faded__label">Recently faded</div>
            <div className="xi-cards xi-cards--dim">
              {faded.map((row) => <RunnerCard key={row.id || `${row.symbol}-${row.chain}`} row={row} />)}
            </div>
          </div>
        ) : null}

        {brewing.length ? (
          <div className="xi-brewing">
            <div className="xi-brewing__label">
              Brewing — buzzing on X, on-chain confirmation pending
              {candidates.length > brewing.length ? (
                <span className="xi-brewing__more xi-num"> +{candidates.length - brewing.length} more</span>
              ) : null}
            </div>
            <div className="xi-cand-list">
              {brewing.map((row) => <CandidateRow key={row.id || `${row.symbol}-${row.chain}`} row={row} />)}
            </div>
          </div>
        ) : null}
      </section>

      <section className="xi-section">
        <header className="xi-section__head">
          <h2 className="xi-section__title">Breakout radar</h2>
          <span className="xi-section__sub">
            Social-breadth fingerprints on indexed tokens — the proven ≥5-authors-early pattern, throttled to the strongest fires.
          </span>
        </header>
        {feedLoading && !breakouts.length ? (
          <XiShimmer variant="row" count={3} />
        ) : breakouts.length ? (
          <div className="xi-cards xi-cards--wide">
            {breakouts.map((item) => <BreakoutCard key={item.id} item={item} />)}
          </div>
        ) : (
          <XiEmpty
            title="No breakout fires in the current window"
            detail="The radar throttles hard — a quiet feed means no clean breadth fingerprint, not a dead detector."
          />
        )}
      </section>

      <p className="xi-disclaimer">
        Signals are information with receipts, not financial advice. Early = risky — size for the tail.
      </p>
    </div>
  )
}
