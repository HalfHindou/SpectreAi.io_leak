/**
 * LIFECYCLE — the wallet → social → price surface.
 *
 * A token isn't a score, it's a STAGE in a cycle. Three clocks per token, read
 * as a sequence (not a fixed order): WALLET (Nansen smart-money netflow) ·
 * SOCIAL (X-Dash mention velocity) · PRICE (24h). The fusion places it in a
 * lifecycle stage — accumulation → ignition → expansion → distribution →
 * markdown — with an INSIDER flag (smart money in a young/quiet token) and a
 * DIVERGENCE flag (24h flow fighting the 7d trend). The edge is catching
 * ignition early and distribution before the dump.
 */
import { useMemo, useState } from 'react'
import { useLifecycle } from './use-x-intel-data'
import { fmtUsdShort, fmtPct, fmtCount, ChainChip, CaRow, ScoreBar, XiShimmer, XiEmpty, XiError } from './xi-bits'

// signed USD for netflow (fmtUsdShort drops negatives — smart money SELLS too)
function fmtFlow(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return null
  const abs = fmtUsdShort(Math.abs(n))
  return abs ? (n > 0 ? `+${abs}` : `-${abs}`) : null
}

const STAGE_META = {
  accumulation: { label: 'Accumulation', blurb: 'smart money in, crowd asleep' },
  ignition:     { label: 'Ignition',     blurb: 'wallet + social firing, price flat' },
  expansion:    { label: 'Expansion',    blurb: 'running, crowd in' },
  distribution: { label: 'Distribution', blurb: 'smart money selling into strength' },
  markdown:     { label: 'Markdown',     blurb: 'smart money out, price fading' },
  neutral:      { label: 'Neutral',      blurb: 'no clear sequence yet' },
}

// the order the surface leads with — earliest/most actionable first
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'accumulation', label: 'Accumulation' },
  { key: 'ignition', label: 'Ignition' },
  { key: 'distribution', label: 'Distribution' },
]

const walletDot = (read) => (read === 'accumulating' ? 'bull' : read === 'distributing' ? 'bear' : 'muted')
const socialDot = (read) => (read === 'igniting' ? 'hot' : read === 'active' ? 'warm' : read === 'quiet' ? 'dim' : 'muted')
const priceDot = (read) => (read === 'up' ? 'bull' : read === 'down' ? 'bear' : 'muted')
const volumeDot = (read) => (read === 'high' ? 'hot' : read === 'moderate' ? 'warm' : read === 'thin' ? 'dim' : 'muted')
// strength tier gates the bar's read-out so a weak "valid?" signal is obvious
const strengthTier = (n) => (n >= 66 ? 'strong' : n >= 40 ? 'building' : 'weak')

const barTone = (n) => (n >= 66 ? 'strong' : n >= 40 ? 'building' : 'weak')

function Clock({ label, dot, read, value, strength }) {
  // money + price are directional — tint the number bull/bear; attention stays neutral
  const valTone = (dot === 'bull' || dot === 'bear') ? ` xi-lc-clock__val--${dot}` : ''
  const st = Number.isFinite(strength) ? strength : 0
  return (
    <div className="xi-lc-clock">
      <span className="xi-lc-clock__label">{label}</span>
      <span className="xi-lc-clock__read">
        <span className={`xi-lc-dot xi-lc-dot--${dot}`} />
        {read}
      </span>
      <span className={`xi-lc-clock__val xi-num${value ? valTone : ''}`}>{value ?? '—'}</span>
      <span className={`xi-lc-clock__bar xi-lc-clock__bar--${barTone(st)}`} title={`${label} strength ${st}/100`}>
        <span className="xi-lc-clock__fill" style={{ width: `${st}%` }} />
      </span>
    </div>
  )
}

// the X Dash-style smart-money tag
const SM_TAG = {
  accumulating: { cls: 'acc', label: 'SM ↑' },
  distributing: { cls: 'dist', label: 'SM ↓' },
  flat: { cls: 'flat', label: 'SM ·' },
}

