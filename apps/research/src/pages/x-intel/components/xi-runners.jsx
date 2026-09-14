/**
 * RUNNERS — the attention board re-scored for early-breakout fit, with
 * receipt columns stamped from the track-record ledger.
 *
 * Rows come from the shared X Dash bootstrap cache (momentum ranking, live
 * server-overlaid mcaps) and are scored client-side by the shared Runner
 * Score (@/lib/runner-signal — acceleration, mcap fit, clean quality, rank
 * climb, novelty, promo/concentration gate) so every score is explainable.
 * SPOTTED MC / ROI / PEAK come from momentum_origin ($1k-per-call ledger) —
 * live rows meet their own history in one table.
 */
import { useMemo, useState } from 'react'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import { useXDashPrices } from '@/hooks/useXDashPrices'
import {
  computeRunnerScore, RUNNER_TIER_LABEL, RUNNER_MIN_SCORE, RUNNER_MAX_MCAP,
} from '@/lib/runner-signal'
import { useReceiptsLedger, findReceipt, useContractMcaps } from './use-x-intel-data'
import {
  fmtUsdShort, fmtCount, fmtPct, fmtAgo,
  ChainChip, ScoreBar, CarrierStack, XiShimmer, XiEmpty, XiError,
} from './xi-bits'

const BOOTSTRAP_PARAMS = {
  page: 1,
  perPage: 50, // upstream silently caps per_page at 50
  timeframe: '24h',
  ranking: 'momentum',
  segment: 'all',
  market: 'all',
  minKols: 1,
}

const FILTERS = [
  { key: 'setups', label: 'Setups' },
  { key: 'igniting', label: 'Igniting' },
  { key: 'heating', label: 'Heating' },
  { key: 'building', label: 'Building' },
  { key: 'all', label: 'All scanned' },
]

// Number(undefined) is NaN (not nullish), so receipt-less rows need an
// explicit finite fallback or the comparator poisons the whole sort.
const roiOf = (e) => {
  const n = Number(e.receipt?.roi_pct)
  return Number.isFinite(n) ? n : -Infinity
}

const SORTS = {
  score: (a, b) => b.score - a.score,
  mentions: (a, b) => (Number(b.row.external_mentions_24h) || 0) - (Number(a.row.external_mentions_24h) || 0),
  mcap: (a, b) => (Number(b.row.market_cap) || 0) - (Number(a.row.market_cap) || 0),
  roi: (a, b) => roiOf(b) - roiOf(a),
}

function mentionGrowthPct(row) {
  // No baseline survives upstream's zeroed 24h rollup - null renders no delta,
  // where the Infinity below would falsely chip every row as 'new'.
  if (row.mentions_window_backfilled) return null
  const now = Number(row.external_mentions_24h) || 0
  const prev = Number(row.external_mentions_prev_daily_avg) || 0
  if (prev <= 0) return now > 0 ? Infinity : null
  return ((now / prev) - 1) * 100
}

function XiToken({ row }) {
  const logo = row.image_small || row.image || row.image_url
  const [broken, setBroken] = useState(false)
  return (
    <span className="xi-token">
      {logo && !broken ? (
        <img
          className="xi-token__logo"
          src={String(logo).split('?')[0]}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="xi-token__fallback">{(row.symbol || '?').slice(0, 1)}</span>
      )}
      <span className="xi-token__names">
        <span className="xi-token__symbol">${row.symbol}</span>
        <span className="xi-token__name">{row.name}</span>
      </span>
      <ChainChip chain={row.chain} />
    </span>
  )
}

function RunnerRow({ entry, rank, liveMcap }) {
  const { row, score, tier, reasons, receipt } = entry
  const growth = mentionGrowthPct(row)
  const clean = Number(row.quality?.clean_signal_score_24h ?? row.clean_signal_score_24h)
  const roi = receipt ? Number(receipt.roi_pct) : null
  const peak = receipt ? Number(receipt.peak_roi_pct) : null
  // Live mcap priority: Codex-by-contract (on-chain truth, fixes non-CG degens
  // like $FEBU) → Spectre Market/CoinGecko overlay → frozen catalog fallback.
  const cMcap = Number(entry.contractMcap)
  const gMcap = Number(liveMcap)
  const mcap = cMcap > 0 ? cMcap : (gMcap > 0 ? gMcap : Number(row.market_cap))
  return (
    <tr className="xi-row">
      <td className="xi-td xi-td--rank xi-num">{rank}</td>
      <td className="xi-td xi-td--token"><XiToken row={row} /></td>
      <td className="xi-td xi-td--carriers">
        <CarrierStack authors={row.top_authors} total={row.unique_external_authors_24h ?? row.author_count} />
      </td>
      <td className="xi-td xi-td--signal">
        <ScoreBar score={score} tier={tier} />
        <span className={`xi-tier xi-tier--${tier}`}>{RUNNER_TIER_LABEL[tier]}</span>
      </td>
      <td className="xi-td xi-td--why">
        {(reasons || []).slice(0, 2).map((r, i) => (
          <span key={i} className={`xi-why xi-why--${r.tone}`}>{r.text}</span>
        ))}
      </td>
      <td className="xi-td xi-num">
        {fmtCount(row.external_mentions_24h) ?? '—'}
        {growth === Infinity ? (
          <span className="xi-sub xi-delta--up">new</span>
        ) : growth != null && Math.abs(growth) >= 5 ? (
          <span className={`xi-sub ${growth >= 0 ? 'xi-delta--up' : 'xi-delta--down'}`}>{fmtPct(growth, { digits: 0 })}</span>
        ) : null}
      </td>
      <td className="xi-td xi-num">{fmtCount(row.unique_external_authors_24h ?? row.author_count) ?? '—'}</td>
      <td className="xi-td xi-num">{Number.isFinite(clean) ? `${Math.round(clean * 100)}%` : '—'}</td>
      <td className="xi-td xi-num xi-td--mcap">{fmtUsdShort(mcap) ?? '—'}</td>
      <td className="xi-td xi-num">{receipt ? (fmtUsdShort(receipt.entry_market_cap) ?? '—') : '—'}</td>
      <td className={`xi-td xi-num ${Number.isFinite(roi) ? (roi >= 0 ? 'xi-delta--up' : 'xi-delta--down') : ''}`}>
        {Number.isFinite(roi) ? fmtPct(roi, { digits: 0 }) : '—'}
      </td>
      <td className="xi-td xi-num xi-td--peak">
        {Number.isFinite(peak) ? fmtPct(peak, { digits: 0 }) : '—'}
      </td>
    </tr>
  )
}

