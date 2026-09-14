/**
 * WalletsMobile — mobile render of the /wallets surface.
 *
 * Applies the Spectre mobile-crypto-ux language (see .claude/rules/
 * mobile-crypto-ux.md): content-on-void, identity → read → data rows, no
 * wide desktop tables. Every wide grid collapses to a token/entity/tape row.
 *
 * Prefix: wam-  ·  root keeps `.wlp` so the `.mono/.pos/.neg/.dim` utils +
 * day-mode overrides from wallets-page.css apply unchanged.
 *
 * Tabs: Flows · Screener · Perps · Tape. The desktop-only Flow Map (canvas
 * river) is intentionally dropped on mobile — the same dollars render as the
 * Flows stat grid + ledgers.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useWalletsLane, {
  fmtUsd, fmtQty, relTime, shortAddr, CHAIN_SHORT, tokenLogoUrl, explorerTxUrl, hlAddressUrl,
  isUglyToken, CHAIN_NETWORK_ID, STANCE_LABEL, READ_BADGE, tapeRead, tapeParty, matchesCohort, snapshotAge,
} from './use-wallets-data'
import { openTradingTerminal, isTradableContract } from '@/lib/trading-terminal'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import FlowRiverTab from './wallets-flow-river'
import LiveFlowPanel from './wallets-live-flow'

/* magnitude-graded change color (skill §B2) — applied to price % pills */
const magClass = (v) => {
  if (v == null) return ''
  const a = Math.abs(v)
  if (a >= 10) return ' wam-mag-3'
  if (a >= 5) return ' wam-mag-2'
  if (a >= 2) return ' wam-mag-1'
  return ' wam-mag-0'
}
const pctText = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`)

/* ── shared bits ── */

const Skeleton = ({ rows = 5 }) => (
  <div className="wam-skel">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className={`wam-skel-row animate-shimmer stagger-${(i % 5) + 1}`} />
    ))}
  </div>
)

const Seg = ({ options, value, onChange }) => (
  <div className="wam-seg" role="tablist">
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        role="tab"
        aria-selected={value === o.id}
        className={`wam-seg-btn${value === o.id ? ' active' : ''}`}
        onClick={() => onChange(o.id)}
      >
        {o.label}
      </button>
    ))}
  </div>
)

const TokenLogo = ({ symbol, chain, contract }) => {
  const logo = tokenLogoUrl(chain, contract)
  return logo
    ? <img className="wam-logo" src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
    : <span className="wam-logo wam-logo--fb">{String(symbol || '?').slice(0, 1)}</span>
}

/* Smart-money / screener flow row — collapses the wide desktop board table.
   Primary metric = netflow (colored, right); price % pill below. */
const FlowRow = ({ r, primaryKey = 'netflow24h' }) => {
  const navigate = useNavigate()
  const badge = READ_BADGE[r.attentionRead]
  const tradable = !!(r.contract && isTradableContract(r.contract))
  const flow = r[primaryKey]
  const open = () => {
    if (tradable) return openTradingTerminal(r.contract)
    navigate(buildResearchZoneLocation({
      symbol: r.symbol, address: r.contract, networkId: CHAIN_NETWORK_ID[r.chain] ?? null,
    }, false))
  }
  return (
    <button type="button" className="wam-row" onClick={open}>
      <TokenLogo symbol={r.symbol} chain={r.chain} contract={r.contract} />
      <span className="wam-row-id">
        <span className="wam-row-sym">{r.symbol}</span>
        <span className="wam-row-meta">
          {CHAIN_SHORT[r.chain] || r.chain}
          {badge && <span className={`wam-readbadge wam-readbadge--${r.attentionRead}`} title={badge.title}>{badge.label}</span>}
        </span>
      </span>
      <span className="wam-row-vals">
        <span className={`wam-row-flow mono ${(flow || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(flow, { sign: true })}</span>
        {r.priceChange24h != null && (
          <span className={`wam-pill${magClass(r.priceChange24h)} ${r.priceChange24h >= 0 ? 'pos' : 'neg'}`}>{pctText(r.priceChange24h)}</span>
        )}
      </span>
    </button>
  )
}

