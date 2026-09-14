/**
 * RzLiveDumpAlert — always-on banner that runs dump-forensics CLIENT-SIDE
 * (DexScreener + GeckoTerminal + CoinGecko macro). Hides itself when the
 * verdict is no_dump. Otherwise renders prominently at the top of the
 * project tab with verdict, price stack, summary, top sells, macro
 * disclaimer.
 *
 * Refreshes every 30s. Zero backend dependency.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useLiveDumpForensics from '@/hooks/useLiveDumpForensics'
import './rz-live-dump-alert.css'

const VERDICT = {
  retail_panic:        { kind: 'panic',  label: 'RETAIL PANIC',  tone: 'amber' },
  single_wallet_dump:  { kind: 'whale',  label: 'WHALE DUMP',    tone: 'red' },
  lp_drain:            { kind: 'drain',  label: 'LP DRAIN',      tone: 'red' },
  macro_correlated:    { kind: 'macro',  label: 'MACRO SELLOFF', tone: 'blue' },
  mixed:               { kind: 'mixed',  label: 'DUMP — MIXED',  tone: 'gray' },
  no_dump:             null,
}

function fmtAge(ms) {
  if (!ms) return '—'
  const d = Date.now() - ms
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  return `${Math.floor(d / 3_600_000)}h ago`
}
function fmtPct(n) {
  if (!Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}
function fmtUsd(n) {
  if (!Number.isFinite(Number(n))) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

const RzLiveDumpAlert = React.memo(({ ca, sym }) => {
  const { t: tr } = useTranslation()
  const { data, loading, updatedAt } = useLiveDumpForensics({ ca, enabled: !!ca })

  const cfg = useMemo(() => VERDICT[data?.verdict?.verdict] || null, [data])

  // Hide entirely when no dump or no data yet (don't pollute layout)
  if (!ca) return null
  if (!data) {
    if (loading) return null
    return null
  }
  if (!cfg) return null  // verdict is no_dump → silently hide

  const t = data.token || {}
  const v = data.verdict
  const pc = t.priceChange || {}

  return (
    <section className={`rz-lda rz-lda--${cfg.tone}`} aria-live="polite">
      <header className="rz-lda-head">
        <span className={`rz-lda-pill rz-lda-pill--${cfg.tone}`}>{cfg.label}</span>
        <span className="rz-lda-conf mono">{Math.round((v.confidence || 0) * 100)}% conviction</span>
        <span className="rz-lda-age mono">updated {fmtAge(updatedAt)}</span>
      </header>

      <div className="rz-lda-body">
        <div className="rz-lda-summary">
          <p className="rz-lda-summary-text">
            <strong>{sym || t.symbol}</strong> — {v.summary}
          </p>
          {v.reasons?.length > 0 && (
            <ul className="rz-lda-reasons">
              {v.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>

        <div className="rz-lda-stack">
          {[
            { k: '5m',  v: pc.m5 },
            { k: '1h',  v: pc.h1 },
            { k: '6h',  v: pc.h6 },
            { k: '24h', v: pc.h24 },
          ].map(({ k, v: val }) => {
            const cls = Number(val) >= 0 ? 'rz-lda-stack-cell--up' : 'rz-lda-stack-cell--down'
            return (
              <div key={k} className={`rz-lda-stack-cell ${cls}`}>
                <span className="rz-lda-stack-label">{k}</span>
                <span className="rz-lda-stack-val mono">{fmtPct(val)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {data.summary && (
      <div className="rz-lda-meta mono">
        <span>peak dump: <strong>{data.summary.peakDumpHour ?? '-'}h ago</strong></span>
        <span className="sep" />
        <span>net sell: <strong>{fmtUsd(data.summary.netSellPressureUsd)}</strong></span>
        <span className="sep" />
        <span>sellers: <strong>{data.summary.uniqueSellers ?? '-'}</strong></span>
        <span className="sep" />
        <span>top share: <strong>{data.summary.topSellerSharePct?.toFixed(1) ?? '-'}%</strong></span>
        {data.macro && (
          <>
            <span className="sep" />
            <span>BTC 24h: <strong>{fmtPct(data.macro.btcChange24h)}</strong></span>
            <span>ETH 24h: <strong>{fmtPct(data.macro.ethChange24h)}</strong></span>
          </>
        )}
      </div>
      )}

      {data.recentSells?.length > 0 && (
        <ul className="rz-lda-sells">
          {data.recentSells.slice(0, 5).map((s, i) => (
            <li key={i} className="rz-lda-sell">
              <span className="rz-lda-sell-amt mono">{fmtUsd(s.usd)}</span>
              <span className="rz-lda-sell-detail mono">{(s.baseAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens</span>
              <span className="rz-lda-sell-wallet mono">{s.wallet?.slice(0, 10) ?? '-'}…</span>
              <span className="rz-lda-sell-age mono">{s.ageMin}m ago</span>
              <a href={s.explorer} target="_blank" rel="noopener noreferrer" className="rz-lda-sell-link">{tr('researchPro.liveDumpAlert.rzlivedumpalert.view', "view")}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})

RzLiveDumpAlert.displayName = 'RzLiveDumpAlert'
export default RzLiveDumpAlert
