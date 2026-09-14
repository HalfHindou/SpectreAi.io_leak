/**
 * MobileStatsGrid — dense 4-column key-metrics grid.
 *
 * Trading-terminal aesthetic (GMGN/Photon/Trojan): every pixel works,
 * mono numbers, tight padding, subtle hairlines between cells. Shows
 * the most relevant stats for a single token in a 4×2 layout that
 * fits any phone width without horizontal scroll.
 *
 *   MCap        Vol(24h)    Liq         Holders
 *   $158.4M     $12.4M      $4.2M       8,420
 *   ─────────────────────────────────────────────
 *   FDV         Mkt/Liq     Pair Age    24h Tx
 *   $245M       37.6×       84d         2,431
 */
import React, { useMemo } from 'react'
import { useSharedTokenDetails } from '../../contexts/TokenDetailsContext'
import { useLatestTrades } from '../../hooks/useCodexData'
import './MobileStatsGrid.css'

const fmtLargeUsd = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3)  return `$${(v / 1e3).toFixed(2)}K`
  return `$${v.toFixed(2)}`
}

const fmtLarge = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return Math.round(v).toLocaleString('en-US')
}

const fmtRatio = (a, b) => {
  const av = Number(a)
  const bv = Number(b)
  if (!Number.isFinite(av) || !Number.isFinite(bv) || bv === 0) return '—'
  return `${(av / bv).toFixed(1)}×`
}

const fmtAge = (createdAt) => {
  if (!createdAt) return '—'
  const created = Number(createdAt) * (Number(createdAt) > 1e12 ? 1 : 1000)
  const diff = Date.now() - created
  if (diff < 0) return '—'
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days >= 365) return `${(days / 365).toFixed(1)}y`
  if (days >= 30)  return `${Math.floor(days / 30)}mo`
  if (days >= 1)   return `${days}d`
  const hours = Math.floor(diff / (1000 * 60 * 60))
  return `${hours}h`
}

function Cell({ label, value, hint, tone, loading }) {
  return (
    <div className={`msg-cell${tone ? ` msg-cell--${tone}` : ''}${loading ? ' is-loading' : ''}`}>
      <span className="msg-cell-label">{label}</span>
      {loading ? (
        <span className="msg-cell-skeleton" aria-hidden="true" />
      ) : (
        <span className="msg-cell-value">{value || '—'}</span>
      )}
      {hint && <span className="msg-cell-hint">{hint}</span>}
    </div>
  )
}

export default function MobileStatsGrid({ token }) {
  const sharedDetails = useSharedTokenDetails() || {}
  const { tokenData: liveData, loading: loadingDetails } = sharedDetails
  const { trades } = useLatestTrades(token?.address, token?.networkId || 1, 50) || {}

  // If we have no data yet, every cell shimmers - confirms structure
  // even when the network is in flight.
  const isLoading = !liveData && !!loadingDetails

  // Reasonable proxy for "24h tx count": number of trades in last 24h.
  const tx24h = useMemo(() => {
    if (!Array.isArray(trades)) return null
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return trades.filter(t => {
      const ts = Number(t?.timestamp) * (Number(t?.timestamp) > 1e12 ? 1 : 1000)
      return ts >= cutoff
    }).length
  }, [trades])

  const marketCap = liveData?.marketCap
  const volume24 = liveData?.volume24 ?? liveData?.volume24h
  const liquidity = liveData?.liquidity
  const holders = liveData?.holders
  const fdv = liveData?.fdv
  const createdAt = liveData?.createdAt ?? liveData?.pairCreatedAt

  return (
    <section className="msg" aria-label="Token statistics">
      <Cell label="MCap"     value={fmtLargeUsd(marketCap)}  loading={isLoading} />
      <Cell label="Vol(24h)" value={fmtLargeUsd(volume24)}   loading={isLoading} />
      <Cell label="Liq"      value={fmtLargeUsd(liquidity)}  loading={isLoading} />
      <Cell label="Holders"  value={fmtLarge(holders)}       loading={isLoading} />

      <Cell label="FDV"      value={fmtLargeUsd(fdv)}                    loading={isLoading} />
      <Cell label="MC/Liq"   value={fmtRatio(marketCap, liquidity)}      loading={isLoading} />
      <Cell label="Age"      value={fmtAge(createdAt)}                   loading={isLoading} />
      <Cell label="24h Tx"   value={tx24h != null ? fmtLarge(tx24h) : '—'} loading={isLoading} />
    </section>
  )
}