const StatCard = ({ label, value, sub, tone }) => (
  <div className="wam-stat">
    <span className="wam-stat-label">{label}</span>
    <span className={`wam-stat-value mono ${tone || ''}`}>{value}</span>
    {sub && <span className="wam-stat-sub">{sub}</span>}
  </div>
)

/* compact ledger sparkline (mirror of desktop LedgerBars) */
const LedgerBars = ({ series, valueKey = 'net' }) => {
  const max = useMemo(() => series.reduce((m, r) => Math.max(m, Math.abs(r[valueKey] || 0)), 0), [series, valueKey])
  return (
    <div className="wam-ledger-bars" aria-hidden>
      {series.map((r, i) => {
        const v = r[valueKey] || 0
        const h = max > 0 ? Math.max(6, Math.round((Math.abs(v) / max) * 100)) : 6
        return <span key={i} className={`wam-ledger-bar ${v >= 0 ? 'pos' : 'neg'}`} style={{ height: `${h}%` }} />
      })}
    </div>
  )
}

/* long/short balance meter (reused across Flows + Perps) */
const LongShortMeter = ({ longUsd = 0, shortUsd = 0 }) => {
  const total = longUsd + shortUsd
  const share = total > 0 ? longUsd / total : 0.5
  return (
    <>
      <div className="wam-ls-labels">
        <span className="pos mono">Long {fmtUsd(longUsd)}</span>
        <span className="neg mono">Short {fmtUsd(shortUsd)}</span>
      </div>
      <div className="wam-ls-meter" aria-hidden><span className="wam-ls-meter-long" style={{ width: `${Math.round(share * 100)}%` }} /></div>
    </>
  )
}

/* ── AI Read hero ── */

const MobileRead = ({ t }) => {
  const { data } = useWalletsLane('read')
  const read = data?.read
  if (!read) return null
  return (
    <section className={`wam-read wam-read--${read.stance || 'neutral'}`}>
      <div className="wam-read-top">
        <span className="wam-read-chip"><span className="wam-read-dot" aria-hidden />{t('walletsPage.aiRead', 'AI Money-Flow Read')}</span>
        <span className="wam-read-stance">{STANCE_LABEL[read.stance] || read.stance}</span>
      </div>
      <h2 className="wam-read-headline">{read.headline}</h2>
      <p className="wam-read-body">{read.body}</p>
    </section>
  )
}

/* ── Flows tab ── */

const MoneyWeather = ({ cmd, hl, t }) => {
  const total = useMemo(() => {
    if (!cmd) return null
    let s = 0
    s += Math.max(-25, Math.min(25, ((cmd.stables?.net24h || 0) / 500e6) * 25))
    const cexNet = (cmd.exchangeFlows?.byAsset || []).reduce((a, x) => a + (x.net || 0), 0)
    s += Math.max(-25, Math.min(25, (-cexNet / 1e9) * 25))
    const etfNet = (cmd.etf?.aggregates || []).reduce((a, x) => a + (x.flowUsd || 0), 0)
    s += Math.max(-20, Math.min(20, (etfNet / 200e6) * 20))
    const smNet = (cmd.smartMoney?.tokens || []).reduce((a, x) => a + (x.netflow24h || 0), 0)
    s += Math.max(-15, Math.min(15, (smNet / 500e3) * 15))
    if (hl?.totals && hl.totals.longUsd + hl.totals.shortUsd > 0) {
      const share = hl.totals.longUsd / (hl.totals.longUsd + hl.totals.shortUsd)
      s += (share - 0.5) * 2 * 15
    }
    return Math.max(-100, Math.min(100, s))
  }, [cmd, hl])
  if (total == null) return null
  const verdict = total > 20 ? t('walletsPage.wAccumulation', 'Accumulation')
    : total < -20 ? t('walletsPage.wDistribution', 'Distribution')
    : t('walletsPage.wMixed', 'Mixed tape')
  return (
    <section className="wam-weather">
      <div className="wam-weather-head">
        <span className="wam-label">{t('walletsPage.moneyWeather', 'Money Weather · 24h')}</span>
        <span className={`wam-weather-verdict ${total > 20 ? 'pos' : total < -20 ? 'neg' : ''}`}>{verdict}</span>
      </div>
      <div className="wam-weather-scale" aria-hidden>
        <span>{t('walletsPage.wDistribution', 'Distribution')}</span>
        <span>{t('walletsPage.wAccumulation', 'Accumulation')}</span>
      </div>
      <div className="wam-weather-gauge" aria-hidden>
        <span className="wam-weather-needle" style={{ left: `${Math.round((total + 100) / 2)}%` }} />
      </div>
    </section>
  )
}

