/**
 * WalletsPage — full wallet-analysis surface.
 *
 * Zones:
 *   · AI Read hero — the Brain's layman's-terms money-flow brief (Groq,
 *     written box-side from measured flows only)
 *   · Tabs: Flows · Smart Money · Hyperliquid · Tape
 *     - Flows: whale radar stats + 30d CEX/ETF/stables ledgers + entities
 *     - Smart Money: full Nansen-cache netflow board with holdings + buzz
 *       joins and the flow×attention read
 *     - Hyperliquid: smart-desk positioning — cohort long/short meter,
 *       per-asset skew, PnL leaderboard, live positions (keyless HL API)
 *     - Tape: filterable labeled whale-transfer feed (BTC + ETH lanes)
 *
 * Every lane reads box-side caches — zero external API spend from this page.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useWalletsLane, {
  fmtUsd, fmtQty, relTime, snapshotAge, shortAddr, CHAIN_SHORT, tokenLogoUrl, explorerTxUrl, hlAddressUrl,
  isUglyToken, CHAIN_NETWORK_ID, STANCE_LABEL, READ_BADGE, tapeRead, tapeParty, matchesCohort,
} from './use-wallets-data'
import { openTradingTerminal, isTradableContract } from '@/lib/trading-terminal'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import FlowRiverTab from './wallets-flow-river'
import LiveFlowPanel from './wallets-live-flow'
import WalletsMobile from './wallets-mobile'
import EtfFlowsView from '@/components/etf/etf-flows-view'
import './wallets-page.css'
import './wallets-page.day-mode.css'
import './wallets-page.mobile.css'

/* Per-row actions: open Research Zone (free client route) or the trading
   terminal. stopPropagation so they coexist with the row's own click. */
const RowActions = ({ row }) => {
  const navigate = useNavigate()
  const tradable = !!(row.contract && isTradableContract(row.contract))
  const openRz = (e) => {
    e.stopPropagation()
    navigate(buildResearchZoneLocation({
      symbol: row.symbol,
      address: row.contract,
      networkId: CHAIN_NETWORK_ID[row.chain] ?? null,
    }, false))
  }
  const openTrade = (e) => {
    e.stopPropagation()
    if (tradable) openTradingTerminal(row.contract)
  }
  return (
    <span className="wlp-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="wlp-action" onClick={openRz} title="Open in Research Zone">RZ</button>
      {tradable && <button type="button" className="wlp-action wlp-action--trade" onClick={openTrade} title="Open in the trading terminal">Trade</button>}
    </span>
  )
}

function TokenIdent({ symbol, chain, contract }) {
  const logo = tokenLogoUrl(chain, contract)
  return (
    <span className="wlp-ident">
      {logo
        ? <img className="wlp-ident-logo" src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        : <span className="wlp-ident-logo wlp-ident-logo--fb">{String(symbol || '?').slice(0, 1)}</span>}
      <span className="wlp-ident-sym">{symbol}</span>
      <span className="wlp-ident-chain">{CHAIN_SHORT[chain] || chain}</span>
    </span>
  )
}

/* ── AI Read hero ── */