export default function XiRunners() {
  const [filter, setFilter] = useState('setups')
  const [sortKey, setSortKey] = useState('score')
  const { data, loading, error, refetch } = useXDashBootstrap(BOOTSTRAP_PARAMS, { refreshIntervalMs: 120_000 })
  const { byAsset } = useReceiptsLedger()

  // Live mcap overlay (Spectre Market + CoinGecko, 30s cache) keyed by cg_id —
  // replaces the frozen catalog market_cap the board ships.
  const cgIds = useMemo(
    () => (data?.tokens || []).map((t) => t.cg_id || t.token_id).filter(Boolean),
    [data],
  )
  const priceMap = useXDashPrices(cgIds)

  const entries = useMemo(() => {
    const rows = data?.tokens || []
    const scored = rows.map((row) => ({
      row,
      receipt: findReceipt(byAsset, row),
      ...computeRunnerScore(row),
    }))
    let filtered = scored
    if (filter === 'setups') {
      filtered = scored.filter((e) => {
        const mc = Number(e.row.market_cap) || 0
        return e.score >= RUNNER_MIN_SCORE && mc > 0 && mc <= RUNNER_MAX_MCAP
      })
    } else if (filter !== 'all') {
      filtered = scored.filter((e) => e.tier === filter)
    }
    return filtered.sort(SORTS[sortKey] || SORTS.score)
  }, [data, byAsset, filter, sortKey])

  // Contract-truth mcap overlay for the VISIBLE rows only (bounded + cached).
  const visibleRows = useMemo(() => entries.map((e) => e.row), [entries])
  const contractMcaps = useContractMcaps(visibleRows)

  const generatedAgo = fmtAgo(data?.generated_at_utc ? Date.parse(data.generated_at_utc) : null)

  if (loading && !data) return <XiShimmer variant="row" count={10} />
  if (error && !data) return <XiError message={String(error)} onRetry={refetch} />

  const sortHeader = (key, label) => (
    <button
      type="button"
      className={`xi-th-sort${sortKey === key ? ' xi-th-sort--on' : ''}`}
      onClick={() => setSortKey(key)}
    >
      {label}
    </button>
  )

  return (
    <div className="xi-runners-view">
      <div className="xi-toolbar">
        <div className="xi-pills" role="tablist" aria-label="Runner filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`xi-pill${filter === f.key ? ' xi-pill--on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="xi-toolbar__meta">
          re-scored from the live attention board
          {generatedAgo ? <span className="xi-ago"> · {generatedAgo}</span> : null}
        </span>
      </div>

      {entries.length === 0 ? (
        <XiEmpty
          title="Nothing clears the bar for this filter"
          detail="No token is accelerating cleanly off a low base right now. Widen the filter or check back as attention builds."
        />
      ) : (
        <div className="xi-table-scroll">
          <table className="xi-table">
            <thead>
              <tr>
                <th className="xi-th">#</th>
                <th className="xi-th xi-th--left">Token</th>
                <th className="xi-th xi-th--left" title="The KOL faces carrying this token — top external authors">Carriers</th>
                <th className="xi-th xi-th--left">{sortHeader('score', 'Signal')}</th>
                <th className="xi-th xi-th--left">Why</th>
                <th className="xi-th">{sortHeader('mentions', 'Mentions 24h')}</th>
                <th className="xi-th">Authors</th>
                <th className="xi-th">Clean</th>
                <th className="xi-th">{sortHeader('mcap', 'Market cap')}</th>
                <th className="xi-th" title="First-spotted market cap from the momentum_origin ledger">Spotted MC</th>
                <th className="xi-th" title="ROI since Spectre first spotted it — from the $1k-per-call ledger">{sortHeader('roi', 'ROI')}</th>
                <th className="xi-th" title="Peak ROI since spotted">Peak</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const cgId = entry.row.cg_id || entry.row.token_id
                const contract = entry.row.contract_address ? String(entry.row.contract_address).toLowerCase() : null
                return (
                  <RunnerRow
                    key={cgId || `${entry.row.symbol}-${i}`}
                    entry={{ ...entry, contractMcap: contract ? contractMcaps[contract] : null }}
                    rank={i + 1}
                    liveMcap={cgId ? priceMap[cgId]?.marketCap : null}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="xi-footnote">
        Signal = acceleration · mcap fit · clean crowd · rank climb · novelty, gated by promo / single-caller
        concentration. Receipts join by CoinGecko id — “—” means the ledger hasn’t spotted that token yet, not zero.
      </p>
    </div>
  )
}