const AlphaStrip = ({ t }) => {
  const { data } = useWalletsLane('board')
  const signals = useMemo(
    () => (data?.rows || []).filter((r) => r.attentionRead && READ_BADGE[r.attentionRead]).slice(0, 8),
    [data]
  )
  if (!signals.length) return null
  return (
    <div className="wam-section">
      <span className="wam-label">{t('walletsPage.alphaSignals', 'Alpha signals')}</span>
      <div className="wam-alpha-row">
        {signals.map((r) => {
          const badge = READ_BADGE[r.attentionRead]
          const clickable = !!(r.contract && isTradableContract(r.contract))
          return (
            <button key={`${r.chain}:${r.contract}`} type="button" className="wam-alpha-chip" onClick={() => clickable && openTradingTerminal(r.contract)} title={badge.title}>
              <span className={`wam-readbadge wam-readbadge--${r.attentionRead}`}>{badge.label}</span>
              <span className="wam-alpha-sym">{r.symbol}</span>
              <span className={`mono ${(r.netflow24h || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(r.netflow24h, { sign: true })}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const SM_FILTERS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'majors', label: 'Majors' },
  { id: 'all', label: 'All' },
]

const SmartMoney = ({ t }) => {
  const { data, loading } = useWalletsLane('board')
  // Same reasoning as the desktop board: an 8-hour tracker cadence has to be
  // visible, or the reader supplies "live" for free.
  const smAge = useMemo(() => {
    const newest = (data?.rows || []).reduce((m, r) => {
      const v = r.ts ? Date.parse(r.ts) : NaN
      return Number.isFinite(v) && v > m ? v : m
    }, 0)
    return newest ? snapshotAge(new Date(newest).toISOString(), 10 * 60) : null
  }, [data])
  const [filter, setFilter] = useState('tokens')
  const rows = useMemo(() => {
    let all = (data?.rows || []).filter((r) => !isUglyToken(r.symbol, r.name))
    if (filter === 'tokens') all = all.filter((r) => !r.isMajor && !r.isStable)
    else if (filter === 'majors') all = all.filter((r) => r.isMajor || r.isStable)
    return [...all].sort((a, b) => Math.abs(b.netflow24h || 0) - Math.abs(a.netflow24h || 0)).slice(0, 20)
  }, [data, filter])
  return (
    <div className="wam-section">
      <div className="wam-section-head">
        <span className="wam-label">
          {t('walletsPage.smartMoneyFlows', 'Smart Money Flows')}
          {smAge && (
            <span className={`wlp-age${smAge.stale ? ' is-stale' : ''}`}>
              {t('walletsPage.nansenAge', 'Nansen · {{a}} old', { a: smAge.text })}
            </span>
          )}
        </span>
        <Seg options={SM_FILTERS.map((f) => ({ ...f, label: t(`walletsPage.${f.id}`, f.label) }))} value={filter} onChange={setFilter} />
      </div>
      {loading && !data ? <Skeleton rows={5} /> : (
        <div className="wam-rows">
          {rows.map((r) => <FlowRow key={`${r.chain}:${r.contract}`} r={r} />)}
          {rows.length === 0 && <p className="wam-empty">{t('walletsPage.noSmRows', 'No smart-money flow captured in this bucket over the last 24h.')}</p>}
        </div>
      )}
    </div>
  )
}

const LedgerCard = ({ title, sub, series, valueKey, chips }) => (
  <section className="wam-card">
    <div className="wam-card-head">
      <span className="wam-card-title">{title}</span>
      <span className="wam-card-sub">{sub}</span>
    </div>
    <LedgerBars series={series} valueKey={valueKey} />
    <div className="wam-ledger-now">{chips}</div>
  </section>
)

const TapePreview = ({ cmd, t, onMore }) => {
  const rows = (cmd?.whaleTape || []).slice(0, 6)
  if (!rows.length) return null
  return (
    <div className="wam-section">
      <div className="wam-section-head">
        <span className="wam-label">{t('walletsPage.liveTape', 'Live Whale Tape')}</span>
        <button type="button" className="wam-more" onClick={onMore}>{t('walletsPage.fullTape', 'Full tape')} →</button>
      </div>
      <div className="wam-rows">
        {rows.map((row, i) => {
          const read = tapeRead(row)
          return (
            <a key={`${row.txHash}-${i}`} className="wam-tape-row" href={explorerTxUrl(row.txHash, row.chain)} target="_blank" rel="noopener noreferrer">
              <span className="mono dim wam-tape-time">{relTime(row.time)}</span>
              <span className={`wam-tapetag wam-tapetag--${read.tone}`}>{read.tag}</span>
              <span className="wam-tape-who">{row.fromLabel || row.toLabel || t('walletsPage.unlabeledWhale', 'Unlabeled whale')}</span>
              <span className="wam-tape-asset">{row.asset}</span>
              <span className="mono strong wam-tape-usd">{fmtUsd(row.usd)}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

const FlowsTab = ({ t, onGoTab }) => {
  const { data: cmd, loading } = useWalletsLane('command')
  const { data: hist } = useWalletsLane('history')
  const { data: hl } = useWalletsLane('hlDesks')

  const cexSeries = useMemo(() => {
    const byDay = new Map()
    for (const r of hist?.cex || []) { const k = String(r.day).slice(0, 10); byDay.set(k, { day: k, net: (byDay.get(k)?.net || 0) + (r.net || 0) }) }
    return [...byDay.values()]
  }, [hist])
  const etfSeries = useMemo(() => {
    const byDay = new Map()
    for (const r of hist?.etf || []) { const k = String(r.day).slice(0, 10); byDay.set(k, { day: k, net: (byDay.get(k)?.net || 0) + (r.flowUsd || 0) }) }
    return [...byDay.values()]
  }, [hist])

  if (loading && !cmd) return <Skeleton rows={6} />

  const s = cmd?.summary
  const stables = cmd?.stables
  const exFlows = cmd?.exchangeFlows
  const etf = cmd?.etf

  return (
    <div className="wam-tab">
      <div className="wam-stat-grid">
        <StatCard label={t('walletsPage.whaleVolume', 'Whale volume · 24h')} value={fmtUsd(s?.volumeUsd24h)} sub={`${s?.txCount24h ?? '—'} ${t('walletsPage.transfers', 'large transfers')}`} />
        <StatCard label={t('walletsPage.stablesNet', 'Stables net · 24h')} value={fmtUsd(stables?.net24h, { sign: true })} tone={(stables?.net24h || 0) >= 0 ? 'pos' : 'neg'} sub={(stables?.net24h || 0) >= 0 ? t('walletsPage.dryPowderIn', 'dry powder entering') : t('walletsPage.liquidityOut', 'liquidity redeemed')} />
        <StatCard label="BTC" value={fmtUsd(s?.byChain?.bitcoin?.volumeUsd)} sub={`${s?.byChain?.bitcoin?.txCount ?? '—'} tx`} />
        <StatCard label="ETH" value={fmtUsd(s?.byChain?.ethereum?.volumeUsd)} sub={`${s?.byChain?.ethereum?.txCount ?? '—'} tx`} />
      </div>

      <MoneyWeather cmd={cmd} hl={hl} t={t} />
      <AlphaStrip t={t} />
      <SmartMoney t={t} />

      {/* The free lane belongs on the phone as much as the desktop — it is the
          half of this page that is never more than four minutes old. */}
      <div className="wam-section wam-section--flow">
        <LiveFlowPanel t={t} maxRows={10} />
      </div>

      <div className="wam-section">
        <span className="wam-label">{t('walletsPage.flows', 'Flows · 30d')}</span>
        <LedgerCard
          title={t('walletsPage.cexFlows', 'CEX Net Flow · 30d')}
          sub={t('walletsPage.cexSub', 'positive = coins onto exchanges (sell-side)')}
          series={cexSeries}
          chips={(exFlows?.byAsset || []).slice(0, 3).map((a) => (
            <span key={a.asset} className="wam-ledger-chip">{a.asset} <b className={`mono ${a.net >= 0 ? 'neg' : 'pos'}`}>{fmtUsd(a.net, { sign: true })}</b></span>
          ))}
        />
        <LedgerCard
          title={t('walletsPage.etfFlows', 'Spot ETF Flow · 30d')}
          sub={t('walletsPage.etfSub', 'BTC + ETH funds, daily')}
          series={etfSeries}
          chips={(etf?.aggregates || []).map((a) => (
            <span key={a.asset} className="wam-ledger-chip">{a.asset} <b className={`mono ${(a.flowUsd || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(a.flowUsd, { sign: true })}</b></span>
          ))}
        />
        <LedgerCard
          title={t('walletsPage.stableLedger', 'Stablecoin Mint/Burn · 30d')}
          sub={t('walletsPage.stableSub', 'Circle + Tether treasury moves')}
          series={hist?.stables || []}
          chips={<>
            <span className="wam-ledger-chip">{t('walletsPage.minted', 'Minted')} <b className="mono pos">{fmtUsd(stables?.minted24h)}</b></span>
            <span className="wam-ledger-chip">{t('walletsPage.redeemed', 'Redeemed')} <b className="mono neg">{fmtUsd(stables?.redeemed24h)}</b></span>
          </>}
        />
      </div>

      <TapePreview cmd={cmd} t={t} onMore={() => onGoTab('tape')} />
    </div>
  )
}

/* ── Screener tab ── */

const SCR_VIEWS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'exchanges', label: 'Exchanges' },
]

const ScreenerTab = ({ t }) => {
  const { data: board, loading: bl } = useWalletsLane('board')
  const { data: scr, loading: sl } = useWalletsLane('screener')
  const [view, setView] = useState('tokens')
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const tokens = useMemo(() => {
    let rows = (board?.rows || []).filter((r) => !isUglyToken(r.symbol, r.name))
    if (query) rows = rows.filter((r) => String(r.symbol || '').toLowerCase().includes(query) || String(r.chain || '').includes(query))
    return [...rows].sort((a, b) => Math.abs(b.netflow24h || 0) - Math.abs(a.netflow24h || 0))
  }, [board, query])
  const wallets = useMemo(() => {
    let rows = scr?.wallets || []
    if (query) rows = rows.filter((r) => String(r.label || '').toLowerCase().includes(query) || String(r.topAsset || '').toLowerCase().includes(query))
    return [...rows].sort((a, b) => Math.abs(b.net24h || 0) - Math.abs(a.net24h || 0))
  }, [scr, query])
  const exchanges = useMemo(() => {
    let rows = scr?.exchanges || []
    if (query) rows = rows.filter((r) => String(r.exchange || '').toLowerCase().includes(query))
    return [...rows].sort((a, b) => Math.abs(b.net24h || 0) - Math.abs(a.net24h || 0))
  }, [scr, query])

  const loading = view === 'tokens' ? bl && !board : sl && !scr

  return (
    <div className="wam-tab">
      <div className="wam-section-head wam-section-head--stack">
        <Seg options={SCR_VIEWS.map((v) => ({ ...v, label: t(`walletsPage.scr_${v.id}`, v.label) }))} value={view} onChange={(v) => { setView(v); setQ('') }} />
      </div>
      <input type="search" className="wam-search" placeholder={t('walletsPage.searchPh', 'Filter…')} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />

      {loading ? <Skeleton rows={6} /> : (
        <div className="wam-rows">
          {view === 'tokens' && tokens.map((r) => <FlowRow key={`${r.chain}:${r.contract}`} r={r} />)}

          {view === 'wallets' && wallets.map((r) => (
            <div key={r.label} className="wam-entity-row">
              <span className="wam-entity-id">
                <span className="wam-row-sym">{r.label}</span>
                <span className="wam-row-meta">{r.topAsset || '—'} · {r.moves24h ?? 0} {t('walletsPage.moves', 'moves')}</span>
              </span>
              <span className="wam-row-vals">
                <span className={`wam-row-flow mono ${(r.net24h || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(r.net24h, { sign: true })}</span>
                <span className="wam-row-sub mono dim">{fmtUsd(r.vol7d)} · 7d</span>
              </span>
            </div>
          ))}

          {view === 'exchanges' && exchanges.map((r) => (
            <div key={r.exchange} className="wam-entity-row">
              <span className="wam-entity-id">
                <span className="wam-row-sym">{r.exchange}</span>
                <span className="wam-row-meta">{(r.net24h || 0) <= 0 ? t('walletsPage.coinsLeaving', 'coins leaving') : t('walletsPage.coinsArriving', 'coins arriving')} · {r.assets} {t('walletsPage.assets', 'assets')}</span>
              </span>
              <span className="wam-row-vals">
                <span className={`wam-row-flow mono ${(r.net24h || 0) >= 0 ? 'neg' : 'pos'}`}>{fmtUsd(r.net24h, { sign: true })}</span>
                <span className="wam-row-sub mono dim">7d {fmtUsd(r.net7d, { sign: true })}</span>
              </span>
            </div>
          ))}

          {((view === 'tokens' && !tokens.length) || (view === 'wallets' && !wallets.length) || (view === 'exchanges' && !exchanges.length)) && (
            <p className="wam-empty">{t('walletsPage.noMatch', 'Nothing matches this filter.')}</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Perps (Hyperliquid) tab ── */

const HL_SIDES = [
  { id: 'all', label: 'All' },
  { id: 'long', label: 'Longs' },
  { id: 'short', label: 'Shorts' },
]
const HL_VIEWS = [
  { id: 'positioning', label: 'Positions' },
  { id: 'desks', label: 'Leaderboard' },
]

const PerpsTab = ({ t }) => {
  const { data, loading } = useWalletsLane('hlDesks')
  const [side, setSide] = useState('all')
  const [view, setView] = useState('positioning')

  if (loading && !data) return <Skeleton rows={6} />

  const totals = data?.totals
  const hlAge = snapshotAge(totals?.positionsTs)
  const skew = (data?.skew || []).slice(0, 12)
  const desks = (data?.desks || []).slice(0, 30)
  const positions = (data?.positions || []).filter((p) => side === 'all' || p.side === side).sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0)).slice(0, 40)
  const longShare = totals && totals.longUsd + totals.shortUsd > 0 ? totals.longUsd / (totals.longUsd + totals.shortUsd) : null

  return (
    <div className="wam-tab">
      <section className="wam-hero">
        <span className="wam-label">{t('walletsPage.hlTitle', 'Smart Perp Desks')}</span>
        {/* The desktop hero carried the snapshot age and this one did not, so
            mobile was the surface actually claiming a live feed. */}
        <span className="wam-hero-sub">
          {t('walletsPage.hlSub', '{{n}} most profitable Hyperliquid accounts · open positions', { n: totals?.desks ?? '—' })}
          {hlAge && (
            <span className={`wlp-age${hlAge.stale ? ' is-stale' : ''}`}>
              {t('walletsPage.snapAge', 'snapshot {{a}} old', { a: hlAge.text })}
            </span>
          )}
        </span>
        <LongShortMeter longUsd={totals?.longUsd} shortUsd={totals?.shortUsd} />
        <span className="wam-hero-note">
          {longShare == null ? '—'
            : longShare > 0.65 ? t('walletsPage.crowdLong', 'Smart perps lean firmly LONG')
            : longShare < 0.35 ? t('walletsPage.crowdShort', 'Smart perps lean firmly SHORT')
            : t('walletsPage.crowdBalanced', 'Positioning near balanced')}
          {' · '}uPnL <b className={`mono ${(totals?.uPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(totals?.uPnl, { sign: true })}</b>
        </span>
      </section>

      <div className="wam-section">
        <span className="wam-label">{t('walletsPage.hlSkew', 'Where the smart desks are positioned')}</span>
        <div className="wam-rows">
          {skew.map((sk) => (
            <div key={sk.coin} className="wam-skew-row">
              <span className="wam-row-sym">{sk.coin}</span>
              <span className="wam-hl-share" aria-hidden><span className="wam-hl-share-long" style={{ width: `${Math.round((sk.longShare ?? 0) * 100)}%` }} /></span>
              <span className={`mono strong wam-skew-net ${(sk.netUsd || 0) >= 0 ? 'pos' : 'neg'}`}>{(sk.netUsd || 0) >= 0 ? 'L ' : 'S '}{fmtUsd(Math.abs(sk.netUsd))}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="wam-section-head wam-section-head--stack">
        <Seg options={HL_VIEWS.map((v) => ({ ...v, label: t(`walletsPage.${v.id === 'positioning' ? 'livePositions' : 'leaderboard'}`, v.label) }))} value={view} onChange={setView} />
        {view === 'positioning' && (
          <Seg options={HL_SIDES.map((f) => ({ ...f, label: t(`walletsPage.${f.id}Side`, f.label) }))} value={side} onChange={setSide} />
        )}
      </div>

      <div className="wam-rows">
        {view === 'positioning' ? (
          <>
            {positions.map((p, i) => (
              <a key={`${p.address}-${p.coin}-${i}`} className="wam-pos-row" href={hlAddressUrl(p.address)} target="_blank" rel="noopener noreferrer">
                <span className="wam-pos-id">
                  <span className="wam-row-sym">{p.coin}</span>
                  <span className={`wam-side wam-side--${p.side}`}>{p.side === 'long' ? 'LONG' : 'SHORT'}{p.leverage ? ` ${p.leverage}×` : ''}</span>
                </span>
                <span className="wam-row-vals">
                  <span className="mono strong wam-row-flow">{fmtUsd(p.valueUsd)}</span>
                  <span className={`wam-row-sub mono ${(p.uPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(p.uPnl, { sign: true })}</span>
                </span>
              </a>
            ))}
            {positions.length === 0 && <p className="wam-empty">{t('walletsPage.noPositions', 'No open positions match this filter.')}</p>}
          </>
        ) : (
          desks.map((d) => (
            <a key={d.address} className="wam-pos-row" href={hlAddressUrl(d.address)} target="_blank" rel="noopener noreferrer">
              <span className="wam-pos-id">
                <span className="wam-row-sym mono">#{d.rank} {shortAddr(d.address)}</span>
                <span className="wam-row-meta">{t('walletsPage.accountValue', 'Account')} {fmtUsd(d.accountValue)}{d.roiMonth != null ? ` · ROI ${(d.roiMonth * 100).toFixed(0)}%` : ''}</span>
              </span>
              <span className="wam-row-vals">
                <span className={`mono strong wam-row-flow ${(d.pnlMonth || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(d.pnlMonth, { sign: true })}</span>
                <span className="wam-row-sub mono dim">30d PnL</span>
              </span>
            </a>
          ))
        )}
      </div>
    </div>
  )
}

/* ── Tape tab ── */

const TAPE_CHAINS = [
  { id: 'all', label: 'All' },
  { id: 'bitcoin', label: 'BTC' },
  { id: 'ethereum', label: 'ETH' },
]
const TAPE_MINS = [
  { id: 0, label: 'All' },
  { id: 5e6, label: '≥ $5M' },
  { id: 10e6, label: '≥ $10M' },
]
const TAPE_COHORT_OPTS = [
  { id: 'all', label: 'All' },
  { id: 'exchange', label: 'CEX' },
  { id: 'stables', label: 'Stables' },
  { id: 'fund', label: 'Funds' },
  { id: 'whale', label: 'Whales' },
]

/* Filters live on the shell so the Flow Map can seed them on a lane tap. */
const TapeTab = ({ t, filters, onFilters }) => {
  const { data, loading } = useWalletsLane('command')
  const { chain, minUsd, cohort } = filters
  const set = (patch) => onFilters({ ...filters, ...patch })
  const rows = useMemo(() => (data?.whaleTape || []).filter((r) => (chain === 'all' || r.chain === chain)
    && (r.usd || 0) >= minUsd
    && matchesCohort(r, cohort)), [data, chain, minUsd, cohort])

  if (loading && !data) return <Skeleton rows={7} />

  return (
    <div className="wam-tab">
      <div className="wam-section-head wam-section-head--stack">
        <Seg options={TAPE_CHAINS} value={chain} onChange={(v) => set({ chain: v })} />
        <Seg options={TAPE_MINS} value={minUsd} onChange={(v) => set({ minUsd: v })} />
        <Seg options={TAPE_COHORT_OPTS} value={cohort} onChange={(v) => set({ cohort: v })} />
      </div>
      <div className="wam-rows">
        {rows.map((row, i) => {
          const read = tapeRead(row)
          const from = tapeParty(row.fromLabel, t('walletsPage.unknown', 'Unknown'))
          const to = tapeParty(row.toLabel, t('walletsPage.unknown', 'Unknown'))
          return (
            <a key={`${row.txHash}-${i}`} className="wam-tape-row wam-tape-row--full" href={explorerTxUrl(row.txHash, row.chain)} target="_blank" rel="noopener noreferrer">
              <span className="mono dim wam-tape-time">{relTime(row.time)}</span>
              <span className={`wam-tapetag wam-tapetag--${read.tone}`}>{read.tag}</span>
              <span className="wam-tape-who">
                {row.fromLabel || row.toLabel
                  ? <>
                      <span className={from.raw ? 'wam-party--addr' : undefined}>{from.text}</span>
                      <span className="wam-tape-arrow" aria-hidden> → </span>
                      <span className={to.raw ? 'wam-party--addr' : undefined}>{to.text}</span>
                    </>
                  : t('walletsPage.unlabeledWhale', 'Unlabeled whale')}
              </span>
              <span className="wam-tape-asset">{row.asset}</span>
              <span className="wam-tape-val">
                <span className="mono strong wam-tape-usd">{fmtUsd(row.usd)}</span>
                {row.amount != null && <span className="mono dim wam-tape-qty">{fmtQty(row.amount)} {row.asset}</span>}
              </span>
            </a>
          )
        })}
        {rows.length === 0 && <p className="wam-empty">{t('walletsPage.tapeEmpty', 'No transfers match these filters in the last 24h.')}</p>}
      </div>
    </div>
  )
}

/* ── Page ── */

const TABS = [
  { id: 'flows', label: 'Flows' },
  { id: 'river', label: 'Flow Map' },
  { id: 'screener', label: 'Screener' },
  { id: 'perps', label: 'Perps' },
  { id: 'tape', label: 'Tape' },
]

const TAPE_FILTER_DEFAULTS = { chain: 'all', minUsd: 0, cohort: 'all' }

const WalletsMobile = ({ t }) => {
  const [tab, setTab] = useState('flows')
  const [tapeFilters, setTapeFilters] = useState(TAPE_FILTER_DEFAULTS)

  /* Same canonical tab ids as desktop; mobile calls the perps tab 'perps'. */
  const goTab = (next, seed) => {
    if (seed) setTapeFilters((f) => ({ ...f, ...seed }))
    setTab(next === 'hyperliquid' ? 'perps' : next)
  }

  return (
    <div className="wlp wam">
      <div className="wam-spacer" aria-hidden />

      <header className="wam-head">
        <span className="wam-eyebrow">{t('walletsPage.title', 'Wallets')}</span>
        <h1 className="wam-headline">{t('walletsPage.mobileHeadline', 'Where the big money moved')}</h1>
      </header>

      <MobileRead t={t} />

      <nav className="wam-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`wam-tab-btn${tab === x.id ? ' active' : ''}`} onClick={() => setTab(x.id)}>
            {t(`walletsPage.tab_${x.id}`, x.label)}
          </button>
        ))}
      </nav>

      {tab === 'flows' && <FlowsTab t={t} onGoTab={goTab} />}
      {tab === 'river' && <div className="wam-tab"><FlowRiverTab t={t} variant="mobile" onGoTab={goTab} /></div>}
      {tab === 'screener' && <ScreenerTab t={t} />}
      {tab === 'perps' && <PerpsTab t={t} />}
      {tab === 'tape' && <TapeTab t={t} filters={tapeFilters} onFilters={setTapeFilters} />}
    </div>
  )
}

export default WalletsMobile
