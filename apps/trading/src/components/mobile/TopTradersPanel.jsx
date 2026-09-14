/**
 * TopTradersPanel — ranked traders for the token, mobile AND desktop (DataTabs
 * mounts it for the tab). Prefix: tt-.
 *
 * PRIMARY source: Codex tokenTopTraders (getTokenTopTraders) - the token's whole
 * wallet index over DAY/WEEK/MONTH/YEAR, ranked by realized PnL or volume.
 * "Best" returns only wallets that closed the period in profit, "Worst" only
 * wallets that closed it at a loss - that is Codex's own contract for the
 * realizedProfitUsd ranking, so the two lists never overlap.
 *
 * FALLBACK: the tape-derived list DataTabs already computes (per-maker
 * aggregation over the loaded trade window). Used only when Codex answers with
 * an error, and labelled as such - the header note says which source is live.
 *
 * Fetches on mount, so it runs only when the Top Traders tab is active.
 * Tap a row -> maker action (sheet on mobile, filter-tape on desktop).
 */
import React, { useEffect, useState } from 'react'
import { ArrowUp, ArrowDown, ChevronRight } from 'lucide-react'
import { TierIcon, tierFromVolume } from './TraderTier'
import { getTokenTopTraders } from '../../services/codexApi'
import { isAppActive } from '../../lib/idleManager'
import './TopTradersPanel.css'