const AiReadHero = ({ t }) => {
  const { data } = useWalletsLane('read')
  const read = data?.read
  if (!read) return null
  return (
    <section className={`wlp-read wlp-read--${read.stance || 'neutral'}`}>
      <div className="wlp-read-main">
        <div className="wlp-read-top">
          <span className="wlp-read-chip">
            <span className="wlp-read-dot" aria-hidden />
            {t('walletsPage.aiRead', 'AI Money-Flow Read')}
          </span>
          <span className="wlp-read-stance">{STANCE_LABEL[read.stance] || read.stance}</span>
          <span className="wlp-read-time">{relTime(read.generatedAt)} {t('walletsPage.ago', 'ago')}</span>
        </div>
        <h2 className="wlp-read-headline">{read.headline}</h2>
        <p className="wlp-read-body">{read.body}</p>
      </div>
      {read.bullets?.length > 0 && (
        <ul className="wlp-read-bullets">
          {read.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
    </section>
  )
}

/* ── Money Weather — one gauge from every flow lane ── */

const MoneyWeather = ({ cmd, hl, t }) => {
  const factors = useMemo(() => {
    if (!cmd) return null
    const f = []
    const stablesNet = cmd.stables?.net24h || 0
    f.push({ key: 'stables', label: t('walletsPage.wStables', 'Stablecoins'), score: Math.max(-25, Math.min(25, (stablesNet / 500e6) * 25)), note: stablesNet >= 0 ? t('walletsPage.wMinting', 'minting') : t('walletsPage.wRedeeming', 'redeeming') })
    const cexNet = (cmd.exchangeFlows?.byAsset || []).reduce((s, a) => s + (a.net || 0), 0)
    f.push({ key: 'cex', label: 'CEX', score: Math.max(-25, Math.min(25, (-cexNet / 1e9) * 25)), note: cexNet <= 0 ? t('walletsPage.wLeaving', 'coins leaving') : t('walletsPage.wArriving', 'coins arriving') })
    const etfNet = (cmd.etf?.aggregates || []).reduce((s, a) => s + (a.flowUsd || 0), 0)
    f.push({ key: 'etf', label: 'ETF', score: Math.max(-20, Math.min(20, (etfNet / 200e6) * 20)), note: etfNet >= 0 ? t('walletsPage.wBuying', 'funds buying') : t('walletsPage.wSelling', 'funds selling') })
    const toks = cmd.smartMoney?.tokens || []
    const smNet = toks.reduce((s, x) => s + (x.netflow24h || 0), 0)
    f.push({ key: 'sm', label: t('walletsPage.wSmart', 'Smart money'), score: Math.max(-15, Math.min(15, (smNet / 500e3) * 15)), note: smNet >= 0 ? t('walletsPage.wAccumulating', 'accumulating') : t('walletsPage.wDistributing', 'distributing') })
    if (hl?.totals && hl.totals.longUsd + hl.totals.shortUsd > 0) {
      const share = hl.totals.longUsd / (hl.totals.longUsd + hl.totals.shortUsd)
      f.push({ key: 'perps', label: t('walletsPage.wPerps', 'Smart perps'), score: (share - 0.5) * 2 * 15, note: share > 0.55 ? t('walletsPage.wLeanLong', 'lean long') : share < 0.45 ? t('walletsPage.wLeanShort', 'lean short') : t('walletsPage.wBalanced', 'balanced') })
    }
    return f
  }, [cmd, hl, t])

  if (!factors) return null
  const total = Math.max(-100, Math.min(100, factors.reduce((s, x) => s + x.score, 0)))
  const verdict = total > 20 ? t('walletsPage.wAccumulation', 'Accumulation')
    : total < -20 ? t('walletsPage.wDistribution', 'Distribution')
    : t('walletsPage.wMixed', 'Mixed tape')

  return (
    <section className="wlp-card wlp-weather">
      <div className="wlp-weather-left">
        <span className="wlp-stat-label">{t('walletsPage.moneyWeather', 'Money Weather · 24h')}</span>
        <span className={`wlp-weather-verdict ${total > 20 ? 'pos' : total < -20 ? 'neg' : ''}`}>{verdict}</span>
      </div>
      <div className="wlp-weather-gauge-wrap">
        <div className="wlp-weather-scale" aria-hidden>
          <span>{t('walletsPage.wDistribution', 'Distribution')}</span>
          <span>{t('walletsPage.wAccumulation', 'Accumulation')}</span>
        </div>
        <div className="wlp-weather-gauge" aria-hidden>
          <span className="wlp-weather-needle" style={{ left: `${Math.round((total + 100) / 2)}%` }} />
        </div>
      </div>
      <div className="wlp-weather-factors">
        {factors.map((f) => (
          <span key={f.key} className={`wlp-weather-factor ${f.score > 3 ? 'pos' : f.score < -3 ? 'neg' : ''}`} title={`${f.label}: ${f.note}`}>
            {f.score > 3 ? '▲' : f.score < -3 ? '▼' : '·'} {f.label}
          </span>
        ))}
      </div>
    </section>
  )
}

/* ── Alpha signals strip (flow × attention) ── */

const AlphaStrip = ({ t }) => {
  const { data } = useWalletsLane('board')
  const signals = useMemo(
    () => (data?.rows || []).filter((r) => r.attentionRead && READ_BADGE[r.attentionRead]).slice(0, 8),
    [data]
  )
  if (!signals.length) return null
  return (
    <div className="wlp-alpha">
      <span className="wlp-alpha-label">{t('walletsPage.alphaSignals', 'Alpha signals')}</span>
      <div className="wlp-alpha-row">
        {signals.map((r) => {
          const badge = READ_BADGE[r.attentionRead]
          const clickable = !!(r.contract && isTradableContract(r.contract))
          return (
            <button
              key={`${r.chain}:${r.contract}`}
              type="button"
              className={`wlp-alpha-chip${clickable ? ' clickable' : ''}`}
              onClick={() => clickable && openTradingTerminal(r.contract)}
              title={badge.title}
            >
              <span className={`wlp-readbadge wlp-readbadge--${r.attentionRead}`}>{badge.label}</span>
              <span className="wlp-alpha-sym">{r.symbol}</span>
              <span className={`mono ${(r.netflow24h || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(r.netflow24h, { sign: true })}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Landing minis: smart-money pulse + HL positioning + tape rail ── */

const HlMini = ({ hl, t, onMore }) => {
  const totals = hl?.totals
  const skew = (hl?.skew || []).slice(0, 5)
  const longShare = totals && totals.longUsd + totals.shortUsd > 0
    ? totals.longUsd / (totals.longUsd + totals.shortUsd) : null
  return (
    <section className="wlp-card wlp-hlmini">
      <header className="wlp-card-head wlp-card-head--row">
        <div className="wlp-card-title-wrap">
          <span className="wlp-card-title">{t('walletsPage.hlTitle', 'Smart Perp Desks')}</span>
          <span className="wlp-card-sub">{totals ? `${totals.desks} ${t('walletsPage.desksTracked', 'top-PnL desks')} · uPnL ` : '—'}{totals && <b className={`mono ${(totals.uPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(totals.uPnl, { sign: true })}</b>}</span>
        </div>
        <button type="button" className="wlp-more" onClick={onMore}>{t('walletsPage.openDesk', 'Open desk')} →</button>
      </header>
      <div className="wlp-hlmini-body">
        <div className="wlp-hl-meter-labels">
          <span className="pos mono">{t('walletsPage.long', 'Long')} {fmtUsd(totals?.longUsd)}</span>
          <span className="neg mono">{t('walletsPage.short', 'Short')} {fmtUsd(totals?.shortUsd)}</span>
        </div>
        <div className="wlp-hl-meter" aria-hidden>
          <span className="wlp-hl-meter-long" style={{ width: `${Math.round((longShare ?? 0.5) * 100)}%` }} />
        </div>
        <div className="wlp-hlmini-skew">
          {skew.map((s) => (
            <div key={s.coin} className="wlp-hlmini-row">
              <span className="wlp-ident-sym">{s.coin}</span>
              <span className="wlp-hl-share" aria-hidden><span className="wlp-hl-share-long" style={{ width: `${Math.round((s.longShare ?? 0) * 100)}%` }} /></span>
              <span className={`mono strong ${(s.netUsd || 0) >= 0 ? 'pos' : 'neg'}`}>{(s.netUsd || 0) >= 0 ? 'L ' : 'S '}{fmtUsd(Math.abs(s.netUsd))}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const TapeRail = ({ cmd, t, onMore }) => {
  const rows = (cmd?.whaleTape || []).slice(0, 18)
  return (
    <section className="wlp-card wlp-rail-tape">
      <header className="wlp-card-head wlp-card-head--row">
        <div className="wlp-card-title-wrap">
          <span className="wlp-card-title">{t('walletsPage.liveTape', 'Live Whale Tape')}</span>
          <span className="wlp-card-sub">{t('walletsPage.tapeSubShort', 'labeled transfers ≥ $1M')}</span>
        </div>
        <span className="wlp-live-dot" aria-hidden />
      </header>
      <div className="wlp-rail-rows">
        {rows.map((row, i) => {
          const read = tapeRead(row)
          const who = tapeParty(row.fromLabel || row.toLabel, t('walletsPage.unlabeledWhale', 'Unlabeled whale'))
          return (
            <a key={`${row.txHash}-${i}`} className="wlp-rail-row" href={explorerTxUrl(row.txHash, row.chain)} target="_blank" rel="noopener noreferrer">
              <span className="mono dim wlp-rail-time">{relTime(row.time)}</span>
              <span className={`wlp-tapetag wlp-tapetag--${read.tone}`}>{read.tag}</span>
              <span className={`wlp-rail-who${who.raw ? ' wlp-party--addr' : ''}`} title={who.full || undefined}>{who.text}</span>
              <span className="wlp-rail-asset">{row.asset}</span>
              <span className="mono strong wlp-rail-usd">{fmtUsd(row.usd)}</span>
            </a>
          )
        })}
      </div>
      <button type="button" className="wlp-more wlp-more--footer" onClick={onMore}>{t('walletsPage.fullTape', 'Full tape')} →</button>
    </section>
  )
}

/* ── Flows tab ── */

const LedgerBars = ({ series, valueKey = 'net' }) => {
  const max = useMemo(
    () => series.reduce((m, r) => Math.max(m, Math.abs(r[valueKey] || 0)), 0),
    [series, valueKey]
  )
  return (
    <div className="wlp-ledger-bars" aria-hidden>
      {series.map((r, i) => {
        const v = r[valueKey] || 0
        const h = max > 0 ? Math.max(6, Math.round((Math.abs(v) / max) * 100)) : 6
        return (
          <span
            key={i}
            className={`wlp-ledger-bar ${v >= 0 ? 'pos' : 'neg'}`}
            style={{ height: `${h}%` }}
            title={`${r.day ? String(r.day).slice(0, 10) : ''} · ${fmtUsd(v, { sign: true })}`}
          />
        )
      })}
    </div>
  )
}

const FlowsTab = ({ t, onGoTab }) => {
  const { data: cmd, loading } = useWalletsLane('command')
  const { data: hist } = useWalletsLane('history')
  const { data: hl } = useWalletsLane('hlDesks')

  const cexSeries = useMemo(() => {
    const byDay = new Map()
    for (const r of hist?.cex || []) {
      const k = String(r.day).slice(0, 10)
      byDay.set(k, { day: k, net: (byDay.get(k)?.net || 0) + (r.net || 0) })
    }
    return [...byDay.values()]
  }, [hist])
  const etfSeries = useMemo(() => {
    const byDay = new Map()
    for (const r of hist?.etf || []) {
      const k = String(r.day).slice(0, 10)
      byDay.set(k, { day: k, net: (byDay.get(k)?.net || 0) + (r.flowUsd || 0) })
    }
    return [...byDay.values()]
  }, [hist])

  if (loading && !cmd) return <div className="wlp-loading">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={`wlp-loading-row animate-shimmer stagger-${i + 1}`} />)}</div>

  const s = cmd?.summary
  const stables = cmd?.stables
  const exFlows = cmd?.exchangeFlows
  const etf = cmd?.etf
  const entities = cmd?.entities || []

  return (
    <div className="wlp-flows">
      <AlphaStrip t={t} />

      {/* The page used to be ONE two-column grid: every section stacked in the
          left column and a rail of two cards on the right. The rail ran out
          around the ETF block, so the whole bottom half of the page — ETF,
          the three ledgers, the entity strip — lived in a ~720px column with
          ~430px of dead space beside it, while the Smart Money table, which
          needs ~940px for its nine columns, was clipped by the card it sat
          in. Sections are paired by HEIGHT now instead: the two short cards
          share a row, the wide table takes the full width it needs, the two
          feeds share a row, and everything below spans. */}
      <div className="wlp-stats">
        <div className="wlp-stat">
          <span className="wlp-stat-label">{t('walletsPage.whaleVolume', 'Whale volume · 24h')}</span>
          <span className="wlp-stat-value mono">{fmtUsd(s?.volumeUsd24h)}</span>
          <span className="wlp-stat-sub">{s?.txCount24h ?? '—'} {t('walletsPage.transfers', 'large transfers')}</span>
        </div>
        <div className="wlp-stat">
          <span className="wlp-stat-label">BTC</span>
          <span className="wlp-stat-value mono">{fmtUsd(s?.byChain?.bitcoin?.volumeUsd)}</span>
          <span className="wlp-stat-sub">{s?.byChain?.bitcoin?.txCount ?? '—'} tx</span>
        </div>
        <div className="wlp-stat">
          <span className="wlp-stat-label">ETH</span>
          <span className="wlp-stat-value mono">{fmtUsd(s?.byChain?.ethereum?.volumeUsd)}</span>
          <span className="wlp-stat-sub">{s?.byChain?.ethereum?.txCount ?? '—'} tx</span>
        </div>
        <div className="wlp-stat">
          <span className="wlp-stat-label">{t('walletsPage.stablesNet', 'Stables net · 24h')}</span>
          <span className={`wlp-stat-value mono ${(stables?.net24h || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(stables?.net24h, { sign: true })}</span>
          <span className="wlp-stat-sub">{(stables?.net24h || 0) >= 0 ? t('walletsPage.dryPowderIn', 'dry powder entering') : t('walletsPage.liquidityOut', 'liquidity redeemed')}</span>
        </div>
      </div>

      {/* Two short cards, one row: the 24h verdict beside the perp desks that
          are voting on it. */}
      <div className="wlp-cols wlp-cols--top">
        <MoneyWeather cmd={cmd} hl={hl} t={t} />
        <HlMini hl={hl} t={t} onMore={() => onGoTab('hyperliquid')} />
      </div>

      {/* The page's main table. Nine columns need ~940px and it used to get
          ~720px, so the read badges and the row actions were cut off by the
          card's own overflow. It spans now. */}
      <SmBoard t={t} onGoTab={onGoTab} maxRows={14} />

      {/* The two live feeds, side by side and the same height. Nansen answers
          "which cohort is accumulating, in dollars" once a day; the taker
          panel answers "which way is the taker side leaning right now" every
          four minutes; the tape is the raw transfers under both. Neither can
          go blank because the other is down. */}
      <div className="wlp-cols wlp-cols--feeds">
        <LiveFlowPanel t={t} maxRows={12} />
        {/* The tape's natural height is whatever the feed returned, so left to
            itself it drives the row and the panel beside it grows a hole. The
            slot is the height reference: the card fills it absolutely and the
            transfers scroll inside. */}
        <div className="wlp-railslot">
          <TapeRail cmd={cmd} t={t} onMore={() => onGoTab('tape')} />
        </div>
      </div>

      <div className="wlp-etf-section">
        <EtfFlowsView compact enabled />
      </div>

      <div className="wlp-ledgers">
        <section className="wlp-card">
          <header className="wlp-card-head">
            <span className="wlp-card-title">{t('walletsPage.cexFlows', 'CEX Net Flow · 30d')}</span>
            <span className="wlp-card-sub">{t('walletsPage.cexSub', 'positive = coins onto exchanges (sell-side)')}</span>
          </header>
          <LedgerBars series={cexSeries} />
          <div className="wlp-ledger-now">
            {(exFlows?.byAsset || []).slice(0, 3).map((a) => (
              <span key={a.asset} className="wlp-ledger-chip">
                {a.asset} <b className={`mono ${a.net >= 0 ? 'neg' : 'pos'}`}>{fmtUsd(a.net, { sign: true })}</b>
              </span>
            ))}
          </div>
        </section>
        <section className="wlp-card">
          <header className="wlp-card-head">
            <span className="wlp-card-title">{t('walletsPage.etfFlows', 'Spot ETF Flow · 30d')}</span>
            <span className="wlp-card-sub">{t('walletsPage.etfSub', 'BTC + ETH funds, daily')}</span>
          </header>
          <LedgerBars series={etfSeries} />
          <div className="wlp-ledger-now">
            {(etf?.aggregates || []).map((a) => (
              <span key={a.asset} className="wlp-ledger-chip">
                {a.asset} <b className={`mono ${(a.flowUsd || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(a.flowUsd, { sign: true })}</b>
              </span>
            ))}
            {(etf?.topFunds || []).slice(0, 1).map((f) => (
              <span key={f.ticker} className="wlp-ledger-chip wlp-ledger-chip--minor">
                {t('walletsPage.top', 'top')}: {f.ticker} <b className={`mono ${(f.flowUsd || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(f.flowUsd, { sign: true })}</b>
              </span>
            ))}
          </div>
        </section>
        <section className="wlp-card">
          <header className="wlp-card-head">
            <span className="wlp-card-title">{t('walletsPage.stableLedger', 'Stablecoin Mint/Burn · 30d')}</span>
            <span className="wlp-card-sub">{t('walletsPage.stableSub', 'Circle + Tether treasury moves')}</span>
          </header>
          <LedgerBars series={hist?.stables || []} />
          <div className="wlp-ledger-now">
            <span className="wlp-ledger-chip">{t('walletsPage.minted', 'Minted')} <b className="mono pos">{fmtUsd(stables?.minted24h)}</b></span>
            <span className="wlp-ledger-chip">{t('walletsPage.redeemed', 'Redeemed')} <b className="mono neg">{fmtUsd(stables?.redeemed24h)}</b></span>
          </div>
        </section>
      </div>

      {entities.length > 0 && (
        <section className="wlp-card wlp-entities">
          <header className="wlp-card-head">
            <span className="wlp-card-title">{t('walletsPage.mostActive', 'Most Active Wallets · 24h')}</span>
          </header>
          <div className="wlp-entities-row">
            {entities.map((e) => (
              <span key={e.label} className="wlp-entity" title={`${e.moves24h} moves`}>
                <span className="wlp-entity-name">{e.label}</span>
                <span className="wlp-entity-vol mono">{fmtUsd(e.volumeUsd)}</span>
                <span className={`wlp-entity-dir ${(e.netInUsd || 0) >= 0 ? 'in' : 'out'}`}>
                  {(e.netInUsd || 0) >= 0 ? t('walletsPage.receiving', 'receiving') : t('walletsPage.sending', 'sending')}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ── Smart Money board — lives on the Flows landing ── */

const SM_FILTERS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'majors', label: 'Majors' },
  { id: 'all', label: 'All' },
]

const SmBoard = ({ t, onGoTab, maxRows = 14 }) => {
  const { data, loading } = useWalletsLane('board')
  const [filter, setFilter] = useState('tokens')
  const [chain, setChain] = useState('all')
  const [sort, setSort] = useState({ key: 'netflow24h', dir: 'desc' })

  const rows = useMemo(() => {
    let all = (data?.rows || []).filter((r) => !isUglyToken(r.symbol, r.name))
    if (filter === 'tokens') all = all.filter((r) => !r.isMajor && !r.isStable)
    else if (filter === 'majors') all = all.filter((r) => r.isMajor || r.isStable)
    if (chain !== 'all') all = all.filter((r) => r.chain === chain)
    return sortRows(all.map((r) => ({ ...r, buzzCount: r.buzz?.mentions24h ?? null })), sort)
  }, [data, filter, chain, sort])

  // chains present in the board, busiest first — the dropdown only offers what exists
  const chains = useMemo(() => {
    const counts = new Map()
    for (const r of data?.rows || []) if (r.chain) counts.set(r.chain, (counts.get(r.chain) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  const maxAbs = useMemo(() => rows.reduce((m, r) => Math.max(m, Math.abs(r.netflow24h || 0)), 0), [rows])

  /* The board is a Nansen cohort on a credit budget, not a stream: the tracker
     ticks every 8 hours, so a row half a day old is normal and the card has to
     say so rather than let the reader assume a live feed. Stale is set past a
     full tick, since anything inside one is simply the cadence. */
  const boardAge = useMemo(() => {
    const newest = (data?.rows || []).reduce((m, r) => {
      const v = r.ts ? Date.parse(r.ts) : NaN
      return Number.isFinite(v) && v > m ? v : m
    }, 0)
    return newest ? snapshotAge(new Date(newest).toISOString(), 10 * 60) : null
  }, [data])

  if (loading && !data) return <div className="wlp-loading">{[0, 1, 2].map((i) => <div key={i} className={`wlp-loading-row animate-shimmer stagger-${i + 1}`} />)}</div>

  return (
    <section className="wlp-card wlp-smboard">
      <header className="wlp-card-head wlp-card-head--row">
        <div className="wlp-card-title-wrap">
          <span className="wlp-card-title">{t('walletsPage.smartMoneyFlows', 'Smart Money Flows')}</span>
          <span className="wlp-card-sub">
            {t('walletsPage.smNote2', 'net USD flow by consistently-profitable wallets · 24h')}
            {boardAge && (
              <span className={`wlp-age${boardAge.stale ? ' is-stale' : ''}`}>
                {t('walletsPage.nansenAge', 'Nansen · {{a}} old', { a: boardAge.text })}
              </span>
            )}
          </span>
        </div>
        <div className="wlp-smboard-controls">
          {chains.length > 1 && (
            <select className="wlp-chainsel" value={chain} onChange={(e) => setChain(e.target.value)} aria-label={t('walletsPage.chainFilter', 'Filter by chain')}>
              <option value="all">{t('walletsPage.allChains', 'All chains')}</option>
              {chains.map(([id, n]) => (
                <option key={id} value={id}>{CHAIN_SHORT[id] || id.toUpperCase()} · {n}</option>
              ))}
            </select>
          )}
          <div className="wlp-seg" role="tablist">
            {SM_FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`wlp-seg-btn${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
                {t(`walletsPage.${f.id}`, f.label)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="wlp-table wlp-table--sm" role="table">
        <div className="wlp-tr wlp-tr--head" role="row">
          <span>{t('walletsPage.token', 'Token')}</span>
          <span />
          <SortTh id="netflow24h" label="24h" sort={sort} setSort={setSort} />
          <SortTh id="priceChange24h" label={t('walletsPage.price24h', 'Price 24h')} sort={sort} setSort={setSort} />
          <SortTh id="traders" label={t('walletsPage.traders', 'Traders')} sort={sort} setSort={setSort} />
          <SortTh id="buzzCount" label={t('walletsPage.buzz', 'Buzz')} sort={sort} setSort={setSort} />
          <SortTh id="mcap" label={t('walletsPage.mcap', 'MCap')} sort={sort} setSort={setSort} />
          <span className="r">{t('walletsPage.read', 'Read')}</span>
          <span className="r">{t('walletsPage.actions', 'Actions')}</span>
        </div>
        {rows.slice(0, maxRows).map((r) => {
          const neg = (r.netflow24h || 0) < 0
          const pct = maxAbs > 0 ? Math.min(100, Math.round((Math.abs(r.netflow24h || 0) / maxAbs) * 100)) : 0
          const badge = READ_BADGE[r.attentionRead]
          const clickable = !!(r.contract && isTradableContract(r.contract))
          return (
            <div
              key={`${r.chain}:${r.contract}`}
              className={`wlp-tr${clickable ? ' clickable' : ''}`}
              role="row"
              onClick={() => clickable && openTradingTerminal(r.contract)}
            >
              <TokenIdent symbol={r.symbol} chain={r.chain} contract={r.contract} />
              <span className="wlp-flowbar" aria-hidden><span className={`wlp-flowbar-fill ${neg ? 'neg' : 'pos'}`} style={{ width: `${pct}%` }} /></span>
              <span className={`r mono strong ${neg ? 'neg' : 'pos'}`}>{fmtUsd(r.netflow24h, { sign: true })}</span>
              <span className={`r mono ${r.priceChange24h == null ? 'dim' : r.priceChange24h >= 0 ? 'pos' : 'neg'}`}>{r.priceChange24h == null ? '—' : `${r.priceChange24h >= 0 ? '+' : ''}${Number(r.priceChange24h).toFixed(1)}%`}</span>
              <span className="r mono">{r.traders ?? '—'}</span>
              <span className="r mono dim" title={r.buzz ? `${r.buzz.mentions24h} mentions · ${r.buzz.voices24h} voices` : ''}>
                {r.buzz?.mentions24h ? `${r.buzz.mentions24h}×` : '—'}
              </span>
              <span className="r mono dim">{r.mcap ? fmtUsd(r.mcap) : '—'}</span>
              <span className="r">
                {badge ? <span className={`wlp-readbadge wlp-readbadge--${r.attentionRead}`} title={badge.title}>{badge.label}</span> : <span className="dim">—</span>}
              </span>
              <RowActions row={r} />
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="wlp-empty">
            {(data?.rows || []).length === 0
              ? t('walletsPage.smFeedDown', 'The smart-money feed is offline right now - flows return when it reconnects.')
              : t('walletsPage.noSmRows', 'No smart-money flow captured in this bucket over the last 24h.')}
          </p>
        )}
      </div>
      <button type="button" className="wlp-more wlp-more--footer" onClick={() => onGoTab('screener')}>
        {t('walletsPage.openScreener', 'Open the full screener')} →
      </button>
    </section>
  )
}

/* ── Hyperliquid tab ── */

const HL_SIDES = [
  { id: 'all', label: 'All' },
  { id: 'long', label: 'Longs' },
  { id: 'short', label: 'Shorts' },
]

const HyperliquidTab = ({ t }) => {
  const { data, loading } = useWalletsLane('hlDesks')
  const [side, setSide] = useState('all')
  const [view, setView] = useState('positioning') // positioning | desks

  if (loading && !data) return <div className="wlp-loading">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`wlp-loading-row animate-shimmer stagger-${(i % 5) + 1}`} />)}</div>

  const totals = data?.totals
  const skew = data?.skew || []
  const desks = data?.desks || []
  const positions = (data?.positions || [])
    .filter((p) => side === 'all' || p.side === side)
    .sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0))
  const longShare = totals && totals.longUsd + totals.shortUsd > 0
    ? totals.longUsd / (totals.longUsd + totals.shortUsd) : null
  // Re-derived every render rather than memoised: the whole point is that it
  // ticks with the clock, not with the payload.
  const age = snapshotAge(totals?.positionsTs)

  return (
    <div className="wlp-hl">
      {/* cohort hero */}
      <div className="wlp-hl-hero">
        <div className="wlp-hl-hero-left">
          <span className="wlp-card-title">{t('walletsPage.hlTitle', 'Smart Perp Desks')}</span>
          <span className="wlp-card-sub">
            {/* Not "live": the positions snapshot is rewritten every 30 minutes,
                so the age has to be the thing the label leans on. */}
            {t('walletsPage.hlSub', '{{n}} most profitable Hyperliquid accounts · open positions', { n: totals?.desks ?? '—' })}
            {age && (
              <span className={`wlp-age${age.stale ? ' is-stale' : ''}`}>
                {age.stale
                  ? t('walletsPage.snapStale', 'snapshot {{a}} old', { a: age.text })
                  : t('walletsPage.snapAge', 'snapshot {{a}} old', { a: age.text })}
              </span>
            )}
          </span>
        </div>
        <div className="wlp-hl-meter-wrap">
          <div className="wlp-hl-meter-labels">
            <span className="pos mono">{t('walletsPage.long', 'Long')} {fmtUsd(totals?.longUsd)}</span>
            <span className="neg mono">{t('walletsPage.short', 'Short')} {fmtUsd(totals?.shortUsd)}</span>
          </div>
          <div className="wlp-hl-meter" aria-hidden>
            <span className="wlp-hl-meter-long" style={{ width: `${Math.round((longShare ?? 0.5) * 100)}%` }} />
          </div>
          <span className="wlp-hl-meter-note">
            {longShare == null ? '—'
              : longShare > 0.65 ? t('walletsPage.crowdLong', 'Smart perps lean firmly LONG')
              : longShare < 0.35 ? t('walletsPage.crowdShort', 'Smart perps lean firmly SHORT')
              : t('walletsPage.crowdBalanced', 'Positioning near balanced')}
            {' · '}uPnL <b className={`mono ${(totals?.uPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(totals?.uPnl, { sign: true })}</b>
          </span>
        </div>
      </div>

      {/* per-asset skew */}
      <section className="wlp-card">
        <header className="wlp-card-head">
          <span className="wlp-card-title">{t('walletsPage.hlSkew', 'Where the smart desks are positioned')}</span>
          <span className="wlp-card-sub">{t('walletsPage.hlSkewSub', 'aggregate long vs short value per asset')}</span>
        </header>
        <div className="wlp-table wlp-table--skew">
          <div className="wlp-tr wlp-tr--head">
            <span>{t('walletsPage.asset', 'Asset')}</span>
            <span>{t('walletsPage.positioning', 'Positioning')}</span>
            <span className="r">{t('walletsPage.netBet', 'Net bet')}</span>
            <span className="r">{t('walletsPage.totalSize', 'Total')}</span>
            <span className="r">{t('walletsPage.desks', 'Desks')}</span>
            <span className="r">uPnL</span>
          </div>
          {skew.slice(0, 14).map((s) => (
            <div key={s.coin} className="wlp-tr" role="row">
              <span className="wlp-ident"><span className="wlp-ident-sym">{s.coin}</span></span>
              <span className="wlp-hl-share" aria-hidden>
                <span className="wlp-hl-share-long" style={{ width: `${Math.round((s.longShare ?? 0) * 100)}%` }} />
              </span>
              <span className={`r mono strong ${(s.netUsd || 0) >= 0 ? 'pos' : 'neg'}`}>{(s.netUsd || 0) >= 0 ? 'LONG ' : 'SHORT '}{fmtUsd(Math.abs(s.netUsd))}</span>
              <span className="r mono dim">{fmtUsd(s.totalUsd)}</span>
              <span className="r mono">{s.longDesks + s.shortDesks}</span>
              <span className={`r mono dim ${(s.uPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(s.uPnl, { sign: true })}</span>
            </div>
          ))}
        </div>
      </section>

      {/* desks / positions switch */}
      <div className="wlp-toolbar">
        <div className="wlp-seg" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'positioning'} className={`wlp-seg-btn${view === 'positioning' ? ' active' : ''}`} onClick={() => setView('positioning')}>
            {t('walletsPage.livePositions', 'Live Positions')}
          </button>
          <button type="button" role="tab" aria-selected={view === 'desks'} className={`wlp-seg-btn${view === 'desks' ? ' active' : ''}`} onClick={() => setView('desks')}>
            {t('walletsPage.leaderboard', 'PnL Leaderboard')}
          </button>
        </div>
        {view === 'positioning' && (
          <div className="wlp-seg" role="tablist">
            {HL_SIDES.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={side === f.id} className={`wlp-seg-btn${side === f.id ? ' active' : ''}`} onClick={() => setSide(f.id)}>
                {t(`walletsPage.${f.id}Side`, f.label)}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'positioning' ? (
        <section className="wlp-card">
          <div className="wlp-table wlp-table--pos">
            <div className="wlp-tr wlp-tr--head">
              <span>{t('walletsPage.asset', 'Asset')}</span>
              <span>{t('walletsPage.side', 'Side')}</span>
              <span className="r">{t('walletsPage.size', 'Size')}</span>
              <span className="r">{t('walletsPage.entry', 'Entry')}</span>
              <span className="r">uPnL</span>
              <span className="r">{t('walletsPage.lev', 'Lev')}</span>
              <span className="r">{t('walletsPage.desk', 'Desk')}</span>
            </div>
            {positions.slice(0, 40).map((p, i) => (
              <a key={`${p.address}-${p.coin}-${i}`} className="wlp-tr clickable" href={hlAddressUrl(p.address)} target="_blank" rel="noopener noreferrer" role="row">
                <span className="wlp-ident"><span className="wlp-ident-sym">{p.coin}</span></span>
                <span><span className={`wlp-side wlp-side--${p.side}`}>{p.side === 'long' ? 'LONG' : 'SHORT'}</span></span>
                <span className="r mono strong">{fmtUsd(p.valueUsd)}</span>
                <span className="r mono dim">{p.entryPx != null ? `$${p.entryPx >= 100 ? Math.round(p.entryPx).toLocaleString() : p.entryPx}` : '—'}</span>
                <span className={`r mono ${(p.uPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(p.uPnl, { sign: true })}</span>
                <span className="r mono dim">{p.leverage ? `${p.leverage}×` : '—'}</span>
                <span className="r mono dim">{shortAddr(p.address)}</span>
              </a>
            ))}
            {positions.length === 0 && <p className="wlp-empty">{t('walletsPage.noPositions', 'No open positions match this filter.')}</p>}
          </div>
        </section>
      ) : (
        <section className="wlp-card">
          <div className="wlp-table wlp-table--desks">
            <div className="wlp-tr wlp-tr--head">
              <span className="r">#</span>
              <span>{t('walletsPage.desk', 'Desk')}</span>
              <span className="r">{t('walletsPage.accountValue', 'Account')}</span>
              <span className="r">{t('walletsPage.pnl7d', 'PnL 7d')}</span>
              <span className="r">{t('walletsPage.pnl30d', 'PnL 30d')}</span>
              <span className="r">{t('walletsPage.roi30d', 'ROI 30d')}</span>
              <span className="r">{t('walletsPage.vol30d', 'Volume 30d')}</span>
            </div>
            {desks.slice(0, 30).map((d) => (
              <a key={d.address} className="wlp-tr clickable" href={hlAddressUrl(d.address)} target="_blank" rel="noopener noreferrer" role="row">
                <span className="r mono dim">{d.rank}</span>
                <span className="mono">{shortAddr(d.address)}</span>
                <span className="r mono">{fmtUsd(d.accountValue)}</span>
                <span className={`r mono ${(d.pnlWeek || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(d.pnlWeek, { sign: true })}</span>
                <span className={`r mono strong ${(d.pnlMonth || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(d.pnlMonth, { sign: true })}</span>
                <span className={`r mono dim ${(d.roiMonth || 0) >= 0 ? 'pos' : 'neg'}`}>{d.roiMonth != null ? `${(d.roiMonth * 100).toFixed(1)}%` : '—'}</span>
                <span className="r mono dim">{fmtUsd(d.volumeMonth)}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ── Screener tab: full sortable lists — tokens · wallets · exchanges ── */

const SortTh = ({ id, label, sort, setSort, className = 'r' }) => (
  <button
    type="button"
    className={`wlp-th ${className}${sort.key === id ? ' active' : ''}`}
    onClick={() => setSort((s) => ({ key: id, dir: s.key === id && s.dir === 'desc' ? 'asc' : 'desc' }))}
  >
    {label}{sort.key === id ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
  </button>
)

function sortRows(rows, sort) {
  const { key, dir } = sort
  return [...rows].sort((a, b) => {
    const av = a[key]; const bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const d = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return dir === 'desc' ? -d : d
  })
}

const SCR_VIEWS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'exchanges', label: 'Exchanges' },
]

const ScreenerTab = ({ t }) => {
  const { data: board, loading: boardLoading } = useWalletsLane('board')
  const { data: scr, loading: scrLoading } = useWalletsLane('screener')
  const [view, setView] = useState('tokens')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ key: 'netflow24h', dir: 'desc' })

  const switchView = (v) => {
    setView(v)
    setQ('')
    setSort({ key: v === 'tokens' ? 'netflow24h' : v === 'wallets' ? 'vol24h' : 'net24h', dir: 'desc' })
  }

  const query = q.trim().toLowerCase()
  const tokens = useMemo(() => {
    let rows = (board?.rows || []).filter((r) => !isUglyToken(r.symbol, r.name))
    if (query) rows = rows.filter((r) => String(r.symbol || '').toLowerCase().includes(query) || String(r.chain || '').includes(query))
    return sortRows(rows.map((r) => ({ ...r, buzzCount: r.buzz?.mentions24h ?? null, heldUsd: r.holdings?.valueUsd ?? null })), sort)
  }, [board, query, sort])
  const wallets = useMemo(() => {
    let rows = scr?.wallets || []
    if (query) rows = rows.filter((r) => String(r.label || '').toLowerCase().includes(query) || String(r.topAsset || '').toLowerCase().includes(query))
    return sortRows(rows, sort)
  }, [scr, query, sort])
  const exchanges = useMemo(() => {
    let rows = scr?.exchanges || []
    if (query) rows = rows.filter((r) => String(r.exchange || '').toLowerCase().includes(query))
    return sortRows(rows, sort)
  }, [scr, query, sort])

  const loading = view === 'tokens' ? boardLoading && !board : scrLoading && !scr
  if (loading) return <div className="wlp-loading">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`wlp-loading-row animate-shimmer stagger-${(i % 5) + 1}`} />)}</div>

  return (
    <div className="wlp-scr">
      <div className="wlp-toolbar">
        <div className="wlp-seg" role="tablist">
          {SCR_VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={`wlp-seg-btn${view === v.id ? ' active' : ''}`} onClick={() => switchView(v.id)}>
              {t(`walletsPage.scr_${v.id}`, v.label)}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="wlp-search"
          placeholder={t('walletsPage.searchPh', 'Filter…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
        />
        <span className="wlp-toolbar-note">
          {view === 'tokens' ? `${tokens.length} ${t('walletsPage.tokensTracked', 'tokens with smart-money flow · 24h')}`
            : view === 'wallets' ? `${wallets.length} ${t('walletsPage.walletsTracked', 'labeled wallets active · 7d')}`
            : `${exchanges.length} ${t('walletsPage.venuesTracked', 'venues tracked')}`}
        </span>
      </div>

      {view === 'tokens' && (
        <section className="wlp-card">
          <div className="wlp-table wlp-table--scrtok">
            <div className="wlp-tr wlp-tr--head">
              <span>{t('walletsPage.token', 'Token')}</span>
              <SortTh id="netflow24h" label="Flow 24h" sort={sort} setSort={setSort} />
              <SortTh id="netflow7d" label="7d" sort={sort} setSort={setSort} />
              <SortTh id="netflow30d" label="30d" sort={sort} setSort={setSort} />
              <SortTh id="traders" label={t('walletsPage.traders', 'Traders')} sort={sort} setSort={setSort} />
              <SortTh id="heldUsd" label={t('walletsPage.held', 'Held')} sort={sort} setSort={setSort} />
              <SortTh id="buzzCount" label={t('walletsPage.buzz', 'Buzz')} sort={sort} setSort={setSort} />
              <SortTh id="priceChange24h" label={t('walletsPage.price24h', 'Price 24h')} sort={sort} setSort={setSort} />
              <SortTh id="mcap" label={t('walletsPage.mcap', 'MCap')} sort={sort} setSort={setSort} />
              <span className="r">{t('walletsPage.actions', 'Actions')}</span>
            </div>
            {tokens.map((r) => {
              const clickable = !!(r.contract && isTradableContract(r.contract))
              return (
                <div key={`${r.chain}:${r.contract}`} className={`wlp-tr${clickable ? ' clickable' : ''}`} role="row" onClick={() => clickable && openTradingTerminal(r.contract)}>
                  <TokenIdent symbol={r.symbol} chain={r.chain} contract={r.contract} />
                  <span className={`r mono strong ${(r.netflow24h || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(r.netflow24h, { sign: true })}</span>
                  <span className={`r mono dim ${r.netflow7d == null ? '' : r.netflow7d < 0 ? 'neg' : 'pos'}`}>{r.netflow7d == null ? '—' : fmtUsd(r.netflow7d, { sign: true })}</span>
                  <span className={`r mono dim ${r.netflow30d == null ? '' : r.netflow30d < 0 ? 'neg' : 'pos'}`}>{r.netflow30d == null ? '—' : fmtUsd(r.netflow30d, { sign: true })}</span>
                  <span className="r mono">{r.traders ?? '—'}</span>
                  <span className="r mono dim">{r.heldUsd ? fmtUsd(r.heldUsd) : '—'}</span>
                  <span className="r mono dim">{r.buzzCount ? `${r.buzzCount}×` : '—'}</span>
                  <span className={`r mono ${r.priceChange24h == null ? 'dim' : r.priceChange24h >= 0 ? 'pos' : 'neg'}`}>{r.priceChange24h == null ? '—' : `${r.priceChange24h >= 0 ? '+' : ''}${Number(r.priceChange24h).toFixed(1)}%`}</span>
                  <span className="r mono dim">{r.mcap ? fmtUsd(r.mcap) : '—'}</span>
                  <RowActions row={r} />
                </div>
              )
            })}
            {tokens.length === 0 && <p className="wlp-empty">{t('walletsPage.noMatch', 'Nothing matches this filter.')}</p>}
          </div>
        </section>
      )}

      {view === 'wallets' && (
        <>
          {[
            { id: 'exchanges', label: t('walletsPage.grpExchanges', 'Exchange Wallets'), test: (l) => /binance|coinbase|kraken|okx|bybit|bitfinex|gate|htx|kucoin|gemini|crypto\.com|mexc|poloniex|upbit|bitstamp/i.test(l) },
            { id: 'issuers', label: t('walletsPage.grpIssuers', 'Stablecoin Issuers'), test: (l) => /circle|tether|paxos/i.test(l) },
            { id: 'other', label: t('walletsPage.grpOther', 'Funds & Other Entities'), test: () => true },
          ].reduce((acc, g) => {
            const taken = new Set(acc.flatMap((x) => x.rows.map((r) => r.label)))
            acc.push({ ...g, rows: wallets.filter((r) => !taken.has(r.label) && g.test(r.label)) })
            return acc
          }, []).filter((g) => g.rows.length > 0).map((g) => (
            <section key={g.id} className="wlp-card">
              <header className="wlp-card-head wlp-card-head--row">
                <div className="wlp-card-title-wrap">
                  <span className="wlp-card-title">{g.label}</span>
                  <span className="wlp-card-sub">{g.rows.length} {t('walletsPage.entities7d', 'entities active · 7d')}</span>
                </div>
              </header>
              <div className="wlp-table wlp-table--scrwal">
                <div className="wlp-tr wlp-tr--head">
                  <span>{t('walletsPage.wallet', 'Wallet')}</span>
                  <span>{t('walletsPage.topAsset', 'Top asset')}</span>
                  <SortTh id="moves24h" label={t('walletsPage.moves24h', 'Moves 24h')} sort={sort} setSort={setSort} />
                  <SortTh id="in24h" label={t('walletsPage.in24h', 'In 24h')} sort={sort} setSort={setSort} />
                  <SortTh id="out24h" label={t('walletsPage.out24h', 'Out 24h')} sort={sort} setSort={setSort} />
                  <SortTh id="net24h" label={t('walletsPage.net24h', 'Net 24h')} sort={sort} setSort={setSort} />
                  <SortTh id="vol7d" label={t('walletsPage.vol7d', 'Volume 7d')} sort={sort} setSort={setSort} />
                  <SortTh id="lastMove" label={t('walletsPage.lastMove', 'Last move')} sort={sort} setSort={setSort} />
                </div>
                {g.rows.map((r) => (
                  <div key={r.label} className="wlp-tr" role="row">
                    <span className="wlp-ident"><span className="wlp-ident-sym">{r.label}</span></span>
                    <span><span className="wlp-tape-asset wlp-scr-asset">{r.topAsset || '—'}</span></span>
                    <span className="r mono">{r.moves24h}</span>
                    <span className="r mono pos">{r.in24h ? fmtUsd(r.in24h) : '—'}</span>
                    <span className="r mono neg">{r.out24h ? fmtUsd(r.out24h) : '—'}</span>
                    <span className={`r mono strong ${(r.net24h || 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(r.net24h, { sign: true })}</span>
                    <span className="r mono dim">{fmtUsd(r.vol7d)}</span>
                    <span className="r mono dim">{relTime(r.lastMove)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {wallets.length === 0 && <section className="wlp-card"><p className="wlp-empty">{t('walletsPage.noMatch', 'Nothing matches this filter.')}</p></section>}
        </>
      )}

      {view === 'exchanges' && (
        <section className="wlp-card">
          <div className="wlp-table wlp-table--screx">
            <div className="wlp-tr wlp-tr--head">
              <span>{t('walletsPage.exchange', 'Exchange')}</span>
              <SortTh id="in24h" label={t('walletsPage.in24h', 'In 24h')} sort={sort} setSort={setSort} />
              <SortTh id="out24h" label={t('walletsPage.out24h', 'Out 24h')} sort={sort} setSort={setSort} />
              <SortTh id="net24h" label={t('walletsPage.net24h', 'Net 24h')} sort={sort} setSort={setSort} />
              <SortTh id="net7d" label={t('walletsPage.net7d', 'Net 7d')} sort={sort} setSort={setSort} />
              <SortTh id="assets" label={t('walletsPage.assets', 'Assets')} sort={sort} setSort={setSort} />
              <span className="r">{t('walletsPage.readCol', 'Read')}</span>
            </div>
            {exchanges.map((r) => (
              <div key={r.exchange} className="wlp-tr" role="row">
                <span className="wlp-ident"><span className="wlp-ident-sym">{r.exchange}</span></span>
                <span className="r mono">{fmtUsd(r.in24h)}</span>
                <span className="r mono">{fmtUsd(r.out24h)}</span>
                <span className={`r mono strong ${(r.net24h || 0) >= 0 ? 'neg' : 'pos'}`}>{fmtUsd(r.net24h, { sign: true })}</span>
                <span className={`r mono dim ${(r.net7d || 0) >= 0 ? 'neg' : 'pos'}`}>{fmtUsd(r.net7d, { sign: true })}</span>
                <span className="r mono dim">{r.assets}</span>
                <span className="r wlp-scr-read">{(r.net24h || 0) <= 0 ? t('walletsPage.coinsLeaving', 'coins leaving') : t('walletsPage.coinsArriving', 'coins arriving')}</span>
              </div>
            ))}
            {exchanges.length === 0 && <p className="wlp-empty">{t('walletsPage.noMatch', 'Nothing matches this filter.')}</p>}
          </div>
        </section>
      )}
    </div>
  )
}

/* ── Tape tab ── */

const TAPE_CHAINS = [
  { id: 'all', label: 'All chains' },
  { id: 'bitcoin', label: 'BTC' },
  { id: 'ethereum', label: 'ETH' },
]
const TAPE_MINS = [
  { id: 0, label: 'All sizes' },
  { id: 5e6, label: '≥ $5M' },
  { id: 10e6, label: '≥ $10M' },
]
const TAPE_COHORT_OPTS = [
  { id: 'all', label: 'All flows' },
  { id: 'exchange', label: 'Exchanges' },
  { id: 'stables', label: 'Stables' },
  { id: 'fund', label: 'Funds' },
  { id: 'whale', label: 'Whales' },
]

/* Filters live on the page so the Flow Map can seed them on click. */
const TapeTab = ({ t, filters, onFilters }) => {
  const { data, loading } = useWalletsLane('command')
  const { chain, minUsd, cohort } = filters
  const set = (patch) => onFilters({ ...filters, ...patch })

  const rows = useMemo(() => (data?.whaleTape || [])
    .filter((r) => (chain === 'all' || r.chain === chain)
      && (r.usd || 0) >= minUsd
      && matchesCohort(r, cohort)), [data, chain, minUsd, cohort])

  if (loading && !data) return <div className="wlp-loading">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`wlp-loading-row animate-shimmer stagger-${(i % 5) + 1}`} />)}</div>

  return (
    <div className="wlp-tape">
      <div className="wlp-toolbar">
        <div className="wlp-seg" role="tablist">
          {TAPE_CHAINS.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={chain === c.id} className={`wlp-seg-btn${chain === c.id ? ' active' : ''}`} onClick={() => set({ chain: c.id })}>{c.label}</button>
          ))}
        </div>
        <div className="wlp-seg" role="tablist">
          {TAPE_MINS.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={minUsd === m.id} className={`wlp-seg-btn${minUsd === m.id ? ' active' : ''}`} onClick={() => set({ minUsd: m.id })}>{m.label}</button>
          ))}
        </div>
        <div className="wlp-seg" role="tablist">
          {TAPE_COHORT_OPTS.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={cohort === c.id} className={`wlp-seg-btn${cohort === c.id ? ' active' : ''}`} onClick={() => set({ cohort: c.id })}>{t(`walletsPage.cohort_${c.id}`, c.label)}</button>
          ))}
        </div>
        <span className="wlp-toolbar-note">{t('walletsPage.tapeNote', 'Labeled transfers ≥ $1M · refreshes with the feed')}</span>
      </div>
      <section className="wlp-card">
        <div className="wlp-table wlp-table--tape">
          {rows.map((row, i) => {
            const read = tapeRead(row)
            const from = tapeParty(row.fromLabel, t('walletsPage.unknown', 'Unknown'))
            const to = tapeParty(row.toLabel, t('walletsPage.unknown', 'Unknown'))
            return (
              <a key={`${row.txHash}-${i}`} className="wlp-tr clickable" href={explorerTxUrl(row.txHash, row.chain)} target="_blank" rel="noopener noreferrer" role="row">
                <span className="mono dim">{relTime(row.time)}</span>
                <span><span className={`wlp-tapetag wlp-tapetag--${read.tone}`}>{read.tag}</span></span>
                <span className="wlp-tape-path">
                  {row.fromLabel || row.toLabel
                    ? <>
                        <b className={from.raw ? 'wlp-party--addr' : undefined} title={from.full || undefined}>{from.text}</b>
                        <span className="wlp-tape-arrow" aria-hidden>→</span>
                        <b className={to.raw ? 'wlp-party--addr' : undefined} title={to.full || undefined}>{to.text}</b>
                      </>
                    : <b>{t('walletsPage.unlabeledWhale', 'Unlabeled whale')}</b>}
                </span>
                <span className="wlp-tape-asset">{row.asset}</span>
                <span className="r wlp-tape-val">
                  <span className="mono strong wlp-tape-usd">{fmtUsd(row.usd)}</span>
                  {row.amount != null && <span className="mono dim wlp-tape-qty">{fmtQty(row.amount)} {row.asset}</span>}
                </span>
              </a>
            )
          })}
          {rows.length === 0 && <p className="wlp-empty">{t('walletsPage.tapeEmpty', 'No transfers match these filters in the last 24h.')}</p>}
        </div>
      </section>
    </div>
  )
}

/* ── Page ── */

const TABS = [
  { id: 'flows', label: 'Flows' },
  { id: 'river', label: 'Flow Map' },
  { id: 'screener', label: 'Screener' },
  { id: 'hyperliquid', label: 'Hyperliquid' },
  { id: 'tape', label: 'Tape' },
]

const TAPE_FILTER_DEFAULTS = { chain: 'all', minUsd: 0, cohort: 'all' }

const WalletsPage = ({ isMobile = false }) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState('flows')
  const [tapeFilters, setTapeFilters] = useState(TAPE_FILTER_DEFAULTS)

  /* Cross-tab jump. `seed` lets the Flow Map hand the Tape a pre-set filter
     so a lane click lands on exactly the rows behind that lane. */
  const goTab = (next, seed) => {
    if (seed) setTapeFilters((f) => ({ ...f, ...seed }))
    setTab(next)
  }

  if (isMobile) return <WalletsMobile t={t} />

  return (
    <div className="wlp">
      <header className="wlp-head">
        <div className="wlp-head-title">
          <h1>{t('walletsPage.title', 'Wallets')}</h1>
          <p>{t('walletsPage.subtitle', 'Where the big money actually moved — whales, smart wallets, funds and the sharpest perp desks.')}</p>
        </div>
      </header>

      <AiReadHero t={t} />

      <nav className="wlp-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`wlp-tab${tab === x.id ? ' active' : ''}`} onClick={() => setTab(x.id)}>
            {t(`walletsPage.tab_${x.id}`, x.label)}
          </button>
        ))}
      </nav>

      {tab === 'flows' && <FlowsTab t={t} onGoTab={goTab} />}
      {tab === 'river' && <FlowRiverTab t={t} onGoTab={goTab} />}
      {tab === 'screener' && <ScreenerTab t={t} />}
      {tab === 'hyperliquid' && <HyperliquidTab t={t} />}
      {tab === 'tape' && <TapeTab t={t} filters={tapeFilters} onFilters={setTapeFilters} />}
    </div>
  )
}

export default WalletsPage
