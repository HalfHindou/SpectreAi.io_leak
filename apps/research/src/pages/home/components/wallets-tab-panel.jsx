/**
 * WalletsTabPanel — on-chain wallet intelligence for the Command Center.
 *
 * One aggregated feed (useWalletsCommand → /data-api/v1/wallets/command):
 *   1. Whale radar ribbon — 24h labeled-transfer volume + per-chain split
 *   2. Smart Money flows — Nansen smart-money cohort netflows into tokens
 *      (the alpha lane) and majors/stables (the rotation lane)
 *   3. Whale tape — live labeled large transfers (BTC + ETH lanes)
 *   4. Flow stack — CEX net flows · ETF flows · stablecoin liquidity
 *   5. Most-active entities strip
 *
 * All data is served from box-side caches — this view never spends a Nansen
 * API credit; the tracker worker owns that budget.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useWalletsCommand from './use-wallets-command'
/* One tape vocabulary across every surface — the /wallets page owns the
   classifier, address detection and quantity formatter. */
import { fmtQty, shortAddr, tapeRead, tapeParty } from '@/pages/wallets/components/use-wallets-data'
import { openTradingTerminal, isTradableContract } from '@/lib/trading-terminal'
import './wallets-tab-panel.css'

function fmtUsd(n, { sign = false } = {}) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const s = n < 0 ? '-' : sign && n > 0 ? '+' : ''
  if (abs >= 1e9) return `${s}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${s}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${s}$${(abs / 1e3).toFixed(0)}K`
  return `${s}$${abs.toFixed(0)}`
}

function relTime(ts) {
  if (!ts) return ''
  const d = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  return `${Math.floor(d / 86400)}d`
}

const CHAIN_SHORT = {
  ethereum: 'ETH', solana: 'SOL', base: 'BASE', bnb: 'BNB',
  arbitrum: 'ARB', polygon: 'POL', bitcoin: 'BTC',
}

/* DexScreener token-logo CDN — the only logo source that covers pre-CG
   on-chain tokens. Chain slugs differ from Nansen's (bnb → bsc). */
const DS_CHAIN = { ethereum: 'ethereum', solana: 'solana', base: 'base', bnb: 'bsc', arbitrum: 'arbitrum', polygon: 'polygon' }
const tokenLogoUrl = (chain, contract) => {
  const slug = DS_CHAIN[chain]
  return slug && contract ? `https://dd.dexscreener.com/ds-data/tokens/${slug}/${contract}.png` : null
}

const explorerTxUrl = (txHash, chain) => {
  if (!txHash) return '#'
  if (chain === 'bitcoin') return `https://mempool.space/tx/${txHash}`
  return `https://etherscan.io/tx/${txHash}`
}