function LifecycleCard({ t }) {
  const stage = STAGE_META[t.stage] || STAGE_META.neutral
  const mcap = fmtUsdShort(t.market_cap_usd)
  const w = t.wallet || {}
  const s = t.social || {}
  const p = t.price || {}
  return (
    <article className={`xi-lc-card xi-lc-card--${t.stage || 'neutral'}`}>
      <header className="xi-lc-card__head">
        <div className="xi-lc-card__id">
          <span className="xi-lc-sym">${t.symbol}</span>
          <ChainChip chain={t.chain} />
        </div>
        <div className="xi-lc-card__stage">
          {mcap ? <span className="xi-lc-mcap xi-num">{mcap}</span> : null}
          {t.sm_backed && SM_TAG[t.sm_backed] ? (
            <span className={`xi-lc-sm xi-lc-sm--${SM_TAG[t.sm_backed].cls}`} title={`Smart money ${t.sm_backed} this token`}>{SM_TAG[t.sm_backed].label}</span>
          ) : null}
          <span className={`xi-lc-badge xi-lc-badge--${t.stage || 'neutral'}`}>
            <span className="xi-lc-dot" />{stage.label}
          </span>
        </div>
      </header>

      <p className="xi-lc-blurb">{stage.blurb}</p>

      <div className={`xi-lc-strength xi-lc-strength--${strengthTier(t.signal_strength)}`} title="Composite of all four clocks — how strongly the read is backed. Smart-money weighted highest; volume gates it (a signal you can't trade isn't valid).">
        <span className="xi-lc-strength__label">Signal</span>
        <ScoreBar score={t.signal_strength} />
        <span className="xi-lc-strength__tier">{strengthTier(t.signal_strength)}</span>
      </div>

      <div className="xi-lc-flow" role="group" aria-label="wallet, social, price and volume clocks">
        <Clock label="Wallet" dot={walletDot(w.read)} read={w.read || 'no data'} value={fmtFlow(w.net_flow_24h_usd)} strength={w.strength} />
        <span className="xi-lc-arrow" aria-hidden="true">→</span>
        <Clock
          label="Social"
          dot={socialDot(s.read)}
          read={s.read || 'silent'}
          value={s.mentions_24h ? `${fmtCount(s.mentions_24h)} mentions` : null}
          strength={s.strength}
        />
        <span className="xi-lc-arrow" aria-hidden="true">→</span>
        <Clock label="Price" dot={priceDot(p.read)} read={p.read || 'unknown'} value={fmtPct(p.change_24h_pct)} strength={p.strength} />
        <span className="xi-lc-arrow xi-lc-arrow--dot" aria-hidden="true">·</span>
        <Clock label="Volume" dot={volumeDot((t.volume || {}).read)} read={(t.volume || {}).read || 'unknown'} value={fmtUsdShort((t.volume || {}).volume_24h_usd)} strength={(t.volume || {}).strength} />
      </div>

      <div className="xi-lc-meta">
        {(t.insider || t.divergence) ? (
          <span className="xi-lc-flags">
            {t.insider ? <span className="xi-lc-flag xi-lc-flag--insider" title="Smart money accumulating a young / quiet token before it is obvious">insider</span> : null}
            {t.divergence ? <span className="xi-lc-flag xi-lc-flag--div" title="24h smart-money flow is fighting the 7d trend — a turning point or a trap">divergence</span> : null}
          </span>
        ) : <span />}
        <span className="xi-lc-substats">
          {Number.isFinite(w.smart_traders) ? <span className="xi-num" title="distinct smart-money wallets">{w.smart_traders} smart</span> : null}
          {fmtFlow(w.net_flow_7d_usd) ? <span className="xi-num" title="smart-money netflow, 7 days">{fmtFlow(w.net_flow_7d_usd)} 7d</span> : null}
          {Number.isFinite(w.token_age_days) ? <span className="xi-num" title="token age">{w.token_age_days}d old</span> : null}
        </span>
      </div>

      <CaRow address={t.token_address} chain={t.chain} symbol={t.symbol} />
    </article>
  )
}

const SOURCES = [
  { key: 'trending', label: 'Trending' },
  { key: 'smart', label: 'Smart Money' },
]

export default function XiLifecycle() {
  const [source, setSource] = useState('trending')
  const { rows, meta, loading, error, refetch } = useLifecycle({ source })
  const [filter, setFilter] = useState('all')

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.stage === filter)),
    [rows, filter],
  )

  if (loading && !rows.length) return <XiShimmer variant="card" count={6} />
  if (error && !rows.length) return <XiError message={String(error.message || error)} onRetry={refetch} />

  const ageMin = meta?.wallet_age_min
  const smCount = meta?.sm_backed_count

  return (
    <div className="xi-lc">
      <div className="xi-lc-intro">
        <p className="xi-lc-intro__lead">
          {source === 'trending' ? (
            <>What crypto Twitter is <strong>actually trading</strong> — each token stamped with whether <strong>smart money</strong> is backing it. Four clocks (wallet · social · price · volume) with a strength bar each; the composite tells you if it's a valid signal.</>
          ) : (
            <>Where <strong>smart money</strong> is moving first — each token read as a <strong>stage in a cycle</strong>, not a score. Catch <strong>ignition</strong> early; spot <strong>distribution</strong> before the dump.</>
          )}
        </p>
        <div className="xi-lc-source" role="tablist" aria-label="Lifecycle source">
          {SOURCES.map((sv) => (
            <button
              key={sv.key}
              type="button"
              role="tab"
              aria-selected={source === sv.key}
              className={`xi-lc-source__opt${source === sv.key ? ' xi-lc-source__opt--on' : ''}`}
              onClick={() => setSource(sv.key)}
            >
              {sv.label}
            </button>
          ))}
          {Number.isFinite(smCount) && smCount > 0 ? <span className="xi-lc-source__note">{smCount} smart-money backed</span> : null}
        </div>
        {meta?.wallet_stale && Number.isFinite(ageMin) ? (
          <p className="xi-lc-intro__note">
            Smart-money feed {ageMin >= 60 ? `${Math.round(ageMin / 60)}h` : `${ageMin}m`} old — test-key credits paused; the SM tag refreshes on a funded key.
          </p>
        ) : null}
      </div>

      <nav className="xi-lc-filters" aria-label="Filter by lifecycle stage">
        {FILTERS.map((f) => {
          const n = f.key === 'all' ? rows.length : rows.filter((r) => r.stage === f.key).length
          return (
            <button
              key={f.key}
              type="button"
              className={`xi-lc-filter${filter === f.key ? ' xi-lc-filter--on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}{n ? <span className="xi-lc-filter__n xi-num">{n}</span> : null}
            </button>
          )
        })}
      </nav>

      {shown.length ? (
        <div className="xi-lc-grid">
          {shown.map((t) => <LifecycleCard key={`${t.chain}:${t.token_address}`} t={t} />)}
        </div>
      ) : (
        <XiEmpty
          title={rows.length ? 'No tokens in this stage right now' : 'Smart-money feed warming up'}
          detail={rows.length ? 'The market rotates — check another stage or back soon.' : 'The wallet lane is indexing. Stages appear as smart-money, social and price line up.'}
        />
      )}
    </div>
  )
}