const fmtUsd = (usd) => {
  const n = Number(usd)
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`
  if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const fmtPct = (p) => {
  const n = Number(p)
  if (!Number.isFinite(n)) return null
  const a = Math.abs(n)
  // A 107,100% figure is real (a wallet that bought for $37 and sold for
  // $39K) but reads as a glitch - cap the display, keep the sign honest.
  if (a >= 10000) return `${n > 0 ? '+' : '-'}${(a / 1000).toFixed(0)}K%`
  if (a >= 100) return `${n > 0 ? '+' : '-'}${a.toFixed(0)}%`
  return `${n > 0 ? '+' : '-'}${a.toFixed(1)}%`
}

const fmtAge = (ms) => {
  if (!ms) return '—'
  const diff = Math.max(0, Date.now() - ms)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const truncAddr = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—')

const RANKS = [
  { id: 'best', label: 'Best' },
  { id: 'worst', label: 'Worst' },
  { id: 'volume', label: 'Volume' },
]
const PERIODS = [
  { id: 'DAY', label: '24h' },
  { id: 'WEEK', label: '7d' },
  { id: 'MONTH', label: '30d' },
  { id: 'YEAR', label: '1y' },
]

// Wallet categories worth a chip. NORMIE is the default and stays silent.
const CATEGORY_LABEL = {
  EXCHANGE: 'exchange',
  DEFI_EXCHANGE: 'dex',
  PAIR: 'pool',
  PAIR_TOKEN_HOLDER: 'pool',
  POOL_AUTHORITY: 'pool',
  STAKING_VAULT: 'vault',
  TOKEN_CREATOR: 'creator',
  LOCKER: 'locker',
  BURN: 'burn',
}

function CodexTraderRow({ tr, onMakerTap }) {
  const maker = tr.address
  const pnlPos = tr.realizedUsd > 0
  const pnlNeg = tr.realizedUsd < 0
  const pct = fmtPct(tr.realizedPct)
  const cat = tr.category && CATEGORY_LABEL[tr.category]
  // "holding" only when what is left is a real position, not dust: BONK's top
  // day trader holds 0.4 tokens after 102 round trips. Floor at 1% of bought.
  const holding = tr.balance > 0 && tr.bought > 0 && tr.balance / tr.bought >= 0.01
  return (
    <div
      className="tt-row"
      role={maker ? 'button' : undefined}
      tabIndex={maker ? 0 : undefined}
      onClick={maker ? () => onMakerTap?.(maker) : undefined}
      onKeyDown={maker ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMakerTap?.(maker) } } : undefined}
    >
      <span className={`tt-rank${tr.rank <= 3 ? ' tt-rank--top' : ''}`}>{tr.rank}</span>
      <span className={`tt-avatar ${pnlNeg ? 'tt-avatar--neg' : 'tt-avatar--pos'}`}>
        <TierIcon tier={tierFromVolume(tr.volumeUsd)} size={16} />
      </span>
      <div className="tt-main">
        <div className="tt-line1">
          <span className="tt-id">
            <span className="tt-addr" title={maker}>{tr.displayName || truncAddr(maker)}</span>
            {tr.isSmart && <span className="tt-chip tt-chip--smart" title="Codex smart-trader label: consistently profitable on tokens older than two days">smart</span>}
            {tr.isSniper && <span className="tt-chip" title="Codex sniper label: buys in the first blocks after launch">sniper</span>}
            {tr.isBot && <span className="tt-chip" title="Codex bot label or bot score of 70+">bot</span>}
            {tr.isFlagged && <span className="tt-chip tt-chip--warn" title="Codex scam heuristics score 80+ on this wallet">flagged</span>}
            {cat && <span className="tt-chip" title={`Wallet category: ${tr.category}`}>{cat}</span>}
          </span>
          <span className={`tt-pnl ${pnlPos ? 'is-pos' : pnlNeg ? 'is-neg' : ''}`} title="Realized PnL for the period">
            {pnlPos ? '+' : pnlNeg ? '−' : ''}{fmtUsd(Math.abs(tr.realizedUsd))}
            {pct && tr.realizedUsd !== 0 && <span className="tt-pnl-pct">{pct}</span>}
          </span>
        </div>
        <div className="tt-line2">
          <span className="tt-bought" title="Bought (USD) in the period"><ArrowUp size={10} strokeWidth={2.75} aria-hidden="true" />{fmtUsd(tr.boughtUsd)}</span>
          <span className="tt-sold" title="Sold (USD) in the period"><ArrowDown size={10} strokeWidth={2.75} aria-hidden="true" />{fmtUsd(tr.soldUsd)}</span>
          <span className="tt-meta">
            {tr.buys}b · {tr.sells}s
            {holding && <> · <span className="tt-holding" title="Still holds a position">holding</span></>}
          </span>
          <span className="tt-meta tt-meta--right">vol {fmtUsd(tr.volumeUsd)} · {fmtAge(tr.lastAt ? tr.lastAt * 1000 : 0)}</span>
        </div>
      </div>
      <ChevronRight className="tt-chev" size={14} strokeWidth={2} aria-hidden="true" />
    </div>
  )
}

// Tape-derived row (fallback only) - the pre-Codex shape: { maker, txns,
// bought, sold, volume, net, last }.
function TapeTraderRow({ rank, tr, onMakerTap }) {
  const maker = tr.maker
  const netPos = tr.net >= 0
  return (
    <div
      className="tt-row"
      role={maker ? 'button' : undefined}
      tabIndex={maker ? 0 : undefined}
      onClick={maker ? () => onMakerTap?.(maker) : undefined}
      onKeyDown={maker ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMakerTap?.(maker) } } : undefined}
    >
      <span className={`tt-rank${rank <= 3 ? ' tt-rank--top' : ''}`}>{rank}</span>
      <span className={`tt-avatar ${netPos ? 'tt-avatar--pos' : 'tt-avatar--neg'}`}>
        <TierIcon tier={tierFromVolume(tr.volume)} size={16} />
      </span>
      <div className="tt-main">
        <div className="tt-line1">
          <span className="tt-addr">{truncAddr(maker)}</span>
          <span className="tt-meta">{tr.txns} {tr.txns === 1 ? 'txn' : 'txns'} · {fmtAge(tr.last)}</span>
        </div>
        <div className="tt-line2">
          <span className="tt-bought"><ArrowUp size={10} strokeWidth={2.75} aria-hidden="true" />{fmtUsd(tr.bought)}</span>
          <span className="tt-sold"><ArrowDown size={10} strokeWidth={2.75} aria-hidden="true" />{fmtUsd(tr.sold)}</span>
          <span className={`tt-net ${netPos ? 'is-pos' : 'is-neg'}`}>{netPos ? '+' : '−'}{fmtUsd(Math.abs(tr.net))}</span>
        </div>
      </div>
      <ChevronRight className="tt-chev" size={14} strokeWidth={2} aria-hidden="true" />
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="tt-row tt-row--skel" aria-hidden="true">
      <span className="tt-skel tt-skel--rank" />
      <span className="tt-skel tt-skel--avatar" />
      <div className="tt-main">
        <div className="tt-line1"><span className="tt-skel tt-skel--w80" /><span className="tt-skel tt-skel--w50" /></div>
        <div className="tt-line2"><span className="tt-skel tt-skel--w60" /><span className="tt-skel tt-skel--w60" /></div>
      </div>
    </div>
  )
}

const EMPTY_COPY = {
  best: ['No wallet closed this period in profit.', 'Best traders are wallets with positive realized PnL.'],
  worst: ['No wallet closed this period at a loss.', 'Worst traders are wallets with negative realized PnL.'],
  volume: ['No trades in this period.', 'Try a longer period.'],
}

export default function TopTradersPanel({
  token,
  fallbackTraders = [],
  onMakerTap,
}) {
  const address = token?.address || null
  const networkId = token?.networkId || 1
  const [rank, setRank] = useState('best')
  const [period, setPeriod] = useState('DAY')
  // null = not loaded yet; otherwise { items, error } straight from the service.
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!address) { setResult({ items: [], error: null }); return }
    let cancelled = false
    setResult(null)

    const load = async () => {
      const r = await getTokenTopTraders(address, networkId, { period, rank, limit: 25 })
      if (!cancelled) setResult(r)
    }
    load()
    // Refresh while the tab stays open. 90s: the period aggregates move
    // slowly and the client cache is 60s, so this is at most one query a
    // minute per (token, period, rank), and none while hidden or idle.
    const t = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      load()
    }, 90_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [address, networkId, period, rank])

  const loading = result === null
  // Fall back to the tape-derived list ONLY when Codex could not be asked. An
  // honest empty answer ("nobody closed green today") stays empty - swapping
  // in the tape there would silently change what the list means.
  const useFallback = !loading && !!result.error && fallbackTraders.length > 0
  const codexRows = !loading && !useFallback ? result.items : []
  const empty = !loading && !useFallback && codexRows.length === 0

  return (
    <div className="tt" role="region" aria-label="Top traders">
      <div className="tt-head">
        <div className="tt-seg" role="tablist" aria-label="Ranking">
          {RANKS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={rank === r.id}
              className={`tt-seg-btn${rank === r.id ? ' is-active' : ''}${r.id === 'worst' ? ' tt-seg-btn--worst' : ''}`}
              onClick={() => setRank(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="tt-seg tt-seg--period" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              className={`tt-seg-btn${period === p.id ? ' is-active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="tt-note">
          {useFallback ? 'from loaded trades · by volume' : rank === 'volume' ? 'by traded volume' : 'by realized PnL'}
        </span>
      </div>

      {loading && (
        <div className="tt-body">
          {Array.from({ length: 10 }, (_, i) => <SkeletonRow key={i} />)}
        </div>
      )}

      {useFallback && (
        <div className="tt-body">
          {fallbackTraders.map((tr, i) => (
            <TapeTraderRow key={tr.maker} rank={i + 1} tr={tr} onMakerTap={onMakerTap} />
          ))}
        </div>
      )}

      {empty && (
        <div className="tt-empty">
          <p>{result.error ? 'Trader data unavailable right now.' : EMPTY_COPY[rank][0]}</p>
          <span>{result.error ? 'Codex did not answer - try again in a minute.' : EMPTY_COPY[rank][1]}</span>
        </div>
      )}

      {codexRows.length > 0 && (
        <div className="tt-body">
          {codexRows.map((tr) => (
            <CodexTraderRow key={tr.key} tr={tr} onMakerTap={onMakerTap} />
          ))}
        </div>
      )}
    </div>
  )
}