const SmRow = ({ row, maxAbs, onOpen }) => {
  const neg = (row.netflow24h || 0) < 0
  const pct = Math.min(100, Math.round((Math.abs(row.netflow24h || 0) / (maxAbs || 1)) * 100))
  const logo = tokenLogoUrl(row.chain, row.contract)
  const clickable = !!(row.contract && isTradableContract(row.contract))
  return (
    <button
      type="button"
      className={`wal-sm-row${clickable ? ' clickable' : ''}`}
      onClick={() => clickable && onOpen(row.contract)}
      title={clickable ? `Open $${row.symbol} in the trading terminal` : undefined}
    >
      <span className="wal-sm-ident">
        {logo ? (
          <img className="wal-sm-logo" src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        ) : (
          <span className="wal-sm-logo wal-sm-logo--fallback">{String(row.symbol || '?').slice(0, 1)}</span>
        )}
        <span className="wal-sm-sym">{row.symbol}</span>
        <span className="wal-sm-chain">{CHAIN_SHORT[row.chain] || row.chain}</span>
      </span>
      <span className="wal-sm-flowbar" aria-hidden>
        <span className={`wal-sm-flowbar-fill ${neg ? 'neg' : 'pos'}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`wal-sm-net mono ${neg ? 'neg' : 'pos'}`}>{fmtUsd(row.netflow24h, { sign: true })}</span>
      <span className={`wal-sm-7d mono ${row.netflow7d == null ? '' : row.netflow7d < 0 ? 'neg' : 'pos'}`}>
        {row.netflow7d == null ? '·' : fmtUsd(row.netflow7d, { sign: true })}
      </span>
      <span className="wal-sm-traders mono">{row.traders ?? '—'}</span>
      <span className="wal-sm-mcap mono">{row.mcap ? fmtUsd(row.mcap) : '—'}</span>
    </button>
  )
}

const WalletsTabPanel = () => {
  const { t } = useTranslation()
  const { data, loading } = useWalletsCommand()
  const [smView, setSmView] = useState('tokens')

  const smRows = useMemo(() => {
    const rows = smView === 'tokens' ? data?.smartMoney?.tokens : data?.smartMoney?.majors
    return Array.isArray(rows) ? rows.slice(0, 12) : []
  }, [data, smView])
  const maxAbs = useMemo(
    () => smRows.reduce((m, r) => Math.max(m, Math.abs(r.netflow24h || 0)), 0),
    [smRows]
  )

  const tape = data?.whaleTape || []
  const summary = data?.summary
  const stables = data?.stables
  const exFlows = data?.exchangeFlows
  const etf = data?.etf
  const entities = data?.entities || []

  const btcChain = summary?.byChain?.bitcoin
  const ethChain = summary?.byChain?.ethereum
  const stablesNet = stables?.net24h || 0

  const cexNetTotal = useMemo(
    () => (exFlows?.byAsset || []).reduce((s, a) => s + (a.net || 0), 0),
    [exFlows]
  )

  if (loading && !data) {
    return (
      <div className="wal">
        <div className="wal-loading">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className={`wal-loading-row animate-shimmer stagger-${(i % 5) + 1}`} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="wal">
      {/* ── Whale radar ribbon ─────────────────────────────────────── */}
      <div className={`wal-ribbon ${stablesNet >= 0 ? 'inflow' : 'outflow'}`}>
        <div className="wal-ribbon-left">
          <span className="wal-ribbon-chip">
            <span className="wal-ribbon-chip-dot" />
            {t('walletsTab.whaleRadar', 'Whale Radar · 24h')}
          </span>
          <span className="wal-ribbon-stat mono">{fmtUsd(summary?.volumeUsd24h)}</span>
          <span className="wal-ribbon-sub">{summary?.txCount24h ?? '—'} {t('walletsTab.largeTransfers', 'large transfers')}</span>
        </div>
        <div className="wal-ribbon-right">
          {btcChain && <span className="wal-ribbon-mini"><b>{t('homePage.walletsTabPanel.walletstabpanel.btc', "BTC")}</b> <span className="mono">{fmtUsd(btcChain.volumeUsd)}</span></span>}
          {ethChain && <span className="wal-ribbon-mini"><b>{t('homePage.walletsTabPanel.walletstabpanel.eth', "ETH")}</b> <span className="mono">{fmtUsd(ethChain.volumeUsd)}</span></span>}
          {stables && (
            <span className={`wal-ribbon-mini wal-ribbon-stable ${stablesNet >= 0 ? 'pos' : 'neg'}`}>
              <b>{t('walletsTab.stablesNet', 'Stables net')}</b>{' '}
              <span className="mono">{fmtUsd(stablesNet, { sign: true })}</span>
            </span>
          )}
        </div>
      </div>

      {/* ── Main grid: smart money + whale tape ────────────────────── */}
      <div className="wal-grid">
        <section className="wal-card wal-card--sm">
          <header className="wal-card-head">
            <div className="wal-card-title-wrap">
              <span className="wal-card-title">{t('walletsTab.smartMoneyFlows', 'Smart Money Flows')}</span>
              <span className="wal-card-sub">{t('walletsTab.smSub', 'Nansen smart-money cohort · net USD flow')}</span>
            </div>
            <div className="wal-seg" role="tablist" aria-label={t('walletsTab.smartMoneyView', 'Smart money view')}>
              <button type="button" role="tab" aria-selected={smView === 'tokens'} className={`wal-seg-btn${smView === 'tokens' ? ' active' : ''}`} onClick={() => setSmView('tokens')}>
                {t('walletsTab.tokens', 'Tokens')}
              </button>
              <button type="button" role="tab" aria-selected={smView === 'majors'} className={`wal-seg-btn${smView === 'majors' ? ' active' : ''}`} onClick={() => setSmView('majors')}>
                {t('walletsTab.majors', 'Majors')}
              </button>
            </div>
          </header>
          {smRows.length > 0 ? (
            <div className="wal-sm-table">
              <div className="wal-sm-cols" aria-hidden>
                <span>{t('walletsTab.token', 'Token')}</span>
                <span />
                <span className="r">{t('walletsTab.flow24h', 'Flow 24h')}</span>
                <span className="r">{t('walletsTab.d7', '7d')}</span>
                <span className="r">{t('walletsTab.traders', 'Traders')}</span>
                <span className="r">{t('walletsTab.mcap', 'MCap')}</span>
              </div>
              {smRows.map((row) => (
                <SmRow key={`${row.chain}:${row.contract}`} row={row} maxAbs={maxAbs} onOpen={openTradingTerminal} />
              ))}
            </div>
          ) : (
            <div className="wal-empty-sm">
              <p>{(data?.smartMoney?.tokens || []).length === 0 && (data?.smartMoney?.majors || []).length === 0
                ? t('walletsTab.smFeedDown', 'The smart-money feed is offline right now - flows return when it reconnects.')
                : smView === 'majors'
                  ? t('walletsTab.noMajorFlows', 'No major-asset smart-money flow in the last 24h.')
                  : t('walletsTab.noTokenFlows', 'No token smart-money flow captured in the last 24h.')}</p>
            </div>
          )}
        </section>

        <section className="wal-card wal-card--tape">
          <header className="wal-card-head">
            <div className="wal-card-title-wrap">
              <span className="wal-card-title">{t('walletsTab.whaleTape', 'Whale Tape')}</span>
              <span className="wal-card-sub">{t('walletsTab.tapeSub', 'Labeled transfers ≥ $1M · BTC + ETH lanes')}</span>
            </div>
            <span className="wal-live-dot" aria-hidden />
          </header>
          <div className="wal-tape">
            {tape.slice(0, 40).map((row, i) => {
              const read = tapeRead(row)
              const from = tapeParty(row.fromLabel, t('walletsTab.unknown', 'Unknown'))
              const to = tapeParty(row.toLabel, t('walletsTab.unknown', 'Unknown'))
              return (
                <a
                  key={`${row.txHash}-${i}`}
                  className="wal-tape-row"
                  href={explorerTxUrl(row.txHash, row.chain)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="wal-tape-time mono">{relTime(row.time)}</span>
                  <span className={`wal-tape-tag wal-tape-tag--${read.tone}`}>{read.tag}</span>
                  <span className="wal-tape-path" title={`${from.full || shortAddr(row.txHash)} → ${to.full || ''}`}>
                    {row.fromLabel || row.toLabel
                      ? <>
                          <span className={`wal-tape-entity${from.raw ? ' wal-party--addr' : ''}`}>{from.text}</span>
                          <span className="wal-tape-arrow" aria-hidden>→</span>
                          <span className={`wal-tape-entity${to.raw ? ' wal-party--addr' : ''}`}>{to.text}</span>
                        </>
                      : <span className="wal-tape-entity">{t('walletsTab.unlabeledWhale', 'Unlabeled whale')}</span>}
                  </span>
                  <span className="wal-tape-asset">{row.asset}</span>
                  <span className="wal-tape-val">
                    <span className="wal-tape-usd mono">{fmtUsd(row.usd)}</span>
                    {row.amount != null && <span className="wal-tape-qty mono">{fmtQty(row.amount)} {row.asset}</span>}
                  </span>
                </a>
              )
            })}
            {tape.length === 0 && (
              <div className="wal-empty-sm"><p>{t('walletsTab.tapeQuiet', 'No large transfers in the last 24h.')}</p></div>
            )}
          </div>
        </section>
      </div>

      {/* ── Flow stack: CEX / ETF / Stables ────────────────────────── */}
      <div className="wal-flowstack">
        <section className="wal-card wal-flowcard">
          <header className="wal-card-head">
            <div className="wal-card-title-wrap">
              <span className="wal-card-title">{t('walletsTab.cexFlows', 'CEX Flows')}</span>
              <span className="wal-card-sub">
                {cexNetTotal <= 0
                  ? t('walletsTab.netLeaving', 'Net leaving exchanges')
                  : t('walletsTab.netEntering', 'Net entering exchanges')}
              </span>
            </div>
          </header>
          <div className="wal-flowlist">
            {(exFlows?.byAsset || []).slice(0, 4).map((a) => (
              <div key={a.asset} className="wal-flowline">
                <span className="wal-flowline-label">{a.asset}</span>
                <span className="wal-flowline-bars" aria-hidden>
                  <span className="wal-flowline-in" style={{ width: `${Math.min(100, ((a.inflow || 0) / ((a.inflow || 0) + (a.outflow || 0) || 1)) * 100)}%` }} />
                </span>
                <span className={`wal-flowline-net mono ${a.net >= 0 ? 'neg' : 'pos'}`}>{fmtUsd(a.net, { sign: true })}</span>
              </div>
            ))}
          </div>
          {exFlows?.topMoves?.[0] && (
            <p className="wal-flownote">
              {t('walletsTab.biggestMove', 'Biggest venue move')}: <b>{exFlows.topMoves[0].exchange}</b> {exFlows.topMoves[0].asset}{' '}
              <span className={`mono ${exFlows.topMoves[0].net >= 0 ? 'neg' : 'pos'}`}>{fmtUsd(exFlows.topMoves[0].net, { sign: true })}</span>
              {exFlows.topMoves[0].outlier && <span className="wal-outlier"> · {t('walletsTab.possiblyInternal', 'likely internal rebalance')}</span>}
            </p>
          )}
        </section>

        <section className="wal-card wal-flowcard">
          <header className="wal-card-head">
            <div className="wal-card-title-wrap">
              <span className="wal-card-title">{t('walletsTab.etfFlows', 'ETF Flows')}</span>
              <span className="wal-card-sub">
                {etf?.aggregates?.[0]?.date
                  ? `${t('walletsTab.lastSession', 'Last session')} · ${new Date(etf.aggregates[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                  : t('walletsTab.spotEtfs', 'US spot ETFs')}
              </span>
            </div>
          </header>
          <div className="wal-flowlist">
            {(etf?.aggregates || []).map((a) => (
              <div key={a.asset} className="wal-flowline">
                <span className="wal-flowline-label">{a.asset}</span>
                <span className="wal-flowline-bars" />
                <span className={`wal-flowline-net mono ${a.flowUsd >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(a.flowUsd, { sign: true })}</span>
              </div>
            ))}
            {(etf?.topFunds || []).slice(0, 2).map((f) => (
              <div key={f.ticker} className="wal-flowline wal-flowline--minor">
                <span className="wal-flowline-label">{f.ticker}</span>
                <span className="wal-flowline-issuer">{f.issuer}</span>
                <span className={`wal-flowline-net mono ${f.flowUsd >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(f.flowUsd, { sign: true })}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="wal-card wal-flowcard">
          <header className="wal-card-head">
            <div className="wal-card-title-wrap">
              <span className="wal-card-title">{t('walletsTab.stableLiquidity', 'Stable Liquidity')}</span>
              <span className="wal-card-sub">
                {stablesNet >= 0
                  ? t('walletsTab.liquidityEntering', 'Dry powder entering')
                  : t('walletsTab.liquidityLeaving', 'Liquidity being redeemed')}
              </span>
            </div>
          </header>
          <div className="wal-flowlist">
            <div className="wal-flowline">
              <span className="wal-flowline-label">{t('walletsTab.minted', 'Minted')}</span>
              <span className="wal-flowline-bars" aria-hidden>
                <span className="wal-flowline-in pos-bg" style={{ width: `${Math.min(100, ((stables?.minted24h || 0) / (((stables?.minted24h || 0) + (stables?.redeemed24h || 0)) || 1)) * 100)}%` }} />
              </span>
              <span className="wal-flowline-net mono pos">{fmtUsd(stables?.minted24h)}</span>
            </div>
            <div className="wal-flowline">
              <span className="wal-flowline-label">{t('walletsTab.redeemed', 'Redeemed')}</span>
              <span className="wal-flowline-bars" aria-hidden>
                <span className="wal-flowline-in neg-bg" style={{ width: `${Math.min(100, ((stables?.redeemed24h || 0) / (((stables?.minted24h || 0) + (stables?.redeemed24h || 0)) || 1)) * 100)}%` }} />
              </span>
              <span className="wal-flowline-net mono neg">{fmtUsd(stables?.redeemed24h)}</span>
            </div>
            <div className="wal-flowline wal-flowline--total">
              <span className="wal-flowline-label">{t('walletsTab.net24h', 'Net 24h')}</span>
              <span className="wal-flowline-bars" />
              <span className={`wal-flowline-net mono ${stablesNet >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(stablesNet, { sign: true })}</span>
            </div>
          </div>
          <p className="wal-flownote">{t('walletsTab.stablesSource', 'Circle + Tether treasury moves · issuer wallets')}</p>
        </section>
      </div>

      {/* ── Entities strip ─────────────────────────────────────────── */}
      {entities.length > 0 && (
        <div className="wal-entities">
          <span className="wal-entities-label">{t('walletsTab.mostActive', 'Most active wallets · 24h')}</span>
          <div className="wal-entities-row">
            {entities.slice(0, 8).map((e) => (
              <span key={e.label} className="wal-entity-chip" title={`${e.moves24h} moves · net ${fmtUsd(e.netInUsd, { sign: true })}`}>
                <span className="wal-entity-name">{e.label}</span>
                <span className="wal-entity-vol mono">{fmtUsd(e.volumeUsd)}</span>
                <span className={`wal-entity-dir ${e.netInUsd >= 0 ? 'in' : 'out'}`} aria-hidden>
                  {e.netInUsd >= 0 ? '▾in' : '▴out'}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default WalletsTabPanel
