/**
 * RzTradeTape — last N trades for the main pair, color-coded buy/sell,
 * each linked to the explorer. Pulls from GeckoTerminal client-side
 * every 25s. Hides itself when no chain/pair available.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import usePairTrades from '@/hooks/usePairTrades'
import './rz-trade-tape.css'

function fmtAge(ms) {
  if (!ms) return ''
  const d = Date.now() - ms
  if (d < 60_000) return `${Math.floor(d / 1000)}s`
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}
function fmtUsd(n) {
  if (!Number.isFinite(Number(n))) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`
  return `$${v.toFixed(2)}`
}
function fmtTokens(n) {
  if (!Number.isFinite(Number(n))) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
function explorerUrl(chain, hash) {
  if (!hash) return null
  const c = String(chain).toLowerCase()
  if (c === 'solana' || c === 'sol') return `https://solscan.io/tx/${hash}`
  if (c === 'ethereum' || c === 'eth') return `https://etherscan.io/tx/${hash}`
  if (c === 'bsc') return `https://bscscan.com/tx/${hash}`
  if (c === 'base') return `https://basescan.org/tx/${hash}`
  if (c === 'arbitrum') return `https://arbiscan.io/tx/${hash}`
  return null
}

const TradeRow = React.memo(({ t }) => {
  const { t: tr } = useTranslation()
  const cls = t.side === 'buy' ? 'rz-tt-row--buy' : 'rz-tt-row--sell'
  const url = explorerUrl(t.chain, t.hash)
  return (
    <li className={`rz-tt-row ${cls}`}>
      <span className="rz-tt-side mono">{t.side === 'buy' ? 'BUY' : 'SELL'}</span>
      <span className="rz-tt-usd mono">{fmtUsd(t.usd)}</span>
      <span className="rz-tt-tokens mono">{fmtTokens(t.baseAmount)}</span>
      <span className="rz-tt-wallet mono">{t.wallet ? t.wallet.slice(0, 10) + '…' : '—'}</span>
      <span className="rz-tt-age mono">{fmtAge(t.ts)}</span>
      {url
        ? <a className="rz-tt-link" href={url} target="_blank" rel="noopener noreferrer">{tr('researchPro.tradeTape.traderow.view', "view")}</a>
        : <span />}
    </li>
  )
})

const RzTradeTape = React.memo(({ chain, pairAddress, ca, sym, limit = 12 }) => {
  const { t } = useTranslation()
  const { data, updatedAt } = usePairTrades({ chain, pairAddress, ca })

  // Hooks must run unconditionally — early-returning before useMemo broke
  // Rules of Hooks (would throw "Rendered fewer hooks than expected" when
  // data transitioned from non-empty to empty between renders).
  const trades = useMemo(() => (Array.isArray(data) ? data.slice(0, limit) : []), [data, limit])

  if (!ca && (!chain || !pairAddress)) return null
  if (!trades.length) return null

  const buys = trades.filter((t) => t.side === 'buy').length
  const sells = trades.length - buys
  const flow = trades.reduce((a, t) => a + (t.side === 'buy' ? t.usd : -t.usd), 0)

  return (
    <SectionShell
      id="proj-trade-tape"
      label={t('researchPro.tradeTape.rztradetape.label', "ONCHAIN · LIVE TRADES")}
      title={`${sym || 'Token'} pair tape`}
      subtitle={`Last ${trades.length} swaps · ${buys}↑ / ${sells}↓ · net ${flow >= 0 ? '+' : '-'}${fmtUsd(flow)}`}
      collapsible
      rightSlot={updatedAt && (
        <span className="rz-tt-meta mono">refreshed {fmtAge(updatedAt)} ago</span>
      )}
    >
      <ol className="rz-tt-list">
        {trades.map((t, i) => <TradeRow key={`${t.hash}-${i}`} t={t} />)}
      </ol>
    </SectionShell>
  )
})

RzTradeTape.displayName = 'RzTradeTape'
export default RzTradeTape
